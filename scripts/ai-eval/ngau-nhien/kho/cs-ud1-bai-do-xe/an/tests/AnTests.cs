using System.Globalization;
using Bai;

namespace KiemThu;

public class AnTests
{
    private sealed class DongHoGia(DateTimeOffset batDau) : TimeProvider
    {
        private DateTimeOffset _bay = batDau;
        public override DateTimeOffset GetUtcNow() => _bay.ToUniversalTime();
        public void Tien(TimeSpan d) => _bay += d;
    }

    private static DateTimeOffset T(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture);

    private static PhiGui Phi(LoaiXe l, string vao, string ra) => BangGia.TinhPhi(l, T(vao), T(ra));

    [Fact]
    public void DuoiMuoiPhutMienPhiKeCaQuaMocDem()
    {
        Assert.Equal(new PhiGui(0, 0), Phi(LoaiXe.XeMay, "2026-06-01T08:00:00+07:00", "2026-06-01T08:09:59+07:00"));
        Assert.Equal(new PhiGui(5_000, 0), Phi(LoaiXe.XeMay, "2026-06-01T08:00:00+07:00", "2026-06-01T08:10:00+07:00"));
        Assert.Equal(new PhiGui(0, 0), Phi(LoaiXe.XeMay, "2026-06-01T01:55:00+07:00", "2026-06-01T02:04:00+07:00"));
        Assert.Equal(new PhiGui(5_000, 5_000), Phi(LoaiXe.XeMay, "2026-06-01T01:55:00+07:00", "2026-06-01T02:05:00+07:00"));
    }

    [Fact]
    public void PhanLeGioLamTronLen()
    {
        Assert.Equal(7_000, Phi(LoaiXe.XeMay, "2026-06-01T08:00:00+07:00", "2026-06-01T10:00:01+07:00").TienGio);
        Assert.Equal(9_000, Phi(LoaiXe.XeMay, "2026-06-01T08:00:00+07:00", "2026-06-01T11:00:01+07:00").TienGio);
        Assert.Equal(55_000, Phi(LoaiXe.OTo, "2026-06-01T08:00:00+07:00", "2026-06-01T11:30:00+07:00").TienGio);
        Assert.Equal(3_000, Phi(LoaiXe.XeDap, "2026-06-01T08:00:00+07:00", "2026-06-01T10:30:00+07:00").TienGio);
    }

    [Fact]
    public void TranTrongMotChuKy()
    {
        Assert.Equal(new PhiGui(25_000, 0), Phi(LoaiXe.XeMay, "2026-06-01T06:00:00+07:00", "2026-06-01T19:00:00+07:00"));
        Assert.Equal(new PhiGui(200_000, 0), Phi(LoaiXe.OTo, "2026-06-01T03:00:00+07:00", "2026-06-01T23:00:00+07:00"));
    }

    [Fact]
    public void NhieuChuKy24Gio()
    {
        Assert.Equal(new PhiGui(25_000, 5_000), Phi(LoaiXe.XeMay, "2026-06-01T08:00:00+07:00", "2026-06-02T08:00:00+07:00"));
        Assert.Equal(new PhiGui(30_000, 5_000), Phi(LoaiXe.XeMay, "2026-06-01T08:00:00+07:00", "2026-06-02T08:05:00+07:00"));
        Assert.Equal(new PhiGui(57_000, 10_000), Phi(LoaiXe.XeMay, "2026-06-01T08:00:00+07:00", "2026-06-03T11:00:00+07:00"));
    }

    [Fact]
    public void MocQuaDemTinhTheoGioVietNam()
    {
        // 18:00Z = 01:00 (+07), 19:30Z = 02:30 (+07)
        Assert.Equal(new PhiGui(5_000, 5_000), Phi(LoaiXe.XeMay, "2026-03-10T18:00:00Z", "2026-03-10T19:30:00Z"));
        // vào ĐÚNG 02:00 (+07) không tính; 5 giờ
        Assert.Equal(new PhiGui(11_000, 0), Phi(LoaiXe.XeMay, "2026-03-10T19:00:00Z", "2026-03-11T00:00:00Z"));
        // ra ĐÚNG 02:00 (+07) có tính; 9 giờ
        Assert.Equal(new PhiGui(19_000, 5_000), Phi(LoaiXe.XeMay, "2026-03-10T10:00:00Z", "2026-03-10T19:00:00Z"));
        // độ lệch +09:00: 03:30 = 01:30 (+07), 04:30 = 02:30 (+07)
        Assert.Equal(new PhiGui(2_000, 2_000), Phi(LoaiXe.XeDap, "2026-05-01T03:30:00+09:00", "2026-05-01T04:30:00+09:00"));
    }

    [Fact]
    public void NhieuDem()
    {
        Assert.Equal(new PhiGui(82_000, 20_000), Phi(LoaiXe.XeMay, "2026-03-01T00:00:00+07:00", "2026-03-04T03:00:00+07:00"));
    }

    [Fact]
    public void RaTruocVaoVaBangPhat()
    {
        Assert.Throws<ArgumentException>(() => Phi(LoaiXe.OTo, "2026-06-01T08:00:00+07:00", "2026-06-01T07:59:59+07:00"));
        Assert.Equal(new PhiGui(0, 0), Phi(LoaiXe.OTo, "2026-06-01T08:00:00+07:00", "2026-06-01T01:00:00Z"));
        Assert.Equal(20_000, BangGia.PhatMatVe(LoaiXe.XeDap));
        Assert.Equal(50_000, BangGia.PhatMatVe(LoaiXe.XeMay));
        Assert.Equal(200_000, BangGia.PhatMatVe(LoaiXe.OTo));
    }

    [Fact]
    public void SucChuaRiengTungLoai()
    {
        var bai = new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.XeMay] = 1, [LoaiXe.OTo] = 2 }, new DongHoGia(T("2026-06-01T01:00:00Z")));
        var a = bai.Vao(LoaiXe.XeMay, "A");
        var e = Assert.Throws<BaiDayException>(() => bai.Vao(LoaiXe.XeMay, "B"));
        Assert.Equal(LoaiXe.XeMay, e.Loai);
        bai.Vao(LoaiXe.OTo, "C");
        Assert.Throws<BaiDayException>(() => bai.Vao(LoaiXe.XeDap, "D"));
        Assert.Equal(0, bai.ConTrong(LoaiXe.XeMay));
        Assert.Equal(1, bai.ConTrong(LoaiXe.OTo));
        Assert.Equal(0, bai.ConTrong(LoaiXe.XeDap));
        bai.Ra(a.MaVe);
        Assert.Equal(1, bai.ConTrong(LoaiXe.XeMay));
        bai.Vao(LoaiXe.XeMay, "B");

        var dh = new DongHoGia(T("2026-06-01T01:00:00Z"));
        Assert.Throws<ArgumentOutOfRangeException>(() => new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.OTo] = -1 }, dh));
        Assert.Throws<ArgumentNullException>(() => new BaiDoXe(null!, dh));
        Assert.Throws<ArgumentNullException>(() => new BaiDoXe(new Dictionary<LoaiXe, int>(), null!));
    }

    [Fact]
    public void BienSoChuanHoaVaKhongVaoHaiLan()
    {
        var bai = new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.XeMay] = 5, [LoaiXe.OTo] = 5 }, new DongHoGia(T("2026-06-01T01:00:00Z")));
        var ve = bai.Vao(LoaiXe.XeMay, "  51a-123.45 ");
        Assert.Equal("51A-123.45", ve.BienSo);
        Assert.Throws<InvalidOperationException>(() => bai.Vao(LoaiXe.XeMay, "51A-123.45"));
        Assert.Throws<InvalidOperationException>(() => bai.Vao(LoaiXe.OTo, "51a-123.45"));
        Assert.ThrowsAny<ArgumentException>(() => bai.Vao(LoaiXe.XeMay, ""));
        Assert.ThrowsAny<ArgumentException>(() => bai.Vao(LoaiXe.XeMay, "   "));
        Assert.ThrowsAny<ArgumentException>(() => bai.Vao(LoaiXe.XeMay, null!));
        Assert.Equal(4, bai.ConTrong(LoaiXe.XeMay));
        bai.Ra(ve.MaVe);
        Assert.Equal("51A-123.45", bai.Vao(LoaiXe.OTo, "51A-123.45").BienSo);
    }

    [Fact]
    public void MaVeTangDanVaVeHetHieuLuc()
    {
        var bai = new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.XeDap] = 2 }, new DongHoGia(T("2026-06-01T01:00:00Z")));
        var v1 = bai.Vao(LoaiXe.XeDap, "X1");
        Assert.Throws<InvalidOperationException>(() => bai.Vao(LoaiXe.XeDap, "x1"));
        var v2 = bai.Vao(LoaiXe.XeDap, "X2");
        Assert.Throws<BaiDayException>(() => bai.Vao(LoaiXe.XeDap, "X3"));
        bai.Ra(v1.MaVe);
        var v3 = bai.Vao(LoaiXe.XeDap, "X3");
        Assert.Equal(new[] { "V000001", "V000002", "V000003" }, new[] { v1.MaVe, v2.MaVe, v3.MaVe });
        Assert.Throws<VeKhongHopLeException>(() => bai.Ra(v1.MaVe));
        Assert.Throws<VeKhongHopLeException>(() => bai.Ra("V999999"));
    }

    [Fact]
    public void MatVeCongPhatVaHuyVe()
    {
        var dh = new DongHoGia(T("2026-06-01T01:00:00Z"));
        var bai = new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.OTo] = 3 }, dh);
        var ve = bai.Vao(LoaiXe.OTo, "29H-555.55");
        dh.Tien(TimeSpan.FromHours(26));
        var hd = bai.RaMatVe(" 29h-555.55");
        Assert.Equal(new HoaDonGui(ve.MaVe, "29H-555.55", LoaiXe.OTo, T("2026-06-01T08:00:00+07:00"), T("2026-06-02T10:00:00+07:00"),
            225_000, 50_000, 200_000), hd);
        Assert.Equal(475_000, hd.Tong);
        Assert.Throws<VeKhongHopLeException>(() => bai.Ra(ve.MaVe));
        Assert.Throws<VeKhongHopLeException>(() => bai.RaMatVe("29H-555.55"));
        Assert.Throws<VeKhongHopLeException>(() => bai.RaMatVe("KHONG-CO"));
        Assert.Equal(3, bai.ConTrong(LoaiXe.OTo));
    }

    [Fact]
    public void HoaDonDungGioDongHoVaQuaDem()
    {
        var dh = new DongHoGia(T("2026-03-10T18:00:00Z"));
        var bai = new BaiDoXe(new Dictionary<LoaiXe, int> { [LoaiXe.XeMay] = 1 }, dh);
        var ve = bai.Vao(LoaiXe.XeMay, "59X");
        dh.Tien(TimeSpan.FromMinutes(90));
        var hd = bai.Ra(ve.MaVe);
        Assert.Equal(T("2026-03-10T18:00:00Z"), hd.Vao);
        Assert.Equal(T("2026-03-10T19:30:00Z"), hd.Ra);
        Assert.Equal((5_000L, 5_000L, 0L, 10_000L), (hd.TienGio, hd.PhuPhiDem, hd.PhatMatVe, hd.Tong));
    }
}
