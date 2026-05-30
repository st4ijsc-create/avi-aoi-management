# WS-G4 — Gỡ phụ thuộc Ollama

## Mục tiêu
Đưa embeddings KB + embeddings ảnh + intent classifier sang GGUF in-process; server chạy KHÔNG cần Ollama daemon. Giữ `USE_LEGACY_OLLAMA` làm công tắc rollback (mặc định `false`). **Phụ thuộc G1** (sửa `generateEmbedding`).

## Hiện trạng (file:line)
- `aiLocalKnowledgeService.ts:187-189` hằng Ollama; `:437-474` `embedQuestion()` gọi cứng Ollama `/api/embed` (không gate cờ), đã L2-normalize `:465`. QA gen ĐÃ chuyển GGUF khi `!USE_LEGACY_OLLAMA` (`:827-845,933-959` — đường mẫu).
- `aiImageEmbedding.ts:48-49` hằng; `:103-118` `embedTextOllama()` cứng; `:124-147` `embedImageAsText()` (describe LLaVA local → embed Ollama); `DEFAULT_EMBEDDING_DIM=1024`, `TEXT_OF_IMAGE_MODEL_CODE`.
- `aiLocalTools/intentClassifier.ts:302-347` `classifyToolIntentLLM()` Ollama `/api/generate format:json`; heuristic `:163-244` không LLM (giữ).
- `.env` hiện **`USE_LEGACY_OLLAMA=true`** → đang chạy trên Ollama; `GGUF_EMBEDDING_MODEL=mxbai-embed-large-v1-f16.gguf` đã có file.
- KB cũ `embeddings.jsonl`: model `mxbai-embed-large`, 1024-dim, L2 — **cùng model với GGUF mxbai** → cosine khớp, KHÔNG cần re-embed (cần verify bằng test).

## Thiết kế
Mỗi điểm Ollama bọc `if (USE_LEGACY_OLLAMA) {Ollama} else {GGUF}`, mặc định GGUF. Embed GGUF chỉ định đúng `GGUF_EMBED_MODEL_ID` (mxbai, không để rơi vào Qwen). L2-normalize ở caller (giữ đồng nhất). Chữ ký public không đổi; giữ `TEXT_OF_IMAGE_MODEL_CODE` để không phá dữ liệu cũ.

1. **KB `embedQuestion`:** nhánh GGUF `generateEmbedding(question, GGUF_EMBED_MODEL_ID)` → L2; guard `length!==1024` → trả `null` (rơi keyword-only, tránh cosine cắt ngắn sai `:320`); fallback Ollama.
2. **Ảnh `embedTextLocal`:** GGUF mặc định, Ollama legacy; `embedImageAsText` gọi nó; giữ pipeline describe(LLaVA local)→embed.
3. **Intent:** GGUF `generateJSON` (schema `{tool,args}`) thay Ollama; giữ zod validate + reasons; GBNF đảm bảo JSON.
4. **Scripts .mjs (build offline):** khuyến nghị (C) — tạo `scripts/ai-kb/_gguf-embed.mjs` nạp `node-llama-cpp` trực tiếp (singleton, cache embeddingContext, L2) dùng mxbai GGUF; đấu vào `generate-embeddings.mjs` + `backfill-image-embeddings.mjs` (gate cờ); backfill vision có thể giữ Ollama-vision tùy chọn. Embed PHẢI dùng mxbai GGUF để cùng không gian KB.
5. **Cờ:** mở rộng `USE_LEGACY_OLLAMA` bao luôn 3 điểm trên; lật `.env` → `false`; tài liệu: `false` thì không cần `OLLAMA_*`/daemon.

## Bước thực hiện
1. (G1 tiền đề) `generateEmbedding` dùng `createEmbeddingContext` + nạp đúng model embedding + cache + ~1024-dim.
2. `aiLocalKnowledgeService`: hằng `GGUF_EMBED_MODEL_ID`, nhánh GGUF + guard dim + cache + fallback.
3. `aiImageEmbedding`: `embedTextLocal()` GGUF/Ollama; refactor `embedImageAsText`; giữ `embedTextOllama` export.
4. `intentClassifier`: nhánh GGUF `generateJSON`.
5. Scripts: `_gguf-embed.mjs` + đấu nối + cập nhật meta model.
6. Lật `.env USE_LEGACY_OLLAMA=false`; cập nhật docs.
7. Tests.

## Files
`aiGgufEngine.ts` (G1) · `aiLocalKnowledgeService.ts` · `aiImageEmbedding.ts` · `aiLocalTools/intentClassifier.ts` · `scripts/ai-kb/{generate-embeddings,backfill-image-embeddings,_gguf-embed}.mjs` · `.env`.

## Tests
Embed GGUF dim=1024 không NaN; **cosine vector cũ (Ollama) vs GGUF trên cùng text ≥ 0.92** (then chốt "không re-embed"); retrieve end-to-end top-1 không sụt; image embed dim 1024 + modelCode giữ; intent classify đúng nhãn (GBNF luôn parse); guard dim mismatch → null không crash.

## Nghiệm thu
`USE_LEGACY_OLLAMA=false` + **tắt Ollama daemon** → server chạy OK; RAG/image-search/intent trả kết quả, **không có `ECONNREFUSED 127.0.0.1:11434`** trong log; image search `searchMode` hnsw/exact (không rơi metadata do embed lỗi).

## Rủi ro
R1 (cao nhất) lệch embedding cũ/mới (prefix/pooling/quantization mxbai Ollama vs GGUF f16) → chạy test cosine TRƯỚC; nếu <0.9 phải re-embed cả corpus bằng `generate-embeddings.mjs` (đã GGUF); kiểm mxbai có cần prompt-prefix truy vấn. R2 hiệu năng embed GGUF (cache context bắt buộc; GPU nhanh, CPU chậm). R3 VRAM khi qwen+mxbai+llava đồng cư → eviction G1. R4 cosine cắt ngắn → guard dim. R6 quên lật `.env` cờ.

## Critical files
`server/services/aiGgufEngine.ts` · `aiLocalKnowledgeService.ts` · `aiImageEmbedding.ts` · `aiLocalTools/intentClassifier.ts` · `scripts/ai-kb/generate-embeddings.mjs`
