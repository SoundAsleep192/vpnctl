import { describe, expect, test } from "bun:test";
import { classifyState, parseStateFile, serializeState, STATE_STALE_MS, type VpnState } from "../src/core/state-file";

const baseState: VpnState = { tunnelUp: true, trustedIface: "utun20", sinkholeActive: false, timestamp: 1_000 };

describe("serializeState / parseStateFile", () => {
  test("round-trips a state object", () => {
    expect(parseStateFile(serializeState(baseState))).toEqual(baseState);
  });

  test("returns null for invalid JSON", () => {
    expect(parseStateFile("not json")).toBeNull();
  });

  test("returns null when required fields are missing or wrong-typed", () => {
    expect(parseStateFile(JSON.stringify({ tunnelUp: true }))).toBeNull();
    expect(parseStateFile(JSON.stringify({ tunnelUp: "yes", sinkholeActive: false, timestamp: 1 }))).toBeNull();
  });

  test("tolerates a null trustedIface", () => {
    const downState: VpnState = { tunnelUp: false, trustedIface: null, sinkholeActive: true, timestamp: 5 };
    expect(parseStateFile(serializeState(downState))).toEqual(downState);
  });
});

describe("classifyState", () => {
  test("protected when tunnel is up and state is fresh", () => {
    expect(classifyState(baseState, baseState.timestamp + STATE_STALE_MS)).toBe("protected");
  });

  test("fail-closed when tunnel is down and state is fresh", () => {
    const downState: VpnState = { tunnelUp: false, trustedIface: null, sinkholeActive: true, timestamp: 1_000 };
    expect(classifyState(downState, downState.timestamp)).toBe("fail-closed");
  });

  test("unknown when no state file exists", () => {
    expect(classifyState(null, 1_000)).toBe("unknown");
  });

  test("unknown when state is older than the staleness window", () => {
    expect(classifyState(baseState, baseState.timestamp + STATE_STALE_MS + 1)).toBe("unknown");
  });
});
