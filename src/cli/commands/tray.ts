import path from "node:path";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { installDaemon, renderPlist, uninstallDaemon, type PlistOptions } from "../../core/launchd";
import { LAUNCHD_LABEL_TRAY, TRAY_LOG_FILE, TRAY_PLIST_FILE } from "../../core/paths";
import { isCompiledBinary } from "../../core/runtime";
import { resolveDaemonBinaryPath } from "./install";

export function buildTrayPlist(invocation: string[]): PlistOptions {
  return {
    label: LAUNCHD_LABEL_TRAY,
    programArguments: invocation,
    runAtLoad: true,
    keepAlive: true,
    throttleIntervalSec: 5,
    stdoutPath: TRAY_LOG_FILE,
    stderrPath: TRAY_LOG_FILE,
  };
}

function trayAgentDomain(): `gui/${string}` {
  const uid = String(process.getuid?.() ?? 0);
  return `gui/${uid}`;
}

async function trayInvocation(): Promise<string[]> {
  if (isCompiledBinary()) return [await resolveDaemonBinaryPath("vpnctl-tray")];
  return [process.execPath, "run", path.resolve(import.meta.dir, "../../daemon/tray.ts")];
}

export interface TrayOptions {
  exec?: Exec;
}

export async function runTrayInstall(options: TrayOptions = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  const invocation = await trayInvocation();
  await installDaemon(exec, LAUNCHD_LABEL_TRAY, TRAY_PLIST_FILE, renderPlist(buildTrayPlist(invocation)), trayAgentDomain());
  console.log(`Installed ${TRAY_PLIST_FILE} — the menu-bar icon now reflects vpnctl state.`);
}

export async function runTrayUninstall(options: TrayOptions = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  await uninstallDaemon(exec, LAUNCHD_LABEL_TRAY, TRAY_PLIST_FILE, trayAgentDomain());
  console.log(`Removed ${TRAY_PLIST_FILE}.`);
}
