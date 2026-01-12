/**
 * Human-In-The-Loop (HITL) System
 * Requires user confirmation before executing potentially destructive actions
 */

// Patterns that require confirmation before execution
export const DESTRUCTIVE_PATTERNS = {
  // File operations
  deleteFile: /\b(rm|del|unlink)\s/i,
  removeDirectory: /\b(rm\s+-r|rmdir|rd)\b/i,
  overwriteFile: />\s*[^|]/,  // Redirect overwrite (not pipe)
  moveFile: /\bmv\s/,

  // Git operations
  gitForce: /\bgit\s+.*--force\b/,
  gitReset: /\bgit\s+reset\s+--hard/,
  gitClean: /\bgit\s+clean\s+-[dfx]/,
  gitPush: /\bgit\s+push/,
  gitCheckout: /\bgit\s+checkout\s+/,

  // Database operations
  dropDatabase: /\bdrop\s+(database|table|schema)\b/i,
  truncateTable: /\btruncate\s+table\b/i,
  deleteFrom: /\bdelete\s+from\b/i,

  // Docker operations
  dockerRm: /\bdocker\s+(rm|rmi|system\s+prune)\b/,
  dockerStop: /\bdocker\s+stop\b/,

  // Kubernetes operations
  kubectlDelete: /\bkubectl\s+delete\b/,

  // Package operations
  npmUninstall: /\bnpm\s+(uninstall|remove|rm)\b/,

  // Cloud operations
  awsDelete: /\baws\s+.*delete\b/,
  azDelete: /\baz\s+.*delete\b/,
  gcDelete: /\bgcloud\s+.*delete\b/,
};

// Categories of destructive actions for better UX
export type DestructiveCategory =
  | 'file_delete'
  | 'file_modify'
  | 'git_destructive'
  | 'git_publish'
  | 'database'
  | 'docker'
  | 'kubernetes'
  | 'cloud'
  | 'package';

export interface DestructiveAction {
  category: DestructiveCategory;
  tool: string;
  description: string;
  command?: string;
  filePath?: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Check if a command/tool call requires HITL confirmation
 */
export function requiresConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  yoloMode: boolean = false
): DestructiveAction | null {
  // YOLO mode bypasses all confirmations (dangerous!)
  if (yoloMode) {
    return null;
  }

  // Check shell commands
  if (toolName === 'shell' && args.command) {
    const command = String(args.command);

    for (const [patternName, pattern] of Object.entries(DESTRUCTIVE_PATTERNS)) {
      if (pattern.test(command)) {
        return categorizeDestructiveAction(patternName, 'shell', command);
      }
    }
  }

  // Check file operations
  if (toolName === 'write_file') {
    const filePath = String(args.path || args.file_path || '');
    // Writing to existing files that look important
    if (/\.(env|config|json|yaml|yml|toml|ini)$/i.test(filePath)) {
      return {
        category: 'file_modify',
        tool: toolName,
        description: `Modifying configuration file: ${filePath}`,
        filePath,
        risk: 'medium',
      };
    }
  }

  if (toolName === 'delete_file') {
    return {
      category: 'file_delete',
      tool: toolName,
      description: `Deleting file: ${args.path || args.file_path}`,
      filePath: String(args.path || args.file_path || ''),
      risk: 'medium',
    };
  }

  return null;
}

/**
 * Categorize a destructive action based on pattern match
 */
function categorizeDestructiveAction(
  patternName: string,
  tool: string,
  command: string
): DestructiveAction {
  const categories: Record<string, { category: DestructiveCategory; risk: 'low' | 'medium' | 'high' | 'critical' }> = {
    deleteFile: { category: 'file_delete', risk: 'medium' },
    removeDirectory: { category: 'file_delete', risk: 'high' },
    overwriteFile: { category: 'file_modify', risk: 'low' },
    moveFile: { category: 'file_modify', risk: 'low' },
    gitForce: { category: 'git_destructive', risk: 'critical' },
    gitReset: { category: 'git_destructive', risk: 'critical' },
    gitClean: { category: 'git_destructive', risk: 'high' },
    gitPush: { category: 'git_publish', risk: 'medium' },
    gitCheckout: { category: 'git_destructive', risk: 'medium' },
    dropDatabase: { category: 'database', risk: 'critical' },
    truncateTable: { category: 'database', risk: 'critical' },
    deleteFrom: { category: 'database', risk: 'high' },
    dockerRm: { category: 'docker', risk: 'medium' },
    dockerStop: { category: 'docker', risk: 'low' },
    kubectlDelete: { category: 'kubernetes', risk: 'high' },
    npmUninstall: { category: 'package', risk: 'low' },
    awsDelete: { category: 'cloud', risk: 'critical' },
    azDelete: { category: 'cloud', risk: 'critical' },
    gcDelete: { category: 'cloud', risk: 'critical' },
  };

  const config = categories[patternName] || { category: 'file_modify' as DestructiveCategory, risk: 'medium' as const };

  return {
    category: config.category,
    tool,
    description: getActionDescription(patternName, command),
    command,
    risk: config.risk,
  };
}

/**
 * Get human-readable description for a destructive action
 */
function getActionDescription(patternName: string, command: string): string {
  const descriptions: Record<string, string> = {
    deleteFile: 'Delete file(s)',
    removeDirectory: 'Remove directory recursively',
    overwriteFile: 'Overwrite file',
    moveFile: 'Move/rename file',
    gitForce: 'Force push to Git repository',
    gitReset: 'Hard reset Git repository',
    gitClean: 'Clean untracked Git files',
    gitPush: 'Push changes to remote',
    gitCheckout: 'Switch Git branch/discard changes',
    dropDatabase: 'Drop database/table',
    truncateTable: 'Truncate database table',
    deleteFrom: 'Delete database records',
    dockerRm: 'Remove Docker container/image',
    dockerStop: 'Stop Docker container',
    kubectlDelete: 'Delete Kubernetes resource',
    npmUninstall: 'Uninstall npm package',
    awsDelete: 'Delete AWS resource',
    azDelete: 'Delete Azure resource',
    gcDelete: 'Delete Google Cloud resource',
  };

  const base = descriptions[patternName] || 'Potentially destructive action';

  // Truncate command for display
  const shortCommand = command.length > 50 ? command.substring(0, 47) + '...' : command;

  return `${base}: ${shortCommand}`;
}

/**
 * Get risk level color for UI
 */
export function getRiskColor(risk: 'low' | 'medium' | 'high' | 'critical'): string {
  switch (risk) {
    case 'low': return '#10B981';      // Green
    case 'medium': return '#F59E0B';   // Yellow/Amber
    case 'high': return '#EF4444';     // Red
    case 'critical': return '#DC2626'; // Dark Red
  }
}

/**
 * Get risk level icon (Nerd Font)
 */
export function getRiskIcon(risk: 'low' | 'medium' | 'high' | 'critical'): string {
  switch (risk) {
    case 'low': return '\uf071';      // nf-fa-exclamation_triangle
    case 'medium': return '\uf071';   // nf-fa-exclamation_triangle
    case 'high': return '\uf06a';     // nf-fa-exclamation_circle
    case 'critical': return '\uf057'; // nf-fa-times_circle
  }
}
