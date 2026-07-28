import { readFile } from "node:fs/promises";
import { parseRawSourceItems } from "../validation/source-item-parser.js";
import type { Collector, CollectorResult } from "./collector.js";

export class FixtureCollector implements Collector {
  readonly sourceName = "fixture";

  constructor(private readonly fixturePath: string) {}

  async collect(): Promise<CollectorResult> {
    const contents = await readFile(this.fixturePath, "utf8");
    const parsed: unknown = JSON.parse(contents);

    return { items: parseRawSourceItems(parsed) };
  }
}
