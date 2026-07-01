import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RealityOutbound } from "./vless";
import {
  CONFIG_FILE,
  DEFAULT_AUDIT_PROCESS_NAME_PATTERNS,
  DEFAULT_DNS_SERVERS,
  DEFAULT_TUN_ADDRESS,
  DEFAULT_TUN_INTERFACE_NAME,
} from "./paths";

const routingModeSchema = z.enum(["full", "split"]);
const uiLanguageSchema = z.enum(["en", "ru"]);

export type RoutingMode = "full" | "split";
export type UiLanguage = "en" | "ru";

export const DEFAULT_ROUTING_MODE: RoutingMode = "split";
export const DEFAULT_UI_LANGUAGE: UiLanguage = detectSystemLanguage();

export interface Config {
  tunnel: { interfaceName: string; address: string };
  outbound: RealityOutbound;
  domains: string[];
  dns: { servers: string[] };
  routing: { mode: RoutingMode };
  ui: { language: UiLanguage };
  audit: { processNamePatterns: string[] };
  exec: { blockedCountries: string[] };
}

interface LanguageEnvironment {
  LANG?: string;
  LANGUAGE?: string;
  LC_ALL?: string;
  LC_MESSAGES?: string;
}

const realityOutboundSchema = z.object({
  type: z.literal("vless"),
  tag: z.string(),
  server: z.string(),
  server_port: z.number().int().positive(),
  uuid: z.string(),
  flow: z.string().optional(),
  network: z.string().optional(),
  tls: z.object({
    enabled: z.literal(true),
    server_name: z.string(),
    utls: z.object({
      enabled: z.literal(true),
      fingerprint: z.string(),
    }),
    reality: z.object({
      enabled: z.literal(true),
      public_key: z.string(),
      short_id: z.string(),
    }),
  }),
}) satisfies z.ZodType<RealityOutbound, z.ZodTypeDef, unknown>;

export const configSchema = z.object({
  tunnel: z
    .object({
      interfaceName: z.string().default(DEFAULT_TUN_INTERFACE_NAME),
      address: z.string().default(DEFAULT_TUN_ADDRESS),
    })
    .default({}),
  outbound: realityOutboundSchema,
  domains: z.array(z.string()),
  dns: z
    .object({
      servers: z.array(z.string()).default(DEFAULT_DNS_SERVERS),
    })
    .default({}),
  routing: z
    .object({
      mode: routingModeSchema.default(DEFAULT_ROUTING_MODE),
    })
    .default({}),
  ui: z
    .object({
      language: uiLanguageSchema.default(DEFAULT_UI_LANGUAGE),
    })
    .default({}),
  audit: z
    .object({
      processNamePatterns: z.array(z.string()).default(DEFAULT_AUDIT_PROCESS_NAME_PATTERNS),
    })
    .default({}),
  exec: z
    .object({
      blockedCountries: z.array(z.string()).default([]),
    })
    .default({}),
}) satisfies z.ZodType<Config, z.ZodTypeDef, unknown>;

export function parseRoutingMode(value: string): RoutingMode {
  const result = routingModeSchema.safeParse(value);
  if (!result.success) {
    throw new Error("routing mode must be one of: full, split");
  }
  return result.data;
}

export function parseUiLanguage(value: string): UiLanguage {
  const result = uiLanguageSchema.safeParse(value);
  if (!result.success) {
    throw new Error("ui language must be one of: en, ru");
  }
  return result.data;
}

export function detectSystemLanguage(env?: LanguageEnvironment): UiLanguage {
  const source: LanguageEnvironment = env ?? {
    LANG: Bun.env.LANG,
    LANGUAGE: Bun.env.LANGUAGE,
    LC_ALL: Bun.env.LC_ALL,
    LC_MESSAGES: Bun.env.LC_MESSAGES,
  };
  const locale = source.LC_ALL ?? source.LC_MESSAGES ?? source.LANGUAGE ?? source.LANG ?? "";
  return locale.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export async function loadConfig(filePath: string = CONFIG_FILE): Promise<Config> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`config file not found: ${filePath}\nrun \`vpnctl setup\` to create it`);
  }

  let raw: unknown;
  try {
    raw = await file.json();
  } catch (error) {
    throw new Error(`config file is not valid JSON: ${filePath}\n${(error as Error).message}`, { cause: error });
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`config file is invalid: ${filePath}\n${issues.join("\n")}`);
  }

  return result.data;
}

export async function saveConfig(config: Config, filePath: string = CONFIG_FILE): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, `${JSON.stringify(config, null, 2)}\n`);
}
