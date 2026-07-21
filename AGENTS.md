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
