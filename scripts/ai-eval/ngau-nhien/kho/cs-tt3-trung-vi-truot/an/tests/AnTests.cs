using Bai;

namespace KiemThu;

public class AnTests
{
    [Fact]
    public void GiaTriSatBienIntKhongTran()
    {
        Assert.Equal(new[] { 2147483646.5 }, TrungVi.TrungViTruot(new[] { int.MaxValue, int.MaxValue - 1 }, 2));
        Assert.Equal(new[] { -2147483648.0 }, TrungVi.TrungViTruot(new[] { int.MinValue, int.MinValue }, 2));
        Assert.Equal(new[] { -0.5, -0.5 }, TrungVi.TrungViTruot(new[] { int.MinValue, int.MaxValue, int.MinValue }, 2));
        Assert.Equal(new[] { 2147483647.0, 2147483647.0 }, TrungVi.TrungViTruot(new[] { int.MaxValue, int.MaxValue, int.MaxValue, 5 }, 3));
    }

    [Fact]
    public void KBangMotTraChinhPhanTu()
    {
        Assert.Equal(new double[] { 7, -2, 0, int.MaxValue }, TrungVi.TrungViTruot(new[] { 7, -2, 0, int.MaxValue }, 1));
    }

    [Fact]
    public void GiaTriTrungNhauLaPhanTuRiengBiet()
    {
        Assert.Equal(new[] { 1.5, 1.5, 2.0 }, TrungVi.TrungViTruot(new[] { 2, 2, 1, 1, 3, 3 }, 4));
        Assert.Equal(new double[] { 7, 7, 7 }, TrungVi.TrungViTruot(new[] { 7, 7, 7, 7 }, 2));
        Assert.Equal(new double[] { 5, 5, 5, 5 }, TrungVi.TrungViTruot(new[] { 5, 5, 5, 1, 5, 5 }, 3));
    }

    [Fact]
    public void SoAmVaCuaSoChan()
    {
        Assert.Equal(new[] { -2.0, -2.5, -2.5, -3.0 }, TrungVi.TrungViTruot(new[] { -3, -1, -4, -1, -5 }, 2));
    }

    [Fact]
    public void DayGiamDanCuaSoChan()
    {
        Assert.Equal(new[] { 8.5, 7.5, 6.5, 5.5, 4.5, 3.5, 2.5 },
            TrungVi.TrungViTruot(new[] { 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 }, 4));
    }

    [Fact]
    public void ThamSoKhongHopLe()
    {
        Assert.Throws<ArgumentNullException>(() => TrungVi.TrungViTruot(null!, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => TrungVi.TrungViTruot(new[] { 1, 2 }, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => TrungVi.TrungViTruot(new[] { 1, 2 }, 3));
        Assert.Throws<ArgumentOutOfRangeException>(() => TrungVi.TrungViTruot(new[] { 1, 2 }, -1));
        Assert.Throws<ArgumentOutOfRangeException>(() => TrungVi.TrungViTruot(Array.Empty<int>(), 1));
    }

    [Fact]
    public void KhongSuaMangDauVao()
    {
        var a = new[] { 5, -1, 9, 3, 3, 0, 12 };
        var banSao = (int[])a.Clone();
        TrungVi.TrungViTruot(a, 4);
        TrungVi.TrungViTruot(a, 3);
        Assert.Equal(banSao, a);
    }

    private static int[] MangGia(int n, uint hat, bool satBien)
    {
        var a = new int[n];
        uint x = hat;
        for (int i = 0; i < n; i++)
        {
            x ^= x << 13; x ^= x >> 17; x ^= x << 5;
            a[i] = satBien ? (int)x : (int)(x % 1000) - 500;
        }
        return a;
    }

    private static double TrungViVetCan(int[] a, int dau, int k)
    {
        var w = new long[k];
        for (int j = 0; j < k; j++) w[j] = a[dau + j];
        Array.Sort(w);
        return k % 2 == 1 ? w[k / 2] : (w[k / 2 - 1] + w[k / 2]) / 2.0;
    }

    [Theory]
    [InlineData(200_000, 50_001, false)]
    [InlineData(200_000, 40_000, true)]
    [InlineData(150_000, 2, true)]
    public void MangLonDungVaNhanh(int n, int k, bool satBien)
    {
        var a = MangGia(n, (uint)(n + k), satBien);
        double[]? kq = null;
        var viec = Task.Run(() => kq = TrungVi.TrungViTruot(a, k));
        Assert.True(viec.Wait(TimeSpan.FromSeconds(8)), "quá chậm — cần O(n log k)");
        Assert.NotNull(kq);
        Assert.Equal(n - k + 1, kq.Length);
        for (int i = 0; i < kq.Length; i += 1999) Assert.Equal(TrungViVetCan(a, i, k), kq[i]);
        Assert.Equal(TrungViVetCan(a, kq.Length - 1, k), kq[^1]);
    }
}
