import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CONFIG_FILE,
  DEFAULT_AUDIT_PROCESS_NAME_PATTERNS,
  DEFAULT_DNS_SERVERS,
  DEFAULT_TUN_ADDRESS,
  DEFAULT_TUN_INTERFACE_NAME,
} from "./paths";

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
});

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
});

export type Config = z.infer<typeof configSchema>;

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
