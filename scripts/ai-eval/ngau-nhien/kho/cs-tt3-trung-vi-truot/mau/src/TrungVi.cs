namespace Bai;

public static class TrungVi
{
    /// <summary>
    /// Hai tập có thứ tự: <c>duoi</c> giữ nửa nhỏ (Count = ⌈k/2⌉), <c>tren</c> giữ nửa lớn. Phần tử là (giá trị, chỉ số)
    /// để giá trị trùng nhau vẫn là các phần tử phân biệt. Mỗi bước trượt O(log k).
    /// </summary>
    public static double[] TrungViTruot(int[] a, int k)
    {
        ArgumentNullException.ThrowIfNull(a);
        if (k < 1 || k > a.Length) throw new ArgumentOutOfRangeException(nameof(k), $"k phải trong 1..{a.Length}");
        var duoi = new SortedSet<(int GiaTri, int ViTri)>();
        var tren = new SortedSet<(int GiaTri, int ViTri)>();
        var kq = new double[a.Length - k + 1];

        void CanBang()
        {
            while (duoi.Count > tren.Count + 1)
            {
                var m = duoi.Max;
                duoi.Remove(m);
                tren.Add(m);
            }
            while (tren.Count > duoi.Count)
            {
                var m = tren.Min;
                tren.Remove(m);
                duoi.Add(m);
            }
        }

        void Them((int, int) x)
        {
            if (duoi.Count == 0 || x.CompareTo(duoi.Max) <= 0) duoi.Add(x);
            else tren.Add(x);
            CanBang();
        }

        void Bot((int, int) x)
        {
            if (!duoi.Remove(x)) tren.Remove(x);
            CanBang();
        }

        double LayTrungVi()
        {
            if (k % 2 == 1) return duoi.Max.GiaTri;
            int giuaTrai = duoi.Max.GiaTri, giuaPhai = tren.Min.GiaTri;
            return ((long)giuaTrai + giuaPhai) / 2.0;
        }

        for (int i = 0; i < a.Length; i++)
        {
            Them((a[i], i));
            if (i >= k) Bot((a[i - k], i - k));
            if (i >= k - 1) kq[i - k + 1] = LayTrungVi();
        }
        return kq;
    }
}
