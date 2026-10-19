CREATE TABLE khach_hang (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (email GLOB '*?@?*.?*'),
  ho_ten TEXT NOT NULL CHECK (length(trim(ho_ten)) > 0),
  sdt TEXT CHECK (sdt IS NULL OR sdt GLOB '0[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  hang TEXT NOT NULL DEFAULT 'thuong' CHECK (hang IN ('thuong', 'vang', 'kim_cuong'))
) STRICT;

CREATE TABLE san_pham (
  ma TEXT PRIMARY KEY CHECK (ma GLOB 'SP[0-9][0-9][0-9][0-9]'),
  ten TEXT NOT NULL,
  gia INTEGER NOT NULL CHECK (gia BETWEEN 1 AND 1000000000),
  ton INTEGER NOT NULL DEFAULT 0 CHECK (ton >= 0)
) STRICT;

CREATE TABLE don_hang (
  id INTEGER PRIMARY KEY,
  khach_id INTEGER NOT NULL REFERENCES khach_hang(id) ON DELETE RESTRICT,
  ngay TEXT NOT NULL CHECK (date(ngay) IS ngay),
  ghi_chu TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE chi_tiet (
  don_id INTEGER NOT NULL REFERENCES don_hang(id) ON DELETE CASCADE,
  ma_sp TEXT NOT NULL REFERENCES san_pham(ma) ON DELETE RESTRICT,
  so_luong INTEGER NOT NULL CHECK (so_luong BETWEEN 1 AND 1000),
  PRIMARY KEY (don_id, ma_sp)
) STRICT;
