import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STAGE_BINARIES_HELPER = path.join(import.meta.dir, "../scripts/e2e/lib/stage-binaries.sh");
const RELEASE_BINARIES = ["vpnctl", "vpnctl-monitor", "vpnctl-tunnel", "vpnctl-tray"];

async function runStageBinaries(sourceDirectory: string, installDirectory: string): Promise<void> {
  const result = Bun.spawnSync(
    ["bash", "-c", 'source "$1"; stage_e2e_binaries "$2" "$3"', "bash", STAGE_BINARIES_HELPER, sourceDirectory, installDirectory],
    { env: process.env },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
}

describe("scripts/e2e/lib/stage-binaries.sh", () => {
  test("stages release binaries and tray helper into a fresh scenario directory", async () => {
    const scratchDirectory = await mkdtemp(path.join(os.tmpdir(), "vpnctl-e2e-stage-test-"));
    const cleanup = (): Promise<void> => rm(scratchDirectory, { recursive: true, force: true });

    try {
      const sourceDirectory = path.join(scratchDirectory, "dist");
      const installDirectory = path.join(scratchDirectory, "install");
      const trayHelperPath = path.join(sourceDirectory, "traybin", "tray_darwin_release");

      await mkdir(path.dirname(trayHelperPath), { recursive: true });
      await writeFile(path.join(sourceDirectory, "vpnctl"), "#!/bin/sh\necho vpnctl\n");
      await writeFile(trayHelperPath, "#!/bin/sh\necho tray\n");
      await chmod(path.join(sourceDirectory, "vpnctl"), 0o755);
      await chmod(trayHelperPath, 0o755);

      await runStageBinaries(sourceDirectory, installDirectory);

      const binaryInodes = await Promise.all(
        RELEASE_BINARIES.map(async (binaryName) => (await stat(path.join(installDirectory, binaryName))).ino),
      );
      expect(new Set(binaryInodes).size).toBe(1);
      expect((await stat(path.join(installDirectory, "traybin", "tray_darwin_release"))).mode & 0o111).not.toBe(0);
    } finally {
      await cleanup();
    }
  });
});
