namespace DatPhong;

public sealed class DichVuDatPhong
{
    private readonly IKhoDatCho _kho;
    private readonly Dictionary<string, PhongHop> _phong;

    public DichVuDatPhong(IKhoDatCho kho, IEnumerable<PhongHop> phong)
    {
        _kho = kho;
        _phong = phong.ToDictionary(p => p.Ma);
    }

    public DatCho Dat(string maPhong, DateTime batDau, DateTime ketThuc, string nguoiDat)
    {
        KiemTra(maPhong, batDau, ketThuc, nguoiDat);
        if (_kho.TheoPhong(maPhong).Any(d => d.TrungVoi(batDau, ketThuc)))
        {
            throw new InvalidOperationException($"Phòng {maPhong} đã có người đặt lúc {batDau:yyyy-MM-dd HH:mm}");
        }
        var datCho = new DatCho(Guid.NewGuid(), maPhong, batDau, ketThuc, nguoiDat);
        _kho.Them(datCho);
        return datCho;
    }

    public bool Huy(Guid id) => _kho.Xoa(id);

    public IReadOnlyList<DatCho> LichPhong(string maPhong, DateOnly ngay) =>
        _kho.TheoPhong(maPhong).Where(d => DateOnly.FromDateTime(d.BatDau) == ngay).ToList();

    private void KiemTra(string maPhong, DateTime batDau, DateTime ketThuc, string nguoiDat)
    {
        if (!_phong.ContainsKey(maPhong)) throw new KeyNotFoundException($"Không có phòng {maPhong}");
        if (ketThuc <= batDau) throw new ArgumentException("Giờ kết thúc phải sau giờ bắt đầu");
        if (string.IsNullOrWhiteSpace(nguoiDat)) throw new ArgumentException("Thiếu người đặt");
    }
}
