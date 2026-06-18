import { chmod, mkdir } from "node:fs/promises";
import { LOG_DIR, STATE_FILE } from "./paths";

// The tray agent reads this without sudo, so the monitor writes it 0644.
const STATE_FILE_MODE = 0o644;

// State older than this means the monitor daemon stopped ticking (it writes
// every SINKHOLE_TICK_MS = 5s); the tray then shows "unknown" rather than a
// stale green/red that no longer reflects reality.
export const STATE_STALE_MS = 30_000;

export interface VpnState {
  tunnelUp: boolean;
  trustedIface: string | null;
  sinkholeActive: boolean;
  timestamp: number;
}

export type TrayStatus = "protected" | "fail-closed" | "unknown";

export function serializeState(state: VpnState): string {
  return JSON.stringify(state);
}

export function parseStateFile(text: string): VpnState | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  if (!("tunnelUp" in data) || typeof data.tunnelUp !== "boolean") return null;
  if (!("sinkholeActive" in data) || typeof data.sinkholeActive !== "boolean") return null;
  if (!("timestamp" in data) || typeof data.timestamp !== "number") return null;

  const trustedIface = "trustedIface" in data && typeof data.trustedIface === "string" ? data.trustedIface : null;
  return { tunnelUp: data.tunnelUp, trustedIface, sinkholeActive: data.sinkholeActive, timestamp: data.timestamp };
}

export function classifyState(state: VpnState | null, nowMs: number, staleMs: number = STATE_STALE_MS): TrayStatus {
  if (state === null || nowMs - state.timestamp > staleMs) return "unknown";
  return state.tunnelUp ? "protected" : "fail-closed";
}

export async function writeStateFile(tunnelUp: boolean, trustedIface: string | null, nowMs: number = Date.now()): Promise<void> {
  const state: VpnState = { tunnelUp, trustedIface, sinkholeActive: !tunnelUp, timestamp: nowMs };
  await mkdir(LOG_DIR, { recursive: true });
  // LOG_DIR is root-owned but must be traversable by the unprivileged tray agent.
  // chmod after mkdir: recursive mkdir doesn't apply a mode to existing dirs.
  await chmod(LOG_DIR, 0o755);
  await Bun.write(STATE_FILE, serializeState(state));
  await chmod(STATE_FILE, STATE_FILE_MODE);
}
