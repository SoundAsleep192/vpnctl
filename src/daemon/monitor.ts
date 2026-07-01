import { mkdir, rm } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import type { Config } from "../core/config";
import { loadConfig } from "../core/config";
import { enforceDesiredTunnel, readDesiredTunnel } from "../core/desired-tunnel";
import { resolveAll, writeTable } from "../core/dns-refresh";
import { reconcileTunnelState } from "../core/enforcement";
import type { Exec } from "../core/exec";
import { realExec } from "../core/exec";
import { isSingBoxRunning, tunnelStateChanged, type TunnelState } from "../core/network";
import { CACHE_V4_FILE, CACHE_V6_FILE, CONFIG_FILE, PF_TABLE_V4, PF_TABLE_V6, TUNNEL_PID_FILE, YIELD_MODE_FILE } from "../core/paths";
import { writeStateFile } from "../core/state-file";
import { resolveReconcileIntervalMs } from "./reconcile-interval";

const REFRESH_TICK_MS = 10 * 60 * 1000;
const DESIRED_POLL_MS = 1_000;

function log(message: string): void {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

function parseArgs(argv: string[]): { configPath: string; singboxConfigPath: string; desiredTunnelPath: string } {
  let configPath = CONFIG_FILE;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config") configPath = argv[++i] ?? configPath;
  }

  const configDir = path.dirname(configPath);
  return {
    configPath,
    singboxConfigPath: path.join(configDir, "sing-box.json"),
    desiredTunnelPath: path.join(configDir, "desired-tunnel"),
  };
}

export async function tickSinkholeAndAnchor(
  exec: Exec,
  config: Config,
  singboxConfigPath: string,
  previousState: TunnelState | null,
): Promise<TunnelState> {
  const state = await reconcileTunnelState(exec, config, singboxConfigPath);

  if (tunnelStateChanged(previousState, state)) {
    log(`sinkhole ${state.tunnelUp ? "cleared" : "applied"} (trustedIface=${state.trustedIface ?? "none"})`);
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
  const { configPath, singboxConfigPath, desiredTunnelPath } = parseArgs(process.argv.slice(2));
  const config = await loadConfig(configPath);

  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  log("monitor daemon starting");

  // Yield mode must not survive a daemon restart (reboot, crash, update). Clear it
  // at startup so the killswitch always starts fail-closed.
  await rm(YIELD_MODE_FILE, { force: true });

  let tunnelState: TunnelState | null = null;

  // Enforce the tray/CLI's desired tunnel state before reconciling, in its own
  // try: a failure here must never skip the sinkhole/anchor reconcile that keeps
  // the killswitch fail-closed.
  const enforceTunnel = async (): Promise<void> => {
    try {
      const action = await enforceDesiredTunnel(exec, desiredTunnelPath);
      if (action === "none") return;
      log(`desired-state: tunnel ${action === "start" ? "started" : "stopped"}`);
      // Stopping is instantly truthful (the daemon is down now), so flip the tray
      // to fail-closed at once rather than after the slower sinkhole reconcile.
      // Starting is not — the tunnel still has to connect — so let the reconcile
      // confirm "up" before the tray goes green.
      if (action === "stop") await writeStateFile(false, null);
      if (action === "start") await writeStateFile(false, null, Date.now(), true);
    } catch (error) {
      log(`ERROR desired-tunnel enforce: ${(error as Error).message}`);
    }
  };

  const runTick = async (): Promise<void> => {
    await enforceTunnel();
    try {
      tunnelState = await tickSinkholeAndAnchor(exec, config, singboxConfigPath, tunnelState);
      const tunnelStarting = !tunnelState.tunnelUp && (await isSingBoxRunning(exec, TUNNEL_PID_FILE).catch(() => false));
      await writeStateFile(tunnelState.tunnelUp, tunnelState.trustedIface, Date.now(), tunnelStarting);
    } catch (error) {
      log(`ERROR sinkhole/anchor tick: ${(error as Error).message}`);
    }
  };

  // Serialize ticks so the desired-state file watcher and the periodic timer can
  // never reconcile pf/launchd concurrently; a request that lands mid-tick runs
  // once more right after, so a tray click still takes effect immediately.
  let ticking = false;
  let tickRequested = false;
  const runTickSerialized = async (): Promise<void> => {
    if (ticking) {
      tickRequested = true;
      return;
    }
    ticking = true;
    try {
      do {
        tickRequested = false;
        await runTick();
      } while (tickRequested && !stopping);
    } finally {
      ticking = false;
    }
  };

  const runRefresh = async (): Promise<void> => {
    try {
      await tickRefresh(exec, config);
    } catch (error) {
      log(`ERROR refresh tick: ${(error as Error).message}`);
    }
  };

  // React to a tray/CLI desired-state write at once instead of waiting up to a
  // full tick. Watch the directory so it survives the file being replaced.
  const desiredFileName = path.basename(desiredTunnelPath);
  const watcher = watch(path.dirname(desiredTunnelPath), (_event, filename) => {
    if (filename === desiredFileName) void runTickSerialized();
  });

  await runTickSerialized();
  await runRefresh();

  let lastDesired = await readDesiredTunnel(desiredTunnelPath);
  let sinceReconcileMs = 0;
  let sinceRefreshMs = 0;
  while (!stopping) {
    await Bun.sleep(DESIRED_POLL_MS);
    if (stopping) break;
    sinceReconcileMs += DESIRED_POLL_MS;
    sinceRefreshMs += DESIRED_POLL_MS;

    const desired = await readDesiredTunnel(desiredTunnelPath);
    // Only an explicit up/down write is an intent change worth acting on. Treat
    // the file disappearing (e.g. uninstall cleaning it up) as "no opinion", not
    // a trigger — otherwise a lingering monitor would reconcile mid-uninstall and
    // recreate the pf anchor / sinkhole that uninstall just removed.
    if (desired !== null && desired !== lastDesired) {
      lastDesired = desired;
      sinceReconcileMs = 0;
      await runTickSerialized();
    } else if (desired !== lastDesired) {
      lastDesired = desired;
    } else if (sinceReconcileMs >= resolveReconcileIntervalMs(desired, tunnelState)) {
      sinceReconcileMs = 0;
      await runTickSerialized();
    }

    if (sinceRefreshMs >= REFRESH_TICK_MS) {
      sinceRefreshMs = 0;
      await runRefresh();
    }
  }

  watcher.close();
  log("monitor daemon exiting on signal");
}

if (import.meta.main) {
  await main();
}
