import {
  isRecord,
  ValidationError,
} from "../validation/source-item-parser.js";

export type JsonObject = Readonly<Record<string, unknown>>;

const PROPOSAL_FIELDS = new Set([
  "title",
  "hypothesis",
  "expectedValue",
  "smallestFirstStep",
  "requiredTools",
  "estimatedEffort",
  "risk",
  "successCriteria",
  "verificationMethod",
]);

const COMPLETION_FIELDS = new Set([
  "result",
  "verificationEvidence",
  "learned",
  "nextDecision",
  "hypothesisSupport",
  "reusableKnowledge",
  "nextExperiment",
  "publishableFirstHandExperience",
]);

const DRAFT_EDIT_FIELDS = new Set([
  "hook",
  "body",
  "keyTakeaway",
  "sourceLinks",
]);

function objectBody(value: unknown, field: string): JsonObject {
  if (!isRecord(value)) {
    throw new ValidationError(field, "must be a JSON object");
  }
  return value;
}

function allowedFields(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
): JsonObject {
  const body = objectBody(value, field);
  const unknownField = Object.keys(body).find(
    (key) => !allowed.has(key),
  );
  if (unknownField !== undefined) {
    throw new ValidationError(
      `${field}.${unknownField}`,
      "is not supported",
    );
  }
  return body;
}

export function importBody(value: unknown): JsonObject {
  return allowedFields(value, "request", new Set(["items"]));
}

export function xImportBody(value: unknown): JsonObject {
  return allowedFields(
    value,
    "request",
    new Set(["canonicalUrl", "content", "author", "publishedAt", "sourceExternalId", "title"]),
  );
}

export function proposalBody(value: unknown): JsonObject {
  return allowedFields(value, "request", PROPOSAL_FIELDS);
}

export function completionBody(value: unknown): JsonObject {
  return allowedFields(value, "request", COMPLETION_FIELDS);
}

export function draftGenerationBody(value: unknown): JsonObject {
  return allowedFields(value, "request", new Set(["experimentId"]));
}

export function draftEditBody(value: unknown): JsonObject {
  return allowedFields(value, "request", DRAFT_EDIT_FIELDS);
}

export function reasonBody(value: unknown): JsonObject {
  return allowedFields(value, "request", new Set(["reason"]));
}

export function digestBody(value: unknown): JsonObject {
  return allowedFields(value, "request", new Set(["localDate"]));
}

export function emptyBody(value: unknown): void {
  allowedFields(value, "request", new Set());
}

export function parseListLimit(
  searchParams: URLSearchParams,
  defaultLimit = 50,
): number {
  for (const key of searchParams.keys()) {
    if (key !== "limit") {
      throw new ValidationError(`query.${key}`, "is not supported");
    }
  }
  const limits = searchParams.getAll("limit");
  if (limits.length === 0) return defaultLimit;
  if (limits.length !== 1 || !/^[1-9]\d{0,2}$/u.test(limits[0] ?? "")) {
    throw new ValidationError(
      "query.limit",
      "must be one integer from 1 through 200",
    );
  }
  const limit = Number(limits[0]);
  if (limit > 200) {
    throw new ValidationError(
      "query.limit",
      "must be one integer from 1 through 200",
    );
  }
  return limit;
}

export function rejectSearchParams(searchParams: URLSearchParams): void {
  const first = searchParams.keys().next();
  if (!first.done) {
    throw new ValidationError(
      `query.${first.value}`,
      "is not supported",
    );
  }
}

export function decodePathId(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ValidationError(field, "must use valid URL encoding");
  }
}
