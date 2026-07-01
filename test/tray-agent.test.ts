import { describe, expect, test } from "bun:test";
import { buildTrayPlist, isRosettaAvailable, resolveTrayAgentDomain } from "../src/cli/commands/tray";
import type { Exec } from "../src/core/exec";
import { LAUNCHD_LABEL_TRAY, TRAY_LOG_FILE } from "../src/core/paths";

function execReturning(exitCode: number): Exec {
  return async () => ({ stdout: "", stderr: "", exitCode });
}

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

describe("resolveTrayAgentDomain", () => {
  test("uses SUDO_UID only while running as root", () => {
    expect(resolveTrayAgentDomain(0, "501")).toBe("gui/501");
    expect(resolveTrayAgentDomain(501, "0")).toBe("gui/501");
  });
});

describe("isRosettaAvailable", () => {
  test("skips the probe and returns true off Apple Silicon", async () => {
    if (process.arch === "arm64") return;
    let probed = false;
    const exec: Exec = async () => {
      probed = true;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    expect(await isRosettaAvailable(exec)).toBe(true);
    expect(probed).toBe(false);
  });

  test("reports availability from the x86_64 probe exit code on arm64", async () => {
    if (process.arch !== "arm64") return;
    expect(await isRosettaAvailable(execReturning(0))).toBe(true);
    expect(await isRosettaAvailable(execReturning(1))).toBe(false);
  });
});
