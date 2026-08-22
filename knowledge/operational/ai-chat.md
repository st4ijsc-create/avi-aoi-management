---
route: /ai-chat
permission: null
role: []
screenVi: Trò chuyện AI
screenEn: AI Chat
inSidebar: true
navGroupVi: AI
navGroupEn: AI
module: MOD_AI
license: OPTIONAL
---

# Trò chuyện AI — Cách vận hành

## Mục đích
doc 78 PHA D — Không gian lập trình AI (cây tệp · trình xem+diff · hội thoại tác nhân). RBAC ai_repo_read.

## Vị trí truy cập
- Menu: AI › Trò chuyện AI
- URL: `/ai-chat`
- English: AI › AI Chat

## Quyền yêu cầu
- Không giới hạn quyền cụ thể (mọi người dùng đã đăng nhập).
- Module: `MOD_AI` (OPTIONAL — cần license).

## Endpoint liên quan
- Router tRPC: `aiChatRouter` (server/routers/aiChatRouter.ts, ~10 thủ tục query/mutation).

