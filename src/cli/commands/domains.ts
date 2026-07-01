import type { Config } from "../../core/config";
import { loadConfig, saveConfig } from "../../core/config";
import { GENERATED_SINGBOX_CONFIG, LAUNCHD_PLIST_TUNNEL } from "../../core/paths";
import { buildSingBoxConfig, writeSingBoxConfig } from "../../core/singbox-config";

export interface DomainListChange {
  domains: string[];
  changed: boolean;
}

export function addDomain(domains: string[], domain: string): DomainListChange {
  if (domains.includes(domain)) return { domains, changed: false };
  return { domains: [...domains, domain], changed: true };
}

export function removeDomain(domains: string[], domain: string): DomainListChange {
  if (!domains.includes(domain)) return { domains, changed: false };
  return { domains: domains.filter((existing) => existing !== domain), changed: true };
}

export interface DomainsOptions {
  configPath?: string;
  singboxConfigPath?: string;
}

async function regenerateSingBoxConfig(config: Config, singboxConfigPath: string): Promise<void> {
  const singboxConfig = buildSingBoxConfig({
    outbound: config.outbound,
    domains: config.domains,
    tun: config.tunnel,
    dnsServer: config.dns.servers[0],
    routingMode: config.routing.mode,
  });
  await writeSingBoxConfig(singboxConfig, singboxConfigPath);
}

async function printApplyHint(): Promise<void> {
  const installed = await Bun.file(LAUNCHD_PLIST_TUNNEL).exists();
  console.log(
    installed ? "Run `sudo vpnctl refresh` to apply immediately." : "Run `sudo vpnctl refresh` to apply once vpnctl is installed.",
  );
}

export async function runDomainsList(options: DomainsOptions = {}): Promise<void> {
  const config = await loadConfig(options.configPath);

  if (config.domains.length === 0) {
    console.log("(no domains configured)");
    return;
  }

  for (const domain of config.domains) console.log(domain);
}

export async function runDomainsAdd(domain: string, options: DomainsOptions = {}): Promise<void> {
  const singboxConfigPath = options.singboxConfigPath ?? GENERATED_SINGBOX_CONFIG;
  const config = await loadConfig(options.configPath);

  const result = addDomain(config.domains, domain);
  if (!result.changed) {
    console.log(`${domain} is already in domains.`);
    return;
  }

  const updated: Config = { ...config, domains: result.domains };
  await saveConfig(updated, options.configPath);
  await regenerateSingBoxConfig(updated, singboxConfigPath);

  console.log(`Added ${domain}.`);
  await printApplyHint();
}

export async function runDomainsRemove(domain: string, options: DomainsOptions = {}): Promise<void> {
  const singboxConfigPath = options.singboxConfigPath ?? GENERATED_SINGBOX_CONFIG;
  const config = await loadConfig(options.configPath);

  const result = removeDomain(config.domains, domain);
  if (!result.changed) {
    console.log(`${domain} is not in domains.`);
    return;
  }

  const updated: Config = { ...config, domains: result.domains };
  await saveConfig(updated, options.configPath);
  await regenerateSingBoxConfig(updated, singboxConfigPath);

  console.log(`Removed ${domain}.`);
  await printApplyHint();
}
