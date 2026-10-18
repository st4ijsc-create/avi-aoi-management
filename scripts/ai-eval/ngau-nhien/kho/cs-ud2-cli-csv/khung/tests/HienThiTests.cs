using Bai;

namespace KiemThu;

public class HienThiTests
{
    private static (int Ma, string Ra, string Loi) Goi(string csv, params string[] args)
    {
        var ra = new StringWriter();
        var loi = new StringWriter();
        int ma = UngDung.Chay(args, new StringReader(csv), ra, loi);
        return (ma, ra.ToString(), loi.ToString());
    }

    [Fact]
    public void BangCoTong()
    {
        var (ma, ra, loi) = Goi("vung,tien\nBac,10.5\nNam,3\nBac,20\n", "--nhom-theo", "vung", "--tong", "tien");
        Assert.Equal(0, ma);
        Assert.Equal("", loi);
        Assert.Equal(
            "vung | so_dong | tong_tien\n" +
            "-----+---------+----------\n" +
            "Bac  |       2 |      30.5\n" +
            "Nam  |       1 |         3\n", ra);
    }

    [Fact]
    public void JsonChiDemDong()
    {
        var (ma, ra, _) = Goi("loai,ten\nA,x\nB,y\nA,z\n", "--dinh-dang", "json", "--nhom-theo", "loai");
        Assert.Equal(0, ma);
        Assert.Equal("[{\"nhom\":\"A\",\"so_dong\":2},{\"nhom\":\"B\",\"so_dong\":1}]\n", ra);
    }

    [Fact]
    public void ThieuNhomTheoLaLoiThamSo()
    {
        var (ma, ra, loi) = Goi("a\n1\n", "--dinh-dang", "json");
        Assert.Equal(2, ma);
        Assert.Equal("", ra);
        Assert.StartsWith("loi: ", loi);
    }
}
