-- Migration 001 — ĐÃ CHẠY trên production, KHÔNG được sửa.
CREATE TABLE nhan_vien (
  id INTEGER PRIMARY KEY,
  ho_ten TEXT NOT NULL,
  email TEXT,
  phong TEXT
);
CREATE INDEX idx_nhan_vien_phong ON nhan_vien(phong);

CREATE TABLE cham_cong (
  id INTEGER PRIMARY KEY,
  nhan_vien_id INTEGER NOT NULL REFERENCES nhan_vien(id),
  ngay TEXT NOT NULL,
  so_gio REAL NOT NULL
);

PRAGMA user_version = 1;
