import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeHosts } from "../src/core/sinkhole";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

const CLEAN = fixture("etc-hosts.clean.txt");
const SINKHOLED = fixture("etc-hosts.sinkholed.txt");
const DOMAINS = ["api.anthropic.com", "claude.ai"];

describe("computeHosts", () => {
  test("sinkholes a clean /etc/hosts", () => {
    expect(computeHosts(CLEAN, DOMAINS, true)).toEqual({ content: SINKHOLED, changed: true });
  });

  test("cleans an already-sinkholed /etc/hosts", () => {
    expect(computeHosts(SINKHOLED, DOMAINS, false)).toEqual({ content: CLEAN, changed: true });
  });

  test("is idempotent when already clean and desired state is clean", () => {
    expect(computeHosts(CLEAN, DOMAINS, false)).toEqual({ content: CLEAN, changed: false });
  });

  test("is idempotent when already sinkholed with the same domains", () => {
    expect(computeHosts(SINKHOLED, DOMAINS, true)).toEqual({ content: SINKHOLED, changed: false });
  });

  test("preserves unrelated /etc/hosts content in both directions", () => {
    const sinkholed = computeHosts(CLEAN, DOMAINS, true).content;
    expect(sinkholed).toContain("185.199.110.154 github.githubassets.com");
    expect(sinkholed).toContain("# >>> some-other-tool unrelated-block");
    expect(sinkholed).toContain("162.159.128.233\texample.com");
    expect(sinkholed).toContain("# <<< some-other-tool unrelated-block");

    const cleaned = computeHosts(SINKHOLED, DOMAINS, false).content;
    expect(cleaned).toContain("# >>> some-other-tool unrelated-block");
    expect(cleaned).toContain("# <<< some-other-tool unrelated-block");
  });

  test("re-sinkholing with a changed domain list produces a new block", () => {
    const result = computeHosts(SINKHOLED, ["api.anthropic.com", "console.anthropic.com"], true);
    expect(result.changed).toBe(true);
    expect(result.content).toContain("0.0.0.0 console.anthropic.com");
    expect(result.content).not.toContain("claude.ai");
  });

  test("round trip: sinkhole then clean restores the original content exactly", () => {
    const sinkholed = computeHosts(CLEAN, DOMAINS, true).content;
    expect(computeHosts(sinkholed, DOMAINS, false)).toEqual({ content: CLEAN, changed: true });
  });
});
