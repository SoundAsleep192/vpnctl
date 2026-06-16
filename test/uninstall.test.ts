import { describe, expect, test } from "bun:test";
import { waitForMonitorStopped } from "../src/cli/commands/uninstall";
import type { Exec } from "../src/core/exec";

function pgrepExec(exitCodes: number[]): { exec: Exec; getCalls: () => number } {
  let index = 0;
  const exec: Exec = async () => {
    const exitCode = exitCodes[Math.min(index, exitCodes.length - 1)] ?? 1;
    index++;
    return { stdout: "", stderr: "", exitCode };
  };
  return { exec, getCalls: () => index };
}

describe("waitForMonitorStopped", () => {
  /**
   * Дано:
   * - pgrep finds the monitor twice (still alive), then reports it gone.
   *
   * Ожидается:
   * - polls until pgrep returns non-zero (gone), then stops.
   */
  test("polls until pgrep reports the monitor process is gone", async () => {
    const { exec, getCalls } = pgrepExec([0, 0, 1]);
    await waitForMonitorStopped(exec, () => Promise.resolve());
    expect(getCalls()).toBe(3);
  });

  test("returns immediately when the monitor is already gone", async () => {
    const { exec, getCalls } = pgrepExec([1]);
    await waitForMonitorStopped(exec, () => Promise.resolve());
    expect(getCalls()).toBe(1);
  });
});
