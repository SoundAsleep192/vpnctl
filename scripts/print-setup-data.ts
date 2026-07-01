import { loadConfig } from "../src/core/config";
import { CONFIG_FILE } from "../src/core/paths";
import type { Config } from "../src/core/config";

function buildVlessUri(config: Config): string {
  const outbound = config.outbound;
  const params = new URLSearchParams();
  params.set("encryption", "none");
  params.set("security", "reality");
  params.set("sni", outbound.tls.server_name);
  params.set("fp", outbound.tls.utls.fingerprint);
  params.set("pbk", outbound.tls.reality.public_key);
  params.set("sid", outbound.tls.reality.short_id);
  if (outbound.network !== undefined) params.set("type", outbound.network);
  if (outbound.flow !== undefined) params.set("flow", outbound.flow);

  const authority = `${encodeURIComponent(outbound.uuid)}@${outbound.server}:${outbound.server_port}`;
  const fragment = outbound.tag.length === 0 ? "" : `#${encodeURIComponent(outbound.tag)}`;
  return `vless://${authority}?${params.toString()}${fragment}`;
}

function formatList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

const configPath = process.argv[2] ?? CONFIG_FILE;
const config = await loadConfig(configPath);

console.log("vpnctl fresh setup data");
console.log("");
console.log("VLESS+Reality URI:");
console.log(buildVlessUri(config));
console.log("");
console.log(`Traffic scope: ${config.routing.mode === "full" ? "all traffic" : "protected domains only"}`);
console.log("");
console.log("Protected domains:");
console.log(formatList(config.domains));
console.log("");
console.log("DNS servers:");
console.log(formatList(config.dns.servers));
