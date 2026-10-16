using System.Globalization;
using System.Text.RegularExpressions;

namespace NhatKy;

public static class BoPhanTich
{
    private static readonly Regex Dong = new(
        @"^(?<tg>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}) \[(?<muc>[A-Z]+)\] (?<nguon>[^:\s]+): (?<nd>.*)$",
        RegexOptions.Compiled);

    private static readonly Dictionary<string, MucDo> TenMuc = new()
    {
        ["DEBUG"] = MucDo.Debug,
        ["INFO"] = MucDo.Info,
        ["WARN"] = MucDo.Warn,
        ["ERROR"] = MucDo.Error,
    };

    /// <summary>Một dòng ⇒ bản ghi; dòng không đúng định dạng (hoặc mức lạ) ⇒ null.</summary>
    public static BanGhi? PhanTichDong(string dong)
    {
        var m = Dong.Match(dong);
        if (!m.Success) return null;
        if (!TenMuc.TryGetValue(m.Groups["muc"].Value, out var muc)) return null;
        var thoiGian = DateTime.ParseExact(m.Groups["tg"].Value, "yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
        return new BanGhi(thoiGian, muc, m.Groups["nguon"].Value, m.Groups["nd"].Value);
    }

    /// <summary>Nhiều dòng ⇒ các bản ghi hợp lệ theo thứ tự + số dòng bị bỏ qua (dòng trống không tính).</summary>
    public static KetQuaPhanTich PhanTich(IEnumerable<string> cacDong)
    {
        var ds = new List<BanGhi>();
        var boQua = 0;
        foreach (var dong in cacDong)
        {
            if (string.IsNullOrWhiteSpace(dong)) continue;
            var bg = PhanTichDong(dong);
            if (bg is null) boQua++;
            else ds.Add(bg);
        }
        return new KetQuaPhanTich(ds, boQua);
    }
}
