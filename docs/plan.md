# vpnctl — TypeScript/Bun rewrite of the macOS AI-tools VPN killswitch

## Context

The current setup (`~/.config/vpn-killswitch`) is a working but bash-only system: a `pf` anchor + IP table, a `/etc/hosts` DNS sinkhole, a sing-box VLESS+Reality tunnel, and three LaunchDaemons gluing it together. It was just migrated to a new VPS and re-verified end-to-end (fail-closed path tested) this session.

The user wants to turn this into a real, open-sourceable console application:

- Bun + TypeScript, ergonomic CLI (paste a `vless://` config, get a working killswitch)
- No GUI
- Automated tests so "everything always works"
- Architecture decisions already made by the user:
  - **Full TS rewrite** of all engine logic (pf rule generation, sinkhole hosts management, table refresh, interface detection, launchd plist management) — no shelling out to the old bash scripts
  - **One-time `sudo vpnctl install`**: sets up persistent root LaunchDaemons; everyday commands (`status`, `up`, `down`, `check`, `setup`) run unprivileged where possible
- Project name: **`vpnctl`** (binary, package, pf anchor name, launchd label prefix `com.vpnctl.*`)
- v1 includes a ported, generalized `vpnctl audit` subcommand (VS Code/Cursor connection snapshot tool, today's `audit-vscode.sh`)

This plan covers building `vpnctl` as a **new, separate, open-sourceable repo** (`~/Projects/vpnctl`) with no personal/ekocrop-specific data. It does **not** include cutting the user's live machine over from the bash system to `vpnctl` — that's an explicit, separate, later step (see "Migration / cutover" below), done with the same care as today's fail-closed verification.

---

## Scope

**In scope (v1):**

- `vless://` (Reality) URI parsing → sing-box outbound config
- sing-box config generation (tun + DNS + route rules) from a domain list + parsed outbound
- Native TS reimplementation of: trusted/public interface detection, pf anchor rule generation + `/etc/pf.conf` patching, `/etc/hosts` sinkhole management, DNS-based pf table refresh
- Two consolidated root LaunchDaemons (monitor loop, tunnel runner) replacing today's three
- CLI: `setup`, `install`, `uninstall`, `status`, `up`, `down`, `refresh`, `check`, `exec`, `domains`, `logs`, `doctor`, `audit`
- Unit tests (`bun test`) for all pure logic, using fixtures captured from today's real macOS command output
- MIT license, README, default "AI dev tools" domain preset (generalized `domains.txt`)

**Out of scope (v1):**

- ekocrop-specific tooling (`ks-mcp-check.sh`, `mcp-dns.txt`, `mcp-docker-dns-args.sh`) — stays in the personal bash repo
- GUI / menu bar app
- Non-macOS platforms
- Automatic migration of the user's live `/etc/pf.conf`, `/etc/hosts`, LaunchDaemons from the old system (separate cutover step)

---

## Tech stack

| Concern           | Choice                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | **Bun ≥ 1.3.13**          | Current machine has 1.0.28 — needs `bun upgrade` before `bun build --compile` work (1.3.12 has a known compiled-binary SIGKILL regression on Apple Silicon; avoid it). Add `"engines": { "bun": ">=1.3.13" }` to `package.json`.                                                                                                                                                                                                                                 |
| Language          | TypeScript, strict mode   | No `as` casts; one exported entity per file; descriptive names — same house style the user already uses.                                                                                                                                                                                                                                                                                                                                                         |
| CLI routing       | **commander v13**         | More OSS-community-standard than citty; subcommand API maps 1:1 onto `vpnctl <verb>`.                                                                                                                                                                                                                                                                                                                                                                            |
| Interactive setup | **@clack/prompts**        | For `vpnctl setup` wizard. Also accept `--uri <vless://...>` / stdin as a non-interactive fallback for the VLESS paste step (defends against any TTY paste edge cases).                                                                                                                                                                                                                                                                                          |
| Output styling    | **picocolors**            | Minimal, fast, fine in compiled binaries.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Config validation | **zod**                   | Validates `~/.config/vpnctl/config.json` on load; gives clear errors in `vpnctl doctor`/`status`.                                                                                                                                                                                                                                                                                                                                                                |
| Tests             | **bun test**              | All shell-outs go through an injectable `Exec` interface; tests pass fake `Exec` implementations returning canned macOS command output. No `Bun.spawn` mocking needed.                                                                                                                                                                                                                                                                                           |
| Daemon binaries   | **`bun build --compile`** | Compile `monitor` and `tunnel` entrypoints to standalone binaries at install time (or via prebuilt release assets later). Ad-hoc `codesign -s -` after compiling. All shelled commands use **absolute paths** (`/sbin/route`, `/sbin/ifconfig`, `/sbin/pfctl`, `/usr/bin/dig`, `/usr/sbin/lsof`, `/usr/bin/dscacheutil`, `/usr/bin/killall`, `/bin/launchctl`) — sidesteps PATH issues in compiled binaries and is correct practice for root daemons regardless. |

---

## Repo layout

```text
~/Projects/vpnctl/
  package.json
  tsconfig.json
  LICENSE                       (MIT)
  README.md
  bin/
    vpnctl.ts                   # CLI entrypoint (commander)
  src/
    core/
      paths.ts                  # all path/name constants (config dir, anchor name, labels, log paths)
      exec.ts                   # Exec type + realExec (Bun.spawn wrapper, absolute paths) + fakeExec helpers for tests
      config.ts                 # zod schema, load/save ~/.config/vpnctl/config.json
      vless.ts                  # parseVlessUri()
      singbox-config.ts         # buildSingBoxConfig()
      network.ts                # interface/tunnel detection (replaces vpn-detect.sh)
      pf-anchor.ts               # generateAnchorRules(), writeAnchor()
      pf-conf-patch.ts          # computePfConfPatch(), applyPfConfPatch()
      sinkhole.ts                # computeHosts(), applyHosts()
      dns-refresh.ts             # resolveAll(), writeTable()
      launchd.ts                 # renderPlist(), install/uninstall/kickstart helpers
      audit.ts                   # captureConnections(), log rotation
    daemon/
      monitor.ts                 # root daemon: sinkhole+pf-anchor (5s) + table refresh (10min)
      tunnel.ts                  # root daemon: runs/owns sing-box process
    cli/
      commands/
        setup.ts
        install.ts
        uninstall.ts
        status.ts
        up.ts
        down.ts
        refresh.ts
        check.ts
        exec.ts
        domains.ts
        logs.ts
        doctor.ts
        audit.ts
  templates/
    domains/
      ai-dev-tools.txt          # default preset = today's domains.txt (Anthropic/OpenAI/Cursor), generalized
    pf-conf-markers.ts           # BEGIN/END marker strings for /etc/pf.conf patch
  test/
    vless.test.ts
    singbox-config.test.ts
    network.test.ts
    pf-anchor.test.ts
    pf-conf-patch.test.ts
    sinkhole.test.ts
    dns-refresh.test.ts
    audit.test.ts
    fixtures/
      route-get-1.1.1.1.txt      # captured `route -n get 1.1.1.1` output
      ifconfig-utun20.txt        # captured `ifconfig utun20` output
      ifconfig-lu.txt
      sing-box-config.sample.json
      etc-hosts.clean.txt
      etc-hosts.sinkholed.txt
      pfctl-rules.trusted.txt    # today's verified `pfctl -a vpn-killswitch -s rules` (trusted case)
      pfctl-rules.no-trusted.txt
      lsof-established.txt
```

---

## Core modules

### `core/paths.ts`

Single source of truth for names/paths so renaming is trivial:

- `CONFIG_DIR = ~/.config/vpnctl`, `CONFIG_FILE`, `GENERATED_SINGBOX_CONFIG`
- `ROOT_STATE_DIR = /Library/Application Support/vpnctl` (cache, pidfiles, compiled daemon binaries)
- `LOG_DIR = /Library/Logs/vpnctl`
- `PF_ANCHOR_NAME = "vpnctl"`, `PF_TABLE_V4 = "vpnctl_v4"`, `PF_TABLE_V6 = "vpnctl_v6"`
- `LAUNCHD_LABEL_MONITOR = "com.vpnctl.monitor"`, `LAUNCHD_LABEL_TUNNEL = "com.vpnctl.tunnel"`
- `PF_CONF_MARKER_BEGIN/END = "# === BEGIN VPNCTL ===" / "# === END VPNCTL ==="`
- `HOSTS_MARKER_BEGIN/END = "# === BEGIN VPNCTL SINKHOLE ===" / "# === END VPNCTL SINKHOLE ==="`

### `core/exec.ts`

```ts
export type ExecResult = { stdout: string; stderr: string; exitCode: number };
export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;
export const realExec: Exec; // Bun.spawn wrapper; cmd must be an absolute path
```

Tests construct fake `Exec` functions (via `mock()` from `bun:test`) keyed on `cmd`+`args`, returning fixture file contents.

### `core/vless.ts` — replaces manual editing of the sing-box outbound block

```ts
export interface RealityOutbound {
  type: "vless";
  tag: string;
  server: string;
  server_port: number;
  uuid: string;
  flow?: string;
  tls: {
    enabled: true;
    server_name: string;
    utls: { enabled: true; fingerprint: string };
    reality: { enabled: true; public_key: string; short_id: string };
  };
}
export function parseVlessUri(uri: string): RealityOutbound;
```

- Throws a clear error if `security != reality` (v1 supports Reality only — matches the user's current/likely future configs) or if required query params (`pbk`, `sid`, `sni`, `fp`) are missing.
- `encryption=none` and `spx=` are validated-but-ignored (sing-box has no outbound field for them — documented in a code comment only if non-obvious).
- Fragment (`#RedShieldVPN_Netherlands`) becomes `tag` (sanitized/URL-decoded).

### `core/singbox-config.ts`

```ts
export function buildSingBoxConfig(opts: {
  outbound: RealityOutbound;
  domains: string[];
  tun: { interfaceName: string; address: string };
  dnsServers: string[];
}): SingBoxConfig; // plain JSON object
```

During implementation, read the user's live `~/sing-box-config/config.json` as the **reference/golden structure** (dns servers + dns rules keyed on `domains`, tun inbound, route rules keyed on `domains`, outbounds = [parsed Reality outbound, direct]). The golden file (sanitized: real values replaced with placeholders) becomes `test/fixtures/sing-box-config.sample.json` for a snapshot test of `buildSingBoxConfig`.

### `core/network.ts` — replaces `vpn-detect.sh` (fixes the BSD-awk bug class entirely)

```ts
export async function getRouteInterface(exec: Exec, target: string): Promise<string | null>; // route -n get <target> -> "interface:" line
export async function getInterfaceInet(exec: Exec, iface: string): Promise<string | null>; // ifconfig <iface> -> "inet" line
export async function listUtunInterfaces(exec: Exec): Promise<string[]>; // ifconfig -lu -> utunN list
export async function findUtunForInet(exec: Exec, ip: string): Promise<string | null>;
export function getTunIpFromConfig(singboxConfig: unknown): string | null; // pure JSON read of tun.address, no awk
export async function isSingBoxRunning(pidFile: string): Promise<boolean>; // read pidfile + kill -0
export async function getTrustedInterface(exec: Exec, singboxConfig: unknown, pidFile: string): Promise<string | null>;
export async function getPublicInterface(exec: Exec): Promise<string | null>; // tries 1.1.1.1 then 8.8.8.8, must be utunN
export async function isTunnelUp(exec: Exec, singboxConfig: unknown, pidFile: string): Promise<boolean>;
```

- All output parsing is regex on captured strings (no awk anywhere).
- `getTunIpFromConfig` parses `inboundType === "tun"`'s `address` (e.g. `"172.19.0.1/30"`) and strips the prefix — pure function, regression-tested directly against the real config structure.
- `isSingBoxRunning` uses a pidfile written by `daemon/tunnel.ts` (more reliable than `pgrep -f "sing-box run"`).

### `core/pf-anchor.ts`

```ts
export function generateAnchorRules(opts: { trustedIface: string | null }): string; // pure
export async function writeAnchor(exec: Exec, rules: string): Promise<void>; // pfctl -nf check, install -m0644 root:wheel, pfctl -a <anchor> -f
```

`generateAnchorRules` reproduces `update-pf-anchor.sh`'s output exactly (table decls + conditional `pass out quick on $trusted ... to <table>` for v4/v6 when `trustedIface` matches `^utun[0-9]+$`, plus unconditional `block drop log quick ... to <table>` for v4/v6), with `vpn_killswitch_v4/v6` renamed to `vpnctl_v4/v6` and anchor name `vpnctl`. Today's verified `pfctl -a vpn-killswitch -s rules` output (both trusted and untrusted cases) becomes the golden snapshot fixtures (renamed accordingly).

### `core/pf-conf-patch.ts` — replaces the `/etc/pf.conf` patching in `install.sh`

```ts
export function computePfConfPatch(content: string, anchorName: string): { content: string; changed: boolean }; // pure, idempotent, marker-bounded
export async function applyPfConfPatch(exec: Exec): Promise<void>; // read /etc/pf.conf, backup to /etc/pf.conf.vpnctl.bak, write if changed, pfctl -nf check
export function computePfConfRevert(content: string): { content: string; changed: boolean };
```

### `core/sinkhole.ts` — replaces `sinkhole.sh`

```ts
export function computeHosts(currentHosts: string, domains: string[], sinkholed: boolean): { content: string; changed: boolean }; // pure
export async function applyHosts(exec: Exec, content: string): Promise<void>; // backup to /etc/hosts.vpnctl.bak, write, dscacheutil -flushcache, killall -HUP mDNSResponder
```

Marker-bounded block exactly like today (`# === BEGIN/END VPNCTL SINKHOLE ===`), `0.0.0.0` / `::` entries per domain. Idempotency is unit-tested: applying twice with the same desired state produces `changed: false`.

### `core/dns-refresh.ts` — replaces `refresh.sh`

```ts
export async function resolveDomain(exec: Exec, domain: string, dnsServers: string[]): Promise<{ v4: string[]; v6: string[] }>; // dig A then AAAA per server, first success wins, via absolute /usr/bin/dig
export async function resolveAll(exec: Exec, domains: string[], dnsServers: string[]): Promise<{ v4: string[]; v6: string[] }>; // dedupe via Set
export async function writeTable(exec: Exec, table: string, ips: string[]): Promise<void>; // pfctl -a vpnctl -t <table> -T replace -f <tmpfile>
```

- Default `dnsServers = ["1.1.1.1", "8.8.8.8", "9.9.9.9"]` (configurable).
- If `resolveAll` yields zero v4 IPs → caller (monitor daemon) logs WARN and leaves the table untouched (matches today's exit-2 behavior), and a last-good cache (`ROOT_STATE_DIR/cache/last-good-{v4,v6}.txt`) is loaded at daemon startup so the table is non-empty immediately.

### `core/launchd.ts`

```ts
export function renderPlist(opts: {
  label: string;
  programArguments: string[];
  runAtLoad: boolean;
  keepAlive: boolean;
  throttleIntervalSec?: number;
  startIntervalSec?: number;
  stdoutPath: string;
  stderrPath: string;
}): string;
export async function installDaemon(
  exec: Exec,
  label: string,
  plistPath: string,
  plistContent: string,
  domain: "system" | `gui/${string}`,
): Promise<void>; // write file, bootout || true, bootstrap
export async function uninstallDaemon(exec: Exec, label: string, plistPath: string, domain: string): Promise<void>; // bootout, rm
export async function kickstart(exec: Exec, label: string, domain: string, kill?: boolean): Promise<void>;
export async function killService(exec: Exec, label: string, domain: string, signal: "TERM" | "KILL"): Promise<void>;
```

### `core/audit.ts` — generalized `audit-vscode.sh`

```ts
export interface AuditConfig {
  processNamePatterns: string[];
} // default: ["Code", "Code Helper", "Cursor", "Cursor Helper"]
export async function captureConnections(exec: Exec, patterns: string[]): Promise<ConnectionRow[]>; // /usr/sbin/lsof -nP -iTCP -sTCP:ESTABLISHED, filter+parse
export function formatSnapshot(rows: ConnectionRow[]): string;
export function rotateLog(path: string, maxBytes: number, maxLines: number): void;
```

Process-name patterns come from `config.json` (default covers VS Code + Cursor; user can add others) — no ekocrop-specific assumptions.

### `core/config.ts`

zod schema for `~/.config/vpnctl/config.json`:

```ts
{
  tunnel: { interfaceName: string; address: string }, // e.g. "utun20", "172.19.0.1/30"
  outbound: RealityOutbound,
  domains: string[],
  dns: { servers: string[] },
  audit: { processNamePatterns: string[] },
  exec: { blockedCountries: string[] } // default [] — generalizes today's hardcoded RU check
}
```

`loadConfig()` / `saveConfig()` — clear zod error messages surfaced by `vpnctl doctor`.

---

## Daemons (consolidation: 3 plists → 2)

### `daemon/monitor.ts` (root, `com.vpnctl.monitor`, KeepAlive+RunAtLoad+ThrottleInterval=5)

Single long-running loop:

- Every 5s: `isTunnelUp()` → `computeHosts()` → if changed: `applyHosts()` + `generateAnchorRules()` + `writeAnchor()` (mirrors today's sinkhole.sh → update-pf-anchor.sh coupling)
- Every 10 min: `resolveAll()` + `writeTable()` for v4/v6, update last-good cache
- Logs to `/Library/Logs/vpnctl/monitor.log`
- `SIGTERM`/`SIGINT` → clean exit

### `daemon/tunnel.ts` (root, `com.vpnctl.tunnel`, KeepAlive=false, RunAtLoad=false)

- On start: spawn `sing-box run -c ~/.config/vpnctl/sing-box.json` (absolute path to `sing-box` binary, resolved via config or `which` at install time), write its PID to `ROOT_STATE_DIR/tunnel.pid`
- On `SIGTERM`: kill the sing-box child, remove pidfile, exit
- `vpnctl up` → `launchctl kickstart -k system/com.vpnctl.tunnel`
- `vpnctl down` → `launchctl kill TERM system/com.vpnctl.tunnel`
- Logs to `/Library/Logs/vpnctl/tunnel.log`

---

## CLI commands

| Command                                                                   | Privilege                               | Replaces                                 | Behavior                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vpnctl setup`                                                            | user                                    | (manual config editing)                  | `@clack/prompts` wizard: paste/`--uri` VLESS URI → `parseVlessUri`, pick domain preset (`ai-dev-tools` default, editable), tun interface/address (default `utun20` / `172.19.0.1/30`), DNS servers. Writes `config.json` + generates `sing-box.json`.                       |
| `vpnctl install`                                                          | root (re-exec via sudo if needed)       | `install.sh install`                     | Generate sing-box config, `bun build --compile` daemon binaries + ad-hoc codesign, write pf anchor (initial `trustedIface=null`), patch `/etc/pf.conf`, `pfctl -E -f`, install+bootstrap both LaunchDaemons, run an initial refresh so pf table is non-empty, print status. |
| `vpnctl uninstall`                                                        | root                                    | `install.sh uninstall`                   | Bootout both daemons, remove plists, revert `/etc/pf.conf` patch, remove anchor file, `pfctl -f`, clean `/etc/hosts` sinkhole. `--purge` also removes `ROOT_STATE_DIR`.                                                                                                     |
| `vpnctl status`                                                           | user                                    | `ks-vpn-status.sh` + `install.sh status` | trusted/public iface, tunnel up/down, pf table counts, daemon load state, sinkhole active/inactive. `--ip` flag adds public-IP/geo lookup (off by default — no network call).                                                                                               |
| `vpnctl up` / `down`                                                      | root (sudo)                             | `vpnon` / `vpnoff`                       | kickstart / kill the tunnel daemon.                                                                                                                                                                                                                                         |
| `vpnctl refresh`                                                          | root (sudo)                             | `ks-refresh`                             | One-shot: resolve domains, write pf tables, recompute sinkhole/anchor state.                                                                                                                                                                                                |
| `vpnctl check [--full]`                                                   | user                                    | `check-endpoints.sh`                     | Requires tunnel up; HTTPS HEAD probes against curated list or full `domains` list.                                                                                                                                                                                          |
| `vpnctl exec -- <cmd...>`                                                 | user                                    | `claude-safe.sh`                         | Preflight: trusted==public iface, tunnel up, optional public-IP country check against `config.exec.blockedCountries` (empty by default — generalized, not RU-hardcoded), then `exec`s the wrapped command.                                                                  |
| `vpnctl domains <list\|add\|remove> [domain]`                             | user (writes config) + triggers refresh | manual `domains.txt` edits               | Edits `config.json.domains`, regenerates `sing-box.json`, triggers `vpnctl refresh` if installed.                                                                                                                                                                           |
| `vpnctl logs [--monitor\|--tunnel] [-f]`                                  | user                                    | `ks-logs`                                | Tail `/Library/Logs/vpnctl/*.log`.                                                                                                                                                                                                                                          |
| `vpnctl doctor`                                                           | user                                    | (new)                                    | Read-only diagnostics: bun/sing-box presence, config validity, pf enabled, daemons loaded, anchor present.                                                                                                                                                                  |
| `vpnctl audit [--watch SEC] [--log] [--install-agent\|--uninstall-agent]` | user                                    | `audit-vscode.sh`                        | Connection snapshot via `core/audit.ts`; `--install-agent` sets up a user `LaunchAgent` (`~/Library/LaunchAgents/com.vpnctl.audit.plist`, `StartInterval=300`) running `vpnctl audit --log`.                                                                                |

---

## Testing plan (`bun test`)

All fixtures captured from **today's real, verified-working system** (sanitized of secrets where needed):

- `vless.test.ts` — parse a Reality URI matching today's structure (placeholder uuid/host/keys, real query-param shape incl. `flow=xtls-rprx-vision`, `fp=firefox`, `spx=%2F`, `#fragment`); error cases for missing `pbk`/`sid`/`sni` and non-`reality` security.
- `singbox-config.test.ts` — `buildSingBoxConfig` snapshot against a sanitized copy of `~/sing-box-config/config.json` structure.
- `network.test.ts` — fake `Exec` returning today's captured `route -n get`, `ifconfig utun20`, `ifconfig -lu` output; `getTunIpFromConfig` against the real `tun.address` value (`"172.19.0.1/30"`) — direct regression test for the BSD-awk class of bug fixed this session; `getTrustedInterface`/`getPublicInterface`/`isTunnelUp` for matching and mismatching iface scenarios.
- `pf-anchor.test.ts` — `generateAnchorRules` snapshot against today's verified `pfctl -a vpn-killswitch -s rules` output (both `trustedIface` set and `null`), renamed to `vpnctl`/`vpnctl_v4/v6`.
- `pf-conf-patch.test.ts` — idempotent patch/revert on a sample `/etc/pf.conf`.
- `sinkhole.test.ts` — `computeHosts` against clean / already-sinkholed / unrelated-content `/etc/hosts` fixtures; idempotency assertions.
- `dns-refresh.test.ts` — fake `dig` output per server with fallback ordering and dedupe; zero-v4-result handling.
- `audit.test.ts` — `captureConnections` against a captured `lsof -nP -iTCP -sTCP:ESTABLISHED` fixture, filtered by process-name patterns.

No test requires root or touches real system files — all root-affecting functions (`writeAnchor`, `applyHosts`, `applyPfConfPatch`, `installDaemon`, etc.) take an injected `Exec` and are exercised only via the fake in tests.

---

## Build & verification (for this plan's deliverable)

1. `bun upgrade` (machine is on 1.0.28; need ≥1.3.13 for reliable `bun build --compile`)
2. `bun install` (commander, @clack/prompts, picocolors, zod, bun-types)
3. `bunx tsc --noEmit` — type check
4. `bun test` — full unit suite green
5. `bun build --compile bin/vpnctl.ts --outfile dist/vpnctl` — confirm CLI compiles; run `dist/vpnctl --help`, `dist/vpnctl setup --uri <test-vless-uri>` against a temp `XDG_CONFIG_HOME` to confirm config/sing-box-config generation works without touching `~/.config/vpnctl`
6. `bun build --compile src/daemon/monitor.ts` / `tunnel.ts` — confirm both compile + run `--help`/dry checks
7. No `vpnctl install`/`uninstall` run against the real machine in this phase — that's the cutover step below

---

## Migration / cutover (separate, later, explicit confirmation required)

Once `vpnctl` is built and tested in isolation:

1. `vpnctl setup --uri <current VLESS URI>` using the live config values
2. Compare generated `sing-box.json` against `~/sing-box-config/config.json` (diff)
3. **Before** running `vpnctl install`: `sudo bash ~/.config/vpn-killswitch/install.sh uninstall` (tear down old anchor/daemons/hosts patch) — confirm with the user immediately before, since this is the live-protecting system
4. `sudo vpnctl install`
5. Re-run the same fail-closed verification done this session (tunnel up → `vpnctl check` passes; tunnel down → sinkhole + pf block confirmed, `curl` to a protected domain fails; tunnel up again → recovers)
6. Update `~/.zshrc` aliases (`claude`/`codex` → `vpnctl exec --`, etc.) and archive/retire `~/.config/vpn-killswitch`

---

## Open-source housekeeping

- `LICENSE`: MIT
- `README.md`: install (`bun install -g vpnctl` or release binary), `vpnctl setup`, `sudo vpnctl install`, daily commands, architecture diagram (text), known limits (Cloudflare IP rotation, app-internal resolvers — same caveats as today's README)
- `templates/domains/ai-dev-tools.txt`: today's `domains.txt` content (Anthropic/OpenAI/Cursor hostnames) — generic, safe to publish, shipped as the default preset
- Verify no UUIDs/keys/personal hostnames anywhere in the new repo before first push
