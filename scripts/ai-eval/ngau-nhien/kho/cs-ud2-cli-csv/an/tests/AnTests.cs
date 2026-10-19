using Bai;

namespace KiemThu;

public class AnTests
{
    private static (int Ma, string Ra, string Loi) Goi(string csv, params string[] args)
    {
        var ra = new StringWriter();
        var loi = new StringWriter();
        int ma = UngDung.Chay(args, new StringReader(csv), ra, loi);
        return (ma, ra.ToString(), loi.ToString());
    }

    private static string[][] Doc(string csv) => DocCsv.Doc(new StringReader(csv)).ToArray();

    [Fact]
    public void CsvONhayChuaPhayXuongDongVaNhayKep()
    {
        var r = Doc("a,b\n\"x, y\",\"dòng 1\ndòng 2\"\n\"he said \"\"hi\"\"\",\n");
        Assert.Equal(new[]
        {
            new[] { "a", "b" },
            new[] { "x, y", "dòng 1\ndòng 2" },
            new[] { "he said \"hi\"", "" },
        }, r);
    }

    [Fact]
    public void CsvCrlfDongTrongVaKhongXuongDongCuoi()
    {
        var r = Doc("a,b\r\n\r\n1,2\r\n\n3,\"4\r\n5\"");
        Assert.Equal(new[] { new[] { "a", "b" }, new[] { "1", "2" }, new[] { "3", "4\r\n5" } }, r);
    }

    [Fact]
    public void CsvNhayGiuaOLaKyTuThuong_LoiDinhDang()
    {
        Assert.Equal(new[] { new[] { "ab\"c", "d" }, new[] { "" }, new[] { "", "" } }, Doc("ab\"c,d\n\"\"\n,\n"));
        Assert.Throws<FormatException>(() => Doc("\"abc\"x,1\n"));
        Assert.Throws<FormatException>(() => Doc("a\n\"abc"));
    }

    [Fact]
    public void BangCanCotTheoDoDaiVaSapOrdinal()
    {
        var (ma, ra, _) = Goi("tinh,tien\nHồ Chí Minh,1000.25\nHuế,-5\nHồ Chí Minh,0.75\n",
            "--tong", "tien", "--nhom-theo", "tinh", "--dinh-dang", "bang");
        Assert.Equal(0, ma);
        Assert.Equal(
            "tinh" + new string(' ', 7) + " | so_dong | tong_tien\n" +
            new string('-', 11) + "-+-" + new string('-', 7) + "-+-" + new string('-', 9) + "\n" +
            "Huế" + new string(' ', 8) + " |       1 |        -5\n" +
            "Hồ Chí Minh |       2 |   1001.00\n", ra);
    }

    [Fact]
    public void JsonThoatNhayXuongDongGiuChuViet()
    {
        var (ma, ra, _) = Goi("tinh,x\n\"Hà\nNội\",1\n\"Đà \"\"Nẵng\"\" & <b>\",2\n", "--nhom-theo", "tinh", "--dinh-dang", "json");
        Assert.Equal(0, ma);
        Assert.Equal("[{\"nhom\":\"Hà\\nNội\",\"so_dong\":1},{\"nhom\":\"Đà \\\"Nẵng\\\" & <b>\",\"so_dong\":1}]\n", ra);
    }

    [Fact]
    public void NhieuLocLaVa_GiaTriChuaDauBang_DongBiLocKhongKiemSo()
    {
        const string csv = "k,q,t,v\nA,a=b,1,10\nA,a=b,2,20\nB,a=b,1,5\nA,a,1,7\nC,x,1,abc\n";
        var (ma, ra, loi) = Goi(csv, "--nhom-theo", "k", "--tong", "v", "--loc", "q=a=b", "--loc", "t=1", "--dinh-dang", "json");
        Assert.Equal("", loi);
        Assert.Equal(0, ma);
        Assert.Equal("[{\"nhom\":\"A\",\"so_dong\":1,\"tong\":10},{\"nhom\":\"B\",\"so_dong\":1,\"tong\":5}]\n", ra);
    }

    [Fact]
    public void TongDecimalGiuChuSoThapPhan_ORongLaKhong()
    {
        var (ma, ra, _) = Goi("k,v\nA,10.50\nA,20\nB,\nB,-0.5\nC,\n", "--nhom-theo", "k", "--tong", "v", "--dinh-dang", "json");
        Assert.Equal(0, ma);
        Assert.Equal("[{\"nhom\":\"A\",\"so_dong\":2,\"tong\":30.50},{\"nhom\":\"B\",\"so_dong\":2,\"tong\":-0.5},{\"nhom\":\"C\",\"so_dong\":1,\"tong\":0}]\n", ra);
    }

    [Fact]
    public void NhomRongVaThuTuOrdinal()
    {
        var (ma, ra, _) = Goi("k\nb\nB\n\"\"\na\n", "--nhom-theo", "k", "--dinh-dang", "json");
        Assert.Equal(0, ma);
        Assert.Equal("[{\"nhom\":\"\",\"so_dong\":1},{\"nhom\":\"B\",\"so_dong\":1},{\"nhom\":\"a\",\"so_dong\":1},{\"nhom\":\"b\",\"so_dong\":1}]\n", ra);
    }

    [Fact]
    public void KetQuaRongVanInTieuDe()
    {
        var (ma, ra, _) = Goi("vung,x\nBac,1\n", "--nhom-theo", "vung", "--loc", "x=2");
        Assert.Equal(0, ma);
        Assert.Equal("vung | so_dong\n-----+--------\n", ra);
        var (ma2, ra2, _) = Goi("vung,x\nBac,1\n", "--nhom-theo", "vung", "--loc", "x=2", "--dinh-dang", "json");
        Assert.Equal(0, ma2);
        Assert.Equal("[]\n", ra2);
    }

    [Fact]
    public void LoiDuLieuMaMotKhongGhiRa()
    {
        var ca = new (string Csv, string[] Args)[]
        {
            ("a,b\n1,2\n", new[] { "--nhom-theo", "c" }),
            ("a,b\n1,2\n", new[] { "--nhom-theo", "a", "--tong", "z" }),
            ("a,b\n1,2\n", new[] { "--nhom-theo", "a", "--loc", "z=1" }),
            ("a,b\n1,2\n3\n", new[] { "--nhom-theo", "a" }),
            ("a,b\n1,2,3\n", new[] { "--nhom-theo", "a" }),
            ("a,b\nx,1\ny,12abc\n", new[] { "--nhom-theo", "a", "--tong", "b" }),
            ("a,b\nx,1\n\"y,2\n", new[] { "--nhom-theo", "a" }),
            ("", new[] { "--nhom-theo", "a" }),
            ("\n\r\n", new[] { "--nhom-theo", "a" }),
        };
        foreach (var (csv, args) in ca)
        {
            var (ma, ra, loi) = Goi(csv, args);
            Assert.True(ma == 1, $"mã {ma} cho {string.Join(' ', args)} / {csv}");
            Assert.Equal("", ra);
            Assert.StartsWith("loi: ", loi);
        }
    }

    [Fact]
    public void LoiThamSoMaHaiTruocCaLoiDuLieu()
    {
        var ca = new[]
        {
            new[] { "--nhom-theo", "a", "--abc" },
            new[] { "x", "--nhom-theo", "a" },
            new[] { "--nhom-theo=a" },
            new[] { "--nhom-theo", "a", "--dinh-dang", "xml" },
            new[] { "--nhom-theo", "a", "--dinh-dang", "JSON" },
            new[] { "--nhom-theo", "a", "--loc", "abc" },
            new[] { "--nhom-theo", "a", "--loc", "=x" },
            new[] { "--nhom-theo", "a", "--nhom-theo", "b" },
            new[] { "--nhom-theo", "a", "--tong", "b", "--tong", "b" },
            new[] { "--nhom-theo", "a", "--tong" },
            Array.Empty<string>(),
        };
        foreach (var args in ca)
        {
            var (ma, ra, loi) = Goi("a,b\n\"hỏng", args);
            Assert.True(ma == 2, $"mã {ma} cho [{string.Join(' ', args)}]");
            Assert.Equal("", ra);
            Assert.StartsWith("loi: ", loi);
        }
    }
}
