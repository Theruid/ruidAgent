import { z } from "zod";
import { fetchWithRetry } from "../providers/retry.js";

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;
const MAX_FETCH_BYTES = 100 * 1024; // 100 KB cap

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Strips HTML tags, styles, scripts, and navigation to produce clean, readable Markdown.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || typeof html !== "string") return "";

  let clean = html;

  // Strip scripts, styles, noscript, svg, iframes
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  clean = clean.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");
  clean = clean.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "");
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  clean = clean.replace(/<!--[\s\S]*?-->/g, "");

  // Strip headers, footers, navs, and asides
  clean = clean.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "");
  clean = clean.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "");
  clean = clean.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "");
  clean = clean.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "");

  // Convert headings
  clean = clean.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  clean = clean.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  clean = clean.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  clean = clean.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  clean = clean.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  clean = clean.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Convert pre/code blocks
  clean = clean.replace(/<pre[^>]*><code(?: class="(?:language-)?([^"]*)")?>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
    return `\n\`\`\`${lang || ""}\n${code.trim()}\n\`\`\`\n`;
  });
  clean = clean.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  clean = clean.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Convert bold and italics
  clean = clean.replace(/<(?:strong\b|b\b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**");
  clean = clean.replace(/<(?:em\b|i\b)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  // Convert links
  clean = clean.replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, text) => {
    const cleanText = text.replace(/<[^>]+>/g, "").trim();
    if (!cleanText) return "";
    return `[${cleanText}](${url})`;
  });

  // Convert list items
  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n* $1");

  // Convert blockquotes
  clean = clean.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");

  // Convert paragraphs, breaks, hr
  clean = clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n");
  clean = clean.replace(/<br\s*\/?>/gi, "\n");
  clean = clean.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Strip remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  clean = decodeHtmlEntities(clean);

  // Normalize consecutive whitespace and line breaks
  clean = clean
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return clean;
}

export function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&copy;": "©",
    "&reg;": "®",
    "&mdash;": "—",
    "&ndash;": "–",
  };

  return text
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|copy|reg|mdash|ndash);/g, (match) => entities[match] || match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Parses DuckDuckGo HTML search results page.
 */
export function parseDuckDuckGoHtml(html: string, limit = DEFAULT_SEARCH_LIMIT): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result links: <a class="result__url" href="..."> or <a class="result__snippet" href="...">
  const resultBlocks = html.split(/class="result\s+results_links/gi);

  for (let i = 1; i < resultBlocks.length && results.length < limit; i++) {
    const block = resultBlocks[i];

    // Extract title & URL
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    // Extract snippet
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

    if (titleMatch) {
      let rawUrl = titleMatch[1];
      // DuckDuckGo redirects links through /l/?uddg=<encoded_url>
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          rawUrl = decodeURIComponent(uddgMatch[1]);
        } catch {}
      }

      const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";

      if (rawUrl && title && !rawUrl.startsWith("//duckduckgo.com")) {
        results.push({
          title: decodeHtmlEntities(title),
          url: rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl,
          snippet: decodeHtmlEntities(snippet),
        });
      }
    }
  }

  return results;
}

export function webSearchTool(signal?: AbortSignal) {
  return {
    name: "web_search",
    description:
      "Search the live web for up-to-date documentation, APIs, library releases, technical solutions, and error explanations. Returns top search results with titles, URLs, and summaries.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords or question",
        },
        limit: {
          type: "number",
          description: "Number of search results to return (default 5, max 20)",
        },
      },
      required: ["query"],
    },
    schema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional().default(DEFAULT_SEARCH_LIMIT),
    }),
    async execute(args: { query: string; limit?: number }): Promise<string> {
      const limit = args.limit ?? DEFAULT_SEARCH_LIMIT;
      const query = args.query.trim();

      // Check for Tavily Search API key
      const tavilyKey = process.env.TAVILY_API_KEY;
      if (tavilyKey) {
        try {
          const res = await fetchWithRetry(
            "https://api.tavily.com/search",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ api_key: tavilyKey, query, max_results: limit }),
            },
            { signal }
          );
          if (res.ok) {
            const data: any = await res.json();
            const results = (data.results || []).map((r: any, idx: number) => {
              return `${idx + 1}. [${r.title || "Untitled"}](${r.url})\n   ${r.content || ""}`;
            });
            return results.length > 0
              ? `Found ${results.length} results for "${query}":\n\n${results.join("\n\n")}`
              : `No results found for "${query}".`;
          }
        } catch {
          // Fall through to DuckDuckGo fallback
        }
      }

      // Zero-config DuckDuckGo HTML search fallback
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetchWithRetry(
          url,
          {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,text/plain",
            },
          },
          { signal }
        );

        if (!res.ok) {
          return `Search query failed with HTTP status ${res.status}: ${res.statusText}`;
        }

        const html = await res.text();
        const results = parseDuckDuckGoHtml(html, limit);

        if (results.length === 0) {
          return `No results found for "${query}".`;
        }

        const formatted = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`);
        return `Found ${results.length} results for "${query}":\n\n${formatted.join("\n\n")}`;
      } catch (err) {
        return `Web search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

export function webFetchTool(signal?: AbortSignal) {
  return {
    name: "web_fetch",
    description:
      "Fetch and read web pages, API references, or documentation from an HTTP/HTTPS URL. Converts HTML pages into clean Markdown while stripping scripts and boilerplate.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full HTTP or HTTPS URL to fetch",
        },
        max_length: {
          type: "number",
          description: "Maximum characters to return (default 100,000)",
        },
      },
      required: ["url"],
    },
    schema: z.object({
      url: z.string().url(),
      max_length: z.number().int().min(1000).max(MAX_FETCH_BYTES).optional().default(MAX_FETCH_BYTES),
    }),
    async execute(args: { url: string; max_length?: number }): Promise<string> {
      const maxLength = args.max_length ?? MAX_FETCH_BYTES;

      try {
        const res = await fetchWithRetry(
          args.url,
          {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,text/plain,application/json,text/markdown",
            },
          },
          { signal }
        );

        if (!res.ok) {
          return `Failed to fetch URL (${res.status} ${res.statusText}): ${args.url}`;
        }

        const contentType = res.headers.get("content-type") || "";
        const rawText = await res.text();

        let markdown = "";
        if (contentType.includes("application/json")) {
          try {
            markdown = "```json\n" + JSON.stringify(JSON.parse(rawText), null, 2) + "\n```";
          } catch {
            markdown = rawText;
          }
        } else if (contentType.includes("text/html") || rawText.includes("<html") || rawText.includes("<body")) {
          markdown = htmlToMarkdown(rawText);
        } else {
          markdown = rawText;
        }

        if (!markdown.trim()) {
          return `(Empty content received from ${args.url})`;
        }

        if (markdown.length > maxLength) {
          return markdown.slice(0, maxLength) + `\n\n... [Content truncated at ${maxLength} characters]`;
        }

        return markdown;
      } catch (err) {
        return `Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
