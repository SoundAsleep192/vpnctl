import path from "node:path";
import { isIP } from "node:net";
import { loadConfig, saveConfig, type Config, type RoutingMode, type UiLanguage } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import { CONFIG_FILE, GENERATED_SINGBOX_CONFIG } from "../../core/paths";
import { isCompiledBinary } from "../../core/runtime";
import { buildSingBoxConfig, writeSingBoxConfig } from "../../core/singbox-config";
import { parseVlessUri } from "../../core/vless";
import { formatTrafficScope } from "./format";
import type { EditorCommand } from "./types";

const CONFIG_OPEN_MESSAGE = "Config closed. Generated sing-box.json. Run refresh to apply firewall tables.";
const DEFAULT_EDITOR = "nano";
const OSASCRIPT_BIN = "/usr/bin/osascript";
const ITERM_APPLICATION_ID = "com.googlecode.iterm2";
const ITERM_TERM_PROGRAM = "iTerm.app";
const APPLE_TERMINAL_TERM_PROGRAM = "Apple_Terminal";
const NEW_TERMINAL_MESSAGE = "Opened in a new terminal window.";
const CONFIG_MISSING_MESSAGE = "Config missing. Run the installer again.";
const SHELL_SAFE_VALUE = /^[A-Za-z0-9_./:@%+=,-]+$/;
const DOMAIN_VALUE = /^[A-Za-z0-9.-]+$/;

type TerminalApplication = "iterm" | "terminal" | "unsupported";

export function resolveEditorCommand(editor: string, filePath: string): EditorCommand {
  const parts = editor.split(/\s+/).filter((part) => part.length > 0);
  const cmd = parts[0];
  if (cmd === undefined) return { cmd: "nano", args: [filePath] };
  return { cmd, args: [...parts.slice(1), filePath] };
}

export async function saveRoutingMode(mode: RoutingMode): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const updated: Config = { ...config, routing: { mode } };
  await saveConfig(updated);
  await regenerateSingBoxConfig();
  return `Traffic scope saved: ${formatTrafficScope(mode)}. Run refresh to apply firewall tables.`;
}

export async function saveUiLanguage(language: UiLanguage): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const updated: Config = { ...config, ui: { language } };
  await saveConfig(updated);
  return `Language saved: ${formatLanguage(language)}.`;
}

export async function saveConnectionUri(uri: string): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const outbound = parseVlessUri(uri.trim());
  const updated: Config = { ...config, outbound };
  await saveConfig(updated);
  await regenerateSingBoxConfig();
  return "Connection saved. Restart tunnel to use the new endpoint.";
}

export async function addProtectedDomain(domain: string): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const normalizedDomain = normalizeDomainInput(domain);
  if (config.domains.includes(normalizedDomain)) return `${normalizedDomain} is already protected.`;
  const updated: Config = { ...config, domains: [...config.domains, normalizedDomain] };
  await saveConfig(updated);
  await regenerateSingBoxConfig();
  return `${normalizedDomain} added. Run refresh to apply firewall tables.`;
}

export async function removeProtectedDomain(domain: string): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const normalizedDomain = normalizeDomainInput(domain);
  if (!config.domains.includes(normalizedDomain)) return `${normalizedDomain} is not protected.`;
  const updated: Config = { ...config, domains: config.domains.filter((existingDomain) => existingDomain !== normalizedDomain) };
  await saveConfig(updated);
  await regenerateSingBoxConfig();
  return `${normalizedDomain} removed. Run refresh to apply firewall tables.`;
}

export async function saveProtectedDomains(domains: string[]): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const normalizedDomains = uniqueValues(domains.map(normalizeDomainInput));
  if (normalizedDomains.length === 0) throw new Error("protected domains list cannot be empty");
  const updated: Config = { ...config, domains: normalizedDomains };
  await saveConfig(updated);
  await regenerateSingBoxConfig();
  return `${normalizedDomains.length} protected domains saved. Run refresh to apply firewall tables.`;
}

export async function addDnsServer(server: string): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const normalizedServer = normalizeDnsServerInput(server);
  if (config.dns.servers.includes(normalizedServer)) return `${normalizedServer} is already configured.`;
  const updated: Config = { ...config, dns: { servers: [...config.dns.servers, normalizedServer] } };
  await saveConfig(updated);
  await regenerateSingBoxConfig();
  return `${normalizedServer} added. Run refresh to apply firewall tables.`;
}

export async function removeDnsServer(server: string): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const normalizedServer = normalizeDnsServerInput(server);
  const nextServers = config.dns.servers.filter((existingServer) => existingServer !== normalizedServer);
  if (nextServers.length === config.dns.servers.length) return `${normalizedServer} is not configured.`;
  return saveDnsServers(nextServers);
}

export async function saveDnsServers(servers: string[]): Promise<string> {
  const config = await loadConfig().catch(() => null);
  if (config === null) return CONFIG_MISSING_MESSAGE;
  const normalizedServers = uniqueValues(servers.map(normalizeDnsServerInput));
  if (normalizedServers.length === 0) throw new Error("at least one DNS server is required");
  const updated: Config = { ...config, dns: { servers: normalizedServers } };
  await saveConfig(updated);
  await regenerateSingBoxConfig();
  return `${normalizedServers.length} DNS servers saved. Run refresh to apply firewall tables.`;
}

export function normalizeDomainInput(value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) throw new Error("domain cannot be empty");
  const host = trimmedValue.includes("://") ? new URL(trimmedValue).hostname : trimmedValue;
  const domain = host.toLowerCase().replace(/\.$/, "");
  if (domain.length === 0) throw new Error("domain cannot be empty");
  if (!DOMAIN_VALUE.test(domain) || domain.includes("..") || domain.startsWith(".") || domain.endsWith(".")) {
    throw new Error(`invalid domain: ${value}`);
  }
  return domain;
}

export function normalizeDnsServerInput(value: string): string {
  const server = value.trim();
  if (server.length === 0) throw new Error("DNS server cannot be empty");
  if (isIP(server) === 0) throw new Error(`DNS server must be an IP address: ${value}`);
  return server;
}

export function formatLanguage(language: UiLanguage): string {
  return language === "ru" ? "Русский" : "English";
}

export async function regenerateSingBoxConfig(): Promise<void> {
  const config = await loadConfig();
  const singboxConfig = buildSingBoxConfig({
    outbound: config.outbound,
    domains: config.domains,
    tun: config.tunnel,
    dnsServer: config.dns.servers[0],
    routingMode: config.routing.mode,
  });
  await writeSingBoxConfig(singboxConfig, GENERATED_SINGBOX_CONFIG);
}

export async function openConfigInEditor(stdin: NodeJS.ReadStream, _stdout: NodeJS.WriteStream): Promise<string> {
  restoreTerminalForExternalCommand();
  const editor = resolveEditorCommand(Bun.env.VISUAL ?? Bun.env.EDITOR ?? DEFAULT_EDITOR, CONFIG_FILE);
  const proc = Bun.spawn([editor.cmd, ...editor.args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  stdin.resume();
  if (exitCode !== 0) return `Editor exited with code ${exitCode}.`;
  return regenerateSingBoxConfig().then(() => CONFIG_OPEN_MESSAGE, errorMessage);
}

export function buildVpnctlInvocation(args: string[]): string[] {
  if (isCompiledBinary()) return [process.execPath, ...args];
  return [process.execPath, path.resolve(import.meta.dir, "../../../bin/vpnctl.ts"), ...args];
}

export function shellQuote(value: string): string {
  if (SHELL_SAFE_VALUE.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildTerminalShellCommand(command: string[], workingDirectory: string): string {
  return `cd ${shellQuote(workingDirectory)} && ${command.map(shellQuote).join(" ")}`;
}

export function buildTerminalAppleScript(shellCommand: string): string {
  return `tell application "Terminal"
activate
do script ${JSON.stringify(shellCommand)}
end tell`;
}

export function buildITermAppleScript(shellCommand: string): string {
  return `tell application id "${ITERM_APPLICATION_ID}"
activate
if (count of windows) = 0 then
  create window with default profile
else
  tell current window
    create tab with default profile
  end tell
end if
tell current session of current window
  write text ${JSON.stringify(shellCommand)}
end tell
end tell`;
}

export function resolveTerminalApplication(termProgram: string | undefined = Bun.env.TERM_PROGRAM): TerminalApplication {
  if (termProgram === ITERM_TERM_PROGRAM) return "iterm";
  if (termProgram === undefined || termProgram === "" || termProgram === APPLE_TERMINAL_TERM_PROGRAM) return "terminal";
  return "unsupported";
}

export function buildTerminalLaunchScript(shellCommand: string, terminalApplication: TerminalApplication): string {
  if (terminalApplication === "unsupported") throw new Error(`unsupported terminal application for command: ${shellCommand}`);
  return terminalApplication === "iterm" ? buildITermAppleScript(shellCommand) : buildTerminalAppleScript(shellCommand);
}

export async function openVpnctlInNewTerminal(
  args: string[],
  options: { cwd?: string; exec?: Exec; termProgram?: string } = {},
): Promise<string> {
  const exec = options.exec ?? realExec;
  const shellCommand = buildTerminalShellCommand(buildVpnctlInvocation(args), options.cwd ?? process.cwd());
  const terminalApplication = resolveTerminalApplication(options.termProgram);
  if (terminalApplication === "unsupported") {
    const termProgram = options.termProgram ?? Bun.env.TERM_PROGRAM ?? "unknown";
    return `Current terminal (${termProgram}) is not supported for opening a new protected workspace yet. Run: ${shellCommand}`;
  }

  const script = buildTerminalLaunchScript(shellCommand, terminalApplication);
  const result = await exec(OSASCRIPT_BIN, ["-e", script]);
  if (result.exitCode === 0) return NEW_TERMINAL_MESSAGE;
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  return `Terminal launch failed: ${detail}`;
}

export function restoreTerminalForExternalCommand(): void {
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  if (process.stdin.isTTY) {
    Bun.spawnSync(["/bin/stty", "sane"], { stdin: "inherit", stdout: "ignore", stderr: "ignore" });
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readTextFile(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return "(not found)";
  return file.text();
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}
