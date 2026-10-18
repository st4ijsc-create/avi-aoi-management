using System.Globalization;
using Bai;

namespace KiemThu;

public class HienThiTests
{
    private sealed class DongHoGia(DateTimeOffset batDau) : TimeProvider
    {
        private DateTimeOffset _bay = batDau;
        public override DateTimeOffset GetUtcNow() => _bay.ToUniversalTime();
        public void Tien(TimeSpan d) => _bay += d;
    }

    private static DateTimeOffset T(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture);

    [Fact]
    public void XeMayBaGioBanNgay()
    {
        Assert.Equal(new PhiGui(7_000, 0), BangGia.TinhPhi(LoaiXe.XeMay, T("2026-06-01T08:00:00+07:00"), T("2026-06-01T11:00:00+07:00")));
    }

    [Fact]
    public void VaoRaPhatVeVaTinhTien()
    {
        var dongHo = new DongHoGia(T("2026-06-01T01:00:00Z"));
        var bai = new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.XeMay] = 2 }, dongHo);
        var ve = bai.Vao(LoaiXe.XeMay, "51A-123.45");
        Assert.Equal(new Ve("V000001", "51A-123.45", LoaiXe.XeMay, T("2026-06-01T01:00:00Z")), ve);
        Assert.Equal(1, bai.ConTrong(LoaiXe.XeMay));
        dongHo.Tien(TimeSpan.FromHours(2));
        var hd = bai.Ra(ve.MaVe);
        Assert.Equal(5_000, hd.TienGio);
        Assert.Equal(0, hd.PhuPhiDem);
        Assert.Equal(0, hd.PhatMatVe);
        Assert.Equal(5_000, hd.Tong);
        Assert.Equal(2, bai.ConTrong(LoaiXe.XeMay));
    }

    [Fact]
    public void HetChoNemBaiDay()
    {
        var bai = new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.OTo] = 1 }, new DongHoGia(T("2026-06-01T01:00:00Z")));
        bai.Vao(LoaiXe.OTo, "30A-000.01");
        Assert.Throws<BaiDayException>(() => bai.Vao(LoaiXe.OTo, "30A-000.02"));
    }
}
