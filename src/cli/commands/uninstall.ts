import { rm } from "node:fs/promises";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { uninstallDaemon } from "../../core/launchd";
import {
  HOSTS_FILE,
  LAUNCHD_LABEL_MONITOR,
  LAUNCHD_LABEL_TUNNEL,
  LAUNCHD_PLIST_MONITOR,
  LAUNCHD_PLIST_TUNNEL,
  PF_ANCHOR_FILE,
  PF_CONF_FILE,
  ROOT_STATE_DIR,
} from "../../core/paths";
import { revertPfConfPatch } from "../../core/pf-conf-patch";
import { applyHosts, computeHosts } from "../../core/sinkhole";
import { requireRoot } from "../root";

export interface UninstallOptions {
  exec?: Exec;
  purge?: boolean;
}

export async function runUninstall(options: UninstallOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;

  console.log("Removing tunnel daemon...");
  await uninstallDaemon(exec, LAUNCHD_LABEL_TUNNEL, LAUNCHD_PLIST_TUNNEL, "system");

  console.log("Removing monitor daemon...");
  await uninstallDaemon(exec, LAUNCHD_LABEL_MONITOR, LAUNCHD_PLIST_MONITOR, "system");

  console.log(`Reverting ${PF_CONF_FILE}...`);
  await revertPfConfPatch(exec);

  console.log("Removing pf anchor file...");
  await rm(PF_ANCHOR_FILE, { force: true });

  console.log("Cleaning /etc/hosts sinkhole entries...");
  const currentHosts = await Bun.file(HOSTS_FILE).text();
  const { content, changed } = computeHosts(currentHosts, [], false);
  if (changed) await applyHosts(exec, content);

  console.log("Reloading pf...");
  const reload = await exec("/sbin/pfctl", ["-f", PF_CONF_FILE]);
  if (reload.exitCode !== 0) {
    console.log(`warning: pf reload reported an error: ${reload.stderr.trim()}`);
  }

  if (options.purge) {
    console.log(`Removing ${ROOT_STATE_DIR}...`);
    await rm(ROOT_STATE_DIR, { recursive: true, force: true });
  }

  console.log("Uninstall complete.");
}
