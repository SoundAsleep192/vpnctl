import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Exec } from "./exec";

const LOOPBACK_PATTERN = /^(127\.|\[::1\]|localhost)/;

export interface ConnectionRow {
  command: string;
  pid: number;
  user: string;
  name: string;
}

export interface AuditConfig {
  processNamePatterns: string[];
}

export async function captureConnections(exec: Exec, patterns: string[]): Promise<ConnectionRow[]> {
  const result = await exec("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:ESTABLISHED"]);
  const rows: ConnectionRow[] = [];

  for (const line of result.stdout.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // COMMAND can contain spaces (e.g. "Cursor He" for a truncated "Cursor Helper"), so locate
    // the PID by its first all-digit token instead of assuming a fixed column index.
    const tokens = trimmed.split(/\s+/);
    const pidIndex = tokens.findIndex((token) => /^\d+$/.test(token));
    if (pidIndex <= 0) continue;

    const command = tokens[0];
    const pidString = tokens[pidIndex];
    const user = tokens[pidIndex + 1];
    const name = tokens[tokens.length - 2];
    if (command === undefined || pidString === undefined || user === undefined || name === undefined) continue;

    if (LOOPBACK_PATTERN.test(name)) continue;
    if (!patterns.some((pattern) => trimmed.includes(pattern))) continue;

    rows.push({ command, pid: Number(pidString), user, name });
  }

  return rows;
}

export function formatSnapshot(rows: ConnectionRow[]): string {
  if (rows.length === 0) return "(no matching established connections)\n";

  const header = `${"COMMAND".padEnd(15)}${"PID".padEnd(8)}${"USER".padEnd(12)}NAME`;
  const lines = rows.map((row) => `${row.command.padEnd(15)}${String(row.pid).padEnd(8)}${row.user.padEnd(12)}${row.name}`);

  return [header, ...lines].join("\n") + "\n";
}

export function rotateLog(filePath: string, maxBytes: number, maxLines: number): void {
  if (!existsSync(filePath)) return;
  if (statSync(filePath).size <= maxBytes) return;

  const content = readFileSync(filePath, "utf8");
  const trailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (trailingNewline) lines.pop();

  const kept = lines.slice(-maxLines).join("\n") + (trailingNewline ? "\n" : "");
  writeFileSync(filePath, kept);
}
