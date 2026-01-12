/**
 * TypeScript type definitions for AgenticWorkCode Manager
 */

export interface UserSession {
  id: string;
  userId: string;
  pid: number;                    // Process ID
  workspacePath: string;
  model: string;
  createdAt: Date;
  lastActivity: Date;
  status: 'starting' | 'running' | 'stopped' | 'error';
}

export interface SessionStatus {
  id: string;
  status: string;
  running: boolean;
  userId?: string;
  model?: string;
  workspacePath?: string;
  createdAt?: Date;
  lastActivity?: Date;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface CreateSessionRequest {
  userId: string;
  workspacePath?: string;
  model?: string;
  storageLimitMb?: number;  // Per-user storage limit from admin settings
}

export interface SendMessageRequest {
  message: string;
}
