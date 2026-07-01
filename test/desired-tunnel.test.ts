import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decideTunnelAction,
  enforceDesiredTunnel,
  parseDesiredTunnel,
  readDesiredTunnel,
  writeDesiredTunnel,
  type DesiredTunnel,
} from "../src/core/desired-tunnel";
import type { Exec } from "../src/core/exec";

async function withTmpFile(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-desired-test-"));
  try {
    await run(path.join(dir, "desired-tunnel"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("parseDesiredTunnel", () => {
  test("accepts up/down, trimming whitespace", () => {
    expect(parseDesiredTunnel("up")).toBe("up");
    expect(parseDesiredTunnel("down\n")).toBe("down");
  });

  test("rejects anything else as null", () => {
    expect(parseDesiredTunnel("")).toBeNull();
    expect(parseDesiredTunnel("UP")).toBeNull();
    expect(parseDesiredTunnel("restart")).toBeNull();
  });
});

describe("writeDesiredTunnel / readDesiredTunnel", () => {
  test("round-trips both states", async () => {
    await withTmpFile(async (filePath) => {
      for (const desired of ["up", "down"] satisfies DesiredTunnel[]) {
        await writeDesiredTunnel(desired, filePath);
        expect(await readDesiredTunnel(filePath)).toBe(desired);
      }
    });
  });

  test("returns null when the file is absent", async () => {
    await withTmpFile(async (filePath) => {
      expect(await readDesiredTunnel(filePath)).toBeNull();
    });
  });
});

describe("decideTunnelAction", () => {
  test("starts only when desired-up and the daemon is not loaded", () => {
    expect(decideTunnelAction("up", false)).toBe("start");
    expect(decideTunnelAction("up", true)).toBe("none");
  });

  test("stops only when desired-down and the daemon is loaded", () => {
    expect(decideTunnelAction("down", true)).toBe("stop");
    expect(decideTunnelAction("down", false)).toBe("none");
  });

  test("does nothing without a desired state", () => {
    expect(decideTunnelAction(null, true)).toBe("none");
    expect(decideTunnelAction(null, false)).toBe("none");
  });
});

describe("enforceDesiredTunnel", () => {
  test("stops a loaded tunnel when the desired state is down", async () => {
    await withTmpFile(async (filePath) => {
      await writeDesiredTunnel("down", filePath);

      const calls: string[][] = [];
      const exec: Exec = async (cmd, args) => {
        calls.push([cmd, ...args]);
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      expect(await enforceDesiredTunnel(exec, filePath)).toBe("stop");
      expect(calls).toContainEqual(["/bin/launchctl", "bootout", "system/com.vpnctl.tunnel"]);
    });
  });

  test("does nothing when no desired state is recorded", async () => {
    await withTmpFile(async (filePath) => {
      const calls: string[][] = [];
      const exec: Exec = async (cmd, args) => {
        calls.push([cmd, ...args]);
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      expect(await enforceDesiredTunnel(exec, filePath)).toBe("none");
      expect(calls).toEqual([]);
    });
  });
});
