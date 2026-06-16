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

if [ "$(uname -s)" != "Darwin" ]; then
  echo "vpnctl E2E only runs on macOS." >&2
  exit 1
fi

run_scenario() {
  echo
  echo "########################################################"
  echo "# scenario: $1"
  echo "########################################################"
  bash "$SCENARIOS_DIR/$1.sh"
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
