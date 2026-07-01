#!/usr/bin/env bash
set -euo pipefail

REPO="SoundAsleep192/vpnctl"
INSTALL_DIR="${VPNCTL_INSTALL_DIR:-$HOME/.local/bin}"
TTY_DEVICE="/dev/tty"

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

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

brew_bin() {
  if command_exists brew; then
    command -v brew
    return
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    printf '%s\n' /opt/homebrew/bin/brew
    return
  fi

  if [ -x /usr/local/bin/brew ]; then
    printf '%s\n' /usr/local/bin/brew
  fi
}

prompt_yes() {
  local prompt="$1"
  local answer

  if [ "${VPNCTL_INSTALL_ASSUME_YES:-}" = "1" ]; then
    return 0
  fi

  if [ ! -r "$TTY_DEVICE" ] || [ ! -w "$TTY_DEVICE" ]; then
    return 1
  fi

  printf "%s [y/N] " "$prompt" >"$TTY_DEVICE"
  read -r answer <"$TTY_DEVICE"

  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_homebrew() {
  local resolved_brew
  resolved_brew="$(brew_bin)"
  if [ -n "$resolved_brew" ]; then
    eval "$("$resolved_brew" shellenv)"
    return
  fi

  if ! prompt_yes "Homebrew is required to install sing-box but was not found. Install Homebrew now?"; then
    echo "Homebrew not found. Install Homebrew or sing-box, then rerun this installer." >&2
    exit 1
  fi

  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_sing_box() {
  local resolved_brew

  if command_exists sing-box || [ -x /opt/homebrew/bin/sing-box ] || [ -x /usr/local/bin/sing-box ]; then
    return
  fi

  ensure_homebrew
  resolved_brew="$(brew_bin)"
  if [ -z "$resolved_brew" ]; then
    echo "Homebrew installed but brew was not found on PATH." >&2
    exit 1
  fi

  echo "Installing sing-box..."
  "$resolved_brew" install sing-box
}

ensure_rosetta() {
  if [ "$ARCH" != "arm64" ] || [ "${VPNCTL_INSTALL_SKIP_ROSETTA:-}" = "1" ]; then
    return
  fi

  if /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
    return
  fi

  echo "Installing Rosetta 2 for the menu-bar helper..."
  sudo /usr/sbin/softwareupdate --install-rosetta --agree-to-license
}

clear_quarantine() {
  if command_exists xattr; then
    xattr -dr com.apple.quarantine "$INSTALL_DIR/vpnctl" "$INSTALL_DIR/vpnctl-monitor" "$INSTALL_DIR/vpnctl-tunnel" "$INSTALL_DIR/vpnctl-tray" "$INSTALL_DIR/traybin" 2>/dev/null || true
  fi
}

run_vpnctl_setup() {
  set --
  if [ -n "${VPNCTL_ROUTING_MODE:-}" ]; then
    set -- --routing-mode "$VPNCTL_ROUTING_MODE"
  fi

  if [ -n "${VPNCTL_SETUP_URI:-}" ]; then
    "$INSTALL_DIR/vpnctl" __setup --uri "$VPNCTL_SETUP_URI" "$@"
    sudo HOME="$HOME" "$INSTALL_DIR/vpnctl" __install "$@"
    return
  fi

  if [ ! -r "$TTY_DEVICE" ] || [ ! -w "$TTY_DEVICE" ]; then
    echo "No interactive terminal available for VLESS setup. Rerun in a terminal or set VPNCTL_SETUP_URI." >&2
    exit 1
  fi

  "$INSTALL_DIR/vpnctl" __setup "$@" <"$TTY_DEVICE" >"$TTY_DEVICE" 2>"$TTY_DEVICE"
}

echo "Downloading ${ASSET} from the latest vpnctl release..."
# Retry/resume: the GitHub release CDN occasionally stalls a connection, and a
# bare `curl -fsSL` then hangs forever instead of recovering.
curl -fL --retry 5 --retry-all-errors --retry-delay 2 --connect-timeout 15 -C - "$URL" -o "$TMP_DIR/$ASSET"

mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/$ASSET" -C "$INSTALL_DIR"
clear_quarantine

echo "Installed vpnctl, vpnctl-monitor, vpnctl-tunnel, vpnctl-tray to $INSTALL_DIR"

ensure_sing_box
ensure_rosetta

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "$INSTALL_DIR is not on your PATH. Add it, e.g.:"
    echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc"
    ;;
esac

echo
echo "Starting vpnctl installer..."
run_vpnctl_setup

echo
echo "vpnctl is installed. Run: $INSTALL_DIR/vpnctl"
