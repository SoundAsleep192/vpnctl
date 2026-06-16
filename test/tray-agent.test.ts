import { describe, expect, test } from "bun:test";
import { buildTrayPlist } from "../src/cli/commands/tray";
import { LAUNCHD_LABEL_TRAY, TRAY_LOG_FILE } from "../src/core/paths";

describe("buildTrayPlist", () => {
  test("keeps the tray daemon alive at load, logging to the tray log", () => {
    const plist = buildTrayPlist(["/Users/nisakhanov/.local/bin/vpnctl-tray"]);

    expect(plist).toEqual({
      label: LAUNCHD_LABEL_TRAY,
      programArguments: ["/Users/nisakhanov/.local/bin/vpnctl-tray"],
      runAtLoad: true,
      keepAlive: true,
      throttleIntervalSec: 5,
      stdoutPath: TRAY_LOG_FILE,
      stderrPath: TRAY_LOG_FILE,
    });
  });
});
