using Bai;

namespace KiemThu;

public class AnTests
{
    private static DonHang D(int ma, int khach, int nam, int thang, int ngay, string danhMuc, decimal tien) =>
        new(ma, khach, new DateOnly(nam, thang, ngay), danhMuc, tien);

    [Fact]
    public void KhachLaVaoVungKhongRo_SapXepOrdinal()
    {
        var khach = new[] { new KhachHang(1, "A", "Tây"), new KhachHang(2, "B", "Đông") };
        var don = new[]
        {
            D(1, 1, 2026, 5, 1, "banh", 10m), D(2, 1, 2026, 5, 2, "Bia", 20m),
            D(3, 2, 2026, 5, 3, "Bia", 5m), D(4, 99, 2026, 5, 4, "banh", 1m),
        };
        Assert.Equal(new[]
        {
            new DongDoanhSo("(không rõ)", "banh", 2026, 5, 1, 1m),
            new DongDoanhSo("Tây", "Bia", 2026, 5, 1, 20m),
            new DongDoanhSo("Tây", "banh", 2026, 5, 1, 10m),
            new DongDoanhSo("Đông", "Bia", 2026, 5, 1, 5m),
        }, BaoCao.TheoVungDanhMucThang(khach, don));
    }

    [Fact]
    public void NhieuNamVaThangSapTheoSo()
    {
        var khach = new[] { new KhachHang(1, "A", "X") };
        var don = new[]
        {
            D(1, 1, 2026, 10, 1, "M", 1m), D(2, 1, 2026, 2, 1, "M", 2m), D(3, 1, 2025, 12, 31, "M", 4m),
            D(4, 1, 2026, 2, 28, "M", 8m), D(5, 1, 2025, 2, 1, "M", 16m),
        };
        Assert.Equal(new[]
        {
            new DongDoanhSo("X", "M", 2025, 2, 1, 16m),
            new DongDoanhSo("X", "M", 2025, 12, 1, 4m),
            new DongDoanhSo("X", "M", 2026, 2, 2, 10m),
            new DongDoanhSo("X", "M", 2026, 10, 1, 1m),
        }, BaoCao.TheoVungDanhMucThang(khach, don));
    }

    [Fact]
    public void TongTheoKhachLaLeftJoinSapTheoMa()
    {
        var khach = new[] { new KhachHang(3, "C", "X"), new KhachHang(1, "A", "X"), new KhachHang(2, "B", "Y") };
        var don = new[]
        {
            D(1, 1, 2026, 1, 1, "M", 5m), D(2, 1, 2026, 1, 2, "M", 7m), D(3, 3, 2026, 1, 3, "M", 1m), D(4, 42, 2026, 1, 4, "M", 1000m),
        };
        Assert.Equal(new[]
        {
            new TongKhach(1, "A", 2, 12m), new TongKhach(2, "B", 0, 0m), new TongKhach(3, "C", 1, 1m),
        }, BaoCao.TongTheoKhach(khach, don));
    }

    private static readonly KhachHang[] NamKhach =
        Enumerable.Range(1, 5).Select(i => new KhachHang(i, "K" + i, "X")).ToArray();

    private static readonly DonHang[] DonHoa =
    {
        D(1, 1, 2026, 1, 1, "M", 50m),
        D(2, 3, 2026, 1, 1, "M", 60m), D(3, 3, 2026, 1, 2, "M", 40m),
        D(4, 4, 2026, 1, 1, "M", 30m), D(5, 4, 2026, 1, 2, "M", 70m),
        D(6, 5, 2026, 1, 1, "M", 100m),
    };

    [Fact]
    public void TopPhaHoaTheoSoDonRoiMaKhach()
    {
        Assert.Equal(new[]
        {
            new TongKhach(3, "K3", 2, 100m), new TongKhach(4, "K4", 2, 100m), new TongKhach(5, "K5", 1, 100m),
        }, BaoCao.TopKhach(NamKhach, DonHoa, 3));
    }

    [Fact]
    public void TopBoKhachKhongCoDon_NLonHonSoKhach()
    {
        var top = BaoCao.TopKhach(NamKhach, DonHoa.Append(D(9, 77, 2026, 1, 1, "M", 9999m)), 10);
        Assert.Equal(new[] { 3, 4, 5, 1 }, top.Select(t => t.MaKhach));
        Assert.Equal(new TongKhach(1, "K1", 1, 50m), top[3]);
    }

    [Fact]
    public void SoTienAmVanTinhVaKhachCoDonTongKhongVanVaoTop()
    {
        var khach = new[] { new KhachHang(1, "A", "X"), new KhachHang(2, "B", "X"), new KhachHang(3, "C", "X") };
        var don = new[] { D(1, 1, 2026, 1, 1, "M", 100m), D(2, 1, 2026, 1, 2, "M", -100m), D(3, 2, 2026, 1, 1, "M", 5m) };
        Assert.Equal(new[] { new TongKhach(2, "B", 1, 5m), new TongKhach(1, "A", 2, 0m) }, BaoCao.TopKhach(khach, don, 5));
    }

    [Fact]
    public void TopNKhongDuongNem()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => BaoCao.TopKhach(NamKhach, DonHoa, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => BaoCao.TopKhach(NamKhach, DonHoa, -3));
    }

    [Fact]
    public void LuyKeBoNamKhacThangTrongVaThapPhanChinhXac()
    {
        var don = new[]
        {
            D(1, 1, 2026, 1, 10, "M", 0.1m), D(2, 1, 2026, 1, 11, "M", 0.2m), D(3, 1, 2026, 3, 1, "M", -0.3m),
            D(4, 1, 2025, 3, 1, "M", 999m), D(5, 1, 2027, 1, 1, "M", 1m), D(6, 1, 2026, 12, 31, "M", 5m),
        };
        var r = BaoCao.LuyKeTheoThang(don, 2026);
        Assert.Equal(Enumerable.Range(1, 12), r.Select(x => x.Thang));
        Assert.Equal(new LuyKeThang(1, 0.3m, 0.3m), r[0]);
        Assert.Equal(new LuyKeThang(2, 0m, 0.3m), r[1]);
        Assert.Equal(new LuyKeThang(3, -0.3m, 0m), r[2]);
        for (int i = 3; i < 11; i++) Assert.Equal(new LuyKeThang(i + 1, 0m, 0m), r[i]);
        Assert.Equal(new LuyKeThang(12, 5m, 5m), r[11]);
    }

    [Fact]
    public void LuyKeKhongCoDonVanDuMuoiHaiDong()
    {
        var r = BaoCao.LuyKeTheoThang(Array.Empty<DonHang>(), 2030);
        Assert.Equal(12, r.Count);
        Assert.All(r, x => Assert.Equal((0m, 0m), (x.TrongThang, x.LuyKe)));
        Assert.Equal(12, r[11].Thang);
    }

    [Fact]
    public void ThamSoNullNemArgumentNull()
    {
        Assert.Throws<ArgumentNullException>(() => BaoCao.TheoVungDanhMucThang(null!, Array.Empty<DonHang>()));
        Assert.Throws<ArgumentNullException>(() => BaoCao.TongTheoKhach(NamKhach, null!));
        Assert.Throws<ArgumentNullException>(() => BaoCao.LuyKeTheoThang(null!, 2026));
    }
}
