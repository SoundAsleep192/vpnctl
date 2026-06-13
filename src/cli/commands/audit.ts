import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { captureConnections, formatSnapshot, rotateLog } from "../../core/audit";
import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { installDaemon, renderPlist, uninstallDaemon, type PlistOptions } from "../../core/launchd";
import { AUDIT_LOG_FILE, AUDIT_PLIST_FILE, LAUNCHD_LABEL_AUDIT } from "../../core/paths";
import { isCompiledBinary } from "../../core/runtime";

export const AUDIT_AGENT_INTERVAL_SEC = 300;
const AUDIT_LOG_MAX_BYTES = 1_000_000;
const AUDIT_LOG_MAX_LINES = 5_000;

export function buildAuditPlist(invocation: string[]): PlistOptions {
  return {
    label: LAUNCHD_LABEL_AUDIT,
    programArguments: [...invocation, "audit", "--log"],
    runAtLoad: false,
    keepAlive: false,
    startIntervalSec: AUDIT_AGENT_INTERVAL_SEC,
    stdoutPath: "/dev/null",
    stderrPath: "/dev/null",
  };
}

function auditAgentDomain(): `gui/${string}` {
  const uid = String(process.getuid?.() ?? 0);
  return `gui/${uid}`;
}

async function installAuditAgent(exec: Exec): Promise<void> {
  const invocation = isCompiledBinary()
    ? [process.execPath]
    : [process.execPath, "run", path.resolve(import.meta.dir, "../../../bin/vpnctl.ts")];

  await installDaemon(exec, LAUNCHD_LABEL_AUDIT, AUDIT_PLIST_FILE, renderPlist(buildAuditPlist(invocation)), auditAgentDomain());
  console.log(`Installed ${AUDIT_PLIST_FILE} — runs \`vpnctl audit --log\` every ${AUDIT_AGENT_INTERVAL_SEC}s.`);
}

async function uninstallAuditAgent(exec: Exec): Promise<void> {
  await uninstallDaemon(exec, LAUNCHD_LABEL_AUDIT, AUDIT_PLIST_FILE, auditAgentDomain());
  console.log(`Removed ${AUDIT_PLIST_FILE}.`);
}

async function logSnapshot(exec: Exec, patterns: string[]): Promise<void> {
  await mkdir(path.dirname(AUDIT_LOG_FILE), { recursive: true });
  rotateLog(AUDIT_LOG_FILE, AUDIT_LOG_MAX_BYTES, AUDIT_LOG_MAX_LINES);

  const rows = await captureConnections(exec, patterns);
  const timestamp = new Date().toISOString();
  await appendFile(AUDIT_LOG_FILE, `=== ${timestamp} ===\n${formatSnapshot(rows)}`);
}

async function printSnapshot(exec: Exec, patterns: string[]): Promise<void> {
  const rows = await captureConnections(exec, patterns);
  console.log(formatSnapshot(rows).trimEnd());
}

export interface AuditOptions {
  exec?: Exec;
  watchSec?: number;
  log?: boolean;
  installAgent?: boolean;
  uninstallAgent?: boolean;
}

export async function runAudit(options: AuditOptions = {}): Promise<void> {
  const exec = options.exec ?? realExec;

  if (options.installAgent) return installAuditAgent(exec);
  if (options.uninstallAgent) return uninstallAuditAgent(exec);

  const config = await loadConfig();
  const tick = options.log
    ? () => logSnapshot(exec, config.audit.processNamePatterns)
    : () => printSnapshot(exec, config.audit.processNamePatterns);

  await tick();
  if (options.watchSec === undefined) return;

  while (true) {
    await Bun.sleep(options.watchSec * 1000);
    await tick();
  }
}
