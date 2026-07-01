import { describe, expect, test } from "bun:test";
import { resolveReconcileIntervalMs } from "../src/daemon/reconcile-interval";
import type { TunnelState } from "../src/core/network";

const downState: TunnelState = { trustedIface: null, publicIface: "en0", tunnelUp: false };
const upState: TunnelState = { trustedIface: "utun20", publicIface: "utun20", tunnelUp: true };

describe("resolveReconcileIntervalMs", () => {
  test("polls faster while the tray waits for the tunnel to connect", () => {
    expect(resolveReconcileIntervalMs("up", downState)).toBe(1_000);
    expect(resolveReconcileIntervalMs("up", null)).toBe(1_000);
  });

  test("uses the normal interval for stable states", () => {
    expect(resolveReconcileIntervalMs("up", upState)).toBe(5_000);
    expect(resolveReconcileIntervalMs("down", downState)).toBe(5_000);
    expect(resolveReconcileIntervalMs(null, downState)).toBe(5_000);
  });
});
