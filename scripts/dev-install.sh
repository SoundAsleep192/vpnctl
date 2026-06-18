#!/usr/bin/env bash
# Install vpnctl from local source — no release needed.
# Builds all binaries, copies them to PREFIX, redeploys daemons.
#
# Usage: bash scripts/dev-install.sh [PREFIX]
#   PREFIX  directory to install binaries into (default: dirname of current vpnctl in PATH,
#           or ~/.local/bin if vpnctl is not found in PATH)
#
# Requires: bun in PATH, sudo for daemon redeploy.

set -euo pipefail
cd "$(dirname "$0")/.."

# ── resolve install prefix ────────────────────────────────────────────────────
if [[ "${1:-}" != "" ]]; then
  PREFIX="$1"
elif command -v vpnctl &>/dev/null; then
  PREFIX="$(dirname "$(command -v vpnctl)")"
else
  PREFIX="$HOME/.local/bin"
fi

echo "=== dev-install: prefix=$PREFIX ==="

# ── build ─────────────────────────────────────────────────────────────────────
echo ""
echo "--- building vpnctl ---"
bun build --compile bin/vpnctl.ts --outfile dist/vpnctl

echo "--- building daemons ---"
bun build --compile src/daemon/monitor.ts --outfile dist/vpnctl-monitor
bun build --compile src/daemon/tunnel.ts  --outfile dist/vpnctl-tunnel
bun build --compile src/daemon/tray.ts    --outfile dist/vpnctl-tray

echo "--- copying systray2 Go helper ---"
rm -rf dist/traybin
cp -r node_modules/systray2/traybin dist/traybin

# ── deploy binaries ───────────────────────────────────────────────────────────
echo ""
echo "--- installing binaries to $PREFIX ---"
mkdir -p "$PREFIX"
cp dist/vpnctl dist/vpnctl-monitor dist/vpnctl-tunnel dist/vpnctl-tray "$PREFIX/"
rm -rf "$PREFIX/traybin"
cp -r dist/traybin "$PREFIX/"
chmod +x "$PREFIX/vpnctl" "$PREFIX/vpnctl-monitor" "$PREFIX/vpnctl-tunnel" "$PREFIX/vpnctl-tray" "$PREFIX/traybin/"*

# ── redeploy daemons ──────────────────────────────────────────────────────────
echo ""
echo "--- redeploying system daemons (sudo) ---"
sudo "$PREFIX/vpnctl" install

echo "--- redeploying tray agent ---"
"$PREFIX/vpnctl" tray install

echo ""
echo "=== dev-install done ==="
echo "    vpnctl:       $PREFIX/vpnctl"
echo "    vpnctl-tray:  $PREFIX/vpnctl-tray"
