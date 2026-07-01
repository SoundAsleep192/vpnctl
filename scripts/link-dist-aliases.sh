#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -x dist/vpnctl ]]; then
  printf 'dist/vpnctl missing or not executable; run bun run build first\n' >&2
  exit 1
fi

rm -f dist/vpnctl-monitor dist/vpnctl-tunnel dist/vpnctl-tray
ln dist/vpnctl dist/vpnctl-monitor
ln dist/vpnctl dist/vpnctl-tunnel
ln dist/vpnctl dist/vpnctl-tray
chmod +x dist/vpnctl dist/vpnctl-monitor dist/vpnctl-tunnel dist/vpnctl-tray
