import { loadConfig } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import type { ExitProfile } from "../../core/exit-profile";
import { formatExitProfileLine, resolveExitProfile } from "../../core/exit-profile";
import { formatKillswitchNotice } from "../../core/killswitch-notice";
import { getPublicInterface, isTunnelUpByRoute, resolveCountry, resolvePublicIp } from "../../core/network";
import { GENERATED_SINGBOX_CONFIG } from "../../core/paths";
import { readSingBoxConfig } from "../../core/singbox-config";

const UNKNOWN_PROFILE_DEBUG_TIMEZONE = "UTC";

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
  allowUnknownProfile?: boolean;
}

export interface ExecLaunchPlan {
  publicInterface: string | null;
  tunnelUp: boolean;
  timezone: string;
  profile: ExitProfile | null;
  profileWarning: string | null;
}

export async function buildExecLaunchPlan(
  exec: Exec,
  singboxConfig: unknown,
  blockedCountries: string[],
  allowUnknownProfile = false,
): Promise<ExecLaunchPlan> {
  const result = await preflight(exec, singboxConfig, blockedCountries);
  if (!result.ok) throw new Error(result.reason);

  const profileResult = await resolveExitProfile(exec);
  if (!profileResult.ok) {
    if (!allowUnknownProfile) throw new Error(profileResult.message);

    return {
      publicInterface: result.publicInterface,
      tunnelUp: result.tunnelUp,
      timezone: UNKNOWN_PROFILE_DEBUG_TIMEZONE,
      profile: null,
      profileWarning: `${profileResult.message}; using TZ=${UNKNOWN_PROFILE_DEBUG_TIMEZONE} because --allow-unknown-profile was set`,
    };
  }

  return {
    publicInterface: result.publicInterface,
    tunnelUp: result.tunnelUp,
    timezone: profileResult.profile.timezone,
    profile: profileResult.profile,
    profileWarning: null,
  };
}

function buildChildEnv(timezone: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(Bun.env)) {
    if (value !== undefined) env[name] = value;
  }
  env.TZ = timezone;
  return env;
}

export async function runExec(command: string[], options: ExecCommandOptions = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  const config = await loadConfig();
  const singboxConfig = await readSingBoxConfig(GENERATED_SINGBOX_CONFIG);

  let launchPlan: ExecLaunchPlan;
  try {
    launchPlan = await buildExecLaunchPlan(exec, singboxConfig, config.exec.blockedCountries, options.allowUnknownProfile);
  } catch (error) {
    const tunnelUp = await isTunnelUpByRoute(exec, singboxConfig);
    const notice = formatKillswitchNotice(config.domains, tunnelUp);
    if (notice !== null) console.error(notice);
    throw error;
  }

  console.log(`[OK] VPN tunnel via ${launchPlan.publicInterface}`);
  if (launchPlan.profile === null) {
    console.error(`[WARN] ${launchPlan.profileWarning}`);
  } else {
    console.log(`Exit: ${formatExitProfileLine(launchPlan.profile)}`);
  }

  if (command.length === 0) {
    console.log("[OK] pre-flight passed.");
    return;
  }

  console.log(`[OK] pre-flight passed. Launching with TZ=${launchPlan.timezone}: ${command.join(" ")}`);

  const proc = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: buildChildEnv(launchPlan.timezone) });
  process.exit(await proc.exited);
}
