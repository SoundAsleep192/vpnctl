#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'offline local test only supports macOS.\n' >&2
  exit 2
fi

if ! command -v bun >/dev/null 2>&1; then
  printf 'bun not found in PATH\n' >&2
  exit 2
fi

if [[ ! -d node_modules/systray2/traybin ]]; then
  printf 'node_modules/systray2/traybin missing; offline test cannot fetch dependencies. Run bun install while online first.\n' >&2
  exit 2
fi

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

arch="$(uname -m)"
case "$arch" in
  arm64) release_arch="arm64" ;;
  x86_64) release_arch="x64" ;;
  *)
    printf 'Unsupported architecture: %s\n' "$arch" >&2
    exit 2
    ;;
esac

printf 'vpnctl offline local test\n'
printf 'repo: %s\n' "$repo_dir"
printf 'install dir: %s\n' "$install_dir"
printf 'release arch: %s\n\n' "$release_arch"

if [[ "${VPNCTL_OFFLINE_SKIP_TESTS:-}" != "1" ]]; then
  bun run typecheck
  bun test test/install-script.test.ts test/install.test.ts test/tray-agent.test.ts
else
  printf 'Skipping focused tests because VPNCTL_OFFLINE_SKIP_TESTS=1\n'
fi

bun run build
./scripts/codesign-dist.sh
./scripts/smoke-test-dist.sh

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
tarball_path="$tmp_dir/vpnctl-darwin-${release_arch}.tar.gz"
tar -czf "$tarball_path" -C dist vpnctl vpnctl-monitor vpnctl-tunnel vpnctl-tray traybin

printf '\nlocal release archive:\n'
ls -lh "$tarball_path"
tar -tzvf "$tarball_path" | sed -n '1,8p'

printf '\nreinstalling local build...\n'
VPNCTL_REINSTALL_OFFLINE=1 ./scripts/reinstall-local.sh

cat <<EOF

Offline local reinstall done.

Manual checks:
  1. Open dashboard: ${install_dir}/vpnctl
  2. Click the menu-bar icon and toggle the tunnel off/on.
  3. Check status: sudo ${install_dir}/vpnctl status --ip
  4. Open logs: ${install_dir}/vpnctl logs --monitor -n 80
  5. If needed, inspect tray log: tail -n 80 ~/.config/vpnctl/tray.log

EOF
