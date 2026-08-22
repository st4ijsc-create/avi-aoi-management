-- ═══════════════════════════════════════════════════════════════════════════════════
-- G (doc 52 §6.1) — XOÁ BÍ MẬT PLAINTEXT KHỎI `machines.apiKey`
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- `machines.apiKey` là khoá dùng chung, lưu NGUYÊN VĂN, không băm, không xoay vòng, và
-- ai đọc được một dòng `machines` là đọc được luôn thông tin xác thực của máy đó. Nó là
-- tàn dư của đường đăng ký thiết bị đời đầu.
--
-- ── TIỀN ĐỀ ĐÃ ĐO, KHÔNG PHẢI GIẢ ĐỊNH (2026-08-22) ───────────────────────────────
--   • 42 máy, 41 đang dùng (1 đã ngừng);
--   • **50 khoá `mk_` riêng từng máy còn hiệu lực, phủ ĐỦ 42/42 máy**;
--   • **0 máy đang dùng mà thiếu khoá riêng**;
--   • còn 17 dòng mang `apiKey` plaintext.
-- Nghĩa là mọi máy đều đã có đường xác thực mạnh; 17 giá trị này chỉ còn là rủi ro thuần,
-- không còn là phương tiện duy nhất của ai cả.
--
-- ── VÌ SAO XOÁ GIÁ TRỊ MÀ KHÔNG BỎ HẲN CỘT ────────────────────────────────────────
-- 27 chỗ trong mã còn tham chiếu cột này, trong đó đường ĐỔI THƯỞNG đăng ký đời cũ
-- (`server/db/hierarchy.ts:968`) BẮT BUỘC phải có `fresh.apiKey` mới chạy. Bỏ cột trong
-- cùng lượt sẽ biến một việc bảo mật rõ ràng thành một cuộc tái cấu trúc — và một cuộc
-- tái cấu trúc thì dễ bị hoãn. Xoá giá trị đạt trọn mục tiêu bảo mật NGAY; bỏ cột là dọn
-- dẹp, làm sau, không gấp.
--
-- Đi kèm bản này, hai chính sách xác thực yếu đổi mặc định sang `deny`
-- (`server/services/machineAuthService.ts`), nên kể cả có ai ghi lại một giá trị
-- plaintext vào cột này thì nó cũng KHÔNG còn xác thực được nữa. Xoá bí mật + đóng cửa —
-- một mình phép xoá là chưa đủ, vì cột vẫn ghi được.
--
-- ⚠ KHÔNG HOÀN NGUYÊN ĐƯỢC. Giá trị plaintext biến mất vĩnh viễn — đó chính là mục đích.
--   Máy nào cần xác thực thì dùng khoá `mk_` của nó (đã cấp đủ, xem `api_keys.machineId`).

UPDATE machines
   SET "apiKey" = NULL,
       "updatedAt" = NOW()
 WHERE "apiKey" IS NOT NULL
   AND "apiKey" <> '';
