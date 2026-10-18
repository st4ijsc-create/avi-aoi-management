using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Bai;

public sealed record SanPham(string Ma, string Ten, decimal Gia);

public sealed record KetQuaTim(int Tong, IReadOnlyList<SanPham> Muc);

/// <summary>API trả mã trạng thái lỗi (không phải 2xx, trừ các trường hợp đặc tả xử lý riêng).</summary>
public sealed class LoiApi : Exception
{
    public LoiApi(HttpStatusCode maTrangThai, string noiDung)
        : base($"API trả mã {(int)maTrangThai}")
    {
        MaTrangThai = maTrangThai;
        NoiDung = noiDung;
    }

    public HttpStatusCode MaTrangThai { get; }

    public string NoiDung { get; }
}

public sealed class KhachSanPham
{
    private static readonly JsonSerializerOptions TuyChon = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly string _token;

    public KhachSanPham(HttpClient http, string token)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentException.ThrowIfNullOrWhiteSpace(token);
        _http = http;
        _token = token;
    }

    public async Task<SanPham?> LayAsync(string ma, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(ma);
        using var phanHoi = await GuiAsync("san-pham/" + Uri.EscapeDataString(ma), ct);
        if (phanHoi.StatusCode == HttpStatusCode.NotFound) return null;
        await NemNeuLoiAsync(phanHoi, ct);
        return await phanHoi.Content.ReadFromJsonAsync<SanPham>(TuyChon, ct);
    }

    public async Task<KetQuaTim> TimAsync(string tuKhoa, int trang, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(tuKhoa);
        ArgumentOutOfRangeException.ThrowIfLessThan(trang, 1);
        using var phanHoi = await GuiAsync($"san-pham?q={Uri.EscapeDataString(tuKhoa)}&trang={trang}", ct);
        await NemNeuLoiAsync(phanHoi, ct);
        var kq = await phanHoi.Content.ReadFromJsonAsync<KetQuaTim>(TuyChon, ct)
            ?? throw new LoiApi(phanHoi.StatusCode, "null");
        return kq.Muc is null ? kq with { Muc = Array.Empty<SanPham>() } : kq;
    }

    /// <summary>Gửi GET; 503 ⇒ thử lại NGAY đúng một lần bằng một HttpRequestMessage MỚI (không gửi lại được message cũ).</summary>
    private async Task<HttpResponseMessage> GuiAsync(string duongDan, CancellationToken ct)
    {
        for (int lan = 1; ; lan++)
        {
            using var yeuCau = new HttpRequestMessage(HttpMethod.Get, new Uri(duongDan, UriKind.Relative));
            yeuCau.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            yeuCau.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
            var phanHoi = await _http.SendAsync(yeuCau, ct);
            if (phanHoi.StatusCode == HttpStatusCode.ServiceUnavailable && lan < 2)
            {
                phanHoi.Dispose();
                continue;
            }
            return phanHoi;
        }
    }

    private static async Task NemNeuLoiAsync(HttpResponseMessage phanHoi, CancellationToken ct)
    {
        if (phanHoi.IsSuccessStatusCode) return;
        var noiDung = await phanHoi.Content.ReadAsStringAsync(ct);
        throw new LoiApi(phanHoi.StatusCode, noiDung);
    }
}
