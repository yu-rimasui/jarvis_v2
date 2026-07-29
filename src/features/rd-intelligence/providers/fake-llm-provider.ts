import type { SourceItem } from "../domain/entities.js";
import type { Category } from "../domain/enums.js";
import type { LlmProvider } from "./llm-provider.js";

function categoryFor(content: string): Category {
  const normalized = content.toLocaleLowerCase("en-US");

  if (normalized.includes("codex")) return "Codex";
  if (normalized.includes("claude code")) return "Claude Code";
  if (normalized.includes("mcp")) return "MCP";
  if (normalized.includes("agent")) return "AI Agents";
  if (normalized.includes("test")) return "Test Automation";
  if (normalized.includes("devops")) return "DevOps";
  if (normalized.includes("llm")) return "LLM Research";
  return "AI Development";
}

function githubRepositories(content: string): readonly string[] {
  const matches = content.matchAll(
    /https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/gu,
  );

  return [
    ...new Set(
      [...matches].map((match) => {
        const url = match[0] ?? "";
        return new URL(url).toString();
      }),
    ),
  ];
}

function technologies(content: string): readonly string[] {
  const candidates: readonly [string, string][] = [
    ["typescript", "TypeScript"],
    ["sqlite", "SQLite"],
    ["mcp", "MCP"],
    ["codex", "Codex"],
    ["agent", "AI Agents"],
    ["test", "Test Automation"],
  ];
  const normalized = content.toLocaleLowerCase("en-US");

  return candidates
    .filter(([keyword]) => normalized.includes(keyword))
    .map(([, label]) => label);
}

export class FakeLlmProvider implements LlmProvider {
  readonly providerId = "local-fake";
  readonly modelId = "deterministic-fixture-analyzer";
  readonly promptVersion = "analysis-v1";
  readonly schemaVersion = "analysis-v1";

  async analyze(item: SourceItem): Promise<unknown> {
    const primaryCategory = categoryFor(
      `${item.title}\n${item.content}`,
    );
    const summarySource = item.content.replace(/\s+/gu, " ").trim();
    const summary =
      summarySource.length <= 180
        ? summarySource
        : `${summarySource.slice(0, 177)}...`;

    return {
      summary,
      primaryCategory,
      secondaryCategories:
        primaryCategory === "AI Development"
          ? []
          : ["AI Development"],
      confidence: 0.6,
      confidenceReason:
        "投稿本文だけを分析したため、外部の一次情報による確認は未実施です。",
      whyItMatters:
        "現在の開発フローへ小さく取り込み、効果を実験で確認できる可能性があります。",
      workUse:
        "既存作業の一部に限定して比較し、採用判断の材料として利用できます。",
      suggestedFirstExperiment:
        "30分以内の最小構成で試し、現在の方法と結果・所要時間を比較する。",
      relatedTechnologies: technologies(
        `${item.title}\n${item.content}`,
      ),
      relatedRepositories: githubRepositories(item.content),
      risksAndLimitations: [
        "投稿者の主張を独立した一次情報で検証していません。",
      ],
      claims: [
        {
          claimClass: "OBSERVATION",
          text: "この分析は保存された投稿本文に記載された内容を要約しています。",
          ...(item.canonicalUrl !== undefined &&
          new URL(item.canonicalUrl).protocol === "https:"
            ? { sourceUrl: item.canonicalUrl }
            : {}),
        },
        {
          claimClass: "HYPOTHESIS",
          text: "小さな実験により実務上の有用性を検証できます。",
        },
      ],
      scores: {
        relevance: {
          score: 4,
          reason: "JarvisのR&Dとソフトウェア開発に関連します。",
        },
        novelty: {
          score: 3,
          reason: "投稿本文だけでは新規性を完全には確認できません。",
        },
        actionability: {
          score: 4,
          reason: "限定したfirst experimentへ変換できます。",
        },
        authorCredibility: {
          score: 2.5,
          reason:
            "著者情報は保存されていますが、内容の真実性とは分離して扱います。",
        },
      },
    };
  }
}
