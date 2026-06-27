import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Exec, ExecResult } from "../src/core/exec";
import { buildExecLaunchPlan, preflight } from "../src/cli/commands/exec";
import { sampleConfig } from "./fixtures/sing-box-config.sample";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function makeExec(responses: Record<string, string | ExecResult>): Exec {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected exec call: ${key}`);
    return typeof response === "string" ? { stdout: response, stderr: "", exitCode: 0 } : response;
  };
}

const ROUTE_GET_172_19_0_1_VIA_UTUN20 = `   route to: 172.19.0.1
destination: 172.19.0.1
  interface: utun20
`;
const IPINFO_COMMAND = "/usr/bin/curl -sS --max-time 12 https://ipinfo.io/json";
const ANTHROPIC_COUNTRY_COMMAND = "/usr/bin/curl -sS --max-time 12 https://www.anthropic.com/api/country";

const TUNNEL_UP_RESPONSES: Record<string, string | ExecResult> = {
  "/sbin/route -n get 172.19.0.1": ROUTE_GET_172_19_0_1_VIA_UTUN20,
  "/sbin/route -n get 1.1.1.1": fixture("route-get-1.1.1.1-tunnel.txt"),
};

describe("preflight", () => {
  test("fails when the tunnel is down, without resolving a public interface", async () => {
    const exec = makeExec({});
    const result = await preflight(exec, { inbounds: [] }, []);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/tunnel is down/);
    expect(result.publicInterface).toBeNull();
    expect(result.tunnelUp).toBe(false);
  });

  test("succeeds when the tunnel is up and no countries are blocked", async () => {
    const exec = makeExec(TUNNEL_UP_RESPONSES);
    const result = await preflight(exec, sampleConfig, []);

    expect(result.ok).toBe(true);
    expect(result.publicInterface).toBe("utun20");
    expect(result.tunnelUp).toBe(true);
  });

  test("fails when the public IP cannot be resolved for the geo check", async () => {
    const exec = makeExec({
      ...TUNNEL_UP_RESPONSES,
      "/usr/bin/dig +short myip.opendns.com @resolver1.opendns.com": "",
    });
    const result = await preflight(exec, sampleConfig, ["RU"]);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/could not resolve public IP/);
    expect(result.publicInterface).toBe("utun20");
    expect(result.tunnelUp).toBe(true);
  });

  test("fails when the country for the resolved IP cannot be determined", async () => {
    const exec = makeExec({
      ...TUNNEL_UP_RESPONSES,
      "/usr/bin/dig +short myip.opendns.com @resolver1.opendns.com": "203.0.113.7\n",
      "/usr/bin/curl -sS --max-time 8 https://ipinfo.io/203.0.113.7/json": { stdout: "", stderr: "timeout\n", exitCode: 28 },
    });
    const result = await preflight(exec, sampleConfig, ["RU"]);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/could not determine country for IP 203\.0\.113\.7/);
    expect(result.tunnelUp).toBe(true);
  });

  test("fails when the resolved country is in the blocked list", async () => {
    const exec = makeExec({
      ...TUNNEL_UP_RESPONSES,
      "/usr/bin/dig +short myip.opendns.com @resolver1.opendns.com": "203.0.113.7\n",
      "/usr/bin/curl -sS --max-time 8 https://ipinfo.io/203.0.113.7/json": '{"ip":"203.0.113.7","country":"RU"}',
    });
    const result = await preflight(exec, sampleConfig, ["RU"]);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/blocked country \(RU\)/);
    expect(result.tunnelUp).toBe(true);
  });

  test("succeeds when the resolved country is not in the blocked list", async () => {
    const exec = makeExec({
      ...TUNNEL_UP_RESPONSES,
      "/usr/bin/dig +short myip.opendns.com @resolver1.opendns.com": "203.0.113.7\n",
      "/usr/bin/curl -sS --max-time 8 https://ipinfo.io/203.0.113.7/json": '{"ip":"203.0.113.7","country":"NL"}',
    });
    const result = await preflight(exec, sampleConfig, ["RU"]);

    expect(result.ok).toBe(true);
    expect(result.publicInterface).toBe("utun20");
    expect(result.tunnelUp).toBe(true);
  });
});

describe("buildExecLaunchPlan", () => {
  /**
   * Дано:
   * - host tunnel проходит preflight
   * - exit profile содержит IANA timezone
   *
   * Ожидается:
   * - план запуска использует timezone VPN-выхода
   * - child process не должен наследовать host timezone молча
   */
  test("добавляет timezone из exit profile в план запуска", async () => {
    const exec = makeExec({
      ...TUNNEL_UP_RESPONSES,
      [IPINFO_COMMAND]: '{"ip":"185.72.10.210","city":"Prague","region":"Prague","country":"CZ","timezone":"Europe/Prague"}',
      [ANTHROPIC_COUNTRY_COMMAND]: '{"country":"CZ"}',
    });

    const plan = await buildExecLaunchPlan(exec, sampleConfig, []);

    expect(plan.timezone).toBe("Europe/Prague");
    expect(plan.profile?.publicIp).toBe("185.72.10.210");
    expect(plan.profileWarning).toBeNull();
  });

  /**
   * Дано:
   * - host tunnel проходит preflight
   * - exit profile не содержит timezone
   * - debug escape hatch не включен
   *
   * Ожидается:
   * - запуск останавливается fail-closed
   */
  test("останавливает запуск когда exit profile без timezone", async () => {
    const exec = makeExec({
      ...TUNNEL_UP_RESPONSES,
      [IPINFO_COMMAND]: '{"ip":"185.72.10.210","country":"CZ"}',
    });

    await expect(buildExecLaunchPlan(exec, sampleConfig, [])).rejects.toThrow(/timezone/);
  });

  /**
   * Дано:
   * - host tunnel проходит preflight
   * - exit profile не содержит timezone
   * - пользователь явно включил allow-unknown-profile
   *
   * Ожидается:
   * - запуск получает громкое предупреждение
   * - timezone становится UTC, а не timezone host
   */
  test("использует UTC только при явном allow-unknown-profile", async () => {
    const exec = makeExec({
      ...TUNNEL_UP_RESPONSES,
      [IPINFO_COMMAND]: '{"ip":"185.72.10.210","country":"CZ"}',
    });

    const plan = await buildExecLaunchPlan(exec, sampleConfig, [], true);

    expect(plan.timezone).toBe("UTC");
    expect(plan.profile).toBeNull();
    expect(plan.profileWarning).toMatch(/allow-unknown-profile/);
  });
});
