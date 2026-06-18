import { rm } from "node:fs/promises";
import { loadConfig } from "../../core/config";
import { writeDesiredTunnel } from "../../core/desired-tunnel";
import { reconcileUntilTunnelState } from "../../core/enforcement";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { formatKillswitchNotice } from "../../core/killswitch-notice";
import { YIELD_MODE_FILE } from "../../core/paths";
import { writeStateFile } from "../../core/state-file";
import { stopTunnel } from "../../core/tunnel-control";
import { requireRoot } from "../root";

export interface DownOptions {
  exec?: Exec;
}

export async function runDown(options: DownOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const config = await loadConfig();

  await rm(YIELD_MODE_FILE, { force: true });

  console.log(await stopTunnel(exec));

  // Record the intent so the monitor's desired-state enforcement agrees with us
  // instead of restarting the tunnel on its next tick.
  await writeDesiredTunnel("down");

  const state = await reconcileUntilTunnelState(exec, config, false);

  // Push the verified state to the tray immediately instead of waiting for the
  // monitor's next tick — the file-watching tray flips to fail-closed at once.
  await writeStateFile(state.tunnelUp, state.trustedIface);

  const notice = formatKillswitchNotice(config.domains, state.tunnelUp);
  if (notice !== null) console.log(`\n${notice}`);
}
