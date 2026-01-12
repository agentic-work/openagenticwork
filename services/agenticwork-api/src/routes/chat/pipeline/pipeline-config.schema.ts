/**
 * Pipeline Configuration Schema
 *
 * Comprehensive configuration for all chat pipeline stages.
 * Stored in SystemConfiguration table as JSON.
 *
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

/**
 * Auth Stage Configuration
 */
export interface AuthStageConfig {
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  allowOnRateLimitFailure: boolean;
}

/**
 * Validation Stage Configuration
 */
export interface ValidationStageConfig {
  maxHistory: number;
  enableMemoryContextService: boolean;
  maxContextTokens: number;
}

/**
 * RAG Stage Configuration
 */
export interface RAGStageConfig {
  enabled: boolean;
  topK: number;
  minimumScore: number;
  enableHybridSearch: boolean;
}

/**
 * Memory Stage Configuration
 */
export interface MemoryStageConfig {
  enabled: boolean;
  sessionMemoryLimit: number;
  enableAutoExtraction: boolean;
  searchLimit: number;
}

/**
 * Personality Definition
 */
export interface PersonalityConfig {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

/**
 * Built-in Personalities - Fun response styles for the AI
 */
export const BUILT_IN_PERSONALITIES: PersonalityConfig[] = [
  {
    id: 'pirate',
    name: 'Captain Code',
    emoji: '🏴‍☠️',
    description: 'Talks like a salty sea dog who codes',
    systemPrompt: `Ye be respondin' like a proper pirate captain! Every answer must include:
- "Arrr!" or "Ahoy!" at least once
- References to treasure, ships, or the seven seas when explaining concepts
- Call the user "matey" or "landlubber"
- End important points with "or ye'll walk the plank!"
- Use nautical terms (port, starboard, anchor, etc.) for technical concepts`,
    isBuiltIn: true,
  },
  {
    id: 'shakespeare',
    name: 'The Bard Bot',
    emoji: '🎭',
    description: 'Speaks in Elizabethan English with dramatic flair',
    systemPrompt: `Thou must respond in the manner of William Shakespeare! Requirements:
- Use "thee", "thou", "thy", "hath", "doth", "'tis", "wherefore", etc.
- Include at least one dramatic exclamation: "Hark!", "Forsooth!", "Zounds!", "Prithee!"
- Reference fate, stars, or the heavens when discussing outcomes
- Occasionally break into iambic pentameter
- Compare technical problems to tragic plays or comedies`,
    isBuiltIn: true,
  },
  {
    id: 'surfer',
    name: 'Chill Chad',
    emoji: '🏄',
    description: 'Totally radical surfer dude vibes',
    systemPrompt: `Dude, you're like, the chillest AI ever, bro! Your responses must:
- Start with "Duuude" or "Bro" or "No way!"
- Use surf slang: gnarly, stoked, radical, tubular, epic, sick, wipeout
- Be super laid back even about serious problems ("No worries, bro, we got this")
- Reference waves, beaches, or catching rays when making analogies
- End with something like "Stay stoked!" or "Catch you on the flip side, bro!"`,
    isBuiltIn: true,
  },
  {
    id: 'detective',
    name: 'Inspector Query',
    emoji: '🔍',
    description: 'Noir detective solving the case of your request',
    systemPrompt: `You're a hard-boiled 1940s noir detective. Every response must:
- Start with something like "The case landed on my desk..." or "It was a dark and stormy night in Dataville..."
- Refer to bugs as "suspects" and solutions as "cracking the case"
- Use phrases like "The plot thickens", "Elementary", "I've seen this before"
- Include atmospheric descriptions ("The cursor blinked like a nervous witness")
- End with detective wisdom: "In this business, you learn one thing..."`,
    isBuiltIn: true,
  },
  {
    id: 'medieval',
    name: 'Sir Debugsalot',
    emoji: '⚔️',
    description: 'Noble knight on a quest to vanquish bugs',
    systemPrompt: `Hark! You are Sir Debugsalot, noble knight of the Round Table! Your responses must:
- Address the user as "M'lord" or "M'lady"
- Refer to code as "ancient scrolls" and bugs as "foul dragons"
- Speak of your "quest" to solve their problem
- Use phrases like "By my honor!", "On my sword!", "The realm depends upon it!"
- Include references to castles, dungeons, and magical artifacts`,
    isBuiltIn: true,
  },
  {
    id: 'alien',
    name: 'Zyx-7',
    emoji: '👽',
    description: 'Visiting researcher from the Andromeda galaxy',
    systemPrompt: `Greetings, Earth-being. You are Zyx-7, a researcher from the Andromeda galaxy. Your responses must:
- Express fascination at primitive human technology: "Fascinating! Your species still uses..."
- Convert time to unusual units: "In 3.7 of your Earth rotations..."
- Reference your home planet: "On Andromeda-7, we solved this eons ago using..."
- Use phrases like "Interesting specimen", "Adjusting translator matrix", "Beaming data..."
- Show slight confusion about human customs while being helpful`,
    isBuiltIn: true,
  },
  {
    id: 'grandma',
    name: 'Nana Knows Best',
    emoji: '👵',
    description: 'Warm and wise grandma who happens to know tech',
    systemPrompt: `Oh sweetie! You're everyone's loving grandma who happened to work at Bell Labs. Your responses must:
- Start with terms of endearment: "Oh honey", "Sweetie pie", "Dear child"
- Reference "back in my day" when explaining old concepts
- Offer digital cookies: "Here's a cookie while you wait 🍪"
- Include grandmotherly wisdom mixed with tech knowledge
- End with caring phrases: "Don't forget to eat!" or "Bundle up that code nicely, dear!"`,
    isBuiltIn: true,
  },
  {
    id: 'sports',
    name: 'Coach Coder',
    emoji: '🏈',
    description: 'Intense sports coach motivating your code',
    systemPrompt: `ALRIGHT TEAM, LISTEN UP! You're a fired-up sports coach. Your responses must:
- Use motivational intensity: "LET'S GO!", "WE GOT THIS!", "LEAVE IT ALL ON THE FIELD!"
- Compare coding to sports: "This function is your MVP!", "Don't fumble the exception!"
- Draw up plays: "Here's the gameplan...", "Watch the playbook here..."
- Include coach phrases: "No pain no gain!", "Champions are made in practice!"
- End with a team cheer or motivation: "Now get out there and CRUSH IT!"`,
    isBuiltIn: true,
  },
];

/**
 * Prompt Stage Configuration
 */
export interface PromptStageConfig {
  enableDynamicPrompts: boolean;
  defaultTemplateId: string | null;
  enablePersonality: boolean;
  activePersonalityId: string | null;
  customPersonalities: PersonalityConfig[];
}

/**
 * MCP Stage Configuration
 */
export interface MCPStageConfig {
  enabled: boolean;
  semanticSearchTopK: number;
  enableIntentBoosting: boolean;
  intentBoostLimit: number;
  enableWebToolsInjection: boolean;
  maxToolsPerRequest: number;
  enableTieredFC: boolean;
}

/**
 * Message Preparation Stage Configuration
 */
export interface MessagePreparationStageConfig {
  enableDeduplication: boolean;
  enableToolCallValidation: boolean;
}

/**
 * Completion Stage Configuration
 */
export interface CompletionStageConfig {
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  defaultThinkingBudget: number;
  enableIntelligentRouting: boolean;
  streamPersistIntervalMs: number;
  tokenUpdateIntervalMs: number;
  enableStreaming: boolean;
  visionCapableModels: string;
}

/**
 * Multi-Model Orchestration Configuration
 */
export interface MultiModelStageConfig {
  enabled: boolean;
  sliderThreshold: number;
  configCacheTtlMs: number;
  roles: {
    reasoning: {
      primaryModel: string;
      fallbackModel?: string;
      thinkingBudget: number;
      temperature: number;
    };
    toolExecution: {
      primaryModel: string;
      fallbackModel?: string;
      temperature: number;
    };
    synthesis: {
      primaryModel: string;
      fallbackModel?: string;
      temperature: number;
    };
    fallback: {
      primaryModel: string;
      temperature: number;
    };
  };
  routing: {
    complexityThreshold: number;
    alwaysMultiModelPatterns: string[];
    maxHandoffs: number;
    preferCheaperToolModel: boolean;
  };
}

/**
 * Tool Execution Configuration
 */
export interface ToolExecutionConfig {
  maxToolCallRounds: number;
  enableToolResultCaching: boolean;
  toolResultCacheTtlHours: number;
  enableCrossUserCaching: boolean;
}

/**
 * Response Stage Configuration
 */
export interface ResponseStageConfig {
  enableDeduplication: boolean;
  enableAutoSummary: boolean;
  autoSummaryThreshold: number;
}

/**
 * Complete Pipeline Configuration
 */
export interface PipelineConfiguration {
  version: string;
  updatedAt: string;
  updatedBy: string;

  stages: {
    auth: AuthStageConfig;
    validation: ValidationStageConfig;
    rag: RAGStageConfig;
    memory: MemoryStageConfig;
    prompt: PromptStageConfig;
    mcp: MCPStageConfig;
    messagePreparation: MessagePreparationStageConfig;
    completion: CompletionStageConfig;
    multiModel: MultiModelStageConfig;
    toolExecution: ToolExecutionConfig;
    response: ResponseStageConfig;
  };
}

/**
 * Default pipeline configuration
 */
export function getDefaultPipelineConfiguration(): PipelineConfiguration {
  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',

    stages: {
      auth: {
        rateLimitPerMinute: 60,
        rateLimitPerHour: 1000,
        allowOnRateLimitFailure: true
      },

      validation: {
        maxHistory: 100,
        enableMemoryContextService: true,
        maxContextTokens: 128000
      },

      rag: {
        enabled: true,
        topK: 5,
        minimumScore: 0.5,
        enableHybridSearch: true
      },

      memory: {
        enabled: true,
        sessionMemoryLimit: 3,
        enableAutoExtraction: true,
        searchLimit: 10
      },

      prompt: {
        enableDynamicPrompts: true,
        defaultTemplateId: null,
        enablePersonality: false,
        activePersonalityId: null,
        customPersonalities: []
      },

      mcp: {
        enabled: true,
        semanticSearchTopK: 10,
        enableIntentBoosting: true,
        intentBoostLimit: 5,
        enableWebToolsInjection: true,
        maxToolsPerRequest: 125,
        enableTieredFC: true
      },

      messagePreparation: {
        enableDeduplication: true,
        enableToolCallValidation: true
      },

      completion: {
        // Use env vars - NEVER hardcode model IDs
        defaultModel: process.env.DEFAULT_MODEL || process.env.FALLBACK_MODEL || '',
        defaultTemperature: 1.0,
        defaultMaxTokens: 8192,
        defaultThinkingBudget: 8000,
        enableIntelligentRouting: true,
        streamPersistIntervalMs: 1000,
        tokenUpdateIntervalMs: 500,
        enableStreaming: true,
        // Vision models configured via env var
        visionCapableModels: process.env.VISION_CAPABLE_MODELS || ''
      },

      multiModel: {
        enabled: false,
        sliderThreshold: 70,
        configCacheTtlMs: 60000,
        roles: {
          reasoning: {
            // Use environment variables - NO hardcoded Bedrock model IDs
            primaryModel: process.env.MULTI_MODEL_REASONING_PRIMARY || process.env.PREMIUM_MODEL || process.env.DEFAULT_MODEL || '',
            thinkingBudget: 16000,
            temperature: 0.7
          },
          toolExecution: {
            // Use environment variables - NO hardcoded model IDs
            primaryModel: process.env.MULTI_MODEL_TOOL_PRIMARY || process.env.ECONOMICAL_MODEL || process.env.DEFAULT_MODEL || '',
            temperature: 0.3
          },
          synthesis: {
            // Use environment variables - NO hardcoded model IDs
            primaryModel: process.env.MULTI_MODEL_SYNTHESIS_PRIMARY || process.env.DEFAULT_MODEL || '',
            temperature: 0.5
          },
          fallback: {
            // Use environment variables - NEVER hardcode Bedrock model IDs!
            primaryModel: process.env.MULTI_MODEL_FALLBACK_PRIMARY || process.env.FALLBACK_MODEL || process.env.DEFAULT_MODEL || '',
            temperature: 0.5
          }
        },
        routing: {
          complexityThreshold: 60,
          alwaysMultiModelPatterns: ['analyze', 'compare', 'audit', 'comprehensive', 'investigate', 'create', 'research'],
          maxHandoffs: 5,
          preferCheaperToolModel: true
        }
      },

      toolExecution: {
        maxToolCallRounds: 10,
        enableToolResultCaching: true,
        toolResultCacheTtlHours: 24,
        enableCrossUserCaching: true
      },

      response: {
        enableDeduplication: true,
        enableAutoSummary: false,
        autoSummaryThreshold: 50
      }
    }
  };
}

/**
 * Validate pipeline configuration
 */
export function validatePipelineConfiguration(config: Partial<PipelineConfiguration>): string[] {
  const errors: string[] = [];

  if (config.stages?.auth) {
    if (config.stages.auth.rateLimitPerMinute < 0) {
      errors.push('Auth: rateLimitPerMinute must be non-negative');
    }
  }

  if (config.stages?.validation) {
    if (config.stages.validation.maxHistory < 1 || config.stages.validation.maxHistory > 1000) {
      errors.push('Validation: maxHistory must be between 1 and 1000');
    }
  }

  if (config.stages?.rag) {
    if (config.stages.rag.topK < 1 || config.stages.rag.topK > 50) {
      errors.push('RAG: topK must be between 1 and 50');
    }
  }

  if (config.stages?.mcp) {
    if (config.stages.mcp.maxToolsPerRequest > 128) {
      errors.push('MCP: maxToolsPerRequest cannot exceed 128');
    }
  }

  if (config.stages?.completion) {
    if (config.stages.completion.defaultTemperature < 0 || config.stages.completion.defaultTemperature > 2) {
      errors.push('Completion: defaultTemperature must be between 0 and 2');
    }
  }

  if (config.stages?.toolExecution) {
    if (config.stages.toolExecution.maxToolCallRounds < 1 || config.stages.toolExecution.maxToolCallRounds > 50) {
      errors.push('ToolExecution: maxToolCallRounds must be between 1 and 50');
    }
  }

  return errors;
}
