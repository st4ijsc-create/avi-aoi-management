---
route: /factory-command
permission: machine_status
role: []
screenVi: Chỉ huy nhà máy
screenEn: Factory command
inSidebar: true
navGroupVi: Thiết bị & Giám sát
navGroupEn: Devices & Monitoring
module: null
license: null
---

# Chỉ huy nhà máy — Cách vận hành

## Mục đích
doc 40 Wave 4d §13.1: màn hình chỉ huy toàn nhà máy (2D/3D theo Line, click máy → drawer chi tiết)

## Vị trí truy cập
- Menu: Thiết bị & Giám sát › Chỉ huy nhà máy
- URL: `/factory-command`
- English: Devices & Monitoring › Factory command

## Quyền yêu cầu
- Permission: `machine_status`

## Endpoint liên quan
- Router tRPC: `factoryCommandRouter` (server/routers/factoryCommandRouter.ts, ~2 thủ tục query/mutation).

