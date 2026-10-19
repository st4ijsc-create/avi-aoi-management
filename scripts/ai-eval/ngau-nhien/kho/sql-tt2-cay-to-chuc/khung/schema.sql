CREATE TABLE nhan_vien (
  id INTEGER PRIMARY KEY,
  ten TEXT NOT NULL,
  quan_ly_id INTEGER REFERENCES nhan_vien(id) -- NULL = người đứng đầu một cây
);
