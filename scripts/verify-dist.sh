#!/usr/bin/env bash
set -euo pipefail

# `bun build --compile` already marks its output "adhoc,linker-signed", but bun
# appends the bundled JS after the linker signs, so `codesign --verify` reports
# "invalid signature (code or signature have been modified)" until the binary is
# re-signed. Ad-hoc re-signing fixes that for locally-built binaries, but does NOT
# help a binary carrying the com.apple.quarantine xattr (e.g. a downloaded release
# asset) — that still gets killed without a notarized Developer ID signature.

cd "$(dirname "$0")/.."

bun run build
bun run build:daemons

BINARIES=(dist/vpnctl dist/vpnctl-monitor dist/vpnctl-tunnel)

codesign --force --sign - "${BINARIES[@]}"

for binary in "${BINARIES[@]}"; do
  codesign --verify --strict "$binary"
done

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

echo "verify-dist: OK"
