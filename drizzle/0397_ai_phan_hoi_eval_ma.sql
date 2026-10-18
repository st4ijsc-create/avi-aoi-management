-- ★★★ AI Local Đợt 5 (2026-10-17) — HAI bảng của "Training làm AI thông minh hơn":
--   (1) `ai_agent_feedback` — PHẢN HỒI từ dùng thật (5.1): 👍/👎 + lý do cho CÂU TRẢ LỜI của một lượt agent
--       (`ai_agent_runs`, runId + chỉ số khối trả lời) và cho DIFF được duyệt/bác trên thẻ duyệt agent (đường dẫn, diff
--       ĐÃ CHE bí mật, lý do bác). Người ghi/đọc DUY NHẤT: `server/db/aiAgentFeedback.ts`.
--   (2) `kb_eval_ma_runs` — lượt EVAL MÃ của Training Studio (5.2): câu hỏi → mã → biên dịch/chạy test, corpus Studio
--       BẬT/TẮT (A/B) trong CÙNG một lượt. Người ghi/đọc DUY NHẤT: `server/services/kbStudioEvalMa.ts`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0397.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO BẢNG MỚI, không tái dùng:
--   • `kb_answer_feedback` (0306) là phiếu cho câu trả lời KB của chat vận hành: `userId` NULL được, không có runId/diff/
--     quyết định, và `aiKbFeedbackSignal` cộng `rating` theo `sourcePath` để XẾP HẠNG LẠI truy hồi. Ghi phiếu lập trình vào
--     đó sẽ làm méo tín hiệu xếp hạng của trợ lý vận hành ⇒ tách bảng là đúng nghĩa, không phải dựng song song.
--   • `kb_eval_runs` (0359) có cột BẮT BUỘC của eval TRUY HỒI (k, nguong, tangDuongOng, soChunk…) và `listEvalRuns` vẽ
--     mọi hàng của corpus lên biểu đồ truy hồi ⇒ chèn lượt eval mã vào đó làm hỏng biểu đồ trước/sau của EvalTab.
--
-- PHẠM VI (`ai_agent_feedback`): CHỈ CHỦ (`userId`) — `eq(userId)` trong MỌI mệnh đề WHERE đọc/sửa (khuôn 0390); admin chỉ
-- xem TỔNG HỢP + xuất bộ dữ liệu qua thủ tục riêng. Không cột nào mang byte thô: `noiDung`/`cauHoi` được che bí mật
-- (`redactSecretsOnly`) ở tầng ứng dụng TRƯỚC khi ghi; `duongDan` là đường tương đối của dự án.
--
-- Mọi mốc giờ là `timestamptz`, chỉ ghi bằng `now()` phía SQL (tránh lớp lỗi timestamp naive lệch −7 h của postgres.js).
-- KHÔNG FUNCTION/TRIGGER ⇒ không có search_path nào phải ghim. Idempotent: IF NOT EXISTS + DO $$ … pg_constraint.

-- ─── (1) ai_agent_feedback ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_agent_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     integer      NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  loai         varchar(8)   NOT NULL,
  "runId"      uuid,
  "chiSoTin"   integer,
  "actionId"   varchar(64),
  "projectId"  varchar(64),
  "danhGia"    smallint,
  "lyDo"       varchar(2000),
  "quyetDinh"  varchar(8),
  "lyDoBac"    varchar(2000),
  "cauHoi"     text,
  "noiDung"    text,
  "duongDan"   varchar(1000),
  "createdAt"  timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz  NOT NULL DEFAULT now()
);

-- MỘT phiếu cho mỗi (người × khối trả lời) và mỗi (người × đề xuất ghi): bấm lại là SỬA phiếu của mình (upsert).
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_feedback_tra_loi_uq
  ON public.ai_agent_feedback ("userId", "runId", "chiSoTin") WHERE loai = 'tra-loi';
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_feedback_diff_uq
  ON public.ai_agent_feedback ("userId", "actionId") WHERE loai = 'diff';
CREATE INDEX IF NOT EXISTS ai_agent_feedback_owner_idx
  ON public.ai_agent_feedback ("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_feedback_loai') THEN
    ALTER TABLE public.ai_agent_feedback
      ADD CONSTRAINT chk_ai_agent_feedback_loai CHECK (loai IN ('tra-loi', 'diff'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_feedback_hinh_dang') THEN
    -- tra-loi: runId + chỉ số khối, KHÔNG actionId/quyết định; diff: actionId, KHÔNG chỉ số khối.
    ALTER TABLE public.ai_agent_feedback
      ADD CONSTRAINT chk_ai_agent_feedback_hinh_dang CHECK (
        (loai = 'tra-loi' AND "runId" IS NOT NULL AND "chiSoTin" IS NOT NULL AND "chiSoTin" >= 0
           AND "actionId" IS NULL AND "quyetDinh" IS NULL AND "danhGia" IS NOT NULL)
        OR
        (loai = 'diff' AND "actionId" IS NOT NULL AND "chiSoTin" IS NULL
           AND ("danhGia" IS NOT NULL OR "quyetDinh" IS NOT NULL))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_feedback_danh_gia') THEN
    ALTER TABLE public.ai_agent_feedback
      ADD CONSTRAINT chk_ai_agent_feedback_danh_gia CHECK ("danhGia" IS NULL OR "danhGia" IN (-1, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_feedback_quyet_dinh') THEN
    ALTER TABLE public.ai_agent_feedback
      ADD CONSTRAINT chk_ai_agent_feedback_quyet_dinh CHECK (
        ("quyetDinh" IS NULL OR "quyetDinh" IN ('duyet', 'bac'))
        AND ("lyDoBac" IS NULL OR "quyetDinh" = 'bac')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_feedback_project_id') THEN
    ALTER TABLE public.ai_agent_feedback
      ADD CONSTRAINT chk_ai_agent_feedback_project_id CHECK ("projectId" IS NULL OR "projectId" ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;
END $$;

-- ─── (2) kb_eval_ma_runs ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kb_eval_ma_runs (
  id           uuid PRIMARY KEY,
  corpus       varchar(120) NOT NULL,
  "boBai"      varchar(120) NOT NULL,
  "boBaiHash"  varchar(16)  NOT NULL,
  "trangThai"  varchar(16)  NOT NULL,
  "tienDo"     integer      NOT NULL DEFAULT 0,
  "soBai"      integer      NOT NULL,
  "soLap"      integer      NOT NULL,
  "tongHop"    jsonb,
  "ketQua"     jsonb        NOT NULL DEFAULT '[]'::jsonb,
  "lyDo"       varchar(1000),
  "tienTrinh"  varchar(120) NOT NULL,
  "createdBy"  integer      REFERENCES public.users(id) ON DELETE SET NULL,
  "batDau"     timestamptz  NOT NULL DEFAULT now(),
  "ketThuc"    timestamptz,
  "capNhat"    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_eval_ma_runs_corpus_idx ON public.kb_eval_ma_runs (corpus, "batDau");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_kb_eval_ma_runs_trang_thai') THEN
    ALTER TABLE public.kb_eval_ma_runs
      ADD CONSTRAINT chk_kb_eval_ma_runs_trang_thai
      CHECK ("trangThai" IN ('dang-chay', 'xong', 'huy', 'loi', 'khong-do-duoc'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_kb_eval_ma_runs_ket_thuc') THEN
    -- Bất biến: đang chạy ⇔ chưa có giờ kết thúc. Một lượt "xong" không có ketThuc là hàng nói dối.
    ALTER TABLE public.kb_eval_ma_runs
      ADD CONSTRAINT chk_kb_eval_ma_runs_ket_thuc CHECK (("trangThai" = 'dang-chay') = ("ketThuc" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_kb_eval_ma_runs_tong_hop') THEN
    -- "xong" mà không có tổng hợp = một con số không tồn tại được hiển thị như đã đo.
    ALTER TABLE public.kb_eval_ma_runs
      ADD CONSTRAINT chk_kb_eval_ma_runs_tong_hop CHECK ("trangThai" <> 'xong' OR "tongHop" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_kb_eval_ma_runs_dem') THEN
    ALTER TABLE public.kb_eval_ma_runs
      ADD CONSTRAINT chk_kb_eval_ma_runs_dem
      CHECK ("tienDo" BETWEEN 0 AND 100 AND "soBai" >= 0 AND "soLap" BETWEEN 1 AND 5 AND jsonb_typeof("ketQua") = 'array');
  END IF;
END $$;

-- `avi_app` cần DML (khuôn 0390/0395). DELETE: dọn lưới. KHÔNG TRUNCATE/REFERENCES/TRIGGER. Khoá uuid ⇒ không sequence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_feedback TO avi_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_eval_ma_runs TO avi_app;
  END IF;
END $$;
