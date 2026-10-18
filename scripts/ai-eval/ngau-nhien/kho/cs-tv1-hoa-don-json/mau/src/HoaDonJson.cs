using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Bai;

public enum TrangThai { Nhap, DaGui, DaThanhToan }

public sealed record DongHang(string MaSp, int SoLuong, decimal DonGia);

public sealed record HoaDon(string So, DateOnly Ngay, TrangThai TrangThai, IReadOnlyList<DongHang> Dong, string? GhiChu);

/// <summary>Enum ⇄ ĐÚNG ba chuỗi kebab-case (JsonStringEnumConverter còn nhận cả tên C# "DaGui" và số — quá lỏng).</summary>
internal sealed class TrangThaiConverter : JsonConverter<TrangThai>
{
    public override TrangThai Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String) throw new JsonException("trangThai phải là chuỗi");
        return reader.GetString() switch
        {
            "nhap" => TrangThai.Nhap,
            "da-gui" => TrangThai.DaGui,
            "da-thanh-toan" => TrangThai.DaThanhToan,
            var s => throw new JsonException($"trangThai lạ: {s}"),
        };
    }

    public override void Write(Utf8JsonWriter writer, TrangThai value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value switch
        {
            TrangThai.Nhap => "nhap",
            TrangThai.DaGui => "da-gui",
            TrangThai.DaThanhToan => "da-thanh-toan",
            _ => throw new JsonException($"trangThai lạ: {value}"),
        });
}

public static class HoaDonJson
{
    private static readonly JsonSerializerOptions TuyChon = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        Converters = { new TrangThaiConverter() },
    };

    public static string Ghi(HoaDon h) => JsonSerializer.Serialize(h, TuyChon);

    public static HoaDon Doc(string json)
    {
        HoaDon? h;
        try
        {
            h = JsonSerializer.Deserialize<HoaDon>(json, TuyChon);
        }
        catch (JsonException e)
        {
            throw new FormatException("JSON hoá đơn không hợp lệ: " + e.Message, e);
        }
        catch (NotSupportedException e)
        {
            throw new FormatException("JSON hoá đơn không hợp lệ: " + e.Message, e);
        }
        if (h is null || string.IsNullOrEmpty(h.So)) throw new FormatException("thiếu số hoá đơn");
        // Thuộc tính vắng ⇒ tham số hàm dựng nhận default (null) — chuẩn hoá về danh sách rỗng.
        return h.Dong is null ? h with { Dong = new List<DongHang>() } : h;
    }
}
