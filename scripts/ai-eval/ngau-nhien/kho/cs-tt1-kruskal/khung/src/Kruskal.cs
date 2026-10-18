namespace Bai;

public sealed record Canh(int U, int V, long TrongSo);

public sealed record KetQuaKhung(long TongTrongSo, IReadOnlyList<Canh> CacCanh, int SoThanhPhan);

/// <summary>Cấu trúc hợp-nhất (union-find) trên các phần tử 0..n-1.</summary>
public sealed class HopNhat
{
    public HopNhat(int n) => throw new NotImplementedException();

    public int SoTap => throw new NotImplementedException();

    public int Tim(int x) => throw new NotImplementedException();

    public bool Hop(int a, int b) => throw new NotImplementedException();
}

public static class Kruskal
{
    public static KetQuaKhung RungKhung(int soDinh, IEnumerable<Canh> canh) => throw new NotImplementedException();

    public static KetQuaKhung? CayKhung(int soDinh, IEnumerable<Canh> canh) => throw new NotImplementedException();
}
