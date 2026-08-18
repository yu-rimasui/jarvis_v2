export type FeatureStatus = "active" | "planned";

export interface FeatureDefinition {
  readonly description: string;
  readonly eyebrow: string;
  readonly glyph: string;
  readonly id: string;
  readonly metric: string;
  readonly metricLabel: string;
  readonly path: string;
  readonly status: FeatureStatus;
  readonly title: string;
}

export const featureDefinitions: readonly FeatureDefinition[] = [
  {
    id: "rd-intelligence",
    title: "R&D Intelligence",
    eyebrow: "RESEARCH / SNS",
    description:
      "根拠を収集・分析し、実験とレビュー済みのX下書きにつなげます。",
    path: "/rd-intelligence",
    status: "active",
    metric: "…",
    metricLabel: "loading local state",
    glyph: "RD",
  },
  {
    id: "chat",
    title: "Jarvis Chat",
    eyebrow: "CONVERSATION",
    description:
      "ローカルLLMを優先し、許可されたコンテキストだけで会話します。",
    path: "/chat",
    status: "planned",
    metric: "NEXT",
    metricLabel: "foundation feature",
    glyph: "CH",
  },
  {
    id: "memory",
    title: "Memory",
    eyebrow: "PERSONAL KNOWLEDGE",
    description:
      "明示的に保存した記憶を、根拠付きで閲覧・訂正・削除します。",
    path: "/memory",
    status: "planned",
    metric: "0",
    metricLabel: "saved memories",
    glyph: "ME",
  },
  {
    id: "tasks",
    title: "Tasks",
    eyebrow: "EXECUTION",
    description:
      "タスクと実行状態を整理し、勝手に実行しない安全な操作面を提供します。",
    path: "/tasks",
    status: "planned",
    metric: "0",
    metricLabel: "open tasks",
    glyph: "TS",
  },
  {
    id: "models",
    title: "Local Models",
    eyebrow: "INTELLIGENCE CORE",
    description:
      "Local LLMの接続状態、モデル選択、評価結果を管理します。",
    path: "/models",
    status: "planned",
    metric: "OFF",
    metricLabel: "runtime status",
    glyph: "LM",
  },
] as const;
