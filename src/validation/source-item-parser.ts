import type { RawSourceItem } from "../collectors/collector.js";
import { SOURCE_TYPES, type SourceType } from "../domain/enums.js";

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(
    readonly field: string,
    reason: string,
  ) {
    super(`Invalid ${field}: ${reason}`);
    this.name = "ValidationError";
  }
}

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(
  value: unknown,
  field: string,
  maximumLength = 20_000,
): string {
  if (typeof value !== "string") {
    throw new ValidationError(field, "must be a string");
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new ValidationError(field, "must not be empty");
  }

  if (normalized.length > maximumLength) {
    throw new ValidationError(
      field,
      `must be at most ${String(maximumLength)} characters`,
    );
  }

  return normalized;
}

export function optionalString(
  value: unknown,
  field: string,
  maximumLength = 20_000,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requiredString(value, field, maximumLength);
}

function sourceType(value: unknown, field: string): SourceType {
  if (
    typeof value !== "string" ||
    !SOURCE_TYPES.includes(value as SourceType)
  ) {
    throw new ValidationError(field, "is not a supported source type");
  }

  return value as SourceType;
}

function optionalUrl(value: unknown, field: string): string | undefined {
  const candidate = optionalString(value, field, 4_096);

  if (candidate === undefined) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ValidationError(field, "must be an absolute URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError(field, "must use http or https");
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new ValidationError(field, "must not contain credentials");
  }

  return parsed.toString();
}

function optionalDateTime(value: unknown, field: string): string | undefined {
  const candidate = optionalString(value, field, 64);

  if (candidate === undefined) {
    return undefined;
  }

  const timestamp = Date.parse(candidate);
  if (Number.isNaN(timestamp)) {
    throw new ValidationError(field, "must be an ISO-compatible date-time");
  }

  return new Date(timestamp).toISOString();
}

export function parseRawSourceItem(
  value: unknown,
  path = "item",
): RawSourceItem {
  if (!isRecord(value)) {
    throw new ValidationError(path, "must be an object");
  }

  const sourceExternalId = optionalString(
    value["sourceExternalId"],
    `${path}.sourceExternalId`,
    512,
  );
  const canonicalUrl = optionalUrl(
    value["canonicalUrl"],
    `${path}.canonicalUrl`,
  );
  const publishedAt = optionalDateTime(
    value["publishedAt"],
    `${path}.publishedAt`,
  );
  const topicUrl = optionalUrl(value["topicUrl"], `${path}.topicUrl`);
  const metadata = jsonRecord(
    value["sourceMetadata"] ?? {},
    `${path}.sourceMetadata`,
  );

  return {
    sourceType: sourceType(value["sourceType"], `${path}.sourceType`),
    ...(sourceExternalId === undefined ? {} : { sourceExternalId }),
    title: requiredString(value["title"], `${path}.title`, 1_000),
    author: requiredString(value["author"], `${path}.author`, 512),
    content: requiredString(value["content"], `${path}.content`, 100_000),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    sourceMetadata: metadata,
    ...(topicUrl === undefined ? {} : { topicUrl }),
  };
}

function jsonValue(value: unknown, field: string, depth: number): unknown {
  if (depth > 8) {
    throw new ValidationError(field, "must not exceed 8 levels");
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new ValidationError(field, "must contain at most 100 items");
    }
    return value.map((item, index) =>
      jsonValue(item, `${field}[${String(index)}]`, depth + 1),
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 100) {
      throw new ValidationError(field, "must contain at most 100 keys");
    }

    return Object.fromEntries(
      entries.map(([key, item]) => [
        key,
        jsonValue(item, `${field}.${key}`, depth + 1),
      ]),
    );
  }

  throw new ValidationError(field, "must contain JSON-compatible values");
}

function jsonRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new ValidationError(field, "must be an object");
  }
  return jsonValue(value, field, 0) as Readonly<
    Record<string, unknown>
  >;
}

export function parseRawSourceItems(
  value: unknown,
): readonly RawSourceItem[] {
  if (!Array.isArray(value)) {
    throw new ValidationError("items", "must be an array");
  }

  if (value.length > 1_000) {
    throw new ValidationError("items", "must contain at most 1000 items");
  }

  return value.map((item, index) =>
    parseRawSourceItem(item, `items[${String(index)}]`),
  );
}
