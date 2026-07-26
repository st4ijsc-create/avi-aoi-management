---
route: /andon
permission: dashboard_view
role: []
screenVi: Bảng Andon (TV)
screenEn: Andon Board (TV)
inSidebar: true
navGroupVi: Tổng quan
navGroupEn: Overview
module: CORE_DASHBOARD
license: CORE
---

# Bảng Andon (TV) — Cách vận hành

## Mục đích
W5-C (doc 27 F7): dedicated Andon/TV wall board (huge type, auto-cycle, socket-first + poll fallback)

## Vị trí truy cập
- Menu: Tổng quan › Bảng Andon (TV)
- URL: `/andon`
- English: Overview › Andon Board (TV)

## Quyền yêu cầu
- Permission: `dashboard_view`
- Module: `CORE_DASHBOARD` (CORE — luôn bật).

## Endpoint liên quan
- Router tRPC: `andonRouter` (server/routers/andonRouter.ts, ~8 thủ tục query/mutation).

