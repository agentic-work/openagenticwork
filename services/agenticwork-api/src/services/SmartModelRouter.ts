/**
 * Smart Model Router
 *
 * Intelligently routes LLM requests to the optimal model based on:
 * - Task complexity (simple chat vs tool calling vs multi-step reasoning)
 * - Model capabilities (function calling accuracy, context length, specializations)
 * - Cost optimization (use cheaper models for simple tasks)
 * - Provider availability and health
 *
 * Discovers models from ALL configured providers on startup and stores
 * capabilities in Milvus for semantic search.
 */

import { Logger } from 'pino';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { ProviderManager } from './llm-providers/ProviderManager.js';
import { ILLMProvider, CompletionRequest } from './llm-providers/ILLMProvider.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { RedisClientType } from 'redis';
import type { SliderConfig } from './SliderService.js';

// Model capability profile
export interface ModelProfile {
  modelId: string;
  provider: string;
  providerType: 'azure-openai' | 'azure-ai-foundry' | 'aws-bedrock' | 'google-vertex' | 'ollama';
  deployment?: string; // For Azure deployments

  capabilities: {
    chat: boolean;
    functionCalling: boolean;
    functionCallingAccuracy: number; // 0-1 score (e.g., 0.967 for GPT-4)
    vision: boolean;
    imageGeneration: boolean;
    embeddings: boolean;
    streaming: boolean;
    jsonMode: boolean;
    structuredOutput: boolean;
  };

  performance: {
    maxContextTokens: number;
    maxOutputTokens: number;
    avgLatencyMs: number;
    tokensPerSecond: number;
  };

  cost: {
    inputPer1kTokens: number;
    outputPer1kTokens: number;
    currency: string;
  };

  metadata: {
    family: string; // gpt, claude, gemini, llama, etc.
    version: string;
    specializations: string[]; // coding, math, creative, reasoning
    lastTested: Date;
    isAvailable: boolean;
  };

  // Vector embedding for semantic search
  embedding?: number[];
}

// Request analysis result
export interface RequestAnalysis {
  hasTools: boolean;
  toolCount: number;
  isComplexReasoning: boolean;
  isMultiStep: boolean;
  isMultiCloud: boolean; // Mentions multiple cloud providers
  requiresVision: boolean;
  estimatedTokens: number;
  recommendedCapabilities: string[];
}

// Routing decision
export interface RoutingDecision {
  selectedModel: ModelProfile;
  reason: string;
  alternativeModels: ModelProfile[];
  analysisResults: RequestAnalysis;
}

// Minimum function calling accuracy for tool-based tasks
const MIN_FUNCTION_CALLING_ACCURACY = 0.90;

// Multi-cloud keywords
const MULTI_CLOUD_KEYWORDS = ['azure', 'aws', 'gcp', 'google cloud', 'vertex', 'bedrock', 'lambda', 's3', 'ec2', 'iam'];

export class SmartModelRouter {
  private logger: Logger;
  private milvusClient?: MilvusClient;
  private embeddingService?: UniversalEmbeddingService;
  private redisClient?: RedisClientType;
  private providerManager?: ProviderManager;

  private modelProfiles: Map<string, ModelProfile> = new Map();
  private initialized = false;
  private collectionName = 'model_capabilities_v2';

  constructor(
    logger: Logger,
    options?: {
      milvusClient?: MilvusClient;
      embeddingService?: UniversalEmbeddingService;
      redisClient?: RedisClientType;
      providerManager?: ProviderManager;
    }
  ) {
    this.logger = logger.child({ service: 'SmartModelRouter' });
    this.milvusClient = options?.milvusClient;
    this.embeddingService = options?.embeddingService;
    this.redisClient = options?.redisClient;
    this.providerManager = options?.providerManager;
  }

  /**
   * Initialize the router - discover models from all providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('SmartModelRouter already initialized');
      return;
    }

    this.logger.info('Initializing SmartModelRouter...');
    const startTime = Date.now();

    try {
      // ONLY discover models dynamically from enabled providers
      // No hardcoded profiles - let the providers tell us what's available
      if (this.providerManager) {
        await this.discoverFromProviders();
      } else {
        this.logger.warn('No ProviderManager available - SmartModelRouter will have no models');
      }

      // Setup Milvus collection if available
      if (this.milvusClient) {
        await this.ensureMilvusCollection();
        await this.storeProfilesInMilvus();
      }

      this.initialized = true;
      const duration = Date.now() - startTime;

      this.logger.info({
        modelsLoaded: this.modelProfiles.size,
        providers: [...new Set([...this.modelProfiles.values()].map(m => m.provider))],
        durationMs: duration,
        milvusEnabled: !!this.milvusClient
      }, 'SmartModelRouter initialized successfully');

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize SmartModelRouter');
      // Don't throw - allow the system to function with known profiles
      this.initialized = true;
    }
  }

  /**
   * Discover models from all configured providers
   */
  private async discoverFromProviders(): Promise<void> {
    if (!this.providerManager) return;

    const providers = this.providerManager.getProviders();

    for (const [name, provider] of providers) {
      try {
        const models = await provider.listModels();

        for (const model of models) {
          // Check if we already have a profile for this model
          const existingProfile = this.findProfileByModelId(model.id);

          if (existingProfile) {
            // Update availability
            existingProfile.metadata.isAvailable = true;
            existingProfile.metadata.lastTested = new Date();
          } else {
            // Create new profile from discovered model
            const newProfile = this.createProfileFromDiscovery(model, name);
            this.modelProfiles.set(model.id, newProfile);
          }
        }

        this.logger.info({
          provider: name,
          modelsDiscovered: models.length
        }, 'Discovered models from provider');

      } catch (error) {
        this.logger.warn({
          provider: name,
          error: error instanceof Error ? error.message : error
        }, 'Failed to discover models from provider');
      }
    }
  }

  /**
   * Find profile by model ID (handles aliases)
   */
  private findProfileByModelId(modelId: string): ModelProfile | undefined {
    const normalized = modelId.toLowerCase();

    // Direct match
    if (this.modelProfiles.has(modelId)) {
      return this.modelProfiles.get(modelId);
    }

    // Search by partial match
    for (const [id, profile] of this.modelProfiles) {
      if (normalized.includes(id.toLowerCase()) || id.toLowerCase().includes(normalized)) {
        return profile;
      }
    }

    return undefined;
  }

  /**
   * Create a profile from discovered model data
   * Infers capabilities based on model naming patterns
   */
  private createProfileFromDiscovery(
    model: { id: string; name: string; provider: string },
    providerName: string
  ): ModelProfile {
    const lower = model.id.toLowerCase();

    // Infer capabilities from model name
    const isGPT = lower.includes('gpt');
    const isClaude = lower.includes('claude');
    const isGemini = lower.includes('gemini');
    const isLlama = lower.includes('llama');
    const isMistral = lower.includes('mistral');
    const isVision = lower.includes('vision') || lower.includes('4o') || isGemini || isClaude;

    // Infer function calling accuracy based on model family and version
    let functionCallingAccuracy = 0.70; // Conservative default for unknown models

    if (isGPT) {
      if (lower.includes('gpt-5') || lower.includes('gpt5')) {
        functionCallingAccuracy = lower.includes('nano') ? 0.65 : lower.includes('mini') ? 0.70 : 0.95;
      } else if (lower.includes('gpt-4') || lower.includes('gpt4')) {
        functionCallingAccuracy = 0.93;
      } else if (lower.includes('o1') || lower.includes('o3')) {
        functionCallingAccuracy = 0.96;
      }
    } else if (isClaude) {
      if (lower.includes('sonnet')) {
        functionCallingAccuracy = 0.94;
      } else if (lower.includes('opus')) {
        functionCallingAccuracy = 0.96;
      } else if (lower.includes('haiku')) {
        functionCallingAccuracy = 0.85;
      }
    } else if (isGemini) {
      if (lower.includes('flash')) {
        functionCallingAccuracy = 0.92;
      } else if (lower.includes('pro')) {
        functionCallingAccuracy = 0.93;
      } else if (lower.includes('ultra')) {
        functionCallingAccuracy = 0.95;
      }
    } else if (isLlama || isMistral) {
      functionCallingAccuracy = 0.80; // Good but not as reliable as frontier models
    }

    const hasFunctionCalling = isGPT || isClaude || isGemini || isLlama || isMistral;

    this.logger.info({
      modelId: model.id,
      provider: providerName,
      hasFunctionCalling,
      functionCallingAccuracy,
      isGPT, isClaude, isGemini
    }, 'Created profile from discovered model');

    return {
      modelId: model.id,
      provider: providerName,
      providerType: this.inferProviderType(providerName),
      capabilities: {
        chat: true,
        functionCalling: hasFunctionCalling,
        functionCallingAccuracy,
        vision: isVision,
        imageGeneration: lower.includes('dall-e') || lower.includes('imagen'),
        embeddings: lower.includes('embedding'),
        streaming: true,
        jsonMode: isGPT || isGemini || isClaude,
        structuredOutput: isGPT || isGemini || isClaude
      },
      performance: {
        maxContextTokens: isGemini ? 1000000 : isClaude ? 200000 : 128000,
        maxOutputTokens: 8192,
        avgLatencyMs: 500,
        tokensPerSecond: 100
      },
      cost: {
        // Ollama is FREE - set cost to 0 so it's preferred for simple queries
        inputPer1kTokens: providerName.toLowerCase() === 'ollama' ? 0 : 0.001,
        outputPer1kTokens: providerName.toLowerCase() === 'ollama' ? 0 : 0.002,
        currency: 'USD'
      },
      metadata: {
        family: this.inferModelFamily(model.id),
        version: this.inferModelVersion(model.id),
        specializations: hasFunctionCalling ? ['tools', 'reasoning'] : ['general'],
        lastTested: new Date(),
        isAvailable: true
      }
    };
  }

  /**
   * Infer provider type from provider name
   */
  private inferProviderType(providerName: string): ModelProfile['providerType'] {
    const lower = providerName.toLowerCase();
    if (lower.includes('foundry')) return 'azure-ai-foundry';
    if (lower.includes('azure')) return 'azure-openai';
    if (lower.includes('bedrock')) return 'aws-bedrock';
    if (lower.includes('vertex') || lower.includes('google')) return 'google-vertex';
    if (lower.includes('ollama')) return 'ollama';
    return 'azure-openai'; // default
  }

  /**
   * Infer model family from ID
   */
  private inferModelFamily(modelId: string): string {
    const lower = modelId.toLowerCase();
    if (lower.includes('gpt')) return 'gpt';
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gemini')) return 'gemini';
    if (lower.includes('llama')) return 'llama';
    if (lower.includes('mistral')) return 'mistral';
    if (lower.includes('titan')) return 'titan';
    return 'unknown';
  }

  /**
   * Infer model version from ID
   */
  private inferModelVersion(modelId: string): string {
    const match = modelId.match(/(\d+\.?\d*)/);
    return match ? match[1] : '1.0';
  }

  /**
   * Ensure Milvus collection exists
   */
  private async ensureMilvusCollection(): Promise<void> {
    if (!this.milvusClient) return;

    try {
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: this.collectionName
      });

      if (!hasCollection.value) {
        await this.milvusClient.createCollection({
          collection_name: this.collectionName,
          fields: [
            { name: 'id', data_type: 'Int64', is_primary_key: true, autoID: true },
            { name: 'model_id', data_type: 'VarChar', max_length: 256 },
            { name: 'provider', data_type: 'VarChar', max_length: 64 },
            { name: 'capability_embedding', data_type: 'FloatVector', dim: 3072 },
            { name: 'profile_json', data_type: 'VarChar', max_length: 65535 },
            { name: 'function_calling_accuracy', data_type: 'Float' },
            { name: 'cost_input', data_type: 'Float' },
            { name: 'max_context', data_type: 'Int32' }
          ]
        });

        await this.milvusClient.createIndex({
          collection_name: this.collectionName,
          field_name: 'capability_embedding',
          index_type: 'IVF_FLAT',
          metric_type: 'L2',
          params: { nlist: 128 }
        });

        await this.milvusClient.loadCollection({ collection_name: this.collectionName });

        this.logger.info({ collectionName: this.collectionName }, 'Created Milvus collection for model capabilities');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to ensure Milvus collection');
    }
  }

  /**
   * Store model profiles in Milvus with embeddings
   */
  private async storeProfilesInMilvus(): Promise<void> {
    if (!this.milvusClient || !this.embeddingService) return;

    try {
      const profiles = Array.from(this.modelProfiles.values());

      for (const profile of profiles) {
        // Generate embedding from capability description
        const description = this.createCapabilityDescription(profile);
        const embeddingResult = await this.embeddingService.generateEmbedding(description);

        if (embeddingResult && Array.isArray(embeddingResult)) {
          profile.embedding = embeddingResult;
        }
      }

      // Insert into Milvus
      const data = profiles
        .filter(p => p.embedding)
        .map(profile => ({
          model_id: profile.modelId,
          provider: profile.provider,
          capability_embedding: profile.embedding!,
          profile_json: JSON.stringify(profile),
          function_calling_accuracy: profile.capabilities.functionCallingAccuracy,
          cost_input: profile.cost.inputPer1kTokens,
          max_context: profile.performance.maxContextTokens
        }));

      if (data.length > 0) {
        await this.milvusClient.insert({
          collection_name: this.collectionName,
          data
        });

        this.logger.info({ count: data.length }, 'Stored model profiles in Milvus');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to store profiles in Milvus');
    }
  }

  /**
   * Create capability description for embedding
   */
  private createCapabilityDescription(profile: ModelProfile): string {
    const caps = [];

    if (profile.capabilities.functionCalling) {
      caps.push(`function calling tools with ${(profile.capabilities.functionCallingAccuracy * 100).toFixed(0)}% accuracy`);
    }
    if (profile.capabilities.vision) caps.push('vision image understanding');
    if (profile.capabilities.imageGeneration) caps.push('image generation');
    if (profile.capabilities.jsonMode) caps.push('JSON mode structured output');

    return `${profile.modelId} from ${profile.provider}: ${caps.join(', ')}. ` +
           `Specializations: ${profile.metadata.specializations.join(', ')}. ` +
           `Max context: ${profile.performance.maxContextTokens} tokens. ` +
           `Cost: $${profile.cost.inputPer1kTokens}/1k tokens.`;
  }

  /**
   * Analyze a completion request to determine requirements
   */
  analyzeRequest(request: CompletionRequest): RequestAnalysis {
    const hasTools = !!(request.tools && request.tools.length > 0);
    const toolCount = request.tools?.length || 0;

    // Get the user message content
    const userMessages = request.messages.filter(m => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1]?.content || '';
    const allContent = request.messages.map(m => m.content || '').join(' ').toLowerCase();

    // Detect multi-cloud query
    const cloudMentions = MULTI_CLOUD_KEYWORDS.filter(kw => allContent.includes(kw.toLowerCase()));
    const isMultiCloud = cloudMentions.length >= 2;

    // Detect complex reasoning needs
    const complexIndicators = ['analyze', 'compare', 'explain why', 'step by step', 'reason through'];
    const isComplexReasoning = complexIndicators.some(ind => allContent.includes(ind));

    // Detect multi-step tasks
    const multiStepIndicators = ['then', 'after that', 'next', 'finally', 'first', 'second'];
    const stepMatches = multiStepIndicators.filter(ind => allContent.includes(ind));
    const isMultiStep = stepMatches.length >= 2 || (allContent.match(/\d+\./g)?.length || 0) >= 2;

    // Vision detection
    const requiresVision = request.messages.some(m =>
      m.content &&
      typeof m.content === 'object' &&
      Array.isArray(m.content) &&
      (m.content as any[]).some((c: any) => c.type === 'image_url')
    );

    // Estimate tokens
    const estimatedTokens = Math.ceil(allContent.length / 4);

    // Determine recommended capabilities
    const recommendedCapabilities: string[] = [];
    if (hasTools) recommendedCapabilities.push('functionCalling');
    if (requiresVision) recommendedCapabilities.push('vision');
    if (isComplexReasoning || isMultiStep) recommendedCapabilities.push('reasoning');
    if (isMultiCloud) recommendedCapabilities.push('multiCloudKnowledge');

    return {
      hasTools,
      toolCount,
      isComplexReasoning,
      isMultiStep,
      isMultiCloud,
      requiresVision,
      estimatedTokens,
      recommendedCapabilities
    };
  }

  /**
   * Route request to optimal model
   * @param request The completion request
   * @param sliderConfig Optional slider configuration for cost/quality tradeoff
   */
  async routeRequest(request: CompletionRequest, sliderConfig?: SliderConfig): Promise<RoutingDecision> {
    const analysis = this.analyzeRequest(request);

    this.logger.debug({
      hasTools: analysis.hasTools,
      toolCount: analysis.toolCount,
      isMultiCloud: analysis.isMultiCloud,
      isMultiStep: analysis.isMultiStep
    }, 'Request analysis');

    // Get all available models
    const availableModels = Array.from(this.modelProfiles.values())
      .filter(m => m.metadata.isAvailable);

    if (availableModels.length === 0) {
      throw new Error('No models available for routing');
    }

    // Filter and score models
    let candidates = availableModels;
    let reason = '';

    // CRITICAL: For tool-based requests, filter by function calling accuracy
    if (analysis.hasTools || analysis.isMultiStep || analysis.isMultiCloud) {
      candidates = candidates.filter(m =>
        m.capabilities.functionCalling &&
        m.capabilities.functionCallingAccuracy >= MIN_FUNCTION_CALLING_ACCURACY
      );

      if (candidates.length === 0) {
        // Fallback to best available function calling model
        candidates = availableModels
          .filter(m => m.capabilities.functionCalling)
          .sort((a, b) => b.capabilities.functionCallingAccuracy - a.capabilities.functionCallingAccuracy)
          .slice(0, 3);

        reason = `No models meet ${MIN_FUNCTION_CALLING_ACCURACY * 100}% accuracy threshold, using best available`;
      } else {
        reason = `Selected from ${candidates.length} models with ≥${MIN_FUNCTION_CALLING_ACCURACY * 100}% function calling accuracy`;
      }
    }

    // Filter by vision if needed
    if (analysis.requiresVision) {
      const visionCandidates = candidates.filter(m => m.capabilities.vision);
      if (visionCandidates.length > 0) {
        candidates = visionCandidates;
        reason += ' (with vision capability)';
      }
    }

    // Filter by context length
    if (analysis.estimatedTokens > 8000) {
      const longContextCandidates = candidates.filter(m =>
        m.performance.maxContextTokens >= analysis.estimatedTokens * 2
      );
      if (longContextCandidates.length > 0) {
        candidates = longContextCandidates;
      }
    }

    // Score remaining candidates with slider weights
    const scoredCandidates = candidates.map(model => ({
      model,
      score: this.scoreModel(model, analysis, sliderConfig)
    })).sort((a, b) => b.score - a.score);

    const selected = scoredCandidates[0].model;
    const alternatives = scoredCandidates.slice(1, 4).map(s => s.model);

    // Build detailed reason
    if (!reason) {
      if (analysis.hasTools) {
        reason = `Tool calling (${analysis.toolCount} tools) - ${selected.modelId} has ${(selected.capabilities.functionCallingAccuracy * 100).toFixed(0)}% accuracy`;
      } else if (analysis.isComplexReasoning) {
        reason = `Complex reasoning task - using ${selected.modelId} for best results`;
      } else {
        reason = `Simple chat - using cost-effective ${selected.modelId}`;
      }
    }

    // VERBOSE LOGGING for model selection analytics
    this.logger.info({
      selectedModel: selected.modelId,
      selectedProvider: selected.provider,
      selectedCost: `$${selected.cost.inputPer1kTokens.toFixed(4)}/1k tokens`,
      functionCallingAccuracy: `${(selected.capabilities.functionCallingAccuracy * 100).toFixed(0)}%`,
      reason,
      alternatives: alternatives.map(a => ({
        model: a.modelId,
        provider: a.provider,
        cost: `$${a.cost.inputPer1kTokens.toFixed(4)}/1k`
      })),
      requestAnalysis: {
        hasTools: analysis.hasTools,
        toolCount: analysis.toolCount,
        isComplexReasoning: analysis.isComplexReasoning,
        isMultiStep: analysis.isMultiStep,
        isMultiCloud: analysis.isMultiCloud,
        estimatedTokens: analysis.estimatedTokens
      },
      sliderPosition: sliderConfig?.position ?? 'default(50)',
      costWeight: sliderConfig?.costWeight ?? 0.5,
      qualityWeight: sliderConfig?.qualityWeight ?? 0.5
    }, '🧭 MODEL ROUTING DECISION');

    return {
      selectedModel: selected,
      reason,
      alternativeModels: alternatives,
      analysisResults: analysis
    };
  }

  /**
   * Score a model for a given request
   * Scoring is weighted by the slider configuration:
   * - costWeight: How much to favor cheaper models (slider 0 = max cost priority)
   * - qualityWeight: How much to favor capable models (slider 100 = max quality priority)
   */
  private scoreModel(
    model: ModelProfile,
    analysis: RequestAnalysis,
    sliderConfig?: SliderConfig
  ): number {
    // Default weights if no slider config
    const costWeight = sliderConfig?.costWeight ?? 0.5;
    const qualityWeight = sliderConfig?.qualityWeight ?? 0.5;

    let score = 0;

    // Function calling accuracy is critical for tool-based tasks (quality-weighted)
    if (analysis.hasTools) {
      // Base score for function calling, weighted by quality preference
      const functionCallingScore = model.capabilities.functionCallingAccuracy * 50;
      score += functionCallingScore * (0.5 + qualityWeight * 0.5); // Min 50% of base score
    }

    // Multi-step and multi-cloud need reliable reasoning (quality-weighted)
    if (analysis.isMultiStep || analysis.isMultiCloud) {
      const reasoningScore = model.capabilities.functionCallingAccuracy * 30;
      score += reasoningScore * (0.5 + qualityWeight * 0.5);
    }

    // Vision requirement
    if (analysis.requiresVision && model.capabilities.vision) {
      score += 20;
    }

    // Context length bonus for long conversations
    if (analysis.estimatedTokens > 4000) {
      score += Math.min(model.performance.maxContextTokens / 50000, 10);
    }

    // Cost optimization (cost-weighted)
    // Higher cost weight = more bonus for cheaper models
    const costScore = (1 - Math.min(model.cost.inputPer1kTokens / 0.01, 1)) * 25;
    score += costScore * costWeight;

    // Latency bonus for faster models (cost-weighted - speed matters more when optimizing cost)
    const latencyScore = (1 - Math.min(model.performance.avgLatencyMs / 1000, 1)) * 10;
    score += latencyScore * costWeight;

    // Quality bonus for premium models (quality-weighted)
    // Models with higher function calling accuracy get extra points when quality matters
    if (qualityWeight > 0.6) {
      score += model.capabilities.functionCallingAccuracy * 15 * qualityWeight;
    }

    return score;
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): ModelProfile | undefined {
    return this.modelProfiles.get(modelId) || this.findProfileByModelId(modelId);
  }

  /**
   * Get all models
   */
  getAllModels(): ModelProfile[] {
    return Array.from(this.modelProfiles.values());
  }

  /**
   * Get models suitable for function calling
   */
  getFunctionCallingModels(minAccuracy = MIN_FUNCTION_CALLING_ACCURACY): ModelProfile[] {
    return Array.from(this.modelProfiles.values())
      .filter(m => m.capabilities.functionCalling && m.capabilities.functionCallingAccuracy >= minAccuracy)
      .sort((a, b) => b.capabilities.functionCallingAccuracy - a.capabilities.functionCallingAccuracy);
  }

  /**
   * Get the best model for function calling
   */
  getBestFunctionCallingModel(): ModelProfile | undefined {
    const models = this.getFunctionCallingModels();
    return models[0];
  }

  /**
   * Get cheapest model for simple chat
   */
  getCheapestChatModel(): ModelProfile | undefined {
    return Array.from(this.modelProfiles.values())
      .filter(m => m.capabilities.chat && m.metadata.isAvailable)
      .sort((a, b) => a.cost.inputPer1kTokens - b.cost.inputPer1kTokens)[0];
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Update model availability
   */
  updateModelAvailability(modelId: string, isAvailable: boolean): void {
    const profile = this.modelProfiles.get(modelId);
    if (profile) {
      profile.metadata.isAvailable = isAvailable;
      profile.metadata.lastTested = new Date();
    }
  }

  /**
   * Add or update a model profile
   */
  addModelProfile(profile: ModelProfile): void {
    this.modelProfiles.set(profile.modelId, profile);
    this.logger.info({ modelId: profile.modelId }, 'Added/updated model profile');
  }
}

// Singleton instance
let smartModelRouterInstance: SmartModelRouter | null = null;

export function getSmartModelRouter(): SmartModelRouter | null {
  return smartModelRouterInstance;
}

export function setSmartModelRouter(router: SmartModelRouter): void {
  smartModelRouterInstance = router;
}
