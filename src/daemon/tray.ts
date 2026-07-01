import { chmodSync, statSync, watch } from "node:fs";
import path from "node:path";
import SysTrayDefault from "systray2";
import iconFailClosed from "../../templates/tray-icons/fail-closed.base64.txt";
import iconProtected from "../../templates/tray-icons/protected.base64.txt";
import iconUnknown from "../../templates/tray-icons/unknown.base64.txt";
import { detectSystemLanguage, loadConfig } from "../core/config";
import { realExec } from "../core/exec";
import { sendDesktopNotification } from "../core/notifications";
import { isCompiledBinary } from "../core/runtime";
import { writeDesiredTunnel } from "../core/desired-tunnel";
import { LOG_DIR, STATE_FILE } from "../core/paths";
import { classifyState, parseStateFile, type TrayStatus } from "../core/state-file";
import {
  scheduleStatusNotification,
  shouldSendStatusNotification,
  statusNotification,
  type StatusNotificationTarget,
} from "../core/status-notification";

// `bun build --compile` double-wraps systray2's CJS default export: the real
// constructor sits at `.default.default` in the shipped binary but at `.default`
// under `bun run`. The runtime shape doesn't match the published types, so this
// boundary is genuinely untyped — pick whichever level is the constructor, else
// `new SysTray(...)` throws "Object is not a constructor" in the release build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapSysTrayConstructor(imported: any): typeof SysTrayDefault {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return typeof imported === "function" ? imported : imported.default;
}
const SysTray = unwrapSysTrayConstructor(SysTrayDefault);

// fs.watch is the fast path, but it's unreliable on macOS (FSEvents coalescing),
// so poll often enough that a state change still reflects within ~1s even when the
// watch lags, and to catch the tunnel-down ⇒ stale ⇒ "unknown" transition (which
// produces no file write to watch for).
const FALLBACK_POLL_INTERVAL_MS = 1_000;
const TRAY_BINARY_NAME = "tray_darwin_release";
const TRAY_BINARY_MODE = 0o755;
const OPEN_LOGS_ITEM_TITLE = "Open logs";
const TURN_TUNNEL_ON_TITLE = "Turn tunnel on";
const TURN_TUNNEL_OFF_TITLE = "Turn tunnel off";

// systray2 assigns each menu item a 1-based __id (depth-first); the toggle is the
// first item. update-item targets this id to refresh the toggle's title in place.
const TUNNEL_TOGGLE_ITEM_ID = 1;

const ICONS: Record<TrayStatus, string> = {
  protected: iconProtected.trim(),
  starting: iconUnknown.trim(),
  "fail-closed": iconFailClosed.trim(),
  unknown: iconUnknown.trim(),
};

function statusLabel(status: TrayStatus): string {
  if (status === "protected") return "Protected — tunnel up";
  if (status === "starting") return "Starting — traffic blocked until tunnel connects";
  if (status === "fail-closed") return "Fail-closed — tunnel down, traffic blocked";
  return "Unknown — daemon not running or state stale";
}

function toggleTitle(status: TrayStatus): string {
  return status === "protected" || status === "starting" ? TURN_TUNNEL_OFF_TITLE : TURN_TUNNEL_ON_TITLE;
}

function tunnelToggleItem(status: TrayStatus) {
  return { __id: TUNNEL_TOGGLE_ITEM_ID, title: toggleTitle(status), tooltip: `vpnctl: ${statusLabel(status)}`, enabled: true };
}

export function buildMenu(status: TrayStatus) {
  return {
    icon: ICONS[status],
    title: "",
    tooltip: `vpnctl: ${statusLabel(status)}`,
    items: [
      tunnelToggleItem(status),
      SysTray.separator,
      { title: OPEN_LOGS_ITEM_TITLE, tooltip: "Open the vpnctl log folder", enabled: true },
    ],
  };
}

async function notifyStatus(status: StatusNotificationTarget): Promise<void> {
  const config = await loadConfig().catch(() => null);
  const notification = statusNotification(status, config?.ui.language ?? detectSystemLanguage());
  if (notification === null) return;
  if (!(await shouldSendStatusNotification(status).catch(() => false))) return;
  await sendDesktopNotification(realExec, notification);
}

// systray2 spawns a precompiled Go binary it locates at `./traybin/<name>`
// (cwd) or `<module dir>/traybin/<name>`. A `bun build --compile` binary has no
// real module dir, so we ship the Go binary in `traybin/` next to the compiled
// vpnctl-tray and chdir there. We also chmod +x: `bun install` drops the
// executable bit during extraction (a tar-based release preserves it, but the
// chmod is idempotent and harmless either way).
function prepareTrayBinary(): void {
  const baseDir = isCompiledBinary() ? path.dirname(process.execPath) : path.resolve(import.meta.dir, "../../node_modules/systray2");
  ensureExecutable(path.join(baseDir, "traybin", TRAY_BINARY_NAME));
  if (isCompiledBinary()) process.chdir(baseDir);
}

function ensureExecutable(binaryPath: string): void {
  try {
    if ((statSync(binaryPath).mode & 0o111) !== 0) return;
    chmodSync(binaryPath, TRAY_BINARY_MODE);
  } catch {
    // Best-effort: a root-owned install dir denies chmod to the per-user agent,
    // but that's fine as long as the binary already carries +x (a tar-based
    // release preserves it). systray2 surfaces a real spawn error if it doesn't.
  }
}

function openLogs(): void {
  Bun.spawn(["/usr/bin/open", LOG_DIR]);
}

async function readStatus(): Promise<TrayStatus> {
  const text = await Bun.file(STATE_FILE)
    .text()
    .catch(() => null);
  return classifyState(text === null ? null : parseStateFile(text), Date.now());
}

export async function runTrayDaemon(): Promise<void> {
  prepareTrayBinary();

  let currentStatus = await readStatus();
  let statusNotificationGeneration = 0;
  let statusNotificationTimer: ReturnType<typeof setTimeout> | null = null;
  const systray = new SysTray({ menu: buildMenu(currentStatus), debug: false, copyDir: false });
  await systray.ready();

  const queueStatusNotification = (status: TrayStatus): void => {
    statusNotificationGeneration += 1;
    if (statusNotificationTimer !== null) {
      clearTimeout(statusNotificationTimer);
      statusNotificationTimer = null;
    }

    const scheduledNotification = scheduleStatusNotification(status);
    if (scheduledNotification === null) return;

    const generation = statusNotificationGeneration;
    if (scheduledNotification.delayMs === 0) {
      void notifyStatus(scheduledNotification.status);
      return;
    }

    statusNotificationTimer = setTimeout(() => {
      if (generation !== statusNotificationGeneration) return;
      statusNotificationTimer = null;
      void notifyStatus(scheduledNotification.status);
    }, scheduledNotification.delayMs);
  };

  await systray.onClick((action) => {
    // Only "Open logs" has a stable title; the toggle's title changes with state
    // and its click payload can be stale, so match the static item and treat any
    // other click as the toggle — driven by tracked status, not the clicked label.
    if (action.item.title === OPEN_LOGS_ITEM_TITLE) openLogs();
    else void writeDesiredTunnel(currentStatus === "protected" || currentStatus === "starting" ? "down" : "up");
  });

  const applyStatus = async (): Promise<void> => {
    const next = await readStatus();
    if (next !== currentStatus) {
      currentStatus = next;
      // Two separate actions: systray2's combined "update-menu-and-item" doesn't
      // match the Go binary's "update-item-and-menu" handler and gets dropped (it
      // also wedges click handling). update-menu swaps the icon; update-item
      // refreshes the toggle title in place.
      await systray.sendAction({ type: "update-menu", menu: buildMenu(currentStatus) });
      await systray.sendAction({ type: "update-item", item: tunnelToggleItem(currentStatus) });
      queueStatusNotification(currentStatus);
    }
  };

  // Watch the state file's directory so an `up`/`down` write (or a monitor tick)
  // updates the icon immediately; filter to the state file by name. Watching the
  // directory survives the file being atomically replaced (a new inode).
  const stateFileName = path.basename(STATE_FILE);
  const watcher = watch(path.dirname(STATE_FILE), (_event, filename) => {
    if (filename === stateFileName) void applyStatus();
  });

  try {
    while (!systray.killed) {
      await Bun.sleep(FALLBACK_POLL_INTERVAL_MS);
      await applyStatus();
    }
  } finally {
    if (statusNotificationTimer !== null) clearTimeout(statusNotificationTimer);
    watcher.close();
  }
}

if (import.meta.main) {
  await runTrayDaemon();
}
