Dự án sandbox-projects/agent-f/cs-dat-phong (C# .NET 10, đặt phòng họp, xem README) cần cho phép đặt phòng lặp lại hằng tuần:

1. `DichVuDatPhong.DatLapLai(string maPhong, DateTime batDau, DateTime ketThuc, string nguoiDat, int soTuan)` tạo `soTuan` lượt đặt; lượt thứ k (tính từ 0) dời đi k*7 ngày. Trả `IReadOnlyList<DatCho>` theo thứ tự thời gian. Mọi lượt trong một lần gọi có cùng `MaChuoi` (chuỗi khác rỗng, khác nhau giữa các lần gọi). `soTuan` ngoài 1..52 ⇒ `ArgumentOutOfRangeException`. Các kiểm tra khác giống `Dat`.
2. Tất cả hoặc không: nếu BẤT KỲ lượt nào trùng lịch (cùng quy tắc trùng của `Dat`, giáp ranh không tính là trùng) thì không lưu lượt nào và ném `XungDotLichException` — lớp mới, kế thừa `InvalidOperationException`, có thuộc tính `IReadOnlyList<DateTime> NgayXungDot` = giờ bắt đầu của các lượt bị trùng, theo thứ tự thời gian.
3. `Dat(...)` đơn lẻ khi trùng lịch cũng ném `XungDotLichException` (với `NgayXungDot` chứa đúng giờ bắt đầu của lượt đó); mã cũ đang bắt `InvalidOperationException` vẫn phải chạy.
4. `DatCho` thêm thuộc tính `string? MaChuoi` (đặt lẻ thì `null`). Thêm `DichVuDatPhong.HuyChuoi(string maChuoi)` huỷ mọi lượt của chuỗi đó, trả về số lượt đã huỷ (không có thì 0).

Test hiện có phải vẫn xanh: `dotnet test sandbox-projects/agent-f/cs-dat-phong/tests/DatPhong.Tests`.
