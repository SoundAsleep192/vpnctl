import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
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

const SING_BOX_CANDIDATE_PATHS = ["/opt/homebrew/bin/sing-box", "/usr/local/bin/sing-box"];

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

export async function resolveDaemonBinaryPath(
  binaryName: string,
  exists: (filePath: string) => Promise<boolean> = (filePath) => Bun.file(filePath).exists(),
): Promise<string> {
  const candidate = path.join(path.dirname(process.execPath), binaryName);
  if (await exists(candidate)) return candidate;
  throw new Error(
    `${binaryName} not found next to ${process.execPath} — reinstall vpnctl (e.g. \`brew reinstall vpnctl\`) so the daemon binaries are present alongside it`,
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
}

export async function runInstall(options: InstallOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const config = await loadConfig();

  const singboxConfig = buildSingBoxConfig({
    outbound: config.outbound,
    domains: config.domains,
    tun: config.tunnel,
    dnsServer: config.dns.servers[0],
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

  console.log("Install complete. Run `sudo vpnctl status` to check state.");
}
