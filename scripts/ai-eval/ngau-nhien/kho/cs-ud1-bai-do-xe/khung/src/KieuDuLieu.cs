namespace Bai;

public enum LoaiXe { XeDap, XeMay, OTo }

/// <summary>Vé phát khi xe vào. <c>BienSo</c> đã chuẩn hoá; <c>Vao</c> là thời điểm lấy từ đồng hồ.</summary>
public sealed record Ve(string MaVe, string BienSo, LoaiXe Loai, DateTimeOffset Vao);

/// <summary>Phí gửi theo bảng giá (chưa gồm phạt mất vé).</summary>
public sealed record PhiGui(long TienGio, long PhuPhiDem);

public sealed record HoaDonGui(
    string MaVe, string BienSo, LoaiXe Loai, DateTimeOffset Vao, DateTimeOffset Ra,
    long TienGio, long PhuPhiDem, long PhatMatVe)
{
    public long Tong => TienGio + PhuPhiDem + PhatMatVe;
}

public sealed class BaiDayException(LoaiXe loai) : Exception($"hết chỗ cho {loai}")
{
    public LoaiXe Loai { get; } = loai;
}

public sealed class VeKhongHopLeException(string thongDiep) : Exception(thongDiep);
