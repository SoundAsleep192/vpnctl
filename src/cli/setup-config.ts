import aiDevToolsDomains from "../../templates/domains/ai-dev-tools.txt";
import type { Config, RoutingMode, UiLanguage } from "../core/config";
import { detectSystemLanguage, saveConfig } from "../core/config";
import {
  DEFAULT_AUDIT_PROCESS_NAME_PATTERNS,
  DEFAULT_DNS_SERVERS,
  DEFAULT_TUN_ADDRESS,
  DEFAULT_TUN_INTERFACE_NAME,
  GENERATED_SINGBOX_CONFIG,
} from "../core/paths";
import { buildSingBoxConfig, writeSingBoxConfig } from "../core/singbox-config";
import { parseVlessUri } from "../core/vless";

export const AI_DEV_TOOLS_DOMAINS: string[] = aiDevToolsDomains
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

export interface SetupAnswers {
  uri: string;
  domains: string[];
  tunnelInterfaceName: string;
  tunnelAddress: string;
  dnsServers: string[];
  routingMode: RoutingMode;
  uiLanguage?: UiLanguage;
}

export function parseListInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function buildSetupConfig(answers: SetupAnswers): Config {
  return {
    tunnel: { interfaceName: answers.tunnelInterfaceName, address: answers.tunnelAddress },
    outbound: parseVlessUri(answers.uri),
    domains: answers.domains,
    dns: { servers: answers.dnsServers },
    routing: { mode: answers.routingMode },
    ui: { language: answers.uiLanguage ?? detectSystemLanguage() },
    audit: { processNamePatterns: DEFAULT_AUDIT_PROCESS_NAME_PATTERNS },
    exec: { blockedCountries: [] },
  };
}

export async function writeSetupConfig(
  config: Config,
  configPath: string,
  singboxConfigPath: string = GENERATED_SINGBOX_CONFIG,
): Promise<void> {
  await saveConfig(config, configPath);

  const singboxConfig = buildSingBoxConfig({
    outbound: config.outbound,
    domains: config.domains,
    tun: config.tunnel,
    dnsServer: config.dns.servers[0],
    routingMode: config.routing.mode,
  });
  await writeSingBoxConfig(singboxConfig, singboxConfigPath);
}

export const DEFAULT_SETUP_VALUES = {
  tunnelInterfaceName: DEFAULT_TUN_INTERFACE_NAME,
  tunnelAddress: DEFAULT_TUN_ADDRESS,
  dnsServers: DEFAULT_DNS_SERVERS,
};
