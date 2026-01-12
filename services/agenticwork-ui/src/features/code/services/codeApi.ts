/**
 * Code API Service
 * API client for AgenticWorkCode endpoints
 */

interface CodeSession {
  id: string;
  containerId: string;
  model: string;
  workspacePath: string;
  createdAt: string;
  lastActivity: string;
}

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  children?: FileNode[];
}

interface ExecuteOptions {
  sessionId: string;
  prompt: string;
  model?: string;
}

interface ApiError extends Error {
  status?: number;
}

class CodeApiService {
  private baseUrl: string;
  private getToken: () => Promise<string>;

  constructor(getToken: () => Promise<string>, baseUrl: string = '/api/code') {
    this.getToken = getToken;
    this.baseUrl = baseUrl;
  }

  private async getHeaders(): Promise<HeadersInit> {
    const token = await this.getToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error: ApiError = new Error(`API request failed: ${response.statusText}`);
      error.status = response.status;
      try {
        const errorData = await response.json();
        error.message = errorData.error || errorData.message || error.message;
      } catch {
        // Unable to parse error response
      }
      throw error;
    }

    return response.json();
  }

  /**
   * Create a new code session
   */
  async createSession(model?: string): Promise<CodeSession> {
    const headers = await this.getHeaders();
    const response = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model })
    });

    return this.handleResponse<CodeSession>(response);
  }

  /**
   * Get session details
   */
  async getSession(sessionId: string): Promise<CodeSession> {
    const headers = await this.getHeaders();
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      method: 'GET',
      headers
    });

    return this.handleResponse<CodeSession>(response);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const headers = await this.getHeaders();
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers
    });

    await this.handleResponse<void>(response);
  }

  /**
   * Execute a prompt (returns SSE stream)
   * Note: This returns the Response object for streaming
   */
  async executePrompt(options: ExecuteOptions): Promise<Response> {
    const headers = await this.getHeaders();
    const response = await fetch(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      throw new Error(`Execute request failed: ${response.statusText}`);
    }

    return response;
  }

  /**
   * List files in workspace
   */
  async listFiles(sessionId: string, path: string = '.'): Promise<FileNode[]> {
    const headers = await this.getHeaders();
    const response = await fetch(
      `${this.baseUrl}/files?sessionId=${sessionId}&path=${encodeURIComponent(path)}`,
      {
        method: 'GET',
        headers
      }
    );

    return this.handleResponse<FileNode[]>(response);
  }

  /**
   * Read file content
   */
  async readFile(sessionId: string, filePath: string): Promise<string> {
    const headers = await this.getHeaders();
    const response = await fetch(
      `${this.baseUrl}/files/${encodeURIComponent(filePath)}?sessionId=${sessionId}`,
      {
        method: 'GET',
        headers
      }
    );

    const data = await this.handleResponse<{ path: string; content: string }>(response);
    return data.content;
  }

  /**
   * Write file content
   */
  async writeFile(sessionId: string, filePath: string, content: string): Promise<void> {
    const headers = await this.getHeaders();
    const response = await fetch(
      `${this.baseUrl}/files/${encodeURIComponent(filePath)}?sessionId=${sessionId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ content })
      }
    );

    await this.handleResponse<void>(response);
  }

  /**
   * Delete file
   */
  async deleteFile(sessionId: string, filePath: string): Promise<void> {
    const headers = await this.getHeaders();
    const response = await fetch(
      `${this.baseUrl}/files/${encodeURIComponent(filePath)}?sessionId=${sessionId}`,
      {
        method: 'DELETE',
        headers
      }
    );

    await this.handleResponse<void>(response);
  }

  /**
   * Create terminal WebSocket URL
   */
  getTerminalWebSocketUrl(containerId: string, token: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}${this.baseUrl}/terminal?containerId=${containerId}&token=${token}`;
  }
}

// Export factory function
export function createCodeApiService(getToken: () => Promise<string>): CodeApiService {
  return new CodeApiService(getToken);
}

// Export types
export type {
  CodeSession,
  FileNode,
  ExecuteOptions,
  ApiError
};

export default CodeApiService;
