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

See [docs/](docs/README.md) for the full project documentation, especially
[docs/project-rules.md](docs/project-rules.md) and [docs/testing.md](docs/testing.md).
Tests in this repo use English descriptions and no comments.

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

## Releases

Pushing a tag matching `v*` (e.g. `v0.2.0`) triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml):

1. **`build`** (`macos-latest`, matrix over `arm64`/`x64`) — cross-compiles all
   three binaries for each architecture with
   `bun build --compile --target=bun-darwin-<arch>`, ad-hoc codesigns them
   ([`scripts/codesign-dist.sh`](scripts/codesign-dist.sh)), runs the smoke test
   ([`scripts/smoke-test-dist.sh`](scripts/smoke-test-dist.sh)) — the `x64` leg runs
   via Rosetta 2, preinstalled on `macos-latest` (arm64) runners — and packages each
   architecture's binaries as `vpnctl-darwin-<arch>.tar.gz`.
2. **`release`** (`ubuntu-latest`) — downloads both tarballs and publishes them as a
   GitHub Release via `gh release create <tag> --generate-notes`.

To cut a release: bump `version` in `package.json`, merge that to `master`, then tag
the merge commit and push the tag (`git tag v0.2.0 && git push origin v0.2.0`).

Note that ad-hoc codesigning only satisfies `codesign --verify` for locally-built
binaries — a binary downloaded as a release asset carries the
`com.apple.quarantine` xattr and would still need a notarized Developer ID signature
to run without a Gatekeeper prompt.
