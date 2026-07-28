import { createHash } from "node:crypto";
import type {
  Analysis,
  SourceItem,
  TopicCluster,
} from "../domain/entities.js";
import { normalizeUrl } from "./normalization.js";

function clusterKey(
  item: SourceItem,
  analysis: Analysis,
): string | undefined {
  const repository = analysis.relatedRepositories[0];

  if (repository !== undefined) {
    return normalizeUrl(repository);
  }

  return item.topicKey;
}

export function createTopicCluster(
  item: SourceItem,
  analysis: Analysis,
  now: () => Date = () => new Date(),
): TopicCluster | undefined {
  const key = clusterKey(item, analysis);

  if (key === undefined) {
    return undefined;
  }

  const digest = createHash("sha256").update(key, "utf8").digest("hex");

  return {
    id: `topic_${digest.slice(0, 24)}`,
    key,
    title: analysis.relatedTechnologies[0] ?? analysis.primaryCategory,
    createdAt: now().toISOString(),
  };
}
