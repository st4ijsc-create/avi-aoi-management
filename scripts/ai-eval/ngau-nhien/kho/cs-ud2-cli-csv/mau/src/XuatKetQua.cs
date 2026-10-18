using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Bai;

public sealed record DongTongHop(string Nhom, int SoDong, decimal? Tong);

public static class XuatKetQua
{
    public static string Bang(string cotNhom, string? cotTong, IReadOnlyList<DongTongHop> dong)
    {
        var tieuDe = new List<string> { cotNhom, "so_dong" };
        if (cotTong is not null) tieuDe.Add("tong_" + cotTong);
        var hang = dong.Select(d =>
        {
            var o = new List<string> { d.Nhom, d.SoDong.ToString(CultureInfo.InvariantCulture) };
            if (cotTong is not null) o.Add((d.Tong ?? 0m).ToString(CultureInfo.InvariantCulture));
            return o;
        }).ToList();
        var rong = tieuDe.Select((t, c) => hang.Select(h => h[c].Length).Prepend(t.Length).Max()).ToArray();

        string Dong(IReadOnlyList<string> o) =>
            string.Join(" | ", o.Select((x, c) => c == 0 ? x.PadRight(rong[c]) : x.PadLeft(rong[c])));

        var sb = new StringBuilder();
        sb.Append(Dong(tieuDe)).Append('\n');
        sb.Append(string.Join("-+-", rong.Select(w => new string('-', w)))).Append('\n');
        foreach (var h in hang) sb.Append(Dong(h)).Append('\n');
        return sb.ToString();
    }

    public static string Json(IReadOnlyList<DongTongHop> dong)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            w.WriteStartArray();
            foreach (var d in dong)
            {
                w.WriteStartObject();
                w.WriteString("nhom", d.Nhom);
                w.WriteNumber("so_dong", d.SoDong);
                if (d.Tong is decimal t) w.WriteNumber("tong", t);
                w.WriteEndObject();
            }
            w.WriteEndArray();
        }
        return Encoding.UTF8.GetString(ms.ToArray()) + "\n";
    }
}
