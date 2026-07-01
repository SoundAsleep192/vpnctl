import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { shouldSendStatusNotification, statusNotification } from "../src/core/status-notification";
import type { TrayStatus } from "../src/core/state-file";

describe("statusNotification", () => {
  test("uses protected domains wording without AI-specific copy", () => {
    const statuses: TrayStatus[] = ["protected", "starting", "fail-closed"];

    for (const status of statuses) {
      const notification = statusNotification(status);
      expect(notification?.body).toContain("Protected domains");
      expect(notification?.body).not.toContain("Protected AI domains");
    }
  });

  test("does not send notifications for unknown status", () => {
    expect(statusNotification("unknown")).toBeNull();
  });

  test("localizes tray notifications to Russian", () => {
    expect(statusNotification("starting", "ru")).toEqual({
      title: "vpnctl: туннель запускается",
      body: "Защищенные домены заблокированы, пока туннель подключается.",
    });
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

      expect(await shouldSendStatusNotification("starting", options)).toBe(true);
      expect(await shouldSendStatusNotification("starting", { ...options, nowMs: 2_000 })).toBe(false);
      expect(await shouldSendStatusNotification("protected", { ...options, nowMs: 3_000 })).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
