namespace NhatKy;

public static class ThongKe
{
    /// <summary>Đếm theo mức; mọi mức đều có khoá (kể cả 0).</summary>
    public static Dictionary<MucDo, int> DemTheoMucDo(IEnumerable<BanGhi> banGhi)
    {
        var dem = Enum.GetValues<MucDo>().ToDictionary(m => m, _ => 0);
        foreach (var bg in banGhi) dem[bg.MucDo]++;
        return dem;
    }

    /// <summary>Tỉ lệ bản ghi lỗi (Error + Fatal) trên tổng (0 nếu rỗng).</summary>
    public static double TyLeLoi(IReadOnlyCollection<BanGhi> banGhi)
    {
        if (banGhi.Count == 0) return 0;
        return (double)banGhi.Count(b => b.MucDo is MucDo.Error or MucDo.Fatal) / banGhi.Count;
    }
}
