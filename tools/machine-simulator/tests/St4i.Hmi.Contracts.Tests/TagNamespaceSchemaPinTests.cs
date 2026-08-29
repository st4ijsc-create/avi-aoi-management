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
/// đổi; (3) nó KHÔNG kiểm luật <c>allOf</c>/<c>if-then</c> có thật sự CHẶN hay không —
/// <see cref="Every_writable_access_is_covered_by_the_policy_action_rule"/> chỉ khẳng định luật ấy PHỦ
/// ĐÚNG tập <c>access</c> ghi được; việc nó thật sự từ chối một tài liệu vi phạm được đo bằng corpus
/// <c>invalid/</c> ở phía web, nơi CÓ bộ validate.</para>
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
    public void Every_writable_access_is_covered_by_the_policy_action_rule()
    {
        // 🔴 Bất biến §5 ở tầng tag — MIRROR của
        // `ComponentModelSchemaPinTests.Every_writable_role_is_covered_by_the_policy_action_rule` và
        // `HmiScreenSchemaPinTests.Every_widget_kind_is_declared_once_and_the_writable_ones_are_exactly_two`.
        //
        // VÌ SAO BÀI NÀY TỒN TẠI (fix round 2, finding Critical 2): hai bài kia đã khẳng định "tập
        // được gác BẰNG tập ghi được", nên thêm một thành viên ghi được vào enum của chúng làm chúng
        // đỏ. `access` là guard DUY NHẤT trong ba guard KHÔNG có khẳng định ấy — không chỗ nào trong
        // cây khẳng định `access.enum` đúng là ["r","rw"], cũng không chỗ nào khẳng định luật
        // `allOf[0].if` phủ mọi thành viên ghi được của nó. Reviewer đã nới `access` thành
        // ["r","rw","w"] — một thay đổi CỘNG THÊM mà `contracts/README.md` cho phép tường minh — rồi
        // validate một tag `"access":"w"` KHÔNG có `policyAction`: 0 lỗi, toàn bộ test xanh. Tức là
        // "đường ghi không gác không diễn đạt được" chỉ cách một lần sửa hợp lệ.
        //
        // Đây cũng là lý do bài này khẳng định SỐ LƯỢNG chứ không chỉ nội dung: `Assert.Equal(2, ...)`
        // là thứ đỏ khi enum PHÌNH RA, còn khẳng định "rw có trong enum" thì không.
        var schema = SchemaPin.Load(SchemaFile);
        var access = schema["$defs"]!["tag"]!["properties"]!["access"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).OrderBy(s => s, StringComparer.Ordinal).ToList();

        Assert.Equal(new[] { "r", "rw" }, access);

        var guarded = schema["$defs"]!["tag"]!["allOf"]!.AsArray()[0]!
            ["if"]!["properties"]!["access"]!["const"]!.GetValue<string>();

        Assert.Equal("rw", guarded);
        Assert.Contains(guarded, access);
    }

    [Fact]
    public void TagSource_covers_every_source_kind_and_every_branch_field_the_schema_allows()
    {
        var oneOf = SchemaPin.Load(SchemaFile)["$defs"]!["source"]!["oneOf"]!.AsArray();

        var kinds = oneOf.Select(v => v!["properties"]!["kind"]!["const"]!.GetValue<string>())
                         .ToHashSet(StringComparer.Ordinal);

        // Mọi trường của các nhánh oneOf gộp lại phải khớp HAI CHIỀU với TagSource phẳng: đây là bài
        // ghim DUY NHẤT của TagSource (không có hàng [InlineData] riêng vì oneOf không có một
        // "properties" gốc để trỏ tới), nên thiếu chiều nào cũng để lọt drift không ai bắt được.
        var allBranchProps = oneOf.SelectMany(v => v!["properties"]!.AsObject().Select(kv => kv.Key))
                                  .ToHashSet(StringComparer.Ordinal);

        var flat = SchemaPin.RecordProps(typeof(TagSource));
        var missingFromRecord = allBranchProps.Except(flat).OrderBy(s => s, StringComparer.Ordinal).ToList();
        var missingFromSchema = flat.Except(allBranchProps).OrderBy(s => s, StringComparer.Ordinal).ToList();

        if (missingFromRecord.Count > 0 || missingFromSchema.Count > 0)
        {
            var parts = new List<string>();
            if (missingFromRecord.Count > 0)
                parts.Add($"nhánh oneOf khai nhưng TagSource thiếu: {string.Join(", ", missingFromRecord)}");
            if (missingFromSchema.Count > 0)
                parts.Add($"TagSource khai nhưng không nhánh oneOf nào có: {string.Join(", ", missingFromSchema)}");
            Assert.Fail($"TagSource: {string.Join(" | ", parts)}");
        }

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
