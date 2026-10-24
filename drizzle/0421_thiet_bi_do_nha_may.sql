-- ★★★ 2026-10-25 — THIẾT BỊ ĐO THEO NHÀ MÁY (lô W7c — kiểm định phamViGhi; chủ dự án duyệt 2026-10-24: thiết bị đo + hiệu chuẩn + MSA THEO nhà máy).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0421.mjs --test-only|--dev-only|--both`.
--    DEV chỉ sau khi phiên điều phối duyệt SQL + số hàng. Không drizzle-kit generate/push.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- CHỈ THÊM MỘT CỘT + MỘT CHỈ MỤC vào `measurement_instruments`; KHÔNG đổi hàng nào đang có (KHÔNG backfill):
--   "factoryId" integer NULL  → nhà máy sở hữu thiết bị. FK `factories(id) ON DELETE SET NULL` (xoá nhà máy ⇒ thiết bị về NULL = fail-closed, chỉ toàn quyền thấy).
-- Hiệu chuẩn (`instrument_calibrations`), bản ghi MSA (`instrument_msa_records`), nghiên cứu MSA (`msa_studies`) KHÔNG có cột riêng — chúng suy nhà máy QUA `instrumentId`
-- (một nguồn sự thật; bốn cột nhà máy lệch nhau là cách hai bản sao quyết định ai thấy gì).
--
-- LUẬT ĐỌC / GHI (server/routers/productRouters.ts): người dùng phạm vi HẸP thấy / thao tác thiết bị ⇔ "factoryId" ∈ phạm vi nhà máy của họ. NULL ⇒ CHỈ toàn quyền (admin)
-- thấy cho tới khi được gán (fail-closed). Dữ liệu cũ: KHÔNG có căn cứ suy nhà máy (DEV: 1 thiết bị "Thước", không điểm đo / mẫu nào dùng nó) ⇒ để NULL, admin gán tay.
-- Idempotent (IF NOT EXISTS). Ổ khoá: ADD COLUMN nullable không default = chỉ đổi catalog (không viết lại bảng).
ALTER TABLE public.measurement_instruments
  ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_measurement_instruments_factory ON public.measurement_instruments ("factoryId");

COMMENT ON COLUMN public.measurement_instruments."factoryId" IS
  'Nha may so huu thiet bi do (lo W7c 2026-10-25). NULL = chua gan => chi nguoi dung toan quyen thay. Hieu chuan / MSA suy qua instrumentId.';
