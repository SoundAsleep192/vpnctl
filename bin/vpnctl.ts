#!/usr/bin/env bun
import { Command } from "commander";
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
import { runSetup } from "../src/cli/commands/setup";
import { runStatus } from "../src/cli/commands/status";
import { runUninstall } from "../src/cli/commands/uninstall";
import { runUp } from "../src/cli/commands/up";

const program = new Command();

program.name("vpnctl").description(pkg.description).version(pkg.version);

program
  .command("setup")
  .description("interactively configure vpnctl (VLESS+Reality URI, domains, TUN interface, DNS servers)")
  .option("--uri <uri>", "VLESS+Reality URI (skips the interactive prompt)")
  .action(async (opts: { uri?: string }) => {
    await runSetup({ uri: opts.uri });
  });

program
  .command("install")
  .description("install the pf anchor, /etc/pf.conf patch, and LaunchDaemons (requires root)")
  .action(async () => {
    await runInstall();
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
  .command("exec")
  .description("preflight (tunnel up, optional country block) then run the given command")
  .argument("[command...]", "command (and args) to run after a successful preflight, e.g. -- claude")
  .action(async (command: string[]) => {
    await runExec(command);
  });

program
  .command("check")
  .description("probe AI dev tool endpoints over the tunnel (requires root, tunnel must be up)")
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
  .command("doctor")
  .description("run diagnostics on bun, config, sing-box binary, pf, and daemons (requires root)")
  .action(async () => {
    await runDoctor();
  });

program
  .command("audit")
  .description("snapshot AI dev tool process connections")
  .option("--watch <seconds>", "repeat the snapshot every <seconds> seconds", (value) => Number(value))
  .option("--log", "append the snapshot to the audit log instead of printing it")
  .option("--install-agent", "install a per-user LaunchAgent that runs `vpnctl audit --log` periodically")
  .option("--uninstall-agent", "remove the audit LaunchAgent")
  .action(async (opts: { watch?: number; log?: boolean; installAgent?: boolean; uninstallAgent?: boolean }) => {
    await runAudit({ watchSec: opts.watch, log: opts.log, installAgent: opts.installAgent, uninstallAgent: opts.uninstallAgent });
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
