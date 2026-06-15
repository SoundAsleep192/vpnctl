import { describe, expect, test } from "bun:test";
import { formatKillswitchNotice } from "../src/core/killswitch-notice";

describe("formatKillswitchNotice", () => {
  test("returns null when the tunnel is up", () => {
    expect(formatKillswitchNotice(["api.anthropic.com"], true)).toBeNull();
  });

  test("returns null when no domains are configured", () => {
    expect(formatKillswitchNotice([], false)).toBeNull();
  });

  test("lists a single blocked domain without truncation", () => {
    const notice = formatKillswitchNotice(["api.anthropic.com"], false);

    expect(notice).toContain("killswitch protection: the VPN tunnel is down");
    expect(notice).toContain("(api.anthropic.com)");
    expect(notice).not.toContain("more");
    expect(notice).toContain("Run `sudo vpnctl up` to restore the tunnel.");
  });

  test("lists up to three domains without truncation", () => {
    const notice = formatKillswitchNotice(["a.example", "b.example", "c.example"], false);

    expect(notice).toContain("(a.example, b.example, c.example)");
    expect(notice).not.toContain("more");
  });

  test("truncates to three examples and counts the remainder", () => {
    const notice = formatKillswitchNotice(["a.example", "b.example", "c.example", "d.example"], false);

    expect(notice).toContain("(a.example, b.example, c.example, and 1 more)");
  });

  test("truncates a large domain list", () => {
    const domains = Array.from({ length: 41 }, (_, index) => `domain${index}.example`);
    const notice = formatKillswitchNotice(domains, false);

    expect(notice).toContain("(domain0.example, domain1.example, domain2.example, and 38 more)");
  });
});
