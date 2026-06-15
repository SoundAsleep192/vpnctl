import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { formatKillswitchNotice } from "../../core/killswitch-notice";
import { getPublicInterface, isTunnelUpByRoute, resolveCountry, resolvePublicIp } from "../../core/network";
import { GENERATED_SINGBOX_CONFIG } from "../../core/paths";
import { readSingBoxConfig } from "../../core/singbox-config";

export interface PreflightResult {
  ok: boolean;
  reason?: string;
  publicInterface: string | null;
  tunnelUp: boolean;
}

export async function preflight(exec: Exec, singboxConfig: unknown, blockedCountries: string[]): Promise<PreflightResult> {
  const tunnelUp = await isTunnelUpByRoute(exec, singboxConfig);
  if (!tunnelUp) {
    return {
      ok: false,
      reason: "tunnel is down or default route is not via the tunnel interface — run `sudo vpnctl up`",
      publicInterface: null,
      tunnelUp: false,
    };
  }

  const publicInterface = await getPublicInterface(exec);

  if (blockedCountries.length > 0) {
    const ip = await resolvePublicIp(exec);
    if (ip === null) {
      return { ok: false, reason: "could not resolve public IP for geo check", publicInterface, tunnelUp };
    }

    const country = await resolveCountry(exec, ip);
    if (country === null) {
      return { ok: false, reason: `could not determine country for IP ${ip}`, publicInterface, tunnelUp };
    }

    if (blockedCountries.includes(country)) {
      return { ok: false, reason: `public IP ${ip} is in a blocked country (${country})`, publicInterface, tunnelUp };
    }
  }

  return { ok: true, publicInterface, tunnelUp };
}

export interface ExecCommandOptions {
  exec?: Exec;
}

export async function runExec(command: string[], options: ExecCommandOptions = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  const config = await loadConfig();
  const singboxConfig = await readSingBoxConfig(GENERATED_SINGBOX_CONFIG);

  const result = await preflight(exec, singboxConfig, config.exec.blockedCountries);
  if (!result.ok) {
    const notice = formatKillswitchNotice(config.domains, result.tunnelUp);
    if (notice !== null) console.error(notice);
    throw new Error(result.reason);
  }

  console.log(`[OK] VPN tunnel via ${result.publicInterface}`);

  if (command.length === 0) {
    console.log("[OK] pre-flight passed.");
    return;
  }

  console.log(`[OK] pre-flight passed. Launching: ${command.join(" ")}`);

  const proc = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(await proc.exited);
}
