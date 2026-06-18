import type { Config } from "./config";
import type { Exec } from "./exec";
import { getTunnelState, type TunnelState } from "./network";
import { GENERATED_SINGBOX_CONFIG, HOSTS_FILE, TUNNEL_PID_FILE, YIELD_MODE_FILE } from "./paths";
import { generateAnchorRules, writeAnchor } from "./pf-anchor";
import { applyHosts, computeHosts } from "./sinkhole";
import { readSingBoxConfig } from "./singbox-config";

export interface EnforcementPlan {
  hostsContent: string;
  hostsChanged: boolean;
  anchorRules: string;
}

export function planEnforcement(
  currentHosts: string,
  domains: string[],
  trustedIface: string | null,
  tunnelUp: boolean,
  yieldMode = false,
): EnforcementPlan {
  const { content, changed } = computeHosts(currentHosts, domains, !tunnelUp);
  return { hostsContent: content, hostsChanged: changed, anchorRules: generateAnchorRules({ trustedIface, yieldMode }) };
}

export async function applyTunnelState(
  exec: Exec,
  domains: string[],
  trustedIface: string | null,
  tunnelUp: boolean,
  yieldMode = false,
): Promise<void> {
  const currentHosts = await Bun.file(HOSTS_FILE).text();
  const plan = planEnforcement(currentHosts, domains, trustedIface, tunnelUp, yieldMode);

  if (plan.hostsChanged) await applyHosts(exec, plan.hostsContent);
  await writeAnchor(exec, plan.anchorRules);
}

export async function reconcileTunnelState(
  exec: Exec,
  config: Config,
  singboxConfigPath: string = GENERATED_SINGBOX_CONFIG,
): Promise<TunnelState> {
  const singboxConfig = await readSingBoxConfig(singboxConfigPath);
  const state = await getTunnelState(exec, singboxConfig, TUNNEL_PID_FILE);
  const yieldMode = await Bun.file(YIELD_MODE_FILE).exists();

  await applyTunnelState(exec, config.domains, state.trustedIface, state.tunnelUp, yieldMode);

  return state;
}

export async function pollUntil<T>(fn: () => Promise<T>, isDone: (value: T) => boolean, timeoutMs: number, intervalMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const value = await fn();
    if (isDone(value) || Date.now() >= deadline) return value;
    await Bun.sleep(intervalMs);
  }
}

// sing-box/VLESS handshake takes a few seconds after the tunnel daemon
// restarts — without this, `vpnctl up`/`down` would reconcile against the
// pre-transition tunnel state and the monitor's next tick would immediately
// fight that reconciliation once the real state catches up.
const TUNNEL_CONVERGENCE_TIMEOUT_MS = 10_000;
const TUNNEL_CONVERGENCE_POLL_INTERVAL_MS = 500;

export async function reconcileUntilTunnelState(exec: Exec, config: Config, desiredTunnelUp: boolean): Promise<TunnelState> {
  return pollUntil(
    () => reconcileTunnelState(exec, config),
    (state) => state.tunnelUp === desiredTunnelUp,
    TUNNEL_CONVERGENCE_TIMEOUT_MS,
    TUNNEL_CONVERGENCE_POLL_INTERVAL_MS,
  );
}
