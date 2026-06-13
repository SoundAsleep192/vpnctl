# Contributing

## Git workflow

This project follows [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow):

1. Branch off `master` with a short, descriptive, kebab-case name (e.g.
   `dns-refresh-retry-backoff`).
2. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, …), short imperative
   subject. No AI co-author trailers.
3. Open a pull request against `master`. CI must pass before merging.
4. Merge once CI is green. The source branch is deleted on merge.

`master` is protected: no direct pushes, CI must pass, and history stays linear (no
merge commits — squash or rebase).

## Quality gates

Before opening a PR, run on changed files (whole repo for broad changes):

1. `bun run typecheck` — must be clean (`tsc --noEmit`)
2. `bun test` — must pass
3. `bun run lint` — zero errors, zero warnings
4. `bun run format` — apply Prettier
5. For `.md` changes: `bun run lint:md`

See [AGENTS.md](AGENTS.md) for code style and testing conventions.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `master` and every
pull request targeting `master`:

- **`test`** — `bun install`, then `typecheck`, `lint`, `format:check`, `lint:md`,
  and `bun test`.
- **`build`** — compiles the CLI and daemon binaries (`bun run build`,
  `bun run build:daemons`) to catch build breakage.
- **`verify-macos`** — on `macos-latest`, runs [`scripts/verify-dist.sh`](scripts/verify-dist.sh):
  builds the CLI and daemon binaries, ad-hoc codesigns them, and smoke-tests
  `vpnctl --help` and `vpnctl setup --uri <test-uri>` against a scratch `$HOME`.
  Run the same script locally before cutting a release.

There is no deploy/release pipeline yet. Once one exists (e.g. publishing compiled
macOS binaries as GitHub Releases on tag push), it will be added as a separate job
here and documented in this section. Note that ad-hoc codesigning only satisfies
`codesign --verify` for locally-built binaries — a binary downloaded as a release
asset carries the `com.apple.quarantine` xattr and would still need a notarized
Developer ID signature to run.
