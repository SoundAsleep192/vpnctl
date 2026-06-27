import type { Exec } from "./exec";

const CURL_BIN = "/usr/bin/curl";
const PROFILE_TIMEOUT_SECONDS = "12";
const IPINFO_URL = "https://ipinfo.io/json";
const ANTHROPIC_COUNTRY_URL = "https://www.anthropic.com/api/country";

export type ExitProfileConfidence = "high" | "medium";

export type ExitProfileFailureReason = "ipinfo-unavailable" | "public-ip-missing" | "country-missing" | "timezone-missing";

export interface ExitProfile {
  publicIp: string;
  country: string;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  anthropicCountry: string | null;
  confidence: ExitProfileConfidence;
  sources: {
    geo: string;
    providerCountry: string;
  };
}

export type ExitProfileResult =
  | { ok: true; profile: ExitProfile }
  | { ok: false; reason: ExitProfileFailureReason; message: string; publicIp: string | null };

interface FetchJsonResult {
  ok: boolean;
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function fetchJson(exec: Exec, url: string): Promise<FetchJsonResult> {
  const result = await exec(CURL_BIN, ["-sS", "--max-time", PROFILE_TIMEOUT_SECONDS, url]);
  if (result.exitCode !== 0) return { ok: false, value: null };

  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, value: null };
  }
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseCoordinates(value: string | null): { latitude: number; longitude: number } | null {
  if (value === null) return null;

  const parts = value.split(",");
  if (parts.length !== 2) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
}

async function resolveAnthropicCountry(exec: Exec): Promise<string | null> {
  const result = await fetchJson(exec, ANTHROPIC_COUNTRY_URL);
  if (!result.ok || !isRecord(result.value)) return null;
  return readString(result.value, "country");
}

export async function resolveExitProfile(exec: Exec): Promise<ExitProfileResult> {
  const result = await fetchJson(exec, IPINFO_URL);
  if (!result.ok || !isRecord(result.value)) {
    return { ok: false, reason: "ipinfo-unavailable", message: "could not resolve exit geo profile from ipinfo", publicIp: null };
  }

  const publicIp = readString(result.value, "ip");
  if (publicIp === null) {
    return { ok: false, reason: "public-ip-missing", message: "ipinfo response did not include public IP", publicIp: null };
  }

  const country = readString(result.value, "country");
  if (country === null) {
    return { ok: false, reason: "country-missing", message: `ipinfo response did not include country for ${publicIp}`, publicIp };
  }

  const timezone = readString(result.value, "timezone");
  if (timezone === null) {
    return { ok: false, reason: "timezone-missing", message: `ipinfo response did not include timezone for ${publicIp}`, publicIp };
  }

  const coordinates = parseCoordinates(readString(result.value, "loc"));
  const anthropicCountry = await resolveAnthropicCountry(exec);

  return {
    ok: true,
    profile: {
      publicIp,
      country,
      region: readString(result.value, "region"),
      city: readString(result.value, "city"),
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      timezone,
      anthropicCountry,
      confidence: anthropicCountry === null ? "medium" : "high",
      sources: {
        geo: IPINFO_URL,
        providerCountry: ANTHROPIC_COUNTRY_URL,
      },
    },
  };
}

export function formatExitProfileLine(profile: ExitProfile): string {
  const location = [profile.country, profile.city ?? profile.region].filter((value) => value !== null).join(" ");
  const providerCountry = profile.anthropicCountry === null ? "Anthropic:unknown" : `Anthropic:${profile.anthropicCountry}`;
  return `${profile.publicIp} ${location} ${profile.timezone} ${providerCountry}`;
}
