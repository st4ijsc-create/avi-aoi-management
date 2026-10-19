using Bai;

namespace KiemThu;

public class HienThiTests
{
    private static readonly KhachHang[] Khach =
    {
        new(1, "An", "Bac"), new(2, "Binh", "Nam"), new(3, "Chi", "Bac"),
    };

    private static readonly DonHang[] Don =
    {
        new(101, 1, new DateOnly(2026, 1, 5), "Sach", 100m),
        new(102, 1, new DateOnly(2026, 1, 20), "Sach", 50m),
        new(103, 2, new DateOnly(2026, 1, 7), "Vo", 30m),
        new(104, 3, new DateOnly(2026, 2, 1), "Sach", 70m),
        new(105, 2, new DateOnly(2026, 3, 15), "Sach", 200m),
    };

    [Fact]
    public void DoanhSoTheoVungDanhMucThang()
    {
        Assert.Equal(new[]
        {
            new DongDoanhSo("Bac", "Sach", 2026, 1, 2, 150m),
            new DongDoanhSo("Bac", "Sach", 2026, 2, 1, 70m),
            new DongDoanhSo("Nam", "Sach", 2026, 3, 1, 200m),
            new DongDoanhSo("Nam", "Vo", 2026, 1, 1, 30m),
        }, BaoCao.TheoVungDanhMucThang(Khach, Don));
    }

    [Fact]
    public void TopHaiKhach()
    {
        Assert.Equal(new[] { new TongKhach(2, "Binh", 2, 230m), new TongKhach(1, "An", 2, 150m) }, BaoCao.TopKhach(Khach, Don, 2));
    }

    [Fact]
    public void LuyKeMuoiHaiThang()
    {
        var r = BaoCao.LuyKeTheoThang(Don, 2026);
        Assert.Equal(12, r.Count);
        Assert.Equal(new LuyKeThang(1, 180m, 180m), r[0]);
        Assert.Equal(new LuyKeThang(2, 70m, 250m), r[1]);
        Assert.Equal(new LuyKeThang(3, 200m, 450m), r[2]);
        Assert.Equal(new LuyKeThang(12, 0m, 450m), r[11]);
    }
}
