import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Exec } from "../src/core/exec";
import { PF_ANCHOR_NAME, PF_TABLE_V4, PF_TABLE_V6 } from "../src/core/paths";
import { formatStatus, gatherStatus, type StatusResult } from "../src/cli/commands/status";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

const SINKHOLED_HOSTS = fixture("etc-hosts.sinkholed.txt");
const CLEAN_HOSTS = fixture("etc-hosts.clean.txt");

function makeExec(responses: Record<string, { stdout?: string; exitCode?: number }>): {
  exec: Exec;
  calls: string[];
} {
  const calls: string[] = [];
  const exec: Exec = async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    calls.push(key);
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return { stdout: response.stdout ?? "", stderr: "", exitCode: response.exitCode ?? 0 };
  };
  return { exec, calls };
}

describe("gatherStatus", () => {
  let dir: string;
  let pidFile: string;

  const cleanup = async () => rm(dir, { recursive: true, force: true });

  test("reports a fully down state when nothing is running", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    pidFile = path.join(dir, "tunnel.pid");
    await writeFile(pidFile, "1\n");

    try {
      const { exec } = makeExec({
        "/sbin/pfctl -s info": { stdout: "Status: Disabled\n" },
        [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -s rules`]: { stdout: "", exitCode: 1 },
        [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -t ${PF_TABLE_V4} -T show`]: { stdout: "", exitCode: 1 },
        [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -t ${PF_TABLE_V6} -T show`]: { stdout: "", exitCode: 1 },
        "/bin/kill -0 1": { exitCode: 1 },
        "/sbin/route -n get 1.1.1.1": { stdout: "interface: en0\n" },
        "/sbin/route -n get 8.8.8.8": { stdout: "interface: en0\n" },
        "/bin/launchctl print system/com.vpnctl.monitor": { exitCode: 1 },
        "/bin/launchctl print system/com.vpnctl.tunnel": { exitCode: 1 },
      });

      const status = await gatherStatus(exec, null, CLEAN_HOSTS, false, pidFile);

      expect(status).toEqual({
        pfEnabled: false,
        anchorLoaded: false,
        tableV4Count: 0,
        tableV6Count: 0,
        trustedInterface: null,
        publicInterface: null,
        tunnelUp: false,
        singBoxRunning: false,
        monitorDaemonLoaded: false,
        tunnelDaemonLoaded: false,
        sinkholeActive: false,
        publicIp: null,
      });
    } finally {
      await cleanup();
    }
  });

  test("reports an up state when the tunnel is the public interface", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    pidFile = path.join(dir, "tunnel.pid");
    await writeFile(pidFile, "4242\n");

    try {
      const singboxConfig = {
        inbounds: [{ type: "tun", address: ["172.19.0.1/30"] }],
      };

      const { exec } = makeExec({
        "/sbin/pfctl -s info": { stdout: "Status: Enabled\n" },
        [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -s rules`]: { stdout: "block drop log quick ...\n" },
        [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -t ${PF_TABLE_V4} -T show`]: { stdout: "1.2.3.4\n5.6.7.8\n" },
        [`/sbin/pfctl -a ${PF_ANCHOR_NAME} -t ${PF_TABLE_V6} -T show`]: { stdout: "" },
        "/bin/kill -0 4242": { exitCode: 0 },
        "/sbin/route -n get 172.19.0.1": { stdout: "interface: utun20\n" },
        "/sbin/route -n get 1.1.1.1": { stdout: "interface: utun20\n" },
        "/usr/bin/dig +short myip.opendns.com @resolver1.opendns.com": { stdout: "203.0.113.7\n" },
        "/bin/launchctl print system/com.vpnctl.monitor": { exitCode: 0 },
        "/bin/launchctl print system/com.vpnctl.tunnel": { exitCode: 0 },
      });

      const status = await gatherStatus(exec, singboxConfig, SINKHOLED_HOSTS, true, pidFile);

      expect(status).toEqual({
        pfEnabled: true,
        anchorLoaded: true,
        tableV4Count: 2,
        tableV6Count: 0,
        trustedInterface: "utun20",
        publicInterface: "utun20",
        tunnelUp: true,
        singBoxRunning: true,
        monitorDaemonLoaded: true,
        tunnelDaemonLoaded: true,
        sinkholeActive: true,
        publicIp: "203.0.113.7",
      });
    } finally {
      await cleanup();
    }
  });
});

describe("formatStatus", () => {
  const base: StatusResult = {
    pfEnabled: true,
    anchorLoaded: true,
    tableV4Count: 3,
    tableV6Count: 0,
    trustedInterface: "utun20",
    publicInterface: "utun20",
    tunnelUp: true,
    singBoxRunning: true,
    monitorDaemonLoaded: true,
    tunnelDaemonLoaded: true,
    sinkholeActive: false,
    publicIp: null,
  };

  test("renders human-readable sections", () => {
    const output = formatStatus(base);

    expect(output).toContain("pf: enabled");
    expect(output).toContain(`table <${PF_TABLE_V4}>: 3 entries`);
    expect(output).toContain("trusted interface: utun20");
    expect(output).toContain("public interface: utun20");
    expect(output).toContain("tunnel: up");
    expect(output).toContain("sing-box: running");
    expect(output).toContain("com.vpnctl.monitor: loaded");
    expect(output).toContain("com.vpnctl.tunnel: loaded");
    expect(output).toContain("/etc/hosts: inactive");
    expect(output).not.toContain("public ip");
  });

  test("includes the public ip section when present", () => {
    const output = formatStatus({ ...base, publicIp: "203.0.113.7" });
    expect(output).toContain("=== public ip ===\n203.0.113.7");
  });

  test("renders down/none states", () => {
    const output = formatStatus({
      ...base,
      pfEnabled: false,
      anchorLoaded: false,
      trustedInterface: null,
      publicInterface: null,
      tunnelUp: false,
      singBoxRunning: false,
      monitorDaemonLoaded: false,
      tunnelDaemonLoaded: false,
      sinkholeActive: true,
    });

    expect(output).toContain("pf: disabled");
    expect(output).toContain('anchor "vpnctl": not loaded');
    expect(output).toContain("trusted interface: none");
    expect(output).toContain("public interface: none");
    expect(output).toContain("tunnel: down");
    expect(output).toContain("sing-box: not running");
    expect(output).toContain("com.vpnctl.monitor: not loaded");
    expect(output).toContain("/etc/hosts: active");
  });
});
