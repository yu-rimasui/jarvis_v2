# Feature設計

## Featureの境界

Feature は、利用者に提供する一つ以上の関連ユースケースと、そのユースケースに必要なデータ・ルールを所有する単位である。変更理由、データ所有、公開インターフェースが独立しているなら、新規Featureとして分離を検討する。単にファイル数を減らすため、または将来の仮説だけを理由に分割しない。

Featureは自身のユースケース、データ操作、外部連携の解釈、Feature固有のプロンプトを所有する。他Featureのデータに必要な操作は、所有Featureの公開インターフェースへ依頼する。

## 内部構成

必要な要素だけをFeature内に置く。小規模Featureへ形式的なファイルを追加しない。

```text
features/chat/
├── router.py
├── models.py
└── service.py
```

複雑化した場合は、責務ごとに `cli.py`、`api.py`、`schemas.py`、`repository.py`、`prompts.py`、`tests/` などを追加できる。

| 要素 | 責務 |
| --- | --- |
| router / cli / api | 入力の受付、入出力変換、Service呼び出し。主要な業務判断は置かない。 |
| service | ユースケースの手順、Featureの業務ルール、依存先の合成。 |
| models | Featureが所有する永続化モデル。 |
| schemas | 外部・入出力契約。永続化の都合を不用意に公開しない。 |
| repository | Feature所有データの読書きと検索。 |
| prompts | Feature固有のプロンプト定義。 |

公開インターフェースは、他Featureが必要とする安定した操作だけに絞る。Feature間のimportはこの公開面に限り、相手の内部モデルやRepositoryへ直接依存しない。Feature間の循環依存は禁止する。

`utils.py` や `helpers.py` に無関係な処理を集約しない。Feature固有ロジックを`core`へ移さない。

## 初期Feature

- **Chat**: 入力受付、Memoryからの関連情報取得、プロンプト構築、LLM呼び出し、出力検証、会話履歴保存を担う。Vector DBを直接操作せず、Memoryの公開インターフェースを使う。
- **Memory**: 記憶保存、メタデータ管理、Embedding生成、検索インデックス登録、意味検索、更新・削除・再インデックスと原本整合を担う。
- **Tasks**: タスク登録、更新、完了、一覧、実行状態を担う。将来のスケジュール実行を理由に、分散キューやジョブ基盤を導入しない。
