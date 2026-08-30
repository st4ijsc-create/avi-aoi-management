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
/// </list></para>
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
    /// day one, under a test suite with no reason to go looking for it.</para></summary>
    public static IReadOnlyList<string> Validate(TagNamespaceDocument doc)
    {
        var v = new List<string>();

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
            if (WritableTagAccess.Contains(t.Access) && string.IsNullOrEmpty(t.PolicyAction))
                v.Add($"tag '{t.Path}': access='{t.Access}' nhưng thiếu policyAction — §5 cấm đường ghi không gác");
        }

        // Một vi phạm mỗi PATH trùng, không phải một vi phạm mỗi lần xuất hiện: khai một path ba lần là
        // MỘT lỗi cần sửa, và ba dòng giống hệt nhau chỉ làm loãng danh sách.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var reported = new HashSet<string>(StringComparer.Ordinal);
        foreach (var t in doc.Tags)
        {
            if (t is null) continue; // already reported above — not this loop's concern.
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
    /// <para>🔴 <b>THE BOUNDARY, DRAWN ON PURPOSE — stated so a THIRD round does not have to re-discover
    /// it.</b> This is a crash-prevention gate, not a JSON Schema validator (see this class's own top-level
    /// doc comment): every field checked here is checked because its null-ness makes EITHER this method OR
    /// <c>ModelIntegrity.Check</c> throw an unhandled exception instead of returning an ordinary violation.
    /// <see cref="ComponentNode.TypeId"/>, <see cref="ComponentNode.Label"/>,
    /// <see cref="ComponentTypeDef.TypeId"/>, <see cref="ComponentTypeDef.Label"/>,
    /// <see cref="ComponentTypeDef.DefaultFaceplate"/>, <see cref="ComponentTypeDef.States"/>, and
    /// <see cref="ComponentTagDef.Role"/>/<see cref="ComponentTagDef.PolicyAction"/>/<see cref="ComponentTagDef.Name"/>
    /// are each declared non-nullable by their record too, and each CAN arrive null from the same missing-
    /// field mechanism — but none of them is ever dereferenced by this method or by
    /// <c>ModelIntegrity.Check</c> in a way that throws (a null <see cref="ComponentTypeDef.TypeId"/>, for
    /// one concrete example, is silently accepted and reported at 200 — see this task's fix round 2 report).
    /// Closing that gap is full JSON-Schema-shape validation, a DIFFERENT and larger job than this class has
    /// ever claimed, stated here as a deliberate non-fix rather than left for a THIRD reviewer to find.</para></summary>
    public static IReadOnlyList<string> Validate(ComponentModelDocument doc)
    {
        var v = new List<string>();

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
                if (string.IsNullOrEmpty(node.Id))
                    v.Add($"components[{i}]: id thiếu (null/rỗng) — id là khoá ModelIntegrity/binding gián tiếp " +
                          "{component} phân giải qua, bắt buộc phải có");
                if (string.IsNullOrEmpty(node.TagPrefix))
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

                var writable = WritableComponentTagRoles.Contains(t.Role);
                if (writable && string.IsNullOrEmpty(t.PolicyAction))
                    v.Add($"componentTag '{type.TypeId}.{t.Name}': role='{t.Role}' nhưng thiếu policyAction — §5");
                var needsHardBand = HardBandComponentTagRoles.Contains(t.Role);
                if (needsHardBand && t.Min is null)
                    v.Add($"componentTag '{type.TypeId}.{t.Name}': {t.Role} thiếu min — dải chặn cứng là bắt buộc");
                if (needsHardBand && t.Max is null)
                    v.Add($"componentTag '{type.TypeId}.{t.Name}': {t.Role} thiếu max — dải chặn cứng là bắt buộc");
            }
        }

        return v;
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
    /// whichever task builds that store to rediscover.</para></summary>
    public static IReadOnlyList<string> Validate(HmiScreenDocument doc)
    {
        var v = new List<string>();

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
            if (WritableWidgetKinds.Contains(w.Kind) && string.IsNullOrEmpty(w.PolicyAction))
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
