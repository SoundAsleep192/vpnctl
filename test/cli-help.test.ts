import { describe, expect, test } from "bun:test";
import path from "node:path";

const CLI_ENTRYPOINT = path.join(import.meta.dir, "../bin/vpnctl.ts");

describe("vpnctl help", () => {
  test("shows only supported public lifecycle commands", () => {
    const result = Bun.spawnSync([process.execPath, "run", CLI_ENTRYPOINT, "--help"]);
    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/\n {2}uninstall\b/);
    expect(output).toMatch(/\n {2}up\b/);
    expect(output).toMatch(/\n {2}down\b/);
    expect(output).not.toMatch(/\n {2}setup\b/);
    expect(output).not.toMatch(/\n {2}install\b/);
    expect(output).not.toMatch(/\n {2}tui\b/);
    expect(output).not.toMatch(/\n {2}ui\b/);
    expect(output).not.toMatch(/\n {2}tray\b/);
    expect(output).not.toMatch(/\n {2}yield\b/);
    expect(output).not.toMatch(/\n {2}wrap\b/);
    expect(output).not.toContain("--purge");
  });
});
