# Project Rules

## Scope

This repo is vpnctl. It is not Ekocrop. Do not import Ekocrop-specific Jira,
GitLab, branch naming, Russian test description, or review conventions here.

vpnctl is a Bun + TypeScript project for fail-closed protected-domain routing. Current
production support is macOS-first, but cross-platform support is planned. Do not make
new architecture depend on "CLI-only" or "macOS-only" as permanent product facts.

## Product language

Use "protected domains" for user-facing copy. Avoid "AI domains" unless naming the
default domain seed file or describing a specific AI-tool preset.

Use "protected workspace" or "sandbox" for Docker runtime copy. Make clear when state
belongs to host protection, tray protection, or sandbox protection.

## Technical constraints

- Runtime and tooling stay on Bun + TypeScript.
- Rust is only a fallback if Bun hard-blocks cross-platform daemon support.
- Shell-outs go through the injectable `Exec` type.
- macOS privileged behavior must keep root-owned actions narrow and auditable.
- Do not introduce Swift, native GUI frameworks, or extra daemons without a product
  reason and explicit discussion.

## Code style

- No `as` casts in new code. Fix type flow instead. `as const` for literal fixtures is
  acceptable.
- No non-null assertions.
- Use full descriptive names.
- Extract magic numbers and non-obvious strings to named constants.
- Prefer narrow pure helpers over broad abstractions.
- Validate real boundaries: config files, CLI input, external command output, and
  system state.
- Do not add defensive checks for impossible internal states.
- Comments are rare in source files and must explain a hidden constraint or safety
  invariant. Tests have stricter rules below.

## Test style

- Test descriptions must be English in `describe`, `test`, and `it`.
- Tests must not contain comments or JSDoc blocks.
- Localized product strings can appear inside assertions when testing localization.
- Add or update a test for every bug fix.
- Prefer pure tests and fake `Exec` implementations keyed on `cmd` and `args`.
- Do not mock `Bun.spawn` directly.
- Thin root-gated command wrappers and hardcoded system path glue do not need direct
  tests when they delegate to already-tested code.

## Safety rules

vpnctl is fail-closed software. When touching pf, DNS, launchd, daemons, tunnel state,
or sandbox networking, preserve these invariants:

- Tunnel down means configured protected domains are blocked, not leaked.
- DNS lookup failure for protected domains blocks those domains.
- Root-owned host protection is reconciled even when desired tunnel actions fail.
- The user-writable desired tunnel file can only request literal `up` or `down`.
- The tray can toggle the tunnel daemon only through that capped desired-state path.
- Sandbox agents do not receive the Docker socket.
- Sandbox agent containers run as a non-root user and drop capabilities.
- Host protection state and sandbox protection state are separate.

If a change could weaken fail-closed behavior, call it out before reporting success.

## Agent workflow

- Read the nearby code before editing.
- Use `rg` and `rg --files` for search.
- Use `apply_patch` for manual edits.
- Do not revert user changes unless explicitly asked.
- Do not commit, push, open, merge, or close PRs without explicit user permission.
- Keep documentation current with architecture and workflow changes.

## Quality gates

Before reporting done:

1. `bun run typecheck`
2. `bun test`
3. `bun run lint`
4. `bun run format`
5. `bun run lint:md` when Markdown changed

For broad runtime changes, also run:

1. `bun run build`
2. `bun run build:daemons` if you need to recreate daemon aliases without rebuilding
