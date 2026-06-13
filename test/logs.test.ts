import { describe, expect, test } from "bun:test";
import { resolveLogFiles } from "../src/cli/commands/logs";
import { MONITOR_LOG_FILE, TUNNEL_LOG_FILE } from "../src/core/paths";

describe("resolveLogFiles", () => {
  test("returns both logs by default", () => {
    expect(resolveLogFiles({})).toEqual([MONITOR_LOG_FILE, TUNNEL_LOG_FILE]);
  });

  test("returns only the monitor log with --monitor", () => {
    expect(resolveLogFiles({ monitor: true })).toEqual([MONITOR_LOG_FILE]);
  });

  test("returns only the tunnel log with --tunnel", () => {
    expect(resolveLogFiles({ tunnel: true })).toEqual([TUNNEL_LOG_FILE]);
  });

  test("returns both logs when --monitor and --tunnel are both given", () => {
    expect(resolveLogFiles({ monitor: true, tunnel: true })).toEqual([MONITOR_LOG_FILE, TUNNEL_LOG_FILE]);
  });
});
