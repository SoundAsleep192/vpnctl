import { describe, expect, test } from "bun:test";
import type { Exec } from "../src/core/exec";
import { sendDesktopNotification } from "../src/core/notifications";

describe("sendDesktopNotification", () => {
  test("sends a macOS notification through osascript", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec: Exec = async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await sendDesktopNotification(exec, { title: "vpnctl", body: "Tunnel up" }, { platform: "darwin" });

    expect(calls).toEqual([
      {
        cmd: "/usr/bin/osascript",
        args: ["-e", 'display notification "Tunnel up" with title "vpnctl"'],
      },
    ]);
  });

  test("sends sudo-origin notifications as the login user", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec: Exec = async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await sendDesktopNotification(exec, { title: "vpnctl", body: "Installed" }, { platform: "darwin", user: "alice" });

    expect(calls).toEqual([
      {
        cmd: "/usr/bin/sudo",
        args: ["-u", "alice", "/usr/bin/osascript", "-e", 'display notification "Installed" with title "vpnctl"'],
      },
    ]);
  });

  test("skips notifications outside macOS", async () => {
    const calls: string[] = [];
    const exec: Exec = async (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await sendDesktopNotification(exec, { title: "vpnctl", body: "Installed" }, { platform: "linux" });

    expect(calls).toEqual([]);
  });
});
