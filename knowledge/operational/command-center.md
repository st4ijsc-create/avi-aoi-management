---
route: /command-center
permission: machine_status
role: []
screenVi: Sơ đồ & bản sao số
screenEn: Layout & Digital Twin
inSidebar: true
navGroupVi: Tổng quan
navGroupEn: Overview
module: CORE_DASHBOARD
license: CORE
---

# Sơ đồ & bản sao số — Cách vận hành

## Mục đích
U2 (doc 21 §6 G-3): Ecosystem Command Center — single pane (hierarchy tree + factory twin + KPI strip + unified live alarm rail)

## Vị trí truy cập
- Menu: Tổng quan › Sơ đồ & bản sao số
- URL: `/command-center`
- English: Overview › Layout & Digital Twin

## Quyền yêu cầu
- Permission: `machine_status`
- Module: `CORE_DASHBOARD` (CORE — luôn bật).

## Endpoint liên quan
- Router tRPC: `commandCenterRouter` (server/routers/commandCenterRouter.ts, ~4 thủ tục query/mutation).

