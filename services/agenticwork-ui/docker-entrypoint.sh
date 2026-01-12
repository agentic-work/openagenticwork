#!/bin/sh

# Copyright (c) 2026 Agenticwork LLC
# For all inquiries, please contact:
# Agenticwork LLC
# hello@agenticwork.io

# Set default values if not provided
export API_HOST="${API_HOST:-localhost}"
export API_PORT="${API_PORT:-8000}"
export MCP_HOST="${MCP_HOST:-localhost}"
export MCP_PORT="${MCP_PORT:-3001}"
export DOCS_HOST="${DOCS_HOST:-localhost}"
export DOCS_PORT="${DOCS_PORT:-80}"

echo "========================================="
echo "AgenticWork UI Container Starting"
echo "========================================="
echo "API Backend: http://${API_HOST}:${API_PORT}"
echo "MCP Backend: http://${MCP_HOST}:${MCP_PORT}"
echo "Docs Backend: http://${DOCS_HOST}:${DOCS_PORT}"
echo "========================================="

# Replace runtime config values in config.js
CONFIG_FILE="/usr/share/nginx/html/config.js"
if [ -f "$CONFIG_FILE" ]; then
    echo "Updating runtime configuration..."

    # Map environment variables to config values
    # Use VITE_API_URL if set, otherwise use relative /api path (nginx will proxy to backend)
    API_URL_VALUE="${VITE_API_URL:-/api}"

    # Azure AD configuration - use AZURE_CLIENT_ID, fallback to VITE_AZURE_CLIENT_ID
    AAD_CLIENT_ID="${VITE_AAD_CLIENT_ID:-${AZURE_CLIENT_ID:-${VITE_AZURE_CLIENT_ID:-}}}"
    AZURE_TENANT="${VITE_AZURE_TENANT_ID:-${AZURE_TENANT_ID:-}}"

    # Construct AAD authority URL if tenant is provided
    if [ -n "$AZURE_TENANT" ] && [ "$AZURE_TENANT" != "disabled-not-using-azure-ad" ]; then
        AAD_AUTHORITY="https://login.microsoftonline.com/${AZURE_TENANT}"
    else
        AAD_AUTHORITY="${VITE_AAD_AUTHORITY:-}"
    fi

    sed -i "s|VITE_API_URL_PLACEHOLDER|${API_URL_VALUE}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AAD_CLIENT_ID_PLACEHOLDER|${AAD_CLIENT_ID}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AAD_AUTHORITY_PLACEHOLDER|${AAD_AUTHORITY}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AAD_REDIRECT_URI_PLACEHOLDER|${VITE_AAD_REDIRECT_URI:-${AZURE_REDIRECT_URI:-/auth/callback}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AZURE_CLIENT_ID_PLACEHOLDER|${AAD_CLIENT_ID}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AZURE_TENANT_ID_PLACEHOLDER|${AZURE_TENANT}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AZURE_AD_ADMIN_GROUP_PLACEHOLDER|${VITE_AZURE_AD_ADMIN_GROUP:-${AZURE_AD_ADMIN_GROUP:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AZURE_AD_API_SCOPE_PLACEHOLDER|${VITE_AZURE_AD_API_SCOPE:-${AZURE_AD_API_SCOPE:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AZURE_AD_AUTHORIZED_GROUPS_PLACEHOLDER|${VITE_AZURE_AD_AUTHORIZED_GROUPS:-${AZURE_AD_AUTHORIZED_GROUPS:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_API_KEY_PLACEHOLDER|${VITE_API_KEY:-${API_KEY:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_FRONTEND_SECRET_PLACEHOLDER|${VITE_FRONTEND_SECRET:-${FRONTEND_SECRET:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_SIGNING_SECRET_PLACEHOLDER|${VITE_SIGNING_SECRET:-${SIGNING_SECRET:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AUTH_MODE_PLACEHOLDER|${VITE_AUTH_MODE:-${AUTH_MODE:-production}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_MAINTENANCE_MODE_PLACEHOLDER|${VITE_MAINTENANCE_MODE:-${MAINTENANCE_MODE:-false}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_DEV_LOGIN_PAGE_PLACEHOLDER|${VITE_DEV_LOGIN_PAGE:-${DEV_LOGIN_PAGE:-false}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_FLOWISE_URL_PLACEHOLDER|${VITE_FLOWISE_URL:-${FLOWISE_URL:-http://localhost:3000}}|g" "$CONFIG_FILE"

    # Auth provider configuration - controls which login buttons are shown
    # VITE_AUTH_PROVIDER: 'google' = Google only, 'azure-ad' = Microsoft only, 'all' = show all enabled
    # Individual toggles: 'true' = show button, 'false' = hide button
    sed -i "s|VITE_AUTH_PROVIDER_PLACEHOLDER|${VITE_AUTH_PROVIDER:-${AUTH_PROVIDER:-all}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_MICROSOFT_LOGIN_ENABLED_PLACEHOLDER|${VITE_MICROSOFT_LOGIN_ENABLED:-${MICROSOFT_LOGIN_ENABLED:-true}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_GOOGLE_LOGIN_ENABLED_PLACEHOLDER|${VITE_GOOGLE_LOGIN_ENABLED:-${GOOGLE_LOGIN_ENABLED:-true}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_LOCAL_LOGIN_ENABLED_PLACEHOLDER|${VITE_LOCAL_LOGIN_ENABLED:-${LOCAL_LOGIN_ENABLED:-true}}|g" "$CONFIG_FILE"

    echo "Runtime configuration updated"
    echo "  API_URL: ${API_URL_VALUE}"
    echo "  AAD_CLIENT_ID: ${AAD_CLIENT_ID}"
    echo "  AAD_AUTHORITY: ${AAD_AUTHORITY}"
    echo "  DEV_LOGIN_PAGE: ${VITE_DEV_LOGIN_PAGE:-${DEV_LOGIN_PAGE:-false}}"
    echo "  FLOWISE_URL: ${VITE_FLOWISE_URL:-${FLOWISE_URL:-http://localhost:3000}}"
    echo "  AUTH_PROVIDER: ${VITE_AUTH_PROVIDER:-${AUTH_PROVIDER:-all}}"
    echo "  MICROSOFT_LOGIN_ENABLED: ${VITE_MICROSOFT_LOGIN_ENABLED:-${MICROSOFT_LOGIN_ENABLED:-true}}"
    echo "  GOOGLE_LOGIN_ENABLED: ${VITE_GOOGLE_LOGIN_ENABLED:-${GOOGLE_LOGIN_ENABLED:-true}}"
    echo "  LOCAL_LOGIN_ENABLED: ${VITE_LOCAL_LOGIN_ENABLED:-${LOCAL_LOGIN_ENABLED:-true}}"
fi

# Set default values if not provided
export API_HOST=${API_HOST:-agenticworkchat-api}
export API_PORT=${API_PORT:-8000}
export DOCS_HOST=${DOCS_HOST:-agenticworkchat-docs}
export DOCS_PORT=${DOCS_PORT:-80}
export FLOWISE_HOST=${FLOWISE_HOST:-flowise}
export FLOWISE_PORT=${FLOWISE_PORT:-3000}

# Redis Commander configuration
export REDIS_COMMANDER_HOST=${REDIS_COMMANDER_HOST:-redis-commander}
export REDIS_COMMANDER_PORT=${REDIS_COMMANDER_PORT:-8081}
echo "Redis Commander: http://${REDIS_COMMANDER_HOST}:${REDIS_COMMANDER_PORT}"

# Attu (Milvus Admin) configuration
export ATTU_HOST=${ATTU_HOST:-attu}
export ATTU_PORT=${ATTU_PORT:-3000}
echo "Attu (Milvus Admin): http://${ATTU_HOST}:${ATTU_PORT}"

# MCP Proxy configuration - routes to mcp-proxy service
export MCP_HOST=${MCP_HOST:-mcp-proxy}
export MCP_PORT=${MCP_PORT:-3001}
echo "MCP Proxy: http://${MCP_HOST}:${MCP_PORT}"

# AWCode Manager configuration - routes to awcode-manager service for PTY terminal
export AWCODE_MANAGER_HOST=${AWCODE_MANAGER_HOST:-awcode-manager}
export AWCODE_MANAGER_PORT=${AWCODE_MANAGER_PORT:-3050}
echo "AWCode Manager: http://${AWCODE_MANAGER_HOST}:${AWCODE_MANAGER_PORT}"

# Code-Server configuration - VS Code Web IDE
export CODE_SERVER_HOST=${CODE_SERVER_HOST:-code-server}
export CODE_SERVER_PORT=${CODE_SERVER_PORT:-8080}
echo "Code-Server: http://${CODE_SERVER_HOST}:${CODE_SERVER_PORT}"

# Substitute environment variables in nginx config
if [ -f /etc/nginx/conf.d/default.conf.template ]; then
    echo "Configuring nginx with environment variables..."
    echo "  FLOWISE_HOST: ${FLOWISE_HOST}"
    echo "  FLOWISE_PORT: ${FLOWISE_PORT}"
    echo "  AWCODE_MANAGER_HOST: ${AWCODE_MANAGER_HOST}"
    echo "  AWCODE_MANAGER_PORT: ${AWCODE_MANAGER_PORT}"
    echo "  CODE_SERVER_HOST: ${CODE_SERVER_HOST}"
    echo "  CODE_SERVER_PORT: ${CODE_SERVER_PORT}"

    # Detect DNS resolver from /etc/resolv.conf
    # In Docker: 127.0.0.11, in K8s: typically 10.43.0.10 or similar
    DNS_RESOLVER=$(grep '^nameserver' /etc/resolv.conf | head -1 | awk '{print $2}')
    if [ -z "$DNS_RESOLVER" ]; then
        DNS_RESOLVER="127.0.0.11"  # Docker default
    fi
    export DNS_RESOLVER
    echo "  DNS_RESOLVER: ${DNS_RESOLVER}"

    envsubst '${API_HOST} ${API_PORT} ${MCP_HOST} ${MCP_PORT} ${DOCS_HOST} ${DOCS_PORT} ${FRONTEND_SECRET} ${FLOWISE_HOST} ${FLOWISE_PORT} ${REDIS_COMMANDER_HOST} ${REDIS_COMMANDER_PORT} ${ATTU_HOST} ${ATTU_PORT} ${AWCODE_MANAGER_HOST} ${AWCODE_MANAGER_PORT} ${CODE_SERVER_HOST} ${CODE_SERVER_PORT} ${DNS_RESOLVER}' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf
    echo "nginx configuration complete"
else
    echo "Warning: No nginx template found, using default configuration"
fi

# Start nginx
echo "Starting nginx..."
exec nginx -g 'daemon off;'