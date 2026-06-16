import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

export const CONFIG_DIR = path.join(HOME, ".config", "vpnctl");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const GENERATED_SINGBOX_CONFIG = path.join(CONFIG_DIR, "sing-box.json");

export const ROOT_STATE_DIR = "/Library/Application Support/vpnctl";
export const ROOT_BIN_DIR = path.join(ROOT_STATE_DIR, "bin");
export const ROOT_CACHE_DIR = path.join(ROOT_STATE_DIR, "cache");
export const CACHE_V4_FILE = path.join(ROOT_CACHE_DIR, "last-good-v4.txt");
export const CACHE_V6_FILE = path.join(ROOT_CACHE_DIR, "last-good-v6.txt");
export const UPDATE_CHECK_CACHE_FILE = path.join(ROOT_CACHE_DIR, "update-check.json");
export const TUNNEL_PID_FILE = path.join(ROOT_STATE_DIR, "tunnel.pid");

export const LOG_DIR = "/Library/Logs/vpnctl";
export const MONITOR_LOG_FILE = path.join(LOG_DIR, "monitor.log");
export const TUNNEL_LOG_FILE = path.join(LOG_DIR, "tunnel.log");
export const TRAY_LOG_FILE = path.join(LOG_DIR, "tray.log");

// Written world-readable by the root monitor daemon so the unprivileged tray
// agent can read current state without sudo.
export const STATE_FILE = path.join(LOG_DIR, "state.json");

export const PF_ANCHOR_NAME = "vpnctl";
export const PF_TABLE_V4 = "vpnctl_v4";
export const PF_TABLE_V6 = "vpnctl_v6";
export const PF_ANCHOR_FILE = "/etc/pf.anchors/vpnctl";
export const PF_CONF_FILE = "/etc/pf.conf";
export const PF_CONF_BACKUP_FILE = "/etc/pf.conf.vpnctl.bak";
export const PF_CONF_MARKER_BEGIN = "# === BEGIN VPNCTL ===";
export const PF_CONF_MARKER_END = "# === END VPNCTL ===";

export const HOSTS_FILE = "/etc/hosts";
export const HOSTS_BACKUP_FILE = "/etc/hosts.vpnctl.bak";
export const HOSTS_MARKER_BEGIN = "# === BEGIN VPNCTL SINKHOLE ===";
export const HOSTS_MARKER_END = "# === END VPNCTL SINKHOLE ===";

export const LAUNCH_DAEMONS_DIR = "/Library/LaunchDaemons";
export const LAUNCHD_LABEL_MONITOR = "com.vpnctl.monitor";
export const LAUNCHD_LABEL_TUNNEL = "com.vpnctl.tunnel";
export const LAUNCHD_PLIST_MONITOR = path.join(LAUNCH_DAEMONS_DIR, `${LAUNCHD_LABEL_MONITOR}.plist`);
export const LAUNCHD_PLIST_TUNNEL = path.join(LAUNCH_DAEMONS_DIR, `${LAUNCHD_LABEL_TUNNEL}.plist`);

export const AUDIT_LOG_FILE = path.join(CONFIG_DIR, "audit.log");
export const LAUNCHD_LABEL_AUDIT = "com.vpnctl.audit";
export const AUDIT_PLIST_FILE = path.join(HOME, "Library", "LaunchAgents", `${LAUNCHD_LABEL_AUDIT}.plist`);

export const LAUNCHD_LABEL_TRAY = "com.vpnctl.tray";
export const TRAY_PLIST_FILE = path.join(HOME, "Library", "LaunchAgents", `${LAUNCHD_LABEL_TRAY}.plist`);

export const DEFAULT_TUN_INTERFACE_NAME = "utun20";
export const DEFAULT_TUN_ADDRESS = "172.19.0.1/30";
export const DEFAULT_DNS_SERVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];
export const DEFAULT_AUDIT_PROCESS_NAME_PATTERNS = ["Code", "Cursor", "Electron", "Copilot", "Visual Studio", "VSCodium"];
