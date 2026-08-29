using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 Đối chiếu HAI CHIỀU giữa <c>contracts/component-model.schema.json</c> và các record C# tương ứng,
/// bằng đúng bộ đồ nghề <see cref="SchemaPin"/> mà <c>TagNamespaceSchemaPinTests</c> dùng.
///
/// <para><b>KHÔNG đo cái gì:</b> so TÊN property, không so kiểu; không đo phía TypeScript (bài tương ứng
/// ở <c>web/contract-tests/</c>); không kiểm các luật <c>allOf</c> (setpoint ⇒ min/max + policyAction) —
/// corpus <c>invalid/</c> phía web đo việc đó.</para>
/// </summary>
public class ComponentModelSchemaPinTests
{
    const string SchemaFile = "component-model.schema.json";

    /// <summary>Property có trong record C# nhưng CỐ Ý không có trong schema. Rỗng ở v1.</summary>
    static readonly HashSet<string> CSharpOnlyByDesign = new(StringComparer.Ordinal);

    [Theory]
    [InlineData(typeof(ComponentModelDocument), new string[0])]
    [InlineData(typeof(ComponentNode), new[] { "$defs", "component" })]
    [InlineData(typeof(ComponentTypeDef), new[] { "$defs", "componentType" })]
    [InlineData(typeof(ComponentTagDef), new[] { "$defs", "componentTag" })]
    [InlineData(typeof(ComponentStateDef), new[] { "$defs", "componentState" })]
    public void Schema_and_record_declare_the_same_property_names(Type recordType, string[] pointer)
    {
        SchemaPin.AssertSameNames(
            recordType.Name,
            SchemaPin.SchemaProps(SchemaPin.Load(SchemaFile), pointer),
            SchemaPin.RecordProps(recordType),
            CSharpOnlyByDesign);
    }

    [Fact]
    public void Every_writable_role_is_covered_by_the_policy_action_rule()
    {
        // 🔴 Bất biến §5 ở tầng kiểu linh kiện. Nếu ai đó thêm một `role` ghi được thứ ba vào enum mà
        // không đưa nó vào luật allOf, bài này đỏ — thay vì lặng lẽ mở một đường ghi không gác.
        var schema = SchemaPin.Load(SchemaFile);
        var roles = schema["$defs"]!["componentTag"]!["properties"]!["role"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
        var guarded = schema["$defs"]!["componentTag"]!["allOf"]!.AsArray()[0]!
            ["if"]!["properties"]!["role"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).OrderBy(s => s, StringComparer.Ordinal).ToList();

        Assert.Equal(new[] { "command", "setpoint" }, guarded);
        Assert.All(guarded, r => Assert.Contains(r, roles));
        Assert.Equal(4, roles.Count); // in, out, setpoint, command
    }

    [Fact]
    public void Exemption_list_is_not_stale()
    {
        var all = new[]
            {
                typeof(ComponentModelDocument), typeof(ComponentNode), typeof(ComponentTypeDef),
                typeof(ComponentTagDef), typeof(ComponentStateDef),
            }
            .SelectMany(SchemaPin.RecordProps).ToHashSet(StringComparer.Ordinal);
        var stale = CSharpOnlyByDesign.Except(all).ToList();
        Assert.True(stale.Count == 0, $"mục miễn trừ đã cũ: {string.Join(", ", stale)}");
    }
}
