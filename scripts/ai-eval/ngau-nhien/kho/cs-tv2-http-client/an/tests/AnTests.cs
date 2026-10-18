using System.Diagnostics;
using System.Net;
using System.Text;
using Bai;

namespace KiemThu;

public class AnTests
{
    private const string Sp = "{\"ma\":\"Z9\",\"ten\":\"Trà\",\"gia\":12.50}";

    /// <summary>Handler giả theo kịch bản: mỗi lượt gọi một hàm (yêu cầu, token) ⇒ phản hồi.</summary>
    private sealed class KichBan(params Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>[] buoc) : HttpMessageHandler
    {
        private readonly Queue<Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>> _con = new(buoc);
        public List<HttpRequestMessage> DaNhan { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage yeuCau, CancellationToken ct)
        {
            DaNhan.Add(yeuCau);
            if (_con.Count == 0) throw new InvalidOperationException("gửi nhiều yêu cầu hơn kịch bản");
            return _con.Dequeue()(yeuCau, ct);
        }
    }

    private static Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Tra(HttpStatusCode ma, string than) =>
        (_, _) => Task.FromResult(new HttpResponseMessage(ma) { Content = new StringContent(than, Encoding.UTF8, "application/json") });

    private static HttpClient Khach(HttpMessageHandler h) => new(h) { BaseAddress = new Uri("https://api.vidu.vn/v1/") };

    private static void HeaderDung(HttpRequestMessage r, string token)
    {
        Assert.Equal("application/json", r.Headers.Accept.ToString());
        Assert.Equal("Bearer", r.Headers.Authorization?.Scheme);
        Assert.Equal(token, r.Headers.Authorization?.Parameter);
    }

    [Fact]
    public async Task Gap503ThuLaiMotLanRoiThanhCong()
    {
        var h = new KichBan(Tra(HttpStatusCode.ServiceUnavailable, "bận"), Tra(HttpStatusCode.OK, Sp));
        var sp = await new KhachSanPham(Khach(h), "tk-9").LayAsync("Z9");
        Assert.Equal(new SanPham("Z9", "Trà", 12.50m), sp);
        Assert.Equal(2, h.DaNhan.Count);
        Assert.NotSame(h.DaNhan[0], h.DaNhan[1]);
        foreach (var r in h.DaNhan)
        {
            Assert.Equal("https://api.vidu.vn/v1/san-pham/Z9", r.RequestUri!.AbsoluteUri);
            HeaderDung(r, "tk-9");
        }
    }

    [Fact]
    public async Task Hai503LienTiepNemLoiApiChiHaiYeuCau()
    {
        var h = new KichBan(Tra(HttpStatusCode.ServiceUnavailable, "bận lần 1"), Tra(HttpStatusCode.ServiceUnavailable, "bận lần 2"),
            Tra(HttpStatusCode.OK, "{\"tong\":0,\"muc\":[]}"));
        var e = await Assert.ThrowsAsync<LoiApi>(() => new KhachSanPham(Khach(h), "tk").TimAsync("x", 1));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, e.MaTrangThai);
        Assert.Equal("bận lần 2", e.NoiDung);
        Assert.Equal(2, h.DaNhan.Count);
    }

    [Fact]
    public async Task LoiKhacKhongThuLai()
    {
        var h = new KichBan(Tra(HttpStatusCode.InternalServerError, "hỏng máy chủ"), Tra(HttpStatusCode.OK, Sp));
        var e = await Assert.ThrowsAsync<LoiApi>(() => new KhachSanPham(Khach(h), "tk").LayAsync("Z9"));
        Assert.Equal(HttpStatusCode.InternalServerError, e.MaTrangThai);
        Assert.Equal("hỏng máy chủ", e.NoiDung);
        Assert.Single(h.DaNhan);

        var h2 = new KichBan(Tra(HttpStatusCode.Unauthorized, ""));
        var e2 = await Assert.ThrowsAsync<LoiApi>(() => new KhachSanPham(Khach(h2), "tk").TimAsync("a", 3));
        Assert.Equal(HttpStatusCode.Unauthorized, e2.MaTrangThai);
        Assert.Equal("", e2.NoiDung);
    }

    [Fact]
    public async Task Tim404LaLoiApi_Lay503Roi404LaNull()
    {
        var h = new KichBan(Tra(HttpStatusCode.NotFound, "không có"));
        var e = await Assert.ThrowsAsync<LoiApi>(() => new KhachSanPham(Khach(h), "tk").TimAsync("a", 1));
        Assert.Equal(HttpStatusCode.NotFound, e.MaTrangThai);

        var h2 = new KichBan(Tra(HttpStatusCode.ServiceUnavailable, ""), Tra(HttpStatusCode.NotFound, ""));
        Assert.Null(await new KhachSanPham(Khach(h2), "tk").LayAsync("Q"));
        Assert.Equal(2, h2.DaNhan.Count);
    }

    [Fact]
    public async Task MaHoaKyTuDacBietTrongDuongVaTruyVan()
    {
        var h = new KichBan(Tra(HttpStatusCode.OK, Sp), Tra(HttpStatusCode.OK, "{\"tong\":0,\"muc\":[]}"),
            Tra(HttpStatusCode.OK, "{\"tong\":0,\"muc\":[]}"));
        var k = new KhachSanPham(Khach(h), "tk");
        await k.LayAsync("A/B 1&2+?");
        await k.TimAsync("a+b & c/d", 1);
        await k.TimAsync("Đà Nẵng", 10);
        Assert.Equal("https://api.vidu.vn/v1/san-pham/A%2FB%201%262%2B%3F", h.DaNhan[0].RequestUri!.AbsoluteUri);
        Assert.Equal("https://api.vidu.vn/v1/san-pham?q=a%2Bb%20%26%20c%2Fd&trang=1", h.DaNhan[1].RequestUri!.AbsoluteUri);
        Assert.Equal("https://api.vidu.vn/v1/san-pham?q=%C4%90%C3%A0%20N%E1%BA%B5ng&trang=10", h.DaNhan[2].RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task JsonKhongPhanBietHoaThuong_ThieuMucLaRong()
    {
        var h = new KichBan(Tra(HttpStatusCode.OK, "{\"TONG\":0}"), Tra(HttpStatusCode.OK, "{\"Ma\":\"X\",\"TEN\":\"y\",\"Gia\":1}"));
        var k = new KhachSanPham(Khach(h), "tk");
        var kq = await k.TimAsync("", 1);
        Assert.Equal(0, kq.Tong);
        Assert.NotNull(kq.Muc);
        Assert.Empty(kq.Muc);
        Assert.Equal("https://api.vidu.vn/v1/san-pham?q=&trang=1", h.DaNhan[0].RequestUri!.AbsoluteUri);
        Assert.Equal(new SanPham("X", "y", 1m), await k.LayAsync("X"));
    }

    [Fact]
    public async Task HuyGiuaChungNemOperationCanceled()
    {
        var h = new KichBan(async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(3), ct);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Sp) };
        });
        var http = Khach(h);
        http.Timeout = Timeout.InfiniteTimeSpan;
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        var dongHo = Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new KhachSanPham(http, "tk").LayAsync("Z9", cts.Token));
        Assert.True(dongHo.Elapsed < TimeSpan.FromSeconds(2.5), $"không truyền CancellationToken ({dongHo.Elapsed})");

        var h2 = new KichBan(Tra(HttpStatusCode.OK, "{\"tong\":0,\"muc\":[]}"));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new KhachSanPham(Khach(h2), "tk").TimAsync("a", 1, new CancellationToken(true)));
    }

    [Fact]
    public async Task ThamSoSaiKhongGuiYeuCau()
    {
        var h = new KichBan();
        var k = new KhachSanPham(Khach(h), "tk");
        await Assert.ThrowsAnyAsync<ArgumentException>(() => k.LayAsync(""));
        await Assert.ThrowsAnyAsync<ArgumentException>(() => k.LayAsync(null!));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => k.TimAsync("a", 0));
        await Assert.ThrowsAnyAsync<ArgumentException>(() => k.TimAsync(null!, 1));
        Assert.Empty(h.DaNhan);
        Assert.Throws<ArgumentNullException>(() => new KhachSanPham(null!, "tk"));
        Assert.ThrowsAny<ArgumentException>(() => new KhachSanPham(Khach(h), ""));
        Assert.ThrowsAny<ArgumentException>(() => new KhachSanPham(Khach(h), "   "));
    }

    [Fact]
    public async Task KhongDungDefaultRequestHeaders_HaiKhachChungHttpClient()
    {
        var h = new KichBan(Tra(HttpStatusCode.OK, Sp), Tra(HttpStatusCode.OK, Sp), Tra(HttpStatusCode.OK, Sp));
        var http = Khach(h);
        var k1 = new KhachSanPham(http, "token-mot");
        var k2 = new KhachSanPham(http, "token-hai");
        await k1.LayAsync("Z9");
        await k2.LayAsync("Z9");
        await k1.LayAsync("Z9");
        HeaderDung(h.DaNhan[0], "token-mot");
        HeaderDung(h.DaNhan[1], "token-hai");
        HeaderDung(h.DaNhan[2], "token-mot");
        Assert.Null(http.DefaultRequestHeaders.Authorization);
        Assert.Empty(http.DefaultRequestHeaders.Accept);
    }

    [Fact]
    public async Task LoiMangLotNguyenKhongThuLai()
    {
        var h = new KichBan((_, _) => throw new HttpRequestException("mất mạng"), Tra(HttpStatusCode.OK, Sp));
        var e = await Assert.ThrowsAsync<HttpRequestException>(() => new KhachSanPham(Khach(h), "tk").LayAsync("Z9"));
        Assert.Equal("mất mạng", e.Message);
        Assert.Single(h.DaNhan);
    }
}
