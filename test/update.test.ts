import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkUpdateAvailable,
  fetchLatestRelease,
  getLatestVersion,
  releaseAssetName,
  runUpdate,
  tryFetchLatestRelease,
} from "../src/cli/commands/update";
import type { Exec } from "../src/core/exec";

const RELEASE_URL = "https://api.github.com/repos/SoundAsleep192/vpnctl/releases/latest";
const RELEASE_CALL_5S = `/usr/bin/curl -fsSL --max-time 5 -H User-Agent: vpnctl ${RELEASE_URL}`;

function makeExec(responses: Record<string, { stdout?: string; exitCode?: number; stderr?: string }>): {
  exec: Exec;
  calls: string[];
} {
  const calls: string[] = [];
  const exec: Exec = async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    calls.push(key);
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return { stdout: response.stdout ?? "", stderr: response.stderr ?? "", exitCode: response.exitCode ?? 0 };
  };
  return { exec, calls };
}

async function withTmpCachePath(run: (cachePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vpnctl-update-test-"));
  try {
    await run(path.join(dir, "update-check.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("fetchLatestRelease", () => {
  test("strips the leading v from the tag to produce a comparable version", async () => {
    const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.2.0" }) } });
    expect(await fetchLatestRelease(exec)).toEqual({ tag: "v0.2.0", version: "0.2.0" });
  });

  test("throws when curl fails", async () => {
    const { exec } = makeExec({ [RELEASE_CALL_5S]: { exitCode: 1, stderr: "curl: connection refused" } });
    await expect(fetchLatestRelease(exec)).rejects.toThrow(/connection refused/);
  });

  test("throws when the response is missing tag_name", async () => {
    const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({}) } });
    await expect(fetchLatestRelease(exec)).rejects.toThrow();
  });

  test("throws when tag_name doesn't look like a version", async () => {
    const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "release-2024" }) } });
    await expect(fetchLatestRelease(exec)).rejects.toThrow();
  });
});

describe("tryFetchLatestRelease", () => {
  test("returns the release on success", async () => {
    const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.2.0" }) } });
    expect(await tryFetchLatestRelease(exec)).toEqual({ tag: "v0.2.0", version: "0.2.0" });
  });

  test("returns null when the check fails", async () => {
    const { exec } = makeExec({ [RELEASE_CALL_5S]: { exitCode: 1, stderr: "curl: timed out" } });
    expect(await tryFetchLatestRelease(exec)).toBeNull();
  });
});

describe("getLatestVersion", () => {
  test("fetches and caches the latest version on a cold cache", async () => {
    await withTmpCachePath(async (cachePath) => {
      const { exec, calls } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.2.0" }) } });
      expect(await getLatestVersion(exec, cachePath)).toBe("0.2.0");
      expect(calls).toEqual([RELEASE_CALL_5S]);

      const cached = await Bun.file(cachePath).text();
      expect(cached).toContain('"latestVersion":"0.2.0"');
    });
  });

  test("serves from cache without hitting the network when fresh", async () => {
    await withTmpCachePath(async (cachePath) => {
      await Bun.write(cachePath, JSON.stringify({ checkedAt: Date.now(), latestVersion: "0.2.0" }));

      const { exec, calls } = makeExec({});
      expect(await getLatestVersion(exec, cachePath)).toBe("0.2.0");
      expect(calls).toEqual([]);
    });
  });

  test("re-fetches when the cache entry is stale", async () => {
    await withTmpCachePath(async (cachePath) => {
      const staleTimestamp = Date.now() - 7 * 60 * 60 * 1000;
      await Bun.write(cachePath, JSON.stringify({ checkedAt: staleTimestamp, latestVersion: "0.1.0" }));

      const { exec, calls } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.3.0" }) } });
      expect(await getLatestVersion(exec, cachePath)).toBe("0.3.0");
      expect(calls).toEqual([RELEASE_CALL_5S]);
    });
  });

  test("falls back to the last known version when a refresh fails", async () => {
    await withTmpCachePath(async (cachePath) => {
      const staleTimestamp = Date.now() - 7 * 60 * 60 * 1000;
      await Bun.write(cachePath, JSON.stringify({ checkedAt: staleTimestamp, latestVersion: "0.2.0" }));

      const { exec } = makeExec({ [RELEASE_CALL_5S]: { exitCode: 1, stderr: "curl: timed out" } });
      expect(await getLatestVersion(exec, cachePath)).toBe("0.2.0");
    });
  });

  test("returns null when there's no cache and the first check fails", async () => {
    await withTmpCachePath(async (cachePath) => {
      const { exec } = makeExec({ [RELEASE_CALL_5S]: { exitCode: 1, stderr: "curl: timed out" } });
      expect(await getLatestVersion(exec, cachePath)).toBeNull();
    });
  });

  test("treats a malformed cache file as a cache miss", async () => {
    await withTmpCachePath(async (cachePath) => {
      await writeFile(cachePath, "not json");

      const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.2.0" }) } });
      expect(await getLatestVersion(exec, cachePath)).toBe("0.2.0");
    });
  });

  test("treats a cache with a non-version latestVersion as a cache miss", async () => {
    await withTmpCachePath(async (cachePath) => {
      await Bun.write(cachePath, JSON.stringify({ checkedAt: Date.now(), latestVersion: "bad" }));

      const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.2.0" }) } });
      expect(await getLatestVersion(exec, cachePath)).toBe("0.2.0");
    });
  });
});

describe("checkUpdateAvailable", () => {
  test("returns the newer version when one is available", async () => {
    await withTmpCachePath(async (cachePath) => {
      const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.2.0" }) } });
      expect(await checkUpdateAvailable(exec, "0.1.5", cachePath)).toBe("0.2.0");
    });
  });

  test("returns null when already up to date", async () => {
    await withTmpCachePath(async (cachePath) => {
      const { exec } = makeExec({ [RELEASE_CALL_5S]: { stdout: JSON.stringify({ tag_name: "v0.1.5" }) } });
      expect(await checkUpdateAvailable(exec, "0.1.5", cachePath)).toBeNull();
    });
  });

  test("returns null when the check fails", async () => {
    await withTmpCachePath(async (cachePath) => {
      const { exec } = makeExec({ [RELEASE_CALL_5S]: { exitCode: 1 } });
      expect(await checkUpdateAvailable(exec, "0.1.5", cachePath)).toBeNull();
    });
  });
});

describe("releaseAssetName", () => {
  test("maps arm64 to the arm64 release asset", () => {
    expect(releaseAssetName("arm64")).toBe("vpnctl-darwin-arm64.tar.gz");
  });

  test("maps x64 to the x64 release asset", () => {
    expect(releaseAssetName("x64")).toBe("vpnctl-darwin-x64.tar.gz");
  });

  test("throws on unsupported architectures", () => {
    expect(() => releaseAssetName("ia32")).toThrow(/unsupported architecture: ia32/);
  });
});

describe("runUpdate", () => {
  test("refuses to run outside a compiled release binary", async () => {
    await expect(runUpdate()).rejects.toThrow(/only works on a release-installed binary/);
  });
});
