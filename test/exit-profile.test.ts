import { describe, expect, test } from "bun:test";
import type { Exec, ExecResult } from "../src/core/exec";
import { formatExitProfileLine, resolveExitProfile } from "../src/core/exit-profile";

const IPINFO_COMMAND = "/usr/bin/curl -sS --max-time 12 https://ipinfo.io/json";
const ANTHROPIC_COUNTRY_COMMAND = "/usr/bin/curl -sS --max-time 12 https://www.anthropic.com/api/country";

function makeExec(responses: Record<string, string | ExecResult>): Exec {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return typeof response === "string" ? { stdout: response, stderr: "", exitCode: 0 } : response;
  };
}

describe("resolveExitProfile", () => {
  test("builds an exit profile from ipinfo and Anthropic country", async () => {
    const exec = makeExec({
      [IPINFO_COMMAND]:
        '{"ip":"185.72.10.210","city":"Prague","region":"Prague","country":"CZ","loc":"50.0880,14.4208","timezone":"Europe/Prague"}',
      [ANTHROPIC_COUNTRY_COMMAND]: '{"country":"CZ"}',
    });

    const result = await resolveExitProfile(exec);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.profile).toEqual({
      publicIp: "185.72.10.210",
      country: "CZ",
      region: "Prague",
      city: "Prague",
      latitude: 50.088,
      longitude: 14.4208,
      timezone: "Europe/Prague",
      anthropicCountry: "CZ",
      confidence: "high",
      sources: {
        geo: "https://ipinfo.io/json",
        providerCountry: "https://www.anthropic.com/api/country",
      },
    });
    expect(formatExitProfileLine(result.profile)).toBe("185.72.10.210 CZ Prague Europe/Prague Anthropic:CZ");
  });

  test("keeps the profile usable without Anthropic country and lowers confidence", async () => {
    const exec = makeExec({
      [IPINFO_COMMAND]: '{"ip":"185.72.10.210","country":"CZ","timezone":"Europe/Prague"}',
      [ANTHROPIC_COUNTRY_COMMAND]: { stdout: "", stderr: "timeout", exitCode: 28 },
    });

    const result = await resolveExitProfile(exec);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.profile.anthropicCountry).toBeNull();
    expect(result.profile.confidence).toBe("medium");
  });

  test("fails closed when timezone cannot be resolved", async () => {
    const exec = makeExec({
      [IPINFO_COMMAND]: '{"ip":"185.72.10.210","country":"CZ"}',
    });

    const result = await resolveExitProfile(exec);

    expect(result).toEqual({
      ok: false,
      reason: "timezone-missing",
      message: "ipinfo response did not include timezone for 185.72.10.210",
      publicIp: "185.72.10.210",
    });
  });
});
