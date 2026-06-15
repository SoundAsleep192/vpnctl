import { rm } from "node:fs/promises";
import type { Exec } from "./exec";

export interface PlistOptions {
  label: string;
  programArguments: string[];
  runAtLoad: boolean;
  keepAlive: boolean;
  throttleIntervalSec?: number;
  startIntervalSec?: number;
  stdoutPath: string;
  stderrPath: string;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlBool(value: boolean): string {
  return value ? "<true/>" : "<false/>";
}

export function renderPlist(opts: PlistOptions): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${escapeXml(opts.label)}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    ...opts.programArguments.map((arg) => `\t\t<string>${escapeXml(arg)}</string>`),
    "\t</array>",
    "\t<key>RunAtLoad</key>",
    `\t${xmlBool(opts.runAtLoad)}`,
    "\t<key>KeepAlive</key>",
    `\t${xmlBool(opts.keepAlive)}`,
  ];

  if (opts.throttleIntervalSec !== undefined) {
    lines.push("\t<key>ThrottleInterval</key>", `\t<integer>${opts.throttleIntervalSec}</integer>`);
  }
  if (opts.startIntervalSec !== undefined) {
    lines.push("\t<key>StartInterval</key>", `\t<integer>${opts.startIntervalSec}</integer>`);
  }

  lines.push(
    "\t<key>StandardOutPath</key>",
    `\t<string>${escapeXml(opts.stdoutPath)}</string>`,
    "\t<key>StandardErrorPath</key>",
    `\t<string>${escapeXml(opts.stderrPath)}</string>`,
    "</dict>",
    "</plist>",
  );

  return lines.join("\n") + "\n";
}

// launchd's async teardown of a busy daemon (the monitor mid-reconcile over
// dozens of domains + pf tables) can outlast a short retry window on slow or
// loaded machines — the E2E tier reproduced a teardown that ran past 5s on a
// constrained VM, exhausting the old 10×500ms budget and leaving the monitor
// daemon DOWN after a redeploy. The budget below is a capped linear backoff
// with a ~27s patience ceiling (500ms, 1s, then 1.5s steps), so a self
// `install`/`update` waits out a slow teardown instead of killing the
// killswitch. Normal teardowns still clear in 1-2 retries (<1s).
export const BOOTSTRAP_TEARDOWN_RETRY_ATTEMPTS = 20;
const BOOTSTRAP_TEARDOWN_RETRY_BASE_DELAY_MS = 500;
const BOOTSTRAP_TEARDOWN_RETRY_MAX_DELAY_MS = 1500;
// launchd reports the async-teardown collision as errno 5 (EIO):
// "Bootstrap failed: 5: Input/output error". Match the errno number too, in
// case `strerror` is localized under a non-C locale.
const BOOTSTRAP_TEARDOWN_ERROR = /Input\/output error|(?:failed|error): 5\b/i;

export function bootstrapTeardownRetryDelayMs(attempt: number): number {
  return Math.min(BOOTSTRAP_TEARDOWN_RETRY_BASE_DELAY_MS * attempt, BOOTSTRAP_TEARDOWN_RETRY_MAX_DELAY_MS);
}

export async function installDaemon(
  exec: Exec,
  label: string,
  plistPath: string,
  plistContent: string,
  domain: "system" | `gui/${string}`,
  sleep: (ms: number) => Promise<void> = Bun.sleep,
): Promise<void> {
  await Bun.write(plistPath, plistContent);
  await exec("/bin/launchctl", ["bootout", `${domain}/${label}`]);

  // A prior `launchctl disable` (e.g. from `vpnctl down`) leaves a persistent
  // override that makes `bootstrap` fail with "5: Input/output error" even
  // after the job is booted out and the plist removed — clear it first.
  await enableDaemon(exec, label, domain);

  let result = await exec("/bin/launchctl", ["bootstrap", domain, plistPath]);
  for (
    let attempt = 1;
    attempt < BOOTSTRAP_TEARDOWN_RETRY_ATTEMPTS && result.exitCode !== 0 && BOOTSTRAP_TEARDOWN_ERROR.test(result.stderr);
    attempt++
  ) {
    // When the job was actively running, launchd tears it down asynchronously
    // after `bootout` returns — `launchctl print` keeps reporting it loaded
    // throughout, then `bootstrap` for the same label collides with the
    // in-flight teardown and fails with "5: Input/output error". Retry until
    // teardown completes.
    console.warn(
      `launchd still tearing down ${label}; retrying bootstrap (attempt ${attempt + 1}/${BOOTSTRAP_TEARDOWN_RETRY_ATTEMPTS})...`,
    );
    await sleep(bootstrapTeardownRetryDelayMs(attempt));
    result = await exec("/bin/launchctl", ["bootstrap", domain, plistPath]);
  }
  if (result.exitCode !== 0) {
    throw new Error(`failed to bootstrap ${label}: ${result.stderr.trim()}`);
  }
}

export async function uninstallDaemon(exec: Exec, label: string, plistPath: string, domain: string): Promise<void> {
  await exec("/bin/launchctl", ["bootout", `${domain}/${label}`]);
  await rm(plistPath, { force: true });
}

export async function isLoaded(exec: Exec, label: string, domain: string): Promise<boolean> {
  const result = await exec("/bin/launchctl", ["print", `${domain}/${label}`]);
  return result.exitCode === 0;
}

export async function bootstrapDaemon(exec: Exec, label: string, plistPath: string, domain: string): Promise<void> {
  const result = await exec("/bin/launchctl", ["bootstrap", domain, plistPath]);
  if (result.exitCode !== 0) {
    throw new Error(`failed to bootstrap ${label}: ${result.stderr.trim()}`);
  }
}

export async function bootoutDaemon(exec: Exec, label: string, domain: string): Promise<void> {
  const result = await exec("/bin/launchctl", ["bootout", `${domain}/${label}`]);
  if (result.exitCode !== 0) {
    throw new Error(`failed to bootout ${label}: ${result.stderr.trim()}`);
  }
}

export async function enableDaemon(exec: Exec, label: string, domain: string): Promise<void> {
  const result = await exec("/bin/launchctl", ["enable", `${domain}/${label}`]);
  if (result.exitCode !== 0) {
    throw new Error(`failed to enable ${label}: ${result.stderr.trim()}`);
  }
}

export async function disableDaemon(exec: Exec, label: string, domain: string): Promise<void> {
  const result = await exec("/bin/launchctl", ["disable", `${domain}/${label}`]);
  if (result.exitCode !== 0) {
    throw new Error(`failed to disable ${label}: ${result.stderr.trim()}`);
  }
}

export async function kickstart(exec: Exec, label: string, domain: string, kill = false): Promise<void> {
  const target = `${domain}/${label}`;
  const args = kill ? ["kickstart", "-k", target] : ["kickstart", target];

  const result = await exec("/bin/launchctl", args);
  if (result.exitCode !== 0) {
    throw new Error(`failed to kickstart ${label}: ${result.stderr.trim()}`);
  }
}

export async function killService(exec: Exec, label: string, domain: string, signal: "TERM" | "KILL"): Promise<void> {
  const result = await exec("/bin/launchctl", ["kill", signal, `${domain}/${label}`]);
  if (result.exitCode !== 0) {
    throw new Error(`failed to send ${signal} to ${label}: ${result.stderr.trim()}`);
  }
}
