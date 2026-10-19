-- Đổi ràng buộc ⇒ quy trình dựng lại bảng của SQLite: tắt khoá ngoại NGOÀI giao dịch, dựng bảng mới,
-- chép dữ liệu, xoá bảng cũ, đổi tên bảng mới (KHÔNG đổi tên bảng cũ — sẽ kéo FK của cham_cong theo), dựng lại chỉ mục.
PRAGMA foreign_keys = OFF;

BEGIN;

ALTER TABLE nhan_vien ADD COLUMN ho TEXT;
ALTER TABLE nhan_vien ADD COLUMN ten TEXT;

UPDATE nhan_vien
SET ho = CASE WHEN instr(trim(ho_ten), ' ') > 0
              THEN substr(trim(ho_ten), 1, instr(trim(ho_ten), ' ') - 1)
              ELSE '' END,
    ten = CASE WHEN instr(trim(ho_ten), ' ') > 0
               THEN trim(substr(trim(ho_ten), instr(trim(ho_ten), ' ') + 1))
               ELSE trim(ho_ten) END;

CREATE TABLE nhan_vien_moi (
  id INTEGER PRIMARY KEY,
  ho TEXT NOT NULL,
  ten TEXT NOT NULL CHECK (length(ten) > 0),
  email TEXT COLLATE NOCASE UNIQUE,
  phong TEXT NOT NULL DEFAULT 'chung'
);

INSERT INTO nhan_vien_moi (id, ho, ten, email, phong)
SELECT id,
       ho,
       ten,
       NULLIF(lower(trim(email)), ''),
       COALESCE(NULLIF(trim(phong), ''), 'chung')
FROM nhan_vien;

DROP TABLE nhan_vien;
ALTER TABLE nhan_vien_moi RENAME TO nhan_vien;
CREATE INDEX idx_nhan_vien_phong ON nhan_vien(phong);

PRAGMA user_version = 2;

COMMIT;

PRAGMA foreign_keys = ON;
