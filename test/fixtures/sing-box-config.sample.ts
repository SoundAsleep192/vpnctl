import type { SingBoxConfig } from "../../src/core/singbox-config";

export const sampleConfig: SingBoxConfig = {
  log: {
    level: "warn",
    timestamp: true,
  },
  dns: {
    servers: [
      {
        tag: "proxy-dns",
        type: "https",
        server: "1.1.1.1",
        detour: "proxy",
      },
      {
        tag: "local-dns",
        type: "udp",
        server: "1.1.1.1",
      },
    ],
    rules: [
      {
        domain_suffix: [
          "anthropic.com",
          "claude.com",
          "claude.ai",
          "cursor.com",
          "cursor.sh",
          "cursorapi.com",
          "openai.com",
          "chatgpt.com",
          "oaiusercontent.com",
          "oaistatic.com",
        ],
        server: "proxy-dns",
      },
    ],
    strategy: "ipv4_only",
    final: "proxy-dns",
  },
  inbounds: [
    {
      type: "tun",
      tag: "tun-in",
      interface_name: "utun20",
      address: ["172.19.0.1/30"],
      auto_route: true,
      strict_route: true,
      stack: "system",
    },
    {
      type: "socks",
      tag: "socks-in",
      listen: "127.0.0.1",
      listen_port: 1080,
    },
    {
      type: "mixed",
      tag: "mixed-in",
      listen: "127.0.0.1",
      listen_port: 1081,
    },
  ],
  outbounds: [
    {
      type: "vless",
      tag: "proxy",
      server: "vpn.example.com",
      server_port: 443,
      uuid: "00000000-0000-4000-8000-000000000000",
      flow: "xtls-rprx-vision",
      network: "tcp",
      tls: {
        enabled: true,
        server_name: "example.com",
        utls: {
          enabled: true,
          fingerprint: "firefox",
        },
        reality: {
          enabled: true,
          public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          short_id: "0123456789abcdef",
        },
      },
    },
    {
      type: "direct",
      tag: "direct",
    },
  ],
  route: {
    rules: [
      {
        action: "sniff",
      },
      {
        protocol: "dns",
        action: "hijack-dns",
      },
      {
        domain_suffix: [
          "anthropic.com",
          "claude.com",
          "claude.ai",
          "cursor.com",
          "cursor.sh",
          "cursorapi.com",
          "openai.com",
          "chatgpt.com",
          "oaiusercontent.com",
          "oaistatic.com",
        ],
        outbound: "proxy",
      },
      {
        ip_is_private: true,
        outbound: "direct",
      },
    ],
    final: "proxy",
    auto_detect_interface: true,
    default_domain_resolver: {
      server: "local-dns",
    },
  },
};
