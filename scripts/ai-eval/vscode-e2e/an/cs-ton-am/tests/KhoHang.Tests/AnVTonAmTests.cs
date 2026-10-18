using KhoHang;

namespace KhoHang.Tests;

public class AnVTonAmTests
{
    private static Kho TaoKho()
    {
        var k = new Kho();
        k.ThemSanPham(new SanPham("A", "Ốc vít", 1000m));
        return k;
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Nhap_SoLuongKhongDuong_NemVaKhongDoiTon(int sl)
    {
        var k = TaoKho();
        k.Nhap("A", 2);
        Assert.Throws<ArgumentOutOfRangeException>(() => k.Nhap("A", sl));
        Assert.Equal(2, k.TonKho("A"));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Xuat_SoLuongKhongDuong_NemVaKhongDoiTon(int sl)
    {
        var k = TaoKho();
        k.Nhap("A", 2);
        Assert.Throws<ArgumentOutOfRangeException>(() => k.Xuat("A", sl));
        Assert.Equal(2, k.TonKho("A"));
    }

    [Fact]
    public void Xuat_VuaDuTon_VeKhong()
    {
        var k = TaoKho();
        k.Nhap("A", 4);
        k.Xuat("A", 4);
        Assert.Equal(0, k.TonKho("A"));
        Assert.ThrowsAny<InvalidOperationException>(() => k.Xuat("A", 1));
        Assert.Equal(0, k.TonKho("A"));
    }

    [Fact]
    public void Xuat_MaKhongCo_VanKeyNotFound()
    {
        Assert.Throws<KeyNotFoundException>(() => TaoKho().Xuat("Z", 1));
    }
}
