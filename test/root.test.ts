import { describe, expect, test } from "bun:test";
import { buildSudoReexecArgv } from "../src/cli/root";

describe("buildSudoReexecArgv", () => {
  test("compiled binary drops the Bun virtual-fs entry point so the real command survives the sudo re-exec", () => {
    const argv = buildSudoReexecArgv({
      execPath: "/Users/me/.local/bin/vpnctl",
      argv: ["/Users/me/.local/bin/vpnctl", "/$bunfs/root/vpnctl", "up"],
      compiled: true,
    });

    expect(argv).toEqual(["sudo", "-E", "/Users/me/.local/bin/vpnctl", "up"]);
  });

  test("compiled binary preserves trailing flags after the subcommand", () => {
    const argv = buildSudoReexecArgv({
      execPath: "/Users/me/.local/bin/vpnctl",
      argv: ["/Users/me/.local/bin/vpnctl", "/$bunfs/root/vpnctl", "logs", "--follow"],
      compiled: true,
    });

    expect(argv).toEqual(["sudo", "-E", "/Users/me/.local/bin/vpnctl", "logs", "--follow"]);
  });

  test("source run via bun forwards the script path and args unchanged", () => {
    const argv = buildSudoReexecArgv({
      execPath: "/opt/homebrew/bin/bun",
      argv: ["/opt/homebrew/bin/bun", "/repo/src/cli/index.ts", "__install"],
      compiled: false,
    });

    expect(argv).toEqual(["sudo", "-E", "/opt/homebrew/bin/bun", "/repo/src/cli/index.ts", "__install"]);
  });
});
