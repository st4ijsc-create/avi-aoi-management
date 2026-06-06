# Cơ sở tri thức AI Local (AI Local Knowledge Base)

## 1. Mục đích
Hệ thống Q&A nội bộ chạy hoàn toàn local (Ollama + qwen2.5 + mxbai-embed-large), trả lời câu hỏi về quy trình AVI-AOI dựa trên knowledge base RAG (chunks + graph), không phụ thuộc cloud.

## 2. Vị trí truy cập
- URL: `/ai-local-kb`
- Menu: AI → Local Knowledge Base
- Embedded chat bubble: `AILocalChatBubble` (góc phải dưới mọi trang)

## 3. Quyền yêu cầu
- Truy cập tính năng AI (kế thừa role)
- Bubble chat dùng `FIXED_USER_ROLE = "engineer"`

## 4. Tiền điều kiện
- Ollama service chạy 127.0.0.1:11434
- Model `qwen2.5:3b-instruct` + `mxbai-embed-large` đã pull
- KB đã reload thành công (chunks > 0)
- env `USE_LEGACY_OLLAMA=true`, `KB_QA_NUM_PREDICT=384`

## 5. Các bước thao tác
1. Mở `/ai-local-kb`, đọc benefit cards (offline, privacy, low latency)
2. Tham khảo FAQ cards (quy trình thường hỏi)
3. Click chat → input câu hỏi, ví dụ "Cách tạo AOI Package?"
4. Hệ thống RAG: embed → top-K chunks → context prompt → LLM
5. Đọc câu trả lời + nguồn tham chiếu (file MD)
6. Hỏi follow-up trong cùng conversation
7. Admin: POST `/api/ai/local-kb/reload` để reload KB sau khi cập nhật MD files

## 6. Kết quả mong đợi
- Latency p50 < 5s, p95 ≤ 11s
- Câu trả lời chính xác, có cite nguồn
- Hoạt động offline 100%

## 7. Lỗi thường gặp & cách xử lý
- Ollama offline → "Knowledge base not available", kiểm tra `ollama serve`
- Câu trả lời sai → reload KB, kiểm tra MD content & template
- Chậm > 15s → giảm `KB_QA_NUM_PREDICT`, kiểm tra model size phù hợp RAM
- Empty answer → mở rộng MD, tăng `topK` (5 → 8)

## 8. API liên quan
- POST `/api/ai/local-kb/reload`
- Service: `aiLocalKnowledgeService.ts` → `getSystemPromptForRole(role)` (L458-475 phục vụ VI_DETAIL)
- Component: `AILocalChatBubble.tsx`, `AILocalKnowledgeBase`

## 9. Tính năng liên quan
- [AI Chat](ai/ai-chat.md)
- [AI Settings](ai/ai-settings.md)
- [AI Hub](ai/ai-hub.md)

## 10. Ví dụ thực tế
Operator hỏi qua chat bubble: "Làm sao tạo AOI Package mới?". Hệ thống trả lời chi tiết theo MD `inspection/aoi-packages.md`: bước 1 vào /aoi-packages, bước 2 click `+ New Package`... Operator làm theo, không cần hỏi quản lý, tiết kiệm thời gian onboarding.
