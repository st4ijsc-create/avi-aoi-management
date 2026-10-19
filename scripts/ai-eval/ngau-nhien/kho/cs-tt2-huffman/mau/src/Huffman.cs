using System.Text;

namespace Bai;

public static class Huffman
{
    private sealed class Nut
    {
        public long TanSuat;
        public char KyTuNho;   // ký tự nhỏ nhất (thứ tự mã UTF-16) trong cây con
        public char? La;       // khác null ⇔ nút lá
        public Nut? Trai, Phai;
    }

    private sealed class SoSanhKhoa : IComparer<(long TanSuat, char KyTu)>
    {
        public int Compare((long TanSuat, char KyTu) x, (long TanSuat, char KyTu) y)
        {
            int c = x.TanSuat.CompareTo(y.TanSuat);
            return c != 0 ? c : x.KyTu.CompareTo(y.KyTu);
        }
    }

    public static IReadOnlyDictionary<char, string> TaoBangMa(string vanBan)
    {
        ArgumentNullException.ThrowIfNull(vanBan);
        var dem = new Dictionary<char, long>();
        foreach (var ch in vanBan) dem[ch] = dem.GetValueOrDefault(ch) + 1;
        var bang = new Dictionary<char, string>();
        if (dem.Count == 0) return bang;
        if (dem.Count == 1)
        {
            bang[dem.Keys.First()] = "0";
            return bang;
        }
        var hang = new PriorityQueue<Nut, (long, char)>(new SoSanhKhoa());
        foreach (var (ch, f) in dem) hang.Enqueue(new Nut { TanSuat = f, KyTuNho = ch, La = ch }, (f, ch));
        while (hang.Count > 1)
        {
            var trai = hang.Dequeue();
            var phai = hang.Dequeue();
            var cha = new Nut
            {
                TanSuat = trai.TanSuat + phai.TanSuat,
                KyTuNho = (char)Math.Min(trai.KyTuNho, phai.KyTuNho),
                Trai = trai,
                Phai = phai,
            };
            hang.Enqueue(cha, (cha.TanSuat, cha.KyTuNho));
        }
        // duyệt bằng ngăn xếp (cây có thể sâu tới số ký tự khác nhau)
        var ngan = new Stack<(Nut, string)>();
        ngan.Push((hang.Dequeue(), ""));
        while (ngan.Count > 0)
        {
            var (n, ma) = ngan.Pop();
            if (n.La is char c) bang[c] = ma;
            else
            {
                ngan.Push((n.Trai!, ma + "0"));
                ngan.Push((n.Phai!, ma + "1"));
            }
        }
        return bang;
    }

    public static string MaHoa(string vanBan, IReadOnlyDictionary<char, string> bang)
    {
        ArgumentNullException.ThrowIfNull(vanBan);
        ArgumentNullException.ThrowIfNull(bang);
        var sb = new StringBuilder();
        foreach (var ch in vanBan)
        {
            if (!bang.TryGetValue(ch, out var ma)) throw new ArgumentException($"ký tự U+{(int)ch:X4} không có trong bảng mã", nameof(vanBan));
            sb.Append(ma);
        }
        return sb.ToString();
    }

    private sealed class NutTrie
    {
        public NutTrie? Khong, Mot;
        public char? KyTu;
    }

    public static string GiaiMa(string bit, IReadOnlyDictionary<char, string> bang)
    {
        ArgumentNullException.ThrowIfNull(bit);
        ArgumentNullException.ThrowIfNull(bang);
        var goc = new NutTrie();
        foreach (var (ch, ma) in bang)
        {
            if (string.IsNullOrEmpty(ma)) throw new ArgumentException("mã rỗng", nameof(bang));
            var n = goc;
            foreach (var b in ma)
            {
                if (b != '0' && b != '1') throw new ArgumentException($"mã của '{ch}' chứa ký tự khác 0/1", nameof(bang));
                if (n.KyTu is not null) throw new ArgumentException("bảng mã không phải mã tiền tố", nameof(bang));
                n = b == '0' ? (n.Khong ??= new NutTrie()) : (n.Mot ??= new NutTrie());
            }
            if (n.KyTu is not null || n.Khong is not null || n.Mot is not null)
                throw new ArgumentException("bảng mã không phải mã tiền tố", nameof(bang));
            n.KyTu = ch;
        }
        var sb = new StringBuilder();
        var hienTai = goc;
        for (int i = 0; i < bit.Length; i++)
        {
            var b = bit[i];
            if (b != '0' && b != '1') throw new FormatException($"ký tự không phải bit ở vị trí {i}");
            hienTai = b == '0' ? hienTai.Khong : hienTai.Mot;
            if (hienTai is null) throw new FormatException($"dãy bit không khớp mã nào tại vị trí {i}");
            if (hienTai.KyTu is char c)
            {
                sb.Append(c);
                hienTai = goc;
            }
        }
        if (!ReferenceEquals(hienTai, goc)) throw new FormatException("dãy bit dừng giữa chừng một mã");
        return sb.ToString();
    }
}
