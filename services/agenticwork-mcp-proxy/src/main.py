#!/usr/bin/env python3
"""
MCP Proxy Service - Centralized MCP Server Management with OBO Authentication
Hosts and manages ALL MCP servers for the AgenticWork platform
"""

import asyncio
import json
import logging
import os
import jwt
import httpx
import time
import redis
import subprocess
import uuid
from typing import Dict, Any, Optional, List, Union
from fastapi import FastAPI, HTTPException, Depends, Request, BackgroundTasks, Cookie, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import uvicorn
from contextlib import asynccontextmanager

from mcp_manager import MCPManager, MCPServerStatus
from user_session_manager import get_user_session_manager
from azure_oauth import AzureOAuthService

# Configure comprehensive logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("mcp-proxy")

# Set detailed logging for MCP interactions
logging.getLogger("mcp-manager").setLevel(logging.INFO)

load_dotenv()

# Configuration
TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
PORT = int(os.getenv("PORT", "8080"))
API_BASE_URL = os.getenv("API_BASE_URL", "http://agenticworkchat-api:3000")  # Internal API for logging

# Authentication can be disabled for local development
# Azure AD users: Validated via Azure AD token, RBAC policies apply
# Local admin users: No token = system admin role with full access
ENABLE_AUTH = os.getenv("ENABLE_AUTH", "true").lower() in ("true", "1", "yes")

# Global instances
mcp_manager: Optional[MCPManager] = None
redis_client: Optional[redis.Redis] = None
oauth_service: Optional[AzureOAuthService] = None
inspector_process: Optional[subprocess.Popen] = None

# === HELPER FUNCTIONS ===

async def send_mcp_log_to_api(
    user_id: str,
    user_name: Optional[str],
    user_email: Optional[str],
    server_name: str,
    tool_name: str,
    method: str,
    params: dict,
    result: Optional[dict],
    error: Optional[dict],
    execution_time_ms: float,
    success: bool
) -> None:
    """Send MCP call log to API database (fire-and-forget) with full request/response data"""
    try:
        # Use internal API key for service-to-service authentication
        api_internal_key = os.environ.get('API_INTERNAL_KEY', '')
        headers = {
            'Authorization': f'Bearer {api_internal_key}',
            'Content-Type': 'application/json'
        }

        async with httpx.AsyncClient() as client:
            log_data = {
                "user_id": user_id,
                "user_name": user_name,
                "user_email": user_email,
                "server_name": server_name,
                "tool_name": tool_name,
                "method": method,
                "params": params,
                "result": result,  # Full response data
                "error": error,
                "execution_time_ms": execution_time_ms,
                "success": success,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
            }

            await client.post(
                f"{API_BASE_URL}/api/mcp-logs",
                json=log_data,
                headers=headers,
                timeout=5.0  # Quick timeout to not block
            )
            logger.debug(f"MCP log sent to API for tool: {tool_name} by user: {user_name or user_id}")
    except Exception as e:
        # Log but don't fail the request
        logger.warning(f"Failed to send MCP log to API: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events for MCP servers"""
    global mcp_manager, redis_client, oauth_service, inspector_process

    logger.info("=== MCP PROXY STARTUP ===")

    # Initialize Redis
    logger.info("Connecting to Redis...")
    redis_host = os.getenv("REDIS_HOST", "redis")
    redis_port = int(os.getenv("REDIS_PORT", "6379"))
    redis_password = os.getenv("REDIS_PASSWORD", None)
    redis_client = redis.Redis(
        host=redis_host,
        port=redis_port,
        password=redis_password,
        decode_responses=False
    )
    redis_client.ping()  # Test connection
    logger.info(f"✅ Redis connected at {redis_host}:{redis_port}")

    # Initialize OAuth service (only if auth is enabled)
    if ENABLE_AUTH:
        logger.info("Initializing Azure OAuth service...")
        oauth_service = AzureOAuthService(redis_client)
        logger.info("✅ OAuth service initialized")
    else:
        logger.info("⚠️ Auth disabled - skipping Azure OAuth service initialization")

    # Start MCP Inspector subprocess
    logger.info("Starting MCP Inspector UI...")
    try:
        inspector_process = subprocess.Popen(
            ["npx", "@modelcontextprotocol/inspector", "--no-open"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "PORT": "6274", "MCPP_PORT": "6277"}
        )
        logger.info(f"✅ MCP Inspector started on ports 6274/6277 (PID: {inspector_process.pid})")
    except Exception as e:
        logger.error(f"⚠️ Failed to start MCP Inspector: {e}")
        inspector_process = None

    logger.info("Initializing MCP Manager...")
    mcp_manager = MCPManager(redis_client=redis_client)

    logger.info("Starting all MCP servers...")
    await mcp_manager.start_all()

    # Log server statuses
    statuses = mcp_manager.get_server_status()
    logger.info("=== MCP SERVER STATUS ===")
    for name, status in statuses.items():
        logger.info(f"{name}: {status['status']} (PID: {status.get('pid', 'N/A')})")

    # Start per-user Azure MCP session cleanup
    logger.info("Starting per-user Azure MCP session manager...")
    session_manager = get_user_session_manager()
    await session_manager.start_periodic_cleanup(interval_minutes=15)
    logger.info("✅ User session manager started with periodic cleanup (every 15 minutes)")

    yield

    logger.info("=== MCP PROXY SHUTDOWN ===")

    # Stop MCP Inspector
    if inspector_process:
        logger.info("Stopping MCP Inspector...")
        inspector_process.terminate()
        try:
            inspector_process.wait(timeout=5)
            logger.info("✅ MCP Inspector stopped")
        except subprocess.TimeoutExpired:
            logger.warning("Force killing MCP Inspector...")
            inspector_process.kill()
            inspector_process.wait()

    if mcp_manager:
        await mcp_manager.stop_all()

    # Stop user session cleanup
    logger.info("Stopping user session manager...")
    session_manager = get_user_session_manager()
    await session_manager.stop_periodic_cleanup()
    logger.info("✅ User session manager stopped")

    # Close Redis connection
    if redis_client:
        redis_client.close()
        logger.info("✅ Redis connection closed")

# FastAPI app with lifespan management
app = FastAPI(
    title="MCP Proxy Service",
    version="2.0.0",
    description="Centralized MCP Server Management with OBO Authentication",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure as needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for inspector UI
app.mount("/static", StaticFiles(directory="src/static"), name="static")

security = HTTPBearer(auto_error=False)

# Request/Response models
class MCPRequest(BaseModel):
    method: str
    params: Dict[str, Any] = {}
    id: str = "1"
    server: Optional[str] = None  # Target MCP server name

class MCPResponse(BaseModel):
    result: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    id: str = "1"
    server: Optional[str] = None
    execution_time: Optional[float] = None

class MCPToolCall(BaseModel):
    server: Optional[str] = None  # Target MCP server name (auto-detected if not provided)
    tool: str
    arguments: Dict[str, Any] = {}
    id: str = "1"

class TokenExchangeError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

# Authentication helpers - using same logic as API
def get_authorized_groups():
    """Get authorized groups from environment - same as API"""
    user_groups = os.getenv('AAD_AUTHORIZED_USER_GROUPS', '').split(',')
    user_groups = [g.strip() for g in user_groups if g.strip()]

    admin_groups = os.getenv('AAD_AUTHORIZED_ADMIN_GROUPS', '').split(',')
    admin_groups = [g.strip() for g in admin_groups if g.strip()]

    return user_groups, admin_groups

def is_user_authorized(user_groups, required_groups):
    """Check if user is in authorized groups - same as API"""
    if not required_groups:
        return True
    return any(group in required_groups for group in user_groups)

def is_admin_user(user_groups, admin_groups):
    """Check if user is admin - same as API"""
    return is_user_authorized(user_groups, admin_groups)

async def fetch_user_mcp_access_policies(user_groups: List[str]) -> Dict[str, str]:
    """Fetch MCP access policies for user's groups from API"""
    try:
        # Query the API for access policies for all user groups
        access_map = {}

        # Use internal API key for service-to-service authentication
        api_internal_key = os.environ.get('API_INTERNAL_KEY', '')
        headers = {
            'Authorization': f'Bearer {api_internal_key}',
            'Content-Type': 'application/json'
        }

        async with httpx.AsyncClient() as client:
            for group_id in user_groups:
                try:
                    response = await client.get(
                        f"{API_BASE_URL}/api/admin/mcp/access-summary/{group_id}",
                        headers=headers,
                        timeout=10.0
                    )

                    if response.status_code == 200:
                        data = response.json()
                        access_summary = data.get('access_summary', [])

                        # Process access summary to build server access map
                        for item in access_summary:
                            server_id = item['server']['id']
                            server_name = item['server']['name']
                            access_type = item['access']  # 'allow' or 'deny'

                            # If we haven't seen this server yet, or if this is an allow policy
                            # (allow policies override deny policies for better UX)
                            if server_name not in access_map or access_type == 'allow':
                                access_map[server_name] = access_type

                except Exception as e:
                    logger.warning(f"Failed to fetch access policies for group {group_id}: {e}")
                    continue

        logger.info(f"Fetched MCP access policies: {access_map}")
        return access_map

    except Exception as e:
        logger.error(f"Failed to fetch MCP access policies: {e}")
        # Return empty map - default policies will be used
        return {}

def check_server_access(server_name: str, user_groups: List[str], access_policies: Dict[str, str], is_admin: bool) -> bool:
    """Check if user can access a specific MCP server"""
    # Admins can access all servers
    if is_admin:
        return True

    # Check explicit policies first
    if server_name in access_policies:
        access = access_policies[server_name]
        logger.debug(f"Explicit policy for server '{server_name}': {access}")
        return access == 'allow'

    # For admin servers, deny access for non-admin users
    # IMPORTANT: awp_admin and awp_kubernetes are admin-only servers
    admin_servers = {'admin', 'awp_admin', 'awp_kubernetes'}
    if server_name in admin_servers:
        logger.debug(f"Denying access to admin server '{server_name}' for non-admin user")
        return False

    # Default policy for other servers - allow access
    # This can be made configurable via MCPDefaultPolicy later
    logger.debug(f"Using default policy for server '{server_name}': allow")
    return True

async def get_user_info(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Optional[Dict[str, Any]]:
    """
    Get user info from JWT token or return system admin for local users.

    Supports THREE authentication methods:
    1. Azure AD tokens (RS256, has 'kid') - Validated against JWKS
    2. Internal API tokens (HS256, no 'kid') - Validated against shared secret
    3. Raw API keys (not JWT) - Direct string comparison

    - Azure AD users: Token validated via JWKS, RBAC policies enforced
    - Internal API users: Token validated via shared secret, user context from claims
    - Local admin users (no token): System admin role with full access
    """
    if not credentials:
        # No credentials = internal/local admin user
        # Return system admin context with full access
        logger.info("No credentials provided - granting system admin access (local admin user)")
        return {
            'token': None,
            'payload': {},
            'user_id': 'system-admin',
            'user_name': 'System Admin',
            'email': 'admin@local',
            'upn': None,
            'groups': ['system-admins'],
            'is_admin': True
        }

    token = credentials.credentials

    # Check if this is a system-level API token (special marker in token)
    # System tokens bypass Azure AD validation and use SP credentials for all MCP calls
    if token and token.startswith('awc_system_'):
        logger.info("System-level API token detected - bypassing Azure AD validation, will use SP credentials")
        return {
            'token': 'SYSTEM_SP_AUTH',  # Special marker for SP credential usage
            'payload': {},
            'user_id': 'system-root',
            'user_name': 'System Root',
            'email': 'system@agenticwork.io',
            'upn': None,
            'groups': ['system-admins'],
            'is_admin': True
        }

    # Check for AgenticWork user API key (awc_ prefix, not system key)
    # This is used when users authenticate with API keys instead of Azure AD
    if token and token.startswith('awc_') and not token.startswith('awc_system_'):
        logger.info("AgenticWork user API key detected - validating against API")
        try:
            # Validate the API key by calling the AgenticWork API's /api/auth/me endpoint
            api_internal_url = os.environ.get('API_INTERNAL_URL', 'http://agenticwork-api:8000')
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{api_internal_url}/api/auth/me",
                    headers={'Authorization': f'Bearer {token}'}
                )
                if response.status_code == 200:
                    user_data = response.json()
                    logger.info(f"API key validated for user: {user_data.get('email', 'unknown')}")
                    return {
                        'token': token,  # Pass the original API key for OBO
                        'payload': {},
                        'user_id': user_data.get('userId', 'unknown'),
                        'user_name': user_data.get('name') or user_data.get('email', 'API User'),
                        'email': user_data.get('email', 'api-user@agenticwork.io'),
                        'upn': None,
                        'groups': user_data.get('groups', []),
                        'is_admin': user_data.get('isAdmin', False)
                    }
                else:
                    logger.warning(f"API key validation failed: {response.status_code}")
        except Exception as e:
            logger.error(f"Failed to validate API key: {e}")
        # Fall through to try other methods if validation fails

    # Check for Flowise internal API key (service-to-service auth)
    # This is used by Flowise to call MCP-proxy without requiring user JWT
    flowise_api_key = os.environ.get('FLOWISE_INTERNAL_API_KEY', 'flowise-internal')
    if token and token == flowise_api_key:
        logger.info("Flowise internal API key detected - granting service account access with SP credentials")
        return {
            'token': 'SYSTEM_SP_AUTH',  # Use SP credentials for Azure calls
            'payload': {},
            'user_id': 'flowise-service',
            'user_name': 'Flowise Service',
            'email': 'flowise@agenticwork.io',
            'upn': None,
            'groups': ['service-accounts'],
            'is_admin': True
        }

    # Check for AgenticWork API internal key (raw key, not JWT)
    # This is used by the agenticwork-api to call MCP-proxy for LLM tool execution
    api_internal_key = os.environ.get('API_INTERNAL_KEY', '')
    if token and token == api_internal_key:
        logger.info("AgenticWork API internal key detected - granting service account access with SP credentials")
        return {
            'token': 'SYSTEM_SP_AUTH',  # Use SP credentials for Azure calls
            'payload': {},
            'user_id': 'api-service',
            'user_name': 'AgenticWork API Service',
            'email': 'api@agenticwork.io',
            'upn': None,
            'groups': ['service-accounts'],
            'is_admin': True
        }

    try:
        # Decode JWT header to determine token type
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get('alg', 'RS256')
        kid = unverified_header.get('kid')

        logger.info(f"[JWT-DEBUG] Token header: kid={kid}, alg={alg}, typ={unverified_header.get('typ')}")

        # =================================================================
        # INTERNAL JWT (HS256) - From AgenticWork API
        # =================================================================
        # Internal tokens are signed with HS256 and don't have a 'kid'
        # They contain user context (userId, email, isAdmin) from the API
        if alg == 'HS256' and not kid:
            logger.info("[JWT-DEBUG] Detected internal HS256 token from API")

            # Get shared secret for internal token validation
            # MUST match API's JWT_SECRET/SIGNING_SECRET
            internal_jwt_secret = os.environ.get('JWT_SECRET') or os.environ.get('SIGNING_SECRET') or os.environ.get('INTERNAL_JWT_SECRET', 'dev-secret-change-in-production')

            try:
                # Validate and decode internal token
                payload = jwt.decode(
                    token,
                    internal_jwt_secret,
                    algorithms=['HS256'],
                    options={'verify_aud': False, 'verify_iss': False}
                )

                logger.info(f"[JWT-DEBUG] Internal token validated successfully: userId={payload.get('userId')}")

                # Extract user context from internal token claims
                user_id = payload.get('userId') or payload.get('user_id') or payload.get('sub')
                user_email = payload.get('email') or payload.get('userEmail')
                user_name = payload.get('name') or payload.get('userName') or user_email
                is_admin = payload.get('isAdmin', False) or payload.get('is_admin', False)
                user_groups = payload.get('groups', [])

                # If admin flag is set, add to admin groups
                if is_admin and 'system-admins' not in user_groups:
                    user_groups = list(user_groups) + ['system-admins']

                return {
                    'token': token,
                    'payload': payload,
                    'user_id': user_id,
                    'user_name': user_name,
                    'email': user_email,
                    'upn': None,
                    'groups': user_groups,
                    'is_admin': is_admin
                }

            except jwt.ExpiredSignatureError:
                logger.warning("[JWT-DEBUG] Internal token expired")
                raise HTTPException(status_code=401, detail="Token expired")
            except jwt.InvalidTokenError as e:
                logger.error(f"[JWT-DEBUG] Internal token validation failed: {e}")
                raise HTTPException(status_code=401, detail=f"Invalid internal token: {e}")

        # =================================================================
        # AZURE AD JWT (RS256) - From browser/Azure AD
        # =================================================================
        # Azure AD tokens are signed with RS256 and have a 'kid' for key lookup
        logger.info("[JWT-DEBUG] Detected Azure AD RS256 token - validating against JWKS")

        # Get Azure AD public keys for token validation
        jwks_url = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
        async with httpx.AsyncClient() as client:
            response = await client.get(jwks_url)
            jwks = response.json()

        logger.info(f"[JWT-DEBUG] JWKS has {len(jwks.get('keys', []))} keys")
        logger.info(f"[JWT-DEBUG] JWKS key IDs: {[k.get('kid') for k in jwks.get('keys', [])]}")

        # Find the correct key
        rsa_key = {}
        for key in jwks['keys']:
            if key['kid'] == kid:
                rsa_key = {
                    'kty': key['kty'],
                    'kid': key['kid'],
                    'use': key['use'],
                    'n': key['n'],
                    'e': key['e']
                }
                logger.info(f"[JWT-DEBUG] Found matching key: kid={kid}")
                break

        if not rsa_key:
            logger.error(f"[JWT-DEBUG] Unable to find key with kid={kid} in JWKS endpoint")
            logger.error(f"[JWT-DEBUG] Token preview (first 50 chars): {token[:50]}...")
            raise HTTPException(status_code=401, detail="Unable to find appropriate key")

        # Convert to PEM format and verify token
        from jwt.algorithms import RSAAlgorithm
        public_key = RSAAlgorithm.from_jwk(rsa_key)

        # Azure AD can use different issuer formats (v1.0 vs v2.0)
        # Support both for compatibility
        valid_issuers = [
            f"https://login.microsoftonline.com/{TENANT_ID}/v2.0",  # v2.0 format
            f"https://sts.windows.net/{TENANT_ID}/",                # v1.0 format
            f"https://login.microsoftonline.com/{TENANT_ID}/"       # Alternative v1.0 format
        ]

        # First decode without validation to see the actual issuer and audience
        try:
            unverified_payload = jwt.decode(
                token,
                options={"verify_signature": False, "verify_aud": False, "verify_iss": False}
            )
            actual_issuer = unverified_payload.get('iss', 'unknown')
            actual_audience = unverified_payload.get('aud', 'unknown')
            logger.info(f"[JWT-DEBUG] Token issuer: {actual_issuer}")
            logger.info(f"[JWT-DEBUG] Token audience: {actual_audience}")
            logger.info(f"[JWT-DEBUG] Valid issuers: {valid_issuers}")
        except Exception as e:
            logger.warning(f"[JWT-DEBUG] Could not peek at token claims: {e}")
            actual_audience = 'unknown'

        # Azure AD tokens can have different audience formats for OBO flow:
        # - CLIENT_ID directly (rare)
        # - api://{CLIENT_ID} (most common for OBO - the API's application ID URI)
        # - api://{CLIENT_ID}/{scope} (with specific scope)
        # - https://management.azure.com (for Azure ARM access tokens - used in chat pipeline)
        valid_audiences = [
            CLIENT_ID,                              # Direct client ID
            f"api://{CLIENT_ID}",                   # Application ID URI (most common for OBO)
            "https://management.azure.com",         # Azure ARM access token (from chat API)
        ]
        logger.info(f"[JWT-DEBUG] Valid audiences: {valid_audiences}")

        # Try to validate with each valid issuer and audience combination
        payload = None
        last_error = None
        for issuer in valid_issuers:
            for audience in valid_audiences:
                try:
                    payload = jwt.decode(
                        token,
                        public_key,
                        algorithms=['RS256'],
                        audience=audience,
                        issuer=issuer
                    )
                    logger.info(f"[JWT-DEBUG] Token validated successfully with issuer: {issuer}, audience: {audience}")
                    break
                except jwt.InvalidIssuerError:
                    last_error = f"Issuer mismatch for {issuer}, audience {audience}"
                    continue
                except jwt.InvalidAudienceError as e:
                    last_error = f"Audience mismatch for {issuer}, audience {audience}: {str(e)}"
                    continue
                except Exception as e:
                    last_error = f"Validation failed for {issuer}, audience {audience}: {str(e)}"
                    continue
            if payload is not None:
                break  # Break outer loop if validated

        if payload is None:
            raise jwt.InvalidIssuerError(f"Token validation failed with all combinations. Actual issuer: {actual_issuer}, Actual audience: {actual_audience}, Expected issuers: {valid_issuers}, Expected audiences: {valid_audiences}. Last error: {last_error}")

        # Get user groups from token
        user_groups = payload.get('groups', [])

        # Check if user is authorized to access the system
        authorized_user_groups, authorized_admin_groups = get_authorized_groups()
        all_authorized_groups = list(set(authorized_user_groups + authorized_admin_groups))

        if all_authorized_groups and not is_user_authorized(user_groups, all_authorized_groups):
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. You must be a member of one of these groups: {', '.join(all_authorized_groups)}"
            )

        # Determine if user is admin
        is_admin = is_admin_user(user_groups, authorized_admin_groups)

        return {
            'token': token,
            'payload': payload,
            'user_id': payload.get('oid'),
            'user_name': payload.get('name') or payload.get('preferred_username'),
            'email': payload.get('email') or payload.get('preferred_username'),
            'upn': payload.get('upn'),
            'groups': user_groups,
            'is_admin': is_admin
        }

    except HTTPException:
        # Re-raise HTTP exceptions (like 403)
        raise
    except Exception as e:
        logger.error(f"Token validation error: {type(e).__name__}: {e}", exc_info=True)
        # Auth is always enabled - always raise on validation failure
        raise HTTPException(status_code=401, detail=f"Token validation failed: {str(e)}")

# OBO token exchange (for Azure MCP when user token is available)
async def exchange_token_for_azure(original_token: str, scope: str = "https://management.azure.com/.default") -> str:
    """Exchange user token for Azure resource access using OBO flow"""
    obo_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

    data = {
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "assertion": original_token,
        "scope": scope,
        "requested_token_use": "on_behalf_of",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(obo_url, data=data)

            if response.status_code == 200:
                token_response = response.json()
                return token_response["access_token"]
            else:
                error_detail = response.text
                logger.error(f"OBO token exchange failed: {error_detail}")
                raise TokenExchangeError(f"Token exchange failed: {error_detail}", response.status_code)

    except httpx.RequestError as e:
        logger.error(f"Network error during token exchange: {e}")
        raise TokenExchangeError(f"Network error: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error during token exchange: {e}")
        raise TokenExchangeError(f"Unexpected error: {str(e)}")

# === MAIN MCP ENDPOINTS ===

@app.post("/mcp", response_model=MCPResponse)
async def proxy_mcp_request(
    mcp_request: MCPRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """Route MCP requests to appropriate server with comprehensive logging"""
    start_time = time.time()

    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    # Determine target server - auto-detect if not specified
    target_server = mcp_request.server

    # TEMPORARY FALLBACK: If API didn't specify server, try to auto-detect from tool name
    # This is a workaround for the API not sending serverId in tool metadata
    # TODO: Remove this once API properly includes serverId in all tool calls
    if not target_server and mcp_request.method == "tools/call":
        tool_name = mcp_request.params.get("name") if mcp_request.params else None
        if tool_name and mcp_manager:
            logger.warning(f"⚠️ API did not specify server for tool '{tool_name}' - attempting auto-detection (TEMPORARY WORKAROUND)")
            # Try to find which server has this tool by querying all servers
            from mcp_manager import MCPServerStatus
            for server_name, server in mcp_manager.servers.items():
                if server.status == MCPServerStatus.RUNNING:
                    try:
                        # Use send_request like list_all_tools() does
                        # Use unique ID to avoid response collisions
                        unique_id = f"auto-detect-{uuid.uuid4().hex[:8]}"
                        request = {
                            "jsonrpc": "2.0",
                            "id": unique_id,
                            "method": "tools/list"
                        }
                        response = await server.send_request(request)
                        if "result" in response and "tools" in response["result"]:
                            server_tools = [t["name"] for t in response["result"]["tools"]]
                            if tool_name in server_tools:
                                target_server = server_name
                                logger.warning(f"🔍 Auto-detected server '{server_name}' for tool '{tool_name}' - API should have provided this!")
                                break
                    except Exception as e:
                        logger.debug(f"Could not list tools for server {server_name}: {e}")
                        continue

    # CRITICAL: If no server specified at this point, the API didn't send it
    # This is an error - the API MUST specify which server to use
    # The MCP proxy should NOT guess or have hardcoded fallbacks
    if not target_server:
        tool_name = mcp_request.params.get("name") if mcp_request.params else "unknown"
        logger.error(f"❌ CRITICAL: No server specified by API for tool '{tool_name}' and auto-detection failed")
        raise HTTPException(
            status_code=400,
            detail=f"Server not specified for tool '{tool_name}'. The API must include server information in tool metadata."
        )

    logger.info(f"=== MCP REQUEST ===")
    user_name = user_info.get('user_name', 'anonymous') if user_info else 'anonymous'
    is_admin = user_info.get('is_admin', False) if user_info else False
    logger.info(f"User: {user_name} (admin: {is_admin})")
    logger.info(f"Server: {target_server}")
    logger.info(f"Method: {mcp_request.method}")
    logger.info(f"Params: {json.dumps(mcp_request.params)}")

    # RBAC: Check if user can access this server
    # IMPORTANT: awp_admin is the actual server name for admin tools
    admin_servers = {'admin', 'awp_admin'}  # List of admin-only servers
    if target_server in admin_servers and not is_admin:
        logger.warning(f"Access denied: Non-admin user '{user_name}' attempted to access admin server '{target_server}'")
        raise HTTPException(
            status_code=403,
            detail=f"Access denied. Admin privileges required to access '{target_server}' server."
        )

    # Extract user_id (required for logging)
    user_id = user_info.get('user_id') if user_info else None

    try:
        # For MCP servers that support OBO (On-Behalf-Of), pass the ORIGINAL user token
        # The MCP server uses OnBehalfOfCredential which needs the original token
        # This includes: awp_azure, awp_azure_cost, awp_flowise
        user_token = None

        # Check if the target server supports OBO authentication
        server_supports_obo = False
        if mcp_manager and target_server in mcp_manager.servers:
            server_supports_obo = mcp_manager.servers[target_server].config.supports_obo

        if server_supports_obo and user_info and ENABLE_AUTH:
            # Check if configured for shared SP mode (bypasses OBO)
            use_shared_sp = os.getenv("AZURE_MCP_USE_SHARED_SP", "false").lower() == "true"

            if not use_shared_sp and user_info.get('token') and user_info.get('token') != 'SYSTEM_SP_AUTH':
                # CRITICAL: For OBO (On-Behalf-Of) flow, the assertion token MUST have
                # audience = app's client ID. The OnBehalfOfCredential then exchanges
                # this for a token with the target resource audience.
                #
                # ID token: audience = app's client ID (392dc6aa-...) - CORRECT for OBO
                # Access token: audience = https://management.azure.com - WRONG for OBO
                #
                # Both AWS and Azure MCP servers need the ID token for OBO!
                # API sends X-Azure-ID-Token for all OBO scenarios (Azure AD ID token)
                id_token = request.headers.get('X-Azure-ID-Token')

                if id_token:
                    user_token = id_token
                    logger.info(f"Using ID token for {target_server} OBO (audience=app client ID): {user_info.get('user_name')}")
                else:
                    # Fall back to access token - this may fail for OBO if audience is wrong
                    user_token = user_info['token']
                    logger.warning(f"No ID token provided for {target_server}, using access token (OBO may fail if audience mismatch)")
            else:
                logger.info(f"MCP server {target_server} configured for shared SP mode - no user token passed")

        # CRITICAL: Inject user_id into tool arguments for servers that require user isolation
        # The awp-agenticwork-cli-mcp server needs user_id for RBAC and workspace isolation
        params_to_send = mcp_request.params
        if mcp_request.method == 'tools/call' and user_id:
            # Check if this is a server that needs user_id injection
            servers_needing_user_id = ['awp_agenticwork_cli', 'awp_agenticode']
            if target_server in servers_needing_user_id:
                # Clone params and inject user_id into arguments
                params_to_send = dict(mcp_request.params) if mcp_request.params else {}
                if 'arguments' in params_to_send:
                    args = dict(params_to_send['arguments']) if params_to_send['arguments'] else {}
                    # Only inject if user_id is not already set or is "default"
                    if not args.get('user_id') or args.get('user_id') == 'default':
                        args['user_id'] = user_id
                        params_to_send['arguments'] = args
                        logger.info(f"[MCP] Injected user_id={user_id} into {target_server} tool arguments")

                    # Also inject api_key for serverless tools that require it
                    # These tools call back to the platform API and need authentication
                    tool_name = params_to_send.get('name', '')
                    serverless_tools = ['run_agenticode_task', 'run_code_generation', 'run_file_operation']
                    if tool_name in serverless_tools and not args.get('api_key'):
                        # Get API key from request header if available
                        api_key = request.headers.get('X-Api-Key') or request.headers.get('Authorization', '').replace('Bearer ', '')
                        if api_key and api_key.startswith('awc_'):
                            args['api_key'] = api_key
                            params_to_send['arguments'] = args
                            logger.info(f"[MCP] Injected api_key into {tool_name} for user {user_id}")

        # Route request to MCP server
        request_data = {
            "jsonrpc": "2.0",
            "id": mcp_request.id,
            "method": mcp_request.method,
            "params": params_to_send
        }

        result = await mcp_manager.route_request(target_server, request_data, user_token)

        execution_time = time.time() - start_time
        execution_time_ms = execution_time * 1000

        logger.info(f"=== MCP RESPONSE ===")
        logger.info(f"Server: {target_server}")
        logger.info(f"Execution Time: {execution_time:.3f}s")
        logger.info(f"Result: {json.dumps(result)}")

        # Send log to API (background task, non-blocking) with full user info and response
        if user_id:
            tool_name = mcp_request.params.get('name', 'unknown') if mcp_request.method == 'tools/call' else mcp_request.method
            background_tasks.add_task(
                send_mcp_log_to_api,
                user_id=user_id,
                user_name=user_info.get('user_name') if user_info else None,
                user_email=user_info.get('user_email') if user_info else None,
                server_name=target_server,
                tool_name=tool_name,
                method=mcp_request.method,
                params=mcp_request.params,
                result=result.get('result'),  # Full response data
                error=None,
                execution_time_ms=execution_time_ms,
                success=True
            )

        return MCPResponse(
            result=result.get('result'),
            error=result.get('error'),
            id=mcp_request.id,
            server=target_server,
            execution_time=execution_time
        )

    except Exception as e:
        execution_time = time.time() - start_time
        execution_time_ms = execution_time * 1000

        logger.error(f"=== MCP ERROR ===")
        logger.error(f"Server: {target_server}")
        logger.error(f"Error: {str(e)}")
        logger.error(f"Execution Time: {execution_time:.3f}s")

        # Send error log to API (background task, non-blocking) with full user info
        if user_id:
            tool_name = mcp_request.params.get('name', 'unknown') if mcp_request.method == 'tools/call' else mcp_request.method
            background_tasks.add_task(
                send_mcp_log_to_api,
                user_id=user_id,
                user_name=user_info.get('user_name') if user_info else None,
                user_email=user_info.get('user_email') if user_info else None,
                server_name=target_server,
                tool_name=tool_name,
                method=mcp_request.method,
                params=mcp_request.params,
                result=None,
                error={"code": 500, "message": str(e)},
                execution_time_ms=execution_time_ms,
                success=False
            )

        return MCPResponse(
            error={
                "code": 500,
                "message": str(e)
            },
            id=mcp_request.id,
            server=target_server,
            execution_time=execution_time
        )

@app.post("/mcp/tool", response_model=MCPResponse)
async def call_mcp_tool(
    tool_call: MCPToolCall,
    background_tasks: BackgroundTasks,
    request: Request,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """Call a specific tool on an MCP server"""

    mcp_request = MCPRequest(
        method="tools/call",
        params={
            "name": tool_call.tool,
            "arguments": tool_call.arguments
        },
        id=tool_call.id,
        server=tool_call.server
    )

    return await proxy_mcp_request(mcp_request, background_tasks, request, user_info)

# === STATUS AND MONITORING ENDPOINTS ===

@app.get("/health")
async def health_check():
    """Health check endpoint with MCP server status"""
    if not mcp_manager:
        return {"status": "unhealthy", "error": "MCP Manager not initialized"}

    server_statuses = mcp_manager.get_server_status()
    healthy_servers = [name for name, status in server_statuses.items() if status['status'] == 'running']

    return {
        "status": "healthy" if healthy_servers else "degraded",
        "service": "mcp-proxy",
        "version": "2.0.0",
        "servers": {
            "total": len(server_statuses),
            "running": len(healthy_servers),
            "statuses": server_statuses
        },
        "auth_enabled": ENABLE_AUTH,
        "tenant_id": TENANT_ID
    }

@app.get("/servers")
async def list_servers():
    """List all MCP servers and their status"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    return mcp_manager.get_server_status()

@app.post("/servers")
async def add_server(config: Dict[str, Any]):
    """
    Add a new MCP server from JSON configuration.

    Supports two formats:
    1. Flat format: {"name": "kubernetes", "command": "npx", "args": ["-y", "kubernetes-mcp-server@latest"]}
    2. Claude Desktop format: {"mcpServers": {"kubernetes": {"command": "npx", "args": ["-y", "..."]}}}
    """
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        # Validation is now done in mcp_manager.add_server() which handles both formats
        result = await mcp_manager.add_server(config)
        logger.info(f"Added new MCP server: {result.get('name', 'unknown')}")
        return {"success": True, "server": result}
    except ValueError as e:
        # Validation errors
        logger.warning(f"Invalid MCP server config: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to add MCP server: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/servers/{server_id}/start")
async def start_server(server_id: str):
    """Start an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.start_server(server_id)
        logger.info(f"Started MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} started"}
    except Exception as e:
        logger.error(f"Failed to start MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/servers/{server_id}/stop")
async def stop_server(server_id: str):
    """Stop an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.stop_server(server_id)
        logger.info(f"Stopped MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} stopped"}
    except Exception as e:
        logger.error(f"Failed to stop MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/servers/{server_id}/restart")
async def restart_server(server_id: str):
    """Restart an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.restart_server(server_id)
        logger.info(f"Restarted MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} restarted"}
    except Exception as e:
        logger.error(f"Failed to restart MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/servers/{server_id}")
async def delete_server(server_id: str):
    """Delete an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.delete_server(server_id)
        logger.info(f"Deleted MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} deleted"}
    except Exception as e:
        logger.error(f"Failed to delete MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Request model for server enable/disable
class ServerEnabledRequest(BaseModel):
    enabled: bool


@app.patch("/servers/{server_id}/enabled")
async def set_server_enabled(
    server_id: str,
    request: ServerEnabledRequest,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """
    Enable or disable an MCP server at runtime.

    - enabled=true: Enables the server and starts it if not running
    - enabled=false: Disables the server and stops it if running

    State is persisted to Redis so it survives restarts.
    Requires admin privileges.
    """
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    # Require admin privileges
    is_admin = user_info.get('is_admin', False) if user_info else False
    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Admin privileges required to enable/disable MCP servers"
        )

    try:
        result = await mcp_manager.set_server_enabled(server_id, request.enabled)
        logger.info(f"Server {server_id} enabled={request.enabled} by {user_info.get('user_name', 'unknown')}")
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to set enabled state for {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/servers/{server_id}/enabled")
async def get_server_enabled(server_id: str):
    """Get the enabled state of a specific MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        enabled = mcp_manager.get_server_enabled(server_id)
        return {"server_id": server_id, "enabled": enabled}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/servers/enabled")
async def list_servers_enabled():
    """List enabled states for all MCP servers"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    return {
        "servers": mcp_manager.list_server_enabled_states()
    }

async def _list_all_tools_impl(user_info: Optional[Dict[str, Any]] = None):
    """Internal implementation for listing all tools with RBAC filtering"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    user_name = user_info.get('user_name', 'anonymous') if user_info else 'anonymous'
    is_admin = user_info.get('is_admin', False) if user_info else False
    user_groups = user_info.get('groups', []) if user_info else []

    logger.info(f"Listing tools for user: {user_name} (admin: {is_admin}, groups: {user_groups})")

    all_tools = await mcp_manager.list_all_tools()

    # Fetch access policies for user's groups
    access_policies = await fetch_user_mcp_access_policies(user_groups)

    # Filter tools based on access policies
    filtered_tools = {}

    for server_name, tools in all_tools.items():
        # Check if user can access this server
        if check_server_access(server_name, user_groups, access_policies, is_admin):
            filtered_tools[server_name] = tools
            logger.info(f"Including {len(tools)} tools from server: {server_name}")
        else:
            logger.info(f"Filtering server '{server_name}' for user: {user_name}")

    # Flatten into a single list with server attribution
    tools_list = []
    for server_name, tools in filtered_tools.items():
        for tool in tools:
            tool_info = {
                "server": server_name,
                **tool
            }
            tools_list.append(tool_info)

    logger.info(f"Found {len(tools_list)} tools across {len(filtered_tools)} servers for user: {user_name}")

    return {
        "tools": tools_list,
        "by_server": filtered_tools,
        "total_count": len(tools_list),
        "server_count": len(filtered_tools),
        "metadata": {
            "user": user_name,
            "is_admin": is_admin,
            "groups": user_groups,
            "access_policies_applied": len(access_policies),
            "total_servers_available": len(all_tools),
            "total_servers_accessible": len(filtered_tools)
        }
    }

@app.get("/tools")
async def list_all_tools(user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List all tools from all running MCP servers"""
    return await _list_all_tools_impl(user_info)

@app.get("/v1/mcp/tools")
async def list_all_tools_v1(user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List all tools from all running MCP servers (OpenAI-compatible endpoint)"""
    return await _list_all_tools_impl(user_info)

@app.get("/servers/{server_name}/tools")
async def list_server_tools(server_name: str, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List tools from a specific MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    if server_name not in mcp_manager.servers:
        raise HTTPException(status_code=404, detail=f"Server {server_name} not found")

    try:
        request_data = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {}
        }

        result = await mcp_manager.route_request(server_name, request_data)

        return {
            "server": server_name,
            "tools": result.get('result', {}).get('tools', [])
        }

    except Exception as e:
        logger.error(f"Failed to list tools from {server_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# === USER SESSION MANAGEMENT ===

class UserSessionStartRequest(BaseModel):
    user_id: str
    email: str
    access_token: str

class UserSessionStopRequest(BaseModel):
    user_id: str

@app.post("/user-sessions/start")
async def start_user_session(request: UserSessionStartRequest, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """Start a per-user Azure MCP session with OBO authentication"""
    try:
        session_manager = get_user_session_manager()
        result = await session_manager.start_user_session(
            user_id=request.user_id,
            email=request.email,
            access_token=request.access_token
        )
        return result
    except Exception as e:
        logger.error(f"Failed to start user session for {request.user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/user-sessions/stop")
async def stop_user_session(request: UserSessionStopRequest, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """Stop a per-user Azure MCP session"""
    try:
        session_manager = get_user_session_manager()
        success = await session_manager.stop_user_session(request.user_id)
        return {"success": success, "user_id": request.user_id}
    except Exception as e:
        logger.error(f"Failed to stop user session for {request.user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/user-sessions")
async def list_user_sessions(user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List all active user sessions"""
    try:
        session_manager = get_user_session_manager()
        sessions = await session_manager.list_sessions()
        return {"sessions": sessions, "count": len(sessions)}
    except Exception as e:
        logger.error(f"Failed to list user sessions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/user-sessions/{user_id}")
async def get_user_session(user_id: str, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """Get a specific user's session info including their Azure MCP tools"""
    try:
        session_manager = get_user_session_manager()
        session = await session_manager.get_session(user_id)
        if not session:
            raise HTTPException(status_code=404, detail=f"No session found for user {user_id}")
        return {
            "user_id": session.user_id,
            "email": session.email,
            "created_at": session.created_at.isoformat(),
            "last_accessed": session.last_accessed_at.isoformat(),
            "is_alive": session.is_alive(),
            "tool_count": len(session.tools) if session.tools else 0,
            "tools": session.tools or [],  # Include the actual tools for LLM discovery
            "pid": session.process.pid if session.process else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user session for {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# === AZURE AD OAUTH ENDPOINTS ===

@app.get("/auth/login")
async def auth_login():
    """Initiate Azure AD OAuth login flow"""
    try:
        if not oauth_service:
            raise HTTPException(status_code=500, detail="OAuth service not initialized")

        # Generate auth URL with PKCE
        auth_data = oauth_service.generate_auth_url()

        # Redirect user to Azure AD login
        return RedirectResponse(url=auth_data["auth_url"])

    except Exception as e:
        logger.error(f"Failed to initiate login: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/auth/callback")
async def auth_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """Handle Azure AD OAuth callback"""
    try:
        if error:
            logger.error(f"OAuth error: {error}")
            # Redirect to UI with error
            return RedirectResponse(url=f"/?error={error}")

        if not code or not state:
            raise HTTPException(status_code=400, detail="Missing code or state parameter")

        if not oauth_service:
            raise HTTPException(status_code=500, detail="OAuth service not initialized")

        # Exchange code for tokens
        tokens = oauth_service.exchange_code_for_token(code, state)

        # Extract user info from tokens
        user_info = oauth_service.extract_user_info(tokens)

        # Create session
        session_id = oauth_service.create_session(user_info)

        # Automatically start per-user Azure MCP session
        session_manager = get_user_session_manager()
        try:
            await session_manager.start_user_session(
                user_id=user_info["user_id"],
                email=user_info["email"],
                access_token=user_info["access_token"]
            )
            logger.info(f"✅ Auto-started Azure MCP session for {user_info['email']}")
        except Exception as mcp_error:
            logger.error(f"Failed to start Azure MCP session: {str(mcp_error)}")
            # Continue anyway - user can manually start session

        # Redirect to UI with session cookie
        response = RedirectResponse(url="/", status_code=302)
        response.set_cookie(
            key="mcp_session",
            value=session_id,
            httponly=True,
            max_age=86400,  # 24 hours
            samesite="lax"
        )

        return response

    except Exception as e:
        logger.error(f"OAuth callback failed: {str(e)}")
        return RedirectResponse(url=f"/?error=auth_failed")


@app.get("/auth/me")
async def auth_me(mcp_session: Optional[str] = Cookie(None)):
    """Get current user info from session"""
    try:
        if not mcp_session:
            raise HTTPException(status_code=401, detail="Not authenticated")

        if not oauth_service:
            raise HTTPException(status_code=500, detail="OAuth service not initialized")

        session_data = oauth_service.get_session(mcp_session)

        if not session_data:
            raise HTTPException(status_code=401, detail="Invalid or expired session")

        return {
            "user_id": session_data["user_id"],
            "email": session_data["email"],
            "name": session_data["name"],
            "tenant_id": session_data["tenant_id"]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user info: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/logout")
async def auth_logout(response: Response, mcp_session: Optional[str] = Cookie(None)):
    """Logout and destroy session"""
    try:
        if mcp_session and oauth_service:
            # Stop user's Azure MCP session
            if oauth_service.get_session(mcp_session):
                session_data = oauth_service.get_session(mcp_session)
                user_id = session_data.get("user_id")

                if user_id:
                    session_manager = get_user_session_manager()
                    await session_manager.stop_user_session(user_id)
                    logger.info(f"Stopped Azure MCP session for user {user_id}")

            # Delete OAuth session
            oauth_service.delete_session(mcp_session)

        # Clear cookie
        response.delete_cookie("mcp_session")

        return {"success": True}

    except Exception as e:
        logger.error(f"Logout failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Pydantic model for manual token testing
class ManualSessionRequest(BaseModel):
    user_id: str
    email: str
    access_token: str


@app.post("/auth/manual-session")
async def create_manual_session(request: ManualSessionRequest):
    """
    Create a user session manually with an access token (for testing).
    This allows testing with tokens obtained from other sources.
    """
    try:
        session_manager = get_user_session_manager()

        # Start Azure MCP session with provided token
        result = await session_manager.start_user_session(
            user_id=request.user_id,
            email=request.email,
            access_token=request.access_token
        )

        logger.info(f"✅ Manual session created for {request.email}")

        return result

    except Exception as e:
        logger.error(f"Failed to create manual session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# === MCP TOOL EXECUTION ===

class MCPCallRequest(BaseModel):
    server: str
    tool: str
    arguments: Dict[str, Any] = {}

@app.post("/call")
async def call_mcp_tool(
    call_request: MCPCallRequest,
    http_request: Request,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """
    Simple endpoint to call MCP tools directly
    Used by intelligent learning system and other services
    """
    try:
        if not mcp_manager:
            raise HTTPException(status_code=503, detail="MCP Manager not initialized")

        # Create MCP request for tools/call
        mcp_request = MCPRequest(
            server=call_request.server,
            method="tools/call",
            params={
                "name": call_request.tool,
                "arguments": call_request.arguments
            }
        )

        # Check RBAC
        user_name = user_info.get('user_name', 'anonymous') if user_info else 'anonymous'
        is_admin = user_info.get('is_admin', False) if user_info else False

        # Admin-only servers
        # IMPORTANT: awp_admin is the actual server name for admin tools
        admin_servers = {'admin', 'awp_admin'}
        if call_request.server in admin_servers and not is_admin:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Admin privileges required to access '{call_request.server}' server."
            )

        # Execute tool call via route_request
        request_data = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": mcp_request.method,
            "params": mcp_request.params
        }

        # CRITICAL: Pass user's token for OBO authentication
        # Both Azure and AWS OBO use the Azure AD ID token (X-Azure-ID-Token header)
        # - Azure: ID token exchanged via Azure AD OBO flow for management.azure.com
        # - AWS: ID token exchanged via AWS Identity Center for STS credentials
        user_token = None
        if user_info and user_info.get('token') and user_info.get('token') != 'SYSTEM_SP_AUTH':
            # For OBO-enabled servers (Azure, AWS), use the ID token if available
            # The ID token has the app's client ID as audience, required for OBO exchange
            id_token = http_request.headers.get('X-Azure-ID-Token')

            if 'aws' in call_request.server.lower() or 'azure' in call_request.server.lower():
                # AWS and Azure servers need the ID token for OBO
                if id_token:
                    user_token = id_token
                    logger.info(f"[OBO] Using ID token for {call_request.server} OBO: {user_name}")
                else:
                    # Fall back to access token if no ID token provided
                    user_token = user_info['token']
                    logger.warning(f"[OBO] No ID token provided for {call_request.server}, falling back to access token (may fail OBO)")
            else:
                # Non-OBO servers use the access token
                user_token = user_info['token']
                logger.info(f"[OBO] Passing access token to {call_request.server}: {user_name}")
        else:
            logger.debug(f"No user token available for {call_request.server} - will use fallback credentials")

        result = await mcp_manager.route_request(call_request.server, request_data, user_token)

        return {
            "server": call_request.server,
            "tool": call_request.tool,
            "result": result
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Tool call failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# === EMBEDDINGS PROXY ===
# Proxies to the API's /api/embeddings endpoint which uses UniversalEmbeddingService
# This supports all configured embedding providers (Azure, AWS, Ollama, Vertex AI, etc.)

class EmbeddingRequest(BaseModel):
    model: Optional[str] = None
    input: Union[str, List[str]]
    encoding_format: Optional[str] = None
    dimensions: Optional[int] = None

@app.post("/v1/embeddings")
async def create_embeddings(request: EmbeddingRequest):
    """
    Generate embeddings by proxying to API's UniversalEmbeddingService.

    This endpoint proxies to the API's /api/embeddings endpoint which uses
    the configured embedding provider (Azure, AWS, Ollama, Vertex AI, etc.)
    based on environment variables.

    No hardcoded models or providers here - all configuration comes from
    the API's UniversalEmbeddingService.
    """
    try:
        # Get API endpoint from environment (configurable)
        api_base_url = os.getenv('AGENTICWORK_API_URL', 'http://agenticworkchat-api:8000')
        embeddings_url = f"{api_base_url}/api/embeddings"

        async with httpx.AsyncClient(timeout=60.0) as client:
            # Build request payload
            payload = {'input': request.input}
            if request.model:
                payload['model'] = request.model
            if request.encoding_format:
                payload['encoding_format'] = request.encoding_format
            if request.dimensions:
                payload['dimensions'] = request.dimensions

            response = await client.post(
                embeddings_url,
                json=payload,
                headers={'Content-Type': 'application/json'}
            )

            if response.status_code != 200:
                logger.error(f"API embeddings error: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Embedding generation failed: {response.text}"
                )

            return response.json()

    except HTTPException:
        raise
    except httpx.ConnectError:
        logger.error(f"Cannot connect to API embeddings endpoint at {api_base_url}/api/embeddings")
        raise HTTPException(
            status_code=503,
            detail="Embedding service unavailable - cannot connect to API"
        )
    except Exception as e:
        logger.error(f"Embeddings generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# === INSPECTOR UI ===
# Reverse proxy to MCP Inspector on localhost:6274
# Must be LAST routes - catch-all for any paths not matched by API routes above

async def proxy_to_inspector(path: str, request: Request):
    """Helper function to proxy requests to MCP Inspector"""
    try:
        # Build target URL
        target_url = f"http://localhost:6274/{path}"

        # Copy query params
        if request.url.query:
            target_url += f"?{request.url.query}"

        logger.debug(f"[INSPECTOR] Proxying {request.url.path} -> {target_url}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Forward the request
            response = await client.get(
                target_url,
                headers={k: v for k, v in request.headers.items() if k.lower() not in ['host']},
                follow_redirects=True
            )

            # Return response with correct headers
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get('content-type')
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="MCP Inspector not available. Please wait for startup to complete.")
    except Exception as e:
        logger.error(f"Inspector proxy error for path '{path}': {e}")
        raise HTTPException(status_code=500, detail=f"Inspector proxy error: {str(e)}")

@app.get("/")
async def inspector_ui_root(request: Request):
    """Serve MCP Inspector UI root - proxy to localhost:6274"""
    return await proxy_to_inspector("", request)

@app.get("/{path:path}")
async def inspector_ui_proxy_all(path: str, request: Request):
    """
    Reverse proxy all other requests to MCP Inspector
    This catches /assets/*, /inspector/*, and all non-API routes
    """
    return await proxy_to_inspector(path, request)

if __name__ == "__main__":
    logger.info("=== STARTING MCP PROXY SERVICE ===")
    logger.info(f"Auth Enabled: {ENABLE_AUTH}")
    logger.info(f"Tenant ID: {TENANT_ID}")
    logger.info(f"Port: {PORT}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info"
    )