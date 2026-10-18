namespace DatPhong;

public sealed class KhoDatChoBoNho : IKhoDatCho
{
    private readonly List<DatCho> _ds = new();

    public void Them(DatCho datCho) => _ds.Add(datCho);

    public bool Xoa(Guid id) => _ds.RemoveAll(d => d.Id == id) > 0;

    public IReadOnlyList<DatCho> TheoPhong(string maPhong) =>
        _ds.Where(d => d.MaPhong == maPhong).OrderBy(d => d.BatDau).ToList();

    public IReadOnlyList<DatCho> TatCa() => _ds.OrderBy(d => d.BatDau).ToList();
}
