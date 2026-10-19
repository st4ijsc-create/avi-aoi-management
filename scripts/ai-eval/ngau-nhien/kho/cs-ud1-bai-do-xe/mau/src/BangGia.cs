namespace Bai;

public static class BangGia
{
    private sealed record Gia(long HaiGioDau, long MoiGioSau, long TranChuKy, long QuaDem, long MatVe);

    private static Gia Cua(LoaiXe loai) => loai switch
    {
        LoaiXe.XeDap => new Gia(2_000, 1_000, 10_000, 2_000, 20_000),
        LoaiXe.XeMay => new Gia(5_000, 2_000, 25_000, 5_000, 50_000),
        LoaiXe.OTo => new Gia(25_000, 15_000, 200_000, 50_000, 200_000),
        _ => throw new ArgumentOutOfRangeException(nameof(loai)),
    };

    private static readonly TimeSpan MienPhi = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan HaiGio = TimeSpan.FromHours(2);
    private static readonly TimeSpan ChuKy = TimeSpan.FromHours(24);
    private static readonly TimeSpan MuiGioVN = TimeSpan.FromHours(7);

    public static PhiGui TinhPhi(LoaiXe loai, DateTimeOffset vao, DateTimeOffset ra)
    {
        var g = Cua(loai);
        var thoiGian = ra - vao;   // DateTimeOffset trừ theo THỜI ĐIỂM, độc lập độ lệch
        if (thoiGian < TimeSpan.Zero) throw new ArgumentException("giờ ra trước giờ vào", nameof(ra));
        if (thoiGian < MienPhi) return new PhiGui(0, 0);

        long soChuKy = thoiGian.Ticks / ChuKy.Ticks;
        var du = thoiGian - TimeSpan.FromTicks(soChuKy * ChuKy.Ticks);
        long tien = soChuKy * g.TranChuKy;
        if (du > TimeSpan.Zero) tien += Math.Min(g.TranChuKy, PhiPhanDu(g, du));
        return new PhiGui(tien, DemQuaDem(vao, ra) * g.QuaDem);
    }

    private static long PhiPhanDu(Gia g, TimeSpan du)
    {
        if (du <= HaiGio) return g.HaiGioDau;
        long gioSau = ((du - HaiGio).Ticks + TimeSpan.TicksPerHour - 1) / TimeSpan.TicksPerHour;
        return g.HaiGioDau + gioSau * g.MoiGioSau;
    }

    /// <summary>Số mốc 02:00 giờ Việt Nam (UTC+7) t với vao &lt; t ≤ ra.</summary>
    private static long DemQuaDem(DateTimeOffset vao, DateTimeOffset ra)
    {
        var v = vao.ToOffset(MuiGioVN);
        var moc = new DateTimeOffset(v.Year, v.Month, v.Day, 2, 0, 0, MuiGioVN);
        if (moc <= vao) moc = moc.AddDays(1);
        if (moc > ra) return 0;
        return (ra - moc).Ticks / TimeSpan.TicksPerDay + 1;
    }

    public static long PhatMatVe(LoaiXe loai) => Cua(loai).MatVe;
}
