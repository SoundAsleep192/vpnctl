import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Exec } from "./exec";
import { DESIRED_TUNNEL_FILE } from "./paths";
import { isTunnelDaemonLoaded, startTunnel, stopTunnel } from "./tunnel-control";

export type DesiredTunnel = "up" | "down";

export function parseDesiredTunnel(text: string): DesiredTunnel | null {
  const value = text.trim();
  return value === "up" || value === "down" ? value : null;
}

export async function readDesiredTunnel(filePath: string): Promise<DesiredTunnel | null> {
  const text = await Bun.file(filePath)
    .text()
    .catch(() => null);
  return text === null ? null : parseDesiredTunnel(text);
}

export async function writeDesiredTunnel(desired: DesiredTunnel, filePath: string = DESIRED_TUNNEL_FILE): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, `${desired}\n`);
}

// The monitor's only privileged action on behalf of the unprivileged tray:
// reconcile the tunnel daemon toward the requested state. Pure decision so it's
// unit-testable; the effectful wrapper below applies it.
export function decideTunnelAction(desired: DesiredTunnel | null, tunnelDaemonLoaded: boolean): "start" | "stop" | "none" {
  if (desired === "up" && !tunnelDaemonLoaded) return "start";
  if (desired === "down" && tunnelDaemonLoaded) return "stop";
  return "none";
}

export async function enforceDesiredTunnel(exec: Exec, filePath: string): Promise<"start" | "stop" | "none"> {
  const desired = await readDesiredTunnel(filePath);
  if (desired === null) return "none";

  const action = decideTunnelAction(desired, await isTunnelDaemonLoaded(exec));
  if (action === "start") await startTunnel(exec);
  else if (action === "stop") await stopTunnel(exec);

  return action;
}
