import type {
  ContentEvidence,
} from "../domain/entities.js";
import {
  composedDraftText,
  type ContentRenderContext,
  type ContentRenderer,
  hasPublishableFirstHandExperience,
  type RenderedContent,
  unicodeCharacterCount,
} from "./content-renderer.js";

const X_CHARACTER_LIMIT = 280;

function shorten(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const characters = [...normalized];
  if (characters.length <= maximum) return normalized;
  return `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function expectedXSourceLinks(
  context: ContentRenderContext,
): readonly string[] {
  const candidates = [
    context.sourceItem.canonicalUrl,
    ...context.analysis.claims.map((claim) => claim.sourceUrl),
    ...context.analysis.relatedRepositories,
  ];
  return [
    ...new Set(
      candidates
        .map(safeHttpsUrl)
        .filter((value): value is string => value !== undefined),
    ),
  ].slice(0, 5);
}

export function expectedXBody(
  context: ContentRenderContext,
): string {
  return hasPublishableFirstHandExperience(context)
    ? experienceBody(context)
    : sourceOnlyBody(context);
}

function sourceOnlyBody(context: ContentRenderContext): string {
  const experiment = context.experiment;
  const proposed =
    experiment?.smallestFirstStep ??
    context.analysis.suggestedFirstExperiment;
  const status =
    experiment === undefined
      ? "まだ試していません"
      : experiment.status === "completed"
        ? "実験は完了。ただし公開可能な体験記録は未登録"
        : `実験は${experiment.status}。結果確定前`;

  return [
    `出典要約: ${shorten(context.analysis.summary, 38)}`,
    `Jarvis解釈: ${shorten(context.analysis.whyItMatters, 34)}`,
    `未検証: ${status}。${shorten(proposed, 38)}`,
  ].join("\n");
}

function experienceBody(context: ContentRenderContext): string {
  const experiment = context.experiment;
  const learning = context.learning;
  if (
    experiment === undefined ||
    learning?.publishableFirstHandExperience === undefined
  ) {
    throw new TypeError("Publishable experiment evidence is missing");
  }

  return [
    `出典要約: ${shorten(context.analysis.summary, 30)}`,
    `Jarvis解釈: ${shorten(context.analysis.whyItMatters, 26)}`,
    `実際に試した: ${shorten(
      learning.publishableFirstHandExperience,
      42,
    )}`,
    `結果: ${shorten(experiment.result ?? "", 28)}`,
  ].join("\n");
}

export function expectedXProvenance(
  context: ContentRenderContext,
): readonly ContentEvidence[] {
  const sourceUrl = expectedXSourceLinks(context)[0];
  const includeExperience =
    hasPublishableFirstHandExperience(context);
  const evidence: ContentEvidence[] = [
    {
      kind: "SOURCE",
      text: context.analysis.summary,
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    },
    {
      kind: "INTERPRETATION",
      text: context.analysis.whyItMatters,
    },
    {
      kind: "HYPOTHESIS",
      text:
        context.experiment?.hypothesis ??
        context.analysis.suggestedFirstExperiment,
    },
  ];

  if (
    includeExperience &&
    context.learning?.publishableFirstHandExperience !== undefined &&
    context.experiment?.result !== undefined
  ) {
    evidence.push({
      kind: "EXPERIENCE",
      text: context.learning.publishableFirstHandExperience,
    });
    evidence.push({
      kind: "EXPERIMENT_RESULT",
      text: context.experiment.result,
    });
  }
  return evidence;
}

interface XEvidenceEnvelope {
  readonly hook: string;
  readonly body: string;
  readonly keyTakeaway: string;
  readonly sourceLinks: readonly string[];
  readonly evidenceScope: "source_only" | "completed_experiment";
  readonly provenance: readonly ContentEvidence[];
}

function hasNonemptyPrefixedLine(
  line: string,
  prefix: string,
): boolean {
  return (
    !line.includes("\n") &&
    !line.includes("\r") &&
    line.startsWith(prefix) &&
    line.slice(prefix.length).trim().length > 0
  );
}

function valueAfterPrefix(
  line: string,
  prefix: string,
): string | undefined {
  if (!hasNonemptyPrefixedLine(line, prefix)) return undefined;
  return line.slice(prefix.length).trim();
}

function normalizedEvidenceText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isEvidenceExcerpt(
  renderedValue: string | undefined,
  evidenceValue: string | undefined,
): boolean {
  if (renderedValue === undefined || evidenceValue === undefined) {
    return false;
  }
  const candidate = normalizedEvidenceText(renderedValue).replace(
    /…$/u,
    "",
  );
  const evidence = normalizedEvidenceText(evidenceValue);
  return candidate.length > 0 && evidence.includes(candidate);
}

function hookAndTakeawayMatchContext(
  context: ContentRenderContext,
  content: Pick<
    XEvidenceEnvelope,
    "hook" | "keyTakeaway" | "evidenceScope"
  >,
): boolean {
  if (content.evidenceScope === "source_only") {
    return (
      isEvidenceExcerpt(
        valueAfterPrefix(content.hook, "検証候補: "),
        context.analysis.summary,
      ) &&
      isEvidenceExcerpt(
        valueAfterPrefix(
          content.keyTakeaway,
          "次の一歩: ",
        ),
        context.experiment?.smallestFirstStep ??
          context.analysis.suggestedFirstExperiment,
      )
    );
  }

  return (
    isEvidenceExcerpt(
      valueAfterPrefix(
        content.hook,
        "小さく試して分かったこと: ",
      ),
      context.experiment?.title,
    ) &&
    isEvidenceExcerpt(
      valueAfterPrefix(content.keyTakeaway, "学び: "),
      context.learning?.reusableKnowledge,
    )
  );
}

export function followsXTruthEnvelope(
  content: Pick<
    XEvidenceEnvelope,
    "hook" | "body" | "keyTakeaway" | "evidenceScope"
  >,
): boolean {
  const lines = content.body.split("\n");
  if (content.evidenceScope === "source_only") {
    return (
      hasNonemptyPrefixedLine(content.hook, "検証候補: ") &&
      hasNonemptyPrefixedLine(
        content.keyTakeaway,
        "次の一歩: ",
      ) &&
      lines.length === 3 &&
      hasNonemptyPrefixedLine(lines[0] ?? "", "出典要約: ") &&
      hasNonemptyPrefixedLine(
        lines[1] ?? "",
        "Jarvis解釈: ",
      ) &&
      hasNonemptyPrefixedLine(lines[2] ?? "", "未検証: ")
    );
  }

  return (
    hasNonemptyPrefixedLine(
      content.hook,
      "小さく試して分かったこと: ",
    ) &&
    hasNonemptyPrefixedLine(content.keyTakeaway, "学び: ") &&
    lines.length === 4 &&
    hasNonemptyPrefixedLine(lines[0] ?? "", "出典要約: ") &&
    hasNonemptyPrefixedLine(
      lines[1] ?? "",
      "Jarvis解釈: ",
    ) &&
    hasNonemptyPrefixedLine(lines[2] ?? "", "実際に試した: ") &&
    hasNonemptyPrefixedLine(lines[3] ?? "", "結果: ")
  );
}

function sameEvidence(
  left: readonly ContentEvidence[],
  right: readonly ContentEvidence[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function matchesXEvidenceContext(
  context: ContentRenderContext,
  content: XEvidenceEnvelope,
  allowSourceLinkSubset = false,
): boolean {
  const includeExperience =
    hasPublishableFirstHandExperience(context);
  const expectedScope = includeExperience
    ? "completed_experiment"
    : "source_only";
  const expectedLinks = expectedXSourceLinks(context);
  const linksMatch = allowSourceLinkSubset
    ? content.sourceLinks.every((link) => expectedLinks.includes(link))
    : JSON.stringify(content.sourceLinks) ===
      JSON.stringify(expectedLinks);

  return (
    content.evidenceScope === expectedScope &&
    content.body === expectedXBody(context) &&
    sameEvidence(
      content.provenance,
      expectedXProvenance(context),
    ) &&
    linksMatch &&
    hookAndTakeawayMatchContext(context, content) &&
    followsXTruthEnvelope(content)
  );
}

export class XContentRenderer implements ContentRenderer<"x"> {
  readonly platform = "x";
  readonly providerId = "local-rules";
  readonly modelId = "deterministic-x-renderer-v1";
  readonly promptVersion = "x-draft-v1";

  render(context: ContentRenderContext): RenderedContent {
    const links = expectedXSourceLinks(context);
    const includeExperience =
      hasPublishableFirstHandExperience(context);
    const hook = includeExperience
      ? `小さく試して分かったこと: ${shorten(
          context.experiment?.title ?? context.analysis.primaryCategory,
          34,
        )}`
      : `検証候補: ${shorten(context.analysis.summary, 36)}`;
    const body = expectedXBody(context);
    const keyTakeaway = includeExperience
      ? `学び: ${shorten(
          context.learning?.reusableKnowledge ?? "",
          38,
        )}`
      : `次の一歩: ${shorten(
          context.experiment?.smallestFirstStep ??
            context.analysis.suggestedFirstExperiment,
          36,
        )}`;
    const characterCount = unicodeCharacterCount(
      composedDraftText({ hook, body, keyTakeaway }),
    );
    if (characterCount > X_CHARACTER_LIMIT) {
      throw new RangeError("Rendered X draft exceeds 280 characters");
    }

    return {
      hook,
      body,
      keyTakeaway,
      sourceLinks: links,
      characterCount,
      evidenceScope: includeExperience
        ? "completed_experiment"
        : "source_only",
      provenance: expectedXProvenance(context),
    };
  }
}
