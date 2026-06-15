import { loadConfig } from "../../core/config";
import { reconcileUntilTunnelState } from "../../core/enforcement";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { formatKillswitchNotice } from "../../core/killswitch-notice";
import { bootoutDaemon, disableDaemon, isLoaded } from "../../core/launchd";
import { LAUNCHD_LABEL_TUNNEL } from "../../core/paths";
import { requireRoot } from "../root";

export async function stopTunnel(exec: Exec): Promise<string> {
  await disableDaemon(exec, LAUNCHD_LABEL_TUNNEL, "system");

  if (!(await isLoaded(exec, LAUNCHD_LABEL_TUNNEL, "system"))) {
    return "Tunnel daemon disabled (already stopped).";
  }

  await bootoutDaemon(exec, LAUNCHD_LABEL_TUNNEL, "system");
  return "Tunnel daemon disabled and stopped.";
}

export interface DownOptions {
  exec?: Exec;
}

export async function runDown(options: DownOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const config = await loadConfig();

  console.log(await stopTunnel(exec));

  const state = await reconcileUntilTunnelState(exec, config, false);

  const notice = formatKillswitchNotice(config.domains, state.tunnelUp);
  if (notice !== null) console.log(`\n${notice}`);
}
