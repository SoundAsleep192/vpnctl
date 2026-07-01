#!/usr/bin/env bun
import { Command } from "commander";
import path from "node:path";
import pkg from "../package.json";
import { runAudit } from "../src/cli/commands/audit";
import { runCheck } from "../src/cli/commands/check";
import { runDoctor } from "../src/cli/commands/doctor";
import { runDomainsAdd, runDomainsList, runDomainsRemove } from "../src/cli/commands/domains";
import { runDown } from "../src/cli/commands/down";
import { runExec } from "../src/cli/commands/exec";
import { runInstall } from "../src/cli/commands/install";
import { runLogs } from "../src/cli/commands/logs";
import { runRefresh } from "../src/cli/commands/refresh";
import {
  parseSandboxPreset,
  runSandboxClean,
  runSandboxCode,
  runSandboxDoctor,
  runSandboxLogs,
  runSandboxRun,
  runSandboxShell,
  runSandboxStatus,
  runSandboxStop,
} from "../src/core/sandbox";
import { runSetup } from "../src/cli/commands/setup";
import { runStatus } from "../src/cli/commands/status";
import { runTrayInstall, runTrayUninstall } from "../src/cli/commands/tray";
import { runTui } from "../src/cli/commands/tui";
import { runUninstall } from "../src/cli/commands/uninstall";
import { runUp } from "../src/cli/commands/up";
import { runUpdate } from "../src/cli/commands/update";
import { runWrapAdd, runWrapList, runWrapRemove } from "../src/cli/commands/wrap";
import { runYield } from "../src/cli/commands/yield";
import { loadConfig } from "../src/core/config";
import { runMonitorDaemon } from "../src/daemon/monitor";
import { runTrayDaemon } from "../src/daemon/tray";
import { runTunnelDaemon } from "../src/daemon/tunnel";

const program = new Command();
const daemonEntrypoints: Record<string, () => Promise<void>> = {
  "vpnctl-monitor": () => runMonitorDaemon(),
  "vpnctl-tunnel": () => runTunnelDaemon(),
  "vpnctl-tray": () => runTrayDaemon(),
};

async function runDaemonEntrypoint(): Promise<boolean> {
  for (const executablePath of [process.execPath, process.argv[0] ?? ""]) {
    const daemonEntrypoint = daemonEntrypoints[path.basename(executablePath)];
    if (daemonEntrypoint === undefined) continue;
    await daemonEntrypoint();
    return true;
  }
  return false;
}

program.name("vpnctl").description(pkg.description).version(pkg.version);

program
  .command("setup")
  .description("interactively configure vpnctl (VLESS+Reality URI, domains, TUN interface, DNS servers)")
  .option("--uri <uri>", "VLESS+Reality URI (skips the interactive prompt)")
  .option("--routing-mode <mode>", "routing mode: full or split")
  .action(async (opts: { uri?: string; routingMode?: string }) => {
    await runSetup({ uri: opts.uri, routingMode: opts.routingMode });
  });

program
  .command("install")
  .description("install the pf anchor, /etc/pf.conf patch, and LaunchDaemons (requires root)")
  .option("--routing-mode <mode>", "persist routing mode before installing: full or split")
  .action(async (opts: { routingMode?: string }) => {
    await runInstall({ routingMode: opts.routingMode });
  });

program
  .command("uninstall")
  .description("remove the LaunchDaemons, pf anchor, /etc/pf.conf patch, and /etc/hosts sinkhole (requires root)")
  .option("--purge", "also remove cached state under /Library/Application Support/vpnctl")
  .action(async (opts: { purge?: boolean }) => {
    await runUninstall({ purge: opts.purge });
  });

program
  .command("up")
  .description("start (or restart) the tunnel daemon (requires root)")
  .action(async () => {
    await runUp();
  });

program
  .command("down")
  .description("stop the tunnel daemon (requires root)")
  .action(async () => {
    await runDown();
  });

program
  .command("yield")
  .description("suspend the pf killswitch while keeping the tunnel running — for coexisting with a corporate VPN (requires root)")
  .action(async () => {
    await runYield();
  });

program
  .command("exec")
  .description("preflight (tunnel up, optional country block), resolve exit profile, inject TZ, then run the given command")
  .option("--allow-unknown-profile", "debug escape hatch: run with TZ=UTC when the exit profile cannot be resolved")
  .argument("[command...]", "command (and args) to run after a successful preflight, e.g. -- claude")
  .action(async (command: string[], opts: { allowUnknownProfile?: boolean }) => {
    await runExec(command, { allowUnknownProfile: opts.allowUnknownProfile });
  });

program
  .command("check")
  .description("probe protected domains over the tunnel (requires root, tunnel must be up)")
  .option("--full", "probe every domain in config.domains instead of the quick curated list")
  .action(async (opts: { full?: boolean }) => {
    await runCheck({ full: opts.full });
  });

program
  .command("refresh")
  .description("one-shot: resolve domains, write pf tables, and recompute sinkhole/anchor state (requires root)")
  .action(async () => {
    await runRefresh();
  });

program
  .command("status")
  .description("show pf, tunnel, daemon, and sinkhole state (requires root)")
  .option("--ip", "also resolve the current public IP")
  .action(async (opts: { ip?: boolean }) => {
    await runStatus({ ip: opts.ip });
  });

program
  .command("tui")
  .alias("ui")
  .description("open the interactive dashboard")
  .action(async () => {
    await runTui();
  });

const domainsCommand = program.command("domains").description("manage the domain allowlist routed through the tunnel");

domainsCommand
  .command("list")
  .description("list configured domains")
  .action(async () => {
    await runDomainsList();
  });

domainsCommand
  .command("add")
  .description("add a domain to the allowlist and regenerate sing-box.json")
  .argument("<domain>", "domain to add, e.g. claude.ai")
  .action(async (domain: string) => {
    await runDomainsAdd(domain);
  });

domainsCommand
  .command("remove")
  .description("remove a domain from the allowlist and regenerate sing-box.json")
  .argument("<domain>", "domain to remove")
  .action(async (domain: string) => {
    await runDomainsRemove(domain);
  });

program
  .command("logs")
  .description("tail the monitor and/or tunnel logs")
  .option("--monitor", "show only the monitor log")
  .option("--tunnel", "show only the tunnel log")
  .option("-f, --follow", "follow log output, like tail -f")
  .option("-n, --lines <count>", "number of lines to show", (value) => Number(value))
  .action(async (opts: { monitor?: boolean; tunnel?: boolean; follow?: boolean; lines?: number }) => {
    await runLogs(opts);
  });

program
  .command("update")
  .description("check for a newer release and install it, redeploying LaunchDaemons (requires root)")
  .action(async () => {
    await runUpdate();
  });

program
  .command("doctor")
  .description("run diagnostics on bun, config, sing-box binary, pf, and daemons (requires root)")
  .action(async () => {
    await runDoctor();
  });

const wrapCommand = program.command("wrap").description("manage shell wrappers that route commands through `vpnctl exec`");

wrapCommand
  .command("add")
  .description("generate a shell wrapper for each command in ~/.local/bin (or --dir)")
  .argument("<command...>", "one or more command names to wrap, e.g. claude codex")
  .option("--dir <path>", "directory to write wrappers into (default: ~/.local/bin)")
  .action(async (commands: string[], opts: { dir?: string }) => {
    await runWrapAdd(commands, { dir: opts.dir });
  });

wrapCommand
  .command("remove")
  .description("remove vpnctl-managed shell wrappers")
  .argument("<command...>", "one or more wrapper names to remove")
  .option("--dir <path>", "directory containing the wrappers (default: ~/.local/bin)")
  .action(async (commands: string[], opts: { dir?: string }) => {
    await runWrapRemove(commands, { dir: opts.dir });
  });

wrapCommand
  .command("list")
  .description("list vpnctl-managed shell wrappers")
  .option("--dir <path>", "directory to scan (default: ~/.local/bin)")
  .action(async (opts: { dir?: string }) => {
    await runWrapList({ dir: opts.dir });
  });

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const sandboxCommand = program.command("sandbox").description("run agents inside a Docker VPN sandbox");

sandboxCommand
  .command("run")
  .description("run a command or preset in the protected Docker runtime")
  .option("--preset <preset>", "preset to run: claude or codex")
  .requiredOption("--workspace <path>", "workspace directory to mount deliberately")
  .option("--secret <name>", "explicit named credential mount: claude or codex", collectOption, [])
  .option("--mount-secret <spec>", "explicit secret mount: source:target[:ro|rw]", collectOption, [])
  .option("--keep", "keep sandbox containers after the command exits")
  .option("--allow-unknown-profile", "debug escape hatch: run with TZ=UTC when the sandbox exit profile cannot be resolved")
  .argument("[command...]", "command (and args) to run after --")
  .action(
    async (
      command: string[],
      opts: {
        preset?: string;
        workspace: string;
        secret: string[];
        mountSecret: string[];
        keep?: boolean;
        allowUnknownProfile?: boolean;
      },
    ) => {
      const exitCode = await runSandboxRun({
        config: await loadConfig(),
        workspace: opts.workspace,
        command,
        preset: parseSandboxPreset(opts.preset),
        secrets: opts.secret,
        mountSecrets: opts.mountSecret,
        keep: opts.keep,
        allowUnknownProfile: opts.allowUnknownProfile,
      });
      process.exit(exitCode);
    },
  );

sandboxCommand
  .command("code")
  .description("open VS Code with its remote backend inside the protected Docker runtime")
  .option("--preset <preset>", "preset to configure: claude or codex", "claude")
  .requiredOption("--workspace <path>", "workspace directory to mount deliberately")
  .option("--secret <name>", "explicit named credential mount: claude or codex", collectOption, [])
  .option("--mount-secret <spec>", "explicit secret mount: source:target[:ro|rw]", collectOption, [])
  .option("--allow-unknown-profile", "debug escape hatch: run with TZ=UTC when the sandbox exit profile cannot be resolved")
  .action(async (opts: { preset?: string; workspace: string; secret: string[]; mountSecret: string[]; allowUnknownProfile?: boolean }) => {
    const exitCode = await runSandboxCode({
      config: await loadConfig(),
      workspace: opts.workspace,
      preset: parseSandboxPreset(opts.preset),
      secrets: opts.secret,
      mountSecrets: opts.mountSecret,
      allowUnknownProfile: opts.allowUnknownProfile,
    });
    process.exit(exitCode);
  });

sandboxCommand
  .command("status")
  .description("show sandbox containers, exit profile, killswitch, and mounts")
  .action(async () => {
    await runSandboxStatus();
  });

sandboxCommand
  .command("logs")
  .description("show sandbox VPN and/or agent logs")
  .option("--vpn", "show only VPN sidecar logs")
  .option("--agent", "show only agent container logs")
  .option("-f, --follow", "follow log output")
  .option("-n, --lines <count>", "number of lines to show", (value) => Number(value))
  .action(async (opts: { vpn?: boolean; agent?: boolean; follow?: boolean; lines?: number }) => {
    await runSandboxLogs(opts);
  });

sandboxCommand
  .command("shell")
  .description("open a shell in the protected Docker runtime")
  .action(async () => {
    const exitCode = await runSandboxShell();
    process.exit(exitCode);
  });

sandboxCommand
  .command("stop")
  .description("stop sandbox containers")
  .action(async () => {
    await runSandboxStop();
  });

sandboxCommand
  .command("clean")
  .description("stop sandbox containers and remove sandbox images/assets")
  .action(async () => {
    await runSandboxClean();
  });

sandboxCommand
  .command("doctor")
  .description("diagnose Docker sandbox prerequisites and cached assets")
  .action(async () => {
    await runSandboxDoctor();
  });

const trayCommand = program.command("tray").description("manage the menu-bar status indicator (per-user LaunchAgent)");

trayCommand
  .command("install")
  .description("install the menu-bar status indicator LaunchAgent")
  .action(async () => {
    await runTrayInstall();
  });

trayCommand
  .command("uninstall")
  .description("remove the menu-bar status indicator LaunchAgent")
  .action(async () => {
    await runTrayUninstall();
  });

program
  .command("audit")
  .description("snapshot configured process connections")
  .option("--watch <seconds>", "repeat the snapshot every <seconds> seconds", (value) => Number(value))
  .option("--log", "append the snapshot to the audit log instead of printing it")
  .option("--install-agent", "install a per-user LaunchAgent that runs `vpnctl audit --log` periodically")
  .option("--uninstall-agent", "remove the audit LaunchAgent")
  .action(async (opts: { watch?: number; log?: boolean; installAgent?: boolean; uninstallAgent?: boolean }) => {
    await runAudit({ watchSec: opts.watch, log: opts.log, installAgent: opts.installAgent, uninstallAgent: opts.uninstallAgent });
  });

if (!(await runDaemonEntrypoint())) {
  try {
    if (process.argv.slice(2).length === 0) {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        await runTui();
      } else {
        program.outputHelp();
      }
    } else {
      await program.parseAsync();
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
