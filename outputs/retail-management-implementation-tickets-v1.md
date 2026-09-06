# 小売向け店舗マネジメントアプリ 実装チケット v1

最終更新: 2026-09-06  
画面仕様 v1 + データモデル v1 を起点に、優先度順で実装化するための最小チケット。

## 共通前提
- 対応画面のルートは `screens`、APIは `api/<domain>/<action>` を想定
- 認証: メール/パスワード + 初期はメールOTP
- ロール: OWNER / MANAGER / STAFF / VIEWER
- 全APIに `store_id` フィルタ（単店舗時は既定値）
- 主要更新系は `audit_logs` を必ず書込

---

## Epic A: 基盤

### A1. ログイン・認証
- 画面: `/auth/login`
- API
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `POST /api/auth/otp/send`
  - `POST /api/auth/otp/verify`
- DB: `users`, `user_roles`, `stores`, `audit_logs`
- 割合: 重要 / 優先度: 最優先
- 完了条件: ロールに応じた画面遷移、セッション維持、ログイン失敗時の監査記録

### A2. 認可/共通フィルタ
- 画面: 全画面
- API
  - `GET /api/me`
  - 各APIで権限制御ミドルウェア
- DB: `roles`, `user_roles`, `user_permissions_override`, `audit_logs`
- 完了条件: 画面単位・ボタン単位の表示制御、越権拒否

### A3. 監査基盤
- 画面: `/settings/audit-logs`
- API
  - `GET /api/audit-logs`
  - `GET /api/audit-logs/:id`
- DB: `audit_logs`
- 完了条件: 変更前後の差分保存、時系列検索、フィルタ動作

---

## Epic B: 売上（POSコア）

### B1. POS受信ロガー
- 画面: `/sales/import`
- API
  - `POST /api/pos/ingest`
  - `GET /api/pos/import-logs`
  - `POST /api/pos/import-logs/:id/retry`
- DB: `pos_ingest_logs`, `sales_transactions`, `sales_transaction_items`, `sales_payments`
- 完了条件: 冪等キー処理、再送、失敗理由の表示、再取得成功

### B2. 売上取引一覧・詳細
- 画面: `/sales/transactions`
- API
  - `GET /api/sales/transactions`
  - `GET /api/sales/transactions/:id`
  - `POST /api/sales/transactions/:id/correct` *(訂正申請)*
- DB: `sales_transactions`, `sales_transaction_items`, `sales_payments`, `audit_logs`
- 完了条件: 編集不可表示、訂正申請フローの生成

### B3. 売上集計
- 画面: `/sales/summary`
- API
  - `GET /api/sales/summary`
  - `GET /api/sales/kpi`
  - `GET /api/sales/export?format=csv`
- DB: `sales_transactions`, `sales_transaction_items`, `sales_payments`
- 完了条件: 日次/週次/月次切替、カテゴリ/スタッフ/決済で絞り込み

---

## Epic C: 在庫・仕入

### C1. 商品マスタ
- 画面: `/inventory/products`
- API
  - `GET /api/products`
  - `POST /api/products`
  - `PATCH /api/products/:id`
  - `PATCH /api/products/:id/toggle-active`
  - `POST /api/products/import`
- DB: `products`, `master_categories`
- 完了条件: SKU一意性、価格変更履歴保存（監査あり）

### C2. 在庫一覧・アラート
- 画面: `/inventory/list`
- API
  - `GET /api/inventory/stocks`
  - `GET /api/inventory/alerts`
- DB: `inventory_stocks`, `products`
- 完了条件: 利用可能在庫算出、低在庫・期限警告表示

### C3. 入出庫
- 画面: `/inventory/movements`
- API
  - `GET /api/inventory/movements`
  - `POST /api/inventory/movements`
- DB: `inventory_movements`, `inventory_stocks`, `sales_transactions`
- 完了条件: 売上連動自動引き当て、手入力監査

### C4. 棚卸
- 画面: `/inventory/count`
- API
  - `POST /api/inventory/counts`
  - `GET /api/inventory/counts`
  - `PATCH /api/inventory/counts/:id/approve`
- DB: `stock_adjustments`, `inventory_stocks`, `audit_logs`
- 完了条件: 差分レビュー→承認→反映

### C5. 仕入先
- 画面: `/procurement/suppliers`
- API
  - `GET /api/suppliers`
  - `POST /api/suppliers`
  - `PATCH /api/suppliers/:id`
- DB: `suppliers`
- 完了条件: 停止フラグ反映、発注との連携土台

### C6. 仕入履歴
- 画面: `/procurement/purchases`
- API
  - `GET /api/purchases`
  - `POST /api/purchases`
  - `PATCH /api/purchases/:id/receive`
  - `GET /api/purchases/:id/items`
- DB: `purchase_orders`, `purchase_items`, `inventory_movements`
- 完了条件: 受領率計算、未入庫アラート

---

## Epic D: スタッフ

### D1. シフト
- 画面: `/staff/schedule`
- API
  - `GET /api/staff/schedules`
  - `POST /api/staff/schedules`
  - `PATCH /api/staff/schedules/:id`
  - `DELETE /api/staff/schedules/:id`
- DB: `staff_schedules`, `users`
- 完了条件: 時間重複チェック、月次表示

### D2. 勤務実績
- 画面: `/staff/attendance`
- API
  - `GET /api/staff/attendance`
  - `POST /api/staff/attendance`
  - `PATCH /api/staff/attendance/:id/approve`
- DB: `attendance_records`, `users`
- 完了条件: 実働/残業自動算定、承認履歴

### D3. 人件費
- 画面: `/staff/payroll`
- API
  - `GET /api/staff/payroll`
  - `POST /api/staff/wage-rates`
  - `PATCH /api/staff/wage-rates/:id`
- DB: `hourly_wage_rates`, `attendance_records`, `users`
- 完了条件: 人別・日別・時給別集計、店長承認要否

---

## Epic E: 経費・会計

### E1. 経費入力
- 画面: `/expenses/entries`
- API
  - `GET /api/expenses`
  - `POST /api/expenses`
  - `PATCH /api/expenses/:id/approve`
- DB: `expenses`, `master_categories`
- 完了条件: 月次PLへの即時集計反映、承認フロー

### E2. 経費カテゴリ
- 画面: `/expenses/categories`
- API
  - `GET /api/expense-categories`
  - `POST /api/expense-categories`
  - `PATCH /api/expense-categories/:id`
- DB: `master_categories`
- 完了条件: 固定費/変動費定義反映

### E3. 月次損益
- 画面: `/reports/pnl`
- API
  - `GET /api/reports/pnl`
- `POST /api/reports/month-close`  
  - `POST /api/reports/month-unlock`  
- DB: `monthly_closings`, `sales_transactions`, `expenses`, `attendance_records`, `expenses`, `products`
- 完了条件: 月次ロック、ロック時の編集制御

---

## Epic F: KPI・比較

### F1. KPI
- 画面: `/reports/kpi`
- API
  - `GET /api/reports/kpi`
- DB: `sales_transactions`, `inventory_stocks`, `expenses`, `attendance_records`
- 完了条件: 粗利率/在庫回転率/欠品率/返品率/人件費率の表示

### F2. 店舗比較（将来）
- 画面: `/reports/store-comparison`
- API
  - `GET /api/reports/stores/comparison`
- DB: 上記共通テーブル（`store_id` 集計）
- 完了条件: 単店舗時は非表示、データ基盤は準備済み

---

## 実装順（推奨）
1. A1 → A2 → A3  
2. B1 → B2 → B3  
3. C1 → C2 → C3 → C4  
4. D1 → D2 → D3  
5. E1 → E2 → E3  
6. F1 → F2

## スプリント割当（目安）
- Sprint 1: A1, A2, B1, B2, B3
- Sprint 2: C1, C2, C3, D1, D2
- Sprint 3: D3, E1, E2, E3
- Sprint 4: C4, C5, C6, F1
- Sprint 5: F2（将来向け）

