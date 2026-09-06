# Sprint1: POS受信フロー（実装仕様）

最終更新: 2026-09-06

対象: `/api/pos/ingest` の処理と、売上/在庫の整合性保証

## 1. 受信前提
- リクエスト: `POST /api/pos/ingest`
- 認証: 内部端末キー or 管理者トークン
- 主要項目:
  - `storeId`, `terminalId`
  - `transactions[]`: `transactionId`, `occurredAt`, `isRefund`, `subtotal`, `taxAmount`, `discountAmount`, `totalAmount`, `payment[]`, `items[]`
- 冪等キー:
  - `sourceKey` がある場合は優先
  - 無い場合: `transactionId + lineNo + (first sku or productId)` を生成可能

## 2. エントリ処理
1. 受信時点で `pos_ingest_logs` へ1レコード作成
   - status=`received`
   - payload 全文保存
2. `sourceKey` 重複チェック
   - `sourceKey` が既存なら `duplicated` として確定
   - 重複対象でも監査ログに記録し 200/409 相当をレスポンス
3. `store_id` 検証（単店舗時は固定storeの許可範囲を検証）
4. 取引ごとの単体検証（型・必須・数値整合）
   - `subtotal` + `taxAmount` - `discountAmount` == `totalAmount`（丸め誤差許容0.01）
   - `items[].lineTotal` と `quantity*unitPrice - lineDiscount + taxAmount` の整合
   - 支払合計 = totalAmount

## 3. トランザクション内反映
`BEGIN`
1. `sales_transactions` の upsert
   - ユニークキー `store_id + external_transaction_id` を使用
   - 新規: `status = imported`
   - 更新: 既存未ロック月なら再計算
2. 明細/決済保存
   - `sales_transaction_items`, `sales_payments` をリプレイス更新
3. 在庫反映 (`inventory_movements`)
   - `isRefund=false`: movement_type=`out`, qty=-quantity
   - `isRefund=true`: movement_type=`in`, qty=+quantity（返品は在庫戻し）
   - `inventory_stocks.on_hand_qty` と `last_movement_at` を更新
4. 売上確定状態を `posted` に更新（仕様上のPOST条件が成立した時）

`COMMIT`

例外時:
- 何れかで失敗した場合 `ROLLBACK`
- `pos_ingest_logs.status=failed`
- `error_code`/`error_message` を保存

## 4. 月次ロック連動
- 取引発生日の年月が `monthly_closings.status='locked'` の場合は受信不可
- status code を `422` で返却し、`error_code='MONTH_CLOSED'`
- それ以外は受信キューへ入れず即失敗

## 5. 再送（Retry）
対象: `pos_ingest_logs` status=`failed`
- API: `POST /pos/import-logs/{id}/retry`
- 対象レコードを1件取得し、検証と反映を再実行
- 成功: `status=processed`, 失敗: `status=failed` のまま

## 6. 監査
- `sales_transactions` / `inventory_movements` 更新ごとに `audit_logs` を1件以上記録
- 監査保存項目:
  - actor user_id
  - entity_type (`sales_transactions`,`inventory_stocks`,`inventory_movements`,`sales_transaction_items`,`sales_payments`)
  - before_json, after_json（差分）
  - ip_address

## 7. API 応答（受信）
- 200/201で集計を返す:
  - `received`: 受信レコード数
  - `queued`: 処理対象数
  - `duplicated`: 重複数
  - `failed`: 検証失敗数
  - `items[]`: 各トランザクションごとの result

## 8. 監視ポイント
- 受信遅延 > 1分: アラート
- 失敗率 > 3%（5分集計）: 運用画面に警告
- 重複率 > 10%（1時間）: 端末側再送設定を確認

## 9. 実装順（推奨）
1. `POST /pos/ingest` 入力検証
2. `pos_ingest_logs` 永続化
3. 売上upsert + 明細保存
4. 在庫反映
5. 監査ログ
6. Retry API
7. /sales/import 一覧UI連携
