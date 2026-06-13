import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { GENERATED_SINGBOX_CONFIG, TUNNEL_PID_FILE } from "../core/paths";

function log(message: string): void {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

function parseArgs(argv: string[]): { singBoxPath: string; configPath: string } {
  let singBoxPath: string | undefined;
  let configPath = GENERATED_SINGBOX_CONFIG;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sing-box") singBoxPath = argv[++i];
    else if (arg === "--config") configPath = argv[++i] ?? configPath;
  }

  if (singBoxPath === undefined) {
    throw new Error("missing required --sing-box <path> argument");
  }

  return { singBoxPath, configPath };
}

async function main(): Promise<void> {
  const { singBoxPath, configPath } = parseArgs(process.argv.slice(2));

  log(`starting ${singBoxPath} run -c ${configPath}`);

  const child = Bun.spawn([singBoxPath, "run", "-c", configPath], {
    stdout: "inherit",
    stderr: "inherit",
  });

  await mkdir(path.dirname(TUNNEL_PID_FILE), { recursive: true });
  await Bun.write(TUNNEL_PID_FILE, `${child.pid}\n`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  const exitCode = await child.exited;

  await rm(TUNNEL_PID_FILE, { force: true });
  log(`sing-box exited with code ${exitCode}`);
  process.exit(stopping ? 0 : exitCode);
}

if (import.meta.main) {
  await main();
}
