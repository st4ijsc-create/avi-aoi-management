---
route: /production-orders
permission: production_orders
role: []
screenVi: Đơn hàng sản xuất
screenEn: Production Orders
inSidebar: true
navGroupVi: Sản xuất
navGroupEn: Production
module: MOD_PRODUCTION
license: OPTIONAL
---

# Đơn hàng sản xuất — Cách vận hành

## Mục đích
Màn hình `/production-orders` (Production Orders).

## Vị trí truy cập
- Menu: Sản xuất › Đơn hàng sản xuất
- URL: `/production-orders`
- English: Production › Production Orders

## Quyền yêu cầu
- Permission: `production_orders`
- Module: `MOD_PRODUCTION` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `productionOrderRouter` (server/routers/productionRouters.ts, ~36 thủ tục query/mutation).

