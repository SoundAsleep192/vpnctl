import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  FAIL_CLOSED_STATUS_NOTIFICATION_SETTLE_MS,
  scheduleStatusNotification,
  shouldSendStatusNotification,
  statusNotification,
} from "../src/core/status-notification";
import type { TrayStatus } from "../src/core/state-file";

describe("statusNotification", () => {
  test("uses protected domains wording without AI-specific copy", () => {
    const statuses: TrayStatus[] = ["protected", "fail-closed"];

    for (const status of statuses) {
      const notification = statusNotification(status);
      expect(notification?.body).toContain("Protected domains");
      expect(notification?.body).not.toContain("Protected AI domains");
    }
  });

  test("does not send notifications for transient or unknown status", () => {
    expect(statusNotification("starting")).toBeNull();
    expect(statusNotification("unknown")).toBeNull();
  });

  test("localizes tray notifications to Russian", () => {
    expect(statusNotification("fail-closed", "ru")).toEqual({
      title: "vpnctl: туннель выключен",
      body: "Защищенные домены заблокированы до переподключения туннеля.",
    });
  });
});

describe("scheduleStatusNotification", () => {
  test("queues protected immediately but lets tunnel-down settle", () => {
    expect(scheduleStatusNotification("protected")).toEqual({ status: "protected", delayMs: 0 });
    expect(scheduleStatusNotification("fail-closed")).toEqual({
      status: "fail-closed",
      delayMs: FAIL_CLOSED_STATUS_NOTIFICATION_SETTLE_MS,
    });
    expect(scheduleStatusNotification("starting")).toBeNull();
    expect(scheduleStatusNotification("unknown")).toBeNull();
  });
});

describe("shouldSendStatusNotification", () => {
  test("deduplicates one status across tray instances", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vpnctl-status-notification-test-"));
    try {
      const options = {
        lockDir: path.join(directory, "lock"),
        nowMs: 1_000,
        stateFile: path.join(directory, "state.json"),
      };
      const results = await Promise.all([
        shouldSendStatusNotification("protected", options),
        shouldSendStatusNotification("protected", options),
        shouldSendStatusNotification("protected", options),
      ]);

      expect(results.filter((allowed) => allowed).length).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("allows notifications only when the status changes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vpnctl-status-notification-test-"));
    try {
      const options = {
        lockDir: path.join(directory, "lock"),
        nowMs: 1_000,
        stateFile: path.join(directory, "state.json"),
      };

      expect(await shouldSendStatusNotification("fail-closed", options)).toBe(true);
      expect(await shouldSendStatusNotification("fail-closed", { ...options, nowMs: 2_000 })).toBe(false);
      expect(await shouldSendStatusNotification("protected", { ...options, nowMs: 3_000 })).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
