using Bai;

namespace KiemThu;

public class HienThiTests
{
    [Fact]
    public void BangMaVaMaHoaTanSuatKhacNhau()
    {
        var bang = Huffman.TaoBangMa("aaaabbc");
        Assert.Equal(3, bang.Count);
        Assert.Equal("1", bang['a']);
        Assert.Equal("01", bang['b']);
        Assert.Equal("00", bang['c']);
        Assert.Equal("1111010100", Huffman.MaHoa("aaaabbc", bang));
    }

    [Fact]
    public void BonKyTuCungTanSuatVaKhuHoi()
    {
        var bang = Huffman.TaoBangMa("abcd");
        Assert.Equal(new[] { "00", "01", "10", "11" }, new[] { bang['a'], bang['b'], bang['c'], bang['d'] });
        var bit = Huffman.MaHoa("dcba", bang);
        Assert.Equal("11100100", bit);
        Assert.Equal("dcba", Huffman.GiaiMa(bit, bang));
    }

    [Fact]
    public void MotKyTuCoMaLaKhong()
    {
        var bang = Huffman.TaoBangMa("x");
        Assert.Single(bang);
        Assert.Equal("0", bang['x']);
        Assert.Equal("00", Huffman.MaHoa("xx", bang));
    }
}
