# WS-HMI-2 — Kho màn hình, hoàn tất runtime, và Editor trực quan
# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho một kỹ sư tại nhà máy dựng được một màn hình HMI hoàn chỉnh cho một cỗ máy chưa từng có màn hình nào, **không viết một dòng JSON hay một dòng mã**, và lưu nó ở nơi máy đọc được sau khi khởi động lại.

**Architecture:** Ba pha có cổng chặn. Pha 1 dựng kho màn hình + API (`/v1/screens`), đúng khuôn `IComponentModelStore`/`ITagNamespaceStore` của WS-HMI-0a/0b, cộng thêm **phiên bản** vì publish/rollback đòi hỏi thế. Pha 2 nối `components` vào đường sản phẩm để `{component}` phân giải thật, và đưa các widget còn lại ra khỏi tình trạng chưa-từng-render. Pha 3 dựng editor đọc/ghi qua API ấy.

**Tech Stack:** .NET 10 · ASP.NET minimal API · SQLite · xUnit · React 19 + Vite + TypeScript · TanStack Query · Playwright · `node --test`

**Spec:** [docs/HMI_BUILDER_DESIGN_2026-08-29.md](../HMI_BUILDER_DESIGN_2026-08-29.md) §3.3, §3.4, §5, §5-bis, §6, §7 (dòng HMI-2).

**Kế hoạch tiền nhiệm (BẮT BUỘC xong trước):** WS-HMI-0a, WS-HMI-0b, WS-HMI-0c, WS-HMI-1 — tất cả đã ở `main` tại `c7105988`.

---

## 🔴 Bốn đính chính với spec, đo từ mã — đọc trước khi làm gì

Spec §7 mô tả HMI-2 là "Canvas, property panel, tag picker, layer tree, undo/redo, preview, publish/version/rollback". Đo được:

| Mệnh đề | Sự thật đo được |
|---|---|
| Runtime đã sẵn sàng, chỉ cần editor | **Nửa đúng.** 15 widget đều có tệp cài đặt và bài test đơn vị, nhưng **một** kind từng render trong trình duyệt (`faceplate`). Mười bốn cái kia chưa bao giờ được vẽ trong sản phẩm |
| §3.3 indirect binding cần được xây | **SAI — đã xây rồi.** `web/src/hmi-runtime/bindings.ts` có `resolveBinding` + `componentTagPrefixOf`, có bài thực thi thật. Thứ thiếu là `Hmi.tsx` **không bao giờ truyền `components`**, nên `resolve` chạy mà không có mô hình để tra |
| Editor "publish/version/rollback" | **Không có chỗ để publish.** `HmiScreenDocument` được Mốc 0 đóng băng, và **không gì trong `src/` ngoài assembly hợp đồng dùng tới nó** — không kho, không route. Ba màn hình hiện tại là module tĩnh nhập lúc build |
| Kho màn hình giống hai kho kia | **Khác một điểm cốt tử.** Cây linh kiện và tag namespace là *người-ghi-sau-thắng, có ghi chép* (phán quyết WS-HMI-0b). Màn hình **không thể** thế: `rollback` là yêu cầu của spec, nên kho này phải giữ **phiên bản** |

**Hệ quả:** phần lớn công việc của WS-HMI-2 nằm ở tầng mà spec không mô tả — kho và API màn hình. Editor là pha thứ ba, không phải pha thứ nhất.

---

## Global Constraints

- **Chạy test .NET TỪNG PROJECT MỘT**, đường dẫn **tuyệt đối**. `dotnet test` cả solution không ổn định trên máy này.
- **KHÔNG sửa hợp đồng đóng băng**: `contracts/*.schema.json`, các record `St4i.Hmi.Contracts`, `web/src/contracts/*.ts`. Editor phải sinh ra tài liệu **hợp lệ theo schema hiện có**. Nếu bạn thấy cần nới schema, **dừng và báo** — đó là quyết định của chủ sở hữu, đổi là bốn chỗ trong một commit theo `contracts/README.md`.
- **Kho thô không bao giờ được đăng ký DI.** Luật của WS-HMI-0b, phát biểu như luật: kho thô có thể được khởi tạo đúng chỗ composition root cần, và **không bao giờ được `AddSingleton`**. Mọi thứ khác lấy interface, và interface phân giải ra decorator chuẩn hoá.
- **Vai trò:** đọc màn hình → `Policies.Operator`; ghi/publish màn hình → `Policies.Engineer`. **KHÔNG route nào trong workstream này cần `Admin`** — không route nào ghi xuống thiết bị. Nếu bạn thấy mình cần `Admin`, bạn đang viết nhầm workstream.
- **§5 an toàn — bất di bất dịch.** Editor cho phép kỹ sư đặt `policyAction` lên widget `setpoint-input`/`command-button`. Điều đó **không** biến editor thành đường ghi. Mọi lệnh ghi xuống máy vẫn đi qua `PolicyEngine` default-deny + vai trò + chốt HALT, ở endpoint máy, không ở đây. **HALT là chốt phần mềm giám sát, không phải thiết bị an toàn ISO 13849, và không bao giờ được nối vào đường ghi.**
- **🔴 S-6, món nợ mang từ WS-HMI-0c:** hiện **không có** người tiêu thụ `policyAction` nào; §5 là **luật hiện diện**, nên `"xyzzy"` được lưu trơ. **Nếu bất kỳ mã nào trong workstream này phân giải `policyAction` thành một quyết định cấp phép, nó PHẢI fail-closed với giá trị không nhận dạng được, và phải có bài test ghim.** Nếu không thêm người tiêu thụ nào, **nói rõ trong báo cáo** để món nợ vẫn hiện là đang mở.
- **§5-bis:** một khách hàng chưa từng mở editor vẫn phải có HMI vận hành được. Ba màn hình hiện tại không được hỏng. Đội hình mặc định vẫn **rỗng**. Không màn chặn, không dữ liệu bịa.
- **§6 ISA-101:** màu chỉ xuất hiện khi bất thường. Editor tự nó là công cụ kỹ thuật, không phải màn vận hành — nhưng **preview** phải trung thực với theme đích.
- **Offline tuyệt đối:** không CDN, font nhúng sẵn, không thêm gói npm nếu tránh được. Nếu một tính năng đòi gói mới, **dừng và báo** kèm lý do và kích thước.
- **Mỗi bài test nói rõ nó KHÔNG đo cái gì**, trong doc comment.
- **Không ký tự điều khiển nguyên bản trong mã nguồn.** Dùng escape. CRLF đã cắn dự án này bốn cách khác nhau; một byte NUL từng khiến git coi cả tệp là nhị phân và giấu một bài test bị viết lại trong diff 1418 dòng.
- **Rà soát an toàn BẮT BUỘC trước merge** (spec §7 bảng phân công): dùng `security-review` trước khi đưa quyết định gộp cho chủ sở hữu.
- Commit sau mỗi task, thông điệp tiếng Anh.

---

## Bài học kho này đã trả giá, và là lý do một số bài test dưới đây trông thừa

**Một dòng nối dây không ai canh làm cả tính năng vô hiệu trong im lặng.** WS-HMI-0c ghim mọi thứ — cờ nói thật, chống nhiễm, kiểm kê hai chiều — rồi phát hiện ở lượt review cuối rằng bọc **điểm gọi sản xuất duy nhất** trong `if (false)` để lại **1728 bài xanh**. Bản vá đầu ghim cái vỏ và để hở tham số bên trong: đổi `SnapshotBindings()` thành `.Take(0)` tắt tính năng cho **mọi máy trên mọi host**, vẫn xanh.

Bài học áp thẳng vào workstream này: **`Hmi.tsx` không truyền `components` là đúng cùng một hình dạng**, đã tồn tại sẵn trong `main`. Task 6 tồn tại để đóng nó, và bài test của nó phải quan sát **kết quả render**, không phải một cờ đặt lúc bước vào.

**Và một lời khai về phạm vi đúng ở một thời điểm sẽ được đọc như đúng mãi.** Hai lần trong đợt vừa rồi, câu "không tệp `web/` nào đổi" đúng với diff và sai với nhánh; lần đầu làm `main` đỏ. Task nào chạm `web/` thì chạy Playwright, không suy luận từ diff.

---

## File Structure

### Pha 1 — kho và API màn hình (.NET)

| File | Trách nhiệm |
|---|---|
| `src/St4i.EngineApi/HmiModel/IHmiScreenStore.cs` | Seam: đọc/ghi/liệt kê/phiên bản màn hình |
| `src/St4i.EngineApi/HmiModel/HmiScreenStore.cs` | SQLite, `ST4I_HMI_SCREENS_DIR`, bảng có phiên bản |
| `src/St4i.EngineApi/HmiModel/CanonicalScreenStore.cs` | Decorator chuẩn hoá `screenId`, đúng khuôn `CanonicalMachineCodeStores` |
| `src/St4i.EngineApi/Endpoints/HmiScreenEndpoints.cs` | `/v1/screens` — list, get, put, versions, rollback |
| `tests/St4i.EngineApi.Tests/HmiModel/HmiScreenStoreTests.cs` | |
| `tests/St4i.EngineApi.Tests/HmiModel/HmiScreenEndpointsTests.cs` | |

### Pha 2 — hoàn tất runtime (web)

| File | Trách nhiệm |
|---|---|
| `web/src/hmi-runtime/ScreenRenderer.tsx` | *Sửa*: nhận và truyền `components` |
| `web/src/hmi-runtime/widgetRegistry.ts` | *Sửa*: `WidgetProps` mang `components` |
| `web/src/routes/Hmi.tsx` | *Sửa*: truyền `components` từ API |
| `web/src/lib/hmiScreens.ts` | Client TanStack Query cho `/v1/screens` |
| `web/screens/component-demo.json` | Màn hình dùng **hai instance của một faceplate** + các widget kind còn lại |
| `web/tests/35-hmi-indirect-binding.spec.ts` | |
| `web/tests/36-hmi-all-widget-kinds.spec.ts` | |

### Pha 3 — editor (web)

| File | Trách nhiệm |
|---|---|
| `web/src/editor/EditorRoute.tsx` | Khung: toolbar, canvas, hai panel |
| `web/src/editor/editorState.ts` | Trạng thái tài liệu + undo/redo, thuần `.ts`, không JSX |
| `web/src/editor/EditorCanvas.tsx` | Vẽ tài liệu, chọn, kéo, đổi kích thước, snap lưới |
| `web/src/editor/PropertyPanel.tsx` | Sửa thuộc tính widget đang chọn |
| `web/src/editor/TagPicker.tsx` | Duyệt cây `/v1/tags`, chèn vào binding |
| `web/src/editor/LayerTree.tsx` | Danh sách widget, thứ tự z, thêm/xoá |
| `web/src/editor/BreakpointPreview.tsx` | Xem theo `panel`/`tablet`/`phone` |

### 🔴 Tên kiểu đóng băng — dùng đúng, đã đo từ `src/St4i.Hmi.Contracts/HmiScreenDocument.cs`

Bản nháp đầu của kế hoạch này viết `ScreenRect`. **Kiểu ấy không tồn tại.** Self-review bắt được, và nó ghi lại đây vì một cái tên sai trong kế hoạch sẽ thành một cái tên sai trong mã:

```csharp
HmiScreenDocument(int SchemaVersion, string ScreenId, string Title, string? TitleEn,
                  string Theme, ScreenLayout Layout, IReadOnlyList<ScreenWidget> Widgets)
ScreenLayout(int Cols, int Rows, string Breakpoint)
ScreenWidget(string Id, string Kind, WidgetRect Rect, string? Component = null,
             IReadOnlyDictionary<string,string>? Bindings = null,
             IReadOnlyDictionary<string,JsonElement>? Props = null, string? PolicyAction = null)
WidgetRect(int Col, int Row, int ColSpan, int RowSpan)
```

Lưới **cố định theo breakpoint, không toạ độ pixel tự do** — và doc comment của `ScreenWidget` nói rõ đó là quyết định có chủ ý: *"toạ độ tự do làm màn hình vỡ khi đổi kích thước, và ISA-101 nói về khả năng đọc được của người vận hành, không về tự do đồ hoạ của người thiết kế."* Task 9 phải tôn trọng câu ấy: kéo thả **snap vào ô**, không có chế độ toạ độ tự do.
| `web/runtime-tests/editorState.test.mjs` | |
| `web/tests/37-editor-*.spec.ts` | Bốn spec, một cho mỗi năng lực |

---

## Pha 1 — Kho và API màn hình

### Task 1: Kho màn hình có phiên bản

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/IHmiScreenStore.cs`
- Create: `src/St4i.EngineApi/HmiModel/HmiScreenStore.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiScreenStoreTests.cs`

**Interfaces:**
- Consumes: `HmiScreenDocument` (đóng băng, Mốc 0); `ContractInvariants.ThrowIfInvalid(HmiScreenDocument)` (WS-HMI-0a, đã siết tới độ sâu trường ở 0c).
- Produces:
  - `Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default)`
  - `Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default)` — trả **số phiên bản mới**
  - `Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default)`
  - `Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default)`
  - `Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default)`
  - `record ScreenVersionInfo(int Version, string SavedAtUtc, bool IsCurrent)`
  - `const string EnvVarDir = "ST4I_HMI_SCREENS_DIR"`

- [ ] **Step 1: Đọc hai kho tiền nhiệm trước khi khai hình dạng**

Đọc `src/St4i.EngineApi/HmiModel/TagNamespaceStore.cs` **toàn bộ**, và `CanonicalMachineCodeStores.cs`. Ba thứ phải rút ra: cách nó phân giải thư mục từ biến môi trường, việc `ThrowIfInvalid` là **câu lệnh đầu tiên** của `PutAsync` (trước mọi kết nối — nên một tài liệu sai §5 *vào* store một lần và **không ghi** gì), và luật decorator.

**Kho này khác ở đúng một điểm và đó là lý do nó tồn tại riêng:** hai kho kia ghi đè một hàng theo khoá. Kho màn hình **thêm một hàng mỗi lần ghi** và giữ một con trỏ "hiện hành", vì `rollback` là yêu cầu của spec §7.

- [ ] **Step 2: Viết bài test thất bại**

`tests/St4i.EngineApi.Tests/HmiModel/HmiScreenStoreTests.cs`.

🔴 **Đính chính, 2026-09-01 (review Task 1).** Bản đầu của kế hoạch này viết `using var root = TestRunTempRoot.Create();` ở sáu chỗ. **API ấy không tồn tại** — grep cả kho cho thấy thứ duy nhất dùng nó là chính tài liệu này. `TestRunTempRoot` là `internal static` với `[ModuleInitializer]`: nó **môi trường sẵn cho cả assembly**, không phải thứ để khởi tạo. Khuôn cô lập THẬT, sao đúng từ `TagNamespaceStoreTests` và `ComponentModelStoreTests`:

```csharp
[Collection(SecurityEnvVarTests.CollectionName)]
public class HmiScreenStoreTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "st4i-screen-tests", Guid.NewGuid().ToString("n"));
    void IDisposable.Dispose() { try { Directory.Delete(_dir, true); } catch { } }
    // ... mỗi bài dùng `new HmiScreenStore(_dir)`
}
```

`[Collection]` không phải trang trí: nhiều lớp trong assembly này gọi `SqliteConnection.ClearAllPools()`, và `SecurityEnvVarTests` nói thẳng rằng không bài nào ép được tư thế ấy nếu chạy song song.

```csharp
/// <summary>
/// Kho màn hình có phiên bản.
///
/// <para><b>KHÔNG đo cái gì:</b> (1) không đo tính hợp lệ theo JSON Schema — đó là
/// <c>check-contracts.mjs</c> và các bài Mốc 0; ở đây chỉ đo bất biến do
/// <c>ContractInvariants</c> thi hành; (2) không đo tranh chấp ghi đồng thời — kho này nối tiếp theo
/// kết nối SQLite và bài test chạy một luồng; (3) không đo phân quyền — đó là tầng auth và
/// <c>HmiScreenEndpointsTests</c>.</para>
/// </summary>
public class HmiScreenStoreTests
{
    [Fact]
    public async Task PutAsync_ReturnsIncrementingVersions_AndGetWithoutVersionServesTheLatest()
    {
        var store = new HmiScreenStore(_dir);

        var v1 = await store.PutAsync(Screen("line-overview", "Tổng quan"));
        var v2 = await store.PutAsync(Screen("line-overview", "Tổng quan sửa"));

        Assert.Equal(1, v1);
        Assert.Equal(2, v2);
        var current = await store.GetAsync("line-overview");
        Assert.Equal("Tổng quan sửa", current!.Title);
    }

    [Fact]
    public async Task GetAsync_WithAnExplicitVersion_ServesThatVersion_NotTheLatest()
    {
        var store = new HmiScreenStore(_dir);
        await store.PutAsync(Screen("line-overview", "một"));
        await store.PutAsync(Screen("line-overview", "hai"));

        var old = await store.GetAsync("line-overview", version: 1);
        Assert.Equal("một", old!.Title);
    }

    [Fact]
    public async Task RollbackAsync_MakesTheOldVersionCurrent_ByAppendingIt_NeverByDeletingHistory()
    {
        var store = new HmiScreenStore(_dir);
        await store.PutAsync(Screen("line-overview", "một"));
        await store.PutAsync(Screen("line-overview", "hai"));

        var v3 = await store.RollbackAsync("line-overview", toVersion: 1);

        Assert.Equal(3, v3);
        Assert.Equal("một", (await store.GetAsync("line-overview"))!.Title);
        // Lịch sử không bị xoá: cả ba phiên bản vẫn liệt kê được.
        var versions = await store.ListVersionsAsync("line-overview");
        Assert.Equal(new[] { 1, 2, 3 }, versions.Select(v => v.Version).ToArray());
    }

    [Fact]
    public async Task PutAsync_WithAScreenViolatingSection5_ThrowsAndWritesNothing()
    {
        var store = new HmiScreenStore(_dir);
        var bad = Screen("bad-screen", "x") with { Widgets = new[] { new ScreenWidget(null!, "readout", Rect()) } };

        await Assert.ThrowsAsync<ContractViolationException>(() => store.PutAsync(bad));

        Assert.Empty(await store.ListScreenIdsAsync());
    }

    [Fact]
    public async Task GetAsync_ForAScreenNobodyDeclared_ReturnsNull_NotAnError()
    {
        var store = new HmiScreenStore(_dir);
        Assert.Null(await store.GetAsync("never-declared"));
    }

    static HmiScreenDocument Screen(string id, string title) => new(
        1, id, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", Rect()) });

    static WidgetRect Rect() => new(0, 0, 2, 1);
}
```

- [ ] **Step 3: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test "D:/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests/St4i.EngineApi.Tests.csproj" --filter HmiScreenStoreTests`
Kỳ vọng: lỗi biên dịch — chưa có kiểu nào.

- [ ] **Step 4: Viết seam và kho**

`IHmiScreenStore.cs` khai đúng sáu thành viên ở khối **Interfaces** trên. `HmiScreenStore.cs` theo khuôn `TagNamespaceStore`:

- Bảng: `screens(screen_id TEXT NOT NULL, version INTEGER NOT NULL, document TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(screen_id, version))` và `screen_current(screen_id TEXT PRIMARY KEY, version INTEGER NOT NULL)`.
- `PutAsync`: **câu lệnh đầu tiên** là `ContractInvariants.ThrowIfInvalid(doc)` — trước khi mở kết nối. Rồi `version = max(version)+1`, `INSERT`, cập nhật `screen_current`, trả `version`.
- `RollbackAsync`: đọc tài liệu ở `toVersion`, gọi `PutAsync` với nó. **Nối thêm, không xoá.** Nếu `toVersion` không tồn tại → `ArgumentOutOfRangeException` với thông điệp nêu số phiên bản có thật.
- `GetAsync(id, null)` đọc qua `screen_current`; `GetAsync(id, n)` đọc thẳng hàng `n`.
- Dùng `HmiContractJson.Options` cho mọi (de)serialize. **Không** dựng `JsonSerializerOptions` mới.

- [ ] **Step 5: Chạy để xác nhận XANH** · **Step 6: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/IHmiScreenStore.cs src/St4i.EngineApi/HmiModel/HmiScreenStore.cs tests/St4i.EngineApi.Tests/HmiModel/HmiScreenStoreTests.cs
git commit -m "feat(hmi): a screen store that appends versions, because rollback is a requirement not a wish"
```

---

### Task 2: Decorator chuẩn hoá `screenId`

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/CanonicalScreenStore.cs`
- Modify: `src/St4i.EngineApi/Program.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiScreenStoreTests.cs` (mở rộng)

**Interfaces:**
- Consumes: `IHmiScreenStore` (Task 1); `MachineCodeIdentity.Canonicalize` (WS-HMI-0b) — **đọc nó trước, và nếu `screenId` cần luật khác thì nói ra trong báo cáo thay vì dùng lại thầm lặng.**
- Produces: `CanonicalizingHmiScreenStore : IHmiScreenStore` — đăng ký DI là **thứ duy nhất** `IHmiScreenStore` phân giải ra.

- [ ] **Step 1: Đọc phán quyết đã có**

Đọc `CanonicalMachineCodeStores.cs` **toàn bộ**, gồm cả đoạn "What this does NOT canonicalise". WS-HMI-0b mất năm vòng cho lớp câu hỏi này và kết thúc bằng một luật, không phải một phép đếm: **kho thô có thể được khởi tạo đúng chỗ composition root cần, và không bao giờ được đăng ký.**

`screenId` trong schema đóng băng có `pattern: "^[a-z0-9-]+$"` — **đã là chữ thường theo hợp đồng**. Nên câu hỏi thật không phải "hoa hay thường" mà là **khoảng trắng thừa và chuỗi rỗng**. Đo trước, rồi quyết, rồi ghi lý do vào doc comment.

- [ ] **Step 2: Viết bài test thất bại**

```csharp
[Fact]
public async Task TheScreenStoreResolvedFromDi_IsTheCanonicalizingDecorator_NeverTheRawStore()
{
    using var host = TestHost.Create();
    var store = host.Services.GetRequiredService<IHmiScreenStore>();
    Assert.IsType<CanonicalizingHmiScreenStore>(store);
}

[Theory]
[InlineData("  line-overview  ")]
[InlineData("line-overview")]
public async Task EveryMethodOfTheDecorator_TrimsTheScreenId_SoOneScreenIsOneRow(string spelling)
{
    var inner = new RecordingScreenStore();
    var store = new CanonicalizingHmiScreenStore(inner);
    await store.PutAsync(Screen(spelling, "x"));
    Assert.Equal(new[] { "Put:line-overview" }, inner.Calls);
}

[Fact]
public async Task EveryMethodOnTheSeam_HasAnIdentityDisposition_SoANewMethodCannotForwardUnhandled()
{
    var seam = typeof(IHmiScreenStore);
    var handled = CanonicalizingHmiScreenStore.HandledMethods;
    var declared = seam.GetMethods().Concat(seam.GetInterfaces().SelectMany(i => i.GetMethods()))
                       .Select(m => m.Name).Distinct().ToArray();
    var missing = declared.Except(handled).ToArray();
    Assert.True(missing.Length == 0,
        $"IHmiScreenStore's surface — its own members AND every member inherited from a base interface — " +
        $"carries method(s) with NO identity disposition: {string.Join(", ", missing)}. Decide: does this " +
        $"method see a screen id? If yes, canonicalise it and add a probe measuring what the inner store " +
        $"received. If no, add a `false` entry NAMING the other identity. Do NOT delete this test to make " +
        $"it pass: forwarding an unhandled method is the exact defect it exists to catch (WS-HMI-0b, three " +
        $"consecutive rounds).");
}
```

`RecordingScreenStore` là một `IHmiScreenStore` giả **ghi lại nó nhận được gì** và **không tự quyết gì** — WS-HMI-0b học được rằng một vật giả cài lại vị từ đang bị kiểm thì nó chứng nhận cho chính nó.

- [ ] **Step 3: ĐỎ** · **Step 4: Viết decorator, đăng ký trong `Program.cs`** · **Step 5: XANH**

`Program.cs`: đăng ký **chỉ** decorator, bọc kho thô như một biến cục bộ. Không `AddSingleton` kiểu cụ thể.

- [ ] **Step 6: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/CanonicalScreenStore.cs src/St4i.EngineApi/Program.cs tests/St4i.EngineApi.Tests/HmiModel/HmiScreenStoreTests.cs
git commit -m "feat(hmi): the screen seam hands out one identity, and a new method cannot forward unhandled"
```

---

### Task 3: `/v1/screens` — sáu route

**Files:**
- Create: `src/St4i.EngineApi/Endpoints/HmiScreenEndpoints.cs`
- Modify: `src/St4i.EngineApi/Program.cs`, `src/St4i.EngineApi/Endpoints/HmiModelDtos.cs`
- Modify: `tests/St4i.EngineApi.Tests/Auth/RbacPolicyTests.cs` — **bản kiểm kê route sẽ đỏ tới khi khai; đó là cơ chế làm việc, và phải nói ra trong báo cáo**
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiScreenEndpointsTests.cs`

**Interfaces:**
- Produces:
  - `GET /v1/screens` → `200` danh sách `screenId` · Operator
  - `GET /v1/screens/{screenId}` → `200 HmiScreenDocument` · **`404` nếu chưa khai** · Operator
  - `GET /v1/screens/{screenId}?version=N` → `200` phiên bản N · `404` nếu không có · Operator
  - `PUT /v1/screens/{screenId}` → `200 PutScreenResultDto` · `400` khi vi phạm §5 · `409` khi `screenId` trong thân khác route · Engineer
  - `GET /v1/screens/{screenId}/versions` → `200 IReadOnlyList<ScreenVersionInfo>` · Operator
  - `POST /v1/screens/{screenId}/rollback` → `200 PutScreenResultDto` · `404` nếu phiên bản đích không có · Engineer
  - `record PutScreenResultDto(string ScreenId, int Version, int WidgetCount)`

- [ ] **Step 1: Quyết một điều spec không quyết, và ghi lý do**

`GET /v1/components/{code}` và `GET /v1/tags?machine=` trả **rỗng-200** cho máy chưa khai, vì §5-bis nói "chưa khai là trạng thái sản phẩm hợp lệ". **Màn hình khác:** không có "màn hình rỗng hợp lệ" — một tài liệu không widget nào vẫn phải được ai đó tạo ra. Nên **`404` là đúng ở đây**, và §5-bis không bị vi phạm: một máy không có màn hình vẫn chạy, chỉ là chưa ai vẽ màn cho nó.

Ghi phán quyết ấy vào doc comment của endpoint, kèm câu phân biệt — vì hai đường liền kề trả hai câu trả lời khác nhau cho "chưa có", và một người đọc lướt sẽ tưởng là bất nhất.

- [ ] **Step 2: Viết bài test thất bại**

Mệnh đề phải ghim:

- `GET /v1/screens/never-declared` → **404**, không phải rỗng-200.
- `PUT` rồi `GET` trả lại đúng tài liệu, và `PutScreenResultDto.Version == 1`.
- `PUT` lần hai → `Version == 2`; `GET` không nêu phiên bản trả bản mới.
- `GET ...?version=1` trả bản cũ.
- `POST .../rollback` với `toVersion=1` → `Version == 3`, và `GET` trả nội dung bản 1.
- `POST .../rollback` với phiên bản không tồn tại → **404**, và phiên bản hiện hành **không đổi**.
- `PUT` với `screenId` trong thân khác route → **409** nêu **cả hai** giá trị, và tài liệu của nạn nhân **không đổi** (đo bằng `GET` sau đó). Đây là HIGH-1 của WS-HMI-0b, một hợp đồng sang bên cạnh.
- `PUT` một tài liệu vi phạm §5 → **400** mang **mọi** vi phạm, và `GET` sau đó vẫn **404**.
- Bốn route đọc gắn `Policies.Operator`; `PUT` và `rollback` gắn `Policies.Engineer`. **Không route nào `Admin`.**
- **P1: không thân nào do khách viết được phép sinh 500.** Liệt kê bề mặt số và chuỗi của `HmiScreenDocument` rồi tấn công từng trường — `rect` âm, `colSpan` bằng 0, `cols` vượt 48, `kind` lạ, `widgets: null`, `layout` vắng mặt, JSON hỏng, `null` trần.
- **P2: không thân bị từ chối nào được để lại bản ghi.** Kiểm sau **mỗi** lần từ chối.

- [ ] **Step 3: ĐỎ** · **Step 4: Viết endpoint** · **Step 5: XANH**

Theo khuôn `HmiTagEndpoints.cs`. Thứ tự trong `PUT`: kiểm route-vs-thân → `store.PutAsync` (nơi §5 được thi hành) → dựng phản hồi → **phát sự kiện là câu lệnh áp chót, `return` là câu cuối**. Luật của WS-HMI-0b: **không gì có thể ném được phép chạy sau lệnh phát.**

- [ ] **Step 6: Commit**

```bash
git add src/St4i.EngineApi/Endpoints/HmiScreenEndpoints.cs src/St4i.EngineApi/Endpoints/HmiModelDtos.cs src/St4i.EngineApi/Program.cs tests/St4i.EngineApi.Tests
git commit -m "feat(hmi): screens over HTTP, where rollback appends and a mismatched id refuses"
```

---

### Task 4: Sự kiện thay đổi màn hình trên kênh đã có

**Files:**
- Modify: `src/St4i.EngineApi/HmiModel/HmiModelEvents.cs`, `src/St4i.EngineApi/Endpoints/HmiScreenEndpoints.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiModelEventsTests.cs` (mở rộng)

**Interfaces:**
- Produces: `HmiModelEvents.ScreenChanged(string screenId, int version)` → khung `{ "at", "change": "screen", "screenId", "version" }`

- [ ] **Step 1: Đọc lane và phán quyết của nó**

Đọc `src/St4i.EngineApi/Hubs/HmiChangeStream.cs` **toàn bộ**. WS-HMI-0b cố ý làm `change` thành **tập MỞ** — ngược với `kind` đóng của kênh inspector, thứ đã buộc phải sửa hai bản sao web đã công bố trước khi thêm được một giá trị. Thêm `"screen"` là đúng thứ tập mở ấy tồn tại để cho phép: **không bản sao web nào phải đổi.** Xác nhận điều đó bằng cách chạy `St4i.Connector.Abstractions.Tests` sau khi thêm.

- [ ] **Step 2: Viết bài test thất bại**

- `PUT /v1/screens/{id}` thành công phát **đúng một** sự kiện mang `screenId` và `version`.
- `POST .../rollback` thành công phát đúng một sự kiện với **phiên bản mới** (không phải phiên bản đích).
- **Mọi mã không phải 2xx phát KHÔNG sự kiện nào.** Ghim **tính chất**, không phải danh sách — 400 (§5), 409 (lệch id), 404 (rollback tới phiên bản không có), 403 (Operator thử ghi), 400 (JSON hỏng). Danh sách là bằng chứng tính chất với tới được, không phải bản thân tính chất.
- Thêm `"screen"` **không đổi khung** của hai loại sự kiện cũ.

- [ ] **Step 3: ĐỎ** · **Step 4: Viết** · **Step 5: XANH** · **Step 6: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/HmiModelEvents.cs src/St4i.EngineApi/Endpoints/HmiScreenEndpoints.cs tests/St4i.EngineApi.Tests/HmiModel/HmiModelEventsTests.cs
git commit -m "feat(hmi): a screen change announces itself on the open lane, and a refusal announces nothing"
```

---

## 🔴 CỔNG CHẶN 1 — trước khi sang Pha 2

Chạy **cả sáu** bộ .NET, đường dẫn tuyệt đối, từng bộ một. `EdgeCore` phải **không đổi số bài**. Chạy `node scripts/check-contracts.mjs`. Chạy bộ quét `scripts/delete-and-redden.sh` sau khi thêm bốn tệp mới vào `SOURCES` và các lớp test mới vào `FILTER` — **bộ quét không tự biết về mã bạn vừa viết**, và ở hai workstream liên tiếp lỗ hổng vùng phủ của nó là thứ giấu đi khuyết tật nghiêm trọng nhất.

Pha 1 phải xanh và tự đứng được: một kỹ sư có thể `PUT` một màn hình bằng `curl`, đọc lại, xem lịch sử, và rollback. Nếu Pha 2 và 3 không bao giờ được làm, Pha 1 vẫn là phần mềm dùng được.

---

## Pha 2 — Hoàn tất runtime

### Task 5: `components` đi tới widget, và `{component}` phân giải trong sản phẩm

**Files:**
- Modify: `web/src/hmi-runtime/widgetRegistry.ts`, `web/src/hmi-runtime/ScreenRenderer.tsx`, `web/src/routes/Hmi.tsx`
- Create: `web/src/lib/hmiScreens.ts`
- Test: `web/runtime-tests/screenRendererComponents.test.mjs`, `web/tests/35-hmi-indirect-binding.spec.ts`

**Interfaces:**
- Consumes: `resolveBinding`, `componentTagPrefixOf` (`bindings.ts`, đã có từ WS-HMI-1); `GET /v1/components/{machineCode}` (WS-HMI-0b).
- Produces: `WidgetProps` mang thêm `components?: ComponentModelDocument`.

- [ ] **Step 1: Đo trạng thái trước khi sửa**

`bindings.ts` **đã cài đặt đầy đủ** `{component}` — đọc nó và các bài `web/runtime-tests/bindings.test.mjs` để thấy. Thứ thiếu duy nhất là `Hmi.tsx` không bao giờ truyền `components`, nên `resolve` chạy với một mô hình rỗng và mọi binding `{component}` **trả về nguyên văn chuỗi có dấu ngoặc**, rồi `TagValueSource` không nhận ra và widget hiện chỗ giữ "không có dữ liệu".

**Chạy phép đo ấy trước khi viết mã**, và ghi kết quả vào báo cáo: đó là bằng chứng khuyết tật có thật, không phải suy đoán từ diff.

- [ ] **Step 2: Viết bài test thất bại**

`web/tests/35-hmi-indirect-binding.spec.ts` — Playwright, vì bài học WS-HMI-0c là **quan sát kết quả, không quan sát một cờ đặt lúc bước vào**:

```ts
test("một faceplate authored once serves two component instances, and each shows its own tag", async ({ page }) => {
  // Màn hình `component-demo` (Task 6) đặt HAI widget cùng kind, cùng binding `{component}/torque`,
  // khác `component` — `spindle-a` và `spindle-b`. Nếu `components` không được truyền, cả hai hiện
  // cùng một chỗ giữ "không có dữ liệu" và bài này đỏ.
  await page.goto("/hmi/SCRW-01")
  const a = page.getByTestId("widget-torque-a")
  const b = page.getByTestId("widget-torque-b")
  await expect(a).not.toHaveText("—")
  await expect(b).not.toHaveText("—")
  await expect(a).not.toHaveText(await b.innerText())   // hai instance, hai giá trị
})
```

- [ ] **Step 3: Chạy để xác nhận ĐỎ**

Chạy: `cd web && npx playwright test 35-hmi-indirect-binding.spec.ts`
Kỳ vọng: đỏ — cả hai widget hiện `"—"`.

- [ ] **Step 4: Nối dây**

`WidgetProps` thêm `components?: ComponentModelDocument`. `ScreenRenderer` nhận prop `components` và truyền xuống; `resolve` dựng từ nó bằng `componentTagPrefixOf`. `Hmi.tsx` lấy `components` qua `useQuery` trên `GET /v1/components/{machineCode}` và truyền vào.

**`components` vắng mặt vẫn phải là trạng thái hợp lệ** (§5-bis): một máy chưa khai cây linh kiện vẫn render màn hình, các binding trực tiếp vẫn chạy, chỉ các binding `{component}` hiện chỗ giữ. Ghim điều đó.

- [ ] **Step 5: XANH** · **Step 6: Commit**

```bash
git add web/src/hmi-runtime web/src/routes/Hmi.tsx web/src/lib/hmiScreens.ts web/runtime-tests web/tests/35-hmi-indirect-binding.spec.ts
git commit -m "feat(hmi): indirect binding was built and unwired; now one faceplate serves N instances"
```

---

### Task 6: Mười bốn widget kind ra khỏi tình trạng chưa-từng-render

**Files:**
- Create: `web/screens/component-demo.json`
- Modify: `web/src/routes/Hmi.tsx` (thêm route demo, **không** đụng ba màn hiện có)
- Test: `web/tests/36-hmi-all-widget-kinds.spec.ts`

- [ ] **Step 1: Viết bài test thất bại — và đây là bài quan trọng nhất của Pha 2**

```ts
test("mọi widget kind trong registry đều render ít nhất một lần trong sản phẩm", async ({ page }) => {
  // Nguồn sự thật là REGISTRY, không phải một danh sách viết tay — một kind mới thêm vào registry mà
  // quên đặt lên màn demo sẽ làm bài này đỏ. Đây là chiều ngược mà WS-HMI-0c mất ba lượt review mới
  // đóng được ở phía .NET; ở đây nó rẻ vì registry là dữ liệu.
  const kinds = await page.evaluate(() => Object.keys((window as never as { __widgetKinds: string[] }).__widgetKinds))
  await page.goto("/hmi/demo/component-demo")
  for (const kind of kinds) {
    await expect(page.getByTestId(`kind-${kind}`), `kind "${kind}" không có mặt trên màn demo`).toBeVisible()
  }
})
```

`widgetRegistry.ts` phơi `Object.keys(widgetRegistry)` lên `window.__widgetKinds` **chỉ trong bản dev/test** — nếu điều đó không làm được sạch sẽ, đọc registry từ tệp nguồn trong bài test thay vì bịa một danh sách thứ hai. **Đừng viết tay một danh sách 15 kind**: hai danh sách sẽ lệch.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết `component-demo.json`** · **Step 4: XANH**

Màn demo dùng **hai instance của một faceplate** (cho Task 5) **và** mỗi kind còn lại ít nhất một lần. Nó là màn hình **kỹ thuật**, không phải màn vận hành — đặt sau route `/hmi/demo/...` và **không** thêm vào đội hình mặc định (§5-bis: đội hình mặc định vẫn rỗng).

- [ ] **Step 5: Chạy toàn bộ Playwright** — 231 bài hiện có **phải vẫn xanh**, baseline **không được đụng**. Nếu một baseline dịch, đó là phát hiện, không phải việc cần cập nhật.

- [ ] **Step 6: Commit**

```bash
git add web/screens/component-demo.json web/src/routes/Hmi.tsx web/tests/36-hmi-all-widget-kinds.spec.ts
git commit -m "feat(hmi): fourteen widget kinds stop being registered-but-never-drawn"
```

---

## 🔴 CỔNG CHẶN 2 — trước khi sang Pha 3

Playwright đầy đủ, **baseline bất động**. `test:runtime`, `tsc -b`, `oxlint`, `check-contracts.mjs` — tất cả exit 0. Ba màn hình hiện có **không đổi một điểm ảnh**.

Pha 2 phải tự đứng được: `{component}` phân giải trong sản phẩm, và mọi widget kind đã render thật một lần. Nếu Pha 3 không bao giờ được làm, runtime vẫn đầy đủ hơn hôm nay.

---

## Pha 3 — Editor

### Task 7: Trạng thái tài liệu + undo/redo, thuần logic

**Files:**
- Create: `web/src/editor/editorState.ts`
- Test: `web/runtime-tests/editorState.test.mjs`

**Interfaces:**
- Produces:
  - `createEditorState(doc: HmiScreenDocument): EditorState`
  - `applyEdit(state, edit: EditorEdit): EditorState` — thuần, không đột biến
  - `undo(state): EditorState` · `redo(state): EditorState`
  - `type EditorEdit = { kind: "move"; widgetId: string; rect: ScreenRect } | { kind: "set-prop"; widgetId: string; path: string; value: unknown } | { kind: "add"; widget: ScreenWidget } | { kind: "remove"; widgetId: string } | { kind: "reorder"; widgetId: string; toIndex: number }`

- [ ] **Step 1: Viết bài test thất bại**

Thuần `.ts`, **không JSX, không import React** — cùng lý do `bindings.ts` và `widgets/shared.ts` là thuần: `node --test` `import()` và **thực thi** được nó, nên bài test đo hành vi thật chứ không khớp mẫu văn bản.

Mệnh đề phải ghim:
- `applyEdit` **không đột biến** đầu vào (so sánh tham chiếu và nội dung tài liệu gốc sau khi gọi).
- `undo` sau ba lần sửa trả về đúng trạng thái sau hai lần.
- `redo` sau `undo` trả lại lần thứ ba; một `applyEdit` **mới** sau `undo` **xoá** nhánh redo.
- Ngăn xếp có **cận trên** (ví dụ 100 bước) và cận ấy được ghim bằng một bài **đỏ khi ai đó nới nó** — một hằng số đọc ở cả hai phía không ghim gì (khuyết tật pin-một-chiều của Mốc 0).
- `remove` một widget rồi `undo` khôi phục **đúng vị trí trong mảng**, không đẩy xuống cuối.
- Mọi `EditorEdit` giữ tài liệu **hợp lệ theo schema đóng băng** — chạy `validate.mjs` của Mốc 0 lên kết quả.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết** · **Step 4: XANH** · **Step 5: Commit**

```bash
git add web/src/editor/editorState.ts web/runtime-tests/editorState.test.mjs
git commit -m "feat(editor): document state and undo, as pure functions a node test can execute"
```

---

### Task 8: Khung editor + canvas đọc

**Files:**
- Create: `web/src/editor/EditorRoute.tsx`, `web/src/editor/EditorCanvas.tsx`
- Modify: router
- Test: `web/tests/37-editor-canvas.spec.ts`

- [ ] **Step 1: Viết bài test thất bại**

- Mở `/editor/{screenId}` tải tài liệu từ `GET /v1/screens/{screenId}` và vẽ đúng số widget.
- Một `screenId` chưa khai → màn "chưa có màn hình này", **không phải trang trắng và không phải lỗi**.
- Canvas dùng **cùng `ScreenRenderer`** với runtime, không phải bản vẽ thứ hai. Ghim bằng cách kiểm rằng sửa một widget trong tài liệu làm đổi thứ canvas hiện — nếu canvas là bản cài lại, nó sẽ không đổi.

**Đây là mệnh đề đắt nhất của Pha 3.** Một editor vẽ bằng mã riêng sẽ trôi khỏi runtime, và kỹ sư sẽ thiết kế một màn hình rồi thấy nó khác lúc chạy. Dùng lại `ScreenRenderer` với một `TagValueSource` giả lập ở chế độ thiết kế.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết** · **Step 4: XANH** · **Step 5: Commit**

```bash
git add web/src/editor web/tests/37-editor-canvas.spec.ts
git commit -m "feat(editor): the canvas is the runtime renderer, so what you design is what runs"
```

---

### Task 9: Chọn, kéo, đổi kích thước, snap lưới

**Files:**
- Modify: `web/src/editor/EditorCanvas.tsx`
- Test: `web/tests/37-editor-drag.spec.ts`

- [ ] **Step 1: Viết bài test thất bại**

- Nhấp một widget chọn nó; viền chọn hiện; nhấp nền bỏ chọn.
- Kéo một widget đổi `rect.col`/`rect.row` và **snap vào lưới** — thả giữa hai ô cho ra toạ độ nguyên.
- Kéo ra ngoài biên **bị kẹp**, không cho ra `col` âm hay vượt `layout.cols`.
- Đổi kích thước qua tay cầm đổi `colSpan`/`rowSpan`, tối thiểu 1.
- Sau mỗi thao tác, tài liệu vẫn **hợp lệ theo schema** — chạy `validate.mjs`.
- `Ctrl+Z` hoàn tác một lần kéo về đúng `rect` cũ.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết** · **Step 4: XANH** · **Step 5: Commit**

```bash
git add web/src/editor/EditorCanvas.tsx web/tests/37-editor-drag.spec.ts
git commit -m "feat(editor): drag and resize on the grid, clamped so a document cannot go invalid"
```

---

### Task 10: Property panel + tag picker

**Files:**
- Create: `web/src/editor/PropertyPanel.tsx`, `web/src/editor/TagPicker.tsx`
- Test: `web/tests/37-editor-properties.spec.ts`

**Interfaces:**
- Consumes: `GET /v1/tags?machine={code}` (WS-HMI-0b), `GET /v1/components/{code}` (WS-HMI-0b).

- [ ] **Step 1: Viết bài test thất bại**

- Chọn một widget hiện `kind`, `id`, `rect`, `bindings`, `props` sửa được.
- Đổi một binding cập nhật tài liệu và canvas **cùng lúc**.
- Tag picker liệt kê tag từ `/v1/tags?machine=`, **hiện `isBackedByDriver`**, và chèn đường dẫn vào ô binding đang chọn.
- Tag picker cho phép chèn `{component}/...` khi widget có `component` — đây là chỗ §3.3 trở nên **dùng được bằng chuột**.
- **🔴 Cổng §5:** đặt `kind` thành `setpoint-input` hoặc `command-button` **bắt buộc** phải chọn `policyAction`, và giá trị chỉ lấy từ enum đóng băng (`machine.setpoint`, `machine.command`). Không có ô nhập tự do. Ghim rằng một widget ghi **không có** `policyAction` **không lưu được**.
- **🔴 S-6:** nếu panel hiển thị bất cứ điều gì hàm ý "hành động này được phép", nó **phải fail-closed** với giá trị không nhận dạng được. Nếu panel chỉ *chọn* mà không *phân giải*, **nói rõ trong báo cáo rằng S-6 vẫn mở.**

- [ ] **Step 2: ĐỎ** · **Step 3: Viết** · **Step 4: XANH** · **Step 5: Commit**

```bash
git add web/src/editor/PropertyPanel.tsx web/src/editor/TagPicker.tsx web/tests/37-editor-properties.spec.ts
git commit -m "feat(editor): a tag picker that browses the namespace, and a write widget that cannot skip its policy"
```

---

### Task 11: Layer tree, thêm/xoá widget, thứ tự z

**Files:**
- Create: `web/src/editor/LayerTree.tsx`
- Test: `web/tests/37-editor-layers.spec.ts`

- [ ] **Step 1: Viết bài test thất bại**

- Layer tree liệt kê mọi widget theo thứ tự tài liệu; chọn ở tree đồng bộ với chọn ở canvas, **hai chiều**.
- Nút thêm widget hiện **danh sách kind lấy từ registry**, không phải danh sách viết tay.
- Xoá widget bỏ nó khỏi tài liệu và canvas; `Ctrl+Z` khôi phục **đúng vị trí cũ**.
- Đổi thứ tự trong tree đổi thứ tự vẽ — ghim bằng hai widget chồng nhau và kiểm cái nào ở trên.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết** · **Step 4: XANH** · **Step 5: Commit**

```bash
git add web/src/editor/LayerTree.tsx web/tests/37-editor-layers.spec.ts
git commit -m "feat(editor): a layer tree whose add menu is the registry, not a second list"
```

---

### Task 12: Preview theo breakpoint + publish/version/rollback

**Files:**
- Create: `web/src/editor/BreakpointPreview.tsx`
- Modify: `web/src/editor/EditorRoute.tsx`, `web/src/lib/hmiScreens.ts`
- Test: `web/tests/37-editor-publish.spec.ts`

- [ ] **Step 1: Viết bài test thất bại**

- Đổi breakpoint đổi `layout.breakpoint` và vẽ lại ở bề rộng tương ứng; ba giá trị `panel`/`tablet`/`phone` đều đi được.
- Nút Publish gọi `PUT /v1/screens/{id}` và hiện **số phiên bản mới** trả về.
- Publish một tài liệu vi phạm §5 hiện **mọi** vi phạm từ `400`, và **không** đổi phiên bản hiện hành trên máy chủ.
- Danh sách phiên bản đọc từ `GET .../versions`; chọn một phiên bản cũ **xem trước** nó mà **không** publish.
- Rollback gọi `POST .../rollback` và hiện phiên bản mới; **lịch sử không mất mục nào**.
- Sửa chưa lưu rồi rời trang **cảnh báo**; đây là dữ liệu người dùng, và bài học của phiên này là một bộ test từng **xoá công việc chưa commit** trong im lặng.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết** · **Step 4: XANH** · **Step 5: Commit**

```bash
git add web/src/editor web/src/lib/hmiScreens.ts web/tests/37-editor-publish.spec.ts
git commit -m "feat(editor): publish returns a version, rollback appends one, and unsaved work warns"
```

---

### Task 13: Nghiệm thu — kỹ sư dựng màn cho một máy chưa từng có

**Files:**
- Test: `web/tests/38-editor-acceptance.spec.ts`
- Modify: `docs/HMI_BUILDER_DESIGN_2026-08-29.md`, `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md`, `README.md`

- [ ] **Step 1: Viết bài nghiệm thu — một lượt, không viết mã**

Đây là tiêu chí nghiệm thu của spec §7, viết thành bài test:

```ts
test("một kỹ sư dựng màn hình cho một máy chưa từng có màn nào, không viết một dòng mã", async ({ page }) => {
  // Máy này có cây linh kiện và tag namespace (0b/0c đã nạp), và KHÔNG có màn hình nào.
  await page.goto("/editor/new?machine=NEWM-01")
  // thêm widget từ menu registry, gán binding bằng tag picker, kéo vào chỗ, publish
  // ...
  // Rồi mở màn RUNTIME và thấy đúng thứ vừa dựng, với dữ liệu thật.
  await page.goto("/hmi/NEWM-01")
  await expect(page.getByTestId("widget-torque")).not.toHaveText("—")
})
```

**Mối nối là mệnh đề, không phải hai nửa.** WS-HMI-0c học được rằng "cả hai nửa đều đã ghim" không đồng nghĩa với "thứ đó chạy" — ở đó, một lambda trao cho service một store khác trên thư mục khác để lại 1728 bài xanh. Bài này phải đi **một lượt liền**: editor → publish → runtime → dữ liệu thật.

- [ ] **Step 2: ĐỎ** · **Step 3: Đóng khoảng còn thiếu** · **Step 4: XANH**

- [ ] **Step 5: Chạy TẤT CẢ**

```bash
# sáu bộ .NET, từng bộ một, đường dẫn tuyệt đối
# node scripts/check-contracts.mjs
# cd web && npm run build && npx tsc -b && npx oxlint && npm run test:runtime && npx playwright test
```

`EdgeCore` **không đổi số bài**. Baseline Playwright **bất động**.

- [ ] **Step 6: Sửa spec và ghi ledger**

Spec §3.3 nói indirect binding cần được xây — **nó đã được xây từ WS-HMI-1 và chỉ thiếu dây nối**. Ghi chú đè tại chỗ theo quy ước kho: trích **nguyên văn** câu cũ, nêu phép đo bác nó, rồi nêu câu đúng. **Không xoá.**

Hàng ledger §0-bis.1 phải nêu cả cái **CHƯA** có: chưa có generator sinh màn từ cây linh kiện (HMI-3), chưa có linter ISA-101 (HMI-4), chưa có xuất/nhập screen pack (HMI-5), và **trạng thái S-6** — mở hay đã đóng, đo được, không phỏng đoán.

- [ ] **Step 7: Commit**

```bash
git add web/tests/38-editor-acceptance.spec.ts docs/ README.md
git commit -m "docs(hmi): an engineer built a screen without writing code, and the spec said binding was missing"
```

---

## Nghiệm thu WS-HMI-2

- [ ] Kỹ sư dựng màn cho một máy chưa từng có màn nào, **không viết một dòng mã**, và màn ấy chạy thật với dữ liệu thật — **một bài test đi liền một lượt**.
- [ ] `{component}` phân giải **trong sản phẩm**; một faceplate phục vụ N instance.
- [ ] **Mọi** widget kind trong registry đã render ít nhất một lần, và nguồn sự thật của bài kiểm là **registry**, không phải danh sách viết tay.
- [ ] Publish trả phiên bản; rollback **nối thêm**, không xoá lịch sử.
- [ ] Widget ghi **không lưu được nếu thiếu `policyAction`**; `PolicyEngine` + vai trò + HALT không bị đụng tới; **không route nào cần `Admin`**.
- [ ] §5-bis: ba màn hiện có không đổi một điểm ảnh; đội hình mặc định vẫn rỗng; khách chưa mở editor vẫn có HMI chạy được.
- [ ] Không thân nào do khách viết sinh 500; không thân bị từ chối nào để lại bản ghi.
- [ ] `scripts/delete-and-redden.sh` phủ **mọi tệp workstream này thêm**, và bảng của nó nằm trong báo cáo.
- [ ] Trạng thái **S-6** được nêu rõ: đã đóng (kèm bài test fail-closed) hoặc còn mở (kèm lý do).
- [ ] `security-review` đã chạy **trước** khi đưa quyết định gộp cho chủ sở hữu — bắt buộc theo spec §7.
- [ ] `EdgeCore` giữ nguyên số bài; sáu bộ .NET xanh; Playwright xanh với baseline bất động.

---

## Ghi chú cho WS-HMI-3 (generator)

Kế hoạch này dựng **editor**, không dựng **generator**. Spec §3.3 gọi nguyên tắc trung tâm là *"sinh trước, tinh chỉnh sau"* — và WS-HMI-2 chỉ làm nửa sau. Điều đó có chủ ý: một generator sinh ra thứ không sửa được là một generator không ai tin, còn một editor không có generator vẫn dùng được, chỉ chậm hơn.

Nhưng nó để lại một khoảng **S1 chưa đóng**: *"khách một máy chưa mở editor lần nào vẫn có HMI vận hành được."* Hôm nay điều đó đúng vì ba màn hình tĩnh vẫn còn. Khi HMI-3 thay chúng bằng đường sinh, S1 phải được chứng minh lại **bằng phép đo, không bằng báo cáo cũ** — đúng như spec §7 yêu cầu mỗi workstream đóng lại bằng một checklist §5-bis.
