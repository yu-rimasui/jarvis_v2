import type { DatabaseSync } from "node:sqlite";
import type { DailyDigest } from "../../domain/entities.js";
import type {
  DailyDigestQuery,
  DailyDigestRepository,
} from "../repositories.js";

type SqlRow = Readonly<Record<string, unknown>>;

function ids(rows: readonly SqlRow[], column: string): readonly string[] {
  return rows.map((row) => {
    const value = row[column];
    if (typeof value !== "string") {
      throw new TypeError(`Expected string column: ${column}`);
    }
    return value;
  });
}

function count(row: SqlRow | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value !== "number") {
    throw new TypeError(`Expected count column: ${column}`);
  }
  return value;
}

export class SqliteDailyDigestRepository
  implements DailyDigestRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async generate(query: DailyDigestQuery): Promise<DailyDigest> {
    if (
      !Number.isInteger(query.topInsightLimit) ||
      query.topInsightLimit < 1 ||
      query.topInsightLimit > 100 ||
      !Number.isFinite(query.lowConfidenceThreshold) ||
      query.lowConfidenceThreshold < 0 ||
      query.lowConfidenceThreshold > 1
    ) {
      throw new RangeError("Invalid daily digest query limits");
    }

    const topInsightIds = ids(
      this.database
        .prepare(`
          SELECT analyses.id AS id
          FROM analyses
          INNER JOIN rankings ON rankings.analysis_id = analyses.id
          WHERE analyses.analyzed_at >= ? AND analyses.analyzed_at < ?
            AND analyses.confidence >= ?
          ORDER BY rankings.overall_score DESC, rankings.ranked_at DESC
          LIMIT ?
        `)
        .all(
          query.startAt,
          query.endAt,
          query.lowConfidenceThreshold,
          query.topInsightLimit,
        ),
      "id",
    );
    const proposedExperimentIds = ids(
      this.database
        .prepare(`
          SELECT id
          FROM experiments
          WHERE status = 'proposed'
            AND created_at >= ? AND created_at < ?
          ORDER BY created_at DESC, id DESC
        `)
        .all(query.startAt, query.endAt),
      "id",
    );
    const activeExperimentIds = ids(
      this.database
        .prepare(`
          SELECT id
          FROM experiments
          WHERE status IN ('approved', 'in_progress', 'blocked')
          ORDER BY updated_at DESC, id DESC
        `)
        .all(),
      "id",
    );
    const previousDayCompletedExperimentIds = ids(
      this.database
        .prepare(`
          SELECT id
          FROM experiments
          WHERE status = 'completed'
            AND updated_at >= ? AND updated_at < ?
          ORDER BY updated_at DESC, id DESC
        `)
        .all(query.previousDayStartAt, query.startAt),
      "id",
    );
    const draftCandidateIds = ids(
      this.database
        .prepare(`
          SELECT id
          FROM content_drafts
          WHERE status IN ('draft', 'needs_review')
          ORDER BY updated_at DESC, id DESC
        `)
        .all(),
      "id",
    );
    const duplicateCount = count(
      this.database
        .prepare(`
          SELECT COALESCE(SUM(duplicate_count), 0) AS count
          FROM processing_runs
          WHERE operation = 'collect'
            AND started_at >= ? AND started_at < ?
        `)
        .get(query.startAt, query.endAt),
      "count",
    );
    const lowConfidenceCount = count(
      this.database
        .prepare(`
          SELECT COUNT(*) AS count
          FROM analyses
          WHERE analyzed_at >= ? AND analyzed_at < ?
            AND confidence < ?
        `)
        .get(
          query.startAt,
          query.endAt,
          query.lowConfidenceThreshold,
        ),
      "count",
    );
    const processingFailureCount = count(
      this.database
        .prepare(`
          SELECT COUNT(*) AS count
          FROM processing_runs
          WHERE status = 'failed'
            AND operation IN ('collect', 'analyze', 'rank')
            AND started_at >= ? AND started_at < ?
        `)
        .get(query.startAt, query.endAt),
      "count",
    );

    return {
      localDate: query.localDate,
      timeZone: "Asia/Tokyo",
      topInsightIds,
      proposedExperimentIds,
      activeExperimentIds,
      previousDayCompletedExperimentIds,
      draftCandidateIds,
      duplicateCount,
      lowConfidenceCount,
      processingFailureCount,
      generatedAt: query.generatedAt,
    };
  }
}
