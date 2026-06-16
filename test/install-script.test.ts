import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const INSTALL_SCRIPT = path.join(import.meta.dir, "../scripts/install.sh");
const RELEASE_BINARIES = ["vpnctl", "vpnctl-monitor", "vpnctl-tunnel", "vpnctl-tray"];

const STUB_CURL = `#!/bin/bash
set -euo pipefail
dest=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    dest="$2"
    shift 2
  else
    shift
  fi
done
cp "$FIXTURE_TARBALL" "$dest"
`;

function stubUname(unameS: string, unameM: string): string {
  return `#!/bin/bash
if [ "$1" = "-s" ]; then echo "${unameS}"; else echo "${unameM}"; fi
`;
}

async function writeStubBinary(dir: string, name: string, contents: string): Promise<void> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}

async function buildFixtureTarball(dir: string): Promise<string> {
  const sourceDir = path.join(dir, "fixture-src");
  await mkdir(sourceDir);
  for (const name of RELEASE_BINARIES) {
    await writeFile(path.join(sourceDir, name), `#!/bin/sh\necho ${name}\n`);
    await chmod(path.join(sourceDir, name), 0o755);
  }

  const tarballPath = path.join(dir, "fixture.tar.gz");
  const result = Bun.spawnSync(["tar", "-czf", tarballPath, "-C", sourceDir, "."]);
  if (result.exitCode !== 0) throw new Error(`failed to build fixture tarball: ${result.stderr.toString()}`);
  return tarballPath;
}

interface RunInstallOptions {
  unameS?: string;
  unameM?: string;
  installDirOnPath?: boolean;
}

interface RunInstallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  installDir: string;
  cleanup: () => Promise<void>;
}

async function runInstallScript(options: RunInstallOptions = {}): Promise<RunInstallResult> {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-install-test-"));
  const cleanup = (): Promise<void> => rm(scratchDir, { recursive: true, force: true });

  const stubBinDir = path.join(scratchDir, "stub-bin");
  await mkdir(stubBinDir);
  await writeStubBinary(stubBinDir, "uname", stubUname(options.unameS ?? "Darwin", options.unameM ?? "arm64"));
  await writeStubBinary(stubBinDir, "curl", STUB_CURL);

  const fixtureTarball = await buildFixtureTarball(scratchDir);

  const home = path.join(scratchDir, "home");
  await mkdir(home);
  const installDir = path.join(home, ".local", "bin");

  const pathEntries = [stubBinDir, ...(options.installDirOnPath ? [installDir] : []), process.env.PATH ?? ""];

  const result = Bun.spawnSync(["bash", INSTALL_SCRIPT], {
    env: {
      ...process.env,
      PATH: pathEntries.join(":"),
      HOME: home,
      VPNCTL_INSTALL_DIR: installDir,
      FIXTURE_TARBALL: fixtureTarball,
    },
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    installDir,
    cleanup,
  };
}

describe("scripts/install.sh", () => {
  test("downloads the matching release asset and installs all binaries as executables", async () => {
    const { exitCode, stdout, installDir, cleanup } = await runInstallScript();
    try {
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Installed vpnctl, vpnctl-monitor, vpnctl-tunnel, vpnctl-tray to ${installDir}`);

      for (const name of RELEASE_BINARIES) {
        const binaryStat = await stat(path.join(installDir, name));
        expect(binaryStat.mode & 0o111).not.toBe(0);
      }
    } finally {
      await cleanup();
    }
  });

  test("resolves the x64 release asset on Intel Macs", async () => {
    const { exitCode, installDir, cleanup } = await runInstallScript({ unameM: "x86_64" });
    try {
      expect(exitCode).toBe(0);
      const binaryStat = await stat(path.join(installDir, "vpnctl"));
      expect(binaryStat.isFile()).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("warns when the install directory is not on PATH", async () => {
    const { stdout, installDir, cleanup } = await runInstallScript({ installDirOnPath: false });
    try {
      expect(stdout).toContain(`${installDir} is not on your PATH`);
    } finally {
      await cleanup();
    }
  });

  test("doesn't warn when the install directory is already on PATH", async () => {
    const { stdout, cleanup } = await runInstallScript({ installDirOnPath: true });
    try {
      expect(stdout).not.toContain("is not on your PATH");
    } finally {
      await cleanup();
    }
  });

  test("exits with an error on non-macOS platforms", async () => {
    const { exitCode, stderr, cleanup } = await runInstallScript({ unameS: "Linux" });
    try {
      expect(exitCode).toBe(1);
      expect(stderr).toContain("vpnctl only supports macOS.");
    } finally {
      await cleanup();
    }
  });

  test("exits with an error on unsupported architectures", async () => {
    const { exitCode, stderr, cleanup } = await runInstallScript({ unameM: "i386" });
    try {
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Unsupported architecture: i386");
    } finally {
      await cleanup();
    }
  });
});
