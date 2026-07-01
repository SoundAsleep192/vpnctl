import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { buildTrayPlist, isRosettaAvailable, resolveTrayAgentDomain } from "../src/cli/commands/tray";
import { buildMenu } from "../src/daemon/tray";
import type { Exec } from "../src/core/exec";
import { LAUNCHD_LABEL_TRAY, TRAY_LOG_FILE } from "../src/core/paths";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

describe("buildMenu", () => {
  test("uses embedded PNG icon assets for every tray status", () => {
    for (const status of ["protected", "starting", "fail-closed", "unknown"] as const) {
      const image = Buffer.from(buildMenu(status).icon, "base64");
      expect([...image.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    }
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
