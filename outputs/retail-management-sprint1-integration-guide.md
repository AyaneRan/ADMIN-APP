# Sprint1 統合ガイド（実装接続版）

対象: `retail-management-sprint1-openapi.yaml`、`retail-management-sprint1-pos-ingest-impl.ts`、`retail-management-sprint1-sales-impl.ts`

## 1. 目標
このガイドは、疑似実装をそのまま **Express + Prisma 構成**で起動できる形に接続するための最低構成です。

## 2. ルータ定義（接続）

### 2.1 推奨ディレクトリ
- `src/index.ts`（Express起動）
- `src/middlewares/auth.ts`（認証）
- `src/routes/sales.ts`
- `src/routes/pos.ts`
- `src/routes/audit.ts`
- `src/routes/me.ts`

### 2.2 ルータ雛形
```ts
import { Router } from 'express'
import * as posController from '../controllers/posController'
import * as salesController from '../controllers/salesController'
import { authenticate, requireRole } from '../middlewares/auth'

const router = Router()
router.use(authenticate)

// auth
router.post('/auth/login', authController.login)
router.post('/auth/logout', authController.logout)
router.post('/auth/otp/send', authController.sendOtp)
router.post('/auth/otp/verify', authController.verifyOtp)
router.get('/me', meController.me)

// audit
router.get('/audit-logs', requireRole(['OWNER', 'MANAGER']), auditController.list)
router.get('/audit-logs/:id', requireRole(['OWNER', 'MANAGER']), auditController.detail)

// pos
router.post('/pos/ingest', requireRole(['OWNER', 'MANAGER']), posController.postPosIngest)
router.get('/pos/import-logs', requireRole(['OWNER', 'MANAGER']), posController.getPosImportLogs)
router.post('/pos/import-logs/:id/retry', requireRole(['OWNER', 'MANAGER']), posController.retryPosIngest)

// sales
router.get('/sales/transactions', requireRole(['OWNER','MANAGER','STAFF','VIEWER']), salesController.listSalesTransactions)
router.get('/sales/transactions/:id', requireRole(['OWNER','MANAGER','STAFF','VIEWER']), salesController.getSalesTransaction)
router.post('/sales/transactions/:id/correct', requireRole(['OWNER', 'MANAGER']), salesController.requestSalesCorrection)
router.get('/sales/summary', requireRole(['OWNER','MANAGER','STAFF','VIEWER']), salesController.getSalesSummary)
router.get('/sales/kpi', requireRole(['OWNER','MANAGER','VIEWER']), salesController.getSalesKpi)
router.get('/sales/export', requireRole(['OWNER','MANAGER']), salesController.exportSalesSummaryCsv)
```

`src/index.ts` で `app.use('/api', router)` を登録。

## 3. Prisma/ORM名の注意点（重要）
疑似コードは SQL 名を前提にしているため、Prismaで採用する model 名を統一するとバグが減ります。

### 3.1 推奨（snake_case保管、camelCaseコード）
- db: `sales_transactions` ← Prisma model: `salesTransaction`
- db: `sales_transaction_items` ← model: `salesTransactionItem`
- db: `sales_payments` ← model: `salesPayment`
- db: `inventory_movements` ← model: `inventoryMovement`
- db: `monthly_closings` ← model: `monthlyClosing`
- db: `master_categories` ← model: `masterCategory`

### 3.2 必要なリレーション
- `salesTransaction` hasMany `salesTransactionItem`, `salesPayment`
- `salesTransactionItem` belongsTo `product`
- `salesPayment` belongsTo `masterCategory`
- `corrections` belongsTo `salesTransaction`, `requestedBy: users`
- `audit_logs` は `entityType` と `entityId` で監査キーを保持

## 4. 実装順（Sprint1開始用）
1. `src/db.ts` / Prisma client 初期化
2. `middlewares/auth.ts`（`req.user`を注入）
3. `routes` の登録（上記）
4. `controllers/posController.ts`（`pos-ingest`）
5. `controllers/salesController.ts`（`sales`系）
6. エラーハンドラ（BadRequest/Forbidden/NotFound）
7. 最低限のダミーデータ（stores/users/roles/products）
8. `/sales/import`, `/sales/transactions`, `/sales/summary` の3画面に画面API接続

## 5. 疑似実装の実際修正ポイント（取り込み時）
以下はそのままコピペすると起きやすい不整合です。事前修正してください。

1. `prisma` では `store_id_source_key` のような unique 複合キー名を定義していない場合が多い  
   - 対応: `@@unique([store_id, source_key])` を作成し、`where` に対応

2. `db.pos_ingest_logs.create` の `payload` が JSON の場合
   - 対応: Prisma `Json` スキーマを使い、`payload: t as Prisma.InputJsonValue`

3. `upsertTransaction` で `transaction_no` の仕様が重複する場合
   - 対応: `transaction_no` を表示用ユニークにするならDBで UNIQUE を追加

4. `master_categories` を paymentマスタとして使う場合
   - 対応: 事前に `domain='payment_method'` を登録する seed を必須化

5. ログインユーザー取得 `req.user.storeId!` の `!`
   - 対応: 単店舗でも nullable なら初期起動時に必ず埋める

6. `is_refund` の在庫反映量
   - 返品は `sign=+1` を維持（在庫戻し）

## 6. 例: 最低限ミドルウェア
```ts
export const requireRole = (allowed: string[]) => (req, res, next) => {
  const role = req.user?.role
  if (!role || !allowed.includes(role)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'insufficient role' })
  }
  return next()
}
```

## 7. 依存する最小API契約（Sprint1）
- `POST /api/pos/ingest`
- `GET /api/pos/import-logs`
- `POST /api/pos/import-logs/:id/retry`
- `GET /api/sales/transactions`
- `GET /api/sales/transactions/:id`
- `POST /api/sales/transactions/:id/correct`
- `GET /api/sales/summary`
- `GET /api/sales/kpi`
- `GET /api/sales/export`

## 8. 想定初回リリース判定（DONE条件）
- 3画面（取り込み監査 / 取引一覧 / 集計）が「表示される」
- `/api/pos/ingest` が1件でも失敗を明示できる
- 取引の訂正申請が作成される
- 集計CSVがDLできる

※ APIのエラー内容は画面に `error_code`、`error_message` として表示
