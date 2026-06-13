import { cancel, confirm, intro, isCancel, outro, text } from "@clack/prompts";
import aiDevToolsDomains from "../../../templates/domains/ai-dev-tools.txt";
import type { Config } from "../../core/config";
import { saveConfig } from "../../core/config";
import {
  CONFIG_FILE,
  DEFAULT_AUDIT_PROCESS_NAME_PATTERNS,
  DEFAULT_DNS_SERVERS,
  DEFAULT_TUN_ADDRESS,
  DEFAULT_TUN_INTERFACE_NAME,
  GENERATED_SINGBOX_CONFIG,
} from "../../core/paths";
import { buildSingBoxConfig, writeSingBoxConfig } from "../../core/singbox-config";
import { parseVlessUri } from "../../core/vless";

const TUN_ADDRESS_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/;

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
    audit: { processNamePatterns: DEFAULT_AUDIT_PROCESS_NAME_PATTERNS },
    exec: { blockedCountries: [] },
  };
}

export interface SetupOptions {
  uri?: string;
  configPath?: string;
  singboxConfigPath?: string;
}

function exitOnCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(1);
  }
  return value;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const configPath = options.configPath ?? CONFIG_FILE;
  const singboxConfigPath = options.singboxConfigPath ?? GENERATED_SINGBOX_CONFIG;

  // `--uri` is also the non-interactive entrypoint (CI/scripting): clack's prompts
  // require a real TTY and spin forever on piped stdin, so this path takes every
  // remaining answer from the documented defaults instead of prompting.
  const interactive = options.uri === undefined;

  if ((await Bun.file(configPath).exists()) && !interactive) {
    throw new Error(`${configPath} already exists — re-run \`vpnctl setup\` interactively to overwrite it`);
  }

  let uri: string;
  let domains: string[];
  let tunnelInterfaceName: string;
  let tunnelAddress: string;
  let dnsServers: string[];

  if (interactive) {
    intro("vpnctl setup");

    if (await Bun.file(configPath).exists()) {
      const overwrite = exitOnCancel(await confirm({ message: `${configPath} already exists. Overwrite it?`, initialValue: false }));
      if (!overwrite) {
        cancel("Setup cancelled — existing config left untouched.");
        process.exit(1);
      }
    }

    uri = exitOnCancel(
      await text({
        message: "VLESS+Reality URI (vless://...)",
        validate: (value) => {
          try {
            parseVlessUri(value);
            return undefined;
          } catch (error) {
            return (error as Error).message;
          }
        },
      }),
    );

    const useDefaultDomains = exitOnCancel(
      await confirm({
        message: `Use the default ai-dev-tools domain preset (${AI_DEV_TOOLS_DOMAINS.length} domains)?`,
        initialValue: true,
      }),
    );

    domains = AI_DEV_TOOLS_DOMAINS;
    if (!useDefaultDomains) {
      const domainsInput = exitOnCancel(
        await text({
          message: "Domains to protect (comma-separated)",
          initialValue: AI_DEV_TOOLS_DOMAINS.join(","),
          validate: (value) => (parseListInput(value).length === 0 ? "enter at least one domain" : undefined),
        }),
      );
      domains = parseListInput(domainsInput);
    }

    tunnelInterfaceName = exitOnCancel(
      await text({
        message: "TUN interface name",
        initialValue: DEFAULT_TUN_INTERFACE_NAME,
        validate: (value) => (value.trim().length === 0 ? "interface name is required" : undefined),
      }),
    );

    tunnelAddress = exitOnCancel(
      await text({
        message: "TUN address (CIDR)",
        initialValue: DEFAULT_TUN_ADDRESS,
        validate: (value) => (TUN_ADDRESS_PATTERN.test(value) ? undefined : "expected an address like 172.19.0.1/30"),
      }),
    );

    const dnsServersInput = exitOnCancel(
      await text({
        message: "DNS servers (comma-separated)",
        initialValue: DEFAULT_DNS_SERVERS.join(","),
        validate: (value) => (parseListInput(value).length === 0 ? "enter at least one DNS server" : undefined),
      }),
    );
    dnsServers = parseListInput(dnsServersInput);
  } else {
    if (options.uri === undefined) throw new Error("internal: --uri is required for non-interactive setup");
    uri = options.uri;
    domains = AI_DEV_TOOLS_DOMAINS;
    tunnelInterfaceName = DEFAULT_TUN_INTERFACE_NAME;
    tunnelAddress = DEFAULT_TUN_ADDRESS;
    dnsServers = DEFAULT_DNS_SERVERS;
  }

  const config = buildSetupConfig({ uri, domains, tunnelInterfaceName, tunnelAddress, dnsServers });

  await saveConfig(config, configPath);

  const singboxConfig = buildSingBoxConfig({
    outbound: config.outbound,
    domains: config.domains,
    tun: config.tunnel,
    dnsServer: config.dns.servers[0],
  });
  await writeSingBoxConfig(singboxConfig, singboxConfigPath);

  const summary = `Wrote ${configPath} and ${singboxConfigPath}.\nNext: sudo vpnctl install`;
  if (interactive) {
    outro(summary);
  } else {
    console.log(summary);
  }
}
