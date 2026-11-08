MÃ: TC-04
MỤC TIÊU: Viết unit test vitest cho client/src/lib/domains.ts (danh mục ô DOMAIN trang chủ): DOMAINS có đúng 8 mục theo đúng thứ tự khoá production, quality, devices, robotics, twin, ai, analytics, governance; khoá (key) và href không trùng; mọi href bắt đầu bằng "/" và không có khoảng trắng; labelKey/blurbKey đúng dạng "domains.<key>.label" / "domains.<key>.blurb"; MỌI labelKey và blurbKey tồn tại và là chuỗi không rỗng trong CẢ BA tệp client/src/i18n/locales/vi.json, en.json, zh.json (import JSON, tra theo đường dẫn chấm); mỗi mục có icon; export mặc định là cùng mảng DOMAINS.
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/domains.unit.test.ts
NGỮ CẢNH ĐỌC: client/src/lib/domains.ts, client/src/i18n/locales/vi.json
LỆNH KIỂM: npx vitest run client/src/lib/domains.unit.test.ts
GIỚI HẠN: 15 phút, 8 vòng
