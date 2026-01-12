/**
 * Session Persistence Layer
 * Integrates with AgenticWork's Redis, PostgreSQL, and Milvus
 * Provides unlimited context via knowledge base and memory summarization
 */

import type { Message, ToolCall } from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface AgenticSession {
  id: string;
  userId: string;
  tenantId: string;
  workingDirectory: string;
  model: string;
  status: 'active' | 'idle' | 'paused' | 'terminated';
  createdAt: Date;
  lastActivityAt: Date;
  tokenCount: number;
  messageCount: number;
  toolCallCount: number;
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  clientVersion: string;
  hostname?: string;
  platform?: string;
  gitBranch?: string;
  gitCommit?: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  tokenCount: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  id: string;
  sessionId: string;
  content: string;
  messageRange: { start: number; end: number };
  tokenCount: number;
  createdAt: Date;
}

export interface ContextMemory {
  id: string;
  userId: string;
  tenantId: string;
  content: string;
  embedding: number[];
  type: 'fact' | 'preference' | 'skill' | 'project' | 'code_pattern';
  source: 'session' | 'manual' | 'inferred';
  sessionId?: string;
  relevanceScore: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface PersistenceConfig {
  redisUrl: string;
  postgresUrl: string;
  milvusUrl: string;
  apiKey?: string;
}

// =============================================================================
// Persistence Client
// =============================================================================

/**
 * Client for session persistence via AgenticWork API
 * Handles Redis (live state), PostgreSQL (history), Milvus (knowledge)
 */
export class PersistenceClient {
  private config: PersistenceConfig;
  private apiEndpoint: string;

  constructor(apiEndpoint: string, config?: Partial<PersistenceConfig>) {
    this.apiEndpoint = apiEndpoint;
    this.config = {
      redisUrl: config?.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      postgresUrl: config?.postgresUrl || process.env.DATABASE_URL || '',
      milvusUrl: config?.milvusUrl || process.env.MILVUS_URL || 'http://localhost:19530',
      apiKey: config?.apiKey,
    };
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Create or resume a session
   */
  async createSession(params: {
    userId: string;
    tenantId: string;
    workingDirectory: string;
    model: string;
    metadata?: SessionMetadata;
  }): Promise<AgenticSession> {
    const response = await this.request<AgenticSession>('/api/agentic/sessions', {
      method: 'POST',
      body: params,
    });
    return response;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<AgenticSession | null> {
    try {
      return await this.request<AgenticSession>(`/api/agentic/sessions/${sessionId}`);
    } catch {
      return null;
    }
  }

  /**
   * Update session state
   */
  async updateSession(sessionId: string, updates: Partial<AgenticSession>): Promise<void> {
    await this.request(`/api/agentic/sessions/${sessionId}`, {
      method: 'PATCH',
      body: updates,
    });
  }

  /**
   * List active sessions for admin view
   */
  async listSessions(params?: {
    userId?: string;
    tenantId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ sessions: AgenticSession[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.userId) query.set('userId', params.userId);
    if (params?.tenantId) query.set('tenantId', params.tenantId);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    return await this.request(`/api/agentic/sessions?${query}`);
  }

  /**
   * Terminate a session (admin action)
   */
  async terminateSession(sessionId: string): Promise<void> {
    await this.request(`/api/agentic/sessions/${sessionId}/terminate`, {
      method: 'POST',
    });
  }

  /**
   * Get session screenshot (for admin monitoring)
   */
  async getSessionScreenshot(sessionId: string): Promise<string | null> {
    try {
      const response = await this.request<{ screenshot: string }>(
        `/api/agentic/sessions/${sessionId}/screenshot`
      );
      return response.screenshot;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Message History
  // ===========================================================================

  /**
   * Save a message to the session history
   */
  async saveMessage(message: Omit<SessionMessage, 'id' | 'createdAt'>): Promise<SessionMessage> {
    return await this.request<SessionMessage>('/api/agentic/messages', {
      method: 'POST',
      body: message,
    });
  }

  /**
   * Get message history for a session
   */
  async getMessages(sessionId: string, params?: {
    limit?: number;
    offset?: number;
    before?: Date;
  }): Promise<SessionMessage[]> {
    const query = new URLSearchParams();
    query.set('sessionId', sessionId);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    if (params?.before) query.set('before', params.before.toISOString());

    const response = await this.request<{ messages: SessionMessage[] }>(
      `/api/agentic/messages?${query}`
    );
    return response.messages;
  }

  /**
   * Save a session summary (for context windowing)
   */
  async saveSummary(summary: Omit<SessionSummary, 'id' | 'createdAt'>): Promise<SessionSummary> {
    return await this.request<SessionSummary>('/api/agentic/summaries', {
      method: 'POST',
      body: summary,
    });
  }

  /**
   * Get summaries for a session
   */
  async getSummaries(sessionId: string): Promise<SessionSummary[]> {
    const response = await this.request<{ summaries: SessionSummary[] }>(
      `/api/agentic/summaries?sessionId=${sessionId}`
    );
    return response.summaries;
  }

  // ===========================================================================
  // Knowledge Base (Milvus)
  // ===========================================================================

  /**
   * Store a memory/fact in the knowledge base
   */
  async storeMemory(memory: Omit<ContextMemory, 'id' | 'embedding' | 'createdAt' | 'lastAccessedAt'>): Promise<ContextMemory> {
    return await this.request<ContextMemory>('/api/agentic/memories', {
      method: 'POST',
      body: memory,
    });
  }

  /**
   * Search for relevant memories using semantic search
   */
  async searchMemories(params: {
    userId: string;
    tenantId: string;
    query: string;
    types?: ContextMemory['type'][];
    limit?: number;
    minScore?: number;
  }): Promise<ContextMemory[]> {
    const response = await this.request<{ memories: ContextMemory[] }>(
      '/api/agentic/memories/search',
      {
        method: 'POST',
        body: params,
      }
    );
    return response.memories;
  }

  /**
   * Get shared knowledge for a tenant (company-wide facts)
   */
  async getSharedKnowledge(tenantId: string, params?: {
    types?: ContextMemory['type'][];
    limit?: number;
  }): Promise<ContextMemory[]> {
    const query = new URLSearchParams();
    query.set('tenantId', tenantId);
    if (params?.types) query.set('types', params.types.join(','));
    if (params?.limit) query.set('limit', String(params.limit));

    const response = await this.request<{ memories: ContextMemory[] }>(
      `/api/agentic/memories/shared?${query}`
    );
    return response.memories;
  }

  // ===========================================================================
  // Context Window Metrics (for admin monitoring)
  // ===========================================================================

  /**
   * Report context window metrics
   */
  async reportContextMetrics(sessionId: string, metrics: {
    totalTokens: number;
    contextLimit: number;
    usagePercent: number;
    messagesCount: number;
    summariesCount: number;
    memoriesUsed: number;
  }): Promise<void> {
    await this.request(`/api/agentic/sessions/${sessionId}/metrics`, {
      method: 'POST',
      body: { type: 'context', ...metrics },
    });
  }

  /**
   * Get aggregated context metrics for admin dashboard
   */
  async getContextMetrics(params?: {
    tenantId?: string;
    timeRange?: 'hour' | 'day' | 'week';
  }): Promise<{
    avgUsage: number;
    totalTokens: number;
    summarizations: number;
    sessions: number;
  }> {
    const query = new URLSearchParams();
    if (params?.tenantId) query.set('tenantId', params.tenantId);
    if (params?.timeRange) query.set('timeRange', params.timeRange);

    return await this.request(`/api/agentic/metrics/context?${query}`);
  }

  // ===========================================================================
  // Live State (Redis)
  // ===========================================================================

  /**
   * Update live session state in Redis (for real-time monitoring)
   */
  async updateLiveState(sessionId: string, state: {
    status: AgenticSession['status'];
    currentActivity?: string;
    lastOutput?: string;
    screenshot?: string;
  }): Promise<void> {
    await this.request(`/api/agentic/sessions/${sessionId}/live`, {
      method: 'PUT',
      body: state,
    });
  }

  /**
   * Get live state for a session
   */
  async getLiveState(sessionId: string): Promise<{
    status: AgenticSession['status'];
    currentActivity?: string;
    lastOutput?: string;
    screenshot?: string;
    lastUpdate: Date;
  } | null> {
    try {
      return await this.request(`/api/agentic/sessions/${sessionId}/live`);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // HTTP Client
  // ===========================================================================

  private async request<T>(path: string, options: {
    method?: string;
    body?: unknown;
  } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.apiEndpoint}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }
}

/**
 * Create persistence client from environment
 */
export function createPersistenceClient(apiEndpoint?: string): PersistenceClient {
  return new PersistenceClient(
    apiEndpoint || process.env.AGENTIC_API_ENDPOINT || 'http://localhost:3001'
  );
}
