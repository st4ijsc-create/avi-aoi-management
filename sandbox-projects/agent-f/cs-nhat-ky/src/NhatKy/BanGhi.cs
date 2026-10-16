namespace NhatKy;

public sealed record BanGhi(DateTime ThoiGian, MucDo MucDo, string Nguon, string NoiDung);

public sealed record KetQuaPhanTich(IReadOnlyList<BanGhi> BanGhi, int SoDongBoQua);
