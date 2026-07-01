import path from "node:path";

export async function resolveDaemonBinaryPath(
  binaryName: string,
  exists: (filePath: string) => Promise<boolean> = (filePath) => Bun.file(filePath).exists(),
): Promise<string> {
  const candidate = path.join(path.dirname(process.execPath), binaryName);
  if (await exists(candidate)) return candidate;
  throw new Error(`${binaryName} not found next to ${process.execPath} — reinstall vpnctl so the daemon binaries are present alongside it`);
}
