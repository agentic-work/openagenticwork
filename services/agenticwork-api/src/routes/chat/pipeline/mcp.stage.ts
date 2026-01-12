import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { getToolSuccessTrackingService } from '../../../services/ToolSuccessTrackingService.js';
import { getIntentLinkingService } from '../../../services/IntentLinkingService.js';
import { mcpAccessControlService } from '../../../services/MCPAccessControlService.js';
// TODO: System MCPs moved to MCP Proxy (awp-diagram-mcp) - keeping import for future use
// import { getSystemMcpTools, isDiagramRequest } from '../../../services/system-mcps/index.js';

/**
 * MCP Stage - Performs semantic search to find relevant tools using ToolSemanticCacheService
 *
 * This stage:
 * 1. Takes user query
 * 2. Uses ToolSemanticCacheService to perform Milvus vector search for semantically relevant tools
 * 3. Returns top-K most relevant tools based on semantic similarity
 * 4. Fallback to Redis cache if semantic search fails
 *
 * CRITICAL: This uses SEMANTIC SEARCH (not keyword routing) to match user intent
 * with available tools. The ToolSemanticCacheService handles all embedding generation
 * and Milvus vector search internally.
 */
export class MCPStage implements PipelineStage {
  readonly name = 'mcp';
  readonly priority = 40;

  constructor() {
    // Service is a singleton, accessed via global.toolSemanticCache global instance
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    try {
      context.logger.info({
        startTime: new Date().toISOString(),
        sessionId: context.request.sessionId,
        userId: context.user.id,
        enableMCP: context.config.enableMCP,
        messageCount: context.messages.length
      }, '[MCP] 🚀 Starting MCP tool search stage with super verbose logging');

      if (!context.config.enableMCP) {
        context.logger.info('[MCP] ⚠️ MCP disabled in config, skipping tool search');
        context.availableTools = [];
        return context;
      }

      // Get user query for semantic search
      context.logger.info('[MCP] 📝 Extracting user query for semantic tool search...');
      const userQuery = this.extractUserQuery(context);

      context.logger.info({
        hasQuery: !!userQuery,
        queryLength: userQuery?.length || 0,
        queryPreview: userQuery?.substring(0, 100) || 'NO_QUERY',
        messagesAvailable: context.messages.length,
        lastMessageRole: context.messages[context.messages.length - 1]?.role
      }, '[MCP] 🔍 User query extraction results');

      if (!userQuery) {
        context.logger.warn('[MCP] ❌ No user query found for tool search - cannot perform semantic search');
        context.availableTools = [];
        return context;
      }

      context.logger.info({
        query: userQuery.substring(0, 100),
        queryLength: userQuery.length,
        toolSemanticCacheInitialized: global.toolSemanticCache?.isInitialized || false,
        hasToolSemanticCache: !!global.toolSemanticCache
      }, '[MCP] 🚀 Starting SEMANTIC tool search via ToolSemanticCacheService');

      // PERFORMANCE OPTIMIZATION: Skip learning services (saves 4+ embedding calls / 60+ seconds)
      // The main semantic search is sufficient for finding relevant tools.
      // Learning services can be re-enabled later with proper embedding caching.
      // const learnedToolNames = await this.getLearnedToolsForQuery(context, userQuery);
      const learnedToolNames: string[] = []; // Skipped for performance

      // CRITICAL: Use ToolSemanticCacheService for semantic search (not keyword routing!)
      // This performs Milvus vector search using embeddings to find tools by INTENT
      let relevantTools: any[] = [];

      if (global.toolSemanticCache?.isInitialized) {
        try {
          // SEMANTIC SEARCH with tags-based filtering
          // REDUCED from 50 to 10 - too many tools confuse the LLM
          const TOP_K = 10;

          context.logger.info({
            query: userQuery.substring(0, 200),
            topK: TOP_K,
            serviceStatus: 'initialized'
          }, '[MCP] 🔍 SEMANTIC SEARCH: Using Milvus vector search with tags');

          relevantTools = await global.toolSemanticCache.searchToolsAsOpenAIFunctions(userQuery, TOP_K);

          // PERFORMANCE: Skip learned tools boosting (already disabled above)
          // The semantic search is already optimized for finding relevant tools

          // CRITICAL: Ensure web tools are available for queries needing real-time info
          // The semantic search often misses web tools for weather/news/current events queries
          relevantTools = await this.ensureEssentialWebTools(relevantTools, userQuery, context);

          context.logger.info({
            semanticToolsFound: relevantTools.length,
            toolNames: relevantTools.slice(0, 10).map(t => t?.function?.name || 'UNNAMED'),
            searchMethod: 'PURE_MILVUS_VECTOR_SEARCH',
            intentBased: true,
            learningApplied: learnedToolNames.length > 0
          }, '[MCP] ✅ SEMANTIC SEARCH COMPLETE: Found tools based on user intent via Milvus');

          // 🛡️ REDIS FALLBACK: If semantic search returns 0 tools, fallback to Redis cache
          if (relevantTools.length === 0) {
            context.logger.warn({
              query: userQuery.substring(0, 100),
              reason: 'semantic_search_returned_zero_tools',
              fallbackMethod: 'REDIS_CACHE_ALL_TOOLS'
            }, '[MCP] ⚠️ Semantic search returned 0 tools - falling back to Redis cache');

            relevantTools = await this.getStaticToolsFromRedis(context);
          }

        } catch (error: any) {
          context.logger.error({
            error: error.message,
            stack: error.stack,
            query: userQuery.substring(0, 100)
          }, '[MCP] ❌ Semantic search failed, falling back to Redis cache');

          // Fallback to static tools from Redis
          relevantTools = await this.getStaticToolsFromRedis(context);
        }
      } else {
        context.logger.warn({
          toolSemanticCacheStatus: 'not_initialized',
          fallbackMethod: 'redis_cache'
        }, '[MCP] ⚠️ ToolSemanticCacheService not initialized, using Redis cache fallback');

        // Fallback to static tools from Redis
        relevantTools = await this.getStaticToolsFromRedis(context);
      }

      // 🎛️ USER PREFERENCE FILTERING: Filter tools based on user's enabled/disabled settings
      // The frontend sends enabledTools array with format: ["serverId.toolName", "serverId", ...]
      // If a server is disabled, all its tools are excluded
      // If a specific tool is disabled, only that tool is excluded
      const enabledToolsFilter = context.request.enabledTools;

      if (enabledToolsFilter && enabledToolsFilter.length > 0) {
        const beforeCount = relevantTools.length;

        // Build sets for quick lookup
        const enabledServers = new Set<string>();
        const enabledToolKeys = new Set<string>();
        const disabledToolKeys = new Set<string>(); // Track explicitly disabled tools

        for (const entry of enabledToolsFilter) {
          if (entry.includes('.')) {
            // It's a specific tool: "serverId.toolName"
            enabledToolKeys.add(entry);
          } else {
            // It's a server ID
            enabledServers.add(entry);
          }
        }

        // Filter tools based on user preferences
        relevantTools = relevantTools.filter(tool => {
          const toolName = tool.function?.name || '';
          // Handle various serverId field names from different sources
          const serverId = tool._serverId || tool.serverId || tool.function?.server_name || '';
          const toolKey = `${serverId}.${toolName}`;

          // If server is enabled, check if this specific tool is enabled
          if (enabledServers.has(serverId)) {
            return enabledToolKeys.has(toolKey);
          }

          // Server not in enabled list means all its tools are disabled
          return false;
        });

        context.logger.info({
          enabledServersCount: enabledServers.size,
          enabledServers: Array.from(enabledServers),
          enabledToolsCount: enabledToolKeys.size,
          beforeFilterCount: beforeCount,
          afterFilterCount: relevantTools.length,
          removedCount: beforeCount - relevantTools.length,
          remainingTools: relevantTools.slice(0, 5).map(t => t.function?.name)
        }, '[MCP] 🎛️ USER PREFERENCE: Filtered tools based on user-enabled servers/tools');
      }

      // 🛡️ MCP ACCESS CONTROL: Filter tools based on policy-based access control
      // This enforces per-MCP access policies configured in the admin portal
      const beforeAccessControl = relevantTools.length;
      relevantTools = await mcpAccessControlService.filterTools(
        context.user.id,
        context.user.groups || [],
        context.user.isAdmin || false,
        relevantTools,
        context.logger
      );

      if (relevantTools.length < beforeAccessControl) {
        context.logger.warn({
          userId: context.user.id,
          userGroups: context.user.groups,
          beforeFilterCount: beforeAccessControl,
          afterFilterCount: relevantTools.length,
          removedCount: beforeAccessControl - relevantTools.length,
          remainingTools: relevantTools.slice(0, 5).map(t => t.function?.name)
        }, '[MCP] 🛡️ ACCESS CONTROL: Removed tools based on MCP access policies');
      } else {
        context.logger.info({
          userId: context.user.id,
          toolCount: relevantTools.length
        }, '[MCP] 🛡️ ACCESS CONTROL: All tools passed policy check');
      }

      // 🚀 PERFORMANCE OPTIMIZATION: Filter out ALL tools for very simple requests
      // This prevents the LLM from calling ANY tools unnecessarily for greetings/simple questions
      const isSimpleConversationalRequest = this.isSimpleConversationalMessage(userQuery);
      if (isSimpleConversationalRequest) {
        const beforeFilterCount = relevantTools.length;
        // For simple conversational messages, remove ALL tools to get instant text responses
        relevantTools = [];

        context.logger.info({
          query: userQuery.substring(0, 50),
          isSimpleMessage: true,
          beforeFilterCount,
          afterFilterCount: 0,
          reason: 'REMOVED ALL tools for simple conversational request - LLM will respond directly'
        }, '[MCP] 🚀 TTFT OPTIMIZATION: Removed ALL tools for simple message');
      }

      context.availableTools = relevantTools;

      // CRITICAL FIX: Filter out reasoning/thinking tools that LLMs abuse
      // Models like Gemini use sequentialthinking instead of producing content
      // These tools should NOT be available - models have native thinking capabilities
      const reasoningToolsToBlock = ['sequentialthinking', 'sequential_thinking', 'think', 'reasoning'];
      const originalCount = context.availableTools.length;
      context.availableTools = context.availableTools.filter(tool => {
        const toolName = (tool.function?.name || '').toLowerCase();
        return !reasoningToolsToBlock.some(blocked => toolName.includes(blocked));
      });
      if (context.availableTools.length < originalCount) {
        context.logger.info({
          removed: originalCount - context.availableTools.length,
          reason: 'Blocked reasoning/thinking tools to prevent abuse - LLMs have native thinking'
        }, '[MCP] 🚫 Removed reasoning tools from available tools');
      }

      // TODO: SYSTEM MCP TOOLS - MOVED TO MCP PROXY (awp-diagram-mcp)
      // The create_diagram tool is now handled by the awp-diagram-mcp server in mcp-proxy.
      // Keeping this code commented out for reference in case we need server-side system MCPs later.
      //
      // // 📊 SYSTEM MCP TOOLS: Inject internal tools like create_diagram when needed
      // // These are not in the external MCP registry but provide specialized capabilities
      // const systemMcpTools = getSystemMcpTools(userQuery);
      // if (systemMcpTools.length > 0) {
      //   // Convert system MCP tool definitions to the same format as external tools
      //   const formattedSystemTools = systemMcpTools.map(tool => ({
      //     type: 'function',
      //     function: {
      //       name: tool.name,
      //       description: tool.description,
      //       parameters: tool.input_schema
      //     },
      //     _serverId: 'system-mcp',  // Mark as internal system tool
      //     _isSystemMcp: true
      //   }));
      //
      //   // Add system tools to the beginning (highest priority)
      //   context.availableTools = [...formattedSystemTools, ...context.availableTools];
      //
      //   context.logger.info({
      //     systemToolsAdded: formattedSystemTools.map(t => t.function.name),
      //     isDiagramRequest: isDiagramRequest(userQuery),
      //     totalToolsNow: context.availableTools.length
      //   }, '[MCP] 📊 SYSTEM MCP: Injected internal tools (e.g., create_diagram)');
      // }

      context.logger.info({
        finalToolCount: context.availableTools.length,
        toolNames: context.availableTools.slice(0, 10).map(t => t.function?.name),
        processingTime: Date.now() - startTime,
        avgTimePerTool: context.availableTools.length > 0 ? Math.round((Date.now() - startTime) / context.availableTools.length) : 0,
        toolSource: 'INTELLIGENT_ROUTING',
        userFilterApplied: !!(context.request.enabledTools && context.request.enabledTools.length > 0)
      }, '[MCP] 🎉 Tool routing completed - minimized tokens while ensuring relevant tools available');

      return context;

    } catch (error: any) {
      context.logger.error({
        error: error.message,
        stack: error.stack,
        processingTime: Date.now() - startTime,
        errorType: error.constructor.name,
        query: this.extractUserQuery(context)?.substring(0, 100),
        hasMilvus: !!context.milvusService
      }, '[MCP] ❌ Tool search failed with detailed error info');

      // Set empty tools on error to prevent downstream issues
      context.availableTools = [];
      return context;
    }
  }

  private extractUserQuery(context: PipelineContext): string {
    // Get the latest user message
    const userMessages = context.messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return '';

    const latestMessage = userMessages[userMessages.length - 1];

    // Handle both string and array content
    if (typeof latestMessage.content === 'string') {
      return latestMessage.content;
    } else if (Array.isArray(latestMessage.content)) {
      // Extract text content from array (ignore images, etc.)
      const contentArray = latestMessage.content as Array<{type: string; text?: string}>;
      return contentArray
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join(' ');
    }

    return '';
  }

  /**
   * Fallback to Redis cache if semantic search is unavailable
   * Returns ALL tools from cache (WARNING: not filtered by intent, sends all tools to LLM)
   */
  private async getStaticToolsFromRedis(context: PipelineContext): Promise<any[]> {
    try {
      context.logger.warn({
        reason: 'semantic_search_unavailable',
        impact: 'ALL_TOOLS_SENT_TO_LLM'
      }, '[MCP] ⚠️ FALLBACK: Using Redis cache (no intent-based filtering)');

      // Get all tools from Redis cache (populated by MCP indexing service)
      const redisClient = context.redisService;
      if (!redisClient) {
        context.logger.error('[MCP] ❌ Redis client not available for fallback');
        return [];
      }

      // Fetch all tools from the cache
      const cacheKey = 'mcp_tools_cache';
      const cachedTools = await redisClient.get(cacheKey);

      if (!cachedTools) {
        context.logger.error('[MCP] ❌ No cached tools found in Redis - MCP indexing may not have run');
        return [];
      }

      // Redis service wrapper already parses JSON, so handle both string and object
      const tools = typeof cachedTools === 'string' ? JSON.parse(cachedTools) : cachedTools;

      // Return all tools from cache (semantic search unavailable)
      context.logger.warn({
        totalToolsInCache: tools.length,
        toolsReturned: tools.length,
        toolNames: tools.slice(0, 10).map((t: any) => t?.function?.name || 'UNNAMED'),
        fallbackMethod: 'REDIS_CACHE_ALL_TOOLS'
      }, '[MCP] ⚠️ FALLBACK: Retrieved ALL tools from Redis (no semantic filtering)');

      return tools;

    } catch (error: any) {
      context.logger.error({
        error: error.message,
        stack: error.stack
      }, '[MCP] ❌ Redis fallback failed - no tools available');
      return [];
    }
  }

  /**
   * 🧠 INTELLIGENT LEARNING: Query ToolSuccessTrackingService and IntentLinkingService
   * Uses structured semantic search in Milvus on past tool usage to suggest relevant tools
   * Also uses cross-collection intent linking for improved tool/prompt routing
   * Reduces token usage by starting with known-good tools
   */
  private async getLearnedToolsForQuery(context: PipelineContext, userQuery: string): Promise<string[]> {
    const allToolNames: string[] = [];

    // 1. Get tools from ToolSuccessTrackingService (direct success patterns)
    try {
      const tracker = getToolSuccessTrackingService();
      const results = await tracker.searchSuccessfulTools({
        query: userQuery,
        userId: context.user.id,
        limit: 5,
        minScore: 0.6,
        includeAllUsers: false  // User-scoped for privacy
      });

      if (results.length > 0) {
        const successTools = results
          .sort((a, b) => b.successScore - a.successScore)
          .map(r => r.toolName);
        allToolNames.push(...successTools);

        context.logger.info({
          userId: context.user.id,
          queryPreview: userQuery.substring(0, 100),
          successTrackingTools: successTools,
          resultsFound: results.length,
          topSuccessScore: results[0]?.successScore,
          topSimilarity: results[0]?.similarity
        }, '[MCP] 🧠 SUCCESS TRACKING: Found previously successful tools');
      }
    } catch (error: any) {
      context.logger.warn({ error: error.message }, '[MCP] 🧠 Tool success tracking search failed');
    }

    // 2. Get tools from IntentLinkingService (cross-collection intent matching)
    try {
      const intentLinker = getIntentLinkingService();
      if (intentLinker.isInitialized) {
        const intentTools = await intentLinker.getToolBoostList(userQuery, context.user.id, 5);

        if (intentTools.length > 0) {
          allToolNames.push(...intentTools);

          // Analyze the query intent for logging
          const intent = intentLinker.analyzeIntent(userQuery);

          context.logger.info({
            userId: context.user.id,
            queryPreview: userQuery.substring(0, 100),
            intentLinkedTools: intentTools,
            detectedIntent: {
              cloudProviders: intent.cloudProviders,
              actions: intent.actions,
              resourceTypes: intent.resourceTypes,
              confidence: intent.confidence
            }
          }, '[MCP] 🔗 INTENT LINKING: Found tools via cross-collection intent matching');
        }
      }
    } catch (error: any) {
      context.logger.warn({ error: error.message }, '[MCP] 🔗 Intent linking search failed');
    }

    // Deduplicate and return
    const uniqueTools = [...new Set(allToolNames)];

    if (uniqueTools.length === 0) {
      context.logger.debug('[MCP] 🧠 No learned tools found from any source');
    } else {
      context.logger.info({
        totalUniqueTools: uniqueTools.length,
        tools: uniqueTools
      }, '[MCP] 🧠 COMBINED LEARNING: Merged tools from success tracking + intent linking');
    }

    return uniqueTools;
  }

  /**
   * 🧠 BOOST LEARNED TOOLS: Move previously successful tools to top of results
   * This prioritizes tools that worked well for similar queries in the past
   */
  private boostLearnedTools(tools: any[], learnedToolNames: string[]): any[] {
    if (learnedToolNames.length === 0) return tools;

    const learnedTools: any[] = [];
    const otherTools: any[] = [];

    for (const tool of tools) {
      const toolName = tool.function?.name;
      if (toolName && learnedToolNames.includes(toolName)) {
        learnedTools.push(tool);
      } else {
        otherTools.push(tool);
      }
    }

    // Learned tools first, then others
    return [...learnedTools, ...otherTools];
  }

  // REMOVED: isBasicQuestion() - We trust semantic search + LLM intelligence.
  // The LLM should decide whether to use tools based on the semantically retrieved tools,
  // not hardcoded keyword lists. Semantic search via Milvus handles relevance.

  // REMOVED: boostCloudProviderTools() - We trust semantic search + LLM intelligence.
  // The Milvus vector search handles tool discovery based on intent, not hardcoded cloud keywords.
  // If cloud provider tools have proper descriptions, they'll be found semantically.

  /**
   * 🌐 ESSENTIAL WEB TOOLS: Ensure web_search and web_news_search are available
   * for queries that may need real-time information (weather, news, current events, etc.)
   *
   * The semantic search often fails to find web tools because their descriptions
   * don't explicitly mention keywords like "weather", "current", "today", etc.
   */
  private async ensureEssentialWebTools(
    tools: any[],
    userQuery: string,
    context: PipelineContext
  ): Promise<any[]> {
    // Keywords that indicate need for real-time/external information
    const realTimeKeywords = [
      'weather', 'forecast', 'temperature', 'rain', 'snow', 'humidity',
      'news', 'current', 'today', 'right now', 'latest', 'recent',
      'price', 'stock', 'market', 'bitcoin', 'crypto',
      'score', 'game', 'match', 'playing',
      'search', 'find', 'look up', 'google', 'lookup',
      'what is', 'who is', 'where is', 'when is',
      'happening', 'events', 'schedule'
    ];

    const queryLower = userQuery.toLowerCase();
    const needsWebTools = realTimeKeywords.some(keyword => queryLower.includes(keyword));

    if (!needsWebTools) {
      return tools; // No web tools needed for this query
    }

    // Check if web tools are already in the results
    const toolNames = tools.map(t => t.function?.name || '');
    const hasWebSearch = toolNames.includes('web_search');
    const hasWebNewsSearch = toolNames.includes('web_news_search');

    if (hasWebSearch && hasWebNewsSearch) {
      return tools; // Already has essential web tools
    }

    // Fetch web tools from ToolSemanticCacheService directly
    try {
      if (!global.toolSemanticCache?.isInitialized) {
        return tools;
      }

      // Get web tools by searching with high relevance query
      // Use semantic search without hardcoding server names - let the query find relevant tools
      const webToolQuery = 'search the web for information news weather current events browse internet fetch url';
      const webTools = await global.toolSemanticCache.searchToolsAsOpenAIFunctions(webToolQuery, 10);

      // Add missing essential tools to the beginning of the list
      const essentialTools: any[] = [];

      if (!hasWebSearch) {
        const webSearchTool = webTools.find((t: any) => t.function?.name === 'web_search');
        if (webSearchTool) {
          essentialTools.push(webSearchTool);
        }
      }

      if (!hasWebNewsSearch) {
        const newsSearchTool = webTools.find((t: any) => t.function?.name === 'web_news_search');
        if (newsSearchTool) {
          essentialTools.push(newsSearchTool);
        }
      }

      if (essentialTools.length > 0) {
        context.logger.info({
          queryPreview: userQuery.substring(0, 100),
          addedTools: essentialTools.map(t => t.function?.name),
          reason: 'real_time_info_keywords_detected',
          triggeredBy: realTimeKeywords.filter(k => queryLower.includes(k))
        }, '[MCP] 🌐 ESSENTIAL WEB TOOLS: Added web search tools for real-time info query');

        // Put essential tools first, then the rest
        return [...essentialTools, ...tools];
      }
    } catch (error: any) {
      context.logger.warn({
        error: error.message
      }, '[MCP] 🌐 Failed to fetch essential web tools');
    }

    return tools;
  }

  /**
   * 🚀 TTFT OPTIMIZATION: Detect simple conversational messages that don't need memory/admin tools
   *
   * This helps improve response time by filtering out memory_* and admin_system_* tools
   * for simple greetings and questions that can be answered without tools.
   */
  private isSimpleConversationalMessage(query: string): boolean {
    const normalizedQuery = query.toLowerCase().trim();

    // Check for cloud provider keywords FIRST - these always need tools
    const cloudKeywords = ['aws', 'azure', 'gcp', 'cloud', 'ec2', 'lambda', 's3', 'dynamodb', 'rds',
                          'subscription', 'resource group', 'vm', 'virtual machine', 'bucket', 'storage',
                          'account', 'region', 'iam', 'kubernetes', 'k8s', 'eks', 'aks', 'gke', 'cost',
                          'flowise', 'workflow', 'chatflow', 'diagram', 'web search', 'browse'];
    const hasCloudKeyword = cloudKeywords.some(kw => normalizedQuery.includes(kw));
    if (hasCloudKeyword) {
      return false;  // Cloud queries ALWAYS need tools
    }

    // Short messages are likely simple conversational requests
    if (normalizedQuery.length < 30) {
      // Check for keywords that indicate memory/admin tools might be needed
      const needsMemoryKeywords = ['remember', 'recall', 'yesterday', 'last time', 'previous', 'earlier', 'before', 'history', 'conversation'];
      const needsAdminKeywords = ['health', 'status', 'system', 'redis', 'postgres', 'milvus', 'database', 'server'];

      const hasMemoryKeyword = needsMemoryKeywords.some(kw => normalizedQuery.includes(kw));
      const hasAdminKeyword = needsAdminKeywords.some(kw => normalizedQuery.includes(kw));

      // If no special keywords, it's a simple conversational message
      if (!hasMemoryKeyword && !hasAdminKeyword) {
        return true;
      }
    }

    // Common greetings that definitely don't need tools
    const greetings = ['hello', 'hi', 'hey', 'howdy', 'good morning', 'good afternoon', 'good evening',
                      'what\'s up', 'wassup', 'yo', 'greetings', 'how are you', 'how\'s it going'];

    if (greetings.some(g => normalizedQuery.includes(g) || normalizedQuery === g)) {
      return true;
    }

    // Simple questions that can be answered without tools
    const simplePatterns = [
      /^what is \d+[\+\-\*\/]\d+/,  // Math questions
      /^just say/i,                  // "Just say Hello!"
      /^say /i,                      // "Say hello"
      /^tell me a joke/i,
      /^what is the capital of/i,
      /^explain (what|how|why)/i,
      /^how do (i|you|we)/i
    ];

    if (simplePatterns.some(p => p.test(normalizedQuery))) {
      return true;
    }

    return false;
  }

  async rollback(context: PipelineContext): Promise<void> {
    // Clear any MCP-related context
    context.availableTools = [];
    context.logger.info('[MCP] Stage rollback completed');
  }
}