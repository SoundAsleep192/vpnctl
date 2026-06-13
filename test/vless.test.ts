import { describe, expect, test } from "bun:test";
import { parseVlessUri } from "../src/core/vless";

const SAMPLE_URI =
  "vless://00000000-0000-4000-8000-000000000000@vpn.example.com:443" +
  "?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision" +
  "&sni=example.com&fp=firefox&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "&sid=0123456789abcdef&spx=%2F#example-server";

describe("parseVlessUri", () => {
  test("parses a VLESS+Reality URI into a sing-box outbound", () => {
    const outbound = parseVlessUri(SAMPLE_URI);

    expect(outbound).toEqual({
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
    });
  });

  test("falls back to the server host as tag when there is no fragment", () => {
    const uri = SAMPLE_URI.replace("#example-server", "");
    const outbound = parseVlessUri(uri);
    expect(outbound.tag).toBe("vpn.example.com");
  });

  test("rejects non-vless schemes", () => {
    expect(() => parseVlessUri("vmess://abc")).toThrow(/not a vless/);
  });

  test("rejects security other than reality", () => {
    const uri = SAMPLE_URI.replace("security=reality", "security=tls");
    expect(() => parseVlessUri(uri)).toThrow(/only supports VLESS\+Reality/);
  });

  test("rejects encryption other than none", () => {
    const uri = SAMPLE_URI.replace("encryption=none", "encryption=aes-128-gcm");
    expect(() => parseVlessUri(uri)).toThrow(/encryption=none/);
  });

  for (const param of ["sni", "fp", "pbk", "sid"]) {
    test(`rejects a Reality URI missing ${param}`, () => {
      const uri = SAMPLE_URI.replace(new RegExp(`[?&]${param}=[^&#]*`), "");
      expect(() => parseVlessUri(uri)).toThrow();
    });
  }
});
