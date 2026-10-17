namespace KhoHang;

/// <summary>Kho hàng một điểm: danh mục sản phẩm + số tồn.</summary>
public class Kho
{
    private readonly Dictionary<string, SanPham> _sanPham = new();
    private readonly Dictionary<string, int> _ton = new();

    public void ThemSanPham(SanPham sp)
    {
        if (_sanPham.ContainsKey(sp.Ma)) throw new InvalidOperationException($"Trùng mã sản phẩm: {sp.Ma}");
        _sanPham[sp.Ma] = sp;
        _ton[sp.Ma] = 0;
    }

    public void Nhap(string ma, int soLuong)
    {
        KiemTraMa(ma);
        _ton[ma] += soLuong;
    }

    public void Xuat(string ma, int soLuong)
    {
        KiemTraMa(ma);
        _ton[ma] -= soLuong;
    }

    public int TonKho(string ma)
    {
        KiemTraMa(ma);
        return _ton[ma];
    }

    public decimal TongGiaTri() => _ton.Sum(kv => kv.Value * _sanPham[kv.Key].DonGia);

    private void KiemTraMa(string ma)
    {
        if (!_sanPham.ContainsKey(ma)) throw new KeyNotFoundException($"Không có sản phẩm: {ma}");
    }
}
