import path from "node:path";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { installDaemon, renderPlist, uninstallDaemon, type PlistOptions } from "../../core/launchd";
import { LAUNCHD_LABEL_TRAY, TRAY_LOG_FILE, TRAY_PLIST_FILE } from "../../core/paths";
import { isCompiledBinary } from "../../core/runtime";
import { resolveDaemonBinaryPath } from "../daemon-binary";

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

export function resolveTrayAgentDomain(
  currentUid: number = process.getuid?.() ?? 0,
  sudoUid: string | undefined = Bun.env.SUDO_UID,
): `gui/${string}` {
  const uid = currentUid === 0 ? (sudoUid ?? String(currentUid)) : String(currentUid);
  return `gui/${uid}`;
}

// The bundled systray helper is an x86_64 Go binary, so on Apple Silicon it
// only runs under Rosetta 2. Probe by running a trivial x86_64 binary; a
// non-zero exit means Rosetta is absent and the tray icon won't appear.
export async function isRosettaAvailable(exec: Exec): Promise<boolean> {
  if (process.arch !== "arm64") return true;
  const result = await exec("/usr/bin/arch", ["-x86_64", "/usr/bin/true"]);
  return result.exitCode === 0;
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

  if (!(await isRosettaAvailable(exec))) {
    console.warn(
      "Warning: the menu-bar helper is x86_64-only and needs Rosetta 2 on Apple Silicon.\n" +
        "Install it, then reinstall the tray:\n  softwareupdate --install-rosetta --agree-to-license",
    );
  }

  const invocation = await trayInvocation();
  await installDaemon(exec, LAUNCHD_LABEL_TRAY, TRAY_PLIST_FILE, renderPlist(buildTrayPlist(invocation)), resolveTrayAgentDomain());
  console.log(`Installed ${TRAY_PLIST_FILE} — the menu-bar icon now reflects vpnctl state.`);
}

export async function runTrayUninstall(options: TrayOptions = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  await uninstallDaemon(exec, LAUNCHD_LABEL_TRAY, TRAY_PLIST_FILE, resolveTrayAgentDomain());
  console.log(`Removed ${TRAY_PLIST_FILE}.`);
}
