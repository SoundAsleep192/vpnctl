#!/usr/bin/env bash
set -euo pipefail

REPO="SoundAsleep192/vpnctl"
INSTALL_DIR="${VPNCTL_INSTALL_DIR:-$HOME/.local/bin}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "vpnctl only supports macOS." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

ASSET="vpnctl-darwin-${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading ${ASSET} from the latest vpnctl release..."
# Retry/resume: the GitHub release CDN occasionally stalls a connection, and a
# bare `curl -fsSL` then hangs forever instead of recovering.
curl -fL --retry 5 --retry-all-errors --retry-delay 2 --connect-timeout 15 -C - "$URL" -o "$TMP_DIR/$ASSET"

mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/$ASSET" -C "$INSTALL_DIR"

echo "Installed vpnctl, vpnctl-monitor, vpnctl-tunnel, vpnctl-tray to $INSTALL_DIR"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "$INSTALL_DIR is not on your PATH. Add it, e.g.:"
    echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc"
    ;;
esac

echo
echo "Next steps:"
echo "  1. Install sing-box if needed: brew install sing-box"
echo "  2. vpnctl setup"
echo "  3. sudo vpnctl install"
