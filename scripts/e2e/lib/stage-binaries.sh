# shellcheck shell=bash

E2E_RELEASE_BINARIES=(vpnctl vpnctl-monitor vpnctl-tunnel vpnctl-tray)
E2E_TRAY_HELPER_DIR="traybin"

stage_e2e_binaries() {
  local from_dir="$1"
  local install_dir="$2"

  if [ ! -x "$from_dir/vpnctl" ]; then
    echo "vpnctl binary not found in $from_dir" >&2
    return 1
  fi

  if [ ! -d "$from_dir/$E2E_TRAY_HELPER_DIR" ]; then
    echo "$E2E_TRAY_HELPER_DIR not found in $from_dir" >&2
    return 1
  fi

  mkdir -p "$install_dir"
  local binary
  for binary in "${E2E_RELEASE_BINARIES[@]}"; do
    rm -f "$install_dir/$binary"
  done
  rm -rf "$install_dir/$E2E_TRAY_HELPER_DIR"

  cp -p "$from_dir/vpnctl" "$install_dir/vpnctl"
  for binary in "${E2E_RELEASE_BINARIES[@]:1}"; do
    ln "$install_dir/vpnctl" "$install_dir/$binary"
  done
  cp -R "$from_dir/$E2E_TRAY_HELPER_DIR" "$install_dir/"
  chmod +x "$install_dir/vpnctl" "$install_dir/vpnctl-monitor" "$install_dir/vpnctl-tunnel" "$install_dir/vpnctl-tray"
  chmod +x "$install_dir/$E2E_TRAY_HELPER_DIR/"*
}
