import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Exec, ExecResult } from "../src/core/exec";
import { detectOtherVpnInterfaces, detectVpnConflicts, getConfiguredTunInterface, parseDnsConflicts } from "../src/core/vpn-conflicts";
import { sampleConfig } from "./fixtures/sing-box-config.sample";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function makeExec(responses: Record<string, string | ExecResult>): Exec {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return typeof response === "string" ? { stdout: response, stderr: "", exitCode: 0 } : response;
  };
}

const noInetIfconfig = (name: string): string => `${name}: flags=8010<POINTOPOINT,MULTICAST> mtu 1500\n`;

const IFCONFIG_LU_WITH_COMPETING = "lo0 en0 utun0 utun1 utun20 utun21 ppp0\n";

const ROUTE_GET_1_1_1_1_VIA_UTUN20 = `   route to: 1.1.1.1\ndestination: default\n  interface: utun20\n`;
const ROUTE_GET_1_1_1_1_VIA_UTUN21 = `   route to: 1.1.1.1\ndestination: default\n  interface: utun21\n`;
const ROUTE_GET_1_1_1_1_VIA_PPP0 = `   route to: 1.1.1.1\ndestination: default\n  interface: ppp0\n`;
const ROUTE_GET_1_1_1_1_VIA_EN0 = `   route to: 1.1.1.1\ndestination: default\n  interface: en0\n`;

describe("getConfiguredTunInterface", () => {
  test("extracts interface_name from tun inbound", () => {
    expect(getConfiguredTunInterface(sampleConfig)).toBe("utun20");
  });

  test("returns null when config has no tun inbound", () => {
    expect(getConfiguredTunInterface({ inbounds: [{ type: "socks", listen: "127.0.0.1" }] })).toBeNull();
  });

  test("returns null for non-object input", () => {
    expect(getConfiguredTunInterface(null)).toBeNull();
    expect(getConfiguredTunInterface("not a config")).toBeNull();
  });
});

describe("detectOtherVpnInterfaces", () => {
  test("returns empty list when no other VPN interfaces are up", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": "lo0 en0 utun0 utun20\n",
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
    });
    expect(await detectOtherVpnInterfaces(exec, "utun20")).toEqual([]);
  });

  test("detects a utun interface not owned by vpnctl", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": IFCONFIG_LU_WITH_COMPETING,
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
      "/sbin/ifconfig utun1": noInetIfconfig("utun1"),
      "/sbin/ifconfig utun21": fixture("ifconfig-utun21-other.txt"),
      "/sbin/ifconfig ppp0": fixture("ifconfig-ppp0.txt"),
    });
    const result = await detectOtherVpnInterfaces(exec, "utun20");
    expect(result).toEqual([
      { name: "utun21", inet: "10.8.0.5" },
      { name: "ppp0", inet: "192.168.100.2" },
    ]);
  });

  test("excludes the trusted vpnctl interface", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": "lo0 en0 utun20\n",
    });
    const result = await detectOtherVpnInterfaces(exec, "utun20");
    expect(result).toEqual([]);
  });

  test("detects ppp interface without a trusted interface configured", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": "lo0 en0 ppp0\n",
      "/sbin/ifconfig ppp0": fixture("ifconfig-ppp0.txt"),
    });
    const result = await detectOtherVpnInterfaces(exec, null);
    expect(result).toEqual([{ name: "ppp0", inet: "192.168.100.2" }]);
  });

  test("ignores interfaces without an inet address", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": "lo0 en0 utun0 utun1\n",
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
      "/sbin/ifconfig utun1": noInetIfconfig("utun1"),
    });
    expect(await detectOtherVpnInterfaces(exec, null)).toEqual([]);
  });
});

describe("parseDnsConflicts", () => {
  test("returns empty when no resolver is bound to a known VPN interface", () => {
    expect(parseDnsConflicts(fixture("scutil-dns-no-vpn.txt"), new Set(["utun21"]))).toEqual([]);
  });

  test("returns conflict when a resolver is bound to a known VPN interface", () => {
    const result = parseDnsConflicts(fixture("scutil-dns-vpn.txt"), new Set(["utun21"]));
    expect(result).toEqual([{ iface: "utun21", servers: ["192.168.151.5", "172.18.148.3"] }]);
  });

  test("ignores resolvers bound to interfaces not in the VPN set", () => {
    expect(parseDnsConflicts(fixture("scutil-dns-vpn.txt"), new Set(["ppp0"]))).toEqual([]);
  });

  test("returns empty for empty output", () => {
    expect(parseDnsConflicts("", new Set(["utun21"]))).toEqual([]);
  });
});

describe("detectVpnConflicts", () => {
  test("no conflicts when vpnctl tunnel is the default route and no other VPN interfaces", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": "lo0 en0 utun0 utun20\n",
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
      "/sbin/route -n get 1.1.1.1": ROUTE_GET_1_1_1_1_VIA_UTUN20,
    });
    const result = await detectVpnConflicts(exec, "utun20");
    expect(result.otherInterfaces).toEqual([]);
    expect(result.routingConflict).toBeNull();
    expect(result.dnsConflicts).toEqual([]);
  });

  test("routing conflict when a competing utun is the default route", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": IFCONFIG_LU_WITH_COMPETING,
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
      "/sbin/ifconfig utun1": noInetIfconfig("utun1"),
      "/sbin/ifconfig utun21": fixture("ifconfig-utun21-other.txt"),
      "/sbin/ifconfig ppp0": fixture("ifconfig-ppp0.txt"),
      "/sbin/route -n get 1.1.1.1": ROUTE_GET_1_1_1_1_VIA_UTUN21,
      "/usr/sbin/scutil --dns": fixture("scutil-dns-no-vpn.txt"),
    });
    const result = await detectVpnConflicts(exec, "utun20");
    expect(result.routingConflict).toBe("utun21");
    expect(result.dnsConflicts).toEqual([]);
  });

  test("DNS conflict when competing VPN pushes custom DNS servers", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": IFCONFIG_LU_WITH_COMPETING,
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
      "/sbin/ifconfig utun1": noInetIfconfig("utun1"),
      "/sbin/ifconfig utun21": fixture("ifconfig-utun21-other.txt"),
      "/sbin/ifconfig ppp0": fixture("ifconfig-ppp0.txt"),
      "/sbin/route -n get 1.1.1.1": ROUTE_GET_1_1_1_1_VIA_UTUN20,
      "/usr/sbin/scutil --dns": fixture("scutil-dns-vpn.txt"),
    });
    const result = await detectVpnConflicts(exec, "utun20");
    expect(result.dnsConflicts).toEqual([{ iface: "utun21", servers: ["192.168.151.5", "172.18.148.3"] }]);
  });

  test("routing conflict when a ppp interface is the default route", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": "lo0 en0 ppp0\n",
      "/sbin/ifconfig ppp0": fixture("ifconfig-ppp0.txt"),
      "/sbin/route -n get 1.1.1.1": ROUTE_GET_1_1_1_1_VIA_PPP0,
      "/usr/sbin/scutil --dns": fixture("scutil-dns-no-vpn.txt"),
    });
    const result = await detectVpnConflicts(exec, null);
    expect(result.otherInterfaces).toEqual([{ name: "ppp0", inet: "192.168.100.2" }]);
    expect(result.routingConflict).toBe("ppp0");
  });

  test("no routing conflict when default route is regular ethernet, no other VPN interfaces", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": "lo0 en0 utun0\n",
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
      "/sbin/route -n get 1.1.1.1": ROUTE_GET_1_1_1_1_VIA_EN0,
    });
    const result = await detectVpnConflicts(exec, null);
    expect(result.otherInterfaces).toEqual([]);
    expect(result.routingConflict).toBeNull();
    expect(result.dnsConflicts).toEqual([]);
  });

  test("other VPN interfaces detected but no routing conflict when vpnctl is default route", async () => {
    const exec = makeExec({
      "/sbin/ifconfig -lu": IFCONFIG_LU_WITH_COMPETING,
      "/sbin/ifconfig utun0": noInetIfconfig("utun0"),
      "/sbin/ifconfig utun1": noInetIfconfig("utun1"),
      "/sbin/ifconfig utun21": fixture("ifconfig-utun21-other.txt"),
      "/sbin/ifconfig ppp0": fixture("ifconfig-ppp0.txt"),
      "/sbin/route -n get 1.1.1.1": ROUTE_GET_1_1_1_1_VIA_UTUN20,
      "/usr/sbin/scutil --dns": fixture("scutil-dns-no-vpn.txt"),
    });
    const result = await detectVpnConflicts(exec, "utun20");
    expect(result.otherInterfaces).toHaveLength(2);
    expect(result.routingConflict).toBeNull();
  });
});
