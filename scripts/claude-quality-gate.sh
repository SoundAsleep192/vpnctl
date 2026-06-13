#!/usr/bin/env bash
# Claude Code Stop hook: enforce the vpnctl quality gate on changed TypeScript.
#
# Runs typecheck + lint only when .ts files actually changed (skips pure
# Q&A/docs turns). Exit 2 + stderr is fed back to the agent as required fixes,
# blocking "done" until the gate is clean. See AGENTS.md "Quality gates".

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

changed_ts="$(
  {
    git diff --name-only -- '*.ts'
    git diff --name-only --cached -- '*.ts'
    git ls-files --others --exclude-standard -- '*.ts'
  } 2>/dev/null | sort -u | sed '/^$/d'
)"

# No TypeScript changes this turn -> nothing to gate.
[ -z "$changed_ts" ] && exit 0

if ! command -v bun >/dev/null 2>&1; then
  echo "vpnctl gate: 'bun' not on PATH; skipped typecheck/lint. Run the quality gate manually." >&2
  exit 0
fi

problems=""

if ! typecheck_output="$(bun run typecheck 2>&1)"; then
  problems="${problems}"$'\n'"[typecheck FAILED]"$'\n'"${typecheck_output}"$'\n'
fi

if ! lint_output="$(bun run lint 2>&1)"; then
  problems="${problems}"$'\n'"[lint FAILED]"$'\n'"${lint_output}"$'\n'
fi

if [ -n "$problems" ]; then
  {
    echo "vpnctl quality gate failed on changed .ts files. Fix before reporting done:"
    printf '%s\n' "$problems"
  } >&2
  exit 2
fi

exit 0
