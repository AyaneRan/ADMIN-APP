# retail-management-sprint1

小売向け店舗マネジメントアプリ（単店舗先行・将来マルチ対応）
Sprint1の仕様・設計・実装下書きをまとめたGit管理リポジトリです。

## 含まれるファイル
- outputs/retail-management-screen-spec-v1.md
- outputs/retail-management-screen-spec-final.md
- outputs/retail-management-data-model-v1.md
- outputs/retail-management-screen-flow-map.md
- outputs/retail-management-implementation-tickets-v2.md
- outputs/retail-management-one-page-summary.md
- outputs/retail-management-multistore-extension-spec.md
- outputs/retail-management-screen-api-matrix.md
- outputs/retail-management-implementation-tickets-v1.md
- outputs/retail-management-sprint1-openapi.yaml
- outputs/retail-management-sprint1-ddl.sql
- outputs/retail-management-sprint1-pos-flow.md
- outputs/retail-management-sprint1-pos-ingest-impl.ts
- outputs/retail-management-sprint1-sales-impl.ts
- outputs/retail-management-sprint1-ui-mock.md
- outputs/retail-management-sprint1-integration-guide.md

## Commit
- 33dfc21: 初回コミット（出力集約）
- b9359dc: Sprint1成果物10件を正規化して追加
- 画面仕様v2（確定版）追加（最新）

## GitHub 公開手順
このリポジトリの中身は既にコミット済みです。GitHubへ公開する場合は、以下を実行してください。

### 1) リモートを追加
```
git remote add origin https://github.com/<owner>/<repo>.git
git branch -M main
```

### 2) GitHubへPush
```
git push -u origin main
```

必要に応じて、トークン認証/HTTPS認証情報を用意してください。

### 3) この保存用スクリプト（任意）
PowerShell:
```
.\publish-to-github.ps1 -Owner "<owner>" -Repo "<repo>"

# 既存リポジトリにpush
.\publish-to-github.ps1 -Owner "my-github-id" -Repo "retail-management-sprint1"

# リポジトリが未作成なら作成してからpush（PAT必須）
.\publish-to-github.ps1 -Owner "my-github-id" -Repo "retail-management-sprint1" -CreateIfMissing -Token "<your_personal_access_token>"
```

`-CreateIfMissing` と `-Token` を付けると、存在しない場合に指定リポジトリを作成します。
