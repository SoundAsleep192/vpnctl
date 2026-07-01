import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import type { Exec } from "../src/core/exec";
import type { Config } from "../src/core/config";
import { formatAiDomainsState, formatLeakGuard, formatTrafficScope, type TuiSnapshot } from "../src/cli/tui";
import {
  buildTerminalLaunchScript,
  buildTerminalShellCommand,
  normalizeDnsServerInput,
  normalizeDomainInput,
  openVpnctlInNewTerminal,
} from "../src/cli/tui/actions";
import { buildDashboardLayout, DashboardApp } from "../src/cli/tui/run-tui";
import { SetupWizardApp, type SetupWizardState } from "../src/cli/tui/setup-wizard";
import type { TuiScreen } from "../src/cli/tui/types";

const STANDARD_DASHBOARD_RENDER_HEIGHT = 23;
const STANDARD_SETUP_RENDER_HEIGHT = 23;

const config: Config = {
  tunnel: { interfaceName: "utun20", address: "172.19.0.1/30" },
  outbound: {
    type: "vless",
    tag: "proxy",
    server: "vpn.example.com",
    server_port: 443,
    uuid: "00000000-0000-0000-0000-000000000000",
    tls: {
      enabled: true,
      server_name: "vpn.example.com",
      utls: { enabled: true, fingerprint: "chrome" },
      reality: { enabled: true, public_key: "public", short_id: "short" },
    },
  },
  domains: ["api.openai.com", "api.anthropic.com"],
  dns: { servers: ["1.1.1.1", "8.8.8.8"] },
  routing: { mode: "split" },
  ui: { language: "en" },
  audit: { processNamePatterns: ["Code"] },
  exec: { blockedCountries: [] },
};

const snapshot: TuiSnapshot = {
  aiDomains: "through VPN",
  trafficScope: "protected domains only",
  workspaces: "none",
  workspaceCount: 0,
  updateAvailable: null,
  domainCount: 12,
  dnsCount: 3,
  tunnel: "up",
  tunnelStarting: false,
  leakGuard: "standing by",
  otherVpn: "none",
  otherVpnInterfaces: [],
  vpnDnsConflicts: [],
  vpnRoutingConflict: null,
  config,
};

const fakeExec: Exec = () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });

function outputLineCount(value: string): number {
  return value.split("\n").length;
}

describe("tui helpers", () => {
  test("labels traffic scope in user-facing language", () => {
    expect(formatTrafficScope("full")).toBe("all traffic");
    expect(formatTrafficScope("split")).toBe("protected domains only");
    expect(formatTrafficScope(null)).toBe("not configured");
  });

  test("formats protected domains state as a user outcome", () => {
    expect(formatAiDomainsState(true, "protected", false)).toBe("through VPN");
    expect(formatAiDomainsState(true, "starting", false)).toBe("blocked");
    expect(formatAiDomainsState(true, "fail-closed", false)).toBe("blocked");
    expect(formatAiDomainsState(true, "protected", true)).toBe("not enforced");
    expect(formatAiDomainsState(false, "protected", false)).toBe("not configured");
  });

  test("shows configured protected domains when monitor state is unknown", () => {
    expect(formatAiDomainsState(true, "unknown", false)).toBe("configured");
  });

  test("shows leak guard standing by as a normal state", () => {
    expect(
      formatLeakGuard(
        { tunnelUp: true, trustedIface: "utun20", sinkholeActive: false, tunnelStarting: false, timestamp: Date.now() },
        "protected",
        false,
      ),
    ).toBe("standing by");
    expect(
      formatLeakGuard(
        { tunnelUp: false, trustedIface: null, sinkholeActive: true, tunnelStarting: true, timestamp: Date.now() },
        "starting",
        false,
      ),
    ).toBe("blocking while tunnel starts");
  });

  test("shows tunnel startup and blocked protected domains while connecting", () => {
    const output = renderToString(
      <DashboardApp
        exec={fakeExec}
        initialScreen="status"
        initialMessage={null}
        initialSnapshot={{
          ...snapshot,
          aiDomains: "blocked",
          tunnel: "starting",
          tunnelStarting: true,
          leakGuard: "blocking while tunnel starts",
        }}
      />,
    );

    expect(output).toContain("Tunnel");
    expect(output).toContain("starting");
    expect(output).toContain("blocking while tunnel starts");
    expect(output).toContain("Tunnel starting...");
  });

  test("renders dashboard without architecture noise", () => {
    const output = renderToString(
      <DashboardApp exec={fakeExec} initialScreen="dashboard" initialMessage={null} initialSnapshot={snapshot} />,
    );

    expect(output).toContain("Protected domains:");
    expect(output).toContain("through VPN");
    expect(output).toContain("Traffic scope:");
    expect(output).toContain("protected");
    expect(output).toContain("domains only");
    expect(output).toContain("↑/↓");
    expect(output).toContain("Move");
    expect(output).not.toContain("HOST");
    expect(output).not.toContain("TRAY");
    expect(output).not.toContain("MODE");
    expect(output).not.toContain("Firewall");
    expect(output).not.toContain("Update none");
  });

  test("renders Configure as the settings hub with counters", () => {
    const output = renderToString(
      <DashboardApp exec={fakeExec} initialScreen="configure" initialMessage={null} initialSnapshot={snapshot} />,
    );

    expect(output).toContain("Protected domains");
    expect(output).toContain("edit >");
    expect(output).toContain("12 configured");
    expect(output).toContain("DNS servers");
    expect(output).toContain("3 configured");
    expect(output).toContain("Language");
    expect(output).not.toContain("open config >");
    expect(output).not.toContain("Audit");
    expect(output).not.toContain("Wrappers");
  });

  test("opens the protected domains editor instead of raw JSON", () => {
    const output = renderToString(
      <DashboardApp exec={fakeExec} initialScreen="domains-editor" initialMessage={null} initialSnapshot={snapshot} />,
    );

    expect(output).toContain("View domains");
    expect(output).toContain("Add domain");
    expect(output).toContain("Remove domain");
    expect(output).toContain("Use default domains");
    expect(output).toContain("Open raw config");
  });

  test("opens the DNS server editor with preset actions", () => {
    const output = renderToString(
      <DashboardApp exec={fakeExec} initialScreen="dns-editor" initialMessage={null} initialSnapshot={snapshot} />,
    );

    expect(output).toContain("View DNS servers");
    expect(output).toContain("Add DNS server");
    expect(output).toContain("Remove DNS server");
    expect(output).toContain("Cloudflare");
    expect(output).toContain("Google");
    expect(output).toContain("Quad9");
  });

  test("shows the current endpoint in the connection editor", () => {
    const output = renderToString(
      <DashboardApp exec={fakeExec} initialScreen="connection-editor" initialMessage={null} initialSnapshot={snapshot} />,
    );

    expect(output).toContain("Replace VLESS URI");
    expect(output).toContain("Open raw config");
    expect(output).toContain("vpn.example.com");
    expect(output).toContain("443");
  });

  test("normalizes a URL into a domain for the domains editor", () => {
    expect(normalizeDomainInput("https://API.OpenAI.com/v1/models")).toBe("api.openai.com");
  });

  test("rejects DNS server values without an IP address", () => {
    expect(() => normalizeDnsServerInput("cloudflare-dns.com")).toThrow("DNS server must be an IP address");
  });

  test("renders Status without selectable movement hints", () => {
    const output = renderToString(<DashboardApp exec={fakeExec} initialScreen="status" initialMessage={null} initialSnapshot={snapshot} />);

    expect(output).toContain("Protected domains: through VPN");
    expect(output).toContain("Traffic scope: protected domains only");
    expect(output).toContain("Protected domains: 12 configured");
    expect(output).toContain("Esc");
    expect(output).toContain("Back");
    expect(output).not.toContain("VPNTraffic");
    expect(output).not.toContain("Traffic scopeprotected");
    expect(output).not.toContain("domains12 configured");
    expect(output).not.toContain("[↑/↓] Move");
    expect(output).not.toContain("Firewall");
    expect(output).not.toContain("Details stay here");
  });

  test("renders Logs without all-in-one log noise", () => {
    const output = renderToString(<DashboardApp exec={fakeExec} initialScreen="logs" initialMessage={null} initialSnapshot={snapshot} />);

    expect(output).toContain("Monitor log");
    expect(output).toContain("Tunnel log");
    expect(output).not.toContain("All logs");
    expect(output).not.toContain("Sandbox logs");
  });

  test("renders log content inside the dashboard", () => {
    const output = renderToString(
      <DashboardApp
        exec={fakeExec}
        initialScreen="log-view"
        initialMessage={null}
        initialSnapshot={snapshot}
        initialLogTitle="Monitor log"
        initialLogContent="line 1\nline 2\n"
      />,
    );

    expect(output).toContain("Monitor log");
    expect(output).toContain("line 2");
    expect(output).toContain("Scroll");
    expect(output).toContain("Esc");
    expect(output).toContain("Back");
  });

  test("renders workspace commands with action descriptions", () => {
    const output = renderToString(
      <DashboardApp exec={fakeExec} initialScreen="workspace" initialMessage={null} initialSnapshot={snapshot} />,
    );

    expect(output).toContain("Start Claude workspace");
    expect(output).toContain("Starts a protected Docker workspace");
    expect(output).not.toContain("product");
    expect(output).not.toContain("cleanup");
  });

  test("shows other VPN interfaces separately from conflict state", () => {
    const output = renderToString(
      <DashboardApp
        exec={fakeExec}
        initialScreen="status"
        initialMessage={null}
        initialSnapshot={{
          ...snapshot,
          otherVpn: "none",
          otherVpnInterfaces: [{ name: "utun4", inet: "10.250.1.41" }],
        }}
      />,
    );

    expect(output).toContain("VPN conflict");
    expect(output).toContain("none");
    expect(output).toContain("utun4");
    expect(output).toContain("10.250.1.41");
    expect(output).toContain("No route or DNS");
    expect(output).not.toContain("5 detected");
  });

  test("caps panel width on wide terminals", () => {
    const layout = buildDashboardLayout(180, 45);

    expect(layout.frameWidth).toBeLessThan(180);
    expect(layout.frameLeftMargin).toBeGreaterThan(0);
  });

  test("opens protected workspace in a new Terminal window", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const exec: Exec = (cmd, args) => {
      calls.push({ cmd, args });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const message = await openVpnctlInNewTerminal(["sandbox", "run", "--preset", "claude", "--workspace", "/tmp/project dir"], {
      cwd: "/tmp/project dir",
      exec,
      termProgram: "Apple_Terminal",
    });

    expect(message).toBe("Opened in a new terminal window.");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error("osascript call missing");
    expect(call.cmd).toBe("/usr/bin/osascript");
    expect(call.args[0]).toBe("-e");
    expect(call.args[1]).toContain('tell application "Terminal"');
    expect(call.args[1]).toContain("sandbox run --preset claude --workspace '/tmp/project dir'");
    expect(call.args[1]).toContain("cd '/tmp/project dir' &&");
  });

  test("opens protected workspace in iTerm2 when the dashboard runs in iTerm2", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const exec: Exec = (cmd, args) => {
      calls.push({ cmd, args });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const message = await openVpnctlInNewTerminal(["sandbox", "run", "--preset", "claude", "--workspace", "/tmp/project"], {
      cwd: "/tmp/project",
      exec,
      termProgram: "iTerm.app",
    });

    expect(message).toBe("Opened in a new terminal window.");
    const script = calls[0]?.args[1];
    expect(script).toContain('tell application id "com.googlecode.iterm2"');
    expect(script).toContain("create tab with default profile");
    expect(script).toContain("write text");
  });

  test("quotes command arguments for a new Terminal window", () => {
    expect(buildTerminalShellCommand(["/bin/echo", "hello world", "O'Reilly"], "/tmp/work dir")).toBe(
      "cd '/tmp/work dir' && /bin/echo 'hello world' 'O'\\''Reilly'",
    );
  });

  test("selects AppleScript by terminal application", () => {
    expect(buildTerminalLaunchScript("echo ok", "iterm")).toContain('tell application id "com.googlecode.iterm2"');
    expect(buildTerminalLaunchScript("echo ok", "terminal")).toContain('tell application "Terminal"');
    expect(() => buildTerminalLaunchScript("echo ok", "unsupported")).toThrow("unsupported terminal application");
  });

  test("does not silently replace an unknown terminal with Terminal.app", async () => {
    const calls: string[] = [];
    const exec: Exec = (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const message = await openVpnctlInNewTerminal(["sandbox", "shell"], {
      cwd: "/tmp/project",
      exec,
      termProgram: "WezTerm",
    });

    expect(calls).toEqual([]);
    expect(message).toContain("Current terminal (WezTerm) is not supported");
    expect(message).toContain("vpnctl");
    expect(message).toContain("sandbox shell");
  });

  test("disables sandbox actions when no sandbox is running", () => {
    const output = renderToString(
      <DashboardApp exec={fakeExec} initialScreen="workspace" initialMessage={null} initialSnapshot={{ ...snapshot, workspaceCount: 0 }} />,
    );

    expect(output).toContain("Open shell");
    expect(output).toContain("Stop workspace");
    expect(output).toContain("No sandbox running");
  });

  test("renders Russian labels when configured", () => {
    const output = renderToString(
      <DashboardApp
        exec={fakeExec}
        initialScreen="configure"
        initialMessage={null}
        initialSnapshot={{ ...snapshot, config: { ...config, ui: { language: "ru" } } }}
      />,
    );

    expect(output).toContain("Настройки");
    expect(output).toContain("Язык");
    expect(output).toContain("Русский");
  });

  test("keeps dashboard height stable on a standard terminal", () => {
    const screens: TuiScreen[] = [
      "dashboard",
      "configure",
      "connection-editor",
      "domains-editor",
      "dns-editor",
      "status",
      "logs",
      "log-view",
    ];

    for (const screen of screens) {
      const output = renderToString(
        <DashboardApp
          exec={fakeExec}
          initialScreen={screen}
          initialMessage={null}
          initialSnapshot={snapshot}
          initialLogTitle="Monitor log"
          initialLogContent="line 1\nline 2\n"
        />,
      );

      expect(outputLineCount(output)).toBe(STANDARD_DASHBOARD_RENDER_HEIGHT);
    }
  });
});

describe("setup wizard", () => {
  const setupState: SetupWizardState = {
    step: "traffic-scope",
    selectedIndex: 0,
    textField: null,
    uri: "vless://secret",
    routingMode: "split",
    domains: ["api.openai.com"],
    domainInput: "api.openai.com",
    message: null,
    installed: false,
    installRunning: false,
    installOutput: "",
  };

  test("renders setup wizard as a separate screen", () => {
    const output = renderToString(<SetupWizardApp initialState={setupState} />);

    expect(output).toContain("vpnctl setup");
    expect(output).toContain("2 Traffic scope");
    expect(output).toContain("4 Verify");
    expect(output).toContain("> Protected domains only");
    expect(output).toContain("Enter");
    expect(output).toContain("Select");
    expect(output).not.toContain("Write config");
    expect(output).not.toContain("5 Verify");
    expect(output).not.toContain("Protected domains: through VPN");
  });

  test("renders pasted VLESS URI fully", () => {
    const output = renderToString(<SetupWizardApp initialState={{ ...setupState, step: "connection", textField: "uri" }} />);

    expect(output).toContain("vless://secret");
    expect(output).not.toContain("chars");
  });

  test("keeps install output visible on verify", () => {
    const output = renderToString(
      <SetupWizardApp
        initialState={{
          ...setupState,
          step: "verify",
          installed: true,
          installOutput: "Writing pf anchor...\nInstalling menu-bar icon...\nInstall complete.\n",
        }}
      />,
    );

    expect(output).toContain("Install log");
    expect(output).toContain("Installing menu-bar icon...");
    expect(output).toContain("Install complete.");
  });

  test("keeps setup wizard height stable on a standard terminal", () => {
    const states: SetupWizardState[] = [
      { ...setupState, step: "connection", textField: "uri" },
      { ...setupState, step: "traffic-scope", textField: null },
      { ...setupState, step: "domains", textField: null },
      { ...setupState, step: "verify", textField: null },
    ];

    for (const state of states) {
      const output = renderToString(<SetupWizardApp initialState={state} />);

      expect(outputLineCount(output)).toBe(STANDARD_SETUP_RENDER_HEIGHT);
    }
  });
});
