#!/usr/bin/env bash
set -euo pipefail

# `bun build --compile` already marks its output "adhoc,linker-signed", but bun
# appends the bundled JS after the linker signs, so `codesign --verify` reports
# "invalid signature (code or signature have been modified)" until the binary is
# re-signed. Ad-hoc re-signing fixes that for locally-built binaries, but does NOT
# help a binary carrying the com.apple.quarantine xattr (e.g. a downloaded release
# asset) — that still gets killed without a notarized Developer ID signature.

cd "$(dirname "$0")/.."

BINARIES=(dist/vpnctl dist/vpnctl-monitor dist/vpnctl-tunnel)

codesign --force --sign - "${BINARIES[@]}"

for binary in "${BINARIES[@]}"; do
  codesign --verify --strict "$binary"
done
