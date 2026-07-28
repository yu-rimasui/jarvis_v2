import type {
  ClassifiedClaim,
  ScoreComponent,
} from "../domain/entities.js";
import {
  CATEGORIES,
  CLAIM_CLASSES,
  type Category,
  type ClaimClass,
} from "../domain/enums.js";
import {
  isRecord,
  requiredString,
  ValidationError,
} from "./source-item-parser.js";

export interface ParsedAnalysis {
  readonly summary: string;
  readonly primaryCategory: Category;
  readonly secondaryCategories: readonly Category[];
  readonly confidence: number;
  readonly confidenceReason: string;
  readonly whyItMatters: string;
  readonly workUse: string;
  readonly suggestedFirstExperiment: string;
  readonly relatedTechnologies: readonly string[];
  readonly relatedRepositories: readonly string[];
  readonly risksAndLimitations: readonly string[];
  readonly claims: readonly ClassifiedClaim[];
  readonly scores: {
    readonly relevance: ScoreComponent;
    readonly novelty: ScoreComponent;
    readonly actionability: ScoreComponent;
    readonly authorCredibility: ScoreComponent;
  };
}

function numberInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ValidationError(
      field,
      `must be a finite number from ${String(minimum)} to ${String(maximum)}`,
    );
  }

  return value;
}

function category(value: unknown, field: string): Category {
  if (
    typeof value !== "string" ||
    !CATEGORIES.includes(value as Category)
  ) {
    throw new ValidationError(field, "is not a supported category");
  }

  return value as Category;
}

function claimClass(value: unknown, field: string): ClaimClass {
  if (
    typeof value !== "string" ||
    !CLAIM_CLASSES.includes(value as ClaimClass)
  ) {
    throw new ValidationError(field, "is not a supported claim class");
  }

  return value as ClaimClass;
}

function stringArray(
  value: unknown,
  field: string,
  maximumItems = 20,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ValidationError(
      field,
      `must be an array with at most ${String(maximumItems)} items`,
    );
  }

  return value.map((item, index) =>
    requiredString(item, `${field}[${String(index)}]`, 4_096),
  );
}

function categoryArray(
  value: unknown,
  field: string,
): readonly Category[] {
  if (!Array.isArray(value) || value.length > CATEGORIES.length) {
    throw new ValidationError(field, "must be a category array");
  }

  return value.map((item, index) =>
    category(item, `${field}[${String(index)}]`),
  );
}

function repositoryUrls(value: unknown, field: string): readonly string[] {
  return stringArray(value, field, 20).map((candidate, index) => {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new ValidationError(
        `${field}[${String(index)}]`,
        "must be an absolute URL",
      );
    }

    if (parsed.protocol !== "https:") {
      throw new ValidationError(
        `${field}[${String(index)}]`,
        "must use https",
      );
    }

    if (parsed.username !== "" || parsed.password !== "") {
      throw new ValidationError(
        `${field}[${String(index)}]`,
        "must not contain credentials",
      );
    }

    return parsed.toString();
  });
}

function claims(value: unknown, field: string): readonly ClassifiedClaim[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new ValidationError(field, "must be a claim array");
  }

  return value.map((item, index) => {
    const itemField = `${field}[${String(index)}]`;
    if (!isRecord(item)) {
      throw new ValidationError(itemField, "must be an object");
    }

    const sourceUrlValue = item["sourceUrl"];
    const sourceUrl =
      sourceUrlValue === undefined
        ? undefined
        : repositoryUrls([sourceUrlValue], `${itemField}.sourceUrl`)[0];

    return {
      claimClass: claimClass(
        item["claimClass"],
        `${itemField}.claimClass`,
      ),
      text: requiredString(item["text"], `${itemField}.text`, 4_096),
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    };
  });
}

function scoreComponent(value: unknown, field: string): ScoreComponent {
  if (!isRecord(value)) {
    throw new ValidationError(field, "must be an object");
  }

  return {
    score: numberInRange(value["score"], `${field}.score`, 0, 5),
    reason: requiredString(value["reason"], `${field}.reason`, 2_000),
  };
}

export function parseAnalysis(value: unknown): ParsedAnalysis {
  if (!isRecord(value)) {
    throw new ValidationError("analysis", "must be an object");
  }

  const scoreValue = value["scores"];
  if (!isRecord(scoreValue)) {
    throw new ValidationError("analysis.scores", "must be an object");
  }

  const primaryCategory = category(
    value["primaryCategory"],
    "analysis.primaryCategory",
  );
  const secondaryCategories = categoryArray(
    value["secondaryCategories"],
    "analysis.secondaryCategories",
  ).filter((candidate) => candidate !== primaryCategory);

  return {
    summary: requiredString(value["summary"], "analysis.summary", 2_000),
    primaryCategory,
    secondaryCategories: [...new Set(secondaryCategories)],
    confidence: numberInRange(
      value["confidence"],
      "analysis.confidence",
      0,
      1,
    ),
    confidenceReason: requiredString(
      value["confidenceReason"],
      "analysis.confidenceReason",
      2_000,
    ),
    whyItMatters: requiredString(
      value["whyItMatters"],
      "analysis.whyItMatters",
      4_000,
    ),
    workUse: requiredString(value["workUse"], "analysis.workUse", 4_000),
    suggestedFirstExperiment: requiredString(
      value["suggestedFirstExperiment"],
      "analysis.suggestedFirstExperiment",
      4_000,
    ),
    relatedTechnologies: stringArray(
      value["relatedTechnologies"],
      "analysis.relatedTechnologies",
    ),
    relatedRepositories: repositoryUrls(
      value["relatedRepositories"],
      "analysis.relatedRepositories",
    ),
    risksAndLimitations: stringArray(
      value["risksAndLimitations"],
      "analysis.risksAndLimitations",
    ),
    claims: claims(value["claims"], "analysis.claims"),
    scores: {
      relevance: scoreComponent(
        scoreValue["relevance"],
        "analysis.scores.relevance",
      ),
      novelty: scoreComponent(
        scoreValue["novelty"],
        "analysis.scores.novelty",
      ),
      actionability: scoreComponent(
        scoreValue["actionability"],
        "analysis.scores.actionability",
      ),
      authorCredibility: scoreComponent(
        scoreValue["authorCredibility"],
        "analysis.scores.authorCredibility",
      ),
    },
  };
}
