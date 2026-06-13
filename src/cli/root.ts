export function requireRoot(): void {
  if (process.getuid?.() === 0) return;

  console.log("Root privileges required — re-running with sudo...");
  const result = Bun.spawnSync(["sudo", "-E", process.execPath, ...process.argv.slice(1)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(result.exitCode);
}
