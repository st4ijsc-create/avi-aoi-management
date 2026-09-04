// The metadata guard below reads the COMPILED contracts assembly rather than its source text — see
// ContractInvariants_uses_one_missing_string_predicate_at_every_site for why a text scan was evadable.
// PEReader.GetMetadataReader() is an extension method living in this namespace.
using System.Reflection.Metadata;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 Bất biến an toàn §5 ở phía C#. Lý do tồn tại, nói thẳng: schema JSON từ chối được một tag ghi
/// không gác, nhưng các record C# khai mọi enum là <see langword="string"/>, nên một producer .NET
/// dựng <c>Access: "rw", PolicyAction: null</c> và serialize sẽ tạo ra một tài liệu vi phạm mà KHÔNG
/// gì trong cây .NET phản đối — chỉ bộ validate phía web bắt được, và chỉ khi ai đó chạy nó. Review
/// toàn nhánh của Mốc 0 gọi tên bất đối xứng ấy; đây là chỗ đóng nó.
///
/// <para><b>Bộ test này KHÔNG đo cái gì:</b> (1) nó KHÔNG là bộ validate JSON Schema — nó chỉ kiểm ba
/// luật §5, không kiểm pattern, kiểu, hay trường lạ; một tài liệu xanh ở đây vẫn có thể bị schema từ
/// chối vì lý do khác. Bộ validate schema duy nhất trong cây là <c>web/contract-tests/validate.mjs</c>;
/// (2) nó KHÔNG kiểm toàn vẹn tham chiếu giữa hai tài liệu — đó là <c>ModelIntegrityTests</c>;
/// (3) nó KHÔNG chạy khi ai đó tự serialize thẳng bằng <c>JsonSerializer</c> mà không qua store — bảo
/// vệ chỉ có ở cửa ghi, và đó là giới hạn có chủ ý chứ không phải sơ suất.</para>
///
/// <para>📎 🔴 <b>"nó chỉ kiểm ba luật §5" GIỮ NGUYÊN VĂN nhưng KHÔNG CÒN ĐÚNG, 2026-08-30</b> (review
/// toàn nhánh WS-HMI-0a, Important 3 + Important 4). Số luật nay là NĂM, và một trong năm không phải luật
/// §5: (a) tag <c>rw</c> ⇒ <c>policyAction</c>; (b) 🔴 <c>path</c> DUY NHẤT trong một tài liệu — luật của
/// <c>TagNamespaceStore</c> chứ không phải của §5, kéo lên cửa để nó đỏ thành
/// <c>ContractViolationException</c> (→ 400) thay vì <c>SqliteException</c> (→ 500); (c) componentTag
/// <c>setpoint|command</c> ⇒ <c>policyAction</c>; (d) componentTag <c>setpoint</c> ⇒ <c>min</c>+<c>max</c>;
/// (e) 🔴 widget <c>setpoint-input|command-button</c> ⇒ <c>policyAction</c>.
/// <b>THÊM MỘT THỨ BỘ NÀY KHÔNG ĐO:</b> nó không đo cửa nào GỌI bộ kiểm. Hai store gọi
/// <c>ThrowIfInvalid</c>; không có store nào ghi <c>HmiScreenDocument</c>, nên luật (e) đúng và chưa gác
/// gì cả. Và nó không đo hai máy khác nhau cùng khai một <c>path</c> — luật (b) thuần trên MỘT tài liệu,
/// va chạm liên-máy vẫn nổ ở tầng SQLite.</para>
/// </summary>
public class ContractInvariantsTests
{
    static TagSource Sim() => new("simulated");

    static TagDescriptor Tag(string access, string? policyAction, string path = "M1/x/y") =>
        new(path, "bool", null, null, null, null, access, policyAction, Sim(), false);

    static TagNamespaceDocument Ns(params TagDescriptor[] tags) => new(1, "M1", tags);

    static WidgetRect Rect() => new(0, 0, 1, 1);

    static HmiScreenDocument Screen(params ScreenWidget[] widgets) =>
        new(1, "s1", "Màn hình", null, "isa101", new ScreenLayout(12, 8, "panel"), widgets);

    [Fact]
    public void A_writable_tag_without_a_policy_action_is_a_violation()
    {
        var violations = ContractInvariants.Validate(Ns(Tag("rw", null)));
        Assert.Single(violations);
        Assert.Contains("M1/x/y", violations[0]);
        Assert.Contains("policyAction", violations[0]);
    }

    [Fact]
    public void A_read_only_tag_without_a_policy_action_is_fine()
    {
        Assert.Empty(ContractInvariants.Validate(Ns(Tag("r", null))));
    }

    [Fact]
    public void A_writable_tag_with_a_policy_action_is_fine()
    {
        Assert.Empty(ContractInvariants.Validate(Ns(Tag("rw", "machine.setpoint"))));
    }

    [Fact]
    public void Every_violation_is_reported_not_just_the_first()
    {
        // Một danh sách lỗi cụt buộc người sửa phải chạy lại N lần để thấy N lỗi. Bài này ghim rằng
        // bộ kiểm đi hết tài liệu — cùng lý do AssertSameNames của Mốc 0 gộp hai chiều vào một lần đỏ.
        // 🔴 2026-08-30: hai tag này phải mang HAI path khác nhau. Trước khi luật trùng-path tồn tại,
        // bài này dùng hai lần Tag("rw", null) mặc định — cùng path "M1/x/y" — nên nó sẽ đếm được BA vi
        // phạm chứ không phải hai, và người đọc sẽ tưởng bộ kiểm đếm sai. Đo đúng một luật mỗi lần.
        var violations = ContractInvariants.Validate(Ns(Tag("rw", null, "M1/x/y"), Tag("rw", null, "M1/x/z")));
        Assert.Equal(2, violations.Count);
    }

    /// <summary>🔴 Review toàn nhánh WS-HMI-0a, Important 3 — <c>tag_index.path</c> là khoá chính TOÀN CỤC
    /// và <c>PutAsync</c> nạp chỉ mục bằng <c>INSERT</c> trần, nhưng mảng <c>tags</c> của schema KHÔNG có
    /// ràng buộc duy nhất: một tài liệu khai cùng path hai lần là hợp lệ với schema và nổ thành
    /// <c>UNIQUE constraint failed</c> ở tận SQLite. Bản đồ lỗi→HTTP của WS-HMI-0b chỉ ánh xạ
    /// <c>ContractViolationException</c> sang 400, nên trước bài này một tài liệu do client soạn hạ cánh
    /// thành 500 không lời giải thích.</summary>
    [Fact]
    public void A_path_declared_twice_in_one_document_is_a_violation()
    {
        var violations = ContractInvariants.Validate(
            Ns(Tag("r", null, "M1/x/y"), Tag("r", null, "M1/x/y")));

        Assert.Single(violations);
        Assert.Contains("M1/x/y", violations[0]);
        Assert.Contains("nhiều lần", violations[0]);
    }

    [Fact]
    public void A_path_declared_three_times_is_reported_once_not_twice()
    {
        // MỘT path trùng là MỘT lỗi cần sửa. Ba dòng giống hệt nhau chỉ làm loãng danh sách mà không
        // thêm thông tin nào cho người sửa.
        var violations = ContractInvariants.Validate(
            Ns(Tag("r", null, "M1/dup"), Tag("r", null, "M1/dup"), Tag("r", null, "M1/dup")));

        Assert.Single(violations);
    }

    [Fact]
    public void Two_tags_with_different_paths_are_fine()
    {
        Assert.Empty(ContractInvariants.Validate(
            Ns(Tag("r", null, "M1/a/x"), Tag("r", null, "M1/b/x"))));
    }

    [Fact]
    public void A_duplicate_path_and_an_ungated_write_are_BOTH_reported()
    {
        // Hai luật khác nhau trên cùng một tài liệu: cả hai phải có mặt, vì một người sửa chỉ thấy một
        // nửa sẽ ghi lại tài liệu và gặp nửa kia ở lần thứ hai.
        var violations = ContractInvariants.Validate(
            Ns(Tag("rw", null, "M1/dup"), Tag("r", null, "M1/dup")));

        Assert.Equal(2, violations.Count);
        Assert.Contains(violations, v => v.Contains("policyAction", StringComparison.Ordinal));
        Assert.Contains(violations, v => v.Contains("nhiều lần", StringComparison.Ordinal));
    }

    /// <summary>🔴 Review toàn nhánh WS-HMI-0a, Important 4 — luật §5 nói TRỰC TIẾP nhất (một nút lệnh
    /// không có <c>policyAction</c> là một đường ghi không gác) là luật DUY NHẤT trong ba hợp đồng đã đóng
    /// băng mà phía .NET không kiểm, cho tới 2026-08-30.
    ///
    /// <para><b>Bốn bài dưới đây KHÔNG đo:</b> rằng có ai đó GỌI bộ kiểm này. Không có store .NET nào ghi
    /// một tài liệu màn hình, nên <c>ThrowIfInvalid(HmiScreenDocument)</c> chưa có người gọi và luật này
    /// đúng mà chưa gác gì. Đó là chỗ WS-HMI-0b tiếp nhận.</para></summary>
    [Fact]
    public void A_command_button_without_a_policy_action_is_a_violation()
    {
        // Đây chính xác là phép dựng mà Task 1 tồn tại để chặn: biên dịch được, schema từ chối, và trước
        // 2026-08-30 không gì trong cây .NET phản đối.
        var violations = ContractInvariants.Validate(
            Screen(new ScreenWidget("b1", "command-button", Rect(), PolicyAction: null)));

        Assert.Single(violations);
        Assert.Contains("b1", violations[0]);
        Assert.Contains("policyAction", violations[0]);
    }

    [Fact]
    public void A_setpoint_input_without_a_policy_action_is_a_violation()
    {
        var violations = ContractInvariants.Validate(
            Screen(new ScreenWidget("sp1", "setpoint-input", Rect(), PolicyAction: null)));

        Assert.Single(violations);
        Assert.Contains("sp1", violations[0]);
    }

    [Fact]
    public void A_read_only_widget_without_a_policy_action_is_fine()
    {
        Assert.Empty(ContractInvariants.Validate(
            Screen(new ScreenWidget("r1", "readout", Rect(), PolicyAction: null))));
    }

    [Fact]
    public void Every_widget_violation_is_reported_and_ThrowIfInvalid_carries_them_all()
    {
        var screen = Screen(
            new ScreenWidget("b1", "command-button", Rect(), PolicyAction: null),
            new ScreenWidget("sp1", "setpoint-input", Rect(), PolicyAction: null),
            new ScreenWidget("ok", "command-button", Rect(), PolicyAction: "machine.command"));

        Assert.Equal(2, ContractInvariants.Validate(screen).Count);

        var ex = Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(screen));
        Assert.Equal(2, ex.Violations.Count);
    }

    [Fact]
    public void ThrowIfInvalid_carries_every_violation_on_the_exception()
    {
        var ex = Assert.Throws<ContractViolationException>(
            () => ContractInvariants.ThrowIfInvalid(Ns(Tag("rw", null))));
        Assert.Single(ex.Violations);
    }

    [Fact]
    public void A_setpoint_component_tag_needs_a_policy_action_and_a_hard_band()
    {
        var type = new ComponentTypeDef(
            "st4i.motor.spindle", "Spindle",
            new[] { new ComponentTagDef("target", "setpoint", "float", null, "Nm", null, null, null) },
            Array.Empty<ComponentStateDef>(), "fp.motor.spindle");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        var violations = ContractInvariants.Validate(doc);

        // Ba luật vi phạm cùng lúc: policyAction, min, max — và cả ba phải được nêu.
        Assert.Equal(3, violations.Count);
        Assert.All(violations, v => Assert.Contains("target", v));
    }

    [Fact]
    public void An_input_component_tag_needs_neither()
    {
        var type = new ComponentTypeDef(
            "st4i.sensor.temp", "Temp",
            new[] { new ComponentTagDef("value", "in", "float", null, "°C", null, null, null) },
            Array.Empty<ComponentStateDef>(), "fp.sensor.analog");
        Assert.Empty(ContractInvariants.Validate(
            new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type })));
    }

    /// <summary>WS-HMI-0b Task 1, fix round 1, HIGH-2 — a body that OMITS <c>components</c> lands here as a
    /// genuine runtime <see langword="null"/>, not an empty list: C#'s non-nullable annotation on
    /// <see cref="ComponentModelDocument.Components"/> does not survive <c>System.Text.Json</c>
    /// deserializing a missing field (neither <c>RespectNullableAnnotations</c> nor
    /// <c>RespectRequiredConstructorParameters</c> is enabled anywhere in this solution). Before this test,
    /// <see cref="ContractInvariants.Validate(ComponentModelDocument)"/> never read <c>doc.Components</c> at
    /// all, so a null here passed the §5 door silently and only crashed later, downstream, in
    /// <c>St4i.EngineApi.HmiModel.ModelIntegrity.Check</c> — AFTER <c>ComponentModelStore.PutAsync</c> had
    /// already written it. Constructed with <c>null!</c> deliberately: this is not a "can't happen" case,
    /// it is exactly what a malformed request produces at this exact type.</summary>
    [Fact]
    public void A_null_Components_is_a_violation_not_a_silent_pass()
    {
        var doc = new ComponentModelDocument(1, "M1", null!, Array.Empty<ComponentTypeDef>());

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("components", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The symmetric case for <see cref="ComponentModelDocument.Types"/>. Before this test, a null
    /// <c>Types</c> was NOT silently absorbed — the opposite failure: <c>foreach (var type in doc.Types)</c>
    /// dereferenced it immediately and threw <see cref="NullReferenceException"/> out of
    /// <c>Validate</c> itself, before a single violation could be collected, and before the store's own
    /// write (a symmetric-looking but luckier bug, since it happened to crash BEFORE
    /// <c>ComponentModelStore.PutAsync</c> writes anything — see this task's review for why that asymmetry
    /// was luck, not design). Both are now ordinary, reported §5 violations instead of either failure
    /// mode.</summary>
    [Fact]
    public void A_null_Types_is_a_violation_not_a_NullReferenceException()
    {
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), null!);

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("types", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Fix round 2, LOW-6 — renamed from
    /// <c>ThrowIfInvalid_rejects_a_null_Components_document_before_any_write_could_happen</c>: the old name
    /// promised a WRITE-ORDERING property ("before any write could happen") that this test cannot measure —
    /// there is no store anywhere in this assembly. It asserts only that <c>ThrowIfInvalid</c> throws. The
    /// ordering property it was gesturing at IS measured, correctly, by
    /// <c>ComponentModelStoreTests.A_document_violating_the_safety_invariant_is_refused_and_nothing_is_written</c>
    /// in <c>St4i.EngineApi.Tests</c> — this test's job is narrower: that a null <c>Components</c> reaches
    /// <c>ThrowIfInvalid</c> as an exception at all, not where in a request's lifecycle that happens.</summary>
    [Fact]
    public void ThrowIfInvalid_throws_ContractViolationException_for_a_null_Components_document()
    {
        var doc = new ComponentModelDocument(1, "M1", null!, Array.Empty<ComponentTypeDef>());

        var ex = Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(doc));

        Assert.Contains(ex.Violations, v => v.Contains("components", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_null_Components_and_a_null_Types_are_BOTH_reported_in_one_pass()
    {
        var doc = new ComponentModelDocument(1, "M1", null!, null!);

        var violations = ContractInvariants.Validate(doc);

        Assert.Equal(2, violations.Count);
        Assert.Contains(violations, v => v.Contains("components", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(violations, v => v.Contains("types", StringComparison.OrdinalIgnoreCase));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 2, HIGH-B — Validate(ComponentModelDocument) checked the two COLLECTIONS for null but never
    // read an ELEMENT. Re-review's own measurement: `{"components":[{}]}` (an empty component object) passed
    // the door, was WRITTEN by ComponentModelStore.PutAsync, and crashed inside
    // St4i.EngineApi.HmiModel.ModelIntegrity.Check with ArgumentNullException (a null ComponentNode.Id used
    // as a Dictionary key) — the exact HIGH-2 shape, one level down. These pin the fix at the CONTRACTS
    // level: a null element, or a null Id/TagPrefix on a non-null element, is now an ordinary violation.
    // ─────────────────────────────────────────────────────────────────────

    static ComponentNode Node(string id = "n1", string typeId = "st4i.motor.spindle", string tagPrefix = "M1/n1") =>
        new(id, typeId, "N1", null, tagPrefix);

    static ComponentTypeDef Type(string typeId = "st4i.motor.spindle") =>
        new(typeId, typeId, Array.Empty<ComponentTagDef>(), Array.Empty<ComponentStateDef>(), "fp.x");

    /// <summary>Reproduces the re-review's exact probe (<c>{"components":[{}]}</c>) at the Contracts level:
    /// a <see cref="ComponentNode"/> whose four required <see langword="string"/> fields are ALL null — the
    /// literal shape <c>System.Text.Json</c> produces from an empty JSON object <c>{}</c>.</summary>
    [Fact]
    public void A_component_with_null_Id_and_null_TagPrefix_is_a_violation_not_a_downstream_crash()
    {
        var node = new ComponentNode(null!, null!, null!, null, null!);
        var doc = new ComponentModelDocument(1, "M1", new[] { node }, Array.Empty<ComponentTypeDef>());

        var violations = ContractInvariants.Validate(doc);

        // Id and tagPrefix are the two fields whose null-ness is what actually crashes
        // ModelIntegrity.Check (a Dictionary key, and a string index bound inside IsPathPrefix,
        // respectively) — both must be reported, not just one.
        Assert.Contains(violations, v => v.Contains("id", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(violations, v => v.Contains("tagPrefix", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_null_element_in_Components_is_a_violation_not_an_exception()
    {
        var doc = new ComponentModelDocument(1, "M1", new ComponentNode?[] { null }!, Array.Empty<ComponentTypeDef>());

        var violations = ContractInvariants.Validate(doc);

        Assert.NotEmpty(violations);
    }

    [Fact]
    public void A_null_element_in_Types_is_a_violation_not_an_exception()
    {
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new ComponentTypeDef?[] { null }!);

        var violations = ContractInvariants.Validate(doc);

        Assert.NotEmpty(violations);
    }

    /// <summary>The sibling shape the re-review found surviving TWO LINES below the fix round 1 repair,
    /// inside the very method that was supposed to have closed it: <c>type.Tags</c> omitted (a
    /// <see cref="ComponentTypeDef"/> whose <c>tags</c> array System.Text.Json leaves null) threw a bare
    /// <see cref="NullReferenceException"/> from <c>foreach (var t in type.Tags)</c>, before a single
    /// violation could be collected — the exact "luck, not design" failure mode
    /// <see cref="ContractInvariants.Validate(ComponentModelDocument)"/>'s own doc comment claimed had been
    /// eliminated.</summary>
    [Fact]
    public void A_componentType_with_null_Tags_is_a_violation_not_a_NullReferenceException()
    {
        var type = new ComponentTypeDef("t1", "T1", null!, Array.Empty<ComponentStateDef>(), "fp.x");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("tags", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_null_element_in_a_componentType_Tags_array_is_a_violation_not_an_exception()
    {
        var type = new ComponentTypeDef(
            "t1", "T1", new ComponentTagDef?[] { null }!, Array.Empty<ComponentStateDef>(), "fp.x");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        var violations = ContractInvariants.Validate(doc);

        Assert.NotEmpty(violations);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 2 — the twins the re-review found sharing the identical unguarded dereference:
    // Validate(TagNamespaceDocument) at the old :122 (doc.Tags) and Validate(HmiScreenDocument) at the old
    // :211 (doc.Widgets). Neither is HTTP-reachable today, but TagNamespaceDocument becomes reachable in
    // Task 2 of this very plan (PUT /v1/tags/{machineCode}) — fixed now rather than shipped broken on day
    // one of that task. HmiScreenDocument fixed alongside it while the reasoning is in front of us, per the
    // same "the mechanism is not specific to one document type" observation.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>WS-HMI-0c MED-3 — the schema-required-field presence checks, pinned in the assembly that OWNS
    /// them.</b> They were added during 0c and every test that exercised them lived in
    /// <c>St4i.EngineApi.Tests</c>, so this assembly — the one whose <c>Validate</c> the rule belongs to —
    /// had nothing to say about its own behaviour.
    ///
    /// <para>Before the fix, an entry omitting <c>source</c> parsed, compiled, drew ZERO violations, threw
    /// nothing, and serialised with <c>source</c> absent: a document the frozen schema FORBIDS was stored
    /// and served. This class's own disclosure had named these three as "deliberately NOT checked" on a
    /// crash-safety criterion, which was true of the question it asked and silent on this one.</para>
    ///
    /// <para>Does not measure: full schema validity. Presence only — no pattern, no enum membership, no
    /// <c>additionalProperties</c>. A <c>dataType</c> of <c>"xyzzy"</c> still passes here, and that remains
    /// this class's declared non-fix.</para>
    /// </summary>
    [Theory]
    [InlineData("dataType")]
    [InlineData("source")]
    [InlineData("source.kind")]
    public void A_schema_required_field_missing_from_a_tag_is_a_violation(string missing)
    {
        var source = missing switch
        {
            "source" => null,
            "source.kind" => new TagSource(null!, UnitId: 1, Register: 1),
            _ => new TagSource("modbus", UnitId: 1, Register: 1),
        };

        var doc = new TagNamespaceDocument(1, "M1", new[]
        {
            new TagDescriptor("M1/oven/temp", missing == "dataType" ? null! : "float",
                "C", 0, 300, null, "r", null, source!, false),
        });

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains(missing.Split('.')[^1], StringComparison.Ordinal));
    }

    /// <summary>A fully-populated tag draws no violation from the checks above — so the theory is measuring
    /// the missing field rather than something the fixture always trips.
    ///
    /// <para>Does not measure: the §5 policyAction rule, which has its own tests in this file.</para></summary>
    [Fact]
    public void A_tag_with_every_schema_required_field_present_draws_no_presence_violation()
    {
        var doc = new TagNamespaceDocument(1, "M1", new[]
        {
            new TagDescriptor("M1/oven/temp", "float", "C", 0, 300, null, "r", null,
                new TagSource("modbus", UnitId: 1, Register: 1), false),
        });

        Assert.Empty(ContractInvariants.Validate(doc));
    }

    [Fact]
    public void A_null_Tags_on_a_TagNamespaceDocument_is_a_violation_not_a_NullReferenceException()
    {
        var doc = new TagNamespaceDocument(1, "M1", null!);

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("tags", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_null_element_in_a_TagNamespaceDocuments_Tags_is_a_violation_not_an_exception()
    {
        var doc = new TagNamespaceDocument(1, "M1", new TagDescriptor?[] { null }!);

        var violations = ContractInvariants.Validate(doc);

        Assert.NotEmpty(violations);
    }

    [Fact]
    public void ThrowIfInvalid_throws_ContractViolationException_not_NullReferenceException_for_a_null_Tags_namespace()
    {
        var doc = new TagNamespaceDocument(1, "M1", null!);
        Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(doc));
    }

    [Fact]
    public void A_null_Widgets_on_an_HmiScreenDocument_is_a_violation_not_a_NullReferenceException()
    {
        var doc = new HmiScreenDocument(1, "s1", "Màn hình", null, "isa101", new ScreenLayout(12, 8, "panel"), null!);

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("widgets", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_null_element_in_an_HmiScreenDocuments_Widgets_is_a_violation_not_an_exception()
    {
        var doc = new HmiScreenDocument(
            1, "s1", "Màn hình", null, "isa101", new ScreenLayout(12, 8, "panel"), new ScreenWidget?[] { null }!);

        var violations = ContractInvariants.Validate(doc);

        Assert.NotEmpty(violations);
    }

    [Fact]
    public void ThrowIfInvalid_throws_ContractViolationException_not_NullReferenceException_for_a_null_Widgets_screen()
    {
        var doc = new HmiScreenDocument(1, "s1", "Màn hình", null, "isa101", new ScreenLayout(12, 8, "panel"), null!);
        Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(doc));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 3 — re-review #2 measured that the twin fix (round 2) closed element-NULL depth but not
    // element-FIELD depth: TagDescriptor.Path is the exact analogue of ComponentNode.TagPrefix (bound as
    // tag_index's PRIMARY KEY parameter, AND the unguarded `path` argument to ModelIntegrity.IsPathPrefix),
    // and Validate(TagNamespaceDocument) let it through at 0 violations, after which
    // TagNamespaceStore.PutAsync threw InvalidOperationException ("Value must be set.") — not a
    // ContractViolationException, so not a 400. Same enumeration method as round 2's HIGH-B fix: list every
    // field the STORE and ModelIntegrity dereference, reach each with a null, confirm a violation instead
    // of an exception. Access is added for a DIFFERENT, non-crash reason — see the tests below.
    // ─────────────────────────────────────────────────────────────────────

    static TagDescriptor TagWith(string? path, string? access, string? policyAction = null) =>
        new(path!, "bool", null, null, null, null, access!, policyAction, Sim(), false);

    [Fact]
    public void A_tag_with_null_Path_is_a_violation_not_a_downstream_crash()
    {
        var doc = new TagNamespaceDocument(1, "M1", new[] { TagWith(path: null, access: "r") });

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("path", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Re-review #2's exact measurement, reproduced at the door: a document that passes
    /// <see cref="ContractInvariants.Validate(TagNamespaceDocument)"/> with a null <c>Path</c> makes
    /// <c>TagNamespaceStore.PutAsync</c> throw <see cref="InvalidOperationException"/> — a raw ADO.NET
    /// exception, not the <see cref="ContractViolationException"/> the whole error→HTTP map depends on to
    /// produce a 400 instead of a 500.</summary>
    [Fact]
    public void ThrowIfInvalid_throws_ContractViolationException_for_a_null_Path_tag()
    {
        var doc = new TagNamespaceDocument(1, "M1", new[] { TagWith(path: null, access: "r") });
        Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(doc));
    }

    /// <summary>A DIFFERENT reason than a crash: <c>WritableTagAccess.Contains(t.Access)</c> reads a null
    /// <c>Access</c> as "not writable" (<c>HashSet&lt;string&gt;.Contains(null)</c> is <see langword="false"/>,
    /// not an exception) — so a <c>"rw"</c> tag whose <c>access</c> was accidentally omitted would silently
    /// skip the very policyAction check this class exists to enforce. Same silent-bypass shape as a null
    /// <c>role</c>/<c>kind</c> below, one field over.</summary>
    [Fact]
    public void A_tag_with_null_Access_is_a_violation_not_a_silent_5_bypass()
    {
        var doc = new TagNamespaceDocument(1, "M1", new[] { TagWith(path: "M1/x", access: null) });

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("access", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Re-review #2, LOW-4: <c>ComponentModelDocument.MachineCode</c> was absent from the BOUNDARY
    /// paragraph's "declared-but-deliberately-unchecked" list, and the omission was not harmless —
    /// <c>ComponentModelStore.PutAsync(new ComponentModelDocument(1, null!, [], []))</c> throws
    /// <see cref="InvalidOperationException"/> ("Value must be set."), not a
    /// <see cref="ContractViolationException"/>. Closed by an actual check rather than by documenting the
    /// gap — the same choice made for <see cref="TagNamespaceDocument.MachineCode"/> just below, since
    /// <c>TagNamespaceStore.PutAsync</c> binds it the identical way.</summary>
    [Fact]
    public void A_null_or_empty_MachineCode_on_a_ComponentModelDocument_is_a_violation()
    {
        var doc1 = new ComponentModelDocument(1, null!, Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>());
        var doc2 = new ComponentModelDocument(1, "", Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>());

        Assert.Contains(ContractInvariants.Validate(doc1), v => v.Contains("machineCode", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(ContractInvariants.Validate(doc2), v => v.Contains("machineCode", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ThrowIfInvalid_throws_ContractViolationException_for_a_null_MachineCode_ComponentModelDocument()
    {
        var doc = new ComponentModelDocument(1, null!, Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>());
        Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(doc));
    }

    [Fact]
    public void A_null_or_empty_MachineCode_on_a_TagNamespaceDocument_is_a_violation()
    {
        var doc = new TagNamespaceDocument(1, null!, Array.Empty<TagDescriptor>());
        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("machineCode", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Re-review #2, LOW-5: the sibling check (<see cref="ComponentNode.TagPrefix"/>, above) used
    /// <c>string.IsNullOrEmpty</c> in round 2, which accepts a whitespace-only <c>" "</c> as "present" — a
    /// perfectly good <c>Dictionary</c> key, but not a usable <c>{component}</c> binding target, and not
    /// what an engineer means by "declared". Switched to <c>IsNullOrWhiteSpace</c> so both halves of one
    /// fix agree on what "missing" means — matching <c>HmiModelEndpoints.cs</c>'s own route/body-code guard,
    /// which already used <c>IsNullOrWhiteSpace</c>.</summary>
    [Fact]
    public void A_component_with_whitespaceOnly_Id_and_TagPrefix_is_a_violation()
    {
        var node = new ComponentNode(" ", "st4i.motor.spindle", "L", null, " ");
        var doc = new ComponentModelDocument(1, "M1", new[] { node }, new[] { Type() });

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("id", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(violations, v => v.Contains("tagPrefix", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The same silent-bypass shape as a null tag <c>Access</c> (above) and a null widget
    /// <c>Kind</c> (below): <c>WritableComponentTagRoles.Contains(t.Role)</c> reads a null <c>Role</c> as
    /// "not writable", so a <c>setpoint</c>/<c>command</c> tag whose OWN <c>role</c> was omitted would skip
    /// the policyAction/min/max checks immediately below it.</summary>
    [Fact]
    public void A_componentTag_with_null_Role_is_a_violation_not_a_silent_5_bypass()
    {
        var tag = new ComponentTagDef("t", null!, "float", null, null, null, null, null);
        var type = new ComponentTypeDef("t1", "T1", new[] { tag }, Array.Empty<ComponentStateDef>(), "fp.x");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("role", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_widget_with_null_Id_is_a_violation()
    {
        var doc = Screen(new ScreenWidget(null!, "readout", Rect()));
        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("id", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Same silent-bypass shape as a null tag <c>Role</c>/<c>Access</c> above:
    /// <c>WritableWidgetKinds.Contains(w.Kind)</c> reads a null <c>Kind</c> as "not writable", so a
    /// <c>setpoint-input</c>/<c>command-button</c> widget whose OWN <c>kind</c> was omitted would skip the
    /// policyAction check immediately below it.</summary>
    [Fact]
    public void A_widget_with_null_Kind_is_a_violation_not_a_silent_5_bypass()
    {
        var doc = Screen(new ScreenWidget("w1", null!, Rect()));
        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("kind", StringComparison.OrdinalIgnoreCase));
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 WS-HMI-2 TASK 12 — THE PUBLISH DOOR. `Validate(HmiScreenDocument)` now answers "is this
    // widget id spelled the way the frozen schema demands", a question it deliberately did not ask before
    // (see ContractInvariants' own header, and the paragraph there that RETRACTS the sentence declining to
    // ask it).
    //
    // The sibling question — "does this widget KIND exist" — is NOT asked, and the header records why it
    // was written, measured and then withdrawn rather than forgotten.
    //
    // The PATTERN these check against is pinned to the schema file itself, at both of the paths that
    // declare it, by SchemaEnumGuardPinTests; these measure that the check RUNS and refuses, which a
    // parity pin cannot say.
    // ═════════════════════════════════════════════════════════════════════

    [Theory]
    [InlineData("Probe-A")]        // uppercase
    [InlineData("probe_a")]        // underscore
    [InlineData("probe a")]        // space
    [InlineData("probe.a")]        // dot
    [InlineData("probe-á")]        // non-ASCII
    public void A_widget_id_the_frozen_pattern_refuses_is_a_violation(string id)
    {
        var doc = Screen(new ScreenWidget(id, "readout", Rect()));

        var violations = ContractInvariants.Validate(doc);

        Assert.Single(violations);
        Assert.Contains(id, violations[0], StringComparison.Ordinal);
    }

    /// <summary>🔴 The <c>\z</c>-not-<c>$</c> trap, measured on <c>widget.id</c> the same way WS-HMI-2
    /// Task 2 fix round 2 measured it on <c>screenId</c>: .NET's <c>$</c> matches immediately BEFORE a
    /// trailing <c>\n</c>, ECMA-262's does not, so a guard written with <c>$</c> accepts a document
    /// <c>web/contract-tests/validate.mjs</c> rejects. This is the falsification for
    /// <c>ContractInvariants.AnchorAtEndOfString</c> being applied at all — delete the anchor swap and this
    /// row goes green while the two sides disagree.</summary>
    [Fact]
    public void A_widget_id_with_a_trailing_newline_is_a_violation_because_dotNET_anchors_at_end_of_STRING()
    {
        var doc = Screen(new ScreenWidget("probe-a\n", "readout", Rect()));

        Assert.Single(ContractInvariants.Validate(doc));
    }

    /// <summary>The anchor swap itself, both directions. A pattern that does not END in the ECMA anchor is
    /// refused rather than silently mangled — this runs in a static initializer of a GUARD, so "wrong but
    /// quiet" means the door is open for the life of the process.</summary>
    [Fact]
    public void AnchorAtEndOfString_swaps_the_ECMA_anchor_and_refuses_a_pattern_that_has_none()
    {
        Assert.Equal("^[a-z0-9-]+\\z", ContractInvariants.AnchorAtEndOfString("^[a-z0-9-]+$"));
        Assert.Throws<ArgumentException>(() => ContractInvariants.AnchorAtEndOfString("^[a-z0-9-]+"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Controls — NOT guards. Each of these asserts that a WELL-FORMED document produces ZERO violations.
    // A control cannot fail by construction against any of the checks above (it would only fail if a check
    // became too strict and started flagging valid input) — re-review #2, LOW-6, on
    // A_well_formed_component_reports_neither_id_nor_tagPrefix_violations being filed, in round 2, under a
    // header that presented it as pinning the fix it sits beside. Kept, relocated, and re-labelled here so
    // nobody counts it as coverage for the checks above.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Control_A_well_formed_component_reports_no_violations()
    {
        var doc = new ComponentModelDocument(1, "M1", new[] { Node() }, new[] { Type() });
        Assert.Empty(ContractInvariants.Validate(doc));
    }

    [Fact]
    public void Control_A_well_formed_tag_namespace_reports_no_violations()
    {
        var doc = new TagNamespaceDocument(1, "M1", new[] { TagWith(path: "M1/x", access: "r") });
        Assert.Empty(ContractInvariants.Validate(doc));
    }

    [Fact]
    public void Control_A_well_formed_screen_reports_no_violations()
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect()));
        Assert.Empty(ContractInvariants.Validate(doc));
    }

    // ═════════════════════════════════════════════════════════════════════
    // Fix round 4 — the three properties re-review #3 measured false, closed as PROPERTIES with an
    // enumeration behind each, not as the individual cases the findings used as illustrations.
    // ═════════════════════════════════════════════════════════════════════

    // ─────────────────────────────────────────────────────────────────────
    // HIGH-2 / P1: no client-authored body may produce a 500.
    //
    // `{"role":"setpoint","min":1e400,"max":2,"policyAction":"p"}` passed every §5 rule — min present, max
    // present, policyAction present — and then made JsonSerializer.Serialize throw ArgumentException
    // INSIDE ComponentModelStore.PutAsync. Not a ContractViolationException, so not the 400 the whole
    // error→HTTP map depends on that type to produce: a bare 500 on a body a client authored.
    //
    // Closed as a property, not at `min`: EVERY floating-point field that reaches serialisation is
    // rejected when non-finite, and
    // `Every_floating_point_field_that_reaches_serialisation_is_covered_by_the_non_finite_rule` is the
    // enumeration that goes red when a sixth one is added to a contract record.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The five floating-point fields the three frozen contract records expose to
    /// <c>JsonSerializer</c>, enumerated by hand HERE and re-derived by REFLECTION in
    /// <see cref="Every_floating_point_field_that_reaches_serialisation_is_covered_by_the_non_finite_rule"/>
    /// — the hand list is what a reader checks against the tests below; the reflection walk is what fails
    /// when the two drift.</summary>
    private static readonly string[] FloatingPointFieldsThatReachSerialisation =
    {
        "ComponentTagDef.Max",
        "ComponentTagDef.Min",
        "TagDescriptor.EngMax",
        "TagDescriptor.EngMin",
        "TagSource.Scale",
    };

    [Fact]
    public void Every_floating_point_field_that_reaches_serialisation_is_covered_by_the_non_finite_rule()
    {
        var reached = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var root in new[] { typeof(ComponentModelDocument), typeof(TagNamespaceDocument), typeof(HmiScreenDocument) })
        {
            CollectFloatingPointFields(root, reached, new HashSet<Type>());
        }

        var uncovered = reached.Except(FloatingPointFieldsThatReachSerialisation, StringComparer.Ordinal).ToList();
        var stale = FloatingPointFieldsThatReachSerialisation.Except(reached, StringComparer.Ordinal).ToList();

        if (uncovered.Count == 0 && stale.Count == 0) return;

        var parts = new List<string>();
        if (uncovered.Count > 0)
        {
            parts.Add(
                $"a contract record now exposes floating-point field(s) with no non-finite rule: {string.Join(", ", uncovered)}. " +
                "A non-finite double (1e400 in a request body deserializes to +∞) passes every §5 rule and " +
                "then makes JsonSerializer.Serialize throw ArgumentException inside a store's PutAsync — an " +
                "unexplained 500 on a client-authored body, which is P1 measured false. Add a " +
                "double.IsFinite check in the matching ContractInvariants.Validate overload, add a test " +
                "beside the four below, and add the field here");
        }
        if (stale.Count > 0)
        {
            parts.Add($"listed here but no longer reachable from any contract record: {string.Join(", ", stale)}");
        }

        Assert.Fail(string.Join(" | ", parts));
    }

    /// <summary>Walks the record graph the way <c>JsonSerializer</c> does — every property, through
    /// collection element types, staying inside the contracts assembly — so the enumeration is derived
    /// from the records rather than from anybody's memory of them.</summary>
    private static void CollectFloatingPointFields(Type type, ISet<string> into, ISet<Type> visited)
    {
        if (!visited.Add(type)) return;

        foreach (var prop in type.GetProperties())
        {
            var propType = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;

            if (propType == typeof(double) || propType == typeof(float) || propType == typeof(decimal))
            {
                into.Add($"{type.Name}.{prop.Name}");
                continue;
            }

            foreach (var candidate in ElementTypes(propType))
            {
                if (candidate.Assembly == typeof(ContractInvariants).Assembly)
                {
                    CollectFloatingPointFields(candidate, into, visited);
                }
            }
        }
    }

    private static IEnumerable<Type> ElementTypes(Type type)
    {
        yield return type;
        if (!type.IsGenericType) yield break;
        foreach (var arg in type.GetGenericArguments()) yield return arg;
    }

    public static TheoryData<double> NonFiniteValues() => new()
    {
        double.PositiveInfinity,
        double.NegativeInfinity,
        double.NaN,
    };

    [Theory]
    [MemberData(nameof(NonFiniteValues))]
    public void A_componentTag_with_a_non_finite_Min_is_a_violation_not_a_500(double value)
    {
        var tag = new ComponentTagDef("t", "setpoint", "float", null, null, value, 2, "machine.setpoint");
        var type = new ComponentTypeDef("t1", "T1", new[] { tag }, Array.Empty<ComponentStateDef>(), "fp.x");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("min", StringComparison.OrdinalIgnoreCase));
        Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(doc));
    }

    [Theory]
    [MemberData(nameof(NonFiniteValues))]
    public void A_componentTag_with_a_non_finite_Max_is_a_violation_not_a_500(double value)
    {
        var tag = new ComponentTagDef("t", "setpoint", "float", null, null, 0, value, "machine.setpoint");
        var type = new ComponentTypeDef("t1", "T1", new[] { tag }, Array.Empty<ComponentStateDef>(), "fp.x");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("max", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The rule is about SERIALISATION, not about the §5 hard band — so it applies to a role that
    /// needs no band at all. Round 3's `min`/`max` checks only fire for a <c>setpoint</c>; a non-finite
    /// <c>min</c> on an <c>in</c> tag reaches <c>JsonSerializer</c> exactly the same way.</summary>
    [Fact]
    public void A_non_finite_bound_on_a_non_setpoint_tag_is_still_a_violation()
    {
        var tag = new ComponentTagDef("t", "in", "float", null, null, double.PositiveInfinity, null, null);
        var type = new ComponentTypeDef("t1", "T1", new[] { tag }, Array.Empty<ComponentStateDef>(), "fp.x");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        Assert.NotEmpty(ContractInvariants.Validate(doc));
    }

    [Theory]
    [MemberData(nameof(NonFiniteValues))]
    public void A_tag_with_a_non_finite_EngMin_or_EngMax_is_a_violation_not_a_500(double value)
    {
        var engMin = new TagDescriptor("M1/x", "float", null, value, 1, null, "r", null, Sim(), false);
        var engMax = new TagDescriptor("M1/y", "float", null, 0, value, null, "r", null, Sim(), false);

        Assert.NotEmpty(ContractInvariants.Validate(new TagNamespaceDocument(1, "M1", new[] { engMin })));
        Assert.NotEmpty(ContractInvariants.Validate(new TagNamespaceDocument(1, "M1", new[] { engMax })));
    }

    [Theory]
    [MemberData(nameof(NonFiniteValues))]
    public void A_tag_source_with_a_non_finite_Scale_is_a_violation_not_a_500(double value)
    {
        var tag = new TagDescriptor(
            "M1/x", "float", null, null, null, null, "r", null, new TagSource("modbus", 1, 40001, value), false);

        Assert.Contains(
            ContractInvariants.Validate(new TagNamespaceDocument(1, "M1", new[] { tag })),
            v => v.Contains("scale", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The counterpart control: an ordinary finite band, including the extremes, must stay legal.
    /// A guard that rejected <c>double.MaxValue</c> would be a new defect wearing this fix's clothes.</summary>
    [Fact]
    public void Control_A_finite_band_including_the_extremes_is_not_a_violation()
    {
        var tag = new ComponentTagDef("t", "setpoint", "float", null, null, double.MinValue, double.MaxValue, "machine.setpoint");
        var type = new ComponentTypeDef("t1", "T1", new[] { tag }, Array.Empty<ComponentStateDef>(), "fp.x");
        Assert.Empty(ContractInvariants.Validate(
            new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type })));
    }

    // ─────────────────────────────────────────────────────────────────────
    // MEDIUM-1: ONE rule for "a required string is missing", adopted at EVERY site rather than at the two
    // a finding used as illustrations.
    //
    // Re-review #3 measured `policyAction: " "` returning 200 AND BEING STORED while `""` correctly 400'd —
    // on the §5 gate itself, i.e. an ungated write door reported as gated. The rule is
    // IsNullOrWhiteSpace everywhere; the three surviving IsNullOrEmpty sites were the three policyAction
    // gates, one per overload.
    // ─────────────────────────────────────────────────────────────────────

    public static TheoryData<string> BlankButNotEmptyStrings() => new() { " ", "\t", "\n", "   " };

    [Theory]
    [MemberData(nameof(BlankButNotEmptyStrings))]
    public void A_writable_tag_with_a_whitespace_only_policy_action_is_a_violation(string blank)
    {
        var violations = ContractInvariants.Validate(Ns(Tag("rw", blank)));

        Assert.Contains(violations, v => v.Contains("policyAction", StringComparison.Ordinal));
    }

    [Theory]
    [MemberData(nameof(BlankButNotEmptyStrings))]
    public void A_writable_componentTag_with_a_whitespace_only_policy_action_is_a_violation(string blank)
    {
        var tag = new ComponentTagDef("torque", "setpoint", "float", null, null, 0, 10, blank);
        var type = new ComponentTypeDef("t1", "T1", new[] { tag }, Array.Empty<ComponentStateDef>(), "fp.x");
        var doc = new ComponentModelDocument(1, "M1", Array.Empty<ComponentNode>(), new[] { type });

        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("policyAction", StringComparison.Ordinal));
    }

    [Theory]
    [MemberData(nameof(BlankButNotEmptyStrings))]
    public void A_command_button_with_a_whitespace_only_policy_action_is_a_violation(string blank)
    {
        var doc = Screen(new ScreenWidget("b1", "command-button", Rect(), PolicyAction: blank));

        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("policyAction", StringComparison.Ordinal));
    }

    /// <summary>...and the door, not only the checker: a whitespace-only <c>policyAction</c> on an
    /// <c>rw</c> tag used to be WRITTEN by <c>TagNamespaceStore.PutAsync</c> with no exception at all
    /// (measured, re-review #3 §7.2).</summary>
    [Fact]
    public void ThrowIfInvalid_throws_for_a_whitespace_only_policy_action_on_a_writable_tag()
    {
        Assert.Throws<ContractViolationException>(() => ContractInvariants.ThrowIfInvalid(Ns(Tag("rw", " "))));
    }

    /// <summary>🔴 <b>The ENUMERATION behind the three tests above, and the thing that goes red when a
    /// FOURTH site is written with the wrong predicate.</b> The rule this class holds is one rule — a
    /// required string is missing when it is null, empty, OR whitespace — and three consecutive review
    /// rounds showed that adopting it at the sites a finding NAMED is not the same as adopting it. So the
    /// guard is an enumeration over the whole assembly rather than three behaviours that happen to be the
    /// three sites known today.
    ///
    /// <para>🔴 <b>Fix round 5, item 2 — this guard was itself evadable, and the evasion was reproduced
    /// before it was closed.</b> Round 4 scanned the SOURCE TEXT for the literal
    /// <c>string.IsNullOrEmpty(</c>. Re-review #4 measured: a fourth site written
    /// <c>string.IsNullOrEmpty(w.Component)</c> → RED, named with its line; the identical call written
    /// <c>String.IsNullOrEmpty(w.Component)</c> — the BCL type name instead of the C# keyword alias —
    /// → <b>GREEN</b>. I reproduced exactly that (green, and the compiler emitted no warning about the
    /// spelling; there is no <c>.editorconfig</c> anywhere in this repository, so no <c>IDE0049</c> would
    /// have caught it either). That permits a fourth <c>policyAction</c>-shaped gate accepting <c>" "</c>
    /// — MEDIUM-1's ungated write door reported as gated — re-entering through a synonym.</para>
    ///
    /// <para><b>Why this is not fixed with a case-insensitive regex.</b> A regex closes the one synonym the
    /// review happened to name and leaves the next one: <c>System.String.IsNullOrEmpty(</c>,
    /// <c>global::System.String.IsNullOrEmpty(</c>, whitespace or a newline around the <c>.</c> or the
    /// <c>(</c>, <c>using static System.String;</c> then a bare <c>IsNullOrEmpty(</c>, or
    /// <c>using Str = System.String;</c> then <c>Str.IsNullOrEmpty(</c>. Patching the spelling a finding
    /// names, and leaving the property open, is the exact failure this whole task exists to end. <b>So the
    /// assertion is made against the COMPILED ASSEMBLY, not the text:</b> every one of those spellings
    /// emits the same <c>MemberRef</c> to <c>System.String::IsNullOrEmpty</c>, so an assembly that
    /// references it nowhere cannot call it by any spelling that exists or that anyone invents later. The
    /// source scan is retained only to name a line number in the failure message — it is a diagnostic, and
    /// the assertion no longer depends on it, which also retires round 4's fragile "prose must write the
    /// predicate without its qualifier" convention.</para>
    ///
    /// <para><b>Scope, deliberately the whole assembly rather than one file:</b> <c>St4i.Hmi.Contracts</c>
    /// contains the three frozen record files and this validator, and it IS the §5 door. A required-string
    /// check anywhere in it must ask the one question.</para></summary>
    [Fact]
    public void ContractInvariants_uses_one_missing_string_predicate_at_every_site()
    {
        var assemblyPath = typeof(ContractInvariants).Assembly.Location;
        var referenced = MemberReferencesNamed(assemblyPath, "IsNullOrEmpty");

        if (referenced.Count == 0) return;

        Assert.Fail(
            "The St4i.Hmi.Contracts assembly CALLS the wrong missing-string predicate. It must ask ONE " +
            "question about a missing required string, at every site: string.IsNullOrWhiteSpace. A " +
            "whitespace-only value is not a declaration — and on a policyAction gate it is an UNGATED " +
            "WRITE DOOR that this class reports as gated (re-review #3, MEDIUM-1: closed at two " +
            "illustration sites in round 3 and left open at the three that mattered).\n" +
            "Compiled references found: " + string.Join(", ", referenced) + "\n" +
            "Candidate source lines (best-effort text search, for locating it only — the assertion above " +
            "came from the compiled metadata and holds for EVERY spelling, including String./" +
            "System.String./using static/aliased):\n  " +
            string.Join("\n  ", LocateCandidateSourceLines()));
    }

    /// <summary>Every <c>MemberRef</c> in <paramref name="assemblyPath"/> whose member name matches, with
    /// its declaring type — read straight out of the PE metadata, so it sees what the compiler emitted
    /// rather than what somebody typed.</summary>
    private static IReadOnlyList<string> MemberReferencesNamed(string assemblyPath, string memberName)
    {
        using var stream = File.OpenRead(assemblyPath);
        using var pe = new System.Reflection.PortableExecutable.PEReader(stream);
        var md = pe.GetMetadataReader();

        var found = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var handle in md.MemberReferences)
        {
            var member = md.GetMemberReference(handle);
            if (!string.Equals(md.GetString(member.Name), memberName, StringComparison.Ordinal)) continue;

            var owner = member.Parent.Kind == System.Reflection.Metadata.HandleKind.TypeReference
                ? DescribeTypeReference(md, (System.Reflection.Metadata.TypeReferenceHandle)member.Parent)
                : member.Parent.Kind.ToString();
            found.Add($"{owner}::{memberName}");
        }

        return found.ToList();
    }

    private static string DescribeTypeReference(
        System.Reflection.Metadata.MetadataReader md, System.Reflection.Metadata.TypeReferenceHandle handle)
    {
        var typeRef = md.GetTypeReference(handle);
        var ns = md.GetString(typeRef.Namespace);
        var name = md.GetString(typeRef.Name);
        return string.IsNullOrWhiteSpace(ns) ? name : $"{ns}.{name}";
    }

    /// <summary>Diagnostic only — never the assertion. Deliberately loose (case-insensitive, optional
    /// qualifier, tolerant of whitespace) because a false positive in a failure message costs nothing and
    /// a false negative in an ASSERTION is what this round is fixing.</summary>
    private static IReadOnlyList<string> LocateCandidateSourceLines()
    {
        var path = ContractInvariantsSourcePath();
        if (!File.Exists(path)) return new[] { $"(source not found at {path})" };

        var lines = File.ReadAllLines(path)
            .Select((text, i) => (Text: text, Number: i + 1))
            .Where(x => System.Text.RegularExpressions.Regex.IsMatch(
                x.Text, @"(?<![A-Za-z0-9_])(?:[sS]tring\s*\.\s*)?IsNullOrEmpty\s*\("))
            .Select(x => $"line {x.Number}: {x.Text.Trim()}")
            .ToList();

        return lines.Count > 0 ? lines : new[] { "(no candidate line matched — check for an alias or a using static)" };
    }

    private static string ContractInvariantsSourcePath()
    {
        // ContractFixtures.ContractsDir is <solution>/contracts — its parent is the solution directory.
        var solutionDir = Path.GetDirectoryName(ContractFixtures.ContractsDir)!;
        return Path.Combine(solutionDir, "src", "St4i.Hmi.Contracts", "ContractInvariants.cs");
    }

    /// <summary>The control the guard above needs to be worth anything: proof that
    /// <see cref="MemberReferencesNamed"/> can SEE such a call at all. Without this, a metadata reader that
    /// silently found nothing — wrong table, wrong file, an exception swallowed upstream — would look
    /// exactly like a clean assembly, and the guard would be a permanent green light. THIS test assembly
    /// deliberately calls <c>string.IsNullOrEmpty</c> once, in
    /// <see cref="DeliberateIsNullOrEmptyCallSoTheDetectorHasSomethingToFind"/>, and the detector must find
    /// it here while finding nothing in the contracts assembly.</summary>
    [Fact]
    public void Control_The_predicate_detector_can_actually_see_such_a_call()
    {
        Assert.True(DeliberateIsNullOrEmptyCallSoTheDetectorHasSomethingToFind(""));

        var inThisAssembly = MemberReferencesNamed(
            typeof(ContractInvariantsTests).Assembly.Location, "IsNullOrEmpty");

        Assert.Contains("System.String::IsNullOrEmpty", inThisAssembly);
    }

    private static bool DeliberateIsNullOrEmptyCallSoTheDetectorHasSomethingToFind(string? value) =>
        string.IsNullOrEmpty(value);

    // ─────────────────────────────────────────────────────────────────────
    // LOW — Validate(HmiScreenDocument)'s criterion, made ONE criterion. Round 3 excluded
    // ScreenWidget.Rect on the grounds that nothing dereferences it, and included ScreenWidget.Id while
    // conceding the same thing three sentences apart; HmiScreenDocument.ScreenId/Title/Theme/Layout were
    // 0-violation and unmentioned. See Validate(HmiScreenDocument)'s own BOUNDARY paragraph for the rule
    // now in force and for why this overload's tie-break differs from its two siblings'.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_widget_with_a_null_Rect_is_a_violation_on_the_same_criterion_that_requires_its_Id()
    {
        var doc = Screen(new ScreenWidget("w1", "readout", null!));
        Assert.Contains(ContractInvariants.Validate(doc), v => v.Contains("rect", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void A_screen_with_a_null_ScreenId_Title_Theme_or_Layout_is_a_violation()
    {
        var doc = new HmiScreenDocument(1, null!, null!, null, null!, null!, Array.Empty<ScreenWidget>());

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("screenId", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(violations, v => v.Contains("title", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(violations, v => v.Contains("theme", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(violations, v => v.Contains("layout", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The other half of the same criterion: fields the frozen record declares NULLABLE stay
    /// optional. A guard that required <c>titleEn</c> would be reading "checked everything" as the rule
    /// instead of "checked what the record declares required".</summary>
    [Fact]
    public void Control_A_screen_omitting_only_its_nullable_fields_reports_no_violations()
    {
        var doc = new HmiScreenDocument(
            1, "s1", "Màn hình", TitleEn: null, "isa101", new ScreenLayout(12, 8, "panel"),
            new[] { new ScreenWidget("w1", "readout", Rect(), Component: null, Bindings: null, Props: null, PolicyAction: null) });

        Assert.Empty(ContractInvariants.Validate(doc));
    }

    // ─────────────────────────────────────────────────────────────────────
    // WS-HMI-2 Task 2 fix round 1 — LOẠI LUẬT THỨ BA (the carried ruling). Before this round, measured:
    // ScreenId="MyScreen" (violates the frozen schema's `^[a-z0-9-]+$` pattern) drew ZERO violations here
    // and HmiScreenStore.PutAsync wrote it to disk unchanged — no regex anywhere in this class, no invalid
    // fixture catching it, and the "TypeScript builder" a previous draft of CanonicalScreenStore.cs cited
    // as the enforcer does not exist (zero a-z0-9-pattern hits in web/src). Closed at THIS door because it
    // is the one every producer — DI-decorated or a direct store caller — passes through.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_ScreenId_Violating_The_Frozen_az09_Pattern_Is_A_Violation()
    {
        // Does NOT measure every character class the schema's pattern excludes — one representative
        // violation (uppercase, the exact shape CanonicalizingHmiScreenStore deliberately does NOT fold)
        // is enough to prove the door is not silently open. Uses the local Screen(...) helper's widgets so
        // only ScreenId varies from the well-formed control below.
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { ScreenId = "MyScreen" };

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("screenId", StringComparison.OrdinalIgnoreCase) &&
                                          v.Contains("MyScreen", StringComparison.Ordinal));
    }

    /// <summary>The positive control this property needs: a screenId that DOES match the pattern must not
    /// be flagged — a regex bug that rejected every screenId (not just out-of-pattern ones) would pass the
    /// test above (which only checks a violation EXISTS for a bad id) while breaking every legitimate
    /// screen. <c>Control_A_well_formed_screen_reports_no_violations</c> already covers <c>"s1"</c>; this
    /// covers the character class explicitly — lowercase, digits, and a hyphen, all three.</summary>
    [Fact]
    public void Control_A_ScreenId_Matching_The_Frozen_Pattern_Is_Not_A_Violation()
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { ScreenId = "line-overview-9" };

        Assert.Empty(ContractInvariants.Validate(doc));
    }

    /// <summary>The tie-break with the presence check directly above: a blank <c>screenId</c> reports
    /// EXACTLY ONE violation (the missing-field one), not two. Written because the pattern check is an
    /// <c>else if</c> — reachable only once presence has already passed — and this is the test that would
    /// redden if that ordering were ever inverted to an unconditional <c>if</c>.</summary>
    [Fact]
    public void A_blank_ScreenId_Reports_Only_The_Missing_Field_Violation_Not_Also_A_Pattern_Violation()
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { ScreenId = "" };

        var violations = ContractInvariants.Validate(doc);

        Assert.Single(violations, v => v.Contains("screenId", StringComparison.OrdinalIgnoreCase));
    }

    // ─────────────────────────────────────────────────────────────────────
    // WS-HMI-2 Task 2 fix round 2 (review MED-2) — .NET's `$` (unlike ECMA-262's, the dialect
    // web/contract-tests/validate.mjs and every browser use) matches immediately BEFORE a trailing `\n`
    // at the end of the string, not only at the true end. Measured before the fix:
    // ScreenId="line-overview\n" (any valid id plus a trailing newline) drew ZERO violations here, and
    // HmiScreenStore.PutAsync stored and round-tripped it — a document the frozen schema rejects,
    // accepted by the .NET side alone. Fixed by using \z, which has no such exception. The Theory below
    // re-checks every boundary already agreed before this one-character fix, so the fix is proven not to
    // have moved any of them.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_ScreenId_With_A_Trailing_Newline_Is_A_Violation()
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { ScreenId = "line-overview\n" };

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("screenId", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("a")]        // single character
    [InlineData("-abc")]     // leading hyphen — the pattern's character class has no position rule
    [InlineData("abc-")]     // trailing hyphen
    [InlineData("ab--cd")]   // double/consecutive hyphen
    [InlineData("12345")]    // digits only, no letters
    public void Control_A_ScreenId_At_These_Boundaries_Still_Matches_The_Pattern_After_The_z_Fix(string screenId)
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { ScreenId = screenId };

        Assert.Empty(ContractInvariants.Validate(doc));
    }

    /// <summary>The schema declares no <c>maxLength</c> for <c>screenId</c> — a long, otherwise-valid id
    /// must still pass. Re-checked here specifically because a length boundary is the shape most likely to
    /// expose an unrelated regression from swapping the anchor.</summary>
    [Fact]
    public void Control_A_512_Character_ScreenId_Matching_The_Pattern_Still_Passes_After_The_z_Fix()
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { ScreenId = new string('a', 512) };

        Assert.Empty(ContractInvariants.Validate(doc));
    }

    /// <summary>Empty/whitespace/null never reach the pattern check at all (the <c>else if</c> above) —
    /// re-checked here as boundaries in their OWN right, not only as the tie-break test above, so a future
    /// reordering that changed reachability would still be caught by a test whose name says what it is
    /// checking.</summary>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Control_Blank_Or_Null_ScreenId_Boundaries_Still_Report_Only_The_Missing_Field_Violation(string? screenId)
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { ScreenId = screenId! };

        var violations = ContractInvariants.Validate(doc);

        Assert.Single(violations, v => v.Contains("screenId", StringComparison.OrdinalIgnoreCase));
    }

    // ─────────────────────────────────────────────────────────────────────
    // WS-HMI-2 Task 3 fix round 1 (review, ruling) — LOẠI LUẬT THỨ TƯ: layout.cols/rows ∈ [1..48]. Before
    // this round, measured over a real browser: cols:999 mis-renders SILENTLY (every grid track computes
    // to 0px, a widget past the first few columns lands outside the host with no console warning and no
    // clamp — clampRectToLayout clamps a rect against the DECLARED layout, and a layout of 999 makes every
    // rect "in range"). The other three range-invalid shapes (negative rect, colSpan/rowSpan 0, an unknown
    // kind) all already degrade visibly on the web side and are deliberately left unenforced here — this
    // is the one range violation with no safety net anywhere else in the stack.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(999)]   // the review's own reproduction
    [InlineData(49)]    // one past the boundary
    [InlineData(0)]     // below the minimum
    [InlineData(-5)]    // negative
    public void A_layout_Cols_Outside_1_48_Is_A_Violation(int cols)
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { Layout = new ScreenLayout(cols, 8, "panel") };

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("cols", StringComparison.OrdinalIgnoreCase) &&
                                          v.Contains(cols.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(999)]
    [InlineData(49)]
    [InlineData(0)]
    [InlineData(-5)]
    public void A_layout_Rows_Outside_1_48_Is_A_Violation(int rows)
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { Layout = new ScreenLayout(12, rows, "panel") };

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("rows", StringComparison.OrdinalIgnoreCase) &&
                                          v.Contains(rows.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal));
    }

    /// <summary>The positive control this property needs, at BOTH ends of the frozen schema's closed
    /// interval — a regex-style off-by-one (`&lt;=`/`&gt;=` swapped for `&lt;`/`&gt;`) would reject a
    /// legitimately boundary-valued layout while this test's siblings above stayed green, since they only
    /// probe values already outside the range.</summary>
    [Theory]
    [InlineData(1, 1)]
    [InlineData(48, 48)]
    [InlineData(1, 48)]
    [InlineData(48, 1)]
    public void Control_Layout_Cols_And_Rows_At_The_1_And_48_Boundaries_Are_Not_Violations(int cols, int rows)
    {
        var doc = Screen(new ScreenWidget("w1", "readout", Rect())) with { Layout = new ScreenLayout(cols, rows, "panel") };

        Assert.Empty(ContractInvariants.Validate(doc));
    }

    /// <summary>No interaction with §5's conditional rules, measured rather than assumed — a document
    /// carrying BOTH an out-of-range layout AND a §5 policyAction gap must report BOTH violations, not have
    /// one gate silently swallow the other (the two live in separate branches of <c>Validate</c>, but nothing
    /// short of running them together proves neither short-circuits the other).</summary>
    [Fact]
    public void A_layout_Range_Violation_And_A_Section5_Violation_On_One_Document_Both_Report()
    {
        var doc = Screen(new ScreenWidget("b1", "command-button", Rect(), PolicyAction: null))
            with { Layout = new ScreenLayout(999, 8, "panel") };

        var violations = ContractInvariants.Validate(doc);

        Assert.Contains(violations, v => v.Contains("cols", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(violations, v => v.Contains("policyAction", StringComparison.Ordinal));
    }
}
