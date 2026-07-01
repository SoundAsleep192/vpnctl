# Operations

## Quick status

```sh
vpnctl
sudo vpnctl status --ip
sudo vpnctl doctor
vpnctl logs --monitor -n 100
vpnctl logs --tunnel -n 100
```

The dashboard is user-facing. `status` and `doctor` are root-facing host diagnostics.

## Important files

| File                                  | What to inspect                                        |
| ------------------------------------- | ------------------------------------------------------ |
| `~/.config/vpnctl/config.json`        | User config and saved routing mode                     |
| `~/.config/vpnctl/sing-box.json`      | Generated sing-box runtime config                      |
| `~/.config/vpnctl/desired-tunnel`     | Last desired tunnel state from tray or CLI             |
| `~/.config/vpnctl/tray.log`           | Tray LaunchAgent output                                |
| `/Library/Logs/vpnctl/state.json`     | Monitor state consumed by tray and TUI                 |
| `/Library/Logs/vpnctl/monitor.log`    | Monitor reconcile log                                  |
| `/Library/Logs/vpnctl/tunnel.log`     | Tunnel daemon and sing-box log                         |
| `/Library/Application Support/vpnctl` | Root runtime cache, pid, and installed daemon binaries |

## Start and stop

```sh
sudo vpnctl up
sudo vpnctl down
```

`up` records desired state and starts or restarts the tunnel daemon. `down` records
desired state, stops the tunnel daemon, and leaves protected domains blocked.

## Refresh protection

```sh
sudo vpnctl refresh
```

Refresh resolves protected domains, writes pf tables, and recomputes pf plus
sinkhole state. Run it after domain edits when you need changes applied immediately.

## Reinstall local build

Run these scripts as your normal user. They build inside the repo and ask for
`sudo` only when installing protected system services.

```sh
./scripts/reinstall-local.sh
```

Use `VPNCTL_REINSTALL_SKIP_DAEMONS=1` when you only need binaries copied:

```sh
VPNCTL_REINSTALL_SKIP_DAEMONS=1 ./scripts/reinstall-local.sh
```

Then redeploy manually when ready:

```sh
sudo HOME="$HOME" "$(command -v vpnctl)" install
```

Keeping `HOME` explicit prevents root from looking under `/var/root/.config/vpnctl`.

For a one-command offline local check that builds, signs, smoke-tests, reinstalls,
and then prints manual tray/dashboard checks:

```sh
./scripts/offline-local-test.sh
```

The offline script refuses to run if cached dependencies are missing, instead of
fetching anything from the network. If an earlier sudo run left root-owned build
artifacts behind, remove them once with `sudo rm -rf dist/traybin`.

## Tray recovery

```sh
vpnctl tray uninstall
vpnctl tray install
launchctl print "gui/$(id -u)/com.vpnctl.tray"
tail -n 100 ~/.config/vpnctl/tray.log
```

If the tray is missing on Apple Silicon, check Rosetta:

```sh
arch -x86_64 /usr/bin/true
```

Install Rosetta if that fails:

```sh
softwareupdate --install-rosetta
```

## Host-vs-sandbox debugging

Use host commands for host protection:

```sh
sudo vpnctl status --ip
sudo vpnctl doctor
vpnctl logs --monitor -n 100
vpnctl logs --tunnel -n 100
```

Use sandbox commands for protected workspaces:

```sh
vpnctl sandbox status
vpnctl sandbox doctor
vpnctl sandbox logs --vpn -n 100
vpnctl sandbox logs --agent -n 100
```

Tray status does not prove sandbox status. Sandbox status does not prove host pf
status.

## VPN conflict checks

Doctor separates inventory from conflict:

- Other VPN interface: another VPN-like interface exists.
- Routing conflict: another VPN owns the default route.
- DNS conflict: another VPN owns DNS resolvers.

Inventory alone is not necessarily a problem. Route or DNS ownership is the part that
can change vpnctl behavior.

## Common recovery checks

Check launchd jobs:

```sh
sudo launchctl print system/com.vpnctl.monitor
sudo launchctl print system/com.vpnctl.tunnel
launchctl print "gui/$(id -u)/com.vpnctl.tray"
```

Check pf anchor:

```sh
sudo pfctl -a vpnctl -sr
sudo pfctl -t vpnctl_v4 -T show
sudo pfctl -t vpnctl_v6 -T show
```

Check generated config:

```sh
python3 -m json.tool ~/.config/vpnctl/config.json >/dev/null
python3 -m json.tool ~/.config/vpnctl/sing-box.json >/dev/null
```

Check sandbox containers:

```sh
docker ps --filter name=vpnctl
vpnctl sandbox status
```

## Uninstall

```sh
sudo vpnctl uninstall
```

To also remove root-owned runtime cache:

```sh
sudo vpnctl uninstall --purge
```

Uninstall removes LaunchDaemons, pf anchor, pf.conf patch, and hosts sinkhole. User
config under `~/.config/vpnctl` is preserved unless removed manually.
