---
route: /feeder-verify
permission: machine_status
role: []
screenVi: Vật tư tại line
screenEn: Line Materials
inSidebar: true
navGroupVi: Sản xuất
navGroupEn: Production
module: MOD_PRODUCTION
license: OPTIONAL
---

# Vật tư tại line — Cách vận hành

## Mục đích
doc 35 W4-C: SMT feeder-setup scan verification (slot↔BOM/program, anti-mispick)

## Vị trí truy cập
- Menu: Sản xuất › Vật tư tại line
- URL: `/feeder-verify`
- English: Production › Line Materials

## Quyền yêu cầu
- Permission: `machine_status`
- Module: `MOD_PRODUCTION` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `feederVerifyRouter` (server/routers/feederVerifyRouter.ts, ~4 thủ tục query/mutation).

