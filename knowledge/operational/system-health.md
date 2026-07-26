---
route: /system-health
permission: machine_status
role: []
screenVi: Sức khỏe hệ thống
screenEn: System Health
inSidebar: true
navGroupVi: Thiết bị & Giám sát
navGroupEn: Devices & Monitoring
module: null
license: null
---

# Sức khỏe hệ thống — Cách vận hành

## Mục đích
Tier-1b (doc 24): OT store-and-forward + connection HA supervisors + DINOv2 model health + commissioning + twin export

## Vị trí truy cập
- Menu: Thiết bị & Giám sát › Sức khỏe hệ thống
- URL: `/system-health`
- English: Devices & Monitoring › System Health

## Quyền yêu cầu
- Permission: `machine_status`

## Endpoint liên quan
- Router tRPC: `systemHealthRouter` (server/routers/systemHealthRouter.ts, ~4 thủ tục query/mutation).

