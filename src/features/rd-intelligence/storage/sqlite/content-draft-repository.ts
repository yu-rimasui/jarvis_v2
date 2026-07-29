import type { DatabaseSync } from "node:sqlite";
import type {
  ContentDraft,
  ContentDraftEvent,
  ContentEvidence,
  ContentEvidenceKind,
  EntityId,
} from "../../domain/entities.js";
import {
  DRAFT_STATUSES,
  type DraftStatus,
} from "../../domain/enums.js";
import type { ContentDraftRepository } from "../repositories.js";

type SqlRow = Readonly<Record<string, unknown>>;

const CONTENT_EVIDENCE_KINDS: readonly ContentEvidenceKind[] = [
  "SOURCE",
  "INTERPRETATION",
  "EXPERIENCE",
  "EXPERIMENT_RESULT",
  "HYPOTHESIS",
];

function stringValue(row: SqlRow, name: string): string {
  const value = row[name];
  if (typeof value !== "string") {
    throw new TypeError(`Expected string column: ${name}`);
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

function draftStatusValue(row: SqlRow, name: string): DraftStatus {
  const value = stringValue(row, name);
  if (!DRAFT_STATUSES.includes(value as DraftStatus)) {
    throw new TypeError(`Invalid draft status column: ${name}`);
  }
  return value as DraftStatus;
}

function provenanceValue(row: SqlRow): readonly ContentEvidence[] {
  const value = parseJson(
    stringValue(row, "provenance_json"),
    "provenance_json",
  );
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid provenance_json");
  }
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item)
    ) {
      throw new TypeError("Invalid provenance_json item");
    }
    const record = item as Readonly<Record<string, unknown>>;
    const kind = record["kind"];
    const text = record["text"];
    const sourceUrl = record["sourceUrl"];
    if (
      typeof kind !== "string" ||
      !CONTENT_EVIDENCE_KINDS.includes(kind as ContentEvidenceKind) ||
      typeof text !== "string" ||
      (sourceUrl !== undefined && typeof sourceUrl !== "string")
    ) {
      throw new TypeError("Invalid provenance_json item");
    }
    return {
      kind: kind as ContentEvidenceKind,
      text,
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    };
  });
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

function draftFromRow(row: SqlRow): ContentDraft {
  const relatedExperimentId = optionalStringValue(
    row,
    "related_experiment_id",
  );
  const evidenceScope = stringValue(row, "evidence_scope");
  if (
    evidenceScope !== "source_only" &&
    evidenceScope !== "completed_experiment"
  ) {
    throw new TypeError("Invalid content draft evidence scope");
  }
  const platform = stringValue(row, "platform");
  if (platform !== "x" && platform !== "instagram") {
    throw new TypeError("Invalid content draft platform");
  }

  return {
    id: stringValue(row, "id"),
    platform,
    relatedAnalysisId: stringValue(row, "related_analysis_id"),
    ...(relatedExperimentId === undefined
      ? {}
      : { relatedExperimentId }),
    hook: stringValue(row, "hook"),
    body: stringValue(row, "body"),
    keyTakeaway: stringValue(row, "key_takeaway"),
    sourceLinks: stringArrayValue(row, "source_links_json"),
    characterCount: numberValue(row, "character_count"),
    status: draftStatusValue(row, "status"),
    evidenceScope,
    provenance: provenanceValue(row),
    providerId: stringValue(row, "provider_id"),
    modelId: stringValue(row, "model_id"),
    promptVersion: stringValue(row, "prompt_version"),
    generatedAt: stringValue(row, "generated_at"),
    updatedAt: stringValue(row, "updated_at"),
  };
}

function eventFromRow(row: SqlRow): ContentDraftEvent {
  const fromStatusRaw = optionalStringValue(row, "from_status");
  const reason = optionalStringValue(row, "reason");
  let fromStatus: DraftStatus | undefined;
  if (fromStatusRaw !== undefined) {
    if (!DRAFT_STATUSES.includes(fromStatusRaw as DraftStatus)) {
      throw new TypeError("Invalid content draft event from_status");
    }
    fromStatus = fromStatusRaw as DraftStatus;
  }
  return {
    id: stringValue(row, "id"),
    contentDraftId: stringValue(row, "content_draft_id"),
    ...(fromStatus === undefined ? {} : { fromStatus }),
    toStatus: draftStatusValue(row, "to_status"),
    ...(reason === undefined ? {} : { reason }),
    createdAt: stringValue(row, "created_at"),
  };
}

function assertEvent(
  draft: ContentDraft,
  event: ContentDraftEvent,
): void {
  if (
    event.contentDraftId !== draft.id ||
    event.toStatus !== draft.status ||
    event.createdAt !== draft.updatedAt
  ) {
    throw new TypeError("Content draft event does not match draft");
  }
}

function insertEvent(
  database: DatabaseSync,
  event: ContentDraftEvent,
): void {
  database
    .prepare(`
      INSERT INTO content_draft_events (
        id, content_draft_id, from_status, to_status, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      event.id,
      event.contentDraftId,
      event.fromStatus ?? null,
      event.toStatus,
      event.reason ?? null,
      event.createdAt,
    );
}

export class SqliteContentDraftRepository
  implements ContentDraftRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async create(
    draft: ContentDraft,
    event: ContentDraftEvent,
  ): Promise<void> {
    if (draft.status !== "draft" || event.fromStatus !== undefined) {
      throw new TypeError("New content drafts must start as draft");
    }
    assertEvent(draft, event);

    transaction(this.database, () => {
      this.database
        .prepare(`
          INSERT INTO content_drafts (
            id, platform, related_analysis_id, related_experiment_id,
            hook, body, key_takeaway, source_links_json, character_count,
            status, provider_id, model_id, prompt_version, generated_at,
            updated_at, evidence_scope, provenance_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          draft.id,
          draft.platform,
          draft.relatedAnalysisId,
          draft.relatedExperimentId ?? null,
          draft.hook,
          draft.body,
          draft.keyTakeaway,
          JSON.stringify(draft.sourceLinks),
          draft.characterCount,
          draft.status,
          draft.providerId,
          draft.modelId,
          draft.promptVersion,
          draft.generatedAt,
          draft.updatedAt,
          draft.evidenceScope,
          JSON.stringify(draft.provenance),
        );
      insertEvent(this.database, event);
    });
  }

  async update(
    draft: ContentDraft,
    expectedUpdatedAt: string,
    event: ContentDraftEvent,
  ): Promise<boolean> {
    if (event.fromStatus === undefined) {
      throw new TypeError("Draft update requires a source status");
    }
    const fromStatus = event.fromStatus;
    assertEvent(draft, event);

    return transaction(this.database, () => {
      const result = this.database
        .prepare(`
          UPDATE content_drafts
          SET hook = ?,
              body = ?,
              key_takeaway = ?,
              source_links_json = ?,
              character_count = ?,
              status = ?,
              evidence_scope = ?,
              provenance_json = ?,
              updated_at = ?
          WHERE id = ? AND status = ? AND updated_at = ?
        `)
        .run(
          draft.hook,
          draft.body,
          draft.keyTakeaway,
          JSON.stringify(draft.sourceLinks),
          draft.characterCount,
          draft.status,
          draft.evidenceScope,
          JSON.stringify(draft.provenance),
          draft.updatedAt,
          draft.id,
          fromStatus,
          expectedUpdatedAt,
        );
      if (result.changes !== 1) return false;
      insertEvent(this.database, event);
      return true;
    });
  }

  async findById(id: EntityId): Promise<ContentDraft | undefined> {
    const row = this.database
      .prepare("SELECT * FROM content_drafts WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : draftFromRow(row);
  }

  async list(): Promise<readonly ContentDraft[]> {
    return this.database
      .prepare(
        "SELECT * FROM content_drafts ORDER BY updated_at DESC, id DESC",
      )
      .all()
      .map(draftFromRow);
  }

  async listEvents(
    draftId: EntityId,
  ): Promise<readonly ContentDraftEvent[]> {
    return this.database
      .prepare(`
        SELECT *
        FROM content_draft_events
        WHERE content_draft_id = ?
        ORDER BY created_at, id
      `)
      .all(draftId)
      .map(eventFromRow);
  }
}
