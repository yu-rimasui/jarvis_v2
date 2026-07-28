import type { DatabaseSync } from "node:sqlite";
import type {
  Analysis,
  ClassifiedClaim,
  EntityId,
  ProcessingRun,
  Ranking,
  SourceItem,
  TopicCluster,
} from "../../domain/entities.js";
import {
  CATEGORIES,
  CLAIM_CLASSES,
  type Category,
  type ClaimClass,
  type ProcessingOperation,
  type ProcessingStatus,
  type SourceType,
} from "../../domain/enums.js";
import type {
  AnalysisRepository,
  InsertResult,
  ProcessingRunRepository,
  SourceItemRepository,
  TopicClusterRepository,
} from "../repositories.js";

type SqlRow = Readonly<Record<string, unknown>>;

function stringValue(row: SqlRow, name: string): string {
  const value = row[name];
  if (typeof value !== "string") {
    throw new TypeError(`Expected string column: ${name}`);
  }
  return value;
}

function optionalStringValue(
  row: SqlRow,
  name: string,
): string | undefined {
  const value = row[name];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Expected nullable string column: ${name}`);
  }
  return value;
}

function numberValue(row: SqlRow, name: string): number {
  const value = row[name];
  if (typeof value !== "number") {
    throw new TypeError(`Expected number column: ${name}`);
  }
  return value;
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`Invalid JSON column: ${name}`);
  }
}

function stringArrayValue(row: SqlRow, name: string): readonly string[] {
  const value = parseJson(stringValue(row, name), name);
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new TypeError(`Expected string array column: ${name}`);
  }
  return value;
}

function categoriesValue(row: SqlRow, name: string): readonly Category[] {
  const values = stringArrayValue(row, name);
  if (
    !values.every((value) => CATEGORIES.includes(value as Category))
  ) {
    throw new TypeError(`Expected category array column: ${name}`);
  }
  return values as readonly Category[];
}

function claimsValue(
  row: SqlRow,
  name: string,
): readonly ClassifiedClaim[] {
  const value = parseJson(stringValue(row, name), name);
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected claim array column: ${name}`);
  }

  return value.map((claim) => {
    if (
      typeof claim !== "object" ||
      claim === null ||
      Array.isArray(claim)
    ) {
      throw new TypeError(`Invalid claim column: ${name}`);
    }

    const record = claim as Readonly<Record<string, unknown>>;
    const kind = record["claimClass"];
    const text = record["text"];
    const sourceUrl = record["sourceUrl"];

    if (
      typeof kind !== "string" ||
      !CLAIM_CLASSES.includes(kind as ClaimClass) ||
      typeof text !== "string" ||
      (sourceUrl !== undefined && typeof sourceUrl !== "string")
    ) {
      throw new TypeError(`Invalid claim column: ${name}`);
    }

    return {
      claimClass: kind as ClaimClass,
      text,
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    };
  });
}

function sourceMetadataValue(
  row: SqlRow,
): Readonly<Record<string, unknown>> {
  const value = parseJson(
    stringValue(row, "source_metadata_json"),
    "source_metadata_json",
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid source_metadata_json");
  }
  return value as Readonly<Record<string, unknown>>;
}

function sourceItemFromRow(row: SqlRow): SourceItem {
  const sourceType = stringValue(row, "source_type") as SourceType;

  return {
    id: stringValue(row, "id"),
    sourceType,
    ...(optionalStringValue(row, "source_external_id") === undefined
      ? {}
      : {
          sourceExternalId: optionalStringValue(
            row,
            "source_external_id",
          ) as string,
        }),
    title: stringValue(row, "title"),
    author: stringValue(row, "author"),
    content: stringValue(row, "content"),
    ...(optionalStringValue(row, "canonical_url") === undefined
      ? {}
      : {
          canonicalUrl: optionalStringValue(
            row,
            "canonical_url",
          ) as string,
        }),
    ...(optionalStringValue(row, "normalized_url") === undefined
      ? {}
      : {
          normalizedUrl: optionalStringValue(
            row,
            "normalized_url",
          ) as string,
        }),
    contentHash: stringValue(row, "content_hash"),
    ...(optionalStringValue(row, "published_at") === undefined
      ? {}
      : {
          publishedAt: optionalStringValue(
            row,
            "published_at",
          ) as string,
        }),
    collectedAt: stringValue(row, "collected_at"),
    sourceMetadata: sourceMetadataValue(row),
    ...(optionalStringValue(row, "topic_key") === undefined
      ? {}
      : { topicKey: optionalStringValue(row, "topic_key") as string }),
  };
}

function analysisFromRow(row: SqlRow): Analysis {
  const primaryCategory = stringValue(
    row,
    "primary_category",
  ) as Category;

  return {
    id: stringValue(row, "analysis_id"),
    sourceItemId: stringValue(row, "source_item_id"),
    summary: stringValue(row, "summary"),
    primaryCategory,
    secondaryCategories: categoriesValue(
      row,
      "secondary_categories_json",
    ),
    confidence: numberValue(row, "confidence"),
    confidenceReason: stringValue(row, "confidence_reason"),
    whyItMatters: stringValue(row, "why_it_matters"),
    workUse: stringValue(row, "work_use"),
    suggestedFirstExperiment: stringValue(
      row,
      "suggested_first_experiment",
    ),
    relatedTechnologies: stringArrayValue(
      row,
      "related_technologies_json",
    ),
    relatedRepositories: stringArrayValue(
      row,
      "related_repositories_json",
    ),
    risksAndLimitations: stringArrayValue(
      row,
      "risks_and_limitations_json",
    ),
    claims: claimsValue(row, "claims_json"),
    providerId: stringValue(row, "provider_id"),
    modelId: stringValue(row, "model_id"),
    promptVersion: stringValue(row, "prompt_version"),
    schemaVersion: stringValue(row, "schema_version"),
    analyzedAt: stringValue(row, "analyzed_at"),
  };
}

function rankingFromRow(row: SqlRow): Ranking {
  return {
    id: stringValue(row, "ranking_id"),
    analysisId: stringValue(row, "analysis_id"),
    relevance: {
      score: numberValue(row, "relevance_score"),
      reason: stringValue(row, "relevance_reason"),
    },
    novelty: {
      score: numberValue(row, "novelty_score"),
      reason: stringValue(row, "novelty_reason"),
    },
    actionability: {
      score: numberValue(row, "actionability_score"),
      reason: stringValue(row, "actionability_reason"),
    },
    authorCredibility: {
      score: numberValue(row, "author_credibility_score"),
      reason: stringValue(row, "author_credibility_reason"),
    },
    overallScore: numberValue(row, "overall_score"),
    rankedAt: stringValue(row, "ranked_at"),
  };
}

function transaction<Result>(
  database: DatabaseSync,
  action: () => Result,
): Result {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = action();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export class DedupeIdentityConflictError extends Error {
  readonly code = "DEDUPE_IDENTITY_CONFLICT";

  constructor() {
    super("Duplicate identity keys point to different source items");
    this.name = "DedupeIdentityConflictError";
  }
}

export class SqliteSourceItemRepository
  implements SourceItemRepository
{
  constructor(private readonly database: DatabaseSync) {}

  private duplicate(
    item: SourceItem,
  ):
    | {
        readonly id: EntityId;
        readonly matchedBy:
          | "source_external_id"
          | "normalized_url"
          | "content_hash";
      }
    | undefined {
    const matches: {
      readonly id: EntityId;
      readonly matchedBy:
        | "source_external_id"
        | "normalized_url"
        | "content_hash";
    }[] = [];

    if (item.sourceExternalId !== undefined) {
      const row = this.database
        .prepare(
          "SELECT id FROM source_items WHERE source_type = ? AND source_external_id = ?",
        )
        .get(item.sourceType, item.sourceExternalId);
      if (row !== undefined) {
        matches.push({
          id: stringValue(row, "id"),
          matchedBy: "source_external_id",
        });
      }
    }

    if (item.normalizedUrl !== undefined) {
      const row = this.database
        .prepare("SELECT id FROM source_items WHERE normalized_url = ?")
        .get(item.normalizedUrl);
      if (row !== undefined) {
        matches.push({
          id: stringValue(row, "id"),
          matchedBy: "normalized_url",
        });
      }
    }

    const row = this.database
      .prepare("SELECT id FROM source_items WHERE content_hash = ?")
      .get(item.contentHash);
    if (row !== undefined) {
      matches.push({
        id: stringValue(row, "id"),
        matchedBy: "content_hash",
      });
    }

    if (new Set(matches.map((match) => match.id)).size > 1) {
      throw new DedupeIdentityConflictError();
    }

    return matches[0];
  }

  async insert(item: SourceItem): Promise<InsertResult> {
    return transaction(this.database, () => {
      const duplicate = this.duplicate(item);
      if (duplicate !== undefined) {
        return { status: "duplicate", ...duplicate };
      }

      try {
        this.database
          .prepare(`
            INSERT INTO source_items (
              id, source_type, source_external_id, title, author, content,
              canonical_url, normalized_url, content_hash, published_at,
              collected_at, source_metadata_json, topic_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            item.id,
            item.sourceType,
            item.sourceExternalId ?? null,
            item.title,
            item.author,
            item.content,
            item.canonicalUrl ?? null,
            item.normalizedUrl ?? null,
            item.contentHash,
            item.publishedAt ?? null,
            item.collectedAt,
            JSON.stringify(item.sourceMetadata),
            item.topicKey ?? null,
          );
      } catch (error) {
        const racedDuplicate = this.duplicate(item);
        if (racedDuplicate !== undefined) {
          return { status: "duplicate", ...racedDuplicate };
        }
        throw error;
      }

      return { status: "inserted", id: item.id };
    });
  }

  async findById(id: EntityId): Promise<SourceItem | undefined> {
    const row = this.database
      .prepare("SELECT * FROM source_items WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : sourceItemFromRow(row);
  }

  async list(limit: number): Promise<readonly SourceItem[]> {
    return this.database
      .prepare(`
        SELECT *
        FROM source_items
        ORDER BY collected_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit)
      .map(sourceItemFromRow);
  }

  async listUnanalyzed(limit: number): Promise<readonly SourceItem[]> {
    const rows = this.database
      .prepare(`
        SELECT source_items.*
        FROM source_items
        LEFT JOIN analyses ON analyses.source_item_id = source_items.id
        WHERE analyses.id IS NULL
        ORDER BY source_items.collected_at, source_items.id
        LIMIT ?
      `)
      .all(limit);
    return rows.map(sourceItemFromRow);
  }
}

export class SqliteTopicClusterRepository
  implements TopicClusterRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async upsert(cluster: TopicCluster): Promise<TopicCluster> {
    this.database
      .prepare(`
        INSERT INTO topic_clusters (id, cluster_key, title, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cluster_key) DO UPDATE SET title = excluded.title
      `)
      .run(cluster.id, cluster.key, cluster.title, cluster.createdAt);

    const row = this.database
      .prepare(
        "SELECT id, cluster_key, title, created_at FROM topic_clusters WHERE cluster_key = ?",
      )
      .get(cluster.key);

    if (row === undefined) {
      throw new Error("Topic cluster upsert failed");
    }

    return {
      id: stringValue(row, "id"),
      key: stringValue(row, "cluster_key"),
      title: stringValue(row, "title"),
      createdAt: stringValue(row, "created_at"),
    };
  }

  async addItem(
    clusterId: EntityId,
    sourceItemId: EntityId,
  ): Promise<void> {
    this.database
      .prepare(`
        INSERT OR IGNORE INTO topic_cluster_items (cluster_id, source_item_id)
        VALUES (?, ?)
      `)
      .run(clusterId, sourceItemId);
  }

  async listItems(clusterId: EntityId): Promise<readonly SourceItem[]> {
    const rows = this.database
      .prepare(`
        SELECT source_items.*
        FROM source_items
        INNER JOIN topic_cluster_items
          ON topic_cluster_items.source_item_id = source_items.id
        WHERE topic_cluster_items.cluster_id = ?
        ORDER BY source_items.collected_at, source_items.id
      `)
      .all(clusterId);
    return rows.map(sourceItemFromRow);
  }
}

const ANALYSIS_SELECT = `
  SELECT
    analyses.id AS analysis_id,
    analyses.source_item_id,
    analyses.summary,
    analyses.primary_category,
    analyses.secondary_categories_json,
    analyses.confidence,
    analyses.confidence_reason,
    analyses.why_it_matters,
    analyses.work_use,
    analyses.suggested_first_experiment,
    analyses.related_technologies_json,
    analyses.related_repositories_json,
    analyses.risks_and_limitations_json,
    analyses.claims_json,
    analyses.provider_id,
    analyses.model_id,
    analyses.prompt_version,
    analyses.schema_version,
    analyses.analyzed_at,
    rankings.id AS ranking_id,
    rankings.relevance_score,
    rankings.relevance_reason,
    rankings.novelty_score,
    rankings.novelty_reason,
    rankings.actionability_score,
    rankings.actionability_reason,
    rankings.author_credibility_score,
    rankings.author_credibility_reason,
    rankings.overall_score,
    rankings.ranked_at
  FROM analyses
  INNER JOIN rankings ON rankings.analysis_id = analyses.id
`;

export class SqliteAnalysisRepository implements AnalysisRepository {
  constructor(private readonly database: DatabaseSync) {}

  async claimForProcessing(
    sourceItemId: EntityId,
    ownerRunId: EntityId,
    claimToken: EntityId,
    claimedAt: string,
    expiresAt: string,
  ): Promise<"claimed" | "already_analyzed" | "busy"> {
    return transaction(this.database, () => {
      const analysis = this.database
        .prepare("SELECT id FROM analyses WHERE source_item_id = ?")
        .get(sourceItemId);
      if (analysis !== undefined) return "already_analyzed";

      const existingClaim = this.database
        .prepare(`
          SELECT claim_token, expires_at
          FROM analysis_claims
          WHERE source_item_id = ?
        `)
        .get(sourceItemId);

      if (existingClaim !== undefined) {
        const existingToken = stringValue(existingClaim, "claim_token");
        const existingExpiry = stringValue(existingClaim, "expires_at");
        if (
          existingToken !== claimToken &&
          existingExpiry > claimedAt
        ) {
          return "busy";
        }
      }

      this.database
        .prepare(`
          INSERT INTO analysis_claims (
            source_item_id, owner_run_id, claim_token, claimed_at, expires_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(source_item_id) DO UPDATE SET
            owner_run_id = excluded.owner_run_id,
            claim_token = excluded.claim_token,
            claimed_at = excluded.claimed_at,
            expires_at = excluded.expires_at
        `)
        .run(
          sourceItemId,
          ownerRunId,
          claimToken,
          claimedAt,
          expiresAt,
        );

      return "claimed";
    });
  }

  async releaseProcessingClaim(
    sourceItemId: EntityId,
    ownerRunId: EntityId,
    claimToken: EntityId,
  ): Promise<void> {
    this.database
      .prepare(`
        DELETE FROM analysis_claims
        WHERE source_item_id = ?
          AND owner_run_id = ?
          AND claim_token = ?
      `)
      .run(sourceItemId, ownerRunId, claimToken);
  }

  async saveClaimed(
    analysis: Analysis,
    ranking: Ranking,
    ownerRunId: EntityId,
    claimToken: EntityId,
  ): Promise<"saved" | "already_analyzed" | "claim_lost"> {
    if (ranking.analysisId !== analysis.id) {
      throw new TypeError("Ranking must belong to the analysis");
    }

    return transaction(this.database, () => {
      const existingAnalysis = this.database
        .prepare("SELECT id FROM analyses WHERE source_item_id = ?")
        .get(analysis.sourceItemId);
      if (existingAnalysis !== undefined) {
        return "already_analyzed";
      }

      const claim = this.database
        .prepare(`
          SELECT owner_run_id, claim_token
          FROM analysis_claims
          WHERE source_item_id = ?
        `)
        .get(analysis.sourceItemId);
      if (
        claim === undefined ||
        stringValue(claim, "owner_run_id") !== ownerRunId ||
        stringValue(claim, "claim_token") !== claimToken
      ) {
        return "claim_lost";
      }

      this.database
        .prepare(`
          INSERT INTO analyses (
            id, source_item_id, summary, primary_category,
            secondary_categories_json, confidence, confidence_reason,
            why_it_matters, work_use, suggested_first_experiment,
            related_technologies_json, related_repositories_json,
            risks_and_limitations_json, claims_json, provider_id, model_id,
            prompt_version, schema_version, analyzed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          analysis.id,
          analysis.sourceItemId,
          analysis.summary,
          analysis.primaryCategory,
          JSON.stringify(analysis.secondaryCategories),
          analysis.confidence,
          analysis.confidenceReason,
          analysis.whyItMatters,
          analysis.workUse,
          analysis.suggestedFirstExperiment,
          JSON.stringify(analysis.relatedTechnologies),
          JSON.stringify(analysis.relatedRepositories),
          JSON.stringify(analysis.risksAndLimitations),
          JSON.stringify(analysis.claims),
          analysis.providerId,
          analysis.modelId,
          analysis.promptVersion,
          analysis.schemaVersion,
          analysis.analyzedAt,
        );
      this.database
        .prepare(`
          INSERT INTO rankings (
            id, analysis_id, relevance_score, relevance_reason,
            novelty_score, novelty_reason, actionability_score,
            actionability_reason, author_credibility_score,
            author_credibility_reason, overall_score, ranked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          ranking.id,
          ranking.analysisId,
          ranking.relevance.score,
          ranking.relevance.reason,
          ranking.novelty.score,
          ranking.novelty.reason,
          ranking.actionability.score,
          ranking.actionability.reason,
          ranking.authorCredibility.score,
          ranking.authorCredibility.reason,
          ranking.overallScore,
          ranking.rankedAt,
        );

      const deletedClaim = this.database
        .prepare(`
          DELETE FROM analysis_claims
          WHERE source_item_id = ?
            AND owner_run_id = ?
            AND claim_token = ?
        `)
        .run(analysis.sourceItemId, ownerRunId, claimToken);
      if (deletedClaim.changes !== 1) {
        throw new Error("Analysis claim could not be finalized");
      }

      return "saved";
    });
  }

  async findById(id: EntityId): Promise<Analysis | undefined> {
    const row = this.database
      .prepare(`${ANALYSIS_SELECT} WHERE analyses.id = ?`)
      .get(id);
    return row === undefined ? undefined : analysisFromRow(row);
  }

  async findBySourceItemId(
    sourceItemId: EntityId,
  ): Promise<Analysis | undefined> {
    const row = this.database
      .prepare(`${ANALYSIS_SELECT} WHERE analyses.source_item_id = ?`)
      .get(sourceItemId);
    return row === undefined ? undefined : analysisFromRow(row);
  }

  async findRankedById(
    id: EntityId,
  ): Promise<
    | { readonly analysis: Analysis; readonly ranking: Ranking }
    | undefined
  > {
    const row = this.database
      .prepare(`${ANALYSIS_SELECT} WHERE analyses.id = ?`)
      .get(id);
    return row === undefined
      ? undefined
      : {
          analysis: analysisFromRow(row),
          ranking: rankingFromRow(row),
        };
  }

  async listRanked(
    limit: number,
  ): Promise<
    readonly { readonly analysis: Analysis; readonly ranking: Ranking }[]
  > {
    const rows = this.database
      .prepare(`
        ${ANALYSIS_SELECT}
        ORDER BY rankings.overall_score DESC, rankings.ranked_at DESC
        LIMIT ?
      `)
      .all(limit);

    return rows.map((row) => ({
      analysis: analysisFromRow(row),
      ranking: rankingFromRow(row),
    }));
  }
}

export class SqliteProcessingRunRepository
  implements ProcessingRunRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async save(run: ProcessingRun): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO processing_runs (
          id, operation, source_or_provider, status, received_count,
          inserted_count, duplicate_count, processed_count, failed_count,
          retry_count, error_code, error_kind, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          received_count = excluded.received_count,
          inserted_count = excluded.inserted_count,
          duplicate_count = excluded.duplicate_count,
          processed_count = excluded.processed_count,
          failed_count = excluded.failed_count,
          retry_count = excluded.retry_count,
          error_code = excluded.error_code,
          error_kind = excluded.error_kind,
          finished_at = excluded.finished_at
      `)
      .run(
        run.id,
        run.operation,
        run.sourceOrProvider,
        run.status,
        run.receivedCount,
        run.insertedCount,
        run.duplicateCount,
        run.processedCount,
        run.failedCount,
        run.retryCount,
        run.errorCode ?? null,
        run.errorKind ?? null,
        run.startedAt,
        run.finishedAt ?? null,
      );
  }

  async findById(id: EntityId): Promise<ProcessingRun | undefined> {
    const row = this.database
      .prepare("SELECT * FROM processing_runs WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : this.fromRow(row);
  }

  async list(limit: number): Promise<readonly ProcessingRun[]> {
    return this.database
      .prepare(
        "SELECT * FROM processing_runs ORDER BY started_at DESC, id DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => this.fromRow(row));
  }

  private fromRow(row: SqlRow): ProcessingRun {
    return {
      id: stringValue(row, "id"),
      operation: stringValue(
        row,
        "operation",
      ) as ProcessingOperation,
      sourceOrProvider: stringValue(row, "source_or_provider"),
      status: stringValue(row, "status") as ProcessingStatus,
      receivedCount: numberValue(row, "received_count"),
      insertedCount: numberValue(row, "inserted_count"),
      duplicateCount: numberValue(row, "duplicate_count"),
      processedCount: numberValue(row, "processed_count"),
      failedCount: numberValue(row, "failed_count"),
      retryCount: numberValue(row, "retry_count"),
      ...(optionalStringValue(row, "error_code") === undefined
        ? {}
        : { errorCode: optionalStringValue(row, "error_code") as string }),
      ...(optionalStringValue(row, "error_kind") === undefined
        ? {}
        : { errorKind: optionalStringValue(row, "error_kind") as string }),
      startedAt: stringValue(row, "started_at"),
      ...(optionalStringValue(row, "finished_at") === undefined
        ? {}
        : {
            finishedAt: optionalStringValue(
              row,
              "finished_at",
            ) as string,
          }),
    };
  }
}
