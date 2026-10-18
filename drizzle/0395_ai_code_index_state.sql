-- ★★★ (2026-10-17) — bảng `ai_code_index_state`: TRẠNG THÁI LƯỢT DỰNG chỉ mục ngữ nghĩa mã (`ai_code_chunks`, 0391)
-- theo (dự án × model nhúng). Người ghi/đọc DUY NHẤT: `server/services/ai/chiMucMa/nguNghia.ts`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0395.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO (đo sống 2026-10-17): `trangThaiChiMuc` cũ trả `san-sang` khi TỒN TẠI BẤT KỲ hàng nào của dự án trong
-- `ai_code_chunks`. Lượt dựng repo chính chết giữa chừng để lại 393/~50.000 đoạn ⇒ chỉ mục MÃI "sẵn sàng", không bao
-- giờ dựng tiếp, `search_code` tìm trên 0,8 % repo mà khai đủ. "Có hàng" KHÔNG phải "đã dựng trọn" — chỉ một bản ghi
-- kết thúc lượt dựng mới nói được điều đó.
--
--   • `trangThai` ∈ { dang-dung | xong | do-dang | loi }:
--       dang-dung — một tiến trình đang dựng (nhịp `capNhat` mỗi 30 s; quá hạn ⇒ tầng ứng dụng coi là `do-dang`:
--                   tiến trình đã chết / restart giữa chừng);
--       xong      — duyệt hết cây (kể cả `catBot` vì trần CẤU TRÚC: số tệp/đoạn/byte — dựng lại cũng ra y vậy);
--       do-dang   — dừng trước khi trọn: huỷ, hết TRẦN THỜI GIAN (dựng lại sẽ đi tiếp nhờ so băm), tiến trình chết;
--       loi       — lượt dựng ném, hoặc quá nhiều tệp nhúng hỏng.
--   • `tienTrinh` + `luot` — ai đang giữ hàng `dang-dung`: chỉ lượt đã ghi `dang-dung` mới được chốt nó (WHERE luot).
--   • Không backfill: hàng `ai_code_chunks` có sẵn KHÔNG chứng minh được lượt dựng nào đã trọn ⇒ vắng = `chua-co` ⇒
--     agent kích hoạt dựng lại; tệp không đổi băm được bỏ qua nên lượt ấy chỉ nhúng phần còn thiếu.
--
-- Mọi mốc giờ là `timestamptz` và chỉ được ghi bằng `now()` phía SQL; phép so "quá hạn" làm trong SQL (tránh lớp lỗi
-- timestamp naive lệch −7 h của postgres.js). KHÔNG FUNCTION/TRIGGER ⇒ không có search_path nào phải ghim.
-- Idempotent: IF NOT EXISTS + DO $$ … pg_constraint.

CREATE TABLE IF NOT EXISTS public.ai_code_index_state (
  "projectId"  varchar(64)  NOT NULL,
  "moHinh"     varchar(200) NOT NULL,
  "trangThai"  varchar(16)  NOT NULL,
  "batDau"     timestamptz  NOT NULL DEFAULT now(),
  "ketThuc"    timestamptz,
  "soTep"      integer      NOT NULL DEFAULT 0,
  "soDoan"     integer      NOT NULL DEFAULT 0,
  "catBot"     boolean      NOT NULL DEFAULT false,
  loi          varchar(500),
  "tienTrinh"  varchar(120) NOT NULL,
  luot         uuid         NOT NULL,
  "capNhat"    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY ("projectId", "moHinh")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_index_state_project_id') THEN
    ALTER TABLE public.ai_code_index_state
      ADD CONSTRAINT chk_ai_code_index_state_project_id CHECK ("projectId" ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_index_state_mo_hinh') THEN
    ALTER TABLE public.ai_code_index_state
      ADD CONSTRAINT chk_ai_code_index_state_mo_hinh CHECK ("moHinh" <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_index_state_trang_thai') THEN
    ALTER TABLE public.ai_code_index_state
      ADD CONSTRAINT chk_ai_code_index_state_trang_thai CHECK ("trangThai" IN ('dang-dung', 'xong', 'do-dang', 'loi'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_index_state_ket_thuc') THEN
    -- Bất biến: đang dựng ⇔ chưa có giờ kết thúc. Một hàng "xong" không có ketThuc là hàng nói dối.
    ALTER TABLE public.ai_code_index_state
      ADD CONSTRAINT chk_ai_code_index_state_ket_thuc CHECK (("trangThai" = 'dang-dung') = ("ketThuc" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_code_index_state_dem') THEN
    ALTER TABLE public.ai_code_index_state
      ADD CONSTRAINT chk_ai_code_index_state_dem CHECK ("soTep" >= 0 AND "soDoan" >= 0);
  END IF;
END $$;

-- `avi_app` cần DML (khuôn 0391). DELETE: dọn dự án / lưới. KHÔNG TRUNCATE/REFERENCES/TRIGGER. Không sequence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_code_index_state TO avi_app;
  END IF;
END $$;
