-- ============================================================================
-- B4.1 — Index phụ trợ cho ràng buộc không gian vector image search.
--
-- searchByImage (nguồn ONNX) lọc theo (modelCode, embeddingDim) để không trộn
-- vector ONNX-dim với text-of-image. Thêm composite index tăng tốc full-scan
-- exact-cast / brute-force khi ONNX-dim ≠ 1024 (HNSW chỉ phục vụ 1024-dim).
--
-- IDEMPOTENT (IF NOT EXISTS). BACKWARD-COMPATIBLE: chỉ THÊM index; không đụng dữ liệu.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_image_emb_modelcode_dim"
  ON "ai_image_embeddings" ("modelCode", "embeddingDim");
