#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

install_dir="${VPNCTL_INSTALL_DIR:-}"
if [[ -z "$install_dir" ]]; then
  if command -v vpnctl >/dev/null 2>&1; then
    install_dir="$(dirname -- "$(command -v vpnctl)")"
  else
    install_dir="$HOME/.local/bin"
  fi
fi

case "$install_dir" in
  /*) ;;
  *)
    printf 'VPNCTL_INSTALL_DIR must be absolute, got: %s\n' "$install_dir" >&2
    exit 2
    ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  printf 'bun not found in PATH\n' >&2
  exit 2
fi

if [[ ! -d node_modules/systray2/traybin ]]; then
  bun install --frozen-lockfile
fi

remove_path() {
  local target="$1"
  if [[ ! -e "$target" && ! -L "$target" ]]; then
    return
  fi
  rm -rf "$target" 2>/dev/null || sudo rm -rf "$target"
}

remove_installed_artifacts() {
  remove_path "$install_dir/vpnctl"
  remove_path "$install_dir/vpnctl-monitor"
  remove_path "$install_dir/vpnctl-tunnel"
  remove_path "$install_dir/vpnctl-tray"
  remove_path "$install_dir/traybin"
}

printf 'Reinstalling vpnctl from %s into %s\n' "$repo_dir" "$install_dir"

remove_path dist/traybin

bun run build
bun run build:daemons

remove_path dist/traybin
cp -R node_modules/systray2/traybin dist/traybin

install_with_user_permissions() {
  mkdir -p "$install_dir"
  remove_installed_artifacts
  cp dist/vpnctl dist/vpnctl-monitor dist/vpnctl-tunnel dist/vpnctl-tray "$install_dir/"
  cp -R dist/traybin "$install_dir/"
  chmod +x "$install_dir/vpnctl" "$install_dir/vpnctl-monitor" "$install_dir/vpnctl-tunnel" "$install_dir/vpnctl-tray"
  chmod +x "$install_dir/traybin/"*
}

install_with_sudo() {
  sudo mkdir -p "$install_dir"
  remove_installed_artifacts
  sudo cp dist/vpnctl dist/vpnctl-monitor dist/vpnctl-tunnel dist/vpnctl-tray "$install_dir/"
  sudo cp -R dist/traybin "$install_dir/"
  sudo chmod +x "$install_dir/vpnctl" "$install_dir/vpnctl-monitor" "$install_dir/vpnctl-tunnel" "$install_dir/vpnctl-tray"
  sudo chmod +x "$install_dir/traybin/"*
}

if mkdir -p "$install_dir" 2>/dev/null && [[ -w "$install_dir" ]]; then
  install_with_user_permissions
else
  install_with_sudo
fi

if [[ "${VPNCTL_REINSTALL_SKIP_DAEMONS:-}" == "1" ]]; then
  printf 'Copied binaries. Skipped daemon redeploy.\n'
  exit 0
fi

sudo HOME="$HOME" "$install_dir/vpnctl" install

printf 'Reinstall complete. Run: %s/vpnctl\n' "$install_dir"
