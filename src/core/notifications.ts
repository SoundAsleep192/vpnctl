import type { Exec } from "./exec";

export interface DesktopNotification {
  body: string;
  title: string;
}

export async function sendDesktopNotification(
  exec: Exec,
  notification: DesktopNotification,
  options: { user?: string; platform?: NodeJS.Platform } = {},
): Promise<void> {
  if ((options.platform ?? process.platform) !== "darwin") return;

  const script = `display notification ${appleScriptString(notification.body)} with title ${appleScriptString(notification.title)}`;
  const user = options.user;
  const result =
    user === undefined || user === "root"
      ? await exec("/usr/bin/osascript", ["-e", script]).catch(() => null)
      : await exec("/usr/bin/sudo", ["-u", user, "/usr/bin/osascript", "-e", script]).catch(() => null);

  if (result === null || result.exitCode !== 0) return;
}

export function notificationUser(): string | undefined {
  const sudoUser = Bun.env.SUDO_USER;
  if (process.getuid?.() === 0 && sudoUser !== undefined && sudoUser !== "root") return sudoUser;
  return undefined;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
