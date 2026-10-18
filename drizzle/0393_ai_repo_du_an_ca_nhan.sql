-- ★★★ Đợt 3a (2026-10-17) — DỰ ÁN CÁ NHÂN CỦA KỸ SƯ (quyết định Q3 của chủ dự án) trên bảng `ai_repo_du_an` (0337).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0393.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO MỞ RỘNG BẢNG CŨ THAY VÌ BẢNG MỚI (chọn đường ít xâm lấn)
-- ----------------------------------------------------------------------------------------------
-- Một dự án cá nhân là MỘT MỤC DANH SÁCH TRẮNG y như mục admin đăng ký: cùng id `[A-Za-z0-9_-]`, cùng tên, cùng gốc
-- tuyệt đối, cùng ẢNH CHỤP `repoProjects.napLaiDuAnTuDb()` mà mọi đường thực thi tool (tRPC/chat/agent/CLI) đã đọc.
-- Bảng thứ hai = phép hợp nhất thứ hai + một chỗ quên lọc nữa. Nên: HAI CỘT NULL-ĐƯỢC trên bảng cũ —
--   • `chuSoHuu` NULL  ⇔ mục admin/dùng chung (hành vi 0337 giữ nguyên từng chữ);
--   • `chuSoHuu` = id  ⇔ dự án CÁ NHÂN: chỉ chủ (và admin) thấy/chọn — `repoProjects.phanGiaiGoc(id, nguoiGoi)` phán.
--   • `cachTao` ∈ {rong, khuon, zip, git} — có ⇔ cá nhân (CHECK đôi bên dưới): truy vết "dự án này đến từ đâu".
-- Hàng cũ không đổi (hai cột NULL) ⇒ không cần backfill.
--
-- `chuSoHuu` CỐ Ý KHÔNG FK → users (cùng lý lẽ `nguoiTao` ở 0337): xoá tài khoản không được kéo theo một lượt xoá
-- hàng mà thư mục trên đĩa vẫn còn (mồ côi đĩa); admin thấy hàng ấy ở màn quản lý và xoá vào thùng rác.
--
-- QUYỀN: 0337 cố ý KHÔNG cấp UPDATE ("sửa = xoá rồi thêm lại"). Đổi TÊN dự án cá nhân là việc của kỹ sư — xoá rồi
-- thêm lại sẽ đổi id (phiên chat, lượt chạy agent, chỉ mục mã đều khoá theo id). Nên cấp UPDATE **MỘT CỘT `ten`**,
-- không hơn: gốc/chủ/cách tạo không đổi được bằng UPDATE (một UPDATE gốc = mở một thư mục tuỳ ý cho AI).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; CHECK/INDEX qua IF NOT EXISTS. KHÔNG FUNCTION/TRIGGER.

ALTER TABLE ai_repo_du_an ADD COLUMN IF NOT EXISTS "chuSoHuu" integer;
ALTER TABLE ai_repo_du_an ADD COLUMN IF NOT EXISTS "cachTao" varchar(16);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_repo_du_an_ca_nhan') THEN
    ALTER TABLE ai_repo_du_an
      ADD CONSTRAINT chk_ai_repo_du_an_ca_nhan
      CHECK (("chuSoHuu" IS NULL) = ("cachTao" IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_repo_du_an_chu') THEN
    ALTER TABLE ai_repo_du_an
      ADD CONSTRAINT chk_ai_repo_du_an_chu
      CHECK ("chuSoHuu" IS NULL OR "chuSoHuu" > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_repo_du_an_cach_tao') THEN
    ALTER TABLE ai_repo_du_an
      ADD CONSTRAINT chk_ai_repo_du_an_cach_tao
      CHECK ("cachTao" IS NULL OR "cachTao" IN ('rong', 'khuon', 'zip', 'git'));
  END IF;
END $$;

-- Đếm trần "số dự án / người" = một lượt dò chỉ mục.
CREATE INDEX IF NOT EXISTS ai_repo_du_an_chu_idx ON ai_repo_du_an ("chuSoHuu") WHERE "chuSoHuu" IS NOT NULL;

-- ⚠ ĐO ĐƯỢC lúc áp lên `_test` (2026-10-17): `avi_app` ĐANG CÓ UPDATE cả bảng — đến từ
--   `ALTER DEFAULT PRIVILEGES … GRANT arwd TO avi_app` của owner `aoi`, nên lời khai "KHÔNG cấp UPDATE" của 0337 chưa
--   bao giờ đúng trên CSDL. Thu về đúng ý 0337 + đúng một ngoại lệ: REVOKE UPDATE cả bảng (PG thu luôn quyền cột) rồi
--   GRANT UPDATE(ten). Không mã nào UPDATE bảng này ngoài lượt đổi tên mới (grep `update(aiRepoDuAn` = 0 trước lượt này).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    REVOKE UPDATE ON ai_repo_du_an FROM avi_app;
    GRANT UPDATE (ten) ON ai_repo_du_an TO avi_app;
  END IF;
END $$;
