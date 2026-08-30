using System.Text.Json.Nodes;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 <b>Nửa .NET của cái ghim schema⟷bộ-gác mà Mốc 0 đã lập ra nhu cầu, và chỉ lập được ở phía TS.</b>
/// Review toàn nhánh WS-HMI-0a, Important 5.
///
/// <para><b>Khuyết tật cụ thể, không phải một mối lo trừu tượng.</b> Vòng sửa của Mốc 0 tìm ra đúng hình
/// dạng này ở phía web: nới <c>access</c> thành <c>["r","rw","w"]</c>, validate một tag <c>"w"</c> KHÔNG
/// có <c>policyAction</c>, nhận về <b>không lỗi nào</b> — rồi đóng bằng một ghim schema↔TS. Phía .NET
/// không có cái tương đương: <c>SchemaPin</c> chỉ so <b>TÊN THUỘC TÍNH</b>, và các record khai mọi enum là
/// <see langword="string"/> một cách có chủ ý, nên không gì đối chiếu <i>giá trị</i>. Trước nhánh này đó
/// là chuyện hình thức. <b>Nhánh này biến chính những chuỗi ấy thành cái gác</b> —
/// <c>TagNamespaceStore.PutAsync</c>/<c>ComponentModelStore.PutAsync</c> gọi
/// <see cref="ContractInvariants.ThrowIfInvalid(TagNamespaceDocument)"/> trước khi mở kết nối — nên nới
/// <c>access</c> hay thêm một <c>role</c> ghi được sẽ khiến ghim TS đỏ trong khi
/// <see cref="ContractInvariants"/> âm thầm thôi gác và store vẫn ghi một tag ghi-được không ai gác.
/// Không gì ở .NET đỏ. Đây là chỗ đóng.
/// </para>
///
/// <para><b>ĐO GÌ — hai khẳng định khác nhau cho mỗi luật, và chúng bắt hai lỗi khác nhau:</b>
/// <list type="number">
///   <item><description><b>Câu <c>if</c> của schema == tập C# gác.</b> Schema tự nói tập nào kích hoạt
///   "bắt buộc có <c>policyAction</c>" (<c>allOf[0].if</c>); <see cref="ContractInvariants"/> nói tập nào
///   nó gác. Hai bên phải bằng nhau. Bắt được: ai đó sửa điều kiện của schema mà quên C#, hoặc ngược
///   lại.</description></item>
///   <item><description><b>Toàn bộ <c>enum</c> == (tập gác ∪ tập MIỄN TRỪ khai tường minh).</b> Bắt được
///   cái mà khẳng định (1) KHÔNG bắt: nới enum thêm một thành viên mới rồi quên cả hai bên — thành viên ấy
///   không thuộc tập nào, và một giá trị chưa được phân loại là chính xác điều kiện sinh ra khuyết tật
///   <c>"w"</c> của Mốc 0.</description></item>
/// </list></para>
///
/// <para>🔴 <b>CÁI GÌ ĐÃ CÓ SẴN, nói ra để không ai đọc file này thành "trước đây không ai ghim enum".</b>
/// Vòng sửa của Mốc 0 đã để lại BA bài ghim enum ở chính project này:
/// <c>TagNamespaceSchemaPinTests.Every_writable_access_is_covered_by_the_policy_action_rule</c>,
/// <c>ComponentModelSchemaPinTests.Every_writable_role_is_covered_by_the_policy_action_rule</c>, và
/// <c>HmiScreenSchemaPinTests.Every_widget_kind_is_declared_once_and_the_writable_ones_are_exactly_two</c>.
/// Chúng đối chiếu <b>schema với CHÍNH NÓ</b> (enum ⟷ câu <c>if</c> của cùng file) cộng một danh sách
/// viết cứng trong bài test. Cái chúng KHÔNG chạm tới, và là toàn bộ lý do file này tồn tại: không bài nào
/// nhắc tới <see cref="ContractInvariants"/>. Sửa <see cref="ContractInvariants.WritableComponentTagRoles"/>
/// bỏ đi <c>"command"</c> mà không đụng schema thì cả ba bài kia vẫn XANH, trong khi
/// <c>ComponentModelStore.PutAsync</c> thôi gác một đường ghi. Bài
/// <see cref="The_schemas_own_if_conditions_name_exactly_the_sets_ContractInvariants_guards"/> là chiều
/// đó, và nó là chiều mới.</para>
///
/// <para><b>Bộ test này KHÔNG đo cái gì:</b> (1) nó KHÔNG kiểm <i>tư cách thành viên</i> lúc chạy — một tài
/// liệu mang <c>access: "rww"</c> vẫn đi qua <see cref="ContractInvariants"/> im lặng, vì bộ kiểm ấy hỏi
/// "có ghi được không", không hỏi "có hợp lệ không"; schema là nơi duy nhất từ chối nó, và
/// <c>web/contract-tests/validate.mjs</c> là nơi duy nhất chạy schema. (2) Nó KHÔNG kiểm rằng có ai GỌI
/// bộ kiểm: hai store gọi, không có store nào ghi <see cref="HmiScreenDocument"/>, nên luật widget đúng mà
/// chưa gác gì — <c>ContractInvariantsTests</c> nói rõ điều đó ở doc-comment của nó. (3) Nó KHÔNG kiểm
/// <c>policyAction</c> mang giá trị nào: bộ kiểm chỉ đòi khác rỗng, nên một
/// <c>policyAction: "machine.reboot"</c> qua được C# và bị schema từ chối — khẳng định thứ ba dưới đây ghim
/// tập ấy ở ba schema để một hành động thứ BA không ra đời lặng lẽ, chứ không biến C# thành bộ kiểm miền.
/// (4) Nó KHÔNG kiểm <c>dataType</c>/<c>tone</c>/<c>theme</c>/<c>breakpoint</c> — không enum nào trong số
/// đó là một cái gác an toàn, và ghim mọi enum chỉ để trông đầy đủ sẽ làm mờ bốn cái thật sự chịu lực.
/// </para>
/// </summary>
public class SchemaEnumGuardPinTests
{
    // Đọc rồi chuẩn hoá \r\n → \n. NÓI THẲNG cho khỏi thành nghi lễ: JsonNode.Parse KHÔNG nhạy với kiểu
    // xuống dòng, nên riêng bộ test này sẽ không bị `core.autocrlf=true` cắn. Việc chuẩn hoá được giữ vì
    // trong kho này chuyện ấy đã cắn HAI lần (cổng hợp đồng Mốc 0 đỏ trên mọi checkout mới vì một regex
    // neo `$`), và người sau thêm một phép so khớp văn bản vào file này sẽ thừa hưởng dạng đã chuẩn hoá
    // thay vì phải tự phát hiện lại.
    static JsonNode Schema(string fileName)
    {
        var raw = File.ReadAllText(ContractFixtures.RepoRelative(fileName));
        return JsonNode.Parse(raw.Replace("\r\n", "\n", StringComparison.Ordinal))!;
    }

    static JsonNode At(JsonNode root, string label, params object[] path)
    {
        JsonNode? cur = root;
        var walked = new List<string>();
        foreach (var seg in path)
        {
            walked.Add(seg.ToString()!);
            cur = seg is int i ? cur?[i] : cur?[(string)seg];
            if (cur is null)
            {
                Assert.Fail(
                    $"{label}: không đi tới được /{string.Join("/", walked)}. CẤU TRÚC SCHEMA ĐÃ ĐỔI, và " +
                    "đó là tin tức chứ không phải phiền toái: sửa đường đi ở đây, đừng xoá khẳng định — " +
                    "việc của nó là báo khi một luật §5 thôi được thi hành ở một trong hai bên.");
            }
        }

        return cur!;
    }

    /// <summary>Đọc một điều kiện của schema thành TẬP giá trị, chấp nhận cả <c>const</c> (một giá trị) lẫn
    /// <c>enum</c> (nhiều giá trị) — schema dùng cả hai dạng cho cùng một loại luật, và một bài chỉ đọc
    /// được một dạng sẽ mù đúng một nửa số luật.</summary>
    static ISet<string> ConstOrEnum(JsonNode node, string label)
    {
        if (node["const"] is { } single)
            return new HashSet<string>(StringComparer.Ordinal) { single.GetValue<string>() };

        if (node["enum"] is JsonArray many)
            return many.Select(n => n!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);

        Assert.Fail($"{label}: nút này không có `const` lẫn `enum`, nên nó không nêu tập giá trị nào.");
        return new HashSet<string>(StringComparer.Ordinal);
    }

    static void AssertSameSet(string label, ISet<string> inSchema, ISet<string> inGuard, string remedy)
    {
        var schemaOnly = inSchema.Except(inGuard).OrderBy(s => s, StringComparer.Ordinal).ToList();
        var guardOnly = inGuard.Except(inSchema).OrderBy(s => s, StringComparer.Ordinal).ToList();
        if (schemaOnly.Count == 0 && guardOnly.Count == 0) return;

        // Hai chiều gộp vào MỘT lần đỏ — cùng lý do SchemaPin.AssertSameNames gộp: hai Assert liên tiếp
        // thì lần thứ hai không bao giờ chạy, và người sửa chỉ thấy nửa chiều lệch mỗi lần.
        var parts = new List<string>();
        if (schemaOnly.Count > 0)
            parts.Add($"schema nói GHI ĐƯỢC nhưng ContractInvariants KHÔNG gác: {string.Join(", ", schemaOnly)}");
        if (guardOnly.Count > 0)
            parts.Add($"ContractInvariants gác nhưng schema không nói: {string.Join(", ", guardOnly)}");

        Assert.Fail($"{label}: {string.Join(" | ", parts)}. {remedy}");
    }

    [Fact]
    public void The_schemas_own_if_conditions_name_exactly_the_sets_ContractInvariants_guards()
    {
        var tags = Schema("tag-namespace.schema.json");
        var model = Schema("component-model.schema.json");
        var screen = Schema("hmi-screen.schema.json");

        const string Remedy =
            "Sửa CẢ HAI bên trong một lần: điều kiện `if` của schema và tập tương ứng ở đầu " +
            "src/St4i.Hmi.Contracts/ContractInvariants.cs. Một bên đi trước bên kia nghĩa là cửa ghi của " +
            "store thôi gác một giá trị mà schema vẫn coi là đường ghi — chính xác khuyết tật `\"w\"` mà " +
            "vòng sửa của Mốc 0 đo được ở phía web.";

        AssertSameSet(
            "tag-namespace $defs.tag.allOf[0].if (access ⇒ policyAction)",
            ConstOrEnum(At(tags, "tag-namespace", "$defs", "tag", "allOf", 0, "if", "properties", "access"),
                        "tag-namespace access if"),
            ContractInvariants.WritableTagAccess.ToHashSet(StringComparer.Ordinal),
            Remedy);

        AssertSameSet(
            "component-model $defs.componentTag.allOf[0].if (role ⇒ policyAction)",
            ConstOrEnum(At(model, "component-model", "$defs", "componentTag", "allOf", 0, "if", "properties", "role"),
                        "component-model role if"),
            ContractInvariants.WritableComponentTagRoles.ToHashSet(StringComparer.Ordinal),
            Remedy);

        AssertSameSet(
            "component-model $defs.componentTag.allOf[1].if (role ⇒ min+max)",
            ConstOrEnum(At(model, "component-model", "$defs", "componentTag", "allOf", 1, "if", "properties", "role"),
                        "component-model hard-band if"),
            ContractInvariants.HardBandComponentTagRoles.ToHashSet(StringComparer.Ordinal),
            Remedy);

        AssertSameSet(
            "hmi-screen $defs.widget.allOf[0].if (kind ⇒ policyAction)",
            ConstOrEnum(At(screen, "hmi-screen", "$defs", "widget", "allOf", 0, "if", "properties", "kind"),
                        "hmi-screen kind if"),
            ContractInvariants.WritableWidgetKinds.ToHashSet(StringComparer.Ordinal),
            Remedy);
    }

    /// <summary>Danh sách MIỄN TRỪ khai tường minh — §2 của skill đòi nó phải là một lời khai, không phải
    /// một thói quen ngầm. Mỗi giá trị dưới đây là một thành viên enum mà bộ kiểm CỐ Ý không gác, vì nó
    /// không phải đường ghi. Thêm một thành viên enum mà không xếp nó vào một trong hai tập ⇒ đỏ.</summary>
    public static TheoryData<string, string, string[], string[]> UnguardedEnumMembers() => new()
    {
        {
            "tag-namespace.schema.json", "access",
            new[] { "$defs", "tag", "properties", "access" },
            new[] { "r" }
        },
        {
            "component-model.schema.json", "componentTag.role",
            new[] { "$defs", "componentTag", "properties", "role" },
            new[] { "in", "out" }
        },
        {
            "hmi-screen.schema.json", "widget.kind",
            new[] { "$defs", "widget", "properties", "kind" },
            new[]
            {
                "readout", "status-lamp", "gauge", "trend", "alarm-banner", "alarm-list",
                "log", "faceplate", "label", "sheet", "kpi-tile", "state-badge", "line-state",
            }
        },
    };

    [Theory]
    [MemberData(nameof(UnguardedEnumMembers))]
    public void Every_enum_member_is_either_guarded_or_explicitly_exempt(
        string schemaFile, string label, string[] pointer, string[] exempt)
    {
        var declared = ConstOrEnum(
            At(Schema(schemaFile), schemaFile, pointer.Cast<object>().ToArray()), $"{schemaFile} {label}");

        // Không rỗng: một pointer hụt hay một enum bị xoá làm phép so sánh dưới đây thoả mãn một cách
        // rỗng tuếch, và một bài "xanh vì không đo gì" là đúng thứ §2 gọi tên.
        Assert.NotEmpty(declared);
        Assert.NotEmpty(exempt);

        var guarded = schemaFile switch
        {
            "tag-namespace.schema.json" => ContractInvariants.WritableTagAccess,
            "component-model.schema.json" => ContractInvariants.WritableComponentTagRoles,
            "hmi-screen.schema.json" => ContractInvariants.WritableWidgetKinds,
            _ => throw new ArgumentOutOfRangeException(nameof(schemaFile), schemaFile, "chưa khai tập gác"),
        };

        var classified = guarded.Concat(exempt).ToHashSet(StringComparer.Ordinal);

        // Miễn trừ phải còn SỐNG: một mục miễn trừ trỏ tới thành viên đã biến mất khỏi schema là một
        // danh sách đang mục, và nó sẽ âm thầm che một thành viên khác trong lần sửa sau.
        var deadExemptions = exempt.Except(declared).OrderBy(s => s, StringComparer.Ordinal).ToList();
        Assert.True(deadExemptions.Count == 0,
            $"{schemaFile} · {label}: danh sách miễn trừ nêu {string.Join(", ", deadExemptions)}, nhưng " +
            "schema không còn khai (những) giá trị ấy. Xoá mục miễn trừ đã chết thay vì để nó ở lại.");

        var unclassified = declared.Except(classified).OrderBy(s => s, StringComparer.Ordinal).ToList();
        Assert.True(unclassified.Count == 0,
            $"{schemaFile} · {label}: enum có (những) thành viên MỚI chưa được phân loại: " +
            $"{string.Join(", ", unclassified)}. Quyết định cho từng cái: nếu nó là ĐƯỜNG GHI thì thêm vào " +
            "tập tương ứng ở ContractInvariants VÀ vào điều kiện `if` của schema; nếu không thì thêm vào " +
            "danh sách miễn trừ của bài test này, ngay tại chỗ, để lần sau người đọc thấy quyết định chứ " +
            "không thấy một khoảng trống. Đây chính là hình dạng của khuyết tật `\"w\"` mà vòng sửa Mốc 0 " +
            "đo được: một thành viên enum ghi được, không ai gác, không gì đỏ.");
    }

    [Fact]
    public void All_three_schemas_declare_the_same_two_policy_actions()
    {
        // ContractInvariants chỉ đòi policyAction KHÁC RỖNG, không đòi nó là thành viên hợp lệ (xem đoạn
        // "KHÔNG đo" ở đầu file). Cái được ghim ở đây là phần schema: ba hợp đồng phải nói CÙNG một tập,
        // và tập ấy phải là hai hành động PolicyEngine thật sự có vai gắn với nó (§3 của skill:
        // machine.setpoint → Engineer, machine.command → Admin). Một hành động THỨ BA ra đời lặng lẽ ở một
        // schema là một đường ghi mới mà không ai quyết định vai cho nó.
        var expected = new HashSet<string>(StringComparer.Ordinal) { "machine.setpoint", "machine.command" };

        var sets = new (string File, object[] Pointer)[]
        {
            ("tag-namespace.schema.json", new object[] { "$defs", "tag", "properties", "policyAction" }),
            ("component-model.schema.json", new object[] { "$defs", "componentTag", "properties", "policyAction" }),
            ("hmi-screen.schema.json", new object[] { "$defs", "widget", "properties", "policyAction" }),
        };

        foreach (var (file, pointer) in sets)
        {
            var declared = ConstOrEnum(At(Schema(file), file, pointer), $"{file} policyAction");
            Assert.True(declared.SetEquals(expected),
                $"{file}: policyAction khai [{string.Join(", ", declared.OrderBy(s => s, StringComparer.Ordinal))}] " +
                $"chứ không phải [{string.Join(", ", expected.OrderBy(s => s, StringComparer.Ordinal))}]. Ba hợp " +
                "đồng phải nói cùng một tập; một hành động mới cần một vai ở PolicyEngine trước khi nó có " +
                "mặt ở đây.");
        }
    }
}
