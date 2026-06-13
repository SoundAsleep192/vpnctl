import { describe, expect, test } from "bun:test";
import { buildMonitorPlist, buildTunnelPlist, resolveSingBoxPath } from "../src/cli/commands/install";
import {
  CONFIG_FILE,
  GENERATED_SINGBOX_CONFIG,
  LAUNCHD_LABEL_MONITOR,
  LAUNCHD_LABEL_TUNNEL,
  MONITOR_LOG_FILE,
  TUNNEL_LOG_FILE,
} from "../src/core/paths";

describe("resolveSingBoxPath", () => {
  test("returns the first candidate path that exists", async () => {
    const checked: string[] = [];
    const exists = async (filePath: string): Promise<boolean> => {
      checked.push(filePath);
      return filePath === "/usr/local/bin/sing-box";
    };

    expect(await resolveSingBoxPath(exists)).toBe("/usr/local/bin/sing-box");
    expect(checked).toEqual(["/opt/homebrew/bin/sing-box", "/usr/local/bin/sing-box"]);
  });

  test("throws a helpful error when sing-box is nowhere to be found", async () => {
    const exists = async (): Promise<boolean> => false;
    await expect(resolveSingBoxPath(exists)).rejects.toThrow(/sing-box binary not found/);
  });
});

describe("buildMonitorPlist", () => {
  test("runs the monitor source via bun with an explicit --config path", () => {
    const plist = buildMonitorPlist("/Users/nisakhanov/.bun/bin/bun", "/repo/src/daemon/monitor.ts", CONFIG_FILE);

    expect(plist).toEqual({
      label: LAUNCHD_LABEL_MONITOR,
      programArguments: ["/Users/nisakhanov/.bun/bin/bun", "run", "/repo/src/daemon/monitor.ts", "--config", CONFIG_FILE],
      runAtLoad: true,
      keepAlive: true,
      throttleIntervalSec: 5,
      stdoutPath: MONITOR_LOG_FILE,
      stderrPath: MONITOR_LOG_FILE,
    });
  });
});

describe("buildTunnelPlist", () => {
  test("runs the tunnel source via bun with --sing-box and --config", () => {
    const plist = buildTunnelPlist(
      "/Users/nisakhanov/.bun/bin/bun",
      "/repo/src/daemon/tunnel.ts",
      "/opt/homebrew/bin/sing-box",
      GENERATED_SINGBOX_CONFIG,
    );

    expect(plist).toEqual({
      label: LAUNCHD_LABEL_TUNNEL,
      programArguments: [
        "/Users/nisakhanov/.bun/bin/bun",
        "run",
        "/repo/src/daemon/tunnel.ts",
        "--sing-box",
        "/opt/homebrew/bin/sing-box",
        "--config",
        GENERATED_SINGBOX_CONFIG,
      ],
      runAtLoad: true,
      keepAlive: true,
      throttleIntervalSec: 5,
      stdoutPath: TUNNEL_LOG_FILE,
      stderrPath: TUNNEL_LOG_FILE,
    });
  });
});
