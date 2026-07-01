import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Exec } from "./exec";
import { PF_ANCHOR_FILE, PF_ANCHOR_NAME, PF_TABLE_V4, PF_TABLE_V6 } from "./paths";

const UTUN_PATTERN = /^utun[0-9]+$/;

export function generateAnchorRules(opts: { trustedIface: string | null }): string {
  const lines = [`table <${PF_TABLE_V4}> persist`, `table <${PF_TABLE_V6}> persist`, ""];

  if (opts.trustedIface !== null && UTUN_PATTERN.test(opts.trustedIface)) {
    lines.push(
      `pass out quick on ${opts.trustedIface} inet  proto { tcp udp } from any to <${PF_TABLE_V4}>`,
      `pass out quick on ${opts.trustedIface} inet6 proto { tcp udp } from any to <${PF_TABLE_V6}>`,
      "",
    );
  }

  lines.push(
    `block drop log quick inet  proto { tcp udp } from any to <${PF_TABLE_V4}>`,
    `block drop log quick inet6 proto { tcp udp } from any to <${PF_TABLE_V6}>`,
  );

  return lines.join("\n") + "\n";
}

export async function writeAnchor(exec: Exec, rules: string): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `vpnctl-anchor-${crypto.randomUUID()}.conf`);
  await Bun.write(tmpFile, rules);

  try {
    const check = await exec("/sbin/pfctl", ["-nvf", tmpFile]);
    if (check.exitCode !== 0) {
      throw new Error(`pf anchor syntax check failed: ${check.stderr.trim()}`);
    }

    const install = await exec("/usr/bin/install", ["-m", "0644", "-o", "root", "-g", "wheel", tmpFile, PF_ANCHOR_FILE]);
    if (install.exitCode !== 0) {
      throw new Error(`failed to install pf anchor file: ${install.stderr.trim()}`);
    }

    const load = await exec("/sbin/pfctl", ["-a", PF_ANCHOR_NAME, "-f", PF_ANCHOR_FILE]);
    if (load.exitCode !== 0) {
      throw new Error(`failed to load pf anchor: ${load.stderr.trim()}`);
    }
  } finally {
    await rm(tmpFile, { force: true });
  }
}
