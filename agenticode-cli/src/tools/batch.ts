/**
 * Batch File Tools
 * Read multiple files and apply patches efficiently
 */

import { readFile, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

/**
 * Read Many Files Tool - Read multiple files in a single call
 */
export const readManyFilesTool: ToolDefinition = {
  name: 'read_many_files',
  description: `Read multiple files at once. More efficient than reading files one at a time.
Use this when you need to examine several related files (e.g., a component and its tests,
or multiple configuration files).`,
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        description: 'Array of file paths to read',
        items: {
          type: 'string',
        },
      },
      maxCharsPerFile: {
        type: 'number',
        description: 'Maximum characters to read from each file (default: 50000)',
      },
    },
    required: ['paths'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const paths = args.paths as string[];
    const maxChars = (args.maxCharsPerFile as number) || 50000;

    if (!Array.isArray(paths) || paths.length === 0) {
      return {
        content: 'Error: paths must be a non-empty array of file paths',
        isError: true,
      };
    }

    const results: string[] = [];
    const errors: string[] = [];
    let totalFiles = 0;
    let successCount = 0;

    for (const inputPath of paths) {
      totalFiles++;
      const filePath = isAbsolute(inputPath)
        ? inputPath
        : resolve(context.workingDirectory, inputPath);

      if (!existsSync(filePath)) {
        errors.push(`${inputPath}: File not found`);
        continue;
      }

      try {
        const stats = await stat(filePath);
        if (stats.isDirectory()) {
          errors.push(`${inputPath}: Is a directory, not a file`);
          continue;
        }

        let content = await readFile(filePath, 'utf-8');
        const truncated = content.length > maxChars;
        if (truncated) {
          content = content.slice(0, maxChars) + '\n... [truncated]';
        }

        const lines = content.split('\n');
        const numberedContent = lines
          .map((line, i) => `${String(i + 1).padStart(5)}│ ${line}`)
          .join('\n');

        results.push(`
${'═'.repeat(60)}
📄 ${inputPath} (${stats.size} bytes${truncated ? ', truncated' : ''})
${'─'.repeat(60)}
${numberedContent}
`);
        successCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${inputPath}: ${message}`);
      }
    }

    let output = `Read ${successCount}/${totalFiles} files\n`;

    if (errors.length > 0) {
      output += `\nErrors:\n${errors.map(e => `  ❌ ${e}`).join('\n')}\n`;
    }

    output += results.join('\n');

    return {
      content: output,
      metadata: {
        total: totalFiles,
        success: successCount,
        errors: errors.length,
      },
    };
  },
};

/**
 * Apply Patch Tool - Apply a unified diff patch to files
 * This is useful for making complex multi-line changes
 */
export const applyPatchTool: ToolDefinition = {
  name: 'apply_patch',
  description: `Apply a unified diff patch to modify files. Use this for complex multi-line changes
that are easier to express as a diff. Supports standard unified diff format.

Example patch format:
--- a/file.ts
+++ b/file.ts
@@ -10,3 +10,4 @@
 existing line
-line to remove
+new line to add
+another new line`,
  inputSchema: {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: 'The unified diff patch to apply',
      },
      dryRun: {
        type: 'boolean',
        description: 'If true, show what would change without applying (default: false)',
      },
    },
    required: ['patch'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const patch = args.patch as string;
    const dryRun = args.dryRun as boolean || false;

    if (!patch) {
      return {
        content: 'Error: patch is required',
        isError: true,
      };
    }

    try {
      const results = await applyUnifiedPatch(patch, context.workingDirectory, dryRun);

      let output = dryRun ? 'Dry run - no changes made:\n' : 'Patch applied:\n';
      output += '─'.repeat(50) + '\n';

      for (const result of results) {
        const status = result.success ? '✅' : '❌';
        output += `\n${status} ${result.file}\n`;
        if (result.error) {
          output += `   Error: ${result.error}\n`;
        } else {
          output += `   Lines changed: +${result.additions} -${result.deletions}\n`;
        }
      }

      const anyErrors = results.some(r => !r.success);
      return {
        content: output,
        isError: anyErrors,
        metadata: {
          dryRun,
          filesProcessed: results.length,
          filesSucceeded: results.filter(r => r.success).length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Failed to apply patch: ${message}`,
        isError: true,
      };
    }
  },
};

interface PatchResult {
  file: string;
  success: boolean;
  error?: string;
  additions: number;
  deletions: number;
}

/**
 * Parse and apply a unified diff patch
 */
async function applyUnifiedPatch(
  patch: string,
  workingDir: string,
  dryRun: boolean
): Promise<PatchResult[]> {
  const results: PatchResult[] = [];
  const lines = patch.split('\n');

  let currentFile: string | null = null;
  let fileContent: string[] = [];
  let hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }> = [];
  let currentHunk: typeof hunks[0] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: --- a/path or --- path
    if (line.startsWith('--- ')) {
      // If we have a previous file, process it
      if (currentFile) {
        results.push(await processFile(currentFile, fileContent, hunks, workingDir, dryRun));
      }

      // Parse new file path
      const match = line.match(/^--- (?:a\/)?(.+)$/);
      if (match) {
        currentFile = match[1];
        fileContent = [];
        hunks = [];
        currentHunk = null;
      }
      continue;
    }

    // New file line: +++ b/path (skip, use --- path)
    if (line.startsWith('+++ ')) {
      continue;
    }

    // Hunk header: @@ -start,count +start,count @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldCount: parseInt(match[2] || '1'),
          newStart: parseInt(match[3]),
          newCount: parseInt(match[4] || '1'),
          lines: [],
        };
        hunks.push(currentHunk);
      }
      continue;
    }

    // Hunk content
    if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.lines.push(line);
    }
  }

  // Process last file
  if (currentFile) {
    results.push(await processFile(currentFile, fileContent, hunks, workingDir, dryRun));
  }

  return results;
}

async function processFile(
  filePath: string,
  _fileContent: string[],
  hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }>,
  workingDir: string,
  dryRun: boolean
): Promise<PatchResult> {
  const fullPath = isAbsolute(filePath) ? filePath : resolve(workingDir, filePath);
  let additions = 0;
  let deletions = 0;

  try {
    // Read existing file
    let content: string;
    if (existsSync(fullPath)) {
      content = await readFile(fullPath, 'utf-8');
    } else {
      // New file
      content = '';
    }

    const lines = content.split('\n');

    // Apply hunks in reverse order to maintain line numbers
    for (let i = hunks.length - 1; i >= 0; i--) {
      const hunk = hunks[i];
      const startIndex = hunk.oldStart - 1; // Convert to 0-based

      // Remove old lines and add new ones
      const toRemove: number[] = [];
      const toAdd: string[] = [];

      for (const line of hunk.lines) {
        if (line.startsWith('-')) {
          deletions++;
          toRemove.push(toRemove.length);
        } else if (line.startsWith('+')) {
          additions++;
          toAdd.push(line.slice(1));
        }
        // Context lines (starting with ' ') are kept
      }

      // Apply changes
      const removeCount = hunk.lines.filter(l => l.startsWith('-')).length;
      lines.splice(startIndex, removeCount, ...toAdd);
    }

    const newContent = lines.join('\n');

    if (!dryRun) {
      await writeFile(fullPath, newContent, 'utf-8');
    }

    return {
      file: filePath,
      success: true,
      additions,
      deletions,
    };
  } catch (error) {
    return {
      file: filePath,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      additions: 0,
      deletions: 0,
    };
  }
}
