import { MONITOR_LOG_FILE, TUNNEL_LOG_FILE } from "../../core/paths";

const TAIL_BIN = "/usr/bin/tail";
const DEFAULT_TAIL_LINES = 100;

export interface LogsOptions {
  monitor?: boolean;
  tunnel?: boolean;
  follow?: boolean;
  lines?: number;
}

export function resolveLogFiles(options: LogsOptions): string[] {
  if (options.monitor && !options.tunnel) return [MONITOR_LOG_FILE];
  if (options.tunnel && !options.monitor) return [TUNNEL_LOG_FILE];
  return [MONITOR_LOG_FILE, TUNNEL_LOG_FILE];
}

async function printTail(filePath: string, lines: number): Promise<void> {
  console.log(`==> ${filePath} <==`);

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    console.log("(not found)");
    return;
  }

  const content = await file.text();
  const split = content.split("\n");
  if (split.length > 0 && split[split.length - 1] === "") split.pop();

  console.log(split.slice(-lines).join("\n"));
}

export async function runLogs(options: LogsOptions = {}): Promise<void> {
  const files = resolveLogFiles(options);

  if (options.follow) {
    const proc = Bun.spawn([TAIL_BIN, "-f", ...files], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.exit(await proc.exited);
  }

  const lines = options.lines ?? DEFAULT_TAIL_LINES;
  for (const [index, file] of files.entries()) {
    if (index > 0) console.log("");
    await printTail(file, lines);
  }
}
