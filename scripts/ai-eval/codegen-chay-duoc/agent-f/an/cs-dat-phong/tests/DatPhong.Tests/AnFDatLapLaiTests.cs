// TEST ẨN bộ F (cs-dat-phong) — chép vào dự án lúc chấm, xoá sau khi chấm. Không phải tệp của dự án.
using DatPhong;

namespace DatPhong.Tests;

public class AnFDatLapLaiTests
{
    private static readonly PhongHop[] Phong = { new("P1", "Phòng Sông Hồng", 8), new("P2", "Phòng Sông Đà", 4) };
    private static DateTime Gio(int ngay, int gio, int phut = 0) => new(2026, 11, ngay, gio, phut, 0);

    private static DichVuDatPhong TaoDichVu(out KhoDatChoBoNho kho)
    {
        kho = new KhoDatChoBoNho();
        return new DichVuDatPhong(kho, Phong);
    }

    [Fact]
    public void AnF_DatLapLai_TaoDungSoLuotCachNhau7Ngay()
    {
        var dv = TaoDichVu(out var kho);
        var ds = dv.DatLapLai("P1", Gio(2, 9), Gio(2, 10, 30), "an", 4);
        Assert.Equal(4, ds.Count);
        for (var k = 0; k < 4; k++)
        {
            Assert.Equal(Gio(2, 9).AddDays(7 * k), ds[k].BatDau);
            Assert.Equal(Gio(2, 10, 30).AddDays(7 * k), ds[k].KetThuc);
            Assert.Equal("P1", ds[k].MaPhong);
            Assert.Equal("an", ds[k].NguoiDat);
        }
        Assert.Equal(4, kho.TatCa().Count);
    }

    [Fact]
    public void AnF_DatLapLai_CungMaChuoi_KhacGiuaHaiLanGoi()
    {
        var dv = TaoDichVu(out _);
        var a = dv.DatLapLai("P1", Gio(2, 9), Gio(2, 10), "an", 3);
        var b = dv.DatLapLai("P1", Gio(2, 14), Gio(2, 15), "binh", 2);
        Assert.False(string.IsNullOrEmpty(a[0].MaChuoi));
        Assert.All(a, d => Assert.Equal(a[0].MaChuoi, d.MaChuoi));
        Assert.All(b, d => Assert.Equal(b[0].MaChuoi, d.MaChuoi));
        Assert.NotEqual(a[0].MaChuoi, b[0].MaChuoi);
        Assert.Equal(5, a.Concat(b).Select(d => d.Id).Distinct().Count());
    }

    [Fact]
    public void AnF_DatLe_MaChuoiNull()
    {
        var dv = TaoDichVu(out _);
        Assert.Null(dv.Dat("P1", Gio(2, 9), Gio(2, 10), "an").MaChuoi);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(53)]
    [InlineData(-1)]
    public void AnF_SoTuanNgoaiKhoang_Nem(int soTuan)
    {
        var dv = TaoDichVu(out var kho);
        Assert.Throws<ArgumentOutOfRangeException>(() => dv.DatLapLai("P1", Gio(2, 9), Gio(2, 10), "an", soTuan));
        Assert.Empty(kho.TatCa());
    }

    [Fact]
    public void AnF_SoTuanBien_1Va52()
    {
        var dv = TaoDichVu(out _);
        Assert.Single(dv.DatLapLai("P1", Gio(2, 9), Gio(2, 10), "an", 1));
        Assert.Equal(52, dv.DatLapLai("P2", Gio(2, 9), Gio(2, 10), "an", 52).Count);
    }

    [Fact]
    public void AnF_XungDot_TatCaHoacKhong_LietKeNgayTrung()
    {
        var dv = TaoDichVu(out var kho);
        dv.Dat("P1", Gio(16, 9, 30), Gio(16, 11), "x");   // trùng tuần thứ 3
        dv.Dat("P1", Gio(30, 8), Gio(30, 9, 1), "y");     // trùng tuần thứ 5
        dv.Dat("P1", Gio(9, 10), Gio(9, 11), "z");        // giáp ranh tuần thứ 2 — KHÔNG trùng
        var ex = Assert.Throws<XungDotLichException>(() => dv.DatLapLai("P1", Gio(2, 9), Gio(2, 10), "an", 5));
        Assert.Equal(new[] { Gio(16, 9), Gio(30, 9) }, ex.NgayXungDot.ToArray());
        Assert.Equal(3, kho.TatCa().Count);
        Assert.IsAssignableFrom<InvalidOperationException>(ex);
    }

    [Fact]
    public void AnF_DatLe_TrungLich_NemXungDotLich()
    {
        var dv = TaoDichVu(out _);
        dv.Dat("P1", Gio(2, 9), Gio(2, 10), "an");
        var ex = Assert.Throws<XungDotLichException>(() => dv.Dat("P1", Gio(2, 9, 30), Gio(2, 11), "binh"));
        Assert.Equal(new[] { Gio(2, 9, 30) }, ex.NgayXungDot.ToArray());
    }

    [Fact]
    public void AnF_HuyChuoi_ChiHuyDungChuoi()
    {
        var dv = TaoDichVu(out var kho);
        var a = dv.DatLapLai("P1", Gio(2, 9), Gio(2, 10), "an", 3);
        dv.DatLapLai("P1", Gio(2, 14), Gio(2, 15), "binh", 2);
        dv.Dat("P2", Gio(2, 9), Gio(2, 10), "chi");
        Assert.Equal(3, dv.HuyChuoi(a[0].MaChuoi!));
        Assert.Equal(3, kho.TatCa().Count);
        Assert.DoesNotContain(kho.TatCa(), d => d.MaChuoi == a[0].MaChuoi);
        Assert.Equal(0, dv.HuyChuoi(a[0].MaChuoi!));
        Assert.Equal(0, dv.HuyChuoi("khong-co"));
    }
}
