import { describe, expect, test } from "bun:test";
import { deriveVpnctlConfigPath } from "../src/daemon/tunnel";
import { CONFIG_FILE, GENERATED_SINGBOX_CONFIG } from "../src/core/paths";

describe("deriveVpnctlConfigPath", () => {
  test("derives config.json next to the sing-box config install passes in", () => {
    expect(deriveVpnctlConfigPath("/Users/alice/.config/vpnctl/sing-box.json")).toBe("/Users/alice/.config/vpnctl/config.json");
  });

  test("derives from the input path, not the daemon's home (root/launchd case)", () => {
    expect(deriveVpnctlConfigPath("/var/root/.config/vpnctl/sing-box.json")).toBe("/var/root/.config/vpnctl/config.json");
  });

  test("round-trips the canonical install paths", () => {
    expect(deriveVpnctlConfigPath(GENERATED_SINGBOX_CONFIG)).toBe(CONFIG_FILE);
  });
});
