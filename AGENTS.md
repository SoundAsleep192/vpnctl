# Agent instructions for vpnctl

`vpnctl` is a Bun + TypeScript fail-closed VPN killswitch (pf firewall + DNS sinkhole +
sing-box VLESS/Reality tunnel) for AI dev tools. **v1 is CLI-only, macOS-only** — that
was a staged-rollout choice to get a working core shipped first, not a permanent
constraint. Cross-platform support (Linux/WSL, Windows) and a UI surface beyond the
CLI (status indicator, interactive TUI, eventually a full GUI) are planned and tracked
in GitHub Issues — don't treat "CLI-only" or "macOS-only" as architectural rules when
designing new work. The one real constraint: stay on Bun + TypeScript (Rust is the
agreed fallback only if Bun hard-blocks cross-platform daemon support — not Swift,
not an open-ended language/framework survey).
Planned and in-progress work is tracked in
[GitHub Issues](https://github.com/SoundAsleep192/vpnctl/issues).

## Quality gates

Before reporting any task done, run on changed files (whole repo for broad changes):

1. `bun run typecheck` — must be clean (`tsc --noEmit`)
2. `bun test` — must pass
3. `bun run lint` — zero errors, zero warnings
4. `bun run format` — apply Prettier
5. For `.md` changes: `bun run lint:md`

## Code style

- **No `as` type casts in new code.** If you reach for `as`, the types are wrong —
  fix the signature/annotation instead. `as const` for literal fixtures is fine.
  `any` is acceptable (and more honest than `unknown` + `as`) when consuming an
  untyped external API.
- **No `!` non-null assertions**, and no defensive narrowing where optional chaining
  / `??` already gives the right type — `error?.message`, not
  `typeof x?.y === "string" ? x.y : undefined`.
- **Full, descriptive names.** No abbreviations, no single-letter variables.
- **Magic numbers/strings → named constants**, not inline comments. The name should
  explain _why_ the value exists (e.g. `AUDIT_LOG_MAX_BYTES`, not `// 1MB`).
- **One exported entity per file** as the default. Existing files sometimes
  co-locate small related helpers/types (see `status.ts`, `domains.ts`) — follow
  that precedent rather than over-splitting.
- **Concise TypeScript**: `prop?: T` over `T | undefined`, `??` over manual
  null-checks, optional chaining over verbose ternaries.
- **No comments** unless they explain a non-obvious _why_ (a hidden constraint, a
  subtle invariant, a workaround for a specific bug). Never explain _what_ the code
  does — descriptive names already do that.
- Don't add abstractions, error handling, or validation for scenarios that can't
  happen. Trust internal code and the type system; only validate at real boundaries
  (config files, CLI input, external command output).

## Testing

- All shell-outs go through the injectable `Exec` type (`src/core/exec.ts`); tests
  pass fake `Exec` implementations keyed on `cmd`/`args`, never mock `Bun.spawn`
  directly.
- Pure functions and `Exec`-injectable functions get `bun test` coverage.
- I/O wrappers that hardcode real system paths (`/Library/Logs/vpnctl`,
  `/Library/LaunchAgents`, etc.) and `requireRoot()`-gated `run*` command entrypoints
  are thin glue over already-tested pieces and aren't directly unit tested.
- Always add a test when fixing a bug.

### E2E tier (`scripts/e2e/`)

Unit tests with fake `Exec` (L0) are structurally blind to launchd/pf/dns timing
— the bug that motivated this tier (#44's EIO-5 redeploy race) was invisible to
them by construction. The L1 tier runs the real CLI against real
`launchctl`/`pfctl`/`dscacheutil`/`/etc/hosts` on disposable macOS environments
(GitHub `macos-14`/`macos-13` runners in CI; a throwaway VM locally).

- `scripts/e2e/lib/assert.sh` — the single source of truth for what a healthy /
  fail-closed system looks like (daemon state, pf enabled, anchor loaded,
  sinkhole present, the tunnel-down⇒domain-blocked invariant). Shared by every
  scenario **and** by the local `scripts/e2e-local.sh`. Its marker/label literals
  mirror `src/core/paths.ts` — keep them in sync.
- `scripts/e2e/scenarios/*.sh` — one scenario per lifecycle concern
  (`structural`, `update-race`, `desired-state`). `scripts/e2e/run.sh` is the
  entrypoint the CI workflow calls; the workflow itself contains no test logic.
- **Each future daemon/pf/dns issue adds one E2E scenario here** that would have
  caught the bug, mirroring the unit-test "add a test when fixing a bug" rule.
- Scenarios are **destructive** (mutate pf, `/etc/hosts`, system LaunchDaemons) —
  never run `scripts/e2e/scenarios/*` or `run.sh` on a machine you care about.
  `scripts/e2e-local.sh` is the only harness safe on an installed machine: it
  backs up and restores your real binaries around an `update` test.
- CI gating: on by default for every PR (opt out of a trivial PR with the
  `skip-e2e` label, mediated by the `e2e-gate` required check); forced and
  un-skippable before any release.
- **Live-tunnel tier** (real VLESS/Reality endpoint + secrets, validating the
  actual handshake + routed egress) is a planned follow-up, out of scope for the
  structural tier.

## GitHub Issues workflow

- When starting work on an issue, set its Status to **In Progress** on the
  `vpnctl roadmap` project board (`gh project item-edit`) before making changes.

## Git workflow

- **GitHub flow**: branch off `master`, open a PR, merge — no direct commits to
  `master`.
- **Conventional Commits** for messages (`feat:`, `fix:`, `refactor:`, `test:`,
  `docs:`, `chore:`, …), short imperative subject.
- **No AI co-author trailers.** Commits are authored as the user — never add
  `Co-Authored-By` lines for AI tools.
- Confirm with the user before committing or pushing — branch/PR creation doesn't
  change that.
- **Never merge a PR without the user's explicit go-ahead**, even one opened earlier
  in the same task and even when the task clearly implies the end result should be
  merged. Merging is always a separate, explicit step.

## Safety

This project implements a fail-closed firewall/DNS-sinkhole killswitch. When
touching `core/pf-anchor.ts`, `core/pf-conf-patch.ts`, `core/sinkhole.ts`,
`core/dns-refresh.ts`, or the daemons: preserve fail-closed behavior (block-by-default
when the tunnel is down or a lookup fails) and call out explicitly if a change could
weaken that, even temporarily.

`core/desired-tunnel.ts` is the unprivileged tray's only path to root: the
monitor reads a user-writable `desired-tunnel` file and enacts it. Two invariants
must hold — (1) the action is hard-capped to enabling/disabling the tunnel daemon
(never arbitrary execution: the file is parsed as the literal `up`/`down`, anything
else is ignored), and (2) enforcement runs in its own `try` _before_ the
sinkhole/anchor reconcile in the monitor, so a failure there can never skip the
reconcile that keeps the killswitch fail-closed. The worst a hostile writer can do
is toggle the tunnel — and tunnel-down stays blocked, never leaked.

## Implementation notes

- **`vpnctl domains add/remove`** doesn't auto-trigger a refresh. It edits
  `config.json`/`sing-box.json` and prints a `sudo vpnctl refresh` hint, rather than
  re-exec'ing under sudo mid-command — that would fire a confusing password prompt
  from inside a plain config-edit command.
- **`vpnctl doctor`** requires root (`requireRoot()`) even though it's a read-only
  diagnostic. The pf/anchor/launchd checks need root to read accurately — without it,
  `doctor` would report false negatives.

## Reasoning & confidence

- Before presenting a result, review it like a principal engineer would: what would
  make this wrong? Argue against your own solution before committing to it.
- Optimize for _correct_, not _helpful_. If the premise of a request is wrong, say so
  instead of answering the wrong question.
- If something is uncertain or you're blocked on a decision only the user can make,
  stop and ask rather than guessing.
- After non-trivial work, give a short recap of what changed and a confidence rating
  (`Confidence: N/10`), noting anything uncertain.
