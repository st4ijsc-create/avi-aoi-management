# WS-3 — Vector Search ảnh NG tương tự

> Quyết định đã chốt: **nguồn embedding = Ollama text-of-image (mô tả ảnh bằng LLM rồi embed text), D = 1024** (mxbai-embed-large, thống nhất với knowledge base). ONNX embedding ảnh trực tiếp KHÔNG dùng (đang tạm dừng).

## 1. Mục tiêu
- Chuyển embedding từ TEXT → cột `vector(1024)` pgvector + index HNSW (cosine) để top-K nhanh.
- Hoàn thiện API similarity search có cosine score + filter `machineId/productModelId/defectType/label`.
- Migrate dữ liệu cũ + backfill ảnh inspection cũ.
- Tích hợp UI `AIImageSearchPage.tsx` + panel similar-search trong `AdvancedVisionLabPage.tsx`.
- Nghiệm thu top-20 p95 < 300ms.

## 2. Hiện trạng (file:line)
- `drizzle/schema/ai.ts:1096-1119` `aiImageEmbeddings`: `embedding` là `text` (`:1101`), `embeddingDim` (`:1102`); 7 b-tree index metadata, CHƯA có index vector.
- `drizzle/0076_*.sql:113` đã `CREATE EXTENSION IF NOT EXISTS vector` nhưng cột tạo là `text NOT NULL`.
- `server/services/aiImageEmbedding.ts`: `storeEmbedding:321-359` lưu chuỗi `"[v1,...]"`; `ensurePgvector:290-317`; `findSimilarByVector:400-469` cast `embedding::vector(${dim}) <=> ...` runtime trên cột TEXT → **full scan O(N)**; fallback `searchByMetadataFallback:52-149` (keyword).
- `server/routers/aiImageSearchRouter.ts`: `embed`(admin), `findSimilar`, `searchByUpload`, `clusterDefects`, `stats`, `uploadForSearch`. Không license gating.
- Pipeline text Ollama: `scripts/ai-kb/generate-embeddings.mjs` + `aiLocalKnowledgeService.ts:188,446-455` (`OLLAMA_EMBED_MODEL=mxbai-embed-large`, 1024-dim, L2-normalize, `/api/embed`).
- Runner migration: `scripts/migrate-standalone.mjs` (idempotent, `__applied_migrations`, split `--> statement-breakpoint`).
- UI `AIImageSearchPage.tsx`: tab Embed báo "tạm dừng sau khi bỏ ONNX" (`:461`). `AdvancedVisionLabPage.tsx`: chưa có similar search.

## 3. Quyết định kỹ thuật
- Thêm cột mới `embedding_vec vector(1024)`; giữ `embedding TEXT` làm nguồn raw/back-compat.
- **Sinh embedding:** mô tả ảnh bằng LLM (`describeDefect` đã có) → embed text qua Ollama `/api/embed` (mxbai, 1024-dim, normalize). Thống nhất với KB pipeline.
- **Index:** HNSW `vector_cosine_ops` (embedding đã L2-normalize) `WITH (m=16, ef_construction=64)`; query `SET hnsw.ef_search = 40..100`.
- Chỉ so sánh trong cùng không gian D=1024 (filter `embeddingDim=1024`/`modelCode`) — tránh trộn vector khác chiều (cũng sửa lỗi tiềm ẩn so sánh chéo model hiện tại).
- **Fallback nhiều tầng** (offline-first): HNSW → cast runtime → brute-force cosine trong Node (parse TEXT, dot product vì đã normalize, giới hạn N) → metadata keyword. Trả cờ `searchMode` cho UI.

## 4. API (server/routers/aiImageSearchRouter.ts)
- `searchByUpload` (mutation): input ảnh → mô tả → embed → top-K; filter +`defectType`; output thêm `searchMode`, `processingTimeMs`.
- `findSimilar` (query): by `embeddingId`, +`defectType` filter.
- `searchByVector` (MỚI): client/edge gửi sẵn vector + dim; validate `dim===1024`.
- `embed` (admin): ghi đồng thời `embedding_vec`.
- `stats`: +`indexedCount`, `pgvectorAvailable`, `defaultDim`.

## 5. Migration & migrate dữ liệu
`drizzle/0091_image_embeddings_pgvector.sql` (idempotent):
1. `CREATE EXTENSION IF NOT EXISTS vector;`
2. `ALTER TABLE ai_image_embeddings ADD COLUMN IF NOT EXISTS embedding_vec vector(1024);`
3. Backfill trong `DO $$ ... EXCEPTION` block: `UPDATE ... SET embedding_vec = embedding::vector(1024) WHERE embedding_vec IS NULL AND "embeddingDim"=1024 AND embedding IS NOT NULL;`
4. `CREATE INDEX IF NOT EXISTS idx_image_emb_vec_hnsw ... USING hnsw (embedding_vec vector_cosine_ops) WITH (m=16, ef_construction=64);`

Backfill ảnh cũ — script mới `scripts/ai-kb/backfill-image-embeddings.mjs`: với mỗi ảnh inspection chưa có embedding → `describeDefect` → embed text Ollama (1024-dim) → lưu. Idempotent, resume, log tiến độ. Build index SAU backfill.

## 6. UI
- `AIImageSearchPage.tsx`: thêm filter `defectType`; badge `searchMode` (HNSW/Exact/Bruteforce/Metadata); trạng thái indexed (`stats.indexedCount`).
- `AdvancedVisionLabPage.tsx`: panel "Tìm lỗi tương tự" → `searchByUpload`/`searchByVector` → grid top-K.
- (Tùy chọn) tách `client/src/components/ai/SimilarImageGrid.tsx` dùng chung.
- i18n vi/en/zh (namespace `is.*`).

## 7. Các bước
1. Migration SQL (`--dry-run` rồi apply).
2. Cập nhật schema Drizzle (`embeddingVec` qua customType; index giữ trong SQL thủ công + comment).
3. Service: `storeEmbedding` ghi `embedding_vec`; `findSimilarByVector` nhánh HNSW + filter defectType + `searchMode`; brute-force fallback; `getEmbeddingStats` mở rộng.
4. Router: filter defectType, `searchByVector`, license gate.
5. Backfill script.
6. UI + i18n.
7. Tests + benchmark.

## 8. Files
**Sửa:** `drizzle/schema/ai.ts`, `server/services/aiImageEmbedding.ts`, `server/routers/aiImageSearchRouter.ts`, `client/src/pages/AIImageSearchPage.tsx`, `AdvancedVisionLabPage.tsx`, i18n vi/en/zh, (có thể) `App.tsx` (license guard route).
**Tạo:** `drizzle/0091_image_embeddings_pgvector.sql`, `scripts/ai-kb/backfill-image-embeddings.mjs`, `server/services/aiImageEmbedding.test.ts`, (tùy chọn) `SimilarImageGrid.tsx`.

## 9. Tests Vitest
cosineSim/normalize (norm≈1, trùng=1) · format `"[..]"` · metadata fallback scoring/sort · clusterDefects greedy · fallback tầng khi `ensurePgvector` throw · (integration, skipIf no DB) insert N vector → top-K đúng + filter + `EXPLAIN ANALYZE` dùng index.

## 10. Nghiệm thu
top-20 p95 < 300ms trên ≥100k vector (xác nhận `Index Scan idx_image_emb_vec_hnsw`) · cosine ∈ [0,1] sort giảm + filter đúng · không pgvector vẫn trả kết quả kèm `searchMode` (không 500) · UI grid + %similarity + searchMode · backfill idempotent.

## 11. Rủi ro
- pgvector phải có trong Postgres đóng gói; `CREATE EXTENSION` cần quyền owner → tài liệu hóa. Fallback Node chỉ hợp quy mô nhỏ.
- Dim không đồng nhất → ràng buộc 1 cột D=1024, chỉ index dòng cùng dim.
- HNSW build chậm/tốn RAM → build sau backfill, theo dõi `maintenance_work_mem`.
- License gating: router hiện không gate → thêm check trong procedure.
- text-of-image embedding kém chính xác hơn embedding ảnh trực tiếp → chấp nhận đánh đổi để offline-first + thống nhất KB (đã chốt).
- Backfill dòng hỏng → DO/EXCEPTION + lọc `embeddingDim`.

## Critical files
`server/services/aiImageEmbedding.ts` · `server/routers/aiImageSearchRouter.ts` · `drizzle/schema/ai.ts` · `client/src/pages/AIImageSearchPage.tsx` · `scripts/migrate-standalone.mjs`

---

## ✅ KẾT QUẢ TRIỂN KHAI (2026-05-30) — HOÀN TẤT (chờ môi trường để nghiệm thu cuối)

### Files đã tạo/sửa
**Tạo:** `drizzle/0091_image_embeddings_pgvector.sql` · `scripts/ai-kb/backfill-image-embeddings.mjs` · `server/services/aiImageEmbedding.test.ts` · `client/src/components/ai/SimilarImageGrid.tsx`.
**Sửa:** `drizzle/schema/ai.ts` (customType `pgvector(1024)` cho `embeddingVec`) · `server/services/aiImageEmbedding.ts` (pipeline text-of-image `embedTextOllama`/`embedImageAsText`, helper cosine/normalize/parse, `storeEmbedding` ghi `embedding_vec`, `findSimilarByVectorWithMode` 3 tầng + filter defectType + `searchMode`, `getEmbeddingStats` mở rộng) · `server/routers/aiImageSearchRouter.ts` (filter defectType, `searchByVector`, `searchMode`) · `client/src/pages/AIImageSearchPage.tsx` · `client/src/pages/AdvancedVisionLabPage.tsx` (tab "Tìm lỗi tương tự") · `client/src/i18n/locales/{vi,en,zh}.json` (~18 key `is.*`).

### Xác minh
- **Test:** `npx vitest run server/services/aiImageEmbedding.test.ts` → **13/13 PASS**.
- **Typecheck:** 0 lỗi ở file đã đổi. (Repo có lỗi tiền tồn TS5103 `--ignoreDeprecations` + 306 lỗi ở file không liên quan — không do WS-3.)
- **Migration thật:** CHƯA chạy (môi trường có thể chưa có pgvector). Migration idempotent + fallback an toàn.

### Cần con người làm tiếp
1. Cài **pgvector** trên Postgres (quyền owner) → `node scripts/migrate-standalone.mjs` (bỏ `--dry-run`).
2. Có pgvector + Ollama (`OLLAMA_VISION_MODEL`, mặc định `llava` + `mxbai-embed-large`) → chạy `node scripts/ai-kb/backfill-image-embeddings.mjs`.
3. **License gating:** repo gate theo route/module (Express middleware), không có per-procedure trong tRPC. Giữ nguyên cơ chế; nếu cần khóa riêng tính năng → thêm route vào `shared/module-registry`.

### Sai khác so với plan (có lý do)
- Bỏ gọi `ensurePgvector` trong search → thay bằng try/catch 3 tầng (HNSW→cast→brute-force) bền hơn, đúng offline-first. `ensurePgvector` cũ giữ lại (không dùng).
- Backfill `.mjs` gọi Ollama `/api/generate` (vision) trực tiếp thay vì import `describeDefect` (TS) vì script standalone — vẫn đúng pipeline text-of-image → mxbai 1024-d.
- File migration tên `0091_*` (cao nhất hiện tại là `0103`) — runner track theo filename + `IF NOT EXISTS` nên an toàn; có thể đổi tên thành `0104_*` nếu muốn rõ thứ tự.

### Nghiệm thu
| Tiêu chí | Trạng thái |
|---|---|
| cosine∈[0,1] sort giảm + filter đúng | ✅ Đạt (logic + unit test) |
| Không pgvector vẫn trả kết quả + searchMode, không 500 | ✅ Đạt (3 tầng fallback) |
| UI grid + %similarity + searchMode + indexed | ✅ Đạt |
| backfill idempotent | ✅ Đạt (logic; cần env chạy thật) |
| top-20 p95 <300ms / Index Scan HNSW | ⏳ Cần môi trường (pgvector + ≥100k vector) |
