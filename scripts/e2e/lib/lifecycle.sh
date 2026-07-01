# shellcheck shell=bash
# vpnctl lifecycle drivers for E2E scenarios (issue #45).
#
# Thin wrappers over the real `vpnctl` CLI plus the fixtures a serverless
# structural run needs (a schema-valid-but-unreachable VLESS URI, a sing-box
# presence guard). Sourced after lib/assert.sh.
#
# The fake URI points at an unroutable server, so the tunnel can never come up.
# That is intentional: a permanently-down tunnel is exactly the state in which
# the fail-closed sinkhole must stay active, which is what the structural tier
# asserts.

# Path to the vpnctl binary under test. Override with VPNCTL_BIN to test a
# specific install (CI points this at the freshly built+installed binary).
VPNCTL_BIN="${VPNCTL_BIN:-vpnctl}"

# A syntactically valid VLESS+Reality URI whose server (192.0.2.1, TEST-NET-1
# per RFC 5737) is guaranteed unroutable — the tunnel will never connect.
FAKE_VLESS_URI="${FAKE_VLESS_URI:-vless://00000000-0000-0000-0000-000000000000@192.0.2.1:443?encryption=none&security=reality&sni=example.com&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=0123abcd&type=tcp#vpnctl-e2e}"

# sing-box is a hard dependency of `vpnctl install`; fail fast with a clear
# message if it is missing rather than letting install throw mid-run.
require_sing_box() {
  if [ -x /opt/homebrew/bin/sing-box ] || [ -x /usr/local/bin/sing-box ]; then
    return 0
  fi
  echo "sing-box not found — install it first (brew install sing-box)." >&2
  return 1
}

vpnctl_setup() {
  "$VPNCTL_BIN" setup --uri "$FAKE_VLESS_URI"
}

vpnctl_install() {
  sudo "$VPNCTL_BIN" install
}

vpnctl_status() {
  sudo "$VPNCTL_BIN" status
}

vpnctl_doctor() {
  sudo "$VPNCTL_BIN" doctor
}

vpnctl_up() {
  sudo "$VPNCTL_BIN" up
}

vpnctl_down() {
  sudo "$VPNCTL_BIN" down
}

vpnctl_refresh() {
  sudo "$VPNCTL_BIN" refresh
}

vpnctl_uninstall() {
  sudo "$VPNCTL_BIN" uninstall --purge
}

# --- synthetic-old build (update-race regression fixture) ---------------------
RELEASE_BINARIES=(vpnctl vpnctl-monitor vpnctl-tunnel)

# build_synthetic_old <version> <repo_root>
# Compiles the current checkout into dist/ but with package.json pinned to an
# older-than-any-release version, so a later `vpnctl update` sees itself as
# stale and exercises the redeploy-the-running-daemons path (the #44 EIO-5
# race). Restores package.json afterwards.
build_synthetic_old() {
  local version="$1"
  local repo_root="$2"
  local pkg_backup
  pkg_backup="$(mktemp)"
  cp "$repo_root/package.json" "$pkg_backup"
  # shellcheck disable=SC2064
  trap "cp '$pkg_backup' '$repo_root/package.json'; rm -f '$pkg_backup'" RETURN

  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$version\"/" "$repo_root/package.json"
  (cd "$repo_root" && bun run build >/dev/null)
}

# install_binaries_to <dir> <from_dir>
# Copies the three release binaries into an install dir and marks them
# executable, mimicking what install.sh / a tarball extraction would leave.
install_binaries_to() {
  local dir="$1"
  local from_dir="$2"
  mkdir -p "$dir"
  local binary
  for binary in "${RELEASE_BINARIES[@]}"; do
    rm -f "$dir/$binary"
  done
  cp -p "$from_dir/vpnctl" "$dir/vpnctl"
  ln "$dir/vpnctl" "$dir/vpnctl-monitor"
  ln "$dir/vpnctl" "$dir/vpnctl-tunnel"
  chmod +x "$dir/vpnctl" "$dir/vpnctl-monitor" "$dir/vpnctl-tunnel"
}
