import { loadConfig, type RoutingMode } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { formatKillswitchNotice } from "../../core/killswitch-notice";
import { getPublicInterface, isTunnelUp } from "../../core/network";
import { GENERATED_SINGBOX_CONFIG, TUNNEL_PID_FILE } from "../../core/paths";
import { readSingBoxConfig } from "../../core/singbox-config";
import { requireRoot } from "../root";

const PROBE_TIMEOUT_SEC = 14;

export const QUICK_CHECK_DOMAINS = [
  "api.anthropic.com",
  "api.openai.com",
  "api.chatgpt.com",
  "chatgpt.com",
  "cursor.com",
  "api2.cursor.sh",
  "marketplace.cursorapi.com",
  "platform.openai.com",
];

export interface ProbeResult {
  domain: string;
  ok: boolean;
  code: string;
}

export async function probeDomain(exec: Exec, domain: string, timeoutSec = PROBE_TIMEOUT_SEC): Promise<ProbeResult> {
  const result = await exec("/usr/bin/curl", [
    "-g",
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "-m",
    String(timeoutSec),
    "--head",
    `https://${domain}/`,
  ]);

  const code = result.stdout.trim();
  const ok = result.exitCode === 0 && code !== "" && code !== "000";
  return { domain, ok, code: ok ? code : "ERR" };
}

export async function runProbes(exec: Exec, domains: string[], timeoutSec = PROBE_TIMEOUT_SEC): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const domain of domains) {
    results.push(await probeDomain(exec, domain, timeoutSec));
  }
  return results;
}

export function formatProbeResults(results: ProbeResult[]): string {
  const lines = ["probing HTTPS HEAD (2xx/3xx/401/403/404 = reached host TLS)", "---"];

  for (const result of results) {
    lines.push(result.ok ? `OK   ${result.domain}  HTTP ${result.code}` : `BAD  ${result.domain}`);
  }

  lines.push("---");

  const failed = results.filter((result) => !result.ok);
  lines.push(
    failed.length === 0 ? "all probes OK." : `${failed.length} probe(s) failed: ${failed.map((result) => result.domain).join(", ")}`,
  );

  return lines.join("\n");
}

export function formatRouteProof(publicInterface: string | null, routingMode: RoutingMode): string {
  const interfaceName = publicInterface ?? "none";
  if (routingMode === "split") {
    return `route OK -> ${interfaceName} (split mode: generic IP-check sites stay direct; protected domains are probed below)`;
  }
  return `route OK -> ${interfaceName}`;
}

export interface CheckOptions {
  exec?: Exec;
  full?: boolean;
}

export async function runCheck(options: CheckOptions = {}): Promise<void> {
  requireRoot();

  const exec = options.exec ?? realExec;
  const config = await loadConfig();
  const singboxConfig = await readSingBoxConfig(GENERATED_SINGBOX_CONFIG);

  if (!(await isTunnelUp(exec, singboxConfig, TUNNEL_PID_FILE))) {
    const notice = formatKillswitchNotice(config.domains, false);
    if (notice !== null) console.error(notice);
    throw new Error("tunnel is down (public route is not via the tunnel interface) — run `sudo vpnctl up`");
  }

  console.log(formatRouteProof(await getPublicInterface(exec), config.routing.mode));

  const domains = options.full ? config.domains : QUICK_CHECK_DOMAINS;
  const results = await runProbes(exec, domains);
  console.log(formatProbeResults(results));

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}
