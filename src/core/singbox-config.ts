import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { RoutingMode } from "./config";
import type { RealityOutbound } from "./vless";

interface DnsServer {
  tag: string;
  type: string;
  server: string;
  detour?: string;
}

interface DnsRule {
  domain_suffix: string[];
  server: string;
}

interface TunInbound {
  type: "tun";
  tag: string;
  interface_name: string;
  address: string[];
  auto_route: true;
  strict_route: true;
  stack: string;
}

interface SocksInbound {
  type: "socks";
  tag: string;
  listen: string;
  listen_port: number;
}

interface MixedInbound {
  type: "mixed";
  tag: string;
  listen: string;
  listen_port: number;
}

type Inbound = TunInbound | SocksInbound | MixedInbound;

interface DirectOutbound {
  type: "direct";
  tag: string;
}

type Outbound = RealityOutbound | DirectOutbound;

interface RouteRule {
  action?: string;
  protocol?: string;
  domain_suffix?: string[];
  outbound?: string;
  ip_is_private?: boolean;
}

export interface SingBoxConfig {
  log: { level: string; timestamp: boolean };
  dns: {
    servers: DnsServer[];
    rules: DnsRule[];
    strategy: string;
    final: string;
  };
  inbounds: Inbound[];
  outbounds: Outbound[];
  route: {
    rules: RouteRule[];
    final: string;
    auto_detect_interface: boolean;
    default_domain_resolver: { server: string };
  };
}

export interface BuildSingBoxConfigOptions {
  outbound: RealityOutbound;
  domains: string[];
  tun: { interfaceName: string; address: string };
  dnsServer?: string;
  routingMode: RoutingMode;
}

export function deriveDomainSuffixes(domains: string[]): string[] {
  const suffixes = new Set<string>();
  for (const domain of domains) {
    const labels = domain.split(".");
    const suffix = labels.length <= 2 ? domain : labels.slice(-2).join(".");
    suffixes.add(suffix);
  }
  return [...suffixes];
}

export async function readSingBoxConfig(filePath: string): Promise<unknown> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return file.json();
}

export async function writeSingBoxConfig(config: SingBoxConfig, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

export function buildSingBoxConfig(opts: BuildSingBoxConfigOptions): SingBoxConfig {
  const dnsServer = opts.dnsServer ?? "1.1.1.1";
  const domainSuffixes = deriveDomainSuffixes(opts.domains);
  const proxyOutbound: RealityOutbound = { ...opts.outbound, tag: "proxy" };
  const fullTunnel = opts.routingMode === "full";

  return {
    log: { level: "warn", timestamp: true },
    dns: {
      servers: [
        { tag: "proxy-dns", type: "https", server: dnsServer, detour: "proxy" },
        { tag: "local-dns", type: "udp", server: dnsServer },
      ],
      rules: [{ domain_suffix: domainSuffixes, server: "proxy-dns" }],
      strategy: "ipv4_only",
      final: fullTunnel ? "proxy-dns" : "local-dns",
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        interface_name: opts.tun.interfaceName,
        address: [opts.tun.address],
        auto_route: true,
        strict_route: true,
        stack: "system",
      },
      { type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: 1080 },
      { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 1081 },
    ],
    outbounds: [proxyOutbound, { type: "direct", tag: "direct" }],
    route: {
      rules: [
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        { domain_suffix: domainSuffixes, outbound: "proxy" },
        { ip_is_private: true, outbound: "direct" },
      ],
      final: fullTunnel ? "proxy" : "direct",
      auto_detect_interface: true,
      default_domain_resolver: { server: "local-dns" },
    },
  };
}
