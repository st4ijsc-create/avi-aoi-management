-- ★★★ Đợt 4A (2026-10-17) — TOKEN THEO NGƯỜI DÙNG cho cổng tương thích OpenAI `/v1` (quyết định Q2-A: extension
-- VSCode chạy lõi agent và gọi `/v1` THAY MẶT người đã đăng nhập). Hai bảng:
--   • `ai_gateway_tokens`       — token đã cấp: chỉ BĂM sha256 (bản rõ trả đúng một lần, không bao giờ lưu),
--                                  tiền tố hiển thị, tên/thiết bị, phạm vi, hết hạn, thu hồi, lần dùng cuối;
--   • `ai_gateway_device_codes` — "device flow" tối giản: extension xin mã ⇒ người dùng xác nhận trên web (phiên đã
--                                  qua 2FA) ⇒ extension đổi mã bí mật lấy token. Mã hết hạn 10 phút, dùng một lần.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0392.mjs --dev-only|--test-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- CHECK ở tầng CSDL (Zod canh cửa tRPC/REST; CHECK canh cái bảng — kể cả một cửa ghi thứ hai hay INSERT thẳng):
--   • băm là 64 ký tự hex THƯỜNG ⇒ một bản rõ `avgw_…` lỡ ghi vào cột này bị CSDL từ chối (23514), không lặng lẽ
--     nằm đó chờ ai đọc;
--   • `phamVi` là mảng con KHÔNG RỖNG của {chat, fim, embed};
--   • hết hạn sau lúc tạo; `nguon` ∈ {web, thiet-bi}; thu hồi thì có cả lúc lẫn người.
-- Thời điểm dùng `timestamptz` (KHÔNG `timestamp`): so hết hạn làm bằng `now()` trong SQL, và cột naive đọc qua
-- postgres.js lệch múi giờ (bài học "timestamp naive lệch −7 h").
-- KHÔNG có FUNCTION/TRIGGER ⇒ không có search_path nào phải ghim.
-- Idempotent: IF NOT EXISTS cho bảng/chỉ mục; CHECK thêm qua DO $$ … pg_constraint.

CREATE TABLE IF NOT EXISTS public.ai_gateway_tokens (
  id                 serial PRIMARY KEY,
  "userId"           integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "tokenHash"        char(64) NOT NULL,
  "tienTo"           varchar(16) NOT NULL,
  ten                varchar(100) NOT NULL,
  "phamVi"           text[] NOT NULL DEFAULT ARRAY['chat', 'fim']::text[],
  nguon              varchar(16) NOT NULL DEFAULT 'web',
  "hetHanLuc"        timestamptz NOT NULL,
  "thuHoiLuc"        timestamptz,
  "thuHoiBoi"        integer REFERENCES public.users(id) ON DELETE SET NULL,
  "dungLanCuoiLuc"   timestamptz,
  "createdAt"        timestamptz NOT NULL DEFAULT now()
);

-- Tra token mỗi yêu cầu `/v1` = MỘT lần dò chỉ mục duy nhất.
CREATE UNIQUE INDEX IF NOT EXISTS ai_gateway_tokens_hash_uq ON public.ai_gateway_tokens ("tokenHash");
-- Danh sách CỦA MỘT người, mới nhất trước.
CREATE INDEX IF NOT EXISTS ai_gateway_tokens_owner_idx ON public.ai_gateway_tokens ("userId", "createdAt");

CREATE TABLE IF NOT EXISTS public.ai_gateway_device_codes (
  id                 serial PRIMARY KEY,
  "maThietBiHash"    char(64) NOT NULL,
  "maNguoiDung"      varchar(9) NOT NULL,
  ten                varchar(100) NOT NULL,
  "phamVi"           text[] NOT NULL DEFAULT ARRAY['chat', 'fim']::text[],
  "trangThai"        varchar(16) NOT NULL DEFAULT 'cho',
  "userId"           integer REFERENCES public.users(id) ON DELETE CASCADE,
  "tokenId"          integer REFERENCES public.ai_gateway_tokens(id) ON DELETE SET NULL,
  "soLanHoi"         integer NOT NULL DEFAULT 0,
  "hoiLanCuoiLuc"    timestamptz,
  "hetHanLuc"        timestamptz NOT NULL,
  "createdAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_gateway_device_codes_ma_tb_uq ON public.ai_gateway_device_codes ("maThietBiHash");
CREATE UNIQUE INDEX IF NOT EXISTS ai_gateway_device_codes_ma_nd_uq ON public.ai_gateway_device_codes ("maNguoiDung");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_tokens_hash') THEN
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_hash CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_tokens_tien_to') THEN
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_tien_to CHECK ("tienTo" ~ '^avgw_[A-Za-z0-9_-]{1,11}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_tokens_ten') THEN
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_ten CHECK (length(btrim(ten)) BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_tokens_pham_vi') THEN
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_pham_vi
      CHECK (cardinality("phamVi") >= 1 AND "phamVi" <@ ARRAY['chat', 'fim', 'embed']::text[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_tokens_nguon') THEN
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_nguon CHECK (nguon IN ('web', 'thiet-bi'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_tokens_het_han') THEN
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_het_han CHECK ("hetHanLuc" > "createdAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_tokens_thu_hoi') THEN
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_thu_hoi CHECK ("thuHoiBoi" IS NULL OR "thuHoiLuc" IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_device_codes_hash') THEN
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_hash CHECK ("maThietBiHash" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_device_codes_ma_nd') THEN
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_ma_nd CHECK ("maNguoiDung" ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_device_codes_ten') THEN
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_ten CHECK (length(btrim(ten)) BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_device_codes_pham_vi') THEN
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_pham_vi
      CHECK (cardinality("phamVi") >= 1 AND "phamVi" <@ ARRAY['chat', 'fim', 'embed']::text[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_device_codes_trang_thai') THEN
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_trang_thai
      CHECK ("trangThai" IN ('cho', 'da-duyet', 'tu-choi', 'da-doi'));
  END IF;
  -- Đã duyệt/đã đổi thì PHẢI biết của ai; đã đổi thì phải có token. Một hàng `da-doi` không chủ là một token mồ côi.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_device_codes_chu') THEN
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_chu
      CHECK ("trangThai" NOT IN ('da-duyet', 'da-doi') OR "userId" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_gateway_device_codes_dem') THEN
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_dem CHECK ("soLanHoi" >= 0 AND "hetHanLuc" > "createdAt");
  END IF;
END $$;

-- `avi_app` (vai ứng dụng lúc chạy) cần DML + dùng sequence của `serial` — do `aoi` sở hữu nên cấp tường minh.
-- KHÔNG TRUNCATE/REFERENCES/TRIGGER. `IF EXISTS` để CSDL chưa có vai `avi_app` không sập.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_gateway_tokens TO avi_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_gateway_device_codes TO avi_app;
    GRANT USAGE, SELECT ON SEQUENCE public.ai_gateway_tokens_id_seq TO avi_app;
    GRANT USAGE, SELECT ON SEQUENCE public.ai_gateway_device_codes_id_seq TO avi_app;
  END IF;
END $$;
