# Testing

## Required gates

Run these before reporting a non-trivial task done:

```sh
bun run typecheck
bun test
bun run lint
bun run format
```

When Markdown changed:

```sh
bun run lint:md
```

For broad runtime changes:

```sh
bun run build
```

## Test writing rules

- Test descriptions must be English.
- Do not add comments or JSDoc blocks in tests.
- Localized strings can appear in assertions when localization is under test.
- Add a test for every bug fix.
- Prefer pure helpers and injected dependencies.
- Use fake `Exec` functions keyed on `cmd` and `args`.
- Do not mock `Bun.spawn` directly.

## Unit test boundaries

Good direct unit-test targets:

- Pure parsers and formatters.
- Config builders and validators.
- pf anchor and sinkhole renderers.
- launchd plist renderers.
- Docker command and template generation.
- State classification.
- TUI formatting and rendered output.
- Command helpers that accept injected IO or `Exec`.

Thin wrappers can stay untested when they only call root-gated system paths and
delegate to tested helpers. Examples include small `run*` command entrypoints that
only call `requireRoot()` and a tested core function.

## E2E tier

The structural E2E tier lives in `scripts/e2e/`. It uses real macOS `launchctl`,
`pfctl`, `dscacheutil`, and `/etc/hosts` behavior.

Scenarios:

- `structural.sh`
- `update-race.sh`
- `desired-state.sh`

Shared assertions live in `scripts/e2e/lib/assert.sh`.

These scenarios are destructive. Run them only on disposable macOS environments such
as CI runners or throwaway VMs.

The local installed-machine harness is:

```sh
scripts/e2e-local.sh
```

It backs up and restores installed binaries around the update test. It is still a
privileged host-protection test, so read output before trusting it on a machine you
care about.

## Live tunnel validation

Live VLESS/Reality validation is separate from structural E2E. Use it when a change
could affect real handshake, real route behavior, or real exit profile resolution.

Useful commands:

```sh
sudo vpnctl status --ip
sudo vpnctl check
sudo vpnctl doctor
scripts/sandbox-live-proof.sh
```

Live proof depends on user secrets, provider behavior, and network availability. Keep
unit tests for deterministic logic, and use live proof for integration confidence.

## Markdown validation

All docs are checked with `markdownlint-cli2`:

```sh
bun run lint:md
```

Use fenced code blocks with language tags. Keep links relative when pointing inside
the repo.
