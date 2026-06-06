# Trò chuyện AI (AI Chat)

## 1. Mục đích
Giao diện chat hội thoại với AI assistant: lưu lịch sử, streaming token theo thời gian thực, tích hợp tools (truy vấn inspection, báo cáo), hỗ trợ nhiều conversation đồng thời.

## 2. Vị trí truy cập
- URL: `/ai-chat`
- Menu: AI → AI Chat

## 3. Quyền yêu cầu
- Tính năng AI (không yêu cầu permission cụ thể, kế thừa role)

## 4. Tiền điều kiện
- Provider AI hoạt động (OpenAI hoặc GGUF)
- Bảng `aiConversations`, `aiMessages` đã migrate

## 5. Các bước thao tác
1. Mở `/ai-chat`, sidebar hiển thị conversations cũ
2. Click `+ New Chat` → tạo conversation, auto-title từ 50 ký tự đầu
3. Nhập câu hỏi vào input, ví dụ "Hôm nay defect rate là bao nhiêu?"
4. Nhấn Send → user message hiển thị ngay
5. Hệ thống thử streaming SSE/WebSocket (10 messages gần nhất, max ~512 tokens)
6. Assistant trả lời streaming từng ký tự
7. Lưu message hoàn chỉnh vào DB
8. Hỏi tiếp follow-up; archive conversation cũ khi không cần

## 6. Kết quả mong đợi
- Streaming token mượt, không trễ > 1s
- Message lưu DB, reload trang vẫn còn
- Stop button huỷ generation an toàn

## 7. Lỗi thường gặp & cách xử lý
- Streaming fail → tự fallback `trpc.aiChat.chat` (chậm hơn)
- Context dài → tự truncate 10 messages cuối
- Empty message → block gửi, toast cảnh báo
- Abort → đảm bảo gọi `aiChat.saveStreamedMessage` để lưu phần đã sinh

## 8. API liên quan
- `trpc.aiChat.listConversations({ limit: 50 })`
- `trpc.aiChat.getConversation({ id, messageLimit: 100 })`
- `trpc.aiChat.tools.useQuery()`
- `trpc.aiChat.createConversation({ title })`
- `trpc.aiChat.deleteConversation({ id })`
- `trpc.aiChat.chat({ conversationId, userMessage, messages, language })`
- `trpc.aiChat.saveStreamedMessage({ conversationId, userMessage, assistantMessage, tokensUsed })`
- Hook `useAIStream()`

## 9. Tính năng liên quan
- [AI Hub](ai/ai-hub.md)
- [AI Local Knowledge Base](ai/ai-local-knowledge-base.md)
- [AI Settings](ai/ai-settings.md)

## 10. Ví dụ thực tế
QA leader mở chat hỏi "Top 3 lỗi tuần này?". AI gọi tool `inspection.list` lấy dữ liệu, trả lời streaming: "1. Solder Bridge 38%, 2. Missing Pad 25%, 3. Cold Joint 12%". QA hỏi tiếp "Máy nào nhiều solder bridge nhất?" → AI tiếp tục dùng context hội thoại trả lời chính xác.
