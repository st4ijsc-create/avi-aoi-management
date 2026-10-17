namespace KhoHang;

/// <summary>Kho hàng một điểm: danh mục sản phẩm + tồn theo LÔ (xuất FEFO — hạn dùng sớm nhất trước).</summary>
public class Kho
{
    public const string LoMacDinh = "MAC_DINH";

    private readonly Dictionary<string, SanPham> _sanPham = new();
    private readonly Dictionary<string, List<LoHang>> _lo = new();

    public void ThemSanPham(SanPham sp)
    {
        if (_sanPham.ContainsKey(sp.Ma)) throw new InvalidOperationException($"Trùng mã sản phẩm: {sp.Ma}");
        _sanPham[sp.Ma] = sp;
        _lo[sp.Ma] = new List<LoHang>();
    }

    public void Nhap(string ma, int soLuong) => Nhap(ma, soLuong, LoMacDinh, DateOnly.MaxValue);

    public void Nhap(string ma, int soLuong, string maLo, DateOnly hanDung)
    {
        KiemTraMa(ma);
        if (soLuong <= 0) throw new ArgumentOutOfRangeException(nameof(soLuong), "Số lượng phải > 0");
        var ds = _lo[ma];
        var i = ds.FindIndex(l => l.MaLo == maLo);
        if (i < 0)
        {
            ds.Add(new LoHang(maLo, soLuong, hanDung));
            return;
        }
        if (ds[i].HanDung != hanDung) throw new InvalidOperationException($"Lô {maLo} đã có hạn dùng khác");
        ds[i] = ds[i] with { SoLuong = ds[i].SoLuong + soLuong };
    }

    public void Xuat(string ma, int soLuong) => XuatTheoLo(ma, soLuong);

    public IReadOnlyList<LoHang> XuatTheoLo(string ma, int soLuong)
    {
        KiemTraMa(ma);
        if (soLuong <= 0) throw new ArgumentOutOfRangeException(nameof(soLuong), "Số lượng phải > 0");
        var ton = TonKho(ma);
        if (ton < soLuong) throw new InvalidOperationException($"Không đủ hàng {ma}: còn {ton}, cần {soLuong}");
        var ra = new List<LoHang>();
        var con = soLuong;
        foreach (var lo in SapFefo(_lo[ma]))
        {
            if (con == 0) break;
            var lay = Math.Min(con, lo.SoLuong);
            ra.Add(lo with { SoLuong = lay });
            con -= lay;
            var i = _lo[ma].FindIndex(l => l.MaLo == lo.MaLo);
            if (lo.SoLuong == lay) _lo[ma].RemoveAt(i);
            else _lo[ma][i] = lo with { SoLuong = lo.SoLuong - lay };
        }
        return ra;
    }

    public IReadOnlyList<LoHang> DanhSachLo(string ma)
    {
        KiemTraMa(ma);
        return SapFefo(_lo[ma]).Where(l => l.SoLuong > 0).ToList();
    }

    public IReadOnlyList<(string Ma, LoHang Lo)> LoSapHetHan(DateOnly homNay, int soNgay)
    {
        var moc = homNay.AddDays(soNgay);
        return _lo
            .SelectMany(kv => kv.Value.Where(l => l.SoLuong > 0 && l.HanDung <= moc).Select(l => (Ma: kv.Key, Lo: l)))
            .OrderBy(x => x.Lo.HanDung)
            .ThenBy(x => x.Ma, StringComparer.Ordinal)
            .ThenBy(x => x.Lo.MaLo, StringComparer.Ordinal)
            .ToList();
    }

    public int TonKho(string ma)
    {
        KiemTraMa(ma);
        return _lo[ma].Sum(l => l.SoLuong);
    }

    public decimal TongGiaTri() => _lo.Sum(kv => kv.Value.Sum(l => l.SoLuong) * _sanPham[kv.Key].DonGia);

    private static List<LoHang> SapFefo(IEnumerable<LoHang> ds) =>
        ds.OrderBy(l => l.HanDung).ThenBy(l => l.MaLo, StringComparer.Ordinal).ToList();

    private void KiemTraMa(string ma)
    {
        if (!_sanPham.ContainsKey(ma)) throw new KeyNotFoundException($"Không có sản phẩm: {ma}");
    }
}
