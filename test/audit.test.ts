import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureConnections, formatSnapshot, rotateLog } from "../src/core/audit";
import { DEFAULT_AUDIT_PROCESS_NAME_PATTERNS } from "../src/core/paths";
import type { Exec } from "../src/core/exec";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function makeExec(stdout: string): Exec {
  return async () => ({ stdout, stderr: "", exitCode: 0 });
}

describe("captureConnections", () => {
  test("filters out loopback connections and unrelated processes", async () => {
    const exec = makeExec(fixture("lsof-established.txt"));
    const rows = await captureConnections(exec, DEFAULT_AUDIT_PROCESS_NAME_PATTERNS);

    expect(rows).toEqual([
      { command: "Cursor", pid: 2201, user: "nisakhanov", name: "172.19.0.1:61010->146.75.36.17:443" },
      { command: "Cursor", pid: 2233, user: "nisakhanov", name: "172.19.0.1:61011->146.75.36.18:443" },
      { command: "Code", pid: 3001, user: "nisakhanov", name: "172.19.0.1:61012->140.82.112.3:443" },
    ]);
  });

  test("returns nothing when only the header line is present", async () => {
    const exec = makeExec("COMMAND     PID       USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME\n");
    expect(await captureConnections(exec, DEFAULT_AUDIT_PROCESS_NAME_PATTERNS)).toEqual([]);
  });
});

describe("formatSnapshot", () => {
  test("renders a header and one line per connection", () => {
    const output = formatSnapshot([{ command: "Cursor", pid: 2201, user: "nisakhanov", name: "172.19.0.1:61010->146.75.36.17:443" }]);

    expect(output).toContain("COMMAND");
    expect(output).toContain("PID");
    expect(output).toContain("USER");
    expect(output).toContain("Cursor");
    expect(output).toContain("2201");
    expect(output).toContain("172.19.0.1:61010->146.75.36.17:443");
  });

  test("reports when there are no matching connections", () => {
    expect(formatSnapshot([])).toBe("(no matching established connections)\n");
  });
});

describe("rotateLog", () => {
  test("leaves a small file untouched", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const logFile = path.join(dir, "audit.log");
    try {
      const content = "line1\nline2\nline3\n";
      await writeFile(logFile, content);

      rotateLog(logFile, 1024, 2);

      expect(readFileSync(logFile, "utf8")).toBe(content);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("truncates a large file to the last N lines", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-test-"));
    const logFile = path.join(dir, "audit.log");
    try {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
      await writeFile(logFile, lines.join("\n") + "\n");

      rotateLog(logFile, 10, 5);

      expect(readFileSync(logFile, "utf8")).toBe(lines.slice(-5).join("\n") + "\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does nothing when the file does not exist", () => {
    expect(() => rotateLog("/nonexistent/vpnctl-test-audit.log", 1024, 100)).not.toThrow();
  });
});
