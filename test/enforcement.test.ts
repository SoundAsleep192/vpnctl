import { describe, expect, test } from "bun:test";
import { planEnforcement, pollUntil } from "../src/core/enforcement";
import { generateAnchorRules } from "../src/core/pf-anchor";
import { computeHosts } from "../src/core/sinkhole";

const DOMAINS = ["api.anthropic.com", "console.anthropic.com"];
const CLEAN = "127.0.0.1 localhost\n";

describe("planEnforcement", () => {
  test("tunnel up: clears hosts sinkhole, trusts the tunnel interface", () => {
    const sinkholed = computeHosts(CLEAN, DOMAINS, true).content;

    const plan = planEnforcement(sinkholed, DOMAINS, "utun20", true);

    expect(plan).toEqual({
      hostsContent: CLEAN,
      hostsChanged: true,
      anchorRules: generateAnchorRules({ trustedIface: "utun20" }),
    });
  });

  test("tunnel down: applies hosts sinkhole, drops without a trusted interface", () => {
    const plan = planEnforcement(CLEAN, DOMAINS, null, false);

    expect(plan).toEqual({
      hostsContent: computeHosts(CLEAN, DOMAINS, true).content,
      hostsChanged: true,
      anchorRules: generateAnchorRules({ trustedIface: null }),
    });
  });

  test("no-op when state already matches", () => {
    const sinkholed = computeHosts(CLEAN, DOMAINS, true).content;

    const plan = planEnforcement(sinkholed, DOMAINS, null, false);

    expect(plan.hostsChanged).toBe(false);
  });
});

describe("pollUntil", () => {
  test("returns immediately when the first value is already done", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return "done";
    };

    const result = await pollUntil(fn, (value) => value === "done", 1000, 10);

    expect(result).toBe("done");
    expect(calls).toBe(1);
  });

  test("polls until the value becomes done", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls >= 3 ? "done" : "pending";
    };

    const result = await pollUntil(fn, (value) => value === "done", 1000, 5);

    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  test("gives up after the timeout and returns the last value", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return "pending";
    };

    const result = await pollUntil(fn, (value) => value === "done", 30, 10);

    expect(result).toBe("pending");
    expect(calls).toBeGreaterThan(1);
  });
});
