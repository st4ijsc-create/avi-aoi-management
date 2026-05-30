# Nhánh A — Chuyển toàn bộ AI sang Local GGUF (kế hoạch chi tiết)

> Tạo 2026-05-30. Nguồn: 3 agent rà soát + 4 agent kiến trúc sư (đã xác minh file:line + API thật trong node_modules).
> Quyết định chủ dự án: làm Nhánh A trước; vision = "nâng node-llama-cpp in-process"; lập kế hoạch chi tiết rồi triển khai.

## ⚠️ CẢNH BÁO CHẶN (đảo tiền đề quyết định) — G2 Vision
Quyết định "nâng node-llama-cpp lên bản hỗ trợ multimodal in-process" **KHÔNG khả thi hiện tại**. Đã xác minh:
- `npm view node-llama-cpp dist-tags` → `latest = 3.18.1`, không có bản nào cao hơn hỗ trợ vision.
- GitHub issue #88 "pass an image as part of evaluation" vẫn **OPEN**, gắn **milestone v4.0.0** (chưa phát hành, chưa có ngày). #562/#585 đóng là duplicate của #88.
- Type thật `LlamaChatSession.prompt()` trong 3.18.1 **không có** option `image/images/mmproj`; grep `dist` không có `mtmd/mmproj/llava/tokenizeImage`.

→ **Vision in-process bằng node-llama-cpp chưa tồn tại.** Phải chọn lại hướng cho G2 (xem [WS-G2](WS-G2-vision-local.md)): **(A) sidecar llama.cpp mtmd-server local** (khả thi ngay, vẫn 100% offline, nhưng là tiến trình con) hoặc **(B) chờ v4.0.0** (đúng ràng buộc in-process nhưng vô thời hạn).

## Thứ tự triển khai
**G1 (nền) → G4 (gỡ Ollama, phụ thuộc G1) → G3 (thay cloud, phần text/JSON) → G2 (vision, chờ quyết định hướng).**
G1/G3-text/G4 khả thi 100% ngay. G2 và phần vision của G3 (inspection image, annotation, compareImages, generateQAReport) chờ quyết định G2.

## Hiện trạng "local hoá" (đã rà soát)
- ✅ Đã local: RCA, report narrative, inspection analytics, specialist agent, smart alert, time-series, quality gate, active learning, ONNX inference, training, KB QA generation (qua `aiProviderRouter` local-only + `aiGgufEngine`).
- 🔴 Còn cloud (6 điểm): `_core/llm.ts` (forge/gemini), inspection image, annotation, `compareImages`, `generateQAReport`, ưu tiên OpenAI trong chat.
- 🔴 Engine GGUF có 2 lỗi chặn: embeddings dùng constructor private; vision không được lib hỗ trợ.
- 🟠 `.env` đang `USE_LEGACY_OLLAMA=true` → hệ thống **đang chạy trên Ollama**; embeddings KB/ảnh + intent classifier còn gọi Ollama.

## Workstream
- [WS-G1](WS-G1-gguf-engine-core.md) — Sửa lõi GGUF engine (embeddings, JSON-grammar, LRU, .env).
- [WS-G2](WS-G2-vision-local.md) — Vision local (sidecar llama.cpp mtmd + Qwen2-VL).
- [WS-G3](WS-G3-replace-cloud-llm.md) — Thay 6 điểm cloud LLM bằng GGUF.
- [WS-G4](WS-G4-remove-ollama.md) — Gỡ Ollama (embeddings + intent → GGUF).

---

## ✅ KẾT QUẢ TRIỂN KHAI NHÁNH A (2026-05-30)
Quyết định đã chốt: vision = **sidecar llama.cpp mtmd-server local** + model **Qwen2-VL-7B-Instruct GGUF + mmproj**.

| WS | Trọng tâm | Test | Typecheck |
|---|---|---|---|
| **G1** | Sửa embeddings (`createEmbeddingContext`), JSON-grammar nhất quán, LRU + giới hạn VRAM, `.env` đầy đủ | 7/7 ✅ | 0 lỗi mới |
| **G4** | embeddings KB + ảnh + intent → GGUF (gate `USE_LEGACY_OLLAMA`), scripts self-contained | 20/20 ✅ | 0 lỗi mới |
| **G3** | `invokeLLM` route qua GGUF (giữ chữ ký), chat ưu tiên GGUF, dọn dead OpenAI | 8/8 + 22 regression ✅ | 0 lỗi mới |
| **G2** | `llamaVisionSidecar.ts` (spawn llama-server, healthcheck, idle-kill), describe trung thực, validate GGUF, compareImages/QAReport → sidecar | 11/11 ✅ | 0 lỗi mới |
| **Tổng** | | **46/46 PASS** | **0 lỗi type mới** |

### Files chính
**Tạo:** `server/services/llamaVisionSidecar.ts`, `scripts/ai-kb/_gguf-embed.mjs` + 6 file test.
**Sửa:** `aiGgufEngine.ts`, `aiProviderRouter.ts`, `aiVisionLanguage.ts`, `aiLocalKnowledgeService.ts`, `aiImageEmbedding.ts`, `aiLocalTools/intentClassifier.ts`, `_core/llm.ts`, `aiChatAssistant.ts`, `aiInsightsService.ts`, `aiProviderManager.ts`, `scripts/ai-kb/{generate-embeddings,backfill-image-embeddings}.mjs`, `.env.example`.

### ⚠️ Cần con người làm tiếp (môi trường thật)
1. **Lật `.env`:** `USE_LEGACY_OLLAMA=false`; đặt `GGUF_EMBED_MODEL=mxbai-embed-large-v1-f16`.
2. **Test cosine "không re-embed" (rủi ro R1 cao nhất):** so vector mxbai-Ollama (corpus cũ) vs mxbai-GGUF trên cùng text, kỳ vọng ≥0.92; nếu <0.9 phải re-embed corpus bằng `generate-embeddings.mjs` (đã GGUF).
3. **Vision (G2):** tải Qwen2-VL-7B GGUF + mmproj khớp vào `uploads/gguf-models/` (xoá file LLaVA 70MB hỏng); cài/build `llama-server` có mtmd; set `LLAMA_SERVER_BIN`/`GGUF_VISION_MODEL`/`GGUF_VISION_MMPROJ`; test vision thật (OCR/so sánh OK-NG, vi/en). Xem [WS-G2 §Hướng dẫn cài đặt](WS-G2-vision-local.md).
4. Tắt Ollama daemon → kiểm log không có `ECONNREFUSED 127.0.0.1:11434`.

### Trạng thái "100% local"
- ✅ **Text/JSON/RCA/report/chat/inspection-analytics:** local GGUF thật, không cloud.
- ✅ **Embeddings (KB + ảnh) + intent:** GGUF in-process (gate rollback) — chạy khi lật `USE_LEGACY_OLLAMA=false` + có model mxbai.
- 🟡 **Vision:** code + sidecar sẵn sàng; **chạy thật khi con người cung cấp binary llama-server + model Qwen2-VL**. Khi chưa có → degrade trung thực (không bịa), hệ thống vẫn chạy.
