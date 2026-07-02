#!/usr/bin/env bash
# E2E entrypoint (issue #45). Runs one or more structural scenarios against a
# real macOS env. The GitHub Actions workflow calls this and nothing else — all
# the logic lives in the scenario scripts, so CI and local runs are identical.
#
# Usage:  scripts/e2e/run.sh [structural|update-race|desired-state|all]   (default: all)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$HERE/scenarios"
TARGET="${1:-all}"
E2E_DIST_DIR="${VPNCTL_E2E_DIST_DIR:-}"

# shellcheck source=lib/stage-binaries.sh disable=SC1091
source "$HERE/lib/stage-binaries.sh"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "vpnctl E2E only runs on macOS." >&2
  exit 1
fi

run_scenario() {
  echo
  echo "########################################################"
  echo "# scenario: $1"
  echo "########################################################"

  if [ -z "$E2E_DIST_DIR" ]; then
    bash "$SCENARIOS_DIR/$1.sh"
    return
  fi

  local scenario_bin_dir
  scenario_bin_dir="$(mktemp -d)"
  local scenario_status=0
  stage_e2e_binaries "$E2E_DIST_DIR" "$scenario_bin_dir"
  VPNCTL_BIN="$scenario_bin_dir/vpnctl" bash "$SCENARIOS_DIR/$1.sh" || scenario_status=$?
  rm -rf "$scenario_bin_dir"
  return "$scenario_status"
}

case "$TARGET" in
  structural | update-race | desired-state)
    run_scenario "$TARGET"
    ;;
  all)
    run_scenario structural
    run_scenario update-race
    run_scenario desired-state
    ;;
  *)
    echo "unknown scenario: $TARGET (expected: structural | update-race | desired-state | all)" >&2
    exit 1
    ;;
esac
