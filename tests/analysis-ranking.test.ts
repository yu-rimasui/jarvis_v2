import assert from "node:assert/strict";
import test from "node:test";
import {
  overallScore,
  type RankingComponents,
} from "../src/features/rd-intelligence/domain/ranking.js";
import {
  parseAnalysis,
  type ParsedAnalysis,
} from "../src/features/rd-intelligence/validation/analysis-parser.js";

function components(
  relevance: number,
  novelty: number,
  actionability: number,
  authorCredibility: number,
): RankingComponents {
  return {
    relevance: { score: relevance, reason: "relevance reason" },
    novelty: { score: novelty, reason: "novelty reason" },
    actionability: {
      score: actionability,
      reason: "actionability reason",
    },
    authorCredibility: {
      score: authorCredibility,
      reason: "credibility reason",
    },
  };
}

function validAnalysis(): Readonly<Record<string, unknown>> {
  return {
    summary: "30秒で読める合成要約です。",
    primaryCategory: "MCP",
    secondaryCategories: ["AI Development", "MCP", "AI Development"],
    confidence: 0.75,
    confidenceReason: "投稿本文のみを根拠にした合成評価です。",
    whyItMatters: "小さな実験に変換できる可能性があります。",
    workUse: "既存フローとの比較に利用できます。",
    suggestedFirstExperiment: "30分のローカル比較を実施する。",
    trialDifficulty: "beginner",
    requiredEnvironment: ["Node.js"],
    hypothesis: "最小構成なら短時間で再現できる。",
    expectedValue: "採否判断に使える一次体験を得る。",
    estimatedEffort: "30分",
    successCriteria: "結果を再現できる。",
    verificationMethod: "同じ手順を2回実行する。",
    relatedTechnologies: ["TypeScript", "MCP"],
    relatedRepositories: [
      "https://github.com/modelcontextprotocol/typescript-sdk",
    ],
    risksAndLimitations: ["外部の一次情報は未確認です。"],
    claims: [
      {
        claimClass: "OBSERVATION",
        text: "保存された投稿本文に記載された内容です。",
        sourceUrl: "https://example.test/source",
      },
      {
        claimClass: "HYPOTHESIS",
        text: "実験により有用性を検証できます。",
      },
    ],
    scores: {
      relevance: { score: 4, reason: "業務との関連があります。" },
      novelty: { score: 3, reason: "新規性は未検証です。" },
      actionability: { score: 4, reason: "小さく試せます。" },
      authorCredibility: {
        score: 2.5,
        reason: "著者の信頼性と主張の真偽を分離します。",
      },
    },
  };
}

test("ranking converts the declared component weights to 0-100", () => {
  assert.equal(overallScore(components(0, 0, 0, 0)), 0);
  assert.equal(overallScore(components(5, 5, 5, 5)), 100);
  assert.equal(overallScore(components(5, 0, 0, 0)), 35);
  assert.equal(overallScore(components(0, 5, 0, 0)), 25);
  assert.equal(overallScore(components(0, 0, 5, 0)), 25);
  assert.equal(overallScore(components(0, 0, 0, 5)), 15);
  assert.equal(overallScore(components(2.5, 2.5, 2.5, 2.5)), 50);
});

test("ranking rejects invalid scores and missing explanations", () => {
  assert.throws(
    () => overallScore(components(Number.NaN, 3, 3, 3)),
    /relevance score must be between 0 and 5/u,
  );
  assert.throws(
    () =>
      overallScore({
        ...components(3, 3, 3, 3),
        novelty: { score: 3, reason: " " },
      }),
    /novelty reason must not be empty/u,
  );
});

test("analysis schema normalizes categories and validates all score fields", () => {
  const parsed: ParsedAnalysis = parseAnalysis(validAnalysis());

  assert.equal(parsed.primaryCategory, "MCP");
  assert.deepEqual(parsed.secondaryCategories, ["AI Development"]);
  assert.equal(parsed.scores.relevance.score, 4);
  assert.equal(parsed.scores.authorCredibility.score, 2.5);
  assert.deepEqual(
    parsed.claims.map((claim) => claim.claimClass),
    ["OBSERVATION", "HYPOTHESIS"],
  );
});

test("analysis schema rejects non-finite values and unsupported enums", () => {
  const invalidConfidence = {
    ...validAnalysis(),
    confidence: Number.POSITIVE_INFINITY,
  };
  assert.throws(
    () => parseAnalysis(invalidConfidence),
    /analysis\.confidence/u,
  );

  const invalidCategory = {
    ...validAnalysis(),
    primaryCategory: "Marketing",
  };
  assert.throws(
    () => parseAnalysis(invalidCategory),
    /analysis\.primaryCategory/u,
  );

  const base = validAnalysis();
  const baseScores = base["scores"];
  assert.equal(
    typeof baseScores === "object" && baseScores !== null,
    true,
  );
  const invalidScore = {
    ...base,
    scores: {
      ...(baseScores as Readonly<Record<string, unknown>>),
      actionability: {
        score: Number.NaN,
        reason: "invalid score",
      },
    },
  };
  assert.throws(
    () => parseAnalysis(invalidScore),
    /analysis\.scores\.actionability\.score/u,
  );

  const invalidClaim = {
    ...validAnalysis(),
    claims: [
      {
        claimClass: "OPINION",
        text: "Unsupported claim class.",
      },
    ],
  };
  assert.throws(
    () => parseAnalysis(invalidClaim),
    /analysis\.claims\[0\]\.claimClass/u,
  );
});
