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
    public void A_well_formed_component_reports_neither_id_nor_tagPrefix_violations()
    {
        var doc = new ComponentModelDocument(1, "M1", new[] { Node() }, new[] { Type() });
        Assert.Empty(ContractInvariants.Validate(doc));
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
}
