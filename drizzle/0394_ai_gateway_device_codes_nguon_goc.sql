-- ★★★ Rà bảo mật de591c868 — phát hiện 3 (lừa đảo mã thiết bị / device-code phishing) trên `ai_gateway_device_codes` (0392).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0394.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Lớp tấn công kinh điển của RFC 8628 §5.4: kẻ tấn công TỰ khởi tạo luồng, gửi mã/đường dẫn cho nạn nhân bấm duyệt ⇒
-- kẻ tấn công (đang giữ `device_code`) nhận token của nạn nhân. 0392 chỉ lưu tên thiết bị DO EXTENSION TỰ KHAI (kẻ tấn
-- công đặt "VSCode" là xong) ⇒ trang duyệt không có gì để người dùng nhận ra yêu cầu không phải của mình.
--
-- Hai cột NGUỒN GỐC, ghi lúc khởi tạo, hiện trên trang duyệt + vào sổ audit:
--   • `ipKhoiTao`      — địa chỉ đã gọi `POST /api/ai/gateway-token/thiet-bi` (theo `trust proxy` của ứng dụng);
--   • `tacNhanKhoiTao` — User-Agent của lượt khởi tạo (đã lọc ký tự điều khiển, cắt 200).
-- Chỉ mục một phần cho trần "mã đang CHỜ theo IP" (đếm mỗi lượt xin mã).
--
-- NULL được: hàng cũ của 0392 không có nguồn gốc (trang duyệt hiện "không rõ"); không backfill.
-- Không đổi quyền: `avi_app` đã có SELECT/INSERT/UPDATE trên bảng (0392) — quyền cột kế thừa quyền bảng.
-- Idempotent: IF NOT EXISTS.

ALTER TABLE public.ai_gateway_device_codes ADD COLUMN IF NOT EXISTS "ipKhoiTao" varchar(64);
ALTER TABLE public.ai_gateway_device_codes ADD COLUMN IF NOT EXISTS "tacNhanKhoiTao" varchar(200);

CREATE INDEX IF NOT EXISTS ai_gateway_device_codes_ip_cho_idx
  ON public.ai_gateway_device_codes ("ipKhoiTao") WHERE "trangThai" = 'cho';
