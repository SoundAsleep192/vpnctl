import { isCompiledBinary } from "../core/runtime";

export function buildSudoReexecArgv(opts: { execPath: string; argv: string[]; compiled: boolean }): string[] {
  const forwarded = opts.compiled ? opts.argv.slice(2) : opts.argv.slice(1);
  return ["sudo", "-E", opts.execPath, ...forwarded];
}

export function requireRoot(): void {
  if (process.getuid?.() === 0) return;

  console.log("Root privileges required — re-running with sudo...");
  const result = Bun.spawnSync(buildSudoReexecArgv({ execPath: process.execPath, argv: process.argv, compiled: isCompiledBinary() }), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(result.exitCode);
}
