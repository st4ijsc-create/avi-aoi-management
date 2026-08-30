using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// Toàn vẹn tham chiếu — bốn phép đo mà các bài round-trip của Mốc 0
/// (<c>ComponentModelRoundTripTests</c>) tự khai là KHÔNG làm.
/// (🔴 2026-08-30, review toàn nhánh WS-HMI-0a Minor 5: <b>NĂM</b>, không phải bốn. Câu trên giữ nguyên
/// văn vì nó đúng với bộ bốn phép đo mà Task 4 giao; phép đo thứ năm — id/typeId trùng — được thêm bởi
/// vòng sửa sau review, và <see cref="A_duplicate_component_id_is_reported_rather_than_absorbed"/> là chỗ
/// nó được ghim.)
///
/// <para><b>KHÔNG đo cái gì:</b> nó là một hàm THUẦN trên hai tài liệu, không đọc đĩa và không phải là
/// cửa ghi. Store cố ý KHÔNG gọi nó, vì một cây linh kiện hợp lệ có thể được khai trước khi connector
/// nạp namespace — bắt hai tài liệu luôn khớp ở cửa ghi sẽ khiến thứ tự khai báo trở thành ràng buộc,
/// và đó là ràng buộc sai. Ai gọi nó và khi nào là quyết định của WS-HMI-0b.</para>
///
/// <para><b>No <c>[Collection(SecurityEnvVarTests.CollectionName)]</c> here, and that is a deliberate
/// read of that collection's membership rule, not an oversight.</b> The rule is "perturbs process-lifetime
/// state, or observes state another class in this assembly perturbs" — process env vars or the SQLite
/// connection pool. <see cref="ModelIntegrity"/> opens no connection, reads no environment variable, and
/// touches no disk; every fixture here is an in-memory record literal. There is nothing in this class for
/// that collection's serialization to protect.</para>
/// </summary>
public class ModelIntegrityTests
{
    static ComponentNode Node(string id, string? parent, string prefix) =>
        new(id, "st4i.motor.spindle", id, parent, prefix);

    static ComponentTypeDef Type(string id = "st4i.motor.spindle") =>
        new(id, id, Array.Empty<ComponentTagDef>(), Array.Empty<ComponentStateDef>(), "fp.x");

    static ComponentModelDocument Model(params ComponentNode[] nodes) =>
        new(1, "M1", nodes, new[] { Type() });

    [Fact]
    public void A_parent_that_does_not_exist_is_reported()
    {
        var r = ModelIntegrity.Check(Model(Node("a", "ghost", "M1/a")), null);
        Assert.Contains(r, m => m.Contains("ghost"));
    }

    [Fact]
    public void A_cycle_is_reported_rather_than_hanging()
    {
        // Nếu bộ kiểm đi cây bằng đệ quy ngây thơ, bài này TREO thay vì đỏ. Đó là lý do nó tồn tại.
        var r = ModelIntegrity.Check(Model(Node("a", "b", "M1/a"), Node("b", "a", "M1/b")), null);
        Assert.Contains(r, m => m.Contains("chu trình", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_component_type_nobody_declared_is_reported()
    {
        var doc = new ComponentModelDocument(
            1, "M1", new[] { new ComponentNode("a", "st4i.ghost.type", "A", null, "M1/a") }, new[] { Type() });
        var r = ModelIntegrity.Check(doc, null);
        Assert.Contains(r, m => m.Contains("st4i.ghost.type"));
    }

    [Fact]
    public void A_tag_prefix_matching_no_tag_is_reported_only_when_a_namespace_is_supplied()
    {
        var model = Model(Node("a", null, "M1/a"));

        // Chưa có namespace: KHÔNG báo lỗi — cây có thể được khai trước khi connector nạp tag.
        Assert.Empty(ModelIntegrity.Check(model, null));

        var ns = new TagNamespaceDocument(1, "M1", new[]
        {
            new TagDescriptor("M1/b/x", "bool", null, null, null, null, "r", null, new TagSource("simulated"), false),
        });
        Assert.Contains(ModelIntegrity.Check(model, ns), m => m.Contains("M1/a"));
    }

    [Fact]
    public void A_clean_pair_reports_nothing()
    {
        var model = Model(Node("a", null, "M1/a"));
        var ns = new TagNamespaceDocument(1, "M1", new[]
        {
            new TagDescriptor("M1/a/x", "bool", null, null, null, null, "r", null, new TagSource("simulated"), false),
        });
        Assert.Empty(ModelIntegrity.Check(model, ns));
    }

    /// <summary>
    /// 🔴 Task 5 review (WS-HMI-0a) — pins <c>IsPathPrefix</c>'s path-SEGMENT boundary, which
    /// <see cref="ModelIntegrity"/>'s own doc comment describes but nothing before this test measured.
    /// A future "simplify this to plain <c>StartsWith</c>" cleanup would pass every OTHER test in this
    /// file — <c>tagPrefix</c> <c>"M1/a"</c> would falsely match tag path <c>"M1/ab/x"</c>, so a genuine
    /// orphan (no tag actually rooted UNDER <c>M1/a</c>) would silently stop being reported. Confirmed
    /// red against a temporary <c>StartsWith</c> substitution, then reverted — see this task's report.
    /// </summary>
    [Fact]
    public void A_tag_prefix_that_only_shares_characters_with_a_tag_path_is_still_reported_as_orphaned()
    {
        var model = Model(Node("a", null, "M1/a"));
        var ns = new TagNamespaceDocument(1, "M1", new[]
        {
            // "M1/ab/x" STARTS WITH the characters "M1/a", but is not rooted under the SEGMENT "M1/a" —
            // the boundary IsPathPrefix exists to require. If it degraded to StartsWith, this tag would
            // wrongly satisfy node "a"'s tagPrefix and the orphan below would go unreported.
            new TagDescriptor("M1/ab/x", "bool", null, null, null, null, "r", null, new TagSource("simulated"), false),
        });

        Assert.Contains(ModelIntegrity.Check(model, ns), m => m.Contains("M1/a"));
    }

    /// <summary>
    /// 🔴 Review toàn nhánh WS-HMI-0a, Minor 5 — <c>GroupBy(n =&gt; n.Id)…First()</c> HẤP THỤ bản thứ hai
    /// im lặng, nên hai node cùng <c>id: "spindle"</c> báo SẠCH từ một hàm mà việc duy nhất của nó là toàn
    /// vẹn tham chiếu. Tệ hơn là "chỉ hơi lộn xộn": §3.3 phân giải <c>{component}</c> qua đúng cái id ấy,
    /// nên một bản trùng làm binding nhập nhằng lúc chạy trong khi bộ kiểm không nói gì.
    ///
    /// <para><b>Bài này KHÔNG đo:</b> rằng <c>First()</c> đã biến mất. Nó vẫn ở đó, và cố ý: sau khi bản
    /// trùng ĐÃ ĐƯỢC BÁO, chọn một đại diện xác định là cách giữ cho bốn phép kiểm kia chạy tiếp và trả về
    /// TOÀN BỘ vi phạm trong một lượt. Cái được sửa là sự im lặng, không phải phép hấp thụ.</para>
    /// </summary>
    [Fact]
    public void A_duplicate_component_id_is_reported_rather_than_absorbed()
    {
        var r = ModelIntegrity.Check(Model(Node("a", null, "M1/a"), Node("a", null, "M1/a")), null);

        Assert.Contains(r, m => m.Contains("'a'") && m.Contains("2 lần"));
    }

    [Fact]
    public void A_duplicate_component_type_id_is_reported()
    {
        var doc = new ComponentModelDocument(
            1, "M1",
            new[] { new ComponentNode("a", "st4i.motor.spindle", "A", null, "M1/a") },
            new[] { Type(), Type() });

        var r = ModelIntegrity.Check(doc, null);

        Assert.Contains(r, m => m.Contains("st4i.motor.spindle") && m.Contains("2 lần"));
    }

    [Fact]
    public void A_duplicate_id_does_not_stop_the_other_four_checks_from_running()
    {
        // Bản trùng được BÁO rồi mới bị hấp thụ, nên phép kiểm 1 (parentId mồ côi) vẫn phải chạy trên
        // cùng tài liệu ấy. Một bộ kiểm dừng ở lỗi đầu tiên buộc người sửa chạy lại N lần để thấy N lỗi.
        var r = ModelIntegrity.Check(
            Model(Node("a", null, "M1/a"), Node("a", "ghost", "M1/a")), null);

        Assert.Contains(r, m => m.Contains("'a'") && m.Contains("2 lần"));
        Assert.Contains(r, m => m.Contains("ghost"));
    }

    [Fact]
    public void Distinct_ids_and_type_ids_report_nothing()
    {
        // Chiều ngược lại của bốn bài trên: phép kiểm thứ năm không được báo động giả trên một tài liệu
        // sạch, nếu không mọi tài liệu hợp lệ đều mang một vi phạm vô nghĩa.
        Assert.Empty(ModelIntegrity.Check(Model(Node("a", null, "M1/a"), Node("b", null, "M1/b")), null));
    }
}
