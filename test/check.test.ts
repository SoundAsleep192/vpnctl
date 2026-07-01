import { describe, expect, test } from "bun:test";
import type { Exec, ExecResult } from "../src/core/exec";
import { formatProbeResults, formatRouteProof, probeDomain, runProbes } from "../src/cli/commands/check";

function makeExec(responses: Record<string, ExecResult>): Exec {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return response;
  };
}

describe("probeDomain", () => {
  test("reports ok with the HTTP status code for a reachable host", async () => {
    const exec = makeExec({
      "/usr/bin/curl -g -sS -o /dev/null -w %{http_code} -m 14 --head https://api.anthropic.com/": {
        stdout: "200",
        stderr: "",
        exitCode: 0,
      },
    });

    expect(await probeDomain(exec, "api.anthropic.com")).toEqual({ domain: "api.anthropic.com", ok: true, code: "200" });
  });

  test("treats 4xx/5xx as ok (host was reached)", async () => {
    const exec = makeExec({
      "/usr/bin/curl -g -sS -o /dev/null -w %{http_code} -m 14 --head https://example.com/": {
        stdout: "403",
        stderr: "",
        exitCode: 0,
      },
    });

    expect(await probeDomain(exec, "example.com")).toEqual({ domain: "example.com", ok: true, code: "403" });
  });

  test("reports ERR when curl reports code 000 (connection failure)", async () => {
    const exec = makeExec({
      "/usr/bin/curl -g -sS -o /dev/null -w %{http_code} -m 14 --head https://blocked.example/": {
        stdout: "000",
        stderr: "",
        exitCode: 0,
      },
    });

    expect(await probeDomain(exec, "blocked.example")).toEqual({ domain: "blocked.example", ok: false, code: "ERR" });
  });

  test("reports ERR when curl itself fails", async () => {
    const exec = makeExec({
      "/usr/bin/curl -g -sS -o /dev/null -w %{http_code} -m 14 --head https://timeout.example/": {
        stdout: "",
        stderr: "curl: (28) Connection timed out\n",
        exitCode: 28,
      },
    });

    expect(await probeDomain(exec, "timeout.example")).toEqual({ domain: "timeout.example", ok: false, code: "ERR" });
  });

  test("uses a custom timeout when given", async () => {
    const exec = makeExec({
      "/usr/bin/curl -g -sS -o /dev/null -w %{http_code} -m 5 --head https://example.com/": {
        stdout: "200",
        stderr: "",
        exitCode: 0,
      },
    });

    expect(await probeDomain(exec, "example.com", 5)).toEqual({ domain: "example.com", ok: true, code: "200" });
  });
});

describe("runProbes", () => {
  test("probes each domain in order", async () => {
    const exec = makeExec({
      "/usr/bin/curl -g -sS -o /dev/null -w %{http_code} -m 14 --head https://a.example/": { stdout: "200", stderr: "", exitCode: 0 },
      "/usr/bin/curl -g -sS -o /dev/null -w %{http_code} -m 14 --head https://b.example/": { stdout: "000", stderr: "", exitCode: 0 },
    });

    expect(await runProbes(exec, ["a.example", "b.example"])).toEqual([
      { domain: "a.example", ok: true, code: "200" },
      { domain: "b.example", ok: false, code: "ERR" },
    ]);
  });
});

describe("formatProbeResults", () => {
  test("renders OK lines with status codes and a success summary", () => {
    const output = formatProbeResults([
      { domain: "a.example", ok: true, code: "200" },
      { domain: "b.example", ok: true, code: "403" },
    ]);

    expect(output).toContain("OK   a.example  HTTP 200");
    expect(output).toContain("OK   b.example  HTTP 403");
    expect(output).toContain("all probes OK.");
  });

  test("renders BAD lines and a failure summary", () => {
    const output = formatProbeResults([
      { domain: "a.example", ok: true, code: "200" },
      { domain: "b.example", ok: false, code: "ERR" },
    ]);

    expect(output).toContain("OK   a.example  HTTP 200");
    expect(output).toContain("BAD  b.example");
    expect(output).toContain("1 probe(s) failed: b.example");
  });
});

describe("formatRouteProof", () => {
  test("renders a direct route proof for full tunnel mode", () => {
    expect(formatRouteProof("utun20", "full")).toBe("route OK -> utun20");
  });

  test("explains why generic IP checks are direct in split mode", () => {
    expect(formatRouteProof("utun20", "split")).toContain("generic IP-check sites stay direct");
  });
});
