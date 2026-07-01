import React, { type FC, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import { detectSystemLanguage, type RoutingMode, type UiLanguage } from "../../core/config";
import type { Exec } from "../../core/exec";
import { realExec } from "../../core/exec";
import type { OtherVpnInterface } from "../../core/vpn-conflicts";
import { MONITOR_LOG_FILE, TUNNEL_LOG_FILE } from "../../core/paths";
import { AI_DEV_TOOLS_DOMAINS } from "../setup-config";
import {
  addDnsServer,
  addProtectedDomain,
  buildVpnctlInvocation,
  errorMessage,
  formatLanguage,
  openConfigInEditor,
  openVpnctlInNewTerminal,
  readTextFile,
  removeDnsServer as removeDnsServerFromConfig,
  removeProtectedDomain as removeProtectedDomainFromConfig,
  restoreTerminalForExternalCommand,
  saveConnectionUri,
  saveDnsServers,
  saveProtectedDomains,
  saveRoutingMode,
  saveUiLanguage,
} from "./actions";
import { stateColor, valueToAiDomainsState } from "./format";
import { DASHBOARD_TEXTS, type DashboardTexts } from "./i18n";
import { buildTuiSnapshot } from "./snapshot";
import type { StatusColor, TuiScreen, TuiSnapshot } from "./types";

const REFRESH_INTERVAL_MS = 1_000;
const FALLBACK_APP_WIDTH = 96;
const FALLBACK_APP_HEIGHT = 30;
const OUTER_MARGIN_WIDTH = 2;
const MAX_FRAME_WIDTH = 118;
const BODY_VERTICAL_PADDING_HEIGHT = 2;
const MESSAGE_SLOT_HEIGHT = 1;
const MIN_BODY_HEIGHT = 1;
const EXPANDED_FOOTER_MIN_ROWS = 30;
const HEADER_HEIGHT = 3;
const COMPACT_FOOTER_CONTENT_HEIGHT = 1;
const EXPANDED_FOOTER_CONTENT_HEIGHT = 6;
const FRAME_VERTICAL_BORDER_HEIGHT = 2;
const FOOTER_BORDER_HEIGHT = 1;
const TITLE_HEIGHT = 1;
const VIEWPORT_BOTTOM_MARGIN_HEIGHT = 2;
const MENU_PANEL_RESERVED_WIDTH = 4;
const PANEL_RULE = "------------------------------";
const LOG_VIEW_HEADER_HEIGHT = 2;
const LOG_PAGE_STEP_MIN_LINES = 1;
const KEYCAP_MIN_WIDTH = 5;
const KEYCAP_EXTRA_WIDTH = 4;
const KEY_HINT_WIDTH = 18;
const KEY_HINT_RIGHT_MARGIN = 2;
const KEY_HINT_LABEL_SUFFIX = "  ";
const LIST_PREVIEW_LIMIT = 8;
const DNS_PRESETS: Array<{ id: "dns-preset-cloudflare" | "dns-preset-google" | "dns-preset-quad9"; label: string; servers: string[] }> = [
  { id: "dns-preset-cloudflare", label: "Cloudflare", servers: ["1.1.1.1", "1.0.0.1"] },
  { id: "dns-preset-google", label: "Google", servers: ["8.8.8.8", "8.8.4.4"] },
  { id: "dns-preset-quad9", label: "Quad9", servers: ["9.9.9.9", "149.112.112.112"] },
];

type MenuItemId =
  | "status"
  | "configure"
  | "workspace"
  | "logs"
  | "diagnostics"
  | "quit"
  | "start-tunnel"
  | "stop-tunnel"
  | "traffic-scope"
  | "connection"
  | "domains"
  | "dns"
  | "replace-connection"
  | "domain-entry"
  | "view-domains"
  | "add-domain"
  | "remove-domain"
  | "use-default-domains"
  | "dns-entry"
  | "view-dns-servers"
  | "add-dns-server"
  | "remove-dns-server"
  | "dns-preset-cloudflare"
  | "dns-preset-google"
  | "dns-preset-quad9"
  | "raw-config"
  | "language"
  | "english"
  | "russian"
  | "back"
  | "doctor"
  | "check"
  | "audit"
  | "update"
  | "start-claude"
  | "start-codex"
  | "shell"
  | "stop-workspace"
  | "monitor-log"
  | "tunnel-log";

type TextInputKind = "connection-uri" | "domain" | "remove-domain" | "dns-server" | "remove-dns-server";

interface TextInputState {
  kind: TextInputKind;
  value: string;
}

interface MenuItem {
  id: MenuItemId;
  label: string;
  detail?: string;
  detailTone?: StatusColor;
  enabled?: boolean;
  select: () => void | Promise<void>;
}

interface DashboardLayout {
  bodyHeight: number;
  bodyContentHeight: number;
  compactFooter: boolean;
  frameLeftMargin: number;
  frameWidth: number;
  menuContentWidth: number;
}

interface DashboardAppProps {
  exec: Exec;
  initialLogContent?: string | null;
  initialLogTitle?: string | null;
  initialMessage: string | null;
  initialScreen: TuiScreen;
  initialSnapshot: TuiSnapshot;
}

export type DashboardExitAction =
  | { kind: "external"; args: string[]; returnScreen: TuiScreen }
  | { kind: "terminal"; args: string[]; returnScreen: TuiScreen }
  | { kind: "editor"; returnScreen: TuiScreen }
  | { kind: "quit" };

export async function runTui(options: { exec?: Exec } = {}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("vpnctl needs an interactive terminal");
  }

  const exec = options.exec ?? realExec;
  let initialScreen: TuiScreen = "dashboard";
  let initialMessage: string | null = null;

  while (true) {
    const initialSnapshot = await buildTuiSnapshot(exec);
    const instance = render(
      <DashboardApp exec={exec} initialScreen={initialScreen} initialMessage={initialMessage} initialSnapshot={initialSnapshot} />,
      {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        alternateScreen: true,
        exitOnCtrlC: true,
        incrementalRendering: false,
      },
    );

    let result: unknown;
    try {
      result = await instance.waitUntilExit();
    } finally {
      instance.cleanup();
      restoreTerminalForExternalCommand();
    }

    if (!isDashboardExitAction(result) || result.kind === "quit") return;

    initialScreen = result.returnScreen;
    if (result.kind === "editor") {
      initialMessage = await openConfigInEditor(process.stdin, process.stdout);
      continue;
    }

    if (result.kind === "terminal") {
      initialMessage = await openVpnctlInNewTerminal(result.args, { exec });
      continue;
    }

    initialMessage = await runExternal(result.args);
  }
}

export const DashboardApp: FC<DashboardAppProps> = ({
  exec,
  initialLogContent = null,
  initialLogTitle = null,
  initialMessage,
  initialScreen,
  initialSnapshot,
}) => {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [screen, setScreen] = useState<TuiScreen>(initialScreen);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [logTitle, setLogTitle] = useState<string | null>(initialLogTitle);
  const [logContent, setLogContent] = useState<string | null>(initialLogContent);
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [logReturnScreen, setLogReturnScreen] = useState<TuiScreen>("logs");
  const [logScrollOffset, setLogScrollOffset] = useState(0);
  const [textInput, setTextInput] = useState<TextInputState | null>(null);
  const [busy, setBusy] = useState(false);
  const updateAvailableRef = useRef(snapshot.updateAvailable);
  updateAvailableRef.current = snapshot.updateAvailable;
  const layout = buildDashboardLayout(columns, rows);
  const language = snapshot.config?.ui.language ?? detectSystemLanguage();
  const texts = DASHBOARD_TEXTS[language];
  const visibleLogLineCount = Math.max(LOG_PAGE_STEP_MIN_LINES, layout.bodyContentHeight - LOG_VIEW_HEADER_HEIGHT);

  const goTo = (nextScreen: TuiScreen): void => {
    setScreen(nextScreen);
    setSelectedIndex(0);
    setMessage(null);
  };

  const refresh = async (): Promise<void> => {
    const nextSnapshot = await buildTuiSnapshot(exec, { checkUpdate: false, updateAvailable: updateAvailableRef.current });
    setSnapshot(nextSnapshot);
  };

  const runConfigEdit = async (operation: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setMessage(texts.saving);
    try {
      setMessage(await operation());
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const beginTextInput = (kind: TextInputKind): void => {
    setTextInput({ kind, value: "" });
    setMessage(null);
  };

  const commitTextInput = async (currentTextInput: TextInputState): Promise<void> => {
    if (currentTextInput.value.trim().length === 0) {
      setMessage(language === "ru" ? "Значение не может быть пустым." : "Value cannot be empty.");
      return;
    }
    setTextInput(null);
    await runConfigEdit(() => {
      if (currentTextInput.kind === "connection-uri") return saveConnectionUri(currentTextInput.value);
      if (currentTextInput.kind === "domain") return addProtectedDomain(currentTextInput.value);
      if (currentTextInput.kind === "remove-domain") return removeProtectedDomainFromConfig(currentTextInput.value);
      if (currentTextInput.kind === "remove-dns-server") return removeDnsServerFromConfig(currentTextInput.value);
      return addDnsServer(currentTextInput.value);
    });
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (screen === "log-view" && logFilePath !== null) {
        void readTextFile(logFilePath).then((content) => {
          setLogContent(content);
          setLogScrollOffset((currentOffset) => clampNumber(currentOffset, 0, maxLogScrollOffset(content, visibleLogLineCount)));
        });
        return;
      }

      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [exec, logFilePath, screen, visibleLogLineCount]);

  const menu = useMemo(
    () =>
      buildMenu({
        exit,
        beginTextInput,
        goTo,
        openEditor: (returnScreen) => exit({ kind: "editor", returnScreen }),
        openExternal: (args, returnScreen) => exit({ kind: "external", args, returnScreen }),
        openTerminal: (args, returnScreen) => exit({ kind: "terminal", args, returnScreen }),
        openLog: async (title, filePath) => {
          setLogTitle(title);
          setLogFilePath(filePath);
          setLogReturnScreen("logs");
          setLogScrollOffset(0);
          setLogContent(await readTextFile(filePath));
          goTo("log-view");
        },
        openText: (title, content, returnScreen) => {
          setLogTitle(title);
          setLogFilePath(null);
          setLogReturnScreen(returnScreen);
          setLogScrollOffset(0);
          setLogContent(content);
          goTo("log-view");
        },
        saveDefaultDomains: () => runConfigEdit(() => saveProtectedDomains(AI_DEV_TOOLS_DOMAINS)),
        saveDnsPreset: (servers) => runConfigEdit(() => saveDnsServers(servers)),
        saveScope: (mode) => runConfigEdit(() => saveRoutingMode(mode)),
        saveLanguage: (nextLanguage) => runConfigEdit(() => saveUiLanguage(nextLanguage)),
        screen,
        snapshot,
        texts,
      }),
    [screen, snapshot, texts],
  );

  useEffect(() => {
    setSelectedIndex((currentIndex) => Math.min(currentIndex, Math.max(0, menu.length - 1)));
  }, [menu.length]);

  useInput(
    (input, key) => {
      if (textInput !== null) {
        if (key.return) {
          void commitTextInput(textInput);
          return;
        }

        if (key.escape) {
          setTextInput(null);
          setMessage(null);
          return;
        }

        if (key.backspace) {
          setTextInput({ ...textInput, value: textInput.value.slice(0, -1) });
          return;
        }

        const printable = input.replace(/[^\x20-\x7e]/g, "");
        if (printable.length > 0) {
          setTextInput({ ...textInput, value: `${textInput.value}${printable}` });
        }
        return;
      }

      if (input === "q" || input === "Q") {
        exit({ kind: "quit" });
        return;
      }

      if (key.escape) {
        if (screen === "dashboard") return;
        if (
          screen === "traffic-scope" ||
          screen === "language" ||
          screen === "connection-editor" ||
          screen === "domains-editor" ||
          screen === "dns-editor"
        ) {
          goTo("configure");
          return;
        }
        if (screen === "log-view") {
          goTo(logReturnScreen);
          setLogFilePath(null);
          return;
        }
        goTo("dashboard");
        return;
      }

      if (screen === "log-view") {
        const maxScrollOffset = maxLogScrollOffset(logContent ?? "", visibleLogLineCount);
        if (key.upArrow) {
          setLogScrollOffset((currentOffset) => clampNumber(currentOffset + 1, 0, maxScrollOffset));
          return;
        }
        if (key.downArrow) {
          setLogScrollOffset((currentOffset) => clampNumber(currentOffset - 1, 0, maxScrollOffset));
          return;
        }
        if (key.pageUp) {
          setLogScrollOffset((currentOffset) => clampNumber(currentOffset + visibleLogLineCount, 0, maxScrollOffset));
          return;
        }
        if (key.pageDown) {
          setLogScrollOffset((currentOffset) => clampNumber(currentOffset - visibleLogLineCount, 0, maxScrollOffset));
          return;
        }
        return;
      }

      if (screen === "status") return;

      if (key.upArrow) {
        setSelectedIndex((currentIndex) => Math.max(0, currentIndex - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((currentIndex) => Math.min(menu.length - 1, currentIndex + 1));
        return;
      }

      if (key.return) {
        const menuItem = menu[selectedIndex];
        if (menuItem !== undefined && menuItem.enabled !== false) void menuItem.select();
      }
    },
    { isActive: !busy },
  );

  return (
    <Box flexDirection="column" marginLeft={layout.frameLeftMargin} width={layout.frameWidth}>
      <Text bold>{screenTitle(screen, texts)}</Text>
      <AppFrame
        header={<Header snapshot={snapshot} texts={texts} />}
        footer={<Footer compact={layout.compactFooter} screen={screen} textInputActive={textInput !== null} texts={texts} />}
        layout={layout}
      >
        <Box height={layout.bodyContentHeight} overflow="hidden" flexDirection="column">
          {textInput !== null ? (
            <TextInputPanel input={textInput} language={language} texts={texts} />
          ) : screen === "status" ? (
            <StatusView language={language} snapshot={snapshot} texts={texts} />
          ) : screen === "log-view" ? (
            <LogView
              content={logContent ?? ""}
              scrollOffset={logScrollOffset}
              title={logTitle ?? texts.logs}
              visibleLineCount={visibleLogLineCount}
            />
          ) : (
            <MenuWorkspace layout={layout} screen={screen} items={menu} selectedIndex={selectedIndex} snapshot={snapshot} texts={texts} />
          )}
        </Box>
        <Box height={MESSAGE_SLOT_HEIGHT} overflow="hidden">
          <Text color="yellow" wrap="truncate">
            {message ?? (snapshot.tunnelStarting ? texts.tunnelStartingMessage : " ")}
          </Text>
        </Box>
      </AppFrame>
    </Box>
  );
};

interface BuildMenuOptions {
  exit: (value?: unknown) => void;
  beginTextInput: (kind: TextInputKind) => void;
  goTo: (screen: TuiScreen) => void;
  openEditor: (returnScreen: TuiScreen) => void;
  openExternal: (args: string[], returnScreen: TuiScreen) => void;
  openTerminal: (args: string[], returnScreen: TuiScreen) => void;
  openLog: (title: string, filePath: string) => Promise<void>;
  openText: (title: string, content: string, returnScreen: TuiScreen) => void;
  saveDefaultDomains: () => Promise<void>;
  saveDnsPreset: (servers: string[]) => Promise<void>;
  saveLanguage: (language: UiLanguage) => Promise<void>;
  saveScope: (mode: RoutingMode) => Promise<void>;
  screen: TuiScreen;
  snapshot: TuiSnapshot;
  texts: DashboardTexts;
}

function buildMenu(options: BuildMenuOptions): MenuItem[] {
  const language = options.snapshot.config?.ui.language ?? detectSystemLanguage();

  if (options.screen === "dashboard") {
    return [
      { id: "status", label: options.texts.status, select: () => options.goTo("status") },
      {
        id: "start-tunnel",
        label: options.texts.startTunnel,
        detail: options.texts.startTunnelDetail,
        detailTone: "green",
        select: () => options.openExternal(["up"], "dashboard"),
      },
      {
        id: "stop-tunnel",
        label: options.texts.stopTunnel,
        detail: options.texts.stopTunnelDetail,
        detailTone: "yellow",
        select: () => options.openExternal(["down"], "dashboard"),
      },
      { id: "configure", label: options.texts.configure, select: () => options.goTo("configure") },
      { id: "workspace", label: options.texts.protectedWorkspace, select: () => options.goTo("workspace") },
      { id: "logs", label: options.texts.logs, select: () => options.goTo("logs") },
      { id: "diagnostics", label: options.texts.diagnostics, select: () => options.goTo("diagnostics") },
      { id: "quit", label: options.texts.quit, select: () => options.exit({ kind: "quit" }) },
    ];
  }

  if (options.screen === "configure") {
    return [
      {
        id: "traffic-scope",
        label: options.texts.trafficScope,
        detail: translateTrafficScope(options.snapshot.trafficScope, language),
        detailTone: "green",
        select: () => options.goTo("traffic-scope"),
      },
      {
        id: "connection",
        label: `${options.texts.connection} >`,
        detail: options.snapshot.config === null ? translateStatusValue("not configured", language) : options.texts.connectionDetail,
        select: () => options.goTo("connection-editor"),
      },
      {
        id: "domains",
        label: `${options.texts.domains} >`,
        detail: formatCount(options.snapshot.domainCount, language),
        detailTone: "green",
        select: () => options.goTo("domains-editor"),
      },
      {
        id: "dns",
        label: `${options.texts.dns} >`,
        detail: formatCount(options.snapshot.dnsCount, language),
        detailTone: "green",
        select: () => options.goTo("dns-editor"),
      },
      {
        id: "language",
        label: options.texts.language,
        detail: `${formatLanguage(language)} >`,
        detailTone: "green",
        select: () => options.goTo("language"),
      },
    ];
  }

  if (options.screen === "connection-editor") {
    return [
      {
        id: "replace-connection",
        label: options.texts.replaceConnection,
        detail: options.texts.editDetail,
        select: () => options.beginTextInput("connection-uri"),
      },
      {
        id: "raw-config",
        label: options.texts.openRawConfig,
        detail: "config.json",
        detailTone: "yellow",
        select: () => options.openEditor("connection-editor"),
      },
    ];
  }

  if (options.screen === "domains-editor") {
    const domains = options.snapshot.config?.domains ?? [];
    return [
      {
        id: "view-domains",
        label: options.texts.viewDomains,
        detail: formatCount(options.snapshot.domainCount, language),
        select: () => options.openText(options.texts.domains, formatListContent(domains), "domains-editor"),
      },
      {
        id: "add-domain",
        label: options.texts.addDomain,
        detail: options.texts.editDetail,
        select: () => options.beginTextInput("domain"),
      },
      {
        id: "remove-domain",
        label: options.texts.removeDomain,
        detail: options.texts.editDetail,
        select: () => options.beginTextInput("remove-domain"),
      },
      {
        id: "use-default-domains",
        label: options.texts.useDefaultDomains,
        detail: `${AI_DEV_TOOLS_DOMAINS.length} domains`,
        select: options.saveDefaultDomains,
      },
      {
        id: "raw-config",
        label: options.texts.openRawConfig,
        detail: "config.json",
        detailTone: "yellow",
        select: () => options.openEditor("domains-editor"),
      },
    ];
  }

  if (options.screen === "dns-editor") {
    const servers = options.snapshot.config?.dns.servers ?? [];
    return [
      {
        id: "view-dns-servers",
        label: options.texts.viewDnsServers,
        detail: formatCount(options.snapshot.dnsCount, language),
        select: () => options.openText(options.texts.dns, formatListContent(servers), "dns-editor"),
      },
      {
        id: "add-dns-server",
        label: options.texts.addDnsServer,
        detail: options.texts.editDetail,
        select: () => options.beginTextInput("dns-server"),
      },
      {
        id: "remove-dns-server",
        label: options.texts.removeDnsServer,
        detail: options.texts.editDetail,
        select: () => options.beginTextInput("remove-dns-server"),
      },
      ...DNS_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        detail: preset.servers.join(", "),
        select: () => options.saveDnsPreset(preset.servers),
      })),
      {
        id: "raw-config",
        label: options.texts.openRawConfig,
        detail: "config.json",
        detailTone: "yellow",
        select: () => options.openEditor("dns-editor"),
      },
    ];
  }

  if (options.screen === "traffic-scope") {
    return [
      {
        id: "traffic-scope",
        label: translateTrafficScope("protected domains only", language),
        detail: "default",
        select: () => options.saveScope("split"),
      },
      {
        id: "traffic-scope",
        label: options.texts.allTraffic,
        detail: "more intrusive",
        detailTone: "yellow",
        select: () => options.saveScope("full"),
      },
    ];
  }

  if (options.screen === "language") {
    return [
      {
        id: "english",
        label: options.texts.english,
        detail: language === "en" ? "selected" : undefined,
        select: () => options.saveLanguage("en"),
      },
      {
        id: "russian",
        label: options.texts.russian,
        detail: language === "ru" ? "selected" : undefined,
        select: () => options.saveLanguage("ru"),
      },
    ];
  }

  if (options.screen === "diagnostics") {
    return [
      {
        id: "doctor",
        label: options.texts.doctor,
        detail: options.texts.doctorDetail,
        select: () => options.openExternal(["doctor"], "diagnostics"),
      },
      {
        id: "check",
        label: options.texts.check,
        detail: options.texts.checkDetail,
        select: () => options.openExternal(["check"], "diagnostics"),
      },
      {
        id: "audit",
        label: "Connection audit",
        detail: "Configured process sockets",
        select: () => options.openExternal(["audit"], "diagnostics"),
      },
      { id: "logs", label: options.texts.logs, detail: "Focused log viewer", select: () => options.goTo("logs") },
      {
        id: "update",
        label: options.texts.update,
        detail: options.texts.updateDetail,
        select: () => options.openExternal(["update"], "diagnostics"),
      },
    ];
  }

  if (options.screen === "workspace") {
    const workspaceRunning = (options.snapshot.workspaceCount ?? 0) > 0;
    return [
      {
        id: "start-claude",
        label: options.texts.startClaude,
        detail: options.texts.startClaudeDetail,
        select: () => options.openTerminal(["sandbox", "run", "--preset", "claude", "--workspace", process.cwd()], "workspace"),
      },
      {
        id: "start-codex",
        label: options.texts.startCodex,
        detail: options.texts.startCodexDetail,
        select: () => options.openTerminal(["sandbox", "run", "--preset", "codex", "--workspace", process.cwd()], "workspace"),
      },
      {
        id: "shell",
        label: options.texts.openShell,
        detail: workspaceRunning ? options.texts.openShellDetail : options.texts.noWorkspaceDetail,
        enabled: workspaceRunning,
        select: () => options.openTerminal(["sandbox", "shell"], "workspace"),
      },
      {
        id: "stop-workspace",
        label: options.texts.stopWorkspace,
        detail: workspaceRunning ? options.texts.stopWorkspaceDetail : options.texts.noWorkspaceDetail,
        enabled: workspaceRunning,
        select: () => options.openExternal(["sandbox", "stop"], "workspace"),
      },
    ];
  }

  if (options.screen === "logs") {
    return [
      {
        id: "monitor-log",
        label: options.texts.monitorLog,
        detail: options.texts.monitorLogDetail,
        select: () => options.openLog(options.texts.monitorLog, MONITOR_LOG_FILE),
      },
      {
        id: "tunnel-log",
        label: options.texts.tunnelLog,
        detail: options.texts.tunnelLogDetail,
        select: () => options.openLog(options.texts.tunnelLog, TUNNEL_LOG_FILE),
      },
    ];
  }

  return [];
}

export function buildDashboardLayout(columns: number, rows: number): DashboardLayout {
  const terminalColumns = columns > 0 ? columns : FALLBACK_APP_WIDTH;
  const terminalRows = rows > 0 ? rows : FALLBACK_APP_HEIGHT;
  const availableFrameWidth = Math.max(1, terminalColumns - OUTER_MARGIN_WIDTH);
  const frameWidth = Math.min(availableFrameWidth, MAX_FRAME_WIDTH);
  const frameLeftMargin = Math.max(0, Math.floor((terminalColumns - frameWidth) / 2));
  const compactFooter = terminalRows < EXPANDED_FOOTER_MIN_ROWS;
  const footerContentHeight = compactFooter ? COMPACT_FOOTER_CONTENT_HEIGHT : EXPANDED_FOOTER_CONTENT_HEIGHT;
  const bodyVerticalReserve =
    TITLE_HEIGHT +
    FRAME_VERTICAL_BORDER_HEIGHT +
    HEADER_HEIGHT +
    FOOTER_BORDER_HEIGHT +
    footerContentHeight +
    VIEWPORT_BOTTOM_MARGIN_HEIGHT;
  const bodyHeight = Math.max(MIN_BODY_HEIGHT, terminalRows - bodyVerticalReserve);
  const bodyContentHeight = Math.max(MIN_BODY_HEIGHT, bodyHeight - BODY_VERTICAL_PADDING_HEIGHT - MESSAGE_SLOT_HEIGHT);
  const menuContentWidth = Math.max(1, frameWidth - MENU_PANEL_RESERVED_WIDTH);

  return {
    bodyHeight,
    bodyContentHeight,
    compactFooter,
    frameLeftMargin,
    frameWidth,
    menuContentWidth,
  };
}

function clampNumber(value: number, minimumValue: number, maximumValue: number): number {
  return Math.min(Math.max(value, minimumValue), maximumValue);
}

const AppFrame: FC<{ header: ReactNode; footer: ReactNode; layout: DashboardLayout; children: ReactNode }> = ({
  children,
  footer,
  header,
  layout,
}) => (
  <Box width={layout.frameWidth} flexDirection="column" borderStyle="single" borderColor="gray">
    <Box paddingX={2} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
      {header}
    </Box>
    <Box height={layout.bodyHeight} paddingX={2} paddingY={1} flexDirection="column">
      {children}
    </Box>
    <Box paddingX={2} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
      {footer}
    </Box>
  </Box>
);

const Header: FC<{ snapshot: TuiSnapshot; texts: DashboardTexts }> = ({ snapshot, texts }) => {
  const language = snapshot.config?.ui.language ?? detectSystemLanguage();

  return (
    <Box flexDirection="column" width="100%">
      <Text wrap="truncate">
        <Text bold>vpnctl</Text> | {texts.aiDomains}:{" "}
        <Text color={stateColor(snapshot.aiDomains)}>{translateStatusValue(snapshot.aiDomains, language)}</Text>
      </Text>
      <Text wrap="truncate">
        {texts.trafficScope}: <Text color="green">{translateTrafficScope(snapshot.trafficScope, language)}</Text>
      </Text>
      <Text wrap="truncate">
        {texts.workspaces}: {translateStatusValue(snapshot.workspaces, language)}
      </Text>
    </Box>
  );
};

const MenuWorkspace: FC<{
  layout: DashboardLayout;
  screen: TuiScreen;
  items: MenuItem[];
  selectedIndex: number;
  snapshot: TuiSnapshot;
  texts: DashboardTexts;
}> = ({ items, layout, screen, selectedIndex, snapshot, texts }) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <MenuView items={items} layout={layout} selectedIndex={selectedIndex} showDetails />
      <Box borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderColor="gray" overflow="hidden">
        <DetailPanel screen={screen} selectedItem={items[selectedIndex]} snapshot={snapshot} texts={texts} />
      </Box>
    </Box>
  );
};

const MenuView: FC<{ items: MenuItem[]; layout: DashboardLayout; selectedIndex: number; showDetails?: boolean }> = ({
  items,
  layout,
  selectedIndex,
  showDetails = false,
}) => (
  <Box flexDirection="column" flexShrink={0} width={layout.menuContentWidth} overflow="hidden">
    {items.map((item, itemIndex) => {
      const selected = itemIndex === selectedIndex;
      return (
        <Box
          key={`${item.id}:${item.label}`}
          flexDirection="row"
          width={layout.menuContentWidth}
          height={1}
          backgroundColor={selected ? "gray" : undefined}
          overflow="hidden"
        >
          <Text
            color={item.enabled === false ? "gray" : selected ? "white" : undefined}
            bold={selected && item.enabled !== false}
            wrap="truncate"
          >
            {selected ? "> " : "  "}
            {item.label}
            {showDetails && item.detail !== undefined ? (
              <>
                {"  "}
                <Text color={item.enabled === false ? "gray" : (item.detailTone ?? detailColor(item.detail))}>{item.detail}</Text>
              </>
            ) : null}
          </Text>
        </Box>
      );
    })}
  </Box>
);

const DetailPanel: FC<{ screen: TuiScreen; selectedItem?: MenuItem; snapshot: TuiSnapshot; texts: DashboardTexts }> = ({
  screen,
  selectedItem,
  snapshot,
  texts,
}) => {
  const language = snapshot.config?.ui.language ?? detectSystemLanguage();

  if (screen === "dashboard") {
    if (selectedItem?.id === "start-tunnel") {
      return (
        <PanelText title={texts.startTunnel}>
          <WrappedText value="Starts or restarts the tunnel daemon. Root prompt may appear." />
        </PanelText>
      );
    }

    if (selectedItem?.id === "stop-tunnel") {
      return (
        <PanelText title={texts.stopTunnel}>
          <WrappedText value="Stops the tunnel daemon. Protected domains stay blocked fail-closed." />
        </PanelText>
      );
    }

    return (
      <PanelText title={selectedItem?.label ?? texts.status}>
        <WrappedText value={texts.closeDashboard} />
      </PanelText>
    );
  }

  if (screen === "configure") {
    return <ConfigureDetails language={language} selectedItem={selectedItem} snapshot={snapshot} texts={texts} />;
  }

  if (screen === "connection-editor") {
    return <ConnectionEditorDetails language={language} selectedItem={selectedItem} snapshot={snapshot} texts={texts} />;
  }

  if (screen === "domains-editor") {
    return <DomainsEditorDetails language={language} selectedItem={selectedItem} snapshot={snapshot} texts={texts} />;
  }

  if (screen === "dns-editor") {
    return <DnsEditorDetails language={language} selectedItem={selectedItem} snapshot={snapshot} texts={texts} />;
  }

  if (screen === "traffic-scope") {
    return (
      <PanelText title={texts.trafficScope}>
        <Text>{texts.allTraffic}</Text>
        <Text color="green">&gt; {translateTrafficScope("protected domains only", language)}</Text>
        <Box height={1} />
        <WrappedText value={texts.scopeAiOnlyDetail} />
      </PanelText>
    );
  }

  if (screen === "diagnostics") {
    return <DiagnosticsDetails selectedItem={selectedItem} texts={texts} />;
  }

  if (screen === "logs") {
    return (
      <PanelText title={selectedItem?.label ?? texts.logs}>
        <WrappedText value={texts.viewLogs} />
      </PanelText>
    );
  }

  if (screen === "language") {
    return (
      <PanelText title={texts.language}>
        <WrappedText value={language === "ru" ? "Выберите язык панели и подсказок." : "Choose dashboard language and settings labels."} />
      </PanelText>
    );
  }

  return <WorkspaceDetails selectedItem={selectedItem} texts={texts} />;
};

const ConfigureDetails: FC<{ language: UiLanguage; selectedItem?: MenuItem; snapshot: TuiSnapshot; texts: DashboardTexts }> = ({
  language,
  selectedItem,
  snapshot,
  texts,
}) => {
  if (selectedItem?.id === "traffic-scope") {
    return (
      <PanelText title={texts.trafficScope}>
        <Text>{texts.allTraffic}</Text>
        <Text color="green">&gt; {translateTrafficScope(snapshot.trafficScope, language)}</Text>
        <Box height={1} />
        <WrappedText value={snapshot.trafficScope === "protected domains only" ? texts.scopeAiOnlyDetail : texts.scopeAllTrafficDetail} />
      </PanelText>
    );
  }

  if (selectedItem?.id === "domains") {
    return (
      <PanelText title={texts.domains}>
        <Text>{formatCount(snapshot.domainCount, language)}</Text>
        <Box height={1} />
        <WrappedText
          value={language === "ru" ? "Enter откроет редактор защищенных доменов." : "Enter opens the protected domains editor."}
        />
      </PanelText>
    );
  }

  if (selectedItem?.id === "dns") {
    return (
      <PanelText title={texts.dns}>
        <Text>{formatCount(snapshot.dnsCount, language)}</Text>
        <Box height={1} />
        <WrappedText value={language === "ru" ? "Enter откроет редактор DNS-серверов." : "Enter opens the DNS server editor."} />
      </PanelText>
    );
  }

  if (selectedItem?.id === "connection") {
    return (
      <PanelText title={texts.connection}>
        <Text>{snapshot.config === null ? translateStatusValue("not configured", language) : texts.configured}</Text>
        <Box height={1} />
        <WrappedText value={language === "ru" ? "Enter откроет редактор подключения." : "Enter opens the connection editor."} />
      </PanelText>
    );
  }

  if (selectedItem?.id === "language") {
    return (
      <PanelText title={texts.language}>
        <Text>{formatLanguage(language)}</Text>
        <Box height={1} />
        <WrappedText value={language === "ru" ? "Выберите язык интерфейса vpnctl." : "Choose the vpnctl interface language."} />
      </PanelText>
    );
  }

  return (
    <PanelText title={selectedItem?.label ?? texts.configure}>
      <WrappedText
        value={
          language === "ru"
            ? "Настройки сгруппированы здесь. Raw config остается fallback для редких ручных правок."
            : "Settings live here. Raw config remains a fallback for rare manual edits."
        }
      />
    </PanelText>
  );
};

const ConnectionEditorDetails: FC<{ language: UiLanguage; selectedItem?: MenuItem; snapshot: TuiSnapshot; texts: DashboardTexts }> = ({
  language,
  selectedItem,
  snapshot,
  texts,
}) => {
  const outbound = snapshot.config?.outbound;

  if (selectedItem?.id === "replace-connection") {
    return (
      <PanelText title={texts.replaceConnection}>
        <WrappedText
          value={
            language === "ru"
              ? "Enter откроет поле ввода. Вставьте полный vless:// URI, чтобы заменить endpoint."
              : "Enter opens an input field. Paste the full vless:// URI to replace the endpoint."
          }
        />
        {outbound === undefined ? null : (
          <>
            <Box height={1} />
            <Text>Server: {outbound.server}</Text>
            <Text>Port: {outbound.server_port}</Text>
            <Text>SNI: {outbound.tls.server_name}</Text>
          </>
        )}
      </PanelText>
    );
  }

  if (selectedItem?.id === "raw-config") {
    return (
      <PanelText title={texts.openRawConfig}>
        <WrappedText
          value={
            language === "ru"
              ? "Fallback для редких ручных правок. После закрытия sing-box config будет пересобран."
              : "Fallback for rare manual edits. Closing the editor regenerates sing-box config."
          }
        />
      </PanelText>
    );
  }

  return (
    <PanelText title={texts.connection}>
      {outbound === undefined ? (
        <Text>{translateStatusValue("not configured", language)}</Text>
      ) : (
        <>
          <Text>Server: {outbound.server}</Text>
          <Text>Port: {outbound.server_port}</Text>
          <Text>SNI: {outbound.tls.server_name}</Text>
        </>
      )}
    </PanelText>
  );
};

const DomainsEditorDetails: FC<{ language: UiLanguage; selectedItem?: MenuItem; snapshot: TuiSnapshot; texts: DashboardTexts }> = ({
  language,
  selectedItem,
  snapshot,
  texts,
}) => {
  const domains = snapshot.config?.domains ?? [];

  if (selectedItem?.id === "view-domains") {
    return (
      <PanelText title={texts.viewDomains}>
        <Text>{formatCount(snapshot.domainCount, language)}</Text>
        <Box height={1} />
        <WrappedText
          value={language === "ru" ? "Enter откроет прокручиваемый список доменов." : "Enter opens the scrollable domain list."}
        />
      </PanelText>
    );
  }

  if (selectedItem?.id === "add-domain") {
    return (
      <PanelText title={texts.addDomain}>
        <WrappedText
          value={
            language === "ru"
              ? "Введите домен или URL. vpnctl сохранит hostname."
              : "Type a domain or paste a URL. vpnctl stores the hostname."
          }
        />
      </PanelText>
    );
  }

  if (selectedItem?.id === "remove-domain") {
    return (
      <PanelText title={texts.removeDomain}>
        <WrappedText
          value={
            language === "ru"
              ? "Введите точный домен для удаления. Если не помните его, сначала откройте список."
              : "Type the exact domain to remove. View the list first if you are unsure."
          }
        />
      </PanelText>
    );
  }

  if (selectedItem?.id === "use-default-domains") {
    return (
      <PanelText title={texts.useDefaultDomains}>
        <WrappedText
          value={
            language === "ru"
              ? `Заменяет текущий список на ${AI_DEV_TOOLS_DOMAINS.length} доменов из bundled defaults.`
              : `Replaces the current list with ${AI_DEV_TOOLS_DOMAINS.length} bundled default domains.`
          }
        />
      </PanelText>
    );
  }

  if (selectedItem?.id === "raw-config") {
    return (
      <PanelText title={texts.openRawConfig}>
        <WrappedText
          value={
            language === "ru"
              ? "Fallback для массовых ручных правок. Обычно удобнее Add/Remove/View."
              : "Fallback for bulk manual edits. Add, Remove, and View are usually easier."
          }
        />
      </PanelText>
    );
  }

  return (
    <PanelText title={texts.domains}>
      <Text>{formatCount(snapshot.domainCount, language)}</Text>
      <Box height={1} />
      <WrappedText value={formatListPreview(domains, language)} />
    </PanelText>
  );
};

const DnsEditorDetails: FC<{ language: UiLanguage; selectedItem?: MenuItem; snapshot: TuiSnapshot; texts: DashboardTexts }> = ({
  language,
  selectedItem,
  snapshot,
  texts,
}) => {
  const servers = snapshot.config?.dns.servers ?? [];

  if (selectedItem?.id === "view-dns-servers") {
    return (
      <PanelText title={texts.viewDnsServers}>
        <Text>{formatCount(snapshot.dnsCount, language)}</Text>
        <Box height={1} />
        <WrappedText value={language === "ru" ? "Enter откроет список DNS-серверов." : "Enter opens the DNS server list."} />
      </PanelText>
    );
  }

  if (selectedItem?.id === "add-dns-server") {
    return (
      <PanelText title={texts.addDnsServer}>
        <WrappedText value={language === "ru" ? "Введите IPv4 или IPv6 адрес DNS-сервера." : "Type an IPv4 or IPv6 DNS server address."} />
      </PanelText>
    );
  }

  if (selectedItem?.id === "remove-dns-server") {
    return (
      <PanelText title={texts.removeDnsServer}>
        <WrappedText
          value={
            language === "ru"
              ? "Введите точный IP DNS-сервера для удаления. Должен остаться хотя бы один сервер."
              : "Type the exact DNS server IP to remove. At least one server must remain."
          }
        />
      </PanelText>
    );
  }

  if (selectedItem?.id === "raw-config") {
    return (
      <PanelText title={texts.openRawConfig}>
        <WrappedText
          value={language === "ru" ? "Fallback для ручной правки DNS в config.json." : "Fallback for manual DNS edits in config.json."}
        />
      </PanelText>
    );
  }

  if (selectedItem?.id.startsWith("dns-preset-")) {
    return (
      <PanelText title={selectedItem.label}>
        <WrappedText
          value={
            language === "ru"
              ? `Заменяет текущий список DNS на: ${selectedItem.detail ?? ""}`
              : `Replaces the current DNS list with: ${selectedItem.detail ?? ""}`
          }
        />
      </PanelText>
    );
  }

  return (
    <PanelText title={texts.dns}>
      <Text>{formatCount(snapshot.dnsCount, language)}</Text>
      <Box height={1} />
      <WrappedText value={formatListPreview(servers, language)} />
    </PanelText>
  );
};

const DiagnosticsDetails: FC<{ selectedItem?: MenuItem; texts: DashboardTexts }> = ({ selectedItem, texts }) => {
  if (selectedItem?.id === "doctor") {
    return (
      <PanelText title={texts.doctor}>
        <WrappedText value="Checks config, sing-box, pf, launchd daemons, update state, and VPN conflicts." />
      </PanelText>
    );
  }

  if (selectedItem?.id === "check") {
    return (
      <PanelText title={texts.check}>
        <WrappedText value="Probes configured protected domains through the current tunnel path." />
      </PanelText>
    );
  }

  if (selectedItem?.id === "audit") {
    return (
      <PanelText title={selectedItem.label}>
        <WrappedText value="Shows active configured process sockets so leaks are easier to spot." />
      </PanelText>
    );
  }

  if (selectedItem?.id === "update") {
    return (
      <PanelText title={texts.update}>
        <WrappedText value="Checks GitHub releases and redeploys installed binaries when a newer release exists." />
      </PanelText>
    );
  }

  return (
    <PanelText title={selectedItem?.label ?? texts.diagnostics}>
      <WrappedText value="Select a diagnostic command to see what it checks before running it." />
    </PanelText>
  );
};

const WorkspaceDetails: FC<{ selectedItem?: MenuItem; texts: DashboardTexts }> = ({ selectedItem, texts }) => {
  if (selectedItem?.id === "start-claude") {
    return (
      <PanelText title={texts.startClaude}>
        <WrappedText value="Starts a protected Docker workspace for Claude with the current directory mounted." />
      </PanelText>
    );
  }

  if (selectedItem?.id === "start-codex") {
    return (
      <PanelText title={texts.startCodex}>
        <WrappedText value="Starts a protected Docker workspace for Codex with the current directory mounted." />
      </PanelText>
    );
  }

  if (selectedItem?.id === "shell") {
    return (
      <PanelText title={texts.openShell}>
        <WrappedText
          value={selectedItem.enabled === false ? texts.noWorkspaceDetail : "Opens a shell inside the existing protected sandbox."}
        />
      </PanelText>
    );
  }

  if (selectedItem?.id === "stop-workspace") {
    return (
      <PanelText title={texts.stopWorkspace}>
        <WrappedText
          value={
            selectedItem.enabled === false
              ? texts.noWorkspaceDetail
              : "Stops the running protected sandbox and leaves host protection unchanged."
          }
        />
      </PanelText>
    );
  }

  return (
    <PanelText title={selectedItem?.label ?? texts.protectedWorkspace}>
      <WrappedText value="Run agent work inside a protected Docker network namespace." />
    </PanelText>
  );
};

const TextInputPanel: FC<{ input: TextInputState; language: UiLanguage; texts: DashboardTexts }> = ({ input, language, texts }) => (
  <PanelText title={textInputTitle(input.kind, texts)}>
    <Text color="gray">{textInputPrompt(input.kind, language, texts)}</Text>
    <Box height={1} />
    <Text wrap="wrap">&gt; {input.value.length === 0 ? <Text color="gray">(empty)</Text> : input.value}</Text>
  </PanelText>
);

const PanelText: FC<{ title: string; children: ReactNode }> = ({ children, title }) => (
  <Box flexDirection="column" width="100%" flexShrink={0}>
    <Box height={1} flexShrink={0}>
      <Text bold>{title}</Text>
    </Box>
    <Box height={1} flexShrink={0}>
      <Text color="gray" wrap="truncate">
        {PANEL_RULE}
      </Text>
    </Box>
    <Box height={1} flexShrink={0} />
    {children}
  </Box>
);

const WrappedText: FC<{ value: string }> = ({ value }) => <Text wrap="wrap">{value}</Text>;

const StatusView: FC<{ language: UiLanguage; snapshot: TuiSnapshot; texts: DashboardTexts }> = ({ language, snapshot, texts }) => {
  const domainSummary = formatCount(snapshot.domainCount, language);
  const scopeDetail = snapshot.trafficScope === "protected domains only" ? texts.scopeAiOnlyDetail : texts.scopeAllTrafficDetail;
  const vpnDetail = formatOtherVpnDetail(snapshot.otherVpnInterfaces, snapshot.vpnRoutingConflict, snapshot.vpnDnsConflicts, language);
  const rows: Array<{ id: string; label: string; value: string; color?: StatusColor }> = [
    {
      id: "ai-domains",
      label: texts.aiDomains,
      value: translateStatusValue(snapshot.aiDomains, language),
      color: stateColor(valueToAiDomainsState(snapshot.aiDomains)),
    },
    { id: "traffic-scope", label: texts.trafficScope, value: translateTrafficScope(snapshot.trafficScope, language) },
    {
      id: "tunnel",
      label: texts.tunnel,
      value: translateStatusValue(snapshot.tunnel, language),
      color: snapshot.tunnel === "up" ? "green" : "yellow",
    },
    {
      id: "leak-guard",
      label: texts.leakGuard,
      value: translateStatusValue(snapshot.leakGuard, language),
      color: snapshot.leakGuard === "standing by" ? "green" : "yellow",
    },
    {
      id: "other-vpn",
      label: texts.otherVpn,
      value: translateStatusValue(snapshot.otherVpn, language),
      color: snapshot.otherVpn === "none" ? undefined : "yellow",
    },
    { id: "domains", label: texts.domains, value: domainSummary },
  ];

  return (
    <Box flexDirection="column" flexGrow={1}>
      {rows.map((row) => (
        <Text key={row.id} wrap="truncate">
          {row.label}: <Text color={row.color}>{row.value}</Text>
        </Text>
      ))}
      <Box height={1} />
      <Text bold wrap="truncate">
        {texts.currentRouting}
      </Text>
      <Text wrap="truncate">{scopeDetail}</Text>
      <Text wrap="truncate">{vpnDetail}</Text>
      <Text wrap="truncate">
        {texts.domains}: {domainSummary}
      </Text>
    </Box>
  );
};

const LogView: FC<{ title: string; content: string; scrollOffset: number; visibleLineCount: number }> = ({
  content,
  scrollOffset,
  title,
  visibleLineCount,
}) => {
  const lines = logLines(content);
  const visibleLines = visibleLogLines(lines, visibleLineCount, scrollOffset);
  const firstVisibleLine = Math.max(1, lines.length - scrollOffset - visibleLines.length + 1);
  const lastVisibleLine = firstVisibleLine + visibleLines.length - 1;

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text color="gray">
        {firstVisibleLine}-{lastVisibleLine} / {lines.length}
      </Text>
      {visibleLines.map((line, lineIndex) => (
        <Text key={`${firstVisibleLine + lineIndex}:${line}`} wrap="truncate">
          {line.length === 0 ? " " : line}
        </Text>
      ))}
    </Box>
  );
};

const Footer: FC<{ compact: boolean; screen: TuiScreen; textInputActive: boolean; texts: DashboardTexts }> = ({
  compact,
  screen,
  textInputActive,
  texts,
}) => {
  const hints = textInputActive
    ? [
        { value: "Enter", label: texts.select },
        { value: "Esc", label: texts.back },
      ]
    : screen === "log-view"
      ? [
          { value: "↑/↓", label: texts.scroll },
          { value: "Esc", label: texts.back },
          { value: "Q", label: texts.quit },
        ]
      : screen === "status"
        ? [
            { value: "Esc", label: texts.back },
            { value: "Q", label: texts.quit },
          ]
        : [
            { value: "↑/↓", label: texts.move },
            { value: "Enter", label: texts.select },
            { value: "Esc", label: texts.back },
            { value: "Q", label: texts.quit },
          ];

  if (compact) {
    return (
      <Box width="100%">
        <Text wrap="truncate">{hints.map((hint) => `[${hint.value}] ${hint.label}`).join("  ")}</Text>
      </Box>
    );
  }

  if (textInputActive) {
    return (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-around" width="100%">
        <KeyHint value="Enter" label={texts.select} />
        <KeyHint value="Esc" label={texts.back} />
      </Box>
    );
  }

  if (screen === "log-view") {
    return (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-around" width="100%">
        <KeyHint value="↑/↓" label={texts.scroll} />
        <KeyHint value="Esc" label={texts.back} />
        <KeyHint value="Q" label={texts.quit} />
      </Box>
    );
  }

  if (screen === "status") {
    return (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-around" width="100%">
        <KeyHint value="Esc" label={texts.back} />
        <KeyHint value="Q" label={texts.quit} />
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" justifyContent="space-around" width="100%">
      <KeyHint value="↑/↓" label={texts.move} />
      <KeyHint value="Enter" label={texts.select} />
      <KeyHint value="Esc" label={texts.back} />
      <KeyHint value="Q" label={texts.quit} />
    </Box>
  );
};

const KeyHint: FC<{ value: string; label: string }> = ({ label, value }) => (
  <Box flexDirection="row" alignItems="center" width={KEY_HINT_WIDTH} marginRight={KEY_HINT_RIGHT_MARGIN} flexShrink={0}>
    <Box
      borderStyle="single"
      borderColor="gray"
      width={Math.max(value.length + KEYCAP_EXTRA_WIDTH, KEYCAP_MIN_WIDTH)}
      minWidth={Math.max(value.length + KEYCAP_EXTRA_WIDTH, KEYCAP_MIN_WIDTH)}
      height={3}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
    >
      <Text bold>{value}</Text>
    </Box>
    <Box marginLeft={1}>
      <Text>
        {label}
        {KEY_HINT_LABEL_SUFFIX}
      </Text>
    </Box>
  </Box>
);

async function runExternal(args: string[]): Promise<string> {
  restoreTerminalForExternalCommand();
  const proc = Bun.spawn(buildVpnctlInvocation(args), { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  await waitForReturn();
  return exitCode === 0 ? "Command finished." : `Command exited with code ${exitCode}.`;
}

async function waitForReturn(): Promise<void> {
  process.stdout.write("\n[Enter] Return to vpnctl");
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => {
      resolve();
    });
  });
  process.stdin.pause();
}

function logLines(content: string): string[] {
  return content.length === 0 ? ["(empty)"] : content.replace(/\n$/, "").split("\n");
}

function visibleLogLines(lines: string[], visibleLineCount: number, scrollOffset: number): string[] {
  const maxScrollOffset = Math.max(0, lines.length - visibleLineCount);
  const safeScrollOffset = clampNumber(scrollOffset, 0, maxScrollOffset);
  const endIndex = lines.length - safeScrollOffset;
  const startIndex = Math.max(0, endIndex - visibleLineCount);
  return lines.slice(startIndex, endIndex);
}

function maxLogScrollOffset(content: string, visibleLineCount: number): number {
  return Math.max(0, logLines(content).length - visibleLineCount);
}

function formatListContent(values: string[]): string {
  if (values.length === 0) return "(empty)";
  return values.map((value, index) => `${index + 1}. ${value}`).join("\n");
}

function formatListPreview(values: string[], language: UiLanguage): string {
  if (values.length === 0) return language === "ru" ? "(пусто)" : "(empty)";
  const visibleValues = values.slice(0, LIST_PREVIEW_LIMIT);
  const hiddenCount = values.length - visibleValues.length;
  const suffix = hiddenCount > 0 ? (language === "ru" ? `\n... еще ${hiddenCount}` : `\n... ${hiddenCount} more`) : "";
  return `${visibleValues.join("\n")}${suffix}`;
}

function textInputTitle(kind: TextInputKind, texts: DashboardTexts): string {
  if (kind === "connection-uri") return texts.replaceConnection;
  if (kind === "domain") return texts.addDomain;
  if (kind === "remove-domain") return texts.removeDomain;
  if (kind === "dns-server") return texts.addDnsServer;
  return texts.removeDnsServer;
}

function textInputPrompt(kind: TextInputKind, language: UiLanguage, texts: DashboardTexts): string {
  if (kind === "connection-uri") return texts.pasteVlessUri;
  if (kind === "domain") return language === "ru" ? "Введите домен или URL." : "Type a domain or URL.";
  if (kind === "remove-domain") return language === "ru" ? "Введите точный домен." : "Type the exact domain.";
  if (kind === "dns-server") return language === "ru" ? "Введите IP DNS-сервера." : "Type a DNS server IP.";
  return language === "ru" ? "Введите точный IP DNS-сервера." : "Type the exact DNS server IP.";
}

function formatCount(count: number | null, language: UiLanguage): string {
  if (count === null) return translateStatusValue("not configured", language);
  return language === "ru" ? `${count} настроено` : `${count} configured`;
}

function formatOtherVpnDetail(
  interfaces: OtherVpnInterface[] | null,
  routingConflict: string | null,
  dnsConflicts: TuiSnapshot["vpnDnsConflicts"],
  language: UiLanguage,
): string {
  if (interfaces === null) {
    return language === "ru"
      ? "Конфликт VPN не удалось проверить. Запустите Doctor, если маршрутизация выглядит странно."
      : "VPN conflict could not be checked. Run Doctor if routing looks wrong.";
  }

  if (interfaces.length === 0) {
    return language === "ru" ? "Других VPN-интерфейсов не видно." : "No other VPN interface detected.";
  }

  const names = interfaces.map((vpnInterface) => `${vpnInterface.name} (${vpnInterface.inet})`).join(", ");
  const activeDnsConflicts = dnsConflicts ?? [];
  if (routingConflict === null && activeDnsConflicts.length === 0) {
    return language === "ru"
      ? `Другие VPN-интерфейсы: ${names}. Конфликта маршрута или DNS не найдено.`
      : `Other VPN interfaces: ${names}. No route or DNS conflict detected.`;
  }

  const dnsNames = activeDnsConflicts.map((dnsConflict) => `${dnsConflict.iface} DNS ${dnsConflict.servers.join(", ")}`).join("; ");
  if (routingConflict !== null && activeDnsConflicts.length > 0) {
    return language === "ru"
      ? `Конфликт маршрута через ${routingConflict}; DNS конфликт: ${dnsNames}. Другие интерфейсы: ${names}.`
      : `Route conflict via ${routingConflict}; DNS conflict: ${dnsNames}. Other interfaces: ${names}.`;
  }

  if (routingConflict !== null) {
    return language === "ru"
      ? `Default route идет через ${routingConflict}. Другие интерфейсы: ${names}.`
      : `Default route uses ${routingConflict}. Other interfaces: ${names}.`;
  }

  return language === "ru"
    ? `DNS конфликт: ${dnsNames}. Другие интерфейсы: ${names}.`
    : `DNS conflict: ${dnsNames}. Other interfaces: ${names}.`;
}

function detailColor(detail: string | undefined): StatusColor | undefined {
  if (detail === undefined) return undefined;
  if (detail.includes("configured") || detail.includes("настроено") || detail === "protected domains only" || detail === "selected")
    return "green";
  if (detail.includes("intrusive")) return "yellow";
  return undefined;
}

function translateStatusValue(value: string, language: UiLanguage): string {
  if (language === "en") return value;
  if (value === "through VPN") return "через VPN";
  if (value === "blocked") return "заблокировано";
  if (value === "configured") return "настроено";
  if (value === "unknown") return "неизвестно";
  if (value === "not configured") return "не настроено";
  if (value === "up") return "включен";
  if (value === "starting") return "запускается";
  if (value === "down") return "выключен";
  if (value === "standing by") return "готов";
  if (value === "blocking protected domains") return "блокирует защищенные домены";
  if (value === "blocking while tunnel starts") return "блокирует на время запуска";
  if (value === "needs refresh") return "требует обновления";
  if (value === "none") return "нет";
  if (value === "DNS conflict") return "DNS конфликт";
  if (value === "route + DNS conflict") return "маршрут + DNS";
  if (value.startsWith("route via ")) return `маршрут через ${value.slice("route via ".length)}`;
  return value;
}

function translateTrafficScope(value: string, language: UiLanguage): string {
  if (language === "en") return value;
  if (value === "protected domains only") return "только защищенные домены";
  if (value === "all traffic") return "весь трафик";
  return value;
}

function screenTitle(screen: TuiScreen, texts: DashboardTexts): string {
  if (
    screen === "configure" ||
    screen === "connection-editor" ||
    screen === "domains-editor" ||
    screen === "dns-editor" ||
    screen === "traffic-scope" ||
    screen === "language"
  )
    return texts.configure;
  if (screen === "status") return texts.status;
  if (screen === "diagnostics") return texts.diagnostics;
  if (screen === "workspace") return texts.protectedWorkspace;
  if (screen === "logs" || screen === "log-view") return texts.logs;
  return texts.dashboard;
}

function isDashboardExitAction(value: unknown): value is DashboardExitAction {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const candidateKind = value.kind;
  return candidateKind === "external" || candidateKind === "terminal" || candidateKind === "editor" || candidateKind === "quit";
}
