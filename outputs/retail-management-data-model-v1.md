# 小売向け店舗マネジメントアプリ データモデル v1（単店舗先行・store_id将来対応）

最終更新: 2026-09-06  
この定義は画面仕様 v1（`retail-management-screen-spec-v1.md`）に対応する。

## 1. 設計方針
- 単店舗運用を前提に起動し、すべての実体テーブルに `store_id` を保持できる構造とする。
- `created_at / updated_at / created_by / updated_by` を全テーブルで基本付与。
- 監査要件のため、主要更新系テーブルは**監査イベント**（`audit_logs`）を必ず記録。
- 将来の店舗横断比較・多店舗化のため、共通マスタは可能な限り `company_id` ではなく `store_id` 非依存にする。

## 2. ER（テーブル定義）

### 2.1 組織 / 認証系
#### `stores`
- `id` (PK, UUID)
- `name` (string, 必須)
- `code` (string, UNIQUE)
- `timezone` (string)
- `currency` (string)
- `tax_default_rate` (decimal)
- `is_active` (boolean)
- `created_at / updated_at`

#### `users`
- `id` (PK, UUID)
- `email` (string, UNIQUE)
- `password_hash` (string)
- `name` (string)
- `status` (enum: active, suspended)
- `mfa_enabled` (boolean)
- `last_login_at` (datetime)
- `created_at / updated_at`

#### `roles`
- `id` (PK, int)
- `code` (enum: OWNER, MANAGER, STAFF, VIEWER, required unique)
- `label` (string)

#### `user_roles`
- `id` (PK, UUID)
- `user_id` (FK -> users.id)
- `store_id` (FK -> stores.id)
- `role_id` (FK -> roles.id)
- `valid_from` / `valid_to`
- `created_at`

#### `user_permissions_override`（将来拡張）
- `id` (PK, UUID)
- `user_id` (FK -> users.id)
- `permission_key` (string)
- `scope` (enum: global, store)
- `scope_id` (UUID nullable)
- `is_allowed` (boolean)

### 2.2 マスタ系
#### `master_categories`
- `id` (PK)
- `domain` (enum: product_category, expense_category, payment_method, cost_type)
- `name` (string)
- `is_active` (boolean)
- `display_order` (int)
- `is_fixed_cost` (boolean, domain=expense_category 時)
- `tax_rate` (decimal, domain=product_category 時)
- `created_at / updated_at`

#### `suppliers`
- `id` (PK)
- `name` (string, 必須)
- `contact_name` (string)
- `phone` (string)
- `email` (string)
- `lead_time_days` (int)
- `notes` (string)
- `is_active` (boolean)
- `store_id` (FK -> stores.id)
- `created_at / updated_at`

#### `products`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `sku` (string, UNIQUE store_id + sku)
- `name` (string)
- `category_id` (FK -> master_categories.id)
- `cost_price` (decimal)
- `sell_price` (decimal)
- `tax_rate` (decimal)
- `min_stock` (decimal)
- `unit` (string)
- `shelf_location` (string)
- `is_active` (boolean)
- `created_at / updated_at`

### 2.3 売上 / POS連携
#### `sales_transactions`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `transaction_no` (string, UNIQUE)
- `external_transaction_id` (string)
- `terminal_id` (string)
- `staff_id` (FK -> users.id, nullable)
- `occurred_at` (datetime)
- `subtotal` (decimal)
- `tax_amount` (decimal)
- `discount_amount` (decimal)
- `total_amount` (decimal)
- `is_refund` (boolean)
- `status` (enum: pending, imported, posted, corrected, cancelled)
- `source` (enum: pos_api, manual)
- `created_at / updated_at`

#### `sales_transaction_items`
- `id` (PK)
- `sales_transaction_id` (FK -> sales_transactions.id)
- `product_id` (FK -> products.id)
- `quantity` (decimal)
- `unit_price` (decimal)
- `line_discount` (decimal)
- `tax_amount` (decimal)
- `line_total` (decimal)

#### `sales_payments`
- `id` (PK)
- `sales_transaction_id` (FK -> sales_transactions.id)
- `method_category_id` (FK -> master_categories.id, domain=payment_method)
- `amount` (decimal)

#### `pos_ingest_logs`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `payload` (json)
- `source_key` (string)  *(transaction_id + line_key などの冪等キー)*
- `request_id` (string)
- `status` (enum: received, processed, failed, retrying, duplicated)
- `error_code` (string)
- `error_message` (text)
- `processed_at` (datetime)
- `received_at` (datetime)

### 2.4 在庫
#### `inventory_stocks`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `product_id` (FK -> products.id)
- `on_hand_qty` (decimal)
- `reserved_qty` (decimal)
- `available_qty` (computed: on_hand - reserved)
- `last_movement_at` (datetime)
- `expiry_date` (date, nullable)

#### `inventory_movements`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `product_id` (FK -> products.id)
- `movement_type` (enum: in, out, return_adjust, stocktake_adjust, transfer_in, transfer_out)
- `qty` (decimal)
- `related_transaction_type` (enum: sales_transaction, purchase_receipt, manual_adjustment, transfer)
- `related_transaction_id` (string)
- `reason` (string)
- `occurred_at` (datetime)
- `created_by` (FK -> users.id)
- `approved_by` (FK -> users.id, nullable)
- `notes` (text)

#### `stock_adjustments`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `product_id` (FK -> products.id)
- `counted_qty` (decimal)
- `system_qty` (decimal)
- `diff_qty` (decimal)
- `status` (enum: draft, submitted, approved, applied)
- `reason_code` (string)
- `approver_id` (FK -> users.id, nullable)
- `counted_at` (datetime)

### 2.5 仕入
#### `purchase_orders`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `supplier_id` (FK -> suppliers.id)
- `order_no` (string)
- `ordered_at` (datetime)
- `status` (enum: ordered, partially_received, received, cancelled)
- `total_amount` (decimal)
- `expected_delivery_date` (date)
- `created_by` (FK -> users.id)

#### `purchase_items`
- `id` (PK)
- `purchase_order_id` (FK -> purchase_orders.id)
- `product_id` (FK -> products.id)
- `quantity_ordered` (decimal)
- `quantity_received` (decimal)
- `unit_cost` (decimal)
- `line_total` (decimal)
- `expiry_date` (date, nullable)

### 2.6 スタッフ / 労務
#### `staff_schedules`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `user_id` (FK -> users.id)
- `work_date` (date)
- `start_at` (time)
- `end_at` (time)
- `break_minutes` (int)
- `status` (enum: planned, confirmed, absent)
- `created_by` (FK -> users.id)

#### `attendance_records`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `user_id` (FK -> users.id)
- `clock_in_at` (datetime)
- `clock_out_at` (datetime)
- `approved_at` (datetime, nullable)
- `approved_by` (FK -> users.id, nullable)
- `memo` (text)
- `source` (enum: terminal, manual)

#### `hourly_wage_rates`
- `id` (PK)
- `user_id` (FK -> users.id)
- `store_id` (FK -> stores.id)
- `rate` (decimal)
- `valid_from` (date)
- `valid_to` (date, nullable)

### 2.7 経費 / 損益
#### `expenses`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `category_id` (FK -> master_categories.id, domain=expense_category)
- `spent_at` (datetime)
- `amount` (decimal)
- `vendor` (string)
- `memo` (text)
- `has_receipt` (boolean)
- `status` (enum: pending, approved, rejected)
- `requested_by` (FK -> users.id)
- `approved_by` (FK -> users.id, nullable)

#### `monthly_closings`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `target_month` (char(7))  *YYYY-MM*
- `status` (enum: open, locked)
- `locked_at` (datetime, nullable)
- `locked_by` (FK -> users.id, nullable)
- `closed_at` (datetime, nullable)

### 2.8 監査
#### `audit_logs`
- `id` (PK)
- `store_id` (FK -> stores.id)
- `user_id` (FK -> users.id)
- `entity_type` (string)
- `entity_id` (string)
- `action` (enum: create, update, delete, approve, lock, unlock)
- `before_json` (json)
- `after_json` (json)
- `ip_address` (string)
- `created_at` (datetime)

## 3. 主要整合性ルール
- 売上が `sales_transactions` 登録されると、`inventory_movements` の出庫と在庫計算に反映される（自動トランザクション）
- `is_refund = true` の売上は `inventory_movements` を逆方向で反映
- `stock_adjustments.status = approved` で `inventory_stocks` 更新
- `monthly_closings.status = locked` の月は `sales_transactions / expenses / attendance_records / inventory_movements` の訂正を原則禁止
- `pos_ingest_logs.source_key` は重複送信時の冪等キーとして利用（同一キーは再処理を抑止）

## 4. インデックス（最初に必須）
- `sales_transactions(store_id, occurred_at)` / `sales_transactions(external_transaction_id)`
- `sales_transaction_items(sales_transaction_id)`
- `inventory_stocks(store_id, product_id)` UNIQUE
- `inventory_movements(store_id, product_id, occurred_at)`
- `attendance_records(store_id, user_id, clock_in_at)`
- `staff_schedules(store_id, user_id, work_date)`
- `expenses(store_id, spent_at)`
- `monthly_closings(store_id, target_month)` UNIQUE

## 5. API設計への入力としてのキー
- `store_id` はすべてのクエリで必須条件（単店舗時は内部固定値）
- 取込イベントは `source_key` を使って idempotency を担保
- 集計系は `monthly_closings.status` を考慮し、ロック月は読み取りのみ
- 監査対象は create/update/delete/approve/lock/unlock の5系統を必須記録
