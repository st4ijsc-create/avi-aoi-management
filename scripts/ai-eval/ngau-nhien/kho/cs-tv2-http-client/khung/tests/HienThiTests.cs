using System.Net;
using System.Text;
using Bai;

namespace KiemThu;

public class HienThiTests
{
    /// <summary>HttpMessageHandler giả: trả lần lượt các phản hồi dựng sẵn, ghi lại mọi yêu cầu.</summary>
    private sealed class XuLyGia(params (HttpStatusCode Ma, string Than)[] phanHoi) : HttpMessageHandler
    {
        private readonly Queue<(HttpStatusCode Ma, string Than)> _con = new(phanHoi);
        public List<HttpRequestMessage> DaNhan { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage yeuCau, CancellationToken ct)
        {
            DaNhan.Add(yeuCau);
            var (ma, than) = _con.Dequeue();
            return Task.FromResult(new HttpResponseMessage(ma) { Content = new StringContent(than, Encoding.UTF8, "application/json") });
        }
    }

    private static HttpClient Khach(XuLyGia x) => new(x) { BaseAddress = new Uri("https://api.vidu.vn/v1/") };

    [Fact]
    public async Task LayThanhCongVaGuiDungHeader()
    {
        var x = new XuLyGia((HttpStatusCode.OK, "{\"ma\":\"A1\",\"ten\":\"Cà phê sữa\",\"gia\":25000.5}"));
        var sp = await new KhachSanPham(Khach(x), "tk-123").LayAsync("A1");
        Assert.Equal(new SanPham("A1", "Cà phê sữa", 25000.5m), sp);
        var r = Assert.Single(x.DaNhan);
        Assert.Equal(HttpMethod.Get, r.Method);
        Assert.Equal("https://api.vidu.vn/v1/san-pham/A1", r.RequestUri!.AbsoluteUri);
        Assert.Equal("application/json", r.Headers.Accept.ToString());
        Assert.Equal("Bearer", r.Headers.Authorization!.Scheme);
        Assert.Equal("tk-123", r.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task Lay404TraNull()
    {
        var x = new XuLyGia((HttpStatusCode.NotFound, "{}"));
        Assert.Null(await new KhachSanPham(Khach(x), "tk").LayAsync("KHONG-CO"));
    }

    [Fact]
    public async Task TimMaHoaTuKhoaTiengViet()
    {
        var x = new XuLyGia((HttpStatusCode.OK, "{\"tong\":1,\"muc\":[{\"ma\":\"B2\",\"ten\":\"Cà phê đen\",\"gia\":18000}]}"));
        var kq = await new KhachSanPham(Khach(x), "tk").TimAsync("cà phê", 2);
        Assert.Equal("https://api.vidu.vn/v1/san-pham?q=c%C3%A0%20ph%C3%AA&trang=2", x.DaNhan[0].RequestUri!.AbsoluteUri);
        Assert.Equal(1, kq.Tong);
        Assert.Equal(new SanPham("B2", "Cà phê đen", 18000m), Assert.Single(kq.Muc));
    }
}
