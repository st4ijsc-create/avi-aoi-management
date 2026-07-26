---
route: /war-room
permission: machine_status
role: []
screenVi: Giao ban
screenEn: War-room
inSidebar: true
navGroupVi: Sản xuất
navGroupEn: Production
module: null
license: null
---

# Giao ban — Cách vận hành

## Mục đích
doc 40 Wave 4c §11: "Giao ban 7h" theo ca — KPI + OEE theo line + top downtime + so sánh ca + plan-vs-actual (trpc.warRoom.briefing)

## Vị trí truy cập
- Menu: Sản xuất › Giao ban
- URL: `/war-room`
- English: Production › War-room

## Quyền yêu cầu
- Permission: `machine_status`

## Endpoint liên quan
- Router tRPC: `warRoomRouter` (server/routers/warRoomRouter.ts, ~1 thủ tục query/mutation).

