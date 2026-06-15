import { chmod, readdir, unlink, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_WRAP_DIR = path.join(os.homedir(), ".local", "bin");
export const VPNCTL_WRAP_MARKER = "# vpnctl-wrap";

export function renderWrapper(command: string, resolvedPath: string): string {
  return `#!/bin/sh\n${VPNCTL_WRAP_MARKER}\nexec vpnctl exec -- ${resolvedPath} "$@"\n`;
}

export function isVpnctlWrapper(content: string): boolean {
  return content.includes(VPNCTL_WRAP_MARKER);
}

export function parseWrappedCommand(content: string): string | null {
  const match = /exec vpnctl exec -- (\S+)/.exec(content);
  return match ? (match[1] ?? null) : null;
}

export interface WrapOptions {
  dir?: string;
}

export async function runWrapAdd(commands: string[], options: WrapOptions = {}): Promise<void> {
  const wrapDir = options.dir ?? DEFAULT_WRAP_DIR;
  await mkdir(wrapDir, { recursive: true });

  for (const command of commands) {
    const resolvedPath = Bun.which(command);
    if (resolvedPath === null) {
      throw new Error(`command not found in PATH: ${command}`);
    }

    const wrapperPath = path.join(wrapDir, command);
    const existing = Bun.file(wrapperPath);
    if (await existing.exists()) {
      const existingContent = await existing.text();
      if (!isVpnctlWrapper(existingContent)) {
        throw new Error(`refusing to overwrite ${wrapperPath}: not a vpnctl wrapper`);
      }
    }

    await writeFile(wrapperPath, renderWrapper(command, resolvedPath), { encoding: "utf8" });
    await chmod(wrapperPath, 0o755);
    console.log(`Wrapper written: ${wrapperPath} → ${resolvedPath}`);
  }

  const pathDirs = (process.env.PATH ?? "").split(":");
  if (!pathDirs.includes(wrapDir)) {
    console.log(`\nNote: ${wrapDir} is not in your PATH.`);
    console.log(`Add this to your shell profile (~/.zshrc or ~/.bashrc):`);
    console.log(`  export PATH="${wrapDir}:$PATH"`);
  }
}

export async function runWrapRemove(commands: string[], options: WrapOptions = {}): Promise<void> {
  const wrapDir = options.dir ?? DEFAULT_WRAP_DIR;

  for (const command of commands) {
    const wrapperPath = path.join(wrapDir, command);
    const file = Bun.file(wrapperPath);
    if (!(await file.exists())) {
      throw new Error(`wrapper not found: ${wrapperPath}`);
    }
    const content = await file.text();
    if (!isVpnctlWrapper(content)) {
      throw new Error(`refusing to remove ${wrapperPath}: not a vpnctl wrapper`);
    }
    await unlink(wrapperPath);
    console.log(`Removed: ${wrapperPath}`);
  }
}

export async function runWrapList(options: WrapOptions = {}): Promise<void> {
  const wrapDir = options.dir ?? DEFAULT_WRAP_DIR;

  let entries: string[];
  try {
    entries = await readdir(wrapDir);
  } catch {
    console.log("No wrappers found (wrap directory does not exist).");
    return;
  }

  const wrappers: Array<{ command: string; resolvedPath: string | null }> = [];
  for (const entry of entries) {
    const filePath = path.join(wrapDir, entry);
    const content = await Bun.file(filePath)
      .text()
      .catch(() => "");
    if (isVpnctlWrapper(content)) {
      wrappers.push({ command: entry, resolvedPath: parseWrappedCommand(content) });
    }
  }

  if (wrappers.length === 0) {
    console.log("No vpnctl wrappers installed.");
    return;
  }

  console.log(`Wrappers in ${wrapDir}:`);
  for (const { command, resolvedPath } of wrappers) {
    console.log(`  ${command} → ${resolvedPath ?? "(unknown)"}`);
  }
}
