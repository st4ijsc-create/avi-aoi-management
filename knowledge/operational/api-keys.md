---
route: /api-keys
permission: admin_system
role:
  - admin
screenVi: Khoá API
screenEn: API Keys
inSidebar: true
navGroupVi: Quản trị
navGroupEn: Administration
module: CORE_ADMIN
license: CORE
---

# Khoá API — Cách vận hành

## Mục đích
Control plane: scoped API-key admin CRUD (create-show-once)

## Vị trí truy cập
- Menu: Quản trị › Khoá API
- URL: `/api-keys`
- English: Administration › API Keys

## Quyền yêu cầu
- Permission: `admin_system`
- Vai trò bắt buộc: admin
- Module: `CORE_ADMIN` (CORE — luôn bật).

## Endpoint liên quan
- Router tRPC: `apiKeyRouter` (server/routers/apiKeyRouter.ts, ~6 thủ tục query/mutation).

