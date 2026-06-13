# vpnctl — implementation status

Tracks progress against the build plan (`idempotent-prancing-rossum.md`). Not everything
in the plan is done yet — see "Remaining" below.

## Done

- **Core modules** (`src/core/`): `paths`, `exec` (injectable `Exec` + `realExec`),
  `config` (zod schema, `loadConfig`/`saveConfig`), `vless` (`parseVlessUri`),
  `singbox-config` (`buildSingBoxConfig`/`writeSingBoxConfig`/`readSingBoxConfig`),
  `network` (interface/tunnel detection, public IP/country resolution),
  `pf-anchor`, `pf-conf-patch`, `sinkhole`, `dns-refresh`, `launchd`, `audit`.
- **Daemons** (`src/daemon/`): `monitor.ts` (sinkhole/pf-anchor + table refresh loop),
  `tunnel.ts` (sing-box process owner).
- **CLI — full 13/13 command surface** (`src/cli/commands/`, wired in `bin/vpnctl.ts`):
  `setup`, `install`, `uninstall`, `status`, `up`, `down`, `refresh`, `check`, `exec`,
  `domains` (list/add/remove), `logs`, `doctor`, `audit`.
- **Tests**: `bun test` — 178 pass, 0 fail, 351 assertions across 21 files.
  `bun run typecheck` (`tsc --noEmit`) — clean.
- **Domain preset**: `templates/domains/ai-dev-tools.txt` (Anthropic/OpenAI/Cursor
  hostnames, generic — safe to publish).
- **Fixtures**: captured from real macOS command output (`route`, `ifconfig`, `pfctl`,
  `lsof`, `/etc/hosts`, `/etc/pf.conf`) under `test/fixtures/`.

## Deviations from plan

1. **`vpnctl domains add/remove`** — plan says these "trigger refresh if installed".
   Implemented instead: print a `sudo vpnctl refresh` hint after editing
   `config.json`/`sing-box.json`, rather than auto re-exec under sudo mid-command.
   Reason: avoids a confusing password prompt fired from inside a plain config-edit
   command. User runs `sudo vpnctl refresh` manually to apply.
2. **`vpnctl doctor`** — plan lists this as "user" privilege. Implemented calls
   `requireRoot()` (same as `status`/`check`). Reason: the pf/anchor/launchd checks
   need root to read accurately; without it `doctor` would report false negatives.

## Remaining (plan items not started)

- **Open-source housekeeping**: `LICENSE` (MIT), `README.md`.
- **Build/compile verification**: `bun build --compile` for `bin/vpnctl.ts` and both
  daemon entrypoints (`src/daemon/monitor.ts`, `src/daemon/tunnel.ts`), plus ad-hoc
  codesign and a smoke run of `--help`/`setup --uri` against a temp `XDG_CONFIG_HOME`.
- **Migration/cutover** to replace the live bash killswitch — explicitly a separate,
  later step requiring direct confirmation before touching the live machine; not
  started.

## Verified

- `bun run typecheck` — 0 errors.
- `bun test` — 178/178 pass.

Not yet verified: no manual run of the compiled CLI or any command against a real
`~/.config/vpnctl` / live macOS pf/launchd state.
