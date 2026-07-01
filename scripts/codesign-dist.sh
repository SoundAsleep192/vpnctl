#!/usr/bin/env bash
set -euo pipefail

# `bun build --compile` already marks its output "adhoc,linker-signed", but bun
# appends the bundled JS after the linker signs, so `codesign --verify` reports
# "invalid signature (code or signature have been modified)" until the binary is
# re-signed. Ad-hoc re-signing fixes that for locally-built binaries, but does NOT
# help a binary carrying the com.apple.quarantine xattr (e.g. a downloaded release
# asset) — that still gets killed without a notarized Developer ID signature.

cd "$(dirname "$0")/.."

# Stage the systray Go helper next to vpnctl-tray (where the daemon chdir's to
# find it). It ships unsigned from npm and `bun install` drops its +x bit, so
# restore that, then ad-hoc sign it below alongside the rest.
rm -rf dist/traybin
mkdir -p dist/traybin
cp node_modules/systray2/traybin/tray_darwin_release dist/traybin/tray_darwin_release
chmod +x dist/traybin/tray_darwin_release

SIGN_BINARIES=(dist/vpnctl dist/traybin/tray_darwin_release)
VERIFY_BINARIES=(dist/vpnctl dist/vpnctl-monitor dist/vpnctl-tunnel dist/vpnctl-tray dist/traybin/tray_darwin_release)

codesign --force --sign - "${SIGN_BINARIES[@]}"
./scripts/link-dist-aliases.sh

for binary in "${VERIFY_BINARIES[@]}"; do
  codesign --verify --strict "$binary"
done
