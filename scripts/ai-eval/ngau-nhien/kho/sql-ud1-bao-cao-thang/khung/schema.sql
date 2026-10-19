CREATE TABLE khu_vuc (
  ma TEXT PRIMARY KEY -- danh sách khu vực cần báo cáo
);
CREATE TABLE ban_hang (
  id INTEGER PRIMARY KEY,
  luc TEXT NOT NULL,                                 -- 'YYYY-MM-DD HH:MM:SS'
  khu_vuc TEXT NOT NULL REFERENCES khu_vuc(ma),
  so_tien INTEGER NOT NULL CHECK (so_tien >= 0),     -- trước giảm giá
  giam_gia INTEGER CHECK (giam_gia BETWEEN 0 AND so_tien) -- NULL = không giảm
);
