import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Exec, ExecResult } from "../src/core/exec";
import {
  BOOTSTRAP_TEARDOWN_RETRY_ATTEMPTS,
  bootoutDaemon,
  bootstrapDaemon,
  bootstrapTeardownRetryDelayMs,
  disableDaemon,
  enableDaemon,
  installDaemon,
  isLoaded,
  kickstart,
  killService,
  renderPlist,
  uninstallDaemon,
} from "../src/core/launchd";

const noopSleep = (): Promise<void> => Promise.resolve();

describe("renderPlist", () => {
  test("renders a KeepAlive daemon with a ThrottleInterval", () => {
    const plist = renderPlist({
      label: "com.vpnctl.monitor",
      programArguments: ["/Library/Application Support/vpnctl/bin/vpnctl-monitor"],
      runAtLoad: true,
      keepAlive: true,
      throttleIntervalSec: 5,
      stdoutPath: "/Library/Logs/vpnctl/monitor.log",
      stderrPath: "/Library/Logs/vpnctl/monitor.log",
    });

    expect(plist).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict>",
        "\t<key>Label</key>",
        "\t<string>com.vpnctl.monitor</string>",
        "\t<key>ProgramArguments</key>",
        "\t<array>",
        "\t\t<string>/Library/Application Support/vpnctl/bin/vpnctl-monitor</string>",
        "\t</array>",
        "\t<key>RunAtLoad</key>",
        "\t<true/>",
        "\t<key>KeepAlive</key>",
        "\t<true/>",
        "\t<key>ThrottleInterval</key>",
        "\t<integer>5</integer>",
        "\t<key>StandardOutPath</key>",
        "\t<string>/Library/Logs/vpnctl/monitor.log</string>",
        "\t<key>StandardErrorPath</key>",
        "\t<string>/Library/Logs/vpnctl/monitor.log</string>",
        "</dict>",
        "</plist>",
        "",
      ].join("\n"),
    );
  });

  test("renders a non-KeepAlive daemon without RunAtLoad/Throttle, with multiple args", () => {
    const plist = renderPlist({
      label: "com.vpnctl.tunnel",
      programArguments: ["/Library/Application Support/vpnctl/bin/vpnctl-tunnel", "--config", "/etc/vpnctl/sing-box.json"],
      runAtLoad: false,
      keepAlive: false,
      stdoutPath: "/Library/Logs/vpnctl/tunnel.log",
      stderrPath: "/Library/Logs/vpnctl/tunnel.log",
    });

    expect(plist).toContain("\t<key>RunAtLoad</key>\n\t<false/>");
    expect(plist).toContain("\t<key>KeepAlive</key>\n\t<false/>");
    expect(plist).not.toContain("ThrottleInterval");
    expect(plist).not.toContain("StartInterval");
    expect(plist).toContain("\t\t<string>--config</string>");
    expect(plist).toContain("\t\t<string>/etc/vpnctl/sing-box.json</string>");
  });

  test("renders a StartInterval-based agent and escapes XML-sensitive characters", () => {
    const plist = renderPlist({
      label: "com.vpnctl.audit",
      programArguments: ["/usr/local/bin/vpnctl", "audit", "--log"],
      runAtLoad: true,
      keepAlive: false,
      startIntervalSec: 300,
      stdoutPath: "/tmp/a&b<c>.log",
      stderrPath: "/tmp/audit.log",
    });

    expect(plist).toContain("\t<key>StartInterval</key>\n\t<integer>300</integer>");
    expect(plist).toContain("<string>/tmp/a&amp;b&lt;c&gt;.log</string>");
  });
});

describe("installDaemon", () => {
  test("writes the plist, ignores bootout failure, re-enables, and bootstraps", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const plistPath = path.join(dir, "com.vpnctl.monitor.plist");
    const calls: { cmd: string; args: string[] }[] = [];

    try {
      const exec: Exec = async (cmd, args) => {
        calls.push({ cmd, args });
        if (args[0] === "bootout") return { stdout: "", stderr: "no such service\n", exitCode: 1 };
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await installDaemon(exec, "com.vpnctl.monitor", plistPath, "PLIST-CONTENT", "system");

      expect(await readFile(plistPath, "utf8")).toBe("PLIST-CONTENT");
      expect(calls).toEqual([
        { cmd: "/bin/launchctl", args: ["bootout", "system/com.vpnctl.monitor"] },
        { cmd: "/bin/launchctl", args: ["enable", "system/com.vpnctl.monitor"] },
        { cmd: "/bin/launchctl", args: ["bootstrap", "system", plistPath] },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("retries bootstrap when launchd is still tearing down the job (EIO 5), then succeeds", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const plistPath = path.join(dir, "com.vpnctl.monitor.plist");
    let bootstrapCalls = 0;

    try {
      const exec: Exec = async (_cmd, args): Promise<ExecResult> => {
        if (args[0] === "bootstrap") {
          bootstrapCalls += 1;
          return bootstrapCalls < 3
            ? { stdout: "", stderr: "Bootstrap failed: 5: Input/output error\n", exitCode: 1 }
            : { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await installDaemon(exec, "com.vpnctl.monitor", plistPath, "PLIST-CONTENT", "system", noopSleep);

      expect(bootstrapCalls).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("backs off between teardown retries with a capped linear delay", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const plistPath = path.join(dir, "com.vpnctl.monitor.plist");
    const sleeps: number[] = [];
    const recordingSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };

    try {
      const exec: Exec = async (_cmd, args): Promise<ExecResult> => {
        if (args[0] === "bootstrap") {
          return { stdout: "", stderr: "Bootstrap failed: 5: Input/output error\n", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await expect(installDaemon(exec, "com.vpnctl.monitor", plistPath, "PLIST-CONTENT", "system", recordingSleep)).rejects.toThrow(
        /failed to bootstrap/,
      );

      expect(sleeps.slice(0, 4)).toEqual([500, 1000, 1500, 1500]);
      expect(Math.max(...sleeps)).toBe(1500);
      expect(sleeps.length).toBe(BOOTSTRAP_TEARDOWN_RETRY_ATTEMPTS - 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("computes a capped linear backoff delay", () => {
    expect(bootstrapTeardownRetryDelayMs(1)).toBe(500);
    expect(bootstrapTeardownRetryDelayMs(2)).toBe(1000);
    expect(bootstrapTeardownRetryDelayMs(3)).toBe(1500);
    expect(bootstrapTeardownRetryDelayMs(10)).toBe(1500);
  });

  test("gives up after exhausting teardown retries and throws", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const plistPath = path.join(dir, "com.vpnctl.monitor.plist");
    let bootstrapCalls = 0;

    try {
      const exec: Exec = async (_cmd, args): Promise<ExecResult> => {
        if (args[0] === "bootstrap") {
          bootstrapCalls += 1;
          return { stdout: "", stderr: "Bootstrap failed: 5: Input/output error\n", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await expect(installDaemon(exec, "com.vpnctl.monitor", plistPath, "PLIST-CONTENT", "system", noopSleep)).rejects.toThrow(
        /failed to bootstrap/,
      );
      expect(bootstrapCalls).toBe(BOOTSTRAP_TEARDOWN_RETRY_ATTEMPTS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when enable fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const plistPath = path.join(dir, "com.vpnctl.monitor.plist");

    try {
      const exec: Exec = async (_cmd, args): Promise<ExecResult> => {
        if (args[0] === "enable") return { stdout: "", stderr: "enable failed\n", exitCode: 1 };
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await expect(installDaemon(exec, "com.vpnctl.monitor", plistPath, "PLIST-CONTENT", "system")).rejects.toThrow(/failed to enable/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when bootstrap fails with a non-teardown error (no retry)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const plistPath = path.join(dir, "com.vpnctl.monitor.plist");
    let bootstrapCalls = 0;

    try {
      const exec: Exec = async (_cmd, args): Promise<ExecResult> => {
        if (args[0] === "bootstrap") {
          bootstrapCalls += 1;
          return { stdout: "", stderr: "bootstrap failed\n", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await expect(installDaemon(exec, "com.vpnctl.monitor", plistPath, "PLIST-CONTENT", "system")).rejects.toThrow(/failed to bootstrap/);
      expect(bootstrapCalls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("uninstallDaemon", () => {
  test("boots out the service and removes the plist file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const plistPath = path.join(dir, "com.vpnctl.tunnel.plist");
    await writeFile(plistPath, "PLIST-CONTENT");
    const calls: { cmd: string; args: string[] }[] = [];

    try {
      const exec: Exec = async (cmd, args) => {
        calls.push({ cmd, args });
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await uninstallDaemon(exec, "com.vpnctl.tunnel", plistPath, "system");

      expect(calls).toEqual([{ cmd: "/bin/launchctl", args: ["bootout", "system/com.vpnctl.tunnel"] }]);
      await expect(readFile(plistPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("kickstart", () => {
  test("kickstarts a service", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await kickstart(exec, "com.vpnctl.tunnel", "system");
    expect(calls).toEqual([["kickstart", "system/com.vpnctl.tunnel"]]);
  });

  test("kickstarts with -k when kill is requested", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await kickstart(exec, "com.vpnctl.tunnel", "system", true);
    expect(calls).toEqual([["kickstart", "-k", "system/com.vpnctl.tunnel"]]);
  });

  test("throws when launchctl fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "no such service\n", exitCode: 1 });
    await expect(kickstart(exec, "com.vpnctl.tunnel", "system")).rejects.toThrow(/failed to kickstart/);
  });
});

describe("killService", () => {
  test("sends the requested signal", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await killService(exec, "com.vpnctl.tunnel", "system", "TERM");
    expect(calls).toEqual([["kill", "TERM", "system/com.vpnctl.tunnel"]]);
  });

  test("throws when launchctl fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "no such service\n", exitCode: 1 });
    await expect(killService(exec, "com.vpnctl.tunnel", "system", "KILL")).rejects.toThrow(/failed to send KILL/);
  });
});

describe("isLoaded", () => {
  test("returns true when launchctl print succeeds", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    expect(await isLoaded(exec, "com.vpnctl.tunnel", "system")).toBe(true);
    expect(calls).toEqual([["print", "system/com.vpnctl.tunnel"]]);
  });

  test("returns false when launchctl print fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "Could not find service\n", exitCode: 1 });
    expect(await isLoaded(exec, "com.vpnctl.tunnel", "system")).toBe(false);
  });
});

describe("bootstrapDaemon", () => {
  test("bootstraps the plist into the given domain", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await bootstrapDaemon(exec, "com.vpnctl.tunnel", "/Library/LaunchDaemons/com.vpnctl.tunnel.plist", "system");
    expect(calls).toEqual([["bootstrap", "system", "/Library/LaunchDaemons/com.vpnctl.tunnel.plist"]]);
  });

  test("throws when launchctl fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "service already loaded\n", exitCode: 1 });
    await expect(bootstrapDaemon(exec, "com.vpnctl.tunnel", "/path/to.plist", "system")).rejects.toThrow(/failed to bootstrap/);
  });
});

describe("bootoutDaemon", () => {
  test("boots the service out of the given domain", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await bootoutDaemon(exec, "com.vpnctl.tunnel", "system");
    expect(calls).toEqual([["bootout", "system/com.vpnctl.tunnel"]]);
  });

  test("throws when launchctl fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "Could not find service\n", exitCode: 1 });
    await expect(bootoutDaemon(exec, "com.vpnctl.tunnel", "system")).rejects.toThrow(/failed to bootout/);
  });
});

describe("enableDaemon", () => {
  test("enables the service in the given domain", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await enableDaemon(exec, "com.vpnctl.tunnel", "system");
    expect(calls).toEqual([["enable", "system/com.vpnctl.tunnel"]]);
  });

  test("throws when launchctl fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "Could not find service\n", exitCode: 1 });
    await expect(enableDaemon(exec, "com.vpnctl.tunnel", "system")).rejects.toThrow(/failed to enable/);
  });
});

describe("disableDaemon", () => {
  test("disables the service in the given domain", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await disableDaemon(exec, "com.vpnctl.tunnel", "system");
    expect(calls).toEqual([["disable", "system/com.vpnctl.tunnel"]]);
  });

  test("throws when launchctl fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "Could not find service\n", exitCode: 1 });
    await expect(disableDaemon(exec, "com.vpnctl.tunnel", "system")).rejects.toThrow(/failed to disable/);
  });
});
