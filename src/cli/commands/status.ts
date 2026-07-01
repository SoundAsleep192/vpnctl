import pkg from "../../../package.json";
import { loadConfig, type RoutingMode } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { formatKillswitchNotice } from "../../core/killswitch-notice";
import { isLoaded } from "../../core/launchd";
import { getTunnelState, isSingBoxRunning, resolvePublicIp } from "../../core/network";
import {
  GENERATED_SINGBOX_CONFIG,
  HOSTS_FILE,
  HOSTS_MARKER_BEGIN,
  LAUNCHD_LABEL_MONITOR,
  LAUNCHD_LABEL_TUNNEL,
  PF_ANCHOR_NAME,
  PF_TABLE_V4,
  PF_TABLE_V6,
  TUNNEL_PID_FILE,
  UPDATE_CHECK_CACHE_FILE,
} from "../../core/paths";
import { readSingBoxConfig } from "../../core/singbox-config";
import { type DnsConflict, type OtherVpnInterface, detectVpnConflicts } from "../../core/vpn-conflicts";
import { requireRoot } from "../root";
import { checkUpdateAvailable } from "./update";

export interface StatusResult {
  pfEnabled: boolean;
  anchorLoaded: boolean;
  tableV4Count: number;
  tableV6Count: number;
  trustedInterface: string | null;
  publicInterface: string | null;
  tunnelUp: boolean;
  singBoxRunning: boolean;
  monitorDaemonLoaded: boolean;
  tunnelDaemonLoaded: boolean;
  sinkholeActive: boolean;
  publicIp: string | null;
  routingMode: RoutingMode | null;
  updateAvailable: string | null;
  otherVpnInterfaces: OtherVpnInterface[];
  vpnRoutingConflict: string | null;
  vpnDnsConflicts: DnsConflict[];
}

async function isPfEnabled(exec: Exec): Promise<boolean> {
  const result = await exec("/sbin/pfctl", ["-s", "info"]);
  return /^Status:\s*Enabled/m.test(result.stdout);
}

async function isAnchorLoaded(exec: Exec): Promise<boolean> {
  const result = await exec("/sbin/pfctl", ["-a", PF_ANCHOR_NAME, "-s", "rules"]);
  return result.exitCode === 0 && result.stdout.trim() !== "";
}

async function countTable(exec: Exec, table: string): Promise<number> {
  const result = await exec("/sbin/pfctl", ["-a", PF_ANCHOR_NAME, "-t", table, "-T", "show"]);
  if (result.exitCode !== 0) return 0;
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "").length;
}

function routingModeFromSingBoxConfig(singboxConfig: unknown): RoutingMode | null {
  if (typeof singboxConfig !== "object" || singboxConfig === null) return null;
  if (!("route" in singboxConfig)) return null;
  const route = singboxConfig.route;
  if (typeof route !== "object" || route === null) return null;
  if (!("final" in route)) return null;
  const finalOutbound = route.final;
  if (finalOutbound === "proxy") return "full";
  if (finalOutbound === "direct") return "split";
  return null;
}

export async function gatherStatus(
  exec: Exec,
  singboxConfig: unknown,
  hostsContent: string,
  includeIp = false,
  pidFile: string = TUNNEL_PID_FILE,
  updateCheckCachePath: string = UPDATE_CHECK_CACHE_FILE,
): Promise<StatusResult> {
  const { trustedIface: trustedInterface, publicIface: publicInterface, tunnelUp } = await getTunnelState(exec, singboxConfig, pidFile);

  const vpnConflicts = await detectVpnConflicts(exec, trustedInterface);

  return {
    pfEnabled: await isPfEnabled(exec),
    anchorLoaded: await isAnchorLoaded(exec),
    tableV4Count: await countTable(exec, PF_TABLE_V4),
    tableV6Count: await countTable(exec, PF_TABLE_V6),
    trustedInterface,
    publicInterface,
    tunnelUp,
    singBoxRunning: await isSingBoxRunning(exec, pidFile),
    monitorDaemonLoaded: await isLoaded(exec, LAUNCHD_LABEL_MONITOR, "system"),
    tunnelDaemonLoaded: await isLoaded(exec, LAUNCHD_LABEL_TUNNEL, "system"),
    sinkholeActive: hostsContent.includes(HOSTS_MARKER_BEGIN),
    publicIp: includeIp ? await resolvePublicIp(exec) : null,
    routingMode: routingModeFromSingBoxConfig(singboxConfig),
    updateAvailable: await checkUpdateAvailable(exec, pkg.version, updateCheckCachePath),
    otherVpnInterfaces: vpnConflicts.otherInterfaces,
    vpnRoutingConflict: vpnConflicts.routingConflict,
    vpnDnsConflicts: vpnConflicts.dnsConflicts,
  };
}

function onOff(value: boolean, on: string, off: string): string {
  return value ? on : off;
}

export function formatStatus(status: StatusResult): string {
  const lines = [
    "=== pf ===",
    `pf: ${onOff(status.pfEnabled, "enabled", "disabled")}`,
    `anchor "${PF_ANCHOR_NAME}": ${onOff(status.anchorLoaded, "loaded", "not loaded")}`,
    `table <${PF_TABLE_V4}>: ${status.tableV4Count} entries`,
    `table <${PF_TABLE_V6}>: ${status.tableV6Count} entries`,
    "",
    "=== tunnel ===",
    `routing mode: ${status.routingMode ?? "unknown"}`,
    `trusted interface: ${status.trustedInterface ?? "none"}`,
    `public interface: ${status.publicInterface ?? "none"}`,
    `tunnel: ${onOff(status.tunnelUp, "up", "down")}`,
    `sing-box: ${onOff(status.singBoxRunning, "running", "not running")}`,
    "",
    "=== daemons ===",
    `${LAUNCHD_LABEL_MONITOR}: ${onOff(status.monitorDaemonLoaded, "loaded", "not loaded")}`,
    `${LAUNCHD_LABEL_TUNNEL}: ${onOff(status.tunnelDaemonLoaded, "loaded", "not loaded")}`,
    "",
    "=== sinkhole ===",
    `/etc/hosts: ${onOff(status.sinkholeActive, "active", "inactive")}`,
  ];

  if (status.otherVpnInterfaces.length > 0) {
    lines.push("", "=== other VPN interfaces ===");
    for (const iface of status.otherVpnInterfaces) {
      lines.push(`${iface.name}: ${iface.inet}`);
    }
    if (status.vpnRoutingConflict !== null) {
      lines.push(`WARNING: default route is through ${status.vpnRoutingConflict} — protected traffic may not be routed as expected`);
    }
    for (const dns of status.vpnDnsConflicts) {
      lines.push(
        `WARNING: ${dns.iface} is pushing DNS servers: ${dns.servers.join(", ")} — apps may resolve protected domain IPs not covered by vpnctl's pf tables`,
      );
    }
  }

  if (status.publicIp !== null) {
    lines.push("", "=== public ip ===", status.publicIp);
    if (status.routingMode === "split") {
      lines.push("split mode: generic IP-check sites use the direct route; protected domain probes are checked by `vpnctl check`.");
    }
  }

  if (status.updateAvailable !== null) {
    lines.push("", `update available: v${status.updateAvailable} — run \`vpnctl update\``);
  }

  return lines.join("\n");
}

export interface StatusOptions {
  exec?: Exec;
  ip?: boolean;
}

export async function runStatus(options: StatusOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const singboxConfig = await readSingBoxConfig(GENERATED_SINGBOX_CONFIG);
  const hostsContent = await Bun.file(HOSTS_FILE).text();

  const status = await gatherStatus(exec, singboxConfig, hostsContent, options.ip);
  console.log(formatStatus(status));

  const domains = await loadConfig()
    .then((config) => config.domains)
    .catch(() => []);
  const notice = formatKillswitchNotice(domains, status.tunnelUp);
  if (notice !== null) console.log(`\n${notice}`);
}
