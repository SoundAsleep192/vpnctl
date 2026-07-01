import pkg from "../../../package.json";
import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { getTunnelState, isSingBoxRunning } from "../../core/network";
import {
  GENERATED_SINGBOX_CONFIG,
  HOSTS_FILE,
  HOSTS_MARKER_BEGIN,
  STATE_FILE,
  TUNNEL_PID_FILE,
  UPDATE_CHECK_CACHE_FILE,
} from "../../core/paths";
import { readSingBoxConfig } from "../../core/singbox-config";
import { classifyState, parseStateFile, type VpnState } from "../../core/state-file";
import { checkUpdateAvailable } from "../commands/update";
import { formatAiDomainsState, formatLeakGuard, formatTrafficScope, formatTunnelLabel } from "./format";
import type { TuiSnapshot } from "./types";
import { detectVpnConflicts, type VpnConflicts } from "../../core/vpn-conflicts";

export interface BuildTuiSnapshotOptions {
  checkUpdate?: boolean;
  updateAvailable?: string | null;
}

export async function buildTuiSnapshot(exec: Exec = realExec, options: BuildTuiSnapshotOptions = {}): Promise<TuiSnapshot> {
  const config = await loadConfig().catch(() => null);
  const nowMs = Date.now();
  const state = await readCurrentVpnState(exec, nowMs);
  const trayStatus = classifyState(state, nowMs);
  const workspaceStatus = await getWorkspaceStatus(exec);
  const updateAvailable =
    options.checkUpdate === false
      ? (options.updateAvailable ?? null)
      : await checkUpdateAvailable(exec, pkg.version, UPDATE_CHECK_CACHE_FILE).catch(() => null);
  const vpnConflicts = await getVpnConflicts(exec, state?.trustedIface ?? config?.tunnel.interfaceName ?? null);
  const otherVpn = formatOtherVpnLabel(vpnConflicts);

  return {
    aiDomains: formatAiDomainsState(config !== null, trayStatus),
    trafficScope: formatTrafficScope(config?.routing.mode ?? null),
    workspaces: workspaceStatus.label,
    workspaceCount: workspaceStatus.count,
    updateAvailable,
    domainCount: config?.domains.length ?? null,
    dnsCount: config?.dns.servers.length ?? null,
    tunnel: formatTunnelLabel(trayStatus),
    tunnelStarting: trayStatus === "starting",
    leakGuard: formatLeakGuard(state, trayStatus),
    otherVpn,
    otherVpnInterfaces: vpnConflicts?.otherInterfaces ?? null,
    vpnDnsConflicts: vpnConflicts?.dnsConflicts ?? null,
    vpnRoutingConflict: vpnConflicts?.routingConflict ?? null,
    config,
  };
}

async function readCurrentVpnState(exec: Exec, nowMs: number): Promise<VpnState | null> {
  const state = await readVpnState();
  if (classifyState(state, nowMs) === "protected") return state;
  return (await readLiveVpnState(exec)) ?? state;
}

async function readVpnState(): Promise<VpnState | null> {
  const text = await Bun.file(STATE_FILE)
    .text()
    .catch(() => null);
  return text === null ? null : parseStateFile(text);
}

async function readLiveVpnState(exec: Exec): Promise<VpnState | null> {
  const singboxConfig = await readSingBoxConfig(GENERATED_SINGBOX_CONFIG).catch(() => null);
  if (singboxConfig === null) return null;

  const [tunnelState, singBoxRunning] = await Promise.all([
    getTunnelState(exec, singboxConfig, TUNNEL_PID_FILE).catch(() => null),
    isSingBoxRunning(exec, TUNNEL_PID_FILE).catch(() => false),
  ]);
  if (tunnelState === null) return null;

  const hostsContent = await Bun.file(HOSTS_FILE)
    .text()
    .catch(() => null);
  if (hostsContent === null) return null;

  return {
    tunnelUp: tunnelState.tunnelUp,
    trustedIface: tunnelState.trustedIface,
    sinkholeActive: hostsContent.includes(HOSTS_MARKER_BEGIN),
    tunnelStarting: !tunnelState.tunnelUp && singBoxRunning,
    timestamp: Date.now(),
  };
}

async function getWorkspaceStatus(exec: Exec): Promise<{ count: number | null; label: string }> {
  const result = await exec("docker", ["ps", "--filter", "name=vpnctl-sandbox", "--format", "{{.Names}}"]).catch(() => null);
  if (result === null) return { count: null, label: "unknown" };
  const count = result?.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  if (count === undefined || count === 0) return { count: 0, label: "none" };
  return { count, label: `${count} active` };
}

async function getVpnConflicts(exec: Exec, ownInterfaceName: string | null): Promise<VpnConflicts | null> {
  return detectVpnConflicts(exec, ownInterfaceName).catch(() => null);
}

function formatOtherVpnLabel(conflicts: VpnConflicts | null): string {
  if (conflicts === null) return "unknown";
  if (conflicts.routingConflict !== null && conflicts.dnsConflicts.length > 0) return "route + DNS conflict";
  if (conflicts.routingConflict !== null) return `route via ${conflicts.routingConflict}`;
  if (conflicts.dnsConflicts.length > 0) return "DNS conflict";
  return "none";
}
