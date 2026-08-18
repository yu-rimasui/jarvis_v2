import type {
  Analysis,
  ContentEvidence,
  Experiment,
  Learning,
  SourceItem,
} from "../domain/entities.js";

export interface ContentRenderContext {
  readonly analysis: Analysis;
  readonly sourceItem: SourceItem;
  readonly experiment?: Experiment;
  readonly learning?: Learning;
}

export interface RenderedContent {
  readonly hook: string;
  readonly body: string;
  readonly keyTakeaway: string;
  readonly sourceLinks: readonly string[];
  readonly characterCount: number;
  readonly evidenceScope: "source_only" | "completed_experiment";
  readonly provenance: readonly ContentEvidence[];
}

export interface ContentRenderer<Platform extends "x" | "instagram"> {
  readonly platform: Platform;
  readonly providerId: string;
  readonly modelId: string;
  readonly promptVersion: string;
  render(context: ContentRenderContext): RenderedContent;
}

export function composedDraftText(content: {
  readonly hook: string;
  readonly body: string;
  readonly keyTakeaway: string;
}): string {
  return [content.hook, content.body, content.keyTakeaway]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

export function unicodeCharacterCount(value: string): number {
  return [...value].length;
}

export function hasPublishableFirstHandExperience(
  context: ContentRenderContext,
): boolean {
  const experiment = context.experiment;
  const learning = context.learning;
  return (
    experiment?.status === "completed" &&
    typeof experiment.result === "string" &&
    experiment.result.trim().length > 0 &&
    learning !== undefined &&
    learning.experimentId === experiment.id &&
    typeof learning.publishableFirstHandExperience === "string" &&
    learning.publishableFirstHandExperience.trim().length > 0
  );
}
