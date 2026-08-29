using System.Text.Json.Nodes;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>Bộ đồ nghề dùng chung cho ba bài ghim schema⟷record (tag namespace · component model ·
/// hmi screen). Tách ra một chỗ vì ba bài ấy phải đo GIỐNG HỆT nhau — ba bản sao chép tay là ba cơ hội
/// để một bài lỏng hơn hai bài kia mà không ai thấy.</summary>
public static class SchemaPin
{
    public static JsonNode Load(string schemaFileName) =>
        JsonNode.Parse(File.ReadAllText(ContractFixtures.RepoRelative(schemaFileName)))!;

    /// <summary>Tên property khai tại <paramref name="pointer"/>. Mảng rỗng = object gốc của schema.</summary>
    public static IReadOnlyCollection<string> SchemaProps(JsonNode schema, params string[] pointer)
    {
        JsonNode node = schema;
        foreach (var seg in pointer) node = node[seg]!;
        return node["properties"]!.AsObject().Select(kv => kv.Key).ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>Tên property của một record, đổi chữ cái đầu thành thường để khớp camelCase của schema.
    /// Khớp với <c>JsonNamingPolicy.CamelCase</c> mà <see cref="HmiContractJson.Options"/> dùng.</summary>
    public static IReadOnlyCollection<string> RecordProps(Type t) =>
        t.GetProperties().Select(p => char.ToLowerInvariant(p.Name[0]) + p.Name[1..])
         .ToHashSet(StringComparer.Ordinal);

    /// <summary>Khẳng định HAI CHIỀU. Thiếu bên nào cũng đỏ, và thông điệp nói rõ thiếu bên nào —
    /// một bài chỉ kiểm một chiều sẽ để lọt đúng nửa số trường hợp drift.</summary>
    public static void AssertSameNames(
        string label,
        IReadOnlyCollection<string> inSchema,
        IReadOnlyCollection<string> inType,
        ISet<string> exemptions)
    {
        var missingFromType = inSchema.Except(inType).OrderBy(s => s, StringComparer.Ordinal).ToList();
        var missingFromSchema = inType.Except(inSchema).Except(exemptions)
                                      .OrderBy(s => s, StringComparer.Ordinal).ToList();

        if (missingFromType.Count == 0 && missingFromSchema.Count == 0) return;

        // Hai chiều được gộp vào MỘT thất bại: nếu tách thành hai Assert.True liên tiếp, xUnit ném
        // ngoại lệ ở lần đầu và lần thứ hai không bao giờ chạy — vậy là bài test chỉ báo được đúng nửa
        // chiều lệch mỗi lần, dù cả hai chiều đều đang sai. Gộp lại để một lần chạy lộ ra cả hai.
        var parts = new List<string>();
        if (missingFromType.Count > 0)
            parts.Add($"schema khai nhưng kiểu thiếu: {string.Join(", ", missingFromType)}");
        if (missingFromSchema.Count > 0)
            parts.Add($"kiểu khai nhưng schema thiếu: {string.Join(", ", missingFromSchema)}");

        Assert.Fail($"{label}: {string.Join(" | ", parts)}");
    }
}
