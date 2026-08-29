using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 Đối chiếu HAI CHIỀU giữa <c>contracts/hmi-screen.schema.json</c> và các record C# tương ứng, cộng
/// một bài ghim riêng cho danh sách <c>kind</c> — vì <c>kind</c> là chỗ bất biến §5 sống.
///
/// <para><b>KHÔNG đo cái gì:</b> so TÊN property, không so kiểu; không đo phía TypeScript; không kiểm
/// luật <c>allOf</c> có thật sự CHẶN hay không (đó là corpus <c>invalid/</c> phía web) — bài dưới chỉ
/// kiểm luật ấy PHỦ ĐÚNG tập kind ghi được.</para>
/// </summary>
public class HmiScreenSchemaPinTests
{
    const string SchemaFile = "hmi-screen.schema.json";

    /// <summary>Property có trong record C# nhưng CỐ Ý không có trong schema. Rỗng ở v1.</summary>
    static readonly HashSet<string> CSharpOnlyByDesign = new(StringComparer.Ordinal);

    [Theory]
    [InlineData(typeof(HmiScreenDocument), new string[0])]
    [InlineData(typeof(ScreenLayout), new[] { "$defs", "layout" })]
    [InlineData(typeof(ScreenWidget), new[] { "$defs", "widget" })]
    [InlineData(typeof(WidgetRect), new[] { "$defs", "rect" })]
    public void Schema_and_record_declare_the_same_property_names(Type recordType, string[] pointer)
    {
        SchemaPin.AssertSameNames(
            recordType.Name,
            SchemaPin.SchemaProps(SchemaPin.Load(SchemaFile), pointer),
            SchemaPin.RecordProps(recordType),
            CSharpOnlyByDesign);
    }

    [Fact]
    public void Every_widget_kind_is_declared_once_and_the_writable_ones_are_exactly_two()
    {
        var schema = SchemaPin.Load(SchemaFile);
        var kinds = schema["$defs"]!["widget"]!["properties"]!["kind"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).ToList();

        Assert.Equal(kinds.Count, kinds.Distinct(StringComparer.Ordinal).Count());

        // 🔴 Bất biến §5. Nếu ai đó thêm một kind ghi được thứ ba, bài này đỏ và buộc họ đọc §5 trước khi
        // đi tiếp — thay vì thêm một đường ghi mà luật allOf không phủ.
        var writable = schema["$defs"]!["widget"]!["allOf"]!.AsArray()[0]!
            ["if"]!["properties"]!["kind"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).OrderBy(s => s, StringComparer.Ordinal).ToList();
        Assert.Equal(new[] { "command-button", "setpoint-input" }, writable);
        Assert.All(writable, k => Assert.Contains(k, kinds));
    }

    [Fact]
    public void Exemption_list_is_not_stale()
    {
        var all = new[]
            {
                typeof(HmiScreenDocument), typeof(ScreenLayout), typeof(ScreenWidget), typeof(WidgetRect),
            }
            .SelectMany(SchemaPin.RecordProps).ToHashSet(StringComparer.Ordinal);
        var stale = CSharpOnlyByDesign.Except(all).ToList();
        Assert.True(stale.Count == 0, $"mục miễn trừ đã cũ: {string.Join(", ", stale)}");
    }
}
