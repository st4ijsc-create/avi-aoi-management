using DatPhong;

namespace DatPhong.Tests;

public class DichVuDatPhongTests
{
    private static readonly PhongHop[] Phong = { new("P1", "Phòng Sông Hồng", 8), new("P2", "Phòng Sông Đà", 4) };
    private static DateTime Gio(int ngay, int gio, int phut = 0) => new(2026, 11, ngay, gio, phut, 0);

    private static DichVuDatPhong TaoDichVu(out KhoDatChoBoNho kho)
    {
        kho = new KhoDatChoBoNho();
        return new DichVuDatPhong(kho, Phong);
    }

    [Fact]
    public void DatThanhCong_LuuVaoKho()
    {
        var dv = TaoDichVu(out var kho);
        var d = dv.Dat("P1", Gio(2, 9), Gio(2, 10), "an");
        Assert.Single(kho.TatCa());
        Assert.Equal("P1", d.MaPhong);
        Assert.Equal("an", d.NguoiDat);
    }

    [Fact]
    public void TrungLich_NemInvalidOperation()
    {
        var dv = TaoDichVu(out _);
        dv.Dat("P1", Gio(2, 9), Gio(2, 10), "an");
        Assert.ThrowsAny<InvalidOperationException>(() => dv.Dat("P1", Gio(2, 9, 30), Gio(2, 11), "binh"));
    }

    [Fact]
    public void GiapRanh_KhongTinhLaTrung()
    {
        var dv = TaoDichVu(out var kho);
        dv.Dat("P1", Gio(2, 9), Gio(2, 10), "an");
        dv.Dat("P1", Gio(2, 10), Gio(2, 11), "binh");
        dv.Dat("P2", Gio(2, 9), Gio(2, 10), "chi");
        Assert.Equal(3, kho.TatCa().Count);
    }

    [Fact]
    public void ThamSoSai_NemLoi()
    {
        var dv = TaoDichVu(out _);
        Assert.Throws<KeyNotFoundException>(() => dv.Dat("P9", Gio(2, 9), Gio(2, 10), "an"));
        Assert.Throws<ArgumentException>(() => dv.Dat("P1", Gio(2, 10), Gio(2, 9), "an"));
        Assert.Throws<ArgumentException>(() => dv.Dat("P1", Gio(2, 9), Gio(2, 10), " "));
    }

    [Fact]
    public void Huy_VaLichTheoNgay()
    {
        var dv = TaoDichVu(out _);
        var a = dv.Dat("P1", Gio(2, 9), Gio(2, 10), "an");
        dv.Dat("P1", Gio(2, 14), Gio(2, 15), "binh");
        dv.Dat("P1", Gio(3, 9), Gio(3, 10), "chi");
        Assert.Equal(2, dv.LichPhong("P1", new DateOnly(2026, 11, 2)).Count);
        Assert.True(dv.Huy(a.Id));
        Assert.False(dv.Huy(a.Id));
        Assert.Single(dv.LichPhong("P1", new DateOnly(2026, 11, 2)));
    }
}
