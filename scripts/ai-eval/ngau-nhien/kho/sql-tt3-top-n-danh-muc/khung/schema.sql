CREATE TABLE danh_muc (
  id INTEGER PRIMARY KEY,
  ten TEXT NOT NULL
);
CREATE TABLE san_pham (
  id INTEGER PRIMARY KEY,
  ten TEXT NOT NULL,
  danh_muc_id INTEGER NOT NULL REFERENCES danh_muc(id)
);
CREATE TABLE ban_hang (
  id INTEGER PRIMARY KEY,
  san_pham_id INTEGER NOT NULL REFERENCES san_pham(id),
  so_luong INTEGER NOT NULL CHECK (so_luong > 0),
  don_gia INTEGER NOT NULL CHECK (don_gia > 0) -- đồng
);
