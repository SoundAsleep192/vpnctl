import { describe, expect, test } from "bun:test";
import type { Exec, ExecResult } from "../src/core/exec";
import { resolveAll, resolveDomain, writeTable } from "../src/core/dns-refresh";
import { PF_ANCHOR_NAME } from "../src/core/paths";

const DNS_SERVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];

function makeExec(responses: Record<string, string>): Exec {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const stdout = responses[key];
    if (stdout === undefined) throw new Error(`unexpected exec call: ${key}`);
    return { stdout, stderr: "", exitCode: 0 };
  };
}

const digKey = (recordType: "A" | "AAAA", domain: string, dns: string): string =>
  `/usr/bin/dig +short +time=2 +tries=1 ${recordType} ${domain} @${dns}`;

describe("resolveDomain", () => {
  test("uses the first DNS server that returns A and AAAA records", async () => {
    const exec = makeExec({
      [digKey("A", "example.com", "1.1.1.1")]: "93.184.216.34\n",
      [digKey("AAAA", "example.com", "1.1.1.1")]: "2606:2800:21f:cb07:6820:80da:af6b:8b2c\n",
    });

    expect(await resolveDomain(exec, "example.com", DNS_SERVERS)).toEqual({
      v4: ["93.184.216.34"],
      v6: ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"],
    });
  });

  test("falls through to the next DNS server when one returns nothing", async () => {
    const exec = makeExec({
      [digKey("A", "example.com", "1.1.1.1")]: "",
      [digKey("A", "example.com", "8.8.8.8")]: "93.184.216.34\n",
      [digKey("AAAA", "example.com", "1.1.1.1")]: "",
      [digKey("AAAA", "example.com", "8.8.8.8")]: "",
      [digKey("AAAA", "example.com", "9.9.9.9")]: "",
    });

    expect(await resolveDomain(exec, "example.com", DNS_SERVERS)).toEqual({
      v4: ["93.184.216.34"],
      v6: [],
    });
  });

  test("collects multiple A records from a single server response", async () => {
    const exec = makeExec({
      [digKey("A", "multi.example.com", "1.1.1.1")]: "1.2.3.4\n5.6.7.8\n",
      [digKey("AAAA", "multi.example.com", "1.1.1.1")]: "",
      [digKey("AAAA", "multi.example.com", "8.8.8.8")]: "",
      [digKey("AAAA", "multi.example.com", "9.9.9.9")]: "",
    });

    expect(await resolveDomain(exec, "multi.example.com", DNS_SERVERS)).toEqual({
      v4: ["1.2.3.4", "5.6.7.8"],
      v6: [],
    });
  });

  test("returns empty arrays when no server resolves the domain", async () => {
    const exec = makeExec({
      [digKey("A", "nxdomain.example.com", "1.1.1.1")]: "",
      [digKey("A", "nxdomain.example.com", "8.8.8.8")]: "",
      [digKey("A", "nxdomain.example.com", "9.9.9.9")]: "",
      [digKey("AAAA", "nxdomain.example.com", "1.1.1.1")]: "",
      [digKey("AAAA", "nxdomain.example.com", "8.8.8.8")]: "",
      [digKey("AAAA", "nxdomain.example.com", "9.9.9.9")]: "",
    });

    expect(await resolveDomain(exec, "nxdomain.example.com", DNS_SERVERS)).toEqual({ v4: [], v6: [] });
  });
});

describe("resolveAll", () => {
  test("dedupes and sorts IPs across multiple domains", async () => {
    const exec = makeExec({
      [digKey("A", "a.example.com", "1.1.1.1")]: "5.6.7.8\n1.2.3.4\n",
      [digKey("AAAA", "a.example.com", "1.1.1.1")]: "",
      [digKey("AAAA", "a.example.com", "8.8.8.8")]: "",
      [digKey("AAAA", "a.example.com", "9.9.9.9")]: "",
      [digKey("A", "b.example.com", "1.1.1.1")]: "1.2.3.4\n",
      [digKey("AAAA", "b.example.com", "1.1.1.1")]: "",
      [digKey("AAAA", "b.example.com", "8.8.8.8")]: "",
      [digKey("AAAA", "b.example.com", "9.9.9.9")]: "",
    });

    expect(await resolveAll(exec, ["a.example.com", "b.example.com"], DNS_SERVERS)).toEqual({
      v4: ["1.2.3.4", "5.6.7.8"],
      v6: [],
    });
  });

  test("returns an empty v4 list when nothing resolves", async () => {
    const exec = makeExec({
      [digKey("A", "nxdomain.example.com", "1.1.1.1")]: "",
      [digKey("A", "nxdomain.example.com", "8.8.8.8")]: "",
      [digKey("A", "nxdomain.example.com", "9.9.9.9")]: "",
      [digKey("AAAA", "nxdomain.example.com", "1.1.1.1")]: "",
      [digKey("AAAA", "nxdomain.example.com", "8.8.8.8")]: "",
      [digKey("AAAA", "nxdomain.example.com", "9.9.9.9")]: "",
    });

    expect(await resolveAll(exec, ["nxdomain.example.com"], DNS_SERVERS)).toEqual({ v4: [], v6: [] });
  });
});

describe("writeTable", () => {
  test("replaces the pf table from a tmpfile containing the given IPs", async () => {
    let captured: { args: string[]; content: string } | undefined;
    const exec: Exec = async (cmd, args) => {
      expect(cmd).toBe("/sbin/pfctl");
      const tmpFile = args[args.length - 1] ?? "";
      captured = { args, content: await Bun.file(tmpFile).text() };
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await writeTable(exec, "vpnctl_v4", ["1.2.3.4", "5.6.7.8"]);

    expect(captured?.args.slice(0, -1)).toEqual(["-a", PF_ANCHOR_NAME, "-t", "vpnctl_v4", "-T", "replace", "-f"]);
    expect(captured?.content).toBe("1.2.3.4\n5.6.7.8\n");
  });

  test("writes an empty tmpfile when there are no IPs", async () => {
    let captured: string | undefined;
    const exec: Exec = async (_cmd, args) => {
      const tmpFile = args[args.length - 1] ?? "";
      captured = await Bun.file(tmpFile).text();
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await writeTable(exec, "vpnctl_v6", []);
    expect(captured).toBe("");
  });

  test("throws when pfctl fails", async () => {
    const exec: Exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "pfctl: no such table\n", exitCode: 1 });
    await expect(writeTable(exec, "vpnctl_v4", ["1.2.3.4"])).rejects.toThrow(/failed to replace pf table/);
  });
});
