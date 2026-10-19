CREATE TABLE don_hang (
  id INTEGER PRIMARY KEY,
  khach TEXT NOT NULL,
  du_lieu TEXT NOT NULL CHECK (json_valid(du_lieu)) -- JSON đơn hàng, xem đề bài
);
