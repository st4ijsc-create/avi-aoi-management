namespace Bai;

public sealed class BaiDoXe
{
    private readonly Dictionary<LoaiXe, int> _sucChua = new();
    private readonly Dictionary<LoaiXe, int> _dangGui = new();
    private readonly Dictionary<string, Ve> _veTheoMa = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Ve> _veTheoBien = new(StringComparer.Ordinal);
    private readonly TimeProvider _dongHo;
    private int _soVe;

    public BaiDoXe(IReadOnlyDictionary<LoaiXe, int> sucChua, TimeProvider dongHo)
    {
        ArgumentNullException.ThrowIfNull(sucChua);
        ArgumentNullException.ThrowIfNull(dongHo);
        foreach (var (loai, so) in sucChua)
        {
            ArgumentOutOfRangeException.ThrowIfNegative(so, nameof(sucChua));
            _sucChua[loai] = so;
        }
        _dongHo = dongHo;
    }

    private static string ChuanHoa(string bienSo)
    {
        if (string.IsNullOrWhiteSpace(bienSo)) throw new ArgumentException("biển số trống", nameof(bienSo));
        return bienSo.Trim().ToUpperInvariant();
    }

    public Ve Vao(LoaiXe loai, string bienSo)
    {
        var bien = ChuanHoa(bienSo);
        if (_veTheoBien.ContainsKey(bien)) throw new InvalidOperationException($"xe {bien} đang ở trong bãi");
        if (ConTrong(loai) <= 0) throw new BaiDayException(loai);
        var ve = new Ve($"V{++_soVe:D6}", bien, loai, _dongHo.GetUtcNow());
        _veTheoMa[ve.MaVe] = ve;
        _veTheoBien[bien] = ve;
        _dangGui[loai] = _dangGui.GetValueOrDefault(loai) + 1;
        return ve;
    }

    public HoaDonGui Ra(string maVe)
    {
        if (maVe is null || !_veTheoMa.TryGetValue(maVe, out var ve)) throw new VeKhongHopLeException($"vé {maVe} không hợp lệ");
        return XuatHoaDon(ve, 0);
    }

    public HoaDonGui RaMatVe(string bienSo)
    {
        var bien = ChuanHoa(bienSo);
        if (!_veTheoBien.TryGetValue(bien, out var ve)) throw new VeKhongHopLeException($"không có xe {bien} trong bãi");
        return XuatHoaDon(ve, BangGia.PhatMatVe(ve.Loai));
    }

    private HoaDonGui XuatHoaDon(Ve ve, long phat)
    {
        var ra = _dongHo.GetUtcNow();
        var phi = BangGia.TinhPhi(ve.Loai, ve.Vao, ra);
        _veTheoMa.Remove(ve.MaVe);
        _veTheoBien.Remove(ve.BienSo);
        _dangGui[ve.Loai]--;
        return new HoaDonGui(ve.MaVe, ve.BienSo, ve.Loai, ve.Vao, ra, phi.TienGio, phi.PhuPhiDem, phat);
    }

    public int ConTrong(LoaiXe loai) => _sucChua.GetValueOrDefault(loai) - _dangGui.GetValueOrDefault(loai);
}
