import { describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REINSTALL_SCRIPT = path.join(import.meta.dir, "../scripts/reinstall-local.sh");

const STUB_BUN = `#!/bin/bash
set -euo pipefail
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  mkdir -p dist
  printf 'unsigned\\n' > dist/vpnctl
  chmod +x dist/vpnctl
  ln -f dist/vpnctl dist/vpnctl-monitor
  ln -f dist/vpnctl dist/vpnctl-tunnel
  ln -f dist/vpnctl dist/vpnctl-tray
  exit 0
fi
printf 'unexpected bun command: %s\\n' "$*" >&2
exit 1
`;

const STUB_CODESIGN_DIST = `#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
printf 'signed\\n' >> dist/vpnctl
rm -f dist/vpnctl-monitor dist/vpnctl-tunnel dist/vpnctl-tray
ln dist/vpnctl dist/vpnctl-monitor
ln dist/vpnctl dist/vpnctl-tunnel
ln dist/vpnctl dist/vpnctl-tray
mkdir -p dist/traybin
printf 'tray-helper\\n' > dist/traybin/tray_darwin_release
chmod +x dist/traybin/tray_darwin_release
`;

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}

describe("scripts/reinstall-local.sh", () => {
  test("installs the codesigned build output without rebuilding or replacing it", async () => {
    const scratchDirectory = await mkdtemp(path.join(os.tmpdir(), "vpnctl-reinstall-test-"));
    const cleanup = (): Promise<void> => rm(scratchDirectory, { recursive: true, force: true });

    try {
      const fakeRepository = path.join(scratchDirectory, "repo");
      const scriptsDirectory = path.join(fakeRepository, "scripts");
      const stubBinaryDirectory = path.join(scratchDirectory, "stub-bin");
      const installDirectory = path.join(scratchDirectory, "install");

      await mkdir(scriptsDirectory, { recursive: true });
      await mkdir(path.join(fakeRepository, "node_modules", "systray2", "traybin"), { recursive: true });
      await mkdir(stubBinaryDirectory);

      await copyFile(REINSTALL_SCRIPT, path.join(scriptsDirectory, "reinstall-local.sh"));
      await chmod(path.join(scriptsDirectory, "reinstall-local.sh"), 0o755);
      await writeExecutable(path.join(scriptsDirectory, "codesign-dist.sh"), STUB_CODESIGN_DIST);
      await writeExecutable(path.join(stubBinaryDirectory, "bun"), STUB_BUN);

      const result = Bun.spawnSync(["bash", path.join(scriptsDirectory, "reinstall-local.sh")], {
        env: {
          ...process.env,
          PATH: `${stubBinaryDirectory}:${process.env.PATH ?? ""}`,
          VPNCTL_INSTALL_DIR: installDirectory,
          VPNCTL_REINSTALL_OFFLINE: "1",
          VPNCTL_REINSTALL_SKIP_DAEMONS: "1",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("Copied binaries. Skipped daemon redeploy.");
      expect(await readFile(path.join(installDirectory, "vpnctl"), "utf8")).toBe("unsigned\nsigned\n");
      expect(await readFile(path.join(installDirectory, "traybin", "tray_darwin_release"), "utf8")).toBe("tray-helper\n");

      const binaryInodes = await Promise.all(
        ["vpnctl", "vpnctl-monitor", "vpnctl-tunnel", "vpnctl-tray"].map(
          async (binaryName) => (await stat(path.join(installDirectory, binaryName))).ino,
        ),
      );
      expect(new Set(binaryInodes).size).toBe(1);
    } finally {
      await cleanup();
    }
  });
});
