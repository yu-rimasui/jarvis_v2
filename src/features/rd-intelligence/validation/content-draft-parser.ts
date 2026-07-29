import {
  isRecord,
  requiredString,
  ValidationError,
} from "./source-item-parser.js";

export interface EditContentDraftInput {
  readonly hook: string;
  readonly body: string;
  readonly keyTakeaway: string;
  readonly sourceLinks: readonly string[];
}

export function parseContentDraftId(value: unknown): string {
  return requiredString(value, "draftId", 512);
}

export function parseOptionalExperimentId(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, "experimentId", 512);
}

export function parseDraftReviewReason(
  value: unknown,
  field = "reviewReason",
): string {
  return requiredString(value, field, 4_000);
}

function sourceLinks(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new ValidationError(
      field,
      "must be an array with at most 20 items",
    );
  }

  return [
    ...new Set(
      value.map((item, index) => {
        const itemField = `${field}[${String(index)}]`;
        const candidate = requiredString(item, itemField, 4_096);
        let url: URL;
        try {
          url = new URL(candidate);
        } catch {
          throw new ValidationError(itemField, "must be an absolute URL");
        }
        if (url.protocol !== "https:") {
          throw new ValidationError(itemField, "must use https");
        }
        if (url.username !== "" || url.password !== "") {
          throw new ValidationError(
            itemField,
            "must not contain credentials",
          );
        }
        return url.toString();
      }),
    ),
  ];
}

export function parseEditContentDraftInput(
  value: unknown,
): EditContentDraftInput {
  if (!isRecord(value)) {
    throw new ValidationError("draft", "must be an object");
  }
  return {
    hook: requiredString(value["hook"], "draft.hook", 1_000),
    body: requiredString(value["body"], "draft.body", 4_000),
    keyTakeaway: requiredString(
      value["keyTakeaway"],
      "draft.keyTakeaway",
      1_000,
    ),
    sourceLinks: sourceLinks(
      value["sourceLinks"],
      "draft.sourceLinks",
    ),
  };
}
