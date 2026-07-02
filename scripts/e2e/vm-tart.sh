#!/usr/bin/env bash
# Run the vpnctl E2E scenarios inside a DISPOSABLE macOS VM via tart (issue #45).
#
# This is the safe way to prove the destructive structural scenarios locally
# without touching your daily driver: it clones a throwaway VM from a base
# image, provisions bun + sing-box, copies the working tree in, runs
# scripts/e2e/run.sh, and deletes the VM on exit. The GitHub Actions runners do
# the same job in CI; this mirrors them locally so you don't debug on the slow
# runner.
#
# Requires: tart (https://tart.run), `expect` (preinstalled on macOS), and a
# pulled base image, e.g.
#   tart pull ghcr.io/cirruslabs/macos-sequoia-base:latest
#
# Usage:   bash scripts/e2e/vm-tart.sh [structural|update-race|all]
# Env:     VPNCTL_E2E_IMAGE  base image (default: ghcr.io/cirruslabs/macos-sequoia-base:latest)
#          VPNCTL_E2E_VM     throwaway VM name (default: vpnctl-e2e-<pid>)
set -euo pipefail

SCENARIO="${1:-all}"
IMAGE="${VPNCTL_E2E_IMAGE:-ghcr.io/cirruslabs/macos-sequoia-base:latest}"
VM="${VPNCTL_E2E_VM:-vpnctl-e2e-$$}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# cirruslabs base images ship a passwordless-sudo `admin` user (password "admin")
# with SSH enabled.
VM_USER="admin"
VM_PASS="admin"
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

TART="$(command -v tart || echo "$HOME/.local/bin/tart")"
KEY_DIR="$(mktemp -d)"
KEY="$KEY_DIR/id_ed25519"

cleanup() {
  echo
  echo "Destroying disposable VM $VM ..."
  "$TART" stop "$VM" >/dev/null 2>&1 || true
  "$TART" delete "$VM" >/dev/null 2>&1 || true
  rm -rf "$KEY_DIR"
}
trap cleanup EXIT

# Feed the VM password to a one-shot ssh via expect (no sshpass / no brew tap).
expect_ssh() {
  local target_command="$1"
  expect -c "
    set timeout 120
    log_user 0
    spawn ssh ${SSH_OPTS[*]} $VM_USER@$VM_IP $target_command
    expect {
      -re {[Pp]assword:} { send \"$VM_PASS\r\"; exp_continue }
      eof
    }
  "
}

echo "Cloning $IMAGE -> $VM ..."
"$TART" clone "$IMAGE" "$VM"

echo "Booting $VM (headless) ..."
"$TART" run --no-graphics "$VM" &

echo "Waiting for VM IP (settled via guest agent) ..."
# `tart ip --wait` blocks until the guest agent reports its address, which is
# more reliable than an early DHCP lease that isn't routable yet.
VM_IP="$("$TART" ip "$VM" --wait 120 2>/dev/null || true)"
[ -n "$VM_IP" ] || {
  echo "VM never got an IP" >&2
  exit 1
}
echo "VM IP: $VM_IP"

ssh_vm() {
  ssh -i "$KEY" "${SSH_OPTS[@]}" "$VM_USER@$VM_IP" "$@"
}

echo "Injecting ephemeral SSH key ..."
ssh-keygen -t ed25519 -N "" -f "$KEY" -q
PUBKEY="$(cat "$KEY.pub")"
# expect always exits 0 even when the inner ssh fails, so gate the retry on real
# key-based auth working — not on expect's exit code. Covers early-boot windows
# where the guest reports an IP before sshd is reachable ("no route to host").
key_ready=0
for _ in $(seq 1 60); do
  expect_ssh "mkdir -p ~/.ssh && echo '$PUBKEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys" >/dev/null 2>&1 || true
  if ssh_vm true >/dev/null 2>&1; then
    key_ready=1
    break
  fi
  sleep 2
done
[ "$key_ready" -eq 1 ] || {
  echo "key-based SSH never came up" >&2
  exit 1
}

# The scenarios and `vpnctl update`'s self-sudo run over non-interactive SSH, so
# a password prompt would hang. GitHub runners are passwordless; make the VM
# match by feeding the admin password once to grant NOPASSWD.
echo "Enabling passwordless sudo in VM ..."
ssh_vm "echo '$VM_PASS' | sudo -S bash -c 'echo \"$VM_USER ALL=(ALL) NOPASSWD:ALL\" > /etc/sudoers.d/99-vpnctl-e2e && chmod 440 /etc/sudoers.d/99-vpnctl-e2e'"
ssh_vm "sudo -n true" || {
  echo "passwordless sudo setup failed" >&2
  exit 1
}

# tart's NAT has a flaky IPv6 path: dual-stack hosts like api.github.com reset
# mid-TLS-handshake (curl error 35) when curl tries AAAA first, which breaks the
# update-race scenario's release lookup. Force IPv4 by disabling IPv6 on every
# network service, and clamp the MTU as a belt-and-suspenders path-MTU dodge.
# Harmless on a throwaway VM; CI runners need none of this.
echo "Forcing IPv4 + clamping MTU (tart NAT workaround) ..."
ssh_vm 'networksetup -listallnetworkservices | tail -n +2 | while IFS= read -r svc; do sudo networksetup -setv6off "$svc" 2>/dev/null || true; done'
VM_IFACE="$(ssh_vm "route -n get default 2>/dev/null | awk '/interface:/{print \$2}'")"
[ -n "$VM_IFACE" ] && ssh_vm "sudo ifconfig $VM_IFACE mtu 1400" || true

echo "Copying working tree into VM ..."
ssh_vm "rm -rf ~/vpnctl && mkdir -p ~/vpnctl"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git \
  -e "ssh -i $KEY ${SSH_OPTS[*]}" \
  "$REPO_ROOT/" "$VM_USER@$VM_IP:vpnctl/"

echo "Provisioning bun + sing-box + deps inside VM ..."
# shellcheck disable=SC2016
ssh_vm 'bash -lc "
  set -euo pipefail
  if ! command -v bun >/dev/null; then
    for attempt in 1 2 3; do
      curl -fsSL https://bun.sh/install | bash && break
      echo \"bun install attempt \$attempt failed; retrying...\" >&2
      sleep 5
    done
  fi
  export PATH=\"\$HOME/.bun/bin:\$PATH\"
  brew list sing-box >/dev/null 2>&1 || brew install sing-box
  cd ~/vpnctl
  bun install --frozen-lockfile
  bun run build
  ./scripts/codesign-dist.sh
  mkdir -p \$HOME/.local/bin
  rm -f \$HOME/.local/bin/vpnctl \$HOME/.local/bin/vpnctl-monitor \$HOME/.local/bin/vpnctl-tunnel \$HOME/.local/bin/vpnctl-tray
  rm -rf \$HOME/.local/bin/traybin
  cp -p dist/vpnctl \$HOME/.local/bin/vpnctl
  ln \$HOME/.local/bin/vpnctl \$HOME/.local/bin/vpnctl-monitor
  ln \$HOME/.local/bin/vpnctl \$HOME/.local/bin/vpnctl-tunnel
  ln \$HOME/.local/bin/vpnctl \$HOME/.local/bin/vpnctl-tray
  cp -R dist/traybin \$HOME/.local/bin/
  chmod +x \$HOME/.local/bin/vpnctl*
  chmod +x \$HOME/.local/bin/traybin/*
"'

echo "Running E2E scenario '$SCENARIO' inside VM ..."
# shellcheck disable=SC2016
ssh_vm "bash -lc '
  export PATH=\"\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH\"
  export VPNCTL_BIN=\$HOME/.local/bin/vpnctl
  export VPNCTL_E2E_DIST_DIR=\$PWD/dist
  cd ~/vpnctl
  bash scripts/e2e/run.sh $SCENARIO
'"
