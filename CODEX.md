# Codex Development Rules

この文書は、Jarvis v2でCodexを安全な共同開発者として使うためのプロジェクトルールです。要求が曖昧な場合は、変更範囲を広げず、必要な確認を行ってください。

## 1. 権限と責任

- プロダクトオーナーおよびGit履歴の管理者は、ゆーりです。
- Codexは、明示された範囲内で調査、提案、ファイル編集、ローカル検証を行えます。
- Codexは、ユーザーからその操作を明示的に依頼されない限り、Gitのブランチ作成・切り替え、stage、commit、push、merge、rebase、tag作成、Pull Request作成を行いません。
- 通常、commitとpushはゆーりが行います。Codexは推奨コミットメッセージを提示します。
- GitHub、クラウド、外部サービスに書き込む操作は、対象と結果を説明し、明示的な依頼を得てから行います。
- cron、GitHub Actionsのschedule、launchdなどの定期実行を勝手に作成・有効化しません。

## 2. 作業開始時

Codexは変更前に次を行います。

1. `AGENTS.md`とこの`CODEX.md`を読む。
2. `git status --short --branch`で現在のブランチと既存変更を確認する。
3. 関係する実装、テスト、ドキュメントを読む。
4. 要求の範囲と完了条件を短く整理する。
5. 大きな設計判断、外部依存の追加、個人データの扱いが曖昧なら、実装前に質問する。

既存の変更はユーザーの作業として扱い、上書き、削除、巻き戻しをしません。

## 3. 実装ルール

- MVPの範囲を優先し、要求されていない抽象化や機能を追加しません。
- ゆーりが理解・説明できる構成を優先します。複雑な選択をした場合は理由と代替案を説明します。
- 一度に一つの縦方向の機能を完成させます。
- 新しい依存パッケージ、外部API、データベース、フレームワークの追加は、必要性と運用負担を示して確認します。
- 秘密情報をコード、ログ、fixture、Markdownへ書きません。
- 個人の会話、記憶、プロフィールをfixtureや公開リポジトリへ入れません。
- 外部送信、ファイル削除、課金、デバイス操作につながる機能は、明示的な同意、監査ログ、停止方法を先に設計します。
- OpenJarvisなど外部コードを再利用する場合は、必要な部分だけを選び、ライセンスと帰属表示を確認します。

## 4. Gitブランチ

Codexがブランチ名を提案する場合は、英小文字のkebab-caseを使用します。

| 目的 | 形式 | 例 |
| --- | --- | --- |
| 新機能 | `feat/<name>` | `feat/digital-twin` |
| バグ修正 | `fix/<name>` | `fix/memory-search` |
| UI/UX | `design/<name>` | `design/dashboard` |
| リファクタリング | `refactor/<name>` | `refactor/provider-interface` |
| テスト | `test/<name>` | `test/memory-retrieval` |
| ドキュメント | `docs/<name>` | `docs/setup-guide` |
| 保守 | `chore/<name>` | `chore/update-dependencies` |
| 調査・実験 | `research/<name>` | `research/local-llm` |
| 開発自動化・AI駆動開発 | `automation/<name>` | `automation/codex-loop` |

- `main`は常に説明可能で、起動・テスト可能な状態を保ちます。
- 一つのブランチに複数の無関係な目的を混ぜません。
- Codexは現在のブランチが作業目的に合わない場合、勝手に切り替えず報告します。

## 5. コミットメッセージ

推奨形式は`<prefix>: <日本語または英語の要約>`です。

- `feat:` 新機能
- `fix:` バグ修正
- `design:` UI/UX変更
- `refactor:` 振る舞いを変えない整理
- `test:` テスト
- `docs:` 文書
- `chore:` 保守・設定
- `research:` 調査成果

要約は変更内容が分かる命令形または簡潔な現在形にします。一つのcommitに無関係な変更を混ぜません。

## 6. 検証と報告

Codexは作業後に、変更のリスクに応じた最小限の検証を行います。テストを実行できない場合は、実行していない理由を明示します。

最終報告には次を含めます。

- 何を変更したか
- 変更したファイル
- 実行した検証と結果
- 残っている問題または判断事項
- 推奨ブランチ名（必要な場合）
- 推奨コミットメッセージ

Codexはテスト未実行または失敗中の状態を、成功したものとして報告しません。

## 7. Codex Loop

`codex-loop`は、複数の作業単位を持ち、再開可能な追跡が必要な実装、QA、レビュー、改善ループに使用します。

- 一回で完了する変更には使用しません。
- 使用時は最初のプロンプト行に、`rounds`、`min`、`goal`のいずれか一つを持つActivation Headerを置きます。
- Jarvis v2では、原則として有限の`rounds`か検証可能な`goal`を使います。
- 追跡情報は`.codex/loop/<name>/`に保存します。
- Loop中も、この文書のGit・外部操作・個人データに関する制限を変更しません。
- Loopの終了は、テスト結果と追跡状態に基づいて判断し、時間切れだけを完了理由にしません。

例：

```text
[[CODEX_LOOP name="memory-mvp" goal="memory MVP is implemented, tests pass, and tracked tasks have no blockers"]]
Use the codex-loop skill. Track the work under .codex/loop/memory-mvp/.
```

## 8. R&D Brain

`rd-brain`は機能開発の代替ではなく、Evidence Firstの研究・アイデア検証に使用します。

- Research Questionは「何を検索するか」ではなく「何を明らかにするか」で定義します。
- Evidence、観察、推測、仮説、アイデアを分離します。
- 根拠が弱いPainは`LOW EVIDENCE`として扱います。
- ResearchからPain、Opportunity、Idea、Critique、Synthesisの順に変換します。
- R&D Brain自身のLoop Engineを新設せず、継続制御には既存の`codex-loop`を使用します。
- R&D Brainの成果をプロダクト要件へ反映する場合は、ゆーりの判断を挟みます。
- `~/.codex/rd-brain`の個人Knowledge Baseを、明示的な許可なくこのリポジトリへコピーまたは公開しません。

## 9. GitHub ActionsとAutomation

- 初期段階ではschedule triggerを使いません。
- CIはPull Requestまたは`workflow_dispatch`から始めます。
- 自動commit、release、package publish、外部サービスへの送信は禁止します。導入にはゆーりの明示的な承認が必要です。
- Workflow追加時は、起動条件、権限、Secret、費用、タイムアウト、停止方法をレビューします。
- 失敗中のWorkflowを、検証を弱めるだけで通しません。原因とMVPに必要かを先に判断します。

## 10. 禁止事項

明示的な依頼なしに、以下を行いません。

- `git reset --hard`、force push、履歴改変
- ユーザー変更の削除や破棄
- commit、push、merge、release
- ファイルやデータの大量削除
- 本番環境または外部アカウントへの変更
- 有料APIの有効化や継続的な呼び出し
- 個人データ、認証情報、調査Knowledge Baseの公開
- 自律エージェントへの無制限な権限付与

## 11. 判断に迷った場合

可逆でローカルな調査は進めて構いません。次の条件に当てはまる場合は停止して質問します。

- 結果が公開される
- 費用が発生する
- データが外部へ送信される
- Git履歴が変わる
- ユーザーデータが削除・移動される
- 複数の設計案でMVPの方向性が大きく変わる
