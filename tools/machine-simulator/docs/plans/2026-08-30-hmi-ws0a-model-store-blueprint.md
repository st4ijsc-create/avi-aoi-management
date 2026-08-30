# WS-HMI-0a — Mô hình linh kiện & Tag Namespace: bất biến + lưu trữ
# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho Machine Edition một chỗ lưu bền cho cây linh kiện và tag namespace của mỗi máy, và đóng bất đối xứng an toàn mà review cuối Mốc 0 đã nêu — phía C# hiện dựng được một tag ghi không gác mà không gì phản đối.

**Architecture:** Hai store SQLite thô theo đúng khuôn `AssetRegistryStore`/`SqliteHistorianStore`/`SecurityDb` đã có: một file `.db`, thư mục lấy từ biến môi trường, thang migration theo `PRAGMA user_version`, WAL, kết nối ngắn. Tài liệu được lưu **nguyên dạng JSON** theo hợp đồng đã đóng băng ở Mốc 0, cộng một bảng chỉ mục để tra cứu theo `path`. Mọi đường ghi đi qua một bộ bất biến chung đặt trong chính contract assembly, nên không tồn tại cửa nào ghi được một tài liệu vi phạm luật an toàn.

**Tech Stack:** .NET 10 · `Microsoft.Data.Sqlite` (đã có trong cây) · xUnit · `St4i.Hmi.Contracts` (net10.0, **zero dependency**).

**Spec:** [docs/HMI_BUILDER_DESIGN_2026-08-29.md](../HMI_BUILDER_DESIGN_2026-08-29.md) §3.1, §3.2, §5. Hợp đồng đã đóng băng: [contracts/README.md](../../contracts/README.md).

---

## Phạm vi — và hai kế hoạch anh em KHÔNG nằm trong đây

`WS-HMI-0` trong spec gồm ba hệ con tách rời được. Kế hoạch này là **hệ con thứ nhất**, và nó chạy được, kiểm được một mình:

| | Nội dung | Trạng thái |
|---|---|---|
| **WS-HMI-0a** (kế hoạch này) | Bất biến hợp đồng phía C# + hai store SQLite + toàn vẹn tham chiếu + wiring | viết đủ ở đây |
| WS-HMI-0b | `/v1/components`, `/v1/component-types`, `/v1/tags`, SSE subscribe | kế hoạch riêng, viết sau |
| WS-HMI-0c | Nạp tag thật từ Modbus / OPC-UA / simulated, thay `mapping/*.json` | kế hoạch riêng, viết sau |

Tách vì mỗi phần có một cổng review riêng có nghĩa: 0a sai thì dữ liệu hỏng, 0b sai thì API hỏng, 0c sai thì số liệu sai. Gộp lại thì một reviewer không từ chối được phần này mà chấp nhận phần kia.

---

## Global Constraints

- **`St4i.Hmi.Contracts` giữ ZERO `PackageReference`.** Bất biến ở Task 1 vào đúng assembly đó, nên nó không được kéo theo gì. Nếu bạn thấy mình cần một thư viện, dừng lại và báo.
- **Target `net10.0` thuần** cho contract assembly; store nằm trong `St4i.EngineApi` (theo đúng `AssetRegistry/`), target của project đó không đổi.
- **Chạy test .NET TỪNG PROJECT MỘT** — `dotnet test` cả solution **không ổn định trên máy này**. Dùng đường dẫn tuyệt đối; thư mục làm việc của shell được giữ giữa các lần gọi và đã từng làm mọi đường dẫn tương đối trỏ sai.
- **Không sửa hợp đồng.** `contracts/*.schema.json`, các record trong `St4i.Hmi.Contracts`, và `web/src/contracts/*.ts` đã ĐÓNG BĂNG ở Mốc 0. Nếu kế hoạch này có vẻ đòi một trường mới, dừng lại và báo — đổi hợp đồng là đổi **bốn chỗ trong một commit** kèm quy trình ở [contracts/README.md](../../contracts/README.md), không phải việc lẻ.
- **Luật không-null-tường-minh** áp cho mọi JSON store này ghi ra: khoá vắng mặt CHÍNH LÀ null. Dùng `HmiContractJson.Options` (camelCase, `WhenWritingNull`), không tự dựng `JsonSerializerOptions` mới.
- **Bất biến an toàn §5:** một tag `access: "rw"` bắt buộc có `policyAction`; một `componentTag` `role` là `setpoint`/`command` bắt buộc có `policyAction`, và `setpoint` bắt buộc thêm `min`/`max`. Ở tầng này chúng phải được **mã kiểm**, không chỉ được schema kiểm.
- **Mỗi bài test nói rõ nó KHÔNG đo cái gì**, trong XML doc comment — quy ước của kho này, xem `MachineConfigDesignDocTableTests`.
- **Bất biến bán-được §5-bis:** không task nào ở đây tạo dữ liệu mặc định. Một máy chưa khai linh kiện có namespace RỖNG, và rỗng là trạng thái hợp lệ — không phải lỗi, không phải màn chặn.
- Commit sau mỗi task, thông điệp tiếng Anh.

---

## Quyết định thiết kế cần biết trước khi đọc task

**Lưu tài liệu nguyên dạng JSON, không chuẩn hoá thành bảng quan hệ.** Hợp đồng đã đóng băng LÀ hình dạng dữ liệu; dựng lại nó thành cột là tạo ra một bản sao thứ hai để lệch, đúng loại khuyết tật kho này đã trả giá nhiều lần (xem khối `🔴` trong `MACHINE_CONFIG_DESIGN.md` §3). Đổi lại, ta mất khả năng truy vấn SQL theo trường — nên có **một bảng chỉ mục phẳng** chỉ cho thứ thật sự cần tra nhanh: `path` của tag. Mọi thứ khác đọc cả tài liệu rồi lọc trong bộ nhớ, và ở quy mô một máy (hàng trăm tag, không phải hàng triệu) đó là đúng đánh đổi.

**`quality` không có ở đây.** Spec §3.2 gọi nó là trường của tag, nhưng Mốc 0 đã hoãn nó có văn bản lý do: `quality` là trạng thái sống theo từng lần đọc, thuộc hợp đồng giá-trị-sống mà `WS-HMI-0c` sẽ định nghĩa, không thuộc tài liệu khai báo tĩnh. Store này lưu **khai báo**, không lưu giá trị.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/St4i.Hmi.Contracts/ContractInvariants.cs` | Luật an toàn §5 viết thành mã, dùng chung bởi mọi đường ghi .NET |
| `src/St4i.EngineApi/HmiModel/IComponentModelStore.cs` | Seam đọc/ghi cây linh kiện |
| `src/St4i.EngineApi/HmiModel/ComponentModelStore.cs` | SQLite `hmi-model.db` |
| `src/St4i.EngineApi/HmiModel/ITagNamespaceStore.cs` | Seam đọc/ghi namespace |
| `src/St4i.EngineApi/HmiModel/TagNamespaceStore.cs` | SQLite `hmi-tags.db` + chỉ mục `path` |
| `src/St4i.EngineApi/HmiModel/ModelIntegrity.cs` | Toàn vẹn tham chiếu giữa hai tài liệu |
| `tests/St4i.Hmi.Contracts.Tests/ContractInvariantsTests.cs` | |
| `tests/St4i.EngineApi.Tests/HmiModel/ComponentModelStoreTests.cs` | |
| `tests/St4i.EngineApi.Tests/HmiModel/TagNamespaceStoreTests.cs` | |
| `tests/St4i.EngineApi.Tests/HmiModel/ModelIntegrityTests.cs` | |

Hai store tách hai file `.db` vì chúng có vòng đời khác nhau: cây linh kiện đổi khi kỹ sư khai báo lại máy, namespace đổi mỗi lần connector nạp lại. Gộp một file thì một lần nạp tag khoá luôn cây linh kiện.

---

## Task 1: Bất biến hợp đồng phía C#

Đây là task quan trọng nhất của kế hoạch, và lý do nó tồn tại đáng đọc kỹ.

Review cuối Mốc 0 ghi nhận: schema từ chối được một tag `rw` thiếu `policyAction`, nhưng **phía C# khai mọi enum là `string`**, nên một producer .NET dựng `new TagDescriptor(..., Access: "rw", PolicyAction: null, ...)` rồi serialize sẽ tạo ra một tài liệu vi phạm luật an toàn mà **không gì trong cây .NET phản đối**. Chỉ bộ validate phía web mới bắt được, và nó chỉ chạy khi ai đó chạy nó. Store là cửa ghi đầu tiên của phía .NET, nên bất biến phải đứng ở đây.

**Files:**
- Create: `src/St4i.Hmi.Contracts/ContractInvariants.cs`
- Test: `tests/St4i.Hmi.Contracts.Tests/ContractInvariantsTests.cs`

**Interfaces:**
- Consumes: `TagNamespaceDocument`, `TagDescriptor`, `ComponentModelDocument`, `ComponentTagDef` (Mốc 0).
- Produces — Task 2, 3, 4 gọi đúng các hàm này:
  - `ContractInvariants.Validate(TagNamespaceDocument doc)` → `IReadOnlyList<string>` (rỗng = hợp lệ)
  - `ContractInvariants.Validate(ComponentModelDocument doc)` → `IReadOnlyList<string>`
  - `ContractInvariants.ThrowIfInvalid(TagNamespaceDocument doc)` / `ThrowIfInvalid(ComponentModelDocument doc)` → ném `ContractViolationException`
  - `ContractViolationException` với property `Violations` (`IReadOnlyList<string>`)

- [ ] **Step 1: Viết bài test thất bại**

`tests/St4i.Hmi.Contracts.Tests/ContractInvariantsTests.cs`:

```csharp
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
/// </summary>
public class ContractInvariantsTests
{
    static TagSource Sim() => new("simulated");

    static TagDescriptor Tag(string access, string? policyAction) =>
        new("M1/x/y", "bool", null, null, null, null, access, policyAction, Sim(), false);

    static TagNamespaceDocument Ns(params TagDescriptor[] tags) => new(1, "M1", tags);

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
        var violations = ContractInvariants.Validate(Ns(Tag("rw", null), Tag("rw", null)));
        Assert.Equal(2, violations.Count);
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
```

> ✅ **Thứ tự tham số đã được đo, không phải nhớ.** `src/St4i.Hmi.Contracts/ComponentModelDocument.cs:37-39`
> khai `ComponentTagDef(string Name, string Role, string DataType, IReadOnlyList<string>? EnumValues,`
> `string? Unit, double? Min, double? Max, string? PolicyAction)` — tám tham số, `EnumValues` ở vị trí
> **thứ tư** (Mốc 0 chèn nó vào đó khi đóng khoảng trống `dataType: "enum"` không có chỗ khai giá trị).
> Mọi lời gọi trong kế hoạch này dùng đúng thứ tự ấy. `ComponentStateDef` là `(Name, Expr, Tone)`.
> Record đã đóng băng: nếu một bài test không khớp, sửa bài test, không sửa record.

- [ ] **Step 2: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.Hmi.Contracts.Tests`
Kỳ vọng: **lỗi biên dịch** — `ContractInvariants` và `ContractViolationException` chưa tồn tại. Đây là màu đỏ đúng.

- [ ] **Step 3: Viết bất biến**

`src/St4i.Hmi.Contracts/ContractInvariants.cs`:

```csharp
namespace St4i.Hmi.Contracts;

/// <summary>Ném khi một tài liệu vi phạm luật an toàn §5. <see cref="Violations"/> mang TOÀN BỘ vi phạm,
/// không phải cái đầu tiên — người sửa cần thấy hết trong một lần.</summary>
public sealed class ContractViolationException : Exception
{
    public IReadOnlyList<string> Violations { get; }

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
/// đúng ba luật §5 và không gì khác — không pattern, không kiểu, không trường lạ. Một tài liệu qua được
/// đây vẫn có thể bị schema từ chối. Và nó chỉ chạy ở nơi có ai đó gọi nó; serialize thẳng bằng
/// <c>JsonSerializer</c> vẫn đi vòng qua được. Bảo vệ nằm ở CỬA GHI (các store), không ở kiểu dữ liệu.</para>
/// </summary>
public static class ContractInvariants
{
    public static IReadOnlyList<string> Validate(TagNamespaceDocument doc)
    {
        var v = new List<string>();
        foreach (var t in doc.Tags)
            if (t.Access == "rw" && string.IsNullOrEmpty(t.PolicyAction))
                v.Add($"tag '{t.Path}': access='rw' nhưng thiếu policyAction — §5 cấm đường ghi không gác");
        return v;
    }

    public static IReadOnlyList<string> Validate(ComponentModelDocument doc)
    {
        var v = new List<string>();
        foreach (var type in doc.Types)
        foreach (var t in type.Tags)
        {
            var writable = t.Role is "setpoint" or "command";
            if (writable && string.IsNullOrEmpty(t.PolicyAction))
                v.Add($"componentTag '{type.TypeId}.{t.Name}': role='{t.Role}' nhưng thiếu policyAction — §5");
            if (t.Role == "setpoint" && t.Min is null)
                v.Add($"componentTag '{type.TypeId}.{t.Name}': setpoint thiếu min — dải chặn cứng là bắt buộc");
            if (t.Role == "setpoint" && t.Max is null)
                v.Add($"componentTag '{type.TypeId}.{t.Name}': setpoint thiếu max — dải chặn cứng là bắt buộc");
        }
        return v;
    }

    public static void ThrowIfInvalid(TagNamespaceDocument doc)
    {
        var v = Validate(doc);
        if (v.Count > 0) throw new ContractViolationException(v);
    }

    public static void ThrowIfInvalid(ComponentModelDocument doc)
    {
        var v = Validate(doc);
        if (v.Count > 0) throw new ContractViolationException(v);
    }
}
```

- [ ] **Step 4: Chạy để xác nhận XANH**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.Hmi.Contracts.Tests`
Kỳ vọng: PASS. Số bài lên từ 26 (Mốc 0) thêm 7.

- [ ] **Step 5: Xác nhận contract assembly vẫn zero-dependency**

Chạy: `grep -c PackageReference /d/SOURCES/avi-aoi-sim/tools/machine-simulator/src/St4i.Hmi.Contracts/St4i.Hmi.Contracts.csproj`
Kỳ vọng: `0`. Nếu khác 0, bạn đã kéo một dependency vào contract assembly — dừng và báo.

- [ ] **Step 6: Commit**

```bash
git add src/St4i.Hmi.Contracts/ContractInvariants.cs tests/St4i.Hmi.Contracts.Tests/ContractInvariantsTests.cs
git commit -m "contract(hmi): the C# mirror could build an unpoliced write; it cannot any more"
```

---

## Task 2: `ComponentModelStore`

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/IComponentModelStore.cs`
- Create: `src/St4i.EngineApi/HmiModel/ComponentModelStore.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/ComponentModelStoreTests.cs`

**Interfaces:**
- Consumes: `ContractInvariants.ThrowIfInvalid(ComponentModelDocument)` (Task 1); `HmiContractJson.Options` (Mốc 0).
- Produces — Task 4 và 5 dùng:
  - `IComponentModelStore.PutAsync(ComponentModelDocument doc, CancellationToken ct = default)` → `Task`
  - `IComponentModelStore.GetAsync(string machineCode, CancellationToken ct = default)` → `Task<ComponentModelDocument?>`
  - `IComponentModelStore.ListMachineCodesAsync(CancellationToken ct = default)` → `Task<IReadOnlyList<string>>`
  - `ComponentModelStore.EnvVarDir` = `"ST4I_HMI_MODEL_DIR"`, property `DbPath`

- [ ] **Step 1: Đọc khuôn trước khi viết**

Đọc `src/St4i.EngineApi/AssetRegistry/AssetRegistryStore.cs` **toàn bộ**. Kế hoạch này bảo bạn theo khuôn của nó và không lặp lại lý lẽ trong doc comment của nó. Chú ý bốn thứ: mảng `OpenPragmas`, thang `Migrations` theo `PRAGMA user_version`, `ResolveRoot` (tham số → biến môi trường → `DefaultRoot`), và việc mỗi thao tác mở một kết nối ngắn.

Một khác biệt có chủ ý bạn PHẢI giữ: `AssetRegistryStore.UpsertAsync` **không bao giờ ném** vì nó nằm trên đường đăng ký máy, nơi một hiccup của đĩa không được phép làm sập việc khởi động fleet. `ComponentModelStore.PutAsync` thì **ném bình thường** — nó chỉ được gọi từ một hành động người dùng chủ động (khai báo lại linh kiện), và nuốt lỗi ở đó nghĩa là kỹ sư tưởng đã lưu trong khi chưa. Nói rõ khác biệt này trong doc comment của lớp.

- [ ] **Step 2: Viết bài test thất bại**

`tests/St4i.EngineApi.Tests/HmiModel/ComponentModelStoreTests.cs`:

```csharp
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// <c>ComponentModelStore</c> trên SQLite thô, cùng khuôn <c>AssetRegistryStore</c>.
///
/// <para><b>KHÔNG đo cái gì:</b> (1) không kiểm tài liệu hợp lệ theo JSON Schema — store chỉ thi hành ba
/// luật §5 qua <see cref="ContractInvariants"/>, phần còn lại của schema do phía web đo; (2) không kiểm
/// toàn vẹn tham chiếu sang tag namespace — đó là <c>ModelIntegrityTests</c>; (3) không đo hành vi đồng
/// thời nhiều tiến trình — WAL được bật nhưng bài này chạy một tiến trình.</para>
/// </summary>
public class ComponentModelStoreTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "st4i-hmi-model-" + Guid.NewGuid().ToString("N"));

    void IDisposable.Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    ComponentModelStore NewStore() => new(_dir);

    static ComponentModelDocument Doc(string code) => new(
        1, code,
        new[] { new ComponentNode("spindle", "st4i.motor.spindle", "Trục vít", null, $"{code}/spindle") },
        new[] { new ComponentTypeDef(
            "st4i.motor.spindle", "Spindle",
            new[] { new ComponentTagDef("running", "in", "bool", null, null, null, null, null) },
            new[] { new ComponentStateDef("running", "running == true", "run") },
            "fp.motor.spindle") });

    [Fact]
    public async Task A_document_round_trips_through_the_database()
    {
        var store = NewStore();
        await store.PutAsync(Doc("SCRW-01"));

        var back = await store.GetAsync("SCRW-01");

        Assert.NotNull(back);
        Assert.Equal("SCRW-01", back!.MachineCode);
        Assert.Single(back.Components);
        Assert.Equal("spindle", back.Components[0].Id);
        Assert.Equal("fp.motor.spindle", back.Types[0].DefaultFaceplate);
    }

    [Fact]
    public async Task An_unknown_machine_reads_back_null_not_an_error()
    {
        // §5-bis: một máy chưa khai linh kiện là trạng thái HỢP LỆ, không phải lỗi.
        Assert.Null(await NewStore().GetAsync("NOPE-01"));
    }

    [Fact]
    public async Task Putting_the_same_machine_twice_replaces_rather_than_duplicates()
    {
        var store = NewStore();
        await store.PutAsync(Doc("SCRW-01"));
        await store.PutAsync(Doc("SCRW-01"));

        Assert.Single(await store.ListMachineCodesAsync());
    }

    [Fact]
    public async Task Data_survives_a_new_store_instance_over_the_same_directory()
    {
        await NewStore().PutAsync(Doc("SCRW-01"));
        Assert.NotNull(await NewStore().GetAsync("SCRW-01"));
    }

    [Fact]
    public async Task A_document_violating_the_safety_invariant_is_refused_and_nothing_is_written()
    {
        var store = NewStore();
        var bad = new ComponentModelDocument(
            1, "SCRW-01", Array.Empty<ComponentNode>(),
            new[] { new ComponentTypeDef(
                "st4i.motor.spindle", "Spindle",
                new[] { new ComponentTagDef("target", "setpoint", "float", null, "Nm", null, null, null) },
                Array.Empty<ComponentStateDef>(), "fp.motor.spindle") });

        await Assert.ThrowsAsync<ContractViolationException>(() => store.PutAsync(bad));

        // Cửa ghi từ chối, VÀ không để lại nửa bản ghi — đây mới là phần đáng ghim.
        Assert.Null(await store.GetAsync("SCRW-01"));
    }
}
```

- [ ] **Step 3: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter ComponentModelStoreTests`
Kỳ vọng: lỗi biên dịch — `ComponentModelStore` chưa tồn tại.

- [ ] **Step 4: Viết seam và store**

`src/St4i.EngineApi/HmiModel/IComponentModelStore.cs`:

```csharp
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>Seam đọc/ghi cây linh kiện của một máy. Khác <see cref="St4i.EngineApi.AssetRegistry.IAssetRegistry"/>
/// ở một điểm có chủ ý: <see cref="PutAsync"/> ĐƯỢC PHÉP ném. Nó chỉ chạy từ một hành động người dùng
/// chủ động, và nuốt lỗi ở đó nghĩa là kỹ sư tưởng đã lưu trong khi chưa.</summary>
public interface IComponentModelStore
{
    Task PutAsync(ComponentModelDocument doc, CancellationToken ct = default);
    Task<ComponentModelDocument?> GetAsync(string machineCode, CancellationToken ct = default);
    Task<IReadOnlyList<string>> ListMachineCodesAsync(CancellationToken ct = default);
}
```

`src/St4i.EngineApi/HmiModel/ComponentModelStore.cs` — viết theo đúng khuôn `AssetRegistryStore` bạn vừa đọc ở Step 1: hằng `EnvVarDir = "ST4I_HMI_MODEL_DIR"`, `DefaultRoot` theo cùng idiom, `ResolveRoot`, `OpenPragmas` y hệt, và thang migration:

```csharp
private static readonly (int Version, string[] Statements)[] Migrations =
{
    (1, new[]
    {
        """
        CREATE TABLE IF NOT EXISTS component_models (
          machine_code TEXT PRIMARY KEY,
          document     TEXT NOT NULL,
          updated_at   TEXT NOT NULL);
        """,
    }),
};
```

`PutAsync` phải, theo đúng thứ tự: gọi `ContractInvariants.ThrowIfInvalid(doc)` **trước khi mở kết nối** (từ chối sớm, không để lại kết nối treo), serialize bằng `HmiContractJson.Options`, rồi `INSERT INTO component_models(machine_code, document, updated_at) VALUES(...) ON CONFLICT(machine_code) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at`.

`GetAsync` deserialize bằng cùng `HmiContractJson.Options`; máy không có hàng trả `null`.

- [ ] **Step 5: Chạy để xác nhận XANH**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter ComponentModelStoreTests`
Kỳ vọng: PASS, 5 bài.

- [ ] **Step 6: Commit**

```bash
git add src/St4i.EngineApi/HmiModel tests/St4i.EngineApi.Tests/HmiModel
git commit -m "feat(hmi): persist the component tree, and refuse a setpoint with no hard band at the door"
```

---

## Task 3: `TagNamespaceStore`

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/ITagNamespaceStore.cs`
- Create: `src/St4i.EngineApi/HmiModel/TagNamespaceStore.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/TagNamespaceStoreTests.cs`

**Interfaces:**
- Consumes: `ContractInvariants.ThrowIfInvalid(TagNamespaceDocument)`; `HmiContractJson.Options`.
- Produces:
  - `ITagNamespaceStore.PutAsync(TagNamespaceDocument doc, CancellationToken ct = default)` → `Task`
  - `ITagNamespaceStore.GetAsync(string machineCode, CancellationToken ct = default)` → `Task<TagNamespaceDocument?>`
  - `ITagNamespaceStore.FindTagAsync(string path, CancellationToken ct = default)` → `Task<TagDescriptor?>`
  - `TagNamespaceStore.EnvVarDir` = `"ST4I_HMI_TAGS_DIR"`

- [ ] **Step 1: Viết bài test thất bại**

`tests/St4i.EngineApi.Tests/HmiModel/TagNamespaceStoreTests.cs`:

```csharp
using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Auth;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// <c>TagNamespaceStore</c>: tài liệu lưu nguyên dạng JSON, cộng một bảng chỉ mục phẳng chỉ cho
/// <c>path</c> — thứ duy nhất cần tra nhanh.
///
/// <para>🔴 <b>`[Collection]` ở trên KHÔNG phải trang trí.</b> Bảy lớp trong assembly này gọi
/// <c>SqliteConnection.ClearAllPools()</c> — một lời gọi ở phạm vi TIẾN TRÌNH. Một lớp test không nằm
/// trong collection ấy mà đang giữ một kết nối SQLite mở đúng lúc đó sẽ dính
/// <c>ObjectDisposedException: SQLitePCL.sqlite3</c>, và kho này ghi nhận triệu chứng đó đã xảy ra
/// thật. 50 lớp test hiện có mang thuộc tính này, gồm cả <c>AssetRegistryStoreTests</c>. Tài liệu của
/// chính quy ước ấy (<c>Auth/SecurityEnvVarTests.cs</c>) nói thẳng rằng <b>không có test nào ép được tư
/// cách thành viên</b> — nên thiếu nó là im lặng cho tới khi thành CI flake, chứ không đỏ ngay.</para>
///
/// <para><b>KHÔNG đo cái gì:</b> (1) không đo giá trị sống hay <c>quality</c> — store này giữ KHAI BÁO,
/// còn giá trị thuộc hợp đồng live mà WS-HMI-0c sẽ định nghĩa; (2) không đo <c>isBackedByDriver</c> có
/// đúng sự thật hay không — nó là một trường dữ liệu ở tầng này, và việc nó khớp driver thật là phép đo
/// của WS-HMI-0c; (3) không kiểm schema đầy đủ, chỉ ba luật §5.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public class TagNamespaceStoreTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "st4i-hmi-tags-" + Guid.NewGuid().ToString("N"));

    void IDisposable.Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    TagNamespaceStore NewStore() => new(_dir);

    static TagDescriptor Tag(string path, string access = "r", string? policy = null) =>
        new(path, "float", "Nm", 0, 20, null, access, policy, new TagSource("simulated"), false);

    [Fact]
    public async Task A_namespace_round_trips()
    {
        var store = NewStore();
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/spindle/torque") }));

        var back = await store.GetAsync("SCRW-01");

        Assert.NotNull(back);
        Assert.Single(back!.Tags);
        Assert.Equal("SCRW-01/spindle/torque", back.Tags[0].Path);
        Assert.Equal(20, back.Tags[0].EngMax);
    }

    [Fact]
    public async Task A_tag_is_findable_by_path_without_reading_the_whole_document()
    {
        var store = NewStore();
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[]
        {
            Tag("SCRW-01/spindle/torque"),
            Tag("SCRW-01/ambient/temp"),
        }));

        var t = await store.FindTagAsync("SCRW-01/ambient/temp");

        Assert.NotNull(t);
        Assert.Equal("SCRW-01/ambient/temp", t!.Path);
    }

    [Fact]
    public async Task An_unknown_path_reads_back_null()
    {
        Assert.Null(await NewStore().FindTagAsync("NOPE/x/y"));
    }

    [Fact]
    public async Task Re_putting_a_machine_removes_tags_that_are_no_longer_declared()
    {
        // 🔴 Bài quan trọng nhất của lớp này. Một connector nạp lại namespace sau khi kỹ sư xoá một tag
        // phải làm tag ấy BIẾN MẤT khỏi chỉ mục. Nếu chỉ mục chỉ được thêm vào, `FindTagAsync` sẽ tiếp
        // tục trả về một tag không còn tồn tại trong tài liệu — hai nguồn sự thật lệch nhau âm thầm,
        // đúng lớp khuyết tật mà cả Mốc 0 dựng lên để chặn.
        var store = NewStore();
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[]
        {
            Tag("SCRW-01/spindle/torque"),
            Tag("SCRW-01/ambient/temp"),
        }));
        await store.PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/spindle/torque") }));

        Assert.NotNull(await store.FindTagAsync("SCRW-01/spindle/torque"));
        Assert.Null(await store.FindTagAsync("SCRW-01/ambient/temp"));
    }

    [Fact]
    public async Task A_writable_tag_without_a_policy_action_is_refused_and_nothing_is_written()
    {
        var store = NewStore();
        var bad = new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/spindle/sp", "rw", null) });

        await Assert.ThrowsAsync<ContractViolationException>(() => store.PutAsync(bad));

        Assert.Null(await store.GetAsync("SCRW-01"));
        Assert.Null(await store.FindTagAsync("SCRW-01/spindle/sp"));
    }

    [Fact]
    public async Task Data_survives_a_new_store_instance()
    {
        await NewStore().PutAsync(new TagNamespaceDocument(1, "SCRW-01", new[] { Tag("SCRW-01/a/b") }));
        Assert.NotNull(await NewStore().FindTagAsync("SCRW-01/a/b"));
    }
}
```

- [ ] **Step 2: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter TagNamespaceStoreTests`
Kỳ vọng: lỗi biên dịch.

- [ ] **Step 3: Viết seam và store**

Cùng khuôn Task 2. Thang migration có **hai** bảng, và chỉ mục có khoá ngoại về tài liệu để việc xoá-rồi-ghi-lại là một giao dịch:

```csharp
private static readonly (int Version, string[] Statements)[] Migrations =
{
    (1, new[]
    {
        """
        CREATE TABLE IF NOT EXISTS tag_namespaces (
          machine_code TEXT PRIMARY KEY,
          document     TEXT NOT NULL,
          updated_at   TEXT NOT NULL);
        """,
        """
        CREATE TABLE IF NOT EXISTS tag_index (
          path         TEXT PRIMARY KEY,
          machine_code TEXT NOT NULL,
          FOREIGN KEY(machine_code) REFERENCES tag_namespaces(machine_code) ON DELETE CASCADE);
        """,
        "CREATE INDEX IF NOT EXISTS ix_tag_index_machine ON tag_index(machine_code);",
    }),
};
```

`PutAsync`, trong **một giao dịch duy nhất**, theo thứ tự: `ThrowIfInvalid` trước khi mở kết nối → upsert `tag_namespaces` → `DELETE FROM tag_index WHERE machine_code = @code` → chèn lại mọi `path` của tài liệu mới. Xoá-rồi-chèn là điều làm bài "tag không còn khai báo phải biến mất" xanh; nếu bạn chỉ `INSERT OR REPLACE` từng path, tag cũ ở lại và bài đó đỏ.

`FindTagAsync` join `tag_index` → `tag_namespaces`, deserialize tài liệu, trả tag có `Path` khớp. Chỉ mục cho biết **tài liệu nào chứa path**, tài liệu vẫn là nguồn sự thật — đó là lý do chỉ mục chỉ có hai cột và không sao chép bất kỳ trường nào khác của tag.

- [ ] **Step 4: Chạy để xác nhận XANH**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter TagNamespaceStoreTests`
Kỳ vọng: PASS, 6 bài.

- [ ] **Step 5: Commit**

```bash
git add src/St4i.EngineApi/HmiModel tests/St4i.EngineApi.Tests/HmiModel
git commit -m "feat(hmi): the tag namespace, where a retired tag actually leaves the index"
```

---

## Task 4: Toàn vẹn tham chiếu giữa hai tài liệu

Hai bài round-trip của Mốc 0 **tự khai** rằng chúng không kiểm `parentId` trỏ tới component có thật, không kiểm chu trình, và không kiểm `tagPrefix` khớp tag nào. Đây là chỗ những phép đo ấy có nhà.

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/ModelIntegrity.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/ModelIntegrityTests.cs`

**Interfaces:**
- Consumes: `ComponentModelDocument`, `TagNamespaceDocument`.
- Produces: `ModelIntegrity.Check(ComponentModelDocument model, TagNamespaceDocument? ns)` → `IReadOnlyList<string>`

- [ ] **Step 1: Viết bài test thất bại**

`tests/St4i.EngineApi.Tests/HmiModel/ModelIntegrityTests.cs`:

```csharp
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// Toàn vẹn tham chiếu — bốn phép đo mà các bài round-trip của Mốc 0 tự khai là KHÔNG làm.
///
/// <para><b>KHÔNG đo cái gì:</b> nó là một hàm THUẦN trên hai tài liệu, không đọc đĩa và không phải là
/// cửa ghi. Store cố ý KHÔNG gọi nó, vì một cây linh kiện hợp lệ có thể được khai trước khi connector
/// nạp namespace — bắt hai tài liệu luôn khớp ở cửa ghi sẽ khiến thứ tự khai báo trở thành ràng buộc,
/// và đó là ràng buộc sai. Ai gọi nó và khi nào là quyết định của WS-HMI-0b.</para>
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
}
```

- [ ] **Step 2: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter ModelIntegrityTests`
Kỳ vọng: lỗi biên dịch.

- [ ] **Step 3: Viết bộ kiểm**

`ModelIntegrity.Check` phải làm bốn việc, và việc thứ hai quyết định cách viết:

1. Mọi `ComponentNode.ParentId` khác null phải là `Id` của một node trong cùng tài liệu.
2. **Cây không có chu trình** — đi bằng vòng lặp có tập `visited`, KHÔNG đệ quy ngây thơ. Một chu trình phải trả về một dòng lỗi, không được làm treo tiến trình. Bài test ở Step 1 sẽ treo thay vì đỏ nếu bạn viết sai chỗ này, nên nếu bài đó không kết thúc trong vài giây, đó là câu trả lời.
3. Mọi `ComponentNode.TypeId` phải có một `ComponentTypeDef` cùng `TypeId` trong `doc.Types`.
4. Chỉ khi `ns` khác null: mọi `ComponentNode.TagPrefix` phải là tiền tố của ít nhất một `TagDescriptor.Path`. `ns == null` nghĩa là "chưa nạp", không phải "rỗng" — và im lặng ở đó là hành vi đúng, không phải lỗ hổng.

Trả về mọi vi phạm, không dừng ở cái đầu tiên.

- [ ] **Step 4: Chạy để xác nhận XANH**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter ModelIntegrityTests`
Kỳ vọng: PASS, 5 bài, và bài chu trình **kết thúc nhanh**.

- [ ] **Step 5: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/ModelIntegrity.cs tests/St4i.EngineApi.Tests/HmiModel/ModelIntegrityTests.cs
git commit -m "feat(hmi): the four checks the round-trip tests said out loud they were not making"
```

---

## Task 5: Wiring + cờ capabilities + đóng sổ

**Files:**
- Modify: `src/St4i.EngineApi/Program.cs`
- Modify: `src/St4i.EngineApi/Endpoints/CapabilitiesEndpoints.cs`
- Modify: `web/playwright.config.ts`
- Modify: `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiModelWiringTests.cs`

- [ ] **Step 1: Đăng ký hai store**

Đọc `Program.cs` để thấy `AssetRegistryStore` được dựng và đăng ký thế nào, rồi làm y hệt cho `ComponentModelStore` và `TagNamespaceStore` qua seam `IComponentModelStore`/`ITagNamespaceStore`. Không thêm endpoint nào — API là WS-HMI-0b.

- [ ] **Step 2: Cờ capabilities**

`GET /v1/capabilities` đã là chỗ khai năng lực. Thêm một cờ cho mô hình HMI, đứng sau cùng seam mà quyết định #4 của roadmap dựng để `WS-E License/Edition` bật Edition sau này không phải sửa kiến trúc. Mặc định BẬT.

- [ ] **Step 3: Cô lập Playwright khỏi hai kho dữ liệu MỚI**

🔴 **Bước này không được bỏ.** Kho này đã một lần để bộ e2e ghi vào `%ProgramData%` thật và tạo ra 10 tài khoản trong `security.db` sản xuất, phải xoá tay sau đó. Bạn vừa thêm **hai** kho mới có đường dẫn từ `%ProgramData%`. Thêm `ST4I_HMI_MODEL_DIR` và `ST4I_HMI_TAGS_DIR` vào khối biến môi trường cô lập của `web/playwright.config.ts`, cạnh `ST4I_HISTORIAN_DIR`.

- [ ] **Step 4: Bài test wiring**

`tests/St4i.EngineApi.Tests/HmiModel/HmiModelWiringTests.cs` — ghim ba điều: hai biến môi trường đúng tên hằng, `/v1/capabilities` khai cờ mới, và `playwright.config.ts` **có chứa cả hai tên biến**. Bài thứ ba đọc file config bằng regex; **chuẩn hoá `\r\n` → `\n` khi đọc**, vì `core.autocrlf=true` trên kho này và một bài quét-file bỏ quên chuyện đó đã làm cổng hợp đồng của Mốc 0 đỏ trên mọi bản checkout mới.

- [ ] **Step 5: Chạy toàn bộ, ghi số liệu thật**

```bash
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.Hmi.Contracts.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EdgeCore.Tests
node scripts/check-contracts.mjs
cd web && npm run build && npx oxlint
```

Đường dẫn **tuyệt đối**, từng project một. `EdgeCore` nằm trong danh sách vì `SuppressionCensusTests` ghim tập project — kế hoạch này **không** thêm project, nên số của nó phải **không đổi**; nếu đổi, dừng và tìm hiểu. Xác nhận `npm run build` bằng **exit code**, không bằng cách đọc log.

Playwright: chỉ chạy nếu bạn chạm thứ nó render. Kế hoạch này không chạm — **nói rõ là không chạy và vì sao**, đừng im lặng bỏ qua.

- [ ] **Step 6: Ghi vào ledger roadmap**

Thêm một hàng vào §0-bis.1 theo đúng giọng các hàng sẵn có: nêu cả cái đã giao lẫn cái **CHƯA** — cụ thể là chưa có endpoint, chưa có SSE, chưa có driver nào nạp tag thật, và `ModelIntegrity` tồn tại nhưng **chưa có ai gọi**.

- [ ] **Step 7: Commit**

```bash
git add src/St4i.EngineApi tests/St4i.EngineApi.Tests web/playwright.config.ts docs/
git commit -m "wire(hmi): two stores, one capability flag, and the e2e isolation the last data store taught us"
```

---

## Nghiệm thu WS-HMI-0a

- [ ] Một tài liệu linh kiện và một namespace ghi được, đọc lại nguyên vẹn, sống qua tiến trình mới.
- [ ] Một tag `rw` thiếu `policyAction` và một `setpoint` thiếu dải cứng đều **bị từ chối tại cửa ghi**, và không để lại nửa bản ghi.
- [ ] Một tag bị gỡ khai báo **biến mất** khỏi chỉ mục.
- [ ] `ModelIntegrity` bắt được cha không tồn tại, chu trình (không treo), kiểu không khai, và `tagPrefix` mồ côi.
- [ ] `St4i.Hmi.Contracts` vẫn **zero `PackageReference`**.
- [ ] `EdgeCore` giữ **nguyên số bài** — kế hoạch này không thêm project.
- [ ] Playwright cô lập khỏi cả hai kho dữ liệu mới.
- [ ] Ledger roadmap ghi cả cái chưa làm.

---

## Ghi chú cho người viết hai kế hoạch anh em

**WS-HMI-0b (API + SSE)** dựng trên `IComponentModelStore`/`ITagNamespaceStore` và là chỗ quyết định **ai gọi `ModelIntegrity` và khi nào** — kế hoạch này cố tình không quyết, vì bắt hai tài liệu khớp nhau tại cửa ghi sẽ biến thứ tự khai báo thành ràng buộc, và đó là ràng buộc sai.

**WS-HMI-0c (nạp tag)** là chỗ `isBackedByDriver` thôi là một trường dữ liệu và trở thành một mệnh đề đo được. Kho này có một khuyết tật lặp lại đủ nhiều để thành bài học — một thứ được khai đủ, kiểm miền, lưu đĩa, phục vụ qua API, **và không ai đọc** — nên 0c phải mang theo một phép đo cho chính cờ ấy, đỏ theo cả hai chiều, đúng khuôn `UnconsumedConfigKindsTests`.
