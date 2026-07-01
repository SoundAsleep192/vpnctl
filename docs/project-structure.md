# Project Structure

## Root layout

| Path                    | Purpose                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `bin/vpnctl.ts`         | Commander CLI entrypoint                                                                       |
| `src/cli/commands/`     | Command implementations for host controls, installer internals, domains, diagnostics, and logs |
| `src/cli/tui/`          | Ink dashboard, setup wizard, actions, formatting, snapshots, and i18n                          |
| `src/core/`             | Pure logic and system integration helpers                                                      |
| `src/daemon/`           | Monitor, tunnel, tray, and reconcile interval daemons                                          |
| `templates/domains/`    | Default protected-domain seed lists                                                            |
| `templates/sandbox/`    | Dockerfile templates used by sandbox asset generation                                          |
| `templates/tray-icons/` | Tray icon assets consumed by the tray daemon                                                   |
| `scripts/`              | Install, local reinstall, build verification, smoke, E2E, and proof scripts                    |
| `scripts/e2e/`          | Destructive macOS E2E scenarios and shared assertions                                          |
| `test/`                 | Bun unit tests and fixtures                                                                    |
| `docs/`                 | Long-form project documentation                                                                |
| `.github/workflows/`    | CI, E2E gate, and release workflows                                                            |

## CLI layer

`bin/vpnctl.ts` owns command registration only. Command behavior should live in
`src/cli/commands/` or `src/core/`.

Important command files:

- `setup.ts`: installer-only interactive and non-interactive config creation.
- `install.ts`: installer-only root install, daemon plist generation, tray install trigger.
- `status.ts`: root host status output.
- `doctor.ts`: root diagnostics and conflict report.
- `domains.ts`: domain list mutation and sing-box regeneration.
- `tray.ts`: per-user tray LaunchAgent install internals and Rosetta probe.
- `up.ts` and `down.ts`: desired-state writes plus tunnel daemon actions.

## TUI layer

`src/cli/tui/` is split by concern:

- `run-tui.tsx`: dashboard component tree and screen state.
- `setup-wizard.tsx`: terminal setup flow.
- `i18n.ts`: English and Russian UI strings.
- `format.ts`: user-facing status and layout formatting helpers.
- `snapshot.ts`: reads current host/sandbox/config state for the dashboard.
- `actions.ts`: side effects triggered by dashboard selections.
- `types.ts`: shared TUI types.

Keep dashboard copy outcome-oriented. The TUI should show what is protected, blocked,
starting, or unknown rather than exposing raw subsystem names as the main experience.

## Core layer

`src/core/` contains both pure logic and small system wrappers:

- `config.ts`: config schema, defaults, language and routing-mode parsing.
- `vless.ts`: VLESS/Reality URI parsing.
- `singbox-config.ts`: generated sing-box config.
- `pf-anchor.ts` and `pf-conf-patch.ts`: pf rules and `/etc/pf.conf` patching.
- `sinkhole.ts`: `/etc/hosts` sinkhole block generation.
- `dns-refresh.ts`: domain resolution and pf table writes.
- `network.ts`: macOS route, interface, tunnel, public IP, and country checks.
- `enforcement.ts`: fail-closed enforcement planning and polling.
- `launchd.ts`: daemon plist rendering and launchctl wrappers.
- `desired-tunnel.ts`: tray/CLI desired tunnel parsing and enforcement.
- `state-file.ts`: monitor state serialization and classification.
- `vpn-conflicts.ts`: other VPN inventory, route conflict, and DNS conflict checks.
- `status-notification.ts` and `notifications.ts`: localized desktop notifications.
- `preflight-wrapper.ts`: Claude/Codex wrapper generation used by the installer.
- `sandbox.ts`: Docker sandbox asset generation and commands.
- `exit-profile.ts`: public IP, country, timezone, and country gate resolution.
- `paths.ts`: central path and launchd label constants.

All shell-outs use `Exec` from `src/core/exec.ts`.

## Daemons

- `monitor.ts`: root control plane for desired tunnel state, pf tables, sinkhole, and
  monitor state.
- `tunnel.ts`: root sing-box daemon wrapper and immediate tunnel-state reconcile.
- `tray.ts`: per-user systray process and notification sender.
- `reconcile-interval.ts`: monitor polling cadence, including faster polling while a
  tunnel is starting.

## Templates

Templates are repository assets, not inline strings:

- Domain seed files live in `templates/domains/`.
- Sandbox Dockerfiles live in `templates/sandbox/`.
- Tray icon base64 assets live in `templates/tray-icons/`.

When a template changes, update tests that render or consume it.

## Tests

Tests mirror behavior, not folder structure perfectly. Prefer a focused test file
named after the unit or command under test. Fixtures belong in `test/fixtures/`.

New tests must use English descriptions and no comments.
