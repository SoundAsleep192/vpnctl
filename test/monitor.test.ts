import { describe, expect, test } from "bun:test";
import { resolveTunnelStarting, TUNNEL_STARTING_GRACE_MS } from "../src/daemon/monitor";

describe("resolveTunnelStarting", () => {
  test("keeps startup state sticky while the tunnel daemon is still connecting", () => {
    const nowMs = 10_000;

    expect(resolveTunnelStarting(false, false, nowMs + TUNNEL_STARTING_GRACE_MS, nowMs)).toBe(true);
  });

  test("keeps startup state while sing-box is already running", () => {
    expect(resolveTunnelStarting(false, true, 0, 10_000)).toBe(true);
  });

  test("clears startup state when the tunnel is up or the grace window expired", () => {
    const nowMs = 10_000;

    expect(resolveTunnelStarting(true, true, nowMs + TUNNEL_STARTING_GRACE_MS, nowMs)).toBe(false);
    expect(resolveTunnelStarting(false, false, nowMs, nowMs)).toBe(false);
  });
});
