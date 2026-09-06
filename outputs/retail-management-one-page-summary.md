# 開発向け1ページサマリ（単店舗→多店舗）

最終更新: 2026-09-07

## 事業ゴール
- 単店舗運営を最短で立ち上げる
- POP（POS）連携を最重要機能として運用に耐える
- 将来の多店舗比較を壊さない基盤で設計する

## 構成
- 画面仕様: `retail-management-screen-spec-final.md`
- 画面遷移: `retail-management-screen-flow-map.md`
- API要件: `retail-management-screen-api-matrix.md`
- 多店舗拡張方針: `retail-management-multistore-extension-spec.md`
- 実装チケット: `retail-management-implementation-tickets-v2.md`

## MVPの必須価値
1. 売上監査：`/sales/import` で再試行運用を回す  
2. 取引確認：`/sales/transactions` の監査可能な明細確認  
3. 在庫運用：`/inventory/list`, `/inventory/movements`, `/inventory/count`  
4. 人的リソース：`/staff/schedule`, `/staff/attendance`  
5. 月次管理：`/reports/pnl`, `/reports/kpi` と監査ログ  

## 画面APIマップ（本番で先に実装）
- まず P0: 認証/売上監査/取引/在庫/シフト
- 次に P1: 経費入力/棚卸/レポート
- P2: 店舗比較・横断在庫は機能フラグで段階有効化

## 変更のルール（全画面共通）
- `store_id` は全API共通のクエリ/識別
- 更新は監査ログ必須
- 月次ロック月は訂正・承認除く更新制御
- 単店舗時は共通UIのまま一貫運用（store compare/cross-stockは非表示）
