import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  removeInstalledArtifacts,
  removePreflightWrappers,
  resolveUninstallUserPaths,
  waitForMonitorStopped,
} from "../src/cli/commands/uninstall";
import type { Exec } from "../src/core/exec";
import { renderPreflightWrapper } from "../src/core/preflight-wrapper";

function pgrepExec(exitCodes: number[]): { exec: Exec; getCalls: () => number } {
  let index = 0;
  const exec: Exec = async () => {
    const exitCode = exitCodes[Math.min(index, exitCodes.length - 1)] ?? 1;
    index++;
    return { stdout: "", stderr: "", exitCode };
  };
  return { exec, getCalls: () => index };
}

describe("waitForMonitorStopped", () => {
  test("polls until pgrep reports the monitor process is gone", async () => {
    const { exec, getCalls } = pgrepExec([0, 0, 1]);
    await waitForMonitorStopped(exec, () => Promise.resolve());
    expect(getCalls()).toBe(3);
  });

  test("returns immediately when the monitor is already gone", async () => {
    const { exec, getCalls } = pgrepExec([1]);
    await waitForMonitorStopped(exec, () => Promise.resolve());
    expect(getCalls()).toBe(1);
  });
});

describe("resolveUninstallUserPaths", () => {
  test("targets the sudo login user while uninstall runs as root", () => {
    const paths = resolveUninstallUserPaths({ HOME: "/var/root", SUDO_USER: "alice", SUDO_UID: "501" }, 0);

    expect(paths.home).toBe("/Users/alice");
    expect(paths.uid).toBe("501");
    expect(paths.configDir).toBe("/Users/alice/.config/vpnctl");
    expect(paths.trayPlistFile).toBe("/Users/alice/Library/LaunchAgents/com.vpnctl.tray.plist");
    expect(paths.auditPlistFile).toBe("/Users/alice/Library/LaunchAgents/com.vpnctl.audit.plist");
    expect(paths.preflightWrapperDir).toBe("/Users/alice/.local/bin");
  });

  test("targets the current user when uninstall is not sudo-backed", () => {
    const paths = resolveUninstallUserPaths({ HOME: "/Users/bob" }, 502);

    expect(paths.home).toBe("/Users/bob");
    expect(paths.uid).toBe("502");
    expect(paths.configDir).toBe("/Users/bob/.config/vpnctl");
  });
});

describe("removePreflightWrappers", () => {
  test("removes only vpnctl-managed preflight wrappers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-uninstall-test-"));

    try {
      await writeFile(path.join(dir, "codex"), renderPreflightWrapper("codex", "/opt/bin/codex"));
      await writeFile(path.join(dir, "plain"), "#!/bin/sh\necho plain\n");

      await removePreflightWrappers(dir);

      expect(await Bun.file(path.join(dir, "codex")).exists()).toBe(false);
      expect(await Bun.file(path.join(dir, "plain")).exists()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("removeInstalledArtifacts", () => {
  test("removes release binaries and tray helper directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-uninstall-artifacts-"));

    try {
      for (const binary of ["vpnctl", "vpnctl-monitor", "vpnctl-tunnel", "vpnctl-tray"]) {
        await writeFile(path.join(dir, binary), binary);
      }
      await mkdir(path.join(dir, "traybin"));
      await writeFile(path.join(dir, "traybin", "tray_darwin_release"), "tray");
      await writeFile(path.join(dir, "other"), "keep");

      await removeInstalledArtifacts(dir);

      for (const artifact of ["vpnctl", "vpnctl-monitor", "vpnctl-tunnel", "vpnctl-tray", "traybin"]) {
        expect(await Bun.file(path.join(dir, artifact)).exists()).toBe(false);
      }
      expect((await stat(path.join(dir, "other"))).isFile()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
