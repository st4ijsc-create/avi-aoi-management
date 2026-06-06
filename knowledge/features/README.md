# Knowledge Features

Mỗi file `.md` trong thư mục này (và các thư mục con theo module) mô tả **một chức năng** của hệ thống AVI/AOI Management theo template `_TEMPLATE.md`.

## Cấu trúc thư mục đề xuất
```
features/
  _TEMPLATE.md
  factories/           # quản lý nhà máy, line, machine
  lots/                # quản lý lô sản xuất
  inspection/          # nhập kết quả kiểm tra, NG handling
  defects/             # catalog & phân tích lỗi
  products/            # sản phẩm + measurement points
  reports/             # OEE, yield, pareto, SPC, PDF
  alerts/              # cảnh báo, ngưỡng, thông báo
  users/               # user, role, permission
  mqtt/                # cấu hình MQTT, topic, payload
  ai/                  # AI Local, KB, embeddings
  system/              # backup, restore, license, settings
```

## Quy tắc
- File name: kebab-case theo chức năng (vd: `create-lot.md`, `assign-measurement-point.md`).
- Giữ chính xác 10 H2 trong `_TEMPLATE.md` theo đúng thứ tự.
- Mỗi bước trong "Các bước thao tác" phải có **vị trí UI cụ thể** + **kết quả nhìn thấy**.
- Tham chiếu file khác dùng relative link để build graph.

## Workflow ingest
1. Thêm/sửa MD ở đây.
2. `POST /api/ai/local-kb/reload` để re-embed.
3. Verify chunk count tăng.
