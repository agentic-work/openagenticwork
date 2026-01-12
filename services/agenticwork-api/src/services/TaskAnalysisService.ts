/**
 * Task Analysis Service - Intelligent Model Routing
 *
 * Analyzes user requests to determine optimal model routing based on complexity.
 *
 * CRITICAL: NO hardcoded providers or models!
 * Provider routing is delegated to ProviderManager which maintains the actual
 * model-to-provider mappings from provider configuration.
 *
 * This service ONLY analyzes task complexity and suggests models from env config.
 * The actual provider selection is handled by ProviderManager.selectProvider().
 */

import type { Logger } from 'pino';

export interface TaskAnalysis {
  taskType: 'reasoning' | 'vision' | 'image_generation' | 'standard' | 'multimodal';
  confidence: number; // 0-1
  suggestedModel: string | undefined;
  reasoning: string;
  requiresVision: boolean;
  requiresImageGen: boolean;
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedCost: 'free' | 'minimal' | 'low' | 'medium' | 'high' | 'premium';
}

export interface TaskRequirements {
  messages: Array<{
    role: string;
    content: any;
  }>;
  hasImages?: boolean;
  tools?: any[];
  requestedModel?: string;  // Model explicitly requested by user/system
  sliderConfig?: {
    position: number;       // 0-100
    costWeight: number;     // Higher = prefer cheaper models
    qualityWeight: number;  // Higher = prefer quality models
    enableThinking: boolean;
    source: 'user' | 'global' | 'default' | 'budget-auto-adjust';
  };
}

export class TaskAnalysisService {
  private routeSimpleToOllama: boolean;
  private routeComplexToClaude: boolean;
  private ollamaModel: string | undefined;
  private claudeModel: string | undefined;
  private geminiModel: string | undefined;
  private fallbackModel: string | undefined;

  constructor(private logger: Logger) {
    // Check if providers are explicitly enabled (must be 'true' to use)
    const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true';
    const vertexAiEnabled = process.env.VERTEX_AI_ENABLED === 'true';

    // Load routing configuration from environment
    // Only enable Ollama routing if OLLAMA_ENABLED is true
    this.routeSimpleToOllama = ollamaEnabled && process.env.ROUTE_SIMPLE_TO_OLLAMA === 'true';
    this.routeComplexToClaude = process.env.ROUTE_COMPLEX_TO_CLAUDE === 'true';

    // Model config from environment (no hardcoded defaults)
    // Only load models for enabled providers
    this.ollamaModel = ollamaEnabled ? (process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL) : undefined;
    this.claudeModel = process.env.AWS_BEDROCK_CHAT_MODEL || process.env.VERTEX_CLAUDE_VERSION;
    // CRITICAL: Only load Gemini model if Vertex AI is enabled
    this.geminiModel = vertexAiEnabled ? (process.env.VERTEX_AI_CHAT_MODEL || process.env.VERTEX_DEFAULT_MODEL) : undefined;
    // Don't use Ollama as fallback if not enabled
    this.fallbackModel = process.env.DEFAULT_MODEL || (ollamaEnabled ? this.ollamaModel : undefined);

    this.logger.info({
      ollamaEnabled,
      vertexAiEnabled,
      routeSimpleToOllama: this.routeSimpleToOllama,
      routeComplexToClaude: this.routeComplexToClaude,
      ollamaModel: this.ollamaModel,
      claudeModel: this.claudeModel,
      geminiModel: this.geminiModel,
      fallbackModel: this.fallbackModel
    }, '[TaskAnalysis] Routing configuration loaded - provider selection delegated to ProviderManager');
  }

  /**
   * Analyze the task requirements and suggest a model
   *
   * NOTE: This method ONLY returns the suggested model.
   * Provider selection is handled by ProviderManager based on its model-to-provider mapping.
   *
   * SLIDER INTEGRATION:
   * - Position 0-40 (costWeight > 0.6): Prefer cheaper models (Ollama, Haiku)
   * - Position 41-60 (balanced): Use default routing based on task complexity
   * - Position 61-100 (qualityWeight > 0.6): Prefer quality models (Claude, GPT-4)
   */
  async analyzeTask(requirements: TaskRequirements): Promise<TaskAnalysis> {
    const lastMessage = this.getLastUserMessage(requirements.messages);
    const hasTools = requirements.tools && requirements.tools.length > 0;
    const slider = requirements.sliderConfig;

    // Log slider config for debugging
    if (slider) {
      this.logger.info({
        sliderPosition: slider.position,
        costWeight: slider.costWeight,
        qualityWeight: slider.qualityWeight,
        source: slider.source
      }, '🎚️ [TaskAnalysis] Slider config received');
    } else {
      this.logger.warn('🎚️ [TaskAnalysis] No slider config provided - using default routing');
    }

    // If model is explicitly requested, use it
    // EXCEPT: If Ollama is requested but tools are needed, upgrade to Gemini
    // because Ollama models aren't optimized for complex tool orchestration
    if (requirements.requestedModel) {
      const isOllamaModel = requirements.requestedModel.toLowerCase().includes('gpt-oss') ||
                           requirements.requestedModel.toLowerCase().includes('ollama') ||
                           requirements.requestedModel.toLowerCase().includes('qwen') ||
                           requirements.requestedModel.toLowerCase().includes('llama');

      // If Ollama model + has tools → upgrade to Gemini for better tool handling
      if (isOllamaModel && hasTools && (requirements.tools?.length ?? 0) > 0) {
        const toolCapableModel = this.geminiModel || process.env.VERTEX_AI_CHAT_MODEL || process.env.DEFAULT_MODEL;
        this.logger.warn({
          requestedModel: requirements.requestedModel,
          overriddenTo: toolCapableModel,
          toolCount: requirements.tools?.length,
          reason: 'Ollama models have poor tool-calling capability - upgrading to Gemini'
        }, '⚠️ [TaskAnalysis] Overriding Ollama model for tool-heavy query');

        return {
          taskType: 'standard',
          confidence: 0.9,
          suggestedModel: toolCapableModel,
          reasoning: `Upgraded from ${requirements.requestedModel} to ${toolCapableModel} for better tool handling (${requirements.tools?.length} tools)`,
          requiresVision: false,
          requiresImageGen: false,
          complexity: 'moderate',
          estimatedCost: 'low'
        };
      }

      return {
        taskType: 'standard',
        confidence: 0.95,
        suggestedModel: requirements.requestedModel,
        reasoning: `Using explicitly requested model: ${requirements.requestedModel}`,
        requiresVision: false,
        requiresImageGen: false,
        complexity: 'simple',
        estimatedCost: 'low'
      };
    }

    // Check for image inputs (vision task)
    if (requirements.hasImages || this.hasImageContent(requirements.messages)) {
      const visionModel = process.env.VERTEX_AI_VISION_MODEL || process.env.OLLAMA_VISION_MODEL || this.geminiModel;
      return {
        taskType: 'vision',
        confidence: 0.95,
        suggestedModel: visionModel,
        reasoning: 'Image content detected - routing to vision-capable model',
        requiresVision: true,
        requiresImageGen: false,
        complexity: 'moderate',
        estimatedCost: 'low'
      };
    }

    // Check for image generation requests
    if (this.isImageGenerationRequest(lastMessage)) {
      const imageModel = process.env.VERTEX_AI_IMAGE_MODEL || process.env.IMAGE_GEN_MODEL;
      return {
        taskType: 'image_generation',
        confidence: 0.9,
        suggestedModel: imageModel,
        reasoning: 'Image generation request detected',
        requiresVision: false,
        requiresImageGen: true,
        complexity: 'moderate',
        estimatedCost: 'medium'
      };
    }

    // ============================================================
    // SLIDER-BASED MODEL SELECTION (CRITICAL FIX)
    // ============================================================
    // The slider position determines the cost/quality tradeoff:
    // - 0-40: ECONOMICAL - Always use cheapest model (Ollama if available)
    // - 41-60: BALANCED - Use complexity-based routing (current behavior)
    // - 61-100: PREMIUM - Use best quality model (Claude Opus, GPT-4)

    // Economical models (slider position 0-40)
    // Priority: ECONOMICAL_MODEL > Haiku > Nova Micro > Ollama
    const economicalModel = process.env.ECONOMICAL_MODEL ||
                           process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL ||
                           this.ollamaModel;

    // Secondary/ultra-cheap fallback (slider 0-20%)
    const secondaryModel = process.env.SECONDARY_MODEL || economicalModel;

    // Premium models (slider position 61-90)
    const premiumModel = process.env.PREMIUM_MODEL || process.env.AWS_BEDROCK_CHAT_MODEL ||
                        process.env.VERTEX_CLAUDE_VERSION || this.claudeModel || this.geminiModel;

    // Ultra-premium models (slider position 90-100)
    const ultraPremiumModel = process.env.ULTRA_PREMIUM_MODEL || premiumModel;

    if (slider) {
      // ULTRA-CHEAP MODE (slider 0-20): Use absolute cheapest model (Nova Micro)
      if (slider.position <= 20 && slider.costWeight > 0.8) {
        const selectedModel = secondaryModel || economicalModel || this.fallbackModel;

        this.logger.info({
          sliderPosition: slider.position,
          costWeight: slider.costWeight,
          selectedModel,
          hasTools,
          reason: 'ULTRA-CHEAP MODE - slider position 0-20 (Nova Micro/cheapest)'
        }, '🎚️ SLIDER ROUTING → Ultra-cheap model selected');

        return {
          taskType: 'standard',
          confidence: 0.85,
          suggestedModel: selectedModel,
          reasoning: `ULTRA-CHEAP MODE (slider: ${slider.position}%) - Using absolute cheapest model (Nova Micro)`,
          requiresVision: false,
          requiresImageGen: false,
          complexity: 'simple',
          estimatedCost: 'minimal'
        };
      }

      // ECONOMICAL MODE (slider 21-40): Use cheap model (Haiku)
      if (slider.position <= 40 && slider.costWeight > 0.6) {
        // For tool calls, we need a model that supports function calling
        // But still prefer cheaper options
        const cheapToolModel = economicalModel || this.geminiModel || this.fallbackModel;
        const selectedModel = hasTools ? cheapToolModel : (economicalModel || this.fallbackModel);

        this.logger.info({
          sliderPosition: slider.position,
          costWeight: slider.costWeight,
          selectedModel,
          hasTools,
          reason: 'ECONOMICAL MODE - slider position 21-40 (Haiku)'
        }, '🎚️ SLIDER ROUTING → Economical model selected');

        return {
          taskType: 'standard',
          confidence: 0.9,
          suggestedModel: selectedModel,
          reasoning: `ECONOMICAL MODE (slider: ${slider.position}%) - Using cheap model (Haiku)${hasTools ? ' with tool support' : ''}`,
          requiresVision: false,
          requiresImageGen: false,
          complexity: 'simple',
          estimatedCost: 'low'
        };
      }

      // ULTRA-PREMIUM MODE (slider 90-100): Use absolute best model (Opus)
      if (slider.position >= 90 && slider.qualityWeight > 0.9) {
        const selectedModel = ultraPremiumModel || premiumModel || this.fallbackModel;

        this.logger.info({
          sliderPosition: slider.position,
          qualityWeight: slider.qualityWeight,
          selectedModel,
          hasTools,
          reason: 'ULTRA-PREMIUM MODE - slider position 90-100 (Opus)'
        }, '🎚️ SLIDER ROUTING → Ultra-premium model selected');

        return {
          taskType: 'reasoning',
          confidence: 0.98,
          suggestedModel: selectedModel,
          reasoning: `ULTRA-PREMIUM MODE (slider: ${slider.position}%) - Using absolute best model (Opus) for maximum quality`,
          requiresVision: false,
          requiresImageGen: false,
          complexity: 'expert',
          estimatedCost: 'premium'
        };
      }

      // PREMIUM MODE (slider 61-89): Use premium model (Sonnet)
      if (slider.position > 60 && slider.qualityWeight > 0.6) {
        const selectedModel = premiumModel || this.geminiModel || this.fallbackModel;

        this.logger.info({
          sliderPosition: slider.position,
          qualityWeight: slider.qualityWeight,
          selectedModel,
          hasTools,
          reason: 'PREMIUM MODE - slider position 61-89 (Sonnet)'
        }, '🎚️ SLIDER ROUTING → Premium model selected');

        return {
          taskType: 'reasoning',
          confidence: 0.95,
          suggestedModel: selectedModel,
          reasoning: `PREMIUM MODE (slider: ${slider.position}%) - Using premium model (Sonnet) for high quality`,
          requiresVision: false,
          requiresImageGen: false,
          complexity: 'complex',
          estimatedCost: 'high'
        };
      }

      // BALANCED MODE (slider 41-60): Fall through to complexity-based routing
      this.logger.debug({
        sliderPosition: slider.position,
        costWeight: slider.costWeight,
        qualityWeight: slider.qualityWeight,
        reason: 'BALANCED MODE - using complexity-based routing'
      }, '🎚️ SLIDER ROUTING → Balanced mode');
    }

    // Analyze complexity for reasoning tasks (BALANCED MODE or no slider)
    const reasoningAnalysis = this.analyzeReasoningComplexity(lastMessage);

    // Expert or complex reasoning → Claude if configured
    if (reasoningAnalysis.isComplex && this.routeComplexToClaude && this.claudeModel) {
      const usesClaude = reasoningAnalysis.complexity === 'expert' || reasoningAnalysis.complexity === 'complex';
      const selectedModel = usesClaude ? this.claudeModel : (this.geminiModel || this.fallbackModel);
      return {
        taskType: 'reasoning',
        confidence: reasoningAnalysis.confidence,
        suggestedModel: selectedModel,
        reasoning: usesClaude
          ? `Complex reasoning detected - routing to Claude: ${reasoningAnalysis.reason}`
          : `Moderate complexity: ${reasoningAnalysis.reason}`,
        requiresVision: false,
        requiresImageGen: false,
        complexity: reasoningAnalysis.complexity,
        estimatedCost: usesClaude ? 'high' : 'low'
      };
    }

    // Complex but Claude routing disabled
    if (reasoningAnalysis.isComplex) {
      return {
        taskType: 'reasoning',
        confidence: reasoningAnalysis.confidence,
        suggestedModel: this.geminiModel || this.fallbackModel,
        reasoning: `Complex reasoning: ${reasoningAnalysis.reason}`,
        requiresVision: false,
        requiresImageGen: false,
        complexity: reasoningAnalysis.complexity,
        estimatedCost: 'low'
      };
    }

    // Moderate complexity
    if (reasoningAnalysis.complexity === 'moderate') {
      return {
        taskType: 'standard',
        confidence: 0.75,
        suggestedModel: this.geminiModel || this.fallbackModel,
        reasoning: 'Moderate complexity query',
        requiresVision: false,
        requiresImageGen: false,
        complexity: 'moderate',
        estimatedCost: 'low'
      };
    }

    // Simple queries → Ollama if configured (FREE!)
    if (this.routeSimpleToOllama && this.ollamaModel && !hasTools) {
      const result = {
        taskType: 'standard' as const,
        confidence: 0.85,
        suggestedModel: this.ollamaModel,
        reasoning: 'Simple query - routing to Ollama (FREE)',
        requiresVision: false,
        requiresImageGen: false,
        complexity: 'simple' as const,
        estimatedCost: 'free' as const
      };

      // VERBOSE LOGGING for analytics/metrics
      this.logger.info({
        decision: '🆓 OLLAMA (FREE)',
        model: this.ollamaModel,
        reason: 'Simple query without tools',
        hasTools,
        messagePreview: lastMessage.substring(0, 100),
        estimatedCost: '$0.00 (local)'
      }, '🧭 MODEL ROUTING → Ollama');

      return result;
    }

    // Default: Use fallback model (paid provider)
    const result = {
      taskType: 'standard' as const,
      confidence: 0.8,
      suggestedModel: this.fallbackModel,
      reasoning: hasTools ? 'Query requires tool calling → using capable model' : 'Standard query',
      requiresVision: false,
      requiresImageGen: false,
      complexity: 'simple' as const,
      estimatedCost: 'low' as const
    };

    // VERBOSE LOGGING for analytics/metrics
    this.logger.info({
      decision: hasTools ? '🛠️ GEMINI (tool calling)' : '⚡ GEMINI (default)',
      model: this.fallbackModel,
      reason: hasTools ? `Query has ${requirements.tools?.length || 0} tools` : 'Standard query (Ollama not configured)',
      hasTools,
      toolCount: requirements.tools?.length || 0,
      messagePreview: lastMessage.substring(0, 100),
      routeSimpleToOllama: this.routeSimpleToOllama,
      ollamaConfigured: !!this.ollamaModel
    }, '🧭 MODEL ROUTING → Gemini');

    return result;
  }

  private getLastUserMessage(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        return typeof content === 'string' ? content :
               Array.isArray(content) ? content.map(c => c.text || '').join(' ') : '';
      }
    }
    return '';
  }

  private hasImageContent(messages: any[]): boolean {
    return messages.some(msg => {
      const content = msg.content;
      if (Array.isArray(content)) {
        return content.some(c => c.type === 'image_url' || c.type === 'image');
      }
      return false;
    });
  }

  private isImageGenerationRequest(message: string): boolean {
    const imageGenKeywords = [
      'generate image', 'create image', 'draw', 'paint', 'sketch',
      'make picture', 'create picture', 'design image', 'visualize',
      'dall-e', 'midjourney', 'stable diffusion', 'text to image',
      'create artwork', 'generate art', 'make illustration'
    ];

    const lowerMessage = message.toLowerCase();
    return imageGenKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private analyzeReasoningComplexity(message: string): {
    isComplex: boolean;
    confidence: number;
    reason: string;
    complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  } {
    const deepThinkingKeywords = [
      'analyze', 'reasoning', 'logic', 'proof', 'theorem', 'hypothesis',
      'deep thinking', 'complex problem', 'step by step', 'chain of thought',
      'philosophical', 'ethical dilemma', 'critical thinking',
      'research', 'investigate', 'comprehensive analysis', 'thorough',
      'detailed study', 'in-depth', 'systematic approach',
      'strategy', 'plan', 'roadmap', 'architecture', 'design system',
      'framework', 'methodology', 'best practices', 'optimization',
      'algorithm', 'performance analysis', 'scalability',
      'security audit', 'code review', 'system design', 'debugging',
      'scientific method', 'literature review', 'meta-analysis',
      'statistical analysis', 'data analysis', 'correlation', 'causation',
      'creative solution', 'innovative approach', 'alternative perspective',
      'brainstorm', 'ideation', 'thought experiment'
    ];

    const expertKeywords = [
      'expert level', 'advanced', 'sophisticated', 'nuanced',
      'multi-faceted', 'interdisciplinary', 'holistic approach',
      'systems thinking', 'meta-cognitive', 'epistemological'
    ];

    const moderateKeywords = [
      'explain', 'compare', 'contrast', 'evaluate', 'assess',
      'summarize', 'breakdown', 'outline', 'overview'
    ];

    const lowerMessage = message.toLowerCase();

    const expertMatches = expertKeywords.filter(keyword => lowerMessage.includes(keyword));
    if (expertMatches.length > 0) {
      return {
        isComplex: true,
        confidence: 0.95,
        reason: `Expert-level: ${expertMatches.join(', ')}`,
        complexity: 'expert'
      };
    }

    const deepMatches = deepThinkingKeywords.filter(keyword => lowerMessage.includes(keyword));
    if (deepMatches.length >= 2 || message.length > 500) {
      return {
        isComplex: true,
        confidence: 0.9,
        reason: `Complex: ${deepMatches.join(', ')}`,
        complexity: 'complex'
      };
    }

    if (deepMatches.length === 1) {
      return {
        isComplex: true,
        confidence: 0.75,
        reason: `Moderate: ${deepMatches[0]}`,
        complexity: 'complex'
      };
    }

    const moderateMatches = moderateKeywords.filter(keyword => lowerMessage.includes(keyword));
    if (moderateMatches.length > 0 && message.length > 100) {
      return {
        isComplex: false,
        confidence: 0.6,
        reason: `Moderate: ${moderateMatches.join(', ')}`,
        complexity: 'moderate'
      };
    }

    return {
      isComplex: false,
      confidence: 0.8,
      reason: 'Simple conversation',
      complexity: 'simple'
    };
  }
}
