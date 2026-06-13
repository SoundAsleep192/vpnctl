import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { bootstrapDaemon, enableDaemon, isLoaded, kickstart } from "../../core/launchd";
import { LAUNCHD_LABEL_TUNNEL, LAUNCHD_PLIST_TUNNEL } from "../../core/paths";
import { requireRoot } from "../root";

export async function startTunnel(exec: Exec): Promise<string> {
  await enableDaemon(exec, LAUNCHD_LABEL_TUNNEL, "system");

  if (await isLoaded(exec, LAUNCHD_LABEL_TUNNEL, "system")) {
    await kickstart(exec, LAUNCHD_LABEL_TUNNEL, "system", true);
    return "Tunnel daemon enabled and restarted.";
  }

  await bootstrapDaemon(exec, LAUNCHD_LABEL_TUNNEL, LAUNCHD_PLIST_TUNNEL, "system");
  return "Tunnel daemon enabled and started.";
}

export interface UpOptions {
  exec?: Exec;
}

export async function runUp(options: UpOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  console.log(await startTunnel(exec));
}
