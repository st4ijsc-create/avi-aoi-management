Dự án sandbox-projects/agent-f/cs-nhat-ky (C# .NET 10, phân tích nhật ký, xem README) cần:

1. Thêm mức `MucDo.Fatal`; bộ phân tích nhận `[FATAL]`.
2. Dòng nối tiếp: trong `BoPhanTich.PhanTich`, dòng bắt đầu bằng dấu cách hoặc tab mà dòng KHÁC TRỐNG ngay trước nó là một bản ghi hợp lệ (hoặc là dòng nối tiếp của bản ghi đó) thì là phần tiếp theo của nội dung (stack trace): nối vào `NoiDung` của bản ghi đó bằng `\n` + dòng đã bỏ khoảng trắng đầu, và không tính là dòng bỏ qua. Dòng nối tiếp không có bản ghi hợp lệ ngay trước (đầu tệp, hoặc sau một dòng rác) thì bị bỏ qua và đếm vào `SoDongBoQua`.
3. `ThongKe.TyLeLoi` tính cả `Fatal` là lỗi.
4. Tệp mới `BaoCaoNguon.cs`: record `DongBaoCao(string Nguon, int Tong, int SoCanhBao, int SoLoi, DateTime LanCuoi)` và lớp tĩnh `BaoCaoNguon` với:
   - `static IReadOnlyList<DongBaoCao> Tao(IEnumerable<BanGhi> banGhi, DateTime? tu = null, DateTime? den = null)`: lọc `tu <= ThoiGian < den` (bên nào `null` thì không chặn), gom theo `Nguon`; `SoLoi` đếm Error + Fatal, `SoCanhBao` đếm Warn, `LanCuoi` = thời gian lớn nhất của nguồn; sắp `SoLoi` giảm dần rồi `Nguon` tăng dần (so sánh ordinal).
   - `static string XuatJson(IReadOnlyList<DongBaoCao> dong)`: mảng JSON, không thụt lề, tên thuộc tính camelCase (`nguon`, `tong`, `soCanhBao`, `soLoi`, `lanCuoi`), `lanCuoi` là chuỗi dạng `yyyy-MM-ddTHH:mm:ss`. Danh sách rỗng ⇒ `[]`.

Test hiện có phải vẫn xanh: `dotnet test sandbox-projects/agent-f/cs-nhat-ky/tests/NhatKy.Tests`.
