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
            throw new XungDotLichException(maPhong, new[] { batDau });
        }
        var datCho = new DatCho(Guid.NewGuid(), maPhong, batDau, ketThuc, nguoiDat);
        _kho.Them(datCho);
        return datCho;
    }

    /// <summary>Đặt lặp lại hằng tuần, tất cả hoặc không.</summary>
    public IReadOnlyList<DatCho> DatLapLai(string maPhong, DateTime batDau, DateTime ketThuc, string nguoiDat, int soTuan)
    {
        if (soTuan < 1 || soTuan > 52) throw new ArgumentOutOfRangeException(nameof(soTuan), "soTuan phải từ 1 đến 52");
        KiemTra(maPhong, batDau, ketThuc, nguoiDat);
        var hienCo = _kho.TheoPhong(maPhong);
        var maChuoi = Guid.NewGuid().ToString("N");
        var ketQua = new List<DatCho>();
        var xungDot = new List<DateTime>();
        for (var k = 0; k < soTuan; k++)
        {
            var bd = batDau.AddDays(7 * k);
            var kt = ketThuc.AddDays(7 * k);
            if (hienCo.Any(d => d.TrungVoi(bd, kt))) xungDot.Add(bd);
            ketQua.Add(new DatCho(Guid.NewGuid(), maPhong, bd, kt, nguoiDat, maChuoi));
        }
        if (xungDot.Count > 0) throw new XungDotLichException(maPhong, xungDot);
        foreach (var d in ketQua) _kho.Them(d);
        return ketQua;
    }

    public bool Huy(Guid id) => _kho.Xoa(id);

    public int HuyChuoi(string maChuoi)
    {
        var dem = 0;
        foreach (var d in _kho.TatCa().Where(d => d.MaChuoi == maChuoi).ToList())
        {
            if (_kho.Xoa(d.Id)) dem++;
        }
        return dem;
    }

    public IReadOnlyList<DatCho> LichPhong(string maPhong, DateOnly ngay) =>
        _kho.TheoPhong(maPhong).Where(d => DateOnly.FromDateTime(d.BatDau) == ngay).ToList();

    private void KiemTra(string maPhong, DateTime batDau, DateTime ketThuc, string nguoiDat)
    {
        if (!_phong.ContainsKey(maPhong)) throw new KeyNotFoundException($"Không có phòng {maPhong}");
        if (ketThuc <= batDau) throw new ArgumentException("Giờ kết thúc phải sau giờ bắt đầu");
        if (string.IsNullOrWhiteSpace(nguoiDat)) throw new ArgumentException("Thiếu người đặt");
    }
}
