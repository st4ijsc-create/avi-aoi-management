namespace Bai;

public enum TrangThai { Nhap, DaGui, DaThanhToan }

public sealed record DongHang(string MaSp, int SoLuong, decimal DonGia);

public sealed record HoaDon(string So, DateOnly Ngay, TrangThai TrangThai, IReadOnlyList<DongHang> Dong, string? GhiChu);

public static class HoaDonJson
{
    public static string Ghi(HoaDon h) => throw new NotImplementedException();

    public static HoaDon Doc(string json) => throw new NotImplementedException();
}
