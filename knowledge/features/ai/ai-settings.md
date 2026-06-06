# Cài đặt AI (AI Settings)

## 1. Mục đích
Trang quản trị toàn bộ cấu hình AI: API keys, model config, hybrid provider (OpenAI + GGUF + fallback), system config, monitoring jobs.

## 2. Vị trí truy cập
- URL: `/ai-settings`
- Menu: AI → AI Settings

## 3. Quyền yêu cầu
- Chỉ Admin

## 4. Tiền điều kiện
- DB tables `apiKeys`, `systemConfig`, `aiJobs`
- Đăng nhập admin

## 5. Các bước thao tác
1. Tab `API Keys`: thêm key (provider, key, label), test, toggle, xoá
2. Tab `Model Config`: chọn activeProvider (openai/gguf), primaryModel
3. Tab `System`: cấu hình system-level (timeout, max tokens, language)
4. Tab `Hybrid Provider`: cấu hình OpenAI + GGUF + priority + circuit breaker
5. Tab `Monitoring`: xem AI Jobs (refetch 5s), batch RCA status (30s), Run Now, Cancel job

## 6. Kết quả mong đợi
- API key test trả về OK
- Active provider áp dụng cho mọi tính năng AI
- Hybrid breaker reset thành công sau lỗi cascading
- Job monitoring realtime

## 7. Lỗi thường gặp & cách xử lý
- API key sai → test fail, không lưu được
- GGUF model không load → giảm size hoặc tăng RAM
- Job stuck → click Cancel, kiểm tra worker logs
- Hybrid breaker open → reset thủ công sau khắc phục

## 8. API liên quan
- `trpc.aiSettings.listApiKeys/createApiKey/deleteApiKey/testApiKey/toggleApiKey`
- `trpc.aiSettings.getConfig/updateConfig({ activeProvider, primaryModel })`
- `trpc.aiSettings.getSystemConfig/updateSystemConfig`
- `trpc.aiSettings.getHybridProviderStatus/setHybridProviderConfig({ openaiConfig, ggufConfig, priority })`
- `trpc.aiSettings.resetHybridBreaker()`
- `trpc.aiSettings.listAiJobs({ limit })` (refetch 5s)
- `trpc.aiSettings.getBatchRcaStatus()` (refetch 30s)
- `trpc.aiSettings.runBatchRcaNow()`
- `trpc.aiSettings.cancelAiJob({ jobId })`

## 9. Tính năng liên quan
- [AI Hub](ai/ai-hub.md)
- [AI Chat](ai/ai-chat.md)
- [AI Local Knowledge Base](ai/ai-local-knowledge-base.md)

## 10. Ví dụ thực tế
Admin thêm OpenAI key, test OK, set activeProvider=openai. Cấu hình Hybrid: OpenAI primary, GGUF fallback (priority [openai, gguf]). Sau lỗi rate-limit OpenAI → breaker open → tự fallback GGUF, đảm bảo zero downtime.
