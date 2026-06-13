import { describe, expect, test } from "bun:test";
import { AUDIT_AGENT_INTERVAL_SEC, buildAuditPlist } from "../src/cli/commands/audit";
import { LAUNCHD_LABEL_AUDIT } from "../src/core/paths";

describe("buildAuditPlist", () => {
  test("runs `vpnctl audit --log` on a StartInterval, without RunAtLoad/KeepAlive", () => {
    const plist = buildAuditPlist("/Users/nisakhanov/.bun/bin/bun", "/repo/bin/vpnctl.ts");

    expect(plist).toEqual({
      label: LAUNCHD_LABEL_AUDIT,
      programArguments: ["/Users/nisakhanov/.bun/bin/bun", "run", "/repo/bin/vpnctl.ts", "audit", "--log"],
      runAtLoad: false,
      keepAlive: false,
      startIntervalSec: AUDIT_AGENT_INTERVAL_SEC,
      stdoutPath: "/dev/null",
      stderrPath: "/dev/null",
    });
  });
});
