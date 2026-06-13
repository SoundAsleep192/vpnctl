import { describe, expect, test } from "bun:test";
import { AI_DEV_TOOLS_DOMAINS, buildSetupConfig, parseListInput } from "../src/cli/commands/setup";
import { DEFAULT_AUDIT_PROCESS_NAME_PATTERNS } from "../src/core/paths";

const SAMPLE_URI =
  "vless://00000000-0000-4000-8000-000000000000@vpn.example.com:443" +
  "?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision" +
  "&sni=example.com&fp=firefox&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "&sid=0123456789abcdef&spx=%2F#example-server";

describe("AI_DEV_TOOLS_DOMAINS", () => {
  test("loads a non-empty list of bare hostnames from the template", () => {
    expect(AI_DEV_TOOLS_DOMAINS.length).toBeGreaterThan(0);
    for (const domain of AI_DEV_TOOLS_DOMAINS) {
      expect(domain).not.toContain(" ");
      expect(domain).not.toBe("");
    }
    expect(AI_DEV_TOOLS_DOMAINS).toContain("api.anthropic.com");
  });
});

describe("parseListInput", () => {
  test("splits on commas and trims whitespace", () => {
    expect(parseListInput("a.com, b.com,  c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  test("splits on newlines and drops empty entries", () => {
    expect(parseListInput("a.com\n\nb.com\n")).toEqual(["a.com", "b.com"]);
  });

  test("returns an empty array for blank input", () => {
    expect(parseListInput("   \n  ")).toEqual([]);
  });
});

describe("buildSetupConfig", () => {
  test("builds a full config from setup answers", () => {
    const config = buildSetupConfig({
      uri: SAMPLE_URI,
      domains: ["anthropic.com", "claude.ai"],
      tunnelInterfaceName: "utun20",
      tunnelAddress: "172.19.0.1/30",
      dnsServers: ["1.1.1.1", "8.8.8.8"],
    });

    expect(config).toEqual({
      tunnel: { interfaceName: "utun20", address: "172.19.0.1/30" },
      outbound: {
        type: "vless",
        tag: "example-server",
        server: "vpn.example.com",
        server_port: 443,
        uuid: "00000000-0000-4000-8000-000000000000",
        flow: "xtls-rprx-vision",
        network: "tcp",
        tls: {
          enabled: true,
          server_name: "example.com",
          utls: { enabled: true, fingerprint: "firefox" },
          reality: {
            enabled: true,
            public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            short_id: "0123456789abcdef",
          },
        },
      },
      domains: ["anthropic.com", "claude.ai"],
      dns: { servers: ["1.1.1.1", "8.8.8.8"] },
      audit: { processNamePatterns: DEFAULT_AUDIT_PROCESS_NAME_PATTERNS },
      exec: { blockedCountries: [] },
    });
  });

  test("throws when the URI is invalid", () => {
    expect(() =>
      buildSetupConfig({
        uri: "vmess://not-vless",
        domains: ["anthropic.com"],
        tunnelInterfaceName: "utun20",
        tunnelAddress: "172.19.0.1/30",
        dnsServers: ["1.1.1.1"],
      }),
    ).toThrow(/not a vless/);
  });
});
