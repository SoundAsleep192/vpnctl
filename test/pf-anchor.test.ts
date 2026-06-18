import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Exec, ExecResult } from "../src/core/exec";
import { generateAnchorRules, writeAnchor } from "../src/core/pf-anchor";
import { PF_ANCHOR_FILE, PF_ANCHOR_NAME } from "../src/core/paths";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

describe("generateAnchorRules", () => {
  test("includes pass-out rules when there is a trusted utun interface", () => {
    expect(generateAnchorRules({ trustedIface: "utun20" })).toBe(fixture("pf-anchor.trusted.txt"));
  });

  test("is block-only when there is no trusted interface", () => {
    expect(generateAnchorRules({ trustedIface: null })).toBe(fixture("pf-anchor.no-trusted.txt"));
  });

  test("is block-only when the trusted interface is not a utun", () => {
    expect(generateAnchorRules({ trustedIface: "en0" })).toBe(fixture("pf-anchor.no-trusted.txt"));
  });

  test("yield mode: pass-out rules present but no block rules when trusted interface set", () => {
    expect(generateAnchorRules({ trustedIface: "utun20", yieldMode: true })).toBe(fixture("pf-anchor.yield.trusted.txt"));
  });

  test("yield mode: tables only (no pass, no block) when no trusted interface", () => {
    expect(generateAnchorRules({ trustedIface: null, yieldMode: true })).toBe(fixture("pf-anchor.yield.no-trusted.txt"));
  });
});

describe("writeAnchor", () => {
  interface RecordedCall {
    cmd: string;
    args: string[];
    tmpFileContent: string;
  }

  function makeExec(results: { check?: ExecResult; install?: ExecResult; load?: ExecResult }): {
    exec: Exec;
    calls: RecordedCall[];
  } {
    const calls: RecordedCall[] = [];
    const exec: Exec = async (cmd, args) => {
      const isSyntaxCheck = cmd === "/sbin/pfctl" && args[0] === "-nvf";
      const tmpFileContent = isSyntaxCheck ? await Bun.file(args[args.length - 1] ?? "").text() : "";
      calls.push({ cmd, args, tmpFileContent });

      if (cmd === "/sbin/pfctl" && args[0] === "-nvf") {
        return results.check ?? { stdout: "", stderr: "", exitCode: 0 };
      }
      if (cmd === "/usr/bin/install") {
        return results.install ?? { stdout: "", stderr: "", exitCode: 0 };
      }
      if (cmd === "/sbin/pfctl" && args[0] === "-a") {
        return results.load ?? { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected exec call: ${cmd} ${args.join(" ")}`);
    };
    return { exec, calls };
  }

  test("syntax-checks, installs, and loads the anchor on success", async () => {
    const rules = generateAnchorRules({ trustedIface: "utun20" });
    const { exec, calls } = makeExec({});

    await writeAnchor(exec, rules);

    expect(calls).toHaveLength(3);
    expect(calls[0]?.cmd).toBe("/sbin/pfctl");
    expect(calls[0]?.args[0]).toBe("-nvf");
    expect(calls[0]?.tmpFileContent).toBe(rules);

    expect(calls[1]?.cmd).toBe("/usr/bin/install");
    expect(calls[1]?.args).toEqual(["-m", "0644", "-o", "root", "-g", "wheel", calls[0]?.args[1] ?? "", PF_ANCHOR_FILE]);

    expect(calls[2]?.cmd).toBe("/sbin/pfctl");
    expect(calls[2]?.args).toEqual(["-a", PF_ANCHOR_NAME, "-f", PF_ANCHOR_FILE]);
  });

  test("throws and stops early when the syntax check fails", async () => {
    const { exec, calls } = makeExec({ check: { stdout: "", stderr: "syntax error\n", exitCode: 1 } });

    await expect(writeAnchor(exec, generateAnchorRules({ trustedIface: null }))).rejects.toThrow(/syntax check failed/);
    expect(calls).toHaveLength(1);
  });

  test("throws and stops early when install fails", async () => {
    const { exec, calls } = makeExec({ install: { stdout: "", stderr: "install: denied\n", exitCode: 1 } });

    await expect(writeAnchor(exec, generateAnchorRules({ trustedIface: null }))).rejects.toThrow(/failed to install/);
    expect(calls).toHaveLength(2);
  });

  test("throws when loading the anchor fails", async () => {
    const { exec, calls } = makeExec({ load: { stdout: "", stderr: "pfctl: anchor error\n", exitCode: 1 } });

    await expect(writeAnchor(exec, generateAnchorRules({ trustedIface: null }))).rejects.toThrow(/failed to load/);
    expect(calls).toHaveLength(3);
  });
});
