# WS-G1 — Sửa lõi GGUF engine

## Mục tiêu
Sửa lõi `aiGgufEngine.ts` cho node-llama-cpp **3.18.1**: (1) embeddings dùng API hợp lệ, trả đúng 1024-dim; (2) JSON qua grammar nhất quán; (3) LRU + giới hạn bộ nhớ chống OOM; (4) tài liệu hoá `.env`. Offline-first, backward-compatible (giữ chữ ký public).

## Hiện trạng (file:line đã xác minh)
- `aiGgufEngine.ts:1016,1040` — `new LlamaEmbeddingContext({model})` constructor **private** trong 3.18.1 → ném lỗi. Route `aiGgufRouter.embedding:196` hỏng theo.
- `aiGgufEngine.ts:1019,1046` — ép `as Float32Array` sai; `LlamaEmbedding.vector` là `readonly number[]`.
- `aiGgufEngine.ts:893-910` `generateQualityInsights` — "respond JSON" + `JSON.parse` (dễ vỡ) thay vì `generateJSON` grammar (đã có, chạy đúng `:407-476`).
- `aiGgufEngine.ts:120` `loadedModels` Map — không LRU/giới hạn; `sequences:4` cố định `:204`.
- `.env.example` thiếu toàn bộ biến GGUF/Ollama dù code đọc.

## API đúng đã xác minh (node_modules 3.18.1)
- `model.createEmbeddingContext(options?)` → `LlamaEmbeddingContext` (`LlamaModel.d.ts:244`); constructor private (`LlamaEmbeddingContext.d.ts:45`).
- `embeddingContext.getEmbeddingFor(input)` → `LlamaEmbedding` (`.vector: readonly number[]`).
- `model.embeddingVectorSize: number` (`LlamaModel.d.ts:260`); `model.size` (`:198`); `model.dispose()` (`:179`).
- `llama.createGrammarForJsonSchema(schema)` (`Llama.d.ts:97`); `llama.getVramState()` (`:62`).

## Thiết kế
1. **Embeddings:** dùng `model.createEmbeddingContext({contextSize:"auto",batchSize})` + `getEmbeddingFor`; bỏ `as Float32Array`; `dimensions = model.embeddingVectorSize`; kiểm `GGUF_EMBED_DIM` (default 1024) → ném lỗi nếu lệch; **cache embeddingContext** trong `LoadedModel`; auto-chọn `GGUF_EMBED_MODEL` (mxbai) khi `modelId` rỗng (tránh dùng nhầm Qwen text).
2. **JSON-grammar:** thêm hằng `QUALITY_INSIGHTS_SCHEMA`, viết lại `generateQualityInsights` dùng `generateJSON`; giữ fallback an toàn + song ngữ vi/en.
3. **LRU + bộ nhớ:** env `GGUF_MAX_LOADED_MODELS` (default 2), `GGUF_MAX_VRAM_MB` (default 0=tắt). `ensureCapacity()` + `evictLRU()` theo `lastUsedAt`, dùng `refCount` để không evict model đang dùng; `sizeBytes=model.size`; `sequences` cấu hình qua env.
4. **Vision placeholder:** chỉ comment "// G2", không sửa logic; đảm bảo eviction dispose cả model vision.
5. **.env.example:** thêm khối `GGUF_*` + `OLLAMA_*` + `USE_LEGACY_OLLAMA` (khớp tên biến code đọc).

## Bước thực hiện
1. Mở rộng `LoadedModel`: `embeddingContext?`, `sizeBytes`, `refCount`.
2. Đọc env LRU/embedding ở đầu module.
3. `ensureCapacity()`+`evictLRU()` dùng `getVramState()`+`lastUsedAt`+`refCount`.
4. `loadGgufModel`/`loadLlavaModel`: gọi `ensureCapacity` trước load; lưu `sizeBytes`; `sequences` từ env.
5. `unloadGgufModel`: dispose `embeddingContext` trước `context`/`model`.
6. `refCount` ++/-- ở `getOrLoadModel` + `finally` các hàm sinh.
7. Sửa `generateEmbedding`/`generateEmbeddings` (API đúng + cache + dim + auto GGUF_EMBED_MODEL).
8. `QUALITY_INSIGHTS_SCHEMA` + viết lại `generateQualityInsights`.
9. `getLoadedGgufModels`/`getEngineHealth` phơi `sizeBytes`/max/VRAM.
10. `.env.example` thêm khối GGUF/Ollama.
11. Test Vitest.

## Files
**Sửa:** `server/services/aiGgufEngine.ts`, `.env.example`. **Tạo:** `server/services/aiGgufEngine.test.ts`.

## Tests (Vitest)
Tầng A (mock `node-llama-cpp`, chạy CI): embedding dim=1024 + dùng `createEmbeddingContext` (KHÔNG `new LlamaEmbeddingContext`); dim mismatch → lỗi; cache context gọi 1 lần; grammar JSON ổn định 5 lần; LRU evict by count; không evict model đang dùng (refCount>0); unload dispose embeddingContext.
Tầng B (`skipIf(!GGUF_TEST_MODEL)`): mxbai thật → dim 1024, cosine 2 câu gần nghĩa > 0.9.

## Nghiệm thu
`aiGgufRouter.embedding` trả `number[1024]` không lỗi; `generateQualityInsights` luôn đúng schema; vượt `GGUF_MAX_LOADED_MODELS` → tự evict không OOM; chữ ký public không đổi (router/providerRouter/KB build không sửa); `.env.example` đủ biến.

## Rủi ro
Model text không hỗ trợ embedding → tách `GGUF_EMBED_MODEL` + lỗi rõ. `getVramState` sai trên CPU/unified → VRAM cap opt-in (default tắt). Eviction giữa request → refCount. Cache embeddingContext giữ thêm VRAM → dispose khi unload.

## Critical files
`server/services/aiGgufEngine.ts` · `.env.example` · `server/routers/aiGgufRouter.ts` · `server/services/aiProviderRouter.ts`
