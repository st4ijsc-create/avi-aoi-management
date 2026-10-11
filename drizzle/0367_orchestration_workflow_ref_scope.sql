-- ════════════════════════════════════════════════════════════════════════════
-- 0367 — doc 81 Đợt 7 task I fix 1 (quyết định chủ dự án 2026-10-11): REF QUY TRÌNH THEO KHÔNG GIAN PHẠM VI
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: `orchestration_workflows.ref` là khoá DUY NHẤT TOÀN CỤC ⇒ một người của nhà máy A thử deploy / nhân bản với một ref
--   sẽ biết ref đó có đang được nhà máy B dùng hay không (dò ref). Chủ dự án chọn KHÔNG GIAN TÊN theo phạm vi: ref là duy nhất
--   theo cặp (ref, scopeKey). Nhà máy B dùng cùng ref ⇒ A không thấy gì; ref trơn được phân giải TRONG phạm vi người gọi nên
--   deploy lại là idempotent và tích hợp API vẫn dùng ref trơn.
--
-- NGỮ NGHĨA `scopeKey` (varchar 160, NOT NULL, mặc định 'global') — khoá ỔN ĐỊNH của phạm vi NGƯỜI TẠO quy trình:
--   • 'global'  — admin, khoá API `global`, trình nạp hệ thống (template QT);
--   • 'f:<id,id,…>' — người dùng / khoá API có phạm vi nhà máy: mã số NHÀ MÁY (factories.id) trong phạm vi, tăng dần, ngăn
--     bằng dấu phẩy (id ổn định, mã nhà máy có thể đổi tên); dài quá 160 ký tự ⇒ 'f#' + 40 hex đầu SHA-256 của chuỗi đó;
--     phạm vi rỗng ⇒ 'f:'. Tính ở ĐÚNG MỘT chỗ: server/services/orchestration/foe/foeScope.ts#workflowScopeKeyOf.
--
-- DỮ LIỆU CŨ (luật backfill): MỌI quy trình đang có ⇒ 'global'. Trước 0367 ref đã duy nhất toàn cục nên ('ref','global') vẫn
--   duy nhất; mọi người đang xem được chúng vẫn phân giải chúng bằng ref trơn như cũ (luật phân giải ưu tiên không gian của
--   chính người gọi, rồi 'global', rồi quy trình DUY NHẤT người gọi xem được). Không đoán nhà máy cho dữ liệu cũ.
--
-- QUYỀN `avi_app`: KHÔNG đổi. Bảng đã cấp SELECT/INSERT/UPDATE/DELETE từ trước; quyền mức BẢNG phủ cột mới. Script chỉ KIỂM.
--
-- ⚠ DDL chạy bằng owner `aoi`: `node scripts/apply-migration-0367.mjs --test-only` (dev: `--dev-only`, do chủ dự án quyết —
--   PHẢI áp lên dev TRƯỚC khi build + khởi động lại :3000 với mã có cột này; không cờ ⇒ script TỪ CHỐI chạy — R-3-g).
-- ⚠ Repo CẤM `drizzle-kit push/generate` — cột khai TAY vào drizzle/schema/orchestration.ts cùng lượt.
-- ROLLBACK (chỉ khi mọi ref vẫn duy nhất toàn cục):
--   ALTER TABLE "orchestration_workflows" ADD CONSTRAINT "orchestration_workflows_ref_unique" UNIQUE ("ref");
--   DROP INDEX IF EXISTS "uq_orch_workflows_ref_scope";
--   ALTER TABLE "orchestration_workflows" DROP COLUMN IF EXISTS "scopeKey";
--
-- Hằng số mặc định (PG ≥ 11) ⇒ ADD COLUMN chỉ đổi catalog: mọi hàng cũ đọc ra 'global' (đúng luật backfill ở trên).
ALTER TABLE "orchestration_workflows" ADD COLUMN IF NOT EXISTS "scopeKey" varchar(160) NOT NULL DEFAULT 'global';
-- Chỉ mục duy nhất MỚI trước, rồi mới bỏ ràng buộc cũ (không có lúc nào bảng thiếu ràng buộc duy nhất).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_orch_workflows_ref_scope" ON "orchestration_workflows" ("ref", "scopeKey");
ALTER TABLE "orchestration_workflows" DROP CONSTRAINT IF EXISTS "orchestration_workflows_ref_unique";
COMMENT ON COLUMN "orchestration_workflows"."scopeKey" IS
  'doc 81 Dot 7 I fix 1: khong gian ten cua ref - global (admin / khoa global / he thong) hoac f:<factory ids tang dan> cua pham vi nguoi tao; ref duy nhat theo (ref, scopeKey). Tinh o foeScope.workflowScopeKeyOf.';
