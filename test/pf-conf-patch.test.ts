import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computePfConfPatch, computePfConfRevert } from "../src/core/pf-conf-patch";
import { PF_ANCHOR_NAME } from "../src/core/paths";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

const CLEAN = fixture("pf-conf.clean.txt");
const PATCHED = fixture("pf-conf.patched.txt");

describe("computePfConfPatch", () => {
  test("appends the anchor block to an unpatched pf.conf", () => {
    expect(computePfConfPatch(CLEAN, PF_ANCHOR_NAME)).toEqual({ content: PATCHED, changed: true });
  });

  test("is idempotent on an already-patched pf.conf", () => {
    expect(computePfConfPatch(PATCHED, PF_ANCHOR_NAME)).toEqual({ content: PATCHED, changed: false });
  });
});

describe("computePfConfRevert", () => {
  test("strips the anchor block back to the original pf.conf", () => {
    expect(computePfConfRevert(PATCHED)).toEqual({ content: CLEAN, changed: true });
  });

  test("is a no-op on an unpatched pf.conf", () => {
    expect(computePfConfRevert(CLEAN)).toEqual({ content: CLEAN, changed: false });
  });
});

describe("patch/revert round trip", () => {
  test("reverting a patch restores the original content exactly", () => {
    const { content: patched } = computePfConfPatch(CLEAN, PF_ANCHOR_NAME);
    expect(computePfConfRevert(patched)).toEqual({ content: CLEAN, changed: true });
  });
});
