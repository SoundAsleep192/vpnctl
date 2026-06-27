#!/usr/bin/env bash
set -uo pipefail

workspace="${1:-$PWD}"
logdir="${VPNCTL_SANDBOX_PROOF_LOGDIR:-/tmp/vpnctl-sandbox-proof-$(date +%Y%m%d-%H%M%S)}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vpnctl_cmd=(bun "$repo_root/bin/vpnctl.ts")
sudo_keepalive_pid=""
host_tunnel_stop_attempted="false"
finalized="false"
proof_exit_code=0

mkdir -p "$logdir"

run_log() {
  local name="$1"
  shift

  {
    printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name"
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    "$@"
    local exit_code=$?
    printf '\nexit_code=%s\n' "$exit_code"
    return "$exit_code"
  } 2>&1 | tee "$logdir/$name.log"
}

run_step() {
  run_log "$@" || proof_exit_code=1
}

cleanup() {
  docker rm -f vpnctl-sandbox-agent vpnctl-sandbox-shell vpnctl-sandbox-vpn >/dev/null 2>&1 || true
}

start_sudo_keepalive() {
  sudo -v
  while true; do
    sudo -n true >/dev/null 2>&1 || true
    sleep 45
  done &
  sudo_keepalive_pid="$!"
}

stop_sudo_keepalive() {
  if [[ -n "$sudo_keepalive_pid" ]]; then
    kill "$sudo_keepalive_pid" >/dev/null 2>&1 || true
    wait "$sudo_keepalive_pid" >/dev/null 2>&1 || true
  fi
}

run_vpnctl_root() {
  sudo -E env HOME="$HOME" "${vpnctl_cmd[@]}" "$@"
}

write_report() {
  local report="$logdir/report.txt"
  local summary="$logdir/summary.txt"
  local archive="$logdir.tar.gz"

  {
    printf 'vpnctl sandbox live proof report\n'
    printf 'logdir=%s\n' "$logdir"
    printf 'archive=%s\n' "$archive"
    printf 'workspace=%s\n' "$workspace"
    printf '\n'
    printf 'direct host ip before host tunnel down:\n'
    sed -n '/exit_code=/!p' "$logdir/host-ip-before-down.log" 2>/dev/null || true
    printf '\n'
    printf 'direct host ip after host tunnel down:\n'
    sed -n '/exit_code=/!p' "$logdir/direct-host-ip.log" 2>/dev/null || true
    printf '\n'
    printf 'sandbox proof highlights:\n'
    awk '
      /^uid=/ { capture = 1 }
      capture && (/^uid=/ || /^docker_socket=/ || /^tz_env=/ || /^tz_js=/ || /^ip=/ || /^anthropic_country=/ || /^agent_tun_create=/)
    ' "$logdir/sandbox-run.log" 2>/dev/null || true
    printf '\n'
    printf 'fail-closed highlights:\n'
    grep -E 'blocked|unexpected_leak|curl:' "$logdir/fail-closed-after-singbox-kill.log" 2>/dev/null || true
    printf '\n'
    printf 'host tunnel restore:\n'
    sed -n '/exit_code=/!p' "$logdir/host-tunnel-up.log" 2>/dev/null || true
  } >"$report"

  cat <<MESSAGE >"$summary"
Done. Bring this back to Codex:
$report

All logs:
$logdir

Archive:
$archive

Expected:
- direct-host-ip differs from sandbox ip
- sandbox TZ matches ipinfo timezone
- docker_socket=absent
- agent_tun_create=blocked with device or capability error
- fail-closed-after-singbox-kill prints blocked
MESSAGE

  tar -czf "$archive" -C "$(dirname "$logdir")" "$(basename "$logdir")"

  cat "$summary"
}

finalize() {
  local exit_code=$?
  if [[ "$finalized" == "true" ]]; then
    exit "$exit_code"
  fi
  finalized="true"

  cleanup

  if [[ "$host_tunnel_stop_attempted" == "true" ]]; then
    run_log host-tunnel-up run_vpnctl_root up || true
  fi

  stop_sudo_keepalive
  write_report

  if [[ "$proof_exit_code" -ne 0 ]]; then
    exit "$proof_exit_code"
  fi
  exit "$exit_code"
}

trap finalize EXIT INT TERM

cat <<MESSAGE | tee "$logdir/README.txt"
vpnctl sandbox live proof

This script intentionally stops host vpnctl first, then restores it before exit.
Run it from a normal terminal. Codex may disconnect while host vpnctl is down.

Workspace: $workspace
Log dir: $logdir
MESSAGE

start_sudo_keepalive

run_step docker-version docker version
run_step docker-context docker context ls
run_step host-status-before-down run_vpnctl_root status --ip
run_step host-ip-before-down sh -lc 'curl -sS --connect-timeout 8 --max-time 15 https://api.ipify.org || true'

host_tunnel_stop_attempted="true"
run_step host-tunnel-down run_vpnctl_root down

run_step direct-host-ip sh -lc 'curl -sS --connect-timeout 8 --max-time 15 https://api.ipify.org || true'

run_step sandbox-run "${vpnctl_cmd[@]}" sandbox run --keep --workspace "$workspace" -- sh -lc '
set -u
id
printf "docker_socket="
test -S /var/run/docker.sock && echo present || echo absent
printf "tz_env=%s\n" "${TZ:-}"
node -e "console.log(\"tz_js=\" + Intl.DateTimeFormat().resolvedOptions().timeZone)"
printf "ip="
curl -sS --max-time 25 https://api.ipify.org
printf "\n"
curl -sS --max-time 25 https://ipinfo.io/json
printf "\nanthropic_country="
curl -sS --max-time 25 https://www.anthropic.com/api/country
printf "\n"
if ip tuntap add dev vctun0 mode tun 2>/tmp/tun.err; then
  echo "agent_tun_create=unexpected_success"
  ip link delete vctun0 >/dev/null 2>&1 || true
  exit 1
else
  printf "agent_tun_create=blocked "
  cat /tmp/tun.err
fi
'

run_step status "${vpnctl_cmd[@]}" sandbox status

run_step fail-closed-after-singbox-kill sh -lc '
docker exec vpnctl-sandbox-vpn sh -lc "pid=\$(pidof sing-box || cat /tmp/singbox.pid); test -n \"\$pid\"; kill \$pid"
sleep 2
docker run --rm --network container:vpnctl-sandbox-vpn --user developer --cap-drop ALL --security-opt no-new-privileges:true vpnctl-sandbox-agent:latest sh -lc "
  curl -sS --connect-timeout 5 --max-time 8 https://api.ipify.org >/tmp/after-kill.out 2>/tmp/after-kill.err
  exit_code=\$?
  if [ \$exit_code -eq 0 ]; then
    echo unexpected_leak
    cat /tmp/after-kill.out
    exit 1
  fi
  echo blocked
  cat /tmp/after-kill.err
"
'

run_step sandbox-logs "${vpnctl_cmd[@]}" sandbox logs --vpn -n 220
