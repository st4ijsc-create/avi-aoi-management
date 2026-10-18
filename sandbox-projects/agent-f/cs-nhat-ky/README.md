# NhatKy — phân tích nhật ký ứng dụng

Định dạng một dòng nhật ký:

```
2026-10-01T08:00:00 [WARN] auth: Đăng nhập sai mật khẩu lần 3
<thời gian ISO, giây>  [MỨC]  <nguồn>: <nội dung>
```

- `src/NhatKy/` — `MucDo`, `BanGhi`, `BoPhanTich` (dòng ⇒ bản ghi), `ThongKe`
- `tests/NhatKy.Tests/` — xUnit

.NET 10. Chạy test: `dotnet test tests/NhatKy.Tests`
(gói NuGet đã có trong cache cục bộ; môi trường offline thì `dotnet restore` một lần trước).
