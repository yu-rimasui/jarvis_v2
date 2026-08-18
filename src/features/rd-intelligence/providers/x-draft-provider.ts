import type {
  Analysis,
  Experiment,
  Learning,
  SourceItem,
} from "../domain/entities.js";

export interface DraftImage {
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly base64: string;
}

export interface PracticeEvidence {
  readonly environment: string;
  readonly actions: string;
  readonly result: string;
  readonly errors: string;
  readonly learning: string;
  readonly publishableExperience: string;
  readonly images: readonly DraftImage[];
}

export interface GeneratedXDraft {
  readonly text: string;
}

export interface XDraftProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly promptVersion: string;
  generateXDraft(context: {
    readonly sourceItem: SourceItem;
    readonly analysis: Analysis;
    readonly experiment: Experiment;
    readonly learning: Learning;
    readonly practice: PracticeEvidence;
    readonly shorten?: boolean;
  }): Promise<GeneratedXDraft>;
}
