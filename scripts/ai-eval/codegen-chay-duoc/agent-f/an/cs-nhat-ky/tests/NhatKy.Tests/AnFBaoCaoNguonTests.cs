// TEST ẨN bộ F (cs-nhat-ky) — chép vào dự án lúc chấm, xoá sau khi chấm. Không phải tệp của dự án.
using System.Text.Json;
using NhatKy;

namespace NhatKy.Tests;

public class AnFBaoCaoNguonTests
{
    private static readonly string[] Mau =
    {
        "2026-10-01T08:00:00 [INFO] app: khởi động",
        "2026-10-01T08:00:01 [WARN] auth: sai mật khẩu",
        "2026-10-01T08:00:02 [ERROR] db: mất kết nối",
        "2026-10-01T08:00:03 [FATAL] app: sập",
        "2026-10-01T08:00:04 [ERROR] auth: khoá tài khoản",
        "2026-10-01T08:00:05 [WARN] db: chậm",
        "2026-10-01T08:00:06 [DEBUG] cache: miss",
    };

    private static IReadOnlyList<BanGhi> NapMau() => BoPhanTich.PhanTich(Mau).BanGhi;

    [Fact]
    public void AnF_Fatal_DuocNhanDien()
    {
        var bg = BoPhanTich.PhanTichDong("2026-10-01T08:00:03 [FATAL] app: sập");
        Assert.NotNull(bg);
        Assert.Equal(MucDo.Fatal, bg!.MucDo);
        Assert.Equal(1, ThongKe.DemTheoMucDo(NapMau())[MucDo.Fatal]);
    }

    [Fact]
    public void AnF_TyLeLoi_TinhCaFatal()
    {
        Assert.Equal(3.0 / 7, ThongKe.TyLeLoi(NapMau().ToList()), 6);
    }

    [Fact]
    public void AnF_DongNoiTiep_GanVaoBanGhiTruoc()
    {
        var kq = BoPhanTich.PhanTich(new[]
        {
            "2026-10-01T08:00:02 [ERROR] db: mất kết nối",
            "    at Db.Connect()",
            "\tat App.Main()",
            "2026-10-01T08:00:03 [INFO] app: thử lại",
        });
        Assert.Equal(2, kq.BanGhi.Count);
        Assert.Equal(0, kq.SoDongBoQua);
        Assert.Equal("mất kết nối\nat Db.Connect()\nat App.Main()", kq.BanGhi[0].NoiDung);
        Assert.Equal("thử lại", kq.BanGhi[1].NoiDung);
    }

    [Fact]
    public void AnF_DongNoiTiep_KhongCoBanGhiTruoc_BoQua()
    {
        var kq = BoPhanTich.PhanTich(new[]
        {
            "   at Mo.Coi()",
            "rác",
            "   at Sau.Rac()",
            "2026-10-01T08:00:03 [INFO] app: ok",
        });
        Assert.Single(kq.BanGhi);
        Assert.Equal("ok", kq.BanGhi[0].NoiDung);
        Assert.Equal(3, kq.SoDongBoQua);
    }

    [Fact]
    public void AnF_BaoCao_GomTheoNguon_SapXep()
    {
        var bc = BaoCaoNguon.Tao(NapMau());
        Assert.Equal(new[] { "app", "auth", "db", "cache" }, bc.Select(d => d.Nguon).ToArray());
        var app = bc[0];
        Assert.Equal(2, app.Tong);
        Assert.Equal(0, app.SoCanhBao);
        Assert.Equal(1, app.SoLoi);
        Assert.Equal(new DateTime(2026, 10, 1, 8, 0, 3), app.LanCuoi);
        var db = bc.Single(d => d.Nguon == "db");
        Assert.Equal((2, 1, 1), (db.Tong, db.SoCanhBao, db.SoLoi));
        Assert.Equal(new DateTime(2026, 10, 1, 8, 0, 5), db.LanCuoi);
        Assert.Equal(0, bc[3].SoLoi);
    }

    [Fact]
    public void AnF_BaoCao_LocKhoangNuaMo()
    {
        var bc = BaoCaoNguon.Tao(NapMau(), new DateTime(2026, 10, 1, 8, 0, 2), new DateTime(2026, 10, 1, 8, 0, 5));
        Assert.Equal(new[] { "app", "auth", "db" }, bc.Select(d => d.Nguon).ToArray());
        Assert.Equal(3, bc.Sum(d => d.Tong));
        Assert.Equal(new[] { "cache", "db" }, BaoCaoNguon.Tao(NapMau(), new DateTime(2026, 10, 1, 8, 0, 5)).Select(d => d.Nguon).ToArray());
        Assert.Equal(2, BaoCaoNguon.Tao(NapMau(), den: new DateTime(2026, 10, 1, 8, 0, 2)).Sum(d => d.Tong));
    }

    [Fact]
    public void AnF_XuatJson_CamelCase_KhongThutLe()
    {
        var json = BaoCaoNguon.XuatJson(BaoCaoNguon.Tao(NapMau()));
        Assert.DoesNotContain("\n", json);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);
        Assert.Equal(4, doc.RootElement.GetArrayLength());
        var dau = doc.RootElement[0];
        Assert.Equal(new[] { "nguon", "tong", "soCanhBao", "soLoi", "lanCuoi" }.OrderBy(x => x),
            dau.EnumerateObject().Select(p => p.Name).OrderBy(x => x));
        Assert.Equal("app", dau.GetProperty("nguon").GetString());
        Assert.Equal(2, dau.GetProperty("tong").GetInt32());
        Assert.Equal(1, dau.GetProperty("soLoi").GetInt32());
        Assert.Equal("2026-10-01T08:00:03", dau.GetProperty("lanCuoi").GetString());
    }

    [Fact]
    public void AnF_XuatJson_Rong()
    {
        Assert.Equal("[]", BaoCaoNguon.XuatJson(BaoCaoNguon.Tao(Array.Empty<BanGhi>())));
    }
}
