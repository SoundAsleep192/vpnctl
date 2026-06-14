import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../core/config";
import { loadConfig } from "../core/config";
import { resolveAll, writeTable } from "../core/dns-refresh";
import type { Exec } from "../core/exec";
import { realExec } from "../core/exec";
import { getTunnelState, tunnelStateChanged, type TunnelState } from "../core/network";
import { CACHE_V4_FILE, CACHE_V6_FILE, CONFIG_FILE, HOSTS_FILE, PF_TABLE_V4, PF_TABLE_V6, TUNNEL_PID_FILE } from "../core/paths";
import { generateAnchorRules, writeAnchor } from "../core/pf-anchor";
import { applyHosts, computeHosts } from "../core/sinkhole";
import { readSingBoxConfig } from "../core/singbox-config";

const SINKHOLE_TICK_MS = 5_000;
const REFRESH_TICK_MS = 10 * 60 * 1000;

function log(message: string): void {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

function parseArgs(argv: string[]): { configPath: string; singboxConfigPath: string } {
  let configPath = CONFIG_FILE;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config") configPath = argv[++i] ?? configPath;
  }

  return { configPath, singboxConfigPath: path.join(path.dirname(configPath), "sing-box.json") };
}

export async function tickSinkholeAndAnchor(
  exec: Exec,
  config: Config,
  singboxConfigPath: string,
  previousState: TunnelState | null,
): Promise<TunnelState> {
  const singboxConfig = await readSingBoxConfig(singboxConfigPath);
  const state = await getTunnelState(exec, singboxConfig, TUNNEL_PID_FILE);
  const { trustedIface, tunnelUp } = state;

  const currentHosts = await Bun.file(HOSTS_FILE).text();
  const { content, changed } = computeHosts(currentHosts, config.domains, !tunnelUp);
  if (changed) await applyHosts(exec, content);

  await writeAnchor(exec, generateAnchorRules({ trustedIface }));

  if (tunnelStateChanged(previousState, state)) {
    log(`sinkhole ${tunnelUp ? "cleared" : "applied"} (trustedIface=${trustedIface ?? "none"})`);
  }

  return state;
}

export async function tickRefresh(exec: Exec, config: Config): Promise<void> {
  const { v4, v6 } = await resolveAll(exec, config.domains, config.dns.servers);

  if (v4.length === 0) {
    log("WARN: no v4 IPs resolved, leaving pf tables untouched");
    return;
  }

  await writeTable(exec, PF_TABLE_V4, v4);
  await mkdir(path.dirname(CACHE_V4_FILE), { recursive: true });
  await Bun.write(CACHE_V4_FILE, `${v4.join("\n")}\n`);

  if (v6.length > 0) {
    await writeTable(exec, PF_TABLE_V6, v6);
    await Bun.write(CACHE_V6_FILE, `${v6.join("\n")}\n`);
  }

  log(`refresh OK: v4=${v4.length} v6=${v6.length}`);
}

async function main(): Promise<void> {
  const exec = realExec;
  const { configPath, singboxConfigPath } = parseArgs(process.argv.slice(2));
  const config = await loadConfig(configPath);

  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  log("monitor daemon starting");

  let tunnelState: TunnelState | null = null;

  const runTick = async (): Promise<void> => {
    try {
      tunnelState = await tickSinkholeAndAnchor(exec, config, singboxConfigPath, tunnelState);
    } catch (error) {
      log(`ERROR sinkhole/anchor tick: ${(error as Error).message}`);
    }
  };

  const runRefresh = async (): Promise<void> => {
    try {
      await tickRefresh(exec, config);
    } catch (error) {
      log(`ERROR refresh tick: ${(error as Error).message}`);
    }
  };

  await runTick();
  await runRefresh();

  let elapsedMs = 0;
  while (!stopping) {
    await Bun.sleep(SINKHOLE_TICK_MS);
    if (stopping) break;
    elapsedMs += SINKHOLE_TICK_MS;

    await runTick();

    if (elapsedMs >= REFRESH_TICK_MS) {
      elapsedMs = 0;
      await runRefresh();
    }
  }

  log("monitor daemon exiting on signal");
}

if (import.meta.main) {
  await main();
}
