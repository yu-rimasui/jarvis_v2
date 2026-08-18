import { XMLParser } from "fast-xml-parser";
import type { SourceType } from "../domain/enums.js";
import type {
  Collector,
  CollectorResult,
  RawSourceItem,
} from "./collector.js";

const FEED_HOSTS = new Set(["zenn.dev", "qiita.com"]);
const REQUEST_TIMEOUT_MS = 10_000;

export interface RssFeedDefinition {
  readonly name: string;
  readonly sourceType: Extract<SourceType, "zenn" | "qiita">;
  readonly url: string;
}

export const DEFAULT_RSS_FEEDS: readonly RssFeedDefinition[] = [
  {
    name: "zenn-ai",
    sourceType: "zenn",
    url: "https://zenn.dev/topics/ai/feed",
  },
  {
    name: "zenn-llm",
    sourceType: "zenn",
    url: "https://zenn.dev/topics/llm/feed",
  },
  {
    name: "qiita-ai",
    sourceType: "qiita",
    url: "https://qiita.com/tags/AI/feed.atom",
  },
  {
    name: "qiita-llm",
    sourceType: "qiita",
    url: "https://qiita.com/tags/LLM/feed.atom",
  },
];

export class RssCollectorError extends Error {
  readonly code = "RSS_COLLECTOR_FAILED";

  constructor(readonly feedName: string) {
    super(`RSS collection failed for ${feedName}`);
    this.name = "RssCollectorError";
  }
}

type RecordValue = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function values(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized === "" ? undefined : normalized;
  }
  if (!isRecord(value)) return undefined;
  return text(value["#text"] ?? value["__cdata"] ?? value["name"]);
}

function firstText(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    const found = text(candidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function safeUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (candidate === undefined) return undefined;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    if (parsed.username !== "" || parsed.password !== "") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function atomLink(value: unknown): string | undefined {
  for (const candidate of values(value)) {
    if (isRecord(candidate)) {
      const relation = text(candidate["@_rel"]);
      if (relation !== undefined && relation !== "alternate") continue;
      const href = safeUrl(candidate["@_href"]);
      if (href !== undefined) return href;
    }
    const direct = safeUrl(candidate);
    if (direct !== undefined) return direct;
  }
  return undefined;
}

function isoDate(value: unknown): string | undefined {
  const candidate = text(value);
  if (candidate === undefined) return undefined;
  const timestamp = Date.parse(candidate);
  return Number.isNaN(timestamp)
    ? undefined
    : new Date(timestamp).toISOString();
}

function validateFeedUrl(value: string): URL {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !FEED_HOSTS.has(parsed.hostname.toLocaleLowerCase("en-US"))
  ) {
    throw new TypeError("RSS feed URL is outside the configured allowlist");
  }
  return parsed;
}

function parseItems(
  documentValue: unknown,
  definition: RssFeedDefinition,
  cutoff: Date,
  limit: number,
): readonly RawSourceItem[] {
  if (!isRecord(documentValue)) throw new TypeError("Invalid feed document");
  const rssChannel = isRecord(documentValue["rss"])
    ? documentValue["rss"]["channel"]
    : undefined;
  const feed = documentValue["feed"];
  const container = isRecord(rssChannel)
    ? rssChannel
    : isRecord(feed)
      ? feed
      : undefined;
  if (container === undefined) throw new TypeError("Unsupported feed format");
  const entries = values(container["item"] ?? container["entry"]);
  const feedAuthor = firstText(container["title"], definition.name) ?? definition.name;
  const parsed: RawSourceItem[] = [];

  for (const entryValue of entries) {
    if (!isRecord(entryValue)) continue;
    const canonicalUrl =
      safeUrl(entryValue["link"]) ?? atomLink(entryValue["link"]);
    const publishedAt = isoDate(
      entryValue["pubDate"] ??
        entryValue["published"] ??
        entryValue["updated"],
    );
    if (
      publishedAt !== undefined &&
      Date.parse(publishedAt) < cutoff.getTime()
    ) {
      continue;
    }
    const title = firstText(entryValue["title"]);
    const rawContent = firstText(
      entryValue["description"],
      entryValue["summary"],
      entryValue["content"],
      entryValue["content:encoded"],
    );
    if (title === undefined || rawContent === undefined) continue;
    const content = stripMarkup(rawContent);
    if (content === "") continue;
    const sourceExternalId = firstText(
      entryValue["guid"],
      entryValue["id"],
      canonicalUrl,
    );
    const author = firstText(
      entryValue["dc:creator"],
      entryValue["author"],
      feedAuthor,
    ) as string;

    parsed.push({
      sourceType: definition.sourceType,
      ...(sourceExternalId === undefined ? {} : { sourceExternalId }),
      title,
      author,
      content,
      ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      sourceMetadata: {
        feedName: definition.name,
        feedUrl: definition.url,
      },
      topicUrl: definition.url,
    });
    if (parsed.length >= limit) break;
  }
  return parsed;
}

export interface RssFeedCollectorOptions {
  readonly definition: RssFeedDefinition;
  readonly cutoff: Date;
  readonly limit?: number;
  readonly fetchImplementation?: typeof fetch;
}

export class RssFeedCollector implements Collector {
  readonly sourceName: string;
  private readonly definition: RssFeedDefinition;
  private readonly cutoff: Date;
  private readonly limit: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: RssFeedCollectorOptions) {
    validateFeedUrl(options.definition.url);
    this.definition = options.definition;
    this.sourceName = `rss:${options.definition.name}`;
    this.cutoff = options.cutoff;
    this.limit = options.limit ?? 10;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 50) {
      throw new RangeError("RSS feed limit must be from 1 to 50");
    }
  }

  async collect(): Promise<CollectorResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImplementation(this.definition.url, {
        headers: {
          accept: "application/atom+xml, application/rss+xml, application/xml, text/xml",
          "user-agent": "Jarvis-RD-Intelligence/0.1",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      const finalUrl = validateFeedUrl(response.url || this.definition.url);
      if (!FEED_HOSTS.has(finalUrl.hostname.toLocaleLowerCase("en-US"))) {
        throw new TypeError("RSS redirect left the configured allowlist");
      }
      if (!response.ok) throw new Error(`RSS HTTP ${String(response.status)}`);
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > 2_000_000) {
        throw new RangeError("RSS response exceeds 2 MB");
      }
      const parser = new XMLParser({
        ignoreAttributes: false,
        processEntities: false,
        trimValues: true,
      });
      return {
        items: parseItems(
          parser.parse(body) as unknown,
          this.definition,
          this.cutoff,
          this.limit,
        ),
      };
    } catch {
      throw new RssCollectorError(this.definition.name);
    } finally {
      clearTimeout(timeout);
    }
  }
}
