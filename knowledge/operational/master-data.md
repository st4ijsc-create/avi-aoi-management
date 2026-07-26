---
route: /master-data
permission: masterdata
role: []
screenVi: Dữ liệu chủ
screenEn: Master Data
inSidebar: true
navGroupVi: Quản lý dữ liệu
navGroupEn: Data Management
module: MOD_DATA_MANAGEMENT
license: OPTIONAL
---

# Dữ liệu chủ — Cách vận hành

## Mục đích
Doc 07 §③: MES/MOM master data (supplier/material/customer/skill/tool)

## Vị trí truy cập
- Menu: Quản lý dữ liệu › Dữ liệu chủ
- URL: `/master-data`
- English: Data Management › Master Data

## Quyền yêu cầu
- Permission: `masterdata`
- Module: `MOD_DATA_MANAGEMENT` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `masterDataRouter` (server/routers/masterDataRouter.ts, ~86 thủ tục query/mutation).

