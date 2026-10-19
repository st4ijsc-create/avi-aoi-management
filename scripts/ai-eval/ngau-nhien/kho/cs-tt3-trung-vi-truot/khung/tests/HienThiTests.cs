using Bai;

namespace KiemThu;

public class HienThiTests
{
    [Fact]
    public void CuaSoLe()
    {
        Assert.Equal(new double[] { 1, -1, -1, 3, 5, 6 }, TrungVi.TrungViTruot(new[] { 1, 3, -1, -3, 5, 3, 6, 7 }, 3));
    }

    [Fact]
    public void CuaSoChanLayTrungBinhHaiSoGiua()
    {
        Assert.Equal(new[] { 1.5, 2.5, 3.5 }, TrungVi.TrungViTruot(new[] { 1, 2, 3, 4 }, 2));
    }

    [Fact]
    public void CuaSoBangCaMang()
    {
        Assert.Equal(new[] { 4.0 }, TrungVi.TrungViTruot(new[] { 9, 1, 4, 8, 2 }, 5));
    }
}
