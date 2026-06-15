import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import pkg from "../../../package.json";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { UPDATE_CHECK_CACHE_FILE } from "../../core/paths";
import { isCompiledBinary } from "../../core/runtime";
import { compareVersions } from "../../core/version";
import { requireRoot } from "../root";
import { runInstall } from "./install";

const REPO = "SoundAsleep192/vpnctl";
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_TIMEOUT_SECONDS = 5;
const DOWNLOAD_TIMEOUT_SECONDS = 60;
const UPDATE_CHECK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RELEASE_BINARIES = ["vpnctl", "vpnctl-monitor", "vpnctl-tunnel"];

const VERSION_REGEX = /^\d+(\.\d+)*$/;
const RELEASE_TAG_REGEX = /^v?\d+(\.\d+)*$/;

const githubReleaseSchema = z.object({
  tag_name: z.string().regex(RELEASE_TAG_REGEX, "tag_name must look like a version, e.g. v1.2.3"),
});

const updateCheckCacheSchema = z.object({
  checkedAt: z.number(),
  latestVersion: z.string().regex(VERSION_REGEX).nullable(),
});

type UpdateCheckCache = z.infer<typeof updateCheckCacheSchema>;

export interface LatestRelease {
  tag: string;
  version: string;
}

export async function fetchLatestRelease(exec: Exec, timeoutSeconds: number = CHECK_TIMEOUT_SECONDS): Promise<LatestRelease> {
  const result = await exec("/usr/bin/curl", [
    "-fsSL",
    "--max-time",
    String(timeoutSeconds),
    "-H",
    "User-Agent: vpnctl",
    LATEST_RELEASE_API_URL,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`failed to check ${LATEST_RELEASE_API_URL}: ${result.stderr.trim()}`);
  }

  const release = githubReleaseSchema.parse(JSON.parse(result.stdout));
  return { tag: release.tag_name, version: release.tag_name.replace(/^v/, "") };
}

export async function tryFetchLatestRelease(exec: Exec, timeoutSeconds: number = CHECK_TIMEOUT_SECONDS): Promise<LatestRelease | null> {
  try {
    return await fetchLatestRelease(exec, timeoutSeconds);
  } catch {
    return null;
  }
}

async function readUpdateCheckCache(cachePath: string): Promise<UpdateCheckCache | null> {
  try {
    return updateCheckCacheSchema.parse(await Bun.file(cachePath).json());
  } catch {
    return null;
  }
}

async function writeUpdateCheckCache(cachePath: string, cache: UpdateCheckCache): Promise<void> {
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await Bun.write(cachePath, JSON.stringify(cache));
  } catch {
    // best-effort cache; an unwritable cache dir shouldn't break status/doctor
  }
}

export async function getLatestVersion(exec: Exec, cachePath: string = UPDATE_CHECK_CACHE_FILE): Promise<string | null> {
  const cached = await readUpdateCheckCache(cachePath);
  if (cached !== null && Date.now() - cached.checkedAt < UPDATE_CHECK_CACHE_TTL_MS) {
    return cached.latestVersion;
  }

  const fetched = await tryFetchLatestRelease(exec);
  const latestVersion = fetched?.version ?? cached?.latestVersion ?? null;
  await writeUpdateCheckCache(cachePath, { checkedAt: Date.now(), latestVersion });
  return latestVersion;
}

export async function checkUpdateAvailable(
  exec: Exec,
  currentVersion: string = pkg.version,
  cachePath: string = UPDATE_CHECK_CACHE_FILE,
): Promise<string | null> {
  const latestVersion = await getLatestVersion(exec, cachePath);
  return latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0 ? latestVersion : null;
}

export function releaseAssetName(arch: string): string {
  switch (arch) {
    case "arm64":
      return "vpnctl-darwin-arm64.tar.gz";
    case "x64":
      return "vpnctl-darwin-x64.tar.gz";
    default:
      throw new Error(`unsupported architecture: ${arch}`);
  }
}

export interface UpdateOptions {
  exec?: Exec;
}

export async function runUpdate(options: UpdateOptions = {}): Promise<void> {
  if (!isCompiledBinary()) {
    throw new Error("vpnctl update only works on a release-installed binary, not a dev checkout run via `bun run`");
  }

  const exec = options.exec ?? realExec;

  const latest = await fetchLatestRelease(exec, DOWNLOAD_TIMEOUT_SECONDS);
  if (compareVersions(latest.version, pkg.version) <= 0) {
    console.log(`vpnctl is up to date (v${pkg.version}).`);
    return;
  }

  requireRoot();

  console.log(`Updating vpnctl v${pkg.version} -> v${latest.version}...`);

  const asset = releaseAssetName(process.arch);
  const url = `https://github.com/${REPO}/releases/download/${latest.tag}/${asset}`;
  const installDir = path.dirname(process.execPath);
  const stagingDir = path.join(installDir, `.vpnctl-update-${process.pid}`);

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-update-"));
  try {
    const tarballPath = path.join(tmpDir, asset);

    console.log(`Downloading ${asset}...`);
    const download = await exec("/usr/bin/curl", ["-fsSL", "--max-time", String(DOWNLOAD_TIMEOUT_SECONDS), url, "-o", tarballPath]);
    if (download.exitCode !== 0) {
      throw new Error(`failed to download ${url}: ${download.stderr.trim()}`);
    }

    await mkdir(installDir, { recursive: true });
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });

    const extract = await exec("/usr/bin/tar", ["-xzf", tarballPath, "-C", stagingDir]);
    if (extract.exitCode !== 0) {
      throw new Error(`failed to extract ${asset}: ${extract.stderr.trim()}`);
    }

    for (const binary of RELEASE_BINARIES) {
      if (!(await Bun.file(path.join(stagingDir, binary)).exists())) {
        throw new Error(`${asset} is missing ${binary} — aborting update without touching ${installDir}`);
      }
    }

    console.log(`Installing binaries to ${installDir}...`);
    for (const binary of RELEASE_BINARIES) {
      await rename(path.join(stagingDir, binary), path.join(installDir, binary));
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }

  console.log("Redeploying LaunchDaemons with the new binaries...");
  try {
    await runInstall({ exec });
  } catch (error) {
    throw new Error(
      `binaries updated to v${latest.version} in ${installDir}, but redeploying LaunchDaemons failed: ` +
        `${(error as Error).message} — rerun \`sudo vpnctl install\` to finish`,
      { cause: error },
    );
  }

  console.log(`Updated to v${latest.version}.`);
}
