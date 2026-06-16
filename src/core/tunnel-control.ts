import { bootoutDaemon, bootstrapDaemon, disableDaemon, enableDaemon, isLoaded, kickstart } from "./launchd";
import type { Exec } from "./exec";
import { LAUNCHD_LABEL_TUNNEL, LAUNCHD_PLIST_TUNNEL } from "./paths";

export async function startTunnel(exec: Exec): Promise<string> {
  await enableDaemon(exec, LAUNCHD_LABEL_TUNNEL, "system");

  if (await isLoaded(exec, LAUNCHD_LABEL_TUNNEL, "system")) {
    await kickstart(exec, LAUNCHD_LABEL_TUNNEL, "system", true);
    return "Tunnel daemon enabled and restarted.";
  }

  await bootstrapDaemon(exec, LAUNCHD_LABEL_TUNNEL, LAUNCHD_PLIST_TUNNEL, "system");
  return "Tunnel daemon enabled and started.";
}

export async function stopTunnel(exec: Exec): Promise<string> {
  await disableDaemon(exec, LAUNCHD_LABEL_TUNNEL, "system");

  if (!(await isLoaded(exec, LAUNCHD_LABEL_TUNNEL, "system"))) {
    return "Tunnel daemon disabled (already stopped).";
  }

  await bootoutDaemon(exec, LAUNCHD_LABEL_TUNNEL, "system");
  return "Tunnel daemon disabled and stopped.";
}

export function isTunnelDaemonLoaded(exec: Exec): Promise<boolean> {
  return isLoaded(exec, LAUNCHD_LABEL_TUNNEL, "system");
}
