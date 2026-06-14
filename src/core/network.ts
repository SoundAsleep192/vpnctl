import type { Exec } from "./exec";

const UTUN_PATTERN = /^utun[0-9]+$/;

export async function getRouteInterface(exec: Exec, target: string): Promise<string | null> {
  const result = await exec("/sbin/route", ["-n", "get", target]);
  const match = result.stdout.match(/^\s*interface:\s*(\S+)/m);
  return match?.[1] ?? null;
}

export async function getInterfaceInet(exec: Exec, iface: string): Promise<string | null> {
  const result = await exec("/sbin/ifconfig", [iface]);
  const match = result.stdout.match(/^\s*inet\s+(\S+)/m);
  return match?.[1] ?? null;
}

export async function listUtunInterfaces(exec: Exec): Promise<string[]> {
  const result = await exec("/sbin/ifconfig", ["-lu"]);
  return result.stdout
    .trim()
    .split(/\s+/)
    .filter((name) => UTUN_PATTERN.test(name));
}

export async function findUtunForInet(exec: Exec, ip: string): Promise<string | null> {
  for (const iface of await listUtunInterfaces(exec)) {
    if ((await getInterfaceInet(exec, iface)) === ip) return iface;
  }
  return null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function getTunIpFromConfig(singboxConfig: unknown): string | null {
  if (typeof singboxConfig !== "object" || singboxConfig === null) return null;
  if (!("inbounds" in singboxConfig) || !isUnknownArray(singboxConfig.inbounds)) return null;

  for (const inbound of singboxConfig.inbounds) {
    if (typeof inbound !== "object" || inbound === null) continue;
    if (!("type" in inbound) || inbound.type !== "tun") continue;
    if (!("address" in inbound) || !isUnknownArray(inbound.address)) continue;

    const addressWithPrefix = inbound.address[0];
    if (typeof addressWithPrefix !== "string") continue;

    const match = addressWithPrefix.match(/^(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1] ?? null;
  }

  return null;
}

export async function readPidFile(pidFile: string): Promise<number | null> {
  const file = Bun.file(pidFile);
  if (!(await file.exists())) return null;

  const pid = Number((await file.text()).trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export async function isSingBoxRunning(exec: Exec, pidFile: string): Promise<boolean> {
  const pid = await readPidFile(pidFile);
  if (pid === null) return false;

  const result = await exec("/bin/kill", ["-0", String(pid)]);
  return result.exitCode === 0;
}

export async function getTrustedInterfaceByRoute(exec: Exec, singboxConfig: unknown): Promise<string | null> {
  const tunIp = getTunIpFromConfig(singboxConfig);
  if (tunIp === null) return null;

  const routeIface = await getRouteInterface(exec, tunIp);
  if (routeIface !== null && UTUN_PATTERN.test(routeIface)) return routeIface;

  return findUtunForInet(exec, tunIp);
}

export async function getTrustedInterface(exec: Exec, singboxConfig: unknown, pidFile: string): Promise<string | null> {
  if (!(await isSingBoxRunning(exec, pidFile))) return null;
  return getTrustedInterfaceByRoute(exec, singboxConfig);
}

export async function getPublicInterface(exec: Exec): Promise<string | null> {
  for (const target of ["1.1.1.1", "8.8.8.8"]) {
    const iface = await getRouteInterface(exec, target);
    if (iface !== null && UTUN_PATTERN.test(iface)) return iface;
  }
  return null;
}

export async function isTunnelUpByRoute(exec: Exec, singboxConfig: unknown): Promise<boolean> {
  const trusted = await getTrustedInterfaceByRoute(exec, singboxConfig);
  if (trusted === null) return false;

  const pub = await getPublicInterface(exec);
  return pub === trusted;
}

export async function isTunnelUp(exec: Exec, singboxConfig: unknown, pidFile: string): Promise<boolean> {
  if (!(await isSingBoxRunning(exec, pidFile))) return false;
  return isTunnelUpByRoute(exec, singboxConfig);
}

export interface TunnelState {
  trustedIface: string | null;
  publicIface: string | null;
  tunnelUp: boolean;
}

// trustedIface and tunnelUp must be derived from the same pair of lookups —
// computing them via separate isTunnelUp()/getTrustedInterface() calls let
// the pf anchor and the DNS sinkhole disagree on which interface is trusted.
export async function getTunnelState(exec: Exec, singboxConfig: unknown, pidFile: string): Promise<TunnelState> {
  const trustedIface = await getTrustedInterface(exec, singboxConfig, pidFile);
  const publicIface = await getPublicInterface(exec);
  return { trustedIface, publicIface, tunnelUp: trustedIface !== null && trustedIface === publicIface };
}

export function tunnelStateChanged(previous: TunnelState | null, current: TunnelState): boolean {
  return previous === null || previous.trustedIface !== current.trustedIface || previous.tunnelUp !== current.tunnelUp;
}

export async function resolvePublicIp(exec: Exec): Promise<string | null> {
  const result = await exec("/usr/bin/dig", ["+short", "myip.opendns.com", "@resolver1.opendns.com"]);
  const ip = result.stdout.trim();
  return ip === "" ? null : ip;
}

export async function resolveCountry(exec: Exec, ip: string): Promise<string | null> {
  const result = await exec("/usr/bin/curl", ["-sS", "--max-time", "8", `https://ipinfo.io/${ip}/json`]);
  if (result.exitCode !== 0) return null;

  try {
    const data: unknown = JSON.parse(result.stdout);
    if (typeof data === "object" && data !== null && "country" in data && typeof data.country === "string") {
      return data.country;
    }
  } catch {
    return null;
  }

  return null;
}
