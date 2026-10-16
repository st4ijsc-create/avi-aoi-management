namespace DatPhong;

/// <summary>Một lượt đặt phòng, khoảng thời gian nửa mở [BatDau, KetThuc).</summary>
public sealed record DatCho(Guid Id, string MaPhong, DateTime BatDau, DateTime KetThuc, string NguoiDat, string? MaChuoi = null)
{
    public bool TrungVoi(DateTime batDau, DateTime ketThuc) => BatDau < ketThuc && batDau < KetThuc;
}
