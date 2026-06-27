import { describe, expect, test } from "bun:test";
import {
  buildAgentDockerRunArgs,
  buildDevcontainerJson,
  buildDevcontainerUri,
  buildDockerComposeYaml,
  buildVpnDockerRunArgs,
  createSandboxContainerExec,
  parseSecretMountSpec,
  parseSandboxPreset,
  resolveSecretMounts,
  type SecretMount,
  type WorkspaceMount,
} from "../src/core/sandbox";

const WORKSPACE: WorkspaceMount = {
  source: "/Users/me/project",
  target: "/workspace/project",
  name: "project",
};

const CLAUDE_SECRET: SecretMount = {
  source: "/Users/me/.claude",
  target: "/home/developer/.claude",
  readonly: false,
  label: "claude",
};

describe("sandbox options", () => {
  /**
   * Дано:
   * - пользователь выбирает preset из CLI
   *
   * Ожидается:
   * - известные preset проходят
   * - неизвестные preset отклоняются до Docker-запуска
   */
  test("валидирует preset", () => {
    expect(parseSandboxPreset("claude")).toBe("claude");
    expect(parseSandboxPreset("codex")).toBe("codex");
    expect(() => parseSandboxPreset("other")).toThrow(/unknown sandbox preset/);
  });

  /**
   * Дано:
   * - пользователь явно передает custom secret mount
   *
   * Ожидается:
   * - mount парсится как read-only по умолчанию
   * - режим rw принимается только явно
   */
  test("парсит явные secret mount specs", () => {
    expect(parseSecretMountSpec("~/secret:/home/developer/secret")).toMatchObject({
      target: "/home/developer/secret",
      readonly: true,
    });
    expect(parseSecretMountSpec("~/secret:/home/developer/secret:rw")).toMatchObject({
      target: "/home/developer/secret",
      readonly: false,
    });
    expect(() => parseSecretMountSpec("~/secret:/home/developer/secret:bad")).toThrow(/mode must be ro or rw/);
  });

  /**
   * Дано:
   * - пользователь явно включает named secret claude
   *
   * Ожидается:
   * - host home не монтируется целиком
   * - монтируется только точечный credential path
   */
  test("разворачивает named secrets в точечные mounts", () => {
    const mounts = resolveSecretMounts(["claude"], []);

    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.target).toBe("/home/developer/.claude");
    expect(mounts[0]?.source.endsWith("/.claude")).toBe(true);
  });
});

describe("sandbox docker generation", () => {
  /**
   * Дано:
   * - agent container запускается поверх VPN sidecar namespace
   * - workspace и secret mount переданы явно
   *
   * Ожидается:
   * - agent не получает NET_ADMIN и Docker socket
   * - agent получает TZ из exit profile
   */
  test("строит docker run для non-root agent без Docker socket", () => {
    const args = buildAgentDockerRunArgs({
      command: ["claude"],
      timezone: "Europe/Prague",
      workspace: WORKSPACE,
      secrets: [CLAUDE_SECRET],
      tty: false,
    });

    expect(args).toContain("--network");
    expect(args).toContain("container:vpnctl-sandbox-vpn");
    expect(args).toContain("--user");
    expect(args).toContain("developer");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges:true");
    expect(args).toContain("TZ=Europe/Prague");
    expect(args.join(" ")).toContain("/Users/me/project:/workspace/project:cached");
    expect(args.join(" ")).toContain("/Users/me/.claude:/home/developer/.claude:rw");
    expect(args.join(" ")).not.toContain("/var/run/docker.sock");
  });

  /**
   * Дано:
   * - VPN sidecar стартует отдельным контейнером
   *
   * Ожидается:
   * - sidecar получает NET_ADMIN и /dev/net/tun
   * - sing-box config монтируется read-only
   * - killswitch default policy блокирует OUTPUT
   */
  test("строит docker run для VPN sidecar с namespace-local killswitch", () => {
    const args = buildVpnDockerRunArgs("/tmp/sing-box.json");
    const joined = args.join(" ");

    expect(joined).toContain("--cap-add NET_ADMIN");
    expect(joined).toContain("--device /dev/net/tun");
    expect(joined).toContain("/tmp/sing-box.json:/etc/sing-box/config.json:ro");
    expect(joined).toContain("iptables -P OUTPUT DROP");
    expect(joined).toContain("vpnctl0");
  });

  /**
   * Дано:
   * - VS Code mode использует compose/devcontainer
   *
   * Ожидается:
   * - dev service разделяет namespace с vpn service
   * - Docker socket отсутствует
   * - Claude extension ставится в remote backend
   */
  test("строит compose и devcontainer для protected VS Code backend", () => {
    const compose = buildDockerComposeYaml({
      timezone: "Europe/Prague",
      workspace: WORKSPACE,
      secrets: [CLAUDE_SECRET],
      singBoxConfigPath: "/tmp/sing-box.json",
    });
    const devcontainer = buildDevcontainerJson({
      preset: "claude",
      workspace: WORKSPACE,
      composeFilePath: "/tmp/docker-compose.yml",
    });

    expect(compose).toContain("network_mode: service:vpn");
    expect(compose).toContain("container_name: vpnctl-sandbox-vpn");
    expect(compose).toContain("container_name: vpnctl-sandbox-agent");
    expect(compose).toContain('TZ: "Europe/Prague"');
    expect(compose).toContain("cap_drop:");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).not.toContain("/var/run/docker.sock");
    expect(devcontainer).toContain("anthropic.claude-code");
    expect(devcontainer).toContain("/workspace/project");
  });

  /**
   * Дано:
   * - devcontainer config уже сгенерирован
   *
   * Ожидается:
   * - VS Code URI указывает на dev-container target
   * - workspace path остается container path, а не host path
   */
  test("строит VS Code dev-container URI", () => {
    const uri = buildDevcontainerUri({
      hostPath: WORKSPACE.source,
      devcontainerFilePath: "/tmp/devcontainer.json",
      workspaceFolder: WORKSPACE.target,
    });

    expect(uri.startsWith("vscode-remote://dev-container+")).toBe(true);
    expect(uri.endsWith("/workspace/project")).toBe(true);
  });

  /**
   * Дано:
   * - exit profile resolver выполняется через временный контейнер в sandbox namespace
   *
   * Ожидается:
   * - probe container тоже non-root и без лишних capabilities
   * - Docker socket не монтируется
   */
  test("строит защищенный docker run для profile probe", async () => {
    let capturedArgs: string[] = [];
    const sandboxExec = createSandboxContainerExec(async (cmd, args) => {
      capturedArgs = [cmd, ...args];
      return { stdout: "{}", stderr: "", exitCode: 0 };
    });

    await sandboxExec("/usr/bin/curl", ["https://ipinfo.io/json"]);

    expect(capturedArgs).toContain("--network");
    expect(capturedArgs).toContain("container:vpnctl-sandbox-vpn");
    expect(capturedArgs).toContain("--user");
    expect(capturedArgs).toContain("developer");
    expect(capturedArgs).toContain("--cap-drop");
    expect(capturedArgs).toContain("ALL");
    expect(capturedArgs).toContain("no-new-privileges:true");
    expect(capturedArgs.join(" ")).not.toContain("/var/run/docker.sock");
  });
});
