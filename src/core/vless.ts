export interface RealityOutbound {
  type: "vless";
  tag: string;
  server: string;
  server_port: number;
  uuid: string;
  flow?: string;
  network?: string;
  tls: {
    enabled: true;
    server_name: string;
    utls: { enabled: true; fingerprint: string };
    reality: { enabled: true; public_key: string; short_id: string };
  };
}

export function parseVlessUri(uri: string): RealityOutbound {
  if (!uri.startsWith("vless://")) {
    throw new Error(`not a vless:// URI: ${uri}`);
  }

  let url: URL;
  try {
    url = new URL(uri);
  } catch (error) {
    throw new Error(`malformed vless:// URI: ${(error as Error).message}`, { cause: error });
  }

  const uuid = decodeURIComponent(url.username);
  const server = url.hostname;
  const portString = url.port;
  if (!uuid) throw new Error("vless URI is missing the UUID (user info before @)");
  if (!server) throw new Error("vless URI is missing the server host");
  if (!portString) throw new Error("vless URI is missing the server port");

  const params = url.searchParams;

  const encryption = params.get("encryption");
  if (encryption !== null && encryption !== "none") {
    throw new Error(`unsupported encryption "${encryption}" — VLESS only supports encryption=none`);
  }

  const security = params.get("security");
  if (security !== "reality") {
    throw new Error(`unsupported security "${security ?? "(none)"}" — vpnctl v1 only supports VLESS+Reality (security=reality)`);
  }

  const sni = params.get("sni");
  const fingerprint = params.get("fp");
  const publicKey = params.get("pbk");
  const shortId = params.get("sid");
  if (!sni) throw new Error("vless+reality URI is missing sni");
  if (!fingerprint) throw new Error("vless+reality URI is missing fp (uTLS fingerprint)");
  if (!publicKey) throw new Error("vless+reality URI is missing pbk (Reality public key)");
  if (!shortId) throw new Error("vless+reality URI is missing sid (Reality short id)");

  const flow = params.get("flow");
  const network = params.get("type");
  const tag = url.hash ? decodeURIComponent(url.hash.slice(1)) : server;

  return {
    type: "vless",
    tag,
    server,
    server_port: Number(portString),
    uuid,
    flow: flow ?? undefined,
    network: network ?? undefined,
    tls: {
      enabled: true,
      server_name: sni,
      utls: { enabled: true, fingerprint },
      reality: { enabled: true, public_key: publicKey, short_id: shortId },
    },
  };
}
