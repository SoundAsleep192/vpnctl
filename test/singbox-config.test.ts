import { describe, expect, test } from "bun:test";
import { buildSingBoxConfig, deriveDomainSuffixes } from "../src/core/singbox-config";
import { parseVlessUri } from "../src/core/vless";
import { sampleConfig } from "./fixtures/sing-box-config.sample";

const SAMPLE_URI =
  "vless://00000000-0000-4000-8000-000000000000@vpn.example.com:443" +
  "?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision" +
  "&sni=example.com&fp=firefox&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "&sid=0123456789abcdef&spx=%2F#example-server";

const AI_DEV_TOOLS_DOMAINS = [
  "api.anthropic.com",
  "console.anthropic.com",
  "claude.ai",
  "console.claude.ai",
  "statsig.anthropic.com",
  "accounts.anthropic.com",
  "log.anthropic.com",
  "cdn.anthropic.com",
  "www.anthropic.com",
  "anthropic.com",
  "cursor.com",
  "www.cursor.com",
  "api2.cursor.sh",
  "api3.cursor.sh",
  "api4.cursor.sh",
  "repo42.cursor.sh",
  "aiserver.cursor.sh",
  "authenticator.cursor.sh",
  "us-asia.gcp.api.cursor.sh",
  "us-east-c.gcp.api.cursor.sh",
  "marketplace.cursorapi.com",
  "api.openai.com",
  "api.chatgpt.com",
  "openai.com",
  "www.openai.com",
  "platform.openai.com",
  "chat.openai.com",
  "cdn.openai.com",
  "auth.openai.com",
  "login.openai.com",
  "chatgpt.com",
  "www.chatgpt.com",
  "ab.chatgpt.com",
  "realtime.chatgpt.com",
  "files.oaiusercontent.com",
  "oaistatic.com",
  "help.openai.com",
  "browser.chatgpt.com",
  "operator.chatgpt.com",
  "sdk.openai.com",
  "status.openai.com",
];

describe("deriveDomainSuffixes", () => {
  test("collapses FQDNs to deduped registrable-domain suffixes, in first-seen order", () => {
    expect(deriveDomainSuffixes(AI_DEV_TOOLS_DOMAINS)).toEqual([
      "anthropic.com",
      "claude.ai",
      "cursor.com",
      "cursor.sh",
      "cursorapi.com",
      "openai.com",
      "chatgpt.com",
      "oaiusercontent.com",
      "oaistatic.com",
    ]);
  });
});

describe("buildSingBoxConfig", () => {
  test("matches the verified sing-box config structure for the AI dev tools preset", () => {
    const outbound = parseVlessUri(SAMPLE_URI);

    const config = buildSingBoxConfig({
      outbound,
      domains: AI_DEV_TOOLS_DOMAINS,
      tun: { interfaceName: "utun20", address: "172.19.0.1/30" },
    });

    expect(config).toEqual(sampleConfig);
  });
});
