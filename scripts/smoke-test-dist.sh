#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

./dist/vpnctl --help | grep -q "Fail-closed macOS VPN killswitch"

# Same VLESS+Reality URI used as the fixture in test/setup.test.ts.
SAMPLE_VLESS_URI="vless://00000000-0000-4000-8000-000000000000@vpn.example.com:443?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision&sni=example.com&fp=firefox&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=0123456789abcdef&spx=%2F#example-server"

# CONFIG_DIR (src/core/paths.ts) is derived from $HOME, not $XDG_CONFIG_HOME — point
# HOME at a scratch directory so setup doesn't touch the real user config.
SMOKE_TEST_HOME=$(mktemp -d)
trap 'rm -rf "$SMOKE_TEST_HOME"' EXIT

HOME="$SMOKE_TEST_HOME" ./dist/vpnctl __setup --uri "$SAMPLE_VLESS_URI" >/dev/null

test -s "$SMOKE_TEST_HOME/.config/vpnctl/config.json"
test -s "$SMOKE_TEST_HOME/.config/vpnctl/sing-box.json"
grep -q "vpn.example.com" "$SMOKE_TEST_HOME/.config/vpnctl/config.json"

# Guard the bun-compile interop regression: the tray daemon must get past
# `new SysTray(...)` without an "Object is not a constructor" / missing-package
# crash that unit tests can't see (only the compiled binary exhibits it). This is
# display-independent — CI runners are headless, so we only assert the fatal
# startup errors are absent, not that a menu-bar icon actually attaches.
TRAY_OUT=$(mktemp)
./dist/vpnctl-tray >"$TRAY_OUT" 2>&1 &
TRAY_PID=$!
sleep 3
kill "$TRAY_PID" 2>/dev/null || true
wait "$TRAY_PID" 2>/dev/null || true
pkill -f tray_darwin_release 2>/dev/null || true
if grep -qE "is not a constructor|Cannot find package" "$TRAY_OUT"; then
  echo "smoke-test-dist: tray failed to start (compiled interop regression):"
  cat "$TRAY_OUT"
  rm -f "$TRAY_OUT"
  exit 1
fi
rm -f "$TRAY_OUT"

echo "smoke-test-dist: OK"
