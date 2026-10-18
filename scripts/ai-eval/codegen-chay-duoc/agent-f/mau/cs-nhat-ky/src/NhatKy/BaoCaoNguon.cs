using System.Globalization;
using System.Text.Json;

namespace NhatKy;

public sealed record DongBaoCao(string Nguon, int Tong, int SoCanhBao, int SoLoi, DateTime LanCuoi);

public static class BaoCaoNguon
{
    /// <summary>Gom theo nguồn trong [tu, den); sắp SoLoi giảm dần rồi Nguon tăng dần (ordinal).</summary>
    public static IReadOnlyList<DongBaoCao> Tao(IEnumerable<BanGhi> banGhi, DateTime? tu = null, DateTime? den = null)
    {
        return banGhi
            .Where(b => (tu is null || b.ThoiGian >= tu) && (den is null || b.ThoiGian < den))
            .GroupBy(b => b.Nguon)
            .Select(g => new DongBaoCao(
                g.Key,
                g.Count(),
                g.Count(b => b.MucDo == MucDo.Warn),
                g.Count(b => b.MucDo is MucDo.Error or MucDo.Fatal),
                g.Max(b => b.ThoiGian)))
            .OrderByDescending(d => d.SoLoi)
            .ThenBy(d => d.Nguon, StringComparer.Ordinal)
            .ToList();
    }

    public static string XuatJson(IReadOnlyList<DongBaoCao> dong)
    {
        var duLieu = dong.Select(d => new
        {
            nguon = d.Nguon,
            tong = d.Tong,
            soCanhBao = d.SoCanhBao,
            soLoi = d.SoLoi,
            lanCuoi = d.LanCuoi.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
        });
        return JsonSerializer.Serialize(duLieu);
    }
}
