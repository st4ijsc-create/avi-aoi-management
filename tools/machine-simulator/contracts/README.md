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

`component-model.schema.json` bắt buộc thêm: một tag `role: "setpoint"` phải có `min`/`max` — dải chặn
cứng, không phải trang trí (`MACHINE_CONFIG_DESIGN.md §3`). Fixture
`invalid/components-setpoint-without-hard-band.json` tồn tại để chứng minh luật ấy thật sự chặn.

### Hai tấm gương KHÔNG đối xứng: schema thi hành, .NET thì không / The two mirrors are not symmetric

**VI** — Ba schema thi hành các luật trên bằng máy. Bản sao C# thì **không**, và điều đó phải được nói ra
thay vì được suy ra: `St4i.Hmi.Contracts` type **mọi** enum của schema thành `string` (`Access`,
`PolicyAction`, `Role`, `DataType`, `Kind`, `Tone`, `Theme`, `Breakpoint`), nên một bộ sinh dữ liệu phía
.NET hoàn toàn có thể dựng `new TagDescriptor(..., Access: "rw", PolicyAction: null, ...)` — hoặc
`Access: "wr"`, hay `"machine.reboot"` — và **không một thứ gì trong cây .NET phản đối**: nó biên dịch,
nó round-trip, nó ghi ra JSON sạch. Bất biến §5 chỉ cắn khi document ấy đi qua một bộ validate JSON
Schema, và bộ validate duy nhất trong cây này nằm ở phía web (`web/contract-tests/validate.mjs`). Hệ quả
thực dụng: **phía .NET đọc/ghi được nhiều hơn schema cho phép, có chủ ý** — record C# là phương tiện
truyền, không phải cổng gác. Đừng đọc một record C# biên dịch được thành "tài liệu hợp lệ". (Vì sao
không siết bằng `enum` C#: một `enum` sẽ ném khi gặp giá trị lạ, tức là phía .NET **mất đường đọc** một
document của bản schema mới hơn — đúng thứ luật cộng-thêm ở trên tồn tại để giữ.)

**EN** — The three schemas enforce those rules by machine. The C# mirror does **not**, and that has to be
stated rather than inferred: `St4i.Hmi.Contracts` types **every** schema enum as `string`, so a .NET
producer can construct `Access: "rw", PolicyAction: null` — or `Access: "wr"`, or
`PolicyAction: "machine.reboot"` — and nothing in the .NET tree objects: it compiles, it round-trips, it
serialises to clean JSON. The §5 invariant only bites when the document passes through a JSON Schema
validator, and the only validator in this tree is the web-side one. Practical consequence: **the .NET
side accepts more than the schema permits, on purpose** — the C# records are a transport, not a gate. A
C# record that compiles is not evidence of a valid document. (Why not tighten with a C# `enum`: an `enum`
throws on an unknown value, which would cost the .NET side its ability to READ a document written against
a newer schema version — exactly what the additive-only rule above exists to preserve.)

## Widget hợp thành: `policyAction` đến TỪ ĐÂU / Composite widgets: where `policyAction` comes from

**VI** — `hmi-screen.schema.json` bắt buộc `policyAction` trên `setpoint-input` và `command-button`, và
**chỉ** hai loại đó. `faceplate` là một widget **hợp thành**: nó gắn vào một linh kiện (`component`) và
vẽ ra nhiều điều khiển con — trong đó có thể có điều khiển GHI, vì mỗi `ComponentTypeDef` có
`defaultFaceplate` và có thể khai tag `role: "command"`/`"setpoint"`. Nghĩa là một `faceplate` render
đường ghi trong khi bản thân nó không mang `policyAction` nào.

**Luật, chốt ở đây thay vì để hai đội tự chọn:** hành động ghi của một widget hợp thành lấy `policyAction`
từ **`ComponentTagDef` được bind**, **không bao giờ** từ widget. Widget hợp thành **không** khai
`policyAction` của riêng nó, và runtime **không** được suy ra một `policyAction` mặc định khi tag không
có — không có `policyAction` trên `ComponentTagDef` nghĩa là tag ấy không ghi được, chấm hết. Đây là lý do
`component-model.schema.json` bắt `role: "setpoint"`/`"command"` phải có `policyAction`: luật ấy chính là
thứ làm cho đường ghi của faceplate được gác, và nó nằm ở đúng chỗ dữ liệu quyền được khai một lần rồi
dùng lại N instance (§3.3 indirect binding).

**Ghim của luật này là fixture `valid/screen-screwdrive-full.json`** — widget `spindle-fp`
(`kind: "faceplate"`, `component: "spindle"`, **không** `policyAction`) hợp lệ **chính vì** luật này, chứ
không phải vì luật §5 bỏ sót nó. Cặp đối chiếu của nó là `valid/components-screwdrive-cell.json`, nơi
`st4i.motor.spindle` khai `torque-target` (`machine.setpoint`) và `reset` (`machine.command`) — đó là nơi
quyền ghi của faceplate ấy thật sự sống. Sửa một trong hai fixture mà không sửa fixture kia là làm hỏng
đúng cặp ví dụ mà luật này dựa vào.

**Không đổi schema cho việc này, và đó là chủ ý:** thêm một ràng buộc `if kind == "faceplate" then …`
sẽ là siết ràng buộc ⇒ phải tăng `schemaVersion` theo khoản 1, và nó sẽ đòi widget khai lại một quyền mà
`ComponentTagDef` đã khai — tức là dựng cổng an toàn thứ hai, đúng thứ README §1 của cây này cấm.

**EN** — `hmi-screen.schema.json` requires `policyAction` on `setpoint-input` and `command-button`, and on
**those two only**. `faceplate` is a **composite** widget: it binds to a `component` and renders several
sub-controls, some of which may write, because every `ComponentTypeDef` has a `defaultFaceplate` and may
declare `role: "command"`/`"setpoint"` tags. So a faceplate can render a write path while carrying no
`policyAction` of its own.

**The rule, decided here rather than left for two parallel teams to each pick:** a composite widget's
write actions derive their `policyAction` from the **bound `ComponentTagDef`**, **never** from the widget.
A composite widget does not declare its own `policyAction`, and the runtime must **not** infer a default
one when the tag has none — no `policyAction` on the `ComponentTagDef` means that tag is not writable,
full stop. This is why `component-model.schema.json` forces `role: "setpoint"`/`"command"` to carry a
`policyAction`: that rule *is* what keeps a faceplate's write path policed, and it sits where the
authority is declared once and reused across N instances (§3.3 indirect binding).

**The pin for this rule is the fixture `valid/screen-screwdrive-full.json`** — the `spindle-fp` widget
(`kind: "faceplate"`, `component: "spindle"`, **no** `policyAction`) is valid *because of* this rule, not
because §5 overlooked it. Its counterpart is `valid/components-screwdrive-cell.json`, where
`st4i.motor.spindle` declares `torque-target` (`machine.setpoint`) and `reset` (`machine.command`) — that
is where that faceplate's write authority actually lives. Editing one of the two fixtures without the
other breaks the very pair this rule rests on.

**No schema change for this, deliberately:** an `if kind == "faceplate" then …` constraint would be a
tightening ⇒ a `schemaVersion` bump under clause 1, and it would make the widget restate an authority
`ComponentTagDef` already declares — i.e. build a second safety gate, which is exactly what this tree's
README §1 forbids.

## Trường được HOÃN có chủ ý, không phải bỏ quên / Fields deliberately deferred, not forgotten

**VI** — `HMI_BUILDER_DESIGN_2026-08-29.md` nêu ba trường mà đợt đóng băng này **không** giao. Ghi ở đây
để đội sau tìm thấy một **quyết định**, không phải một cái lỗ:

| Trường | Spec | Quyết định ở Mốc 0 |
|---|---|---|
| `quality` (`good`/`stale`/`bad`) | §3.2 bảng tag, và tiêu chí nghiệm thu §7 của WS-HMI-0 | **HOÃN sang hợp đồng giá trị sống của WS-HMI-0.** `quality` là trạng thái **theo từng lần đọc**, không phải thuộc tính khai báo của tag. Nó đổi mỗi chu kỳ poll; `tag-namespace.schema.json` là một document **TĨNH** được lưu và version hoá. Đặt `quality` vào đây sẽ tạo ra một trường mà mọi document ghi ra đĩa đều mang một giá trị đã cũ ngay lúc ghi — đúng lớp khuyết tật "được phục vụ ≠ có tác dụng" mà cây này đã trả giá. Chỗ đúng của nó là payload của `GET /v1/tags/{path}` và stream SSE, tức hợp đồng **giá trị sống** mà WS-HMI-0 sẽ định nghĩa. Yêu cầu "runtime BẮT BUỘC hiển thị quality" của §3.2 **không** bị bỏ — nó chuyển sang hợp đồng ấy. |
| `alarms[]` trên `ComponentType` | §3.1 bảng `ComponentType` | **HOÃN.** Một điều kiện alarm khai trong component model chỉ có nghĩa nếu nó **nạp được vào `AlarmEngine`** (ISA-18.2, đã có, ba nguồn: Policy-DENY / DriverHealth / NG-rate). Hình dạng của trường phụ thuộc vào thiết kế tích hợp ấy — mức ưu tiên, shelving, ngưỡng trễ, ánh xạ sang nguồn alarm nào — và WS-HMI-0 sở hữu thiết kế đó. Đóng băng một hình dạng `alarms[]` **trước** khi biết `AlarmEngine` nhận gì sẽ là đóng băng một phỏng đoán, rồi phải tăng `schemaVersion` để sửa. |
| `enumValues` trên `ComponentType.tags[]` | §3.1 bảng `ComponentType` | **ĐÃ THÊM** (fix round 2). Khác hai hàng trên: đây là một **mâu thuẫn nội bộ** của hợp đồng, không phải một tính năng mới — `component-model.schema.json` cho phép `dataType: "enum"` mà không có chỗ khai giá trị, trong khi `tag-namespace.schema.json` đã có `enumValues` từ đầu. Hai schema bất đồng về đúng cùng một kiểu dữ liệu là một khuyết tật, và hoãn một khuyết tật thì nó vẫn là khuyết tật. Fixture `valid/components-screwdrive-cell.json` (tag `state`) dùng nó. |

**EN** — The design doc names three fields this freeze does **not** deliver. Recorded here so the next
team finds a **decision** rather than a hole:

- **`quality`** (§3.2, and WS-HMI-0's §7 acceptance criterion) — **deferred to the live-value contract
  WS-HMI-0 will define.** Quality is **per-read** state, not a declared property of a tag: it changes
  every poll cycle, while `tag-namespace.schema.json` is a **static**, stored, versioned document.
  Putting `quality` here would create a field that is stale the instant any document is written to disk —
  the same "served ≠ has effect" defect class this tree has already paid for. Its correct home is the
  payload of `GET /v1/tags/{path}` and the SSE stream. §3.2's "the runtime MUST display quality"
  requirement is not dropped; it moves to that contract.
- **`alarms[]` on `ComponentType`** (§3.1) — **deferred.** An alarm condition declared in the component
  model only means anything if it **loads into `AlarmEngine`** (ISA-18.2, already shipped, three sources).
  The field's shape depends on that integration design — priority, shelving, hysteresis, which alarm
  source it maps to — and WS-HMI-0 owns that design. Freezing an `alarms[]` shape *before* knowing what
  `AlarmEngine` accepts would freeze a guess and then need a `schemaVersion` bump to correct.
- **`enumValues` on `ComponentType.tags[]`** (§3.1) — **added** in fix round 2, unlike the two above,
  because it is an **internal contradiction** rather than a new feature: `component-model.schema.json`
  permitted `dataType: "enum"` with no way to declare the values while `tag-namespace.schema.json` has
  had `enumValues` from the start. Two schemas disagreeing about the same data type is a defect, and
  deferring a defect leaves a defect.

## Một document không bao giờ viết `null` tường minh / A document never writes an explicit `null`

**VI** — Một property optional vắng mặt (absent) CHÍNH LÀ `null` của nó — **không một schema nào trong
thư mục này** còn nhận `"type": ["X", "null"]` hay `null` trong `enum`; absent đã mang optionality rồi
(nó không có trong `required`). Câu luật này cố ý không đếm số schema (đợt viết đầu tiên nói "hai schema
này" khi corpus mới có hai file; corpus giờ có ba, và một câu đếm-số chỉ đúng tới lần thêm schema tiếp
theo — sửa "hai" thành "ba" sẽ chỉ đặt lại đúng cái bẫy đó cho file thứ tư). Đừng viết `"unit": null` —
hãy bỏ hẳn key `unit`. Lý do không chỉ là quy ước: `HmiContractJson.Options` phía .NET đặt
`WhenWritingNull`, nên phía C# **không bao giờ** có thể ghi ra một `null` tường minh — mọi document
schema-hợp-lệ mà chứa `null` tường minh sẽ round-trip thất bại ở phía C#, dù chính document đó hoàn toàn
hợp lệ theo schema. Bên TypeScript viết `"unit": null` là một cái bẫy tương thích giữa hai nhánh, không
phải một lựa chọn hợp lệ khác — schema giờ cấm nó bằng máy, không chỉ bằng văn xuôi.

**EN** — An absent optional property IS its null — **no schema in this directory** accepts
`"type": ["X", "null"]` or `null` in an `enum`; absence already carries the optionality (it is not in
`required`). This rule is deliberately count-agnostic (the first draft said "neither schema" when the
corpus held two files; the corpus now holds three, and a counted sentence is only correct until the next
schema lands — bumping "neither" to "none of the three" would just reset the same trap for a fourth
file). Never write `"unit": null` — omit the `unit` key entirely. This is not just convention: the .NET
side's `HmiContractJson.Options` sets `WhenWritingNull`, so the C# reference implementation can **never**
emit an explicit null — any schema-valid document containing one would fail to round-trip on the C# side
even though the document itself is valid. A TypeScript author writing `"unit": null` was falling into an
interoperability trap between the two branches, not choosing an equally valid alternative — the schema now
forbids it by machine, not by prose.
