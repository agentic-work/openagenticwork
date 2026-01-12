/**
 * Web Tools
 * Web search and URL fetching capabilities
 */

import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

/**
 * Web Search Tool - Search the web using DuckDuckGo
 * Uses DuckDuckGo's HTML interface (no API key needed)
 */
export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: `Search the web for information. Use this to find documentation, tutorials, API references, package info, error solutions, or any up-to-date information. Returns relevant search results with titles, URLs, and snippets.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (be specific for better results)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 8)',
      },
    },
    required: ['query'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const query = args.query as string;
    const maxResults = (args.maxResults as number) || 8;

    try {
      // Use DuckDuckGo HTML search (no API key needed)
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AgentiCode/1.0)',
        },
        signal: context.signal,
      });

      if (!response.ok) {
        return {
          content: `Search failed: HTTP ${response.status}`,
          isError: true,
        };
      }

      const html = await response.text();

      // Parse search results from DuckDuckGo HTML
      const results = parseDuckDuckGoResults(html, maxResults);

      if (results.length === 0) {
        return {
          content: `No search results found for: "${query}"`,
        };
      }

      const header = `Web Search Results for: "${query}"\nFound ${results.length} results\n${'─'.repeat(60)}`;
      const formatted = results.map((r, i) =>
        `\n[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`
      ).join('\n');

      return {
        content: `${header}${formatted}`,
        metadata: { resultCount: results.length, query },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('aborted')) {
        return {
          content: 'Search cancelled',
          isError: true,
        };
      }

      return {
        content: `Search error: ${message}`,
        isError: true,
      };
    }
  },
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML format uses class="result" for each result
  // and contains links and snippets
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

  // Alternative simpler regex for result blocks
  const blockRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;

  let match;

  // Try to extract using result links
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  // Split by result blocks and extract
  const blocks = html.split(/class="result\s/);

  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];

    // Extract URL - look for uddg parameter or direct href
    let url = '';
    const uddgMatch = block.match(/uddg=([^&"]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    } else {
      const hrefMatch = block.match(/href="(https?:\/\/[^"]+)"/);
      if (hrefMatch) {
        url = hrefMatch[1];
      }
    }

    // Extract title
    let title = '';
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    if (titleMatch) {
      title = cleanHtml(titleMatch[1]);
    }

    // Extract snippet
    let snippet = '';
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (snippetMatch) {
      snippet = cleanHtml(snippetMatch[1]);
    }

    if (url && title) {
      results.push({
        title: title.trim(),
        url: url,
        snippet: snippet.trim() || 'No description available',
      });
    }
  }

  return results;
}

/**
 * Clean HTML tags and entities from text
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Web Fetch Tool - Fetch and process URL content
 */
export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: `Fetch content from a URL. Use this to read documentation, API references, GitHub files, blog posts, or any web page. Returns the content converted to readable text/markdown format.`,
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (must be a valid http/https URL)',
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters to return (default: 50000)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector to extract specific content (optional)',
      },
    },
    required: ['url'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const url = args.url as string;
    const maxChars = (args.maxChars as number) || 50000;

    // Validate URL
    try {
      new URL(url);
    } catch {
      return {
        content: `Invalid URL: ${url}`,
        isError: true,
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      // Combine with context signal
      context.signal?.addEventListener('abort', () => controller.abort());

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AgentiCode/1.0; +https://agenticwork.io)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          content: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
          isError: true,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      let content: string;

      if (contentType.includes('application/json')) {
        // JSON response - pretty print
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else if (contentType.includes('text/html')) {
        // HTML - convert to readable text
        const html = await response.text();
        content = htmlToReadableText(html);
      } else if (contentType.includes('text/')) {
        // Plain text
        content = await response.text();
      } else {
        // Binary or unknown - just note it
        return {
          content: `URL returned non-text content (${contentType}). Cannot display binary content.`,
          metadata: { url, contentType },
        };
      }

      // Truncate if needed
      const truncated = content.length > maxChars;
      if (truncated) {
        content = content.slice(0, maxChars) + '\n\n... [content truncated]';
      }

      const header = `Content from: ${url}\n${'─'.repeat(60)}\n`;

      return {
        content: header + content,
        metadata: {
          url,
          contentType,
          length: content.length,
          truncated,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('aborted')) {
        return {
          content: 'Fetch cancelled or timed out',
          isError: true,
        };
      }

      return {
        content: `Fetch error: ${message}`,
        isError: true,
      };
    }
  },
};

/**
 * Convert HTML to readable text (simple markdown-like conversion)
 */
function htmlToReadableText(html: string): string {
  // Remove script and style elements
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Convert headers
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Convert links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert emphasis
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // Convert code
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Convert lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<\/ul>/gi, '\n');
  text = text.replace(/<\/ol>/gi, '\n');

  // Convert paragraphs and line breaks
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Convert blockquotes
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

  // Clean up whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +/gm, '')
    .trim();

  return text;
}
