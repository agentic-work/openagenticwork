/**
 * Local Session Persistence
 *
 * File-based persistence for offline/local use of agenticode.
 * Stores sessions in ~/.agenticode/sessions/
 *
 * Features:
 * - Auto-save after each message
 * - Resume last session with --continue
 * - List sessions with --sessions
 * - Per-directory session tracking
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import type { Message } from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface LocalSession {
  id: string;
  workingDirectory: string;
  model: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  title?: string;
  messageCount: number;
  tokenEstimate: number;
}

export interface SessionListItem {
  id: string;
  workingDirectory: string;
  model: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// =============================================================================
// Local Persistence Class
// =============================================================================

export class LocalPersistence {
  private sessionsDir: string;
  private currentSession: LocalSession | null = null;

  constructor() {
    this.sessionsDir = join(homedir(), '.agenticode', 'sessions');
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Generate a session ID based on working directory and timestamp
   */
  private generateSessionId(workingDirectory: string): string {
    const dirHash = createHash('md5').update(workingDirectory).digest('hex').slice(0, 8);
    const timestamp = Date.now().toString(36);
    return `${dirHash}-${timestamp}`;
  }

  /**
   * Get session file path
   */
  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  /**
   * Create a new session
   */
  createSession(workingDirectory: string, model: string): LocalSession {
    const session: LocalSession = {
      id: this.generateSessionId(workingDirectory),
      workingDirectory,
      model,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      tokenEstimate: 0,
    };

    this.currentSession = session;
    this.saveSession(session);
    return session;
  }

  /**
   * Load a session by ID
   */
  loadSession(sessionId: string): LocalSession | null {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) {
      return null;
    }

    try {
      const data = readFileSync(path, 'utf-8');
      const session = JSON.parse(data) as LocalSession;
      this.currentSession = session;
      return session;
    } catch (err) {
      console.error(`Failed to load session ${sessionId}:`, err);
      return null;
    }
  }

  /**
   * Save current session to disk
   */
  saveSession(session?: LocalSession): void {
    const s = session || this.currentSession;
    if (!s) return;

    s.updatedAt = new Date().toISOString();
    s.messageCount = s.messages.length;
    // Rough token estimate: ~4 chars per token
    s.tokenEstimate = s.messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);

    // Generate title from first user message if not set
    if (!s.title && s.messages.length > 0) {
      const firstUser = s.messages.find(m => m.role === 'user');
      if (firstUser) {
        const content = typeof firstUser.content === 'string'
          ? firstUser.content
          : JSON.stringify(firstUser.content);
        s.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      }
    }

    const path = this.getSessionPath(s.id);
    writeFileSync(path, JSON.stringify(s, null, 2));
  }

  /**
   * Add a message to the current session and save
   */
  addMessage(message: Message): void {
    if (!this.currentSession) return;
    this.currentSession.messages.push(message);
    this.saveSession();
  }

  /**
   * Update messages (for streaming updates)
   */
  updateMessages(messages: Message[]): void {
    if (!this.currentSession) return;
    this.currentSession.messages = messages;
    this.saveSession();
  }

  /**
   * Get the current session
   */
  getCurrentSession(): LocalSession | null {
    return this.currentSession;
  }

  /**
   * Get the last session for a working directory
   */
  getLastSessionForDirectory(workingDirectory: string): LocalSession | null {
    const sessions = this.listSessions();
    const matching = sessions
      .filter(s => s.workingDirectory === workingDirectory)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (matching.length === 0) return null;
    return this.loadSession(matching[0].id);
  }

  /**
   * Get the most recent session overall
   */
  getLastSession(): LocalSession | null {
    const sessions = this.listSessions();
    if (sessions.length === 0) return null;

    const sorted = sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return this.loadSession(sorted[0].id);
  }

  /**
   * List all sessions
   */
  listSessions(): SessionListItem[] {
    const sessions: SessionListItem[] = [];

    try {
      const files = readdirSync(this.sessionsDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const path = join(this.sessionsDir, file);
        try {
          const data = readFileSync(path, 'utf-8');
          const session = JSON.parse(data) as LocalSession;
          sessions.push({
            id: session.id,
            workingDirectory: session.workingDirectory,
            model: session.model,
            title: session.title || 'Untitled',
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messageCount,
          });
        } catch {
          // Skip corrupted session files
        }
      }
    } catch {
      // Sessions directory might not exist yet
    }

    return sessions;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) return false;

    try {
      unlinkSync(path);
      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up old sessions (keep last N per directory)
   */
  cleanupOldSessions(keepPerDirectory: number = 10): number {
    const sessions = this.listSessions();

    // Group by directory
    const byDirectory = new Map<string, SessionListItem[]>();
    for (const session of sessions) {
      const existing = byDirectory.get(session.workingDirectory) || [];
      existing.push(session);
      byDirectory.set(session.workingDirectory, existing);
    }

    let deleted = 0;

    // For each directory, keep only the most recent N
    for (const [_dir, dirSessions] of byDirectory) {
      const sorted = dirSessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      const toDelete = sorted.slice(keepPerDirectory);
      for (const session of toDelete) {
        if (this.deleteSession(session.id)) {
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Export session for sharing
   */
  exportSession(sessionId: string): string | null {
    const session = this.loadSession(sessionId);
    if (!session) return null;
    return JSON.stringify(session, null, 2);
  }

  /**
   * Import a session
   */
  importSession(json: string): LocalSession | null {
    try {
      const session = JSON.parse(json) as LocalSession;
      // Generate new ID to avoid conflicts
      session.id = this.generateSessionId(session.workingDirectory);
      this.saveSession(session);
      return session;
    } catch {
      return null;
    }
  }
}

/**
 * Singleton instance
 */
let instance: LocalPersistence | null = null;

export function getLocalPersistence(): LocalPersistence {
  if (!instance) {
    instance = new LocalPersistence();
  }
  return instance;
}

/**
 * Format session list for display
 */
export function formatSessionList(sessions: SessionListItem[]): string {
  if (sessions.length === 0) {
    return 'No saved sessions found.';
  }

  const sorted = sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const lines = ['Recent Sessions:', ''];

  for (const session of sorted.slice(0, 20)) {
    const date = new Date(session.updatedAt);
    const relative = getRelativeTime(date);
    const dir = session.workingDirectory.replace(homedir(), '~');

    lines.push(`  ${session.id}`);
    lines.push(`    ${session.title}`);
    lines.push(`    ${dir} | ${session.model} | ${session.messageCount} msgs | ${relative}`);
    lines.push('');
  }

  if (sorted.length > 20) {
    lines.push(`  ... and ${sorted.length - 20} more sessions`);
  }

  lines.push('');
  lines.push('Use --resume <id> to continue a session');

  return lines.join('\n');
}

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
