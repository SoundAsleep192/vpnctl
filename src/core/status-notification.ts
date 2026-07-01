import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { detectSystemLanguage, type UiLanguage } from "./config";
import type { DesktopNotification } from "./notifications";
import { CONFIG_DIR } from "./paths";
import type { TrayStatus } from "./state-file";

const STATUS_NOTIFICATION_STATE_FILE = path.join(CONFIG_DIR, "tray-notification-state.json");
const STATUS_NOTIFICATION_LOCK_DIR = path.join(CONFIG_DIR, "tray-notification-state.lock");
const STALE_STATUS_NOTIFICATION_LOCK_MS = 10_000;

const STATUS_NOTIFICATION_TEXTS: Record<UiLanguage, Record<"protected" | "starting" | "fail-closed", DesktopNotification>> = {
  en: {
    protected: { title: "vpnctl tunnel up", body: "Protected domains are routed through the VPN." },
    starting: {
      title: "vpnctl tunnel starting",
      body: "Protected domains stay blocked until the tunnel connects.",
    },
    "fail-closed": {
      title: "vpnctl tunnel down",
      body: "Protected domains are blocked until the tunnel reconnects.",
    },
  },
  ru: {
    protected: { title: "vpnctl: туннель включен", body: "Защищенные домены идут через VPN." },
    starting: {
      title: "vpnctl: туннель запускается",
      body: "Защищенные домены заблокированы, пока туннель подключается.",
    },
    "fail-closed": {
      title: "vpnctl: туннель выключен",
      body: "Защищенные домены заблокированы до переподключения туннеля.",
    },
  },
};

export function statusNotification(status: TrayStatus, language: UiLanguage = detectSystemLanguage()): DesktopNotification | null {
  if (status === "protected") {
    return STATUS_NOTIFICATION_TEXTS[language].protected;
  }

  if (status === "starting") {
    return STATUS_NOTIFICATION_TEXTS[language].starting;
  }

  if (status === "fail-closed") {
    return STATUS_NOTIFICATION_TEXTS[language]["fail-closed"];
  }

  return null;
}

export async function shouldSendStatusNotification(
  status: TrayStatus,
  options: { lockDir?: string; nowMs?: number; stateFile?: string } = {},
): Promise<boolean> {
  const stateFile = options.stateFile ?? STATUS_NOTIFICATION_STATE_FILE;
  const lockDir = options.lockDir ?? STATUS_NOTIFICATION_LOCK_DIR;
  const nowMs = options.nowMs ?? Date.now();

  await mkdir(path.dirname(lockDir), { recursive: true });
  const lockAcquired = await acquireStatusNotificationLock(lockDir, nowMs);
  if (!lockAcquired) return false;

  try {
    if ((await readPreviousStatusNotification(stateFile)) === status) return false;
    await Bun.write(stateFile, `${JSON.stringify({ status, timestamp: nowMs })}\n`);
    return true;
  } finally {
    await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function acquireStatusNotificationLock(lockDir: string, nowMs: number): Promise<boolean> {
  if (await tryCreateStatusNotificationLock(lockDir)) return true;

  const existingLock = await stat(lockDir).catch(() => null);
  if (existingLock === null || nowMs - existingLock.mtimeMs <= STALE_STATUS_NOTIFICATION_LOCK_MS) return false;

  await rm(lockDir, { recursive: true, force: true });
  return tryCreateStatusNotificationLock(lockDir);
}

async function tryCreateStatusNotificationLock(lockDir: string): Promise<boolean> {
  return mkdir(lockDir)
    .then(() => true)
    .catch(() => false);
}

async function readPreviousStatusNotification(stateFile: string): Promise<TrayStatus | null> {
  const text = await Bun.file(stateFile)
    .text()
    .catch(() => null);
  if (text === null) return null;

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null) return null;
  if (!("status" in data)) return null;
  return isTrayStatus(data.status) ? data.status : null;
}

function isTrayStatus(value: unknown): value is TrayStatus {
  return value === "protected" || value === "starting" || value === "fail-closed" || value === "unknown";
}
