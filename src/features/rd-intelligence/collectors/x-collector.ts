import {
  CollectorNotConfiguredError,
  type Collector,
  type CollectorResult,
} from "./collector.js";

export interface XListTimelineConfiguration {
  readonly listId: string;
}

export class XListTimelineCollector implements Collector {
  readonly sourceName = "x-list-timeline";

  constructor(readonly configuration: XListTimelineConfiguration) {}

  async collect(): Promise<CollectorResult> {
    throw new CollectorNotConfiguredError(this.sourceName);
  }
}
