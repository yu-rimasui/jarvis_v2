import { randomUUID } from "node:crypto";
import type {
  EntityId,
  Ranking,
  ScoreComponent,
} from "./entities.js";

export interface RankingComponents {
  readonly relevance: ScoreComponent;
  readonly novelty: ScoreComponent;
  readonly actionability: ScoreComponent;
  readonly authorCredibility: ScoreComponent;
}

function assertComponent(name: string, component: ScoreComponent): void {
  if (
    !Number.isFinite(component.score) ||
    component.score < 0 ||
    component.score > 5
  ) {
    throw new RangeError(`${name} score must be between 0 and 5`);
  }

  if (component.reason.trim().length === 0) {
    throw new TypeError(`${name} reason must not be empty`);
  }
}

export function overallScore(components: RankingComponents): number {
  assertComponent("relevance", components.relevance);
  assertComponent("novelty", components.novelty);
  assertComponent("actionability", components.actionability);
  assertComponent("authorCredibility", components.authorCredibility);

  const weighted =
    components.relevance.score * 0.35 +
    components.novelty.score * 0.25 +
    components.actionability.score * 0.25 +
    components.authorCredibility.score * 0.15;

  return Math.round((weighted / 5) * 100);
}

export interface CreateRankingDependencies {
  readonly id?: () => EntityId;
  readonly now?: () => Date;
}

export function createRanking(
  analysisId: EntityId,
  components: RankingComponents,
  dependencies: CreateRankingDependencies = {},
): Ranking {
  const id = dependencies.id ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
    id: id(),
    analysisId,
    ...components,
    overallScore: overallScore(components),
    rankedAt: now().toISOString(),
  };
}
