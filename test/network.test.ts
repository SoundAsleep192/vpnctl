import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Exec, ExecResult } from "../src/core/exec";
import {
  findUtunForInet,
  getInterfaceInet,
  getPublicInterface,
  getRouteInterface,
  getTrustedInterface,
  getTrustedInterfaceByRoute,
  getTunIpFromConfig,
  isSingBoxRunning,
  isTunnelUp,
  isTunnelUpByRoute,
  listUtunInterfaces,
  readPidFile,
  resolveCountry,
  resolvePublicIp,
} from "../src/core/network";
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

const ROUTE_GET_172_19_0_1_VIA_UTUN20 = `   route to: 172.19.0.1
destination: 172.19.0.1
  interface: utun20
`;

const ROUTE_GET_172_19_0_1_VIA_LO0 = `   route to: 172.19.0.1
destination: 172.19.0.1
  interface: lo0
`;

const ROUTE_GET_8_8_8_8_NO_TUNNEL = `   route to: 8.8.8.8
destination: default
  interface: en0
`;

const noInetIfconfig = (name: string): string => `${name}: flags=8010<POINTOPOINT,MULTICAST> mtu 1500\n`;

describe("getRouteInterface", () => {
  test("extracts the interface when the route goes through the tunnel", async () => {
    const exec = makeExec({ "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-tunnel.txt") });
    expect(await getRouteInterface(exec, "1.1.1.1")).toBe("utun20");
  });

  test("extracts the interface when the route goes through the physical NIC", async () => {
    const exec = makeExec({ "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-no-tunnel.txt") });
    expect(await getRouteInterface(exec, "1.1.1.1")).toBe("en0");
  });
});

describe("getInterfaceInet", () => {
  test("extracts the inet address of the tun interface", async () => {
    const exec = makeExec({ "/sbin/ifconfig utun20": fixture("ifconfig-utun20.txt") });
    expect(await getInterfaceInet(exec, "utun20")).toBe("172.19.0.1");
  });

  test("extracts the inet address of an unrelated tunnel interface", async () => {
    const exec = makeExec({ "/sbin/ifconfig utun21": fixture("ifconfig-utun21-other.txt") });
    expect(await getInterfaceInet(exec, "utun21")).toBe("10.8.0.5");
  });

  test("returns null when the interface has no inet line", async () => {
    const exec = makeExec({ "/sbin/ifconfig utun9": noInetIfconfig("utun9") });
    expect(await getInterfaceInet(exec, "utun9")).toBeNull();
  });
});

describe("listUtunInterfaces", () => {
  test("filters ifconfig -lu output down to utunN interfaces, in order", async () => {
    const exec = makeExec({ "/sbin/ifconfig -lu": fixture("ifconfig-lu.txt") });
    expect(await listUtunInterfaces(exec)).toEqual(["utun0", "utun1", "utun2", "utun3", "utun5", "utun4", "utun20"]);
  });
});

describe("findUtunForInet", () => {
  const responses: Record<string, string> = {
    "/sbin/ifconfig -lu": fixture("ifconfig-lu.txt"),
    "/sbin/ifconfig utun20": fixture("ifconfig-utun20.txt"),
  };
  for (const name of ["utun0", "utun1", "utun2", "utun3", "utun4", "utun5"]) {
    responses[`/sbin/ifconfig ${name}`] = noInetIfconfig(name);
  }

  test("finds the utun interface carrying the given inet address", async () => {
    const exec = makeExec(responses);
    expect(await findUtunForInet(exec, "172.19.0.1")).toBe("utun20");
  });

  test("returns null when no utun interface carries the given inet address", async () => {
    const exec = makeExec(responses);
    expect(await findUtunForInet(exec, "10.0.0.1")).toBeNull();
  });
});

describe("getTunIpFromConfig", () => {
  test("extracts the tun inbound's address, stripped of its prefix length", () => {
    expect(getTunIpFromConfig(sampleConfig)).toBe("172.19.0.1");
  });

  test("returns null when there is no tun inbound", () => {
    expect(getTunIpFromConfig({ inbounds: [{ type: "socks", listen: "127.0.0.1" }] })).toBeNull();
  });

  test("returns null for non-object input", () => {
    expect(getTunIpFromConfig(null)).toBeNull();
    expect(getTunIpFromConfig("not a config")).toBeNull();
  });
});

describe("readPidFile", () => {
  test("returns null when the pidfile does not exist", async () => {
    expect(await readPidFile("/nonexistent/vpnctl-test.pid")).toBeNull();
  });

  test("reads a valid pid", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const pidFile = path.join(dir, "tunnel.pid");
    try {
      await writeFile(pidFile, "12345\n");
      expect(await readPidFile(pidFile)).toBe(12345);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null for non-numeric or non-positive content", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    try {
      const garbage = path.join(dir, "garbage.pid");
      await writeFile(garbage, "not-a-pid\n");
      expect(await readPidFile(garbage)).toBeNull();

      const zero = path.join(dir, "zero.pid");
      await writeFile(zero, "0\n");
      expect(await readPidFile(zero)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("isSingBoxRunning", () => {
  test("returns false when the pidfile is missing, without checking the process", async () => {
    const exec = makeExec({});
    expect(await isSingBoxRunning(exec, "/nonexistent/vpnctl-test.pid")).toBe(false);
  });

  test("returns true when the pid is alive", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const pidFile = path.join(dir, "tunnel.pid");
    try {
      await writeFile(pidFile, "4242\n");
      const exec = makeExec({ "/bin/kill -0 4242": { stdout: "", stderr: "", exitCode: 0 } });
      expect(await isSingBoxRunning(exec, pidFile)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns false when the pid is stale", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const pidFile = path.join(dir, "tunnel.pid");
    try {
      await writeFile(pidFile, "4242\n");
      const exec = makeExec({
        "/bin/kill -0 4242": { stdout: "", stderr: "kill: 4242: No such process\n", exitCode: 1 },
      });
      expect(await isSingBoxRunning(exec, pidFile)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("getTrustedInterface", () => {
  let pidFile: string;
  let dir: string;

  const setup = async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    pidFile = path.join(dir, "tunnel.pid");
    await writeFile(pidFile, "4242\n");
  };
  const cleanup = async () => rm(dir, { recursive: true, force: true });

  test("returns null when sing-box is not running", async () => {
    await setup();
    try {
      const exec = makeExec({ "/bin/kill -0 4242": { stdout: "", stderr: "", exitCode: 1 } });
      expect(await getTrustedInterface(exec, sampleConfig, pidFile)).toBeNull();
    } finally {
      await cleanup();
    }
  });

  test("returns the tun interface when the route to its IP goes through it directly", async () => {
    await setup();
    try {
      const exec = makeExec({
        "/bin/kill -0 4242": { stdout: "", stderr: "", exitCode: 0 },
        "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_UTUN20,
      });
      expect(await getTrustedInterface(exec, sampleConfig, pidFile)).toBe("utun20");
    } finally {
      await cleanup();
    }
  });

  test("falls back to scanning utun interfaces when the route doesn't resolve to a utun", async () => {
    await setup();
    try {
      const responses: Record<string, string | ExecResult> = {
        "/bin/kill -0 4242": { stdout: "", stderr: "", exitCode: 0 },
        "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_LO0,
        "/sbin/ifconfig -lu": fixture("ifconfig-lu.txt"),
        "/sbin/ifconfig utun20": fixture("ifconfig-utun20.txt"),
      };
      for (const name of ["utun0", "utun1", "utun2", "utun3", "utun4", "utun5"]) {
        responses[`/sbin/ifconfig ${name}`] = noInetIfconfig(name);
      }

      expect(await getTrustedInterface(makeExec(responses), sampleConfig, pidFile)).toBe("utun20");
    } finally {
      await cleanup();
    }
  });
});

describe("getPublicInterface", () => {
  test("returns the utun interface when 1.1.1.1 routes through the tunnel", async () => {
    const exec = makeExec({ "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-tunnel.txt") });
    expect(await getPublicInterface(exec)).toBe("utun20");
  });

  test("falls back to 8.8.8.8 and returns null when neither resolves to a utun", async () => {
    const exec = makeExec({
      "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-no-tunnel.txt"),
      "/sbin/route -n get 8.8.8.8": ROUTE_GET_8_8_8_8_NO_TUNNEL,
    });
    expect(await getPublicInterface(exec)).toBeNull();
  });
});

describe("isTunnelUp", () => {
  let pidFile: string;
  let dir: string;

  const setup = async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    pidFile = path.join(dir, "tunnel.pid");
    await writeFile(pidFile, "4242\n");
  };
  const cleanup = async () => rm(dir, { recursive: true, force: true });

  test("true when the trusted interface is also the public interface", async () => {
    await setup();
    try {
      const exec = makeExec({
        "/bin/kill -0 4242": { stdout: "", stderr: "", exitCode: 0 },
        "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_UTUN20,
        "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-tunnel.txt"),
      });
      expect(await isTunnelUp(exec, sampleConfig, pidFile)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("false when sing-box is not running", async () => {
    await setup();
    try {
      const exec = makeExec({ "/bin/kill -0 4242": { stdout: "", stderr: "", exitCode: 1 } });
      expect(await isTunnelUp(exec, sampleConfig, pidFile)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("false when the trusted interface and public interface differ", async () => {
    await setup();
    try {
      const exec = makeExec({
        "/bin/kill -0 4242": { stdout: "", stderr: "", exitCode: 0 },
        "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_UTUN20,
        "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-no-tunnel.txt"),
        "/sbin/route -n get 8.8.8.8": ROUTE_GET_8_8_8_8_NO_TUNNEL,
      });
      expect(await isTunnelUp(exec, sampleConfig, pidFile)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

describe("getTrustedInterfaceByRoute", () => {
  test("returns the tun interface when the route to its IP goes through it directly, without checking the pid", async () => {
    const exec = makeExec({ "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_UTUN20 });
    expect(await getTrustedInterfaceByRoute(exec, sampleConfig)).toBe("utun20");
  });

  test("falls back to scanning utun interfaces when the route doesn't resolve to a utun", async () => {
    const responses: Record<string, string | ExecResult> = {
      "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_LO0,
      "/sbin/ifconfig -lu": fixture("ifconfig-lu.txt"),
      "/sbin/ifconfig utun20": fixture("ifconfig-utun20.txt"),
    };
    for (const name of ["utun0", "utun1", "utun2", "utun3", "utun4", "utun5"]) {
      responses[`/sbin/ifconfig ${name}`] = noInetIfconfig(name);
    }

    expect(await getTrustedInterfaceByRoute(makeExec(responses), sampleConfig)).toBe("utun20");
  });

  test("returns null when there is no tun inbound in the config", async () => {
    const exec = makeExec({});
    expect(await getTrustedInterfaceByRoute(exec, { inbounds: [{ type: "socks", listen: "127.0.0.1" }] })).toBeNull();
  });
});

describe("isTunnelUpByRoute", () => {
  test("true when the trusted interface (via route) is also the public interface, without checking the pid", async () => {
    const exec = makeExec({
      "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_UTUN20,
      "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-tunnel.txt"),
    });
    expect(await isTunnelUpByRoute(exec, sampleConfig)).toBe(true);
  });

  test("false when the trusted interface and public interface differ", async () => {
    const exec = makeExec({
      "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_UTUN20,
      "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-no-tunnel.txt"),
      "/sbin/route -n get 8.8.8.8": ROUTE_GET_8_8_8_8_NO_TUNNEL,
    });
    expect(await isTunnelUpByRoute(exec, sampleConfig)).toBe(false);
  });
});

describe("resolvePublicIp", () => {
  test("returns the trimmed IP from dig", async () => {
    const exec = makeExec({ "/usr/bin/dig +short myip.opendns.com @resolver1.opendns.com": "203.0.113.7\n" });
    expect(await resolvePublicIp(exec)).toBe("203.0.113.7");
  });

  test("returns null when dig returns nothing", async () => {
    const exec = makeExec({ "/usr/bin/dig +short myip.opendns.com @resolver1.opendns.com": "" });
    expect(await resolvePublicIp(exec)).toBeNull();
  });
});

describe("resolveCountry", () => {
  test("returns the country from ipinfo's JSON response", async () => {
    const exec = makeExec({
      "/usr/bin/curl -sS --max-time 8 https://ipinfo.io/203.0.113.7/json": '{"ip":"203.0.113.7","country":"NL","city":"Amsterdam"}',
    });
    expect(await resolveCountry(exec, "203.0.113.7")).toBe("NL");
  });

  test("returns null when curl fails", async () => {
    const exec = makeExec({
      "/usr/bin/curl -sS --max-time 8 https://ipinfo.io/203.0.113.7/json": { stdout: "", stderr: "timeout\n", exitCode: 28 },
    });
    expect(await resolveCountry(exec, "203.0.113.7")).toBeNull();
  });

  test("returns null when the response is not valid JSON", async () => {
    const exec = makeExec({ "/usr/bin/curl -sS --max-time 8 https://ipinfo.io/203.0.113.7/json": "not json" });
    expect(await resolveCountry(exec, "203.0.113.7")).toBeNull();
  });
});
