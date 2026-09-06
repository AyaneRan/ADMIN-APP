# 小売向け店舗経営アプリ 画面仕様・実装プレイブック（単店舗→多店舗）

最終更新: 2026-09-07  
本書は **画面設計（ワイヤー/遷移）** と **API実装順（開発タスク）** を同時に確定し、実装開始可能な状態にするための実行仕様です。

## 0. 前提

- 目的: 単店舗運用を最短で成立させる（POP連携を最優先）
- 今期対象: `P0`（必須）→ `P1`（有効化）を中心に実装
- 多店舗拡張: スキーマ/監査/集計の土台は最初から `store_id` 前提。  
  単店舗では画面自体を非表示（Feature Flag）にし、API互換を保つ。
- 権限:
  - OWNER: 全権限
  - MANAGER: 業務系画面の更新、承認
  - STAFF: 入力系中心、承認は不可
  - VIEWER: 参照のみ

## 1. 画面仕様（MVP確定）

### 1.1 コアレイアウト（確定）

- 左サイドバー + 上部バー（運用中枢）
- 上部バー:
  - 日付/営業日
  - 店舗名（単店舗時は固定）
  - 更新系アクションの失敗通知バナー
- 全画面共通:
  - `403 / 409 / 422` のエラーを画面内通知
  - 監査対象APIは実行時にトースト通知

### 1.2 画面一覧（v1）

| 区分 | 画面 | 説明 |
|---|---|---|
| 監視 | `/` | ダッシュボード（当日KPI + アラート） |
| 売上 | `/sales/import` | POS取り込み監査（再処理起点） |
| 売上 | `/sales/transactions` | 取引一覧（検証） |
| 売上 | `/sales/transactions/:id` | 取引明細（変更不可、訂正申請） |
| 売上 | `/sales/summary` | 日次/週次/月次集計 |
| 在庫 | `/inventory/products` | 商品登録・編集・CSV取込 |
| 在庫 | `/inventory/list` | 在庫一覧（閾値アラート） |
| 在庫 | `/inventory/movements` | 入出庫・補正入力 |
| 在庫 | `/inventory/count` | 棚卸の差分確定/承認 |
| 人材 | `/staff/schedule` | シフト登録・編集 |
| 人材 | `/staff/attendance` | 勤怠入力・勤務時間 |
| 経費 | `/expenses/entries` | 経費申請 |
| レポート | `/reports/pnl` | 月次損益 |
| レポート | `/reports/kpi` | KPI表示（粗利率等） |
| レポート | `/settings/audit-logs` | 監査履歴検索 |
| 設定（将来） | `/reports/store-comparison` | 店舗比較（将来） |
| 設定（将来） | `/inventory/stock-cross` | 店舗横断在庫（将来） |

### 1.3 画面ワイヤー（固定）

- **`/`（Dashboard）**
  - 左上: 店舗情報＋営業日
  - 上段カード: 本日売上 / 粗利 / 注文件数
  - 中段2列: 取り込み失敗件数、欠品リスク件数
  - 右下: 当日シフト充足率・月次ロック状態

- **`/sales/import`（POP運用画面）**
  - フィルタ: 期間、状態、端末
  - テーブル: 取引ID / 時刻 / 端末 / ステータス / Retry / エラー
  - 行アクション: 再処理、取引詳細

- **`/inventory/list`（在庫運用画面）**
  - テーブル: 商品名 / 在庫 / 予約 / 利用可能 / 最低在庫との差分
  - カード: 期限切れ近接、アラート件数
  - 行アクション: 補正入力、棚卸導線

### 1.4 画面遷移（確定）

- 売上監視導線  
  `/` → `/sales/import` → `/sales/transactions` → `/sales/transactions/:id` → `/sales/summary`
- 在庫導線  
  `/` → `/inventory/products` → `/inventory/list` → `/inventory/movements` または `/inventory/count`
- 経理導線  
  `/` → `/expenses/entries` → `/reports/pnl` → `/settings/audit-logs`
- 人材導線  
  `/` → `/staff/schedule` → `/staff/attendance` → 承認完了

### 1.5 P0 / P1 / P2 と表示制御

- P0（初回公開）: 認証, ダッシュボード, `/sales/import`, `/sales/transactions*`, `/sales/summary`, `/inventory/products`, `/inventory/list`, `/inventory/movements`, `/staff/schedule`, `/staff/attendance`, `/expenses/entries`, `/reports/pnl`, `/reports/kpi`
- P1（短期追加）: `/inventory/count`, `/staff/payroll`, `/expense-categories`, `/dashboard/alerts`
- P2（将来）：`/reports/store-comparison`, `/inventory/stock-cross`（単店舗は非表示）

## 2. API実装順（開発計画）

### 2.1 スプリント0（Day0, 基盤）

1) 認証基盤
- `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/otp/send`, `POST /api/auth/otp/verify`
- `GET /api/me`, `GET /api/audit-logs`, `GET /api/audit-logs/{id}`

2) 共通基盤
- `GET /api/dashboard/today`, `GET /api/dashboard/alerts`
- エラー共通レスポンス、権限ミドルウェア、`store_id`強制、監査書き込み

### 2.2 スプリント1（Sales Core）

- `POST /api/pos/ingest`
- `GET /api/pos/import-logs`
- `POST /api/pos/import-logs/{id}/retry`
- `GET /api/sales/transactions`
- `GET /api/sales/transactions/{id}`
- `POST /api/sales/transactions/{id}/correct`
- `GET /api/sales/summary`
- `GET /api/sales/export`  

**完成条件:**  
POS取り込み失敗の可視化、再処理再試行、取引明細検証まで完了。

### 2.3 スプリント2（Inventory Core）

- `GET /api/products`, `POST /api/products`, `PATCH /api/products/{id}`
- `PATCH /api/products/{id}/toggle-active`, `POST /api/products/import`
- `GET /api/inventory/stocks`, `GET /api/inventory/alerts`
- `GET /api/inventory/movements`, `POST /api/inventory/movements`
- `GET /api/inventory/counts`, `POST /api/inventory/counts`
- `PATCH /api/inventory/counts/{id}/approve`

**完成条件:**  
商品登録→在庫表示→補正入力→棚卸承認の1サイクル成立。

### 2.4 スプリント3（Human + 勤怠）

- `GET /api/staff/schedules`, `POST /api/staff/schedules`, `PATCH /api/staff/schedules/{id}`
- `GET /api/staff/attendance`, `POST /api/staff/attendance`
- `PATCH /api/staff/attendance/{id}/approve`
- `GET /api/staff/payroll`

**完成条件:**  
シフト作成と勤怠入力、承認フロー、月次の労務コスト反映。

### 2.5 スプリント4（Finance + Reports）

- `GET /api/expenses`, `POST /api/expenses`
- `PATCH /api/expenses/{id}/approve`
- `GET /api/expense-categories`, `POST /api/expense-categories`
- `GET /api/reports/pnl`
- `POST /api/reports/month-close`, `POST /api/reports/month-unlock`
- `GET /api/reports/kpi`

**完成条件:**  
経費申請→承認→月次損益表示→月次ロック/解除まで一気通しで成立。

### 2.6 スプリント5（将来）

- `GET /api/reports/stores/comparison`
- `GET /api/inventory/cross-stores`

## 3. 実装依存（失敗しにくい順序）

1. Foundation API（認証/権限/監査）を先に固定しないと、後続APIの品質が不安定になる  
2. 売上は日々の運用価値が高いため、在庫より先行  
3. 在庫は商品との整合を優先し、在庫一覧→補正→棚卸承認の順にする  
4. スタッフ/経費は営業運用で必要だが、初期リリース価値より順次導入  
5. 月次ロックは報告系の前提条件として `reports` は在庫・勤怠・経費の集約が揃ってから

## 4. 画面確定後の受け入れチェック（最小）

- `/sales/import` から再処理して、同じ取引の再取り込みステータスが遷移する
- `/inventory/list` で不足アラートが色付き表示される
- `/inventory/count` で差分の承認がなければ在庫反映されない
- `/reports/pnl` の月次ロック中は更新系APIが `409` を返し、説明文が表示される
- `store_id` なし更新系リクエストが全APIで 400/422 を返す

