namespace Bai;

public sealed record Canh(int U, int V, long TrongSo);

public sealed record KetQuaKhung(long TongTrongSo, IReadOnlyList<Canh> CacCanh, int SoThanhPhan);

/// <summary>Cấu trúc hợp-nhất (union-find) trên các phần tử 0..n-1.</summary>
public sealed class HopNhat
{
    private readonly int[] _cha;
    private readonly byte[] _hang;

    public HopNhat(int n)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(n);
        _cha = new int[n];
        _hang = new byte[n];
        for (int i = 0; i < n; i++) _cha[i] = i;
        SoTap = n;
    }

    public int SoTap { get; private set; }

    public int Tim(int x)
    {
        if ((uint)x >= (uint)_cha.Length) throw new ArgumentOutOfRangeException(nameof(x));
        int goc = x;
        while (_cha[goc] != goc) goc = _cha[goc];
        // nén đường: mọi nút trên đường đi trỏ thẳng về gốc (vòng lặp — không đệ quy sâu)
        while (_cha[x] != goc)
        {
            int ke = _cha[x];
            _cha[x] = goc;
            x = ke;
        }
        return goc;
    }

    public bool Hop(int a, int b)
    {
        int ra = Tim(a), rb = Tim(b);
        if (ra == rb) return false;
        if (_hang[ra] < _hang[rb]) (ra, rb) = (rb, ra);
        _cha[rb] = ra;
        if (_hang[ra] == _hang[rb]) _hang[ra]++;
        SoTap--;
        return true;
    }
}

public static class Kruskal
{
    public static KetQuaKhung RungKhung(int soDinh, IEnumerable<Canh> canh)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(soDinh);
        ArgumentNullException.ThrowIfNull(canh);
        var ds = canh.ToList();
        foreach (var c in ds)
        {
            ArgumentNullException.ThrowIfNull(c, nameof(canh));
            if ((uint)c.U >= (uint)soDinh || (uint)c.V >= (uint)soDinh)
                throw new ArgumentOutOfRangeException(nameof(canh), $"cạnh ({c.U},{c.V}) có đỉnh ngoài 0..{soDinh - 1}");
        }
        // OrderBy ổn định ⇒ khoá cuối là chỉ số gốc; List.Sort KHÔNG ổn định.
        var thuTu = ds.Select((c, i) => (c, i))
            .OrderBy(x => x.c.TrongSo)
            .ThenBy(x => Math.Min(x.c.U, x.c.V))
            .ThenBy(x => Math.Max(x.c.U, x.c.V))
            .ThenBy(x => x.i);
        var hn = new HopNhat(soDinh);
        var chon = new List<Canh>();
        long tong = 0;
        foreach (var (c, _) in thuTu)
        {
            if (hn.SoTap <= 1) break;
            if (c.U == c.V) continue;
            if (hn.Hop(c.U, c.V))
            {
                chon.Add(c);
                tong += c.TrongSo;
            }
        }
        return new KetQuaKhung(tong, chon, hn.SoTap);
    }

    public static KetQuaKhung? CayKhung(int soDinh, IEnumerable<Canh> canh)
    {
        var r = RungKhung(soDinh, canh);
        return r.SoThanhPhan == 1 ? r : null;
    }
}
