import type { Exec } from "./exec";
import { getInterfaceInet, getRouteInterface } from "./network";

const VPN_INTERFACE_PATTERNS = [/^ppp\d+$/, /^ipsec\d*$/, /^tun\d+$/, /^tap\d+$/, /^utun\d+$/];

export interface OtherVpnInterface {
  name: string;
  inet: string;
}

export interface VpnConflicts {
  otherInterfaces: OtherVpnInterface[];
  routingConflict: string | null;
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

export async function detectVpnConflicts(exec: Exec, ownTrustedIface: string | null): Promise<VpnConflicts> {
  const otherInterfaces = await detectOtherVpnInterfaces(exec, ownTrustedIface);
  const defaultIface = await getDefaultRouteInterface(exec);
  const routingConflict = defaultIface !== null && otherInterfaces.some((iface) => iface.name === defaultIface) ? defaultIface : null;
  return { otherInterfaces, routingConflict };
}
