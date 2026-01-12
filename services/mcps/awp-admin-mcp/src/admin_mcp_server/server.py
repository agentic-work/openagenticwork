#!/usr/bin/env python3
"""
Admin MCP Server - FastMCP Implementation with RBAC Auth Integration

IMPORTANT: This MCP server is ONLY available to ADMIN users.
Non-admin users should NOT have access to any tools in this server.
The MCP proxy validates admin status before routing requests here.
"""

import os
import sys
import json
import logging
import asyncio
import httpx
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from contextlib import asynccontextmanager

import dotenv
import redis
from pymilvus import connections, utility, Collection
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

# Load environment variables
dotenv.load_dotenv()

# Configure logging to stderr (stdout is reserved for JSON-RPC)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger("admin-mcp")

# Initialize FastMCP server
mcp = FastMCP("Admin MCP Server - ADMIN USERS ONLY")

# Global instances
redis_client: Optional[redis.Redis] = None
prisma_client: Optional[Any] = None  # Will be initialized when prisma is available


# ============================================================================
# DATABASE CONNECTION MANAGEMENT
# ============================================================================

class DatabaseConfig:
    """Configuration for database connections"""

    @staticmethod
    def get_prisma_url() -> str:
        """Get PostgreSQL connection URL from environment"""
        return os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/agenticwork")

    @staticmethod
    def get_redis_config() -> Dict[str, Any]:
        """Get Redis configuration from environment"""
        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            return {"url": redis_url}

        return {
            "host": os.getenv("REDIS_HOST", "redis"),
            "port": int(os.getenv("REDIS_PORT", "6379")),
            "password": os.getenv("REDIS_PASSWORD"),
            "decode_responses": True
        }

    @staticmethod
    def get_milvus_config() -> Dict[str, str]:
        """Get Milvus configuration from environment"""
        return {
            "host": os.getenv("MILVUS_HOST", "milvus"),
            "port": os.getenv("MILVUS_PORT", "19530"),
            "user": os.getenv("MILVUS_USERNAME", ""),
            "password": os.getenv("MILVUS_PASSWORD", "")
        }


async def init_connections():
    """Initialize all database connections"""
    global redis_client, prisma_client

    # Initialize Redis
    logger.info("Connecting to Redis...")
    redis_config = DatabaseConfig.get_redis_config()

    if "url" in redis_config:
        redis_client = redis.from_url(redis_config["url"], decode_responses=True)
    else:
        redis_client = redis.Redis(**redis_config)

    # Test Redis connection
    redis_client.ping()
    logger.info("✅ Redis connected successfully")

    # Initialize Milvus
    logger.info("Connecting to Milvus...")
    milvus_config = DatabaseConfig.get_milvus_config()
    connections.connect(
        alias="default",
        host=milvus_config["host"],
        port=milvus_config["port"],
        user=milvus_config["user"] if milvus_config["user"] else None,
        password=milvus_config["password"] if milvus_config["password"] else None
    )
    logger.info("✅ Milvus connected successfully")

    # Initialize Prisma (if available)
    try:
        from prisma import Prisma
        prisma_client = Prisma()
        await prisma_client.connect()
        logger.info("✅ Prisma (PostgreSQL) connected successfully")
    except ImportError:
        logger.warning("⚠️ Prisma not available - using direct SQL queries instead")
        # We can fall back to psycopg2 or other database library if needed
    except Exception as e:
        logger.error(f"Failed to connect to PostgreSQL: {e}")
        raise


async def cleanup_connections():
    """Cleanup all database connections"""
    global redis_client, prisma_client

    if redis_client:
        redis_client.close()
        logger.info("Redis connection closed")

    try:
        connections.disconnect("default")
        logger.info("Milvus connection closed")
    except Exception as e:
        logger.warning(f"Error closing Milvus connection: {e}")

    if prisma_client:
        await prisma_client.disconnect()
        logger.info("Prisma connection closed")


# ============================================================================
# AUTH CONTEXT - This is passed from MCP Proxy
# ============================================================================

class UserContext(BaseModel):
    """User context passed from MCP proxy with auth information"""
    user_id: str
    user_name: str
    email: str
    is_admin: bool
    groups: List[str] = []


def validate_admin_access(user_context: Optional[Dict[str, Any]] = None) -> UserContext:
    """
    Validate that the user is an admin before allowing any tool execution.
    This is a CRITICAL security check - ALL tools in this MCP require admin access.

    The MCP proxy should already filter this, but we validate again as defense in depth.
    """
    if not user_context:
        logger.error("❌ SECURITY: No user context provided - rejecting request")
        raise PermissionError("Authentication required. Admin access only.")

    # Extract user info
    is_admin = user_context.get("is_admin", False)
    user_name = user_context.get("user_name", "unknown")
    user_id = user_context.get("user_id", "unknown")

    if not is_admin:
        logger.error(f"❌ SECURITY: Non-admin user '{user_name}' ({user_id}) attempted to access admin-mcp")
        raise PermissionError(
            f"Access denied. Admin privileges required. "
            f"User '{user_name}' does not have admin access."
        )

    logger.info(f"✅ Admin access validated for user: {user_name} ({user_id})")

    return UserContext(
        user_id=user_id,
        user_name=user_name,
        email=user_context.get("email", ""),
        is_admin=True,
        groups=user_context.get("groups", [])
    )


# ============================================================================
# POSTGRESQL TOOLS
# ============================================================================

@mcp.tool(description="Execute a raw SQL query on the AgenticWork system PostgreSQL database (NOT Azure databases). Use with extreme caution - this is for system administration only.")
async def admin_system_postgres_raw_query(
    query: str,
    params: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Execute raw SQL query on system PostgreSQL database"""
    # Note: In FastMCP, user context would need to be passed via context or global state
    # For now, we'll validate using a context manager pattern or rely on proxy filtering

    if not prisma_client:
        raise RuntimeError("PostgreSQL connection not available")

    try:
        # Execute raw query
        params_list = params or []
        result = await prisma_client.query_raw(query, *params_list)

        logger.info(f"Database query executed: {query[:100]}...")

        return {
            "success": True,
            "result": result,
            "rowCount": len(result) if isinstance(result, list) else 1
        }
    except Exception as e:
        logger.error(f"Database query failed: {e}")
        raise RuntimeError(f"Database query failed: {str(e)}")


@mcp.tool(description="List all tables in the AgenticWork system PostgreSQL database with schema information (NOT Azure SQL databases)")
async def admin_system_postgres_list_tables() -> Dict[str, Any]:
    """List all tables in the system database"""

    if not prisma_client:
        raise RuntimeError("PostgreSQL connection not available")

    try:
        query = """
            SELECT table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """

        tables = await prisma_client.query_raw(query)

        logger.info(f"Listed {len(tables)} tables from database")

        return {
            "success": True,
            "tables": tables
        }
    except Exception as e:
        logger.error(f"Failed to list tables: {e}")
        raise RuntimeError(f"Failed to list tables: {str(e)}")


@mcp.tool(description="Check health and connection status of the AgenticWork system PostgreSQL database (NOT Azure databases)")
async def admin_system_postgres_health_check() -> Dict[str, Any]:
    """Check PostgreSQL database health"""

    if not prisma_client:
        return {
            "success": False,
            "healthy": False,
            "message": "PostgreSQL connection not available"
        }

    try:
        await prisma_client.query_raw("SELECT 1")

        return {
            "success": True,
            "healthy": True,
            "message": "Database connection is healthy"
        }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "message": f"Database connection failed: {str(e)}"
        }


# ============================================================================
# REDIS TOOLS
# ============================================================================

@mcp.tool(description="Get value from the AgenticWork system Redis cache by key (NOT Azure Redis Cache)")
async def admin_system_redis_get_key(key: str) -> Dict[str, Any]:
    """Get value from Redis by key"""

    if not redis_client:
        raise RuntimeError("Redis connection not available")

    try:
        value = redis_client.get(key)

        logger.info(f"Redis GET: key={key}, found={bool(value)}")

        return {
            "success": True,
            "key": key,
            "value": value,
            "found": bool(value)
        }
    except Exception as e:
        logger.error(f"Redis GET failed: {e}")
        raise RuntimeError(f"Redis GET failed: {str(e)}")


@mcp.tool(description="Set key-value pair in the AgenticWork system Redis cache with optional TTL (NOT Azure Redis Cache)")
async def admin_system_redis_set_key(
    key: str,
    value: str,
    ttl: Optional[int] = None
) -> Dict[str, Any]:
    """Set key-value in Redis with optional TTL"""

    if not redis_client:
        raise RuntimeError("Redis connection not available")

    try:
        if ttl:
            redis_client.setex(key, ttl, value)
        else:
            redis_client.set(key, value)

        logger.info(f"Redis SET: key={key}, ttl={ttl}")

        return {
            "success": True,
            "key": key,
            "ttl": ttl
        }
    except Exception as e:
        logger.error(f"Redis SET failed: {e}")
        raise RuntimeError(f"Redis SET failed: {str(e)}")


@mcp.tool(description="Delete one or more keys from the AgenticWork system Redis cache (NOT Azure Redis Cache)")
async def admin_system_redis_delete_keys(keys: List[str]) -> Dict[str, Any]:
    """Delete keys from Redis"""

    if not redis_client:
        raise RuntimeError("Redis connection not available")

    try:
        deleted = redis_client.delete(*keys) if keys else 0

        logger.info(f"Redis DELETE: keys={keys}, deleted={deleted}")

        return {
            "success": True,
            "keys": keys,
            "deleted": deleted
        }
    except Exception as e:
        logger.error(f"Redis DELETE failed: {e}")
        raise RuntimeError(f"Redis DELETE failed: {str(e)}")


@mcp.tool(description="List keys in the AgenticWork system Redis cache matching a pattern (NOT Azure Redis Cache). Use with caution on large datasets.")
async def admin_system_redis_list_keys_by_pattern(
    pattern: str = "*",
    limit: int = 100
) -> Dict[str, Any]:
    """List Redis keys matching a pattern"""

    if not redis_client:
        raise RuntimeError("Redis connection not available")

    try:
        # Use SCAN instead of KEYS for better performance
        keys = []
        cursor = 0

        while True:
            cursor, batch = redis_client.scan(cursor, match=pattern, count=100)
            keys.extend(batch)

            if cursor == 0 or len(keys) >= limit:
                break

        result_keys = keys[:limit]

        logger.info(f"Redis SCAN: pattern={pattern}, found={len(result_keys)}")

        return {
            "success": True,
            "pattern": pattern,
            "keys": result_keys,
            "count": len(result_keys),
            "limited": len(keys) > limit
        }
    except Exception as e:
        logger.error(f"Redis SCAN failed: {e}")
        raise RuntimeError(f"Redis SCAN failed: {str(e)}")


@mcp.tool(description="Clear keys from the AgenticWork system Redis cache by pattern (NOT Azure Redis Cache). Example: clear all user sessions.")
async def admin_system_redis_clear_cache_by_pattern(pattern: str) -> Dict[str, Any]:
    """Clear Redis keys matching a pattern"""

    if not redis_client:
        raise RuntimeError("Redis connection not available")

    try:
        # Find all keys matching pattern using SCAN
        keys = []
        cursor = 0

        while True:
            cursor, batch = redis_client.scan(cursor, match=pattern, count=1000)
            keys.extend(batch)

            if cursor == 0:
                break

        # Delete all found keys
        deleted = redis_client.delete(*keys) if keys else 0

        logger.info(f"Redis CLEAR: pattern={pattern}, deleted={deleted}")

        return {
            "success": True,
            "pattern": pattern,
            "deleted": deleted
        }
    except Exception as e:
        logger.error(f"Redis CLEAR failed: {e}")
        raise RuntimeError(f"Redis CLEAR failed: {str(e)}")


@mcp.tool(description="Check health and connection status of the AgenticWork system Redis cache (NOT Azure Redis Cache)")
async def admin_system_redis_health_check() -> Dict[str, Any]:
    """Check Redis health"""

    if not redis_client:
        return {
            "success": False,
            "healthy": False,
            "message": "Redis connection not available"
        }

    try:
        result = redis_client.ping()

        return {
            "success": True,
            "healthy": result,
            "message": "Redis connection is healthy"
        }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "message": f"Redis connection failed: {str(e)}"
        }


# ============================================================================
# MILVUS TOOLS
# ============================================================================

@mcp.tool(description="List all collections in the AgenticWork system Milvus vector database (NOT Azure AI Search)")
async def admin_system_milvus_list_collections() -> Dict[str, Any]:
    """List all Milvus collections"""

    try:
        collections = utility.list_collections()

        logger.info(f"Listed {len(collections)} Milvus collections")

        return {
            "success": True,
            "collections": collections
        }
    except Exception as e:
        logger.error(f"Failed to list Milvus collections: {e}")
        raise RuntimeError(f"Failed to list Milvus collections: {str(e)}")


@mcp.tool(description="Get detailed information about a collection in the AgenticWork system Milvus vector database (NOT Azure AI Search)")
async def admin_system_milvus_get_collection_info(collection_name: str) -> Dict[str, Any]:
    """Get Milvus collection information"""

    try:
        # Check if collection exists
        if not utility.has_collection(collection_name):
            raise ValueError(f"Collection '{collection_name}' does not exist")

        collection = Collection(collection_name)

        # Get collection stats
        stats = utility.get_query_segment_info(collection_name)

        # Get schema
        schema = collection.schema

        info = {
            "name": collection_name,
            "num_entities": collection.num_entities,
            "schema": {
                "description": schema.description,
                "fields": [
                    {
                        "name": field.name,
                        "type": str(field.dtype),
                        "description": field.description
                    }
                    for field in schema.fields
                ]
            }
        }

        logger.info(f"Retrieved info for Milvus collection: {collection_name}")

        return {
            "success": True,
            "collection_name": collection_name,
            "info": info
        }
    except Exception as e:
        logger.error(f"Failed to get Milvus collection info: {e}")
        raise RuntimeError(f"Failed to get Milvus collection info: {str(e)}")


@mcp.tool(description="Check health and connection status of the AgenticWork system Milvus vector database (NOT Azure AI Search)")
async def admin_system_milvus_health_check() -> Dict[str, Any]:
    """Check Milvus health"""

    try:
        # Try to list collections as a health check
        collections = utility.list_collections()

        return {
            "success": True,
            "healthy": True,
            "message": "Milvus connection is healthy",
            "details": {
                "collection_count": len(collections)
            }
        }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "message": f"Milvus connection failed: {str(e)}"
        }


# ============================================================================
# SYSTEM HEALTH CHECK
# ============================================================================

@mcp.tool(description="Get overall health status for all AgenticWork infrastructure components (PostgreSQL, Redis, Milvus, services)")
async def admin_system_infrastructure_health_check() -> Dict[str, Any]:
    """Check overall system health"""

    health = {
        "timestamp": datetime.utcnow().isoformat(),
        "components": {}
    }

    # Check PostgreSQL
    pg_health = await admin_system_postgres_health_check()
    health["components"]["postgresql"] = {
        "healthy": pg_health.get("healthy", False),
        "message": pg_health.get("message", "Unknown")
    }

    # Check Redis
    redis_health = await admin_system_redis_health_check()
    health["components"]["redis"] = {
        "healthy": redis_health.get("healthy", False),
        "message": redis_health.get("message", "Unknown")
    }

    # Check Milvus
    milvus_health = await admin_system_milvus_health_check()
    health["components"]["milvus"] = {
        "healthy": milvus_health.get("healthy", False),
        "message": milvus_health.get("message", "Unknown"),
        "details": milvus_health.get("details", {})
    }

    # Overall health
    health["healthy"] = all(
        component.get("healthy", False)
        for component in health["components"].values()
    )

    logger.info(f"System health check: healthy={health['healthy']}")

    return health


# ============================================================================
# FULL SYSTEM TEST TOOL
# ============================================================================

@mcp.tool(description="Run a COMPREHENSIVE test of the ENTIRE AgenticWork platform. Use when admin says 'full test'. Tests: ALL infrastructure (PostgreSQL, Redis, Milvus, Ollama, API, Flowise), ALL 12 MCP servers, tool execution from each MCP, formatting MCP, diagram MCP, critical API endpoints, and performance benchmarks. Returns detailed report with pass/fail status, timing, bottlenecks, and recommendations.")
async def admin_full_system_test(
    include_slow_tests: bool = False,
    include_azure_tests: bool = False,
    include_gcp_tests: bool = False,
    verbose: bool = True
) -> Dict[str, Any]:
    """
    Run comprehensive full system test.

    Args:
        include_slow_tests: Include slow tests like full web fetches (adds 30-60 seconds)
        include_azure_tests: Test Azure MCP tools (requires valid Azure credentials)
        include_gcp_tests: Test GCP MCP tools (requires valid GCP credentials)
        verbose: Include detailed output for each test

    Returns:
        Comprehensive test report
    """
    from .full_test_tools import admin_full_system_test as run_full_test
    return await run_full_test(
        include_slow_tests=include_slow_tests,
        include_azure_tests=include_azure_tests,
        include_gcp_tests=include_gcp_tests,
        verbose=verbose
    )


# ============================================================================
# FASTMCP SERVER INITIALIZATION
# ============================================================================

def main():
    """Main entry point for the admin MCP server"""
    logger.info("=" * 80)
    logger.info("Starting Admin MCP Server (FastMCP)")
    logger.info("ADMIN USERS ONLY - Non-admin users will be rejected")
    logger.info("=" * 80)

    # Initialize connections
    async def setup():
        await init_connections()

    async def teardown():
        await cleanup_connections()

    # Import tool modules to register their tools with FastMCP
    try:
        from . import user_tools
        from . import audit_tools
        logger.info("✅ Tool modules loaded successfully")
    except ImportError as e:
        logger.warning(f"Some tool modules could not be loaded: {e}")

    # Run server with connection management
    try:
        loop = asyncio.get_event_loop()
        loop.run_until_complete(setup())

        # Start FastMCP server
        logger.info("✅ Admin MCP Server ready - waiting for requests")
        mcp.run()
    except KeyboardInterrupt:
        logger.info("Shutting down Admin MCP Server...")
    finally:
        loop.run_until_complete(teardown())
        logger.info("Admin MCP Server stopped")


if __name__ == "__main__":
    main()
