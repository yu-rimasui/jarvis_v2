import { createHash, randomUUID } from "node:crypto";
import type { RawSourceItem } from "../collectors/collector.js";
import type { SourceItem } from "../domain/entities.js";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
]);

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase("en-US");

  for (const key of [...url.searchParams.keys()]) {
    if (
      TRACKING_PARAMETERS.has(key.toLocaleLowerCase("en-US")) ||
      key.toLocaleLowerCase("en-US").startsWith("utm_")
    ) {
      url.searchParams.delete(key);
    }
  }

  url.searchParams.sort();

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/u, "");
  }

  return url.toString();
}

export function hashContent(content: string): string {
  return createHash("sha256")
    .update(normalizedText(content), "utf8")
    .digest("hex");
}

export interface NormalizationDependencies {
  readonly id?: () => string;
  readonly now?: () => Date;
}

export function normalizeSourceItem(
  raw: RawSourceItem,
  dependencies: NormalizationDependencies = {},
): SourceItem {
  const id = dependencies.id ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  const canonicalUrl =
    raw.canonicalUrl === undefined
      ? undefined
      : normalizeUrl(raw.canonicalUrl);
  const normalizedUrl = canonicalUrl;
  const topicKey =
    raw.topicUrl === undefined ? undefined : normalizeUrl(raw.topicUrl);

  return {
    id: id(),
    sourceType: raw.sourceType,
    ...(raw.sourceExternalId === undefined
      ? {}
      : { sourceExternalId: normalizedText(raw.sourceExternalId) }),
    title: normalizedText(raw.title),
    author: normalizedText(raw.author),
    content: normalizedText(raw.content),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(normalizedUrl === undefined ? {} : { normalizedUrl }),
    contentHash: hashContent(raw.content),
    ...(raw.publishedAt === undefined
      ? {}
      : { publishedAt: new Date(raw.publishedAt).toISOString() }),
    collectedAt: now().toISOString(),
    sourceMetadata: raw.sourceMetadata,
    ...(topicKey === undefined ? {} : { topicKey }),
  };
}
