import type { RoutingMode } from "../../core/config";
import { DEFAULT_ROUTING_MODE, parseRoutingMode } from "../../core/config";
import { CONFIG_FILE, GENERATED_SINGBOX_CONFIG } from "../../core/paths";
import { AI_DEV_TOOLS_DOMAINS, buildSetupConfig, DEFAULT_SETUP_VALUES, parseListInput, writeSetupConfig } from "../setup-config";
import { runTuiSetupWizard } from "../tui/setup-wizard";

export { AI_DEV_TOOLS_DOMAINS, buildSetupConfig, parseListInput };

export interface SetupOptions {
  uri?: string;
  routingMode?: string;
  configPath?: string;
  singboxConfigPath?: string;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const configPath = options.configPath ?? CONFIG_FILE;
  const singboxConfigPath = options.singboxConfigPath ?? GENERATED_SINGBOX_CONFIG;
  const requestedRoutingMode = options.routingMode === undefined ? undefined : parseRoutingMode(options.routingMode);

  // `--uri` is also the non-interactive entrypoint (CI/scripting): clack's prompts
  // require a real TTY and spin forever on piped stdin, so this path takes every
  // remaining answer from the documented defaults instead of prompting.
  const interactive = options.uri === undefined;

  if ((await Bun.file(configPath).exists()) && !interactive) {
    throw new Error(`${configPath} already exists — run \`vpnctl uninstall\` before reinstalling from scratch`);
  }

  let uri: string;
  let domains: string[];
  let tunnelInterfaceName: string;
  let tunnelAddress: string;
  let dnsServers: string[];
  let routingMode: RoutingMode;

  if (interactive) {
    await runTuiSetupWizard({ configPath, singboxConfigPath, requestedRoutingMode });
    return;
  } else {
    if (options.uri === undefined) throw new Error("internal: --uri is required for non-interactive setup");
    uri = options.uri;
    domains = AI_DEV_TOOLS_DOMAINS;
    tunnelInterfaceName = DEFAULT_SETUP_VALUES.tunnelInterfaceName;
    tunnelAddress = DEFAULT_SETUP_VALUES.tunnelAddress;
    dnsServers = DEFAULT_SETUP_VALUES.dnsServers;
    routingMode = requestedRoutingMode ?? DEFAULT_ROUTING_MODE;
  }

  const config = buildSetupConfig({ uri, domains, tunnelInterfaceName, tunnelAddress, dnsServers, routingMode });

  await writeSetupConfig(config, configPath, singboxConfigPath);

  const summary = `Wrote ${configPath} and ${singboxConfigPath}.\nNext: installing protection daemons.`;
  console.log(summary);
}
