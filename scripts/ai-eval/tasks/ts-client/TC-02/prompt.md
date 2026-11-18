MÃ: TC-02
MỤC TIÊU: Viết unit test vitest cho client/src/lib/stateVocabulary.ts, hàm resolveStateToken: đủ năm họ (packml, e10, alarm, andon, unitmode); mỗi họ có ca tên đầy đủ và ca viết tắt/đồng nghĩa; chuẩn hoá đầu vào (hoa/thường, khoảng trắng đầu cuối, khoảng trắng và gạch nối giữa từ thành "_"); cờ transient đúng cho trạng thái chuyển tiếp của PackML và vắng ở trạng thái tĩnh; chuỗi lạ, chuỗi rỗng và họ không tồn tại trả null; một trạng thái của họ này hỏi ở họ khác trả null.
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/stateVocabulary.unit.test.ts
NGỮ CẢNH ĐỌC: client/src/lib/stateVocabulary.ts
LỆNH KIỂM: npx vitest run client/src/lib/stateVocabulary.unit.test.ts
GIỚI HẠN: 15 phút, 8 vòng
