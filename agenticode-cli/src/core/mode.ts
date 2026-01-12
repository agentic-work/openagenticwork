/**
 * AgentiCode Mode Detection
 *
 * Determines whether AgentiCode is running in:
 * - STANDALONE: Direct terminal usage with full Ink UI
 * - MANAGED: Spawned by agenticode-manager, accessed via web terminal
 *
 * Both modes require authentication to agenticwork-api for:
 * - User context and permissions
 * - Model routing and configuration
 * - MCP tools access
 * - Context/memory management (Milvus/Redis)
 */

export type AgentiCodeMode = 'standalone' | 'managed';

export interface ModeConfig {
  mode: AgentiCodeMode;
  /** Whether running in a real TTY vs PTY */
  isTTY: boolean;
  /** Whether spawned by agenticode-manager */
  isManaged: boolean;
  /** Session ID if managed */
  sessionId?: string;
  /** User ID passed from manager */
  userId?: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string;
  /** API endpoint to use */
  apiEndpoint: string;
  /** Auth token if pre-authenticated */
  authToken?: string;
}

/**
 * Detect the current operating mode
 */
export function detectMode(): ModeConfig {
  // Check for managed mode indicators
  const isManaged = !!(
    process.env.AGENTICODE_MANAGED === '1' ||
    process.env.AGENTICODE_SESSION_ID ||
    process.env.CONTAINER_MODE === '1'
  );

  // TTY detection - real terminal or PTY from manager
  const isTTY = process.stdout.isTTY || (
    process.env.CONTAINER_MODE === '1' &&
    process.env.TERM === 'xterm-256color'
  );

  // API endpoint - manager passes this, or use env/default
  const apiEndpoint = process.env.AGENTICWORK_API_ENDPOINT ||
    process.env.AGENTICWORK_API_URL ||
    'http://localhost:8000';

  // Auth token - manager passes this for pre-authenticated sessions
  const authToken = process.env.AGENTICODE_AUTH_TOKEN ||
    process.env.AGENTICWORK_API_TOKEN;

  return {
    mode: isManaged ? 'managed' : 'standalone',
    isTTY,
    isManaged,
    sessionId: process.env.AGENTICODE_SESSION_ID,
    userId: process.env.AGENTICODE_USER_ID,
    tenantId: process.env.AGENTICODE_TENANT_ID,
    apiEndpoint,
    authToken,
  };
}

/**
 * Check if we have valid authentication
 */
export function hasAuth(config: ModeConfig): boolean {
  return !!(config.authToken);
}

/**
 * Get display mode name for UI
 */
export function getModeDisplayName(mode: AgentiCodeMode): string {
  return mode === 'standalone' ? 'Standalone' : 'Managed';
}
