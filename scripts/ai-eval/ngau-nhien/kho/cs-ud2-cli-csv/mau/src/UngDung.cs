using System.Globalization;

namespace Bai;

public static class UngDung
{
    private sealed class LoiThamSo(string thongDiep) : Exception(thongDiep);

    private sealed record ThamSo(string CotNhom, string? CotTong, bool Json, IReadOnlyList<(string Khoa, string GiaTri)> Loc);

    private static ThamSo PhanTich(string[] args)
    {
        string? nhom = null, tong = null, dinhDang = null;
        var loc = new List<(string, string)>();
        for (int i = 0; i < args.Length; i++)
        {
            var a = args[i];
            if (a is not ("--nhom-theo" or "--tong" or "--dinh-dang" or "--loc")) throw new LoiThamSo($"đối số không hợp lệ: {a}");
            if (i + 1 >= args.Length) throw new LoiThamSo($"{a} thiếu giá trị");
            var v = args[++i];
            switch (a)
            {
                case "--nhom-theo":
                    if (nhom is not null) throw new LoiThamSo("--nhom-theo lặp lại");
                    nhom = v;
                    break;
                case "--tong":
                    if (tong is not null) throw new LoiThamSo("--tong lặp lại");
                    tong = v;
                    break;
                case "--dinh-dang":
                    if (dinhDang is not null) throw new LoiThamSo("--dinh-dang lặp lại");
                    if (v is not ("bang" or "json")) throw new LoiThamSo($"--dinh-dang phải là bang hoặc json, nhận '{v}'");
                    dinhDang = v;
                    break;
                default:
                    int bang = v.IndexOf('=');
                    if (bang <= 0) throw new LoiThamSo($"--loc phải dạng khoa=gia_tri, nhận '{v}'");
                    loc.Add((v[..bang], v[(bang + 1)..]));
                    break;
            }
        }
        if (nhom is null) throw new LoiThamSo("thiếu --nhom-theo");
        return new ThamSo(nhom, tong, dinhDang == "json", loc);
    }

    private static string XuLy(ThamSo ts, TextReader vao)
    {
        var banGhi = DocCsv.Doc(vao);
        if (banGhi.Count == 0) throw new FormatException("dữ liệu rỗng (không có dòng tiêu đề)");
        var tieuDe = banGhi[0];
        int Cot(string ten)
        {
            int c = Array.IndexOf(tieuDe, ten);
            return c >= 0 ? c : throw new FormatException($"không có cột '{ten}'");
        }
        int cNhom = Cot(ts.CotNhom);
        int? cTong = ts.CotTong is null ? null : Cot(ts.CotTong);
        var cLoc = ts.Loc.Select(l => (Cot: Cot(l.Khoa), l.GiaTri)).ToList();

        var nhom = new Dictionary<string, (int SoDong, decimal Tong)>(StringComparer.Ordinal);
        for (int r = 1; r < banGhi.Count; r++)
        {
            var o = banGhi[r];
            if (o.Length != tieuDe.Length) throw new FormatException($"bản ghi {r + 1} có {o.Length} ô, tiêu đề có {tieuDe.Length}");
            if (!cLoc.All(l => o[l.Cot] == l.GiaTri)) continue;
            decimal giaTri = 0;
            if (cTong is int ct && o[ct].Length > 0
                && !decimal.TryParse(o[ct], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out giaTri))
                throw new FormatException($"bản ghi {r + 1}: '{o[ct]}' không phải số");
            var cu = nhom.GetValueOrDefault(o[cNhom]);
            nhom[o[cNhom]] = (cu.SoDong + 1, cu.Tong + giaTri);
        }
        var dong = nhom.OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => new DongTongHop(kv.Key, kv.Value.SoDong, ts.CotTong is null ? null : kv.Value.Tong))
            .ToList();
        return ts.Json ? XuatKetQua.Json(dong) : XuatKetQua.Bang(ts.CotNhom, ts.CotTong, dong);
    }

    public static int Chay(string[] args, TextReader vao, TextWriter ra, TextWriter loi)
    {
        ThamSo ts;
        try
        {
            ts = PhanTich(args);
        }
        catch (LoiThamSo e)
        {
            loi.Write("loi: " + e.Message + "\n");
            return 2;
        }
        string ketQua;
        try
        {
            ketQua = XuLy(ts, vao);
        }
        catch (FormatException e)
        {
            loi.Write("loi: " + e.Message.Replace('\n', ' ') + "\n");
            return 1;
        }
        ra.Write(ketQua);   // chỉ ghi khi đã thành công trọn vẹn
        return 0;
    }
}
