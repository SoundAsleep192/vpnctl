import type { Config } from "../../core/config";
import type { DnsConflict, OtherVpnInterface } from "../../core/vpn-conflicts";

export type TuiScreen =
  | "dashboard"
  | "configure"
  | "connection-editor"
  | "domains-editor"
  | "dns-editor"
  | "traffic-scope"
  | "language"
  | "status"
  | "diagnostics"
  | "workspace"
  | "logs"
  | "log-view";
export type AiDomainsState = "through VPN" | "blocked" | "configured" | "unknown" | "not configured";
export type StatusColor = "green" | "yellow" | "gray";

export interface TuiSnapshot {
  aiDomains: AiDomainsState;
  trafficScope: string;
  workspaces: string;
  workspaceCount: number | null;
  updateAvailable: string | null;
  domainCount: number | null;
  dnsCount: number | null;
  tunnel: string;
  tunnelStarting: boolean;
  leakGuard: string;
  otherVpn: string;
  otherVpnInterfaces: OtherVpnInterface[] | null;
  vpnDnsConflicts: DnsConflict[] | null;
  vpnRoutingConflict: string | null;
  config: Config | null;
}

export interface EditorCommand {
  cmd: string;
  args: string[];
}
