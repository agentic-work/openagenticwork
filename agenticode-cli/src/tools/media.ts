/**
 * Media Tools
 * Image viewing and media handling capabilities
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, resolve, isAbsolute } from 'path';
import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

/**
 * Supported image extensions
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

/**
 * Get MIME type for image extension
 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
  };
  return mimeTypes[ext.toLowerCase()] || 'image/png';
}

/**
 * View Image Tool - Read and analyze images
 * Returns image as base64 for LLM vision capabilities
 */
export const viewImageTool: ToolDefinition = {
  name: 'view_image',
  description: `View an image file. Use this to analyze screenshots, diagrams, UI mockups, or any visual content. The image will be processed and described. Supports PNG, JPG, GIF, WebP, and SVG formats.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the image file (absolute or relative to working directory)',
      },
    },
    required: ['path'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const inputPath = args.path as string;

    if (!inputPath) {
      return {
        content: 'Error: path is required',
        isError: true,
      };
    }

    // Resolve path relative to working directory
    const filePath = isAbsolute(inputPath)
      ? inputPath
      : resolve(context.workingDirectory || process.cwd(), inputPath);

    // Check if file exists
    if (!existsSync(filePath)) {
      return {
        content: `Error: Image file not found: ${filePath}`,
        isError: true,
      };
    }

    // Check file extension
    const ext = extname(filePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      return {
        content: `Error: Unsupported image format: ${ext}. Supported formats: ${IMAGE_EXTENSIONS.join(', ')}`,
        isError: true,
      };
    }

    try {
      // Read file as base64
      const buffer = await readFile(filePath);
      const base64 = buffer.toString('base64');
      const mimeType = getMimeType(ext);

      // For SVG, we can include the actual content since it's text
      if (ext === '.svg') {
        const svgContent = buffer.toString('utf-8');
        return {
          content: `Image loaded: ${filePath}\nType: ${mimeType}\nSize: ${buffer.length} bytes\n\nSVG Content:\n${svgContent.slice(0, 5000)}${svgContent.length > 5000 ? '\n... (truncated)' : ''}`,
          metadata: {
            path: filePath,
            mimeType,
            size: buffer.length,
            format: ext,
          },
        };
      }

      // For binary images, return base64 data
      // The LLM can use this for vision capabilities
      return {
        content: `Image loaded: ${filePath}\nType: ${mimeType}\nSize: ${buffer.length} bytes\nFormat: ${ext}\n\n[Image data available as base64 in metadata]`,
        metadata: {
          path: filePath,
          mimeType,
          size: buffer.length,
          format: ext,
          base64: `data:${mimeType};base64,${base64}`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error reading image: ${message}`,
        isError: true,
      };
    }
  },
};

/**
 * Screenshot Tool - Take a screenshot of the terminal or desktop
 * This is a placeholder - actual implementation would depend on the environment
 */
export const screenshotTool: ToolDefinition = {
  name: 'screenshot',
  description: `Take a screenshot. In terminal mode, this captures the current terminal state. In GUI mode, this captures the desktop or a specific window.`,
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['terminal', 'desktop', 'window'],
        description: 'Type of screenshot to take (default: terminal)',
      },
      outputPath: {
        type: 'string',
        description: 'Optional path to save the screenshot',
      },
    },
    required: [],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const type = (args.type as string) || 'terminal';

    // For now, this is a placeholder
    // In a real implementation, we could:
    // - For terminal: capture ANSI output or use a PTY snapshot
    // - For desktop: use native screenshot tools (gnome-screenshot, scrot, etc.)

    return {
      content: `Screenshot capability (${type}) is not yet implemented in this environment.\n\nTo view existing images, use the view_image tool with the path to the image file.`,
      metadata: {
        type,
        implemented: false,
      },
    };
  },
};
