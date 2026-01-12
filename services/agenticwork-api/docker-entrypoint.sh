#!/bin/sh

echo "========================================="
echo "Dependencies Health Check"
echo "========================================="

# Step 1: Check if Milvus is enabled and wait for it to be ready
if [ "${MILVUS_ENABLED}" = "false" ] || [ "${DISABLE_MILVUS}" = "true" ] || [ "${SKIP_MILVUS_CHECK}" = "true" ]; then
  echo "[1/4] Milvus is disabled - skipping health check"
else
  echo "[1/4] Waiting for Milvus vector database to be fully ready..."
  MILVUS_HOST=${MILVUS_HOST:-milvus-standalone}
  MILVUS_HEALTH_URL="http://${MILVUS_HOST}:9091/healthz"

  echo "  Checking Milvus health at: $MILVUS_HEALTH_URL"
  for i in $(seq 1 36); do
    echo -n "  Attempt $i/36: "
    if curl -f -s "$MILVUS_HEALTH_URL" >/dev/null 2>&1; then
      echo "✅ Milvus health check passed"
      # Wait additional 10 seconds for Milvus to fully initialize connection pool
      echo "  Waiting 10 seconds for Milvus connection pool to stabilize..."
      sleep 10
      echo "✅ Milvus is ready"
      break
    else
      echo "❌ Milvus not ready yet"
      if [ $i -eq 36 ]; then
        echo "⚠️ WARNING: Milvus not ready after 3 minutes - continuing anyway"
      fi
      sleep 5
    fi
  done
fi

# Step 2: Wait for Redis to be ready
echo "[2/4] Waiting for Redis to be ready..."
REDIS_HOST=${REDIS_HOST:-redis}
REDIS_PORT=${REDIS_PORT:-6379}

echo "  Checking Redis at: $REDIS_HOST:$REDIS_PORT"
for i in $(seq 1 12); do
  echo -n "  Attempt $i/12: "
  if nc -z -w 2 "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
    echo "✅ Redis is ready"
    break
  else
    echo "❌ Redis not ready yet"
    if [ $i -eq 12 ]; then
      echo "⚠️ WARNING: Redis not ready after 60 seconds - continuing anyway"
    fi
    sleep 5
  fi
done

# Step 3: Wait for MCP Proxy to be ready
if [ "${MCP_PROXY_ENABLED}" = "false" ] || [ "${SKIP_MCP_PROXY_CHECK}" = "true" ]; then
  echo "[3/4] MCP Proxy is disabled - skipping health check"
else
  echo "[3/4] Waiting for MCP Proxy to be ready..."
  MCP_PROXY_URL="${MCP_PROXY_URL:-http://mcp-proxy:8080}"
  MCP_HEALTH_URL="${MCP_PROXY_URL}/health"

  echo "  Checking MCP Proxy health at: $MCP_HEALTH_URL"
  for i in $(seq 1 18); do
    echo -n "  Attempt $i/18: "
    if curl -f -s "$MCP_HEALTH_URL" >/dev/null 2>&1; then
      echo "✅ MCP Proxy health check passed"
      # Wait additional 5 seconds for MCP servers to fully initialize
      echo "  Waiting 5 seconds for MCP servers to fully initialize..."
      sleep 5
      echo "✅ MCP Proxy is ready"
      break
    else
      echo "❌ MCP Proxy not ready yet"
      if [ $i -eq 18 ]; then
        echo "⚠️ WARNING: MCP Proxy not ready after 90 seconds - continuing anyway"
      fi
      sleep 5
    fi
  done
fi

# Step 4: All database initialization handled by DatabaseService
echo "[4/4] Database initialization will be handled by DatabaseService on startup..."
echo "  ℹ️  DatabaseService.initialize() will handle:"
echo "    - Schema validation and migration"
echo "    - Duplicate cleanup and constraint resolution"
echo "    - Table and column verification"
echo "    - Admin user creation from env vars"
echo "    - System prompt template seeding"

echo "========================================="
echo "✅ Dependencies ready - starting API server"
echo "========================================="

echo "Starting API server..."
exec node dist/server.js