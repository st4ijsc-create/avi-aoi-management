namespace St4i.Hmi.Contracts;

/// <summary>Ném khi một tài liệu vi phạm luật an toàn §5. <see cref="Violations"/> mang TOÀN BỘ vi phạm,
/// không phải cái đầu tiên — người sửa cần thấy hết trong một lần.</summary>
public sealed class ContractViolationException : Exception
{
    /// <summary>TOÀN BỘ vi phạm tìm thấy, không phải cái đầu tiên.</summary>
    public IReadOnlyList<string> Violations { get; }

    /// <summary>Khởi tạo với danh sách vi phạm đầy đủ đã thu thập bởi <see cref="ContractInvariants.Validate(TagNamespaceDocument)"/>,
    /// <see cref="ContractInvariants.Validate(ComponentModelDocument)"/> hoặc
    /// <see cref="ContractInvariants.Validate(HmiScreenDocument)"/>.</summary>
    public ContractViolationException(IReadOnlyList<string> violations)
        : base($"Tài liệu vi phạm bất biến hợp đồng ({violations.Count}): {string.Join(" | ", violations)}")
        => Violations = violations;
}

/// <summary>
/// Luật an toàn §5 viết thành mã, cho phía .NET. Schema JSON đã thi hành cùng những luật này cho mọi tài
/// liệu đi qua bộ validate phía web — nhưng các record ở assembly này khai enum là <see langword="string"/>,
/// nên một producer .NET dựng thẳng một record vi phạm sẽ không gặp trở ngại nào. Đây là cửa đóng chỗ đó.
///
/// <para>🔴 <b>Giới hạn, nói ra để không ai đọc quá:</b> đây KHÔNG phải bộ validate JSON Schema. Nó kiểm
/// đúng những luật liệt kê ngay dưới đây và không gì khác — không pattern, không kiểu, không trường lạ,
/// không kiểm tư cách thành viên của bất kỳ <c>enum</c> nào. Một tài liệu qua được
/// đây vẫn có thể bị schema từ chối. Và nó chỉ chạy ở nơi có ai đó gọi nó; serialize thẳng bằng
/// <c>JsonSerializer</c> vẫn đi vòng qua được. Bảo vệ nằm ở CỬA GHI (các store), không ở kiểu dữ liệu.</para>
///
/// <para>🔴 <b>LUẬT ĐƯỢC KIỂM — liệt kê đầy đủ, vì đoạn giới hạn cũ nói "ba luật" trong khi bảng dưới đây
/// có nhiều hơn ba, và một đoạn đếm sai làm người đọc kết luận §5 đã đóng ở chỗ nó chưa đóng</b>
/// (review toàn nhánh WS-HMI-0a, Important 4):
/// <list type="number">
///   <item><description><see cref="TagNamespaceDocument"/> — <c>access == "rw"</c> ⇒ bắt buộc có
///   <c>policyAction</c>.</description></item>
///   <item><description><see cref="TagNamespaceDocument"/> — <c>tags[].path</c> phải DUY NHẤT trong một
///   tài liệu. Không phải luật §5; đây là luật của <c>TagNamespaceStore</c>, thêm ở đây để nó đỏ ở CỬA
///   thay vì nổ thành <c>SqliteException</c> giữa transaction — xem doc-comment của
///   <see cref="Validate(TagNamespaceDocument)"/>.</description></item>
///   <item><description><see cref="ComponentModelDocument"/> — <c>role ∈ {setpoint, command}</c> ⇒ bắt
///   buộc có <c>policyAction</c>.</description></item>
///   <item><description><see cref="ComponentModelDocument"/> — <c>role == "setpoint"</c> ⇒ bắt buộc có
///   cả <c>min</c> và <c>max</c>.</description></item>
///   <item><description><see cref="HmiScreenDocument"/> — <c>kind ∈ {setpoint-input, command-button}</c>
///   ⇒ bắt buộc có <c>policyAction</c>.</description></item>
///   <item><description>🔴 <b>Thêm ở fix round 4, và như luật (2) đây KHÔNG phải luật §5:</b> mọi trường
///   số thực (<c>min</c>, <c>max</c>, <c>engMin</c>, <c>engMax</c>, <c>source.scale</c> — NĂM trường, liệt
///   kê đầy đủ) phải HỮU HẠN. <c>NaN</c>/<c>±∞</c> làm <c>JsonSerializer.Serialize</c> của cửa ghi ném
///   <see cref="ArgumentException"/>, tức một thân do client soạn hạ cánh thành <b>500 không lời giải
///   thích</b> — cùng hình dạng, cùng lý do như luật trùng <c>path</c>. Xem
///   <see cref="Validate(ComponentModelDocument)"/> để biết cơ chế đầy đủ.</description></item>
/// </list>
/// <b>Và một dòng về việc ĐẾM, vì đoạn này đã đếm sai một lần:</b> con số cho các luật CÓ ĐIỀU KIỆN ở trên
/// là SÁU, và bài kiểm giữ nó khỏi lệch không phải là ai đó đọc lại danh sách — mà là
/// <c>ContractInvariantsTests.Every_floating_point_field_that_reaches_serialisation_is_covered_by_the_non_finite_rule</c>
/// (phản chiếu ba record, đỏ khi có trường số thực thứ sáu) và
/// <c>...ContractInvariants_uses_one_missing_string_predicate_at_every_site</c> (đọc METADATA của assembly
/// đã biên dịch, đỏ khi có bất kỳ cửa nào gọi <c>IsNullOrEmpty</c> — mọi cách viết, xem doc-comment của bài
/// ấy).</para>
///
/// <para>🔴 <b>LOẠI LUẬT THỨ HAI — các kiểm tra CÓ MẶT, tách riêng ở fix round 5 vì đếm lại đúng SÁU luật
/// có điều kiện trong khi bỏ quên cả một LOẠI khác là chính xác cái lỗi đoạn trên vừa xin lỗi vì đã mắc</b>
/// (re-review #4). Ngoài sáu luật có điều kiện, bộ kiểm còn đòi một số trường BẮT BUỘC PHẢI CÓ, không phụ
/// thuộc điều kiện nào: <c>machineCode</c> (cả hai tài liệu), <c>components</c>/<c>types</c>/<c>tags</c>/
/// <c>widgets</c> và mọi PHẦN TỬ của chúng, <c>component.id</c>, <c>component.tagPrefix</c>,
/// <c>tag.path</c>, <c>tag.access</c>, <c>componentTag.role</c>, <c>widget.id</c>, <c>widget.kind</c>, và —
/// thêm ở round 4, và là năm cái đoạn này bỏ sót — <c>screenId</c>, <c>title</c>, <c>theme</c>,
/// <c>layout</c>/<c>layout.breakpoint</c>, <c>widget.rect</c>. <b>Không bài kiểm nào ở trên gác DANH SÁCH
/// này</b> (chúng gác trường số thực và vị từ chuỗi, không gác "còn thiếu trường bắt buộc nào không"); cái
/// gác nó là TIÊU CHÍ được phát biểu trong đoạn BOUNDARY của từng overload — và tiêu chí ấy, chứ không phải
/// danh sách này, là thứ một người thêm trường mới phải đọc. Danh sách này tồn tại để người đọc biết loại
/// luật thứ hai CÓ tồn tại.</para>
///
/// <para>🔴 <b>CÁI CÒN LẠI CHƯA KIỂM, nói tên chứ không để người đọc tự suy:</b> không có bộ kiểm nào cho
/// <c>screenId</c>/<c>widget.id</c> trùng nhau, cho <see cref="ScreenLayout"/> có nằm trong dải
/// <c>1..48</c> của schema, cho <c>bindings</c> có tham chiếu tới một <c>component</c> có thật, hay cho
/// bất kỳ chuỗi enum nào (<c>theme</c>, <c>breakpoint</c>, <c>kind</c>, <c>tone</c>, <c>dataType</c>) là
/// thành viên hợp lệ. Những thứ ấy schema thi hành và <c>web/contract-tests/validate.mjs</c> chạy; ở phía
/// .NET chúng KHÔNG được thi hành. <b>Và không có store .NET nào ghi
/// <see cref="HmiScreenDocument"/></b> — <see cref="ThrowIfInvalid(HmiScreenDocument)"/> tồn tại nhưng
/// CHƯA CÓ AI GỌI; nó là cửa cho WS-HMI-0b, không phải một cửa đang gác cái gì hôm nay.</para>
/// </summary>
public static class ContractInvariants
{
    // ─────────────────────────────────────────────────────────────────────
    // 🔴 CÁC TẬP CHUỖI ENUM MÀ BỘ KIỂM GÁC — public, và public LÀ ĐIỂM CHÍNH.
    //
    // Review toàn nhánh WS-HMI-0a, Important 5: trước 2026-08-30 bốn tập này là các chuỗi VIẾT THẲNG
    // trong thân bốn vòng lặp bên dưới (`t.Access == "rw"`, `t.Role is "setpoint" or "command"`, …).
    // Không gì đối chiếu chúng với enum trong `contracts/*.schema.json`: `SchemaPin` chỉ so TÊN THUỘC
    // TÍNH, và các record khai mọi enum là `string` một cách có chủ ý. Trước nhánh này đó là chuyện hình
    // thức. Nhánh này biến chính những chuỗi ấy thành CÁI GÁC — `PutAsync` của hai store gọi
    // `ThrowIfInvalid` trước khi mở kết nối — nên nới `access` thêm một `"w"`, hay thêm một `role` ghi
    // được, sẽ khiến bộ kiểm này âm thầm THÔI gác trong khi store vẫn ghi. Phía web đã gặp đúng hình
    // dạng ấy ở vòng sửa của Mốc 0 (nới `access` thành ["r","rw","w"], validate một tag "w" không có
    // policyAction, nhận về KHÔNG lỗi nào) và đóng bằng một ghim schema↔TS. Đây là nửa .NET của cái ghim
    // ấy: bốn tập nằm ở MỘT chỗ, vòng lặp đọc chúng, và `SchemaEnumGuardPinTests` đối chiếu chúng với
    // câu `if` của chính schema. Một literal, hai người đọc — không có bản chép tay nào để lệch.
    //
    // GIỚI HẠN, nói ra: đây KHÔNG phải danh sách giá trị HỢP LỆ của mỗi enum (schema mới là). Nó là danh
    // sách giá trị bộ kiểm này COI LÀ GHI ĐƯỢC. Một `access` gõ sai ("rww") không thuộc tập nào và đi qua
    // đây im lặng — schema từ chối nó, bộ kiểm này thì không.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Các giá trị <c>tags[].access</c> mà §5 coi là ĐƯỜNG GHI, nên bắt buộc có
    /// <c>policyAction</c>. Ghim với <c>tag-namespace.schema.json</c> → <c>$defs.tag.allOf[0].if</c>.</summary>
    public static readonly IReadOnlySet<string> WritableTagAccess =
        new HashSet<string>(StringComparer.Ordinal) { "rw" };

    /// <summary>Các giá trị <c>componentTag.role</c> mà §5 coi là ĐƯỜNG GHI. Ghim với
    /// <c>component-model.schema.json</c> → <c>$defs.componentTag.allOf[0].if</c>.</summary>
    public static readonly IReadOnlySet<string> WritableComponentTagRoles =
        new HashSet<string>(StringComparer.Ordinal) { "setpoint", "command" };

    /// <summary>Các giá trị <c>componentTag.role</c> bắt buộc có dải chặn cứng <c>min</c>+<c>max</c>.
    /// Ghim với <c>component-model.schema.json</c> → <c>$defs.componentTag.allOf[1].if</c>. Đây là một
    /// tập RIÊNG chứ không phải <see cref="WritableComponentTagRoles"/>: một <c>command</c> là đường ghi
    /// nhưng không có dải số để chặn.</summary>
    public static readonly IReadOnlySet<string> HardBandComponentTagRoles =
        new HashSet<string>(StringComparer.Ordinal) { "setpoint" };

    /// <summary>Các giá trị <c>widget.kind</c> mà §5 coi là ĐƯỜNG GHI. Ghim với
    /// <c>hmi-screen.schema.json</c> → <c>$defs.widget.allOf[0].if</c>.</summary>
    public static readonly IReadOnlySet<string> WritableWidgetKinds =
        new HashSet<string>(StringComparer.Ordinal) { "setpoint-input", "command-button" };

    /// <summary>Kiểm một <see cref="TagNamespaceDocument"/>: (1) mọi tag <c>access == "rw"</c>
    /// phải có <see cref="TagDescriptor.PolicyAction"/> (luật §5); (2) mọi <see cref="TagDescriptor.Path"/>
    /// phải DUY NHẤT trong tài liệu. Trả về rỗng nếu hợp lệ; danh sách đầy đủ nếu không.
    ///
    /// <para>🔴 <b>Vì sao luật trùng path nằm ở ĐÂY chứ không ở schema</b> (review toàn nhánh WS-HMI-0a,
    /// Important 3). <c>tag_index.path</c> trong <c>TagNamespaceStore</c> là PRIMARY KEY TOÀN CỤC, và
    /// <c>PutAsync</c> nạp chỉ mục bằng <c>INSERT</c> trần. Một tài liệu khai cùng một <c>path</c> hai lần
    /// là HỢP LỆ với schema (mảng <c>tags</c> không có ràng buộc duy nhất), nên nó đi lọt tới tận SQLite và
    /// nổ thành <c>UNIQUE constraint failed: tag_index.path</c>. Transaction cuộn lại đúng nên không có gì
    /// hỏng — nhưng đó là một <c>SqliteException</c>, không phải
    /// <see cref="ContractViolationException"/>, và bản đồ lỗi→HTTP của WS-HMI-0b chỉ ánh xạ cái sau sang
    /// <c>400</c>. Nghĩa là một tài liệu do client soạn hạ cánh thành <b>500 không lời giải thích</b>.
    /// Kiểm ở cửa biến nó thành một vi phạm nằm cùng danh sách với các vi phạm khác, và giữ nguyên schema
    /// của store.</para>
    ///
    /// <para><b>Luật này KHÔNG bắt được gì:</b> hai MÁY KHÁC NHAU cùng khai một <c>path</c>. Pattern của
    /// <c>path</c> không đòi tiền tố mã máy, nên hai tài liệu hợp lệ vẫn có thể va nhau ở
    /// <c>tag_index</c> — bộ kiểm này thuần trên MỘT tài liệu và không đọc đĩa, nên nó không thấy tài liệu
    /// kia. Trường hợp ấy vẫn ném <c>SqliteException</c> ở store, và nó được ghi ra đây thay vì để im.</para>
    ///
    /// <para>🔴 <b>WS-HMI-0b Task 1, fix round 2 — <see cref="TagNamespaceDocument.Tags"/> is checked for
    /// <see langword="null"/> first, and every element is checked for <see langword="null"/> before it is
    /// dereferenced.</b> Found by review as the FIRST of two twins sharing
    /// <see cref="Validate(ComponentModelDocument)"/>'s exact pre-fix hole: a missing <c>tags</c> field
    /// deserializes to a genuine runtime <see langword="null"/> (same <c>System.Text.Json</c> mechanism —
    /// see that overload's own doc comment), and <c>foreach (var t in doc.Tags)</c> threw a bare
    /// <see cref="NullReferenceException"/> with no chance to collect a violation. Closed NOW, ahead of
    /// need, because <see cref="TagNamespaceDocument"/> becomes HTTP-reachable in WS-HMI-0b Task 2
    /// (<c>PUT /v1/tags/{machineCode}</c>) — leaving this hole here would have shipped it on that task's
    /// day one, under a test suite with no reason to go looking for it.</para>
    ///
    /// <para>🔴 <b>Fix round 3 — round 2 closed element-NULL depth and stopped one level short of
    /// element-FIELD depth, on the exact document type its own justification named.</b> Re-review #2
    /// measured: a <see cref="TagDescriptor"/> with a null <see cref="TagDescriptor.Path"/> passed this
    /// method at 0 violations, then made <c>TagNamespaceStore.PutAsync</c> throw
    /// <see cref="InvalidOperationException"/> ("Value must be set.") — not a
    /// <see cref="ContractViolationException"/>, so not the 400 the whole error→HTTP map depends on that
    /// type to produce. <see cref="TagDescriptor.Path"/> is checked now for the SAME two reasons
    /// <see cref="ComponentNode.TagPrefix"/> is checked in <see cref="Validate(ComponentModelDocument)"/>:
    /// it is bound as <c>tag_index.path</c>'s PRIMARY KEY SQL parameter, AND it is the unguarded <c>path</c>
    /// argument to <c>St4i.EngineApi.HmiModel.ModelIntegrity.IsPathPrefix</c>
    /// (<c>path.Length</c> with no null check) — so a null <c>Path</c> that somehow reached that far would
    /// crash a component-tree integrity check too, not only the namespace's own write door.
    /// <see cref="TagDescriptor.Access"/> is checked for a DIFFERENT reason, not a crash: a null
    /// <c>Access</c> reads as "not writable" (<c>Contains(null)</c> is <see langword="false"/>, not an
    /// exception), silently skipping the very policyAction rule this class exists to enforce for a tag
    /// whose <c>access</c> was simply omitted. <see cref="TagNamespaceDocument.MachineCode"/> is checked
    /// too — <c>TagNamespaceStore.PutAsync</c> binds it as a SQL parameter the identical way
    /// <see cref="ComponentModelDocument.MachineCode"/> is bound; see that overload's own doc comment for
    /// the measurement.</para>
    ///
    /// <para>🔴 <b>THE BOUNDARY FOR THIS OVERLOAD — fix round 4. Re-review #3, LOW: this overload had no
    /// boundary paragraph at all while its <see cref="ComponentModelDocument"/> sibling had one, so its
    /// 0-violation fields were unnamed and a reader had to derive the rule from the code.</b> Same ONE
    /// criterion its sibling states, so read that one for the full wording: a field is checked iff (a) its
    /// null/blank/non-finite value makes THIS METHOD, <c>ModelIntegrity.Check</c>, or a STORE'S OWN WRITE
    /// DOOR throw something that is not a <see cref="ContractViolationException"/>; or (b) its null-ness
    /// makes this method silently skip the very §5 rule it exists to enforce. Under (a):
    /// <see cref="TagNamespaceDocument.MachineCode"/> and <see cref="TagDescriptor.Path"/> (SQL parameter
    /// binds in <c>TagNamespaceStore.PutAsync</c>; <c>Path</c> also the unguarded argument to
    /// <c>ModelIntegrity.IsPathPrefix</c>), plus <see cref="TagDescriptor.EngMin"/>,
    /// <see cref="TagDescriptor.EngMax"/> and <see cref="TagSource.Scale"/> when NON-FINITE (see the
    /// non-finite rule stated on <see cref="Validate(ComponentModelDocument)"/>). Under (b):
    /// <see cref="TagDescriptor.Access"/>.
    ///
    /// <para>🔴 <b>RETRACTED 2026-08-31 (WS-HMI-0c, MED-3), kept verbatim because the reasoning it
    /// records is still correct about the question it asked.</b> This paragraph used to continue:
    /// <i>"Named and deliberately NOT checked: <see cref="TagDescriptor.DataType"/>,
    /// <see cref="TagDescriptor.Source"/> and <see cref="TagSource.Kind"/> — each is declared non-nullable
    /// by its record and each CAN arrive null from the same missing-field mechanism, but none is
    /// dereferenced by this method or by the store in a way that throws (the store writes the whole
    /// document as one JSON blob), and none gates another §5 check."</i>
    ///
    /// <para>Every clause of that is true, and its criterion was CRASH-SAFETY — will a null throw here or
    /// silently skip a §5 gate. What it did not ask is whether a document the FROZEN SCHEMA FORBIDS can be
    /// stored and served, and it could: an entry omitting <c>source</c> parsed, compiled, drew zero
    /// violations, threw nothing, and serialised with <c>source</c> absent, so a schema-invalid namespace
    /// reached the store and the read routes — through a real ingestion path once WS-HMI-0c Task 4 landed.
    /// All three are now checked for PRESENCE. That is still not full JSON-Schema validation (no patterns,
    /// no enum membership, no <c>additionalProperties</c>, no conditional <c>engMin</c>/<c>engMax</c>
    /// rule), which remains the deliberate non-fix the sibling overload declares — it is the same
    /// required-field-presence class as the checks above, extended to the fields that were left out of
    /// it.</para></para></summary>
    public static IReadOnlyList<string> Validate(TagNamespaceDocument doc)
    {
        var v = new List<string>();

        if (string.IsNullOrWhiteSpace(doc.MachineCode))
            v.Add("machineCode: thiếu trường bắt buộc (null/rỗng) — TagNamespaceStore.PutAsync bind nó làm " +
                  "tham số SQL; rỗng làm lần ghi hỏng ở tầng SQLite thay vì đỏ ở cửa này");

        if (doc.Tags is null)
        {
            v.Add("tags: thiếu trường bắt buộc (null) — một tài liệu không khai tags không phải tài liệu hợp lệ");
            return v; // nothing below can run without it.
        }

        for (var i = 0; i < doc.Tags.Count; i++)
        {
            var t = doc.Tags[i];
            if (t is null)
            {
                v.Add($"tags[{i}]: phần tử null — một tag rỗng không phải khai báo hợp lệ");
                continue;
            }

            // Path: bound as tag_index's PRIMARY KEY AND the unguarded `path` argument to
            // ModelIntegrity.IsPathPrefix — see this method's own doc comment. Access: a null value reads
            // as "not writable" below, silently bypassing the policyAction rule for an `rw` tag whose
            // `access` was simply omitted.
            if (string.IsNullOrWhiteSpace(t.Path))
                v.Add($"tags[{i}]: path thiếu (null/rỗng) — path là khoá chính của tag_index, bắt buộc phải có");
            if (string.IsNullOrWhiteSpace(t.Access))
                v.Add($"tags[{i}]: access thiếu (null/rỗng) — access rỗng âm thầm bỏ qua luật §5 (rw ⇒ policyAction)");

            // 🔴 WS-HMI-0c, MED-3 — the REMAINING schema-REQUIRED fields. `dataType`, `source` and
            // `source.kind` are in the frozen schema's `required` lists (a tag requires path/dataType/
            // access/source/isBackedByDriver; every arm of the source union requires kind), and every one
            // of them CAN arrive null from the same missing-field mechanism the three checks above exist
            // for: a non-nullable C# record property does not survive System.Text.Json on an absent field.
            //
            // WHY THIS CLASS'S OWN DISCLOSURE SAID OTHERWISE, AND WHY THAT ANSWER HAS CHANGED. The
            // paragraph in this method's remarks named these three as "deliberately NOT checked", and its
            // criterion was CRASH-SAFETY: does a null here throw at the door, or silently skip a §5 gate?
            // For all three the answer was no — the store writes the document as one JSON blob and
            // dereferences none of them. That reasoning was correct for the question it asked.
            //
            // MED-3 asked a different question: can a document the frozen schema FORBIDS be stored and
            // served? It could. An entry omitting `source` parsed, compiled, drew zero violations, threw
            // nothing, and serialised with `source` absent — so a schema-invalid namespace reached the
            // store and the read routes, and after WS-HMI-0c Task 4 it did so through a real ingestion
            // path rather than only a hand-built record. "Nothing crashes" and "the document is valid" are
            // two different properties, and this class is the only door that can answer the second.
            //
            // 🔴 WHAT THIS IS NOT: full JSON-Schema validation, which the disclosure rightly calls a
            // deliberate non-fix. No pattern is checked, no enum membership, no additionalProperties, no
            // conditional engMin/engMax rule. This is REQUIRED-FIELD PRESENCE and nothing else — the same
            // narrow class the three checks above already enforce, extended to the fields that were left
            // out of it. The schema stays the authority; this is the .NET side agreeing with it about
            // which fields must exist.
            if (string.IsNullOrWhiteSpace(t.DataType))
                v.Add($"tags[{i}]: dataType thiếu (null/rỗng) — schema bắt buộc; một tag không kiểu không đọc được");
            if (t.Source is null)
                v.Add($"tags[{i}]: source thiếu (null) — schema bắt buộc; một tag không nguồn không nói được giá trị đến từ đâu");
            else if (string.IsNullOrWhiteSpace(t.Source.Kind))
                v.Add($"tags[{i}]: source.kind thiếu (null/rỗng) — schema bắt buộc ở MỌI nhánh của union source");

            // 🔴 Fix round 4, MEDIUM-1 — IsNullOrWhiteSpace, the ONE predicate this class asks about a
            // missing required string, at EVERY site. Round 3 adopted it at the two fields a finding used
            // as illustrations and left the three §5 policyAction gates on the other one, so `" "` was
            // accepted and STORED (measured over HTTP: 200) while `""` was rejected — an ungated write
            // door reported as gated, on the gate whose entire stated purpose is "§5 cấm đường ghi không
            // gác". The enumeration that keeps this closed is a source scan, not three behaviours:
            // ContractInvariantsTests.ContractInvariants_uses_one_missing_string_predicate_at_every_site.
            if (WritableTagAccess.Contains(t.Access) && string.IsNullOrWhiteSpace(t.PolicyAction))
                v.Add($"tag '{t.Path}': access='{t.Access}' nhưng thiếu policyAction — §5 cấm đường ghi không gác");

            // 🔴 Fix round 4, HIGH-2 / P1 — the non-finite rule, applied to every floating-point field this
            // document exposes to JsonSerializer. See Validate(ComponentModelDocument) for the mechanism.
            AddIfNonFinite(v, t.EngMin, $"tag '{t.Path}'", "engMin");
            AddIfNonFinite(v, t.EngMax, $"tag '{t.Path}'", "engMax");
            AddIfNonFinite(v, t.Source?.Scale, $"tag '{t.Path}'", "source.scale");
        }

        // Một vi phạm mỗi PATH trùng, không phải một vi phạm mỗi lần xuất hiện: khai một path ba lần là
        // MỘT lỗi cần sửa, và ba dòng giống hệt nhau chỉ làm loãng danh sách.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var reported = new HashSet<string>(StringComparer.Ordinal);
        foreach (var t in doc.Tags)
        {
            if (t is null || string.IsNullOrWhiteSpace(t.Path)) continue; // already reported above.
            if (seen.Add(t.Path) || !reported.Add(t.Path)) continue;
            v.Add($"tag '{t.Path}': path bị khai nhiều lần trong cùng tài liệu — tag_index.path là khoá " +
                  "chính, nên bản khai thứ hai sẽ làm cả lần ghi hỏng ở tầng SQLite thay vì ở cửa này");
        }

        return v;
    }

    /// <summary>Kiểm luật §5 cho một <see cref="ComponentModelDocument"/>: mọi <see cref="ComponentTagDef"/>
    /// với <c>role</c> là <c>"setpoint"</c> hoặc <c>"command"</c> phải có <see cref="ComponentTagDef.PolicyAction"/>,
    /// và riêng <c>"setpoint"</c> còn phải có cả <see cref="ComponentTagDef.Min"/> và <see cref="ComponentTagDef.Max"/>.
    /// Trả về rỗng nếu hợp lệ; danh sách đầy đủ nếu không.
    ///
    /// <para>🔴 <b>WS-HMI-0b Task 1, fix round 1, HIGH-2 — <see cref="ComponentModelDocument.Components"/>
    /// and <see cref="ComponentModelDocument.Types"/> are checked for <see langword="null"/> FIRST, before
    /// either is dereferenced.</b> C#'s non-nullable annotation on an <c>IReadOnlyList&lt;&gt;</c> does not
    /// survive <c>System.Text.Json</c> deserializing a MISSING field — this solution enables neither
    /// <c>RespectNullableAnnotations</c> nor <c>RespectRequiredConstructorParameters</c> anywhere — so a
    /// client that omits <c>components</c> or <c>types</c> produces a genuine runtime <see langword="null"/>
    /// here, not an empty list. Before this fix, a null <c>Components</c> was invisible to this method
    /// entirely (nothing below ever read it) — it passed the §5 door silently, was WRITTEN by
    /// <c>ComponentModelStore.PutAsync</c>, and only then crashed downstream in
    /// <c>St4i.EngineApi.HmiModel.ModelIntegrity.Check</c> — after the half-record already existed on disk.
    /// A null <c>Types</c> failed the OPPOSITE way — <c>foreach (var type in doc.Types)</c> threw a bare
    /// <see cref="NullReferenceException"/> immediately, before the store's write and before a single
    /// violation could be collected.</para>
    ///
    /// <para>📎 🔴 <b>THE SENTENCE THAT FOLLOWED THIS ONE — "which happened to avoid persisting anything,
    /// but by luck (the dereference order), not by design. Both are now ordinary, reported §5 violations"
    /// — IS RETRACTED, kept in the git history rather than silently edited.</b> It was true of the two
    /// TOP-LEVEL fields it named and false of the method as a whole: two lines below it,
    /// <c>foreach (var t in type.Tags)</c> threw that exact same bare <see cref="NullReferenceException"/>,
    /// by that exact same luck, for a <c>type.Tags</c> omitted from the request — reproducing HIGH-2's full
    /// consequence set (write-then-crash, half-record, a permanently poisoned Operator-tier integrity
    /// route) through an ELEMENT-level null instead of a collection-level one. Round 1 checked whether the
    /// two COLLECTIONS were null; it never read a single ELEMENT of either. Round 2 (below) does — every
    /// element of <c>Components</c>, every element of <c>Types</c>, and every element of a type's own
    /// <c>Tags</c> is now checked for <see langword="null"/> before it is dereferenced, plus the two
    /// <see cref="ComponentNode"/> fields (<see cref="ComponentNode.Id"/>, <see cref="ComponentNode.TagPrefix"/>)
    /// whose null-ness is what actually crashes <c>ModelIntegrity.Check</c> — a <c>Dictionary</c> key and a
    /// string index bound, respectively.</para>
    ///
    /// <para>🔴 <b>THE BOUNDARY, DRAWN ON PURPOSE — stated so the next round does not have to re-discover
    /// it. Corrected at fix round 3 to name <see cref="ComponentModelDocument.MachineCode"/> at all, and
    /// AGAIN at fix round 4 because round 3's correction mis-filed it (re-review #3, LOW: it listed
    /// <c>MachineCode</c> under "makes this method or <c>ModelIntegrity.Check</c> throw", which it does
    /// NOT — it makes <c>ComponentModelStore.PutAsync</c> throw, on a SQL parameter bind, which this
    /// method's own inline comment three lines below the check states correctly. The paragraph and the code
    /// it documents disagreed about why the check exists, inside the paragraph whose job is to state why
    /// the checks exist — the same shape, a third time, in one file).</b></para>
    ///
    /// <para>This is a crash-prevention gate, not a JSON Schema validator (see this class's own top-level
    /// doc comment). <b>ONE criterion, stated once and used by all three overloads</b> — a field is checked
    /// iff:
    /// <list type="letter">
    ///   <item><description>its null / blank / non-finite value makes THIS METHOD, <c>ModelIntegrity.Check</c>,
    ///   or <b>a STORE'S OWN WRITE DOOR</b> throw something that is not a
    ///   <see cref="ContractViolationException"/> — the third of those is the clause round 3 left out, and
    ///   it is the one <c>MachineCode</c> (a SQL parameter bind) and the non-finite numeric rule below (a
    ///   <c>JsonSerializer.Serialize</c> call) both belong to; or</description></item>
    ///   <item><description>its null-ness makes this method silently skip the very §5 rule it exists to
    ///   enforce (<c>Role</c> here; <c>Access</c> and <c>Kind</c> in the sibling overloads).</description></item>
    /// </list>
    /// Under (a) for this overload: <c>MachineCode</c>, <c>Components</c>/its elements, <c>Id</c>,
    /// <c>TagPrefix</c>, <c>Types</c>/its elements, a type's <c>Tags</c>/its elements, and
    /// <see cref="ComponentTagDef.Min"/>/<see cref="ComponentTagDef.Max"/> when non-finite. Under (b):
    /// <c>Role</c>.</para>
    ///
    /// <para>🔴 <b>THE NON-FINITE RULE, and why it is criterion (a) rather than a §5 rule</b> (fix round 4,
    /// HIGH-2 — P1, "no client-authored body may produce a 500", measured FALSE by re-review #3).
    /// <c>{"role":"setpoint","min":1e400,"max":2,"policyAction":"p"}</c> satisfies EVERY §5 rule: min is
    /// not null, max is not null, policyAction is present. <c>1e400</c> deserializes to
    /// <see cref="double.PositiveInfinity"/>, and <c>JsonSerializer.Serialize</c> then throws
    /// <see cref="ArgumentException"/> ("...positive and negative infinity cannot be written as valid
    /// JSON") inside <c>ComponentModelStore.PutAsync</c> — not a <see cref="ContractViolationException"/>,
    /// so it escaped the endpoint's <c>catch</c> and became a bare 500. Checked for EVERY floating-point
    /// field of all three contracts, not for <c>min</c>: <see cref="ComponentTagDef.Min"/>/<c>Max</c>,
    /// <see cref="TagDescriptor.EngMin"/>/<c>EngMax</c>, <see cref="TagSource.Scale"/> — five fields, and
    /// <c>ContractInvariantsTests.Every_floating_point_field_that_reaches_serialisation_is_covered_by_the_non_finite_rule</c>
    /// re-derives that list by REFLECTION so a sixth one cannot be added silently. Deliberately independent
    /// of <c>role</c>: the hard band is a §5 rule about <c>setpoint</c>, but serialisation happens for every
    /// tag, so an <c>in</c> tag with a non-finite <c>min</c> is the same 500. <b>The rejected alternative,
    /// named:</b> <c>JsonNumberHandling.AllowNamedFloatingPointLiterals</c> on
    /// <see cref="HmiContractJson.Options"/> would stop the throw and persist <c>Infinity</c> into a
    /// document the frozen JSON Schema rejects — trading a 500 for a corrupt record.</para>
    ///
    /// <para><b>Named and deliberately NOT checked:</b> <see cref="ComponentNode.TypeId"/>,
    /// <see cref="ComponentNode.Label"/>, <see cref="ComponentTypeDef.TypeId"/>,
    /// <see cref="ComponentTypeDef.Label"/>, <see cref="ComponentTypeDef.DefaultFaceplate"/>,
    /// <see cref="ComponentTypeDef.States"/>/its elements, <see cref="ComponentTagDef.PolicyAction"/> when
    /// the role is not writable, <see cref="ComponentTagDef.Name"/>, <see cref="ComponentTagDef.DataType"/>,
    /// and every field of <see cref="ComponentStateDef"/>. Each is declared non-nullable by its record too,
    /// and each CAN arrive null from the same missing-field mechanism — but none is ever dereferenced by
    /// this method or by <c>ModelIntegrity.Check</c> in a way that throws, and none gates another §5 check
    /// the way <c>Role</c> does (a null <see cref="ComponentTypeDef.TypeId"/>, for one concrete example, is
    /// silently accepted and reported at 200 — measured, fix round 2's report). Closing THAT gap is full
    /// JSON-Schema-shape validation, a DIFFERENT and larger job than this class has ever claimed, stated
    /// here as a deliberate non-fix rather than left for a future reviewer to find.</para></summary>
    public static IReadOnlyList<string> Validate(ComponentModelDocument doc)
    {
        var v = new List<string>();

        // 🔴 Fix round 3 — ComponentModelStore.PutAsync binds MachineCode as a SQL parameter
        // (`@machine_code`); a null value throws InvalidOperationException ("Value must be set."), not a
        // ContractViolationException, so a direct store caller (bypassing HTTP, where a route segment can
        // never be null) got a non-mappable exception from a door whose entire contract is
        // ContractViolationException. Not client-reachable over HTTP in Task 1 — HmiModelEndpoints.PutAsync
        // normalises the body to the route before this is ever called — but this door serves every caller,
        // not only the HTTP one (see this method's own doc comment).
        if (string.IsNullOrWhiteSpace(doc.MachineCode))
            v.Add("machineCode: thiếu trường bắt buộc (null/rỗng) — ComponentModelStore.PutAsync bind nó làm " +
                  "tham số SQL; rỗng làm lần ghi hỏng ở tầng SQLite thay vì đỏ ở cửa này");

        if (doc.Components is null)
        {
            v.Add("components: thiếu trường bắt buộc (null) — một tài liệu không khai components không phải tài liệu hợp lệ");
        }
        else
        {
            for (var i = 0; i < doc.Components.Count; i++)
            {
                var node = doc.Components[i];
                if (node is null)
                {
                    v.Add($"components[{i}]: phần tử null — một component rỗng không phải khai báo hợp lệ");
                    continue;
                }

                // Id and TagPrefix are the two ComponentNode fields whose null-ness actually crashes
                // ModelIntegrity.Check downstream (a Dictionary key via groupedById.ToDictionary, and a
                // string index bound inside IsPathPrefix, respectively) — see this method's own doc
                // comment for why TypeId/Label are declared non-nullable too but NOT checked here.
                // IsNullOrWhiteSpace, not IsNullOrEmpty (fix round 3, re-review #2 LOW): a whitespace-only
                // "id":" " is just as unusable a Dictionary/binding key as an empty one, and the sibling
                // route/body-code guard in HmiModelEndpoints.cs already used IsNullOrWhiteSpace — the two
                // halves of one fix now agree on what "missing" means.
                if (string.IsNullOrWhiteSpace(node.Id))
                    v.Add($"components[{i}]: id thiếu (null/rỗng) — id là khoá ModelIntegrity/binding gián tiếp " +
                          "{component} phân giải qua, bắt buộc phải có");
                if (string.IsNullOrWhiteSpace(node.TagPrefix))
                    v.Add($"components[{i}]: tagPrefix thiếu (null/rỗng) — bắt buộc phải có để đối chiếu tham chiếu namespace");
            }
        }

        if (doc.Types is null)
        {
            v.Add("types: thiếu trường bắt buộc (null) — một tài liệu không khai types không phải tài liệu hợp lệ");
            return v; // nothing below can run without it.
        }

        for (var i = 0; i < doc.Types.Count; i++)
        {
            var type = doc.Types[i];
            if (type is null)
            {
                v.Add($"types[{i}]: phần tử null — một componentType rỗng không phải khai báo hợp lệ");
                continue;
            }
            if (type.Tags is null)
            {
                v.Add($"componentType '{type.TypeId}': tags thiếu (null) — một kiểu không khai tags không phải khai báo hợp lệ");
                continue;
            }

            for (var j = 0; j < type.Tags.Count; j++)
            {
                var t = type.Tags[j];
                if (t is null)
                {
                    v.Add($"componentType '{type.TypeId}': tags[{j}] là phần tử null — một componentTag rỗng không phải khai báo hợp lệ");
                    continue;
                }

                // Fix round 3 — a null Role reads as "not writable" below (Contains(null) is false, not an
                // exception), which would let a setpoint/command tag whose OWN role was omitted silently
                // skip the policyAction/min/max checks immediately below it — the exact "an ungated write
                // door" shape this class exists to close, one field over from the case WS-HMI-0a's own
                // review found (Access: "rw", PolicyAction: null).
                if (string.IsNullOrWhiteSpace(t.Role))
                    v.Add($"componentTag '{type.TypeId}.{t.Name}': role thiếu (null/rỗng) — role rỗng âm thầm bỏ qua luật §5");

                var writable = WritableComponentTagRoles.Contains(t.Role);
                // IsNullOrWhiteSpace, not the other predicate — see the identical note in
                // Validate(TagNamespaceDocument) for why " " on a §5 gate is the worst place for the two
                // to disagree (fix round 4, MEDIUM-1).
                if (writable && string.IsNullOrWhiteSpace(t.PolicyAction))
                    v.Add($"componentTag '{type.TypeId}.{t.Name}': role='{t.Role}' nhưng thiếu policyAction — §5");
                var needsHardBand = HardBandComponentTagRoles.Contains(t.Role);
                if (needsHardBand && t.Min is null)
                    v.Add($"componentTag '{type.TypeId}.{t.Name}': {t.Role} thiếu min — dải chặn cứng là bắt buộc");
                if (needsHardBand && t.Max is null)
                    v.Add($"componentTag '{type.TypeId}.{t.Name}': {t.Role} thiếu max — dải chặn cứng là bắt buộc");

                // 🔴 Fix round 4, HIGH-2 / P1 — non-finite, for EVERY tag, not only a setpoint: the hard
                // band above is a §5 rule about a role, this is criterion (a) about serialisation, and
                // serialisation happens for every tag. See this method's own doc comment.
                AddIfNonFinite(v, t.Min, $"componentTag '{type.TypeId}.{t.Name}'", "min");
                AddIfNonFinite(v, t.Max, $"componentTag '{type.TypeId}.{t.Name}'", "max");
            }
        }

        return v;
    }

    /// <summary>The ONE place the non-finite rule is written, so the five call sites cannot drift into five
    /// spellings of it. <see langword="null"/> is NOT a violation here — an absent optional number is a
    /// different question, owned by the §5 hard-band rule for the two fields that have one.</summary>
    private static void AddIfNonFinite(List<string> v, double? value, string subject, string field)
    {
        if (value is null || double.IsFinite(value.Value)) return;
        v.Add($"{subject}: {field} không phải số hữu hạn ({value.Value}) — JsonSerializer.Serialize của cửa " +
              "ghi ném ArgumentException với NaN/±∞, tức một thân do client soạn hạ cánh thành 500 không " +
              "lời giải thích thay vì một vi phạm 400");
    }

    /// <summary>Kiểm luật §5 cho một <see cref="HmiScreenDocument"/>: mọi <see cref="ScreenWidget"/> có
    /// <c>kind</c> là <c>"setpoint-input"</c> hoặc <c>"command-button"</c> phải có
    /// <see cref="ScreenWidget.PolicyAction"/>. Trả về rỗng nếu hợp lệ; danh sách đầy đủ nếu không.
    ///
    /// <para>🔴 <b>Vì sao overload này tồn tại</b> (review toàn nhánh WS-HMI-0a, Important 4). Trước nó,
    /// <see cref="ContractInvariants"/> đóng hai trong ba hợp đồng đã đóng băng, và luật §5 nói TRỰC TIẾP
    /// nhất — "một nút lệnh không có policyAction là một đường ghi không gác" — là luật KHÔNG được đóng:
    /// <c>new ScreenWidget("b1", "command-button", rect, PolicyAction: null)</c> biên dịch được và không
    /// gì trong cây .NET phản đối. Việc hoãn là bảo vệ được (chưa có mã .NET nào lưu hay nhận một tài liệu
    /// màn hình), nhưng cái KHÔNG bảo vệ được là hoãn mà không nói ra — đoạn giới hạn của class này liệt kê
    /// ba luật và không kể luật này, nên người đọc kết luận §5 đã đóng ở phía .NET. Đóng nó rẻ hơn là ghi
    /// chú về nó.</para>
    ///
    /// <para><b>Bài kiểm này KHÔNG đo:</b> tư cách thành viên của <c>kind</c> trong enum của schema. Một
    /// widget <c>kind: "commandbutton"</c> (gõ sai) KHÔNG khớp danh sách ghi-được ở đây, nên nó đi qua bộ
    /// kiểm này im lặng — schema là thứ từ chối nó, và <c>SchemaEnumGuardPinTests</c> ở
    /// <c>St4i.Hmi.Contracts.Tests</c> là thứ báo đỏ nếu enum của schema rộng ra mà danh sách này thì
    /// không.</para>
    ///
    /// <para>🔴 <b>WS-HMI-0b Task 1, fix round 2 — <see cref="HmiScreenDocument.Widgets"/> is checked for
    /// <see langword="null"/> first, and every element is checked for <see langword="null"/> before it is
    /// dereferenced.</b> The SECOND of the two twins review found sharing
    /// <see cref="Validate(ComponentModelDocument)"/>'s exact pre-fix hole — same mechanism, same missing
    /// guard, same bare <see cref="NullReferenceException"/> from <c>foreach (var w in doc.Widgets)</c>.
    /// Fixed alongside <see cref="Validate(TagNamespaceDocument)"/> while the reasoning was in front of the
    /// fix, even though no .NET store writes an <see cref="HmiScreenDocument"/> today (see this class's own
    /// remarks on <see cref="ThrowIfInvalid(HmiScreenDocument)"/>) — cheaper to close now than to leave for
    /// whichever task builds that store to rediscover.</para>
    ///
    /// <para>🔴 <b>Fix round 3 — element-NULL depth (round 2) was not element-FIELD depth.</b> Re-review #2
    /// measured <c>new ScreenWidget(Id: null, Kind: null, Rect: null)</c> passing at 0 violations.
    /// <see cref="ScreenWidget.Id"/> is now required (its own identity key, the same role
    /// <see cref="ComponentNode.Id"/> plays — no store dereferences it unsafely today because no store
    /// writes this type at all, checked anyway for the same declared-required, same missing-field-mechanism
    /// reasoning applied everywhere else this round). <see cref="ScreenWidget.Kind"/> is required for the
    /// SAME non-crash reason <see cref="TagDescriptor.Access"/> and <see cref="ComponentTagDef.Role"/> are
    /// (see their own checks): a null <c>Kind</c> reads as "not writable" below, silently skipping the
    /// policyAction rule for a <c>command-button</c>/<c>setpoint-input</c> widget whose OWN <c>kind</c> was
    /// omitted.</para>
    ///
    /// <para>📎 🔴 <b>THE SENTENCE THAT FOLLOWED — "<see cref="WidgetRect"/> is deliberately NOT checked —
    /// nothing dereferences it" — IS RETRACTED at fix round 4, kept in git history rather than silently
    /// edited.</b> It was true, and it disqualified <see cref="ScreenWidget.Id"/> too: three sentences
    /// above it, <c>Id</c> was checked while CONCEDING that "no store dereferences it unsafely today
    /// because no store writes this type at all". Two fields of one record, two mutually incompatible
    /// criteria (re-review #3, LOW). Also 0-violation and unmentioned anywhere:
    /// <see cref="HmiScreenDocument.ScreenId"/>, <see cref="HmiScreenDocument.Title"/>,
    /// <see cref="HmiScreenDocument.Theme"/>, <see cref="HmiScreenDocument.Layout"/>.</para>
    ///
    /// <para>🔴 <b>THE BOUNDARY FOR THIS OVERLOAD — one criterion, and the ONE tie-break it needs, both
    /// stated rather than left to be inferred field by field.</b> The criterion is the same one
    /// <see cref="Validate(ComponentModelDocument)"/> states in full: (a) crashes something at a write door
    /// or in <c>ModelIntegrity.Check</c>, or (b) silently disables a §5 gate. <b>Clause (a) is VACUOUS for
    /// this whole overload</b> — no .NET store writes an <see cref="HmiScreenDocument"/>, so no field can be
    /// shown to crash a door that does not exist, and reading that vacuum as "checked" for <c>Id</c> and as
    /// "not checked" for <c>Rect</c> is precisely the incoherence above. The tie is therefore broken ONCE,
    /// for the WHOLE overload, in one direction: <b>every field the frozen record declares NON-NULLABLE is
    /// required</b> — <c>ScreenId</c>, <c>Title</c>, <c>Theme</c>, <c>Layout</c> (and its
    /// <see cref="ScreenLayout.Breakpoint"/>), <c>Widgets</c>, and per widget <c>Id</c>, <c>Kind</c>,
    /// <c>Rect</c>. Chosen over the opposite tie-break (drop the <c>Id</c> check) because this validator is
    /// a door built AHEAD of the store that will use it, and when that store arrives <c>ScreenId</c> will
    /// be its primary key and <c>Rect</c>'s ints will be bound or laid out — so the strict direction is the
    /// one that will still be right then. <b>Not required, because the record declares them nullable:</b>
    /// <see cref="HmiScreenDocument.TitleEn"/>, <see cref="ScreenWidget.Component"/>,
    /// <see cref="ScreenWidget.Bindings"/>, <see cref="ScreenWidget.Props"/>, and
    /// <see cref="ScreenWidget.PolicyAction"/> for a non-writable <c>kind</c>. <b>This overload's criterion
    /// therefore differs from its two siblings' — deliberately, for the stated reason — and that is said
    /// out loud rather than presented as one rule covering all three.</b> There is no non-finite check
    /// here because this contract exposes no floating-point field at all (verified by the reflection walk
    /// in <c>Every_floating_point_field_that_reaches_serialisation_is_covered_by_the_non_finite_rule</c>);
    /// every number it carries is an <see langword="int"/>.</para></summary>
    public static IReadOnlyList<string> Validate(HmiScreenDocument doc)
    {
        var v = new List<string>();

        // Fix round 4 — the document's own non-nullable fields, on the criterion this method's doc comment
        // states. Previously all four were silently 0-violation and named nowhere.
        if (string.IsNullOrWhiteSpace(doc.ScreenId))
            v.Add("screenId: thiếu trường bắt buộc (null/rỗng) — bắt buộc phải có");
        if (string.IsNullOrWhiteSpace(doc.Title))
            v.Add("title: thiếu trường bắt buộc (null/rỗng) — bắt buộc phải có");
        if (string.IsNullOrWhiteSpace(doc.Theme))
            v.Add("theme: thiếu trường bắt buộc (null/rỗng) — bắt buộc phải có");
        if (doc.Layout is null)
            v.Add("layout: thiếu trường bắt buộc (null) — một màn hình không khai lưới đặt widget không phải tài liệu hợp lệ");
        else if (string.IsNullOrWhiteSpace(doc.Layout.Breakpoint))
            v.Add("layout: breakpoint thiếu (null/rỗng) — bắt buộc phải có");

        if (doc.Widgets is null)
        {
            v.Add("widgets: thiếu trường bắt buộc (null) — một tài liệu không khai widgets không phải tài liệu hợp lệ");
            return v;
        }

        for (var i = 0; i < doc.Widgets.Count; i++)
        {
            var w = doc.Widgets[i];
            if (w is null)
            {
                v.Add($"widgets[{i}]: phần tử null — một widget rỗng không phải khai báo hợp lệ");
                continue;
            }

            if (string.IsNullOrWhiteSpace(w.Id))
                v.Add($"widgets[{i}]: id thiếu (null/rỗng) — bắt buộc phải có");
            if (string.IsNullOrWhiteSpace(w.Kind))
                v.Add($"widgets[{i}]: kind thiếu (null/rỗng) — kind rỗng âm thầm bỏ qua luật §5");
            // Fix round 4 — checked on the SAME criterion that requires `id` two lines above, which is the
            // whole point: round 3 excluded `rect` for a reason that disqualified `id` as well.
            if (w.Rect is null)
                v.Add($"widgets[{i}]: rect thiếu (null) — bắt buộc phải có");

            if (WritableWidgetKinds.Contains(w.Kind) && string.IsNullOrWhiteSpace(w.PolicyAction))
                v.Add($"widget '{w.Id}': kind='{w.Kind}' nhưng thiếu policyAction — §5 cấm đường ghi không gác");
        }

        return v;
    }

    /// <summary>Như <see cref="Validate(TagNamespaceDocument)"/> nhưng ném <see cref="ContractViolationException"/>
    /// mang toàn bộ vi phạm thay vì trả về danh sách — dùng ở cửa ghi của store.</summary>
    public static void ThrowIfInvalid(TagNamespaceDocument doc)
    {
        var v = Validate(doc);
        if (v.Count > 0) throw new ContractViolationException(v);
    }

    /// <summary>Như <see cref="Validate(ComponentModelDocument)"/> nhưng ném <see cref="ContractViolationException"/>
    /// mang toàn bộ vi phạm thay vì trả về danh sách — dùng ở cửa ghi của store.</summary>
    public static void ThrowIfInvalid(ComponentModelDocument doc)
    {
        var v = Validate(doc);
        if (v.Count > 0) throw new ContractViolationException(v);
    }

    /// <summary>Như <see cref="Validate(HmiScreenDocument)"/> nhưng ném <see cref="ContractViolationException"/>
    /// mang toàn bộ vi phạm thay vì trả về danh sách.
    ///
    /// <para>🔴 <b>CHƯA CÓ AI GỌI HÀM NÀY</b>, và điều đó được viết ra thay vì để người đọc suy: không có
    /// store .NET nào lưu <see cref="HmiScreenDocument"/> hôm nay, nên đây là một CỬA CHƯA GẮN VÀO TƯỜNG.
    /// Nó tồn tại để WS-HMI-0b gọi ở đúng chỗ hai anh em của nó đang được gọi (<c>PutAsync</c> của store),
    /// chứ không phải để ai đó đọc sự tồn tại của nó thành "màn hình đã được gác".</para></summary>
    public static void ThrowIfInvalid(HmiScreenDocument doc)
    {
        var v = Validate(doc);
        if (v.Count > 0) throw new ContractViolationException(v);
    }
}
