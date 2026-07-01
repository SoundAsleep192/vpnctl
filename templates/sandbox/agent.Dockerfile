FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

USER root
RUN apt-get update && apt-get install -y --no-install-recommends dnsutils iproute2 iptables tzdata && rm -rf /var/lib/apt/lists/*
RUN npm install -g {{CODEX_NPM_PACKAGE}}
RUN set -eux; \
  if ! getent group {{SANDBOX_DEVELOPER_USER}} >/dev/null; then groupadd -g {{SANDBOX_DEVELOPER_UID}} {{SANDBOX_DEVELOPER_USER}}; fi; \
  if ! id -u {{SANDBOX_DEVELOPER_USER}} >/dev/null 2>&1; then useradd -m -u {{SANDBOX_DEVELOPER_UID}} -g {{SANDBOX_DEVELOPER_USER}} -s /bin/bash {{SANDBOX_DEVELOPER_USER}}; fi; \
  mkdir -p {{SANDBOX_WORKSPACE_ROOT}} {{SANDBOX_DEVELOPER_HOME}}/.vscode-server/extensions; \
  chown -R {{SANDBOX_DEVELOPER_USER}}:{{SANDBOX_DEVELOPER_USER}} {{SANDBOX_WORKSPACE_ROOT}} {{SANDBOX_DEVELOPER_HOME}}

USER {{SANDBOX_DEVELOPER_USER}}
RUN curl -fsSL {{CLAUDE_INSTALL_SCRIPT_URL}} | bash
ENV PATH="{{SANDBOX_DEVELOPER_HOME}}/.local/bin:${PATH}"
WORKDIR {{SANDBOX_WORKSPACE_ROOT}}
CMD ["sleep", "infinity"]
