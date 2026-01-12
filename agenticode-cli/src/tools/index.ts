/**
 * Tool exports
 */

export { ToolRegistry } from './registry.js';
export { shellTool } from './shell.js';
export { readFileTool, writeFileTool, editFileTool, listDirTool } from './files.js';
export { grepTool, globTool } from './search.js';
export { webSearchTool, webFetchTool } from './web.js';
export { todoWriteTool, todoReadTool } from './tasks.js';
export { viewImageTool, screenshotTool } from './media.js';
export { bashBackgroundTool, bashOutputTool, killBashTool, listBackgroundTool } from './background.js';
export { readManyFilesTool, applyPatchTool } from './batch.js';

import { ToolRegistry } from './registry.js';
import { shellTool } from './shell.js';
import { readFileTool, writeFileTool, editFileTool, listDirTool } from './files.js';
import { grepTool, globTool } from './search.js';
import { webSearchTool, webFetchTool } from './web.js';
import { todoWriteTool, todoReadTool } from './tasks.js';
import { viewImageTool, screenshotTool } from './media.js';
import { bashBackgroundTool, bashOutputTool, killBashTool, listBackgroundTool } from './background.js';
import { readManyFilesTool, applyPatchTool } from './batch.js';

/**
 * Create a registry with all built-in tools
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.registerAll([
    // Core file and shell tools
    shellTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    grepTool,
    globTool,
    // Web tools (Phase 1)
    webSearchTool,
    webFetchTool,
    // Task management (Phase 1)
    todoWriteTool,
    todoReadTool,
    // Media tools (Phase 1)
    viewImageTool,
    screenshotTool,
    // Background process tools (Phase 2)
    bashBackgroundTool,
    bashOutputTool,
    killBashTool,
    listBackgroundTool,
    // Batch file tools (Phase 2)
    readManyFilesTool,
    applyPatchTool,
  ]);

  return registry;
}
