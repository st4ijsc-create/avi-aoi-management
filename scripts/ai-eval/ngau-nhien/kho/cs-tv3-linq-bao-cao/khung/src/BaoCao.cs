namespace Bai;

public sealed record KhachHang(int Ma, string Ten, string Vung);

public sealed record DonHang(int Ma, int MaKhach, DateOnly Ngay, string DanhMuc, decimal SoTien);

public sealed record DongDoanhSo(string Vung, string DanhMuc, int Nam, int Thang, int SoDon, decimal TongTien);

public sealed record TongKhach(int MaKhach, string Ten, int SoDon, decimal TongTien);

public sealed record LuyKeThang(int Thang, decimal TrongThang, decimal LuyKe);

public static class BaoCao
{
    public static IReadOnlyList<DongDoanhSo> TheoVungDanhMucThang(IEnumerable<KhachHang> khach, IEnumerable<DonHang> don) =>
        throw new NotImplementedException();

    public static IReadOnlyList<TongKhach> TongTheoKhach(IEnumerable<KhachHang> khach, IEnumerable<DonHang> don) =>
        throw new NotImplementedException();

    public static IReadOnlyList<TongKhach> TopKhach(IEnumerable<KhachHang> khach, IEnumerable<DonHang> don, int n) =>
        throw new NotImplementedException();

    public static IReadOnlyList<LuyKeThang> LuyKeTheoThang(IEnumerable<DonHang> don, int nam) =>
        throw new NotImplementedException();
}
