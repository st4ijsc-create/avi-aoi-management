---
route: /equipment-standards
permission: machine_status
role: []
screenVi: Tiêu chuẩn thiết bị
screenEn: Equipment Standards
inSidebar: true
navGroupVi: Kỹ thuật & Điều khiển (Nâng cao)
navGroupEn: Engineering & Control (Advanced)
module: MOD_OT_CONTROL
license: OPTIONAL
---

# Tiêu chuẩn thiết bị — Cách vận hành

## Mục đích
E1 (doc 16 §10 Khối 5): device-type hierarchy + ISA-18.2 alarm taxonomy + Equipment Standards Board (governance metadata only; mutations gated by EQ_GOVERN_ENABLED)

## Vị trí truy cập
- Menu: Kỹ thuật & Điều khiển (Nâng cao) › Tiêu chuẩn thiết bị
- URL: `/equipment-standards`
- English: Engineering & Control (Advanced) › Equipment Standards

## Quyền yêu cầu
- Permission: `machine_status`
- Module: `MOD_OT_CONTROL` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `equipmentStandardsRouter` (server/routers/equipmentStandardsRouter.ts, ~19 thủ tục query/mutation).

