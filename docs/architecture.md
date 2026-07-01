# Architecture

## Overview

vpnctl has one product goal: protected domains and protected agent processes must not
leak outside the configured VPN path. The host layer uses macOS pf, `/etc/hosts`, DNS
resolution, launchd, and sing-box. The sandbox layer uses Docker, a VPN sidecar
container, and namespace-local iptables.

Host protection and sandbox protection are intentionally separate. The tray reflects
host monitor state. The sandbox has its own VPN namespace and its own killswitch.

## Runtime surfaces

| Surface        | Owner               | Purpose                                                                  |
| -------------- | ------------------- | ------------------------------------------------------------------------ |
| CLI            | user/root           | Dashboard, diagnostics, domains, logs, tunnel controls, sandbox commands |
| TUI            | user                | Terminal dashboard for status, config, diagnostics, workspace actions    |
| Monitor daemon | root launchd daemon | Reconcile pf tables, sinkhole, state file, and desired tunnel state      |
| Tunnel daemon  | root launchd daemon | Run sing-box with generated config and reconcile immediate tunnel state  |
| Tray agent     | user launchd agent  | Menu-bar indicator and unprivileged tunnel toggle                        |
| Docker sandbox | Docker              | Protected runtime for agent commands and VS Code remote backend          |

## State and paths

| Path                                              | Purpose                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `~/.config/vpnctl/config.json`                    | User config: VLESS URI, domains, DNS servers, TUN, routing mode, UI language |
| `~/.config/vpnctl/sing-box.json`                  | Generated sing-box config                                                    |
| `~/.config/vpnctl/desired-tunnel`                 | User-writable desired tunnel state, parsed only as `up` or `down`            |
| `~/.config/vpnctl/tray.log`                       | Per-user tray log                                                            |
| `/Library/Logs/vpnctl/state.json`                 | World-readable monitor state for tray and TUI                                |
| `/Library/Logs/vpnctl/monitor.log`                | Root monitor daemon log                                                      |
| `/Library/Logs/vpnctl/tunnel.log`                 | Root tunnel daemon log                                                       |
| `/Library/Application Support/vpnctl`             | Root-owned runtime state, cache, and installed daemon binaries               |
| `/etc/pf.anchors/vpnctl`                          | Generated pf anchor                                                          |
| `/etc/pf.conf`                                    | Patched once with vpnctl anchor include markers                              |
| `/etc/hosts`                                      | Patched sinkhole block for protected domains when needed                     |
| `~/Library/LaunchAgents/com.vpnctl.tray.plist`    | Per-user tray LaunchAgent                                                    |
| `/Library/LaunchDaemons/com.vpnctl.monitor.plist` | Root monitor LaunchDaemon                                                    |
| `/Library/LaunchDaemons/com.vpnctl.tunnel.plist`  | Root tunnel LaunchDaemon                                                     |

## Host protection flow

1. The release installer writes `config.json` and generates `sing-box.json`.
2. The release installer installs the pf anchor, patches `/etc/pf.conf`, installs root
   LaunchDaemons, installs the tray agent, and starts protection.
3. The tunnel daemon starts sing-box with the generated config.
4. The monitor daemon repeatedly reads config and live network state, resolves protected
   domains, updates pf tables, updates `/etc/hosts`, and writes `state.json`.
5. If the tunnel is down or unknown, protected domains are sinkholed and blocked by pf.
6. If the tunnel is up, protected domains route through the trusted TUN interface.

The monitor and tunnel daemon both reconcile enforcement. This is deliberate:
enforcement should converge even if one launchd job starts slowly.

## Routing modes

Routing mode changes sing-box fallback behavior:

- `split` routes configured protected domain suffixes through the proxy and leaves other
  traffic direct.
- `full` routes all non-private traffic through the proxy.

New configs default to `split`. Domain management regenerates `sing-box.json` while
preserving the saved routing mode.

## Desired tunnel state

The tray and `vpnctl up/down` write `desired-tunnel`. The root monitor reads that file
and can only enact two actions:

- `up`: enable or restart the tunnel daemon.
- `down`: disable and boot out the tunnel daemon.

Anything else is ignored. Desired-state enforcement runs before normal reconcile, in
its own error boundary, so a desired-state failure cannot skip fail-closed pf and
sinkhole reconciliation.

## Conflict detection

vpnctl distinguishes VPN inventory from real conflict:

- Other VPN inventory means another `utun`, `ppp`, `ipsec`, or similar interface is up.
- Routing conflict means a competing VPN owns the default route.
- DNS conflict means macOS resolvers are bound to a competing VPN interface.

Status and doctor should describe those states separately. "Other VPN detected" alone
is not proof of conflict.

## Tray and notifications

The tray is a per-user LaunchAgent. It reads monitor `state.json`, watches for changes,
polls as a fallback, and writes desired tunnel changes without `sudo`.

Tray status:

- Protected: tunnel is up and state is fresh.
- Starting: tunnel requested up, protected domains remain blocked while it connects.
- Fail-closed: tunnel is down and protected domains are blocked.
- Unknown: monitor state is absent or stale.

Notifications are deduplicated across tray instances through status-notification state
so repeated tray launches do not spam the user.

## Docker sandbox

`vpnctl sandbox` creates a protected runtime independent of host pf and launchd state.

The VPN sidecar:

- Owns the Docker network namespace.
- Runs sing-box with sandbox-generated config.
- Gets `/dev/net/tun` and `NET_ADMIN`.
- Applies namespace-local iptables default-deny egress.

The agent container:

- Shares the sidecar network namespace with `--network container:<vpn>`.
- Runs as non-root `developer`.
- Drops all capabilities.
- Does not receive the Docker socket.
- Mounts only the requested workspace and selected credentials.

The `claude` and `codex` presets mount their matching credentials automatically.
Arbitrary commands receive no credentials unless the user passes `--secret` or
`--mount-secret`.

Before running the agent, vpnctl resolves public IP, country, and timezone from inside
the sandbox namespace. Protected mode fails closed when no usable exit profile can be
resolved unless `--allow-unknown-profile` is explicitly passed.

## Dockerfile templates and assets

Sandbox Dockerfiles are real template files under `templates/sandbox/`. TypeScript
renders named placeholders rather than keeping Dockerfile bodies as unreadable inline
strings. Tray icons live under `templates/tray-icons/`.

## Failure model

The safest answer wins:

- If domain resolution fails, keep protected domains blocked.
- If tunnel state is unknown, report unknown or fail-closed, never protected.
- If sandbox exit profile is unknown, fail closed by default.
- If doctor lacks root, require root rather than reporting false negatives.
- If a competing VPN exists but does not own route or DNS, report inventory without
  claiming conflict.
