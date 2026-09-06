# 小売向け店舗マネジメントアプリ 実装チケット v2（画面別）

最終更新: 2026-09-07  
対象: 単店舗MVPを最短で成立させるための画面単位タスク分解（チーム内共有用）

## 画面別実装ユニット（最短順）

### A. 認証・共通基盤
1. `auth/login`
2. `auth/logout`
3. `auth/otp/send` / `auth/otp/verify`
4. `me`
5. `audit-logs`, `audit-logs/{id}`

### B. ダッシュボード
6. `dashboard/today`
7. `dashboard/alerts`

### C. 売上（POP連携最優先）
8. `pos/import-logs`
9. `pos/import-logs/{id}/retry`
10. `pos/ingest`
11. `sales/transactions`
12. `sales/transactions/{id}`
13. `sales/transactions/{id}/correct`
14. `sales/summary`
15. `sales/export`

### D. 商品・在庫
16. `products`（一覧/登録/更新）
17. `products/{id}`
18. `products/{id}/toggle-active`
19. `products/import`
20. `inventory/stocks`
21. `inventory/alerts`
22. `inventory/movements`
23. `inventory/counts`
24. `inventory/counts/{id}/approve`

### E. 人材・労務
25. `staff/schedules`
26. `staff/attendance`
27. `staff/attendance/{id}/approve`
28. `staff/payroll`

### F. 経費・レポート
29. `expenses`
30. `expenses/{id}/approve`
31. `expense-categories`
32. `reports/pnl`
33. `reports/month-close`
34. `reports/month-unlock`
35. `reports/kpi`

### G. 将来対応（現状は画面非表示）
36. `reports/stores/comparison`
37. `inventory/cross-stores`

## 1スプリントの最小実装目標（参考）

- 週1スプリント
- 1スプリントあたり 6〜8 API + 1画面
- 目標: 8日以内で「売上監視＋在庫管理」稼働

## チーム分担の進め方（推奨）

- Team A: POS連携 + 売上監査系（7〜9）
- Team B: 商品・在庫系（16〜24）
- Team C: スタッフ・経費系（25〜35）
- Team D: ダッシュボード/運用設定（6、7、A1〜A5）

## Definition of Done（画面側）

- 画面に対し、一覧表示APIが1件以上正常に描画できる
- 主要アクション（再試行/承認/ロック）が権限制御される
- エラーケース（権限不足、必須項目不足、月次ロック）をUIで表示可能
- 更新系は監査ログ（最低 `audit-logs`) に反映
