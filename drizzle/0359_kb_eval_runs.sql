-- ════════════════════════════════════════════════════════════════════════════
-- 0359 — R1 (kế hoạch AI Local 2026-09-22 §4): **SỔ LƯỢT EVAL của Training Studio** (`kb_eval_runs`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: EvalTab trước đây chỉ xem mẫu chunk — không có điểm chất lượng nào, không so được
--   trước/sau ingest. Mỗi lượt `kbStudio.evalCorpus` (bộ câu hỏi vàng × truy hồi thật, chấm bằng
--   máy) ghi MỘT hàng ở đây: tổng hợp (jsonb) + kết quả từng câu (jsonb) + ảnh chụp corpus lúc chạy
--   (`soChunk`, `soNguon`, `lanNapCuoi`) ⇒ UI vẽ được "điểm theo lượt" và đánh dấu lượt nào đứng
--   sau một lần nạp mới.
--
-- ⚠ `trangThai` = 'xong' | 'khong-do-duoc'. Lượt không nhúng được câu hỏi (engine embed vắng) ghi
--   'khong-do-duoc' + `lyDo`, `tongHop` NULL — **không biết ≠ 0 %**.
-- ⚠ DDL chạy bằng owner `aoi` (`avi_app` → 42501): `node scripts/apply-migration-0359.mjs`.
-- ⚠ Repo CẤM `drizzle-kit push/generate` — bảng khai TAY vào `drizzle/schema/kbStudio.ts` cùng lượt.
-- ROLLBACK: DROP TABLE "kb_eval_runs";
--
CREATE TABLE IF NOT EXISTS "kb_eval_runs" (
  "id" serial PRIMARY KEY,
  "corpus" varchar(120) NOT NULL,
  "boVang" varchar(120) NOT NULL,
  "trangThai" varchar(24) NOT NULL,
  "lyDo" text,
  "k" integer NOT NULL,
  "nguong" real NOT NULL,
  "tangDuongOng" boolean NOT NULL,
  "soChunk" integer NOT NULL,
  "soNguon" integer NOT NULL,
  "lanNapCuoi" timestamp,
  "embedModel" varchar(200),
  "boVangHash" varchar(16) NOT NULL,
  "tongHop" jsonb,
  "ketQua" jsonb NOT NULL,
  "msTong" integer NOT NULL,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_kb_eval_runs_corpus_created" ON "kb_eval_runs" ("corpus", "createdAt");
-- Sổ chỉ ghi thêm: vai ứng dụng được SELECT + INSERT, không UPDATE/DELETE (một lượt đo đã ghi là
-- bằng chứng, không sửa). Bọc DO để môi trường không có vai `avi_app` vẫn chạy được (khuôn 0357).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- REVOKE tường minh: default ACL của dev cấp ĐỦ quyền cho avi_app (0357 đo 2026-09-15) —
    -- chỉ GRANT thì "chỉ ghi thêm" là lời khai, không phải sự thật.
    REVOKE UPDATE, DELETE, TRUNCATE ON "kb_eval_runs" FROM avi_app;
    GRANT SELECT, INSERT ON "kb_eval_runs" TO avi_app;
    GRANT USAGE, SELECT ON SEQUENCE "kb_eval_runs_id_seq" TO avi_app;
  END IF;
END $$;
