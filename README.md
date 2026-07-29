# Jarvis v2

Jarvis v2は、ゆーり自身の記憶・能力・判断傾向・人格を少しずつ学び、将来的に「自分のデジタルツイン」へ育てるための、ローカルファーストなパーソナルAIプロジェクトです。

既存のOpenJarvisをそのまま縮小するのではなく、必要な機能だけを、理解できる大きさで一つずつ実装します。

## 現在の状態

現在は、既存のNode.js／SQLiteによるR&D Intelligence MVPと、将来のPython／PostgreSQL／Vector DB構成へ移行するためのCompose設定基盤を併存させています。

- R&D Intelligence MVP: `npm test`で検証できる既存のローカル縦切り
- Python foundation: `pyproject.toml`、`src/jarvis/`、`Dockerfile`
- Local infrastructure: `compose.yaml`（app、PostgreSQL、Qdrant）

Python側は現在ヘルスチェック用の最小アプリのみです。既存R&D機能のPython移植、SQLiteからPostgreSQLへのデータ移行、Vector DBへの再インデックスはまだ実施していません。

前身プロジェクトの調査結果は[`docs/JARVIS_V1_HANDOFF.md`](docs/JARVIS_V1_HANDOFF.md)を参照してください。Codexを使った開発ルールは[`CODEX.md`](CODEX.md)に定義しています。

構成の境界と移行方針は[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)を参照してください。

## Python／Compose foundation

```bash
cp .env.example .env
docker compose config
docker compose up --build
curl http://127.0.0.1:8000/health
```

Composeは`app`、`postgres`、`vector-db`をローカル限定で起動します。`.env`にはローカル開発用の値だけを置き、実際のAPIキーや個人データは保存しないでください。

## MVPの目的

最初のMVPでは、次の一連の体験を成立させます。

1. ユーザーがJarvisとチャットできる。
2. ユーザーが明示的に許可した情報だけを記憶として保存できる。
3. 保存した記憶を検索し、根拠を示して回答に利用できる。
4. 「自分らしい／違う」というフィードバックを記録できる。
5. ローカルLLMを優先し、必要な場合だけクラウドAPIへ切り替えられる。

### MVPに含める候補

- シンプルなチャットUI
- 最小限のバックエンドAPI
- ローカルLLM接続（例：Ollama）
- 任意のクラウドLLM接続
- SQLiteまたはMarkdownによるローカル記憶
- 記憶の検索、出典表示、編集、削除
- 明示的な記憶保存とフィードバック
- 最低限のユニットテスト

### MVPに含めないもの

- 無制限に自律実行するエージェント
- OSレベルの常駐処理や勝手な定期実行
- IoT機器の操作
- 多数の外部サービス連携
- 音声クローンや意識の再現
- 複雑なMulti-Agentフレームワーク
- リリース自動化やパッケージ配布

## 設計原則

- **Local first:** 個人情報と記憶は原則ローカルに保存する。
- **Explicit consent:** 保存、外部送信、実行はユーザーの明示的な許可を境界にする。
- **Understandable:** ゆーりが説明できない仕組みを安易に追加しない。
- **Small vertical slices:** UIだけ、基盤だけではなく、小さくても一連の価値が動く単位で作る。
- **Replaceable providers:** LLMや保存先を交換可能にし、特定サービスへ密結合しない。
- **Evidence before autonomy:** 自律化はログ、評価、失敗時の停止方法が揃ってから行う。

## Roadmap

### Phase 0: Foundation

- 要件とMVP境界の確定
- 技術スタックの選定
- ローカル起動手順と最小テストの整備
- 秘密情報と個人データの管理方針の確定

### Phase 1: Digital Twin — `feat/digital-twin`

- 会話履歴と明示的な長期記憶
- プロフィール、価値観、好み、判断傾向の管理
- 記憶を参照した回答と根拠表示
- フィードバックによる振る舞いの改善
- 記憶の閲覧、訂正、削除、エクスポート

### Phase 2: Dashboard Design — `design/dashboard`

- Jarvisの状態、記憶、権限、実行履歴の可視化
- Control Center UIの再設計
- コスト、ローカル／クラウド利用状況、エラーの確認

### Phase 3: IoT — `feat/iot`

- 明示的に許可した機器との接続
- 操作前確認、監査ログ、緊急停止
- 読み取り専用から段階的に操作権限を拡張

## Codexを使った開発

このプロジェクトではCodexを共同開発者として利用します。ただし、Git履歴と公開操作の最終責任はゆーりが持ちます。

- Codexは調査、提案、実装、ローカル検証を担当できます。
- ブランチ作成・切り替え、stage、commit、push、PR作成は、ゆーりの明示的な依頼がない限り行いません。
- 通常運用では、commitとpushはゆーりが実行します。
- Codexは作業後に変更ファイル、検証結果、推奨コミットメッセージを提示します。
- 詳細は[`CODEX.md`](CODEX.md)に従います。

### Codex Loop

複数日にまたがる実装、調査、QAなど、再開可能な進捗管理が必要な作業に限って`codex-loop` Skillを使用します。一回で終わる小さな修正には使用しません。

実行時は、有限のroundsまたは明確なgoalを指定します。無制限ループは使用しません。

```text
[[CODEX_LOOP name="digital-twin-mvp" rounds="3"]]
Use the codex-loop skill. Track the work under .codex/loop/digital-twin-mvp/.
```

### R&D Brain

機能を先に作るのではなく、EvidenceからPain、Opportunity、Idea、Critiqueへ変換する調査に`rd-brain` Skillを利用します。

```text
$rd-brain research 個人AIが長期記憶を安全に更新するために、既存製品では未解決のPainは何か？
```

R&D BrainのKnowledge Baseは既定では`~/.codex/rd-brain`にあり、このリポジトリには自動的に含まれません。個人情報を含む成果物は、明示的な確認なしにコピー、commit、公開しません。

## Git運用

安定版は`main`で管理し、開発は目的別ブランチで行います。

| 種別 | ブランチ | 例 |
| --- | --- | --- |
| 新機能 | `feat/<kebab-case>` | `feat/digital-twin` |
| バグ修正 | `fix/<kebab-case>` | `fix/memory-search` |
| UI/UX設計 | `design/<kebab-case>` | `design/dashboard` |
| リファクタリング | `refactor/<kebab-case>` | `refactor/provider-interface` |
| テスト | `test/<kebab-case>` | `test/memory-retrieval` |
| ドキュメント | `docs/<kebab-case>` | `docs/setup-guide` |
| 保守作業 | `chore/<kebab-case>` | `chore/update-dependencies` |
| 調査・実験 | `research/<kebab-case>` | `research/local-llm` |

ブランチ名には英小文字、数字、ハイフンを使用します。原則として一つのブランチには一つの目的だけを持たせます。

コミットメッセージには次の接頭辞を使用します。

```text
feat: 長期記憶の保存機能を追加
fix: 空の会話で検索が失敗する問題を修正
design: ダッシュボードのレイアウトを更新
refactor: LLMプロバイダー境界を整理
test: 記憶検索のテストを追加
docs: ローカル起動手順を追加
chore: 開発依存を更新
research: ローカルモデル比較を記録
```

## GitHub Actions方針

- MVP初期は定期実行を導入しません。
- CIを導入する場合は、Pull Requestまたは手動実行から始めます。
- cron、外部公開、release、package publishを行うWorkflowは、ゆーりの明示的な承認が必要です。
- 外部APIや有料リソースを使うWorkflowは、費用上限と停止方法を先に文書化します。
