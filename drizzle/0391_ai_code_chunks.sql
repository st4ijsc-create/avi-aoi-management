-- ★★★ Đợt 2 (2026-10-17) — bảng `ai_code_chunks`: CHỈ MỤC NGỮ NGHĨA mã nguồn theo DỰ ÁN cho vòng agent
-- (`server/services/ai/chiMucMa/nguNghia.ts` — tool `search_code`). Thiết kế:
-- docs/superpowers/specs/2026-10-17-ai-local-dot2-ngu-canh-tri-nho-design.md §3.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0391.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Mỗi hàng = MỘT đoạn mã (cắt theo ranh giới định nghĩa, rơi về cửa sổ dòng) của MỘT tệp trong MỘT dự án:
--   • `projectId` — id dự án (KHÔNG phải đường dẫn — cùng hình dạng `RE_ID_DU_AN`/0390), khoá cách ly mọi truy vấn;
--   • `duong`     — đường TƯƠNG ĐỐI POSIX trong gốc dự án (CHECK: không tuyệt đối, không `..`, không `\`);
--   • `bam`       — sha256 hex của NỘI DUNG TỆP lúc nhúng: tệp không đổi băm ⇒ không nhúng lại;
--   • `noiDung`   — đoạn mã ĐÃ CHE BÍ MẬT (tầng ứng dụng: `redactSecretsOnly` lúc đọc + `redactSecretsAndPII` trước khi lưu);
--   • `moHinh`    — tên model nhúng: đổi model ⇒ vector khác không gian ⇒ tìm kiếm LỌC theo cột này và lượt dựng nhúng lại;
--   • `embedding` — `vector(1024)` (Qwen3-Embedding-0.6B / mxbai — `GGUF_EMBED_DIM` mặc định 1024).
--
-- ⚠ KHÔNG có chỉ mục HNSW, CÓ CHỦ Ý: mọi truy vấn lọc `projectId`, và HNSW của pgvector lọc SAU khi lấy `ef_search`
--   ứng viên ⇒ một dự án nhỏ cạnh một dự án lớn nhận ÍT HƠN k kết quả mà không ai biết (mất recall im lặng).
--   Quét CHÍNH XÁC theo chỉ mục btree (`projectId`) có trần cứng vì số đoạn/dự án bị chặn ở tầng ứng dụng.
-- ⚠ CẦN pgvector — thiếu ⇒ migration DỪNG với thông báo rõ (bảng vô dụng khi không có kiểu `vector`).
-- KHÔNG có FUNCTION/TRIGGER ⇒ không có search_path nào phải ghim. Idempotent: IF NOT EXISTS + DO $$ … pg_constraint.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION '0391: pgvector (extension "vector") chua cai tren CSDL nay — superuser chay CREATE EXTENSION vector truoc';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_code_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" varchar(64) NOT NULL,
  duong       varchar(1024) NOT NULL,
  bam         char(64) NOT NULL,
  "dongDau"   integer NOT NULL,
  "dongCuoi"  integer NOT NULL,
  "noiDung"   text NOT NULL,
  "moHinh"    varchar(200) NOT NULL,
  embedding   public.vector(1024) NOT NULL,
  "capNhat"   timestamp NOT NULL DEFAULT now()
);

-- Mọi truy vấn (tìm, so băm, xoá theo tệp) đều khoá theo dự án rồi theo tệp.
CREATE INDEX IF NOT EXISTS ai_code_chunks_du_an_tep_idx
  ON public.ai_code_chunks ("projectId", duong);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_chunks_project_id') THEN
    ALTER TABLE public.ai_code_chunks
      ADD CONSTRAINT chk_ai_code_chunks_project_id CHECK ("projectId" ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_chunks_duong') THEN
    -- Tương đối POSIX: không `/` đầu, không ổ đĩa `X:`, không `\`, không đoạn `..`, không rỗng.
    ALTER TABLE public.ai_code_chunks
      ADD CONSTRAINT chk_ai_code_chunks_duong
      CHECK (duong <> '' AND duong !~ '^/' AND duong !~ '^[A-Za-z]:' AND position(E'\\' IN duong) = 0
             AND duong !~ '(^|/)\.\.(/|$)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_chunks_bam') THEN
    ALTER TABLE public.ai_code_chunks
      ADD CONSTRAINT chk_ai_code_chunks_bam CHECK (bam ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_chunks_dong') THEN
    ALTER TABLE public.ai_code_chunks
      ADD CONSTRAINT chk_ai_code_chunks_dong CHECK ("dongDau" >= 1 AND "dongCuoi" >= "dongDau");
  END IF;
END $$;

-- `avi_app` (vai ứng dụng lúc chạy) cần DML — bảng do `aoi` sở hữu nên cấp tường minh (khuôn 0333/0390).
-- id là uuid mặc định ⇒ không có sequence nào phải cấp. KHÔNG TRUNCATE/REFERENCES/TRIGGER.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_code_chunks TO avi_app;
  END IF;
END $$;
