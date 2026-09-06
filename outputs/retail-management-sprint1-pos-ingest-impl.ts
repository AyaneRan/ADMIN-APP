/**
 * Sprint1: POS ingest implementation (TypeScript pseudo-code, runnable baseline)
 * Target: /api/pos/ingest, /api/pos/import-logs, /api/pos/import-logs/{id}/retry
 *
 * Assumptions:
 * - Express + TypeScript + Prisma-like DB client
 * - Authentication middleware sets req.user
 * - DB schema follows `retail-management-sprint1-ddl.sql`
 */

import { Request, Response } from 'express'
import { db } from './db'
import { BadRequest, Forbidden, NotFound } from './errors'
import { toISODate } from './utils/date'

type AuthUser = {
  userId: string
  role: 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER'
  storeId?: string
}

type Role = 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER'

type PosTransactionEvent = {
  transactionId: string
  occurredAt: string
  staffId?: string
  isRefund?: boolean
  subtotal: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
  payment: { method: string; amount: number }[]
  items: {
    lineNo: number
    productId?: string
    sku?: string
    quantity: number
    unitPrice: number
    lineDiscount: number
    taxAmount: number
    lineTotal: number
  }[]
}

type PosIngestBatchRequest = {
  storeId?: string
  terminalId: string
  transactions: PosTransactionEvent[]
}

type IngestResult = {
  sourceKey: string
  status: 'received' | 'processed' | 'failed' | 'duplicated'
  errorCode?: string
  transactionId?: string
}

type ApiError = { code: string; message: string }

const ERROR = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  CLOSED_MONTH: 'MONTH_CLOSED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  TRANSACTION_RETRY_DISABLED: 'TRANSACTION_RETRY_DISABLED'
} as const

const isManager = (role: Role) => role === 'OWNER' || role === 'MANAGER'

const resolveStoreId = (requestStoreId: string | undefined, user: AuthUser): string => {
  // 単店舗運用では user.storeId を既定とする
  return requestStoreId ?? user.storeId!
}

const getMonthKey = (dateIso: string) => {
  const d = new Date(dateIso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const amountEq = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps

const validateTransactionItem = (item: PosTransactionEvent['items'][number]): ApiError | null => {
  if (!item.quantity || item.quantity <= 0) return { code: ERROR.VALIDATION_ERROR, message: 'quantity must be > 0' }
  if (item.unitPrice < 0 || item.lineTotal < 0) return { code: ERROR.VALIDATION_ERROR, message: 'item amounts must be >= 0' }
  return null
}

const validateTransaction = (tx: PosTransactionEvent): ApiError | null => {
  if (!tx.transactionId) return { code: ERROR.VALIDATION_ERROR, message: 'transactionId required' }
  if (!tx.occurredAt) return { code: ERROR.VALIDATION_ERROR, message: 'occurredAt required' }
  if (!Array.isArray(tx.payment) || tx.payment.length === 0) {
    return { code: ERROR.VALIDATION_ERROR, message: 'payment required' }
  }
  if (!Array.isArray(tx.items) || tx.items.length === 0) {
    return { code: ERROR.VALIDATION_ERROR, message: 'items required' }
  }

  const expectedBase = tx.items.reduce((sum, item) => sum + item.lineTotal, 0)
  const calcItems = tx.items.reduce((sum, item) => {
    const lineBase = item.quantity * item.unitPrice - item.lineDiscount + item.taxAmount
    // 丸め誤差対策
    return sum + lineBase
  }, 0)
  if (!amountEq(expectedBase, calcItems)) {
    return { code: ERROR.VALIDATION_ERROR, message: 'line totals inconsistent' }
  }

  const paymentSum = tx.payment.reduce((sum, p) => sum + p.amount, 0)
  if (!amountEq(paymentSum, tx.totalAmount)) {
    return { code: ERROR.VALIDATION_ERROR, message: 'payment sum mismatch totalAmount' }
  }

  const expected = tx.subtotal + tx.taxAmount - tx.discountAmount
  if (!amountEq(expected, tx.totalAmount)) {
    return { code: ERROR.VALIDATION_ERROR, message: 'totals inconsistent (subtotal + tax - discount != total)' }
  }

  const invalidItem = tx.items.find((item) => validateTransactionItem(item) !== null)
  if (invalidItem) {
    return validateTransactionItem(invalidItem)!
  }

  return null
}

const createAudit = async (params: {
  tx: any
  userId: string
  storeId: string
  entityType: string
  entityId: string
  action: 'create' | 'update' | 'approve' | 'lock' | 'unlock' | 'retry'
  before?: unknown
  after?: unknown
  ip: string
}) => {
  await params.tx.audit_logs.create({
    data: {
      store_id: params.storeId,
      user_id: params.userId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      action: params.action,
      before_json: params.before ? JSON.stringify(params.before) : null,
      after_json: params.after ? JSON.stringify(params.after) : null,
      ip_address: params.ip
    }
  })
}

const ensureNotClosed = async (txDb: any, storeId: string, occurredAt: string) => {
  const monthKey = getMonthKey(occurredAt)
  const closing = await txDb.monthly_closings.findFirst({
    where: { store_id: storeId, target_month: monthKey }
  })
  if (closing && closing.status === 'locked') {
    throw Object.assign(new Error('month is locked'), { code: ERROR.CLOSED_MONTH })
  }
}

const upsertTransaction = async (txDb: any, params: {
  storeId: string
  terminalId: string
  tx: PosTransactionEvent
  user: AuthUser
  sourceKey: string
}) => {
  const transactionPayload = {
    store_id: params.storeId,
    transaction_no: params.tx.transactionId,
    external_transaction_id: params.tx.transactionId,
    terminal_id: params.terminalId,
    staff_id: params.tx.staffId ?? null,
    occurred_at: new Date(params.tx.occurredAt),
    subtotal: params.tx.subtotal,
    tax_amount: params.tx.taxAmount,
    discount_amount: params.tx.discountAmount,
    total_amount: params.tx.totalAmount,
    is_refund: !!params.tx.isRefund,
    status: 'posted',
    source: 'pos_api'
  }

  const existing = await txDb.sales_transactions.findFirst({
    where: {
      store_id: params.storeId,
      external_transaction_id: params.tx.transactionId
    }
  })

  const before = existing ? existing : null
  const savedTx = existing
    ? await txDb.sales_transactions.update({
        where: { id: existing.id },
        data: { ...transactionPayload, updated_at: new Date() }
      })
    : await txDb.sales_transactions.create({ data: transactionPayload })

  // 既存明細を差し替え
  await txDb.sales_transaction_items.deleteMany({ where: { sales_transaction_id: savedTx.id } })
  await txDb.sales_payments.deleteMany({ where: { sales_transaction_id: savedTx.id } })

  const itemRows = []
  for (const item of params.tx.items) {
    let productId = item.productId
    if (!productId) {
      const bySku = await txDb.products.findFirst({
        where: { store_id: params.storeId, sku: item.sku, is_active: true }
      })
      if (!bySku) throw Object.assign(new Error(`product missing: ${item.sku}`), { code: ERROR.PRODUCT_NOT_FOUND })
      productId = bySku.id
    }
    itemRows.push({
      sales_transaction_id: savedTx.id,
      product_id: productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_discount: item.lineDiscount,
      tax_amount: item.taxAmount,
      line_total: item.lineTotal
    })
  }
  for (const row of itemRows) {
    await txDb.sales_transaction_items.create({ data: row })
  }

  for (const p of params.tx.payment) {
    // payment method is passed as category code/id. Map to id in implementation
    const methodCategory = await txDb.master_categories.findFirst({
      where: { domain: 'payment_method', name: p.method, is_active: true }
    })
    if (!methodCategory) {
      throw new Error(`unknown payment method ${p.method}`)
    }
    await txDb.sales_payments.create({
      data: { sales_transaction_id: savedTx.id, method_category_id: methodCategory.id, amount: p.amount }
    })
  }

  await createAudit({
    tx: txDb,
    userId: params.user.userId,
    storeId: params.storeId,
    entityType: 'sales_transactions',
    entityId: savedTx.id,
    action: existing ? 'update' : 'create',
    before: before ?? null,
    after: { ...transactionPayload },
    ip: 'REQ_IP_PLACEHOLDER'
  })

  return savedTx
}

const applyInventoryMovement = async (txDb: any, params: {
  storeId: string
  txId: string
  tx: PosTransactionEvent
  user: AuthUser
  sourceKey: string
}) => {
  const sign = tx.isRefund ? 1 : -1

  // for each line apply +/- to stock
  for (const item of params.tx.items) {
    let productId = item.productId
    if (!productId) {
      const bySku = await txDb.products.findFirst({
        where: { store_id: params.storeId, sku: item.sku, is_active: true }
      })
      if (!bySku) throw Object.assign(new Error(`product missing: ${item.sku}`), { code: ERROR.PRODUCT_NOT_FOUND })
      productId = bySku.id
    }

    const stock = await txDb.inventory_stocks.upsert({
      where: {
        // Prismaの複合uniqueフィールド例
        store_id_product_id: { store_id: params.storeId, product_id: productId }
      },
      create: {
        store_id: params.storeId,
        product_id: productId,
        on_hand_qty: 0,
        reserved_qty: 0
      },
      update: {}
    })

    const beforeQty = Number(stock.on_hand_qty)
    const delta = sign * Number(item.quantity)
    const afterQty = beforeQty + delta

    await txDb.inventory_stocks.update({
      where: { id: stock.id },
      data: {
        on_hand_qty: afterQty,
        last_movement_at: new Date()
      }
    })

    await txDb.inventory_movements.create({
      data: {
        store_id: params.storeId,
        product_id: productId,
        movement_type: params.tx.isRefund ? 'in' : 'out',
        qty: delta,
        related_transaction_type: 'sales_transaction',
        related_transaction_id: params.txId,
        reason: params.tx.isRefund ? 'refund' : 'sale',
        occurred_at: new Date(params.tx.occurredAt),
        created_by: params.user.userId,
        notes: `sourceKey=${params.sourceKey}`
      }
    })

    await createAudit({
      tx: txDb,
      userId: params.user.userId,
      storeId: params.storeId,
      entityType: 'inventory_stocks',
      entityId: stock.id,
      action: 'update',
      before: { on_hand_qty: beforeQty },
      after: { on_hand_qty: afterQty },
      ip: 'REQ_IP_PLACEHOLDER'
    })
  }
}

const processSingleTransaction = async (ctx: {
  db: any
  storeId: string
  terminalId: string
  user: AuthUser
  txItem: PosTransactionEvent
  sourceKey: string
  ip: string
}): Promise<IngestResult> => {
  try {
    const vErr = validateTransaction(ctx.txItem)
    if (vErr) return { sourceKey: ctx.sourceKey, status: 'failed', errorCode: vErr.code, transactionId: ctx.txItem.transactionId }

    await ensureNotClosed(ctx.db, ctx.storeId, ctx.txItem.occurredAt)

    const savedTx = await upsertTransaction(ctx.db, {
      storeId: ctx.storeId,
      terminalId: ctx.terminalId,
      tx: ctx.txItem,
      user: ctx.user,
      sourceKey: ctx.sourceKey
    })

    await applyInventoryMovement(ctx.db, {
      storeId: ctx.storeId,
      txId: savedTx.id,
      tx: ctx.txItem,
      user: ctx.user,
      sourceKey: ctx.sourceKey
    })

    return {
      sourceKey: ctx.sourceKey,
      status: 'processed',
      transactionId: ctx.txItem.transactionId
    }
  } catch (err: any) {
    const code = err.code ?? ERROR.VALIDATION_ERROR
    return {
      sourceKey: ctx.sourceKey,
      status: 'failed',
      errorCode: code,
      transactionId: ctx.txItem.transactionId
    }
  }
}

export const postPosIngest = async (req: Request & { user: AuthUser }, res: Response) => {
  const { terminalId, transactions, storeId: reqStoreId } = req.body as PosIngestBatchRequest
  if (!isManager(req.user.role)) throw new Forbidden(ERROR.PERMISSION_DENIED)
  const storeId = resolveStoreId(reqStoreId, req.user)
  if (!terminalId || !Array.isArray(transactions) || transactions.length === 0) {
    throw new BadRequest(ERROR.VALIDATION_ERROR, 'terminalId and transactions required')
  }

  let received = 0
  let queued = 0
  let duplicated = 0
  let failed = 0
  const items: IngestResult[] = []

  await db.transaction(async (tx: any) => {
    for (const t of transactions) {
      const sourceKey = `${storeId}:${terminalId}:${t.transactionId}`
      received++
      const existing = await tx.pos_ingest_logs.findUnique({
        where: { store_id_source_key: { store_id: storeId, source_key: sourceKey } }
      })
      if (existing) {
        duplicated++
        items.push({ sourceKey, status: 'duplicated', errorCode: undefined, transactionId: t.transactionId })
        continue
      }

      const ingestLog = await tx.pos_ingest_logs.create({
        data: {
          store_id: storeId,
          terminal_id: terminalId,
          source_key: sourceKey,
          request_id: String(req.headers['x-request-id'] || ''),
          status: 'received',
          payload: t
        }
      })
      queued++

      const result = await processSingleTransaction({
        db: tx,
        storeId,
        terminalId,
        user: req.user,
        txItem: t,
        sourceKey,
        ip: String(req.ip)
      })

      if (result.status === 'processed') {
        await tx.pos_ingest_logs.update({
          where: { id: ingestLog.id },
          data: { status: 'processed', processed_at: new Date() }
        })
      } else {
        failed++
        await tx.pos_ingest_logs.update({
          where: { id: ingestLog.id },
          data: {
            status: result.status,
            error_code: result.errorCode,
            error_message: result.errorCode ? `error: ${result.errorCode}` : null,
            processed_at: new Date()
          }
        })
      }
      items.push(result)
    }
  })

  return res.status(201).json({ received, queued, duplicated, failed, items })
}

export const getPosImportLogs = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!isManager(req.user.role)) throw new Forbidden(ERROR.PERMISSION_DENIED)
  const storeId = resolveStoreId(req.query.store_id as string | undefined, req.user)
  const { status, terminalId, from, to, limit = 50, offset = 0 } = req.query as any
  const where: any = { store_id: storeId }
  if (status) where.status = status
  if (terminalId) where.terminal_id = terminalId
  if (from || to) where.received_at = {}
  if (from) where.received_at.gte = new Date(from)
  if (to) where.received_at.lte = new Date(to)

  const rows = await db.pos_ingest_logs.findMany({
    where,
    orderBy: { received_at: 'desc' },
    skip: Number(offset),
    take: Number(limit)
  })
  const total = await db.pos_ingest_logs.count({ where })
  return res.json({ items: rows, page: { total, limit: Number(limit), offset: Number(offset) } })
}

export const retryPosIngest = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!isManager(req.user.role)) throw new Forbidden(ERROR.PERMISSION_DENIED)
  const { id } = req.params
  const storeId = resolveStoreId(req.body?.storeId, req.user)
  const log = await db.pos_ingest_logs.findUnique({ where: { id } })
  if (!log || log.store_id !== storeId) throw new NotFound('not found')
  if (log.status !== 'failed') throw new BadRequest(ERROR.TRANSACTION_RETRY_DISABLED, 'only failed logs can be retried')

  const txPayload = log.payload as PosTransactionEvent
  const terminalId = log.terminal_id || 'unknown'

  await db.pos_ingest_logs.update({ where: { id }, data: { status: 'retrying' } })
  let result: IngestResult
  await db.transaction(async (tx: any) => {
    result = await processSingleTransaction({
      db: tx,
      storeId,
      terminalId,
      user: req.user,
      txItem: txPayload,
      sourceKey: log.source_key,
      ip: String(req.ip)
    })
    const newStatus = result!.status === 'processed' ? 'processed' : 'failed'
    await tx.pos_ingest_logs.update({
      where: { id },
      data: {
        status: newStatus,
        error_code: result!.errorCode ?? null,
        error_message: result!.errorCode ? `error: ${result!.errorCode}` : null,
        processed_at: new Date()
      }
    })
  })
  return res.status(202).json(result)
}

/**
 * 追加で必要なAPI
 * - GET /sales/transactions -> sales_transaction + items + payment join
 * - GET /sales/transactions/:id/correct -> correction insert
 * - GET /sales/summary -> aggregate query
 * これらは次の実装ステップで `repository` 層を分離して追加する
 */

// ======
// 補足: 1分で見直すための SQL集約例
// ======
export const sqlDailySalesSummary = `
SELECT
  DATE(st.occurred_at) AS bucket,
  COUNT(*)::INT AS sales_count,
  COALESCE(SUM(st.total_amount),0) AS sales_amount,
  COALESCE(SUM(st.tax_amount),0) AS tax_amount,
  COALESCE(SUM(st.discount_amount),0) AS discount_amount
FROM sales_transactions st
WHERE st.store_id = $1
  AND st.occurred_at BETWEEN $2 AND $3
  AND st.status <> 'cancelled'
GROUP BY DATE(st.occurred_at)
ORDER BY bucket DESC;
`

