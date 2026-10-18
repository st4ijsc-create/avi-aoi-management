# viec — CLI danh sách việc

```
viec add "<tiêu đề>" [--han YYYY-MM-DD]
viec list [--tat-ca]
viec done <id>
viec help
```

Dữ liệu lưu ở tệp JSON (`VIEC_KHO` hoặc `./viec.json`).

Cấu trúc: `src/cli.mjs` (phân tích lệnh, bảng lệnh), `src/lenh/*.mjs` (mỗi lệnh con một tệp),
`src/kho.mjs` (đọc/ghi tệp), `src/thamSo.mjs` (tách tham số), `src/troGiup.mjs` (trợ giúp).
Mọi lệnh con nhận `(thamSo, io)` và trả MÃ THOÁT; `io.ghi(s)`/`io.loi(s)` ghi NGUYÊN VĂN (tự thêm `\n`).

Chạy test: `node --test test/cli.test.mjs`
