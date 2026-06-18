import type { Exec } from "./exec";
import { getInterfaceInet, getRouteInterface } from "./network";

const VPN_INTERFACE_PATTERNS = [/^ppp\d+$/, /^ipsec\d*$/, /^tun\d+$/, /^tap\d+$/, /^utun\d+$/];

export interface OtherVpnInterface {
  name: string;
  inet: string;
}

export interface DnsConflict {
  iface: string;
  servers: string[];
}

export interface VpnConflicts {
  otherInterfaces: OtherVpnInterface[];
  routingConflict: string | null;
  dnsConflicts: DnsConflict[];
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function getConfiguredTunInterface(singboxConfig: unknown): string | null {
  if (typeof singboxConfig !== "object" || singboxConfig === null) return null;
  if (!("inbounds" in singboxConfig) || !isUnknownArray(singboxConfig.inbounds)) return null;
  for (const inbound of singboxConfig.inbounds) {
    if (typeof inbound !== "object" || inbound === null) continue;
    if (!("type" in inbound) || inbound.type !== "tun") continue;
    if (!("interface_name" in inbound) || typeof inbound.interface_name !== "string") continue;
    return inbound.interface_name;
  }
  return null;
}

export async function detectOtherVpnInterfaces(exec: Exec, ownTrustedIface: string | null): Promise<OtherVpnInterface[]> {
  const result = await exec("/sbin/ifconfig", ["-lu"]);
  const names = result.stdout.trim().split(/\s+/);

  const candidates = names.filter((name) => VPN_INTERFACE_PATTERNS.some((pattern) => pattern.test(name)) && name !== ownTrustedIface);

  const interfaces: OtherVpnInterface[] = [];
  for (const name of candidates) {
    const inet = await getInterfaceInet(exec, name);
    if (inet !== null) {
      interfaces.push({ name, inet });
    }
  }
  return interfaces;
}

async function getDefaultRouteInterface(exec: Exec): Promise<string | null> {
  for (const target of ["1.1.1.1", "8.8.8.8"]) {
    const iface = await getRouteInterface(exec, target);
    if (iface !== null) return iface;
  }
  return null;
}

// Pure parser — split scutil --dns output into resolver blocks and find any
// that are bound to a known VPN interface (via if_index).
export function parseDnsConflicts(scutilOutput: string, vpnIfaceNames: ReadonlySet<string>): DnsConflict[] {
  const conflicts: DnsConflict[] = [];

  for (const block of scutilOutput.split(/\n(?=resolver #)/)) {
    const ifaceMatch = /if_index\s*:\s*\d+\s*\(([^)]+)\)/.exec(block);
    if (ifaceMatch === null) continue;

    const iface = ifaceMatch[1];
    if (iface === undefined || !vpnIfaceNames.has(iface)) continue;

    const servers: string[] = [];
    const serverPattern = /nameserver\[\d+\]\s*:\s*(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = serverPattern.exec(block)) !== null) {
      const server = match[1];
      if (server !== undefined) servers.push(server);
    }

    if (servers.length > 0) conflicts.push({ iface, servers });
  }

  return conflicts;
}

export async function detectDnsConflicts(exec: Exec, otherIfaces: OtherVpnInterface[]): Promise<DnsConflict[]> {
  if (otherIfaces.length === 0) return [];

  const result = await exec("/usr/sbin/scutil", ["--dns"]);
  if (result.exitCode !== 0) return [];

  return parseDnsConflicts(result.stdout, new Set(otherIfaces.map((iface) => iface.name)));
}

export async function detectVpnConflicts(exec: Exec, ownTrustedIface: string | null): Promise<VpnConflicts> {
  const otherInterfaces = await detectOtherVpnInterfaces(exec, ownTrustedIface);
  const defaultIface = await getDefaultRouteInterface(exec);
  const routingConflict = defaultIface !== null && otherInterfaces.some((iface) => iface.name === defaultIface) ? defaultIface : null;
  const dnsConflicts = await detectDnsConflicts(exec, otherInterfaces);
  return { otherInterfaces, routingConflict, dnsConflicts };
}
