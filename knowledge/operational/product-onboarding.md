---
route: /product-onboarding
permission: settings_products
role: []
screenVi: Tạo sản phẩm mới
screenEn: Product setup
inSidebar: true
navGroupVi: Quản lý dữ liệu
navGroupEn: Data Management
module: MOD_DATA_MANAGEMENT
license: OPTIONAL
---

# Tạo sản phẩm mới — Cách vận hành

## Mục đích
WD-1 (doc 31 Đợt D · UX1): product-side onboarding wizard — resumable guided setup (fiducials/points/limits/golden/panel/release/mapping)

## Vị trí truy cập
- Menu: Quản lý dữ liệu › Tạo sản phẩm mới
- URL: `/product-onboarding`
- English: Data Management › Product setup

## Quyền yêu cầu
- Permission: `settings_products`
- Module: `MOD_DATA_MANAGEMENT` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `productOnboardingRouter` (server/routers/productOnboardingRouter.ts, ~5 thủ tục query/mutation).

