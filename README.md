# vpnctl

[![CI](https://github.com/SoundAsleep192/vpnctl/actions/workflows/ci.yml/badge.svg)](https://github.com/SoundAsleep192/vpnctl/actions/workflows/ci.yml)

Fail-closed macOS VPN killswitch (pf firewall + DNS sinkhole + sing-box VLESS/Reality
tunnel) for AI dev tools. CLI only, no GUI, macOS only.

When the tunnel is down or DNS resolution fails, traffic to the configured domains is
blocked by default — not allowed through.

## Requirements

- macOS
- [Bun](https://bun.sh) >= 1.3.13
- [sing-box](https://sing-box.sagernet.org/)

## Install

```sh
bun install
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
vpnctl exec -- <command>   # preflight (tunnel up, optional country block) then run <command>
vpnctl domains list|add|remove <domain>  # manage the domain allowlist
vpnctl logs [--monitor] [--tunnel] [-f] [-n <count>]  # tail monitor/tunnel logs
vpnctl doctor              # diagnose bun, config, sing-box, pf, and daemons (requires root)
vpnctl audit [--watch <s>] [--log] [--install-agent] [--uninstall-agent]  # snapshot AI dev tool connections
```

## Development

See [AGENTS.md](AGENTS.md) for code style, testing conventions, and quality gates, and
[CONTRIBUTING.md](CONTRIBUTING.md) for the git workflow and CI/CD pipeline.

Planned and in-progress work is tracked in
[GitHub Issues](https://github.com/SoundAsleep192/vpnctl/issues), grouped by
[milestone](https://github.com/SoundAsleep192/vpnctl/milestones).

## License

MIT
