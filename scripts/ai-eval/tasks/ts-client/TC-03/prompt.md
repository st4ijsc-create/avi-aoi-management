MÃ: TC-03
MỤC TIÊU: Viết unit test vitest cho client/src/lib/engineeringDeepLink.ts: parseDeepLink (có và không có dấu "?" đầu, projectId/machineId chỉ nhận số nguyên DƯƠNG — 0, số âm, số thập phân, chữ, rỗng, khoảng trắng đều thành null; ref rỗng hoặc toàn khoảng trắng thành null, ref có giá trị giữ nguyên; thiếu tham số thành null; tham số lạ bị bỏ qua) và withParams (bỏ null/undefined/rỗng/toàn khoảng trắng, cắt khoảng trắng hai đầu, số được chuyển thành chuỗi, không còn tham số nào thì trả path trơn không có "?", mã hoá ký tự đặc biệt đúng như URLSearchParams).
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/engineeringDeepLink.unit.test.ts
NGỮ CẢNH ĐỌC: client/src/lib/engineeringDeepLink.ts
LỆNH KIỂM: npx vitest run client/src/lib/engineeringDeepLink.unit.test.ts
GIỚI HẠN: 15 phút, 8 vòng
