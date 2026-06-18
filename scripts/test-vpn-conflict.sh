#!/usr/bin/env bash
# Manual test for VPN conflict detection (issue #19).
#
# Creates a fake utun interface via the macOS kernel utun control socket,
# assigns it an IP, runs vpnctl doctor + status from source, then cleans up.
#
# Requirements: clang (Xcode CLI tools), sudo, bun in PATH.

set -euo pipefail
cd "$(dirname "$0")/.."

DEV_BIN=/tmp/vpnctl-dev-test
UTUN_HELPER=/tmp/vpnctl-test-utun
UTUN_ADDR=10.99.0.1
UTUN_PID=
UTUN_LOG=/tmp/vpnctl-test-utun.log
UTUN_IFACE=  # filled in after the helper starts and reports the assigned name

cleanup() {
  echo ""
  echo "--- tearing down ${UTUN_IFACE:-utun} ---"
  if [[ -n "$UTUN_PID" ]]; then
    sudo kill "$UTUN_PID" 2>/dev/null || true
    wait "$UTUN_PID" 2>/dev/null || true
  fi
  sudo pkill -f "vpnctl-test-utun" 2>/dev/null || true
  rm -f "$UTUN_HELPER" "$DEV_BIN" /tmp/vpnctl-test-utun.c "$UTUN_LOG"
}
trap cleanup EXIT

# ── build ─────────────────────────────────────────────────────────────────────
echo "=== building dev binary ==="
bun build --target=bun --outfile="$DEV_BIN" bin/vpnctl.ts
chmod +x "$DEV_BIN"

# ── compile utun helper ───────────────────────────────────────────────────────
# sc_unit=0 means auto-assign the next available unit.
# getsockopt(UTUN_OPT_IFNAME) reads back the actual assigned interface name.
# while(1) sleep(1) keeps the socket open so the interface stays alive.
cat > /tmp/vpnctl-test-utun.c << 'EOF'
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/sys_domain.h>
#include <sys/kern_control.h>
#include <net/if_utun.h>

int main(void) {
    signal(SIGHUP,  SIG_IGN);
    signal(SIGPIPE, SIG_IGN);

    int fd = socket(PF_SYSTEM, SOCK_DGRAM, SYSPROTO_CONTROL);
    if (fd < 0) { perror("socket"); return 1; }

    struct ctl_info info;
    memset(&info, 0, sizeof(info));
    strncpy(info.ctl_name, UTUN_CONTROL_NAME, sizeof(info.ctl_name));
    if (ioctl(fd, CTLIOCGINFO, &info) < 0) { perror("ioctl"); return 1; }

    struct sockaddr_ctl sc;
    memset(&sc, 0, sizeof(sc));
    sc.sc_len     = sizeof(sc);
    sc.sc_family  = AF_SYSTEM;
    sc.ss_sysaddr = AF_SYS_CONTROL;
    sc.sc_id      = info.ctl_id;
    sc.sc_unit    = 0;  /* 0 = auto-assign next available unit */

    if (connect(fd, (struct sockaddr *)&sc, sizeof(sc)) < 0) { perror("connect"); return 1; }

    char ifname[32] = {};
    socklen_t ifname_len = sizeof(ifname);
    if (getsockopt(fd, SYSPROTO_CONTROL, UTUN_OPT_IFNAME, ifname, &ifname_len) < 0) {
        perror("getsockopt UTUN_OPT_IFNAME"); return 1;
    }

    printf("%s created\n", ifname); fflush(stdout);
    while (1) sleep(1);
    return 0;
}
EOF
echo "=== compiling utun helper ==="
clang /tmp/vpnctl-test-utun.c -o "$UTUN_HELPER"

# ── baseline ──────────────────────────────────────────────────────────────────
echo ""
echo "=== baseline (no competing VPN) ==="
sudo "$DEV_BIN" doctor 2>/dev/null | grep -E "other VPN|routing conflict"

# ── bring up fake utun ────────────────────────────────────────────────────────
echo ""
echo "=== creating test utun ==="
rm -f "$UTUN_LOG"
sudo "$UTUN_HELPER" > "$UTUN_LOG" 2>&1 &
UTUN_PID=$!

for _ in $(seq 1 25); do
  grep -q "created" "$UTUN_LOG" 2>/dev/null && break
  sleep 0.2
done
grep -q "created" "$UTUN_LOG" 2>/dev/null || { echo "ERROR: helper failed:"; cat "$UTUN_LOG"; exit 1; }

UTUN_IFACE=$(grep "created" "$UTUN_LOG" | awk '{print $1}')
echo "helper assigned: $UTUN_IFACE"

sudo ifconfig "$UTUN_IFACE" "$UTUN_ADDR" "$UTUN_ADDR" netmask 255.255.255.255 up
echo "$UTUN_IFACE up with inet $UTUN_ADDR"

# ── test detection ────────────────────────────────────────────────────────────
echo ""
echo "=== vpnctl doctor (expect WARN for $UTUN_IFACE) ==="
sudo "$DEV_BIN" doctor 2>/dev/null | grep -E "other VPN|routing conflict|---"

echo ""
echo "=== vpnctl status (expect 'other VPN interfaces' section) ==="
sudo "$DEV_BIN" status 2>/dev/null | grep -A4 "other VPN" || echo "(section absent — check formatStatus)"

echo ""
echo "=== done — cleanup on exit ==="
