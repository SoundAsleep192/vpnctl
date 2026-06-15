#!/usr/bin/env bash
# Update-race E2E scenario (issue #45): regression for the #44 EIO-5 bug
# (`launchctl bootstrap ... 5: Input/output error` when redeploying the RUNNING
# monitor daemon during `vpnctl update`).
#
# The bug lives in installDaemon's bootout-then-bootstrap of an already-running
# daemon, which `vpnctl update` reaches via runInstall. We prove it two ways:
#
#   1. REDEPLOY-OVER-RUNNING (network-free, deterministic, runs everywhere):
#      install a synthetic build with its daemons running, then run
#      `vpnctl install` AGAIN — the exact bootout->bootstrap path the EIO-5 fix
#      guards — and assert the running daemons survive the redeploy.
#   2. LIVE UPDATE (delivery leg): run `vpnctl update` against the real latest
#      release and assert the version bumps + daemons redeploy. This needs to
#      reach api.github.com, so it is enforced on CI (E2E_REQUIRE_LIVE_UPDATE=1)
#      and skipped with a notice when GitHub is unreachable locally (e.g. a VM
#      NAT that resets the api.github.com TLS handshake).
#
# DESTRUCTIVE: loads system LaunchDaemons. Run on a disposable macOS env.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
# shellcheck source=../lib/assert.sh disable=SC1091
source "$HERE/../lib/assert.sh"
# shellcheck source=../lib/lifecycle.sh disable=SC1091
source "$HERE/../lib/lifecycle.sh"

SYNTHETIC_OLD_VERSION="${VPNCTL_E2E_OLD_VERSION:-0.0.1}"
REQUIRE_LIVE_UPDATE="${E2E_REQUIRE_LIVE_UPDATE:-0}"

echo "=== vpnctl update-race E2E ==="

require_sing_box || exit 1

INSTALL_DIR="$(mktemp -d)"
export VPNCTL_BIN="$INSTALL_DIR/vpnctl"

cleanup() {
  sudo "$VPNCTL_BIN" uninstall --purge >/dev/null 2>&1 || true
  rm -rf "$INSTALL_DIR"
}
trap cleanup EXIT

echo
echo "-- build + install synthetic v$SYNTHETIC_OLD_VERSION --"
build_synthetic_old "$SYNTHETIC_OLD_VERSION" "$REPO_ROOT"
install_binaries_to "$INSTALL_DIR" "$REPO_ROOT/dist"

vpnctl_setup
vpnctl_install
assert "synthetic version is $SYNTHETIC_OLD_VERSION" bash -c "[ \"\$('$VPNCTL_BIN' --version)\" = '$SYNTHETIC_OLD_VERSION' ]"
poll_assert "monitor daemon running before redeploy" daemon_running "$LAUNCHD_LABEL_MONITOR"
poll_assert "tunnel daemon running before redeploy" daemon_running "$LAUNCHD_LABEL_TUNNEL"

echo
echo "-- redeploy over RUNNING daemons (network-free EIO-5 regression) --"
# Re-running install boots out and re-bootstraps the live daemons — the exact
# path that raced with launchd's async teardown (errno 5) before #44's fix.
vpnctl_install
poll_assert "monitor daemon running after redeploy" daemon_running "$LAUNCHD_LABEL_MONITOR"
poll_assert "tunnel daemon running after redeploy" daemon_running "$LAUNCHD_LABEL_TUNNEL"
assert "pf enabled after redeploy" pf_enabled
assert "anchor '$PF_ANCHOR_NAME' loaded after redeploy" anchor_loaded

echo
echo "-- live update (delivery leg) --"
github_reachable() {
  curl -fsS --max-time 8 -H "User-Agent: vpnctl" \
    "https://api.github.com/repos/SoundAsleep192/vpnctl/releases/latest" >/dev/null 2>&1
}

if [ "$REQUIRE_LIVE_UPDATE" != "1" ] && ! github_reachable; then
  echo "  SKIP live update — api.github.com unreachable from here, and"
  echo "       E2E_REQUIRE_LIVE_UPDATE != 1 (the redeploy path above already"
  echo "       proved the EIO-5 regression network-free)."
else
  # `vpnctl update` self-sudoes after its version check, so no sudo prefix here.
  "$VPNCTL_BIN" update
  assert "version bumped above $SYNTHETIC_OLD_VERSION" bash -c \
    "[ \"\$('$VPNCTL_BIN' --version)\" != '$SYNTHETIC_OLD_VERSION' ]"
  poll_assert "monitor daemon running after update" daemon_running "$LAUNCHD_LABEL_MONITOR"
  poll_assert "tunnel daemon running after update" daemon_running "$LAUNCHD_LABEL_TUNNEL"
  assert "pf enabled after update" pf_enabled
  assert "anchor '$PF_ANCHOR_NAME' loaded after update" anchor_loaded
fi

assert_summary "update-race E2E"
