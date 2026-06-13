import pkg from "../../../package.json";
import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { isLoaded } from "../../core/launchd";
import { CONFIG_FILE, GENERATED_SINGBOX_CONFIG, LAUNCHD_LABEL_MONITOR, LAUNCHD_LABEL_TUNNEL, PF_ANCHOR_NAME } from "../../core/paths";
import { requireRoot } from "../root";
import { resolveSingBoxPath } from "./install";

const MIN_BUN_VERSION = pkg.engines.bun.replace(/^>=/, "");

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export function checkBunVersion(version: string, minVersion: string = MIN_BUN_VERSION): DoctorCheck {
  const ok = compareVersions(version, minVersion) >= 0;
  return {
    name: "bun version",
    status: ok ? "ok" : "fail",
    detail: ok ? `${version} (>= ${minVersion})` : `${version} is older than the required ${minVersion}`,
  };
}

export async function checkConfig(configPath: string = CONFIG_FILE): Promise<DoctorCheck> {
  try {
    await loadConfig(configPath);
    return { name: "config", status: "ok", detail: configPath };
  } catch (error) {
    return { name: "config", status: "fail", detail: (error as Error).message };
  }
}

export async function checkSingBoxBinary(
  exists: (filePath: string) => Promise<boolean> = (filePath) => Bun.file(filePath).exists(),
): Promise<DoctorCheck> {
  try {
    const resolved = await resolveSingBoxPath(exists);
    return { name: "sing-box binary", status: "ok", detail: resolved };
  } catch (error) {
    return { name: "sing-box binary", status: "fail", detail: (error as Error).message };
  }
}

export async function checkGeneratedSingBoxConfig(singboxConfigPath: string = GENERATED_SINGBOX_CONFIG): Promise<DoctorCheck> {
  const exists = await Bun.file(singboxConfigPath).exists();
  return {
    name: "sing-box.json",
    status: exists ? "ok" : "warn",
    detail: exists ? singboxConfigPath : `${singboxConfigPath} not found — run \`vpnctl setup\` or \`vpnctl install\``,
  };
}

export async function checkPfEnabled(exec: Exec): Promise<DoctorCheck> {
  const result = await exec("/sbin/pfctl", ["-s", "info"]);
  const enabled = /^Status:\s*Enabled/m.test(result.stdout);
  return { name: "pf", status: enabled ? "ok" : "warn", detail: enabled ? "enabled" : "disabled" };
}

export async function checkAnchorLoaded(exec: Exec): Promise<DoctorCheck> {
  const result = await exec("/sbin/pfctl", ["-a", PF_ANCHOR_NAME, "-s", "rules"]);
  const loaded = result.exitCode === 0 && result.stdout.trim() !== "";
  return { name: `pf anchor "${PF_ANCHOR_NAME}"`, status: loaded ? "ok" : "warn", detail: loaded ? "loaded" : "not loaded" };
}

export async function checkDaemon(exec: Exec, label: string): Promise<DoctorCheck> {
  const loaded = await isLoaded(exec, label, "system");
  return { name: label, status: loaded ? "ok" : "warn", detail: loaded ? "loaded" : "not loaded" };
}

const STATUS_LABEL: Record<DoctorStatus, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL" };

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const lines = checks.map((check) => `${STATUS_LABEL[check.status]} ${check.name}: ${check.detail}`);

  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;

  lines.push("---");
  if (failed > 0) {
    lines.push(`${failed} check(s) failed.`);
  } else if (warned > 0) {
    lines.push(`${warned} check(s) need attention.`);
  } else {
    lines.push("all checks OK.");
  }

  return lines.join("\n");
}

export interface DoctorOptions {
  exec?: Exec;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;

  const checks: DoctorCheck[] = [
    checkBunVersion(Bun.version),
    await checkConfig(),
    await checkSingBoxBinary(),
    await checkGeneratedSingBoxConfig(),
    await checkPfEnabled(exec),
    await checkAnchorLoaded(exec),
    await checkDaemon(exec, LAUNCHD_LABEL_MONITOR),
    await checkDaemon(exec, LAUNCHD_LABEL_TUNNEL),
  ];

  console.log(formatDoctorReport(checks));

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}
