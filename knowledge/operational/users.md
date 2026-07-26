---
route: /users
permission: admin_users
role:
  - admin
screenVi: Người dùng
screenEn: Users
inSidebar: true
navGroupVi: Quản trị
navGroupEn: Administration
module: CORE_ADMIN
license: CORE
---

# Người dùng — Cách vận hành

## Mục đích
Màn hình `/users` (Users).

## Vị trí truy cập
- Menu: Quản trị › Người dùng
- URL: `/users`
- English: Administration › Users

## Quyền yêu cầu
- Permission: `admin_users`
- Vai trò bắt buộc: admin
- Module: `CORE_ADMIN` (CORE — luôn bật).

## Endpoint liên quan
- Router tRPC: `userRouter` (server/routers/userRouters.ts, ~29 thủ tục query/mutation).

