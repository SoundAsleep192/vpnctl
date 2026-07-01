import type { RoutingMode } from "../../core/config";
import { type TrayStatus, type VpnState } from "../../core/state-file";
import type { AiDomainsState, StatusColor } from "./types";

export function formatTrafficScope(mode: RoutingMode | null): string {
  if (mode === "full") return "all traffic";
  if (mode === "split") return "protected domains only";
  return "not configured";
}

export function formatAiDomainsState(configPresent: boolean, trayStatus: TrayStatus): AiDomainsState {
  if (!configPresent) return "not configured";
  if (trayStatus === "protected") return "through VPN";
  if (trayStatus === "starting") return "blocked";
  if (trayStatus === "fail-closed") return "blocked";
  return "configured";
}

export function formatLeakGuard(state: VpnState | null, trayStatus: TrayStatus): string {
  if (trayStatus === "protected") return "standing by";
  if (trayStatus === "starting") return "blocking while tunnel starts";
  if (state?.sinkholeActive === true) return "blocking protected domains";
  if (trayStatus === "fail-closed") return "needs refresh";
  return "unknown";
}

export function formatTunnelLabel(status: TrayStatus): string {
  if (status === "protected") return "up";
  if (status === "starting") return "starting";
  if (status === "fail-closed") return "down";
  return "unknown";
}

export function stateColor(state: AiDomainsState): StatusColor {
  if (state === "through VPN") return "green";
  if (state === "configured") return "green";
  if (state === "blocked") return "yellow";
  return "gray";
}

export function valueToAiDomainsState(value: string): AiDomainsState {
  if (value === "through VPN" || value === "blocked" || value === "configured" || value === "unknown" || value === "not configured") {
    return value;
  }
  return "unknown";
}
