/**
 * Image Generation Service
 *
 * Provider-agnostic image generation supporting all configured providers:
 * - Gemini 3 Pro Image (gemini-3-pro-image-preview) - 4K output, best quality, native
 * - Azure OpenAI (DALL-E 3, Sora, future models)
 * - Google Vertex AI (Imagen 3, future models)
 * - AWS Bedrock (Stability AI, Amazon Titan Image, future models)
 *
 * Configuration via environment variables:
 * - IMAGE_GEN_PROVIDER: 'gemini' | 'azure-openai' | 'vertex-ai' | 'aws-bedrock'
 * - IMAGE_GEN_MODEL: Model ID (provider-specific)
 * - Provider-specific credentials (reuses existing LLM provider config)
 *
 * Gemini uses the generateContent API with responseModalities: ["TEXT", "IMAGE"]
 * while Imagen uses the predict API - these are completely different endpoints.
 */

import { AzureOpenAI } from 'openai';
import { ClientSecretCredential, getBearerTokenProvider } from '@azure/identity';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { GoogleAuth } from 'google-auth-library';

export type ImageProvider = 'azure-openai' | 'vertex-ai' | 'aws-bedrock' | 'gemini';

interface ImageGenerationRequest {
  prompt: string;
  size?: string; // e.g., '1024x1024', '1792x1024', etc.
  n?: number;
  model?: string;
  provider?: ImageProvider;
  // Provider-specific options
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  aspectRatio?: string; // For Vertex AI
}

interface ImageGenerationResult {
  success: boolean;
  imageUrl?: string;
  imageBase64?: string;
  revisedPrompt?: string;
  error?: string;
  responseTime: number;
  provider: string;
  model: string;
}

export class ImageGenerationService {
  private logger: any;
  private defaultProvider: ImageProvider;
  private defaultModel: string;

  // Azure OpenAI
  private azureClient?: AzureOpenAI;
  private azureEndpoint?: string;

  // AWS Bedrock
  private bedrockClient?: BedrockRuntimeClient;

  // Vertex AI
  private vertexProjectId?: string;
  private vertexLocation?: string;

  constructor(logger: any) {
    this.logger = logger;

    // Determine default provider from env (normalize provider names)
    let rawProvider = process.env.IMAGE_GEN_PROVIDER || '';
    this.defaultProvider = this.normalizeProvider(rawProvider) || this.detectDefaultProvider();

    // Determine model (normalize aliases to actual model names)
    let rawModel = process.env.IMAGE_GEN_MODEL || '';
    this.defaultModel = this.normalizeModel(rawModel, this.defaultProvider) || this.getDefaultModelForProvider(this.defaultProvider);

    this.logger.info({
      defaultProvider: this.defaultProvider,
      defaultModel: this.defaultModel,
      rawProvider,
      rawModel
    }, '[IMAGE-GEN] ImageGenerationService initialized');

    // Initialize providers based on available configuration
    this.initializeProviders();
  }

  /**
   * Normalize provider names (accept common aliases)
   */
  private normalizeProvider(provider: string): ImageProvider | null {
    const normalized = provider.toLowerCase().trim();

    // Map common aliases to canonical names
    const providerMap: Record<string, ImageProvider> = {
      'vertex': 'vertex-ai',
      'vertex-ai': 'vertex-ai',
      'vertexai': 'vertex-ai',
      'google': 'vertex-ai',
      'google-vertex': 'vertex-ai',
      'azure': 'azure-openai',
      'azure-openai': 'azure-openai',
      'openai': 'azure-openai',
      'dalle': 'azure-openai',
      'dall-e': 'azure-openai',
      'bedrock': 'aws-bedrock',
      'aws': 'aws-bedrock',
      'aws-bedrock': 'aws-bedrock',
      // Gemini 3 Pro Image (native image generation via generateContent)
      'gemini': 'gemini',
      'gemini-3': 'gemini',
      'gemini-3-pro': 'gemini',
      'gemini-image': 'gemini',
      'nano-banana': 'gemini',  // Internal codename
    };

    return providerMap[normalized] || null;
  }

  /**
   * Normalize model names (map aliases to actual provider model names)
   */
  private normalizeModel(model: string, provider: ImageProvider): string | null {
    if (!model) return null;

    const normalized = model.toLowerCase().trim();

    // Map aliases and short names to actual model IDs
    const modelMap: Record<string, Record<string, string>> = {
      'vertex-ai': {
        'image-gen': 'imagen-3.0-fast-generate-001',
        'imagen': 'imagen-3.0-fast-generate-001',
        'imagen-3': 'imagen-3.0-fast-generate-001',
        'imagen-3-fast': 'imagen-3.0-fast-generate-001',
        'imagen-3.0-fast': 'imagen-3.0-fast-generate-001',
        'imagen-3.0-generate': 'imagen-3.0-generate-001',
      },
      'azure-openai': {
        'dalle': 'dall-e-3',
        'dall-e': 'dall-e-3',
        'dalle-3': 'dall-e-3',
      },
      'aws-bedrock': {
        'sdxl': 'stability.stable-diffusion-xl-v1',
        'stable-diffusion': 'stability.stable-diffusion-xl-v1',
        'titan': 'amazon.titan-image-generator-v1',
      },
      // Gemini 3 Pro Image - native image generation via generateContent API
      'gemini': {
        'gemini-3-pro-image': 'gemini-3-pro-image-preview',
        'gemini-3-pro': 'gemini-3-pro-image-preview',
        'gemini-image': 'gemini-3-pro-image-preview',
        'nano-banana': 'gemini-3-pro-image-preview',
        '4k': 'gemini-3-pro-image-preview',  // 4K output
        '2.5-flash-image': 'gemini-2.5-flash-preview-image-generation',
        'flash-image': 'gemini-2.5-flash-preview-image-generation',
      }
    };

    // Check if there's a mapping for this provider
    const providerModels = modelMap[provider];
    if (providerModels && providerModels[normalized]) {
      return providerModels[normalized];
    }

    // Return original if it looks like a real model ID (contains dots or dashes)
    if (model.includes('.') || model.includes('-')) {
      return model;
    }

    return null;
  }

  /**
   * Detect which provider to use based on available configuration
   */
  private detectDefaultProvider(): ImageProvider {
    // Prefer Gemini 3 Pro Image when GCP is configured (best quality, 4K output)
    if (process.env.GCP_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT) {
      return 'gemini';
    }

    // Check Azure OpenAI
    if (process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_KEY) {
      return 'azure-openai';
    }

    // Check Vertex AI (Imagen)
    if (process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT) {
      return 'vertex-ai';
    }

    // Check AWS Bedrock
    if (process.env.AWS_REGION || process.env.AWS_ACCESS_KEY_ID) {
      return 'aws-bedrock';
    }

    // Default to Gemini if nothing else configured
    return 'gemini';
  }

  /**
   * Get default model for a provider
   */
  private getDefaultModelForProvider(provider: ImageProvider): string {
    switch (provider) {
      case 'gemini':
        // Gemini 3 Pro Image - 4K output, best quality
        return process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
      case 'azure-openai':
        return process.env.AZURE_IMAGE_MODEL || 'dall-e-3';
      case 'vertex-ai':
        return process.env.VERTEX_IMAGE_MODEL || 'imagen-3.0-fast-generate-001';
      case 'aws-bedrock':
        return process.env.AWS_IMAGE_MODEL || 'stability.stable-diffusion-xl-v1';
      default:
        return 'gemini-3-pro-image-preview';
    }
  }

  /**
   * Initialize all available providers
   * IMPORTANT: Synchronous Vertex AI config MUST run BEFORE any async operations
   * to avoid race conditions where generateImage() is called before providers are ready
   */
  private async initializeProviders(): Promise<void> {
    // Initialize Vertex AI config FIRST (synchronous - must complete before any await)
    // This prevents race conditions where generateImage() is called before config is set
    if (process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT) {
      this.vertexProjectId = process.env.VERTEX_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
      // Imagen models require specific regions (us-central1, us-west1, etc.) - NOT 'global'
      // Use IMAGE_LOCATION or fall back to us-central1 for Imagen compatibility
      const configuredLocation = process.env.VERTEX_AI_IMAGE_LOCATION || process.env.VERTEX_AI_LOCATION || 'us-central1';
      this.vertexLocation = configuredLocation === 'global' ? 'us-central1' : configuredLocation;
      this.logger.info({
        vertexProjectId: this.vertexProjectId,
        vertexLocation: this.vertexLocation
      }, '[IMAGE-GEN] Vertex AI config initialized (sync)');
    }

    // Initialize AWS Bedrock if configured (synchronous)
    if (process.env.AWS_REGION || process.env.AWS_ACCESS_KEY_ID) {
      try {
        this.initializeAWSBedrock();
      } catch (error: any) {
        this.logger.warn({ error: error.message }, '[IMAGE-GEN] AWS Bedrock initialization failed');
      }
    }

    // Initialize Azure OpenAI if configured (async - runs last)
    if (process.env.AZURE_OPENAI_ENDPOINT) {
      try {
        await this.initializeAzureOpenAI();
      } catch (error: any) {
        this.logger.warn({ error: error.message }, '[IMAGE-GEN] Azure OpenAI initialization failed');
      }
    }
  }

  /**
   * Initialize Azure OpenAI client
   */
  private async initializeAzureOpenAI(): Promise<void> {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!endpoint) {
      throw new Error('AZURE_OPENAI_ENDPOINT not configured');
    }

    this.azureEndpoint = endpoint;

    if (tenantId && clientId && clientSecret) {
      // Entra ID authentication
      const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
      const azureADTokenProvider = getBearerTokenProvider(
        credential,
        'https://cognitiveservices.azure.com/.default'
      );

      this.azureClient = new AzureOpenAI({
        azureADTokenProvider,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-10-21',
        endpoint: endpoint
      });

      this.logger.info('[IMAGE-GEN] Azure OpenAI initialized with Entra ID');
    } else if (apiKey) {
      // API key authentication
      this.azureClient = new AzureOpenAI({
        apiKey,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-10-21',
        endpoint: endpoint
      });

      this.logger.info('[IMAGE-GEN] Azure OpenAI initialized with API key');
    }
  }

  /**
   * Initialize AWS Bedrock client
   */
  private initializeAWSBedrock(): void {
    const clientConfig: any = {
      region: process.env.AWS_REGION || 'us-east-1'
    };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
      };
    }

    this.bedrockClient = new BedrockRuntimeClient(clientConfig);
    this.logger.info('[IMAGE-GEN] AWS Bedrock initialized');
  }

  /**
   * Generate an image using the configured or specified provider
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const provider = request.provider || this.defaultProvider;
    const model = request.model || this.defaultModel;

    this.logger.info({
      prompt: request.prompt.substring(0, 100),
      provider,
      model,
      size: request.size
    }, '[IMAGE-GEN] Starting image generation');

    try {
      let result: ImageGenerationResult;

      switch (provider) {
        case 'gemini':
          result = await this.generateWithGemini(request, model, startTime);
          break;
        case 'azure-openai':
          result = await this.generateWithAzureOpenAI(request, model, startTime);
          break;
        case 'vertex-ai':
          result = await this.generateWithVertexAI(request, model, startTime);
          break;
        case 'aws-bedrock':
          result = await this.generateWithBedrock(request, model, startTime);
          break;
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      return result;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      this.logger.error({
        error: error.message,
        provider,
        model,
        responseTime
      }, '[IMAGE-GEN] Image generation failed');

      return {
        success: false,
        error: error.message,
        responseTime,
        provider,
        model
      };
    }
  }

  /**
   * Generate image using Gemini 3 Pro Image (Nano Banana Pro)
   * Uses the generateContent API with responseModalities: ["TEXT", "IMAGE"]
   * Supports up to 4K (4096x4096) output resolution
   */
  private async generateWithGemini(
    request: ImageGenerationRequest,
    model: string,
    startTime: number
  ): Promise<ImageGenerationResult> {
    const projectId = process.env.GCP_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || this.vertexProjectId;
    if (!projectId) {
      throw new Error('Gemini not configured. Set GCP_PROJECT_ID or VERTEX_AI_PROJECT_ID.');
    }

    const accessToken = await this.getVertexAccessToken();

    // Gemini 3 Pro Image uses 'global' location for preview models
    const location = process.env.VERTEX_AI_LOCATION || 'global';

    // Use generateContent endpoint (not predict like Imagen)
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    // Map size to aspect ratio for Gemini
    const aspectRatio = request.aspectRatio || this.sizeToAspectRatio(request.size || '1024x1024');

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [{
          text: request.prompt
        }]
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: aspectRatio
        }
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE'
        },
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE'
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE'
        }
      ]
    };

    this.logger.debug({
      endpoint,
      model,
      aspectRatio,
      promptPreview: request.prompt.substring(0, 50)
    }, '[IMAGE-GEN] Calling Gemini generateContent for image');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestBody)
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error({
        status: response.status,
        error: errorText
      }, '[IMAGE-GEN] Gemini generateContent failed');
      throw new Error(`Gemini error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;

    // Extract image from Gemini response
    // Response format: { candidates: [{ content: { parts: [...] } }] }
    if (data.candidates && data.candidates.length > 0) {
      const parts = data.candidates[0].content?.parts || [];

      // Find the image part (has inlineData with mimeType starting with 'image/')
      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
          const imageBase64 = part.inlineData.data;

          this.logger.info({
            model,
            responseTime,
            mimeType: part.inlineData.mimeType,
            imageSize: imageBase64?.length
          }, '[IMAGE-GEN] Gemini image generated successfully');

          return {
            success: true,
            imageBase64,
            revisedPrompt: request.prompt,
            responseTime,
            provider: 'gemini',
            model
          };
        }
      }

      // Check if there's text but no image (model refused or couldn't generate)
      const textParts = parts.filter((p: any) => p.text);
      if (textParts.length > 0) {
        const textResponse = textParts.map((p: any) => p.text).join('\n');
        this.logger.warn({
          model,
          textResponse: textResponse.substring(0, 200)
        }, '[IMAGE-GEN] Gemini returned text instead of image');
        throw new Error(`Gemini could not generate image: ${textResponse.substring(0, 200)}`);
      }
    }

    throw new Error('No image data in Gemini response');
  }

  /**
   * Generate image using Azure OpenAI (DALL-E, Sora, etc.)
   */
  private async generateWithAzureOpenAI(
    request: ImageGenerationRequest,
    model: string,
    startTime: number
  ): Promise<ImageGenerationResult> {
    if (!this.azureClient) {
      throw new Error('Azure OpenAI not initialized. Check AZURE_OPENAI_ENDPOINT configuration.');
    }

    const size = request.size || '1024x1024';

    const response = await this.azureClient.images.generate({
      model: model,
      prompt: request.prompt,
      n: request.n || 1,
      size: size as any,
      response_format: 'b64_json',
      quality: request.quality || 'standard',
      style: request.style || 'vivid'
    });

    const responseTime = Date.now() - startTime;

    if (response.data && response.data.length > 0) {
      const imageData = response.data[0];

      this.logger.info({
        model,
        responseTime,
        hasRevisedPrompt: !!imageData.revised_prompt
      }, '[IMAGE-GEN] Azure OpenAI image generated successfully');

      return {
        success: true,
        imageBase64: imageData.b64_json,
        imageUrl: imageData.url,
        revisedPrompt: imageData.revised_prompt || request.prompt,
        responseTime,
        provider: 'azure-openai',
        model
      };
    }

    throw new Error('No image data in Azure OpenAI response');
  }

  /**
   * Generate image using Google Vertex AI (Imagen 3, etc.)
   */
  private async generateWithVertexAI(
    request: ImageGenerationRequest,
    model: string,
    startTime: number
  ): Promise<ImageGenerationResult> {
    if (!this.vertexProjectId) {
      throw new Error('Vertex AI not configured. Set VERTEX_AI_PROJECT or GOOGLE_CLOUD_PROJECT.');
    }

    const accessToken = await this.getVertexAccessToken();
    const aspectRatio = request.aspectRatio || this.sizeToAspectRatio(request.size || '1024x1024');

    const endpoint = `https://${this.vertexLocation}-aiplatform.googleapis.com/v1/projects/${this.vertexProjectId}/locations/${this.vertexLocation}/publishers/google/models/${model}:predict`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        instances: [{
          prompt: request.prompt
        }],
        parameters: {
          sampleCount: request.n || 1,
          aspectRatio: aspectRatio,
          safetyFilterLevel: 'block_some',
          personGeneration: 'allow_adult',
          includeSafetyAttributes: false
        }
      })
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vertex AI error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;

    if (data.predictions && data.predictions.length > 0) {
      const prediction = data.predictions[0];
      const imageBytes = prediction.bytesBase64Encoded;

      if (imageBytes) {
        this.logger.info({
          model,
          responseTime,
          bytesLength: imageBytes.length
        }, '[IMAGE-GEN] Vertex AI image generated successfully');

        return {
          success: true,
          imageBase64: imageBytes,
          revisedPrompt: request.prompt,
          responseTime,
          provider: 'vertex-ai',
          model
        };
      }
    }

    throw new Error('No image data in Vertex AI response');
  }

  /**
   * Generate image using AWS Bedrock (Stability AI, Titan Image, etc.)
   */
  private async generateWithBedrock(
    request: ImageGenerationRequest,
    model: string,
    startTime: number
  ): Promise<ImageGenerationResult> {
    if (!this.bedrockClient) {
      throw new Error('AWS Bedrock not initialized. Check AWS credentials configuration.');
    }

    // Build request body based on model type
    let body: any;

    if (model.includes('stability')) {
      // Stability AI models (Stable Diffusion)
      const [width, height] = (request.size || '1024x1024').split('x').map(Number);
      body = {
        text_prompts: [{ text: request.prompt, weight: 1.0 }],
        cfg_scale: 7,
        steps: 50,
        width: width || 1024,
        height: height || 1024,
        samples: request.n || 1
      };
    } else if (model.includes('amazon.titan-image')) {
      // Amazon Titan Image Generator
      body = {
        textToImageParams: {
          text: request.prompt
        },
        taskType: 'TEXT_IMAGE',
        imageGenerationConfig: {
          numberOfImages: request.n || 1,
          quality: request.quality === 'hd' ? 'premium' : 'standard',
          width: parseInt((request.size || '1024x1024').split('x')[0]),
          height: parseInt((request.size || '1024x1024').split('x')[1])
        }
      };
    } else {
      // Generic format for other Bedrock image models
      body = {
        prompt: request.prompt,
        num_images: request.n || 1
      };
    }

    const command = new InvokeModelCommand({
      modelId: model,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const response = await this.bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const responseTime = Date.now() - startTime;

    // Extract image based on model type
    let imageBase64: string | undefined;

    if (model.includes('stability')) {
      // Stability AI response format
      imageBase64 = responseBody.artifacts?.[0]?.base64;
    } else if (model.includes('amazon.titan-image')) {
      // Titan Image response format
      imageBase64 = responseBody.images?.[0];
    } else {
      // Try generic extraction
      imageBase64 = responseBody.image || responseBody.images?.[0] || responseBody.artifacts?.[0]?.base64;
    }

    if (imageBase64) {
      this.logger.info({
        model,
        responseTime
      }, '[IMAGE-GEN] AWS Bedrock image generated successfully');

      return {
        success: true,
        imageBase64,
        revisedPrompt: request.prompt,
        responseTime,
        provider: 'aws-bedrock',
        model
      };
    }

    throw new Error('No image data in Bedrock response');
  }

  /**
   * Get Vertex AI access token
   */
  private async getVertexAccessToken(): Promise<string> {
    // Try environment credentials first
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try {
        const authOptions: any = {
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        };

        if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
          authOptions.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        }

        const auth = new GoogleAuth(authOptions);
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        if (token.token) {
          return token.token;
        }
      } catch (error: any) {
        this.logger.warn({ error: error.message }, '[IMAGE-GEN] Failed to get token via GoogleAuth');
      }
    }

    // Try metadata server (when running in GCP)
    try {
      const response = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } }
      );
      if (response.ok) {
        const data = await response.json() as any;
        return data.access_token;
      }
    } catch (error: any) {
      this.logger.debug('[IMAGE-GEN] Metadata server not available');
    }

    // Try gcloud CLI as fallback (for local development)
    try {
      const { execSync } = await import('child_process');
      const token = execSync('gcloud auth print-access-token', { encoding: 'utf-8' }).trim();
      if (token) {
        return token;
      }
    } catch (error: any) {
      this.logger.debug('[IMAGE-GEN] gcloud CLI not available');
    }

    throw new Error('Unable to obtain Google Cloud access token');
  }

  /**
   * Convert size string to aspect ratio
   */
  private sizeToAspectRatio(size: string): string {
    const aspectRatioMap: Record<string, string> = {
      '1024x1024': '1:1',
      '1792x1024': '16:9',
      '1024x1792': '9:16',
      '1408x768': '16:9',
      '768x1408': '9:16',
      '1280x896': '4:3',
      '896x1280': '3:4',
      '1536x1024': '3:2',
      '1024x1536': '2:3'
    };
    return aspectRatioMap[size] || '1:1';
  }

  /**
   * Get list of available image generation providers
   */
  getAvailableProviders(): ImageProvider[] {
    const providers: ImageProvider[] = [];

    // Gemini uses same GCP credentials as Vertex AI
    const hasGcp = process.env.GCP_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || this.vertexProjectId;
    if (hasGcp) providers.push('gemini');
    if (this.azureClient) providers.push('azure-openai');
    if (this.vertexProjectId) providers.push('vertex-ai');
    if (this.bedrockClient) providers.push('aws-bedrock');

    return providers;
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): ImageProvider {
    return this.defaultProvider;
  }

  /**
   * Get the default model
   */
  getDefaultModel(): string {
    return this.defaultModel;
  }
}
