import {
  HYPOTHESIS_SUPPORT_VALUES,
  type HypothesisSupport,
} from "../domain/enums.js";
import {
  isRecord,
  optionalString,
  requiredString,
  ValidationError,
} from "./source-item-parser.js";

export interface ProposeExperimentInput {
  readonly title: string;
  readonly hypothesis: string;
  readonly expectedValue: string;
  readonly smallestFirstStep: string;
  readonly requiredTools: readonly string[];
  readonly estimatedEffort: string;
  readonly risk: string;
  readonly successCriteria: string;
  readonly verificationMethod: string;
}

export interface CompleteExperimentInput {
  readonly result: string;
  readonly verificationEvidence: string;
  readonly learned: string;
  readonly nextDecision: string;
  readonly hypothesisSupport: HypothesisSupport;
  readonly reusableKnowledge: string;
  readonly nextExperiment?: string;
  readonly publishableFirstHandExperience?: string;
}

function stringArray(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new ValidationError(
      field,
      "must be an array with at most 20 items",
    );
  }

  const parsed = value.map((item, index) =>
    requiredString(item, `${field}[${String(index)}]`, 512),
  );
  return [...new Set(parsed)];
}

function hypothesisSupport(
  value: unknown,
  field: string,
): HypothesisSupport {
  if (
    typeof value !== "string" ||
    !HYPOTHESIS_SUPPORT_VALUES.includes(value as HypothesisSupport)
  ) {
    throw new ValidationError(
      field,
      "is not a supported hypothesis outcome",
    );
  }
  return value as HypothesisSupport;
}

export function parseExperimentId(value: unknown): string {
  return requiredString(value, "experimentId", 512);
}

export function parseAnalysisId(value: unknown): string {
  return requiredString(value, "analysisId", 512);
}

export function parseDecisionReason(
  value: unknown,
  field = "reason",
): string {
  return requiredString(value, field, 4_000);
}

export function parseProposeExperimentInput(
  value: unknown,
): ProposeExperimentInput {
  if (!isRecord(value)) {
    throw new ValidationError("experiment", "must be an object");
  }

  return {
    title: requiredString(value["title"], "experiment.title", 1_000),
    hypothesis: requiredString(
      value["hypothesis"],
      "experiment.hypothesis",
      4_000,
    ),
    expectedValue: requiredString(
      value["expectedValue"],
      "experiment.expectedValue",
      4_000,
    ),
    smallestFirstStep: requiredString(
      value["smallestFirstStep"],
      "experiment.smallestFirstStep",
      4_000,
    ),
    requiredTools: stringArray(
      value["requiredTools"],
      "experiment.requiredTools",
    ),
    estimatedEffort: requiredString(
      value["estimatedEffort"],
      "experiment.estimatedEffort",
      1_000,
    ),
    risk: requiredString(value["risk"], "experiment.risk", 4_000),
    successCriteria: requiredString(
      value["successCriteria"],
      "experiment.successCriteria",
      4_000,
    ),
    verificationMethod: requiredString(
      value["verificationMethod"],
      "experiment.verificationMethod",
      4_000,
    ),
  };
}

export function parseCompleteExperimentInput(
  value: unknown,
): CompleteExperimentInput {
  if (!isRecord(value)) {
    throw new ValidationError("completion", "must be an object");
  }

  const nextExperiment = optionalString(
    value["nextExperiment"],
    "completion.nextExperiment",
    4_000,
  );
  const publishableFirstHandExperience = optionalString(
    value["publishableFirstHandExperience"],
    "completion.publishableFirstHandExperience",
    4_000,
  );

  return {
    result: requiredString(
      value["result"],
      "completion.result",
      20_000,
    ),
    verificationEvidence: requiredString(
      value["verificationEvidence"],
      "completion.verificationEvidence",
      20_000,
    ),
    learned: requiredString(
      value["learned"],
      "completion.learned",
      20_000,
    ),
    nextDecision: requiredString(
      value["nextDecision"],
      "completion.nextDecision",
      4_000,
    ),
    hypothesisSupport: hypothesisSupport(
      value["hypothesisSupport"],
      "completion.hypothesisSupport",
    ),
    reusableKnowledge: requiredString(
      value["reusableKnowledge"],
      "completion.reusableKnowledge",
      20_000,
    ),
    ...(nextExperiment === undefined ? {} : { nextExperiment }),
    ...(publishableFirstHandExperience === undefined
      ? {}
      : { publishableFirstHandExperience }),
  };
}
