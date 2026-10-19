using Bai;

namespace KiemThu;

public class AnTests
{
    [Fact]
    public void GiuNguyenChuViet()
    {
        var h = new HoaDon("HĐ-02", new DateOnly(2026, 1, 9), TrangThai.Nhap, new List<DongHang>(), "Giao trước 9 giờ – Đà Nẵng");
        var s = HoaDonJson.Ghi(h);
        Assert.Contains("\"so\":\"HĐ-02\"", s);
        Assert.Contains("\"ghiChu\":\"Giao trước 9 giờ – Đà Nẵng\"", s);
        Assert.DoesNotContain("\\u", s);
    }

    [Fact]
    public void GhiChuNullBiBo_KhacNullDuocGhiCuoi()
    {
        var h = new HoaDon("X", new DateOnly(2026, 12, 31), TrangThai.DaThanhToan, new List<DongHang>(), "ok");
        Assert.Equal("{\"so\":\"X\",\"ngay\":\"2026-12-31\",\"trangThai\":\"da-thanh-toan\",\"dong\":[],\"ghiChu\":\"ok\"}", HoaDonJson.Ghi(h));
        Assert.DoesNotContain("ghiChu", HoaDonJson.Ghi(h with { GhiChu = null }));
    }

    [Fact]
    public void DecimalGiuChuSoThapPhan()
    {
        var h = new HoaDon("Y", new DateOnly(2026, 2, 1), TrangThai.Nhap,
            new List<DongHang> { new("B", 1, 3.000m), new("C", 7, 1234567.8m) }, null);
        var s = HoaDonJson.Ghi(h);
        Assert.Contains("\"donGia\":3.000", s);
        Assert.Contains("\"donGia\":1234567.8", s);
    }

    [Fact]
    public void DocKhongPhanBietHoaThuong()
    {
        var h = HoaDonJson.Doc("{\"SO\":\"Z\",\"Ngay\":\"2026-07-04\",\"TRANGTHAI\":\"nhap\",\"Dong\":[{\"MASP\":\"Q\",\"soluong\":3,\"DonGia\":2.5}]}");
        Assert.Equal("Z", h.So);
        Assert.Equal(TrangThai.Nhap, h.TrangThai);
        Assert.Equal(new DongHang("Q", 3, 2.5m), h.Dong[0]);
    }

    [Fact]
    public void ThieuDongLaDanhSachRong()
    {
        var h = HoaDonJson.Doc("{\"so\":\"Z\",\"ngay\":\"2026-07-04\",\"trangThai\":\"da-gui\"}");
        Assert.NotNull(h.Dong);
        Assert.Empty(h.Dong);
    }

    [Fact]
    public void TrangThaiLaNemFormatException()
    {
        Assert.Throws<FormatException>(() => HoaDonJson.Doc("{\"so\":\"Z\",\"ngay\":\"2026-07-04\",\"trangThai\":\"huy\"}"));
        Assert.Throws<FormatException>(() => HoaDonJson.Doc("{\"so\":\"Z\",\"ngay\":\"2026-07-04\",\"trangThai\":\"DaGui\"}"));
    }

    [Fact]
    public void ThieuHoacRongSoNemFormatException()
    {
        Assert.Throws<FormatException>(() => HoaDonJson.Doc("{\"ngay\":\"2026-07-04\",\"trangThai\":\"nhap\"}"));
        Assert.Throws<FormatException>(() => HoaDonJson.Doc("{\"so\":\"\",\"ngay\":\"2026-07-04\",\"trangThai\":\"nhap\"}"));
    }

    [Fact]
    public void KhongLotJsonException()
    {
        var e = Record.Exception(() => HoaDonJson.Doc("[1,2]"));
        Assert.IsType<FormatException>(e);
        e = Record.Exception(() => HoaDonJson.Doc("không phải json"));
        Assert.IsType<FormatException>(e);
    }

    [Fact]
    public void BaTrangThaiDeuKhuHoi()
    {
        foreach (var t in new[] { TrangThai.Nhap, TrangThai.DaGui, TrangThai.DaThanhToan })
        {
            var h = new HoaDon("K", new DateOnly(2026, 5, 5), t, new List<DongHang>(), null);
            Assert.Equal(t, HoaDonJson.Doc(HoaDonJson.Ghi(h)).TrangThai);
        }
    }
}
