import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RELEASE_VERSION_HELPER = path.join(import.meta.dir, "../scripts/e2e/lib/release-version.sh");

async function parseReleaseVersion(json: string): Promise<string> {
  const scratchDirectory = await mkdtemp(path.join(os.tmpdir(), "vpnctl-release-version-test-"));
  const cleanup = (): Promise<void> => rm(scratchDirectory, { recursive: true, force: true });

  try {
    await mkdir(scratchDirectory, { recursive: true });
    const jsonPath = path.join(scratchDirectory, "latest-release.json");
    await writeFile(jsonPath, json);

    const result = Bun.spawnSync(
      ["bash", "-c", 'source "$1"; parse_github_latest_release_version < "$2"', "bash", RELEASE_VERSION_HELPER, jsonPath],
      { env: process.env },
    );

    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  } finally {
    await cleanup();
  }
}

describe("scripts/e2e/lib/release-version.sh", () => {
  test("parses compact GitHub release JSON without a space after tag_name", async () => {
    await expect(parseReleaseVersion('{"tag_name":"v0.2.4"}')).resolves.toBe("0.2.4");
  });

  test("parses GitHub release JSON with whitespace around tag_name", async () => {
    await expect(parseReleaseVersion('{ "tag_name" : "0.2.5" }')).resolves.toBe("0.2.5");
  });
});
