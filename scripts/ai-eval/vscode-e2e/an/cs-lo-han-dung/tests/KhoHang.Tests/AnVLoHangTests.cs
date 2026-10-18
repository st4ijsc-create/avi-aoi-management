using KhoHang;

namespace KhoHang.Tests;

public class AnVLoHangTests
{
    private static DateOnly D(int thang, int ngay) => new(2026, thang, ngay);

    private static Kho TaoKho()
    {
        var k = new Kho();
        k.ThemSanPham(new SanPham("SUA", "Sữa hộp", 10000m));
        k.ThemSanPham(new SanPham("BANH", "Bánh quy", 20000m));
        return k;
    }

    [Fact]
    public void XuatTheoLo_FefoQuaNhieuLo()
    {
        var k = TaoKho();
        k.Nhap("SUA", 5, "L2", D(6, 1));
        k.Nhap("SUA", 3, "L1", D(5, 1));
        k.Nhap("SUA", 4, "L3", D(7, 1));
        var lay = k.XuatTheoLo("SUA", 6);
        Assert.Equal(new[] { new LoHang("L1", 3, D(5, 1)), new LoHang("L2", 3, D(6, 1)) }, lay);
        Assert.Equal(new[] { new LoHang("L2", 2, D(6, 1)), new LoHang("L3", 4, D(7, 1)) }, k.DanhSachLo("SUA"));
        Assert.Equal(6, k.TonKho("SUA"));
    }

    [Fact]
    public void CungHan_TheoMaLo()
    {
        var k = TaoKho();
        k.Nhap("SUA", 2, "B", D(5, 1));
        k.Nhap("SUA", 2, "A", D(5, 1));
        Assert.Equal("A", k.XuatTheoLo("SUA", 1)[0].MaLo);
    }

    [Fact]
    public void NhapCungLo_CongDon_KhacHan_Nem()
    {
        var k = TaoKho();
        k.Nhap("SUA", 2, "L1", D(5, 1));
        k.Nhap("SUA", 3, "L1", D(5, 1));
        Assert.Equal(new[] { new LoHang("L1", 5, D(5, 1)) }, k.DanhSachLo("SUA"));
        Assert.ThrowsAny<InvalidOperationException>(() => k.Nhap("SUA", 1, "L1", D(9, 9)));
        Assert.Equal(5, k.TonKho("SUA"));
    }

    [Fact]
    public void NhapKhongLo_VaoLoMacDinh_XuatSauCung()
    {
        var k = TaoKho();
        k.Nhap("SUA", 2);
        k.Nhap("SUA", 1, "L1", D(5, 1));
        Assert.Equal(new[] { new LoHang("L1", 1, D(5, 1)), new LoHang("MAC_DINH", 2, DateOnly.MaxValue) }, k.DanhSachLo("SUA"));
        k.Xuat("SUA", 2);
        Assert.Equal(new[] { new LoHang("MAC_DINH", 1, DateOnly.MaxValue) }, k.DanhSachLo("SUA"));
    }

    [Fact]
    public void XuatQuaTon_NemVaKhongDoiLo()
    {
        var k = TaoKho();
        k.Nhap("SUA", 2, "L1", D(5, 1));
        Assert.ThrowsAny<InvalidOperationException>(() => k.XuatTheoLo("SUA", 3));
        Assert.Equal(new[] { new LoHang("L1", 2, D(5, 1)) }, k.DanhSachLo("SUA"));
    }

    [Fact]
    public void LoSapHetHan_SapTheoHanMaSpMaLo()
    {
        var k = TaoKho();
        k.Nhap("SUA", 1, "S2", D(5, 10));
        k.Nhap("BANH", 1, "B1", D(5, 10));
        k.Nhap("SUA", 1, "S1", D(5, 3));
        k.Nhap("SUA", 1, "S9", D(8, 1));
        k.Nhap("BANH", 1);
        var ds = k.LoSapHetHan(D(5, 1), 10);
        Assert.Equal(new[] { ("SUA", "S1"), ("BANH", "B1"), ("SUA", "S2") }, ds.Select(x => (x.Ma, x.Lo.MaLo)).ToArray());
    }

    [Fact]
    public void TongGiaTri_TheoLo()
    {
        var k = TaoKho();
        k.Nhap("SUA", 2, "L1", D(5, 1));
        k.Nhap("BANH", 1);
        Assert.Equal(40000m, k.TongGiaTri());
    }
}
