import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { uninstallDaemon } from "../../core/launchd";
import {
  LAUNCHD_LABEL_AUDIT,
  HOSTS_FILE,
  HOSTS_BACKUP_FILE,
  LAUNCHD_LABEL_MONITOR,
  LAUNCHD_LABEL_TRAY,
  LAUNCHD_LABEL_TUNNEL,
  LAUNCHD_PLIST_MONITOR,
  LAUNCHD_PLIST_TUNNEL,
  LOG_DIR,
  PF_ANCHOR_FILE,
  PF_ANCHOR_NAME,
  PF_CONF_BACKUP_FILE,
  PF_CONF_FILE,
  ROOT_STATE_DIR,
} from "../../core/paths";
import { revertPfConfPatch } from "../../core/pf-conf-patch";
import { isCompiledBinary } from "../../core/runtime";
import { applyHosts, computeHosts } from "../../core/sinkhole";
import { requireRoot } from "../root";
import { isPreflightWrapper } from "../../core/preflight-wrapper";

export interface UninstallOptions {
  exec?: Exec;
  installDir?: string;
  userHome?: string;
  userUid?: string;
  removeBinaries?: boolean;
}

const MONITOR_STOP_POLL_ATTEMPTS = 50;
const MONITOR_STOP_POLL_DELAY_MS = 100;
const RELEASE_ARTIFACTS = ["vpnctl", "vpnctl-monitor", "vpnctl-tunnel", "vpnctl-tray", "traybin"];
const DEFAULT_USER_BIN_DIR = [".local", "bin"];
const USER_HOME_PARENT = "/Users";

interface UninstallUserPaths {
  home: string;
  uid: string | null;
  configDir: string;
  trayPlistFile: string;
  auditPlistFile: string;
  preflightWrapperDir: string;
}

interface UninstallUserEnvironment {
  HOME?: string;
  SUDO_USER?: string;
  SUDO_UID?: string;
}

export async function waitForMonitorStopped(exec: Exec, sleep: (ms: number) => Promise<void> = Bun.sleep): Promise<void> {
  for (let attempt = 0; attempt < MONITOR_STOP_POLL_ATTEMPTS; attempt++) {
    const result = await exec("/usr/bin/pgrep", ["-f", "vpnctl-monitor"]);
    if (result.exitCode !== 0) return;
    await sleep(MONITOR_STOP_POLL_DELAY_MS);
  }
}

export function resolveUninstallUserPaths(
  env?: UninstallUserEnvironment,
  currentUid: number = process.getuid?.() ?? 0,
): UninstallUserPaths {
  const source = env ?? { HOME: Bun.env.HOME, SUDO_USER: Bun.env.SUDO_USER, SUDO_UID: Bun.env.SUDO_UID };
  const sudoUser = source.SUDO_USER;
  const sudoUid = source.SUDO_UID;
  const sudoHome = sudoUser !== undefined && sudoUser !== "root" ? path.join(USER_HOME_PARENT, sudoUser) : null;
  const home = currentUid === 0 ? (sudoHome ?? source.HOME ?? os.homedir()) : (source.HOME ?? os.homedir());
  const uid = currentUid === 0 ? (sudoUid ?? null) : String(currentUid);

  return {
    home,
    uid,
    configDir: path.join(home, ".config", "vpnctl"),
    trayPlistFile: path.join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL_TRAY}.plist`),
    auditPlistFile: path.join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL_AUDIT}.plist`),
    preflightWrapperDir: path.join(home, ...DEFAULT_USER_BIN_DIR),
  };
}

async function uninstallLaunchAgent(exec: Exec, label: string, plistPath: string, uid: string | null): Promise<void> {
  if (uid !== null) {
    await uninstallDaemon(exec, label, plistPath, `gui/${uid}`);
    return;
  }

  await rm(plistPath, { force: true });
}

export async function removePreflightWrappers(preflightWrapperDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(preflightWrapperDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const wrapperPath = path.join(preflightWrapperDir, entry);
    const content = await Bun.file(wrapperPath)
      .text()
      .catch(() => "");
    if (isPreflightWrapper(content)) {
      await rm(wrapperPath, { force: true });
    }
  }
}

export async function removeInstalledArtifacts(installDir: string): Promise<void> {
  for (const artifact of RELEASE_ARTIFACTS) {
    await rm(path.join(installDir, artifact), { recursive: true, force: true });
  }
}

function shouldRemoveBinaries(options: UninstallOptions): boolean {
  if (options.removeBinaries !== undefined) return options.removeBinaries;
  return isCompiledBinary();
}

function resolveInstallDir(options: UninstallOptions): string {
  if (options.installDir !== undefined) return options.installDir;
  return path.dirname(process.execPath);
}

export async function runUninstall(options: UninstallOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const userPaths = resolveUninstallUserPaths(
    {
      HOME: options.userHome ?? Bun.env.HOME,
      SUDO_USER: Bun.env.SUDO_USER,
      SUDO_UID: options.userUid ?? Bun.env.SUDO_UID,
    },
    process.getuid?.() ?? 0,
  );

  console.log("Removing menu-bar icon...");
  await uninstallLaunchAgent(exec, LAUNCHD_LABEL_TRAY, userPaths.trayPlistFile, userPaths.uid);

  console.log("Removing audit agent...");
  await uninstallLaunchAgent(exec, LAUNCHD_LABEL_AUDIT, userPaths.auditPlistFile, userPaths.uid);

  console.log("Removing tunnel daemon...");
  await uninstallDaemon(exec, LAUNCHD_LABEL_TUNNEL, LAUNCHD_PLIST_TUNNEL, "system");

  console.log("Removing monitor daemon...");
  await uninstallDaemon(exec, LAUNCHD_LABEL_MONITOR, LAUNCHD_PLIST_MONITOR, "system");

  // launchctl bootout returns before the process actually exits. A monitor that
  // is still alive will reconcile once more and recreate the pf anchor / sinkhole
  // we are about to remove, so wait for it to be gone first.
  await waitForMonitorStopped(exec);

  console.log(`Reverting ${PF_CONF_FILE}...`);
  await revertPfConfPatch(exec);

  console.log("Removing pf anchor file...");
  await rm(PF_ANCHOR_FILE, { force: true });
  await rm(PF_CONF_BACKUP_FILE, { force: true });

  console.log("Cleaning /etc/hosts sinkhole entries...");
  const currentHosts = await Bun.file(HOSTS_FILE).text();
  const { content, changed } = computeHosts(currentHosts, [], false);
  if (changed) await applyHosts(exec, content);
  await rm(HOSTS_BACKUP_FILE, { force: true });

  console.log("Reloading pf...");
  const reload = await exec("/sbin/pfctl", ["-f", PF_CONF_FILE]);
  if (reload.exitCode !== 0) {
    console.log(`warning: pf reload reported an error: ${reload.stderr.trim()}`);
  }

  // Reverting pf.conf de-references the anchor, but its rules and tables stay
  // loaded in the kernel. With the tunnel down those rules are fail-closed
  // (block-all), so a leftover anchor would strand the machine offline after an
  // uninstall — the killswitch outliving its own removal. Flush it explicitly.
  console.log("Flushing pf anchor...");
  await exec("/sbin/pfctl", ["-a", PF_ANCHOR_NAME, "-F", "all"]);

  // Drop the tray/CLI desired-state override; leaving a stale "down" would force
  // the tunnel off on the next install.
  await rm(path.join(userPaths.configDir, "desired-tunnel"), { force: true });

  console.log(`Removing ${ROOT_STATE_DIR}...`);
  await rm(ROOT_STATE_DIR, { recursive: true, force: true });

  console.log(`Removing ${LOG_DIR}...`);
  await rm(LOG_DIR, { recursive: true, force: true });

  console.log(`Removing ${userPaths.configDir}...`);
  await rm(userPaths.configDir, { recursive: true, force: true });

  console.log("Removing vpnctl preflight wrappers...");
  await removePreflightWrappers(userPaths.preflightWrapperDir);

  if (shouldRemoveBinaries(options)) {
    const installDir = resolveInstallDir(options);
    console.log(`Removing installed binaries from ${installDir}...`);
    await removeInstalledArtifacts(installDir);
  }

  console.log("Uninstall complete.");
}
