---
route: /user-assignments
permission: admin_users
role:
  - admin
screenVi: User Assignments
screenEn: User Assignments
inSidebar: false
navGroupVi: null
navGroupEn: null
module: CORE_ADMIN
license: CORE
---

# User Assignments — Cách vận hành

## Mục đích
Màn hình `/user-assignments` (User Assignments).

## Vị trí truy cập
- Không có trong menu sidebar — truy cập trực tiếp qua URL.
- URL: `/user-assignments`
- English: User Assignments

## Quyền yêu cầu
- Permission: `admin_users`
- Vai trò bắt buộc: admin
- Module: `CORE_ADMIN` (CORE — luôn bật).

## Endpoint liên quan
- Router tRPC: `userAssignmentRouter` (server/routers/userRouters.ts, ~28 thủ tục query/mutation).

