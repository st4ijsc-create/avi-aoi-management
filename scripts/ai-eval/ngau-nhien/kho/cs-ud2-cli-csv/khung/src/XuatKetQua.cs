namespace Bai;

public sealed record DongTongHop(string Nhom, int SoDong, decimal? Tong);

public static class XuatKetQua
{
    public static string Bang(string cotNhom, string? cotTong, IReadOnlyList<DongTongHop> dong) => throw new NotImplementedException();

    public static string Json(IReadOnlyList<DongTongHop> dong) => throw new NotImplementedException();
}
