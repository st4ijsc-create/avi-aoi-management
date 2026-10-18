namespace Bai;

public sealed record KhachHang(int Ma, string Ten, string Vung);

public sealed record DonHang(int Ma, int MaKhach, DateOnly Ngay, string DanhMuc, decimal SoTien);

public sealed record DongDoanhSo(string Vung, string DanhMuc, int Nam, int Thang, int SoDon, decimal TongTien);

public sealed record TongKhach(int MaKhach, string Ten, int SoDon, decimal TongTien);

public sealed record LuyKeThang(int Thang, decimal TrongThang, decimal LuyKe);

public static class BaoCao
{
    public const string VungKhongRo = "(không rõ)";

    public static IReadOnlyList<DongDoanhSo> TheoVungDanhMucThang(IEnumerable<KhachHang> khach, IEnumerable<DonHang> don)
    {
        ArgumentNullException.ThrowIfNull(khach);
        ArgumentNullException.ThrowIfNull(don);
        var vungTheoMa = khach.ToDictionary(k => k.Ma, k => k.Vung);
        // OrderBy chuỗi mặc định so theo VĂN HOÁ — đặc tả đòi ordinal.
        return don
            .GroupBy(d => (Vung: vungTheoMa.GetValueOrDefault(d.MaKhach, VungKhongRo), d.DanhMuc, d.Ngay.Year, d.Ngay.Month))
            .Select(g => new DongDoanhSo(g.Key.Vung, g.Key.DanhMuc, g.Key.Year, g.Key.Month, g.Count(), g.Sum(d => d.SoTien)))
            .OrderBy(r => r.Vung, StringComparer.Ordinal)
            .ThenBy(r => r.DanhMuc, StringComparer.Ordinal)
            .ThenBy(r => r.Nam)
            .ThenBy(r => r.Thang)
            .ToList();
    }

    public static IReadOnlyList<TongKhach> TongTheoKhach(IEnumerable<KhachHang> khach, IEnumerable<DonHang> don)
    {
        ArgumentNullException.ThrowIfNull(khach);
        ArgumentNullException.ThrowIfNull(don);
        // left join: GroupJoin giữ khách không có đơn; đơn của khách lạ tự rơi
        return khach
            .GroupJoin(don, k => k.Ma, d => d.MaKhach,
                (k, ds) => new TongKhach(k.Ma, k.Ten, ds.Count(), ds.Sum(d => d.SoTien)))
            .OrderBy(t => t.MaKhach)
            .ToList();
    }

    public static IReadOnlyList<TongKhach> TopKhach(IEnumerable<KhachHang> khach, IEnumerable<DonHang> don, int n)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(n, 1);
        return TongTheoKhach(khach, don)
            .Where(t => t.SoDon > 0)
            .OrderByDescending(t => t.TongTien)
            .ThenByDescending(t => t.SoDon)
            .ThenBy(t => t.MaKhach)
            .Take(n)
            .ToList();
    }

    public static IReadOnlyList<LuyKeThang> LuyKeTheoThang(IEnumerable<DonHang> don, int nam)
    {
        ArgumentNullException.ThrowIfNull(don);
        var theoThang = don.Where(d => d.Ngay.Year == nam)
            .GroupBy(d => d.Ngay.Month)
            .ToDictionary(g => g.Key, g => g.Sum(d => d.SoTien));
        decimal luyKe = 0;
        return Enumerable.Range(1, 12)
            .Select(t =>
            {
                var trong = theoThang.GetValueOrDefault(t);
                luyKe += trong;
                return new LuyKeThang(t, trong, luyKe);
            })
            .ToList();
    }
}
