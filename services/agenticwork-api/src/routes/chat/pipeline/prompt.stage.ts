/**
 * Prompt Engineering Pipeline Stage
 * 
 * Responsibilities:
 * - Load user's assigned prompt template
 * - Apply prompt engineering techniques (CoT, Few-shot, etc.)
 * - Build system prompt with context
 * - Handle dynamic prompt modifications
 * - Apply prompting techniques configuration
 * - Apply context-aware directives
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ChatErrorCode } from '../interfaces/chat.types.js';
import { PromptEngineeringResult, PromptTechnique } from '../interfaces/prompt.types.js';
import { isPromptConfigurationError, getConfigurationErrorMessage } from '../../../startup/validateAdminPortal.js';
// import { PromptTechniqueService } from '../../../services/PromptTechniqueService.js'; // REMOVED: Prompt techniques disabled
import { DirectiveService } from '../../../services/DirectiveService.js';
import { KnowledgeIngestionService } from '../../../services/KnowledgeIngestionService.js';
import { PromptFormattingIntegration } from '../../../services/PromptFormattingIntegration.js';
import { AzureSDKKnowledgeIngester, AZURE_KEYWORDS } from '../../../services/AzureSDKKnowledgeIngester.js';
import { getFormattingCapabilitiesService } from '../../../services/formatting/FormattingCapabilitiesService.js';
import { getSystemMcpPrompts, isDiagramRequest } from '../../../services/system-mcps/index.js';
import { BUILT_IN_PERSONALITIES, type PersonalityConfig } from './pipeline-config.schema.js';
import type { Logger } from 'pino';

export class PromptStage implements PipelineStage {
  name = 'prompt';
  private techniqueService?: any; // REMOVED: PromptTechniqueService disabled
  private directiveService?: DirectiveService;
  private knowledgeService?: KnowledgeIngestionService;
  private formattingIntegration: PromptFormattingIntegration;

  constructor(
    private promptService: any,
    private logger: any,
    techniqueService?: any, // REMOVED: PromptTechniqueService type
    directiveService?: DirectiveService,
    knowledgeService?: KnowledgeIngestionService
  ) {
    this.logger = logger.child({ stage: this.name }) as Logger;
    this.techniqueService = techniqueService;
    this.directiveService = directiveService;
    this.knowledgeService = knowledgeService;
    this.formattingIntegration = new PromptFormattingIntegration(this.logger);
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    // Initialize prompt usage tracking data
    const promptUsageData: any = {
      userId: context.user.id,
      sessionId: context.request.sessionId,
      techniquesApplied: [],
      hasFormatting: false,
      hasMcpContext: false,
      hasRagContext: false,
      hasMemoryContext: false,
      hasAzureSdkDocs: false,
      ragDocsCount: 0,
      ragChatsCount: 0,
      memoryCount: 0,
      mcpToolsCount: 0,
      tokensAdded: 0,
      metadata: {}
    };

    try {
      this.logger.info({
        startTime: new Date().toISOString(),
        userId: context.user.id,
        sessionId: context.request.sessionId,
        messageId: context.messageId,
        userGroups: context.user.groups,
        userMessage: context.request.message?.substring(0, 100)
      }, '[PROMPT] 🚀 Starting prompt engineering stage with super verbose logging');

      // Load user's prompt template
      this.logger.info('[PROMPT] 📝 Loading user prompt template...');
      const promptTemplate = await this.loadUserPromptTemplate(context);

      this.logger.info({
        templateFound: !!promptTemplate,
        templateId: promptTemplate?.id,
        templateName: promptTemplate?.name,
        templateCategory: promptTemplate?.category,
        isDefault: promptTemplate?.isDefault,
        contentLength: promptTemplate?.content?.length,
        contentPreview: promptTemplate?.content?.substring(0, 200)
      }, '[PROMPT] 📄 Prompt template loaded with details');

      // Track template usage
      if (promptTemplate?._trackingData) {
        promptUsageData.baseTemplateId = promptTemplate._trackingData.baseTemplateId;
        promptUsageData.baseTemplateName = promptTemplate._trackingData.baseTemplateName;
        promptUsageData.domainTemplateId = promptTemplate._trackingData.domainTemplateId;
        promptUsageData.domainTemplateName = promptTemplate._trackingData.domainTemplateName;
        promptUsageData.metadata.composition = promptTemplate.metadata?.composition;
      }

      // Load user's prompt techniques configuration
      this.logger.info('[PROMPT] 🧠 Loading prompt techniques configuration...');
      const promptTechniques = await this.loadPromptTechniques(context);

      this.logger.info({
        techniquesFound: promptTechniques?.length || 0,
        techniqueNames: promptTechniques?.map(t => t.name) || [],
        techniquesEnabled: promptTechniques?.filter(t => t.enabled)?.length || 0
      }, '[PROMPT] ⚙️ Prompt techniques configuration loaded');
      
      // Apply user-selected techniques from frontend if provided
      const userSelectedTechniques = context.request.promptTechniques;
      if (userSelectedTechniques && userSelectedTechniques.length > 0 && this.techniqueService) {
        this.logger.info({
          userId: context.user.id,
          selectedTechniques: userSelectedTechniques
        }, 'Applying user-selected prompt techniques from frontend');
        
        const techniqueResults = await this.techniqueService.applyUserSelectedTechniques(
          context.user.id,
          context.request.message,
          context.request.message,
          userSelectedTechniques
        );
        
        // Store technique results in context for later use
        context.metadata = {
          ...context.metadata,
          appliedTechniques: techniqueResults
        };
      }
      
      // STEP 2: Use knowledge from RAG stage (if available) or retrieve directly
      // RAG stage runs before prompt stage and stores results in context.ragContext
      let knowledgeContext = context.ragContext;

      // If RAG stage didn't run or didn't find anything, fall back to direct retrieval
      if (!knowledgeContext) {
        knowledgeContext = await this.retrieveKnowledge(context);
      } else {
        this.logger.info({
          docsFromRag: knowledgeContext.docs?.length || 0,
          chatsFromRag: knowledgeContext.chats?.length || 0,
          artifactsFromRag: knowledgeContext.artifacts?.length || 0
        }, '[PROMPT] Using knowledge from RAG stage');
      }

      // Track RAG context
      if (knowledgeContext) {
        const hasArtifacts = knowledgeContext.artifacts?.length > 0;
        promptUsageData.hasRagContext = (
          knowledgeContext.docs?.length > 0 ||
          knowledgeContext.chats?.length > 0 ||
          hasArtifacts
        );
        promptUsageData.ragDocsCount = knowledgeContext.docs?.length || 0;
        promptUsageData.ragChatsCount = knowledgeContext.chats?.length || 0;
        promptUsageData.hasAzureSdkDocs = (knowledgeContext.azureDocs?.length > 0);
        if (promptUsageData.hasAzureSdkDocs) {
          promptUsageData.metadata.azureDocsCount = knowledgeContext.azureDocs.length;
        }
        if (hasArtifacts) {
          promptUsageData.metadata.artifactsCount = knowledgeContext.artifacts.length;
        }
      }

      // Build system prompt with context
      const systemPrompt = await this.buildSystemPrompt(context, promptTemplate, promptTechniques);

      // STEP 3: Enhance prompt with retrieved knowledge
      let enhancedSystemPrompt = await this.enhanceWithKnowledge(systemPrompt, knowledgeContext, context);

      // CRITICAL: Preserve memory context from MemoryStage
      // The MemoryStage runs before PromptStage and may have added memories to context.systemPrompt
      // We need to include this memory context in the final system prompt
      if (context.memoryContext?.memories?.length > 0) {
        const memorySection = this.formatMemoryContextForPrompt(context.memoryContext);
        if (memorySection) {
          enhancedSystemPrompt = `${enhancedSystemPrompt}\n\n${memorySection}`;
          this.logger.info({
            memoriesIncluded: context.memoryContext.memories.length,
            memorySectionLength: memorySection.length
          }, '[PROMPT] 🧠 Memory context included in system prompt');

          // Track memory usage
          promptUsageData.hasMemoryContext = true;
          promptUsageData.memoryCount = context.memoryContext.memories.length;
        }
      }

      // Apply prompt engineering techniques
      const promptEngineering = await this.applyPromptEngineering(context, promptTechniques);

      // Track techniques and tokens
      if (promptEngineering) {
        promptUsageData.techniquesApplied = promptEngineering.appliedTechniques || [];
        promptUsageData.tokensAdded = promptEngineering.tokensAdded || 0;
      }

      // Update context with enhanced prompt data (STEP 4: This will be sent to LLM)
      context.systemPrompt = enhancedSystemPrompt;
      context.promptEngineering = promptEngineering;

      // Track final system prompt
      promptUsageData.systemPrompt = enhancedSystemPrompt;
      promptUsageData.systemPromptLength = enhancedSystemPrompt.length;

      // Track context injections
      promptUsageData.hasFormatting = (context as any)._hasFormattingInjection || false;
      promptUsageData.hasMcpContext = (context as any)._hasMcpContextInjection || false;

      // Track MCP tools count if available
      if (context.availableTools && Array.isArray(context.availableTools)) {
        promptUsageData.mcpToolsCount = context.availableTools.length;
      }

      // Store prompt usage data in context for later persistence
      context.promptUsageData = promptUsageData;
      
      // Add knowledge context metadata
      if (knowledgeContext) {
        context.metadata = {
          ...context.metadata,
          knowledgeRetrieved: true,
          docsCount: knowledgeContext.docs?.length || 0,
          chatsCount: knowledgeContext.chats?.length || 0
        };
      }
      
      this.logger.info({ 
        userId: context.user.id,
        sessionId: context.request.sessionId,
        promptTemplateId: promptTemplate?.id,
        techniquesCount: promptTechniques.length,
        systemPromptLength: enhancedSystemPrompt.length,
        knowledgeDocsRetrieved: knowledgeContext?.docs?.length || 0,
        knowledgeChatsRetrieved: knowledgeContext?.chats?.length || 0,
        executionTime: Date.now() - startTime
      }, 'Prompt stage completed with RAG enhancement');

      return context;

    } catch (error) {
      this.logger.error({ 
        error: error.message,
        executionTime: Date.now() - startTime
      }, 'Prompt stage failed');

      // Handle configuration errors specially
      if (isPromptConfigurationError(error)) {
        throw {
          ...error,
          code: ChatErrorCode.ADMIN_PORTAL_MISCONFIGURED,
          message: getConfigurationErrorMessage(error),
          adminMessage: error.message,
          retryable: false, // Configuration errors require admin intervention
          stage: this.name
        };
      }

      throw {
        ...error,
        code: error.code || ChatErrorCode.INTERNAL_ERROR,
        retryable: true,
        stage: this.name
      };
    }
  }

  /**
   * Compose base template + domain template into final system prompt
   */
  private composeTemplates(baseTemplate: any, domainTemplate: any): any {
    const baseContent = baseTemplate?.content || '';
    const domainContent = domainTemplate?.content || '';

    // Compose: BASE (formatting instructions) + DOMAIN (expertise/personality)
    const composedContent = `${baseContent}

─────────────────────────────────────────────────────────────

# Domain Expertise

${domainContent}`;

    // Return composed template with metadata from both
    return {
      ...domainTemplate,
      content: composedContent,
      metadata: {
        ...domainTemplate.metadata,
        composition: {
          base: {
            id: baseTemplate.id,
            name: baseTemplate.name,
            category: baseTemplate.category
          },
          domain: {
            id: domainTemplate.id,
            name: domainTemplate.name,
            category: domainTemplate.category
          }
        }
      }
    };
  }

  /**
   * Load base formatting template (always applied)
   * This template instructs the LLM to use Formatting MCP tools
   */
  private async loadBaseFormattingTemplate(): Promise<any> {
    try {
      this.logger.info('[PROMPT] 📝 Loading base formatting template...');

      const { prisma } = await import('../../../utils/prisma.js');

      const baseTemplate = await prisma.promptTemplate.findFirst({
        where: {
          category: 'system_base',
          is_active: true
        }
      });

      if (baseTemplate) {
        this.logger.info({
          templateId: baseTemplate.id,
          templateName: baseTemplate.name,
          contentLength: baseTemplate.content?.length
        }, '[PROMPT] ✅ Base formatting template loaded');

        return baseTemplate;
      }

      // Fallback to minimal formatting instructions if base template not found
      this.logger.warn('[PROMPT] ⚠️ Base formatting template not found, using fallback');

      return {
        id: 'fallback-base',
        name: 'Fallback Formatting',
        category: 'system_base',
        content: `# GEMINI-STYLE RESPONSE FORMATTING

You are a world-class AI assistant. Your responses must be **visually polished, scannable, and professional** - like Google Gemini or Claude. Never produce walls of plain text.

## 🎨 VISUAL PRESENTATION RULES

### Rule 1: EMOJI SECTION MARKERS
Start EVERY major section with a relevant emoji:
- 🏗️ Architecture / Infrastructure
- 📋 Requirements / Specifications
- 💡 Key Insights / Tips
- ⚙️ Configuration / Setup
- 🔧 Implementation / Technical Details
- 📊 Data / Metrics / Analysis
- ✅ Best Practices / Recommendations
- ⚠️ Warnings / Cautions / Considerations
- 🚀 Getting Started / Quick Start
- 📝 Summary / Conclusion

### Rule 2: BOLD LEAD TERMS IN LISTS
Every bullet point MUST have a **bold lead term** followed by explanation:
- **Correct:** "- **Scalability:** Horizontal scaling with Kubernetes auto-scaling"
- **Wrong:** "- The system can scale horizontally using Kubernetes"

### Rule 3: INLINE EMPHASIS
Use **bold** liberally for:
- Key concepts: "The **Cloud-First** approach is recommended"
- Important terms: "This uses a **Hybrid or Colocation transition**"
- Technical names: "Use **Azure Hub VNet** for connectivity"

### Rule 4: NUMBERED SECTIONS WITH BOLD HEADINGS
For multi-part explanations, use numbered bold headings:

**1. Modular and Scalable Core (Microservices)**
Content here...

**2. Infrastructure Options & Cost Analysis**
Content here...

### Rule 5: STRUCTURED HIERARCHY

Always organize with clear heading hierarchy:
- # for main title (rarely needed - usually implicit)
- ## for major sections (with emoji)
- ### for subsections
- **Bold text** for inline emphasis within paragraphs

---

## 📋 MANDATORY FORMATTING ELEMENTS

### Code Blocks (CRITICAL)
ALWAYS use fenced code blocks with language:
\`\`\`python
def example():
    return "Hello World"
\`\`\`

### Tables for Comparisons
| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Cloud-First** | ✅ Fast scaling | ❌ Ongoing costs | $$$$ |
| **Hybrid** | ✅ Balanced | ⚠️ Complexity | $$$ |
| **On-Prem** | ✅ One-time cost | ❌ Slow scaling | $$ |

### Diagrams for Architecture
Use D2 or Mermaid for any system/architecture explanation:
\`\`\`d2
OnPrem: "On-Premises DC"
Azure: "Azure Cloud"
OnPrem -> Azure: "ExpressRoute"
\`\`\`

### Math with LaTeX
Inline: $E = mc^2$
Display: $$\\sum_{i=1}^{n} x_i$$

---

## 🎯 RESPONSE STRUCTURE TEMPLATE

For substantive answers, follow this structure:

## 🎯 [Direct Answer/Summary]
One-sentence direct answer to the question.

[Brief context paragraph with **bold key terms**]

## 📋 [Main Section 1 - with emoji]

**1. First Point**
- **Sub-point A:** Explanation here
- **Sub-point B:** More details

**2. Second Point**
Content with **emphasis** on key terms.

## 💡 Key Insights

> **Note:** Important callout using blockquote

## ✅ Recommendations

| Recommendation | Priority | Rationale |
|----------------|----------|-----------|
| **Action 1** | High | Because... |
| **Action 2** | Medium | Since... |

---

## ❌ ANTI-PATTERNS TO AVOID

1. **NO walls of text** - Break up with headings, bullets, whitespace
2. **NO plain bullet lists** - Always use **bold lead terms**
3. **NO section without emoji** - Major sections need visual markers
4. **NO unformatted comparisons** - Use tables for structured data
5. **NO buried key terms** - Bold important concepts inline
6. **NO monospace overuse** - Only \`code\` for actual code/commands

---

## ✅ QUICK REFERENCE

| Element | When to Use | Example |
|---------|-------------|---------|
| ## 🎨 Heading | Every major section | ## 🏗️ Architecture |
| **Bold lead** | Every bullet point | - **Scaling:** Auto-scales... |
| **Inline bold** | Key terms in text | The **microservices** approach... |
| Tables | Comparisons, data, options | See above |
| Diagrams | Architecture, flows | D2 or Mermaid |
| > Blockquotes | Tips, warnings, notes | > **Tip:** Consider... |

**Remember:** Your goal is to produce responses that look like polished technical documentation - scannable, visual, and professional.`
      };

    } catch (error) {
      this.logger.error({ error: error.message }, '[PROMPT] ❌ Failed to load base template');

      // Return minimal fallback to ensure formatting is always available
      return {
        id: 'error-fallback',
        name: 'Error Fallback',
        category: 'system_base',
        content: 'Use formatting MCP tools when appropriate for better responses.'
      };
    }
  }

  private async loadUserPromptTemplate(context: PipelineContext): Promise<any> {
    try {
      this.logger.info({
        userId: context.user.id,
        userGroups: context.user.groups,
        messagePreview: context.request.message.substring(0, 50),
        hasPromptService: !!this.promptService
      }, '[PROMPT] 🔍 Querying prompt service for user template...');

      // STEP 1: Load base formatting template (ALWAYS applied)
      const baseTemplate = await this.loadBaseFormattingTemplate();

      // STEP 2: Load domain-specific template
      // Use the unified method that ensures admin portal is SOT
      const promptResult = await this.promptService.getSystemPromptForUser(
        context.user.id,
        context.request.message,
        context.user.groups
      );

      this.logger.info({
        userId: context.user.id,
        hasPromptTemplate: !!promptResult?.promptTemplate,
        hasContent: !!promptResult?.content,
        contentLength: promptResult?.content?.length,
        promptServiceResult: {
          templateId: promptResult?.promptTemplate?.id,
          templateName: promptResult?.promptTemplate?.name,
          templateCategory: promptResult?.promptTemplate?.category,
          isDefault: promptResult?.promptTemplate?.is_default,
          isActive: promptResult?.promptTemplate?.is_active
        }
      }, '[PROMPT] 📊 Prompt service result analysis');

      // STEP 3: Compose base + domain templates
      let domainTemplate;

      if (promptResult.promptTemplate) {
        this.logger.info({
          userId: context.user.id,
          promptTemplateId: promptResult.promptTemplate.id,
          promptName: promptResult.promptTemplate.name,
          promptCategory: promptResult.promptTemplate.category,
          contentLength: promptResult.promptTemplate.content?.length,
          isDefault: promptResult.promptTemplate.is_default,
          createdAt: promptResult.promptTemplate.created_at,
          updatedAt: promptResult.promptTemplate.updated_at,
          assignmentSource: 'admin_portal'
        }, '[PROMPT] ✅ Using specific prompt template from admin portal');

        domainTemplate = promptResult.promptTemplate;
      } else {
        // Fallback to direct content
        this.logger.warn({
          userId: context.user.id,
          contentLength: promptResult?.content?.length,
          contentPreview: promptResult?.content?.substring(0, 100)
        }, '[PROMPT] ⚠️ No specific prompt template found, using direct content');

        domainTemplate = {
          id: 'direct-content',
          name: 'Direct Content',
          content: promptResult.content,
          category: 'system',
          isDefault: true,
          assignmentSource: 'fallback_content'
        };
      }

      // STEP 4: Compose the final template (BASE + DOMAIN)
      const composedTemplate = this.composeTemplates(baseTemplate, domainTemplate);

      this.logger.info({
        userId: context.user.id,
        baseTemplateId: baseTemplate.id,
        domainTemplateId: domainTemplate.id,
        composedContentLength: composedTemplate.content.length,
        composition: {
          baseLength: baseTemplate.content?.length || 0,
          domainLength: domainTemplate.content?.length || 0,
          totalLength: composedTemplate.content.length
        }
      }, '[PROMPT] ✅ Template composition complete (BASE + DOMAIN)');

      // Store template information in composedTemplate metadata for tracking
      composedTemplate._trackingData = {
        baseTemplateId: typeof baseTemplate.id === 'number' ? baseTemplate.id : undefined,
        baseTemplateName: baseTemplate.name,
        domainTemplateId: typeof domainTemplate.id === 'number' ? domainTemplate.id : undefined,
        domainTemplateName: domainTemplate.name
      };

      return composedTemplate;

    } catch (error) {
      this.logger.error({
        userId: context.user.id,
        error: error.message,
        stack: error.stack,
        errorType: error.constructor?.name
      }, '[PROMPT] ❌ Failed to load prompt template');

      // FATAL: Cannot load any prompt template - re-throw error
      this.logger.error({
        userId: context.user.id,
        error: error.message,
        promptServiceAvailable: !!this.promptService
      }, '[PROMPT] 💥 FATAL: Cannot load any prompt template - system failure');
      throw new Error('PROMPT_SYSTEM_FAILURE: Admin portal prompt system is not properly configured');
    }
  }

  private async loadPromptTechniques(context: PipelineContext): Promise<PromptTechnique[]> {
    // Feature flag: Prompt techniques disabled for now, future enhancement
    // TODO: Re-enable when PromptTechniqueService is ready
    const PROMPT_TECHNIQUES_ENABLED = false;
    
    if (!PROMPT_TECHNIQUES_ENABLED) {
      return [];
    }
    
    try {
      const techniques = await this.promptService.getUserPromptTechniques(context.user.id);
      
      // Add default techniques if none configured
      if (!techniques || techniques.length === 0) {
        // Disabled - no hardcoded prompts
        return [];
      }
      
      // Filter to only enabled techniques
      return techniques.filter((technique: PromptTechnique) => technique.enabled);
      
    } catch (error) {
      this.logger.warn({ 
        userId: context.user.id,
        error: error.message 
      }, 'Failed to load prompt techniques, using defaults');
      
      return [];
    }
  }

  /**
   * Get the active personality configuration from pipeline config
   */
  private getActivePersonality(context: PipelineContext): PersonalityConfig | null {
    try {
      const promptConfig = context.pipelineConfig?.stages?.prompt;
      if (!promptConfig?.enablePersonality || !promptConfig.activePersonalityId) {
        return null;
      }

      const personalityId = promptConfig.activePersonalityId;

      // Check built-in personalities first
      const builtIn = BUILT_IN_PERSONALITIES.find(p => p.id === personalityId);
      if (builtIn) {
        return builtIn;
      }

      // Check custom personalities
      const custom = promptConfig.customPersonalities?.find((p: PersonalityConfig) => p.id === personalityId);
      if (custom) {
        return custom;
      }

      this.logger.warn({
        personalityId,
        availableBuiltIn: BUILT_IN_PERSONALITIES.map(p => p.id),
        availableCustom: promptConfig.customPersonalities?.map((p: PersonalityConfig) => p.id) || []
      }, '[PROMPT] Configured personality not found');

      return null;
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, '[PROMPT] Failed to get active personality');
      return null;
    }
  }

  private async buildSystemPrompt(
    context: PipelineContext,
    promptTemplate: any,
    techniques: PromptTechnique[]
  ): Promise<string> {
    let systemPrompt = promptTemplate.content;

    // PERSONALITY INJECTION: Add fun personality styling if enabled
    const activePersonality = this.getActivePersonality(context);
    if (activePersonality) {
      const personalitySection = `
---

# 🎭 PERSONALITY MODE: ${activePersonality.emoji} ${activePersonality.name}

**CRITICAL INSTRUCTION**: You MUST adopt the following personality for ALL responses in this conversation.
This personality styling takes PRECEDENCE over your default response style.

${activePersonality.systemPrompt}

**REMEMBER**: Stay in character for EVERY response! This is ${activePersonality.name} mode - have fun with it!

---
`;
      systemPrompt = `${personalitySection}\n${systemPrompt}`;

      // Track personality in context for metrics
      (context as any)._activePersonality = {
        id: activePersonality.id,
        name: activePersonality.name,
        emoji: activePersonality.emoji
      };

      this.logger.info({
        userId: context.user.id,
        personalityId: activePersonality.id,
        personalityName: activePersonality.name
      }, '[PROMPT] 🎭 Personality injected into system prompt');
    }

    // PHASE 3: Inject comprehensive formatting capabilities guidance
    // This replaces the need for MCP formatting tools - all capabilities are built into the UI
    try {
      const formattingService = getFormattingCapabilitiesService(this.logger);
      const formattingGuidance = formattingService.generateSystemPromptSection();

      if (formattingGuidance) {
        systemPrompt += `\n\n---\n\n${formattingGuidance}`;

        // Mark that formatting was injected (for tracking)
        (context as any)._hasFormattingInjection = true;

        this.logger.info({
          userId: context.user.id,
          guidanceLength: formattingGuidance.length,
          capabilitiesCount: formattingService.getAllCapabilities().length,
          presetsCount: formattingService.getAllPresets().length
        }, '[PROMPT] 📝 Formatting capabilities injected into system prompt');

        // Add contextual formatting guidance based on user query
        const queryGuidance = formattingService.getGuidanceForQuery(context.request.message);
        if (queryGuidance.tips.length > 0) {
          systemPrompt += `\n\n## Contextual Formatting Tips for This Query:\n`;
          queryGuidance.tips.forEach(tip => {
            systemPrompt += `- ${tip}\n`;
          });

          if (queryGuidance.preset) {
            systemPrompt += `\n**Recommended Preset:** ${queryGuidance.preset.name}\n`;
            systemPrompt += `${queryGuidance.preset.description}\n`;
          }

          this.logger.info({
            userId: context.user.id,
            recommendedCapabilities: queryGuidance.recommendedCapabilities,
            discouragedCapabilities: queryGuidance.discouragedCapabilities,
            preset: queryGuidance.preset?.name,
            tipsCount: queryGuidance.tips.length
          }, '[PROMPT] 💡 Contextual formatting guidance added');
        }
      }
    } catch (error) {
      this.logger.warn({
        error: (error as Error).message,
        stack: (error as Error).stack
      }, '[PROMPT] ⚠️ Failed to inject formatting capabilities - continuing without them');
    }

    // SYSTEM MCP: Inject diagram generation capabilities if user is asking for a diagram
    try {
      const systemMcpPrompts = getSystemMcpPrompts(context.request.message);
      if (systemMcpPrompts.length > 0) {
        this.logger.info({
          userId: context.user.id,
          isDiagramRequest: isDiagramRequest(context.request.message),
          systemMcpCount: systemMcpPrompts.length
        }, '[PROMPT] 📊 Injecting System MCP prompts (diagram generation)');

        systemMcpPrompts.forEach(mcpPrompt => {
          systemPrompt += `\n\n---\n\n${mcpPrompt}`;
        });
      }
    } catch (error) {
      this.logger.warn({
        error: (error as Error).message
      }, '[PROMPT] ⚠️ Failed to inject System MCP prompts');
    }

    // Add context about available MCPs if enabled
    if (context.config.enableMCP) {
      const mcpContext = await this.buildMCPContext(context);
      if (mcpContext) {
        systemPrompt += `\n\n${mcpContext}`;
        // Mark that MCP context was injected (for tracking)
        (context as any)._hasMcpContextInjection = true;
      }
    }

    // Add session context if available
    if (context.session && context.session.metadata) {
      const sessionContext = this.buildSessionContext(context.session.metadata);
      if (sessionContext) {
        systemPrompt += `\n\n${sessionContext}`;
      }
    }

    // Apply technique instructions that should be in system prompt
    const systemTechniques = techniques.filter(t =>
      t.configuration?.placement === 'system_prompt'
    );

    for (const technique of systemTechniques) {
      if (technique.configuration?.instruction) {
        systemPrompt += `\n\n${technique.configuration.instruction}`;
      }
    }

    // Add current timestamp for temporal context
    systemPrompt += `\n\nCurrent time: ${new Date().toISOString()}`;

    return systemPrompt.trim();
  }

  private async buildMCPContext(context: PipelineContext): Promise<string | null> {
    try {
      // MCP tools are discovered and provided by the MCP stage
      // The system prompt templates already include instructions for tool usage
      // No need to dynamically list servers here since tools come with full descriptions

      this.logger.debug('MCP tools will be provided by MCP stage with full descriptions');

      // Return tool call instructions with explicit capability awareness
      return `## Your Capabilities

You are an AI assistant with access to tools and capabilities when needed. You can EXECUTE actions and RETRIEVE real data, but you MUST use good judgment about when tools are necessary.

### 🚨🚨🚨 CRITICAL: TOOL RELEVANCE CHECK 🚨🚨🚨

**BEFORE calling ANY tool, you MUST verify the tool matches the user's request domain:**

| User Query Topic | Allowed Tools | FORBIDDEN Tools |
|------------------|---------------|-----------------|
| Azure/cloud infra | azure-*, subscription_list | aws-*, gcp-*, web_search |
| AWS cloud | aws-*, suggest_aws | azure-*, gcp-*, web_search |
| GCP cloud | gcp-* | azure-*, aws-*, web_search |
| Flight tickets | web_search, web_fetch | azure-*, aws-*, gcp-*, admin-* |
| Restaurant reservations | web_search, web_fetch | azure-*, aws-*, gcp-*, admin-* |
| Weather | web_search | azure-*, aws-*, gcp-*, admin-* |
| General web queries | web_search, web_fetch | azure-*, aws-*, gcp-*, admin-* |
| Coding questions | NONE - just answer | ALL tools are forbidden |
| Math/calculations | NONE - just answer | ALL tools are forbidden |
| Greetings | NONE - just answer | ALL tools are forbidden |

**EXAMPLE VIOLATIONS (NEVER DO THIS):**
- ❌ User asks about flight tickets → You call azure subscription tools (WRONG!)
- ❌ User says "Hello" → You call memory tools (WRONG!)
- ❌ User asks about weather → You call AWS tools (WRONG!)

**CORRECT BEHAVIOR:**
- ✅ User asks about flight tickets → Use web_search ONLY
- ✅ User asks about Azure VMs → Use azure-* tools
- ✅ User says "Hello" → Just respond "Hello!" (NO tools!)

### ✅ TOOL CATEGORIES (Match Request to Category):

1. **Cloud Infrastructure (Azure/AWS/GCP)** - ONLY for cloud resource queries
   - "Show my Azure subscriptions" → azure-* tools
   - "List my S3 buckets" → aws-* tools
   - "What GCP projects do I have?" → gcp-* tools

2. **Web Search** - For real-world information, travel, weather, general queries
   - "Find flights to Miami" → web_search
   - "What's the weather in NYC?" → web_search
   - "Restaurant recommendations in Paris" → web_search

3. **Image Generation** - ONLY for "create image", "draw", "generate picture"

4. **Memory** - ONLY when user explicitly says "what did we discuss", "our previous conversation"

### 🚫 MANDATORY RULE: NO TOOLS FOR SIMPLE REQUESTS

If the user says ANY of these, RESPOND IMMEDIATELY WITHOUT TOOLS:
- "Hello" / "Hi" / "Hey" → Just say hi back
- "What is 2+2?" → Answer "4"
- "Explain X" / "How does X work?" → Just explain it
- "Write code for X" → Just write the code
- ANY coding/math/explanation → Answer directly

**NEVER call these tools proactively:**
- admin_system_* tools - ONLY when user explicitly asks for system health
- memory_* tools - ONLY when user explicitly references past conversations
- sequentialthinking - DO NOT USE (you have native thinking)
- azure/aws/gcp tools - ONLY for cloud infrastructure queries about THEIR resources

### Tool Usage Summary:

- **MATCH the tool to the request domain** - Don't use Azure tools for flight queries!
- **USE tools** when user asks about their cloud resources OR needs real-time web data
- **DON'T use tools** for general questions, math, coding, or explanations
- **MINIMIZE tool calls** - Only call what's necessary, not everything available

---

## Tool Call Instructions (for cloud/infrastructure queries ONLY)

When the user asks about cloud resources (Azure, AWS, GCP), you have MCP tools to execute commands.

**When to use tools:**
- Cloud resource queries: "show my Azure subscriptions", "list AWS S3 buckets"
- Infrastructure commands: kubectl, az, aws CLI operations
- Image generation: "create an image of...", "draw...", "generate a picture of..."

**When NOT to use tools (just answer directly):**
- Math questions
- General knowledge questions
- Coding help
- Conversational messages

**Tool Behavior:**
- Execute silently without announcing "I'll..." or "Let me..."
- Present results naturally
- For multi-cloud queries (Azure AND AWS), call all relevant tools in parallel

**AWS-SPECIFIC:**
For AWS queries: First call \`suggest_aws_commands\`, then \`call_aws\` with the command.

---

## Response Quality Standards

Regardless of which AI model you are (GPT, Gemini, Claude, or other), you MUST follow these standards:

### 1. **Action-First Responses**
When the user asks for information that can be retrieved via tools:
- BAD: "To see your Azure subscriptions, you can run az account list..."
- GOOD: [Execute tool] "You have 3 Azure subscriptions: Production, Development, and Staging."

### 2. **Complete Answers**
Provide full, actionable responses in a single message:
- BAD: "I found some information. Would you like me to elaborate?"
- GOOD: Present ALL relevant information immediately with proper formatting.

### 3. **Proactive Tool Usage**
If multiple tools could provide useful context, call them ALL:
- BAD: Only call one tool when multiple are relevant
- GOOD: Call subscription_list AND resource group tools when asked about Azure infrastructure

### 4. **Error Transparency**
If a tool fails, explain what you tried and what went wrong:
- BAD: "I couldn't retrieve that information."
- GOOD: "I called the subscription_list tool but received an authentication error. Please ensure your Azure credentials are configured."

### 5. **Consistent Formatting**
Always use structured Markdown:
- Use headings (##, ###) for organization
- Use numbered lists for sequences
- Use code blocks with language tags for code
- Use tables for comparisons or tabular data`;


    } catch (error) {
      this.logger.warn({
        error: error.message
      }, 'Failed to build MCP context');
      return null;
    }
  }

  private buildSessionContext(metadata: Record<string, any>): string | null {
    const contextParts: string[] = [];

    // Add user preferences if available
    if (metadata.preferences) {
      contextParts.push(`User preferences: ${JSON.stringify(metadata.preferences)}`);
    }

    // Add session type or mode
    if (metadata.mode) {
      contextParts.push(`Session mode: ${metadata.mode}`);
    }

    // Add any special instructions
    if (metadata.instructions) {
      contextParts.push(`Special instructions: ${metadata.instructions}`);
    }

    return contextParts.length > 0 ? `Session Context:\n${contextParts.join('\n')}` : null;
  }

  /**
   * Format memory context for inclusion in system prompt
   * This ensures the LLM has access to information from previous conversations
   */
  private formatMemoryContextForPrompt(memoryContext: any): string | null {
    if (!memoryContext?.memories || memoryContext.memories.length === 0) {
      return null;
    }

    const sections: string[] = [
      '## IMPORTANT: Information from Previous Conversations',
      '',
      '**You HAVE access to information from previous conversations with this user.**',
      'The following context was retrieved from your memory system. USE THIS INFORMATION when answering questions about previous interactions.',
      ''
    ];

    // Group memories by type
    const byType: Record<string, any[]> = {};
    for (const mem of memoryContext.memories) {
      const type = mem.type || 'general';
      if (!byType[type]) byType[type] = [];
      byType[type].push(mem);
    }

    // Format session memories
    if (byType['session']?.length > 0) {
      sections.push('### Current Session Context:');
      for (const mem of byType['session']) {
        sections.push(`- ${mem.content}`);
      }
      sections.push('');
    }

    // Format user memories (long-term)
    if (byType['user']?.length > 0) {
      sections.push('### User History (from previous sessions):');
      for (const mem of byType['user']) {
        sections.push(`- ${mem.content}`);
      }
      sections.push('');
    }

    // Format semantic memories (facts/knowledge)
    if (byType['semantic']?.length > 0) {
      sections.push('### Retrieved Information from Previous Conversations:');
      sections.push('This data was retrieved from your long-term memory. Reference it when the user asks about previous queries or results.');
      for (const mem of byType['semantic']) {
        sections.push(`- ${mem.content}`);
      }
      sections.push('');
    }

    // Format any other memory types
    const otherTypes = Object.keys(byType).filter(t => !['session', 'user', 'semantic'].includes(t));
    for (const type of otherTypes) {
      sections.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)} Memories:`);
      for (const mem of byType[type]) {
        sections.push(`- ${mem.content}`);
      }
      sections.push('');
    }

    // Add reminder
    sections.push('---');
    sections.push('**REMEMBER**: When the user asks "what did I have", "from our previous conversation", or references past interactions, USE the information above.');
    sections.push('Do NOT claim you cannot retain information from previous conversations - your memory system provides this capability.');

    return sections.join('\n');
  }

  private async applyPromptEngineering(
    context: PipelineContext, 
    techniques: PromptTechnique[]
  ): Promise<PromptEngineeringResult> {
    const result: PromptEngineeringResult = {
      systemPrompt: context.systemPrompt || '',
      techniques: [],
      appliedTechniques: [],
      messageModifications: [],
      systemPromptAdditions: [],
      tokensAdded: 0,
      metadata: {
        selectionReason: 'Default prompt engineering applied',
        confidence: 1.0,
        processingTime: 0,
        cacheHit: false
      }
    };
    
    // Apply advanced prompt techniques if service is available
    if (this.techniqueService) {
      try {
        const techniqueResults = await this.techniqueService.applyTechniques(
          context.user.id,
          context.systemPrompt || '',
          context.request.message,
          {
            maxTokens: 500
          }
        );
        
        if (techniqueResults && techniqueResults.length > 0) {
          for (const techniqueResult of techniqueResults) {
            if (techniqueResult.enhancedPrompt) {
              result.systemPromptAdditions.push(techniqueResult.enhancedPrompt);
              result.appliedTechniques.push(techniqueResult.techniqueId);
              result.tokensAdded += techniqueResult.tokensAdded || 0;
            }
          }
          
          this.logger.info({
            techniquesApplied: techniqueResults.length,
            tokensAdded: result.tokensAdded
          }, 'Applied advanced prompt techniques');
        }
      } catch (error) {
        this.logger.warn({ error: error.message }, 'Failed to apply advanced prompt techniques');
      }
    }
    
    // Apply context-aware directives if service is available
    if (this.directiveService) {
      try {
        const directives = this.directiveService.generateDynamicDirectives(
          context.request.message,
          {
            sentiment: 'neutral',
            complexity: 'moderate',
            urgency: false,
            technical_level: 'intermediate'
          }
        );
        
        if (directives && directives.length > 0) {
          result.systemPromptAdditions.push(...directives);
          result.appliedTechniques.push('contextual_directives');
          result.tokensAdded += Math.ceil(directives.join(' ').length / 4);
          
          this.logger.info({ 
            directivesLength: directives.length 
          }, 'Applied contextual directives');
        }
      } catch (error) {
        this.logger.warn({ error: error.message }, 'Failed to apply directives');
      }
    }
    
    // Apply original techniques
    for (const technique of techniques) {
      try {
        const modification = await this.applyTechnique(context, technique);
        if (modification) {
          result.appliedTechniques.push(technique.name);
          
          switch (technique.configuration?.placement) {
            case 'before_content':
              result.messageModifications.push({
                type: 'prepend',
                content: modification
              });
              break;
            case 'after_content':
              result.messageModifications.push({
                type: 'append',
                content: modification
              });
              break;
            case 'system_prompt':
              result.systemPromptAdditions.push(modification);
              break;
          }
          
          // Estimate tokens added (rough approximation)
          result.tokensAdded += Math.ceil(modification.length / 4);
        }
      } catch (error) {
        this.logger.warn({ 
          technique: technique.name,
          error: error.message 
        }, 'Failed to apply prompt technique');
      }
    }
    
    return result;
  }

  private async applyTechnique(
    context: PipelineContext, 
    technique: PromptTechnique
  ): Promise<string | null> {
    const config = technique.configuration || {};
    
    switch (technique.name.toLowerCase()) {
      case 'chain_of_thought':
      case 'cot':
        // No hardcoded prompts - use config only
        return config.instruction || null;
        
      case 'few_shot':
        return this.buildFewShotExamples(config);
        
      case 'roleplay':
        return (config.parameters?.role) ? `You are acting as ${config.parameters.role}.` : null;
        
      case 'clear_thinking':
        // No hardcoded prompts - use config only
        return config.instruction || null;
        
      case 'structured_response':
        return 'Please structure your response with clear headings and bullet points where appropriate.';
        
      case 'question_decomposition':
        return 'Break down complex questions into smaller parts and address each one.';
        
      default:
        // Custom technique - use provided instruction
        return config.instruction || null;
    }
  }

  private detectTaskType(message: string): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.match(/\b(debug|fix|error|bug|issue)\b/)) return 'debugging';
    if (lowerMessage.match(/\b(create|build|implement|develop|write)\b/)) return 'creation';
    if (lowerMessage.match(/\b(analyze|review|evaluate|assess)\b/)) return 'analysis';
    if (lowerMessage.match(/\b(explain|describe|what|how|why)\b/)) return 'explanation';
    if (lowerMessage.match(/\b(optimize|improve|enhance|refactor)\b/)) return 'optimization';
    if (lowerMessage.match(/\b(test|verify|validate|check)\b/)) return 'testing';
    
    return 'general';
  }
  
  private detectCategory(context: PipelineContext): string {
    const message = context.request.message.toLowerCase();
    
    if (message.match(/\b(code|function|class|api|backend|frontend|database)\b/)) return 'engineering';
    if (message.match(/\b(cost|roi|budget|revenue|profit|business)\b/)) return 'business';
    if (message.match(/\b(design|creative|content|copy|marketing)\b/)) return 'creative';
    if (message.match(/\b(data|analytics|metrics|statistics|report)\b/)) return 'analytical';
    if (message.match(/\b(research|study|paper|academic|scientific)\b/)) return 'research';
    
    return 'general';
  }

  private buildFewShotExamples(config: any): string | null {
    if (!config.examples || !Array.isArray(config.examples)) {
      return null;
    }
    
    const examples = config.examples
      .map((example: any, index: number) => 
        `Example ${index + 1}:\nQ: ${example.input}\nA: ${example.output}`
      )
      .join('\n\n');
    
    return examples ? `Here are some examples of how to respond:\n\n${examples}` : null;
  }

  /**
   * STEP 2: Retrieve relevant knowledge from vector database
   */
  private async retrieveKnowledge(context: PipelineContext): Promise<any> {
    if (!this.knowledgeService) {
      this.logger.debug('Knowledge service not available, skipping RAG retrieval');
      return null;
    }

    try {
      const startTime = Date.now();

      // Check if user is admin
      const isAdmin = context.user.isAdmin === true;

      // Check if query is Azure-related for specialized knowledge retrieval
      const isAzureQuery = AzureSDKKnowledgeIngester.isAzureQuery(context.request.message);

      // Search for relevant documentation (available to all users)
      const docsPromise = this.knowledgeService.search(context.request.message, {
        collections: ['app_documentation'],
        limit: isAdmin ? 5 : 3, // Admins get more results
        includePrivate: isAdmin, // Admins can see private docs
        includeSources: true
      });

      // Search for relevant chat conversations
      let chatsPromise;
      if (isAdmin) {
        // ADMINS: Can search ALL chat history across all users
        chatsPromise = this.knowledgeService.search(context.request.message, {
          collections: ['chat_conversations'],
          limit: 5,
          includePrivate: true, // Include all conversations
          includeSources: true,
          // No userId filter - search all users' chats
        });

        this.logger.info({
          userId: context.user.id,
          isAdmin: true
        }, 'Admin user - searching all chat history');
      } else {
        // REGULAR USERS: Can only search their own chat history
        chatsPromise = this.knowledgeService.search(context.request.message, {
          collections: ['chat_conversations'],
          limit: 2,
          userId: context.user.id, // Privacy filter - only user's own chats
          includePrivate: false,
          includeSources: true
        });
      }

      // Azure SDK Knowledge retrieval (automatic for Azure-related queries)
      let azureDocsPromise: Promise<any[]> = Promise.resolve([]);
      if (isAzureQuery) {
        this.logger.info({
          userId: context.user.id,
          message: context.request.message.substring(0, 100)
        }, 'Azure-related query detected, retrieving Azure SDK documentation');

        azureDocsPromise = this.retrieveAzureSDKKnowledge(context.request.message);
      }

      // Execute searches in parallel
      const [docs, chats, azureDocs] = await Promise.all([
        docsPromise.catch(err => {
          this.logger.warn({ error: err.message }, 'Failed to retrieve documentation');
          return [];
        }),
        chatsPromise.catch(err => {
          this.logger.warn({ error: err.message }, 'Failed to retrieve chat history');
          return [];
        }),
        azureDocsPromise.catch(err => {
          this.logger.warn({ error: err.message }, 'Failed to retrieve Azure SDK documentation');
          return [];
        })
      ]);

      this.logger.info({
        userId: context.user.id,
        isAdmin,
        docsRetrieved: docs.length,
        chatsRetrieved: chats.length,
        azureDocsRetrieved: azureDocs.length,
        isAzureQuery,
        retrievalTime: Date.now() - startTime
      }, 'Knowledge retrieved successfully');

      return { docs, chats, azureDocs, isAdmin, isAzureQuery };

    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to retrieve knowledge');
      return null;
    }
  }

  /**
   * Retrieve Azure SDK documentation from Milvus
   * This runs automatically when Azure-related queries are detected
   */
  private async retrieveAzureSDKKnowledge(query: string): Promise<any[]> {
    try {
      // Try to get Azure SDK knowledge ingester from Milvus
      // Note: This requires the service to be initialized with Milvus connection
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');

      const milvusHost = process.env.MILVUS_HOST || 'agenticworkchat-milvus';
      const milvusPort = process.env.MILVUS_PORT || '19530';

      const milvus = new MilvusClient({
        address: `${milvusHost}:${milvusPort}`
      });

      const ingester = new AzureSDKKnowledgeIngester(milvus, this.logger);

      // Search Azure SDK documentation
      const results = await ingester.search(query, {
        limit: 5,
        minPriority: 5 // Only return high-priority documentation
      });

      return results;
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'Failed to retrieve Azure SDK knowledge');
      return [];
    }
  }

  /**
   * STEP 3: Enhance prompt with retrieved knowledge
   */
  private async enhanceWithKnowledge(
    systemPrompt: string,
    knowledgeContext: any,
    context: PipelineContext
  ): Promise<string> {
    if (!knowledgeContext || (
      !knowledgeContext.docs?.length &&
      !knowledgeContext.chats?.length &&
      !knowledgeContext.azureDocs?.length &&
      !knowledgeContext.artifacts?.length
    )) {
      return systemPrompt;
    }

    const knowledgeSections: string[] = [];

    // Add Azure SDK documentation FIRST (highest priority for Azure queries)
    if (knowledgeContext.azureDocs?.length > 0) {
      const azureDocContext = knowledgeContext.azureDocs
        .map((doc: any) => {
          const source = doc.sourceUrl ? `[Source: ${doc.source}](${doc.sourceUrl})\n` : `[${doc.source}]\n`;
          const commands = doc.metadata?.commands?.length > 0
            ? `\n**Commands:** ${doc.metadata.commands.join(', ')}`
            : '';
          const examples = doc.metadata?.examples?.length > 0
            ? `\n**Examples:**\n\`\`\`\n${doc.metadata.examples[0]}\n\`\`\``
            : '';
          return `${source}${doc.content}${commands}${examples}`;
        })
        .join('\n\n---\n\n');

      knowledgeSections.push(`## Azure SDK/CLI Documentation:

**IMPORTANT: Use this documentation to understand how to execute Azure commands with the azure-sdk-mcp tools.**
The following is the latest Azure SDK documentation relevant to your query:

${azureDocContext}`);

      this.logger.info({
        azureDocsIncluded: knowledgeContext.azureDocs.length,
        firstDocSource: knowledgeContext.azureDocs[0]?.source
      }, 'Azure SDK documentation injected into prompt');
    }

    // Add relevant documentation
    if (knowledgeContext.docs?.length > 0) {
      const docContext = knowledgeContext.docs
        .map((doc: any) => {
          const source = doc.metadata?.source ? `[Source: ${doc.metadata.source}]\n` : '';
          return `${source}${doc.content}`;
        })
        .join('\n\n');

      knowledgeSections.push(`## Relevant Documentation:\n${docContext}`);
    }

    // Add relevant chat history
    if (knowledgeContext.chats?.length > 0) {
      const chatLabel = knowledgeContext.isAdmin ?
        '## Related Conversations (All Users):' :
        '## Related Previous Conversations:';

      const chatContext = knowledgeContext.chats
        .map((chat: any) => {
          const timestamp = chat.metadata?.timestamp ?
            new Date(chat.metadata.timestamp).toISOString() : 'Unknown time';

          // For admins, include user information
          if (knowledgeContext.isAdmin && chat.metadata?.userId) {
            return `[User: ${chat.metadata.userId} | ${timestamp}]\n${chat.content}`;
          }

          return `[${timestamp}]\n${chat.content}`;
        })
        .join('\n\n');

      knowledgeSections.push(`${chatLabel}\n${chatContext}`);
    }

    // Add user artifacts (saved reports, exports, files)
    if (knowledgeContext.artifacts?.length > 0) {
      const artifactContext = knowledgeContext.artifacts
        .map((artifact: any) => {
          const title = artifact.metadata?.title || artifact.metadata?.filename || 'Untitled';
          const type = artifact.metadata?.type || 'file';
          const date = artifact.metadata?.createdAt ?
            new Date(artifact.metadata.createdAt).toLocaleDateString() : 'Unknown date';
          const tags = artifact.metadata?.tags?.length > 0 ?
            `Tags: ${artifact.metadata.tags.join(', ')}` : '';

          return `### ${title}
**Type:** ${type} | **Created:** ${date}
${tags}

${artifact.content}`;
        })
        .join('\n\n---\n\n');

      knowledgeSections.push(`## Your Saved Documents:

The following are previously saved reports, exports, or files that may be relevant:

${artifactContext}`);

      this.logger.info({
        artifactsIncluded: knowledgeContext.artifacts.length,
        firstArtifactTitle: knowledgeContext.artifacts[0]?.metadata?.title
      }, '[PROMPT] User artifacts injected into prompt');
    }

    // Combine knowledge with system prompt
    if (knowledgeSections.length > 0) {
      const knowledgeSection = knowledgeSections.join('\n\n---\n\n');

      // Add admin notice if applicable
      const adminNote = knowledgeContext.isAdmin ?
        '\n\n**Admin Mode**: You have access to all users\' chat history and private documentation.' : '';

      // Add Azure-specific instruction if Azure docs were retrieved
      const azureInstruction = knowledgeContext.isAzureQuery ?
        '\n\n**Azure Query Detected**: Use the Azure SDK documentation above to formulate the correct commands. Execute them using the azure-sdk-mcp tools.' : '';

      // Add knowledge context before the user's question
      return `${systemPrompt}${adminNote}${azureInstruction}\n\n---\n\n# Retrieved Knowledge Context:\n${knowledgeSection}\n\n---\n\nBased on the above context and your knowledge, please respond to the user's query.`;
    }

    return systemPrompt;
  }

  async rollback(context: PipelineContext): Promise<void> {
    // Clear prompt-related context if needed
    context.systemPrompt = undefined;
    context.promptEngineering = undefined;
    
    this.logger.debug({ 
      messageId: context.messageId 
    }, 'Prompt stage rollback completed');
  }
}
