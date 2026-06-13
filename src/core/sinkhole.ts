import type { Exec } from "./exec";
import { HOSTS_BACKUP_FILE, HOSTS_FILE, HOSTS_MARKER_BEGIN, HOSTS_MARKER_END } from "./paths";

const SINK_V4 = "0.0.0.0";
const SINK_V6 = "::";

export function computeHosts(currentHosts: string, domains: string[], sinkholed: boolean): { content: string; changed: boolean } {
  const kept: string[] = [];
  let skipping = false;
  for (const line of currentHosts.split("\n")) {
    if (line === HOSTS_MARKER_BEGIN) {
      skipping = true;
      continue;
    }
    if (line === HOSTS_MARKER_END) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }

  const base = kept.join("\n").replace(/\n+$/, "\n");

  let content = base;
  if (sinkholed) {
    const block = [
      "",
      HOSTS_MARKER_BEGIN,
      ...domains.flatMap((domain) => [`${SINK_V4} ${domain}`, `${SINK_V6} ${domain}`]),
      HOSTS_MARKER_END,
      "",
    ].join("\n");
    content = base + block;
  }

  return { content, changed: content !== currentHosts };
}

export async function applyHosts(exec: Exec, content: string): Promise<void> {
  const current = await Bun.file(HOSTS_FILE).text();
  await Bun.write(HOSTS_BACKUP_FILE, current);
  await Bun.write(HOSTS_FILE, content);
  await exec("/usr/bin/dscacheutil", ["-flushcache"]);
  await exec("/usr/bin/killall", ["-HUP", "mDNSResponder"]);
}
