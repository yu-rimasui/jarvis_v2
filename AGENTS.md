# Project Instructions for Codex

このリポジトリで作業するCodexは、変更前に必ず[`CODEX.md`](CODEX.md)を全文読み、そのルールに従ってください。

特に、ユーザーから対象操作を明示的に依頼されない限り、branchの作成・切り替え、stage、commit、push、merge、rebase、tag作成、Pull Request作成を行ってはいけません。通常、commitとpushはゆーりが行います。

要求が曖昧で、公開、課金、外部送信、Git履歴、個人データ、MVPの方向性に影響する場合は、実行前に質問してください。

## Codex Loop

このリポジトリでCodex Loopを使用する場合は、グローバルの同名スキルではなく、[`.agents/skills/codex-loop/SKILL.md`](.agents/skills/codex-loop/SKILL.md)を全文読み、その手順を優先してください。

- 実行時は`CODEX.md`で定めたActivation Headerをプロンプトの1行目に置きます。
- 実行状態は`.codex/loop/<name>/`に保存します。
- カスタムエージェントは`.codex/agents/`のプロジェクト設定を使用します。
- 自動継続時のスキル解決は`codex-loop.toml`に従います。

## Jarvis architecture rules

Jarvisは、日常のタスクと情報検索を支援するローカルファーストのパーソナルAIアシスタントです。単一アプリケーションのモジュラーモノリスとして実装し、コードはPackage by Featureで配置します。

変更前に対象の既存コード・テスト・設定を確認し、実装後は必ず[`.codex/rules/verification.md`](.codex/rules/verification.md)を参照して、変更に見合う検証を行います。

- 共通ルール: [`.codex/rules/common.md`](.codex/rules/common.md)
- ディレクトリ構成・依存関係: [`.codex/rules/architecture.md`](.codex/rules/architecture.md)
- Feature追加・変更: [`.codex/rules/feature.md`](.codex/rules/feature.md)
- DBモデル・永続化: [`.codex/rules/database.md`](.codex/rules/database.md)
- LLM・プロンプト・AI処理: [`.codex/rules/llm.md`](.codex/rules/llm.md)
- テスト: [`.codex/rules/testing.md`](.codex/rules/testing.md)
- Docker・環境変数・設定: [`.codex/rules/infrastructure.md`](.codex/rules/infrastructure.md)

ルール同士が矛盾する場合は、上位の規則、ユーザーの明示的な指示、安全性・データ保護、Feature境界の順に優先します。解決できない矛盾は実装前に確認します。
