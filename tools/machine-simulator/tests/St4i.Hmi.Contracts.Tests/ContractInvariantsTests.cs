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
}
