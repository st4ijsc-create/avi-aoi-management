---
route: /products
permission: settings_products
role: []
screenVi: Sản phẩm
screenEn: Products
inSidebar: true
navGroupVi: Quản lý dữ liệu
navGroupEn: Data Management
module: MOD_DATA_MANAGEMENT
license: OPTIONAL
---

# Sản phẩm — Cách vận hành

## Mục đích
Màn hình `/products` (Products).

## Vị trí truy cập
- Menu: Quản lý dữ liệu › Sản phẩm
- URL: `/products`
- English: Data Management › Products

## Quyền yêu cầu
- Permission: `settings_products`
- Module: `MOD_DATA_MANAGEMENT` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `productModelRouter` (server/routers/productRouters.ts, ~121 thủ tục query/mutation).

