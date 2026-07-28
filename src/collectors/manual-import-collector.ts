import { parseRawSourceItems } from "../validation/source-item-parser.js";
import type { Collector, CollectorResult } from "./collector.js";

export class ManualImportCollector implements Collector {
  readonly sourceName = "manual-import";

  constructor(private readonly input: unknown) {}

  async collect(): Promise<CollectorResult> {
    return { items: parseRawSourceItems(this.input) };
  }
}
