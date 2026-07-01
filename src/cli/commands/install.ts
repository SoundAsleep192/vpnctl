import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveDaemonBinaryPath } from "../daemon-binary";
import { loadConfig, parseRoutingMode, saveConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { notificationUser, sendDesktopNotification } from "../../core/notifications";
import { installDaemon, renderPlist, type PlistOptions } from "../../core/launchd";
import {
  CONFIG_FILE,
  GENERATED_SINGBOX_CONFIG,
  LAUNCHD_LABEL_MONITOR,
  LAUNCHD_LABEL_TUNNEL,
  LAUNCHD_PLIST_MONITOR,
  LAUNCHD_PLIST_TUNNEL,
  LOG_DIR,
  MONITOR_LOG_FILE,
  PF_CONF_FILE,
  ROOT_CACHE_DIR,
  TUNNEL_LOG_FILE,
} from "../../core/paths";
import { generateAnchorRules, writeAnchor } from "../../core/pf-anchor";
import { applyPfConfPatch } from "../../core/pf-conf-patch";
import { isCompiledBinary } from "../../core/runtime";
import { buildSingBoxConfig, writeSingBoxConfig } from "../../core/singbox-config";
import { requireRoot } from "../root";
import { runTrayInstall } from "./tray";

const SING_BOX_CANDIDATE_PATHS = ["/opt/homebrew/bin/sing-box", "/usr/local/bin/sing-box"];
const SUDO_BIN = "/usr/bin/sudo";

export async function resolveSingBoxPath(
  exists: (filePath: string) => Promise<boolean> = (filePath) => Bun.file(filePath).exists(),
): Promise<string> {
  for (const candidate of SING_BOX_CANDIDATE_PATHS) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(
    `sing-box binary not found (looked in ${SING_BOX_CANDIDATE_PATHS.join(", ")}) — install it first, e.g. \`brew install sing-box\``,
  );
}

export function buildMonitorPlist(invocation: string[], configPath: string): PlistOptions {
  return {
    label: LAUNCHD_LABEL_MONITOR,
    programArguments: [...invocation, "--config", configPath],
    runAtLoad: true,
    keepAlive: true,
    throttleIntervalSec: 5,
    stdoutPath: MONITOR_LOG_FILE,
    stderrPath: MONITOR_LOG_FILE,
  };
}

export function buildTunnelPlist(invocation: string[], singBoxPath: string, singboxConfigPath: string): PlistOptions {
  return {
    label: LAUNCHD_LABEL_TUNNEL,
    programArguments: [...invocation, "--sing-box", singBoxPath, "--config", singboxConfigPath],
    runAtLoad: true,
    keepAlive: true,
    throttleIntervalSec: 5,
    stdoutPath: TUNNEL_LOG_FILE,
    stderrPath: TUNNEL_LOG_FILE,
  };
}

export interface InstallOptions {
  exec?: Exec;
  routingMode?: string;
}

export async function runInstall(options: InstallOptions = {}): Promise<void> {
  const routingMode = options.routingMode === undefined ? undefined : parseRoutingMode(options.routingMode);

  requireRoot();

  const exec = options.exec ?? realExec;
  const loadedConfig = await loadConfig();
  const config = routingMode === undefined ? loadedConfig : { ...loadedConfig, routing: { mode: routingMode } };

  if (routingMode !== undefined) {
    await saveConfig(config);
  }

  const singboxConfig = buildSingBoxConfig({
    outbound: config.outbound,
    domains: config.domains,
    tun: config.tunnel,
    dnsServer: config.dns.servers[0],
    routingMode: config.routing.mode,
  });
  await writeSingBoxConfig(singboxConfig, GENERATED_SINGBOX_CONFIG);

  const monitorInvocation = isCompiledBinary()
    ? [await resolveDaemonBinaryPath("vpnctl-monitor")]
    : [process.execPath, "run", path.resolve(import.meta.dir, "../../daemon/monitor.ts")];
  const tunnelInvocation = isCompiledBinary()
    ? [await resolveDaemonBinaryPath("vpnctl-tunnel")]
    : [process.execPath, "run", path.resolve(import.meta.dir, "../../daemon/tunnel.ts")];
  const singBoxPath = await resolveSingBoxPath();

  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(ROOT_CACHE_DIR, { recursive: true });

  console.log("Writing pf anchor...");
  await writeAnchor(exec, generateAnchorRules({ trustedIface: null }));

  console.log(`Patching ${PF_CONF_FILE}...`);
  await applyPfConfPatch(exec);

  console.log("Enabling pf...");
  const enable = await exec("/sbin/pfctl", ["-E", "-f", PF_CONF_FILE]);
  if (enable.exitCode !== 0) {
    throw new Error(`failed to enable pf: ${enable.stderr.trim()}`);
  }

  console.log("Installing monitor daemon...");
  await installDaemon(
    exec,
    LAUNCHD_LABEL_MONITOR,
    LAUNCHD_PLIST_MONITOR,
    renderPlist(buildMonitorPlist(monitorInvocation, CONFIG_FILE)),
    "system",
  );

  console.log("Installing tunnel daemon...");
  await installDaemon(
    exec,
    LAUNCHD_LABEL_TUNNEL,
    LAUNCHD_PLIST_TUNNEL,
    renderPlist(buildTunnelPlist(tunnelInvocation, singBoxPath, GENERATED_SINGBOX_CONFIG)),
    "system",
  );

  console.log("Installing menu-bar icon...");
  await installTrayForLoginUser(exec);

  await sendDesktopNotification(
    exec,
    { title: "vpnctl installed", body: "Menu-bar icon and protection daemons are installed." },
    { user: notificationUser() },
  );

  console.log("Install complete. Run `vpnctl` to check state.");
}

function buildSelfInvocation(args: string[]): string[] {
  if (isCompiledBinary()) return [process.execPath, ...args];
  return [process.execPath, process.argv[1] ?? "bin/vpnctl.ts", ...args];
}

async function installTrayForLoginUser(exec: Exec): Promise<void> {
  const sudoUser = Bun.env.SUDO_USER;
  if (process.getuid?.() === 0 && sudoUser !== undefined && sudoUser !== "root") {
    const result = await exec(SUDO_BIN, ["-u", sudoUser, ...buildSelfInvocation(["tray", "install"])]);
    if (result.stdout.length > 0) console.log(result.stdout.trimEnd());
    if (result.stderr.length > 0) console.error(result.stderr.trimEnd());
    if (result.exitCode !== 0) throw new Error(`failed to install menu-bar icon: ${result.stderr.trim() || result.stdout.trim()}`);
    return;
  }

  await runTrayInstall({ exec });
}
