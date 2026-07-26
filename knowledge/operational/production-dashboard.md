---
route: /production-dashboard
permission: dashboard_view
role: []
screenVi: Tổng quan sản xuất
screenEn: Production Overview
inSidebar: true
navGroupVi: Sản xuất
navGroupEn: Production
module: MOD_PRODUCTION
license: OPTIONAL
---

# Tổng quan sản xuất — Cách vận hành

## Mục đích
Màn hình `/production-dashboard` (Production Overview).

## Vị trí truy cập
- Menu: Sản xuất › Tổng quan sản xuất
- URL: `/production-dashboard`
- English: Production › Production Overview

## Quyền yêu cầu
- Permission: `dashboard_view`
- Module: `MOD_PRODUCTION` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `productionDashboardRouter` (server/routers/productionDashboardRouter.ts, ~6 thủ tục query/mutation).

