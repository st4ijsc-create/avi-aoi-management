# WS-HMI-0b — API mô hình HMI + luồng thay đổi
# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở cây linh kiện và tag namespace ra ngoài qua HTTP, và cho khách đăng ký nhận thay đổi — để nhánh web dựng editor và runtime mà không cần biết SQLite tồn tại.

**Architecture:** Endpoint tối thiểu (`app.MapGet/MapPut` + `RequireAuthorization`) trên hai seam `IComponentModelStore`/`ITagNamespaceStore` của WS-HMI-0a, đúng khuôn `AssetEndpoints` đã có. Luồng thay đổi ~~**mở rộng WebSocket `/v1/inspector/stream` đang chạy**~~, không dựng kênh SSE thứ hai.

> 📎 🔴 **ĐÍNH CHÍNH (Task 3, 2026-08-30) — nửa gạch bỏ ở trên dựa trên một tiền đề ĐO ĐƯỢC LÀ SAI.** Giữ nguyên văn thay vì xoá, theo lối chú-thích-không-xoá của kho này.
>
> - **Câu cũ nói:** luồng thay đổi *mở rộng* `WS /v1/inspector/stream` đang chạy.
> - **Sự thật đo được:** `/v1/inspector/stream` **không phải** kênh sự kiện API chung. `EventBus.Publish` có **đúng một** nơi gọi trong `src/` — `EdgePipeline.cs:135`, đường **đẩy số liệu RA NGOÀI** — nên mỗi khung của nó nghĩa là "đã gửi một reading của máy X, nhận status S sau L ms". Một thay đổi mô hình HMI không phải là "thêm một cái như thế". Khung ấy là `ApiTraceEvent`, một record ĐÓNG: không có `ReadingKind` nào đúng sự thật cho nó, và `tagCount` **không có chỗ để đặt**. Mang được sự kiện của Task 3 lên kênh đó buộc phải THÊM TRƯỜNG vào `ApiTraceEvent`, tức đổi khung trên cả ba mặt mà phán quyết ở `InspectorStream.cs:217-219` đã đóng băng (khung WS và hai file Export).
> - **Quyết định thay thế (chủ sở hữu phán, Task 3):** một **ROUTE WebSocket thứ hai**, `WS /v1/hmi/changes`, với shape riêng (`HmiModelChangedEvent`). **Mục tiêu của câu cũ vẫn được giữ:** đây là *một route nữa*, **không phải một cơ chế nữa** — vẫn WebSocket, vẫn cùng thư viện client, nên nhánh web vẫn chỉ nói MỘT thứ tiếng realtime. Vì thế điểm 1 ở §"Hai đính chính" bên dưới (bác bỏ SSE) **vẫn còn hiệu lực**, chỉ có mệnh đề "mở rộng kênh đã có" là bị thay.
> - **Phán quyết byte-identical KHÔNG được gỡ.** Đi vòng qua nó chính là việc mà một phán quyết như thế tồn tại để bắt người ta làm. Kho này đã trả lời đúng câu hỏi ấy một lần rồi: `InspectorBodiesResponse` chọn route mới thay vì nới khung.
> - **Nếu sau này ai đó muốn nới `ApiTraceEvent`:** `ApiJson.Options` không đặt `DefaultIgnoreCondition`, nên một trường nullable mới sẽ được ghi thành `"x":null` trên **mọi** sự kiện cũ — khung đổi kể cả với sự kiện không bao giờ dùng trường đó. Đó phải là một phần của quyết định gỡ phán quyết, không phải một phát hiện sau đó.

**Tech Stack:** .NET 10 · ASP.NET minimal API · WebSocket qua `EventBus` đã có · xUnit.

**Spec:** [docs/HMI_BUILDER_DESIGN_2026-08-29.md](../HMI_BUILDER_DESIGN_2026-08-29.md) §3.1, §3.2, §5.
**Kế hoạch tiền nhiệm (BẮT BUỘC xong trước):** [2026-08-30-hmi-ws0a-model-store-blueprint.md](2026-08-30-hmi-ws0a-model-store-blueprint.md).

---

## Hai đính chính so với spec, đã đo từ mã

**1. Spec §3.2 viết "SSE subscribe". Cây này không dùng SSE cho việc đó.** `src/St4i.EngineApi/Hubs/InspectorStream.cs:86` đăng ký `app.Map("/v1/inspector/stream", ...)` và doc comment của chính nó gọi đây là `WS /v1/inspector/stream` — một **WebSocket** backfill từ `EventBus.Recent` khi client kết nối. Dựng thêm một kênh SSE riêng cho HMI nghĩa là hai cơ chế realtime song song trong một sản phẩm offline chạy trên một máy, và nhánh web sẽ phải nói cả hai thứ tiếng. Kế hoạch này ~~**mở rộng kênh đã có**~~. Nếu chủ sở hữu muốn đúng nguyên văn "SSE", đó là một quyết định riêng — nói trước khi bắt đầu, đừng đổi giữa chừng.

> 📎 🔴 **ĐÍNH CHÍNH (Task 3, 2026-08-30).** **Kết luận của mục 1 này — KHÔNG dựng SSE — vẫn đúng và vẫn được thi hành.** Cái sai chỉ là ba chữ "mở rộng kênh đã có": xem đính chính ở phần **Architecture** đầu file cho phép đo (`EventBus.Publish` chỉ có một nơi gọi, `EdgePipeline.cs:135`) và cho quyết định thay thế (`WS /v1/hmi/changes`, một route nữa chứ không phải một cơ chế nữa). Lý do bác bỏ SSE mà mục này nêu — "hai cơ chế realtime song song… nhánh web sẽ phải nói cả hai thứ tiếng" — chính là lý do quyết định thay thế vẫn là WebSocket.

**2. WS-HMI-0a cố ý KHÔNG gọi `ModelIntegrity`, và đây là chỗ quyết định ai gọi.** Lý do 0a hoãn: bắt cây linh kiện và tag namespace khớp nhau tại cửa ghi sẽ biến *thứ tự khai báo* thành ràng buộc — kỹ sư phải khai tag trước linh kiện, hoặc ngược lại, tuỳ chiều ta chọn. Đó là ràng buộc sai; cả hai thứ tự đều hợp lệ trong đời thật.

**Quyết định của kế hoạch này:** `PUT` **không từ chối** vì mất toàn vẹn — nó trả `200` kèm một mảng `warnings`. Vi phạm bất biến an toàn §5 vẫn là `400` cứng (đó là `ContractViolationException` từ 0a, và nó không phải chuyện toàn vẹn mà là chuyện an toàn). Cộng thêm một endpoint `GET .../integrity` để kiểm lại theo yêu cầu. Người vận hành thấy vấn đề ngay khi tạo ra nó, mà không bị chặn giữa một luồng khai báo hợp lệ.

---

## Global Constraints

- **Chạy test .NET TỪNG PROJECT MỘT**, đường dẫn **tuyệt đối**. `dotnet test` cả solution không ổn định trên máy này.
- **Không sửa hợp đồng.** `contracts/*`, các record `St4i.Hmi.Contracts`, `web/src/contracts/*.ts` đã đóng băng ở Mốc 0. Đổi là bốn chỗ trong một commit theo [contracts/README.md](../../contracts/README.md).
- **Không sửa hai store của 0a.** Nếu một endpoint cần thứ store không cho, dừng và báo — có thể 0a thiếu, và nói ra rẻ hơn là lách.
- **Vai trò:** đọc → `Policies.Operator`; ghi cây/namespace → `Policies.Engineer`. Không endpoint nào ở đây cần `Admin`, vì **không endpoint nào ở đây ghi vào thiết bị**. Nếu bạn thấy mình cần `Admin`, bạn đang viết nhầm workstream.
- **Luật không-null-tường-minh** áp cho mọi JSON trả ra: dùng `HmiContractJson.Options`, đừng tự dựng options mới.
- **Mỗi bài test nói rõ nó KHÔNG đo cái gì**, trong XML doc comment.
- **§5-bis:** một máy chưa khai gì trả **rỗng**, không phải 404, không phải lỗi. Rỗng là trạng thái sản phẩm hợp lệ.
- Commit sau mỗi task, thông điệp tiếng Anh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/St4i.EngineApi/Endpoints/HmiModelEndpoints.cs` | `/v1/components`, `/v1/component-types` |
| `src/St4i.EngineApi/Endpoints/HmiTagEndpoints.cs` | `/v1/tags` |
| `src/St4i.EngineApi/Endpoints/HmiModelDtos.cs` | DTO request/response chỉ dùng ở hai file trên |
| `src/St4i.EngineApi/HmiModel/HmiModelEvents.cs` | Phát sự kiện thay đổi lên `EventBus` |
| `tests/St4i.EngineApi.Tests/HmiModel/HmiModelEndpointsTests.cs` | |
| `tests/St4i.EngineApi.Tests/HmiModel/HmiTagEndpointsTests.cs` | |
| `tests/St4i.EngineApi.Tests/HmiModel/HmiModelEventsTests.cs` | |

Hai file endpoint tách theo tài liệu chúng phục vụ, không gộp một `HmiEndpoints.cs` — cùng lý do hai store tách hai file: chúng đổi vì những lý do khác nhau.

---

## Task 1: Đọc khuôn, rồi endpoint cây linh kiện

**Files:**
- Create: `src/St4i.EngineApi/Endpoints/HmiModelDtos.cs`
- Create: `src/St4i.EngineApi/Endpoints/HmiModelEndpoints.cs`
- Modify: `src/St4i.EngineApi/Program.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiModelEndpointsTests.cs`

**Interfaces:**
- Consumes: `IComponentModelStore.{PutAsync,GetAsync,ListMachineCodesAsync}`, `ModelIntegrity.Check`, `ContractViolationException` (0a).
- Produces:
  - `GET /v1/components` → `200` danh sách machine code đã khai
  - `GET /v1/components/{machineCode}` → `200 ComponentModelDocument` · `200` tài liệu rỗng nếu chưa khai
  - `PUT /v1/components/{machineCode}` → `200 PutModelResultDto` · `400 ApiErrorDto` khi vi phạm §5
  - `GET /v1/components/{machineCode}/integrity` → `200 IntegrityReportDto`
  - `GET /v1/component-types` → `200` mọi `ComponentTypeDef` đã khai, gộp theo `typeId`
  - `record PutModelResultDto(string MachineCode, int ComponentCount, IReadOnlyList<string> Warnings)`
  - `record IntegrityReportDto(string MachineCode, bool NamespaceLoaded, IReadOnlyList<string> Violations)`

- [ ] **Step 1: Đọc khuôn trước khi viết một dòng**

Đọc `src/St4i.EngineApi/Endpoints/AssetEndpoints.cs` **toàn bộ**. Nó ngắn và nó là khuôn: `app.MapGet("/v1/assets", ListAsync).RequireAuthorization(Policies.Operator)`, handler `static` trả `IResult`, lỗi trả `Results.NotFound(new ApiErrorDto(...))` / `Results.BadRequest(new ApiErrorDto(...))`. Dùng đúng `ApiErrorDto` đó, đừng khai một kiểu lỗi thứ hai.

Chú ý cách nó lấy store — đó là cách bạn sẽ lấy `IComponentModelStore`.

- [ ] **Step 2: Viết bài test thất bại**

`tests/St4i.EngineApi.Tests/HmiModel/HmiModelEndpointsTests.cs`. Dùng đúng khuôn dựng host/test-client mà các bài `*EndpointsTests` sẵn có trong `tests/St4i.EngineApi.Tests/` dùng — **đọc một bài trong số đó trước** (ví dụ `AssetEndpointsTests`) và theo nó; đừng phát minh cách dựng host thứ hai.

Các mệnh đề phải ghim:

```csharp
/// <summary>
/// Endpoint cây linh kiện.
///
/// <para><b>KHÔNG đo cái gì:</b> (1) không đo phân quyền thật đầu-cuối — chỉ ghim ĐÚNG policy được gắn
/// vào từng route; việc `Policies.Engineer` thật sự chặn một Operator là phép đo của tầng auth và đã có
/// bài riêng; (2) không đo toàn vẹn tham chiếu sâu — chỉ đo rằng cảnh báo được TRẢ RA, còn nội dung
/// từng luật là `ModelIntegrityTests` của 0a; (3) không đo tài liệu hợp lệ theo JSON Schema.</para>
/// </summary>
```

- `GET /v1/components/{code}` với máy chưa khai → **200** và một tài liệu có `components` rỗng. **Không phải 404.** Đây là §5-bis viết thành bài test: chưa khai là trạng thái hợp lệ.
- `PUT` rồi `GET` trả lại đúng tài liệu.
- `PUT` một tài liệu có `setpoint` thiếu `min`/`max` → **400**, thân là `ApiErrorDto`, và `GET` sau đó vẫn rỗng — từ chối không được để lại nửa bản ghi.
- `PUT` một tài liệu hợp lệ nhưng có `tagPrefix` không khớp tag nào, **khi namespace đã nạp** → **200**, và `Warnings` không rỗng. Đây là quyết định trung tâm của kế hoạch: mất toàn vẹn là cảnh báo, không phải từ chối.
- `PUT` cùng tài liệu ấy khi namespace **chưa** nạp → **200**, `Warnings` **rỗng**. Thứ tự khai báo không phải ràng buộc.
- `GET /v1/component-types` gộp type từ nhiều máy, mỗi `typeId` xuất hiện **một lần**.
- Bốn route đọc gắn `Policies.Operator`, route `PUT` gắn `Policies.Engineer`.

- [ ] **Step 3: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter HmiModelEndpointsTests`
Kỳ vọng: lỗi biên dịch — chưa có endpoint nào.

- [ ] **Step 4: Viết DTO và endpoint**

`HmiModelDtos.cs`:

```csharp
namespace St4i.EngineApi.Endpoints;

/// <summary>Kết quả một lần ghi cây linh kiện. <paramref name="Warnings"/> là mất TOÀN VẸN, không phải
/// lỗi: một `tagPrefix` chưa khớp tag nào có thể chỉ nghĩa là connector chưa nạp namespace. Vi phạm bất
/// biến AN TOÀN §5 không bao giờ đi đường này — nó là 400.</summary>
public sealed record PutModelResultDto(string MachineCode, int ComponentCount, IReadOnlyList<string> Warnings);

/// <summary><paramref name="NamespaceLoaded"/> phân biệt "khớp hết" với "chưa có gì để khớp" — hai trạng
/// thái khác nhau mà một danh sách rỗng không tự nói ra được.</summary>
public sealed record IntegrityReportDto(string MachineCode, bool NamespaceLoaded, IReadOnlyList<string> Violations);
```

`HmiModelEndpoints.cs` — theo đúng khuôn `AssetEndpoints`. Điểm cần cẩn thận:

- `GET /v1/components/{machineCode}` khi store trả `null`: trả **200** với `new ComponentModelDocument(1, machineCode, Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>())`, không phải 404.
- `PUT`: bắt `ContractViolationException` từ store và đổi thành `Results.BadRequest(new ApiErrorDto(...))` mang **mọi** vi phạm, không phải cái đầu tiên. Sau khi ghi thành công, gọi `ModelIntegrity.Check(doc, await tags.GetAsync(machineCode))` và trả cảnh báo.
- `GET /v1/component-types`: đọc mọi máy, gộp `Types` theo `TypeId`, giữ bản gặp đầu tiên. Nếu hai máy khai cùng `typeId` với nội dung khác nhau, **đó là một cảnh báo đáng có** — nhưng nó không thuộc task này; ghi một dòng TODO trong báo cáo thay vì tự thêm.

- [ ] **Step 5: Chạy để xác nhận XANH**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter HmiModelEndpointsTests`

- [ ] **Step 6: Commit**

```bash
git add src/St4i.EngineApi/Endpoints tests/St4i.EngineApi.Tests/HmiModel src/St4i.EngineApi/Program.cs
git commit -m "feat(hmi): the component tree over HTTP, where losing integrity warns and losing safety refuses"
```

---

## Task 2: Endpoint tag namespace

**Files:**
- Create: `src/St4i.EngineApi/Endpoints/HmiTagEndpoints.cs`
- Modify: `src/St4i.EngineApi/Program.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiTagEndpointsTests.cs`

**Interfaces:**
- Consumes: `ITagNamespaceStore.{PutAsync,GetAsync,FindTagAsync}` (0a).
- Produces:
  - `GET /v1/tags?machine={code}` → `200 TagNamespaceDocument` (rỗng nếu chưa nạp)
  - `GET /v1/tags/by-path/{**path}` → `200 TagDescriptor` · `404` nếu không có
  - `PUT /v1/tags/{machineCode}` → `200 PutNamespaceResultDto` · `400` khi vi phạm §5
  - `record PutNamespaceResultDto(string MachineCode, int TagCount, int BackedByDriverCount)`

- [ ] **Step 1: Viết bài test thất bại**

Mệnh đề phải ghim:

- `GET /v1/tags?machine=NOPE` → **200**, `tags` rỗng. Không 404.
- `PUT` rồi `GET` trả lại đúng namespace.
- `GET /v1/tags/by-path/SCRW-01/spindle/torque` trả đúng tag. **Chú ý:** `path` chứa dấu `/`, nên route phải dùng catch-all `{**path}`; một route `{path}` thường sẽ khớp hụt và trả 404 cho mọi tag. Ghim bằng một bài dùng path ba đoạn.
- `GET /v1/tags/by-path/...` với path không tồn tại → **404**. Ở đây 404 là **đúng**, khác với `?machine=` — hỏi một tag cụ thể mà không có là "không tìm thấy", còn hỏi namespace của một máy chưa nạp là "rỗng". Ghim cả hai để sự khác biệt ấy có người canh.
- `PUT` một namespace có tag `rw` thiếu `policyAction` → **400**, và `GET` sau đó vẫn rỗng.
- `PutNamespaceResultDto.BackedByDriverCount` đếm đúng số tag có `isBackedByDriver == true`. Trường này tồn tại để WS-HMI-0c có chỗ chứng minh nó nạp thật; ở đây nó chỉ là phép đếm.
- Route đọc `Policies.Operator`, `PUT` `Policies.Engineer`.

- [ ] **Step 2: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests --filter HmiTagEndpointsTests`

- [ ] **Step 3: Viết endpoint**

Theo khuôn Task 1. Ba chỗ dễ sai:
1. Catch-all `{**path}` — không phải `{path}`.
2. `?machine=` thiếu hoặc rỗng → `400 ApiErrorDto`, không phải trả mọi máy. Một endpoint im lặng trả tất cả khi thiếu tham số lọc là cách một UI vô tình kéo về toàn bộ namespace.
3. Bắt `ContractViolationException` → `400` mang mọi vi phạm.

- [ ] **Step 4: Chạy để xác nhận XANH**

- [ ] **Step 5: Commit**

```bash
git add src/St4i.EngineApi/Endpoints/HmiTagEndpoints.cs tests/St4i.EngineApi.Tests/HmiModel/HmiTagEndpointsTests.cs src/St4i.EngineApi/Program.cs
git commit -m "feat(hmi): tags over HTTP, and the difference between 'no such tag' and 'nothing loaded yet'"
```

---

## Task 3: Sự kiện thay đổi trên kênh realtime đã có

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/HmiModelEvents.cs`
- Modify: `src/St4i.EngineApi/Endpoints/HmiModelEndpoints.cs`, `src/St4i.EngineApi/Endpoints/HmiTagEndpoints.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/HmiModelEventsTests.cs`

**Interfaces:**
- Produces: `HmiModelEvents.ComponentModelChanged(string machineCode)`, `HmiModelEvents.TagNamespaceChanged(string machineCode, int tagCount)`

- [ ] **Step 1: Đọc kênh đã có trước khi thêm gì**

Đọc `src/St4i.EngineApi/Hubs/InspectorStream.cs` **toàn bộ**, và `EventBus`. Ba câu hỏi phải trả lời được trước khi viết: sự kiện có hình dạng gì trên dây, `EventBus.Recent` backfill bao nhiêu và theo luật gì, và client phân biệt loại sự kiện bằng trường nào.

🔴 Doc comment ở `InspectorStream.cs:219` nói khung dây của kênh này **giữ byte-identical** theo một phán quyết đã có. Đọc phán quyết ấy trước khi thêm một loại sự kiện mới. Nếu thêm loại mới làm đổi khung của loại cũ, **dừng và báo** — đó là phá một cam kết, không phải mở rộng nó.

- [ ] **Step 2: Viết bài test thất bại**

- `PUT /v1/components/{code}` phát đúng **một** sự kiện mang `machineCode`.
- `PUT /v1/tags/{code}` phát đúng **một** sự kiện mang `machineCode` và `tagCount`.
- Một `PUT` **thất bại** (vi phạm §5 → 400) phát **không** sự kiện nào. Đây là bài quan trọng nhất của task: một client nghe thấy "đã đổi" rồi đọc lại và thấy y nguyên là cách UI mất niềm tin vào kênh.
- Khung của các sự kiện sẵn có không đổi.

- [ ] **Step 3: Chạy để xác nhận ĐỎ**

- [ ] **Step 4: Viết bộ phát sự kiện, nối vào hai endpoint**

Phát **sau khi** store trả về thành công, không phải trước. Nếu bạn phát trước rồi store ném, bài "PUT thất bại không phát sự kiện" sẽ đỏ — và nó đỏ vì lý do đúng.

- [ ] **Step 5: Chạy để xác nhận XANH**

- [ ] **Step 6: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/HmiModelEvents.cs src/St4i.EngineApi/Endpoints tests/St4i.EngineApi.Tests/HmiModel
git commit -m "feat(hmi): announce a change only after it happened, never before"
```

---

## Task 4: OpenAPI, capabilities, và đóng sổ

**Files:**
- Modify: `src/St4i.EngineApi/openapi/` (theo đúng cách các endpoint khác được mô tả — đọc trước)
- Modify: `src/St4i.EngineApi/Endpoints/CapabilitiesEndpoints.cs`
- Modify: `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md`, `README.md`
- Test: mở rộng `tests/St4i.EngineApi.Tests/HmiModel/HmiModelEndpointsTests.cs`

- [ ] **Step 1: Mô tả tám route trong OpenAPI**

Đọc `src/St4i.EngineApi/openapi/` để thấy các route hiện có được mô tả thế nào, rồi làm y hệt. Nhánh web đọc tài liệu này; một route không mô tả là một route nhánh kia phải đoán.

- [ ] **Step 2: Cờ capabilities**

WS-HMI-0a đã thêm một cờ cho mô hình. Task này thêm cờ cho **API**, tách biệt — vì hai nhánh song song cần biết "store đã có" khác "API đã mở".

- [ ] **Step 3: Chạy toàn bộ, ghi số liệu thật**

```bash
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.Hmi.Contracts.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EdgeCore.Tests
node scripts/check-contracts.mjs
cd web && npm run build && npx oxlint
```

`EdgeCore` phải **không đổi số bài** — task này không thêm project. Xác nhận `npm run build` bằng **exit code**.

Playwright: task này không thêm route web và không chạm component render nào, nên không chạy. **Nói rõ là không chạy và vì sao.**

- [ ] **Step 4: Ghi ledger roadmap**

Một hàng ở §0-bis.1, nêu cả cái CHƯA có: chưa có driver nào nạp tag thật (0c), chưa có editor, chưa có runtime.

- [ ] **Step 5: Commit**

```bash
git add src/St4i.EngineApi docs/ README.md tests/
git commit -m "docs(hmi): describe the eight routes the other branch has to build against"
```

---

## Nghiệm thu WS-HMI-0b

- [ ] Tám route hoạt động, gắn đúng vai trò, mô tả trong OpenAPI.
- [ ] Máy chưa khai trả **rỗng**, không 404; một tag cụ thể không có trả **404**. Cả hai đều có bài ghim.
- [ ] Vi phạm §5 là **400** và không để lại nửa bản ghi; mất toàn vẹn là **cảnh báo trong 200**.
- [ ] Thứ tự khai báo không phải ràng buộc — `PUT` cây trước khi có namespace không sinh cảnh báo.
- [ ] `PUT` thất bại **không** phát sự kiện.
- [ ] Khung dây của các sự kiện sẵn có **không đổi**.
- [ ] `EdgeCore` giữ nguyên số bài.

---

## Ghi chú cho WS-HMI-0c

`BackedByDriverCount` ở Task 2 hiện chỉ là phép đếm một trường dữ liệu. 0c là chỗ nó phải trở thành mệnh đề đo được — và kho này có một khuyết tật lặp lại đủ nhiều để thành bài học: một thứ được khai đủ, kiểm miền, lưu đĩa, phục vụ qua API, **và không ai đọc**. Xem `MachineParameterSchema.IsConsumedBySimulator` và `UnconsumedConfigKindsTests` để thấy khuôn đóng nó: một cờ, và một bài test **đỏ theo cả hai chiều** — kể cả chiều ai đó nối dây thật mà quên sửa lời khai.
