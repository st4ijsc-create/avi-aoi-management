using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 Đối chiếu HAI CHIỀU giữa <c>contracts/tag-namespace.schema.json</c> và các record C# tương ứng.
/// Đây là cùng khuôn mẫu <c>MachineConfigDesignDocTableTests</c> đã dựng cho bảng §3 của
/// <c>MACHINE_CONFIG_DESIGN.md</c>, và vì cùng một lý do: khi hai thứ phải khớp nhau mà KHÔNG có phép đo
/// nào nối chúng, chúng lệch và không ai biết.
///
/// <para>Ở đây rủi ro cụ thể hơn: hai NHÁNH đang xây song song từ file schema này. Một property thêm vào
/// schema mà quên thêm vào record là một lệch không bao giờ tự lộ ra cho tới khi hai nhánh merge.</para>
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó so TÊN property, không so KIỂU — schema nói
/// <c>engMin</c> là number, bài test này không kiểm C# khai <c>double?</c>; sai kiểu bị round-trip ở
/// <c>TagNamespaceRoundTripTests</c> bắt, nhưng chỉ khi có fixture chạm tới nó; (2) nó KHÔNG đo phía
/// TypeScript — đó là bài tương ứng ở <c>web/contract-tests/</c>, và hai bài phải cùng đỏ khi schema
/// đổi; (3) nó KHÔNG kiểm các ràng buộc <c>allOf</c>/<c>if-then</c> (luật rw→policyAction) — những luật
/// ấy được đo bằng corpus <c>invalid/</c> ở phía web, nơi CÓ bộ validate.</para>
/// </summary>
public class TagNamespaceSchemaPinTests
{
    const string SchemaFile = "tag-namespace.schema.json";

    /// <summary>Property có trong record C# nhưng CỐ Ý không có trong schema. Rỗng ở v1 — và khẳng định
    /// dưới cùng bắt danh sách này phải được cập nhật có ý thức chứ không phình lên âm thầm.</summary>
    static readonly HashSet<string> CSharpOnlyByDesign = new(StringComparer.Ordinal);

    [Theory]
    [InlineData(typeof(TagNamespaceDocument), new string[0])]
    [InlineData(typeof(TagDescriptor), new[] { "$defs", "tag" })]
    public void Schema_and_record_declare_the_same_property_names(Type recordType, string[] pointer)
    {
        SchemaPin.AssertSameNames(
            recordType.Name,
            SchemaPin.SchemaProps(SchemaPin.Load(SchemaFile), pointer),
            SchemaPin.RecordProps(recordType),
            CSharpOnlyByDesign);
    }

    [Fact]
    public void TagSource_covers_every_source_kind_and_every_branch_field_the_schema_allows()
    {
        var oneOf = SchemaPin.Load(SchemaFile)["$defs"]!["source"]!["oneOf"]!.AsArray();

        var kinds = oneOf.Select(v => v!["properties"]!["kind"]!["const"]!.GetValue<string>())
                         .ToHashSet(StringComparer.Ordinal);

        // Mọi trường của các nhánh oneOf gộp lại phải nằm trong TagSource phẳng.
        var allBranchProps = oneOf.SelectMany(v => v!["properties"]!.AsObject().Select(kv => kv.Key))
                                  .ToHashSet(StringComparer.Ordinal);

        var flat = SchemaPin.RecordProps(typeof(TagSource));
        var missing = allBranchProps.Except(flat).OrderBy(s => s, StringComparer.Ordinal).ToList();

        Assert.True(missing.Count == 0, $"TagSource thiếu trường của nhánh oneOf: {string.Join(", ", missing)}");
        Assert.Equal(5, kinds.Count); // modbus, opcua, mqtt, simulated, derived
    }

    [Fact]
    public void Exemption_list_is_not_stale()
    {
        // Một mục miễn trừ không còn tồn tại trong record là dấu hiệu danh sách đã cũ và đang che một
        // drift thật. Cùng khẳng định "non-vacuity" mà MachineConfigDesignDocTableTests đã dựng.
        var all = SchemaPin.RecordProps(typeof(TagNamespaceDocument))
                           .Concat(SchemaPin.RecordProps(typeof(TagDescriptor)))
                           .ToHashSet(StringComparer.Ordinal);
        var stale = CSharpOnlyByDesign.Except(all).ToList();
        Assert.True(stale.Count == 0, $"mục miễn trừ đã cũ: {string.Join(", ", stale)}");
    }
}
