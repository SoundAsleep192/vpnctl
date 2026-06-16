import { describe, expect, test } from "bun:test";
import type { Exec } from "../src/core/exec";
import { stopTunnel } from "../src/core/tunnel-control";

function makeExec(responses: Record<string, { exitCode?: number; stderr?: string }>): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (_cmd, args) => {
    calls.push(args);
    const key = args.join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return { stdout: "", stderr: response.stderr ?? "", exitCode: response.exitCode ?? 0 };
  };
  return { exec, calls };
}

describe("stopTunnel", () => {
  test("disables and boots the daemon out when it is loaded", async () => {
    const { exec, calls } = makeExec({
      "disable system/com.vpnctl.tunnel": {},
      "print system/com.vpnctl.tunnel": {},
      "bootout system/com.vpnctl.tunnel": {},
    });

    expect(await stopTunnel(exec)).toBe("Tunnel daemon disabled and stopped.");
    expect(calls).toEqual([
      ["disable", "system/com.vpnctl.tunnel"],
      ["print", "system/com.vpnctl.tunnel"],
      ["bootout", "system/com.vpnctl.tunnel"],
    ]);
  });

  test("disables only when the daemon is already stopped", async () => {
    const { exec, calls } = makeExec({
      "disable system/com.vpnctl.tunnel": {},
      "print system/com.vpnctl.tunnel": { exitCode: 1, stderr: "Could not find service\n" },
    });

    expect(await stopTunnel(exec)).toBe("Tunnel daemon disabled (already stopped).");
    expect(calls).toEqual([
      ["disable", "system/com.vpnctl.tunnel"],
      ["print", "system/com.vpnctl.tunnel"],
    ]);
  });
});
