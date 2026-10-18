using KhoHang;

namespace KhoHang.Tests;

public class KhoTests
{
    private static Kho TaoKho()
    {
        var k = new Kho();
        k.ThemSanPham(new SanPham("A", "Ốc vít M3", 1500m));
        k.ThemSanPham(new SanPham("B", "Đai ốc M3", 800m));
        return k;
    }

    [Fact]
    public void NhapXuat_CapNhatTon()
    {
        var k = TaoKho();
        k.Nhap("A", 10);
        k.Xuat("A", 4);
        Assert.Equal(6, k.TonKho("A"));
        Assert.Equal(0, k.TonKho("B"));
    }

    [Fact]
    public void XuatQuaTon_NemVaKhongDoiTon()
    {
        var k = TaoKho();
        k.Nhap("A", 3);
        Assert.ThrowsAny<InvalidOperationException>(() => k.Xuat("A", 5));
        Assert.Equal(3, k.TonKho("A"));
    }

    [Fact]
    public void MaKhongCo_NemKeyNotFound()
    {
        var k = TaoKho();
        Assert.Throws<KeyNotFoundException>(() => k.Nhap("Z", 1));
    }

    [Fact]
    public void TrungMa_Nem()
    {
        var k = TaoKho();
        Assert.ThrowsAny<InvalidOperationException>(() => k.ThemSanPham(new SanPham("A", "trùng", 1m)));
    }

    [Fact]
    public void TongGiaTri()
    {
        var k = TaoKho();
        k.Nhap("A", 2);
        k.Nhap("B", 5);
        Assert.Equal(7000m, k.TongGiaTri());
    }
}
