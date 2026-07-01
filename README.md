# vpnctl

[![CI](https://github.com/SoundAsleep192/vpnctl/actions/workflows/ci.yml/badge.svg)](https://github.com/SoundAsleep192/vpnctl/actions/workflows/ci.yml)

Fail-closed VPN tooling for protected domains: macOS pf/DNS killswitch for the host
and a Docker sandbox runtime for protected agent processes.

When the tunnel is down or DNS resolution fails, traffic to the configured domains is
blocked by default — not allowed through.

## Requirements

- macOS (Apple Silicon or Intel)
- A VLESS+Reality `vless://...` share link from your VPN provider
- Internet access and an admin password for first install
- Docker Desktop, only for `vpnctl sandbox`

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/SoundAsleep192/vpnctl/master/scripts/install.sh | bash
```

Installs `vpnctl` plus daemon aliases (`vpnctl-monitor`, `vpnctl-tunnel`, and
`vpnctl-tray`) to `~/.local/bin` (override with `VPNCTL_INSTALL_DIR`), installs
`sing-box` with Homebrew if missing, prepares Rosetta 2 on Apple Silicon for the
tray helper, asks for the VLESS+Reality link, optionally installs Claude/Codex
preflight wrappers, and installs the protection daemons. Add the install directory
to your `PATH` if prompted.

The installer does not require Node.js or Bun. The release binary is self-contained.
vpnctl does not provide a VPN server by itself.

## Usage

```sh
vpnctl                       # open the interactive dashboard in a terminal
vpnctl uninstall          # fully remove vpnctl daemons, firewall/DNS changes, state, logs, config, tray, preflight wrappers, and binaries (requires root)
vpnctl up                  # start (or restart) the tunnel daemon (requires root)
vpnctl down                # stop the tunnel daemon (requires root)
vpnctl status [--ip]       # show pf, tunnel, daemon, and sinkhole state (requires root)
vpnctl refresh             # resolve domains, write pf tables, recompute sinkhole/anchor state (requires root)
vpnctl check [--full]      # probe protected domains over the tunnel (requires root)
vpnctl exec -- <command>   # preflight, resolve exit profile, inject TZ, then run <command>
vpnctl sandbox run --preset claude --workspace .  # run Claude in Docker VPN sandbox
vpnctl sandbox run --preset codex --workspace .   # run Codex in Docker VPN sandbox
vpnctl sandbox run --workspace . -- <command>     # run arbitrary command in Docker VPN sandbox
vpnctl sandbox code --preset claude --workspace . # open VS Code remote backend in sandbox
vpnctl domains list|add|remove <domain>  # manage the domain allowlist
vpnctl logs [--monitor] [--tunnel] [-f] [-n <count>]  # tail monitor/tunnel logs
vpnctl doctor              # diagnose runtime, config, sing-box, pf, and daemons (requires root)
vpnctl update              # check for a newer release, install it, and redeploy daemons (requires root)
vpnctl audit [--watch <s>] [--log] [--install-agent] [--uninstall-agent]  # snapshot configured process sockets
```

Routing mode controls the sing-box fallback route. `full` routes all non-private
traffic through the proxy. `split` routes only configured domain suffixes through
the proxy and leaves other traffic direct. New configs default to `split`.
Choose routing mode during the installer or later in `vpnctl` under Configure.

`doctor` checks local health: config, sing-box, pf, launchd daemons, update state,
and VPN conflicts. `audit` is different: it snapshots configured process sockets so
you can see what protected tools are connecting to.

## Protected Docker sandbox

`vpnctl sandbox` starts a self-contained Docker runtime. A VPN sidecar owns the Linux
network namespace, `/dev/net/tun`, sing-box, and namespace-local iptables killswitch.
The agent container shares that namespace with `--network container:<vpn>`, runs as
the non-root `developer` user, drops all capabilities, and does not receive the Docker
socket.

The sandbox uses the VLESS/Reality outbound from `~/.config/vpnctl/config.json`, but it
does not depend on host `vpnctl up`, macOS `pf`, launchd, `/etc/hosts`, or host DNS
state. Host timezone, system clock, geolocation, global network settings, and macOS
firewall state are never changed.

The `claude` and `codex` presets build an agent image with the corresponding CLIs
installed and mount their matching host credentials (`~/.claude` or `~/.codex`) into
the agent container. Arbitrary commands do not receive credentials unless requested.

Before starting the agent, vpnctl resolves the exit profile from inside the sandbox
namespace and injects `TZ=<exit timezone>`. Protected mode fails closed if no usable
country/timezone profile can be resolved. `--allow-unknown-profile` is a debug escape
hatch and uses `TZ=UTC` with a warning instead of silently inheriting the host timezone.

For arbitrary commands, mount credentials only when intended:

```sh
vpnctl sandbox run --workspace . --mount-secret ~/.config/tool:/home/developer/.config/tool:ro -- tool
```

Management commands:

```sh
vpnctl sandbox status
vpnctl sandbox logs [--vpn|--agent] [-f] [-n <count>]
vpnctl sandbox shell
vpnctl sandbox stop
vpnctl sandbox clean
vpnctl sandbox doctor
```

VS Code mode opens the macOS VS Code frontend, while the remote backend and extension
host run in the Docker sandbox. Host-side VS Code marketplace, sync, and telemetry
traffic may still use the host network; the protected guarantee is for the remote
backend, agent process, and extension backend inside the container.

### Status indicator

The installer adds a per-user LaunchAgent (`com.vpnctl.tray`) that shows a
menu-bar icon reflecting live state — green (tunnel up), red (tunnel down, traffic
blocked fail-closed), or gray (monitor daemon not running / state stale). It reads a
world-readable `state.json` the monitor daemon writes each tick; no `sudo` needed.

The menu-bar helper is an x86_64 binary, so on Apple Silicon it runs under Rosetta 2
(`softwareupdate --install-rosetta`); the install script installs Rosetta when
needed.

## Development

Requires [Bun](https://bun.sh) >= 1.3.13.

```sh
bun install
bun run bin/vpnctl.ts --help
```

Start with [docs/](docs/README.md) for architecture, workflows, project structure,
operations, testing, and agent rules. See [AGENTS.md](AGENTS.md) for the compact
agent-facing rules and [CONTRIBUTING.md](CONTRIBUTING.md) for the git workflow and
CI/CD pipeline.

Planned and in-progress work is tracked in
[GitHub Issues](https://github.com/SoundAsleep192/vpnctl/issues), grouped by
[milestone](https://github.com/SoundAsleep192/vpnctl/milestones).

## License

[MIT](LICENSE)
