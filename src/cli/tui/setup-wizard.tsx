import React, { type FC, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import { DEFAULT_ROUTING_MODE, type Config, type RoutingMode } from "../../core/config";
import {
  DEFAULT_PREFLIGHT_WRAPPER_DIR,
  installPreflightWrappers,
  type PreflightWrapperCommand,
  type PreflightWrapperInstallResult,
} from "../../core/preflight-wrapper";
import { DEFAULT_SETUP_VALUES, AI_DEV_TOOLS_DOMAINS, buildSetupConfig, parseListInput, writeSetupConfig } from "../setup-config";
import { parseVlessUri } from "../../core/vless";
import { buildVpnctlInvocation, restoreTerminalForExternalCommand } from "./actions";

type SetupStep = "connection" | "traffic-scope" | "domains" | "preflight" | "verify";
type TextField = "uri" | "domains";

interface SetupWizardOptions {
  configPath: string;
  singboxConfigPath: string;
  requestedRoutingMode?: RoutingMode;
}

export interface SetupWizardState {
  step: SetupStep;
  selectedIndex: number;
  textField: TextField | null;
  uri: string;
  routingMode: RoutingMode;
  domains: string[];
  preflightCommands: PreflightWrapperCommand[];
  domainInput: string;
  message: string | null;
  installed: boolean;
  installRunning: boolean;
  installOutput: string;
}

interface SetupWizardAppProps {
  initialState: SetupWizardState;
}

type SetupWizardExitAction = { kind: "install"; state: SetupWizardState } | { kind: "finish"; state: SetupWizardState } | { kind: "quit" };

interface SetupMenuItem {
  label: string;
  detail?: string;
  select: () => void;
}

const STEPS: Array<{ step: SetupStep; label: string }> = [
  { step: "connection", label: "1 Connection" },
  { step: "traffic-scope", label: "2 Traffic scope" },
  { step: "domains", label: "3 Domains" },
  { step: "preflight", label: "4 Preflight" },
  { step: "verify", label: "5 Verify" },
];

const FALLBACK_APP_WIDTH = 96;
const FALLBACK_APP_HEIGHT = 32;
const OUTER_MARGIN_WIDTH = 2;
const BODY_VERTICAL_PADDING_HEIGHT = 2;
const MESSAGE_SLOT_HEIGHT = 1;
const MIN_BODY_HEIGHT = 1;
const EXPANDED_FOOTER_MIN_ROWS = 30;
const SETUP_HEADER_HEIGHT = 6;
const COMPACT_FOOTER_CONTENT_HEIGHT = 1;
const EXPANDED_FOOTER_CONTENT_HEIGHT = 6;
const FRAME_VERTICAL_BORDER_HEIGHT = 2;
const FOOTER_BORDER_HEIGHT = 1;
const TITLE_HEIGHT = 1;
const VIEWPORT_BOTTOM_MARGIN_HEIGHT = 1;
const MENU_WIDTH = 28;
const INSTALL_OUTPUT_MAX_LINES = 18;
const KEYCAP_MIN_WIDTH = 5;
const KEYCAP_EXTRA_WIDTH = 4;
const KEY_HINT_WIDTH = 18;
const KEY_HINT_RIGHT_MARGIN = 2;
const KEY_HINT_LABEL_SUFFIX = "  ";

export async function runTuiSetupWizard(options: SetupWizardOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("vpnctl installer needs an interactive terminal unless --uri is provided");
  }

  let state = initialSetupState(options.requestedRoutingMode);

  while (true) {
    const instance = render(<SetupWizardApp initialState={state} />, {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      alternateScreen: true,
      exitOnCtrlC: true,
      incrementalRendering: true,
    });

    let result: unknown;
    try {
      result = await instance.waitUntilExit();
    } finally {
      instance.cleanup();
      restoreTerminalForExternalCommand();
    }

    if (!isSetupWizardExitAction(result)) return;
    if (result.kind === "quit") throw new Error("vpnctl installer cancelled.");
    if (result.kind === "finish") {
      if (!result.state.installed) throw new Error("vpnctl install failed.");
      return;
    }

    state = await writeConfigAndInstall(result.state, options.configPath, options.singboxConfigPath);
  }
}

export const SetupWizardApp: FC<SetupWizardAppProps> = ({ initialState }) => {
  const { exit } = useApp();
  const [state, setState] = useState(initialState);

  const menu = buildSetupMenu(state, {
    exit,
    setState,
  });

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit({ kind: "quit" });
      return;
    }

    if (state.textField !== null) {
      if (key.return) {
        submitTextField(state, setState);
        return;
      }

      if (key.escape) {
        moveSetupBack(state, setState);
        return;
      }

      updateTextField(input, key.backspace, state, setState);
      return;
    }

    if (input === "q" || input === "Q") {
      exit({ kind: "quit" });
      return;
    }

    if (key.escape) {
      moveSetupBack(state, setState);
      return;
    }

    if (key.upArrow) {
      setState((currentState) => ({ ...currentState, selectedIndex: Math.max(0, currentState.selectedIndex - 1) }));
      return;
    }

    if (key.downArrow) {
      setState((currentState) => ({ ...currentState, selectedIndex: Math.min(menu.length - 1, currentState.selectedIndex + 1) }));
      return;
    }

    if (key.return) {
      const menuItem = menu[state.selectedIndex];
      if (menuItem !== undefined) menuItem.select();
    }
  });

  return <SetupWizardView state={state} menu={menu} />;
};

export const SetupWizardView: FC<{ state: SetupWizardState; menu: SetupMenuItem[] }> = ({ state, menu }) => {
  const { columns, rows } = useWindowSize();
  const terminalColumns = columns > 0 ? columns : FALLBACK_APP_WIDTH;
  const terminalRows = rows > 0 ? rows : FALLBACK_APP_HEIGHT;
  const frameWidth = Math.max(1, terminalColumns - OUTER_MARGIN_WIDTH);
  const compactFooter = terminalRows < EXPANDED_FOOTER_MIN_ROWS;
  const footerContentHeight = compactFooter ? COMPACT_FOOTER_CONTENT_HEIGHT : EXPANDED_FOOTER_CONTENT_HEIGHT;
  const bodyVerticalReserve =
    TITLE_HEIGHT +
    FRAME_VERTICAL_BORDER_HEIGHT +
    SETUP_HEADER_HEIGHT +
    FOOTER_BORDER_HEIGHT +
    footerContentHeight +
    VIEWPORT_BOTTOM_MARGIN_HEIGHT;
  const bodyHeight = Math.max(MIN_BODY_HEIGHT, terminalRows - bodyVerticalReserve);
  const bodyContentHeight = Math.max(MIN_BODY_HEIGHT, bodyHeight - BODY_VERTICAL_PADDING_HEIGHT - MESSAGE_SLOT_HEIGHT);

  return (
    <Box flexDirection="column" width={frameWidth}>
      <Text bold>vpnctl installer</Text>
      <Box width={frameWidth} flexDirection="column" borderStyle="single" borderColor="gray">
        <Box
          paddingX={2}
          paddingY={1}
          flexDirection="column"
          borderStyle="single"
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          borderColor="gray"
        >
          <Text>vpnctl installer</Text>
          <Box height={1} />
          <Stepper step={state.step} compact={frameWidth < 78} />
        </Box>
        <Box height={bodyHeight} paddingX={2} paddingY={1} flexDirection="column">
          <Box height={bodyContentHeight} overflow="hidden" flexDirection="column">
            <SetupBody state={state} menu={menu} />
          </Box>
          <Box height={MESSAGE_SLOT_HEIGHT} overflow="hidden">
            <Text color="yellow" wrap="truncate">
              {state.message === null ? " " : state.message}
            </Text>
          </Box>
        </Box>
        <Box paddingX={2} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
          <SetupFooter compact={compactFooter} state={state} />
        </Box>
      </Box>
    </Box>
  );
};

function initialSetupState(requestedRoutingMode: RoutingMode | undefined): SetupWizardState {
  return {
    step: "connection",
    selectedIndex: 0,
    textField: "uri",
    uri: "",
    routingMode: requestedRoutingMode ?? DEFAULT_ROUTING_MODE,
    domains: AI_DEV_TOOLS_DOMAINS,
    preflightCommands: [],
    domainInput: AI_DEV_TOOLS_DOMAINS.join(", "),
    message: null,
    installed: false,
    installRunning: false,
    installOutput: "",
  };
}

function buildSetupMenu(
  state: SetupWizardState,
  options: { exit: (value?: unknown) => void; setState: React.Dispatch<React.SetStateAction<SetupWizardState>> },
): SetupMenuItem[] {
  if (state.step === "traffic-scope") {
    return [
      {
        label: "Protected domains only",
        detail: "default",
        select: () => options.setState((currentState) => ({ ...currentState, routingMode: "split", step: "domains", selectedIndex: 0 })),
      },
      {
        label: "All traffic",
        detail: "more intrusive",
        select: () => options.setState((currentState) => ({ ...currentState, routingMode: "full", step: "domains", selectedIndex: 0 })),
      },
    ];
  }

  if (state.step === "domains") {
    const nextState: SetupWizardState = {
      ...state,
      domains: AI_DEV_TOOLS_DOMAINS,
      domainInput: AI_DEV_TOOLS_DOMAINS.join(", "),
      selectedIndex: 0,
      message: null,
    };

    return [
      {
        label: "Use default protected domains",
        detail: `${AI_DEV_TOOLS_DOMAINS.length} domains`,
        select: () => options.setState({ ...nextState, step: "preflight" }),
      },
      {
        label: "Edit domain list",
        select: () => options.setState((currentState) => ({ ...currentState, textField: "domains", message: null })),
      },
    ];
  }

  if (state.step === "preflight") {
    return [
      { label: "No preflight wrappers", detail: "default", select: () => options.exit({ kind: "install", state }) },
      {
        label: "Claude",
        detail: "claude -> vpnctl exec",
        select: () => options.exit({ kind: "install", state: { ...state, preflightCommands: ["claude"] } }),
      },
      {
        label: "Codex",
        detail: "codex -> vpnctl exec",
        select: () => options.exit({ kind: "install", state: { ...state, preflightCommands: ["codex"] } }),
      },
      {
        label: "Claude and Codex",
        detail: "both wrappers",
        select: () => options.exit({ kind: "install", state: { ...state, preflightCommands: ["claude", "codex"] } }),
      },
    ];
  }

  if (state.step === "verify") {
    return [{ label: "Finish", select: () => options.exit({ kind: "finish", state }) }];
  }

  return [];
}

const Stepper: FC<{ step: SetupStep; compact: boolean }> = ({ compact, step }) => {
  const labels = compact
    ? [
        { step: "connection", label: "1 Conn" },
        { step: "traffic-scope", label: "2 Scope" },
        { step: "domains", label: "3 Domains" },
        { step: "preflight", label: "4 Preflight" },
        { step: "verify", label: "5 Verify" },
      ]
    : STEPS;

  return (
    <Box flexDirection="row" width="100%" justifyContent="space-between">
      {labels.map((item) => (
        <Box key={item.step} flexShrink={1}>
          <Text color={item.step === step ? "yellow" : undefined} bold={item.step === step} wrap="truncate">
            {item.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

const SetupBody: FC<{ state: SetupWizardState; menu: SetupMenuItem[] }> = ({ state, menu }) => {
  if (state.step === "connection") {
    return (
      <Box flexDirection="column">
        <Text bold>VLESS+Reality URI</Text>
        <Text color="gray">Paste your vless:// link, then press Enter.</Text>
        <Box height={1} />
        <InputBox value={state.uri} placeholder="[paste vless://...]" />
      </Box>
    );
  }

  if (state.step === "traffic-scope") {
    return (
      <Box flexDirection="column">
        <Text bold>Choose traffic scope</Text>
        <Box height={1} />
        <SetupMenu menu={menu} selectedIndex={state.selectedIndex} />
        <Box height={1} />
        <Text color="gray">
          {state.selectedIndex === 0 ? "Only protected domains use the VPN." : "All non-private traffic uses the VPN."}
        </Text>
      </Box>
    );
  }

  if (state.step === "domains") {
    if (state.textField === "domains") {
      return (
        <Box flexDirection="column">
          <Text bold>Protected domains</Text>
          <Text color="gray">Comma-separated domains. Press Enter to continue.</Text>
          <Box height={1} />
          <InputBox value={state.domainInput} placeholder="[api.openai.com, api.anthropic.com]" />
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        <Text bold>Protected domains</Text>
        <Box height={1} />
        <SetupMenu menu={menu} selectedIndex={state.selectedIndex} />
        <Box height={1} />
        <Text color="gray">{state.domains.length} domains selected.</Text>
      </Box>
    );
  }

  if (state.step === "preflight") {
    return (
      <Box flexDirection="column">
        <Text bold>Preflight wrappers</Text>
        <Text color="gray">Choose CLI names that should run through vpnctl exec.</Text>
        <Box height={1} />
        <SetupMenu menu={menu} selectedIndex={state.selectedIndex} />
        <Box height={1} />
        <Text color="gray">Wrappers install to {DEFAULT_PREFLIGHT_WRAPPER_DIR}.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{state.installed ? "Ready" : "Config ready"}</Text>
      <Box height={1} />
      <Text>{state.installed ? "vpnctl is installed. Open the dashboard with vpnctl." : "Run the installer again, then open vpnctl."}</Text>
      {state.installOutput.length === 0 ? null : (
        <>
          <Box height={1} />
          <InstallOutput value={state.installOutput} />
        </>
      )}
      <Box height={1} />
      <SetupMenu menu={menu} selectedIndex={state.selectedIndex} />
    </Box>
  );
};

const SetupMenu: FC<{ menu: SetupMenuItem[]; selectedIndex: number }> = ({ menu, selectedIndex }) => (
  <Box flexDirection="column" flexShrink={0}>
    {menu.map((item, itemIndex) => {
      const selected = itemIndex === selectedIndex;
      return (
        <Box key={item.label} flexDirection="row" width="100%" backgroundColor={selected ? "gray" : undefined}>
          <Box width={MENU_WIDTH} flexShrink={0}>
            <Text color={selected ? "white" : undefined} bold={selected} wrap="truncate">
              {selected ? "> " : "  "}
              {item.label}
            </Text>
          </Box>
          <Text color={item.detail === undefined ? "gray" : "green"} wrap="truncate">
            {item.detail ?? ""}
          </Text>
        </Box>
      );
    })}
  </Box>
);

const InputBox: FC<{ value: string; placeholder: string }> = ({ placeholder, value }) => (
  <Box borderStyle="single" borderColor="gray" paddingX={1} width="100%">
    <Text wrap="wrap">
      {value.length === 0 ? <Text color="gray">{placeholder}</Text> : value}
      <Text inverse> </Text>
    </Text>
  </Box>
);

const InstallOutput: FC<{ value: string }> = ({ value }) => {
  const lines = value.replace(/\n$/, "").split("\n").slice(-INSTALL_OUTPUT_MAX_LINES);
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box height={1} flexShrink={0}>
        <Text bold>Install log</Text>
      </Box>
      {lines.map((line, lineIndex) => (
        <Text key={`${lineIndex}:${line}`}>{line.length === 0 ? " " : line}</Text>
      ))}
    </Box>
  );
};

const SetupFooter: FC<{ compact: boolean; state: SetupWizardState }> = ({ compact, state }) => {
  const hints =
    state.step === "verify"
      ? [
          { value: "Enter", label: "Close" },
          { value: "Q", label: "Quit" },
        ]
      : state.textField !== null
        ? [
            { value: "Enter", label: "Continue" },
            { value: "Esc", label: "Back" },
          ]
        : [
            { value: "↑/↓", label: "Move" },
            { value: "Enter", label: "Select" },
            { value: "Esc", label: "Back" },
            { value: "Q", label: "Quit" },
          ];

  if (compact) {
    return (
      <Box width="100%">
        <Text wrap="truncate">{hints.map((hint) => `[${hint.value}] ${hint.label}`).join("  ")}</Text>
      </Box>
    );
  }

  if (state.step === "verify") {
    return (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-around" width="100%">
        <KeyHint value="Enter" label="Close" />
        <KeyHint value="Q" label="Quit" />
      </Box>
    );
  }

  if (state.textField !== null) {
    return (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-around" width="100%">
        <KeyHint value="Enter" label="Continue" />
        <KeyHint value="Esc" label="Back" />
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" justifyContent="space-around" width="100%">
      <KeyHint value="↑/↓" label="Move" />
      <KeyHint value="Enter" label="Select" />
      <KeyHint value="Esc" label="Back" />
      <KeyHint value="Q" label="Quit" />
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

function submitTextField(state: SetupWizardState, setState: React.Dispatch<React.SetStateAction<SetupWizardState>>): void {
  if (state.textField === "uri") {
    try {
      parseVlessUri(state.uri);
      setState({
        ...state,
        step: "traffic-scope",
        textField: null,
        message: null,
        selectedIndex: state.routingMode === "split" ? 0 : 1,
      });
    } catch (error) {
      setState({ ...state, message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const domains = parseListInput(state.domainInput);
  if (domains.length === 0) {
    setState({ ...state, message: "Enter at least one domain." });
    return;
  }

  setState({ ...state, domains, step: "preflight", textField: null, selectedIndex: 0, message: null });
}

function updateTextField(
  input: string,
  backspace: boolean,
  state: SetupWizardState,
  setState: React.Dispatch<React.SetStateAction<SetupWizardState>>,
): void {
  if (backspace) {
    if (state.textField === "uri") setState({ ...state, uri: state.uri.slice(0, -1) });
    else setState({ ...state, domainInput: state.domainInput.slice(0, -1) });
    return;
  }

  const printable = input.replace(/[^\x20-\x7e]/g, "");
  if (printable.length === 0) return;
  if (state.textField === "uri") setState({ ...state, uri: `${state.uri}${printable}` });
  else setState({ ...state, domainInput: `${state.domainInput}${printable}` });
}

function moveSetupBack(state: SetupWizardState, setState: React.Dispatch<React.SetStateAction<SetupWizardState>>): void {
  if (state.textField === "domains") {
    setState({ ...state, textField: null, message: null });
    return;
  }

  if (state.step === "connection") return;
  if (state.step === "traffic-scope") {
    setState({ ...state, step: "connection", textField: "uri", selectedIndex: 0, message: null });
    return;
  }
  if (state.step === "domains") {
    setState({ ...state, step: "traffic-scope", selectedIndex: state.routingMode === "split" ? 0 : 1, message: null });
    return;
  }
  if (state.step === "preflight") {
    setState({ ...state, step: "domains", selectedIndex: 0, message: null });
    return;
  }
  if (state.step === "verify") return;
}

async function writeConfigAndInstall(state: SetupWizardState, configPath: string, singboxConfigPath: string): Promise<SetupWizardState> {
  try {
    await writeSetupConfig(buildConfig(state), configPath, singboxConfigPath);
    const { exitCode, output } = await runInstallCommand(state.routingMode);
    const preflightOutput = exitCode === 0 ? await installSelectedPreflightWrappers(state.preflightCommands) : "";
    const installOutput = [output, preflightOutput].filter((value) => value.length > 0).join("\n");
    return {
      ...state,
      step: "verify",
      selectedIndex: 0,
      installed: exitCode === 0,
      installOutput,
      message: exitCode === 0 ? "Install complete." : `Install exited with code ${exitCode}. Config was still written.`,
    };
  } catch (error) {
    return {
      ...state,
      step: "verify",
      selectedIndex: 0,
      installed: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function installSelectedPreflightWrappers(commands: PreflightWrapperCommand[]): Promise<string> {
  if (commands.length === 0) return "";
  const results = await installPreflightWrappers(commands);
  return formatPreflightInstallResults(results);
}

function formatPreflightInstallResults(results: PreflightWrapperInstallResult[]): string {
  const lines = ["Preflight wrappers:"];
  for (const result of results) {
    lines.push(`${result.command}: ${result.status} - ${result.message}`);
  }
  return lines.join("\n");
}

function buildConfig(state: SetupWizardState): Config {
  return buildSetupConfig({
    uri: state.uri,
    domains: state.domains,
    tunnelInterfaceName: DEFAULT_SETUP_VALUES.tunnelInterfaceName,
    tunnelAddress: DEFAULT_SETUP_VALUES.tunnelAddress,
    dnsServers: DEFAULT_SETUP_VALUES.dnsServers,
    routingMode: state.routingMode,
  });
}

async function runInstallCommand(routingMode: RoutingMode): Promise<{ exitCode: number; output: string }> {
  restoreTerminalForExternalCommand();
  process.stdout.write("Root privileges required. Enter password if prompted.\n");
  const sudoValidation = Bun.spawn(["/usr/bin/sudo", "-v"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const sudoExitCode = await sudoValidation.exited;
  if (sudoExitCode !== 0) return { exitCode: sudoExitCode, output: "sudo authentication failed." };

  process.stdout.write("Installing vpnctl...\n");
  const proc = Bun.spawn(["/usr/bin/sudo", "-E", ...buildVpnctlInvocation(["__install", "--routing-mode", routingMode])], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([captureStream(proc.stdout), captureStream(proc.stderr), proc.exited]);
  return { exitCode, output: `${stdout}${stderr}`.trim() };
}

async function captureStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of stream) {
    output += decoder.decode(chunk, { stream: true });
  }

  output += decoder.decode();
  return output;
}

function isSetupWizardExitAction(value: unknown): value is SetupWizardExitAction {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const candidateKind = value.kind;
  return candidateKind === "install" || candidateKind === "finish" || candidateKind === "quit";
}
