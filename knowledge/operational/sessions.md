---
route: /sessions
permission: admin_system
role:
  - admin
screenVi: Phiên đăng nhập
screenEn: Sessions
inSidebar: true
navGroupVi: Quản trị
navGroupEn: Administration
module: CORE_ADMIN
license: CORE
---

# Phiên đăng nhập — Cách vận hành

## Mục đích
Màn hình `/sessions` (Sessions).

## Vị trí truy cập
- Menu: Quản trị › Phiên đăng nhập
- URL: `/sessions`
- English: Administration › Sessions

## Quyền yêu cầu
- Permission: `admin_system`
- Vai trò bắt buộc: admin
- Module: `CORE_ADMIN` (CORE — luôn bật).

## Endpoint liên quan
- Router tRPC: `sessionRouter` (server/routers/sessionRouter.ts, ~4 thủ tục query/mutation).

