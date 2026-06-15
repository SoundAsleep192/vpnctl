# shellcheck shell=bash
# Reusable E2E assert library for vpnctl (issue #45).
#
# Sourced by both the CI scenarios under scripts/e2e/ and the local
# scripts/e2e-local.sh harness, so the two share one source of truth for what
# a healthy / fail-closed system state looks like. These query REAL system
# state (launchctl/pfctl/dscacheutil//etc/hosts) — there is no mocking here;
# that is the whole point of the L1 tier.
#
# All state-query functions are quiet (exit status only) so they compose inside
# `assert`. Marker/label literals are mirrored from src/core/paths.ts — keep
# them in sync if those constants ever change.

# --- constants mirrored from src/core/paths.ts --------------------------------
# Consumed by the sourcing scenario scripts, not within this file.
# shellcheck disable=SC2034
LAUNCHD_LABEL_MONITOR="com.vpnctl.monitor"
# shellcheck disable=SC2034
LAUNCHD_LABEL_TUNNEL="com.vpnctl.tunnel"
PF_ANCHOR_NAME="vpnctl"
PF_ANCHOR_FILE="/etc/pf.anchors/vpnctl"
PF_CONF_FILE="/etc/pf.conf"
PF_CONF_MARKER_BEGIN="# === BEGIN VPNCTL ==="
HOSTS_FILE="/etc/hosts"
HOSTS_MARKER_BEGIN="# === BEGIN VPNCTL SINKHOLE ==="

# A domain from the default ai-dev-tools preset (templates/domains/ai-dev-tools.txt).
# Used to observe the fail-closed sinkhole: when the tunnel is down this must
# resolve to the 0.0.0.0 sink, not a real address.
SINKHOLE_PROBE_DOMAIN="${SINKHOLE_PROBE_DOMAIN:-api.anthropic.com}"
SINKHOLE_SINK_V4="0.0.0.0"

# --- assert framework ---------------------------------------------------------
ASSERT_PASS_COUNT=0
ASSERT_FAIL_COUNT=0

# assert "<description>" <command> [args...]
# Runs the command quietly; records pass/fail and prints a one-line result.
assert() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  OK   ${description}"
    ASSERT_PASS_COUNT=$((ASSERT_PASS_COUNT + 1))
    return 0
  fi
  echo "  FAIL ${description}"
  ASSERT_FAIL_COUNT=$((ASSERT_FAIL_COUNT + 1))
  return 1
}

# poll_assert "<description>" <command> [args...]
# Like `assert`, but retries the predicate until it passes or the poll timeout
# elapses. launchd teardown/bootstrap and pf/dns reconciliation are async, so a
# one-shot check races them; this waits for the expected state to settle (with a
# bound) exactly as the product's own reconcile loop does.
ASSERT_POLL_TIMEOUT_SECONDS="${ASSERT_POLL_TIMEOUT_SECONDS:-15}"
poll_assert() {
  local description="$1"
  shift
  local deadline=$(($(date +%s) + ASSERT_POLL_TIMEOUT_SECONDS))
  while true; do
    if "$@" >/dev/null 2>&1; then
      echo "  OK   ${description}"
      ASSERT_PASS_COUNT=$((ASSERT_PASS_COUNT + 1))
      return 0
    fi
    [ "$(date +%s)" -ge "$deadline" ] && break
    sleep 1
  done
  echo "  FAIL ${description} (after ${ASSERT_POLL_TIMEOUT_SECONDS}s)"
  ASSERT_FAIL_COUNT=$((ASSERT_FAIL_COUNT + 1))
  return 1
}

# assert_not "<description>" <command> [args...]
# Passes when the command FAILS (for absence/teardown assertions).
assert_not() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  FAIL ${description}"
    ASSERT_FAIL_COUNT=$((ASSERT_FAIL_COUNT + 1))
    return 1
  fi
  echo "  OK   ${description}"
  ASSERT_PASS_COUNT=$((ASSERT_PASS_COUNT + 1))
  return 0
}

# assert_summary "<scenario name>"
# Prints the tally and returns nonzero if any assertion failed.
assert_summary() {
  local scenario="$1"
  echo
  if [ "$ASSERT_FAIL_COUNT" -eq 0 ]; then
    echo "${scenario}: PASS — ${ASSERT_PASS_COUNT} assertion(s) green."
    return 0
  fi
  echo "${scenario}: FAIL — ${ASSERT_FAIL_COUNT} of $((ASSERT_PASS_COUNT + ASSERT_FAIL_COUNT)) assertion(s) failed." >&2
  return 1
}

# --- daemon state -------------------------------------------------------------
# launchctl's system domain and pfctl both require root to read accurately, so
# these shell out via sudo. CI runners and the throwaway VM both have
# passwordless sudo; a local run prompts once and caches.
daemon_loaded() {
  sudo launchctl print "system/$1" >/dev/null 2>&1
}

daemon_running() {
  sudo launchctl print "system/$1" 2>/dev/null | grep -q "state = running"
}

daemon_gone() {
  ! sudo launchctl print "system/$1" >/dev/null 2>&1
}

# --- pf / anchor --------------------------------------------------------------
pf_enabled() {
  sudo pfctl -s info 2>/dev/null | grep -qE "^Status:[[:space:]]*Enabled"
}

anchor_loaded() {
  [ -n "$(sudo pfctl -a "$PF_ANCHOR_NAME" -s rules 2>/dev/null)" ]
}

# Teardown signal is the anchor FILE being gone plus pf.conf no longer
# referencing the anchor (asserted separately via pf_conf_reverted). uninstall
# doesn't flush the kernel anchor ruleset, but once pf.conf drops the `anchor
# "vpnctl"` reference those rules are orphaned and never evaluated — and they
# are block rules, so even lingering they only ever fail *closed*.
anchor_file_gone() {
  [ ! -f "$PF_ANCHOR_FILE" ]
}

pf_conf_patched() {
  grep -qF "$PF_CONF_MARKER_BEGIN" "$PF_CONF_FILE"
}

pf_conf_reverted() {
  ! grep -qF "$PF_CONF_MARKER_BEGIN" "$PF_CONF_FILE"
}

# --- /etc/hosts sinkhole ------------------------------------------------------
sinkhole_present() {
  grep -qF "$HOSTS_MARKER_BEGIN" "$HOSTS_FILE"
}

sinkhole_absent() {
  ! grep -qF "$HOSTS_MARKER_BEGIN" "$HOSTS_FILE"
}

# --- fail-closed invariant ----------------------------------------------------
# With the tunnel down, a configured domain must resolve to the 0.0.0.0 sink
# (block-by-default). This is the safety core: if this ever passes traffic to a
# real address while the tunnel is down, the killswitch has failed open.
domain_sinkholed() {
  local domain="${1:-$SINKHOLE_PROBE_DOMAIN}"
  dscacheutil -q host -a name "$domain" 2>/dev/null | grep -qF "ip_address: ${SINKHOLE_SINK_V4}"
}
