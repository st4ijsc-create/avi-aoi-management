# THIẾT KẾ — HMI BUILDER & NỀN TẢNG ĐỘC LẬP CHO MÁY TỰ ĐỘNG HOÁ
## Machine Edition: từ HMI viết tay sang HMI sinh từ mô hình thiết bị

| | |
|---|---|
| Ngày lập | 29/08/2026 |
| Phạm vi | `tools/machine-simulator` (bộ `St4i.*` .NET 10 + `web/` React 19) |
| Tài liệu tiền nhiệm | [SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md](SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md) · [HMI_DESIGN_SPEC.md](HMI_DESIGN_SPEC.md) · [MACHINE_CONFIG_DESIGN.md](MACHINE_CONFIG_DESIGN.md) |
| Trạng thái | **CHỜ DUYỆT** — chưa có mã nào được viết, chưa agent nào được gọi |
| Vị trí trong lộ trình | Workstream mới `WS-HMI-0..6`, nối tiếp GĐ3; **không sửa GĐ1/GĐ2 đã đóng** |

---

## 0. Mệnh đề một câu

Hôm nay thêm một loại máy mới nghĩa là **viết thêm React**; sau đợt này, thêm một loại máy mới nghĩa là **khai báo máy đó có linh kiện gì**, và màn hình điều khiển đúng chuẩn ISA-101 được **sinh ra**, rồi kỹ sư kéo-thả tinh chỉnh.

---

## 1. Quyết định định hướng đã chốt (29/08/2026)

| # | Quyết định | Chốt | Hệ quả |
|---|---|---|---|
| 1 | Vị trí HMI Builder | **Machine Edition** (`tools/machine-simulator`) | Giữ được offline-first. Synapse là *consumer* qua WS-HMI-5, không phải chủ sở hữu |
| 2 | Thứ tự thi công | **Song song hai nhánh** (.NET Spine ‖ web Runtime/Editor) | ⚠️ Rủi ro chính chuyển thành **schema drift** ⇒ §4 (hợp đồng schema) phải đóng **TRƯỚC** khi tách nhánh |
| 3 | Đích runtime v1 | **Browser + Tauri kiosk** | `St4i.DesktopShell` (WPF) **không đụng tới** trong v1. Một renderer duy nhất |
| 4 | Widget điều khiển (ghi) | **CÓ**, bắt buộc qua Policy + vai trò + chốt HALT | `security-review` là **cổng bắt buộc** trước merge, không phải tuỳ chọn |

---

## 2. Hiện trạng — đo từ mã, không suy đoán

### 2.1 Nền tảng đã có (không làm lại)

Machine Edition đã **không còn là "simulator"**. Theo ledger §0-bis của tài liệu roadmap: GĐ1 xong, GĐ2 xong (trừ `WS-B B2` hoãn + Serial chưa làm), GĐ3 ~1/4.

| Năng lực | Hiện trạng | Dùng lại cho HMI Builder như thế nào |
|---|---|---|
| `AssetRegistryStore` (ISA-95 URN, vòng đời) | ✅ `src/St4i.EngineApi/AssetRegistry/` | **Mở rộng xuống cấp linh kiện** (§3.1) — không viết mới |
| `PolicyEngine` default-deny + `EstopGuardRule` + `CriticalAlarmGuardRule` | ✅ `src/St4i.EngineApi/Policy/` | **Cổng ghi của widget** — không cần cổng mới (§5) |
| `MachineWriteEndpoints` — `POST /v1/machines/{code}/setpoint` (Engineer) / `.../command` (Admin) | ✅ | Đích của widget ghi |
| `AlarmEngine` ISA-18.2 + `/v1/alarms` | ✅ | Nguồn cho widget annunciator/alarm banner |
| `LineController` PackML/ISA-88 + `/v1/line` | ✅ | Nguồn cho widget trạng thái line |
| Broker MQTT nhúng + **Sparkplug B** | ✅ WS-B | Tag Namespace publish lên đây (§3.2) |
| Historian SQLite + OEE + `/v1/historian/*` | ✅ WS-A | Nguồn cho widget trend/KPI |
| RBAC 3 vai + **audit hash-chain** | ✅ WS-D-core | Mọi thao tác publish màn hình + mọi lệnh ghi vào chuỗi audit |
| Connector SDK seam + conformance suite | 🔶 SEAM (chưa có plugin loader) | Nguồn nạp tag (§3.2) |
| Design system: `Sheet`/`Readout`/`StatusLamp`/`ControlButton`/`LogTag`, font Barlow bundled offline, 176 bài Playwright (gồm visual + axe AA) | ✅ | Widget lõi của runtime kế thừa trực tiếp |
| Hệ 3 theme `[data-theme="glass"\|"console"\|"warmth"]` | ✅ `web/src/index.css` | Thêm theme thứ 4 `isa101` (§6) — mở rộng, không đập đi |

### 2.2 Khoảng trống — chính xác chỗ HMI Builder lấp

| Khoảng trống | Bằng chứng |
|---|---|
| **HMI là React viết tay**, 3 schematic cố định theo `DeviceClass`, tỉ lệ cột hard-code | [web/src/routes/Hmi.tsx](../web/src/routes/Hmi.tsx) — hằng `SCHEMATIC_READOUT_FLEX`; [schematics/](../web/src/components/hmi/schematics/) chỉ có `AutomationSchematic`/`AoiSchematic`/`IotSchematic` |
| **Readout parse từ CHUỖI** `"Torque=4.2Nm"` bằng regex | [derive.ts](../web/src/components/hmi/derive.ts) — `parseKeyMetric` |
| **KHÔNG có mô hình tag/điểm dữ liệu.** `mapping/*.json` tự khai là placeholder, chỉ chứa `unitMap` | [mapping/screwdrive.json](../mapping/screwdrive.json) — `"not yet consulted by the runtime pipeline"` |
| **KHÔNG có mô hình linh kiện.** Asset Registry dừng ở cấp MÁY | `AssetRecord` không có quan hệ cha-con dưới cấp máy |
| `/connectors` chỉ dán/tải JSON — **chưa có visual mapper** | Đợt A, SM-5 |
| Design system là **brand-first, không phải ISA-101** | [HMI_DESIGN_SPEC.md](HMI_DESIGN_SPEC.md) — navy ST4I làm accent, không có nguyên tắc "màu chỉ cho bất thường" |

**Kết luận đo được:** khoảng trống lớn nhất **không phải editor** — mà là **không có mô hình dữ liệu để editor bind vào**. Vì vậy `WS-HMI-0` (Spine) là gốc, không phải phần phụ.

### 2.3 Đối chiếu thị trường (nghiên cứu 29/08/2026)

Bốn nền tảng chiếm ~80% triển khai SCADA: Ignition, AVEVA System Platform, Rockwell FactoryTalk (View SE + Optix), Siemens WinCC Unified. Xu hướng 2026: **Perspective và Optix kéo khách khỏi runtime HMI Windows-only** vì khách muốn mở HMI từ trình duyệt/tablet mà không mua license panel — xác nhận quyết định #3.

Cơ chế khiến họ scale: **UDT (kiểu thiết bị) + faceplate (view có tham số) + indirect binding**. Không ai vẽ màn hình cho từng máy. Đây chính là mô hình §3.1 + §3.3 áp dụng.

Tham chiếu mã nguồn mở: **FUXA** (editor SVG kéo-thả trong trình duyệt, Node.js, driver Modbus/S7/OPC-UA/BACnet/MQTT, historian SQLite/InfluxDB) chứng minh hình dạng này xây được ở quy mô nhỏ. Điểm yếu của nó — UX/thẩm mỹ cũ, không có mô hình linh kiện, không có sinh tự động — là khoảng trống ta đánh vào.

Mô hình thương mại đáng học: Optix tính license theo **feature token cộng dồn** theo chức năng đã cấu hình (kết nối controller, số web client, alarming, recipe, PDF report, data logging, DB, OPC UA, MQTT). Khuôn mẫu tốt cho `WS-E License/Edition` còn nợ ở GĐ3 — nối ở WS-HMI-5.

---

## 3. Kiến trúc — 5 tầng

```
① MÔ HÌNH THIẾT BỊ & LINH KIỆN  (.NET, mở rộng WS-J)
   Máy → Module/Trạm → Linh kiện
   ComponentType = "UDT": tag khai báo, đơn vị, dải kỹ thuật, điều kiện alarm, faceplate mặc định
                                   ↓
② TAG NAMESPACE  (.NET — SPINE, thay mapping/*.json placeholder)
   Một không gian địa chỉ chuẩn cho mỗi máy, do connector nạp
   (Modbus register / OPC-UA node / MQTT topic / simulated / dẫn xuất)
                                   ↓  hợp đồng JSON §4
③ HMI BUILDER  (web, design-time)
   Canvas kéo-thả · thư viện faceplate theo ComponentType · tag picker ·
   indirect binding {component} · responsive · ISA-101 linter · version/duyệt/audit
                                   ↓
④ HMI RUNTIME  (web, run-time)
   MỘT renderer React đọc JSON — KHÔNG codegen. Browser + Tauri kiosk. Offline-first.
                                   ↓
⑤ GOVERNANCE & SAFETY  (.NET, tái dùng PolicyEngine)
   Mọi widget ghi khai intent → PolicyEngine default-deny + vai trò + chốt HALT + audit
```

### 3.1 Tầng ① — Mô hình thiết bị & linh kiện

Mở rộng `AssetRegistry` từ *phẳng cấp máy* sang *cây*:

```
Machine (đã có, ISA-95 URN)
  └─ Module/Station  (mới — cụm chức năng: trạm cấp phôi, cụm trục Z, buồng soi)
       └─ Component  (mới — linh kiện: motor, van, xy-lanh, cảm biến, camera,
                      spindle, heater, conveyor, gripper, robot, encoder, biến tần…)
```

**`ComponentType` — đây là "UDT" của hệ thống.** Mỗi kiểu khai báo một lần, dùng lại N lần:

| Trường | Ý nghĩa |
|---|---|
| `typeId` | `st4i.motor.servo`, `st4i.valve.solenoid2w`, `st4i.sensor.temp`… (chuỗi mở, như `connector id` đã làm ở WS-G-plugin) |
| `tags[]` | Tag khai báo: `name`, `role` (`in`/`out`/`setpoint`/`command`), `dataType`, `unit`, `min`/`max`, `enumValues` |
| `states[]` | Trạng thái hiển thị (`stopped`/`running`/`faulted`/`homing`…) + biểu thức suy ra từ tag |
| `alarms[]` | Điều kiện alarm mặc định → nạp vào `AlarmEngine` (ISA-18.2 đã có) |
| `defaultFaceplate` | Id faceplate mặc định trong thư viện §3.3 |

**Nguyên tắc kế thừa từ `MachineParameterSchema`:** mọi tag ghi được **bắt buộc khai min/max chặn cứng**. [MACHINE_CONFIG_DESIGN.md §3](MACHINE_CONFIG_DESIGN.md) đã lập luận điều này cho tham số vận hành; ở đây áp cho tag — *"đây là giao diện vận hành máy công nghiệp, không được để nhập mô-men ngoài dải an toàn"*.

**Lớp đè kế thừa nguyên tắc đã chốt:** `baseline` (khuyến nghị từ server) → `theo máy` → `theo máy × sản phẩm`. Mô hình linh kiện **không phá** mô hình này, nó bổ sung chiều *"tham số này thuộc linh kiện nào"*.

API mới: `GET/POST/PUT /v1/components`, `GET /v1/component-types`.

### 3.2 Tầng ② — Tag Namespace (SPINE)

Thay `mapping/*.json` placeholder bằng **compiler thật**. Mỗi tag:

| Trường | Ví dụ |
|---|---|
| `path` | `SCRW-01/spindle/torque` (nối vào ISA-95 URN của asset cha) |
| `dataType` / `unit` | `float` / `Nm` |
| `engMin` / `engMax` | `0` / `20` — dải kỹ thuật để widget vẽ gauge/scale không phải đoán |
| `access` | `r` / `rw` |
| `policyAction` | ~~`null` nếu chỉ đọc~~; `machine.setpoint` hoặc `machine.command` nếu ghi (§5) — xem ghi chú đè ngay dưới bảng |
| `source` | `{ kind: "modbus", unitId, register, scale }` / `{ kind: "opcua", nodeId }` / `{ kind: "mqtt", topic, jsonPath }` / `{ kind: "simulated" }` / `{ kind: "derived", expr }` |
| `quality` | `good` / `stale` / `bad` — **runtime bắt buộc hiển thị**, không được vẽ số như thể luôn tươi |

> 🔴 **GHI CHÚ ĐÈ (fix round 2, 2026-08-30) — hai ô của bảng trên không còn đúng với hợp đồng đã đóng
> băng. Nguyên văn giữ nguyên ở trên, không xoá.**
>
> **1. `policyAction`.** Bảng nói nguyên văn *"`null` nếu chỉ đọc"*. **Sai** kể từ phán quyết
> "không-null-tường-minh" (Task 4, ghi ở `contracts/README.md`): một document **không bao giờ** viết
> `null` tường minh — một property optional **vắng mặt CHÍNH LÀ** `null` của nó. Cả ba schema nay thi
> hành điều đó bằng máy (`{"enum": ["machine.setpoint","machine.command"]}`, không có `null` trong
> `enum`, không có `"type": [...,"null"]`), và `HmiContractJson.Options` phía .NET đặt `WhenWritingNull`
> nên bản tham chiếu C# **không thể** phát ra một null tường minh. Một tag chỉ đọc **bỏ hẳn khoá
> `policyAction`**; viết `"policyAction": null` là một tài liệu mà phía .NET không round-trip được.
> Câu đúng: *"`policyAction` VẮNG MẶT nếu chỉ đọc; `machine.setpoint` hoặc `machine.command` nếu ghi"*.
>
> **2. `quality`.** Hàng này **không có** trong `tag-namespace.schema.json` đã đóng băng, và đó là một
> **hoãn có chủ ý, không phải bỏ sót** — `quality` là trạng thái theo từng lần đọc, thuộc hợp đồng
> *giá trị sống* mà WS-HMI-0 sẽ định nghĩa, không thuộc một document tĩnh được lưu và version hoá. Lý do
> đầy đủ, cùng quyết định hoãn `alarms[]` của §3.1, ở `contracts/README.md` §"Trường được HOÃN có chủ ý".
> Yêu cầu "runtime bắt buộc hiển thị quality" **không** bị bỏ; nó chuyển chỗ.

Namespace publish lên UNS dưới dạng Sparkplug metric (hạ tầng WS-B đã có). API: `GET /v1/tags?machine=`, `GET /v1/tags/{path}`, `POST /v1/tags/subscribe` (SSE, tái dùng cơ chế `/v1/inspector/stream` đã có).

> ⚠️ **Giới hạn khai báo trước, không overclaim:** WS-HMI-0 định nghĩa và phục vụ namespace. Việc *mọi* driver hiện có nạp đủ tag vào đó là công việc của WS-HMI-0 giai đoạn 2 (Modbus + OPC-UA + simulated trước; MQTT/Serial sau). Bài học từ §3 của `MACHINE_CONFIG_DESIGN.md`: *"bảng này nói vựng từ nào được phục vụ, nó không nói giá trị có tác dụng"* — spec này phải phân biệt hai câu đó, và mỗi tag mang cờ `isBackedByDriver` được ghim bằng test.

### 3.3 Tầng ③ — HMI Builder

**Nguyên tắc trung tâm: "Sinh trước, tinh chỉnh sau" (generate-then-refine).** Không bắt kỹ sư vẽ từ trang trắng như FUXA/WinCC. Luồng:

```
Khai báo máy có linh kiện gì (§3.1)
        → Generator đọc cây linh kiện + luật template
        → SINH bộ màn hình: Overview · mỗi Module một màn · Alarm · Trend · Settings
        → Kỹ sư kéo-thả tinh chỉnh
        → Linter ISA-101 chấm điểm
        → Publish (có version, có duyệt, vào audit hash-chain)
```

Thành phần editor: canvas (kéo/snap/căn/z-order/nhóm), property panel, **tag picker duyệt cây namespace**, layer tree, undo/redo, preview theo breakpoint, publish/version/rollback.

**Indirect binding** — một faceplate phục vụ N instance. Faceplate `motor` khai tham số `{component}`; binding viết `{component}/speed` chứ không phải `SCRW-01/spindle/speed`. Đây là cơ chế khiến Ignition scale được và là điều kiện cần để "tùy vào linh kiện mà sinh màn hình" không biến thành copy-paste.

**Thư viện faceplate** (WS-HMI-3): 20–30 symbol SVG theo `ComponentType`, mỗi cái gồm *symbol* (nhỏ, đặt trên sơ đồ) + *detail popup* (đầy đủ readout/setpoint/alarm/trend của linh kiện đó).

### 3.4 Tầng ④ — HMI Runtime

**MỘT renderer React đọc JSON, KHÔNG sinh mã.** Lý do: codegen thì mỗi lần sửa màn hình phải build lại app — trái với mục tiêu "kỹ sư tại nhà máy tự sửa được".

Đích: browser + Tauri kiosk (quyết định #3). Ràng buộc kế thừa từ `HMI_DESIGN_SPEC.md §1`: **offline-only, font bundled, không CDN**. WPF `DesktopShell` giữ nguyên, không đụng trong v1.

**Nghiệm thu quyết định của tầng này:** viết lại **3 màn hard-code hiện tại thành JSON**, xoá bản React, **176 bài Playwright hiện có vẫn xanh** (gồm visual baseline). Nếu runtime không đủ mạnh làm việc này thì nó là đồ chơi, và ta biết điều đó ở tuần thứ 4 chứ không phải tháng thứ 6.

### 3.5 Tầng ⑤ — Governance & Safety

Xem §5. Tầng này **không phải mã mới** — là ràng buộc bắt buộc lên tầng ③④.

---

## 4. HỢP ĐỒNG SCHEMA — điều kiện tiên quyết của thi công song song

> 🔴 **Đây là hạng mục rủi ro cao nhất của cả đợt.** Quyết định #2 chọn hai nhánh song song; nếu schema đổi giữa chừng, cả hai nhánh phải làm lại. **Không nhánh nào được tách trước khi ba file dưới đây được duyệt và đóng băng.**

| File | Nội dung | Chủ sở hữu |
|---|---|---|
| `contracts/tag-namespace.schema.json` | Hình dạng tag + quality + source (§3.2) | Nhánh .NET đề xuất, cả hai duyệt |
| `contracts/component-model.schema.json` | `ComponentType` + cây asset (§3.1) | Nhánh .NET đề xuất, cả hai duyệt |
| `contracts/hmi-screen.schema.json` | Màn hình + widget + binding + layout (§3.3) | Nhánh web đề xuất, cả hai duyệt |

> 🔴 **BA FILE TRÊN ĐÃ ĐÓNG BĂNG, 2026-08-29, ở commit `9fb45a88`** (nhánh `feat/hmi-builder-moc0`) —
> lần sửa cuối trên cả ba file. Task 7 (Mốc 0, `.superpowers/sdd/2026-08-29-hmi-moc0-schema-freeze-blueprint/task-7-brief.md`)
> đóng đợt bằng cổng hợp nhất `node scripts/check-contracts.mjs`, chạy trên commit gate(contract) — xem
> `task-7-report.md` để có SHA thật của commit đó. Người chốt: chủ sở hữu, theo quyết định #2 của §1
> (song song hai nhánh, hợp đồng schema phải đóng TRƯỚC khi tách).
>
> **Khoản 2 dưới đây được thi hành bằng GHIM HAI CHIỀU, không phải bằng sinh mã (codegen).** Nguyên văn
> khoản 2 giữ nguyên bên dưới, không xoá — đây là ghi chú đè, theo đúng thói quen của kho này. Khoản 2 nói
> "Sinh kiểu hai chiều: C# record ⟷ TypeScript type **sinh** từ cùng một JSON Schema". Cái thật sự giao ở
> Mốc 0 là NGƯỢC LẠI theo nghĩa hẹp: type C# và TypeScript đều **viết tay**, không có bước sinh mã nào,
> và thứ ghim chúng lại với schema là hai bộ test đối chiếu tên property theo cả hai chiều
> (`tests/St4i.Hmi.Contracts.Tests`, `web/contract-tests/`) — thiếu bên nào cũng đỏ, tên property thiếu
> được nêu trong thông điệp lỗi. Lý do đổi hướng: viết một bộ sinh mã JSON-Schema→C#/TS đáng tin cậy cho
> đúng ba schema, với `if`/`then`/`oneOf`/`$ref` mà chúng dùng, là một hạng mục công cụ riêng có rủi ro và
> chi phí không nhỏ hơn việc viết tay 12 kiểu (record C# ⟷ type TS, đếm được: `TagNamespaceDocument`,
> `TagDescriptor`, `TagSource`, `ComponentModelDocument`, `ComponentNode`, `ComponentTypeDef`,
> `ComponentTagDef`, `ComponentStateDef`, `HmiScreenDocument`, `ScreenLayout`, `ScreenWidget`,
> `WidgetRect`) và ghim chúng — trong khi ghim hai chiều cho cùng một bảo đảm (schema và kiểu không lệch
> nhau) với ít mã hơn và không có công cụ sinh mã nào phải bảo trì. Đây là
> một quyết định có chủ ý của Mốc 0, không phải một khoản chưa làm kịp; xem `contracts/README.md` và
> README §25 để biết cách luật đóng băng này được thi hành trong thực tế.
>
> **Khoản 3 được đọc là "≥5 fixture trải trên BA schema", không phải "≥5 màn hình".** Nguyên văn khoản 3
> giữ nguyên bên dưới, không xoá — lại là một ghi chú đè. Khoản 3 nói *"≥5 **màn hình mẫu** JSON nằm
> trong repo"*, tức năm **screen**. Cái thật sự giao là **5 fixture `valid/` + 6 fixture `invalid/`**
> trải trên cả ba schema, trong đó chỉ **HAI** là màn hình (`screen-overview-minimal.json`,
> `screen-screwdrive-full.json`); ba fixture `valid/` còn lại là tag namespace (×2) và component model
> (×1). Lý do đọc rộng ra như vậy: Mốc 0 phải chứng minh **cả ba** schema đọc/ghi được ở cả hai phía, và
> một corpus năm-màn-hình-không-có-tag-nào sẽ để hai schema kia hoàn toàn không được ví dụ nào chạm tới.
>
> **Nói thẳng cái giá của cách đọc ấy: hai màn hình là MỎNG cho đội runtime.** Corpus hiện tại chưa có
> ví dụ nào cho `alarm-list`, `sheet`, `kpi-tile`, `state-badge`, `line-state`, `gauge`, `status-lamp`
> — tức là hơn nửa danh sách `kind` chưa từng xuất hiện trong một tài liệu thật, và `breakpoint`
> `tablet`/`phone` cũng chưa. Đội WS-HMI-1 sẽ gặp các hình dạng ấy lần đầu **trong lúc viết renderer**,
> không phải trong một fixture. **Mở rộng bộ màn hình mẫu là việc ĐẦU TIÊN của WS-HMI-1**, và nó không
> phải một khoản trang trí: mỗi màn hình mẫu mới chạy qua đúng hai bộ ghim đã có mà không cần thêm một
> dòng hạ tầng test nào.

Ràng buộc bắt buộc:
1. **`schemaVersion` là trường bắt buộc** trong mọi document — màn hình lưu hôm nay phải đọc được sau 3 năm.
2. **Sinh kiểu hai chiều:** C# record ⟷ TypeScript type sinh từ **cùng một** JSON Schema, ghim bằng test ở CẢ HAI phía. Đây là bài học trực tiếp từ khuyết tật `MachineConfigDesignDocTableTests` — bảng tài liệu và mã lệch nhau suốt nhiều tháng vì *"không gì ghim chúng với nhau"*.
3. **Bộ fixture chung:** ≥5 màn hình mẫu JSON nằm trong repo, cả hai nhánh chạy test trên đúng bộ đó. Đây là thứ phát hiện drift trong ngày, không phải trong tháng.
4. Trước khi tách nhánh: **một phiên chốt schema chung**, kết thúc bằng commit đóng băng ba file.

---

## 5. Ràng buộc AN TOÀN — bất di bất dịch

Kế thừa nguyên văn posture đã có trong README §1 và `PolicyEngine`. **Đây không phải khuyến nghị.**

1. **Không có đường ghi không gác.** Mọi widget ghi khai một `policyAction`; runtime **không** gọi thẳng thiết bị mà đi qua `POST /v1/machines/{code}/setpoint` (Engineer) hoặc `.../command` (Admin), tức là qua `PolicyEngine.Evaluate` default-deny. Builder **không có** cách nào tạo widget bỏ qua bước này — đây là bất biến được ghim bằng test, không phải quy ước.

   > Chú thích trong `PolicyRequest.cs` đã thiết kế sẵn cho tình huống này: *"Deliberately transport-agnostic so a future non-HTTP command path can build the same request and be gated by the same rules (the 'no back-door')"*. HMI Builder chính là "future command path" đó. **Không cần cổng an toàn mới.**

2. **HALT giữ nguyên bản chất.** HALT là **chốt phần mềm giám sát**, không phải mạch an toàn ISO 13849 Cat 3/4. HALT **không bao giờ** đi đường ghi. Widget ghi bị `EstopGuardRule` từ chối khi HALT đang cài. Builder **không được** cho tạo widget đặt tên/tạo hình như nút dừng khẩn cấp thật — đây là một luật của linter §6, mức **error**, chặn publish.

   Bối cảnh: đợt SM-4 đã đổi tên "E-STOP" → "HALT" chính vì lý do này. Builder không được phép làm hỏng lại điều đó.

3. **Alarm nguy cấp chặn ghi.** `CriticalAlarmGuardRule` đã có, áp nguyên cho widget.

4. **Mọi lệnh ghi và mọi lần publish màn hình vào audit hash-chain.** Đây cũng là thứ đáp ứng yêu cầu audit trail kiểu 21 CFR Part 11 nếu khách cần.

5. **`security-review` là cổng bắt buộc** trước khi merge bất kỳ nhánh nào chạm đường ghi (WS-HMI-1 và WS-HMI-2).

---

## 5-bis. ĐIỀU KIỆN BÁN ĐƯỢC CHO MỘT MÁY — bất biến thứ hai

> 🔴 **Đây là bất biến ngang hàng với §5, không phải mục "nice to have".** Lịch sử repo đã chứng minh chi phí của việc quên nó: GĐ1 từng được đánh dấu **XONG**, rồi một audit độc lập phát hiện sản phẩm **vẫn không bán được cho khách chỉ mua 1 máy** — đội hình mặc định vẫn fabricated ở cả hai host, dữ liệu demo trộn vô hình vào KPI khách hàng, màn "Connect ecosystem" chặn toàn trang. Phải mở lại thành **Đợt A (SM-1→SM-6)**, rồi `task-7` còn phát hiện chính Đợt A đã làm hỏng bản demo mà nó tự nhận "không đụng tới". **HMI Builder không được lặp lại vòng đó.**

Khách hàng tham chiếu của mọi quyết định trong đợt này: **một nhà máy mua ĐÚNG MỘT máy, không mua hệ sinh thái, không có mạng ra ngoài.** Người đó phải có sản phẩm hoàn chỉnh.

| # | Bất biến | Nghiệm thu (mỗi WS phải chứng minh lại) |
|---|---|---|
| **S1** | **Zero-config phải chạy được.** Khách 1 máy, chưa vẽ gì, vẫn phải có HMI dùng được — sinh từ tag map của connector | Cài mới → cắm 1 máy Modbus thật → có màn hình vận hành **không cần mở editor một lần nào** |
| **S2** | **Không có màn chặn.** Chưa thiết kế màn hình ≠ trang trắng, ≠ nag, ≠ chặn toàn trang. Standalone là **trạng thái sản phẩm hợp lệ** (SM-3 đã chốt) | Không tồn tại đường dẫn nào mà thiếu cấu hình HMI làm chặn Dashboard/Machines/HMI |
| **S3** | **Không rò dữ liệu demo.** Screen pack / faceplate / máy mẫu dạng demo mang provenance và bị loại khỏi truy vấn khách hàng đúng như cơ chế `is_fabricated` + `ProvenanceTag` đã có | Bản khách: 0 dòng demo. Bản demo (`ST4I_DEMO_ENABLED`): hiện đủ — **kiểm CẢ HAI CHIỀU** (đây chính là chỗ `task-7` bắt được lỗi Critical) |
| **S4** | **Offline tuyệt đối.** Không chức năng nào của builder/runtime cần Site, Synapse, hay Internet. Font bundled, không CDN, không telemetry ra ngoài | Rút mạng → thiết kế, publish, vận hành, xuất báo cáo đều chạy |
| **S5** | **Bền qua restart, cài qua MSI sẵn có.** Màn hình lưu SQLite phía EngineApi, **không** lưu `localStorage` trình duyệt | Restart dịch vụ + reset trình duyệt → màn hình còn nguyên |
| **S6** | **Seam license, chưa bật license.** Builder nằm sau cờ `capabilities` để `WS-E` bật Edition sau này không phải sửa kiến trúc (quyết định #4 của roadmap cũ) | Cờ tồn tại, mặc định mở, có test |
| **S7** | **Đặt tên trung thực.** Một máy thì gọi đúng là một máy. Không gọi sản phẩm là "SCADA server"/"nhà máy" khi nó đang chạy một máy — cùng nguyên tắc đã buộc đổi "E-STOP" → "HALT" ở SM-4 | Rà chữ trước mỗi merge; linter §6 bắt widget đặt tên vượt quá năng lực thật |

**Hệ quả lên kế hoạch — hai điều chỉnh thật, không phải khẩu hiệu:**

1. **`WS-HMI-3` (Generator) nâng từ P1 lên P0.** Nếu khách 1 máy phải tự vẽ màn hình mới có cái dùng, thì S1 hỏng. Generator **là** điều kiện bán được, không phải tính năng cao cấp. Thư viện faceplate 20–30 symbol vẫn có thể giao dần, nhưng **đường sinh màn hình mặc định phải xong cùng lúc với editor**.
2. **`WS-HMI-5` (cầu nối hệ sinh thái) xác nhận là P1 và tách hẳn.** Không một dòng nào của HMI-0/1/2/3 được phép phụ thuộc vào nó. Đây là thứ chứng minh S4.

---

## 6. ISA-101 — giải mâu thuẫn "chuẩn công nghiệp" ⟷ "đẹp, hiện đại"

Nghiên cứu: ISA-101 / ASM Consortium quy định **nền xám, màu CHỈ dành cho bất thường** — thiết bị chạy bình thường vẽ xám trung tính, màu chỉ xuất hiện khi có alarm, chạm ngưỡng, đổi mode, hoặc người vận hành ra lệnh. Số liệu công bố: giảm 38–42% thời gian ack alarm nguy cấp, giảm 30–50% thời gian đào tạo.

Điều này **mâu thuẫn trực tiếp** với `HMI_DESIGN_SPEC.md` hiện tại (navy ST4I làm accent thương hiệu). Giải bằng **hai chế độ song song trên cùng hệ token**, không phải chọn một:

| Theme | Mục đích | Trạng thái |
|---|---|---|
| `isa101` | **Mặc định cho máy sản xuất.** Nền xám, màu chỉ cho bất thường, tuân thủ được | **Mới** — thêm `[data-theme="isa101"]` vào `web/src/index.css` cạnh `glass`/`console`/`warmth` |
| `blueprint` | Showroom, triển lãm, khách muốn thương hiệu | Là `HMI_DESIGN_SPEC.md` hiện có, giữ nguyên |

**ISA-101 linter (WS-HMI-4)** — chấm điểm trong editor **trước khi publish**. Luật (mức `error` chặn publish / `warn` cảnh báo):

| Luật | Mức |
|---|---|
| Dùng màu trạng thái (`--status-run/warn/fault`) để trang trí, không mang nghĩa trạng thái | error |
| Widget số thiếu đơn vị hoặc thiếu dải kỹ thuật | error |
| Widget trông giống nút dừng khẩn cấp thật (§5.2) | error |
| Tương phản dưới WCAG AA | error |
| Vùng chạm < 44px trên breakpoint panel/tablet | error |
| Quá N màu phi-trạng thái trên một màn | warn |
| Màn hình không có đường tới trạng thái alarm | warn |
| Tag `quality` không được hiển thị ở đâu | warn |

Không nền tảng nào trong 4 ông lớn khảo sát có linter ISA-101 tích hợp editor. **Đây là điểm bán hàng thật.**

---

## 7. Kế hoạch — 7 workstream

Đánh số nối tiếp roadmap hiện có. Không đụng GĐ1/GĐ2 đã đóng.

### Mốc 0 — Chốt schema (điều kiện tiên quyết, KHÔNG song song)
Ba file §4 + bộ fixture chung + sinh kiểu hai chiều. **Mọi nhánh chờ mốc này.**

### Nhánh A (.NET) và Nhánh B (web) chạy song song sau mốc 0

| WS | Nhánh | Nội dung | Nghiệm thu |
|---|---|---|---|
| **HMI-0** Spine | A | `ComponentType` + cây linh kiện (mở rộng `AssetRegistryStore`) + Tag Namespace + compiler thay `mapping/*.json`; `/v1/components`, `/v1/component-types`, `/v1/tags`, SSE subscribe. Nạp tag từ Modbus + OPC-UA + simulated | Cắm 1 thiết bị Modbus thật, tag hiện trong namespace với `quality` đúng, đổi giá trị thấy đổi qua SSE. Cờ `isBackedByDriver` được ghim bằng test |
| **HMI-1** Runtime | B | Renderer JSON + ~15 widget lõi + binding engine + theme `isa101` | **Viết lại 3 màn hard-code thành JSON, xoá bản React, 176 bài Playwright vẫn xanh** |
| **HMI-2** Editor | B | Canvas, property panel, tag picker, layer tree, undo/redo, preview, publish/version/rollback | Kỹ sư tạo màn mới cho một máy chưa từng có, không viết một dòng mã |
| **HMI-3** Faceplate + Generator | A+B | 20–30 symbol theo `ComponentType` + luật template + wizard "sinh màn hình từ máy" | Khai báo máy 12 linh kiện → sinh bộ màn dùng được ngay, điểm linter ≥ ngưỡng. **Và S1: khách 1 máy chưa mở editor lần nào vẫn có HMI vận hành được** |
| **HMI-4** Linter ISA-101 + a11y | B | Rules engine §6 + điểm số + cổng CI, nối vào bộ Playwright visual/axe sẵn có | Màn vi phạm bị chặn publish; bộ test hiện có không hồi quy |
| **HMI-5** Cầu nối hệ sinh thái | A | Xuất/nhập screen pack; publish màn hình qua UNS/config-sync để Synapse render **cùng một HMI**; màn hình thành feature tính license (nối `WS-E`) | Màn thiết kế tại máy hiện đúng trong Synapse, không sửa tay |
| **HMI-6** Visual connector mapper | B | Đóng khoảng trống "CHƯA có visual mapper" của `/connectors`, tái dùng canvas HMI-2 | Onboard 1 thiết bị Modbus mới hoàn toàn bằng UI |

**Ưu tiên:** HMI-0/1/2 **và đường sinh màn hình mặc định của HMI-3** là **P0** (§5-bis hệ quả 1); phần còn lại của HMI-3 + HMI-4/5 là **P1**; HMI-6 là **P2**.

**Mỗi WS đóng lại bằng một checklist §5-bis** — bảy bất biến S1–S7 chứng minh lại, không nhận báo cáo cũ. Đây là bài học `task-7`: bằng chứng "demo không đổi" của SM-2 chỉ xét KPI fleet sống, chưa xét mặt historian/OEE/report, nên lỗi Critical lọt qua.

### Phân công AI Agent (sau khi duyệt)

| Việc | Agent | Ghi chú |
|---|---|---|
| Blueprint mỗi WS lớn | `feature-dev:code-architect` | Trước khi code, đúng như §7 roadmap cũ đã làm |
| Chốt schema (mốc 0) | `feature-dev:code-architect` | **Một agent duy nhất**, không song song — đây là điểm hội tụ |
| .NET (HMI-0, HMI-5) | `general-purpose` + `superpowers:test-driven-development` | Mỗi WS một worktree |
| Web runtime/editor (HMI-1/2/4/6) | `frontend-design` + `general-purpose` | Giữ design system/i18n/theme hiện có |
| Faceplate library (HMI-3) | `frontend-design` | Cần nhất quán thị giác |
| **Rà soát an toàn** | `security-review` | **BẮT BUỘC** trước merge HMI-1 và HMI-2 |
| Review trước merge | `feature-dev:code-reviewer` | Mọi WS |

Quy trình: `superpowers:writing-plans` → `superpowers:subagent-driven-development`, mỗi WS một worktree, review giữa các task — đúng cách các đợt A/B/C đã chạy.

---

## 8. Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | **Schema drift giữa hai nhánh song song** | 🔴 Cao | Mốc 0 chặn cứng; sinh kiểu hai chiều; fixture chung; test ghim ở cả hai phía (§4) |
| R2 | Runtime JSON không đủ mạnh, phải quay lại viết tay | 🔴 Cao | Nghiệm thu HMI-1 (viết lại 3 màn cũ) đặt ở **tuần thứ 4**, không phải cuối |
| R3 | Widget ghi mở đường lách qua Policy | 🔴 Cao | §5 bất biến + test ghim + `security-review` bắt buộc |
| R4 | Editor phình thành Figma | 🟡 Vừa | YAGNI: v1 **không có** animation timeline, không script tuỳ ý, không nhúng iframe |
| R5 | Tag Namespace phục vụ vựng từ nhưng driver không nạp thật (đúng khuyết tật `IsConsumedBySimulator` đã có) | 🟡 Vừa | Cờ `isBackedByDriver` + test đỏ theo cả hai chiều (§3.2) |
| R6 | Thư viện faceplate không nhất quán | 🟡 Vừa | Một agent `frontend-design` làm trọn HMI-3, không chia nhỏ |
| R7 | Bộ 176 bài Playwright hồi quy | 🟢 Thấp | Chạy toàn bộ ở mỗi mốc, không lấy báo cáo cũ (bài học Đợt A) |
| R8 | **Lặp lại vòng Đợt A: xong tính năng nhưng khách 1 máy vẫn không dùng được** | 🔴 Cao | §5-bis S1–S7 là checklist đóng WS, kiểm **cả hai chiều** khách/demo; Generator nâng lên P0 |

---

## 9. Ngoài phạm vi v1 (khai báo tường minh)

- WPF `DesktopShell` render HMI mới (quyết định #3 — v1 không đụng)
- Editor 3D / digital twin (`FactoryLiveMap3D` bên Synapse đã có, không nhân bản)
- Scripting tuỳ ý trong màn hình (rủi ro an toàn + rủi ro bảo mật; chỉ có biểu thức binding hạn chế)
- OPC UA Companion Spec (Machinery/PackML/MTP) — đề xuất cho GĐ4
- HMI Builder chạy trên Synapse (quyết định #1 — Synapse là consumer qua HMI-5)
- Serial/RS-485 nạp tag (còn nợ từ GĐ2 `WS-H1`, không kéo vào đợt này)

---

## 10. Câu hỏi còn mở (không chặn khởi công)

1. `ComponentType` là **dữ liệu** (sửa qua UI, lưu SQLite) hay **mã** (khai trong C#, deploy mới đổi)? Đề xuất: **dữ liệu**, có bộ seed mặc định — nhưng để agent kiến trúc phản biện ở mốc 0.
2. Thư viện faceplate v1 phủ những `ComponentType` nào cụ thể? Chốt danh sách khi bắt đầu HMI-3, dựa trên `fleet.json` thật của khách đầu tiên.
3. Ngưỡng điểm linter ISA-101 để chặn publish — đặt bao nhiêu? Đề xuất khởi đầu **cảnh báo, không chặn** trong HMI-4, bật chặn sau một đợt dùng thật.

---

## 11. Nguồn nghiên cứu (29/08/2026)

- [Top 10 SCADA Software Platforms Ranked for 2026 — iFactory](https://ifactoryapp.com/blog/top-scada-software-platforms)
- [Ignition SCADA Alternatives in 2026 — Anexee](https://www.anexee.com/blog/ignition-scada-alternatives-augment-replace-2026)
- [ISA-101 Standards — ISA](https://www.isa.org/standards-and-publications/isa-standards/isa-101-standards)
- [ISA-101 High Performance HMI Design: Color Strategy — Industrial Monitor Direct](https://industrialmonitordirect.com/blogs/knowledgebase/isa-101-high-performance-hmi-design-principles-color-strategy)
- [HMI Design Best Practices: ISA-101 Principles for 2026 — iFactory](https://ifactoryapp.com/blog/hmi-design-best-practices)
- [FUXA — Web-based Process Visualization (SCADA/HMI/Dashboard)](https://github.com/frangoteam/FUXA)
- [FUXA, Node-RED, and Modbus as an Open-Source SCADA Stack — ZedIoT](https://zediot.com/blog/fuxa-node-red-modbus-open-source-scada-stack/)
- [Building Reusable Symbol Templates in Ignition Perspective — Industrial Monitor Direct](https://industrialmonitordirect.com/blogs/knowledgebase/building-reusable-symbol-templates-in-ignition-perspective)
- [Templates in Ignition Perspective — Corso Systems](https://corsosystems.com/posts/templates-in-ignition-perspective)
- [FactoryTalk Optix Portfolio — Rockwell Automation](https://www.rockwellautomation.com/en-us/solutions/hmi/optix.html)
- [FactoryTalk Optix in 2026: modern HMI, edge connectivity and scalable runtime licensing — ROTEC](https://rotec.bg/media-centrum/news/factorytalk-optix-in-2026-modern-hmi-edge-connectivity-and-scalable-runtime-licensing/)
- [Unified Namespace (UNS) Architecture: Definitive 2026 Guide — Anexee](https://www.anexee.com/blog/unified-namespace-uns-architecture-industrial-2026)
- [Unified Namespace: MQTT, Sparkplug B, ISA-95 flattening — TEEPTRAK](https://teeptrak.com/en/unified-namespace-uns-mqtt-sparkplug-iiot-2027/)
- [Guidelines for applying FactoryTalk AssetCentre in a 21 CFR part 11 environment — Rockwell](https://literature.rockwellautomation.com/idc/groups/literature/documents/wp/ftalk-wp001_-en-p.pdf)
