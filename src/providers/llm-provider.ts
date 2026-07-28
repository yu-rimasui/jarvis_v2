import type { SourceItem } from "../domain/entities.js";

export interface LlmProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  analyze(item: SourceItem): Promise<unknown>;
}
