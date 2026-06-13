import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Exec } from "./exec";
import { PF_ANCHOR_NAME } from "./paths";

const IPV4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

async function digRecords(exec: Exec, domain: string, recordType: "A" | "AAAA", dnsServers: string[], pattern: RegExp): Promise<string[]> {
  for (const dns of dnsServers) {
    const result = await exec("/usr/bin/dig", ["+short", "+time=2", "+tries=1", recordType, domain, `@${dns}`]);
    const ips = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => pattern.test(line));
    if (ips.length > 0) return ips;
  }
  return [];
}

export async function resolveDomain(exec: Exec, domain: string, dnsServers: string[]): Promise<{ v4: string[]; v6: string[] }> {
  const v4 = await digRecords(exec, domain, "A", dnsServers, IPV4_PATTERN);
  const v6 = await digRecords(exec, domain, "AAAA", dnsServers, IPV6_PATTERN);
  return { v4, v6 };
}

export async function resolveAll(exec: Exec, domains: string[], dnsServers: string[]): Promise<{ v4: string[]; v6: string[] }> {
  const v4 = new Set<string>();
  const v6 = new Set<string>();

  for (const domain of domains) {
    const resolved = await resolveDomain(exec, domain, dnsServers);
    for (const ip of resolved.v4) v4.add(ip);
    for (const ip of resolved.v6) v6.add(ip);
  }

  return { v4: [...v4].sort(), v6: [...v6].sort() };
}

export async function writeTable(exec: Exec, table: string, ips: string[]): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `vpnctl-table-${crypto.randomUUID()}.txt`);
  await Bun.write(tmpFile, ips.length > 0 ? ips.join("\n") + "\n" : "");

  try {
    const result = await exec("/sbin/pfctl", ["-a", PF_ANCHOR_NAME, "-t", table, "-T", "replace", "-f", tmpFile]);
    if (result.exitCode !== 0) {
      throw new Error(`failed to replace pf table <${table}>: ${result.stderr.trim()}`);
    }
  } finally {
    await rm(tmpFile, { force: true });
  }
}
