# Workflows

## Local development

```sh
bun install
bun run bin/vpnctl.ts --help
bun run bin/vpnctl.ts
```

The no-argument command opens the dashboard when stdin and stdout are TTYs. In scripts,
use explicit subcommands.

## First local install

```sh
brew install sing-box
bun run build
vpnctl setup
sudo vpnctl install
```

`vpnctl setup` requires a VLESS+Reality `vless://...` share link. vpnctl does not
provide a VPN server.

## Fast local reinstall

Use the local reinstall script when iterating on compiled binaries:

```sh
./scripts/reinstall-local.sh
```

It builds the compiled CLI, recreates daemon aliases, copies release assets into the
existing install directory, and redeploys daemons through `sudo vpnctl install`.

To only replace binaries and skip daemon redeploy:

```sh
VPNCTL_REINSTALL_SKIP_DAEMONS=1 ./scripts/reinstall-local.sh
```

If the install directory is root-owned, the script falls back to `sudo` for removal
and copy operations.

## Offline local test

Use this when you want a release-shaped local build without downloading anything:

```sh
./scripts/offline-local-test.sh
```

It runs focused gates, builds/signs the compiled binary, smoke-tests `dist/`,
reinstalls the local build, and prints the manual dashboard/tray checklist. Set
`VPNCTL_OFFLINE_SKIP_TESTS=1` when you only want the reinstall path.

## Host protection setup

Primary flow:

```sh
vpnctl setup
sudo vpnctl install
sudo vpnctl status --ip
sudo vpnctl doctor
```

Routing mode can be set during setup or install:

```sh
vpnctl setup --routing-mode split
sudo vpnctl install --routing-mode full
```

`full` routes all non-private traffic through the proxy. `split` routes only protected
domain suffixes through the proxy and leaves other traffic direct.

## Domain management

```sh
vpnctl domains list
vpnctl domains add example.com
vpnctl domains remove example.com
sudo vpnctl refresh
```

`domains add/remove` edits user config and regenerates `sing-box.json`. It prints a
refresh hint instead of prompting for `sudo` inside a plain config-edit command.

## Tray workflow

```sh
vpnctl tray install
vpnctl tray uninstall
```

The tray is per-user. It reads monitor state without root and writes desired tunnel
state when the user toggles protection. On Apple Silicon, the bundled systray helper
requires Rosetta 2.

## Sandbox workflow

```sh
vpnctl sandbox run --preset claude --workspace .
vpnctl sandbox run --preset codex --workspace .
vpnctl sandbox run --workspace . -- node script.js
vpnctl sandbox status
vpnctl sandbox logs --vpn
vpnctl sandbox stop
```

Presets mount matching credentials automatically. Arbitrary commands do not receive
credentials unless `--secret` or `--mount-secret` is passed.

VS Code remote backend flow:

```sh
vpnctl sandbox code --preset claude --workspace .
```

The macOS VS Code frontend still runs on the host. The protected guarantee applies to
the remote backend and extension backend inside Docker.

## Diagnostics workflow

```sh
sudo vpnctl status --ip
sudo vpnctl doctor
vpnctl logs --monitor -n 100
vpnctl logs --tunnel -n 100
vpnctl sandbox doctor
vpnctl sandbox logs --vpn -n 100
```

Use doctor for root-visible host state. Use sandbox doctor/logs for Docker runtime
state. Do not infer sandbox health from tray state.

## GitHub workflow

This repo uses GitHub flow:

1. Branch from `master`.
2. Use Conventional Commits.
3. Open a PR against `master`.
4. Keep CI green.
5. Merge only after explicit user approval.

Do not push directly to `master`. Do not commit or push from an agent session without
explicit user permission.

When starting work on a GitHub issue, set its project-board status to `In Progress`.

## Release workflow

Release tags are `v*`, for example `v0.2.3`.

1. Bump `package.json` version.
2. Merge the version bump to `master`.
3. Tag the merge commit.
4. Push the tag.

The release workflow builds arm64 and x64 macOS tarballs, ad-hoc codesigns binaries,
smoke-tests them, and publishes a GitHub Release.

Ad-hoc codesigning is not notarization. Downloaded release assets can still hit
Gatekeeper quarantine until proper notarized signing exists.
