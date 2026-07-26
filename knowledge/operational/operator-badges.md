---
route: /operator-badges
permission: masterdata
role: []
screenVi: Thẻ nhân viên
screenEn: Operator Badges
inSidebar: true
navGroupVi: Quản lý dữ liệu
navGroupEn: Data Management
module: MOD_DATA_MANAGEMENT
license: OPTIONAL
---

# Thẻ nhân viên — Cách vận hành

## Mục đích
W8-B (doc 29 §3): operator/badge master — badgeCode → users.id with validity windows

## Vị trí truy cập
- Menu: Quản lý dữ liệu › Thẻ nhân viên
- URL: `/operator-badges`
- English: Data Management › Operator Badges

## Quyền yêu cầu
- Permission: `masterdata`
- Module: `MOD_DATA_MANAGEMENT` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `operatorBadgeRouter` (server/routers/operatorBadgeRouter.ts, ~7 thủ tục query/mutation).

