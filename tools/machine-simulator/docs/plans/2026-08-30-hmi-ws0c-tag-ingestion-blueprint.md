# WS-HMI-0c — Nạp tag thật từ connector
# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến tag namespace từ một thứ người ta nhập tay thành một thứ **connector khai và driver thật sự đọc** — và làm cho cờ `isBackedByDriver` trở thành một mệnh đề đo được thay vì một trường dữ liệu.

**Architecture:** Một khai báo bản đồ tag đặt cạnh cấu hình connector đã có; một bộ biên dịch dựng `TagNamespaceDocument` từ khai báo ấy; và một cờ được ghim bằng bài test **đỏ theo cả hai chiều**, theo đúng khuôn `MachineParameterSchema.IsConsumedBySimulator` + `UnconsumedConfigKindsTests` mà kho này đã dựng cho cùng lớp khuyết tật.

**Tech Stack:** .NET 10 · `St4i.Connector.Abstractions` (`IDeviceDriver`, `IConnectorFactory`, `ConnectorRegistry`) · xUnit.

**Spec:** [docs/HMI_BUILDER_DESIGN_2026-08-29.md](../HMI_BUILDER_DESIGN_2026-08-29.md) §3.2.
**Kế hoạch tiền nhiệm (BẮT BUỘC xong trước):** [WS-HMI-0a](2026-08-30-hmi-ws0a-model-store-blueprint.md) và [WS-HMI-0b](2026-08-30-hmi-ws0b-api-stream-blueprint.md).

---

## 🔴 Một đính chính với spec, đo từ mã — đọc trước khi làm gì

Spec §3.2 và bảng §2.2 nói `mapping/*.json` là placeholder **"không được runtime đọc"**, và mô tả WS-HMI-0 là **"thay"** nó. **Cả hai đều quá lời**, và tin theo sẽ dẫn tới việc xoá một thứ đang chạy.

Đo được:

| Mệnh đề | Sự thật |
|---|---|
| `mapping/*.json` không được đọc | **SAI.** `src/St4i.EdgeCore/Mapping/MappingProfile.cs` phân tích nó; `MappingProfileResolver` phân giải theo máy; `FleetCore` và `EdgeAgentPipelines` dùng nó |
| Nó là bản đồ địa chỉ tag | **SAI.** Nó giữ `Name`, `DeviceClass`, `DefaultStepType`, `DefaultRecipeCode`, `UnitMap` — nó **chuẩn hoá số đọc** (đổi `C` → `°C`, điền step/recipe mặc định), không ánh xạ địa chỉ |
| `_note` trong `screwdrive.json` nói cả file vô dụng | **Đọc quá.** Nó nói về năng lực *"Mapping UI"* còn thiếu (doc 62 §11 P2), không phải về `UnitMap` đang chạy |
| `MappingProfileResolver` đang được dùng trong pipeline | **KHÔNG.** `EdgeAgentPipelines` cố ý dùng **một** profile fallback chung và ghi rõ lý do trong doc comment tại `:131-132` |

**Hệ quả cho kế hoạch này: 0c THÊM một tầng bản đồ tag bên cạnh `MappingProfile`, không thay nó.** Hai thứ trả lời hai câu khác nhau — `MappingProfile` trả lời *"số này mang đơn vị gì"*, bản đồ tag trả lời *"thanh ghi nào là tag nào"*. Đừng gộp; đừng xoá.

Nếu bạn thấy mình đang sửa `MappingProfile`, `MappingProfileResolver`, `FleetCore` hay `EdgeAgentPipelines`, **dừng và báo** — bạn đã ra khỏi phạm vi.

---

## Global Constraints

- **Chạy test .NET TỪNG PROJECT MỘT**, đường dẫn **tuyệt đối**.
- **Không sửa hợp đồng** (`contracts/*`, record `St4i.Hmi.Contracts`, `web/src/contracts/*.ts`) — đóng băng từ Mốc 0.
- **Không sửa `MappingProfile` và họ hàng của nó** (xem khối đính chính trên).
- **`St4i.Connector.Abstractions` giữ ZERO dependency.** Nếu bản đồ tag cần một kiểu chung, nó vào đó **chỉ khi** không kéo theo gì; nếu không, để ở `St4i.EngineApi`.
- **Bất biến an toàn §5** vẫn do `ContractInvariants` (0a) gác tại cửa ghi. Một connector khai một tag `rw` thiếu `policyAction` phải bị **từ chối**, không phải được lưu rồi cảnh báo.
- **Mỗi bài test nói rõ nó KHÔNG đo cái gì.**
- **§5-bis:** một connector không khai bản đồ tag nào là **hợp lệ** — nó chỉ không đóng góp tag. Không lỗi, không màn chặn, không đội hình mặc định bịa ra.
- Commit sau mỗi task, thông điệp tiếng Anh.

---

## Bài học kho này đã trả giá, và là lý do Task 3 tồn tại

`MACHINE_CONFIG_DESIGN.md` ghi lại một khuyết tật lặp lại: `dispense_program` và `weld_profile` **được khai đủ, kiểm miền cứng, lưu đĩa, phục vụ qua `GET /v1/machines/{code}/settings` — và không bộ mô phỏng nào đọc chúng.** Bảng tài liệu nói *"vựng từ nào được phục vụ"*, nó không nói *"giá trị có tác dụng"*, và suốt nhiều tháng không ai phân biệt hai câu ấy.

Cách nó được đóng: một cờ `MachineParameterSchema.IsConsumedBySimulator`, ghim bằng `UnconsumedConfigKindsTests` — **đỏ theo cả hai chiều**, kể cả chiều ai đó nối dây thật mà quên sửa lời khai.

`isBackedByDriver` là đúng cùng hình dạng bẫy ấy. Task 3 tồn tại để nó không rơi vào.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/St4i.EngineApi/HmiModel/TagMapDeclaration.cs` | Hình dạng khai báo bản đồ tag của một connector |
| `src/St4i.EngineApi/HmiModel/TagNamespaceBuilder.cs` | Khai báo → `TagNamespaceDocument` |
| `src/St4i.EngineApi/HmiModel/DriverTagSupport.cs` | Kind nào thật sự nạp được tag, và cờ được ghim |
| `src/St4i.EngineApi/HmiModel/TagIngestionService.cs` | Nối vào vòng đời connector |
| `tests/St4i.EngineApi.Tests/HmiModel/TagNamespaceBuilderTests.cs` | |
| `tests/St4i.EngineApi.Tests/HmiModel/DriverTagSupportTests.cs` | bài ghim hai chiều |
| `tests/St4i.EngineApi.Tests/HmiModel/TagIngestionServiceTests.cs` | |

---

## Task 1: Khai báo bản đồ tag

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/TagMapDeclaration.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/TagMapDeclarationTests.cs`

**Interfaces:**
- Produces:
  - `record TagMapEntry(string Path, string DataType, string? Unit, double? EngMin, double? EngMax, IReadOnlyList<string>? EnumValues, string Access, string? PolicyAction, TagSource Source)`
  - `record TagMapDeclaration(int SchemaVersion, string MachineCode, IReadOnlyList<TagMapEntry> Entries)`
  - `TagMapDeclaration.TryParse(string json, out TagMapDeclaration? decl, out string? error)`

- [ ] **Step 1: Hiểu chỗ nó sống trước khi khai hình dạng**

Đọc `src/St4i.EngineApi/Fleet/ConnectorConfigStore.cs` và `connectors.json`. Cấu hình connector hiện là **một chuỗi** đi vào `IConnectorFactory.TryCreate(string config, ...)` — mỗi hãng tự định nghĩa hình dạng bên trong. Bản đồ tag **không** được nhét vào chuỗi ấy: nó là dữ liệu của ta, không của hãng, và trộn vào sẽ buộc mọi connector bên thứ ba phải hiểu định dạng của ta.

Vì vậy khai báo bản đồ tag là **một tài liệu riêng, gắn theo `machineCode`**, đúng cách `TagNamespaceDocument` đã gắn.

- [ ] **Step 2: Viết bài test thất bại**

Ghim ba mệnh đề:
- Một JSON hợp lệ phân tích được, giữ nguyên mọi trường.
- JSON hỏng cú pháp → `TryParse` trả `false` và `error` **nêu được vị trí**, không phải ném.
- Một entry `access: "rw"` thiếu `policyAction` **vẫn phân tích được ở tầng này** — vì việc từ chối nó là của `ContractInvariants` tại cửa ghi (Task 2), không phải của bộ phân tích. Ghim điều đó tường minh, kèm câu giải thích: một bộ phân tích cũng từ chối theo luật an toàn nghĩa là có **hai** chỗ định nghĩa cùng một luật, và hai chỗ sẽ lệch.

- [ ] **Step 3: Chạy để xác nhận ĐỎ** · **Step 4: Viết kiểu và bộ phân tích** · **Step 5: XANH**

Dùng `HmiContractJson.Options`. `TryParse` bắt `JsonException` và đổi thành `error`, không để lọt ra ngoài.

- [ ] **Step 6: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/TagMapDeclaration.cs tests/St4i.EngineApi.Tests/HmiModel/TagMapDeclarationTests.cs
git commit -m "feat(hmi): a tag map is our data, not the vendor's, so it lives beside the connector config"
```

---

## Task 2: Bộ biên dịch khai báo → namespace

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/TagNamespaceBuilder.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/TagNamespaceBuilderTests.cs`

**Interfaces:**
- Consumes: `TagMapDeclaration` (Task 1); `DriverTagSupport.CanBack(string kind)` (Task 3 — viết Task 3 **trước** nếu bạn thấy thứ tự này khó, chúng độc lập).
- Produces: `TagNamespaceBuilder.Build(TagMapDeclaration decl, string driverKind)` → `TagNamespaceDocument`

- [ ] **Step 1: Viết bài test thất bại**

Mệnh đề phải ghim, và mệnh đề thứ ba là lý do task này tồn tại:

1. Mỗi `TagMapEntry` thành đúng một `TagDescriptor`, mọi trường đi qua nguyên vẹn.
2. `machineCode` và `schemaVersion` đi vào tài liệu kết quả.
3. **`isBackedByDriver` phản ánh SỰ THẬT, không phải mong muốn.** Với `driverKind` mà `DriverTagSupport.CanBack` trả `true`, cờ là `true`; với kind không nạp được (ví dụ một connector chỉ-đọc-chu-kỳ chưa có đường đọc theo địa chỉ), cờ là `false` **dù khai báo có đầy đủ đến đâu**. Ghim cả hai chiều.
4. Một khai báo rỗng cho ra một namespace **rỗng và hợp lệ**, không phải null, không phải lỗi (§5-bis).

```csharp
/// <summary>
/// <para><b>KHÔNG đo cái gì:</b> (1) nó KHÔNG đo rằng driver thật sự đọc được địa chỉ trong
/// <c>Source</c> — không có thiết bị nào trong bài test này; cái nó đo là cờ
/// <c>isBackedByDriver</c> nói đúng về NĂNG LỰC CỦA KIND, và ranh giới ấy là có chủ ý; (2) nó KHÔNG
/// kiểm bất biến §5 — đó là <c>ContractInvariants</c> tại cửa ghi; (3) nó KHÔNG đo đơn vị được
/// <c>MappingProfile</c> viết lại, vì đó là một tầng khác trả lời một câu khác.</para>
/// </summary>
```

- [ ] **Step 2: ĐỎ** · **Step 3: Viết bộ biên dịch** · **Step 4: XANH**

- [ ] **Step 5: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/TagNamespaceBuilder.cs tests/St4i.EngineApi.Tests/HmiModel/TagNamespaceBuilderTests.cs
git commit -m "feat(hmi): compile a declaration into a namespace, and let the flag tell the truth"
```

---

## Task 3: Cờ `isBackedByDriver`, ghim đỏ theo cả hai chiều

Đây là task quan trọng nhất của kế hoạch. Đọc khối *"Bài học kho này đã trả giá"* ở trên trước khi bắt đầu.

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/DriverTagSupport.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/DriverTagSupportTests.cs`

**Interfaces:**
- Produces:
  - `DriverTagSupport.CanBack(string connectorKind)` → `bool`
  - `DriverTagSupport.DeclaredKinds` → `IReadOnlyDictionary<string, bool>` — lời khai, và là thứ bài test đối chiếu

- [ ] **Step 1: Đọc bài ghim mẫu, rồi đọc sự thật**

Đọc `tests/St4i.EdgeCore.Tests/UnconsumedConfigKindsTests.cs` — khuôn bạn sẽ theo. Rồi xác định **sự thật đo được**: connector kind nào trong cây này thật sự có đường đọc theo địa chỉ (Modbus TCP/RTU, OPC-UA), và kind nào không (simulated theo chu kỳ, hotfolder, mqtt-iot…). `ConnectorRegistry` và các `IConnectorFactory` sẵn có là nguồn; **đừng đoán từ tên**.

Với `simulated`: quyết định của kế hoạch này là `CanBack` trả **`true`**, vì một máy mô phỏng vẫn phục vụ một namespace dùng được cho triển lãm và cho phát triển nhánh web — nhưng chỉ khi `ST4I_DEMO_ENABLED` bật, đúng ranh giới đội-hình-demo mà Đợt A đã dựng. Nếu bạn thấy lý do khác, **nói ra trong báo cáo** thay vì lặng lẽ đổi.

- [ ] **Step 2: Viết bài ghim hai chiều thất bại**

Ba thành phần bắt buộc, đúng như khuôn:

1. **Chiều xuôi:** mọi kind trong `DeclaredKinds` phải là một kind `ConnectorRegistry` thật sự biết. Một lời khai cho một kind không tồn tại là lời khai đã cũ.
2. **Chiều ngược:** mọi kind `ConnectorRegistry` biết phải có một hàng trong `DeclaredKinds`. Một connector mới thêm mà quên khai là chính xác cái bẫy — nó sẽ im lặng nhận mặc định.
3. **Không rỗng:** nếu `DeclaredKinds` rỗng hoặc `ConnectorRegistry` không trả kind nào, bài test phải **đỏ**, không phải xanh vô nghĩa.

Cộng một bài thứ tư, và nó là bài thật sự đắt: **một kind khai `CanBack = true` phải có một `IConnectorFactory` mà driver của nó cài `IWritableDeviceDriver` hoặc có đường đọc theo địa chỉ.** Nếu bạn không đo được điều đó một cách trung thực từ mã, **đừng giả vờ** — viết bài đo được thứ đo được, và ghi rõ trong doc comment cái nó KHÔNG đo, để người sau không đọc quá.

- [ ] **Step 3: ĐỎ** · **Step 4: Viết lời khai** · **Step 5: XANH**

- [ ] **Step 6: Chứng minh nó đỏ theo cả hai chiều**

Không đủ nếu chỉ thấy xanh. Làm hai lần thử, ghi lại đầu ra thật, rồi hoàn nguyên:
- Thêm một hàng giả cho kind `"st4i.nonexistent"` vào `DeclaredKinds` → bài chiều xuôi phải đỏ.
- Xoá một hàng thật → bài chiều ngược phải đỏ.

Chứng minh hoàn nguyên bằng `git diff --exit-code -- src/St4i.EngineApi/HmiModel/DriverTagSupport.cs`.

- [ ] **Step 7: Commit**

```bash
git add src/St4i.EngineApi/HmiModel/DriverTagSupport.cs tests/St4i.EngineApi.Tests/HmiModel/DriverTagSupportTests.cs
git commit -m "test(hmi): the flag that says a driver backs a tag now has something that checks"
```

---

## Task 4: Nối vào vòng đời connector

**Files:**
- Create: `src/St4i.EngineApi/HmiModel/TagIngestionService.cs`
- Modify: `src/St4i.EngineApi/Program.cs`
- Test: `tests/St4i.EngineApi.Tests/HmiModel/TagIngestionServiceTests.cs`

**Interfaces:**
- Consumes: `TagMapDeclaration`, `TagNamespaceBuilder`, `DriverTagSupport`, `ITagNamespaceStore` (0a).
- Produces: `TagIngestionService.IngestAsync(string machineCode, string driverKind, string tagMapJson, CancellationToken ct)` → `Task<IngestResult>`; `record IngestResult(bool Ok, int TagCount, int BackedCount, IReadOnlyList<string> Errors)`

- [ ] **Step 1: Viết bài test thất bại**

- Một khai báo hợp lệ được lưu, `GET` namespace trả về đúng nó.
- Một khai báo vi phạm §5 → `Ok == false`, `Errors` mang **mọi** vi phạm, và namespace **không đổi** — nạp lại hỏng không được phép xoá cái đang chạy. Đây là bài quan trọng nhất của task.
- Nạp lại cho cùng máy **thay thế** namespace cũ, và tag không còn khai báo biến mất (0a đã ghim ở tầng store; ở đây ghim rằng đường nạp thật sự đi qua đường ấy).
- Một connector không có bản đồ tag → `Ok == true`, `TagCount == 0`, không lỗi (§5-bis).

- [ ] **Step 2: ĐỎ** · **Step 3: Viết service** · **Step 4: XANH**

Thứ tự trong `IngestAsync`: parse → build → `ContractInvariants` (qua store) → lưu. Lỗi ở bất kỳ bước nào trả `IngestResult` với `Ok=false` và **không chạm store**.

- [ ] **Step 5: Nối vào đăng ký connector**

Đọc `ConnectorRegistry.Register` và chỗ `Program.cs`/`FleetHost` gọi nó. Nạp tag chạy **sau khi** connector đăng ký thành công. Một lần nạp hỏng **không được** làm hỏng việc đăng ký connector — cùng lý lẽ `IAssetRegistry.UpsertAsync` không bao giờ ném: một máy vẫn phải chạy được dù namespace HMI của nó lỗi. Ghi lỗi vào log, không ném lên.

🔴 Chú ý: đây là một trong hai chỗ của cả workstream có ngoại lệ "nuốt lỗi", và ngoại lệ ấy phải được ghi trong doc comment cùng lý do. Chỗ kia là `AssetRegistryStore.UpsertAsync`.

- [ ] **Step 6: Commit**

```bash
git add src/St4i.EngineApi tests/St4i.EngineApi.Tests/HmiModel
git commit -m "feat(hmi): ingest on connector registration, and never let a bad map take a machine down"
```

---

## Task 5: Đóng sổ

- [ ] **Step 1: Chạy toàn bộ, ghi số liệu thật**

```bash
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EngineApi.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.Hmi.Contracts.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.EdgeCore.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.Connector.Abstractions.Tests
dotnet test /d/SOURCES/avi-aoi-sim/tools/machine-simulator/tests/St4i.Connector.Conformance.Tests
node scripts/check-contracts.mjs
cd web && npm run build && npx oxlint
```

Hai suite connector nằm trong danh sách vì Task 3 đọc `ConnectorRegistry` — nếu bạn vô tình đổi bề mặt của nó, chúng là chỗ biết. `EdgeCore` phải **không đổi số bài**.

- [ ] **Step 2: Sửa spec, đừng để nó tiếp tục nói quá**

`docs/HMI_BUILDER_DESIGN_2026-08-29.md` §2.2 và §3.2 nói `mapping/*.json` không được đọc và sẽ bị **thay**. Cả hai sai (xem khối đính chính đầu kế hoạch này). Ghi chú đè lên tại chỗ theo đúng thói quen của kho — trích **nguyên văn** câu cũ, nêu phép đo bác nó, rồi nêu câu đúng. **Không xoá**.

- [ ] **Step 3: Ledger roadmap + README**

Một hàng §0-bis.1, nêu cả cái CHƯA có: chưa có editor, chưa có runtime, và `CanBack` cho `simulated` gắn với `ST4I_DEMO_ENABLED` chứ không phải luôn bật.

- [ ] **Step 4: Commit**

```bash
git add docs/ README.md
git commit -m "docs(hmi): the mapping profile was never dead code, and the spec said it was"
```

---

## Nghiệm thu WS-HMI-0c

- [ ] Một connector Modbus hoặc OPC-UA khai bản đồ tag → namespace xuất hiện qua `GET /v1/tags?machine=`, `isBackedByDriver` **true**.
- [ ] Một kind không nạp được địa chỉ → cờ **false**, dù khai báo đầy đủ.
- [ ] Bài ghim `DriverTagSupport` **đã được nhìn thấy đỏ theo CẢ HAI chiều**, có đầu ra thật trong báo cáo.
- [ ] Một bản đồ hỏng **không** làm hỏng việc đăng ký connector, và **không** xoá namespace đang chạy.
- [ ] `MappingProfile` và họ hàng **không bị chạm**.
- [ ] Spec đã được ghi chú đè, không xoá.
- [ ] `EdgeCore` giữ nguyên số bài.
