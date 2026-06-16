#!/usr/bin/env bash
# Desired-state E2E scenario: the unprivileged tray controls the tunnel by
# writing ~/.config/vpnctl/desired-tunnel; the root monitor enforces it with NO
# sudo prompt. This asserts both halves of that contract:
#   1. a plain (non-sudo) file write toggles the tunnel daemon, and
#   2. stopping the tunnel this way keeps the killswitch fail-closed (the
#      enforcement runs in its own try, so it must never skip the sinkhole/anchor
#      reconcile — a regression there would leak).
#
# Unit tests with a fake Exec can't see the real monitor watching the file and
# driving launchctl, which is exactly the integration this tier covers.
#
# DESTRUCTIVE: mutates pf, /etc/hosts and system LaunchDaemons. Run on a
# disposable macOS env (CI runner or a throwaway VM), never a daily driver.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/assert.sh disable=SC1091
source "$HERE/../lib/assert.sh"
# shellcheck source=../lib/lifecycle.sh disable=SC1091
source "$HERE/../lib/lifecycle.sh"

assert_failclosed_invariant() {
  assert "[invariant] pf still enabled" pf_enabled
}

echo "=== vpnctl desired-state E2E ==="

require_sing_box || exit 1

echo
echo "-- setup + install --"
vpnctl_setup
vpnctl_install
poll_assert "monitor daemon running" daemon_running "$LAUNCHD_LABEL_MONITOR"
poll_assert "tunnel daemon running" daemon_running "$LAUNCHD_LABEL_TUNNEL"
assert_failclosed_invariant

echo
echo "-- tray writes desired=down (unprivileged, no sudo) --"
echo down >"$DESIRED_TUNNEL_FILE"
poll_assert "monitor stops the tunnel from desired=down" daemon_gone "$LAUNCHD_LABEL_TUNNEL"
assert "monitor daemon still running" daemon_running "$LAUNCHD_LABEL_MONITOR"
assert_failclosed_invariant
poll_assert "sinkhole present after desired=down" sinkhole_present
poll_assert "probe domain '$SINKHOLE_PROBE_DOMAIN' sinkholed after desired=down" domain_sinkholed

echo
echo "-- tray writes desired=up (unprivileged, no sudo) --"
echo up >"$DESIRED_TUNNEL_FILE"
poll_assert "monitor restarts the tunnel from desired=up" daemon_loaded "$LAUNCHD_LABEL_TUNNEL"
assert_failclosed_invariant

echo
echo "-- cleanup --"
vpnctl_uninstall
poll_assert "monitor daemon gone" daemon_gone "$LAUNCHD_LABEL_MONITOR"
poll_assert "tunnel daemon gone" daemon_gone "$LAUNCHD_LABEL_TUNNEL"

assert_summary "desired-state E2E"
