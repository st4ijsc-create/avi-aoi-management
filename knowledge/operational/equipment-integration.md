---
route: /equipment-integration
permission: machine_status
role: []
screenVi: Tích hợp thiết bị
screenEn: Equipment Integration
inSidebar: true
navGroupVi: Kỹ thuật & Điều khiển (Nâng cao)
navGroupEn: Engineering & Control (Advanced)
module: MOD_OT_CONTROL
license: OPTIONAL
---

# Tích hợp thiết bị — Cách vận hành

## Mục đích
I1 (doc 16 §6 Khối 1B): FOCAS/Euromap integration frameworks (read-only) + recipe versioning genealogy (mutations gated by EQ_INTEG_ENABLED)

## Vị trí truy cập
- Menu: Kỹ thuật & Điều khiển (Nâng cao) › Tích hợp thiết bị
- URL: `/equipment-integration`
- English: Engineering & Control (Advanced) › Equipment Integration

## Quyền yêu cầu
- Permission: `machine_status`
- Module: `MOD_OT_CONTROL` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `equipmentIntegrationRouter` (server/routers/equipmentIntegrationRouter.ts, ~12 thủ tục query/mutation).

