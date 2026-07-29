# アーキテクチャ

## 方針

Jarvis は、CLIから日常のタスクと情報検索を支援するローカルファーストのパーソナルAIアシスタントである。初期段階は単一のデプロイ可能なアプリケーションとして動かしつつ、内部では Feature ごとに責務と依存を分けるモジュラーモノリスを採用する。

モジュラーモノリスは、インフラと運用を小さく保ったまま、Featureの独立性を検証できるため採用する。Package by Feature は、変更理由・ユースケース・テストを近接させ、技術レイヤー横断の変更を避けるため採用する。

## 基本構成

```text
src/jarvis/
├── main.py
├── core/
└── features/
    ├── chat/
    ├── memory/
    └── tasks/
```

`main.py` はアプリケーションの組み立てとエントリーポイントの登録だけを担う。CLI と API は利用者向けの入出力層であり、同じ Feature Service を呼び出す。`core` は設定、共通の外部接続、横断的な例外・ログなど、Featureに属さない技術的基盤を担う。`features` は各ユースケース、データ所有、Feature固有の入出力変換を担う。

## Feature単位の配置規約

変更に必要なコンテキストを小さく保つため、コードは技術レイヤーではなくFeatureでまとめる。新規コードで、Feature横断の`api/`、`application/`、`domain/`、`storage/`のようなトップレベルディレクトリは作らない。

Featureは次のように、ユースケース単位で内部を分ける。必要な要素だけを置き、小規模なFeatureに空の雛形は作らない。

```text
features/<feature>/
├── shared/                    # そのFeature内だけで共有する型・エンティティ
├── <usecase>/
│   ├── <name>.pure.<ext>      # 副作用なしの計算・判定・変換
│   ├── <name>.io.<ext>        # DB、外部API、ファイルなどの入出力
│   └── <name>.usecase.<ext>   # IOとpureを組み合わせるユースケース
└── api.<ext> / cli.<ext>      # 必要な場合だけ。入口は薄く保つ
```

- `*.pure.*`は外部状態に依存しない。同じ入力に同じ出力を返し、Unit Testを近接させる。
- `*.io.*`はDB、Vector DB、LLM、ファイル、ネットワークなどの副作用を閉じ込める。secretや本文をログへ出さない。
- `*.usecase.*`は取得、判定、保存の順序とトランザクション境界を扱う。フレームワーク固有のrequest/response型を持ち込まない。
- APIやCLIは入力を検証してFeatureの公開usecaseを呼び、入出力へ変換するだけにする。

テーブル対応モデルなど複数Featureで使う技術的な型は`core`または明示的な共通境界に置く。Feature固有のモデル、Repository、promptを`core`へ集約しない。Feature間は相手の公開操作だけを参照し、内部の`shared`、IO、永続化実装を直接importしない。

既存コードを移行する間は、まず`src/features/<feature>/`へ物理的に集約してトップレベルの技術レイヤーを解消する。その後、変更頻度の高いユースケースから`pure`、`io`、`usecase`へ小さく分割する。別ランタイムの実装を一つのFeatureディレクトリに混在させない。

次の技術レイヤー別トップレベル構成は作らない。

```text
controllers/
services/
repositories/
models/
```

## 依存方向

```text
CLI / API
    ↓
Feature Router
    ↓
Feature Service
    ↓
Repository / External Adapter
    ↓
PostgreSQL / Vector DB / LLM
```

- 入出力層は Feature Service へ依存し、Service は FastAPI・Typer固有の型へ依存しない。
- Feature は必要な共通技術だけを `core` から利用できる。`core` は Featureのユースケースや個別モデルを知らない。
- Feature間は公開インターフェースを通じて連携する。相手の内部実装、Repository、内部DBモデルを直接参照しない。
- 循環依存は作らない。双方向連携が必要に見える場合は、責務の見直し、呼び出し元での合成、または明示的な公開契約を検討する。
- PostgreSQL、Vector DB、LLMなどの外部サービスは Adapter / Repository の外側に置き、Feature Serviceが接続詳細を持たないようにする。

## 拡張の判断

将来に切り出せるよう、Featureの公開境界とデータ所有を明確にする。ただし、独立デプロイ、メッセージブローカー、分散トランザクション、共通イベント基盤は、現在の単一プロセスでは必要になった時点で導入を判断する。

代表的な違反は、routerへの主要ロジック配置、Feature固有ロジックの`core`集約、他FeatureのRepository直接操作、技術レイヤー別トップレベル構成、循環importである。

設計の背景は、Package by Feature、純粋処理と副作用処理の分離、入口の薄さによって修正時のコンテキストを小さく保つことにある。参考: [AI時代のソフトウェアアーキテクチャ](https://zenn.dev/yosugi/articles/llm-friendly-architecture)
