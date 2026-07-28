# テスト方針

テストはFeature単位で整理する。横断的なテストは `tests/` 配下に置き、Feature固有の小さなUnit TestはFeature近傍にも置ける。規模と対象に応じて、`tests/unit/`、`tests/integration/`、`tests/contract/`、`tests/e2e/` を使い分ける。

| 種別 | 主な対象 |
| --- | --- |
| Unit Test | Serviceと決定的ロジック。外部依存はfakeまたはmockに置換する。 |
| Integration Test | PostgreSQL、Vector DB、Repository、migrationを含む境界。 |
| Contract Test | CLI/APIと共通Service、Feature公開インターフェース、外部Adapterの契約。 |
| E2E Test | 利用者の主要な縦方向フロー。必要な最小ケースに限る。 |

- CLIとAPIが同じFeature Serviceを利用し、同じユースケース結果になることを必要に応じて検証する。
- LLM実APIは通常のUnit Testから呼ばず、fakeまたはmockでStructured Output、検証失敗、fallbackを確認する。
- 呼び出し順などの内部実装ではなく、入力、出力、保存状態、観測可能な副作用を検証する。
- バグ修正には、再発を防ぐ最小の回帰テストを追加する。
- テストのしやすさを理由に本番コードへ不自然な公開APIや複雑な分岐を追加しない。
