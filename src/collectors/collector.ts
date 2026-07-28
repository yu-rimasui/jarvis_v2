import type { SourceType } from "../domain/enums.js";

export interface RawSourceItem {
  readonly sourceType: SourceType;
  readonly sourceExternalId?: string;
  readonly title: string;
  readonly author: string;
  readonly content: string;
  readonly canonicalUrl?: string;
  readonly publishedAt?: string;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly topicUrl?: string;
}

export interface CollectorResult {
  readonly items: readonly RawSourceItem[];
  readonly nextCursor?: string;
}

export interface Collector {
  readonly sourceName: string;
  collect(cursor?: string): Promise<CollectorResult>;
}

export class CollectorNotConfiguredError extends Error {
  readonly code = "COLLECTOR_NOT_CONFIGURED";

  constructor(collectorName: string) {
    super(`${collectorName} is not configured`);
    this.name = "CollectorNotConfiguredError";
  }
}
