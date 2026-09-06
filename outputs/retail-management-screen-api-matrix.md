# 画面別API要件マトリクス（MVP）

最終更新: 2026-09-07  
基準: `screen-spec-final` と `implementation-tickets-v1` を統合。`openapi.yaml` の現状を踏襲しつつ不足分を明記。

## 表記

- レベル: P0=必須 / P1=重要 / P2=将来
- 権限: O=OWNER, M=MANAGER, S=STAFF, V=VIEWER
- `store_id` は全APIに原則必須（単店舗時は固定値）

## 1. 認証・共通

| 画面 | API | method | 説明 | 権限 | 優先度 |
|---|---|---|---|---|---|
| 全画面 | `/api/auth/login` | POST | 認証 | O/M/S/V | P0 |
| 全画面 | `/api/auth/logout` | POST | ログアウト | O/M/S/V | P0 |
| 全画面 | `/api/auth/otp/send` | POST | OTP発行 | V/O/M/S | P1 |
| 全画面 | `/api/auth/otp/verify` | POST | OTP検証 | V/O/M/S | P1 |
| 全画面 | `/api/me` | GET | 自分の状態取得 | O/M/S/V | P0 |
| 全画面 | `/api/audit-logs` | GET | 監査検索 | O/M | P0 |
| 全画面 | `/api/audit-logs/:id` | GET | 監査詳細 | O/M | P1 |

## 2. ダッシュボード/画面ヘッダ

| 画面 | API | method | 説明 | 権限 | 優先度 |
|---|---|---|---|---|---|
| `/` | `/api/dashboard/today` | GET | 当日サマリ | O/M/S/V | P0 |
| `/` | `/api/dashboard/alerts` | GET | アラート一覧 | O/M/S/V | P0 |
| 全体 | `/api/reports/kpi`（ヘッダ表示のみ） | GET | 本日KPI取得 | O/M/S/V | P1 |

## 3. 売上

| 画面 | API | method | 説明 | 権限 | 優先度 |
|---|---|---|---|---|---|
| `/sales/import` | `/api/pos/import-logs` | GET | 取り込み監査検索 | O/M | P0 |
| `/sales/import` | `/api/pos/import-logs/:id/retry` | POST | 再試行 | O/M | P0 |
| `/sales/import` | `/api/pos/ingest` | POST | POS取り込み | O/M | P0 |
| `/sales/transactions` | `/api/sales/transactions` | GET | 取引一覧 | O/M/V | P0 |
| `/sales/transactions/:id` | `/api/sales/transactions/:id` | GET | 明細取得 | O/M/V | P0 |
| `/sales/transactions` | `/api/sales/transactions/:id/correct` | POST | 訂正申請 | O/M | P0 |
| `/sales/summary` | `/api/sales/summary` | GET | 期間集計 | O/M/V | P0 |

## 4. 在庫

| 画面 | API | method | 説明 | 権限 | 優先度 |
|---|---|---|---|---|---|
| `/inventory/products` | `/api/products` | GET | 商品検索/一覧 | O/M/V | P0 |
| `/inventory/products` | `/api/products` | POST | 商品新規 | O/M | P0 |
| `/inventory/products/:id` | `/api/products/:id` | PATCH | 商品更新 | O/M | P0 |
| `/inventory/products/:id/toggle-active` | `/api/products/:id/toggle-active` | PATCH | 非アクティブ化 | O/M | P0 |
| `/inventory/products/import` | `/api/products/import` | POST | CSV取込 | O/M | P1 |
| `/inventory/list` | `/api/inventory/stocks` | GET | 在庫一覧 | O/M/S/V | P0 |
| `/inventory/list` | `/api/inventory/alerts` | GET | アラート一覧 | O/M/S/V | P0 |
| `/inventory/movements` | `/api/inventory/movements` | GET | 入出庫一覧 | O/M/S/V | P0 |
| `/inventory/movements` | `/api/inventory/movements` | POST | 手入力補正 | O/M | P0 |
| `/inventory/count` | `/api/inventory/counts` | GET | 棚卸履歴 | O/M/S/V | P1 |
| `/inventory/count` | `/api/inventory/counts` | POST | 棚卸開始/登録 | O/M | P0 |
| `/inventory/count/:id/approve` | `/api/inventory/counts/:id/approve` | PATCH | 棚卸承認 | O/M | P0 |

## 5. スタッフ・労務

| 画面 | API | method | 説明 | 権限 | 優先度 |
|---|---|---|---|---|---|
| `/staff/schedule` | `/api/staff/schedules` | GET | シフト一覧 | O/M/S | P0 |
| `/staff/schedule` | `/api/staff/schedules` | POST | シフト登録 | O/M | P0 |
| `/staff/schedule` | `/api/staff/schedules/:id` | PATCH | シフト更新 | O/M | P0 |
| `/staff/attendance` | `/api/staff/attendance` | GET | 勤務実績一覧 | O/M/S | P0 |
| `/staff/attendance` | `/api/staff/attendance` | POST | 勤務入力 | O/M/S | P1 |
| `/staff/attendance/:id/approve` | `/api/staff/attendance/:id/approve` | PATCH | 承認 | O/M | P0 |
| `/staff/payroll` | `/api/staff/payroll` | GET | 人件費集計 | O/M | P1 |

## 6. 経費・会計

| 画面 | API | method | 説明 | 権限 | 優先度 |
|---|---|---|---|---|---|
| `/expenses/entries` | `/api/expenses` | GET | 経費一覧 | O/M/S | P0 |
| `/expenses/entries` | `/api/expenses` | POST | 経費登録 | O/M/S | P0 |
| `/expenses/entries` | `/api/expenses/:id/approve` | PATCH | 経費承認 | O/M | P0 |
| `/expenses/categories` | `/api/expense-categories` | GET | 経費科目一覧 | O/M | P1 |
| `/expenses/categories` | `/api/expense-categories` | POST | 科目追加 | O | P1 |
| `/reports/pnl` | `/api/reports/pnl` | GET | 月次損益取得 | O/M | P0 |
| `/reports/pnl` | `/api/reports/month-close` | POST | 月次ロック | O/M | P0 |
| `/reports/pnl` | `/api/reports/month-unlock` | POST | 月次解除 | O | P1 |

## 7. 将来（将来リリース）

| 画面 | API | method | 説明 | 権限 | 優先度 |
|---|---|---|---|---|---|
| `/reports/store-comparison` | `/api/reports/stores/comparison` | GET | 店舗比較 | O/M | P2 |
| `/inventory/stock-cross` | `/api/inventory/cross-stores` | GET | 店舗横断在庫 | O/M | P2 |

## 8. openapiとの差分（実装前提）

- 追加必須（未存在）
  - `/api/dashboard/*`
  - `/api/products/:id` / `/api/products/:id/toggle-active` / `/api/products/import`
  - `/api/inventory/alerts`
  - `/api/inventory/cross-stores`
  - `/api/reports/stores/comparison`
  - `/api/staff/payroll`

- 確認要（既存未記載可能性）
  - `/api/reports/kpi` のレスポンス項目（画面のKPI目標との整合）
  - `/api/pos/import-logs` の `retry_count` / 担当者アサイン項目

## 9. 受入基準（画面別）

- 各画面は、最小1件のGET一覧APIが正常に表示、対象アクションAPIが権限制御されること
- 店舗外部キーがないデータ更新APIはエラーにならないこと（422/403で明確化）
- `store_id` 未指定時の400エラーを返すこと（将来の複数店舗時代まで）
