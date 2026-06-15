const KILLSWITCH_NOTICE_EXAMPLE_DOMAIN_COUNT = 3;

export function formatKillswitchNotice(domains: string[], tunnelUp: boolean): string | null {
  if (tunnelUp || domains.length === 0) return null;

  const examples = domains.slice(0, KILLSWITCH_NOTICE_EXAMPLE_DOMAIN_COUNT).join(", ");
  const remaining = domains.length - KILLSWITCH_NOTICE_EXAMPLE_DOMAIN_COUNT;
  const list = remaining > 0 ? `${examples}, and ${remaining} more` : examples;

  return [
    `killswitch protection: the VPN tunnel is down, so traffic to your configured domains (${list}) is being blocked.`,
    "Run `sudo vpnctl up` to restore the tunnel.",
  ].join("\n");
}
