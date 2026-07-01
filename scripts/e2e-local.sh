#!/usr/bin/env bash
# Local, SAFE end-to-end test for `vpnctl update`'s redeploy path — the real
# launchd/pf/dns lifecycle that fake-Exec unit tests can't model (issue #45).
#
# Unlike scripts/e2e/scenarios/update-race.sh (which provisions a throwaway
# install on a disposable runner/VM), this harness is meant to run on a machine
# with vpnctl ALREADY installed and protecting it: it backs up your real
# binaries, swaps in a synthetic-old build over them, runs `vpnctl update`, and
# asserts the post-update state — then ALWAYS restores your originals on exit.
# Assertions are shared with CI via scripts/e2e/lib/assert.sh.
#
# Usage:   bash scripts/e2e-local.sh
# Env:     VPNCTL_INSTALL_DIR     where the binaries live (default: dir of `vpnctl` on PATH)
#          VPNCTL_E2E_OLD_VERSION synthetic version to build (default: 0.0.1)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/e2e/lib/assert.sh disable=SC1091
source "$REPO_ROOT/scripts/e2e/lib/assert.sh"
# shellcheck source=scripts/e2e/lib/lifecycle.sh disable=SC1091
source "$REPO_ROOT/scripts/e2e/lib/lifecycle.sh"

INSTALL_DIR="${VPNCTL_INSTALL_DIR:-$(dirname "$(command -v vpnctl 2>/dev/null || echo "$HOME/.local/bin/vpnctl")")}"
OLD_VERSION="${VPNCTL_E2E_OLD_VERSION:-0.0.1}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "vpnctl e2e only runs on macOS." >&2
  exit 1
fi

# --- safety: always restore the original binaries on exit ---------------------
BACKUP_DIR=""
swapped=0

cleanup() {
  if [ "$swapped" -eq 1 ] && [ -n "$BACKUP_DIR" ]; then
    echo
    echo "Restoring your original binaries to $INSTALL_DIR ..."
    for binary in "${RELEASE_BINARIES[@]}"; do
      [ -f "$BACKUP_DIR/$binary" ] && cp "$BACKUP_DIR/$binary" "$INSTALL_DIR/$binary"
    done
    echo "Restored. To reload the daemons from them: sudo vpnctl __install"
  fi
  [ -n "$BACKUP_DIR" ] && rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

echo "Building synthetic v$OLD_VERSION from the current checkout..."
build_synthetic_old "$OLD_VERSION" "$REPO_ROOT"

echo "Backing up current binaries from $INSTALL_DIR ..."
BACKUP_DIR=$(mktemp -d)
for binary in "${RELEASE_BINARIES[@]}"; do
  cp "$INSTALL_DIR/$binary" "$BACKUP_DIR/$binary"
done

echo "Installing synthetic v$OLD_VERSION over $INSTALL_DIR ..."
install_binaries_to "$INSTALL_DIR" "$REPO_ROOT/dist"
swapped=1

actual="$("$INSTALL_DIR/vpnctl" --version)"
if [ "$actual" != "$OLD_VERSION" ]; then
  echo "FAIL: expected synthetic version $OLD_VERSION, got $actual" >&2
  exit 1
fi
echo "Synthetic version in place: $actual"

echo
echo "Running 'vpnctl update' (will prompt for sudo)..."
"$INSTALL_DIR/vpnctl" update

echo
echo "Verifying system state..."
poll_assert "monitor daemon running" daemon_running "$LAUNCHD_LABEL_MONITOR"
poll_assert "tunnel daemon running" daemon_running "$LAUNCHD_LABEL_TUNNEL"
assert "pf enabled" pf_enabled
assert "anchor '$PF_ANCHOR_NAME' loaded" anchor_loaded
assert "/etc/hosts sinkhole present" sinkhole_present

assert_summary "e2e-local (update redeploy)"
