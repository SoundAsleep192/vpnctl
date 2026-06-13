import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Config } from "../src/core/config";
import { loadConfig, saveConfig } from "../src/core/config";
import { addDomain, removeDomain, runDomainsAdd, runDomainsList, runDomainsRemove } from "../src/cli/commands/domains";
import { readSingBoxConfig } from "../src/core/singbox-config";

async function captureConsoleLog(fn: () => Promise<void>): Promise<unknown[][]> {
  const logSpy = mock((..._args: unknown[]) => {});
  const originalLog = console.log;
  console.log = logSpy;
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return logSpy.mock.calls;
}

const baseConfig: Config = {
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
  domains: ["anthropic.com", "openai.com"],
  dns: { servers: ["1.1.1.1", "8.8.8.8"] },
  audit: { processNamePatterns: ["Code", "Cursor"] },
  exec: { blockedCountries: [] },
};

describe("addDomain", () => {
  test("appends a new domain", () => {
    expect(addDomain(["a.com"], "b.com")).toEqual({ domains: ["a.com", "b.com"], changed: true });
  });

  test("is a no-op when the domain is already present", () => {
    expect(addDomain(["a.com", "b.com"], "a.com")).toEqual({ domains: ["a.com", "b.com"], changed: false });
  });
});

describe("removeDomain", () => {
  test("removes an existing domain", () => {
    expect(removeDomain(["a.com", "b.com"], "a.com")).toEqual({ domains: ["b.com"], changed: true });
  });

  test("is a no-op when the domain is not present", () => {
    expect(removeDomain(["a.com", "b.com"], "c.com")).toEqual({ domains: ["a.com", "b.com"], changed: false });
  });
});

describe("runDomainsList", () => {
  test("prints each configured domain on its own line", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    try {
      await saveConfig(baseConfig, configPath);

      const calls = await captureConsoleLog(() => runDomainsList({ configPath }));

      expect(calls).toEqual([["anthropic.com"], ["openai.com"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports when no domains are configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    try {
      await saveConfig({ ...baseConfig, domains: [] }, configPath);

      const calls = await captureConsoleLog(() => runDomainsList({ configPath }));

      expect(calls).toEqual([["(no domains configured)"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runDomainsAdd", () => {
  test("adds the domain, saves config, and regenerates sing-box.json", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    const singboxConfigPath = path.join(dir, "sing-box.json");
    try {
      await saveConfig(baseConfig, configPath);

      const calls = await captureConsoleLog(() => runDomainsAdd("claude.ai", { configPath, singboxConfigPath }));

      const updated = await loadConfig(configPath);
      expect(updated.domains).toEqual(["anthropic.com", "openai.com", "claude.ai"]);

      const singboxConfig = await readSingBoxConfig(singboxConfigPath);
      expect(singboxConfig).not.toBeNull();
      expect(calls[0]).toEqual(["Added claude.ai."]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("is a no-op when the domain is already configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    const singboxConfigPath = path.join(dir, "sing-box.json");
    try {
      await saveConfig(baseConfig, configPath);

      const calls = await captureConsoleLog(() => runDomainsAdd("anthropic.com", { configPath, singboxConfigPath }));

      const updated = await loadConfig(configPath);
      expect(updated.domains).toEqual(baseConfig.domains);
      expect(await Bun.file(singboxConfigPath).exists()).toBe(false);
      expect(calls).toEqual([["anthropic.com is already in domains."]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runDomainsRemove", () => {
  test("removes the domain, saves config, and regenerates sing-box.json", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    const singboxConfigPath = path.join(dir, "sing-box.json");
    try {
      await saveConfig(baseConfig, configPath);

      const calls = await captureConsoleLog(() => runDomainsRemove("openai.com", { configPath, singboxConfigPath }));

      const updated = await loadConfig(configPath);
      expect(updated.domains).toEqual(["anthropic.com"]);

      const singboxConfig = await readSingBoxConfig(singboxConfigPath);
      expect(singboxConfig).not.toBeNull();
      expect(calls[0]).toEqual(["Removed openai.com."]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("is a no-op when the domain is not configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const configPath = path.join(dir, "config.json");
    const singboxConfigPath = path.join(dir, "sing-box.json");
    try {
      await saveConfig(baseConfig, configPath);

      const calls = await captureConsoleLog(() => runDomainsRemove("claude.ai", { configPath, singboxConfigPath }));

      const updated = await loadConfig(configPath);
      expect(updated.domains).toEqual(baseConfig.domains);
      expect(await Bun.file(singboxConfigPath).exists()).toBe(false);
      expect(calls).toEqual([["claude.ai is not in domains."]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
