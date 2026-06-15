import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../core/config";
import { realExec } from "../core/exec";
import type { TunnelState } from "../core/network";
import { CONFIG_FILE, GENERATED_SINGBOX_CONFIG, TUNNEL_PID_FILE } from "../core/paths";
import { tickSinkholeAndAnchor } from "./monitor";

const RECONCILE_TICK_MS = 5_000;

function log(message: string): void {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

function parseArgs(argv: string[]): { singBoxPath: string; configPath: string } {
  let singBoxPath: string | undefined;
  let configPath = GENERATED_SINGBOX_CONFIG;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sing-box") singBoxPath = argv[++i];
    else if (arg === "--config") configPath = argv[++i] ?? configPath;
  }

  if (singBoxPath === undefined) {
    throw new Error("missing required --sing-box <path> argument");
  }

  return { singBoxPath, configPath };
}

// The tunnel daemon is launched by launchd as root, where os.homedir() resolves to
// /var/root — so loadConfig()'s home-based CONFIG_FILE default points at a config that
// doesn't exist and the daemon crashes (#6 regression). Derive the vpnctl config path
// from the absolute sing-box config path install passes in (both live in the same
// config dir), mirroring how monitor derives sing-box.json from its --config arg.
export function deriveVpnctlConfigPath(singboxConfigPath: string): string {
  return path.join(path.dirname(singboxConfigPath), path.basename(CONFIG_FILE));
}

async function main(): Promise<void> {
  const { singBoxPath, configPath } = parseArgs(process.argv.slice(2));

  log(`starting ${singBoxPath} run -c ${configPath}`);

  const child = Bun.spawn([singBoxPath, "run", "-c", configPath], {
    stdout: "inherit",
    stderr: "inherit",
  });

  await mkdir(path.dirname(TUNNEL_PID_FILE), { recursive: true });
  await Bun.write(TUNNEL_PID_FILE, `${child.pid}\n`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // Reconcile pf anchor + sinkhole against this tunnel's own state independently
  // of the monitor daemon, so enforcement converges even if monitor's RunAtLoad
  // spawn stalls at boot (#6) — the tunnel daemon is the one proven to spawn
  // reliably, and reconcileTunnelState is idempotent/safe to call redundantly.
  const config = await loadConfig(deriveVpnctlConfigPath(configPath));
  let tunnelState: TunnelState | null = null;
  const reconcileLoop = async (): Promise<void> => {
    while (!stopping) {
      try {
        tunnelState = await tickSinkholeAndAnchor(realExec, config, configPath, tunnelState);
      } catch (error) {
        log(`ERROR reconcile tick: ${(error as Error).message}`);
      }
      if (stopping) break;
      await Bun.sleep(RECONCILE_TICK_MS);
    }
  };
  void reconcileLoop();

  const exitCode = await child.exited;

  await rm(TUNNEL_PID_FILE, { force: true });
  log(`sing-box exited with code ${exitCode}`);
  process.exit(stopping ? 0 : exitCode);
}

if (import.meta.main) {
  await main();
}
