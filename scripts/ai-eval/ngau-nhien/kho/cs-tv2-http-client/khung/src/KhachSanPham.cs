using System.Net;

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
    public KhachSanPham(HttpClient http, string token) => throw new NotImplementedException();

    public Task<SanPham?> LayAsync(string ma, CancellationToken ct = default) => throw new NotImplementedException();

    public Task<KetQuaTim> TimAsync(string tuKhoa, int trang, CancellationToken ct = default) => throw new NotImplementedException();
}
