import { mkdir } from "node:fs/promises";
import { loadConfig } from "../../core/config";
import { reconcileTunnelState } from "../../core/enforcement";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { ROOT_STATE_DIR, YIELD_MODE_FILE } from "../../core/paths";
import { requireRoot } from "../root";

export interface YieldOptions {
  exec?: Exec;
}

export async function runYield(options: YieldOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const config = await loadConfig();

  await mkdir(ROOT_STATE_DIR, { recursive: true });
  await Bun.write(YIELD_MODE_FILE, "yield\n");
  await reconcileTunnelState(exec, config);

  console.log(
    "Yield mode active: pf killswitch suspended.\n" +
      "AI tool traffic can flow through your other VPN (unprotected by vpnctl's tunnel).\n" +
      "Run `sudo vpnctl up` to restore full killswitch protection.",
  );
}
