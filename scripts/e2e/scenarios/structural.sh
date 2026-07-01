#!/usr/bin/env bash
# Structural E2E scenario (issue #45): full vpnctl lifecycle against REAL
# launchctl/pfctl/dscacheutil//etc/hosts, with no VPN server and no secrets.
#
# Note on tunnel state: sing-box brings up the TUN interface (utun) as soon as
# the daemon starts, even though the configured server is unroutable, so the
# system converges to `tunnel: up` with the sinkhole LIFTED — egress is then
# gated by the pf anchor (pass-out only on utun => the dead handshake drops the
# connection; direct egress to the domain tables is blocked). The unambiguous,
# race-free fail-closed state is therefore tunnel-DOWN, which we force with
# `vpnctl down` and assert there: sinkhole present + the probe domain resolving
# to the 0.0.0.0 sink. pf stays enabled through every transition.
#
# DESTRUCTIVE: mutates pf, /etc/hosts and system LaunchDaemons. Run on a
# disposable macOS env (CI runner or a throwaway VM), never a daily driver.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/assert.sh disable=SC1091
source "$HERE/../lib/assert.sh"
# shellcheck source=../lib/lifecycle.sh disable=SC1091
source "$HERE/../lib/lifecycle.sh"

# Asserted after every mutating step: the killswitch must never drop pf, even
# mid-transition. A single failure here means traffic could leak.
assert_failclosed_invariant() {
  assert "[invariant] pf still enabled" pf_enabled
}

echo "=== vpnctl structural E2E ==="

require_sing_box || exit 1

echo
echo "-- setup (non-interactive, fake unroutable URI) --"
vpnctl_setup
assert "config.json written" test -f "$HOME/.config/vpnctl/config.json"
assert "sing-box.json written" test -f "$HOME/.config/vpnctl/sing-box.json"

echo
echo "-- install --"
vpnctl_install
poll_assert "monitor daemon running" daemon_running "$LAUNCHD_LABEL_MONITOR"
poll_assert "tunnel daemon running" daemon_running "$LAUNCHD_LABEL_TUNNEL"
assert "pf enabled" pf_enabled
assert "anchor '$PF_ANCHOR_NAME' loaded" anchor_loaded
assert "/etc/pf.conf patched" pf_conf_patched

echo
echo "-- status --"
vpnctl_status
assert "status exits 0" vpnctl_status
assert "status reports pf enabled" bash -c "sudo \"$VPNCTL_BIN\" status | grep -qE '^pf: enabled'"
assert "status renders a tunnel state" bash -c "sudo \"$VPNCTL_BIN\" status | grep -qE '^tunnel: (up|down)'"

echo
echo "-- doctor --"
assert "doctor exits 0 (no failing checks)" vpnctl_doctor

echo
echo "-- up (tunnel daemon reload must not drop pf) --"
vpnctl_up
poll_assert "tunnel daemon loaded after up" daemon_loaded "$LAUNCHD_LABEL_TUNNEL"
assert_failclosed_invariant
assert "anchor still loaded after up" anchor_loaded

echo
echo "-- down (forces the deterministic fail-closed state) --"
vpnctl_down
poll_assert "tunnel daemon stopped after down" daemon_gone "$LAUNCHD_LABEL_TUNNEL"
assert "monitor daemon still running after down" daemon_running "$LAUNCHD_LABEL_MONITOR"
assert_failclosed_invariant
poll_assert "sinkhole present after down" sinkhole_present
poll_assert "probe domain '$SINKHOLE_PROBE_DOMAIN' resolves to sink (tunnel down)" domain_sinkholed
assert "status shows killswitch notice when tunnel is down" bash -c "sudo \"\$VPNCTL_BIN\" status | grep -qF 'killswitch protection'"
assert "exec shows killswitch notice when tunnel is down" bash -c "sudo \"\$VPNCTL_BIN\" exec -- true 2>&1 | grep -qF 'killswitch protection'"

echo
echo "-- refresh --"
vpnctl_refresh
assert "anchor still loaded after refresh" anchor_loaded
assert "sinkhole still present after refresh" sinkhole_present
assert_failclosed_invariant

echo
echo "-- uninstall --"
vpnctl_uninstall
poll_assert "monitor daemon gone" daemon_gone "$LAUNCHD_LABEL_MONITOR"
poll_assert "tunnel daemon gone" daemon_gone "$LAUNCHD_LABEL_TUNNEL"
assert "anchor file removed" anchor_file_gone
assert "/etc/pf.conf reverted" pf_conf_reverted
assert "/etc/hosts sinkhole cleaned" sinkhole_absent

assert_summary "structural E2E"
