import pkg from "../../../package.json";
import pc from "picocolors";
import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { isLoaded } from "../../core/launchd";
import {
  CONFIG_FILE,
  GENERATED_SINGBOX_CONFIG,
  LAUNCHD_LABEL_MONITOR,
  LAUNCHD_LABEL_TUNNEL,
  PF_ANCHOR_NAME,
  UPDATE_CHECK_CACHE_FILE,
} from "../../core/paths";
import { readSingBoxConfig } from "../../core/singbox-config";
import { compareVersions } from "../../core/version";
import { detectVpnConflicts, getConfiguredTunInterface } from "../../core/vpn-conflicts";
import { requireRoot } from "../root";
import { resolveSingBoxPath } from "./install";
import { getLatestVersion } from "./update";

const MIN_BUN_VERSION = pkg.engines.bun.replace(/^>=/, "");

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReportOptions {
  color?: boolean;
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
    detail: exists ? singboxConfigPath : `${singboxConfigPath} not found — run the vpnctl installer again`,
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

export async function checkVpnConflicts(exec: Exec, singboxConfig: unknown): Promise<DoctorCheck[]> {
  const ownIface = getConfiguredTunInterface(singboxConfig);
  const conflicts = await detectVpnConflicts(exec, ownIface);

  const checks: DoctorCheck[] = [];

  if (conflicts.otherInterfaces.length === 0) {
    checks.push({ name: "other VPN interfaces", status: "ok", detail: "none detected" });
  } else {
    const names = conflicts.otherInterfaces.map((iface) => `${iface.name} (${iface.inet})`).join(", ");
    checks.push({
      name: "other VPN interfaces",
      status: "ok",
      detail:
        conflicts.routingConflict === null && conflicts.dnsConflicts.length === 0
          ? `${names} — no default-route or DNS conflict detected`
          : `${names} — see conflict rows below`,
    });
  }

  if (conflicts.routingConflict !== null) {
    checks.push({
      name: "VPN routing conflict",
      status: "warn",
      detail: `default route is through ${conflicts.routingConflict}, not vpnctl's tunnel — protected traffic may not be routed as expected; run \`vpnctl up\` after connecting your other VPN`,
    });
  }

  for (const dns of conflicts.dnsConflicts) {
    checks.push({
      name: "VPN DNS override",
      status: "warn",
      detail: `${dns.iface} is pushing DNS servers (${dns.servers.join(", ")}) — apps may resolve protected domain IPs not covered by vpnctl's pf tables`,
    });
  }

  return checks;
}

export async function checkForUpdate(
  exec: Exec,
  currentVersion: string = pkg.version,
  cachePath: string = UPDATE_CHECK_CACHE_FILE,
): Promise<DoctorCheck> {
  const latestVersion = await getLatestVersion(exec, cachePath);
  if (latestVersion === null) {
    return { name: "update", status: "ok", detail: `unable to check for updates — currently v${currentVersion}` };
  }

  return compareVersions(latestVersion, currentVersion) > 0
    ? { name: "update", status: "warn", detail: `v${latestVersion} available — run \`vpnctl update\`` }
    : { name: "update", status: "ok", detail: `up to date (v${currentVersion})` };
}

const STATUS_LABEL: Record<DoctorStatus, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL" };

export function formatDoctorReport(checks: DoctorCheck[], options: DoctorReportOptions = {}): string {
  const nameWidth = checks.reduce((width, check) => Math.max(width, check.name.length), 0);
  const lines = ["vpnctl doctor", ""];

  for (const check of checks) {
    lines.push(`${formatStatusLabel(check.status, options.color === true)}  ${check.name.padEnd(nameWidth)}  ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;

  lines.push("");
  if (failed > 0) {
    lines.push(`${failed} check(s) failed.`);
  } else if (warned > 0) {
    lines.push(`${warned} check(s) need attention.`);
  } else {
    lines.push("all checks OK.");
  }

  return lines.join("\n");
}

function formatStatusLabel(status: DoctorStatus, color: boolean): string {
  const label = STATUS_LABEL[status];
  if (!color) return label;
  const colors = pc.createColors(true);
  if (status === "ok") return colors.green(label);
  if (status === "warn") return colors.yellow(label);
  return colors.red(label);
}

export interface DoctorOptions {
  exec?: Exec;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const singboxConfig = await readSingBoxConfig(GENERATED_SINGBOX_CONFIG).catch(() => null);

  const checks: DoctorCheck[] = [
    checkBunVersion(Bun.version),
    await checkConfig(),
    await checkSingBoxBinary(),
    await checkGeneratedSingBoxConfig(),
    await checkPfEnabled(exec),
    await checkAnchorLoaded(exec),
    await checkDaemon(exec, LAUNCHD_LABEL_MONITOR),
    await checkDaemon(exec, LAUNCHD_LABEL_TUNNEL),
    ...(await checkVpnConflicts(exec, singboxConfig)),
    await checkForUpdate(exec),
  ];

  console.log(formatDoctorReport(checks, { color: process.stdout.isTTY }));

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}
