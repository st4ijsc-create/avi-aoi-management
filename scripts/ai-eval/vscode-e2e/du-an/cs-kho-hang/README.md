# kho-hang

Kho hàng một điểm (danh mục sản phẩm, nhập, xuất, tồn) — C# .NET 10, test xUnit.

- `src/KhoHang/` — `SanPham` (record), `Kho` (nhập/xuất/tồn/tổng giá trị).
- `tests/KhoHang.Tests/` — test xUnit.
- Quy ước lỗi: mã sản phẩm không có ⇒ `KeyNotFoundException`; số lượng ≤ 0 ⇒ `ArgumentOutOfRangeException`;
  không đủ hàng / trùng mã ⇒ `InvalidOperationException`.
- Chạy test: `dotnet test tests/KhoHang.Tests`
