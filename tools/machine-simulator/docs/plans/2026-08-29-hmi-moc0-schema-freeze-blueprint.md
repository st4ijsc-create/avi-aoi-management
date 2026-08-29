# HMI Builder — Mốc 0: Chốt & đóng băng hợp đồng schema
# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng băng ba hợp đồng JSON Schema (tag namespace, mô hình linh kiện, màn hình HMI) cùng một bộ fixture dùng chung và các bài test ghim hai chiều ở CẢ hai phía .NET và web — để hai nhánh thi công song song sau đó không thể lệch nhau mà không có test đỏ.

**Architecture:** Một thư mục `contracts/` mới giữ ba file JSON Schema + bộ fixture hợp lệ/không hợp lệ. Một contract assembly .NET zero-dependency `St4i.Hmi.Contracts` (đúng khuôn `St4i.Connector.Abstractions` đã có ở WS-G-plugin) giữ record C#. Một thư mục `web/src/contracts/` giữ type TypeScript. Cả hai phía chạy **cùng một bộ fixture** qua hai loại test: *round-trip* (đọc → ghi → so khớp ngữ nghĩa) và *ghim hai chiều* (mọi property trong schema có mặt ở type, và ngược lại, với danh sách miễn trừ khai tường minh + khẳng định không rỗng).

**Tech Stack:** .NET 10 (`net10.0`, zero dependency) · xUnit · TypeScript 6 · Node built-in test runner (`node --test`) — **không thêm một npm package nào** · JSON Schema draft 2020-12.

**Spec:** [docs/HMI_BUILDER_DESIGN_2026-08-29.md](../HMI_BUILDER_DESIGN_2026-08-29.md) — đọc §4 (hợp đồng schema), §5 (an toàn), §5-bis (bán được cho 1 máy) trước khi bắt đầu.

---

## Sai lệch có chủ ý so với spec §4 — đọc trước

Spec §4 khoản 2 viết *"sinh kiểu hai chiều: C# record ⟷ TypeScript type **sinh từ** cùng một JSON Schema"*. Kế hoạch này **không sinh kiểu**; nó **viết tay type ở cả hai phía và ghim bằng test hai chiều**. Ba lý do:

1. **Zero dependency mới.** Sinh kiểu C# cần NJsonSchema/JsonSchema.Net; sinh TS cần `json-schema-to-typescript`. Kho này vừa dọn CVE NU1903 ở WS-FF và ghim từng phiên bản một; contract assembly `St4i.Connector.Abstractions` được làm **ZERO dependency** có chủ đích. Thêm hai toolchain sinh mã đi ngược cả hai.
2. **Đây là khuôn mẫu kho này tự phát minh ra và đã chứng minh.** `MachineConfigDesignDocTableTests` đối chiếu tài liệu ⟷ mã **hai chiều, với danh sách miễn trừ khai tường minh và khẳng định không rỗng** — chính xác cơ chế cần ở đây. Test ghim bắt drift ngang codegen, nhưng đọc được và sửa được bằng tay.
3. **Codegen giấu quyết định.** Type viết tay ép người viết đọc schema. Với hợp đồng mà cả hai nhánh phải hiểu **giống nhau**, đó là tính năng chứ không phải chi phí.

Đánh đổi phải nói thẳng: viết tay có thể lệch **giữa hai lần chạy test**. Bù lại bằng việc test ghim chạy trong cổng build của cả hai phía (Task 7), nên cửa sổ lệch không sống qua một commit.

**Nếu chủ sở hữu muốn đúng nguyên văn spec §4 (codegen), dừng ở đây và nói — đừng tự chuyển hướng giữa chừng.**

---

## Global Constraints

Áp cho **mọi** task trong kế hoạch này.

- **Target framework:** `net10.0` cho contract assembly (KHÔNG `net10.0-windows` — contract phải dùng được từ bất kỳ host nào, đúng như `St4i.Connector.Abstractions`). Test project theo đúng target của các test project hiện có.
- **ZERO dependency trên contract assembly.** Không `PackageReference` nào trong `St4i.Hmi.Contracts.csproj` ngoài những gì `Directory.Build.props` đã áp.
- **KHÔNG thêm npm package.** Test phía web dùng `node --test` (có sẵn trong Node) và `.mjs`, đúng khuôn `web/scripts/check-test-budgets.mjs` và `web/scripts/reset-engine-state.mjs`.
- **Chạy test .NET TỪNG PROJECT MỘT**, không bao giờ `dotnet test` cả solution — `dotnet test` toàn solution **không ổn định trên máy này** (ghi nhận ở Đợt A §0-bis).
- **`schemaVersion` là trường BẮT BUỘC** trong mọi document gốc, kiểu `const` số nguyên, giá trị `1` ở v1.
- **Offline tuyệt đối.** `$id` dùng `https://st4i.local/...` (không phân giải được, cố ý — không có gì fetch nó). Không có bước build nào chạm mạng.
- **Mỗi bài test phải nói rõ nó KHÔNG đo cái gì**, trong XML doc comment (C#) hoặc block comment đầu file (JS). Đây là quy ước của kho này, xem `MachineConfigDesignDocTableTests` — không phải trang trí, nó là thứ ngăn một bài xanh bị đọc thành nhiều hơn nó chứng minh.
- **Bất biến an toàn §5 phải mã hoá được trong schema:** một tag `access: "rw"` **bắt buộc** có `policyAction` khác null. Điều này được ghim bằng fixture `invalid/`, không chỉ bằng văn xuôi.
- **Bất biến bán-được §5-bis:** không task nào trong Mốc 0 tạo dữ liệu mặc định nào ngoài file trong `contracts/fixtures/` — fixture **không bao giờ** được nạp vào runtime sản phẩm.
- **Commit sau mỗi task**, thông điệp tiếng Anh theo đúng phong cách lịch sử gần đây của nhánh.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `contracts/README.md` | Luật đóng băng: ai được đổi schema, đổi thì phải làm gì |
| `contracts/tag-namespace.schema.json` | Hợp đồng tag (§3.2 spec) |
| `contracts/component-model.schema.json` | Hợp đồng `ComponentType` + cây linh kiện (§3.1 spec) |
| `contracts/hmi-screen.schema.json` | Hợp đồng màn hình + widget + binding (§3.3 spec) |
| `contracts/fixtures/valid/*.json` | Corpus hợp lệ — CẢ HAI phía phải đọc được hết |
| `contracts/fixtures/invalid/*.json` | Corpus phải bị từ chối, tên file nêu luật bị vi phạm |
| `src/St4i.Hmi.Contracts/*.cs` | Record C#, zero dependency |
| `tests/St4i.Hmi.Contracts.Tests/*.cs` | Round-trip + ghim hai chiều phía .NET |
| `web/src/contracts/*.ts` | Type TypeScript |
| `web/contract-tests/*.mjs` | Validate corpus + ghim hai chiều phía web (ngoài `web/tests/` — xem Task 6) |

Ba schema tách ba file vì chúng có **ba vòng đời khác nhau**: tag namespace đổi khi thêm loại nguồn dữ liệu; component model đổi khi thêm loại linh kiện; screen schema đổi khi thêm loại widget. Gộp lại thì một thay đổi widget bắt cả hai nhánh rebase.

---

## Task 1: Khung `contracts/` + luật đóng băng + schema tag-namespace

**Files:**
- Create: `contracts/README.md`
- Create: `contracts/tag-namespace.schema.json`
- Create: `contracts/fixtures/valid/tags-screwdrive-minimal.json`
- Create: `contracts/fixtures/valid/tags-screwdrive-full.json`
- Create: `contracts/fixtures/invalid/tags-rw-without-policy-action.json`
- Create: `contracts/fixtures/invalid/tags-float-without-eng-range.json`

**Interfaces:**
- Consumes: (không có — task đầu)
- Produces: `contracts/tag-namespace.schema.json` với `$id` = `https://st4i.local/contracts/tag-namespace/v1`; document gốc có `schemaVersion` (const 1), `machineCode` (string), `tags` (array). Mỗi tag: `path`, `dataType`, `unit`, `engMin`, `engMax`, `enumValues`, `access`, `policyAction`, `source`, `isBackedByDriver`.

- [ ] **Step 1: Tạo `contracts/README.md` với luật đóng băng**

```markdown
# `contracts/` — hợp đồng schema đã đóng băng / frozen schema contracts

**EN** — These three JSON Schemas are the contract between the .NET Spine branch and the web
Runtime/Editor branch. They were frozen at Milestone 0 precisely so those two branches could be built
in parallel without drifting apart. Changing one is not a normal edit.

**VI** — Ba file JSON Schema ở đây là hợp đồng giữa nhánh .NET Spine và nhánh web Runtime/Editor.
Chúng được đóng băng ở Mốc 0 để hai nhánh xây song song mà không lệch nhau. Sửa một file ở đây
KHÔNG phải một lần sửa bình thường.

## Luật đổi schema / How to change a schema

1. **Cộng thêm thì được, bỏ đi thì không** (additive only). Thêm property optional: được. Xoá
   property, đổi tên, đổi kiểu, siết ràng buộc: **phải tăng `schemaVersion`** và giữ đường đọc bản cũ.
2. **Đổi là đổi cả bốn chỗ, trong CÙNG một commit** — schema, fixture, record C#, type TypeScript.
   Test ghim hai chiều ở cả hai phía sẽ đỏ nếu thiếu bất kỳ chỗ nào. Đó là chủ ý.
3. **Fixture là một phần của hợp đồng.** Thêm property nghĩa là thêm/sửa ít nhất một fixture
   `valid/` dùng nó. Thêm ràng buộc nghĩa là thêm một fixture `invalid/` vi phạm đúng ràng buộc đó,
   và tên file phải nêu luật bị vi phạm.
4. **`$id` không phân giải được là cố ý.** `https://st4i.local/...` không tồn tại trên mạng. Sản phẩm
   này chạy offline tuyệt đối; không có gì được phép fetch một schema.

## Ràng buộc an toàn được mã hoá TRONG schema, không chỉ trong văn xuôi

`tag-namespace.schema.json` bắt buộc: một tag `access: "rw"` phải có `policyAction` khác null. Đây là
bất biến §5 của tài liệu thiết kế ("không có đường ghi không gác") viết thành luật máy kiểm được.
Fixture `invalid/tags-rw-without-policy-action.json` tồn tại để chứng minh luật ấy thật sự chặn.
```

- [ ] **Step 2: Viết `contracts/tag-namespace.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://st4i.local/contracts/tag-namespace/v1",
  "title": "St4i Tag Namespace",
  "type": "object",
  "required": ["schemaVersion", "machineCode", "tags"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "const": 1 },
    "machineCode": { "type": "string", "minLength": 1 },
    "tags": { "type": "array", "items": { "$ref": "#/$defs/tag" } }
  },
  "$defs": {
    "tag": {
      "type": "object",
      "required": ["path", "dataType", "access", "source", "isBackedByDriver"],
      "additionalProperties": false,
      "properties": {
        "path": { "type": "string", "pattern": "^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)+$" },
        "dataType": { "enum": ["bool", "int", "float", "string", "enum"] },
        "unit": { "type": ["string", "null"] },
        "engMin": { "type": ["number", "null"] },
        "engMax": { "type": ["number", "null"] },
        "enumValues": { "type": ["array", "null"], "items": { "type": "string" } },
        "access": { "enum": ["r", "rw"] },
        "policyAction": { "enum": [null, "machine.setpoint", "machine.command"] },
        "source": { "$ref": "#/$defs/source" },
        "isBackedByDriver": { "type": "boolean" }
      },
      "allOf": [
        {
          "if": { "properties": { "access": { "const": "rw" } }, "required": ["access"] },
          "then": { "properties": { "policyAction": { "type": "string" } }, "required": ["policyAction"] }
        },
        {
          "if": { "properties": { "dataType": { "enum": ["int", "float"] } }, "required": ["dataType"] },
          "then": {
            "properties": { "engMin": { "type": "number" }, "engMax": { "type": "number" } },
            "required": ["engMin", "engMax"]
          }
        }
      ]
    },
    "source": {
      "oneOf": [
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "unitId", "register"],
          "properties": {
            "kind": { "const": "modbus" },
            "unitId": { "type": "integer", "minimum": 0, "maximum": 255 },
            "register": { "type": "integer", "minimum": 0 },
            "scale": { "type": ["number", "null"] }
          }
        },
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "nodeId"],
          "properties": { "kind": { "const": "opcua" }, "nodeId": { "type": "string", "minLength": 1 } }
        },
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "topic"],
          "properties": {
            "kind": { "const": "mqtt" },
            "topic": { "type": "string", "minLength": 1 },
            "jsonPath": { "type": ["string", "null"] }
          }
        },
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind"],
          "properties": { "kind": { "const": "simulated" } }
        },
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "expr"],
          "properties": { "kind": { "const": "derived" }, "expr": { "type": "string", "minLength": 1 } }
        }
      ]
    }
  }
}
```

- [ ] **Step 3: Viết bốn fixture**

`contracts/fixtures/valid/tags-screwdrive-minimal.json` — trường hợp nhỏ nhất còn hợp lệ:

```json
{
  "schemaVersion": 1,
  "machineCode": "SCRW-01",
  "tags": [
    {
      "path": "SCRW-01/spindle/running",
      "dataType": "bool",
      "access": "r",
      "source": { "kind": "simulated" },
      "isBackedByDriver": false
    }
  ]
}
```

`contracts/fixtures/valid/tags-screwdrive-full.json` — chạm mọi nhánh `source` và cả tag ghi:

```json
{
  "schemaVersion": 1,
  "machineCode": "SCRW-01",
  "tags": [
    {
      "path": "SCRW-01/spindle/torque",
      "dataType": "float", "unit": "Nm", "engMin": 0, "engMax": 20,
      "access": "r",
      "source": { "kind": "modbus", "unitId": 1, "register": 40001, "scale": 0.01 },
      "isBackedByDriver": true
    },
    {
      "path": "SCRW-01/spindle/torque-target",
      "dataType": "float", "unit": "Nm", "engMin": 5, "engMax": 15,
      "access": "rw", "policyAction": "machine.setpoint",
      "source": { "kind": "modbus", "unitId": 1, "register": 40010, "scale": 0.01 },
      "isBackedByDriver": true
    },
    {
      "path": "SCRW-01/cell/reset",
      "dataType": "bool",
      "access": "rw", "policyAction": "machine.command",
      "source": { "kind": "opcua", "nodeId": "ns=2;s=Cell.Reset" },
      "isBackedByDriver": true
    },
    {
      "path": "SCRW-01/ambient/temp",
      "dataType": "float", "unit": "°C", "engMin": -10, "engMax": 80,
      "access": "r",
      "source": { "kind": "mqtt", "topic": "syn/site/scrw-01/ambient", "jsonPath": "$.tempC" },
      "isBackedByDriver": true
    },
    {
      "path": "SCRW-01/spindle/state",
      "dataType": "enum", "enumValues": ["stopped", "running", "faulted"],
      "access": "r",
      "source": { "kind": "derived", "expr": "running ? 'running' : 'stopped'" },
      "isBackedByDriver": false
    }
  ]
}
```

`contracts/fixtures/invalid/tags-rw-without-policy-action.json` — vi phạm bất biến §5:

```json
{
  "schemaVersion": 1,
  "machineCode": "SCRW-01",
  "tags": [
    {
      "path": "SCRW-01/spindle/torque-target",
      "dataType": "float", "unit": "Nm", "engMin": 5, "engMax": 15,
      "access": "rw",
      "source": { "kind": "modbus", "unitId": 1, "register": 40010, "scale": 0.01 },
      "isBackedByDriver": true
    }
  ]
}
```

`contracts/fixtures/invalid/tags-float-without-eng-range.json`:

```json
{
  "schemaVersion": 1,
  "machineCode": "SCRW-01",
  "tags": [
    {
      "path": "SCRW-01/spindle/torque",
      "dataType": "float", "unit": "Nm",
      "access": "r",
      "source": { "kind": "simulated" },
      "isBackedByDriver": false
    }
  ]
}
```

- [ ] **Step 4: Kiểm bằng mắt rằng bốn fixture đúng ý định**

Chạy: `node -e "for (const f of ['valid/tags-screwdrive-minimal','valid/tags-screwdrive-full','invalid/tags-rw-without-policy-action','invalid/tags-float-without-eng-range']) { JSON.parse(require('fs').readFileSync('contracts/fixtures/'+f+'.json','utf8')); console.log('parsed ok:', f) }"`

Kỳ vọng: bốn dòng `parsed ok:`. Bước này CHỈ kiểm JSON hợp lệ về cú pháp — **nó không đo schema**; việc đó là Task 2/3. Nói rõ để không đọc quá kết quả xanh này.

- [ ] **Step 5: Commit**

```bash
git add contracts/
git commit -m "contract(hmi): freeze the tag-namespace schema, and encode the no-unpoliced-write rule in it"
```

---

## Task 2: Contract assembly .NET + record tag + test round-trip

**Files:**
- Create: `src/St4i.Hmi.Contracts/St4i.Hmi.Contracts.csproj`
- Create: `src/St4i.Hmi.Contracts/TagNamespaceDocument.cs`
- Create: `tests/St4i.Hmi.Contracts.Tests/St4i.Hmi.Contracts.Tests.csproj`
- Create: `tests/St4i.Hmi.Contracts.Tests/ContractFixtures.cs`
- Create: `tests/St4i.Hmi.Contracts.Tests/TagNamespaceRoundTripTests.cs`
- Modify: `St4iMachineSimulator.sln` (thêm hai project)

**Interfaces:**
- Consumes: `contracts/tag-namespace.schema.json` và `contracts/fixtures/**` từ Task 1.
- Produces:
  - `St4i.Hmi.Contracts.TagNamespaceDocument(int SchemaVersion, string MachineCode, IReadOnlyList<TagDescriptor> Tags)`
  - `St4i.Hmi.Contracts.TagDescriptor(string Path, string DataType, string? Unit, double? EngMin, double? EngMax, IReadOnlyList<string>? EnumValues, string Access, string? PolicyAction, TagSource Source, bool IsBackedByDriver)`
  - `St4i.Hmi.Contracts.TagSource(string Kind, int? UnitId, int? Register, double? Scale, string? NodeId, string? Topic, string? JsonPath, string? Expr)`
  - `St4i.Hmi.Contracts.HmiContractJson.Options` — `JsonSerializerOptions` dùng chung (camelCase, bỏ qua null khi ghi)
  - `ContractFixtures.RepoRelative(string)` → đường dẫn tuyệt đối tới file trong `contracts/`
  - `ContractFixtures.ValidFiles(string prefix)` / `ContractFixtures.InvalidFiles(string prefix)` → danh sách file fixture

- [ ] **Step 1: Viết bài test thất bại — round-trip mọi fixture hợp lệ**

`tests/St4i.Hmi.Contracts.Tests/TagNamespaceRoundTripTests.cs`:

```csharp
using System.Text.Json;
using System.Text.Json.Nodes;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// Mỗi fixture <c>contracts/fixtures/valid/tags-*.json</c> phải đọc được vào
/// <see cref="TagNamespaceDocument"/> rồi ghi ra lại thành JSON <b>tương đương ngữ nghĩa</b> với bản gốc.
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó KHÔNG kiểm fixture có hợp lệ theo JSON Schema hay
/// không — không có bộ validate JSON Schema nào trong cây này (chủ ý: contract assembly zero-dependency),
/// việc "schema từ chối đúng thứ cần từ chối" do <c>TagNamespaceSchemaPinTests</c> đo bằng cách khác;
/// (2) nó KHÔNG chứng minh phía TypeScript đọc cùng fixture ra cùng kết quả — đó là
/// <c>web/contract-tests/contracts.test.mjs</c>; (3) một fixture xanh ở đây KHÔNG có nghĩa driver
/// nào nạp tag ấy thật — cờ <c>isBackedByDriver</c> chỉ là một trường dữ liệu ở tầng này.</para>
/// </summary>
public class TagNamespaceRoundTripTests
{
    public static TheoryData<string> ValidFixtures()
    {
        var data = new TheoryData<string>();
        foreach (var f in ContractFixtures.ValidFiles("tags-")) data.Add(f);
        return data;
    }

    [Theory]
    [MemberData(nameof(ValidFixtures))]
    public void Valid_fixture_round_trips_without_semantic_loss(string fixturePath)
    {
        var original = File.ReadAllText(fixturePath);

        var doc = JsonSerializer.Deserialize<TagNamespaceDocument>(original, HmiContractJson.Options);
        Assert.NotNull(doc);

        var rewritten = JsonSerializer.Serialize(doc, HmiContractJson.Options);

        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(original), JsonNode.Parse(rewritten)),
            $"round-trip changed the document.\nORIGINAL:\n{original}\n\nREWRITTEN:\n{rewritten}");
    }

    [Fact]
    public void Fixture_corpus_is_not_empty()
    {
        // Chống bài test rỗng: một glob hụt sẽ làm mọi [Theory] ở trên biến mất mà vẫn "xanh".
        Assert.NotEmpty(ContractFixtures.ValidFiles("tags-"));
    }
}
```

- [ ] **Step 2: Viết helper định vị fixture**

`tests/St4i.Hmi.Contracts.Tests/ContractFixtures.cs`:

```csharp
namespace St4i.Hmi.Contracts.Tests;

/// <summary>Định vị thư mục <c>contracts/</c> bằng cách đi ngược từ thư mục chạy test lên tới thư mục
/// chứa <c>St4iMachineSimulator.sln</c>. Không hard-code đường dẫn tuyệt đối, và không phụ thuộc vào
/// <c>CopyToOutputDirectory</c> — fixture phải là MỘT bản duy nhất, dùng chung với phía web; sao chép
/// nó vào thư mục build là cách sinh ra bản thứ hai âm thầm lệch đi.</summary>
public static class ContractFixtures
{
    public static string ContractsDir { get; } = Locate();

    static string Locate()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.sln")))
            dir = dir.Parent;
        if (dir is null)
            throw new InvalidOperationException(
                "Không tìm thấy St4iMachineSimulator.sln khi đi ngược từ " + AppContext.BaseDirectory);
        return Path.Combine(dir.FullName, "contracts");
    }

    public static string RepoRelative(string relative) => Path.Combine(ContractsDir, relative);

    public static IReadOnlyList<string> ValidFiles(string prefix) => Files("valid", prefix);
    public static IReadOnlyList<string> InvalidFiles(string prefix) => Files("invalid", prefix);

    static IReadOnlyList<string> Files(string bucket, string prefix) =>
        Directory.EnumerateFiles(Path.Combine(ContractsDir, "fixtures", bucket), prefix + "*.json")
                 .OrderBy(p => p, StringComparer.Ordinal)
                 .ToList();
}
```

- [ ] **Step 3: Tạo hai csproj và thêm vào solution**

`src/St4i.Hmi.Contracts/St4i.Hmi.Contracts.csproj` — **zero PackageReference**, đúng khuôn `St4i.Connector.Abstractions`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <!-- Contract assembly cho HMI Builder. net10.0 THUẦN (không -windows) và ZERO dependency, cùng lý do
       St4i.Connector.Abstractions được làm như vậy: một hợp đồng phải dùng được từ bất kỳ host nào mà
       không kéo theo gì. Đừng thêm PackageReference vào đây. -->
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
  </PropertyGroup>
</Project>
```

`tests/St4i.Hmi.Contracts.Tests/St4i.Hmi.Contracts.Tests.csproj` — sao chép nguyên các `PackageReference` (xunit, runner, Microsoft.NET.Test.Sdk) và `TargetFramework` từ `tests/St4i.Connector.Abstractions.Tests/St4i.Connector.Abstractions.Tests.csproj`, đổi `ProjectReference` sang `../../src/St4i.Hmi.Contracts/St4i.Hmi.Contracts.csproj`.

Thêm vào solution:

```bash
dotnet sln St4iMachineSimulator.sln add src/St4i.Hmi.Contracts/St4i.Hmi.Contracts.csproj
dotnet sln St4iMachineSimulator.sln add tests/St4i.Hmi.Contracts.Tests/St4i.Hmi.Contracts.Tests.csproj
```

- [ ] **Step 4: Chạy test để xác nhận nó ĐỎ**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests`
Kỳ vọng: **lỗi biên dịch** — `TagNamespaceDocument`, `TagDescriptor`, `HmiContractJson` chưa tồn tại. Đây là màu đỏ đúng cần thấy trước khi viết implementation.

- [ ] **Step 5: Viết record**

`src/St4i.Hmi.Contracts/TagNamespaceDocument.cs`:

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.Hmi.Contracts;

/// <summary>Bản sao C# của <c>contracts/tag-namespace.schema.json</c> v1. Mọi property ở đây được ghim
/// đối chiếu HAI CHIỀU với file schema bởi <c>TagNamespaceSchemaPinTests</c> — thêm một property vào một
/// bên mà quên bên kia thì bài test ấy đỏ.</summary>
public sealed record TagNamespaceDocument(
    int SchemaVersion,
    string MachineCode,
    IReadOnlyList<TagDescriptor> Tags);

/// <summary>Một tag trong namespace. <paramref name="PolicyAction"/> là bất biến an toàn §5 viết thành
/// dữ liệu: <c>Access == "rw"</c> BẮT BUỘC có giá trị khác null ở đây, và runtime dùng nó để chọn
/// endpoint (<c>machine.setpoint</c> → Engineer, <c>machine.command</c> → Admin). Ràng buộc ấy được
/// schema thi hành; kiểu C# không tự thi hành được nó, nên đừng đọc "biên dịch được" thành "hợp lệ".</summary>
public sealed record TagDescriptor(
    string Path,
    string DataType,
    string? Unit,
    double? EngMin,
    double? EngMax,
    IReadOnlyList<string>? EnumValues,
    string Access,
    string? PolicyAction,
    TagSource Source,
    bool IsBackedByDriver);

/// <summary>Nguồn của một tag. Đây là một union phẳng: <paramref name="Kind"/> quyết định trường nào có
/// nghĩa (schema dùng <c>oneOf</c> + <c>additionalProperties:false</c> để cấm trộn). Làm phẳng thay vì
/// đa hình vì <c>System.Text.Json</c> phải round-trip được nó mà không cần converter tuỳ biến — và một
/// converter tuỳ biến là đúng thứ hai nhánh song song sẽ hiện thực khác nhau.</summary>
public sealed record TagSource(
    string Kind,
    int? UnitId = null,
    int? Register = null,
    double? Scale = null,
    string? NodeId = null,
    string? Topic = null,
    string? JsonPath = null,
    string? Expr = null);

/// <summary>Cấu hình JSON dùng chung cho MỌI contract HMI. camelCase khớp schema; bỏ null khi ghi để
/// round-trip không thêm trường mà fixture gốc không có.</summary>
public static class HmiContractJson
{
    public static JsonSerializerOptions Options { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
```

- [ ] **Step 6: Chạy test để xác nhận XANH**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests`
Kỳ vọng: PASS, 3 bài (2 theory case + 1 non-vacuity).

Nếu round-trip đỏ vì thứ tự trường: `JsonNode.DeepEquals` **không** phụ thuộc thứ tự property của object, nên đỏ ở đây nghĩa là **giá trị** thật sự khác — đọc diff in ra trong thông điệp assert, đừng nới lỏng bài test.

- [ ] **Step 7: Commit**

```bash
git add src/St4i.Hmi.Contracts tests/St4i.Hmi.Contracts.Tests St4iMachineSimulator.sln
git commit -m "contract(hmi): the C# side of the tag contract, and a round-trip test over the shared corpus"
```

---

## Task 3: Ghim hai chiều schema ⟷ record C# (tag-namespace)

**Files:**
- Create: `tests/St4i.Hmi.Contracts.Tests/SchemaPin.cs`
- Create: `tests/St4i.Hmi.Contracts.Tests/TagNamespaceSchemaPinTests.cs`

**Interfaces:**
- Consumes: `TagNamespaceDocument`, `TagDescriptor`, `TagSource` (Task 2); `ContractFixtures` (Task 2).
- Produces — **Task 4 và Task 5 dùng lại nguyên ba hàm này, đừng viết lại**:
  - `SchemaPin.Load(string schemaFileName)` → `JsonNode` — đọc một file schema trong `contracts/`
  - `SchemaPin.SchemaProps(JsonNode schema, params string[] pointer)` → `IReadOnlyCollection<string>` — tên property khai tại `pointer` (rỗng = gốc)
  - `SchemaPin.RecordProps(Type t)` → `IReadOnlyCollection<string>` — tên property của record, đổi sang camelCase
  - `SchemaPin.AssertSameNames(string label, IReadOnlyCollection<string> inSchema, IReadOnlyCollection<string> inType, ISet<string> exemptions)` — khẳng định hai chiều

- [ ] **Step 1: Viết helper dùng chung**

`tests/St4i.Hmi.Contracts.Tests/SchemaPin.cs`:

```csharp
using System.Text.Json.Nodes;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>Bộ đồ nghề dùng chung cho ba bài ghim schema⟷record (tag namespace · component model ·
/// hmi screen). Tách ra một chỗ vì ba bài ấy phải đo GIỐNG HỆT nhau — ba bản sao chép tay là ba cơ hội
/// để một bài lỏng hơn hai bài kia mà không ai thấy.</summary>
public static class SchemaPin
{
    public static JsonNode Load(string schemaFileName) =>
        JsonNode.Parse(File.ReadAllText(ContractFixtures.RepoRelative(schemaFileName)))!;

    /// <summary>Tên property khai tại <paramref name="pointer"/>. Mảng rỗng = object gốc của schema.</summary>
    public static IReadOnlyCollection<string> SchemaProps(JsonNode schema, params string[] pointer)
    {
        JsonNode node = schema;
        foreach (var seg in pointer) node = node[seg]!;
        return node["properties"]!.AsObject().Select(kv => kv.Key).ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>Tên property của một record, đổi chữ cái đầu thành thường để khớp camelCase của schema.
    /// Khớp với <c>JsonNamingPolicy.CamelCase</c> mà <see cref="HmiContractJson.Options"/> dùng.</summary>
    public static IReadOnlyCollection<string> RecordProps(Type t) =>
        t.GetProperties().Select(p => char.ToLowerInvariant(p.Name[0]) + p.Name[1..])
         .ToHashSet(StringComparer.Ordinal);

    /// <summary>Khẳng định HAI CHIỀU. Thiếu bên nào cũng đỏ, và thông điệp nói rõ thiếu bên nào —
    /// một bài chỉ kiểm một chiều sẽ để lọt đúng nửa số trường hợp drift.</summary>
    public static void AssertSameNames(
        string label,
        IReadOnlyCollection<string> inSchema,
        IReadOnlyCollection<string> inType,
        ISet<string> exemptions)
    {
        var missingFromType = inSchema.Except(inType).OrderBy(s => s, StringComparer.Ordinal).ToList();
        var missingFromSchema = inType.Except(inSchema).Except(exemptions)
                                      .OrderBy(s => s, StringComparer.Ordinal).ToList();

        Assert.True(missingFromType.Count == 0,
            $"{label}: schema khai nhưng kiểu thiếu: {string.Join(", ", missingFromType)}");
        Assert.True(missingFromSchema.Count == 0,
            $"{label}: kiểu khai nhưng schema thiếu: {string.Join(", ", missingFromSchema)}");
    }
}
```

- [ ] **Step 2: Viết bài test thất bại**

`tests/St4i.Hmi.Contracts.Tests/TagNamespaceSchemaPinTests.cs`:

```csharp
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 Đối chiếu HAI CHIỀU giữa <c>contracts/tag-namespace.schema.json</c> và các record C# tương ứng.
/// Đây là cùng khuôn mẫu <c>MachineConfigDesignDocTableTests</c> đã dựng cho bảng §3 của
/// <c>MACHINE_CONFIG_DESIGN.md</c>, và vì cùng một lý do: khi hai thứ phải khớp nhau mà KHÔNG có phép đo
/// nào nối chúng, chúng lệch và không ai biết.
///
/// <para>Ở đây rủi ro cụ thể hơn: hai NHÁNH đang xây song song từ file schema này. Một property thêm vào
/// schema mà quên thêm vào record là một lệch không bao giờ tự lộ ra cho tới khi hai nhánh merge.</para>
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó so TÊN property, không so KIỂU — schema nói
/// <c>engMin</c> là number, bài test này không kiểm C# khai <c>double?</c>; sai kiểu bị round-trip ở
/// <c>TagNamespaceRoundTripTests</c> bắt, nhưng chỉ khi có fixture chạm tới nó; (2) nó KHÔNG đo phía
/// TypeScript — đó là bài tương ứng ở <c>web/contract-tests/</c>, và hai bài phải cùng đỏ khi schema
/// đổi; (3) nó KHÔNG kiểm các ràng buộc <c>allOf</c>/<c>if-then</c> (luật rw→policyAction) — những luật
/// ấy được đo bằng corpus <c>invalid/</c> ở phía web, nơi CÓ bộ validate.</para>
/// </summary>
public class TagNamespaceSchemaPinTests
{
    const string SchemaFile = "tag-namespace.schema.json";

    /// <summary>Property có trong record C# nhưng CỐ Ý không có trong schema. Rỗng ở v1 — và khẳng định
    /// dưới cùng bắt danh sách này phải được cập nhật có ý thức chứ không phình lên âm thầm.</summary>
    static readonly HashSet<string> CSharpOnlyByDesign = new(StringComparer.Ordinal);

    [Theory]
    [InlineData(typeof(TagNamespaceDocument), new string[0])]
    [InlineData(typeof(TagDescriptor), new[] { "$defs", "tag" })]
    public void Schema_and_record_declare_the_same_property_names(Type recordType, string[] pointer)
    {
        SchemaPin.AssertSameNames(
            recordType.Name,
            SchemaPin.SchemaProps(SchemaPin.Load(SchemaFile), pointer),
            SchemaPin.RecordProps(recordType),
            CSharpOnlyByDesign);
    }

    [Fact]
    public void TagSource_covers_every_source_kind_and_every_branch_field_the_schema_allows()
    {
        var oneOf = SchemaPin.Load(SchemaFile)["$defs"]!["source"]!["oneOf"]!.AsArray();

        var kinds = oneOf.Select(v => v!["properties"]!["kind"]!["const"]!.GetValue<string>())
                         .ToHashSet(StringComparer.Ordinal);

        // Mọi trường của các nhánh oneOf gộp lại phải nằm trong TagSource phẳng.
        var allBranchProps = oneOf.SelectMany(v => v!["properties"]!.AsObject().Select(kv => kv.Key))
                                  .ToHashSet(StringComparer.Ordinal);

        var flat = SchemaPin.RecordProps(typeof(TagSource));
        var missing = allBranchProps.Except(flat).OrderBy(s => s, StringComparer.Ordinal).ToList();

        Assert.True(missing.Count == 0, $"TagSource thiếu trường của nhánh oneOf: {string.Join(", ", missing)}");
        Assert.Equal(5, kinds.Count); // modbus, opcua, mqtt, simulated, derived
    }

    [Fact]
    public void Exemption_list_is_not_stale()
    {
        // Một mục miễn trừ không còn tồn tại trong record là dấu hiệu danh sách đã cũ và đang che một
        // drift thật. Cùng khẳng định "non-vacuity" mà MachineConfigDesignDocTableTests đã dựng.
        var all = SchemaPin.RecordProps(typeof(TagNamespaceDocument))
                           .Concat(SchemaPin.RecordProps(typeof(TagDescriptor)))
                           .ToHashSet(StringComparer.Ordinal);
        var stale = CSharpOnlyByDesign.Except(all).ToList();
        Assert.True(stale.Count == 0, $"mục miễn trừ đã cũ: {string.Join(", ", stale)}");
    }
}
```

- [ ] **Step 3: Chạy để xác nhận ĐỎ trước**

Trước khi chạy, **cố ý** đổi `contracts/tag-namespace.schema.json`: đổi tên property `unit` thành `units` trong `$defs/tag/properties`.

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests --filter TagNamespaceSchemaPinTests`
Kỳ vọng: FAIL với `TagDescriptor: schema khai nhưng record thiếu: units` **và** `record khai nhưng schema thiếu: unit`. Đỏ theo **cả hai chiều** — đó là điều cần thấy.

- [ ] **Step 4: Hoàn nguyên schema và chạy lại**

Đổi `units` về `unit`.

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests`
Kỳ vọng: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add tests/St4i.Hmi.Contracts.Tests/SchemaPin.cs tests/St4i.Hmi.Contracts.Tests/TagNamespaceSchemaPinTests.cs
git commit -m "test(contract): pin schema and record to each other, in both directions, with a non-vacuity check"
```

---

## Task 4: Schema mô hình linh kiện + record + test

**Files:**
- Create: `contracts/component-model.schema.json`
- Create: `contracts/fixtures/valid/components-screwdrive-cell.json`
- Create: `contracts/fixtures/invalid/components-writable-tag-without-policy-action.json`
- Create: `src/St4i.Hmi.Contracts/ComponentModelDocument.cs`
- Create: `tests/St4i.Hmi.Contracts.Tests/ComponentModelRoundTripTests.cs`
- Create: `tests/St4i.Hmi.Contracts.Tests/ComponentModelSchemaPinTests.cs`

**Interfaces:**
- Consumes: `HmiContractJson.Options`, `ContractFixtures` (Task 2).
- Produces:
  - `ComponentModelDocument(int SchemaVersion, string MachineCode, IReadOnlyList<ComponentNode> Components, IReadOnlyList<ComponentTypeDef> Types)`
  - `ComponentNode(string Id, string TypeId, string Label, string? ParentId, string TagPrefix)`
  - `ComponentTypeDef(string TypeId, string Label, IReadOnlyList<ComponentTagDef> Tags, IReadOnlyList<ComponentStateDef> States, string DefaultFaceplate)`
  - `ComponentTagDef(string Name, string Role, string DataType, string? Unit, double? Min, double? Max, string? PolicyAction)`
  - `ComponentStateDef(string Name, string Expr, string Tone)`

- [ ] **Step 1: Viết `contracts/component-model.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://st4i.local/contracts/component-model/v1",
  "title": "St4i Component Model",
  "type": "object",
  "required": ["schemaVersion", "machineCode", "components", "types"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "const": 1 },
    "machineCode": { "type": "string", "minLength": 1 },
    "components": { "type": "array", "items": { "$ref": "#/$defs/component" } },
    "types": { "type": "array", "items": { "$ref": "#/$defs/componentType" } }
  },
  "$defs": {
    "component": {
      "type": "object",
      "required": ["id", "typeId", "label", "tagPrefix"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "typeId": { "type": "string", "pattern": "^[a-z0-9]+(\\.[a-z0-9]+)+$" },
        "label": { "type": "string", "minLength": 1 },
        "parentId": { "type": ["string", "null"] },
        "tagPrefix": { "type": "string", "minLength": 1 }
      }
    },
    "componentType": {
      "type": "object",
      "required": ["typeId", "label", "tags", "states", "defaultFaceplate"],
      "additionalProperties": false,
      "properties": {
        "typeId": { "type": "string", "pattern": "^[a-z0-9]+(\\.[a-z0-9]+)+$" },
        "label": { "type": "string", "minLength": 1 },
        "tags": { "type": "array", "items": { "$ref": "#/$defs/componentTag" } },
        "states": { "type": "array", "items": { "$ref": "#/$defs/componentState" } },
        "defaultFaceplate": { "type": "string", "minLength": 1 }
      }
    },
    "componentTag": {
      "type": "object",
      "required": ["name", "role", "dataType"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "role": { "enum": ["in", "out", "setpoint", "command"] },
        "dataType": { "enum": ["bool", "int", "float", "string", "enum"] },
        "unit": { "type": ["string", "null"] },
        "min": { "type": ["number", "null"] },
        "max": { "type": ["number", "null"] },
        "policyAction": { "enum": [null, "machine.setpoint", "machine.command"] }
      },
      "allOf": [
        {
          "if": { "properties": { "role": { "enum": ["setpoint", "command"] } }, "required": ["role"] },
          "then": { "properties": { "policyAction": { "type": "string" } }, "required": ["policyAction"] }
        },
        {
          "if": { "properties": { "role": { "const": "setpoint" } }, "required": ["role"] },
          "then": {
            "properties": { "min": { "type": "number" }, "max": { "type": "number" } },
            "required": ["min", "max"]
          }
        }
      ]
    },
    "componentState": {
      "type": "object",
      "required": ["name", "expr", "tone"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "expr": { "type": "string", "minLength": 1 },
        "tone": { "enum": ["run", "warn", "fault", "idle"] }
      }
    }
  }
}
```

Chú ý hai luật `allOf`: `role: setpoint|command` bắt buộc `policyAction` (bất biến §5 lặp lại ở tầng type), và `role: setpoint` bắt buộc `min`/`max` — đúng nguyên tắc *"chặn cứng min/max là bắt buộc, không phải trang trí"* của `MACHINE_CONFIG_DESIGN.md §3`.

- [ ] **Step 2: Viết hai fixture**

`contracts/fixtures/valid/components-screwdrive-cell.json`:

```json
{
  "schemaVersion": 1,
  "machineCode": "SCRW-01",
  "types": [
    {
      "typeId": "st4i.motor.spindle",
      "label": "Trục vít / Spindle",
      "defaultFaceplate": "fp.motor.spindle",
      "tags": [
        { "name": "running", "role": "in", "dataType": "bool" },
        { "name": "torque", "role": "in", "dataType": "float", "unit": "Nm", "min": 0, "max": 20 },
        { "name": "torque-target", "role": "setpoint", "dataType": "float", "unit": "Nm",
          "min": 5, "max": 15, "policyAction": "machine.setpoint" },
        { "name": "reset", "role": "command", "dataType": "bool", "policyAction": "machine.command" }
      ],
      "states": [
        { "name": "running", "expr": "running == true", "tone": "run" },
        { "name": "stopped", "expr": "running == false", "tone": "idle" }
      ]
    },
    {
      "typeId": "st4i.sensor.temp",
      "label": "Cảm biến nhiệt / Temperature sensor",
      "defaultFaceplate": "fp.sensor.analog",
      "tags": [
        { "name": "value", "role": "in", "dataType": "float", "unit": "°C", "min": -10, "max": 80 }
      ],
      "states": [{ "name": "ok", "expr": "value < 70", "tone": "run" },
                 { "name": "hot", "expr": "value >= 70", "tone": "warn" }]
    }
  ],
  "components": [
    { "id": "spindle", "typeId": "st4i.motor.spindle", "label": "Trục vít chính",
      "parentId": null, "tagPrefix": "SCRW-01/spindle" },
    { "id": "ambient", "typeId": "st4i.sensor.temp", "label": "Nhiệt độ buồng máy",
      "parentId": null, "tagPrefix": "SCRW-01/ambient" }
  ]
}
```

`contracts/fixtures/invalid/components-writable-tag-without-policy-action.json` — giống fixture trên nhưng bỏ `policyAction` khỏi tag `torque-target`. Chép nguyên file hợp lệ, xoá đúng một cặp khoá-giá trị `"policyAction": "machine.setpoint",` ở tag `torque-target`, giữ mọi thứ khác y hệt.

- [ ] **Step 3: Viết bài test round-trip thất bại**

`tests/St4i.Hmi.Contracts.Tests/ComponentModelRoundTripTests.cs`:

```csharp
using System.Text.Json;
using System.Text.Json.Nodes;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// Mỗi fixture <c>contracts/fixtures/valid/components-*.json</c> phải đọc được vào
/// <see cref="ComponentModelDocument"/> rồi ghi ra lại thành JSON <b>tương đương ngữ nghĩa</b> với bản gốc.
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó KHÔNG kiểm <c>parentId</c> trỏ tới một component
/// có thật, cũng không kiểm cây có chu trình — toàn vẹn cây là việc của tầng lưu trữ ở WS-HMI-0, không
/// phải của tầng hợp đồng; (2) nó KHÔNG kiểm <c>tagPrefix</c> khớp với bất kỳ tag nào trong tag
/// namespace — hai document là hai hợp đồng độc lập, và việc nối chúng là runtime; (3) nó KHÔNG kiểm
/// <c>expr</c> của một state có phân tích cú pháp được — bộ đánh giá biểu thức thuộc WS-HMI-1;
/// (4) nó KHÔNG kiểm ràng buộc <c>allOf</c> (setpoint phải có min/max và policyAction) — corpus
/// <c>invalid/</c> ở phía web đo việc đó, nơi CÓ bộ validate.</para>
/// </summary>
public class ComponentModelRoundTripTests
{
    public static TheoryData<string> ValidFixtures()
    {
        var data = new TheoryData<string>();
        foreach (var f in ContractFixtures.ValidFiles("components-")) data.Add(f);
        return data;
    }

    [Theory]
    [MemberData(nameof(ValidFixtures))]
    public void Valid_fixture_round_trips_without_semantic_loss(string fixturePath)
    {
        var original = File.ReadAllText(fixturePath);

        var doc = JsonSerializer.Deserialize<ComponentModelDocument>(original, HmiContractJson.Options);
        Assert.NotNull(doc);

        var rewritten = JsonSerializer.Serialize(doc, HmiContractJson.Options);

        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(original), JsonNode.Parse(rewritten)),
            $"round-trip changed the document.\nORIGINAL:\n{original}\n\nREWRITTEN:\n{rewritten}");
    }

    [Fact]
    public void Fixture_corpus_is_not_empty()
    {
        // Chống bài test rỗng: một glob hụt sẽ làm mọi [Theory] ở trên biến mất mà vẫn "xanh".
        Assert.NotEmpty(ContractFixtures.ValidFiles("components-"));
    }
}
```

- [ ] **Step 4: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests --filter ComponentModel`
Kỳ vọng: lỗi biên dịch — `ComponentModelDocument` chưa tồn tại.

- [ ] **Step 5: Viết record**

`src/St4i.Hmi.Contracts/ComponentModelDocument.cs`:

```csharp
namespace St4i.Hmi.Contracts;

/// <summary>Bản sao C# của <c>contracts/component-model.schema.json</c> v1. Ghim hai chiều bởi
/// <c>ComponentModelSchemaPinTests</c>.</summary>
public sealed record ComponentModelDocument(
    int SchemaVersion,
    string MachineCode,
    IReadOnlyList<ComponentNode> Components,
    IReadOnlyList<ComponentTypeDef> Types);

/// <summary>Một linh kiện cụ thể trên một máy cụ thể. <paramref name="TagPrefix"/> là thứ biến một
/// faceplate dùng chung thành một instance: binding trong màn hình viết <c>{component}/torque</c>, runtime
/// thay <c>{component}</c> bằng giá trị này. Đây là cơ chế indirect binding của §3.3 — không có nó thì
/// "sinh màn hình theo linh kiện" biến thành copy-paste.</summary>
public sealed record ComponentNode(
    string Id, string TypeId, string Label, string? ParentId, string TagPrefix);

/// <summary>Định nghĩa một KIỂU linh kiện — vai trò "UDT" trong mô hình này. Khai một lần, dùng N lần.</summary>
public sealed record ComponentTypeDef(
    string TypeId,
    string Label,
    IReadOnlyList<ComponentTagDef> Tags,
    IReadOnlyList<ComponentStateDef> States,
    string DefaultFaceplate);

/// <summary>Tag khai báo của một kiểu linh kiện. <paramref name="Min"/>/<paramref name="Max"/> là dải chặn
/// CỨNG cho <c>role == "setpoint"</c> — schema bắt buộc chúng, vì đây là giao diện vận hành máy công
/// nghiệp và không được để nhập giá trị ngoài dải an toàn (nguyên tắc của MACHINE_CONFIG_DESIGN.md §3).</summary>
public sealed record ComponentTagDef(
    string Name, string Role, string DataType, string? Unit,
    double? Min, double? Max, string? PolicyAction);

/// <summary>Một trạng thái hiển thị được của linh kiện. <paramref name="Tone"/> ánh xạ vào bậc trạng thái
/// run/warn/fault/idle — KHÔNG phải màu tuỳ ý; theme quyết định màu, và ISA-101 quy định màu chỉ xuất hiện
/// khi bất thường (§6).</summary>
public sealed record ComponentStateDef(string Name, string Expr, string Tone);
```

- [ ] **Step 6: Chạy round-trip, xác nhận XANH**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests --filter ComponentModel`
Kỳ vọng: PASS.

- [ ] **Step 7: Viết bài ghim hai chiều**

`tests/St4i.Hmi.Contracts.Tests/ComponentModelSchemaPinTests.cs`:

```csharp
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 Đối chiếu HAI CHIỀU giữa <c>contracts/component-model.schema.json</c> và các record C# tương ứng,
/// bằng đúng bộ đồ nghề <see cref="SchemaPin"/> mà <c>TagNamespaceSchemaPinTests</c> dùng.
///
/// <para><b>KHÔNG đo cái gì:</b> so TÊN property, không so kiểu; không đo phía TypeScript (bài tương ứng
/// ở <c>web/contract-tests/</c>); không kiểm các luật <c>allOf</c> (setpoint ⇒ min/max + policyAction) —
/// corpus <c>invalid/</c> phía web đo việc đó.</para>
/// </summary>
public class ComponentModelSchemaPinTests
{
    const string SchemaFile = "component-model.schema.json";

    /// <summary>Property có trong record C# nhưng CỐ Ý không có trong schema. Rỗng ở v1.</summary>
    static readonly HashSet<string> CSharpOnlyByDesign = new(StringComparer.Ordinal);

    [Theory]
    [InlineData(typeof(ComponentModelDocument), new string[0])]
    [InlineData(typeof(ComponentNode), new[] { "$defs", "component" })]
    [InlineData(typeof(ComponentTypeDef), new[] { "$defs", "componentType" })]
    [InlineData(typeof(ComponentTagDef), new[] { "$defs", "componentTag" })]
    [InlineData(typeof(ComponentStateDef), new[] { "$defs", "componentState" })]
    public void Schema_and_record_declare_the_same_property_names(Type recordType, string[] pointer)
    {
        SchemaPin.AssertSameNames(
            recordType.Name,
            SchemaPin.SchemaProps(SchemaPin.Load(SchemaFile), pointer),
            SchemaPin.RecordProps(recordType),
            CSharpOnlyByDesign);
    }

    [Fact]
    public void Every_writable_role_is_covered_by_the_policy_action_rule()
    {
        // 🔴 Bất biến §5 ở tầng kiểu linh kiện. Nếu ai đó thêm một `role` ghi được thứ ba vào enum mà
        // không đưa nó vào luật allOf, bài này đỏ — thay vì lặng lẽ mở một đường ghi không gác.
        var schema = SchemaPin.Load(SchemaFile);
        var roles = schema["$defs"]!["componentTag"]!["properties"]!["role"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
        var guarded = schema["$defs"]!["componentTag"]!["allOf"]!.AsArray()[0]!
            ["if"]!["properties"]!["role"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).OrderBy(s => s, StringComparer.Ordinal).ToList();

        Assert.Equal(new[] { "command", "setpoint" }, guarded);
        Assert.All(guarded, r => Assert.Contains(r, roles));
        Assert.Equal(4, roles.Count); // in, out, setpoint, command
    }

    [Fact]
    public void Exemption_list_is_not_stale()
    {
        var all = new[]
            {
                typeof(ComponentModelDocument), typeof(ComponentNode), typeof(ComponentTypeDef),
                typeof(ComponentTagDef), typeof(ComponentStateDef),
            }
            .SelectMany(SchemaPin.RecordProps).ToHashSet(StringComparer.Ordinal);
        var stale = CSharpOnlyByDesign.Except(all).ToList();
        Assert.True(stale.Count == 0, $"mục miễn trừ đã cũ: {string.Join(", ", stale)}");
    }
}
```

- [ ] **Step 8: Chạy toàn project, xác nhận XANH**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests`
Kỳ vọng: PASS toàn bộ.

- [ ] **Step 9: Commit**

```bash
git add contracts src/St4i.Hmi.Contracts/ComponentModelDocument.cs tests/St4i.Hmi.Contracts.Tests
git commit -m "contract(hmi): the component model, where a setpoint without a hard band is not expressible"
```

---

## Task 5: Schema màn hình HMI + record + test

**Files:**
- Create: `contracts/hmi-screen.schema.json`
- Create: `contracts/fixtures/valid/screen-overview-minimal.json`
- Create: `contracts/fixtures/valid/screen-screwdrive-full.json`
- Create: `contracts/fixtures/invalid/screen-write-widget-without-policy-action.json`
- Create: `src/St4i.Hmi.Contracts/HmiScreenDocument.cs`
- Create: `tests/St4i.Hmi.Contracts.Tests/HmiScreenRoundTripTests.cs`
- Create: `tests/St4i.Hmi.Contracts.Tests/HmiScreenSchemaPinTests.cs`

**Interfaces:**
- Consumes: `HmiContractJson.Options`, `ContractFixtures`.
- Produces:
  - `HmiScreenDocument(int SchemaVersion, string ScreenId, string Title, string? TitleEn, string Theme, ScreenLayout Layout, IReadOnlyList<ScreenWidget> Widgets)`
  - `ScreenLayout(int Cols, int Rows, string Breakpoint)`
  - `ScreenWidget(string Id, string Kind, WidgetRect Rect, string? Component, IReadOnlyDictionary<string, string>? Bindings, IReadOnlyDictionary<string, JsonElement>? Props, string? PolicyAction)`
  - `WidgetRect(int Col, int Row, int ColSpan, int RowSpan)`

- [ ] **Step 1: Viết `contracts/hmi-screen.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://st4i.local/contracts/hmi-screen/v1",
  "title": "St4i HMI Screen",
  "type": "object",
  "required": ["schemaVersion", "screenId", "title", "theme", "layout", "widgets"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "const": 1 },
    "screenId": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "title": { "type": "string", "minLength": 1 },
    "titleEn": { "type": ["string", "null"] },
    "theme": { "enum": ["isa101", "blueprint"] },
    "layout": { "$ref": "#/$defs/layout" },
    "widgets": { "type": "array", "items": { "$ref": "#/$defs/widget" } }
  },
  "$defs": {
    "layout": {
      "type": "object",
      "required": ["cols", "rows", "breakpoint"],
      "additionalProperties": false,
      "properties": {
        "cols": { "type": "integer", "minimum": 1, "maximum": 48 },
        "rows": { "type": "integer", "minimum": 1, "maximum": 48 },
        "breakpoint": { "enum": ["panel", "tablet", "phone"] }
      }
    },
    "rect": {
      "type": "object",
      "required": ["col", "row", "colSpan", "rowSpan"],
      "additionalProperties": false,
      "properties": {
        "col": { "type": "integer", "minimum": 0 },
        "row": { "type": "integer", "minimum": 0 },
        "colSpan": { "type": "integer", "minimum": 1 },
        "rowSpan": { "type": "integer", "minimum": 1 }
      }
    },
    "widget": {
      "type": "object",
      "required": ["id", "kind", "rect"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "kind": {
          "enum": [
            "readout", "status-lamp", "gauge", "trend", "alarm-banner", "alarm-list",
            "log", "faceplate", "label", "sheet", "kpi-tile", "state-badge",
            "setpoint-input", "command-button", "line-state"
          ]
        },
        "rect": { "$ref": "#/$defs/rect" },
        "component": { "type": ["string", "null"] },
        "bindings": { "type": ["object", "null"], "additionalProperties": { "type": "string" } },
        "props": { "type": ["object", "null"] },
        "policyAction": { "enum": [null, "machine.setpoint", "machine.command"] }
      },
      "allOf": [
        {
          "if": {
            "properties": { "kind": { "enum": ["setpoint-input", "command-button"] } },
            "required": ["kind"]
          },
          "then": { "properties": { "policyAction": { "type": "string" } }, "required": ["policyAction"] }
        }
      ]
    }
  }
}
```

> 🔴 **Luật `allOf` ở đây là bất biến §5 viết thành schema:** hai `kind` duy nhất có thể ghi (`setpoint-input`, `command-button`) **không thể tồn tại** mà thiếu `policyAction`. Builder không thể sinh ra một widget ghi không gác vì schema không diễn đạt được widget đó. Đây là ý nghĩa của câu *"builder không có cách nào tạo widget bỏ qua bước này"* trong spec §5.1.

- [ ] **Step 2: Viết ba fixture**

`contracts/fixtures/valid/screen-overview-minimal.json`:

```json
{
  "schemaVersion": 1,
  "screenId": "overview",
  "title": "Tổng quan",
  "titleEn": "OVERVIEW",
  "theme": "isa101",
  "layout": { "cols": 12, "rows": 8, "breakpoint": "panel" },
  "widgets": [
    {
      "id": "state",
      "kind": "status-lamp",
      "rect": { "col": 0, "row": 0, "colSpan": 3, "rowSpan": 1 },
      "bindings": { "state": "SCRW-01/spindle/state" }
    }
  ]
}
```

`contracts/fixtures/valid/screen-screwdrive-full.json` — chạm mọi thứ quan trọng: faceplate với indirect binding, tag ghi cả hai loại, trend, alarm:

```json
{
  "schemaVersion": 1,
  "screenId": "screwdrive-cell",
  "title": "Trạm bắt vít",
  "titleEn": "SCREWDRIVING CELL",
  "theme": "isa101",
  "layout": { "cols": 12, "rows": 10, "breakpoint": "panel" },
  "widgets": [
    { "id": "alarms", "kind": "alarm-banner",
      "rect": { "col": 0, "row": 0, "colSpan": 12, "rowSpan": 1 } },
    { "id": "spindle-fp", "kind": "faceplate",
      "rect": { "col": 0, "row": 1, "colSpan": 4, "rowSpan": 4 },
      "component": "spindle",
      "props": { "faceplate": "fp.motor.spindle" } },
    { "id": "torque", "kind": "readout",
      "rect": { "col": 4, "row": 1, "colSpan": 3, "rowSpan": 2 },
      "component": "spindle",
      "bindings": { "value": "{component}/torque" },
      "props": { "label": "Mô-men", "labelEn": "TORQUE" } },
    { "id": "torque-trend", "kind": "trend",
      "rect": { "col": 7, "row": 1, "colSpan": 5, "rowSpan": 4 },
      "bindings": { "series": "SCRW-01/spindle/torque" } },
    { "id": "torque-sp", "kind": "setpoint-input",
      "rect": { "col": 4, "row": 3, "colSpan": 3, "rowSpan": 2 },
      "component": "spindle",
      "bindings": { "value": "{component}/torque-target" },
      "policyAction": "machine.setpoint" },
    { "id": "reset", "kind": "command-button",
      "rect": { "col": 0, "row": 5, "colSpan": 2, "rowSpan": 1 },
      "component": "spindle",
      "bindings": { "value": "{component}/reset" },
      "policyAction": "machine.command",
      "props": { "label": "Đặt lại", "labelEn": "RESET" } },
    { "id": "log", "kind": "log",
      "rect": { "col": 0, "row": 6, "colSpan": 12, "rowSpan": 4 } }
  ]
}
```

`contracts/fixtures/invalid/screen-write-widget-without-policy-action.json` — chép `screen-overview-minimal.json`, đổi widget duy nhất thành:

```json
{
  "id": "torque-sp",
  "kind": "setpoint-input",
  "rect": { "col": 0, "row": 0, "colSpan": 3, "rowSpan": 1 },
  "bindings": { "value": "SCRW-01/spindle/torque-target" }
}
```

- [ ] **Step 3: Viết round-trip test thất bại**

`tests/St4i.Hmi.Contracts.Tests/HmiScreenRoundTripTests.cs`:

```csharp
using System.Text.Json;
using System.Text.Json.Nodes;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// Mỗi fixture <c>contracts/fixtures/valid/screen-*.json</c> phải đọc được vào
/// <see cref="HmiScreenDocument"/> rồi ghi ra lại thành JSON <b>tương đương ngữ nghĩa</b> với bản gốc.
/// Đây là bài chứng minh một màn hình lưu hôm nay đọc lại được nguyên vẹn — nếu nó đỏ, mọi màn hình
/// khách đã thiết kế đều đang có nguy cơ mất dữ liệu khi tải lại.
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) nó KHÔNG kiểm <c>bindings</c> trỏ tới một tag có thật,
/// cũng không kiểm <c>component</c> trỏ tới một linh kiện có thật — hai việc ấy cần cả tag namespace lẫn
/// component model, và là việc của runtime WS-HMI-1; (2) nó KHÔNG kiểm các widget có chồng lấn ô lưới —
/// editor WS-HMI-2 lo việc đó; (3) nó KHÔNG kiểm bất kỳ luật ISA-101 nào (màu, tương phản, vùng chạm) —
/// linter §6 là WS-HMI-4; (4) nó KHÔNG kiểm <c>props</c> có đúng hình dạng cho <c>kind</c> tương ứng —
/// <c>props</c> cố tình để mở ở tầng hợp đồng, xem ghi chú ở Step 6.</para>
/// </summary>
public class HmiScreenRoundTripTests
{
    public static TheoryData<string> ValidFixtures()
    {
        var data = new TheoryData<string>();
        foreach (var f in ContractFixtures.ValidFiles("screen-")) data.Add(f);
        return data;
    }

    [Theory]
    [MemberData(nameof(ValidFixtures))]
    public void Valid_fixture_round_trips_without_semantic_loss(string fixturePath)
    {
        var original = File.ReadAllText(fixturePath);

        var doc = JsonSerializer.Deserialize<HmiScreenDocument>(original, HmiContractJson.Options);
        Assert.NotNull(doc);

        var rewritten = JsonSerializer.Serialize(doc, HmiContractJson.Options);

        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(original), JsonNode.Parse(rewritten)),
            $"round-trip changed the document.\nORIGINAL:\n{original}\n\nREWRITTEN:\n{rewritten}");
    }

    [Fact]
    public void Fixture_corpus_is_not_empty()
    {
        // Chống bài test rỗng: một glob hụt sẽ làm mọi [Theory] ở trên biến mất mà vẫn "xanh".
        Assert.NotEmpty(ContractFixtures.ValidFiles("screen-"));
    }
}
```

- [ ] **Step 4: Chạy để xác nhận ĐỎ**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests --filter HmiScreen`
Kỳ vọng: lỗi biên dịch.

- [ ] **Step 5: Viết record**

`src/St4i.Hmi.Contracts/HmiScreenDocument.cs`:

```csharp
using System.Text.Json;

namespace St4i.Hmi.Contracts;

/// <summary>Bản sao C# của <c>contracts/hmi-screen.schema.json</c> v1 — một màn hình HMI do builder tạo
/// ra, do runtime đọc. Ghim hai chiều bởi <c>HmiScreenSchemaPinTests</c>.</summary>
public sealed record HmiScreenDocument(
    int SchemaVersion,
    string ScreenId,
    string Title,
    string? TitleEn,
    string Theme,
    ScreenLayout Layout,
    IReadOnlyList<ScreenWidget> Widgets);

/// <summary>Lưới đặt widget. Lưới cố định theo breakpoint chứ không toạ độ pixel tự do — đây là quyết định
/// có chủ ý: toạ độ tự do làm màn hình vỡ khi đổi kích thước, và ISA-101 nói về khả năng đọc được của
/// người vận hành, không về tự do đồ hoạ của người thiết kế.</summary>
public sealed record ScreenLayout(int Cols, int Rows, string Breakpoint);

/// <summary>Một widget. <paramref name="Component"/> khác null bật indirect binding: mọi chuỗi
/// <c>{component}</c> trong <paramref name="Bindings"/> được thay bằng <c>TagPrefix</c> của linh kiện đó
/// lúc chạy, nên MỘT faceplate phục vụ N instance.
///
/// <para><paramref name="PolicyAction"/> là bất biến §5: schema BẮT BUỘC nó khác null với
/// <c>kind == "setpoint-input"</c> hoặc <c>"command-button"</c>. Kiểu C# không tự thi hành được ràng buộc
/// ấy — schema thi hành, và fixture <c>invalid/screen-write-widget-without-policy-action.json</c> là bằng
/// chứng luật ấy thật sự chặn. Đừng đọc "biên dịch được" thành "gác được".</para></summary>
public sealed record ScreenWidget(
    string Id,
    string Kind,
    WidgetRect Rect,
    string? Component = null,
    IReadOnlyDictionary<string, string>? Bindings = null,
    IReadOnlyDictionary<string, JsonElement>? Props = null,
    string? PolicyAction = null);

/// <summary>Ô trên lưới của <see cref="ScreenLayout"/>. Gốc toạ độ (0,0) ở góc trên-trái.</summary>
public sealed record WidgetRect(int Col, int Row, int ColSpan, int RowSpan);
```

- [ ] **Step 6: Chạy round-trip, xác nhận XANH**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests --filter HmiScreen`
Kỳ vọng: PASS.

Nếu đỏ ở fixture `screen-screwdrive-full.json` vì `props`: `JsonElement` round-trip giữ nguyên object thô, đó là chủ ý — `props` cố tình **không** có schema chặt, vì mỗi `kind` widget có bộ prop riêng và ràng buộc chúng ở tầng này sẽ khiến mọi widget mới phải sửa hợp đồng. Ràng buộc prop theo `kind` là việc của runtime (WS-HMI-1).

- [ ] **Step 7: Viết bài ghim hai chiều**

`tests/St4i.Hmi.Contracts.Tests/HmiScreenSchemaPinTests.cs`:

```csharp
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.Hmi.Contracts.Tests;

/// <summary>
/// 🔴 Đối chiếu HAI CHIỀU giữa <c>contracts/hmi-screen.schema.json</c> và các record C# tương ứng, cộng
/// một bài ghim riêng cho danh sách <c>kind</c> — vì <c>kind</c> là chỗ bất biến §5 sống.
///
/// <para><b>KHÔNG đo cái gì:</b> so TÊN property, không so kiểu; không đo phía TypeScript; không kiểm
/// luật <c>allOf</c> có thật sự CHẶN hay không (đó là corpus <c>invalid/</c> phía web) — bài dưới chỉ
/// kiểm luật ấy PHỦ ĐÚNG tập kind ghi được.</para>
/// </summary>
public class HmiScreenSchemaPinTests
{
    const string SchemaFile = "hmi-screen.schema.json";

    /// <summary>Property có trong record C# nhưng CỐ Ý không có trong schema. Rỗng ở v1.</summary>
    static readonly HashSet<string> CSharpOnlyByDesign = new(StringComparer.Ordinal);

    [Theory]
    [InlineData(typeof(HmiScreenDocument), new string[0])]
    [InlineData(typeof(ScreenLayout), new[] { "$defs", "layout" })]
    [InlineData(typeof(ScreenWidget), new[] { "$defs", "widget" })]
    [InlineData(typeof(WidgetRect), new[] { "$defs", "rect" })]
    public void Schema_and_record_declare_the_same_property_names(Type recordType, string[] pointer)
    {
        SchemaPin.AssertSameNames(
            recordType.Name,
            SchemaPin.SchemaProps(SchemaPin.Load(SchemaFile), pointer),
            SchemaPin.RecordProps(recordType),
            CSharpOnlyByDesign);
    }

    [Fact]
    public void Every_widget_kind_is_declared_once_and_the_writable_ones_are_exactly_two()
    {
        var schema = SchemaPin.Load(SchemaFile);
        var kinds = schema["$defs"]!["widget"]!["properties"]!["kind"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).ToList();

        Assert.Equal(kinds.Count, kinds.Distinct(StringComparer.Ordinal).Count());

        // 🔴 Bất biến §5. Nếu ai đó thêm một kind ghi được thứ ba, bài này đỏ và buộc họ đọc §5 trước khi
        // đi tiếp — thay vì thêm một đường ghi mà luật allOf không phủ.
        var writable = schema["$defs"]!["widget"]!["allOf"]!.AsArray()[0]!
            ["if"]!["properties"]!["kind"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>()).OrderBy(s => s, StringComparer.Ordinal).ToList();
        Assert.Equal(new[] { "command-button", "setpoint-input" }, writable);
        Assert.All(writable, k => Assert.Contains(k, kinds));
    }

    [Fact]
    public void Exemption_list_is_not_stale()
    {
        var all = new[]
            {
                typeof(HmiScreenDocument), typeof(ScreenLayout), typeof(ScreenWidget), typeof(WidgetRect),
            }
            .SelectMany(SchemaPin.RecordProps).ToHashSet(StringComparer.Ordinal);
        var stale = CSharpOnlyByDesign.Except(all).ToList();
        Assert.True(stale.Count == 0, $"mục miễn trừ đã cũ: {string.Join(", ", stale)}");
    }
}
```

- [ ] **Step 8: Chạy toàn project, xác nhận XANH**

Chạy: `dotnet test tests/St4i.Hmi.Contracts.Tests`
Kỳ vọng: PASS toàn bộ.

- [ ] **Step 9: Commit**

```bash
git add contracts src/St4i.Hmi.Contracts/HmiScreenDocument.cs tests/St4i.Hmi.Contracts.Tests
git commit -m "contract(hmi): the screen schema, in which an unpoliced write widget is not expressible"
```

---

## Task 6: Phía web — type TypeScript + validate + ghim hai chiều

**Files:**
- Create: `web/src/contracts/tagNamespace.ts`
- Create: `web/src/contracts/componentModel.ts`
- Create: `web/src/contracts/hmiScreen.ts`
- Create: `web/src/contracts/index.ts`
- Create: `web/contract-tests/validate.mjs`
- Create: `web/contract-tests/contracts.test.mjs`
- Modify: `web/package.json` (thêm script `test:contracts`)

> 🔴 **Vì sao `web/contract-tests/` chứ KHÔNG phải `web/tests/contracts/`:** `web/playwright.config.ts:31` đặt `testDir: "./tests"`, và `testMatch` mặc định của Playwright là `**/*.@(spec|test).?(c|m)[jt]s?(x)` — khớp cả `contracts.test.mjs`. Đặt bài test Node vào `web/tests/` sẽ khiến Playwright cố chạy nó và đỏ. Thư mục riêng ngang hàng là cách sạch nhất; không cần sửa `playwright.config.ts`.

**Interfaces:**
- Consumes: ba file schema + toàn bộ `contracts/fixtures/**`.
- Produces: type `TagNamespaceDocument`, `TagDescriptor`, `TagSource`, `ComponentModelDocument`, `ComponentNode`, `ComponentTypeDef`, `ComponentTagDef`, `ComponentStateDef`, `HmiScreenDocument`, `ScreenLayout`, `ScreenWidget`, `WidgetRect` — **tên trùng khít với record C#**, property camelCase.

- [ ] **Step 1: Viết type TypeScript**

`web/src/contracts/tagNamespace.ts`:

```ts
/**
 * Bản sao TypeScript của `contracts/tag-namespace.schema.json` v1.
 *
 * Mọi property ở đây được ghim đối chiếu HAI CHIỀU với file schema bởi
 * `web/contract-tests/contracts.test.mjs`. Phía .NET có bài tương ứng
 * (`TagNamespaceSchemaPinTests`); hai bài phải CÙNG đỏ khi schema đổi. Đó là toàn bộ lý do
 * hai bài tồn tại — xem `contracts/README.md`.
 */

export type TagDataType = "bool" | "int" | "float" | "string" | "enum"
export type TagAccess = "r" | "rw"
export type PolicyAction = "machine.setpoint" | "machine.command"

export type TagSource = {
  kind: "modbus" | "opcua" | "mqtt" | "simulated" | "derived"
  unitId?: number | null
  register?: number | null
  scale?: number | null
  nodeId?: string | null
  topic?: string | null
  jsonPath?: string | null
  expr?: string | null
}

export type TagDescriptor = {
  path: string
  dataType: TagDataType
  unit?: string | null
  engMin?: number | null
  engMax?: number | null
  enumValues?: string[] | null
  access: TagAccess
  /** Bất biến §5: bắt buộc khác null khi `access === "rw"`. Schema thi hành; TypeScript không. */
  policyAction?: PolicyAction | null
  source: TagSource
  isBackedByDriver: boolean
}

export type TagNamespaceDocument = {
  schemaVersion: 1
  machineCode: string
  tags: TagDescriptor[]
}
```

`web/src/contracts/componentModel.ts` và `web/src/contracts/hmiScreen.ts` — viết tương tự, một type cho mỗi `$defs` của schema tương ứng, tên trùng khít với record C# ở Task 4/5, và **cùng kiểu doc comment đầu file**. `web/src/contracts/index.ts` chỉ re-export cả ba.

- [ ] **Step 2: Viết bộ validate JSON Schema tối thiểu**

`web/contract-tests/validate.mjs` — **không** phải bộ validate JSON Schema đầy đủ; nó phủ đúng những từ khoá mà ba schema này dùng, và **nói thẳng điều đó**:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Bộ validate JSON Schema TỐI THIỂU, viết tay, cho đúng ba schema của `contracts/`.
//
// VÌ SAO KHÔNG DÙNG AJV: Mốc 0 có ràng buộc "không thêm npm package" (xem blueprint §Global
// Constraints). Đổi lại, bộ này CHỈ hiểu các từ khoá ba schema ấy thật sự dùng:
//   type · const · enum · required · additionalProperties · properties · items · $ref (nội bộ)
//   minLength · minimum · maximum · pattern · oneOf · allOf · if/then
//
// 🔴 NÓ KHÔNG PHẢI BỘ VALIDATE TỔNG QUÁT. Nếu ai đó thêm một từ khoá ngoài danh sách trên vào
// schema, `assertKnownKeywords` dưới đây NÉM LỖI thay vì bỏ qua âm thầm — một từ khoá không được
// hiểu mà bị bỏ qua chính là cách một bộ validate viết tay trở thành lời nói dối.
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "type", "const", "enum", "required",
  "additionalProperties", "properties", "items", "minLength", "minimum", "maximum",
  "pattern", "oneOf", "allOf", "if", "then",
])

// 🔴 Đệ quy phải phân biệt NÚT SCHEMA với BẢN ĐỒ TÊN→SCHEMA. Khoá của `properties` và `$defs` là tên do
// người dùng đặt ("machineCode", "tag"), KHÔNG phải từ khoá — kiểm chúng với KNOWN sẽ ném lỗi trên mọi
// schema hợp lệ. Chỉ đi xuống những chỗ thật sự chứa nút schema; `enum`/`required`/`pattern`/`const` là
// giá trị lá, không đi xuống.
export function assertKnownKeywords(node, path = "#") {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return

  for (const k of Object.keys(node)) {
    if (!KNOWN.has(k)) throw new Error(`từ khoá schema chưa được hỗ trợ: ${k} tại ${path}`)
  }

  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" || k === "$defs") {
      for (const [name, sub] of Object.entries(v)) assertKnownKeywords(sub, `${path}/${k}/${name}`)
    } else if (k === "oneOf" || k === "allOf") {
      v.forEach((sub, i) => assertKnownKeywords(sub, `${path}/${k}/${i}`))
    } else if (k === "items" || k === "if" || k === "then" || k === "additionalProperties") {
      assertKnownKeywords(v, `${path}/${k}`) // additionalProperties có thể là `false` — guard đầu hàm lo
    }
  }
}

function resolve(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`chỉ hỗ trợ $ref nội bộ, gặp: ${ref}`)
  return ref.slice(2).split("/").reduce((node, seg) => node[seg], root)
}

/** Trả về mảng lỗi (rỗng = hợp lệ). */
export function validate(root, schema, value, path = "$") {
  const errs = []
  if (schema.$ref) return validate(root, resolve(root, schema.$ref), value, path)

  if (schema.const !== undefined && value !== schema.const)
    errs.push(`${path}: phải là ${JSON.stringify(schema.const)}`)

  if (schema.enum && !schema.enum.some((e) => e === value))
    errs.push(`${path}: không nằm trong enum ${JSON.stringify(schema.enum)}`)

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actual =
      value === null ? "null"
      : Array.isArray(value) ? "array"
      : Number.isInteger(value) ? "integer"
      : typeof value === "number" ? "number"
      : typeof value
    const ok = types.some((t) => t === actual || (t === "number" && actual === "integer"))
    if (!ok) errs.push(`${path}: kiểu ${actual}, schema đòi ${types.join("|")}`)
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errs.push(`${path}: ngắn hơn minLength ${schema.minLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errs.push(`${path}: không khớp pattern ${schema.pattern}`)
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errs.push(`${path}: nhỏ hơn minimum ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum)
      errs.push(`${path}: lớn hơn maximum ${schema.maximum}`)
  }

  if (schema.properties && value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const req of schema.required ?? [])
      if (!(req in value)) errs.push(`${path}: thiếu trường bắt buộc "${req}"`)
    if (schema.additionalProperties === false)
      for (const k of Object.keys(value))
        if (!(k in schema.properties)) errs.push(`${path}: trường lạ "${k}"`)
    for (const [k, sub] of Object.entries(schema.properties))
      if (k in value) errs.push(...validate(root, sub, value[k], `${path}.${k}`))
  }

  if (schema.items && Array.isArray(value))
    value.forEach((v, i) => errs.push(...validate(root, schema.items, v, `${path}[${i}]`)))

  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validate(root, s, value, path).length === 0)
    if (passing.length !== 1) errs.push(`${path}: khớp ${passing.length} nhánh oneOf, cần đúng 1`)
  }

  for (const sub of schema.allOf ?? []) {
    if (sub.if) {
      if (validate(root, sub.if, value, path).length === 0)
        errs.push(...validate(root, sub.then, value, path))
    } else {
      errs.push(...validate(root, sub, value, path))
    }
  }

  return errs
}
```

- [ ] **Step 3: Viết bài test thất bại**

`web/contract-tests/contracts.test.mjs`:

```js
// Chạy: npm run test:contracts   (node --test, không thêm package nào)
//
// 🔴 Bài này KHÔNG đo: (1) phía C# đọc cùng fixture ra cùng kết quả — đó là
// `tests/St4i.Hmi.Contracts.Tests`, và hai bên cố ý dùng CHUNG một corpus để một fixture mới bắt
// buộc cả hai phải xanh; (2) type TypeScript có ĐÚNG KIỂU không — bài ghim chỉ so TÊN property,
// sai kiểu do `tsc -b` bắt khi `web/src/contracts/*.ts` được dùng thật ở WS-HMI-1; (3) bất kỳ luật
// ISA-101 nào — đó là WS-HMI-4.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { validate, assertKnownKeywords } from "./validate.mjs"

// web/contract-tests → web → tools/machine-simulator → contracts
const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACTS = join(HERE, "..", "..", "contracts")

const SCHEMAS = {
  "tags-": "tag-namespace.schema.json",
  "components-": "component-model.schema.json",
  "screen-": "hmi-screen.schema.json",
}

const load = (f) => JSON.parse(readFileSync(join(CONTRACTS, f), "utf8"))
const fixtures = (bucket, prefix) =>
  readdirSync(join(CONTRACTS, "fixtures", bucket))
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()

for (const [prefix, schemaFile] of Object.entries(SCHEMAS)) {
  const schema = load(schemaFile)

  test(`${schemaFile}: chỉ dùng từ khoá bộ validate này hiểu`, () => {
    assertKnownKeywords(schema)
  })

  test(`${schemaFile}: corpus hợp lệ không rỗng`, () => {
    assert.ok(fixtures("valid", prefix).length > 0, `không có fixture valid/${prefix}*`)
  })

  for (const f of fixtures("valid", prefix)) {
    test(`${schemaFile}: chấp nhận valid/${f}`, () => {
      const errs = validate(schema, schema, load(join("fixtures", "valid", f)))
      assert.deepEqual(errs, [], `đáng lẽ hợp lệ nhưng báo lỗi:\n${errs.join("\n")}`)
    })
  }

  for (const f of fixtures("invalid", prefix)) {
    test(`${schemaFile}: TỪ CHỐI invalid/${f}`, () => {
      const errs = validate(schema, schema, load(join("fixtures", "invalid", f)))
      assert.ok(errs.length > 0, `đáng lẽ bị từ chối nhưng lại hợp lệ — luật trong tên file không chặn`)
    })
  }
}

// ── Ghim hai chiều schema ⟷ type TypeScript ───────────────────────────────────
// Không đọc được type TS lúc chạy, nên bài này đọc TÊN PROPERTY từ chính file .ts bằng cách bóc
// các khối `export type X = { ... }`. Thô, nhưng đúng thứ cần: nó đỏ khi hai bên lệch tên.

const TS_SOURCES = {
  "tag-namespace.schema.json": "tagNamespace.ts",
  "component-model.schema.json": "componentModel.ts",
  "hmi-screen.schema.json": "hmiScreen.ts",
}

const PIN = {
  "tag-namespace.schema.json": [
    [[], "TagNamespaceDocument"],
    [["$defs", "tag"], "TagDescriptor"],
  ],
  "component-model.schema.json": [
    [[], "ComponentModelDocument"],
    [["$defs", "component"], "ComponentNode"],
    [["$defs", "componentType"], "ComponentTypeDef"],
    [["$defs", "componentTag"], "ComponentTagDef"],
    [["$defs", "componentState"], "ComponentStateDef"],
  ],
  "hmi-screen.schema.json": [
    [[], "HmiScreenDocument"],
    [["$defs", "layout"], "ScreenLayout"],
    [["$defs", "widget"], "ScreenWidget"],
    [["$defs", "rect"], "WidgetRect"],
  ],
}

function tsProps(sourceFile, typeName) {
  const src = readFileSync(join(HERE, "..", "src", "contracts", sourceFile), "utf8")
  const m = new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\}`).exec(src)
  assert.ok(m, `không tìm thấy "export type ${typeName} = {" trong ${sourceFile}`)
  return new Set([...m[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((x) => x[1]))
}

for (const [schemaFile, pins] of Object.entries(PIN)) {
  const schema = load(schemaFile)
  for (const [pointer, typeName] of pins) {
    test(`${schemaFile} ⟷ ${typeName}: cùng tập tên property`, () => {
      const node = pointer.reduce((n, seg) => n[seg], schema)
      const inSchema = new Set(Object.keys(node.properties))
      const inTs = tsProps(TS_SOURCES[schemaFile], typeName)

      const missingFromTs = [...inSchema].filter((k) => !inTs.has(k)).sort()
      const missingFromSchema = [...inTs].filter((k) => !inSchema.has(k)).sort()

      assert.deepEqual(missingFromTs, [], `schema khai nhưng TS thiếu: ${missingFromTs}`)
      assert.deepEqual(missingFromSchema, [], `TS khai nhưng schema thiếu: ${missingFromSchema}`)
    })
  }
}
```

- [ ] **Step 4: Thêm script và chạy để xác nhận ĐỎ**

Thêm vào `web/package.json` mục `scripts`:

```json
"test:contracts": "node --test contract-tests/"
```

Trước khi chạy, **cố ý** xoá dòng `isBackedByDriver: boolean` khỏi `web/src/contracts/tagNamespace.ts`.

Chạy: `cd web && npm run test:contracts`
Kỳ vọng: FAIL ở bài `tag-namespace.schema.json ⟷ TagDescriptor` với `schema khai nhưng TS thiếu: isBackedByDriver`.

- [ ] **Step 5: Hoàn nguyên và chạy lại**

Trả dòng `isBackedByDriver: boolean` về chỗ cũ.

Chạy: `cd web && npm run test:contracts`
Kỳ vọng: PASS toàn bộ — trong đó có **ba bài `TỪ CHỐI invalid/...`**, tức là ba bất biến an toàn/dải cứng đã được chứng minh là thật sự chặn, chứ không chỉ được viết trong tài liệu.

- [ ] **Step 6: Chạy cổng build**

Không cần sửa `tsconfig.*.json`: `web/src/contracts/*.ts` nằm dưới `src/` nên đã thuộc phạm vi `tsconfig.app.json` sẵn có, và `contract-tests/*.mjs` là JavaScript — `tsc` không kiểm nó, việc kiểm là `node --test` ở Step 5. Đừng thêm nó vào tsconfig chỉ để "cho đủ"; nó sẽ không đo thêm gì.

Chạy: `cd web && npm run build`
Kỳ vọng: exit code **0**. Xác nhận **trực tiếp bằng exit code**, không chỉ đọc log — kho này đã từng có bốn đợt liên tiếp né lỗi kiểu và tự nhận là xanh (ghi ở §0-bis, Đợt A).

Chạy: `cd web && npx oxlint`
Kỳ vọng: không lỗi mới.

- [ ] **Step 7: Commit**

```bash
git add web/src/contracts web/contract-tests web/package.json
git commit -m "contract(hmi): the TypeScript side, pinned to the same schema and the same corpus as C#"
```

---

## Task 7: Đóng băng — cổng chạy được, tài liệu cập nhật, ledger ghi đúng

**Files:**
- Create: `scripts/check-contracts.mjs`
- Modify: `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md` (thêm hàng vào §0-bis.1)
- Modify: `README.md` (mục mới cho `contracts/`)
- Modify: `docs/HMI_BUILDER_DESIGN_2026-08-29.md` (§4 đánh dấu đã đóng + ghi sai lệch codegen)

**Interfaces:**
- Consumes: mọi thứ từ Task 1–6.
- Produces: `node scripts/check-contracts.mjs` — một lệnh chạy cả hai phía và in bảng tổng kết; đây là lệnh mọi task của WS-HMI-0/1/2 chạy trước khi báo xong.

- [ ] **Step 1: Viết cổng hợp nhất**

`scripts/check-contracts.mjs`:

```js
// Cổng Mốc 0: chạy CẢ HAI phía của hợp đồng schema và báo cáo cùng một chỗ.
//
// Vì sao cần một lệnh: hai phía sống ở hai toolchain (dotnet / node) và hai thư mục. Một người
// sửa schema rồi chỉ chạy phía mình là kịch bản drift chính mà Mốc 0 tồn tại để chặn.
//
// 🔴 Cổng này KHÔNG chạy Playwright, KHÔNG chạy bốn test project .NET khác, và KHÔNG build web.
// Nó chỉ đo hợp đồng. Xanh ở đây không có nghĩa nhánh sẵn sàng merge.

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const steps = [
  { name: ".NET contract tests", cmd: "dotnet", args: ["test", "tests/St4i.Hmi.Contracts.Tests"], cwd: ROOT },
  { name: "web contract tests", cmd: "npm", args: ["run", "test:contracts"], cwd: join(ROOT, "web") },
]

let failed = 0
for (const s of steps) {
  process.stdout.write(`\n=== ${s.name} ===\n`)
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, stdio: "inherit", shell: process.platform === "win32" })
  if (r.status !== 0) { failed++; process.stdout.write(`!!! ${s.name} FAILED (exit ${r.status})\n`) }
}

process.stdout.write(failed === 0
  ? "\nCONTRACT GATE: PASS — hai phía đồng ý về cả ba schema.\n"
  : `\nCONTRACT GATE: FAIL — ${failed}/${steps.length} bước đỏ.\n`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 2: Chạy cổng, xác nhận XANH**

Chạy: `node scripts/check-contracts.mjs`
Kỳ vọng: exit code 0, in `CONTRACT GATE: PASS`.

- [ ] **Step 3: Chứng minh cổng thật sự bắt được drift**

Cố ý thêm `"revision": { "type": "integer" }` vào `properties` gốc của `contracts/tag-namespace.schema.json`.

Chạy: `node scripts/check-contracts.mjs`
Kỳ vọng: exit code 1, và **CẢ HAI** bước đỏ — .NET báo `schema khai nhưng record thiếu: revision`, web báo `schema khai nhưng TS thiếu: revision`. Nếu chỉ một phía đỏ, cổng chưa làm đúng việc của nó — dừng và sửa trước khi đi tiếp.

Hoàn nguyên thay đổi, chạy lại, xác nhận PASS.

- [ ] **Step 4: Ghi vào ledger roadmap**

Thêm một hàng vào bảng §0-bis.1 của `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md`, theo đúng giọng của các hàng sẵn có — **nêu cả cái đã làm lẫn cái CHƯA làm**:

| WS | GĐ | Đã giao | Commit | Tài liệu |
|---|---|---|---|---|
| **WS-HMI Mốc 0** Đóng băng hợp đồng schema | 4 (mới) | `contracts/` với 3 JSON Schema (tag namespace · component model · hmi screen) + corpus fixture dùng chung (valid + invalid) + contract assembly `St4i.Hmi.Contracts` (net10.0, **ZERO dependency**) + type TS `web/src/contracts/` + ghim hai chiều schema⟷kiểu ở **CẢ HAI** phía + cổng `node scripts/check-contracts.mjs`. Hai bất biến an toàn §5 nay **không diễn đạt được nếu sai**: tag `rw` không có `policyAction`, và widget `setpoint-input`/`command-button` không có `policyAction`, đều bị schema từ chối — có fixture `invalid/` chứng minh. **CHƯA có:** không sinh mã (chủ ý, xem blueprint §Sai lệch), bộ validate phía web là bản viết tay tối thiểu chỉ phủ từ khoá ba schema này dùng (ném lỗi khi gặp từ khoá lạ, không bỏ qua âm thầm), và **chưa có một dòng runtime/editor/driver nào** — Mốc 0 chỉ là hợp đồng | *(điền khi commit)* | `docs/plans/2026-08-29-hmi-moc0-schema-freeze-blueprint.md`, `contracts/README.md` |

- [ ] **Step 5: Thêm mục `contracts/` vào README**

Thêm một mục mới vào `README.md` (đánh số tiếp theo mục cuối hiện có), song ngữ theo đúng khuôn các mục khác, nội dung: `contracts/` là gì, luật đóng băng, cách chạy cổng, và **câu cảnh báo rằng Mốc 0 chưa giao tính năng người dùng thấy được** — chỉ là hợp đồng giữa hai nhánh.

- [ ] **Step 6: Đánh dấu §4 của spec đã đóng**

Trong `docs/HMI_BUILDER_DESIGN_2026-08-29.md` §4, thêm một khối ghi chú ngay dưới bảng ba file: ba file đã đóng băng ngày nào, ở commit nào, và **khoản 2 được thi hành bằng ghim hai chiều thay vì codegen**, kèm lý do và người chốt. Không xoá nguyên văn khoản 2 — theo đúng thói quen của kho này là ghi chú đè lên chứ không xoá lịch sử.

- [ ] **Step 7: Chạy lại toàn bộ, xác nhận không hồi quy**

Chạy từng lệnh, ghi lại exit code thật:

```bash
node scripts/check-contracts.mjs
dotnet test tests/St4i.EngineApi.Tests
dotnet test tests/St4i.EdgeCore.Tests
dotnet test tests/St4i.EdgeService.Tests
dotnet test tests/St4i.Connector.Abstractions.Tests
dotnet test tests/St4i.Connector.Conformance.Tests
cd web && npm run build && npx oxlint && node scripts/check-test-budgets.mjs
```

Kỳ vọng: tất cả exit 0. Số bài của năm project cũ **không được đổi** — Mốc 0 không sửa mã sản phẩm nào. Nếu một con số đổi, dừng lại và tìm hiểu vì sao trước khi commit.

Playwright: Mốc 0 không thêm route, không sửa component nào đang render, nên **không cần chạy lại toàn bộ 176 bài**. Ghi rõ điều này trong báo cáo đóng task thay vì im lặng bỏ qua.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-contracts.mjs README.md docs/
git commit -m "gate(contract): one command runs both sides, and it fails on both when the schema moves"
```

---

## Nghiệm thu Mốc 0

Mốc 0 đóng khi **tất cả** đúng:

- [ ] `node scripts/check-contracts.mjs` exit 0.
- [ ] Thêm một property vào bất kỳ schema nào làm **cả hai** phía đỏ (đã chứng minh ở Task 7 Step 3).
- [ ] Ba fixture `invalid/` đều bị từ chối, và mỗi tên file nêu đúng luật nó vi phạm.
- [ ] Năm test project .NET cũ giữ **nguyên số bài**; `npm run build` exit 0 (xác nhận bằng exit code).
- [ ] `contracts/README.md` nêu luật đổi schema; `README.md` có mục `contracts/`; §0-bis.1 của roadmap có hàng mới; §4 của spec có ghi chú đóng băng.
- [ ] Bất biến §5 mã hoá được kiểm: không thể viết một tag `rw` hay một widget ghi mà thiếu `policyAction`.

**Chỉ sau khi ô cuối cùng được tick, hai nhánh WS-HMI-0 (.NET Spine) và WS-HMI-1 (web Runtime) mới được tách.**

---

## Ghi chú cho người viết kế hoạch kế tiếp

Sau Mốc 0, **hai kế hoạch riêng** cần được viết, và chúng chạy song song:

1. `docs/plans/YYYY-MM-DD-hmi-ws0-tag-spine-blueprint.md` — .NET: cây linh kiện trên `AssetRegistryStore`, Tag Namespace store, compiler thay `mapping/*.json`, endpoint `/v1/components` `/v1/component-types` `/v1/tags`, SSE subscribe, nạp tag từ Modbus + OPC-UA + simulated.
2. `docs/plans/YYYY-MM-DD-hmi-ws1-runtime-blueprint.md` — web: renderer đọc `HmiScreenDocument`, 15 widget theo đúng danh sách `kind` đã đóng băng ở Task 5, binding engine (gồm thay `{component}`), theme `isa101`, và nghiệm thu **viết lại ba màn hard-code thành JSON rồi xoá bản React**.

Cả hai kế hoạch phải mở đầu bằng dòng: *mọi thay đổi hợp đồng phải quay lại `contracts/` và làm cả bốn chỗ trong cùng một commit.*
