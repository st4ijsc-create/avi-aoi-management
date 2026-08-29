using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.Hmi.Contracts;

/// <summary>Bản sao C# của <c>contracts/tag-namespace.schema.json</c> v1. Mọi property ở đây được ghim
/// đối chiếu HAI CHIỀU với file schema bởi <c>TagNamespaceSchemaPinTests</c> — thêm một property vào một
/// bên mà quên bên kia thì bài test ấy đỏ.</summary>
public sealed record TagNamespaceDocument(
    int SchemaVersion,
    string MachineCode,
    IReadOnlyList<TagDescriptor> Tags);

/// <summary>Một tag trong namespace. <paramref name="PolicyAction"/> là bất biến an toàn §5 viết thành
/// dữ liệu: <c>Access == "rw"</c> BẮT BUỘC có giá trị khác null ở đây, và runtime dùng nó để chọn
/// endpoint (<c>machine.setpoint</c> → Engineer, <c>machine.command</c> → Admin). Ràng buộc ấy được
/// schema thi hành; kiểu C# không tự thi hành được nó, nên đừng đọc "biên dịch được" thành "hợp lệ".</summary>
public sealed record TagDescriptor(
    string Path,
    string DataType,
    string? Unit,
    double? EngMin,
    double? EngMax,
    IReadOnlyList<string>? EnumValues,
    string Access,
    string? PolicyAction,
    TagSource Source,
    bool IsBackedByDriver);

/// <summary>Nguồn của một tag. Đây là một union phẳng: <paramref name="Kind"/> quyết định trường nào có
/// nghĩa (schema dùng <c>oneOf</c> + <c>additionalProperties:false</c> để cấm trộn). Làm phẳng thay vì
/// đa hình vì <c>System.Text.Json</c> phải round-trip được nó mà không cần converter tuỳ biến — và một
/// converter tuỳ biến là đúng thứ hai nhánh song song sẽ hiện thực khác nhau.</summary>
public sealed record TagSource(
    string Kind,
    int? UnitId = null,
    int? Register = null,
    double? Scale = null,
    string? NodeId = null,
    string? Topic = null,
    string? JsonPath = null,
    string? Expr = null);

/// <summary>Cấu hình JSON dùng chung cho MỌI contract HMI. camelCase khớp schema; bỏ null khi ghi để
/// round-trip không thêm trường mà fixture gốc không có.</summary>
public static class HmiContractJson
{
    /// <summary>Options dùng cho MỌI (de)serialize <see cref="TagNamespaceDocument"/> — camelCase, bỏ
    /// null khi ghi. Xem doc-comment ở đầu class để biết lý do.</summary>
    public static JsonSerializerOptions Options { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
