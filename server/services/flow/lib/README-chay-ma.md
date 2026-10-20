# Ảnh chạy mã của node `du-lieu.ma` (Luồng AI, Đợt 8.2)

- Ảnh: `node:24-alpine` (Node v24.22.0), kéo 2026-10-20, **ghim digest** trong `chayMaCachLy.ts`:
  `node@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f`.
- Chạy luôn với `--pull never`: ảnh thiếu ⇒ node báo lỗi `thieu-anh`, KHÔNG lùi về chạy trong tiến trình máy chủ.
- Bản lưu offline: `D:\SOURCES\16.AI\toolchains\flow\node-24-alpine.tar` (`docker save node:24-alpine`).
  Cài lại: `docker load -i D:\SOURCES\16.AI\toolchains\flow\node-24-alpine.tar`, rồi kiểm
  `docker image inspect node@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f`.
- Đổi ảnh = đổi `ANH_MA_DIGEST` trong mã + dòng này (không có biến môi trường ghi đè).
