# Jarvis 開発ルール

Jarvis は、日常のタスクと情報検索を支援するローカルファーストのパーソナル AI アシスタントです。単一アプリケーションの**モジュラーモノリス**として実装し、コードは**Package by Feature**で配置します。

変更前に対象の既存コード・テスト・設定を確認し、実装後は必ず [`verification.md`](.codex/rules/verification.md) を参照して、変更に見合う検証を行います。

## 常に参照するルール

- [`common.md`](.codex/rules/common.md)

## タスク別の参照先

| 変更内容 | 参照ルール |
| --- | --- |
| すべての変更 | `common.md` |
| ディレクトリ構成、依存関係 | `architecture.md` |
| Feature追加・変更 | `feature.md` |
| DBモデル、永続化 | `database.md` |
| LLM、プロンプト、AI処理 | `llm.md` |
| テスト追加・変更 | `testing.md` |
| Docker、環境変数、設定 | `infrastructure.md` |
| 実装後の確認 | `verification.md` |

ルール群の全体像は [`.codex/rules/README.md`](.codex/rules/README.md) を参照します。

## 優先順位

上位のリポジトリ規則、ユーザーの明示的な指示、本ファイル、タスク別ルールの順に適用します。ルール同士が矛盾する場合は、上位の規則を優先し、同じ優先度なら安全性・データ保護・Feature境界を優先します。解決できない矛盾は実装前に報告して確認します。
