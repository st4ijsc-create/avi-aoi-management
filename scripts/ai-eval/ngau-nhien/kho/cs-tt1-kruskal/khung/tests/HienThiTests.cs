using Bai;

namespace KiemThu;

public class HienThiTests
{
    [Fact]
    public void CayKhungDoThiNho()
    {
        var canh = new List<Canh> { new(0, 1, 1), new(1, 2, 2), new(2, 3, 1), new(0, 3, 3), new(0, 2, 2) };
        var kq = Kruskal.CayKhung(4, canh);
        Assert.NotNull(kq);
        Assert.Equal(4, kq.TongTrongSo);
        Assert.Equal(1, kq.SoThanhPhan);
        Assert.Equal(new[] { new Canh(0, 1, 1), new Canh(2, 3, 1), new Canh(0, 2, 2) }, kq.CacCanh);
    }

    [Fact]
    public void KhongLienThongThiCayKhungLaNull()
    {
        var canh = new List<Canh> { new(0, 1, 7) };
        Assert.Null(Kruskal.CayKhung(3, canh));
        var rung = Kruskal.RungKhung(3, canh);
        Assert.Equal(2, rung.SoThanhPhan);
        Assert.Equal(7, rung.TongTrongSo);
    }

    [Fact]
    public void HopNhatCoBan()
    {
        var hn = new HopNhat(3);
        Assert.Equal(3, hn.SoTap);
        Assert.True(hn.Hop(0, 1));
        Assert.False(hn.Hop(0, 1));
        Assert.Equal(2, hn.SoTap);
        Assert.Equal(hn.Tim(0), hn.Tim(1));
        Assert.NotEqual(hn.Tim(0), hn.Tim(2));
    }
}
