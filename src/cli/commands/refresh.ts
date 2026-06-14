import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { GENERATED_SINGBOX_CONFIG } from "../../core/paths";
import { tickRefresh, tickSinkholeAndAnchor } from "../../daemon/monitor";
import { requireRoot } from "../root";

export interface RefreshOptions {
  exec?: Exec;
}

export async function runRefresh(options: RefreshOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const config = await loadConfig();

  await tickRefresh(exec, config);
  await tickSinkholeAndAnchor(exec, config, GENERATED_SINGBOX_CONFIG, null);
}
