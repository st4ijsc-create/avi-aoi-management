---
route: /sites
permission: admin_system
role:
  - admin
screenVi: Liên kết các site
screenEn: Sites Federation
inSidebar: true
navGroupVi: Quản trị
navGroupEn: Administration
module: MOD_FEDERATION
license: OPTIONAL
---

# Liên kết các site — Cách vận hành

## Mục đích
Doc 13 / F0: Multi-site Federation sites registry (admin)

## Vị trí truy cập
- Menu: Quản trị › Liên kết các site
- URL: `/sites`
- English: Administration › Sites Federation

## Quyền yêu cầu
- Permission: `admin_system`
- Vai trò bắt buộc: admin
- Module: `MOD_FEDERATION` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `sitesRouter` (server/routers/sitesRouter.ts, ~7 thủ tục query/mutation).

