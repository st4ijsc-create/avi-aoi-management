---
route: /license
permission: admin_system
role:
  - admin
screenVi: Quản lý bản quyền
screenEn: License Management
inSidebar: true
navGroupVi: Quản trị
navGroupEn: Administration
module: CORE_ADMIN
license: CORE
---

# Quản lý bản quyền — Cách vận hành

## Mục đích
Màn hình `/license` (License Management).

## Vị trí truy cập
- Menu: Quản trị › Quản lý bản quyền
- URL: `/license`
- English: Administration › License Management

## Quyền yêu cầu
- Permission: `admin_system`
- Vai trò bắt buộc: admin
- Module: `CORE_ADMIN` (CORE — luôn bật).

## Endpoint liên quan
- Router tRPC: `licenseRouter` (server/routers/licenseRouter.ts, ~32 thủ tục query/mutation).

