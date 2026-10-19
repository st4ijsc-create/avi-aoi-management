using Bai;

namespace KiemThu;

public class AnTests
{
    private static string[] Ma(IReadOnlyDictionary<char, string> bang, string kyTu) => kyTu.Select(c => bang[c]).ToArray();

    [Fact]
    public void HoaTanSuat_NutGopCoKyTuNhoHonThiDiTruoc()
    {
        // a1 b1 c2: gộp (a,b) thành nút khoá (2,'a') — nhỏ hơn lá (2,'c') ⇒ nằm bên trái
        var bang = Huffman.TaoBangMa("abcc");
        Assert.Equal(new[] { "00", "01", "1" }, Ma(bang, "abc"));
    }

    [Fact]
    public void HoaTanSuat_LaCoKyTuNhoHonThiDiTruoc()
    {
        // b1 c1 a2: gộp (b,c) thành (2,'b'); lá (2,'a') nhỏ hơn ⇒ a bên trái
        var bang = Huffman.TaoBangMa("bcaa");
        Assert.Equal(new[] { "0", "10", "11" }, Ma(bang, "abc"));
    }

    [Fact]
    public void KhoaNutGopLaKyTuNhoNhatCuaCaCayCon()
    {
        // c1 a2 b3: lấy (1,'c') rồi (2,'a') ⇒ nút (3,'a'), hoà tần suất với lá (3,'b') và đứng trước nó
        var bang = Huffman.TaoBangMa("cabbab");
        Assert.Equal(new[] { "00", "01", "1" }, Ma(bang, "cab"));
        Assert.Equal("000111011", Huffman.MaHoa("cabbab", bang));
    }

    [Fact]
    public void ChuoiRong()
    {
        var bang = Huffman.TaoBangMa("");
        Assert.Empty(bang);
        Assert.Equal("", Huffman.MaHoa("", bang));
        Assert.Equal("", Huffman.GiaiMa("", bang));
        Assert.Throws<FormatException>(() => Huffman.GiaiMa("0", bang));
    }

    [Fact]
    public void MotKyTuLapLaiGiaiMaVaBitThua()
    {
        var bang = Huffman.TaoBangMa("zzz");
        Assert.Equal("0", Assert.Single(bang).Value);
        Assert.Equal("000", Huffman.MaHoa("zzz", bang));
        Assert.Equal("zzz", Huffman.GiaiMa("000", bang));
        Assert.Throws<FormatException>(() => Huffman.GiaiMa("01", bang));
        Assert.Throws<FormatException>(() => Huffman.GiaiMa("1", bang));
    }

    [Fact]
    public void KyTuTiengVietSoTheoMaUtf16()
    {
        // 'a' (U+0061) < 'z' (U+007A) < 'đ' (U+0111)
        var bang = Huffman.TaoBangMa("đđaz");
        Assert.Equal(new[] { "00", "01", "1" }, Ma(bang, "azđ"));
        const string s = "Đường xa – nắng gắt, đường dài; Đà Nẵng ở đâu?";
        var b2 = Huffman.TaoBangMa(s);
        Assert.Equal(s, Huffman.GiaiMa(Huffman.MaHoa(s, b2), b2));
    }

    [Fact]
    public void MaHoaKyTuNgoaiBangNemArgumentException()
    {
        var bang = Huffman.TaoBangMa("ab");
        Assert.Throws<ArgumentException>(() => Huffman.MaHoa("abc", bang));
    }

    [Fact]
    public void GiaiMaBitHongNemFormatException()
    {
        var bang = Huffman.TaoBangMa("abcd");
        Assert.Throws<FormatException>(() => Huffman.GiaiMa("0120", bang));
        Assert.Throws<FormatException>(() => Huffman.GiaiMa("00 01", bang));
        Assert.Throws<FormatException>(() => Huffman.GiaiMa("001", bang));
    }

    [Fact]
    public void GiaiMaVoiBangTienToTuyY()
    {
        var bang = new Dictionary<char, string> { ['x'] = "1", ['y'] = "01", ['z'] = "001" };
        Assert.Equal("zyx", Huffman.GiaiMa("001011", bang));
        Assert.Equal("xxzy", Huffman.GiaiMa("1100101", bang));
        Assert.Throws<FormatException>(() => Huffman.GiaiMa("000", bang));
    }

    [Fact]
    public void BangKhongHopLeNemArgumentException()
    {
        Assert.Throws<ArgumentException>(() => Huffman.GiaiMa("0", new Dictionary<char, string> { ['a'] = "0", ['b'] = "01" }));
        Assert.Throws<ArgumentException>(() => Huffman.GiaiMa("0", new Dictionary<char, string> { ['a'] = "01", ['b'] = "0" }));
        Assert.Throws<ArgumentException>(() => Huffman.GiaiMa("0", new Dictionary<char, string> { ['a'] = "0", ['b'] = "0" }));
        Assert.Throws<ArgumentException>(() => Huffman.GiaiMa("", new Dictionary<char, string> { ['a'] = "" }));
        Assert.Throws<ArgumentException>(() => Huffman.GiaiMa("0", new Dictionary<char, string> { ['a'] = "0", ['b'] = "12" }));
    }

    [Fact]
    public void VanBanLonToiUuVaTienTo()
    {
        // văn bản tất định, phân bố lệch, 40 ký hiệu
        var bangChu = "abcdefghijklmnopqrstuvwxyzăâđêôơưáàảãạéí".ToCharArray();
        var sb = new System.Text.StringBuilder();
        uint x = 12345;
        for (int i = 0; i < 60_000; i++)
        {
            x = x * 1103515245 + 12345;
            int r = (int)((x >> 8) % 1000);
            int k = r < 500 ? r % 3 : r < 800 ? 3 + r % 7 : 10 + r % 30;
            sb.Append(bangChu[k]);
        }
        var s = sb.ToString();
        var bang = Huffman.TaoBangMa(s);
        Assert.Equal(s.Distinct().Count(), bang.Count);
        var ma = bang.Values.ToList();
        foreach (var m1 in ma)
            foreach (var m2 in ma)
                if (!ReferenceEquals(m1, m2)) Assert.False(m2.StartsWith(m1, StringComparison.Ordinal), $"{m1} là tiền tố của {m2}");

        // chi phí tối ưu tính độc lập: tổng các lần gộp hai tần suất nhỏ nhất
        var tanSuat = s.GroupBy(c => c).Select(g => (long)g.Count()).ToList();
        long chiPhi = 0;
        while (tanSuat.Count > 1)
        {
            tanSuat.Sort();
            long gop = tanSuat[0] + tanSuat[1];
            chiPhi += gop;
            tanSuat.RemoveRange(0, 2);
            tanSuat.Add(gop);
        }
        var bit = Huffman.MaHoa(s, bang);
        Assert.Equal(chiPhi, bit.Length);
        Assert.Equal(s, Huffman.GiaiMa(bit, bang));
    }
}
