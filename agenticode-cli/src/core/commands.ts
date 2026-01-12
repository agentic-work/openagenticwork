/**
 * AgentiCode Slash Commands
 *
 * Slash commands for common operations.
 * Commands are prefixed with / and can take arguments.
 *
 * Built-in commands:
 * - /help, /?      - Show help
 * - /clear, /c     - Clear conversation
 * - /compact       - Compact context (via API)
 * - /cost          - Show token usage and cost estimate
 * - /model, /m     - Show or set current model
 * - /models        - List available models
 * - /init          - Initialize project context (AGENTICODE.md)
 * - /memory        - Show/manage context memory
 * - /doctor        - Diagnose connection issues
 * - /history       - Show conversation history
 * - /resume, /r    - Resume a previous conversation
 * - /quit, /q      - Exit
 */

import type { ChatSession } from './session.js';
import type { AuthClient } from './auth-client.js';

// Model pricing (per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'o1-preview': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3.5-sonnet': { input: 3, output: 15 },
  'gemini-pro': { input: 0.5, output: 1.5 },
  'gemini-pro-vision': { input: 0.5, output: 1.5 },
  'gemini-1.5-pro': { input: 7, output: 21 },
  'gemini-1.5-flash': { input: 0.35, output: 1.05 },
  'gemini-2.0-flash': { input: 0, output: 0 }, // Free tier
  'gemma3': { input: 0, output: 0 }, // Local (Ollama)
  'gpt-oss': { input: 0, output: 0 }, // Local (Ollama)
};

/**
 * Calculate cost for a model based on token usage
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first
  let pricing = MODEL_PRICING[model];

  // Try partial match (e.g., "gpt-4o-2024-05-13" -> "gpt-4o")
  if (!pricing) {
    for (const [key, value] of Object.entries(MODEL_PRICING)) {
      if (model.toLowerCase().includes(key.toLowerCase())) {
        pricing = value;
        break;
      }
    }
  }

  // Default to zero (unknown or local model)
  if (!pricing) {
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export interface CommandContext {
  session: ChatSession;
  authClient?: AuthClient;
  workingDirectory: string;
  currentModel: string;
  onModelChange: (model: string) => void;
  onClear: () => void;
  onExit: () => void;
}

export interface CommandResult {
  /** Output to display */
  output: string;
  /** Whether to continue processing (false = exit) */
  continue: boolean;
  /** Whether this was a valid command */
  handled: boolean;
  /** New model if changed */
  newModel?: string;
}

export type CommandHandler = (
  args: string[],
  ctx: CommandContext
) => Promise<CommandResult> | CommandResult;

// Registry of commands
const commands: Map<string, { handler: CommandHandler; description: string; aliases?: string[] }> = new Map();

/**
 * Register a command
 */
export function registerCommand(
  name: string,
  handler: CommandHandler,
  description: string,
  aliases?: string[]
): void {
  commands.set(name, { handler, description, aliases });
  // Also register aliases
  if (aliases) {
    for (const alias of aliases) {
      commands.set(alias, { handler, description, aliases: [name] });
    }
  }
}

/**
 * Execute a slash command
 */
export async function executeCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  // Parse command and args
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { output: '', continue: true, handled: false };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1);

  const cmd = commands.get(cmdName);
  if (!cmd) {
    return {
      output: `Unknown command: /${cmdName}. Type /help for available commands.`,
      continue: true,
      handled: true,
    };
  }

  return cmd.handler(args, ctx);
}

/**
 * Check if input is a command
 */
export function isCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/**
 * Get command completions for autocomplete
 */
export function getCommandCompletions(partial: string): string[] {
  const search = partial.toLowerCase().replace(/^\//, '');
  const matches: string[] = [];

  for (const [name, cmd] of commands) {
    if (name.startsWith(search) && !cmd.aliases?.includes(name)) {
      matches.push(`/${name}`);
    }
  }

  return matches.sort();
}

// ============================================
// Built-in Commands
// ============================================

// /help, /?
registerCommand('help', (_args, _ctx) => {
  const lines: string[] = [
    'AgentiCode Commands:',
    '',
    '  /help, /?           Show this help message',
    '  /clear, /c          Clear conversation history',
    '  /compact            Compact context to reduce token usage',
    '  /cost               Show token usage and estimated cost',
    '  /model, /m [name]   Show or set current model',
    '  /models             List available models',
    '  /skill, /skills     Manage agent skills',
    '  /init               Initialize project context (AGENTICODE.md)',
    '  /memory             Show context memory status',
    '  /doctor             Diagnose connection and configuration',
    '  /history            Show conversation history',
    '  /resume, /r [id]    Resume a previous conversation',
    '  /quit, /q           Exit AgentiCode',
    '',
    'Keyboard shortcuts:',
    '  Ctrl+C              Cancel current request / Exit',
    '  Shift+Enter         Multi-line input',
    '  Up/Down             Navigate history',
  ];

  return { output: lines.join('\n'), continue: true, handled: true };
}, 'Show help', ['?', 'h']);

// /clear, /c
registerCommand('clear', (_args, ctx) => {
  ctx.session.clearHistory();
  ctx.onClear();
  return { output: 'Conversation cleared.', continue: true, handled: true };
}, 'Clear conversation', ['c']);

// /quit, /q
registerCommand('quit', (_args, ctx) => {
  ctx.onExit();
  return { output: 'Goodbye!', continue: false, handled: true };
}, 'Exit', ['q', 'exit']);

// /model, /m
registerCommand('model', (args, ctx) => {
  if (args.length === 0) {
    return {
      output: `Current model: ${ctx.currentModel}`,
      continue: true,
      handled: true,
    };
  }

  const newModel = args[0];
  ctx.session.setModel(newModel);
  ctx.onModelChange(newModel);

  return {
    output: `Model set to: ${newModel}`,
    continue: true,
    handled: true,
    newModel,
  };
}, 'Show or set model', ['m']);

// /models
registerCommand('models', async (_args, ctx) => {
  const models = ctx.authClient?.getAvailableModels() || [];

  if (models.length === 0) {
    return {
      output: 'No models available. Check your API connection.',
      continue: true,
      handled: true,
    };
  }

  const lines = ['Available Models:', ''];
  for (const model of models) {
    const marker = model === ctx.currentModel ? ' ◀ current' : '';
    lines.push(`  ${model}${marker}`);
  }
  lines.push('', 'Use /model <name> to switch models');

  return { output: lines.join('\n'), continue: true, handled: true };
}, 'List available models');

// /cost
registerCommand('cost', (_args, ctx) => {
  const stats = ctx.session.getContextStats();
  const tokenStats = ctx.session.getTokenStats();

  // Calculate cost
  const cost = calculateCost(ctx.currentModel, tokenStats.inputTokens, tokenStats.outputTokens);
  const costStr = cost > 0 ? `$${cost.toFixed(4)}` : 'Free (local model)';

  // Estimate if only total is available
  let breakdown = '';
  if (tokenStats.inputTokens > 0 || tokenStats.outputTokens > 0) {
    const inputCost = calculateCost(ctx.currentModel, tokenStats.inputTokens, 0);
    const outputCost = calculateCost(ctx.currentModel, 0, tokenStats.outputTokens);
    breakdown = `\nBreakdown:\n  Input:  ${tokenStats.inputTokens.toLocaleString()} tokens → $${inputCost.toFixed(4)}\n  Output: ${tokenStats.outputTokens.toLocaleString()} tokens → $${outputCost.toFixed(4)}`;
  }

  const lines = [
    'Token Usage:',
    `  Total tokens: ${stats.totalTokens.toLocaleString()}`,
    `  Context used: ${stats.usagePercent.toFixed(1)}%`,
    `  Context limit: ${stats.contextLimit.toLocaleString()}`,
    breakdown,
    '',
    `Estimated cost: ${costStr}`,
    '',
    'Note: Cost estimates based on standard pricing. Actual costs may vary.',
  ];

  return { output: lines.join('\n'), continue: true, handled: true };
}, 'Show token usage and cost');

// /compact
registerCommand('compact', async (_args, ctx) => {
  try {
    const beforeStats = ctx.session.getContextStats();
    const beforeTokens = beforeStats.totalTokens;

    await ctx.session.compactContext();

    const afterStats = ctx.session.getContextStats();
    const afterTokens = afterStats.totalTokens;
    const saved = beforeTokens - afterTokens;
    const savedPercent = (saved / beforeTokens) * 100;

    const lines = [
      '✓ Context compacted successfully',
      '',
      `Before: ${beforeTokens.toLocaleString()} tokens (${beforeStats.usagePercent.toFixed(1)}%)`,
      `After:  ${afterTokens.toLocaleString()} tokens (${afterStats.usagePercent.toFixed(1)}%)`,
      `Saved:  ${saved.toLocaleString()} tokens (${savedPercent.toFixed(1)}%)`,
      '',
      'Old messages have been summarized and stored in the knowledge base.',
    ];

    return { output: lines.join('\n'), continue: true, handled: true };
  } catch (error) {
    return {
      output: `Failed to compact context: ${error instanceof Error ? error.message : String(error)}`,
      continue: true,
      handled: true,
    };
  }
}, 'Compact context');

// /history
registerCommand('history', (_args, ctx) => {
  const history = ctx.session.getHistory();

  if (history.length === 0) {
    return { output: 'No conversation history.', continue: true, handled: true };
  }

  const lines = ['Conversation History:', '─'.repeat(60)];
  for (const msg of history) {
    const role = msg.role === 'user' ? 'You' : 'Assistant';
    const content = typeof msg.content === 'string'
      ? msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : '')
      : '[complex content]';
    lines.push(`${role}: ${content}`);
  }
  lines.push('─'.repeat(60));

  return { output: lines.join('\n'), continue: true, handled: true };
}, 'Show conversation history');

// /init
registerCommand('init', async (args, ctx) => {
  const includeFiles = args.includes('--files');
  const includeDeps = args.includes('--deps');
  const includeGit = args.includes('--git');

  try {
    const context = await ctx.session.initializeProjectContext({
      workingDirectory: ctx.workingDirectory,
      includeFileStructure: includeFiles,
      includeDependencies: includeDeps,
      includeGitInfo: includeGit,
    });

    const lines = [
      `✓ Project context initialized for ${ctx.workingDirectory}`,
      '',
      'Generated AGENTICODE.md with:',
      `  - Project structure: ${context.hasStructure ? '✓' : '○'}`,
      `  - Dependencies: ${context.hasDependencies ? '✓' : '○'}`,
      `  - Git info: ${context.hasGit ? '✓' : '○'}`,
      '',
      'This context will be automatically loaded in future sessions.',
      '',
      'Options:',
      '  --files  Include file structure',
      '  --deps   Include dependencies',
      '  --git    Include git branch/commit info',
    ];

    return {
      output: lines.join('\n'),
      continue: true,
      handled: true,
    };
  } catch (error) {
    return {
      output: `Failed to initialize project context: ${error instanceof Error ? error.message : String(error)}`,
      continue: true,
      handled: true,
    };
  }
}, 'Initialize project context');

// /memory
registerCommand('memory', async (_args, ctx) => {
  try {
    const memoryStatus = await ctx.session.getMemoryStatus();

    const lines = [
      'Memory Status:', '─'.repeat(60),
      '',
      'Context Loaded:',
      `  - Startup memories: ${memoryStatus.startupMemories}`,
      `  - Session summaries: ${memoryStatus.sessionSummaries}`,
      `  - Shared knowledge: ${memoryStatus.sharedKnowledge}`,
      `  - Total context items: ${memoryStatus.totalContextItems}`,
      '',
      'Current Session:',
      `  - Messages: ${memoryStatus.currentMessages}`,
      `  - Tokens: ${memoryStatus.currentTokens.toLocaleString()}`,
      `  - Context usage: ${memoryStatus.contextUsagePercent.toFixed(1)}%`,
      '',
      'Storage:',
      `  - User memories in vector DB: ${memoryStatus.userMemoriesInDB || 'Unknown'}`,
      `  - Project context: ${memoryStatus.hasProjectContext ? '✓ Loaded' : '○ Not initialized'}`,
      '',
      'Tips:',
      '  - Use /init to generate project context',
      '  - Use /compact to reduce token usage',
      '  - Use /clear to start fresh',
      '─'.repeat(60),
    ];

    return { output: lines.join('\n'), continue: true, handled: true };
  } catch (error) {
    return {
      output: `Failed to get memory status: ${error instanceof Error ? error.message : String(error)}`,
      continue: true,
      handled: true,
    };
  }
}, 'Show memory status');

// /doctor
registerCommand('doctor', async (_args, ctx) => {
  const lines = ['AgentiCode Doctor', '─'.repeat(40)];

  // Check API connection
  lines.push('');
  lines.push('API Connection:');
  if (ctx.authClient?.isAuthenticated()) {
    const state = ctx.authClient.getState();
    lines.push(`  ✓ Connected as ${state.userEmail || state.userId || 'unknown'}`);
    lines.push(`  ✓ ${state.availableModels.length} models available`);
  } else {
    lines.push('  ✗ Not authenticated');
  }

  // Check working directory
  lines.push('');
  lines.push('Working Directory:');
  lines.push(`  ${ctx.workingDirectory}`);

  // Check model
  lines.push('');
  lines.push('Current Model:');
  lines.push(`  ${ctx.currentModel}`);

  lines.push('');
  lines.push('─'.repeat(40));

  return { output: lines.join('\n'), continue: true, handled: true };
}, 'Diagnose configuration');

// /resume, /r
registerCommand('resume', async (args, ctx) => {
  // Check if authenticated (persistence requires API)
  if (!ctx.authClient?.isAuthenticated()) {
    return {
      output: 'Session resume requires authentication. Use direct Ollama mode for standalone sessions.',
      continue: true,
      handled: true,
    };
  }

  const state = ctx.authClient.getState();
  const userId = state.userId;
  const tenantId = state.tenantId;

  if (!userId || !tenantId) {
    return {
      output: 'User ID and Tenant ID required for session management.',
      continue: true,
      handled: true,
    };
  }

  if (args.length === 0) {
    // List recent sessions
    try {
      const sessions = await ctx.session.listRecentSessions(userId, 10);

      if (sessions.length === 0) {
        return {
          output: 'No previous sessions found. Start a new conversation!',
          continue: true,
          handled: true,
        };
      }

      const lines = ['Recent Sessions:', '─'.repeat(80)];
      for (const sess of sessions) {
        const date = new Date(sess.lastActivityAt).toLocaleString();
        const status = sess.status === 'active' ? '●' : '○';
        const branch = sess.metadata?.gitBranch ? ` [${sess.metadata.gitBranch}]` : '';
        const msgCount = sess.messageCount ? ` (${sess.messageCount} msgs)` : '';
        const dir = sess.workingDirectory.split('/').pop() || sess.workingDirectory;

        lines.push(`${status} ${sess.id.slice(0, 8)}... - ${date} - ${dir}${branch}${msgCount}`);
      }
      lines.push('─'.repeat(80));
      lines.push('\nUsage: /resume <session-id>');

      return { output: lines.join('\n'), continue: true, handled: true };
    } catch (error) {
      return {
        output: `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
        continue: true,
        handled: true,
      };
    }
  }

  // Resume specific session
  const sessionId = args[0];
  try {
    const success = await ctx.session.resumeSession(sessionId);

    if (success) {
      return {
        output: `✓ Resumed session ${sessionId.slice(0, 8)}...\nContext and message history loaded.`,
        continue: true,
        handled: true,
      };
    } else {
      return {
        output: `Failed to resume session ${sessionId}. Session may not exist or you don't have access.`,
        continue: true,
        handled: true,
      };
    }
  } catch (error) {
    return {
      output: `Error resuming session: ${error instanceof Error ? error.message : String(error)}`,
      continue: true,
      handled: true,
    };
  }
}, 'Resume previous conversation', ['r']);

// /skill, /skills
registerCommand('skill', (args, ctx) => {
  const skills = ctx.session.listSkills();
  const activeSkills = ctx.session.getActiveSkills();

  if (args.length === 0) {
    // List skills and their status
    const lines = ['Agent Skills:', '─'.repeat(60)];
    lines.push('');

    if (skills.length === 0) {
      lines.push('  No skills available.');
      lines.push('');
      lines.push('  Add skills to .claude/skills/ in your project.');
    } else {
      lines.push('Available Skills:');
      lines.push('');
      for (const skill of skills) {
        const isActive = activeSkills.includes(skill);
        const status = isActive ? '●' : '○';
        lines.push(`  ${status} ${skill.name}`);
        lines.push(`      ${skill.description}`);
        if (skill.triggers?.length) {
          lines.push(`      Triggers: ${skill.triggers.join(', ')}`);
        }
        lines.push('');
      }
      lines.push('');
      lines.push('Usage:');
      lines.push('  /skill               List all skills');
      lines.push('  /skill <name>        Toggle skill on/off');
      lines.push('  /skill on <name>     Activate skill');
      lines.push('  /skill off <name>    Deactivate skill');
    }
    lines.push('─'.repeat(60));

    return { output: lines.join('\n'), continue: true, handled: true };
  }

  // Parse subcommand
  const subCommand = args[0].toLowerCase();

  if (subCommand === 'on' && args.length > 1) {
    const skillName = args[1];
    const success = ctx.session.activateSkill(skillName);
    if (success) {
      const skill = ctx.session.getSkill(skillName);
      return {
        output: `✓ Skill "${skillName}" activated.\n\n${skill?.description || ''}`,
        continue: true,
        handled: true,
      };
    } else {
      return {
        output: `Skill "${skillName}" not found. Use /skill to list available skills.`,
        continue: true,
        handled: true,
      };
    }
  }

  if (subCommand === 'off' && args.length > 1) {
    const skillName = args[1];
    const success = ctx.session.deactivateSkill(skillName);
    if (success) {
      return {
        output: `○ Skill "${skillName}" deactivated.`,
        continue: true,
        handled: true,
      };
    } else {
      return {
        output: `Skill "${skillName}" not found or not active.`,
        continue: true,
        handled: true,
      };
    }
  }

  // Toggle skill (single arg)
  const skillName = subCommand;
  const skill = ctx.session.getSkill(skillName);

  if (!skill) {
    return {
      output: `Skill "${skillName}" not found. Use /skill to list available skills.`,
      continue: true,
      handled: true,
    };
  }

  if (skill.active) {
    ctx.session.deactivateSkill(skillName);
    return {
      output: `○ Skill "${skillName}" deactivated.`,
      continue: true,
      handled: true,
    };
  } else {
    ctx.session.activateSkill(skillName);
    return {
      output: `✓ Skill "${skillName}" activated.\n\n${skill.description}`,
      continue: true,
      handled: true,
    };
  }
}, 'Manage agent skills', ['skills']);

// Export command list for help generation
export function getCommandList(): { name: string; description: string }[] {
  const list: { name: string; description: string }[] = [];
  const seen = new Set<string>();

  for (const [name, cmd] of commands) {
    // Skip aliases (they reference the main command)
    if (cmd.aliases?.includes(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    list.push({ name, description: cmd.description });
  }

  return list.sort((a, b) => a.name.localeCompare(b.name));
}
