/**
 * Sprint1: 売上 API 実装下書き（TypeScript pseudo-code）
 * 依存:
 * - Express
 * - Prisma-like ORM
 * - 認証ミドルウェアで req.user が利用可能
 *
 * endpoints:
 * - GET /api/sales/transactions
 * - GET /api/sales/transactions/:id
 * - POST /api/sales/transactions/:id/correct
 * - GET /api/sales/summary
 * - GET /api/sales/kpi
 * - GET /api/sales/export
 */

import { Request, Response } from 'express'
import { db } from './db'
import { BadRequest, Forbidden, NotFound } from './errors'

type Role = 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER'

type AuthUser = {
  userId: string
  role: Role
  storeId?: string
}

type SalesFilter = {
  storeId: string
  from?: string
  to?: string
  staffId?: string
  paymentMethod?: string
  status?: 'pending' | 'imported' | 'posted' | 'corrected' | 'cancelled'
  isRefund?: boolean
  categoryId?: string
  limit?: number
  offset?: number
}

type Unit = 'day' | 'week' | 'month'

type Kpi = {
  salesAmount: number
  salesCount: number
  grossProfit: number
  grossMarginRate: number
  refundRate: number
  topProducts: { productId: string; productName: string; amount: number }[]
}

const isAdminView = (role: Role) => ['OWNER', 'MANAGER'].includes(role)
const isViewer = (role: Role) => role === 'VIEWER'

const resolveStoreId = (requestStoreId: string | undefined, user: AuthUser): string => {
  return requestStoreId ?? user.storeId!
}

const toNumber = (value: unknown, defaultValue = 0): number => {
  if (value === null || value === undefined) return defaultValue
  const num = Number(value)
  return Number.isNaN(num) ? defaultValue : num
}

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const s = String(value).replace(/"/g, '""')
  return /[",\n\r]/.test(s) ? `"${s}"` : s
}

const buildWhere = (f: SalesFilter): any => {
  const where: any = { store_id: f.storeId }
  if (f.from || f.to) {
    where.occurred_at = {}
    if (f.from) where.occurred_at.gte = new Date(f.from)
    if (f.to) where.occurred_at.lte = new Date(f.to)
  }
  if (f.staffId) where.staff_id = f.staffId
  if (f.status) where.status = f.status
  if (f.isRefund !== undefined) where.is_refund = f.isRefund
  if (f.paymentMethod) {
    where.sales_payments = {
      some: { method_category_id: f.paymentMethod }
    }
  }
  if (f.categoryId) {
    where.sales_transaction_items = {
      some: {
        product: { category_id: f.categoryId }
      }
    }
  }
  return where
}

export const listSalesTransactions = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!req.user) throw new Forbidden('AUTH_REQUIRED')
  const storeId = resolveStoreId(req.query.store_id as string | undefined, req.user)

  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)
  const filter: SalesFilter = {
    storeId,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    staffId: req.query.staffId as string | undefined,
    paymentMethod: req.query.paymentMethod as string | undefined,
    status: req.query.status as any,
    isRefund: req.query.isRefund === 'true' ? true : req.query.isRefund === 'false' ? false : undefined,
    categoryId: req.query.categoryId as string | undefined,
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0
  }

  const where = buildWhere(filter)
  const orderBy: any[] = [{ occurred_at: 'desc' }]

  const [items, total] = await Promise.all([
    db.sales_transactions.findMany({
      where,
      orderBy,
      skip: filter.offset,
      take: filter.limit,
      include: {
        sales_transaction_items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true
              }
            }
          }
        },
        sales_payments: {
          include: {
            master_categories: {
              select: { name: true }
            }
          }
        }
      }
    }),
    db.sales_transactions.count({ where })
  ])

  const list = items.map((tx: any) => ({
    id: tx.id,
    transactionNo: tx.transaction_no,
    occurredAt: tx.occurred_at,
    totalAmount: tx.total_amount,
    taxAmount: tx.tax_amount,
    discountAmount: tx.discount_amount,
    isRefund: tx.is_refund,
    status: tx.status,
    terminalId: tx.terminal_id,
    itemCount: tx.sales_transaction_items.length
  }))

  return res.json({
    items: list,
    page: { total, limit: filter.limit, offset: filter.offset }
  })
}

export const getSalesTransaction = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!req.user) throw new Forbidden('AUTH_REQUIRED')
  const storeId = resolveStoreId(req.query.store_id as string | undefined, req.user)
  const { id } = req.params

  const tx = await db.sales_transactions.findFirst({
    where: { id, store_id: storeId },
    include: {
      staff: {
        select: { id: true, name: true, email: true }
      },
      sales_transaction_items: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true
            }
          }
        }
      },
      sales_payments: {
        include: {
          method_category: {
            select: { id: true, name: true }
          }
        }
      }
    }
  })

  if (!tx) throw new NotFound('SALES_TRANSACTION_NOT_FOUND')

  // 店舗権限は共通。表示時点ではスタッフでも閲覧可
  const corrections = await db.corrections.findMany({
    where: { sales_transaction_id: tx.id },
    orderBy: { created_at: 'desc' },
    include: { requested_by_user: { select: { id: true, name: true } } }
  })

  return res.json({
    id: tx.id,
    transactionNo: tx.transaction_no,
    storeId: tx.store_id,
    terminalId: tx.terminal_id,
    occurredAt: tx.occurred_at,
    subtotal: tx.subtotal,
    taxAmount: tx.tax_amount,
    discountAmount: tx.discount_amount,
    totalAmount: tx.total_amount,
    isRefund: tx.is_refund,
    status: tx.status,
    staff: tx.staff ? { id: tx.staff.id, name: tx.staff.name, email: tx.staff.email } : null,
    payments: tx.sales_payments.map((p: any) => ({
      method: p.method_category?.name ?? p.method_category_id,
      amount: p.amount
    })),
    items: tx.sales_transaction_items.map((i: any) => ({
      productId: i.product?.id ?? null,
      sku: i.product?.sku ?? null,
      productName: i.product?.name ?? null,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineDiscount: i.line_discount,
      taxAmount: i.tax_amount,
      lineTotal: i.line_total
    })),
    corrections: corrections.map((c: any) => ({
      id: c.id,
      reason: c.reason,
      status: c.status,
      requestedBy: c.requested_by_user?.name,
      requestedAt: c.created_at,
      reviewedBy: c.reviewed_by,
      reviewedAt: c.reviewed_at
    }))
  })
}

export const requestSalesCorrection = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!req.user || !isAdminView(req.user.role)) throw new Forbidden('INSUFFICIENT_ROLE')
  const { id } = req.params
  const storeId = resolveStoreId(req.body?.storeId as string | undefined, req.user)
  const reason = String(req.body?.reason || '').trim()

  if (!reason || reason.length < 5) throw new BadRequest('VALIDATION_ERROR', 'reason is required (min 5 chars)')

  const tx = await db.sales_transactions.findFirst({ where: { id, store_id: storeId } })
  if (!tx) throw new NotFound('SALES_TRANSACTION_NOT_FOUND')

  const correction = await db.corrections.create({
    data: {
      store_id: storeId,
      sales_transaction_id: tx.id,
      requested_by: req.user.userId,
      reason,
      status: 'pending'
    }
  })

  return res.status(201).json({
    id: correction.id,
    status: correction.status,
    requestedAt: correction.created_at
  })
}

const buildDateBucket = (from: string, to: string, unit: Unit): string => {
  // DB側日付集計は DATE_TRUNC で実施し、このヘルパーはフォーマット用途
  if (unit === 'week') return `DATE_TRUNC('week', occurred_at)`
  if (unit === 'month') return `DATE_TRUNC('month', occurred_at)`
  return `DATE_TRUNC('day', occurred_at)`
}

const sqlDateFormat = (iso: string) => {
  const d = new Date(iso)
  return d.toISOString().slice(0, 10)
}

export const getSalesSummary = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!req.user) throw new Forbidden('AUTH_REQUIRED')
  const storeId = resolveStoreId(req.query.store_id as string | undefined, req.user)
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  const unit = (req.query.unit as Unit | undefined) ?? 'day'
  const categoryId = req.query.categoryId as string | undefined
  const staffId = req.query.staffId as string | undefined

  if (!from || !to) throw new BadRequest('VALIDATION_ERROR', 'from/to required')

  const whereBase = buildWhere({
    storeId,
    from,
    to,
    categoryId,
    staffId
  })

  // 基本集計
  const transactions = await db.sales_transactions.findMany({
    where: whereBase,
    select: {
      occurred_at: true,
      total_amount: true,
      tax_amount: true,
      discount_amount: true,
      is_refund: true,
      sales_transaction_items: { select: { quantity: true, unit_price: true, line_discount: true } }
    }
  })

  // 単純集計（POC。後続でSQL集約化して負荷最適化）
  let rowsMap = new Map<string, any>()
  for (const tx of transactions) {
    const bucketDate = (() => {
      const d = new Date(tx.occurred_at)
      if (unit === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (unit === 'week') {
        const day = d.getDay()
        const monday = new Date(d)
        monday.setDate(d.getDate() - ((day + 6) % 7))
        return `W${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
      }
      return sqlDateFormat(tx.occurred_at.toISOString())
    })()

    const row = rowsMap.get(bucketDate) ?? { bucket: bucketDate, sales: 0, tax: 0, discount: 0, refund: 0, cogs: 0 }
    const amount = Number(tx.total_amount)
    const tax = Number(tx.tax_amount)
    const discount = Number(tx.discount_amount)
    const isRefund = !!tx.is_refund
    row.sales += isRefund ? -amount : amount
    row.tax += isRefund ? -tax : tax
    row.discount += isRefund ? -discount : discount
    row.refund += isRefund ? amount : 0
    const cogs = tx.sales_transaction_items.reduce((sum: number, i: any) => sum + (Number(i.quantity) * Number(i.unit_price) - Number(i.line_discount)), 0)
    row.cogs += isRefund ? -cogs : cogs
    rowsMap.set(bucketDate, row)
  }

  const rows = [...rowsMap.values()].sort((a, b) => b.bucket.localeCompare(a.bucket))
  const totals = rows.reduce(
    (acc, row) => {
      acc.salesAmount += row.sales
      acc.taxAmount += row.tax
      acc.discountAmount += row.discount
      acc.refundAmount += row.refund
      acc.salesCount += 1
      return acc
    },
    { salesAmount: 0, taxAmount: 0, discountAmount: 0, refundAmount: 0, salesCount: 0 }
  )
  const cogsTotal = rows.reduce((sum, r) => sum + r.cogs, 0)
  const grossProfit = totals.salesAmount - cogsTotal

  const response = {
    unit,
    from,
    to,
    totals: {
      salesCount: totals.salesCount,
      saleAmount: totals.salesAmount,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      refundAmount: totals.refundAmount,
      grossProfit
    },
    rows: rows.map((r) => ({
      bucket: r.bucket,
      sales: r.sales,
      tax: r.tax,
      discount: r.discount,
      refund: r.refund,
      cogs: r.cogs,
      grossProfit: r.sales - r.cogs
    }))
  }
  return res.json(response)
}

export const getSalesKpi = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!req.user) throw new Forbidden('AUTH_REQUIRED')
  const storeId = resolveStoreId(req.query.store_id as string | undefined, req.user)
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')

  if (!from || !to) throw new BadRequest('VALIDATION_ERROR', 'from/to required')

  const transactions = await db.sales_transactions.findMany({
    where: {
      store_id: storeId,
      occurred_at: { gte: new Date(from), lte: new Date(to) },
      status: { not: 'cancelled' } as any
    },
    include: {
      sales_transaction_items: {
        include: {
          product: { select: { id: true, name: true } }
        }
      }
    }
  })

  const kpi = transactions.reduce(
    (acc: any, t: any) => {
      const sales = Number(t.total_amount)
      const tax = Number(t.tax_amount)
      const discount = Number(t.discount_amount)
      const isRefund = !!t.is_refund
      const sign = isRefund ? -1 : 1
      const cogs = t.sales_transaction_items.reduce(
        (s: number, item: any) => s + (Number(item.quantity) * 0), // 実運用では原価に商品原価を乗せる
        0
      )
      acc.salesAmount += sign * sales
      acc.salesCount += 1
      acc.taxAmount += sign * tax
      acc.discountAmount += sign * discount
      acc.grossProfit += sign * (sales - cogs)
      acc.refundAmount += isRefund ? sales : 0
      acc.rowCount++
      for (const item of t.sales_transaction_items) {
        if (!item.product) continue
        const key = item.product.id
        const amount = sign * Number(item.quantity) * Number(item.unit_price)
        const current = acc.topProducts.get(key) ?? { productId: key, productName: item.product.name, amount: 0 }
        current.amount += amount
        acc.topProducts.set(key, current)
      }
      return acc
    },
    {
      salesAmount: 0,
      salesCount: 0,
      taxAmount: 0,
      discountAmount: 0,
      grossProfit: 0,
      refundAmount: 0,
      rowCount: 0,
      topProducts: new Map<string, any>()
    } as {
      salesAmount: number
      salesCount: number
      taxAmount: number
      discountAmount: number
      grossProfit: number
      refundAmount: number
      rowCount: number
      topProducts: Map<string, { productId: string; productName: string; amount: number }>
    }
  )

  const topProducts = [...kpi.topProducts.values()]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 10)

  const grossMarginRate = kpi.salesAmount !== 0 ? (kpi.grossProfit / kpi.salesAmount) * 100 : 0
  const refundRate = kpi.salesAmount !== 0 ? (kpi.refundAmount / kpi.salesAmount) * 100 : 0

  const payload: Kpi = {
    salesAmount: kpi.salesAmount,
    salesCount: kpi.salesCount,
    grossProfit: kpi.grossProfit,
    grossMarginRate,
    refundRate,
    topProducts
  }
  return res.json(payload)
}

export const exportSalesSummaryCsv = async (req: Request & { user: AuthUser }, res: Response) => {
  if (!req.user || !isAdminView(req.user.role)) throw new Forbidden('INSUFFICIENT_ROLE')
  const storeId = resolveStoreId(req.query.store_id as string | undefined, req.user)
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!from || !to) throw new BadRequest('VALIDATION_ERROR', 'from/to required')

  const where: any = {
    store_id: storeId,
    occurred_at: { gte: new Date(from), lte: new Date(to) }
  }
  const rows = await db.sales_transactions.findMany({
    where,
    include: {
      sales_transaction_items: {
        include: { product: { select: { sku: true, name: true } } }
      }
    },
    orderBy: { occurred_at: 'asc' }
  })

  const header = [
    'transaction_no',
    'occurred_at',
    'status',
    'is_refund',
    'subtotal',
    'tax_amount',
    'discount_amount',
    'total_amount',
    'staff_id',
    'terminal_id',
    'items'
  ]

  const body = rows.map((t: any) => [
    t.transaction_no,
    t.occurred_at.toISOString(),
    t.status,
    t.is_refund,
    t.subtotal,
    t.tax_amount,
    t.discount_amount,
    t.total_amount,
    t.staff_id ?? '',
    t.terminal_id,
    t.sales_transaction_items
      .map((i: any) => `${i.product?.sku ?? ''}:${i.product?.name ?? ''}:${i.quantity}x${i.unit_price}`)
      .join(' / ')
  ].map(escapeCsv).join(','))

  const csv = [header.join(','), ...body].join('\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="sales_summary_${from}_${to}.csv"`)
  return res.send(csv)
}

export const salesSqlSummary = `
SELECT
  DATE_TRUNC($1::text, occurred_at) AS bucket,
  COUNT(*)::INT AS sales_count,
  COALESCE(SUM(total_amount), 0) AS sales_amount,
  COALESCE(SUM(tax_amount), 0) AS tax_amount,
  COALESCE(SUM(discount_amount), 0) AS discount_amount,
  COALESCE(SUM(CASE WHEN is_refund THEN total_amount ELSE 0 END), 0) AS refund_amount
FROM sales_transactions
WHERE store_id = $2
  AND occurred_at BETWEEN $3 AND $4
  AND status <> 'cancelled'
GROUP BY DATE_TRUNC($1::text, occurred_at)
ORDER BY bucket DESC;
`

