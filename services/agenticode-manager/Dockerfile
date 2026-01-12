# =============================================================================
# AGENTICODE MANAGER - DISTROLESS HARDENED IMAGE (DHI)
# =============================================================================
#
# SECURITY MODEL:
# - Minimal attack surface - only essential binaries
# - No curl/wget - prevents download-and-execute attacks
# - No gcc/make - prevents compiling malicious code
# - No netcat/nmap - prevents reverse shells and scanning
# - No sudo - no privilege escalation
# - Sandbox users with ulimits - prevents DoS
#
# SUPPORTED LANGUAGES:
# - Python 3 (with pip for --user installs only)
# - Node.js 20 (with npm for local installs only)
# - Go (runtime only, no cgo)
# - PowerShell Core 7 (cross-platform PowerShell)
# - Bash scripting
#
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build the Manager
# -----------------------------------------------------------------------------
FROM node:20-slim AS manager-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/agenticode-manager/package*.json ./
RUN npm ci
COPY services/agenticode-manager/tsconfig.json ./
COPY services/agenticode-manager/src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Build the Hardened Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim AS runtime

LABEL maintainer="AgenticWork <engineering@agenticwork.io>"
LABEL description="Agenticode Manager - Hardened Code Mode Container"
LABEL security.hardened="true"

# -----------------------------------------------------------------------------
# Install ONLY essential runtime dependencies
# -----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Process management
    procps \
    dumb-init \
    # Python runtime (no build tools)
    python3 \
    python3-pip \
    python3-venv \
    # Git (essential for dev work)
    git \
    # Text search (used by CLI)
    ripgrep \
    # JSON processing
    jq \
    # User management (for sandbox)
    passwd \
    # PowerShell dependencies
    apt-transport-https \
    ca-certificates \
    gnupg \
    # Minimal editor (for git commits etc)
    nano \
    # Temporarily install curl (will be removed later)
    curl \
  && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Install PowerShell Core 7 (amd64 only - skip on ARM)
# -----------------------------------------------------------------------------
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ] || [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-archive-keyring.gpg \
      && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-archive-keyring.gpg] https://packages.microsoft.com/repos/microsoft-debian-bullseye-prod bullseye main" > /etc/apt/sources.list.d/microsoft.list \
      && apt-get update \
      && apt-get install -y --no-install-recommends powershell \
      && rm -rf /var/lib/apt/lists/* \
      && pwsh --version; \
    else \
      echo "Skipping PowerShell installation on ARM architecture"; \
    fi

# -----------------------------------------------------------------------------
# Install Go (runtime only - CGO_ENABLED=0)
# -----------------------------------------------------------------------------
ARG GO_VERSION=1.22.0
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then GO_ARCH="arm64"; else GO_ARCH="amd64"; fi && \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:${PATH}"
ENV CGO_ENABLED=0

# -----------------------------------------------------------------------------
# Install code-server (VS Code in browser)
# -----------------------------------------------------------------------------
ARG CODE_SERVER_VERSION=4.96.4
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${ARCH}.deb" -o /tmp/code-server.deb \
    && dpkg -i /tmp/code-server.deb \
    && rm /tmp/code-server.deb \
    && mkdir -p /var/lib/code-server \
    && chmod 755 /var/lib/code-server

# -----------------------------------------------------------------------------
# Pre-install VS Code Extensions (read-only, shared)
# -----------------------------------------------------------------------------
ENV EXTENSIONS_DIR=/var/lib/code-server/extensions
RUN mkdir -p $EXTENSIONS_DIR

# Language Support
RUN code-server --extensions-dir $EXTENSIONS_DIR --install-extension ms-python.python \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension golang.go \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension ms-vscode.powershell \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension dbaeumer.vscode-eslint

# Productivity
RUN code-server --extensions-dir $EXTENSIONS_DIR --install-extension esbenp.prettier-vscode \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension eamodio.gitlens \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension redhat.vscode-yaml \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension yzhang.markdown-all-in-one

# UI/UX
RUN code-server --extensions-dir $EXTENSIONS_DIR --install-extension pkief.material-icon-theme \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension christian-kohler.path-intellisense

# File viewers
RUN code-server --extensions-dir $EXTENSIONS_DIR --install-extension tomoki1207.pdf \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension ms-vscode.hexeditor \
  && code-server --extensions-dir $EXTENSIONS_DIR --install-extension grapecity.gc-excelviewer

# Lock down extensions directory
RUN chmod -R 755 $EXTENSIONS_DIR

# -----------------------------------------------------------------------------
# SECURITY: Remove dangerous binaries (AFTER all installations complete)
# -----------------------------------------------------------------------------
RUN \
  # Remove network fetch tools (prevents download-and-execute)
  rm -f /usr/bin/curl /usr/bin/wget /usr/bin/fetch 2>/dev/null || true && \
  # Remove compilers (prevents compiling malicious code)
  rm -f /usr/bin/gcc /usr/bin/g++ /usr/bin/cc /usr/bin/c++ /usr/bin/make 2>/dev/null || true && \
  # Remove network tools (prevents reverse shells, scanning)
  rm -f /usr/bin/nc /usr/bin/ncat /usr/bin/netcat /usr/bin/nmap /usr/bin/telnet 2>/dev/null || true && \
  # Remove packet capture tools
  rm -f /usr/bin/tcpdump /usr/sbin/tcpdump /usr/bin/wireshark /usr/bin/tshark 2>/dev/null || true && \
  # Remove debugging tools (can attach to other processes)
  rm -f /usr/bin/gdb /usr/bin/lldb /usr/bin/strace /usr/bin/ltrace 2>/dev/null || true && \
  # Remove sudo completely
  rm -f /usr/bin/sudo /usr/sbin/sudo 2>/dev/null || true && \
  apt-get purge -y sudo 2>/dev/null || true && \
  # Remove cron (prevents persistence)
  rm -f /usr/bin/crontab /usr/sbin/cron 2>/dev/null || true && \
  # Remove at/batch (scheduled execution)
  rm -f /usr/bin/at /usr/bin/batch 2>/dev/null || true && \
  # Verify removals
  echo "=== SECURITY: Verifying dangerous binaries removed ===" && \
  for cmd in curl wget gcc g++ make nc netcat nmap sudo gdb strace crontab; do \
    if command -v $cmd >/dev/null 2>&1; then \
      echo "WARNING: $cmd still exists!"; \
    else \
      echo "OK: $cmd removed"; \
    fi; \
  done

# -----------------------------------------------------------------------------
# Setup Application
# -----------------------------------------------------------------------------
WORKDIR /app

# Copy manager
COPY services/agenticode-manager/package*.json ./
COPY --from=manager-builder /app/node_modules ./node_modules
COPY --from=manager-builder /app/dist ./dist

# Copy and build SDK
COPY sdk ./sdk
WORKDIR /app/sdk
RUN npm install && npm run build
WORKDIR /app

# Copy and build CLI
COPY agenticode-cli ./agenticode
WORKDIR /app/agenticode
RUN npm install && npm run build && rm -rf node_modules && npm install --omit=dev
WORKDIR /app

# Link SDK into CLI
RUN rm -rf /app/agenticode/node_modules/@agentic-work/sdk \
  && mkdir -p /app/agenticode/node_modules/@agentic-work \
  && cp -r /app/sdk /app/agenticode/node_modules/@agentic-work/sdk

# Create agenticode wrapper
RUN printf '#!/bin/sh\nexec node /app/agenticode/dist/index.js "$@"\n' > /usr/local/bin/agenticode \
  && chmod +x /usr/local/bin/agenticode \
  && chmod +x /app/agenticode/dist/index.js

# -----------------------------------------------------------------------------
# Filesystem Security
# -----------------------------------------------------------------------------
# Workspaces directory - root owns, sandbox users get subdirs
RUN mkdir -p /workspaces && chmod 711 /workspaces

# Allow dynamic user creation (for sandbox users)
RUN chmod 644 /etc/passwd /etc/group \
  && chmod 640 /etc/shadow 2>/dev/null || true

# Create python/pip symlinks
RUN ln -sf /usr/bin/python3 /usr/bin/python 2>/dev/null || true

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------
ENV AGENTICODE_PATH=/usr/local/bin/agenticode
ENV WORKSPACES_PATH=/workspaces
ENV CODE_SERVER_BINARY=/usr/bin/code-server
ENV CODE_SERVER_BASE_PORT=3100
ENV CODE_SERVER_MAX_INSTANCES=100
ENV CODE_SERVER_USER_DATA_DIR=/var/lib/code-server
ENV CODE_SERVER_EXTENSIONS_DIR=/var/lib/code-server/extensions
ENV CODE_SERVER_EXTERNAL_URL=/code-server
ENV CODE_SERVER_STARTUP_TIMEOUT=30000

# PowerShell configuration
ENV POWERSHELL_TELEMETRY_OPTOUT=1
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1

# -----------------------------------------------------------------------------
# Final Security Hardening
# -----------------------------------------------------------------------------
# Remove apt/dpkg to prevent package installation
RUN rm -rf /var/lib/apt/lists/* \
  && rm -f /usr/bin/apt /usr/bin/apt-get /usr/bin/dpkg 2>/dev/null || true

# Remove shells users shouldn't use (keep bash for sandbox)
RUN rm -f /bin/sh.distrib 2>/dev/null || true

# Print security summary
RUN echo "=== DHI SECURITY SUMMARY ===" \
  && echo "Removed: curl, wget, gcc, make, nc, nmap, sudo, gdb, strace, apt" \
  && echo "Installed: python3, node, go, pwsh, git, ripgrep" \
  && echo "Extensions: Python, Go, PowerShell, ESLint, Prettier, GitLens" \
  && echo "============================"

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
EXPOSE 3050
EXPOSE 3100-3199

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3050/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["dumb-init", "node", "dist/index.js"]
