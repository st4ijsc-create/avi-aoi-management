---
route: /alarm-kpi
permission: machine_status
role: []
screenVi: Alarm Kpi Dashboard
screenEn: Alarm Kpi Dashboard
inSidebar: false
navGroupVi: null
navGroupEn: null
module: null
license: null
---

# Alarm Kpi Dashboard — Cách vận hành

## Mục đích
doc 44 W6-1 §G5.11: ISA-18.2 alarm KPI (rate/flood/standing/bad-actors/distribution)

## Vị trí truy cập
- Không có trong menu sidebar — truy cập trực tiếp qua URL.
- URL: `/alarm-kpi`
- English: Alarm Kpi Dashboard

## Quyền yêu cầu
- Permission: `machine_status`

## Endpoint liên quan
- Router tRPC: `alarmKpiRouter` (server/routers/alarmKpiRouter.ts, ~1 thủ tục query/mutation).

