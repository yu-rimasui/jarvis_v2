# Jarvis R&D Intelligence MVP

Jarvis v2 に、技術情報を「読むだけ」で終わらせず、次の判断・実験・学習・発信へ変換するローカルファーストのR&D機能を追加しています。

```text
Collect → Evaluate → Experiment → Learn → Draft → Human Review
```

現在のMVPは、外部資格情報なしで `fixture` または手動JSONを取り込み、SQLiteへ保存し、重複排除・構造化分析・説明可能なランキング・実験記録・X下書きレビューまでをローカルで実行できます。

## 現在の境界

実装済み:

- fixture / manual import
- SQLiteのmigration、重複排除、topic cluster
- deterministic fake LLMによる型付き分析
- relevance / novelty / actionability / author credibility の0〜5評価と0〜100ランキング
- experimentの提案、承認、開始、結果・学習の記録
- evidence scopeを持つX下書き、編集、コピー、人間レビュー、承認
- processing historyと手動Daily Digest API
- `127.0.0.1` 専用APIと既存Jarvisダッシュボード内のR&D画面

明示的に未実装:

- X API、Zenn RSS、Qiita RSSへの実接続（Collectorの境界とfixture/manual検証のみ）
- 外部LLM、有料API、クラウド送信
- Xへの自動投稿、Instagram API、自動スケジュール、任意コード実行
- チャット、長期記憶、Digital Twin機能

実装範囲の詳細とAPI契約は[`docs/RD_INTELLIGENCE.md`](docs/RD_INTELLIGENCE.md)を参照してください。

## ローカルセットアップ

必要環境:

- Node.js `>=22.14 <23`
- npm
- 外部アカウント、APIキー、環境変数は不要

リポジトリ直下で実行します。

```bash
npm ci
npm run db:init
npm run pipeline:fixture
npm run api:local
```

その後、ブラウザで <http://127.0.0.1:4317/> を開きます。`api:local` は同じプロセスからUIとAPIを配信します。別のターミナルで停止する場合は `Ctrl-C` を使ってください。

既定値は次のとおりです。

- SQLite: `data/rd-intelligence.sqlite`
- migration: `migrations/`
- fixture: `fixtures/source-items.json`
- API host / port: `127.0.0.1:4317`

個別のパスを使う場合は、CLIへオプションを渡せます。

```bash
npm run db:init -- --database data/demo.sqlite
npm run pipeline:fixture -- --database data/demo.sqlite --fixture fixtures/source-items.json
npm run api:local -- --database data/demo.sqlite --port 4317
```

`api:local` 起動時にもmigrationは冪等に確認されます。fixtureは合成データであり、同じfixtureを再実行してもsource ID、canonical URL、content hashの重複は保存されません。

## 画面での基本操作

1. 既存ダッシュボードの `R&D INTELLIGENCE` を開く。
2. `ローカルデータを更新` は保存済みデータの読み取りだけを行う。
3. `INBOX` で合成サンプルを入力するか、手動JSONを貼り付け、`JSONを取り込む` を明示的に押す。
4. `RANKED INSIGHTS` で根拠、スコア内訳、最初の実験を確認する。
5. Insightから実験を提案し、承認 → 開始 → ユーザーが実施 → 結果と学習を記録する。
6. `X DRAFTS` で出典・解釈・仮説・実験結果の範囲を確認し、編集・コピー・レビュー・承認を行う。
7. `HISTORY` で処理履歴を確認する。

ページ表示や更新だけで、収集、分析、下書き生成、実験実行、外部送信は起きません。Xへの投稿ボタンはありません。

## CLIとテスト

```bash
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:local-api
npm run test:foundation
```

fixtureを使った一連の処理だけを実行する場合は `npm run pipeline:fixture`、DB migrationだけを確認する場合は `npm run db:init` を使います。テストは実X API、RSS、外部LLMを呼ばず、fixtureまたはfake providerを使用します。

GitHub Actionsは[`ci.yml`](.github/workflows/ci.yml)で、Pull Requestまたは`workflow_dispatch`だけを受け付けます。schedule、push起動、外部書込み、Secret送信はありません。

## ドキュメント

- [`docs/RD_INTELLIGENCE.md`](docs/RD_INTELLIGENCE.md): architecture、Mermaid図、データモデル、API、セットアップ、セキュリティ、費用、拡張点、TODO
- [`CODEX.md`](CODEX.md): このリポジトリでの開発・Git・外部接続ルール
- [`docs/JARVIS_V1_HANDOFF.md`](docs/JARVIS_V1_HANDOFF.md): 前身プロジェクトの調査結果

## プロジェクト方針

- Local first
- Explicit consent
- Evidence before autonomy
- Explainable ranking
- Replaceable providers
- Human approval before publishing
- Understandable architecture

情報源やLLMを追加する場合も、Collector / LlmProvider / ContentRendererの境界を保ち、まずfixtureとfake providerで検証します。実X API、RSS、外部LLM、Instagram連携を有効化するには、料金、利用規約、送信データ、資格情報の保存場所、停止方法を別途判断してください。

## Git運用

現在の作業ブランチは `feat/sns` です。Codexは明示的な依頼がない限り、branch、stage、commit、push、merge、rebase、tag、PR作成を行いません。

推奨コミットメッセージ:

```text
feat: add local R&D intelligence loop MVP
```
