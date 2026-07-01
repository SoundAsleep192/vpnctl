import { constants } from "node:fs";
import { access, chmod, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PREFLIGHT_WRAPPER_COMMANDS = ["claude", "codex"] as const;
export const DEFAULT_PREFLIGHT_WRAPPER_DIR = path.join(os.homedir(), ".local", "bin");
export const VPNCTL_PREFLIGHT_WRAPPER_MARKER = "# vpnctl-wrap";

export type PreflightWrapperCommand = (typeof PREFLIGHT_WRAPPER_COMMANDS)[number];
export type PreflightWrapperInstallStatus = "installed" | "skipped";

export interface PreflightWrapperInstallResult {
  command: PreflightWrapperCommand;
  status: PreflightWrapperInstallStatus;
  message: string;
  wrapperPath: string;
  resolvedPath: string | null;
}

export interface InstallPreflightWrappersOptions {
  dir?: string;
  pathValue?: string;
}

export function renderPreflightWrapper(command: string, resolvedPath: string): string {
  return `#!/bin/sh\n${VPNCTL_PREFLIGHT_WRAPPER_MARKER}\nexec vpnctl exec -- ${resolvedPath} "$@"\n`;
}

export function isPreflightWrapper(content: string): boolean {
  return content.includes(VPNCTL_PREFLIGHT_WRAPPER_MARKER);
}

export function parsePreflightWrappedCommand(content: string): string | null {
  const match = /exec vpnctl exec -- (\S+)/.exec(content);
  return match ? (match[1] ?? null) : null;
}

export async function installPreflightWrappers(
  commands: PreflightWrapperCommand[],
  options: InstallPreflightWrappersOptions = {},
): Promise<PreflightWrapperInstallResult[]> {
  const wrapperDir = options.dir ?? DEFAULT_PREFLIGHT_WRAPPER_DIR;
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  const uniqueCommands = uniquePreflightCommands(commands);

  await mkdir(wrapperDir, { recursive: true });

  const results: PreflightWrapperInstallResult[] = [];
  for (const command of uniqueCommands) {
    const wrapperPath = path.join(wrapperDir, command);
    const resolvedPath = await findExecutableOnPath(command, pathValue, wrapperDir);

    if (resolvedPath === null) {
      results.push({
        command,
        status: "skipped",
        message: `${command} not found outside ${wrapperDir}`,
        wrapperPath,
        resolvedPath,
      });
      continue;
    }

    const existingContent = await Bun.file(wrapperPath)
      .text()
      .catch(() => null);
    if (existingContent !== null && !isPreflightWrapper(existingContent)) {
      results.push({
        command,
        status: "skipped",
        message: `${wrapperPath} already exists and is not managed by vpnctl`,
        wrapperPath,
        resolvedPath,
      });
      continue;
    }

    await writeFile(wrapperPath, renderPreflightWrapper(command, resolvedPath), { encoding: "utf8" });
    await chmod(wrapperPath, 0o755);
    results.push({
      command,
      status: "installed",
      message: `${wrapperPath} -> ${resolvedPath}`,
      wrapperPath,
      resolvedPath,
    });
  }

  return results;
}

export async function findExecutableOnPath(command: string, pathValue: string, excludedDirectory: string): Promise<string | null> {
  for (const directory of pathValue.split(":")) {
    if (directory.length === 0 || samePath(directory, excludedDirectory)) continue;
    const candidatePath = path.join(directory, command);
    try {
      const candidateStat = await stat(candidatePath);
      if (!candidateStat.isFile()) continue;
      await access(candidatePath, constants.X_OK);
      return candidatePath;
    } catch {
      continue;
    }
  }

  return null;
}

function samePath(leftPath: string, rightPath: string): boolean {
  return path.resolve(leftPath) === path.resolve(rightPath);
}

function uniquePreflightCommands(commands: PreflightWrapperCommand[]): PreflightWrapperCommand[] {
  const uniqueCommands: PreflightWrapperCommand[] = [];
  for (const command of commands) {
    if (!uniqueCommands.includes(command)) uniqueCommands.push(command);
  }
  return uniqueCommands;
}
