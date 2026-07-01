import { Buffer } from "node:buffer";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import agentDockerfileTemplate from "../../templates/sandbox/agent.Dockerfile";
import vpnDockerfileTemplate from "../../templates/sandbox/vpn.Dockerfile";
import type { Config } from "./config";
import type { Exec } from "./exec";
import { realExec } from "./exec";
import type { ExitProfile, ExitProfileResult } from "./exit-profile";
import { formatExitProfileLine, resolveExitProfile } from "./exit-profile";
import { CONFIG_DIR } from "./paths";
import { buildSingBoxConfig, writeSingBoxConfig } from "./singbox-config";

const DOCKER_BIN = "docker";
const CODE_BIN = "code";
const SANDBOX_DIR = path.join(CONFIG_DIR, "sandbox");
const SANDBOX_BUILD_DIR = path.join(SANDBOX_DIR, "build");
const SANDBOX_STATE_FILE = path.join(SANDBOX_DIR, "state.json");
const SANDBOX_SING_BOX_FILE = path.join(SANDBOX_BUILD_DIR, "sing-box.json");
const SANDBOX_DOCKERFILE_VPN = path.join(SANDBOX_BUILD_DIR, "Dockerfile.vpn");
const SANDBOX_DOCKERFILE_AGENT = path.join(SANDBOX_BUILD_DIR, "Dockerfile.agent");
const SANDBOX_COMPOSE_FILE = path.join(SANDBOX_BUILD_DIR, "docker-compose.yml");
const SANDBOX_DEVCONTAINER_FILE = path.join(SANDBOX_BUILD_DIR, "devcontainer.json");
const SANDBOX_VPN_IMAGE = "vpnctl-sandbox-vpn:latest";
const SANDBOX_AGENT_IMAGE = "vpnctl-sandbox-agent:latest";
const SANDBOX_VPN_CONTAINER = "vpnctl-sandbox-vpn";
const SANDBOX_AGENT_CONTAINER = "vpnctl-sandbox-agent";
const SANDBOX_SHELL_CONTAINER = "vpnctl-sandbox-shell";
const SANDBOX_TUN_INTERFACE_NAME = "vpnctl0";
const SANDBOX_TUN_ADDRESS = "198.18.0.1/30";
const SANDBOX_PRIMARY_DNS_SERVER = "1.1.1.1";
const SANDBOX_SECONDARY_DNS_SERVER = "8.8.8.8";
const SANDBOX_DEVELOPER_USER = "developer";
const SANDBOX_DEVELOPER_UID = "1654";
const SANDBOX_DEVELOPER_HOME = "/home/developer";
const SANDBOX_WORKSPACE_ROOT = "/workspace";
const SANDBOX_PROFILE_ATTEMPTS = 20;
const SANDBOX_PROFILE_DELAY_MS = 1000;
const UNKNOWN_PROFILE_DEBUG_TIMEZONE = "UTC";
const DOCKER_NOT_FOUND_EXIT_CODE = 127;
const DEFAULT_LOG_LINES = 100;
const CLAUDE_INSTALL_SCRIPT_URL = "https://claude.ai/install.sh";
const CODEX_NPM_PACKAGE = "@openai/codex";

const DOCKERFILE_TEMPLATE_VALUES: Record<string, string> = {
  CLAUDE_INSTALL_SCRIPT_URL,
  CODEX_NPM_PACKAGE,
  SANDBOX_DEVELOPER_HOME,
  SANDBOX_DEVELOPER_UID,
  SANDBOX_DEVELOPER_USER,
  SANDBOX_WORKSPACE_ROOT,
};

const VPN_DOCKERFILE = renderDockerfileTemplate(vpnDockerfileTemplate);
const AGENT_DOCKERFILE = renderDockerfileTemplate(agentDockerfileTemplate);

const VPN_ENTRYPOINT_COMMAND = `iptables -P INPUT ACCEPT
iptables -P FORWARD DROP
iptables -P OUTPUT DROP
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -o ${SANDBOX_TUN_INTERFACE_NAME} -j ACCEPT
iptables -A OUTPUT -m owner --uid-owner 0 -j ACCEPT
touch /tmp/singbox.log
sing-box run -c /etc/sing-box/config.json >/tmp/singbox.log 2>&1 &
echo $! >/tmp/singbox.pid
for wait_index in $(seq 1 30); do ip link show ${SANDBOX_TUN_INTERFACE_NAME} >/tmp/tun.ready 2>/tmp/tun.err && break; sleep 1; done
tail -f /tmp/singbox.log`;

export type SandboxPresetName = "claude" | "codex";

export interface WorkspaceMount {
  source: string;
  target: string;
  name: string;
}

export interface SecretMount {
  source: string;
  target: string;
  readonly: boolean;
  label: string;
}

export interface SandboxAssets {
  buildDir: string;
  singBoxConfigPath: string;
  vpnDockerfilePath: string;
  agentDockerfilePath: string;
  composeFilePath: string;
  devcontainerFilePath: string;
}

export interface SandboxState {
  version: 1;
  updatedAt: string;
  timezone: string;
  profile: ExitProfile | null;
  workspace: WorkspaceMount;
  secrets: SecretMount[];
  vpnContainer: string;
  agentContainer: string;
  vpnImage: string;
  agentImage: string;
  buildDir: string;
}

export type InteractiveSpawn = (cmd: string, args: string[]) => Promise<number>;

export interface SandboxRunOptions {
  config: Config;
  workspace: string;
  command: string[];
  preset?: SandboxPresetName;
  secrets?: string[];
  mountSecrets?: string[];
  keep?: boolean;
  allowUnknownProfile?: boolean;
  exec?: Exec;
  spawn?: InteractiveSpawn;
}

export interface SandboxCodeOptions {
  config: Config;
  workspace: string;
  preset?: SandboxPresetName;
  secrets?: string[];
  mountSecrets?: string[];
  allowUnknownProfile?: boolean;
  exec?: Exec;
  spawn?: InteractiveSpawn;
}

export interface SandboxLogsOptions {
  vpn?: boolean;
  agent?: boolean;
  follow?: boolean;
  lines?: number;
  exec?: Exec;
  spawn?: InteractiveSpawn;
}

export interface SandboxShellOptions {
  exec?: Exec;
  spawn?: InteractiveSpawn;
}

export const realInteractiveSpawn: InteractiveSpawn = async (cmd, args) => {
  const proc = Bun.spawn([cmd, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return proc.exited;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

export function renderDockerfileTemplate(template: string): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, replaceDockerfilePlaceholder);
}

function replaceDockerfilePlaceholder(placeholder: string, key: string): string {
  const value = DOCKERFILE_TEMPLATE_VALUES[key];
  if (value === undefined) throw new Error(`unknown sandbox Dockerfile placeholder ${placeholder}`);
  return value;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isWorkspaceMount(value: unknown): value is WorkspaceMount {
  if (!isRecord(value)) return false;
  return readString(value, "source") !== null && readString(value, "target") !== null && readString(value, "name") !== null;
}

function isSecretMount(value: unknown): value is SecretMount {
  if (!isRecord(value)) return false;
  return (
    readString(value, "source") !== null &&
    readString(value, "target") !== null &&
    typeof value.readonly === "boolean" &&
    readString(value, "label") !== null
  );
}

function isSandboxState(value: unknown): value is SandboxState {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    readString(value, "updatedAt") !== null &&
    readString(value, "timezone") !== null &&
    isWorkspaceMount(value.workspace) &&
    Array.isArray(value.secrets) &&
    value.secrets.every(isSecretMount) &&
    readString(value, "vpnContainer") !== null &&
    readString(value, "agentContainer") !== null &&
    readString(value, "vpnImage") !== null &&
    readString(value, "agentImage") !== null &&
    readString(value, "buildDir") !== null
  );
}

function defaultCommandForPreset(preset: SandboxPresetName | undefined): string[] {
  if (preset === "claude") return ["claude"];
  if (preset === "codex") return ["codex"];
  return [];
}

function ensureKnownPreset(preset: string | undefined): SandboxPresetName | undefined {
  if (preset === undefined) return undefined;
  if (preset === "claude" || preset === "codex") return preset;
  throw new Error(`unknown sandbox preset "${preset}" — expected claude or codex`);
}

function buildSandboxCommand(command: string[], preset: SandboxPresetName | undefined): string[] {
  if (command.length > 0) return command;

  const presetCommand = defaultCommandForPreset(preset);
  if (presetCommand.length > 0) return presetCommand;

  throw new Error("sandbox run needs --preset or a command after --");
}

function namedSecretMount(name: string): SecretMount {
  if (name === "claude") {
    return {
      source: path.join(os.homedir(), ".claude"),
      target: path.join(SANDBOX_DEVELOPER_HOME, ".claude"),
      readonly: false,
      label: "claude",
    };
  }

  if (name === "codex") {
    return {
      source: path.join(os.homedir(), ".codex"),
      target: path.join(SANDBOX_DEVELOPER_HOME, ".codex"),
      readonly: false,
      label: "codex",
    };
  }

  throw new Error(`unknown sandbox secret "${name}" — expected claude or codex`);
}

export function parseSandboxPreset(value: string | undefined): SandboxPresetName | undefined {
  return ensureKnownPreset(value);
}

export function resolveWorkspaceMount(workspace: string): WorkspaceMount {
  const source = path.resolve(expandHome(workspace));
  const name = path.basename(source) || "workspace";
  return { source, target: path.posix.join(SANDBOX_WORKSPACE_ROOT, name), name };
}

export function parseSecretMountSpec(spec: string): SecretMount {
  const parts = spec.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`invalid --mount-secret "${spec}" — expected source:target[:ro|rw]`);
  }

  const source = parts[0];
  const target = parts[1];
  const mode = parts[2] ?? "ro";
  if (source === undefined || source.trim() === "" || target === undefined || target.trim() === "") {
    throw new Error(`invalid --mount-secret "${spec}" — source and target are required`);
  }
  if (mode !== "ro" && mode !== "rw") {
    throw new Error(`invalid --mount-secret "${spec}" — mode must be ro or rw`);
  }

  return { source: path.resolve(expandHome(source)), target, readonly: mode === "ro", label: target };
}

export function resolveSecretMounts(secretNames: string[] = [], mountSpecs: string[] = []): SecretMount[] {
  return [...secretNames.map(namedSecretMount), ...mountSpecs.map(parseSecretMountSpec)];
}

export function resolvePresetSecretNames(preset: SandboxPresetName | undefined, secretNames: string[] = []): string[] {
  if (preset === undefined || secretNames.includes(preset)) return secretNames;
  return [preset, ...secretNames];
}

function volumeArg(source: string, target: string, mode: string): string {
  return `${source}:${target}:${mode}`;
}

function buildVolumeArgs(workspace: WorkspaceMount, secrets: SecretMount[]): string[] {
  const args = ["--volume", volumeArg(workspace.source, workspace.target, "cached")];
  for (const secret of secrets) {
    args.push("--volume", volumeArg(secret.source, secret.target, secret.readonly ? "ro" : "rw"));
  }
  return args;
}

export function buildAgentDockerRunArgs(options: {
  command: string[];
  timezone: string;
  workspace: WorkspaceMount;
  secrets: SecretMount[];
  containerName?: string;
  remove?: boolean;
  tty?: boolean;
}): string[] {
  const args = ["run"];
  if (options.remove ?? true) args.push("--rm");
  if (options.tty ?? false) args.push("--interactive", "--tty");
  args.push(
    "--name",
    options.containerName ?? SANDBOX_AGENT_CONTAINER,
    "--network",
    `container:${SANDBOX_VPN_CONTAINER}`,
    "--user",
    SANDBOX_DEVELOPER_USER,
    "--workdir",
    options.workspace.target,
    "--env",
    `TZ=${options.timezone}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    ...buildVolumeArgs(options.workspace, options.secrets),
    SANDBOX_AGENT_IMAGE,
    ...options.command,
  );
  return args;
}

export function buildVpnDockerRunArgs(singBoxConfigPath: string): string[] {
  return [
    "run",
    "-d",
    "--name",
    SANDBOX_VPN_CONTAINER,
    "--cap-add",
    "NET_ADMIN",
    "--device",
    "/dev/net/tun",
    "--dns",
    SANDBOX_PRIMARY_DNS_SERVER,
    "--dns",
    SANDBOX_SECONDARY_DNS_SERVER,
    "--volume",
    volumeArg(singBoxConfigPath, "/etc/sing-box/config.json", "ro"),
    "--entrypoint",
    "/bin/sh",
    SANDBOX_VPN_IMAGE,
    "-lc",
    VPN_ENTRYPOINT_COMMAND,
  ];
}

export function buildDockerComposeYaml(options: {
  timezone: string;
  workspace: WorkspaceMount;
  secrets: SecretMount[];
  singBoxConfigPath: string;
}): string {
  const volumeLines = [
    volumeArg(options.workspace.source, options.workspace.target, "cached"),
    ...options.secrets.map((secret) => volumeArg(secret.source, secret.target, secret.readonly ? "ro" : "rw")),
  ].map((volume) => `      - ${quoteYaml(volume)}`);

  return `services:
  vpn:
    container_name: ${SANDBOX_VPN_CONTAINER}
    image: ${SANDBOX_VPN_IMAGE}
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun
    dns:
      - ${SANDBOX_PRIMARY_DNS_SERVER}
      - ${SANDBOX_SECONDARY_DNS_SERVER}
    volumes:
      - ${quoteYaml(volumeArg(options.singBoxConfigPath, "/etc/sing-box/config.json", "ro"))}
    entrypoint: /bin/sh
    command:
      - -lc
      - |
${VPN_ENTRYPOINT_COMMAND.split("\n")
  .map((line) => `        ${line}`)
  .join("\n")}
  dev:
    container_name: ${SANDBOX_AGENT_CONTAINER}
    image: ${SANDBOX_AGENT_IMAGE}
    network_mode: service:vpn
    depends_on:
      - vpn
    volumes:
${volumeLines.join("\n")}
    environment:
      TZ: ${quoteYaml(options.timezone)}
    user: ${SANDBOX_DEVELOPER_USER}
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
`;
}

export function buildDevcontainerJson(options: { preset?: SandboxPresetName; workspace: WorkspaceMount; composeFilePath: string }): string {
  const extensions = options.preset === "claude" ? ["anthropic.claude-code"] : [];
  return `${JSON.stringify(
    {
      name: `vpnctl protected ${options.preset ?? "agent"}`,
      dockerComposeFile: options.composeFilePath,
      service: "dev",
      runServices: ["vpn", "dev"],
      workspaceFolder: options.workspace.target,
      remoteUser: SANDBOX_DEVELOPER_USER,
      containerUser: SANDBOX_DEVELOPER_USER,
      overrideCommand: false,
      shutdownAction: "none",
      customizations: {
        vscode: {
          extensions,
          settings: {
            "claudeCode.useTerminal": false,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

export function buildDevcontainerUri(options: { hostPath: string; devcontainerFilePath: string; workspaceFolder: string }): string {
  const payload = {
    hostPath: options.hostPath,
    localDocker: true,
    settings: {},
    configFile: {
      $mid: 1,
      fsPath: options.devcontainerFilePath,
      path: options.devcontainerFilePath,
      scheme: "file",
    },
  };
  return `vscode-remote://dev-container+${Buffer.from(JSON.stringify(payload)).toString("hex")}${options.workspaceFolder}`;
}

export function createSandboxContainerExec(exec: Exec): Exec {
  return async (cmd, args) =>
    exec(DOCKER_BIN, [
      "run",
      "--rm",
      "--network",
      `container:${SANDBOX_VPN_CONTAINER}`,
      "--user",
      SANDBOX_DEVELOPER_USER,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      SANDBOX_AGENT_IMAGE,
      cmd,
      ...args,
    ]);
}

async function ensureDirectory(filePath: string): Promise<void> {
  const result = await stat(filePath);
  if (!result.isDirectory()) throw new Error(`not a directory: ${filePath}`);
}

async function ensureMountSources(workspace: WorkspaceMount, secrets: SecretMount[]): Promise<void> {
  await ensureDirectory(workspace.source);
  for (const secret of secrets) {
    await stat(secret.source);
  }
}

async function writeSandboxAssets(config: Config): Promise<SandboxAssets> {
  await mkdir(SANDBOX_BUILD_DIR, { recursive: true });
  await Bun.write(SANDBOX_DOCKERFILE_VPN, VPN_DOCKERFILE);
  await Bun.write(SANDBOX_DOCKERFILE_AGENT, AGENT_DOCKERFILE);
  await writeSingBoxConfig(
    buildSingBoxConfig({
      outbound: config.outbound,
      domains: config.domains,
      tun: { interfaceName: SANDBOX_TUN_INTERFACE_NAME, address: SANDBOX_TUN_ADDRESS },
      dnsServer: config.dns.servers[0] ?? SANDBOX_PRIMARY_DNS_SERVER,
      routingMode: config.routing.mode,
    }),
    SANDBOX_SING_BOX_FILE,
  );
  return {
    buildDir: SANDBOX_BUILD_DIR,
    singBoxConfigPath: SANDBOX_SING_BOX_FILE,
    vpnDockerfilePath: SANDBOX_DOCKERFILE_VPN,
    agentDockerfilePath: SANDBOX_DOCKERFILE_AGENT,
    composeFilePath: SANDBOX_COMPOSE_FILE,
    devcontainerFilePath: SANDBOX_DEVCONTAINER_FILE,
  };
}

async function runRequired(exec: Exec, cmd: string, args: string[]): Promise<void> {
  const result = await exec(cmd, args);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const detail = stderr || stdout || `exit code ${result.exitCode}`;
    throw new Error(`${cmd} ${args.join(" ")} failed: ${detail}`);
  }
}

async function runOptional(exec: Exec, cmd: string, args: string[]): Promise<void> {
  await exec(cmd, args).catch(() => ({ stdout: "", stderr: "", exitCode: DOCKER_NOT_FOUND_EXIT_CODE }));
}

async function ensureDocker(exec: Exec): Promise<void> {
  await runRequired(exec, DOCKER_BIN, ["version", "--format", "{{.Server.Version}}"]);
}

async function buildImages(exec: Exec, assets: SandboxAssets): Promise<void> {
  await runRequired(exec, DOCKER_BIN, ["build", "-t", SANDBOX_VPN_IMAGE, "-f", assets.vpnDockerfilePath, assets.buildDir]);
  await runRequired(exec, DOCKER_BIN, ["build", "-t", SANDBOX_AGENT_IMAGE, "-f", assets.agentDockerfilePath, assets.buildDir]);
  await runRequired(exec, DOCKER_BIN, [
    "run",
    "--rm",
    "--entrypoint",
    "/bin/sh",
    "--volume",
    volumeArg(assets.singBoxConfigPath, "/etc/sing-box/config.json", "ro"),
    SANDBOX_VPN_IMAGE,
    "-lc",
    "sing-box check -c /etc/sing-box/config.json",
  ]);
}

async function stopContainers(exec: Exec): Promise<void> {
  await runOptional(exec, DOCKER_BIN, ["rm", "-f", SANDBOX_AGENT_CONTAINER]);
  await runOptional(exec, DOCKER_BIN, ["rm", "-f", SANDBOX_SHELL_CONTAINER]);
  await runOptional(exec, DOCKER_BIN, ["rm", "-f", SANDBOX_VPN_CONTAINER]);
}

async function waitForSandboxProfile(exec: Exec): Promise<ExitProfileResult> {
  let latestResult: ExitProfileResult = {
    ok: false,
    reason: "ipinfo-unavailable",
    message: "could not resolve exit geo profile from sandbox namespace",
    publicIp: null,
  };

  for (let attempt = 0; attempt < SANDBOX_PROFILE_ATTEMPTS; attempt += 1) {
    latestResult = await resolveExitProfile(exec);
    if (latestResult.ok) return latestResult;
    await Bun.sleep(SANDBOX_PROFILE_DELAY_MS);
  }

  return latestResult;
}

async function resolveSandboxProfile(
  exec: Exec,
  allowUnknownProfile: boolean | undefined,
): Promise<{ timezone: string; profile: ExitProfile | null }> {
  const profileResult = await waitForSandboxProfile(createSandboxContainerExec(exec));
  if (profileResult.ok) return { timezone: profileResult.profile.timezone, profile: profileResult.profile };
  if (allowUnknownProfile) {
    console.error(`[WARN] ${profileResult.message}; using TZ=${UNKNOWN_PROFILE_DEBUG_TIMEZONE} because --allow-unknown-profile was set`);
    return { timezone: UNKNOWN_PROFILE_DEBUG_TIMEZONE, profile: null };
  }
  throw new Error(profileResult.message);
}

async function saveSandboxState(state: SandboxState): Promise<void> {
  await mkdir(SANDBOX_DIR, { recursive: true });
  await Bun.write(SANDBOX_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function readSandboxState(): Promise<SandboxState | null> {
  const file = Bun.file(SANDBOX_STATE_FILE);
  if (!(await file.exists())) return null;

  try {
    const value: unknown = await file.json();
    return isSandboxState(value) ? value : null;
  } catch {
    return null;
  }
}

function secretSummary(secret: SecretMount): string {
  return `${secret.source} -> ${secret.target}:${secret.readonly ? "ro" : "rw"}`;
}

async function prepareSandbox(options: {
  config: Config;
  workspace: string;
  preset?: SandboxPresetName;
  secrets?: string[];
  mountSecrets?: string[];
  exec: Exec;
}): Promise<{ assets: SandboxAssets; workspace: WorkspaceMount; secrets: SecretMount[] }> {
  const workspace = resolveWorkspaceMount(options.workspace);
  const secrets = resolveSecretMounts(resolvePresetSecretNames(options.preset, options.secrets), options.mountSecrets);
  await ensureMountSources(workspace, secrets);
  await ensureDocker(options.exec);
  const assets = await writeSandboxAssets(options.config);
  await buildImages(options.exec, assets);
  return { assets, workspace, secrets };
}

export async function runSandboxRun(options: SandboxRunOptions): Promise<number> {
  const exec = options.exec ?? realExec;
  const spawn = options.spawn ?? realInteractiveSpawn;
  const preset = options.preset;
  const command = buildSandboxCommand(options.command, preset);

  console.log("Checking Docker...");
  const prepared = await prepareSandbox({
    config: options.config,
    workspace: options.workspace,
    preset,
    secrets: options.secrets,
    mountSecrets: options.mountSecrets,
    exec,
  });

  await stopContainers(exec);

  console.log("Starting VPN sidecar...");
  console.log("Applying sandbox killswitch...");
  await runRequired(exec, DOCKER_BIN, buildVpnDockerRunArgs(prepared.assets.singBoxConfigPath));

  try {
    console.log("Resolving VPN exit profile...");
    const profile = await resolveSandboxProfile(exec, options.allowUnknownProfile);
    if (profile.profile !== null) console.log(`Exit: ${formatExitProfileLine(profile.profile)}`);

    await saveSandboxState({
      version: 1,
      updatedAt: new Date().toISOString(),
      timezone: profile.timezone,
      profile: profile.profile,
      workspace: prepared.workspace,
      secrets: prepared.secrets,
      vpnContainer: SANDBOX_VPN_CONTAINER,
      agentContainer: SANDBOX_AGENT_CONTAINER,
      vpnImage: SANDBOX_VPN_IMAGE,
      agentImage: SANDBOX_AGENT_IMAGE,
      buildDir: prepared.assets.buildDir,
    });

    console.log("Starting agent container as non-root user...");
    console.log(`Workspace: ${prepared.workspace.source} -> ${prepared.workspace.target}`);
    console.log(`Timezone: TZ=${profile.timezone}`);
    console.log(`Running: ${command.join(" ")}`);

    return await spawn(
      DOCKER_BIN,
      buildAgentDockerRunArgs({
        command,
        timezone: profile.timezone,
        workspace: prepared.workspace,
        secrets: prepared.secrets,
        remove: !options.keep,
        tty: Boolean(process.stdout.isTTY),
      }),
    );
  } finally {
    if (!options.keep) await stopContainers(exec);
  }
}

export async function runSandboxCode(options: SandboxCodeOptions): Promise<number> {
  const exec = options.exec ?? realExec;
  const spawn = options.spawn ?? realInteractiveSpawn;
  const preset = options.preset ?? "claude";

  console.log("Checking Docker...");
  const prepared = await prepareSandbox({
    config: options.config,
    workspace: options.workspace,
    preset,
    secrets: options.secrets,
    mountSecrets: options.mountSecrets,
    exec,
  });

  await stopContainers(exec);

  console.log("Starting VPN sidecar...");
  console.log("Applying sandbox killswitch...");
  await runRequired(exec, DOCKER_BIN, buildVpnDockerRunArgs(prepared.assets.singBoxConfigPath));

  try {
    console.log("Resolving VPN exit profile...");
    const profile = await resolveSandboxProfile(exec, options.allowUnknownProfile);
    if (profile.profile !== null) console.log(`Exit: ${formatExitProfileLine(profile.profile)}`);

    await Bun.write(
      SANDBOX_COMPOSE_FILE,
      buildDockerComposeYaml({
        timezone: profile.timezone,
        workspace: prepared.workspace,
        secrets: prepared.secrets,
        singBoxConfigPath: prepared.assets.singBoxConfigPath,
      }),
    );
    await Bun.write(
      SANDBOX_DEVCONTAINER_FILE,
      buildDevcontainerJson({ preset, workspace: prepared.workspace, composeFilePath: prepared.assets.composeFilePath }),
    );

    await saveSandboxState({
      version: 1,
      updatedAt: new Date().toISOString(),
      timezone: profile.timezone,
      profile: profile.profile,
      workspace: prepared.workspace,
      secrets: prepared.secrets,
      vpnContainer: SANDBOX_VPN_CONTAINER,
      agentContainer: SANDBOX_AGENT_CONTAINER,
      vpnImage: SANDBOX_VPN_IMAGE,
      agentImage: SANDBOX_AGENT_IMAGE,
      buildDir: prepared.assets.buildDir,
    });

    const uri = buildDevcontainerUri({
      hostPath: prepared.workspace.source,
      devcontainerFilePath: prepared.assets.devcontainerFilePath,
      workspaceFolder: prepared.workspace.target,
    });
    console.log(`Workspace: ${prepared.workspace.source} -> ${prepared.workspace.target}`);
    console.log(`Timezone: TZ=${profile.timezone}`);
    console.log("Opening VS Code Dev Container...");
    return await spawn(CODE_BIN, ["--folder-uri", uri]);
  } finally {
    await stopContainers(exec);
  }
}

export async function runSandboxStop(options: { exec?: Exec } = {}): Promise<void> {
  await stopContainers(options.exec ?? realExec);
  console.log("sandbox stopped.");
}

export async function runSandboxClean(options: { exec?: Exec } = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  await stopContainers(exec);
  await runOptional(exec, DOCKER_BIN, ["image", "rm", SANDBOX_AGENT_IMAGE]);
  await runOptional(exec, DOCKER_BIN, ["image", "rm", SANDBOX_VPN_IMAGE]);
  await rm(SANDBOX_DIR, { recursive: true, force: true });
  console.log("sandbox cleaned.");
}

export async function runSandboxStatus(options: { exec?: Exec } = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  const state = await readSandboxState();
  const ps = await exec(DOCKER_BIN, ["ps", "-a", "--filter", "name=vpnctl-sandbox", "--format", "{{.Names}}\t{{.ID}}\t{{.Status}}"]);
  const rules = await exec(DOCKER_BIN, ["exec", SANDBOX_VPN_CONTAINER, "iptables", "-S", "OUTPUT"]).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: DOCKER_NOT_FOUND_EXIT_CODE,
  }));

  console.log("=== sandbox ===");
  console.log(ps.stdout.trim() === "" ? "containers: stopped" : ps.stdout.trim());
  console.log(`killswitch: ${rules.exitCode === 0 && rules.stdout.includes("-P OUTPUT DROP") ? "active" : "unknown"}`);

  if (state === null) {
    console.log("state: none");
    return;
  }

  console.log("");
  console.log("=== exit ===");
  if (state.profile === null) {
    console.log(`timezone: ${state.timezone}`);
  } else {
    console.log(formatExitProfileLine(state.profile));
  }
  console.log("");
  console.log("=== mounts ===");
  console.log(`workspace: ${state.workspace.source} -> ${state.workspace.target}`);
  console.log(state.secrets.length === 0 ? "secrets: none" : `secrets: ${state.secrets.map(secretSummary).join(", ")}`);
}

export async function runSandboxLogs(options: SandboxLogsOptions = {}): Promise<void> {
  const spawn = options.spawn ?? realInteractiveSpawn;
  const containers: string[] = [];
  if (options.vpn || !options.agent) containers.push(SANDBOX_VPN_CONTAINER);
  if (options.agent || !options.vpn) containers.push(SANDBOX_AGENT_CONTAINER);

  for (const container of containers) {
    const args = ["logs", "--tail", String(options.lines ?? DEFAULT_LOG_LINES)];
    if (options.follow) args.push("--follow");
    args.push(container);
    const exitCode = await spawn(DOCKER_BIN, args);
    if (exitCode !== 0) process.exitCode = exitCode;
  }
}

export async function runSandboxShell(options: SandboxShellOptions = {}): Promise<number> {
  const state = await readSandboxState();
  if (state === null) throw new Error("sandbox state not found — run `vpnctl sandbox run --keep` first");

  const spawn = options.spawn ?? realInteractiveSpawn;
  return spawn(
    DOCKER_BIN,
    buildAgentDockerRunArgs({
      command: ["bash"],
      timezone: state.timezone,
      workspace: state.workspace,
      secrets: state.secrets,
      containerName: SANDBOX_SHELL_CONTAINER,
      tty: Boolean(process.stdout.isTTY),
    }),
  );
}

export async function runSandboxDoctor(options: { exec?: Exec } = {}): Promise<void> {
  const exec = options.exec ?? realExec;
  const docker = await exec(DOCKER_BIN, ["version", "--format", "{{.Server.Version}}"]).catch(() => ({
    stdout: "",
    stderr: "docker unavailable",
    exitCode: DOCKER_NOT_FOUND_EXIT_CODE,
  }));
  const compose = await exec(DOCKER_BIN, ["compose", "version", "--short"]).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }));
  const vpnImage = await exec(DOCKER_BIN, ["image", "inspect", SANDBOX_VPN_IMAGE]).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }));
  const agentImage = await exec(DOCKER_BIN, ["image", "inspect", SANDBOX_AGENT_IMAGE]).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }));
  const state = await readSandboxState();

  console.log("=== docker ===");
  console.log(`engine: ${docker.exitCode === 0 ? docker.stdout.trim() : "unavailable"}`);
  console.log(`compose: ${compose.exitCode === 0 ? compose.stdout.trim() : "unavailable"}`);
  console.log("");
  console.log("=== images ===");
  console.log(`${SANDBOX_VPN_IMAGE}: ${vpnImage.exitCode === 0 ? "present" : "missing"}`);
  console.log(`${SANDBOX_AGENT_IMAGE}: ${agentImage.exitCode === 0 ? "present" : "missing"}`);
  console.log("");
  console.log("=== state ===");
  console.log(state === null ? "none" : `${state.workspace.source} -> ${state.workspace.target}, TZ=${state.timezone}`);
}
