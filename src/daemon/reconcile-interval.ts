import type { DesiredTunnel } from "../core/desired-tunnel";
import type { TunnelState } from "../core/network";

const STEADY_RECONCILE_INTERVAL_MS = 5_000;
const STARTING_RECONCILE_INTERVAL_MS = 1_000;

export function resolveReconcileIntervalMs(desiredTunnel: DesiredTunnel | null, tunnelState: TunnelState | null): number {
  if (desiredTunnel === "up" && tunnelState?.tunnelUp !== true) return STARTING_RECONCILE_INTERVAL_MS;
  return STEADY_RECONCILE_INTERVAL_MS;
}
