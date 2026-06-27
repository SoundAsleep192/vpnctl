# vpnctl

[![CI](https://github.com/SoundAsleep192/vpnctl/actions/workflows/ci.yml/badge.svg)](https://github.com/SoundAsleep192/vpnctl/actions/workflows/ci.yml)

Fail-closed VPN tooling for AI dev tools: macOS pf/DNS killswitch for the host and a
Docker sandbox runtime for protected agent processes.

When the tunnel is down or DNS resolution fails, traffic to the configured domains is
blocked by default — not allowed through.

## Requirements

- macOS (Apple Silicon or Intel)
- [sing-box](https://sing-box.sagernet.org/)
- Docker Desktop

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/SoundAsleep192/vpnctl/master/scripts/install.sh | bash
```

Installs `vpnctl`, `vpnctl-monitor`, `vpnctl-tunnel`, and `vpnctl-tray` to `~/.local/bin`
(override with `VPNCTL_INSTALL_DIR`). Add that directory to your `PATH` if prompted, then:

```sh
brew install sing-box  # if not already installed
vpnctl setup
sudo vpnctl install
```

## Usage

```sh
vpnctl setup              # interactively configure (VLESS+Reality URI, domains, TUN interface, DNS)
vpnctl install             # install pf anchor, /etc/pf.conf patch, and LaunchDaemons (requires root)
vpnctl uninstall [--purge] # remove LaunchDaemons, pf anchor, pf.conf patch, /etc/hosts sinkhole (requires root)
vpnctl up                  # start (or restart) the tunnel daemon (requires root)
vpnctl down                # stop the tunnel daemon (requires root)
vpnctl status [--ip]       # show pf, tunnel, daemon, and sinkhole state (requires root)
vpnctl refresh             # resolve domains, write pf tables, recompute sinkhole/anchor state (requires root)
vpnctl check [--full]      # probe AI dev tool endpoints over the tunnel (requires root)
vpnctl exec -- <command>   # preflight, resolve exit profile, inject TZ, then run <command>
vpnctl sandbox run --preset claude --workspace .  # run Claude in Docker VPN sandbox
vpnctl sandbox run --preset codex --workspace .   # run Codex in Docker VPN sandbox
vpnctl sandbox run --workspace . -- <command>     # run arbitrary command in Docker VPN sandbox
vpnctl sandbox code --preset claude --workspace . # open VS Code remote backend in sandbox
vpnctl domains list|add|remove <domain>  # manage the domain allowlist
vpnctl logs [--monitor] [--tunnel] [-f] [-n <count>]  # tail monitor/tunnel logs
vpnctl doctor              # diagnose bun, config, sing-box, pf, and daemons (requires root)
vpnctl update              # check for a newer release, install it, and redeploy daemons (requires root)
vpnctl audit [--watch <s>] [--log] [--install-agent] [--uninstall-agent]  # snapshot AI dev tool connections
vpnctl tray install|uninstall  # menu-bar icon: green = protected, red = fail-closed, gray = stale/off
```

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
installed. Authentication is still explicit; no host credentials are mounted unless
requested.

Before starting the agent, vpnctl resolves the exit profile from inside the sandbox
namespace and injects `TZ=<exit timezone>`. Protected mode fails closed if no usable
country/timezone profile can be resolved. `--allow-unknown-profile` is a debug escape
hatch and uses `TZ=UTC` with a warning instead of silently inheriting the host timezone.

Credentials are never mounted by default. Mount them only when intended:

```sh
vpnctl sandbox run --preset claude --workspace . --secret claude
vpnctl sandbox run --preset codex --workspace . --secret codex
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

`vpnctl tray install` adds a per-user LaunchAgent (`com.vpnctl.tray`) that shows a
menu-bar icon reflecting live state — green (tunnel up), red (tunnel down, traffic
blocked fail-closed), or gray (monitor daemon not running / state stale). It reads a
world-readable `state.json` the monitor daemon writes each tick; no `sudo` needed.

The menu-bar helper is an x86_64 binary, so on Apple Silicon it runs under Rosetta 2
(`softwareupdate --install-rosetta`); `vpnctl tray install` warns if it's missing.

## Development

Requires [Bun](https://bun.sh) >= 1.3.13.

```sh
bun install
bun run bin/vpnctl.ts --help
```

See [AGENTS.md](AGENTS.md) for code style, testing conventions, and quality gates, and
[CONTRIBUTING.md](CONTRIBUTING.md) for the git workflow and CI/CD pipeline.

Planned and in-progress work is tracked in
[GitHub Issues](https://github.com/SoundAsleep192/vpnctl/issues), grouped by
[milestone](https://github.com/SoundAsleep192/vpnctl/milestones).

## License

[MIT](LICENSE)
