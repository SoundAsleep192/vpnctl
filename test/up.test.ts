import { describe, expect, test } from "bun:test";
import type { Exec } from "../src/core/exec";
import { LAUNCHD_PLIST_TUNNEL } from "../src/core/paths";
import { startTunnel } from "../src/cli/commands/up";

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

describe("startTunnel", () => {
  test("enables and bootstraps the daemon when it is not loaded", async () => {
    const { exec, calls } = makeExec({
      "enable system/com.vpnctl.tunnel": {},
      "print system/com.vpnctl.tunnel": { exitCode: 1, stderr: "Could not find service\n" },
      [`bootstrap system ${LAUNCHD_PLIST_TUNNEL}`]: {},
    });

    expect(await startTunnel(exec)).toBe("Tunnel daemon enabled and started.");
    expect(calls).toEqual([
      ["enable", "system/com.vpnctl.tunnel"],
      ["print", "system/com.vpnctl.tunnel"],
      ["bootstrap", "system", LAUNCHD_PLIST_TUNNEL],
    ]);
  });

  test("enables and force-restarts the daemon when it is already loaded", async () => {
    const { exec, calls } = makeExec({
      "enable system/com.vpnctl.tunnel": {},
      "print system/com.vpnctl.tunnel": {},
      "kickstart -k system/com.vpnctl.tunnel": {},
    });

    expect(await startTunnel(exec)).toBe("Tunnel daemon enabled and restarted.");
    expect(calls).toEqual([
      ["enable", "system/com.vpnctl.tunnel"],
      ["print", "system/com.vpnctl.tunnel"],
      ["kickstart", "-k", "system/com.vpnctl.tunnel"],
    ]);
  });
});
