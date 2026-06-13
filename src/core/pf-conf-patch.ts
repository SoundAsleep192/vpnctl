import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Exec } from "./exec";
import { PF_ANCHOR_FILE, PF_ANCHOR_NAME, PF_CONF_BACKUP_FILE, PF_CONF_FILE, PF_CONF_MARKER_BEGIN, PF_CONF_MARKER_END } from "./paths";

export function computePfConfPatch(content: string, anchorName: string): { content: string; changed: boolean } {
  if (content.includes(PF_CONF_MARKER_BEGIN)) {
    return { content, changed: false };
  }

  const block = [
    "",
    PF_CONF_MARKER_BEGIN,
    `anchor "${anchorName}"`,
    `load anchor "${anchorName}" from "${PF_ANCHOR_FILE}"`,
    PF_CONF_MARKER_END,
    "",
  ].join("\n");

  return { content: content.replace(/\n*$/, "\n") + block, changed: true };
}

export function computePfConfRevert(content: string): { content: string; changed: boolean } {
  if (!content.includes(PF_CONF_MARKER_BEGIN)) {
    return { content, changed: false };
  }

  const kept: string[] = [];
  let skipping = false;
  for (const line of content.split("\n")) {
    if (line === PF_CONF_MARKER_BEGIN) {
      skipping = true;
      continue;
    }
    if (line === PF_CONF_MARKER_END) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }

  return { content: kept.join("\n").replace(/\n+$/, "\n"), changed: true };
}

export async function revertPfConfPatch(exec: Exec): Promise<void> {
  const current = await Bun.file(PF_CONF_FILE).text();
  const { content, changed } = computePfConfRevert(current);
  if (!changed) return;

  const tmpFile = path.join(os.tmpdir(), `vpnctl-pf-conf-${crypto.randomUUID()}.conf`);
  await Bun.write(tmpFile, content);

  try {
    const check = await exec("/sbin/pfctl", ["-nf", tmpFile]);
    if (check.exitCode !== 0) {
      throw new Error(`pf.conf syntax check failed: ${check.stderr.trim()}`);
    }

    await Bun.write(PF_CONF_FILE, content);
  } finally {
    await rm(tmpFile, { force: true });
  }
}

export async function applyPfConfPatch(exec: Exec): Promise<void> {
  const current = await Bun.file(PF_CONF_FILE).text();
  const { content, changed } = computePfConfPatch(current, PF_ANCHOR_NAME);
  if (!changed) return;

  const tmpFile = path.join(os.tmpdir(), `vpnctl-pf-conf-${crypto.randomUUID()}.conf`);
  await Bun.write(tmpFile, content);

  try {
    const check = await exec("/sbin/pfctl", ["-nf", tmpFile]);
    if (check.exitCode !== 0) {
      throw new Error(`pf.conf syntax check failed: ${check.stderr.trim()}`);
    }

    await Bun.write(PF_CONF_BACKUP_FILE, current);
    await Bun.write(PF_CONF_FILE, content);
  } finally {
    await rm(tmpFile, { force: true });
  }
}
