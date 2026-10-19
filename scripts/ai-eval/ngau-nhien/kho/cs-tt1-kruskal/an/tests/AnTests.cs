using Bai;

namespace KiemThu;

public class AnTests
{
    [Fact]
    public void PhaHoaTheoDinhNhoRoiDinhLon_KhiCanhGhiNguocChieu()
    {
        // ba cạnh cùng trọng số; khoá (min, max): (1,2) (0,2) (0,1) ⇒ xét (0,1) rồi (0,2), bỏ (1,2)
        var canh = new List<Canh> { new(1, 2, 1), new(2, 0, 1), new(0, 1, 1) };
        var kq = Kruskal.RungKhung(3, canh);
        Assert.Equal(new[] { new Canh(0, 1, 1), new Canh(2, 0, 1) }, kq.CacCanh);
        Assert.Equal(2, kq.TongTrongSo);
    }

    [Fact]
    public void TrungKhoaHoanToanThiCanhDungTruocThang()
    {
        var kq = Kruskal.CayKhung(2, new[] { new Canh(1, 0, 5), new Canh(0, 1, 5) });
        Assert.NotNull(kq);
        Assert.Equal(new[] { new Canh(1, 0, 5) }, kq.CacCanh);

        var kq2 = Kruskal.CayKhung(2, new[] { new Canh(0, 1, 5), new Canh(1, 0, 5) });
        Assert.Equal(new[] { new Canh(0, 1, 5) }, kq2!.CacCanh);
    }

    [Fact]
    public void RungKhungDemThanhPhanKeCaDinhCoLap()
    {
        var canh = new List<Canh> { new(0, 1, 3), new(1, 2, 1), new(3, 4, 2), new(0, 2, 2) };
        var kq = Kruskal.RungKhung(5, canh);
        Assert.Equal(new[] { new Canh(1, 2, 1), new Canh(0, 2, 2), new Canh(3, 4, 2) }, kq.CacCanh);
        Assert.Equal(5, kq.TongTrongSo);
        Assert.Equal(2, kq.SoThanhPhan);
        Assert.Null(Kruskal.CayKhung(5, canh));

        var kq6 = Kruskal.RungKhung(6, canh);
        Assert.Equal(3, kq6.SoThanhPhan);
        Assert.Equal(5, kq6.TongTrongSo);
    }

    [Fact]
    public void KhongDinhVaMotDinh()
    {
        var r0 = Kruskal.RungKhung(0, Array.Empty<Canh>());
        Assert.Equal(0, r0.TongTrongSo);
        Assert.Empty(r0.CacCanh);
        Assert.Equal(0, r0.SoThanhPhan);
        Assert.Null(Kruskal.CayKhung(0, Array.Empty<Canh>()));

        var r1 = Kruskal.CayKhung(1, new[] { new Canh(0, 0, -9) });
        Assert.NotNull(r1);
        Assert.Empty(r1.CacCanh);
        Assert.Equal(0, r1.TongTrongSo);
        Assert.Equal(1, r1.SoThanhPhan);
    }

    [Fact]
    public void KhuyenBoQuaDuAmNhat()
    {
        var kq = Kruskal.CayKhung(2, new[] { new Canh(0, 0, -100), new Canh(1, 1, -5), new Canh(0, 1, 7) });
        Assert.NotNull(kq);
        Assert.Equal(new[] { new Canh(0, 1, 7) }, kq.CacCanh);
        Assert.Equal(7, kq.TongTrongSo);
    }

    [Fact]
    public void TrongSoAmVaTongVuotInt()
    {
        const long T = 4_000_000_000_000;
        var canh = new List<Canh> { new(0, 1, -3), new(1, 2, T), new(2, 3, T), new(0, 3, T + 1), new(3, 1, -1) };
        var kq = Kruskal.CayKhung(4, canh);
        Assert.NotNull(kq);
        Assert.Equal(new[] { new Canh(0, 1, -3), new Canh(3, 1, -1), new Canh(1, 2, T) }, kq.CacCanh);
        Assert.Equal(3_999_999_999_996L, kq.TongTrongSo);
    }

    [Fact]
    public void ThamSoSaiNemArgumentOutOfRange()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Kruskal.RungKhung(-1, Array.Empty<Canh>()));
        Assert.Throws<ArgumentOutOfRangeException>(() => Kruskal.RungKhung(3, new[] { new Canh(0, 3, 1) }));
        Assert.Throws<ArgumentOutOfRangeException>(() => Kruskal.CayKhung(3, new[] { new Canh(0, 1, 1), new Canh(-1, 0, 1) }));
        Assert.Throws<ArgumentOutOfRangeException>(() => new HopNhat(-1));
        var hn = new HopNhat(5);
        Assert.Throws<ArgumentOutOfRangeException>(() => hn.Tim(5));
        Assert.Throws<ArgumentOutOfRangeException>(() => hn.Hop(0, -1));
    }

    [Fact]
    public void HopNhatDemTapVaGoc()
    {
        var hn = new HopNhat(5);
        Assert.Equal(2, hn.Tim(2));
        Assert.True(hn.Hop(0, 1));
        Assert.False(hn.Hop(1, 0));
        Assert.False(hn.Hop(2, 2));
        Assert.True(hn.Hop(3, 4));
        Assert.True(hn.Hop(1, 4));
        Assert.Equal(2, hn.SoTap);
        Assert.Equal(hn.Tim(0), hn.Tim(3));
        Assert.NotEqual(hn.Tim(2), hn.Tim(0));
        Assert.Equal(2, hn.Tim(2));
        Assert.Equal(0, new HopNhat(0).SoTap);
    }

    [Fact]
    public void HopNhatChuoiMotTrieuPhanTu()
    {
        const int n = 1_000_000;
        var hn = new HopNhat(n);
        for (int i = 0; i + 1 < n; i++) Assert.True(hn.Hop(i, i + 1));
        Assert.Equal(1, hn.SoTap);
        int g = hn.Tim(0);
        for (int i = n - 1; i >= 0; i -= 997) Assert.Equal(g, hn.Tim(i));
        Assert.Equal(g, hn.Tim(n - 1));
    }

    [Fact]
    public void DoThiLonDuongThang()
    {
        const int n = 200_000;
        var canh = new List<Canh>();
        for (int i = n - 3; i >= 0; i--)
        {
            canh.Add(new Canh(i + 2, i, 100));
            canh.Add(new Canh(i + 1, i, i % 7 + 1));
        }
        canh.Add(new Canh(n - 1, n - 2, (n - 2) % 7 + 1));
        long kyVong = 0;
        for (int i = 0; i + 1 < n; i++) kyVong += i % 7 + 1;
        var kq = Kruskal.CayKhung(n, canh);
        Assert.NotNull(kq);
        Assert.Equal(kyVong, kq.TongTrongSo);
        Assert.Equal(n - 1, kq.CacCanh.Count);
        Assert.All(kq.CacCanh, c => Assert.Equal(1, Math.Abs(c.U - c.V)));
    }
}
