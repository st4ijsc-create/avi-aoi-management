using NhatKy;

namespace NhatKy.Tests;

public class BoPhanTichTests
{
    [Fact]
    public void PhanTichDong_DungDinhDang()
    {
        var bg = BoPhanTich.PhanTichDong("2026-10-01T08:00:00 [WARN] auth: Đăng nhập sai mật khẩu lần 3");
        Assert.NotNull(bg);
        Assert.Equal(new DateTime(2026, 10, 1, 8, 0, 0), bg!.ThoiGian);
        Assert.Equal(MucDo.Warn, bg.MucDo);
        Assert.Equal("auth", bg.Nguon);
        Assert.Equal("Đăng nhập sai mật khẩu lần 3", bg.NoiDung);
    }

    [Theory]
    [InlineData("không phải nhật ký")]
    [InlineData("2026-10-01 08:00:00 [INFO] app: thiếu chữ T")]
    [InlineData("2026-10-01T08:00:00 [TRACE] app: mức lạ")]
    [InlineData("2026-10-01T08:00:00 [INFO] app thiếu dấu hai chấm")]
    public void PhanTichDong_SaiDinhDang_Null(string dong)
    {
        Assert.Null(BoPhanTich.PhanTichDong(dong));
    }

    [Fact]
    public void PhanTich_DemDongBoQua_KhongTinhDongTrong()
    {
        var kq = BoPhanTich.PhanTich(new[]
        {
            "2026-10-01T08:00:00 [INFO] app: khởi động",
            "",
            "rác",
            "2026-10-01T08:00:05 [ERROR] db: mất kết nối",
        });
        Assert.Equal(2, kq.BanGhi.Count);
        Assert.Equal(1, kq.SoDongBoQua);
        Assert.Equal("db", kq.BanGhi[1].Nguon);
    }

    [Fact]
    public void ThongKe_DemVaTyLeLoi()
    {
        var kq = BoPhanTich.PhanTich(new[]
        {
            "2026-10-01T08:00:00 [INFO] app: a",
            "2026-10-01T08:00:01 [ERROR] app: b",
            "2026-10-01T08:00:02 [WARN] db: c",
            "2026-10-01T08:00:03 [ERROR] db: d",
        });
        var dem = ThongKe.DemTheoMucDo(kq.BanGhi);
        Assert.Equal(0, dem[MucDo.Debug]);
        Assert.Equal(2, dem[MucDo.Error]);
        Assert.Equal(0.5, ThongKe.TyLeLoi(kq.BanGhi.ToList()), 3);
        Assert.Equal(0, ThongKe.TyLeLoi(new List<BanGhi>()));
    }
}
