import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, type Config } from "../src/core/config";
import {
  DEFAULT_AUDIT_PROCESS_NAME_PATTERNS,
  DEFAULT_DNS_SERVERS,
  DEFAULT_TUN_ADDRESS,
  DEFAULT_TUN_INTERFACE_NAME,
} from "../src/core/paths";

const sampleOutbound = {
  type: "vless" as const,
  tag: "proxy",
  server: "vpn.example.com",
  server_port: 443,
  uuid: "00000000-0000-4000-8000-000000000000",
  flow: "xtls-rprx-vision",
  network: "tcp",
  tls: {
    enabled: true as const,
    server_name: "example.com",
    utls: { enabled: true as const, fingerprint: "firefox" },
    reality: { enabled: true as const, public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", short_id: "0123456789abcdef" },
  },
};

const fullConfig: Config = {
  tunnel: { interfaceName: "utun20", address: "172.19.0.1/30" },
  outbound: sampleOutbound,
  domains: ["anthropic.com", "claude.ai"],
  dns: { servers: ["1.1.1.1", "8.8.8.8"] },
  audit: { processNamePatterns: ["Code", "Cursor"] },
  exec: { blockedCountries: ["RU"] },
};

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-config-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("loadConfig", () => {
  test("loads a fully-specified config unchanged", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "config.json");
      await writeFile(filePath, `${JSON.stringify(fullConfig, null, 2)}\n`);

      expect(await loadConfig(filePath)).toEqual(fullConfig);
    });
  });

  test("fills in defaults for missing optional sections", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "config.json");
      await writeFile(
        filePath,
        JSON.stringify({
          outbound: sampleOutbound,
          domains: ["anthropic.com"],
        }),
      );

      expect(await loadConfig(filePath)).toEqual({
        tunnel: { interfaceName: DEFAULT_TUN_INTERFACE_NAME, address: DEFAULT_TUN_ADDRESS },
        outbound: sampleOutbound,
        domains: ["anthropic.com"],
        dns: { servers: DEFAULT_DNS_SERVERS },
        audit: { processNamePatterns: DEFAULT_AUDIT_PROCESS_NAME_PATTERNS },
        exec: { blockedCountries: [] },
      });
    });
  });

  test("throws a clear error when the config file does not exist", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "missing.json");
      await expect(loadConfig(filePath)).rejects.toThrow(/config file not found/);
    });
  });

  test("throws a clear error on invalid JSON", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "config.json");
      await writeFile(filePath, "{ not json");

      await expect(loadConfig(filePath)).rejects.toThrow(/not valid JSON/);
    });
  });

  test("throws a clear error listing validation issues for missing/invalid fields", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "config.json");
      await writeFile(filePath, JSON.stringify({ domains: "not-an-array" }));

      await expect(loadConfig(filePath)).rejects.toThrow(/outbound/);
      await expect(loadConfig(filePath)).rejects.toThrow(/domains/);
    });
  });
});

describe("saveConfig", () => {
  test("writes a trailing-newline-terminated JSON file and round-trips through loadConfig", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "nested", "config.json");

      await saveConfig(fullConfig, filePath);

      const written = await Bun.file(filePath).text();
      expect(written.endsWith("\n")).toBe(true);
      expect(await loadConfig(filePath)).toEqual(fullConfig);
    });
  });
});
