# Trung tâm AI (AI Hub)

## 1. Mục đích
Cổng truy cập trung tâm cho mọi tính năng AI: hiển thị nhóm chức năng (Analysis, Inspection, Models, System), trạng thái nhà cung cấp AI (OpenAI / GGUF / Offline) và quick actions.

## 2. Vị trí truy cập
- URL: `/ai-hub`
- Menu: AI → AI Hub

## 3. Quyền yêu cầu
- Truy cập chung tính năng AI (kế thừa role)
- `ai_hub_view` ngầm định

## 4. Tiền điều kiện
- Cấu hình ít nhất 1 provider hoạt động (OpenAI hoặc GGUF) trong AI Settings

## 5. Các bước thao tác
1. Vào `/ai-hub`
2. Chờ provider status query (refetch mỗi 30s)
3. Xem badge: GGUF Local / OpenAI / Offline + tên model
4. Click thẻ chức năng để điều hướng (AI Chat, Quality Gate, Reports...)
5. Click `Bắt đầu hội thoại AI` → mở `/ai-chat` và tạo conversation mới

## 6. Kết quả mong đợi
- Provider badge cập nhật trạng thái thực
- Click thẻ chuyển trang chính xác
- Quick action tạo conversation thành công

## 7. Lỗi thường gặp & cách xử lý
- Badge `Offline` → vào AI Settings cấu hình API key hoặc bật GGUF model
- Badge `?` → query provider status fail, refresh hoặc kiểm tra server log
- Click thẻ không phản hồi → trang đích chưa build hoặc lỗi route

## 8. API liên quan
- `trpc.aiGguf.providerStatus.useQuery(undefined, { refetchInterval: 30_000 })`

## 9. Tính năng liên quan
- [AI Chat](ai/ai-chat.md)
- [AI Quality Gate](ai/ai-quality-gate.md)
- [AI Settings](ai/ai-settings.md)
- [AI Reports](ai/ai-reports.md)

## 10. Ví dụ thực tế
Kỹ sư mở AI Hub thấy badge `GGUF Local · Llama 2 7B` xanh. Click thẻ `AI Chat` → mở conversation mới, hỏi "Yield hôm nay bao nhiêu?". Hệ thống xử lý local, trả về câu trả lời tức thì không cần internet.
