import type { UiLanguage } from "../../core/config";

export interface DashboardTexts {
  aiDomains: string;
  allTraffic: string;
  back: string;
  check: string;
  checkDetail: string;
  closeDashboard: string;
  commandFinished: string;
  configure: string;
  connection: string;
  connectionDetail: string;
  addDnsServer: string;
  addDomain: string;
  configured: string;
  currentRouting: string;
  dashboard: string;
  diagnostics: string;
  dns: string;
  dnsDetail: string;
  doctor: string;
  doctorDetail: string;
  domains: string;
  domainsDetail: string;
  editDetail: string;
  english: string;
  language: string;
  languageDetail: string;
  leakGuard: string;
  logs: string;
  monitorLog: string;
  monitorLogDetail: string;
  move: string;
  noWorkspaceDetail: string;
  openShell: string;
  openShellDetail: string;
  openRawConfig: string;
  pasteVlessUri: string;
  protectedWorkspace: string;
  otherVpn: string;
  replaceConnection: string;
  removeDnsServer: string;
  removeDomain: string;
  quit: string;
  russian: string;
  saving: string;
  scopeAllTrafficDetail: string;
  scopeAiOnlyDetail: string;
  scroll: string;
  select: string;
  startClaude: string;
  startClaudeDetail: string;
  startCodex: string;
  startCodexDetail: string;
  status: string;
  stopWorkspace: string;
  stopWorkspaceDetail: string;
  trafficScope: string;
  useDefaultDomains: string;
  viewDnsServers: string;
  viewDomains: string;
  tunnelStartingMessage: string;
  tunnel: string;
  tunnelLog: string;
  tunnelLogDetail: string;
  update: string;
  updateDetail: string;
  viewLogs: string;
  workspaces: string;
}

export const DASHBOARD_TEXTS: Record<UiLanguage, DashboardTexts> = {
  en: {
    aiDomains: "Protected domains",
    allTraffic: "All traffic",
    back: "Back",
    check: "Check endpoints",
    checkDetail: "Probe protected domains",
    closeDashboard: "No action needed. You can close the dashboard; protection keeps running.",
    commandFinished: "Command finished.",
    configure: "Configure",
    connection: "Connection",
    connectionDetail: "edit >",
    addDnsServer: "Add DNS server",
    addDomain: "Add domain",
    configured: "configured",
    currentRouting: "Current routing",
    dashboard: "Dashboard",
    diagnostics: "Diagnostics",
    dns: "DNS servers",
    dnsDetail: "edit >",
    doctor: "Doctor",
    doctorDetail: "Full local diagnosis",
    domains: "Protected domains",
    domainsDetail: "edit >",
    editDetail: "edit >",
    english: "English",
    language: "Language",
    languageDetail: "choose >",
    leakGuard: "Leak guard",
    logs: "Logs",
    monitorLog: "Monitor log",
    monitorLogDetail: "Daemon state and enforcement",
    move: "Move",
    noWorkspaceDetail: "No sandbox running",
    openShell: "Open shell",
    openShellDetail: "Existing sandbox",
    openRawConfig: "Open raw config",
    pasteVlessUri: "Paste VLESS URI",
    protectedWorkspace: "Protected Workspace",
    otherVpn: "VPN conflict",
    replaceConnection: "Replace VLESS URI",
    removeDnsServer: "Remove DNS server",
    removeDomain: "Remove domain",
    quit: "Quit",
    russian: "Русский",
    saving: "Saving...",
    scopeAllTrafficDetail: "All non-private traffic uses the VPN tunnel.",
    scopeAiOnlyDetail: "Only protected domains use the VPN. Other traffic stays direct.",
    scroll: "Scroll",
    select: "Select",
    startClaude: "Start Claude workspace",
    startClaudeDetail: "New sandbox",
    startCodex: "Start Codex workspace",
    startCodexDetail: "New sandbox",
    status: "Status",
    stopWorkspace: "Stop workspace",
    stopWorkspaceDetail: "Stop current sandbox",
    trafficScope: "Traffic scope",
    useDefaultDomains: "Use default domains",
    viewDnsServers: "View DNS servers",
    viewDomains: "View domains",
    tunnelStartingMessage: "Tunnel starting... Protected domains stay blocked until it connects.",
    tunnel: "Tunnel",
    tunnelLog: "Tunnel log",
    tunnelLogDetail: "sing-box tunnel process",
    update: "Update",
    updateDetail: "Install latest release",
    viewLogs: "Open one focused log at a time.",
    workspaces: "Workspaces",
  },
  ru: {
    aiDomains: "Защищенные домены",
    allTraffic: "Весь трафик",
    back: "Назад",
    check: "Проверить доступ",
    checkDetail: "Проверка защищенных доменов",
    closeDashboard: "Действия не нужны. Можно закрыть панель; защита продолжит работать.",
    commandFinished: "Команда завершена.",
    configure: "Настройки",
    connection: "Подключение",
    connectionDetail: "изменить >",
    addDnsServer: "Добавить DNS-сервер",
    addDomain: "Добавить домен",
    configured: "настроено",
    currentRouting: "Текущая маршрутизация",
    dashboard: "Панель",
    diagnostics: "Диагностика",
    dns: "DNS-серверы",
    dnsDetail: "изменить >",
    doctor: "Проверка системы",
    doctorDetail: "Полная локальная диагностика",
    domains: "Защищенные домены",
    domainsDetail: "изменить >",
    editDetail: "изменить >",
    english: "English",
    language: "Язык",
    languageDetail: "выбрать >",
    leakGuard: "Защита от утечек",
    logs: "Логи",
    monitorLog: "Лог монитора",
    monitorLogDetail: "Состояние демона и защиты",
    move: "Навигация",
    noWorkspaceDetail: "Sandbox не запущен",
    openShell: "Открыть shell",
    openShellDetail: "Текущий sandbox",
    openRawConfig: "Открыть raw config",
    pasteVlessUri: "Вставьте VLESS URI",
    protectedWorkspace: "Защищенная среда",
    otherVpn: "Конфликт VPN",
    replaceConnection: "Заменить VLESS URI",
    removeDnsServer: "Удалить DNS-сервер",
    removeDomain: "Удалить домен",
    quit: "Выход",
    russian: "Русский",
    saving: "Сохранение...",
    scopeAllTrafficDetail: "Весь непубличный трафик идет через VPN-туннель.",
    scopeAiOnlyDetail: "Только защищенные домены идут через VPN. Остальной трафик идет напрямую.",
    scroll: "Прокрутка",
    select: "Выбрать",
    startClaude: "Запустить Claude",
    startClaudeDetail: "Новый sandbox",
    startCodex: "Запустить Codex",
    startCodexDetail: "Новый sandbox",
    status: "Статус",
    stopWorkspace: "Остановить среду",
    stopWorkspaceDetail: "Остановить sandbox",
    trafficScope: "Охват трафика",
    useDefaultDomains: "Вернуть домены по умолчанию",
    viewDnsServers: "Показать DNS-серверы",
    viewDomains: "Показать домены",
    tunnelStartingMessage: "Туннель запускается... защищенные домены заблокированы до подключения.",
    tunnel: "Туннель",
    tunnelLog: "Лог туннеля",
    tunnelLogDetail: "Процесс sing-box",
    update: "Обновить",
    updateDetail: "Установить свежий релиз",
    viewLogs: "Открывайте один конкретный лог за раз.",
    workspaces: "Среды",
  },
};
