/**
 * Skill Loader
 * Loads and manages Agent Skills for AgentiCode
 *
 * Skills are prompt-based extensions that enhance the assistant's capabilities
 * in specific domains (frontend design, architecture, etc.)
 *
 * Based on the Agent Skills specification: https://agentskills.io
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface Skill {
  name: string;
  description: string;
  triggers?: string[];  // Keywords that auto-activate this skill
  instructions: string;  // The actual prompt instructions
  tools?: SkillTool[];   // Optional tools provided by the skill
  active: boolean;
}

export interface SkillTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface SkillMetadata {
  name: string;
  description: string;
  triggers?: string[];
  version?: string;
  author?: string;
}

/**
 * Parse SKILL.md file with YAML frontmatter
 */
function parseSkillMd(content: string): { metadata: SkillMetadata; instructions: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    // No frontmatter, treat entire content as instructions
    return {
      metadata: { name: 'unnamed', description: 'No description' },
      instructions: content.trim(),
    };
  }

  const [, frontmatter, instructions] = match;

  // Simple YAML parsing for frontmatter
  const metadata: SkillMetadata = { name: 'unnamed', description: 'No description' };
  const lines = frontmatter.split('\n');

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key === 'name') metadata.name = value;
      else if (key === 'description') metadata.description = value;
      else if (key === 'version') metadata.version = value;
      else if (key === 'author') metadata.author = value;
      else if (key === 'triggers') {
        // Parse array format: [keyword1, keyword2]
        const arrayMatch = value.match(/\[(.*)\]/);
        if (arrayMatch) {
          metadata.triggers = arrayMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        }
      }
    }
  }

  return { metadata, instructions: instructions.trim() };
}

/**
 * Load a skill from a directory
 */
function loadSkillFromDir(skillDir: string): Skill | null {
  const skillMdPath = join(skillDir, 'SKILL.md');

  if (!existsSync(skillMdPath)) {
    return null;
  }

  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    const { metadata, instructions } = parseSkillMd(content);

    return {
      name: metadata.name,
      description: metadata.description,
      triggers: metadata.triggers,
      instructions,
      active: false,
    };
  } catch (error) {
    console.error(`Failed to load skill from ${skillDir}:`, error);
    return null;
  }
}

/**
 * Skill Manager
 * Manages loading, activation, and retrieval of skills
 */
export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private activeSkills: Set<string> = new Set();

  constructor() {
    this.loadBuiltInSkills();
  }

  /**
   * Load built-in skills from the skills/builtin directory
   */
  private loadBuiltInSkills(): void {
    // Get the directory of this module
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const builtinDir = join(__dirname, 'builtin');

    if (!existsSync(builtinDir)) {
      return;
    }

    try {
      const entries = readdirSync(builtinDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skill = loadSkillFromDir(join(builtinDir, entry.name));
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load built-in skills:', error);
    }
  }

  /**
   * Load skills from a workspace directory (.claude/skills/)
   */
  loadWorkspaceSkills(workspaceDir: string): void {
    const skillsDir = join(workspaceDir, '.claude', 'skills');

    if (!existsSync(skillsDir)) {
      return;
    }

    try {
      const entries = readdirSync(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skill = loadSkillFromDir(join(skillsDir, entry.name));
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to load workspace skills from ${workspaceDir}:`, error);
    }
  }

  /**
   * Get a skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * List all available skills
   */
  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Activate a skill
   */
  activateSkill(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }
    skill.active = true;
    this.activeSkills.add(name);
    return true;
  }

  /**
   * Deactivate a skill
   */
  deactivateSkill(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }
    skill.active = false;
    this.activeSkills.delete(name);
    return true;
  }

  /**
   * Get all active skills
   */
  getActiveSkills(): Skill[] {
    return Array.from(this.activeSkills)
      .map(name => this.skills.get(name))
      .filter((s): s is Skill => s !== undefined);
  }

  /**
   * Check if a message should trigger any skills
   */
  checkTriggers(message: string): Skill[] {
    const triggered: Skill[] = [];
    const lowerMessage = message.toLowerCase();

    for (const skill of this.skills.values()) {
      if (skill.triggers) {
        for (const trigger of skill.triggers) {
          if (lowerMessage.includes(trigger.toLowerCase())) {
            triggered.push(skill);
            break;
          }
        }
      }
    }

    return triggered;
  }

  /**
   * Get the combined instructions for all active skills
   */
  getActiveInstructions(): string {
    const activeSkills = this.getActiveSkills();

    if (activeSkills.length === 0) {
      return '';
    }

    const parts = ['# Active Skills\n'];

    for (const skill of activeSkills) {
      parts.push(`## ${skill.name}\n`);
      parts.push(skill.instructions);
      parts.push('\n');
    }

    return parts.join('\n');
  }

  /**
   * Register a skill programmatically
   */
  registerSkill(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }
}

// Singleton instance
let skillManagerInstance: SkillManager | null = null;

export function getSkillManager(): SkillManager {
  if (!skillManagerInstance) {
    skillManagerInstance = new SkillManager();
  }
  return skillManagerInstance;
}

export function createSkillManager(): SkillManager {
  return new SkillManager();
}
