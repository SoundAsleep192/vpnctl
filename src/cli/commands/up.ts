import { rm } from "node:fs/promises";
import { loadConfig } from "../../core/config";
import { writeDesiredTunnel } from "../../core/desired-tunnel";
import { reconcileUntilTunnelState } from "../../core/enforcement";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { YIELD_MODE_FILE } from "../../core/paths";
import { writeStateFile } from "../../core/state-file";
import { startTunnel } from "../../core/tunnel-control";
import { requireRoot } from "../root";

export interface UpOptions {
  exec?: Exec;
}

export async function runUp(options: UpOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const config = await loadConfig();

  await rm(YIELD_MODE_FILE, { force: true });

  console.log(await startTunnel(exec));

  // Record the intent so the monitor's desired-state enforcement agrees with us
  // instead of reverting the tunnel on its next tick.
  await writeDesiredTunnel("up");

  const state = await reconcileUntilTunnelState(exec, config, true);

  // Reconcile already waited until the tunnel is genuinely up (or timed out), so
  // this state is truthful — push it to the file-watching tray at once rather
  // than letting it show stale until the monitor's next tick.
  await writeStateFile(state.tunnelUp, state.trustedIface);

  if (!state.tunnelUp) {
    console.log("Tunnel not up yet — traffic to configured domains stays blocked until it connects.");
  }
}
