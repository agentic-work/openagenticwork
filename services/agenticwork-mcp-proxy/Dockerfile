FROM python:3.11-slim

ARG SRC_PATH=services/agenticwork-mcp-proxy

WORKDIR /app

# Install system dependencies including Node.js for MCP servers
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    wget \
    nodejs \
    npm \
    pipx \
    ca-certificates \
    lsb-release \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Note: Cloud CLI tools (Azure, AWS, kubectl, helm) removed in open source version
# Only web and admin MCPs are enabled by default

# Install global Node.js dependencies for MCP servers
RUN npm install -g @modelcontextprotocol/server-sequential-thinking

# Install MCP Inspector for visual testing and debugging
RUN npm install -g @modelcontextprotocol/inspector

RUN pipx install uv && \
    pipx ensurepath && \
    cp /root/.local/bin/uvx /usr/local/bin/uvx && \
    cp /root/.local/bin/uv /usr/local/bin/uv && \
    chmod +x /usr/local/bin/uvx /usr/local/bin/uv && \
    uvx --version

# Install mcp-server-fetch globally using uvx
# This ensures fetch MCP is available and properly configured
RUN uvx --with mcp-server-fetch mcp-server-fetch --version || echo "Fetch MCP server cached"

# Pre-install AWS MCP servers globally
RUN uvx --with awslabs.aws-api-mcp-server@latest --version || echo "AWS API MCP server cached"
RUN uvx --with awslabs.aws-knowledge-mcp-server@latest --version || echo "AWS Knowledge MCP server cached"

# Copy and install Python dependencies
COPY ${SRC_PATH}/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY ${SRC_PATH}/src/ ./src/
COPY ${SRC_PATH}/.env.example .env

# Copy and build all MCP servers from services/mcps
COPY services/mcps/ /app/mcp-servers/

# Build Node.js MCP servers with Prisma checksum bypass
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
# AWP Memory MCP - DISABLED (redundant - pipeline memory.stage.ts already does Milvus search)
# RUN cd /app/mcp-servers/awp-memory-mcp && npm install && npm run build && ls -la dist/
# AWC Formatting MCP - DISABLED (redundant - use system prompts for formatting)
# RUN cd /app/mcp-servers/awc-formatting-mcp && npm install && npm run build

# Build Python MCP servers (Open Source version - minimal set)

# Install AWP Admin MCP server dependencies (Platform-level admin control)
RUN cd /app/mcp-servers/awp-admin-mcp && pip install --no-cache-dir -r requirements.txt

# Install AWP Web MCP server dependencies (Intelligent web browsing and research)
RUN cd /app/mcp-servers/awp-web-mcp && pip install --no-cache-dir -r requirements.txt

# Install AWP AgenticWork CLI MCP server dependencies (Controlled agentic workflows)
RUN cd /app/mcp-servers/awp-agenticwork-cli-mcp && pip install --no-cache-dir -r requirements.txt

# Note: Cloud MCPs (Azure, AWS, GCP, K8s, ServiceNow, Flowise) removed in open source version

# Create non-root user and change ownership AFTER building
# RUN useradd -m -u 1000 mcpuser && chown -R mcpuser:mcpuser /app
# USER mcpuser

EXPOSE 8080

CMD ["python", "src/main.py"]