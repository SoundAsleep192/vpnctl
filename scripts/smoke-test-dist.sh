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

HOME="$SMOKE_TEST_HOME" ./dist/vpnctl setup --uri "$SAMPLE_VLESS_URI"

test -s "$SMOKE_TEST_HOME/.config/vpnctl/config.json"
test -s "$SMOKE_TEST_HOME/.config/vpnctl/sing-box.json"
grep -q "vpn.example.com" "$SMOKE_TEST_HOME/.config/vpnctl/config.json"

echo "smoke-test-dist: OK"
