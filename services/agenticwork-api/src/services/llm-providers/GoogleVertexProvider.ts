/**
 * Google Vertex AI Provider
 *
 * Implements ILLMProvider for Google Vertex AI models (Gemini 2.5+, Gemini 3, etc.)
 *
 * SDK: @google/genai (recommended for Gemini 2.0+ features as of 2025)
 *      This is the official Google GenAI SDK that supports:
 *      - Streaming with thinking content (includeThoughts)
 *      - Vertex AI authentication
 *      - All Gemini 2.5+ features
 *
 * Auth: Supports Vertex AI mode with project/location, or API key
 *       Uses ADC (Application Default Credentials) when no explicit credentials
 */

import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type ProviderConfig,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth
} from './ILLMProvider.js';

export interface VertexConfig {
  projectId: string;
  location: string;
  serviceAccountJson?: string; // Base64-encoded service account JSON
  apiKey?: string; // Alternative: API key authentication
  credentials?: {
    client_email: string;
    private_key: string;
  };
  endpoint?: string;
}

export class GoogleVertexProvider extends BaseLLMProvider {
  readonly name = 'Google Vertex AI';
  readonly type = 'google-vertex' as const;

  private genAI?: GoogleGenAI;
  private config?: VertexConfig;

  constructor(logger: Logger) {
    super(logger, 'google-vertex');
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    try {
      this.config = config as VertexConfig;

      const projectId = this.config.projectId || process.env.GOOGLE_CLOUD_PROJECT!;
      const location = this.config.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      // Handle service account JSON if provided (from database config)
      if (this.config.serviceAccountJson) {
        try {
          let serviceAccount: any;

          // Try to parse as JSON directly first (from env vars)
          try {
            serviceAccount = typeof this.config.serviceAccountJson === 'string'
              ? JSON.parse(this.config.serviceAccountJson)
              : this.config.serviceAccountJson;
          } catch {
            // If direct parse fails, try decoding as base64 (from database)
            const serviceAccountBuffer = Buffer.from(this.config.serviceAccountJson, 'base64');
            serviceAccount = JSON.parse(serviceAccountBuffer.toString('utf-8'));
          }

          // Set credentials in environment for Google Cloud SDK
          process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(serviceAccount);

          this.logger.info(
            { provider: this.name, authType: 'service-account', project: projectId },
            'Using service account authentication'
          );
        } catch (error) {
          this.logger.error({ error }, 'Failed to parse service account JSON');
          throw new Error('Invalid service account JSON format');
        }
      } else if (this.config.apiKey || process.env.VERTEX_AI_API_KEY || process.env.GEMINI_API_KEY) {
        // API key authentication (from config or environment)
        if (!this.config.apiKey) {
          this.config.apiKey = process.env.VERTEX_AI_API_KEY || process.env.GEMINI_API_KEY;
        }
        this.logger.info({ provider: this.name, authType: 'api-key' }, 'Using API key authentication');
      } else {
        // Use Application Default Credentials (ADC)
        // Pre-validate that credentials are available before proceeding
        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

        if (credentialsPath) {
          // Validate the credentials file exists and contains required fields
          try {
            const fs = await import('fs');
            if (!fs.existsSync(credentialsPath)) {
              throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${credentialsPath}`);
            }
            const credContent = fs.readFileSync(credentialsPath, 'utf-8');
            const creds = JSON.parse(credContent);
            if (!creds.client_email || !creds.private_key) {
              throw new Error('Credentials file missing required fields (client_email, private_key). Ensure it is a service account JSON file.');
            }
            this.logger.info(
              { provider: this.name, authType: 'service-account-file', clientEmail: creds.client_email },
              'Using service account from GOOGLE_APPLICATION_CREDENTIALS file'
            );
          } catch (fileError: any) {
            this.logger.error({
              error: fileError.message,
              credentialsPath
            }, 'Invalid or missing GOOGLE_APPLICATION_CREDENTIALS file');
            throw new Error(`Google credentials error: ${fileError.message}. Set GOOGLE_APPLICATION_CREDENTIALS to a valid service account JSON file, or use VERTEX_AI_API_KEY for API key auth.`);
          }
        } else if (credentialsJson) {
          // Validate JSON credentials
          try {
            const creds = JSON.parse(credentialsJson);
            if (!creds.client_email || !creds.private_key) {
              throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON missing required fields (client_email, private_key)');
            }
            this.logger.info(
              { provider: this.name, authType: 'service-account-json', clientEmail: creds.client_email },
              'Using service account from GOOGLE_APPLICATION_CREDENTIALS_JSON'
            );
          } catch (jsonError: any) {
            this.logger.error({ error: jsonError.message }, 'Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON');
            throw new Error(`Google credentials JSON error: ${jsonError.message}`);
          }
        } else {
          // No explicit credentials - warn about ADC requirement
          this.logger.warn(
            { provider: this.name, authType: 'adc' },
            'No explicit credentials provided. Using Application Default Credentials (ADC). Run "gcloud auth application-default login" if not on GCP.'
          );
        }

        this.logger.info(
          { provider: this.name, authType: 'default' },
          'Using Application Default Credentials'
        );
      }

      // Initialize the new @google/genai SDK
      // For Vertex AI mode, we set vertexai: true and provide project/location
      const genAIConfig: any = {};

      if (this.config.apiKey) {
        // Use API key authentication (Gemini Developer API)
        genAIConfig.apiKey = this.config.apiKey;
      } else {
        // Use Vertex AI mode with project/location
        genAIConfig.vertexai = true;
        genAIConfig.project = projectId;
        genAIConfig.location = location;
      }

      this.genAI = new GoogleGenAI(genAIConfig);

      this.initialized = true;
      this.logger.info(
        { provider: this.name, project: projectId, location: location, sdkMode: genAIConfig.apiKey ? 'api-key' : 'vertex-ai' },
        'Google Vertex AI provider initialized with @google/genai SDK'
      );
    } catch (error) {
      this.logger.error({ error, provider: this.name }, 'Failed to initialize Google Vertex AI provider');
      throw error;
    }
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.genAI) {
      throw new Error('Google Vertex AI provider not initialized');
    }

    const startTime = Date.now();

    try {
      // Determine model from request or use default
      const modelName = request.model || process.env.VERTEX_DEFAULT_MODEL || process.env.DEFAULT_MODEL;

      // Convert OpenAI-style messages to Vertex format
      const { contents, systemInstruction } = this.convertToVertex(request);

      // Convert OpenAI-style tools to Vertex AI format
      const tools = request.tools ? this.convertToolsToVertex(request.tools) : undefined;

      // Build the config object for @google/genai
      const config: any = {
        temperature: request.temperature || 0.7,
        topP: request.top_p || 1,
        maxOutputTokens: request.max_tokens || 8192
      };

      // Add system instruction if present
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
        this.logger.info({
          model: modelName,
          systemInstructionLength: systemInstruction.length,
          preview: systemInstruction.substring(0, 100)
        }, '[GoogleVertexProvider] Using systemInstruction');
      }

      // Add tools if present
      // CRITICAL FIX: Use 'ANY' mode to FORCE Gemini to use native function calls
      // With 'AUTO' mode, Gemini outputs "TOOL_CODE" as text instead of native functionCall
      // This causes the LLM to stop expecting tool results that never come
      // 'ANY' forces the model to ALWAYS use native function calling when tools are provided
      if (tools && tools.length > 0) {
        // Filter out any invalid/empty tool declarations
        const validTools = tools.filter(t => t && t.name && t.parameters);

        if (validTools.length > 0) {
          config.tools = [{ functionDeclarations: validTools }];
          config.toolConfig = {
            functionCallingConfig: {
              mode: 'ANY'  // FORCE native function calls - prevents TOOL_CODE text output
            }
          };

          this.logger.info({
            toolCount: validTools.length,
            toolNames: validTools.map(t => t.name).slice(0, 5),
            mode: 'ANY'
          }, '[GoogleVertexProvider] Tools configured with ANY mode - forcing native function calls');
        } else {
          this.logger.warn({
            originalCount: tools.length,
            validCount: 0
          }, '[GoogleVertexProvider] All tools filtered out as invalid - skipping tool config');
        }
      }

      // Enable thinking/reasoning for Gemini models
      // Gemini 3 uses thinking_level instead of thinking_budget
      // See: https://ai.google.dev/gemini-api/docs/gemini-3
      // NOTE: Gemini 2.5+ Flash models DO support thinking mode (thinkingConfig)
      // Usage metadata shows thoughtsTokenCount even for Flash models
      const modelLower = modelName.toLowerCase();
      const isFlashModel = modelLower.includes('flash');
      // Gemini 3 detection: gemini-3, gemini-3.0, 3-pro, 3.0-pro, etc.
      const isGemini3 = modelLower.includes('gemini-3') ||
                        modelLower.includes('gemini-3.') ||
                        modelLower.includes('3-pro') ||
                        modelLower.includes('3.0-pro') ||
                        modelLower.includes('3-flash') ||
                        modelLower.includes('3.0-flash');
      const isGemini25 = modelLower.includes('gemini-2.5') || modelLower.includes('2.5');

      if ((request as any).thinking?.type === 'enabled') {
        const thinkingConfig: any = {
          includeThoughts: true
        };

        // CRITICAL DEBUG: Log when thinking is requested
        console.log('\n' + '='.repeat(60));
        console.log('🧠 GEMINI THINKING MODE ENABLED');
        console.log('='.repeat(60));
        console.log(`Model: ${modelName}`);
        console.log(`isFlashModel: ${isFlashModel}`);
        console.log(`isGemini3: ${isGemini3}`);
        console.log(`isGemini25: ${isGemini25}`);
        console.log('Request thinking config:', JSON.stringify((request as any).thinking, null, 2));
        console.log('='.repeat(60) + '\n');

        // For Gemini 3 and 2.5 models (including Flash), use thinking_level
        // For older models, use thinking_budget
        if (isGemini3 || isGemini25) {
          // Gemini 3/2.5 uses thinking_level parameter
          // IMPORTANT: Valid values are 'low' or 'high' (NOT 'minimal')
          // 'minimal' actually DISABLES thinking for Flash models!
          // See: https://ai.google.dev/gemini-api/docs/thinking
          // For Flash models: use 'low' for lighter reasoning
          // For Pro models: use 'low' or 'high' for deeper reasoning
          const defaultLevel = isFlashModel ? 'low' : 'low';  // 'low' for both, 'high' for deeper reasoning
          // Priority: request.thinking.level > provider config > env var > default
          const thinkingLevel = (request as any).thinking?.level ||
                               (this.config as any)?.thinkingLevel ||
                               process.env.VERTEX_AI_THINKING_LEVEL ||
                               defaultLevel;
          thinkingConfig.thinkingLevel = thinkingLevel;
          this.logger.info({
            model: modelName,
            thinkingLevel,
            isFlashModel,
            isGemini3,
            isGemini25,
            includeThoughts: true,
            fullThinkingConfig: JSON.stringify(thinkingConfig)
          }, '[GoogleVertexProvider] 🧠 Gemini thinking mode enabled with thinking_level');
        } else {
          // Older models use thinking_budget
          const thinkingBudget = (request as any).thinking?.budget_tokens || 8000;
          thinkingConfig.thinkingBudget = thinkingBudget;
          this.logger.info({
            model: modelName,
            thinkingBudget,
            includeThoughts: true
          }, '[GoogleVertexProvider] 🧠 Thinking mode enabled with thinking_budget');
        }

        config.thinkingConfig = thinkingConfig;
      }

      // Set media resolution for multimodal inputs (Gemini 3 feature)
      // Controls vision processing for images/videos/PDFs
      const mediaResolution = (request as any).media_resolution ||
                             process.env.VERTEX_AI_MEDIA_RESOLUTION;
      if (mediaResolution && ['low', 'medium', 'high'].includes(mediaResolution)) {
        config.mediaResolution = mediaResolution;
        this.logger.info({
          model: modelName,
          mediaResolution
        }, '[GoogleVertexProvider] Media resolution set');
      }

      this.logger.info({
        model: modelName,
        toolCount: tools?.length || 0,
        messageCount: contents.length,
        hasSystemInstruction: !!systemInstruction,
        hasThinkingConfig: !!config.thinkingConfig,
        thinkingConfig: config.thinkingConfig ? JSON.stringify(config.thinkingConfig) : null,
        configKeys: Object.keys(config)
      }, '[GoogleVertexProvider] Creating completion with @google/genai SDK');

      // CRITICAL DEBUG: Show exactly what we're sending to Google
      if (config.thinkingConfig) {
        console.log('\n' + '*'.repeat(60));
        console.log('📤 SENDING TO GOOGLE GENAI API');
        console.log('*'.repeat(60));
        console.log('Final thinkingConfig:', JSON.stringify(config.thinkingConfig, null, 2));
        console.log('Model:', modelName);
        console.log('Stream:', request.stream);
        console.log('*'.repeat(60) + '\n');
      }

      if (request.stream) {
        return this.streamCompletion(contents, config, modelName, startTime);
      } else {
        return await this.nonStreamCompletion(contents, config, modelName, startTime);
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error, provider: this.name }, 'Vertex AI completion failed');
      throw error;
    }
  }

  private async nonStreamCompletion(
    contents: any[],
    config: any,
    modelName: string,
    startTime: number
  ): Promise<CompletionResponse> {
    const response = await this.genAI!.models.generateContent({
      model: modelName,
      contents,
      config
    });

    const latency = Date.now() - startTime;

    // Debug: log raw response structure - the @google/genai SDK returns response differently
    const allParts = response.candidates?.[0]?.content?.parts || [];
    const candidate0 = response.candidates?.[0];
    this.logger.info({
      hasText: !!(response as any).text,
      sdkTextValue: (response as any).text,
      hasParts: !!(response as any).parts,
      hasCandidates: !!response.candidates,
      candidateCount: response.candidates?.length,
      partsLength: allParts.length,
      candidate0Keys: candidate0 ? Object.keys(candidate0) : [],
      candidate0Content: candidate0?.content,
      candidate0FinishReason: candidate0?.finishReason,
      rawCandidate0: JSON.stringify(candidate0)?.substring(0, 500),
      allPartsInfo: allParts.map((p: any, i: number) => ({
        index: i,
        hasText: !!p.text,
        textLength: p.text?.length || 0,
        textPreview: p.text?.substring(0, 100),
        thought: p.thought,
        hasThoughtSignature: !!p.thoughtSignature
      }))
    }, '[GoogleVertexProvider] Raw response structure DEBUG');

    // Parse response - use candidates structure to properly separate thinking from content
    // NOTE: We MUST parse parts directly rather than relying on SDK .text property
    // because the SDK .text might return thinking content for Gemini 3 models,
    // causing actual response content to be lost.
    const parts = response.candidates?.[0]?.content?.parts || [];
    const finishReason = response.candidates?.[0]?.finishReason || 'STOP';

    // Extract text content and thinking content by parsing ALL parts
    // This is critical for Gemini 3 thinking mode where response has both:
    // - Thinking parts (thought: true) 
    // - Content parts (no thought flag)
    let text = '';
    let thinkingContent = '';
    const toolCalls: any[] = [];

    // ALWAYS parse parts to properly separate thinking from content
    for (const part of parts) {
      // Check if this is thinking content (thought: true)
      if ((part as any).thought === true && part.text) {
        thinkingContent += part.text;
        this.logger.debug({
          thinkingLength: part.text.length,
          thinkingPreview: part.text.substring(0, 100)
        }, '[GoogleVertexProvider] Found thinking content in part');
      } else if (part.text) {
        // Regular content (no thought flag)
        text += part.text;
        this.logger.debug({
          contentLength: part.text.length,
          contentPreview: part.text.substring(0, 100)
        }, '[GoogleVertexProvider] Found regular content in part');
      }
    }

    // Log final extraction results
    this.logger.info({
      thinkingLength: thinkingContent.length,
      contentLength: text.length,
      hasThinking: thinkingContent.length > 0,
      hasContent: text.length > 0
    }, '[GoogleVertexProvider] Content extraction complete');

    // Still process parts for function calls
    for (const part of parts) {
      if (part.functionCall) {
        // Convert Vertex AI function call to OpenAI format
        // Preserve thoughtSignature for Gemini 3 models (required for multi-turn function calling)
        const toolCall: any = {
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args)
          }
        };

        // Preserve thought signature if present (Gemini 3 requirement)
        if ((part as any).thoughtSignature) {
          toolCall.thought_signature = (part as any).thoughtSignature;
          this.logger.debug({
            functionName: part.functionCall.name,
            hasThoughtSignature: true
          }, '[GoogleVertexProvider] Preserving thought signature for function call');
        }

        toolCalls.push(toolCall);
      }
    }

    // Extract token usage if available
    const usage = response.usageMetadata || {};
    const tokens = (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0);
    const cost = this.estimateCost(modelName, tokens);

    this.trackSuccess(latency, tokens, cost);

    const message: any = {
      role: 'assistant',
      content: text
    };

    // Add tool calls if present
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
      this.logger.info({
        toolCallCount: toolCalls.length,
        tools: toolCalls.map(tc => tc.function.name)
      }, '[GoogleVertexProvider] Function calls detected in response');
    }

    const completionResponse: CompletionResponse = {
      id: `vertex-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        {
          index: 0,
          message,
          finish_reason: this.convertFinishReason(finishReason)
        }
      ],
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: tokens
      }
    };

    // Add thinking content if present
    if (thinkingContent) {
      (completionResponse as any).thinking_content = thinkingContent;
    }

    return completionResponse;
  }

  private async *streamCompletion(
    contents: any[],
    config: any,
    modelName: string,
    startTime: number
  ): AsyncGenerator<any> {
    // Use generateContentStream for streaming responses
    const response = await this.genAI!.models.generateContentStream({
      model: modelName,
      contents,
      config
    });

    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let isTokensEstimated = false; // Track if tokens are estimated vs actual from API
    let toolCallIndex = 0;
    let hasYieldedThinking = false;
    let chunkCount = 0;  // Track chunk count for detailed logging

    // Track content for token estimation (fallback when usageMetadata not returned)
    let totalTextLength = 0;
    let totalThinkingLength = 0;

    for await (const chunk of response) {
      chunkCount++;
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const finishReason = candidate?.finishReason;

      // CRITICAL DEBUG: Log first chunk in detail to see if thinking is present
      if (chunkCount === 1) {
        console.log('\n' + '#'.repeat(60));
        console.log('📥 FIRST CHUNK FROM GOOGLE');
        console.log('#'.repeat(60));
        console.log('Raw chunk keys:', Object.keys(chunk));
        console.log('Candidate keys:', candidate ? Object.keys(candidate) : 'NO CANDIDATE');
        console.log('Parts count:', parts.length);
        if (parts.length > 0) {
          console.log('First part:', JSON.stringify(parts[0], null, 2).substring(0, 500));
        }
        console.log('#'.repeat(60) + '\n');
      }

      // Check for thinking at candidate/chunk level (not just part level)
      const candidateAny = candidate as any;
      const chunkAny = chunk as any;

      // Log detailed chunk structure for first 3 chunks to debug thinking detection
      // Check for thinking content at candidate/chunk level (alternative locations)
      const candidateLevelThinking = candidateAny?.thoughts ||
                                     candidateAny?.thinking ||
                                     candidateAny?.thoughtSummary ||
                                     candidateAny?.content?.thoughts;
      const chunkLevelThinking = chunkAny?.thoughts ||
                                 chunkAny?.thinking ||
                                 chunkAny?.thoughtSummary;

      // Yield candidate/chunk level thinking if found (before processing parts)
      if (candidateLevelThinking && !hasYieldedThinking) {
        const thinkingText = typeof candidateLevelThinking === 'string'
          ? candidateLevelThinking
          : JSON.stringify(candidateLevelThinking);
        hasYieldedThinking = true;
        this.logger.info({
          source: 'candidate-level',
          thinkingLength: thinkingText.length,
          thinkingPreview: thinkingText.substring(0, 100)
        }, '[GoogleVertexProvider] 🧠 Yielding CANDIDATE-level thinking');

        yield {
          id: `vertex-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{
            index: 0,
            delta: { thinking: thinkingText },
            finish_reason: null
          }],
          thinking_content: thinkingText
        };
      }

      if (chunkLevelThinking && !hasYieldedThinking) {
        const thinkingText = typeof chunkLevelThinking === 'string'
          ? chunkLevelThinking
          : JSON.stringify(chunkLevelThinking);
        hasYieldedThinking = true;
        this.logger.info({
          source: 'chunk-level',
          thinkingLength: thinkingText.length,
          thinkingPreview: thinkingText.substring(0, 100)
        }, '[GoogleVertexProvider] 🧠 Yielding CHUNK-level thinking');

        yield {
          id: `vertex-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{
            index: 0,
            delta: { thinking: thinkingText },
            finish_reason: null
          }],
          thinking_content: thinkingText
        };
      }

      if (chunkCount <= 3) {
        this.logger.info({
          chunkCount,
          hasParts: parts.length > 0,
          partsCount: parts.length,
          finishReason,
          candidateKeys: candidate ? Object.keys(candidate) : [],
          chunkKeys: Object.keys(chunk),
          // Check various places thinking might be
          candidateThoughts: candidateAny?.thoughts,
          candidateThinking: candidateAny?.thinking,
          candidateThoughtSummary: candidateAny?.thoughtSummary,
          chunkThoughts: chunkAny?.thoughts,
          chunkThinking: chunkAny?.thinking,
          contentKeys: candidate?.content ? Object.keys(candidate.content) : [],
          groundingMetadata: candidateAny?.groundingMetadata ? 'present' : 'absent'
        }, '[GoogleVertexProvider] 🔍 DETAILED Chunk structure');
      } else {
        this.logger.debug({
          hasParts: parts.length > 0,
          partsCount: parts.length,
          finishReason,
          candidateCount: chunk.candidates?.length || 0,
          partTypes: parts.map((p: any) => Object.keys(p))
        }, '[GoogleVertexProvider] Processing stream chunk');
      }

      for (const part of parts) {
        // CRITICAL: @google/genai SDK returns thinking as parts with thought: true
        // The actual thinking TEXT is in part.text, marked with the thought boolean
        // BUT Google says this is "best effort" - not always returned
        // Check multiple possible property names for thinking content
        const partAny = part as any;
        const isThoughtPart = partAny.thought === true ||
                              partAny.isThought === true ||
                              partAny.type === 'thought' ||
                              partAny.role === 'thought';

        // Enhanced logging - show full part structure for first few chunks to debug
        if (chunkCount <= 3) {
          this.logger.info({
            hasText: !!part.text,
            textLength: part.text?.length || 0,
            hasFunctionCall: !!part.functionCall,
            isThoughtPart,
            partKeys: Object.keys(part),
            thoughtProp: partAny.thought,
            isThoughtProp: partAny.isThought,
            typeProp: partAny.type,
            roleProp: partAny.role,
            fullPartPreview: JSON.stringify(part).substring(0, 500)
          }, '[GoogleVertexProvider] 🔍 DETAILED Part structure');
        } else {
          this.logger.debug({
            hasText: !!part.text,
            textLength: part.text?.length || 0,
            hasFunctionCall: !!part.functionCall,
            isThoughtPart,
            partKeys: Object.keys(part)
          }, '[GoogleVertexProvider] Processing part');
        }

        // Handle thinking content from Gemini 2.5+
        // When part.thought === true, the part.text contains the thinking/reasoning
        if (isThoughtPart && part.text) {
          hasYieldedThinking = true;
          totalThinkingLength += part.text.length;  // Track for token estimation
          this.logger.info({
            thinkingLength: part.text.length,
            thinkingPreview: part.text.substring(0, 100)
          }, '[GoogleVertexProvider] 🧠 Yielding thinking chunk (thought=true)');

          yield {
            id: `vertex-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [
              {
                index: 0,
                delta: {
                  thinking: part.text  // The actual thinking content is in part.text
                },
                finish_reason: null
              }
            ],
            thinking_content: part.text  // Also include at top level for compatibility
          };
          continue;  // Don't also yield as regular text
        }

        // Handle regular text content (non-thinking)
        if (part.text && !isThoughtPart) {
          totalTextLength += part.text.length;  // Track for token estimation
          this.logger.debug({
            textContent: part.text.substring(0, 100)
          }, '[GoogleVertexProvider] Yielding text chunk');

          yield {
            id: `vertex-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [
              {
                index: 0,
                delta: {
                  content: part.text
                },
                finish_reason: null
              }
            ]
          };
        }

        // Handle function calls
        if (part.functionCall) {
          const hasThoughtSignature = !!(part as any).thoughtSignature;
          this.logger.info({
            functionName: part.functionCall.name,
            hasArgs: !!part.functionCall.args,
            hasThoughtSignature
          }, '[GoogleVertexProvider] Streaming function call');

          // Build tool call with optional thought signature (Gemini 3 requirement)
          const toolCall: any = {
            index: toolCallIndex,
            id: `call_${Date.now()}_${toolCallIndex}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args)
            }
          };

          // Preserve thought signature if present
          if (hasThoughtSignature) {
            toolCall.thought_signature = (part as any).thoughtSignature;
          }

          yield {
            id: `vertex-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [toolCall]
                },
                finish_reason: null
              }
            ]
          };
          toolCallIndex++;
        }
      }

      // Track tokens if available in chunk
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount || 0;
        completionTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        cachedTokens = chunk.usageMetadata.cachedContentTokenCount || 0;
        totalTokens = promptTokens + completionTokens;

        // Log thinking token count if available
        if (chunk.usageMetadata.thoughtsTokenCount) {
          this.logger.info({
            thoughtsTokenCount: chunk.usageMetadata.thoughtsTokenCount,
            hasYieldedThinking
          }, '[GoogleVertexProvider] 🧠 Thoughts token count in metadata');
        }
      }
    }

    // Log final thinking status - CRITICAL DEBUG
    console.log('\n' + '~'.repeat(60));
    console.log('📊 GEMINI STREAM COMPLETE SUMMARY');
    console.log('~'.repeat(60));
    console.log('Total chunks processed:', chunkCount);
    console.log('Thinking content yielded:', hasYieldedThinking ? '✅ YES' : '❌ NO');
    console.log('Total tokens:', totalTokens);
    console.log('Model:', modelName);
    console.log('~'.repeat(60) + '\n');

    if (hasYieldedThinking) {
      this.logger.info('[GoogleVertexProvider] 🧠 Successfully streamed thinking content');
    } else {
      this.logger.warn('[GoogleVertexProvider] ⚠️ No thinking content was yielded during streaming');
    }

    // Send final chunk with usage metadata for cost tracking
    // This is critical for LLMMetricsService to log token usage properly
    //
    // WORKAROUND: Google's API sometimes doesn't return usageMetadata in streaming mode
    // (known issue: https://discuss.ai.google.dev/t/usagemetadata-is-nil-in-generatecontentstream-final-response)
    // When this happens, we ESTIMATE tokens based on content length (~4 chars per token)
    //
    // IMPORTANT: We only count TEXT content, not JSON structure or base64 images
    // Previous bug: JSON.stringify(contents) massively over-counted due to JSON overhead
    if (totalTokens === 0 && (totalTextLength > 0 || totalThinkingLength > 0)) {
      // Estimate output tokens: ~4 characters per token for English text (reasonably accurate)
      const estimatedCompletionTokens = Math.ceil((totalTextLength + totalThinkingLength) / 4);

      // FIXED: Extract only text content from messages, not JSON structure
      // This prevents massive over-counting from JSON syntax and base64 images
      let textContentLength = 0;
      for (const msg of contents) {
        if (msg.parts) {
          for (const part of msg.parts) {
            if (typeof part === 'string') {
              textContentLength += part.length;
            } else if (part.text) {
              textContentLength += part.text.length;
            }
            // Skip inlineData (images) - these are counted differently by Google
          }
        }
      }
      const estimatedPromptTokens = Math.ceil(textContentLength / 4);

      promptTokens = estimatedPromptTokens;
      completionTokens = estimatedCompletionTokens;
      totalTokens = promptTokens + completionTokens;
      isTokensEstimated = true;

      this.logger.warn({
        totalTextLength,
        totalThinkingLength,
        textContentLength,
        estimatedPromptTokens,
        estimatedCompletionTokens,
        estimatedTotalTokens: totalTokens,
        oldMethodWouldHaveEstimated: Math.ceil(JSON.stringify(contents).length / 4)
      }, '[GoogleVertexProvider] ⚠️ usageMetadata not returned by Google API - using estimated tokens (text-only method)');
    }

    if (totalTokens > 0) {
      yield {
        id: `vertex-stream-final-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cached_tokens: cachedTokens,
          estimated: isTokensEstimated // Flag to track actual vs estimated tokens
        }
      };

      this.logger.info({
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens,
        isEstimated: isTokensEstimated,
        source: isTokensEstimated ? 'text-based-estimation' : 'google-api-usageMetadata'
      }, '[GoogleVertexProvider] Sent final chunk with usage data');
    } else {
      // Still send a final chunk even without usage data so the stream properly terminates
      yield {
        id: `vertex-stream-final-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ]
      };
      this.logger.warn('[GoogleVertexProvider] No token usage data available after stream completed (no content generated?)');
    }

    // Track metrics after streaming completes
    const latency = Date.now() - startTime;
    const cost = this.estimateCost(modelName, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);
  }

  /**
   * Convert OpenAI tools format to Vertex AI function declarations
   */
  private convertToolsToVertex(openaiTools: any[]): any[] {
    this.logger.debug({
      toolCount: openaiTools.length,
      firstTool: openaiTools[0] ? JSON.stringify(openaiTools[0]).substring(0, 500) : 'none'
    }, '[GoogleVertexProvider] Converting tools to Vertex format');

    return openaiTools.map(tool => {
      // OpenAI format: { type: 'function', function: { name, description, parameters } }
      // Vertex format: { name, description, parameters }
      const func = tool.function || tool;

      // Clean parameters to remove unsupported fields for Vertex AI
      const cleanedParams = this.cleanParametersForVertex(func.parameters);

      const converted = {
        name: func.name,
        description: func.description,
        parameters: cleanedParams
      };

      this.logger.debug({
        originalName: func.name,
        converted: JSON.stringify(converted).substring(0, 300)
      }, '[GoogleVertexProvider] Converted tool');

      return converted;
    });
  }

  /**
   * Clean parameters object to remove fields unsupported by Vertex AI
   * Vertex AI doesn't support $schema, additionalProperties, and some other JSON Schema fields
   */
  private cleanParametersForVertex(params: any): any {
    if (!params || typeof params !== 'object') {
      return params;
    }

    // Fields that Vertex AI doesn't support
    const unsupportedFields = [
      '$schema',
      'additionalProperties',
      '$id',
      '$ref',
      'definitions',
      '$defs',
      'exclusiveMaximum',  // Not supported by Vertex AI function calling
      'exclusiveMinimum'   // Not supported by Vertex AI function calling
    ];

    const cleaned: any = {};

    for (const [key, value] of Object.entries(params)) {
      // Skip unsupported fields
      if (unsupportedFields.includes(key)) {
        continue;
      }

      // Recursively clean nested objects
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          cleaned[key] = value.map(item => this.cleanParametersForVertex(item));
        } else {
          cleaned[key] = this.cleanParametersForVertex(value);
        }
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }

  private convertToVertex(request: CompletionRequest): { contents: any[], systemInstruction?: string } {
    const contents: any[] = [];
    let systemInstruction: string | undefined;

    for (let i = 0; i < request.messages.length; i++) {
      const message = request.messages[i];

      if (message.role === 'system') {
        // Gemini handles system messages as a separate systemInstruction parameter
        systemInstruction = message.content;
        continue;
      }

      // Handle tool calls in assistant messages
      if (message.role === 'assistant' && message.tool_calls) {
        // Convert tool calls to Vertex AI format
        const parts = [];

        // Add text content if present
        if (message.content) {
          parts.push({ text: message.content });
        }

        // Add function calls with thought signatures (required for Gemini 3)
        for (const toolCall of message.tool_calls) {
          const functionCallPart: any = {
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments)
            }
          };

          // Include thought signature if present (Gemini 3 requirement)
          if ((toolCall as any).thought_signature) {
            functionCallPart.thoughtSignature = (toolCall as any).thought_signature;
          }

          parts.push(functionCallPart);
        }

        contents.push({
          role: 'model',
          parts
        });
        continue;
      }

      // Handle tool results - group consecutive tool messages together
      if (message.role === 'tool') {
        const functionResponseParts = [];

        // Collect this and all consecutive tool messages
        let j = i;
        while (j < request.messages.length && request.messages[j].role === 'tool') {
          const toolMsg = request.messages[j];
          functionResponseParts.push({
            functionResponse: {
              name: toolMsg.tool_call_id || toolMsg.name,
              response: {
                content: toolMsg.content
              }
            }
          });
          j++;
        }

        // Push all tool responses as a single user message
        contents.push({
          role: 'user',
          parts: functionResponseParts
        });

        // Skip the messages we just processed
        i = j - 1;
        continue;
      }

      // Handle multimodal content (images + text)
      if (Array.isArray(message.content)) {
        const parts: any[] = [];

        for (const item of message.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text });
          } else if (item.type === 'image_url' && item.image_url?.url) {
            // Convert OpenAI image_url format to Vertex AI inlineData format
            const imageUrl = item.image_url.url;

            if (imageUrl.startsWith('data:')) {
              // Handle base64 data URLs
              const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                const mimeType = matches[1];
                const base64Data = matches[2];
                parts.push({
                  inlineData: {
                    mimeType,
                    data: base64Data
                  }
                });
                this.logger.debug({
                  mimeType,
                  dataLength: base64Data.length
                }, '[GoogleVertexProvider] Added inline image data');
              }
            } else {
              // Handle URL references (Vertex AI also supports fileData for URLs)
              parts.push({
                fileData: {
                  mimeType: 'image/jpeg', // Default, may need to detect
                  fileUri: imageUrl
                }
              });
              this.logger.debug({
                fileUri: imageUrl
              }, '[GoogleVertexProvider] Added file URI reference');
            }
          }
        }

        contents.push({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts
        });
      } else {
        // Simple text content
        contents.push({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content || '' }]
        });
      }
    }

    // Return both contents and systemInstruction so it can be passed to model config
    return { contents, systemInstruction };
  }

  private convertFinishReason(vertexReason: string): string {
    const reasonMap: Record<string, string> = {
      STOP: 'stop',
      MAX_TOKENS: 'length',
      SAFETY: 'content_filter',
      RECITATION: 'content_filter',
      OTHER: 'stop'
    };

    return reasonMap[vertexReason] || 'stop';
  }

  async listModels(): Promise<Array<{
    id: string;
    name: string;
    provider: string;
    capabilities?: {
      chat: boolean;
      vision: boolean;
      tools: boolean;
      embeddings: boolean;
      imageGeneration: boolean;
      streaming: boolean;
    };
    maxTokens?: number;
    contextWindow?: number;
    description?: string;
  }>> {
    if (!this.initialized) {
      throw new Error('Google Vertex AI provider not initialized');
    }

    // Comprehensive Gemini model catalog with capabilities
    const modelCatalog: Record<string, {
      name: string;
      capabilities: {
        chat: boolean;
        vision: boolean;
        tools: boolean;
        embeddings: boolean;
        imageGeneration: boolean;
        streaming: boolean;
      };
      maxTokens: number;
      contextWindow: number;
      description: string;
    }> = {
      // Gemini 2.5 models (latest)
      'gemini-2.5-pro-preview-06-05': {
        name: 'Gemini 2.5 Pro Preview',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 65536,
        contextWindow: 1048576,
        description: 'Most capable model for complex reasoning, coding, and multimodal tasks'
      },
      'gemini-2.5-flash-preview-05-20': {
        name: 'Gemini 2.5 Flash Preview',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 65536,
        contextWindow: 1048576,
        description: 'Fast and efficient model with strong reasoning capabilities'
      },
      // Gemini 2.0 models
      'gemini-2.0-flash': {
        name: 'Gemini 2.0 Flash',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 8192,
        contextWindow: 1048576,
        description: 'Fast multimodal model for everyday tasks'
      },
      'gemini-2.0-flash-lite': {
        name: 'Gemini 2.0 Flash Lite',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 8192,
        contextWindow: 1048576,
        description: 'Cost-effective model for high-volume tasks'
      },
      // Gemini 1.5 models
      'gemini-1.5-pro': {
        name: 'Gemini 1.5 Pro',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 8192,
        contextWindow: 2097152,
        description: 'Powerful model with 2M token context window'
      },
      'gemini-1.5-flash': {
        name: 'Gemini 1.5 Flash',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 8192,
        contextWindow: 1048576,
        description: 'Fast and versatile multimodal model'
      },
      'gemini-1.5-flash-8b': {
        name: 'Gemini 1.5 Flash-8B',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 8192,
        contextWindow: 1048576,
        description: 'Compact and efficient for high-frequency tasks'
      },
      // Gemini experimental/preview models
      'gemini-3-flash-preview': {
        name: 'Gemini 3 Flash Preview',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 32768,
        contextWindow: 1048576,
        description: 'Next-gen Flash preview with improved capabilities'
      },
      'gemini-3-pro-preview': {
        name: 'Gemini 3 Pro Preview',
        capabilities: { chat: true, vision: true, tools: true, embeddings: false, imageGeneration: false, streaming: true },
        maxTokens: 32768,
        contextWindow: 1048576,
        description: 'Next-gen Pro preview with advanced reasoning'
      },
      // Image generation models
      'imagen-3.0-generate-002': {
        name: 'Imagen 3.0',
        capabilities: { chat: false, vision: false, tools: false, embeddings: false, imageGeneration: true, streaming: false },
        maxTokens: 0,
        contextWindow: 0,
        description: 'High-quality image generation model'
      },
      'imagen-3.0-fast-generate-001': {
        name: 'Imagen 3.0 Fast',
        capabilities: { chat: false, vision: false, tools: false, embeddings: false, imageGeneration: true, streaming: false },
        maxTokens: 0,
        contextWindow: 0,
        description: 'Fast image generation for rapid iteration'
      },
      'gemini-2.0-flash-preview-image-generation': {
        name: 'Gemini 2.0 Flash Image Gen',
        capabilities: { chat: true, vision: true, tools: false, embeddings: false, imageGeneration: true, streaming: false },
        maxTokens: 8192,
        contextWindow: 32768,
        description: 'Multimodal with native image generation'
      },
      // Embedding models
      'text-embedding-004': {
        name: 'Text Embedding 004',
        capabilities: { chat: false, vision: false, tools: false, embeddings: true, imageGeneration: false, streaming: false },
        maxTokens: 2048,
        contextWindow: 2048,
        description: 'Latest text embedding model for semantic search'
      },
      'text-embedding-005': {
        name: 'Text Embedding 005',
        capabilities: { chat: false, vision: false, tools: false, embeddings: true, imageGeneration: false, streaming: false },
        maxTokens: 2048,
        contextWindow: 2048,
        description: 'Improved text embedding with better performance'
      },
      'text-multilingual-embedding-002': {
        name: 'Multilingual Embedding 002',
        capabilities: { chat: false, vision: false, tools: false, embeddings: true, imageGeneration: false, streaming: false },
        maxTokens: 2048,
        contextWindow: 2048,
        description: 'Multilingual embedding supporting 100+ languages'
      }
    };

    const models: Array<{
      id: string;
      name: string;
      provider: string;
      capabilities?: typeof modelCatalog[string]['capabilities'];
      maxTokens?: number;
      contextWindow?: number;
      description?: string;
      configured?: boolean;
    }> = [];
    const addedModels = new Set<string>();

    // Helper to add model with full metadata
    const addModel = (modelId: string | undefined, isConfigured: boolean = true) => {
      if (modelId && !addedModels.has(modelId)) {
        addedModels.add(modelId);
        const catalogInfo = modelCatalog[modelId];
        models.push({
          id: modelId,
          name: catalogInfo?.name || modelId,
          provider: 'google-vertex',
          capabilities: catalogInfo?.capabilities || {
            chat: true,
            vision: false,
            tools: true,
            embeddings: false,
            imageGeneration: false,
            streaming: true
          },
          maxTokens: catalogInfo?.maxTokens || 8192,
          contextWindow: catalogInfo?.contextWindow || 32768,
          description: catalogInfo?.description || `Gemini model: ${modelId}`,
          // Pricing handled by LLMMetricsService
          configured: isConfigured
        });
      }
    };

    // Add configured models from environment (these are the "live" ones)
    addModel(process.env.VERTEX_AI_CHAT_MODEL || process.env.VERTEX_DEFAULT_MODEL);
    addModel(process.env.VERTEX_AI_EMBEDDING_MODEL);
    addModel(process.env.VERTEX_AI_VISION_MODEL);
    addModel(process.env.VERTEX_AI_IMAGE_MODEL);
    addModel(process.env.VERTEX_AI_COMPACTION_MODEL);

    // Add any additional models from VERTEX_AI_MODELS env var (comma-separated)
    const additionalModels = process.env.VERTEX_AI_MODELS;
    if (additionalModels) {
      for (const modelId of additionalModels.split(',').map(m => m.trim()).filter(m => m)) {
        addModel(modelId);
      }
    }

    // Add database-configured models (from admin API)
    // These are stored in this.config.models when loaded from ProviderConfigService
    const dbConfiguredModels = (this.config as any)?.models as any[];
    if (Array.isArray(dbConfiguredModels)) {
      for (const dbModel of dbConfiguredModels) {
        if (dbModel.id && !addedModels.has(dbModel.id)) {
          addedModels.add(dbModel.id);
          const catalogInfo = modelCatalog[dbModel.id];
          models.push({
            id: dbModel.id,
            name: dbModel.name || catalogInfo?.name || dbModel.id,
            provider: 'google-vertex',
            capabilities: dbModel.capabilities || catalogInfo?.capabilities || {
              chat: true,
              vision: false,
              tools: true,
              embeddings: false,
              imageGeneration: false,
              streaming: true
            },
            maxTokens: dbModel.maxTokens || catalogInfo?.maxTokens || 8192,
            contextWindow: dbModel.contextWindow || catalogInfo?.contextWindow || 32768,
            description: dbModel.description || catalogInfo?.description || `Model: ${dbModel.id}`,
            configured: true
          });
        }
      }
    }

    // Also include the full catalog of available models (not configured, but available)
    // This allows the admin UI to show all available models for testing
    const includeFullCatalog = process.env.VERTEX_AI_SHOW_ALL_MODELS === 'true';
    if (includeFullCatalog) {
      for (const modelId of Object.keys(modelCatalog)) {
        addModel(modelId, false);
      }
    }

    this.logger.info({
      modelsCount: models.length,
      configuredModels: models.filter(m => m.configured !== false).map(m => m.id),
      showAllModels: includeFullCatalog
    }, 'Returning Vertex AI models with capabilities');

    return models;
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.initialized || !this.genAI) {
      return {
        status: 'not_initialized',
        provider: this.name,
        lastChecked: new Date()
      };
    }

    try {
      // Simple health check - make a minimal test request
      const model = process.env.VERTEX_HEALTH_CHECK_MODEL || process.env.VERTEX_DEFAULT_MODEL || process.env.DEFAULT_MODEL;

      const result = await this.genAI.models.generateContent({
        model: model,
        contents: 'test',
        config: {
          maxOutputTokens: 10
        }
      });

      if (result.text) {
        return {
          status: 'healthy',
          provider: this.name,
          endpoint: this.config?.endpoint,
          lastChecked: new Date()
        };
      }

      throw new Error('No response from Vertex AI');
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.config?.endpoint,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date()
      };
    }
  }

  private estimateCost(modelName: string, tokens: number): number {
    // Cost tracking is handled centrally by LLMMetricsService
    // Return 0 here - actual costs are calculated and stored when logging metrics
    return 0;
  }

  /**
   * Generate text embeddings using Vertex AI
   * Supports text-embedding-004, text-embedding-005, textembedding-gecko models
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    if (!this.initialized || !this.genAI) {
      throw new Error('Google Vertex AI provider not initialized');
    }

    try {
      const embeddingModel =
        process.env.VERTEX_AI_EMBEDDING_MODEL ||
        process.env.EMBEDDING_MODEL;

      const texts = Array.isArray(text) ? text : [text];
      const embeddings: number[][] = [];

      // Vertex AI embedding API requires calling the prediction endpoint
      const projectId = this.config?.projectId || process.env.GOOGLE_CLOUD_PROJECT!;
      const location = this.config?.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      // Use the VertexAI client to get embeddings
      // Note: @google/genai doesn't have a direct embeddings API yet,
      // so we need to use the prediction endpoint directly
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${embeddingModel}:predict`;

      // Initialize GoogleAuth for authentication
      const authOptions: any = {
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      };

      // Use explicit credentials if available
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        try {
          authOptions.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        } catch (error) {
          this.logger.warn('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON, falling back to ADC');
        }
      }

      const auth = new GoogleAuth(authOptions);
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      // Make requests for each text
      for (const inputText of texts) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            instances: [{ content: inputText }]
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Vertex AI embedding request failed: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        const embedding = result.predictions?.[0]?.embeddings?.values;

        if (!embedding || !Array.isArray(embedding)) {
          throw new Error('Invalid embedding response from Vertex AI');
        }

        embeddings.push(embedding);
      }

      this.logger.debug(
        {
          model: embeddingModel,
          textCount: texts.length,
          dimension: embeddings[0]?.length
        },
        'Generated embeddings with Vertex AI'
      );

      return Array.isArray(text) ? embeddings : embeddings[0];
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          provider: this.name
        },
        'Failed to generate embeddings with Vertex AI'
      );
      throw error;
    }
  }
}
