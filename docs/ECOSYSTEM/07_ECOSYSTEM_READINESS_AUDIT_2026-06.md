# BÁO CÁO RÀ SOÁT & ĐÁNH GIÁ MỨC ĐỘ SẴN SÀNG "HỆ SINH THÁI NHÀ MÁY THÔNG MINH"
### Trả lời 4 câu hỏi: (1) Bug sidebar OT · (2) Độ phủ máy & chuẩn dữ liệu · (3) Master data · (4) Frontend & phân cấp người dùng
**Ngày:** 2026-06-28 · **Phương pháp:** 4 AI Agent rà soát read-only, bám file:line · **Trạng thái:** ⏳ Chờ anh/chị duyệt trước khi gọi Agent chuyên môn thực thi

> Báo cáo này CHƯA sửa/đổi mã nguồn. Mỗi phần nêu **sự thật hiện trạng (có dẫn chứng file:line)** + **khoảng trống** + **khuyến nghị ưu tiên**. Sau khi anh/chị duyệt, các hạng mục sẽ được giao cho Agent chuyên môn thực thi theo lộ trình.

---

## TÓM TẮT ĐIỀU HÀNH

| Câu hỏi | Kết luận ngắn | Mức độ |
|---|---|---|
| **① Bug mất sidebar (OT/Machine Control)** | Đã tìm ra **đúng nguyên nhân gốc**: 6 trang OT không render `<DashboardLayout>` (app dùng layout-per-page). Fix rõ ràng, rủi ro thấp. | 🔴 Sửa ngay |
| **② Độ phủ máy & chuẩn dữ liệu** | Mạnh ở **OT/PLC (5 driver thật)** + **AOI/AVI inspection**; nhưng 15/17 loại máy dùng chung 2 schema generic, robot toàn scaffold, **thiếu SECS/GEM, MTConnect, adapter vision đa hãng**. | 🟡 Khá — còn nhiều gap |
| **③ Master data** | **Mảng chất lượng/đo lường xuất sắc**; nhưng **MES/chuỗi cung ứng còn mỏng** — thiếu master Vật tư/NCC/Khách hàng/Kỹ năng/Dụng cụ; **RLS đa-tenant chưa kích hoạt**. | 🟡 Đủ cho quality-centric, **chưa đủ** cho MOM toàn diện |
| **④ Frontend & phân cấp người dùng** | **Bề rộng hệ sinh thái tốt** (125 trang, RBAC, i18n, kiosk, lớp AI push) nhưng **chưa phân hoá trải nghiệm theo cấp độ**: mọi role vào cùng 1 trang marketing, chỉ ẩn/hiện menu. | 🟡 Khá — thiếu "cửa trước" theo vai trò |

**Thông điệp chính:** Nền tảng có **chiều sâu chất lượng + lớp AI hiện đại** đáng kể, nhưng để thành **hệ sinh thái nhà máy hoàn chỉnh** còn 3 khoảng trống lớn: (a) **trừu tượng hoá thiết bị đa-hãng** (vision + robot + chuẩn CNC/semiconductor), (b) **master data MES/chuỗi cung ứng**, (c) **trải nghiệm frontend theo vai trò/cấp độ**.

---

# ① BUG: MẤT SIDEBAR KHI VÀO OT / MACHINE CONTROL

## Nguyên nhân gốc (đã xác nhận)
App dùng kiểu **layout-per-page**: `App.tsx` KHÔNG bọc route trong layout; mỗi trang tự render `<DashboardLayout>` làm gốc. **6 trang OT không render `<DashboardLayout>`** → mất toàn bộ vỏ app (sidebar + header).

- Trang ĐÚNG (có layout): `MachineStatusMonitor.tsx:415`, `Dashboard.tsx:1050`, `AIHub.tsx:80`, `TechnicianCopilot.tsx:212`…
- Trang LỖI (bare `<div className="p-6">`, không layout):

| Route | Component | File |
|---|---|---|
| `/andon` | AndonBoard | `client/src/pages/AndonBoard.tsx:62` |
| `/device-adapters` | DeviceAdapterManagement | `DeviceAdapterManagement.tsx:174` |
| `/command-audit` | CommandAuditLog | `CommandAuditLog.tsx:65` |
| `/recipes` | RecipeManagement | `RecipeManagement.tsx:156` |
| `/interlock-rules` | InterlockRuleManagement | `InterlockRuleManagement.tsx:224` |
| `/bom-management` | BomManagement | `BomManagement.tsx` (nhiều nhánh return) |

> KHÔNG phải do license-gate hay ErrorBoundary — license chỉ lọc *item trong* layout đã render (`DashboardLayout.tsx:261-270`); không thể "gỡ" một layout mà trang chưa hề render. `AIPageWrapper` chỉ là ErrorBoundary+Suspense, không cấp sidebar.

## Khuyến nghị sửa (chưa áp dụng)
- **Fix nhanh (rủi ro thấp, khuyến nghị):** bọc JSX gốc của 6 trang trong `<DashboardLayout currentPath="/...">`, **kể cả các nhánh return loading/empty/error sớm** (vd `BomManagement.tsx:34,46,103`) để sidebar không nhấp nháy mất. Truyền đúng `currentPath` để auto-highlight + mở nhóm OT.
- **Fix bền vững (lớn hơn):** chuyển layout lên cấp route trong `App.tsx` (1 `<AppShell>` bọc toàn bộ route đã đăng nhập) — chống tái diễn cho mọi trang mới, nhưng đụng ~100 trang. *Đề xuất: làm fix nhanh trước, cân nhắc refactor sau.*
- **Phòng ngừa:** thêm test/lint khẳng định mọi routed-page render `DashboardLayout`.

**Vấn đề phụ:** trang OT lazy-load nhưng route bằng `component={…}` (thiếu Suspense boundary như AI pages) → nên đồng bộ khi sửa.

---

# ② ĐỘ PHỦ MÁY & CHUẨN DỮ LIỆU

## Sự thật cốt lõi
**"Có giá trị enum" ≠ "ingest dữ liệu thật".** Không có nhánh `switch(machineType)` cho ingest — **mọi loại máy dồn qua 2 đường generic**: schema *inspection* (`product_inspections`+`measurement_results`) và *process telemetry* (`process_results`). Khác biệt theo loại chỉ là cờ `capabilities` JSON (advisory), không phải hành vi.

### Ma trận độ phủ loại máy (17 loại)
| Nhóm | Loại | Ingest thật? | Adapter riêng | HW thật |
|---|---|---|---|---|
| Inspection | AOI, AVI | ✅ ZIP package + REST + MQTT | ❌ generic | ✅ qua edge agent |
| Inspection | SPI, AXI, ICT, FCT, CMM | ✅ qua inspection API (có cột 3D/solder/x-ray) | ❌ generic | ⚠️ generic |
| Automation | AUTOMATION | ✅ OT telemetry | ✅ **OT adapters thật** | ✅ OPC-UA/Modbus |
| Generic | FEEDER, ASSEMBLY, SCREWDRIVE, DISPENSING, ICT_FUNC, ROBOT_TEST, PACKAGING, PALLETIZER | ✅ process_results | ❌ | ⚠️ generic |
| Robot | ROBOT (bảng riêng) | ⚠️ subsystem riêng | ✅ scaffold | ❌ chỉ `sim` |

### Chuẩn dữ liệu / giao thức
| Chuẩn | Hỗ trợ? | Độ chín | Dẫn chứng |
|---|---|---|---|
| **MQTT** | ✅ | **Thật** (broker Aedes nhúng + client) | `mqttService.ts:12-20` |
| **Sparkplug B** | ✅ | **Thật (chỉ publish)** — NBIRTH/DBIRTH/DDATA; **không có NCMD/DCMD** (điều khiển 1 chiều) | `uns/sparkplugNode.ts:38-60` |
| **OPC-UA** | ✅ | **Driver thật** (read + write có gate) | `ot/drivers/opcuaDriver.ts:40` |
| **Modbus TCP** | ✅ | **Thật** | `ot/drivers/modbusDriver.ts:61` |
| **Siemens S7** | ✅ | **Thật** | `ot/drivers/s7Driver.ts` |
| **Mitsubishi MELSEC MC** | ✅ | **Thật** | `ot/drivers/mitsubishiMcDriver.ts` |
| **EtherNet/IP (CIP)** | ✅ | **Thật** | `ot/drivers/ethernetIpDriver.ts` |
| **SECS/GEM (SEMI E5/E30)** | ❌ | **Thiếu** (chỉ trong doc) | — |
| **MTConnect (CNC)** | ❌ | **Thiếu** | — |
| **PackML (ISA-TR88)** | ❌ | Thiếu | — |

**Robotics:** 3 bảng thật (`robots`/`robot_telemetry`/`robot_jobs`), registry/telemetry/job log hoạt động — nhưng **4 driver hãng (Fanuc/Mitsubishi/Delta/Techman) đều scaffold**, chỉ `sim` chạy; điều khiển dry-run trừ khi `ROBOT_CONTROL_ENABLED`. AGV có enum `agv` nhưng **không có VDA 5050**.

**AOI/AVI:** schema `measurement_results` **trung lập-hãng & mở rộng được** (point/value/result/image + cột 3D + bbox defect + `variantPayload`). NHƯNG định dạng gói là **ZIP + meta.json độc quyền** của agent nội bộ; **không có lớp adapter cho vision hãng thứ ba** (Cognex/Keyence/Koh Young/TRI/Omron) — đối lập với OT có `driverRegistry` sạch.

**Time-series:** 4 hypertable TimescaleDB (`ot_telemetry`/`oee_metrics`/`machine_heartbeats`/`process_results`) có compression; **retention policy đang comment-out**; `robot_telemetry` chưa phải hypertable.

## Khuyến nghị ưu tiên
- **P1 — Lớp adapter Vision đa-hãng** (gương `ot/driverRegistry.ts`): importer Cognex/Keyence/Koh Young/TRI/Omron → đổ vào `measurement_results` sẵn có. *Đây là gap lớn nhất vì nền tảng lấy inspection làm trung tâm.*
- **P1 — MTConnect ingestion** (HTTP/XML, mở) → mở khoá CNC/máy công cụ + bù enum CMM.
- **P2 — Nối thật 1 hãng robot** (Techman/Fanuc) đầu-cuối để kiểm chứng đường dry-run→live (schema/dispatcher/HITL đã sẵn).
- **P2 — SECS/GEM** nếu nhắm thị trường bán dẫn (công sức lớn nhất).
- **P3 — VDA 5050 (AGV/AMR)**; `robot_telemetry`→hypertable; Sparkplug NCMD/DCMD (điều khiển qua UNS).

---

# ③ MASTER DATA — ĐỦ CHO HỆ SINH THÁI CHƯA?

**Verdict:** Master data **chất lượng/đo lường xuất sắc**; **MES/MOM & chuỗi cung ứng mỏng**; thiếu ~8–10 thực thể master kinh điển (ISA-95). **Đủ cho nhà máy quality-centric, CHƯA đủ cho MOM đa-lĩnh vực.**

### Kiểm kê master data (~129 bảng)
| Lĩnh vực | Thực thể tiêu biểu | Độ đầy đủ |
|---|---|---|
| **Phân cấp tài sản** | corporates→factories→workshops→productionLines→stations→machines→workstations | **Giàu** (ISA-95 6 cấp) |
| **Sản phẩm/Chất lượng** | productModels, measurementPointDefs(+versions/templates), measurementTypeCatalog, defectCatalog, samplingPlans, spcConfigurations, qualityGates | **Giàu** |
| **Đo lường/MSA** | measurementInstruments, instrumentCalibrations, instrumentMsaRecords, msaStudies | **Giàu** |
| **MES/Process** | productionOrders(+templates), processes, lineStages, lineProcessAssignments, bomDefinitions/bomLineItems, feederMaterials, machineCapacity, shiftConfigs, productionSessions | **Một phần** |
| **WIP/Truy xuất** | wipTracking, componentInstallations, stationTraces, genealogyChain, measurementSamples | **Giàu** |
| **Người/Tổ chức/RBAC** | users, userRoles, permissions, user*Assignments | **Một phần** |
| **Bảo trì/Tài sản** | maintenanceSchedules, maintenanceWorkOrders, sparePartsInventory, pmEffectivenessMetrics | **Một phần** |
| **OT/Kết nối** | deviceAdapters, deviceTags, machineRecipes, recipeDeployments, commandLog, robots, MQTT profiles | **Giàu** |
| **Năng lượng** | energyReadings, enpiMetrics | **Một phần** (chỉ telemetry) |
| **Vật tư/NCC** | materialReceipts, supplierLots, lotDisposition — **không có supplier/material/inventory master** | **Mỏng** |

### Khoảng trống (ưu tiên)
**BẮT BUỘC (chặn hệ sinh thái đa-lĩnh vực):**
1. **Master Nhà cung cấp** (`suppliers`) — hiện chỉ là text `supplierCode` rải rác, không FK. Cần cho IQC, Pareto lỗi theo NCC, SCAR.
2. **Master Vật tư/Linh kiện** (`materials`) — cùng 1 linh kiện đang mô tả lại độc lập ở BOM/feeder/spares; thiếu MPN/package/MSL/RoHS.
3. **Master Khách hàng** (`customers`) — `productionOrders` không có FK khách hàng; returns/RMA chỉ là text.
4. **Master Kỹ năng/Chứng chỉ + năng lực thợ** — `users` chỉ có `position` text; **không gate được** `operatorId`/work-order theo trình độ (yêu cầu IATF/MOM).
5. **Master Dụng cụ/Đồ gá/Vật tư tiêu hao** (nozzle/stencil/lens/jig) — **không có**; chỉ có spare parts.
6. **Kích hoạt RLS đa-tenant** — `tenantContext.ts` "STAGED — chưa nối"; RLS mới phủ mỗi `product_inspections`. Cột code đã có sẵn, chỉ thiếu enforcement.

**NÊN CÓ:** Master Đơn vị đo (UoM) + quy đổi; Lịch nhà máy/ca (ngày nghỉ/downtime kế hoạch); Equipment-class/spec template; Kho/vị trí/tồn kho; Routing theo sản phẩm (process-segment); Catalog cảnh báo/sự kiện; Đăng ký tài liệu/SOP có kiểm soát phiên bản.

### ISA-95
Khớp tốt: phân cấp thiết bị 6 cấp, product definition, production schedule/performance (`productionSessions` ghi rõ "ISA-95 Level 3"), genealogy vật liệu. Chưa khớp: **Material/Equipment-Class/Personnel-Class (skill) model**, Process-Segment library, routing đang theo-line thay vì theo-sản-phẩm.

---

# ④ FRONTEND — HỆ SINH THÁI & PHÂN CẤP NGƯỜI DÙNG

**Verdict:** Bề rộng hệ sinh thái **đạt chuẩn** (125 trang/11 nhóm domain, RBAC chi tiết, i18n vi/en/zh ~parity, kiosk, PWA, lớp AI push mạnh). NHƯNG **chưa phân hoá trải nghiệm theo cấp độ**: mọi role đăng nhập đều về **cùng 1 trang marketing `/`**, chỉ khác nhau ở **ẩn/hiện menu** — không có trang chủ theo vai trò, không có chế độ operator đơn giản, không progressive disclosure.

### Kiến trúc thông tin (IA)
- 11 nhóm nav (~70 route hiện trên sidebar) nhưng `App.tsx` đăng ký **125 trang/~150 route** → **~50 trang "mồ côi"** (chỉ vào được bằng deep-link): RoleBuilder, LicenseManagement, BackupRestore, ReportBuilder, AIBrainDashboard, MachineRegistration…
- Nhóm quá phẳng & rộng: nhóm AI 18 mục, nhóm Monitoring 13 mục → "bức tường link" với operator.

### Ma trận Vai trò × Trải nghiệm
| Role | Thấy gì | Phù hợp cấp độ? |
|---|---|---|
| **operator** | Trang marketing + TodayBriefing(operator) + sidebar dày; có helper tốt (MachineQuickScan/QuickIssueReport/voice) nhưng **không có shell operator đơn giản** | **MỘT PHẦN → KHÔNG** |
| **maintenance/kỹ thuật** | TodayBriefing + **TechnicianCopilot** (RCA 1-chạm) + machine-health/device-adapters/recipes | **TỐT (phục vụ tốt nhất)** |
| **quality_inspector** | TodayBriefing(quality) + SPC/Pareto/heatmap/annotation — **rải rác, không có "hàng đợi QC"** | **MỘT PHẦN** |
| **supervisor/manager** | TodayBriefing(KPI+ngoại lệ) + ManagementInsight; nhưng nhóm corporate là `requiredRole:admin` → supervisor không thấy | **MỘT PHẦN → TỐT** |
| **viewer / user** | Read-only/empty; `user` mới đăng ký gần như sidebar trống, **không onboarding** | **MỘT PHẦN** |
| **admin/IT** | Tất cả (bypass) | **TỐT** |

→ **Phân quyền (ai-thấy-gì) chắc & chi tiết. Phân hoá trải nghiệm theo trình độ thì YẾU** — chỉ giảm phức tạp bằng cách *ẩn bớt*, không trình bày bề mặt đơn giản hơn theo vai trò.

### UX theo cấp độ
- **Tốt:** kiosk mode (`?kiosk=1`), PWA, lớp AI push (TodayBriefing/ActionInbox/Copilot/QuickScan/voice), touch target 44px, accordion sidebar.
- **Thiếu:** kiosk **chỉ ẩn chrome**, không đổi *nội dung* sang layout operator đơn giản; **không progressive disclosure** (trang SPC/MSA/AdminSettings 10 mục hiện full-depth); **không onboarding in-app** (UserGuide nằm trong nhóm admin); **trang mặc định sau login là hero marketing** — không hợp làm màn làm việc hằng ngày.

### Khuyến nghị ưu tiên
1. **P0 — Redirect trang chủ theo vai trò:** operator→production-dashboard/`/operator`, maintenance→technician-copilot, quality→hàng đợi QC, manager→management-insight, admin→dashboard. (Dữ liệu theo-role đã có sẵn ở TodayBriefing.)
2. **P0 — Shell operator đơn giản** (touch/kiosk thật về *nội dung*): 4–6 nút lớn (quét máy / báo sự cố / trạng thái line / hỏi AI), gate theo role.
3. **P1 — Chia nhỏ nhóm mega + cho trang mồ côi 1 chỗ đứng** (Admin/Reports).
4. **P1 — Workspace riêng cho QC & supervisor** (hàng đợi kiểm tra; màn ngoại lệ/KPI; cho supervisor xem corporate phạm vi hẹp).
5. **P2 — Progressive disclosure (toggle cơ bản/nâng cao) + tour in-app**; **chuyển auth-guard vào router** (chống deep-link bypass lọc menu).

---

# LỘ TRÌNH KHẮC PHỤC ĐỀ XUẤT (để anh/chị duyệt → giao Agent chuyên môn)

| Ưu tiên | Hạng mục | Thuộc câu | Quy mô |
|---|---|---|---|
| **P0** | Fix sidebar 6 trang OT (bọc DashboardLayout + nhánh return) | ① | Nhỏ |
| **P0** | Redirect trang chủ theo vai trò + shell operator đơn giản | ④ | Vừa |
| **P1** | Lớp adapter Vision đa-hãng (driverRegistry cho inspection) | ② | Vừa–Lớn |
| **P1** | MTConnect ingestion (CNC) | ② | Vừa |
| **P1** | Master data MES: suppliers/materials/customers/skills/tools (+migration) | ③ | Lớn |
| **P1** | Chia nhỏ IA + workspace QC/supervisor + đưa trang mồ côi vào nav | ④ | Vừa |
| **P2** | Kích hoạt RLS đa-tenant (mở rộng policy) | ③ | Vừa |
| **P2** | Nối thật 1 hãng robot (Techman/Fanuc) | ② | Vừa |
| **P2** | Progressive disclosure + onboarding in-app + auth-guard router | ④ | Vừa |
| **P3** | SECS/GEM · VDA 5050 · Sparkplug NCMD/DCMD · UoM/calendar/inventory master · robot_telemetry hypertable | ②③ | Lớn (theo nhu cầu thị trường) |

> **Đề xuất thứ tự thực thi:** P0 (bug + cửa-trước-theo-vai-trò) trước → P1 (adapter vision + master MES + IA) → P2 → P3 theo định hướng thị trường (bán dẫn/CNC/AGV).

---

## CÂU HỎI CHO ANH/CHỊ (trước khi giao thực thi)
1. **Thị trường mục tiêu** để ưu tiên chuẩn dữ liệu: SMT/PCBA (đang mạnh) · CNC/máy công cụ (cần MTConnect) · bán dẫn (cần SECS/GEM) · kho/AGV (VDA 5050)? → quyết P1–P3.
2. **Mức master data** muốn bổ sung ngay: chỉ NCC+Vật tư (đủ IQC/genealogy) hay trọn bộ MOM (thêm Khách hàng/Kỹ năng/Dụng cụ/Kho)?
3. **Operator mode:** làm shell đơn giản riêng, hay chỉ redirect theo vai trò + dọn IA?
4. **RLS đa-tenant:** kích hoạt ngay (có nhiều khách/đa nhà máy) hay để sau?
5. Bắt đầu thực thi từ **P0** ngay tuần này chứ?

---

*(Báo cáo rà soát — chưa thực thi thay đổi mã nguồn. Chờ anh/chị duyệt/điều chỉnh ưu tiên để giao Agent chuyên môn triển khai.)*
