using Bai;

namespace KiemThu;

public class HienThiTests
{
    private static HoaDon Mau() => new("HD-01", new DateOnly(2026, 3, 5), TrangThai.DaGui,
        new List<DongHang> { new("A", 2, 10.50m) }, null);

    [Fact]
    public void GhiDungHopDong()
    {
        Assert.Equal("{\"so\":\"HD-01\",\"ngay\":\"2026-03-05\",\"trangThai\":\"da-gui\",\"dong\":[{\"maSp\":\"A\",\"soLuong\":2,\"donGia\":10.50}]}",
            HoaDonJson.Ghi(Mau()));
    }

    [Fact]
    public void KhuHoi()
    {
        var h = HoaDonJson.Doc(HoaDonJson.Ghi(Mau()));
        Assert.Equal("HD-01", h.So);
        Assert.Equal(new DateOnly(2026, 3, 5), h.Ngay);
        Assert.Equal(TrangThai.DaGui, h.TrangThai);
        Assert.Single(h.Dong);
        Assert.Equal(new DongHang("A", 2, 10.50m), h.Dong[0]);
        Assert.Null(h.GhiChu);
    }

    [Fact]
    public void JsonHongNemFormatException()
    {
        Assert.Throws<FormatException>(() => HoaDonJson.Doc("{\"so\":"));
    }
}
