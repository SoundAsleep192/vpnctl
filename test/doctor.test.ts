import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkAnchorLoaded,
  checkBunVersion,
  checkConfig,
  checkDaemon,
  checkForUpdate,
  checkGeneratedSingBoxConfig,
  checkPfEnabled,
  checkSingBoxBinary,
  checkVpnConflicts,
  formatDoctorReport,
  type DoctorCheck,
} from "../src/cli/commands/doctor";
import type { Config } from "../src/core/config";
import { saveConfig } from "../src/core/config";
import type { Exec } from "../src/core/exec";
import { PF_ANCHOR_NAME } from "../src/core/paths";
import { compareVersions } from "../src/core/version";

function makeExec(responses: Record<string, { stdout?: string; exitCode?: number }>): Exec {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return { stdout: response.stdout ?? "", stderr: "", exitCode: response.exitCode ?? 0 };
  };
}

const validConfig: Config = {
  tunnel: { interfaceName: "utun20", address: "172.19.0.1/30" },
  outbound: {
    type: "vless",
    tag: "proxy",
    server: "vpn.example.com",
    server_port: 443,
    uuid: "00000000-0000-4000-8000-000000000000",
    flow: "xtls-rprx-vision",
    network: "tcp",
    tls: {
      enabled: true,
      server_name: "example.com",
      utls: { enabled: true, fingerprint: "firefox" },
      reality: { enabled: true, public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", short_id: "0123456789abcdef" },
    },
  },
  domains: ["anthropic.com"],
  dns: { servers: ["1.1.1.1", "8.8.8.8"] },
  audit: { processNamePatterns: ["Code", "Cursor"] },
  exec: { blockedCountries: [] },
};

describe("compareVersions", () => {
  test("returns 0 for equal versions", () => {
    expect(compareVersions("1.3.13", "1.3.13")).toBe(0);
  });

  test("returns positive when the first version is newer", () => {
    expect(compareVersions("1.3.14", "1.3.13")).toBeGreaterThan(0);
    expect(compareVersions("1.4.0", "1.3.13")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.3.13")).toBeGreaterThan(0);
  });

  test("returns negative when the first version is older", () => {
    expect(compareVersions("1.3.12", "1.3.13")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.3.13")).toBeLessThan(0);
  });

  test("treats missing trailing components as zero", () => {
    expect(compareVersions("1.3", "1.3.0")).toBe(0);
  });
});

describe("checkBunVersion", () => {
  test("ok when the version meets the minimum", () => {
    expect(checkBunVersion("1.3.14", "1.3.13")).toEqual({
      name: "bun version",
      status: "ok",
      detail: "1.3.14 (>= 1.3.13)",
    });
  });

  test("fail when the version is older than the minimum", () => {
    const check = checkBunVersion("1.2.0", "1.3.13");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("1.2.0");
    expect(check.detail).toContain("1.3.13");
  });
});

describe("checkConfig", () => {
  test("ok for a valid config file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    try {
      await saveConfig(validConfig, configPath);
      expect(await checkConfig(configPath)).toEqual({ name: "config", status: "ok", detail: configPath });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fail when the config file is missing", async () => {
    const check = await checkConfig("/nonexistent/vpnctl-test/config.json");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("config file not found");
  });

  test("fail when the config file is invalid", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    try {
      await writeFile(configPath, "{}");
      const check = await checkConfig(configPath);
      expect(check.status).toBe("fail");
      expect(check.detail).toContain("config file is invalid");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("checkSingBoxBinary", () => {
  test("ok when a candidate path exists", async () => {
    const exists = async (filePath: string): Promise<boolean> => filePath === "/usr/local/bin/sing-box";
    expect(await checkSingBoxBinary(exists)).toEqual({
      name: "sing-box binary",
      status: "ok",
      detail: "/usr/local/bin/sing-box",
    });
  });

  test("fail when no candidate path exists", async () => {
    const exists = async (): Promise<boolean> => false;
    const check = await checkSingBoxBinary(exists);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("sing-box binary not found");
  });
});

describe("checkGeneratedSingBoxConfig", () => {
  test("ok when the generated config exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const singboxConfigPath = path.join(dir, "sing-box.json");
    try {
      await writeFile(singboxConfigPath, "{}");
      expect(await checkGeneratedSingBoxConfig(singboxConfigPath)).toEqual({
        name: "sing-box.json",
        status: "ok",
        detail: singboxConfigPath,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("warn when the generated config is missing", async () => {
    const check = await checkGeneratedSingBoxConfig("/nonexistent/vpnctl-test/sing-box.json");
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("not found");
  });
});

describe("checkPfEnabled", () => {
  test("ok when pf reports enabled", async () => {
    const exec = makeExec({ "/sbin/pfctl -s info": { stdout: "Status: Enabled\n" } });
    expect(await checkPfEnabled(exec)).toEqual({ name: "pf", status: "ok", detail: "enabled" });
  });

  test("warn when pf reports disabled", async () => {
    const exec = makeExec({ "/sbin/pfctl -s info": { stdout: "Status: Disabled\n" } });
    expect(await checkPfEnabled(exec)).toEqual({ name: "pf", status: "warn", detail: "disabled" });
  });
});

describe("checkAnchorLoaded", () => {
  test("ok when the anchor has rules", async () => {
    const exec = makeExec({ [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -s rules`]: { stdout: "block drop log quick ...\n" } });
    expect(await checkAnchorLoaded(exec)).toEqual({ name: `pf anchor "${PF_ANCHOR_NAME}"`, status: "ok", detail: "loaded" });
  });

  test("warn when the anchor is empty", async () => {
    const exec = makeExec({ [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -s rules`]: { stdout: "", exitCode: 1 } });
    expect(await checkAnchorLoaded(exec)).toEqual({ name: `pf anchor "${PF_ANCHOR_NAME}"`, status: "warn", detail: "not loaded" });
  });
});

describe("checkDaemon", () => {
  test("ok when launchctl print succeeds", async () => {
    const exec = makeExec({ "/bin/launchctl print system/com.vpnctl.monitor": { exitCode: 0 } });
    expect(await checkDaemon(exec, "com.vpnctl.monitor")).toEqual({ name: "com.vpnctl.monitor", status: "ok", detail: "loaded" });
  });

  test("warn when launchctl print fails", async () => {
    const exec = makeExec({ "/bin/launchctl print system/com.vpnctl.tunnel": { exitCode: 1 } });
    expect(await checkDaemon(exec, "com.vpnctl.tunnel")).toEqual({ name: "com.vpnctl.tunnel", status: "warn", detail: "not loaded" });
  });
});

describe("checkForUpdate", () => {
  const releaseUrl = "https://api.github.com/repos/SoundAsleep192/vpnctl/releases/latest";
  const releaseCall = `/usr/bin/curl -fsSL --max-time 5 -H User-Agent: vpnctl ${releaseUrl}`;

  async function withTmpCachePath(run: (cachePath: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-doctor-test-"));
    try {
      await run(path.join(dir, "update-check.json"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("warn when a newer release is available", async () => {
    await withTmpCachePath(async (cachePath) => {
      const exec = makeExec({ [releaseCall]: { stdout: JSON.stringify({ tag_name: "v0.2.0" }) } });
      expect(await checkForUpdate(exec, "0.1.5", cachePath)).toEqual({
        name: "update",
        status: "warn",
        detail: "v0.2.0 available — run `vpnctl update`",
      });
    });
  });

  test("ok when already up to date", async () => {
    await withTmpCachePath(async (cachePath) => {
      const exec = makeExec({ [releaseCall]: { stdout: JSON.stringify({ tag_name: "v0.1.5" }) } });
      expect(await checkForUpdate(exec, "0.1.5", cachePath)).toEqual({ name: "update", status: "ok", detail: "up to date (v0.1.5)" });
    });
  });

  test("ok when the release check fails (e.g. offline)", async () => {
    await withTmpCachePath(async (cachePath) => {
      const exec = makeExec({ [releaseCall]: { stdout: "", exitCode: 1 } });
      expect(await checkForUpdate(exec, "0.1.5", cachePath)).toEqual({
        name: "update",
        status: "ok",
        detail: "unable to check for updates — currently v0.1.5",
      });
    });
  });
});

describe("checkVpnConflicts", () => {
  const noInetIfconfig = (name: string): string => `${name}: flags=8010<POINTOPOINT,MULTICAST> mtu 1500\n`;

  test("ok check when no other VPN interfaces detected", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": { stdout: "lo0 en0 utun0\n" },
      "/sbin/ifconfig utun0": { stdout: noInetIfconfig("utun0") },
      "/sbin/route -n get 1.1.1.1": { stdout: "  interface: en0\n" },
    });
    const checks = await checkVpnConflicts(exec, null);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toEqual({ name: "other VPN interfaces", status: "ok", detail: "none detected" });
  });

  test("warn when competing VPN interface detected, no routing conflict", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": { stdout: "lo0 en0 utun20 utun21\n" },
      "/sbin/ifconfig utun21": {
        stdout: "utun21: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380\n\tinet 10.8.0.5 --> 10.8.0.5 netmask 0xffffffff\n",
      },
      "/sbin/route -n get 1.1.1.1": { stdout: "  interface: utun20\n" },
    });
    const singboxConfig = { inbounds: [{ type: "tun", interface_name: "utun20", address: ["172.19.0.1/30"] }] };
    const checks = await checkVpnConflicts(exec, singboxConfig);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("warn");
    expect(checks[0]?.name).toBe("other VPN interfaces");
    expect(checks[0]?.detail).toContain("utun21");
    expect(checks[0]?.detail).not.toContain("vpnctl domains");
    expect(checks[0]?.detail).toContain("vpnctl down");
  });

  test("two warn checks when competing VPN also wins default route", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": { stdout: "lo0 en0 utun20 utun21\n" },
      "/sbin/ifconfig utun21": {
        stdout: "utun21: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380\n\tinet 10.8.0.5 --> 10.8.0.5 netmask 0xffffffff\n",
      },
      "/sbin/route -n get 1.1.1.1": { stdout: "  interface: utun21\n" },
    });
    const singboxConfig = { inbounds: [{ type: "tun", interface_name: "utun20", address: ["172.19.0.1/30"] }] };
    const checks = await checkVpnConflicts(exec, singboxConfig);
    expect(checks).toHaveLength(2);
    expect(checks[0]?.status).toBe("warn");
    expect(checks[1]?.status).toBe("warn");
    expect(checks[1]?.name).toBe("VPN routing conflict");
    expect(checks[1]?.detail).toContain("utun21");
  });

  test("treats malformed singbox config (null) as no trusted interface", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": { stdout: "lo0 en0\n" },
      "/sbin/route -n get 1.1.1.1": { stdout: "  interface: en0\n" },
    });
    const checks = await checkVpnConflicts(exec, null);
    expect(checks[0]?.status).toBe("ok");
  });
});

describe("formatDoctorReport", () => {
  const ok: DoctorCheck = { name: "a", status: "ok", detail: "fine" };
  const warn: DoctorCheck = { name: "b", status: "warn", detail: "meh" };
  const fail: DoctorCheck = { name: "c", status: "fail", detail: "broken" };

  test("reports all-OK when every check passes", () => {
    const output = formatDoctorReport([ok]);
    expect(output).toContain("OK   a: fine");
    expect(output).toContain("all checks OK.");
  });

  test("counts warnings when there are no failures", () => {
    const output = formatDoctorReport([ok, warn]);
    expect(output).toContain("WARN b: meh");
    expect(output).toContain("1 check(s) need attention.");
  });

  test("counts failures over warnings", () => {
    const output = formatDoctorReport([ok, warn, fail]);
    expect(output).toContain("FAIL c: broken");
    expect(output).toContain("1 check(s) failed.");
  });
});
