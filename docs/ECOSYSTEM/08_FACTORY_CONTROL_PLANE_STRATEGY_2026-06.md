# CHIẾN LƯỢC "CONTROL PLANE" NHÀ MÁY — Lập trình & Điều khiển máy phức tạp đa-loại trong một hệ sinh thái
### Hiện trạng · Phương án tối ưu (tích hợp vs phần mềm riêng) · Kế hoạch · Chuẩn & API thống nhất
**Ngày:** 2026-06-28 · **Trạng thái:** ⏳ Thiết kế chiến lược — chờ phê duyệt định hướng

> Nối tiếp [07_ECOSYSTEM_READINESS_AUDIT](./07_ECOSYSTEM_READINESS_AUDIT_2026-06.md). Câu hỏi cốt lõi: hệ thống đang ở đâu cho **quản lý máy tự động hoá / robotics / AOI-AVI / IoT / máy khác**, và nếu cần **lập trình + điều khiển máy phức tạp kết hợp tất cả loại** thì nên **tích hợp vào hệ hiện tại** hay **xây phần mềm riêng rồi upload**? → Bản này đưa ra phương án tối ưu + chuẩn + API thống nhất theo nguyên tắc hệ sinh thái.

---

# PHẦN 0 — HIỆN TRẠNG: ĐANG Ở MỨC NÀO?

## Mô hình 5 tầng tham chiếu (ISA-95 + ISA-88) để định vị
```
L4  ERP/Doanh nghiệp              ─ (ngoài phạm vi)
L3  MOM/MES + Phân tích + AI      ─ ★ HỆ THỐNG HIỆN TẠI sống ở đây (giám sát, chất lượng, AI)
L2  SCADA/Điều phối/HMI           ─ ◑ MỘT PHẦN (event bus, rules, command dispatcher, playbook)
L1  Điều khiển (PLC/CNC/Robot ctrl)─ ✗ KHÔNG (vẫn nằm trên controller của máy)
L0  Thiết bị/cảm biến/cơ cấu      ─ ✗ (phần cứng)
```

## Đánh giá theo từng mảng (thật, có dẫn chứng)

| Mảng | Kết nối/Thu thập | Điều khiển | Mức đạt |
|---|---|---|---|
| **AOI/AVI/SPI/AXI** | ✅ Rất mạnh: package ZIP + REST + adapter vision đa-hãng (P1a) + schema đo 3D/defect | ⚪ Chỉ chỉnh cấu hình/ngưỡng (HITL write-tools) | **L3 tốt; L2 cơ bản; L1 không** |
| **PLC/SCADA (AUTOMATION)** | ✅ 5 driver thật (OPC-UA/Modbus/S7/Mitsubishi-MC/EtherNet-IP) | ◑ Ghi tag **đơn lẻ** qua `commandDispatcher` (HITL, dry-run gate) | **L2 đọc tốt; ghi đơn-lệnh** |
| **Robotics** | ◑ Registry/telemetry/jobs; Techman driver khung (P2b) | ◑ Lệnh **đơn** qua `robotCommandDispatcher` (dry-run); 3 hãng còn scaffold | **L2 khung; L1 không** |
| **IoT/Telemetry** | ✅ MQTT broker + Sparkplug B (UNS) + TimescaleDB | ◑ Sparkplug NCMD/DCMD vừa nối (HITL dry-run) | **L2 telemetry mạnh** |
| **CNC/máy công cụ** | ◑ MTConnect khung (P1b) | ✗ | **L3 ingest; L1 không** |
| **Bán dẫn (SECS/GEM)** | ◑ Khung (P3a) | ✗ | Khung |
| **AGV/AMR** | ◑ VDA 5050 khung (P3b) | ◑ Order qua dispatcher (dry-run) | Khung |

## 🔴 Khoảng trống cốt lõi cho "lập trình & điều khiển máy phức tạp kết hợp"
Hệ thống hiện điều khiển ở mức **"một lệnh tới một máy"** (set param, start/stop, send recipe — đều HITL). Nó **CHƯA có**:
1. **Bộ điều phối chuỗi (sequencing/orchestration engine)** thời gian thực để phối hợp **nhiều máy khác loại** trong một quy trình (vd: AOI báo NG → robot gắp loại → băng tải chuyển → máy in lại → CNC gia công bù).
2. **Lớp "lập trình" quy trình** (visual workflow/recipe) để người dùng *soạn* logic phối hợp mà không code.
3. **Mô hình trạng thái thiết bị chuẩn** (PackML) + **interlock an toàn** xuyên máy.
4. **Tầng thời-gian-thực-cứng** — Node.js là **soft real-time** (GC pause), **không phù hợp điều khiển chuyển động/an toàn dưới mili-giây**.
5. **Digital twin/mô phỏng** để kiểm thử quy trình trước khi chạy thật.

> Kết luận: hệ thống là một **L3 (MOM+AI) xuất sắc + L2 cơ bản**. Để "lập trình & điều khiển máy phức tạp đa-loại" cần bổ sung **một Control/Orchestration Plane (L2 mạnh + cầu nối L1)** — đây là phần còn thiếu.

---

# PHẦN A — TRẢ LỜI CÂU HỎI: TÍCH HỢP HAY PHẦN MỀM RIÊNG?

## Không chọn cực đoan nào — chọn **HYBRID PHÂN TẦNG**: *"Soạn trong hệ sinh thái, Thực thi ở tầng điều khiển riêng"*

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **(a) Nhồi hết vào hệ hiện tại** (monolith Node.js điều khiển luôn) | Đơn giản, 1 chỗ | ❌ Node soft-real-time → **không an toàn cho điều khiển/chuyển động**; monolith khó scale; trộn giám sát với điều khiển vi phạm nguyên tắc tầng | **KHÔNG** (rủi ro an toàn + kiến trúc) |
| **(b) Phần mềm riêng biệt rồi "upload"** (silo tách rời) | Tách điều khiển | ❌ Tách rời → **mất tính hệ sinh thái** (dữ liệu/auth/UNS phân mảnh), khó vận hành 2 nguồn sự thật | **KHÔNG** (phá vỡ hệ sinh thái) |
| **(c) ⭐ HYBRID phân tầng** | ✅ Soạn/quản lý/giám sát **trong** hệ sinh thái; **thực thi** ở một **engine điều khiển chuyên dụng** (tách tiến trình, có thể khác runtime) + **edge runtime** cho thời-gian-thực; nối nhau qua **API + UNS thống nhất** | Phức tạp hơn 1 chút | **✅ TỐI ƯU** |

**Bản chất (c):** vừa "tích hợp" (cùng hệ sinh thái: 1 auth, 1 UNS, 1 API, 1 nguồn master-data) **vừa** "phần mềm riêng để xử lý rồi nạp lên" (một **Factory Orchestration Engine** tách biệt + **edge control runtime**). Người dùng **lập trình quy trình bằng visual editor trong nền tảng → biên dịch → deploy xuống engine/edge để chạy**. Đó chính là kết hợp đẹp nhất của cả 2 lựa chọn anh/chị nêu.

---

# PHẦN B — KIẾN TRÚC ĐÍCH: "CONTROL PLANE" PHÂN TẦNG

```
┌──────────────────────────────────────────────────────────────────────────┐
│ NỀN TẢNG HIỆN TẠI (L3) — MOM/MES · Chất lượng · AI · Giám sát · HITL · UI   │
│   + ⭐ VISUAL ORCHESTRATION STUDIO (lập trình quy trình low-code, mô phỏng)  │
│        soạn → version → simulate (digital twin) → COMPILE → DEPLOY ↓        │
├──────────────────────────────────────────────────────────────────────────┤
│ ⭐ FACTORY ORCHESTRATION ENGINE (FOE) — service riêng (L2)                  │
│   • Thực thi workflow/recipe (ISA-88) · sequencing đa-máy · state PackML    │
│   • Interlock/safety logic · HITL gates · retry/compensation · audit        │
│   • Chạy deterministic; KHÔNG GC-block đường điều khiển; scale độc lập      │
├──────────────────────────────────────────────────────────────────────────┤
│ ⭐ EDGE CONTROL RUNTIME (per line/cell) — L1.5 (tuỳ chọn, cho RT + offline) │
│   • Gần máy, độ trễ thấp, chạy tiếp khi mất mạng · đệm lệnh · safety-aware  │
├──────────────────────────────────────────────────────────────────────────┤
│ EQUIPMENT ABSTRACTION — Adapter SDK (OT/vision/robot/CNC/AGV/SECS…)         │
│   Mỗi máy = "Capability Contract" chuẩn (commands/params/telemetry/states) │
├──────────────────────────────────────────────────────────────────────────┤
│ L1 PLC/CNC/Robot/Safety controllers (HARD REAL-TIME, certified) — GIỮ NGUYÊN│
└──────────────────────────────────────────────────────────────────────────┘
        ▲ Tất cả nói chuyện qua: UNIFIED NAMESPACE (UNS/Sparkplug) + UNIFIED API
```

### 4 trụ cột thiết kế
1. **Equipment Capability Model** — mọi máy (bất kể loại/hãng) khai báo *năng lực chuẩn*: tập command, tham số, telemetry, **trạng thái theo PackML** (Idle/Execute/Held/Aborted…). Orchestration lập trình theo **capability**, không theo hãng. (Mở rộng registry pattern đã có: OT/vision/robot.)
2. **Factory Orchestration Engine (FOE)** — service riêng thực thi quy trình (ISA-88 recipe: Procedure→Unit Procedure→Operation→Phase). Phối hợp đa-máy, interlock, HITL, bù trừ lỗi (saga/compensation), audit từng bước. Tách khỏi monolith → an toàn + scale.
3. **Visual Orchestration Studio** (trong nền tảng) — kéo-thả node (máy/hành động/điều kiện/song song/tuần tự/interlock) → **biên dịch ra định nghĩa quy trình khả-chuyển** (JSON/BPMN-like/ISA-88) → **mô phỏng trên digital twin** → **deploy** xuống FOE/edge. Versioned, rollback, HITL phê duyệt.
4. **Edge Control Runtime** (tuỳ chọn) — chạy gần line cho độ trễ thấp + **resilience khi mất kết nối**; vẫn báo cáo ngược UNS.

### 🔒 Nguyên tắc an toàn (BẮT BUỘC — nói thẳng)
- **Điều khiển an toàn (E-stop, interlock SIL/PLe, motion sub-ms) PHẢI ở L1 trên PLC/safety-controller được chứng nhận.** FOE/nền tảng chỉ **điều phối + giám sát**, KHÔNG thay thế safety PLC. "Điều khiển" của control-plane = *điều phối lệnh cấp cao* (start operation, set recipe, sequence) — luôn qua HITL + dry-run gate đã có.
- FOE ra lệnh → vẫn đi qua `commandDispatcher`/`robotCommandDispatcher` (HITL, OT_CONTROL_ENABLED) → giữ nguyên invariant an toàn hiện hữu.

---

# PHẦN C — CHUẨN HOÁ & API THỐNG NHẤT (xương sống tích hợp)

## C1. Bộ chuẩn áp dụng (open standards, không khoá hãng)
| Lớp | Chuẩn | Vai trò |
|---|---|---|
| **UNS/IIoT backbone** | **MQTT + Sparkplug B** (đã có) | 1 không-gian-tên duy nhất cho mọi máy/dữ liệu (publish + NCMD/DCMD) |
| **Mô hình dữ liệu thiết bị** | **OPC-UA + Companion Specs** (đã có driver) | Mô hình thông tin máy chuẩn (semantic) |
| **Trạng thái máy** | **PackML / ISA-TR88** | State machine chuẩn cho mọi máy (Idle/Execute/Held…) |
| **Recipe/Quy trình** | **ISA-88 (S88)** | Cấu trúc recipe/procedure cho FOE |
| **CNC/máy công cụ** | **MTConnect** (khung đã có) | Đọc dữ liệu CNC mở |
| **Bán dẫn** | **SECS/GEM (E5/E30/E37)** (khung) | Thiết bị fab/back-end |
| **AGV/AMR** | **VDA 5050** (khung) | Đội xe tự hành |
| **Tích hợp MES/ERP/ngoài** | **REST + B2MML (ISA-95 XML)** + Webhooks/Events | Trao đổi đơn hàng/master-data với hệ ngoài |
| **Điều khiển độ trễ thấp** | **gRPC / OPC-UA methods** | Kênh lệnh FOE↔edge↔máy |

## C2. "Unified Machine API" — 1 hợp đồng giao tiếp duy nhất
**Nguyên tắc:** mọi máy/hệ ngoài giao tiếp qua **MỘT API Gateway có version + OpenAPI** + **MỘT Adapter SDK**. Bề mặt:

```
# Capability & Registry
GET   /api/v1/equipment                      # liệt kê máy + capability
GET   /api/v1/equipment/{id}/capabilities    # commands/params/telemetry/states
# Telemetry (đọc) — realtime qua UNS/SSE, lịch sử qua REST
GET   /api/v1/equipment/{id}/telemetry?from=&to=
SUB   uns: spBv1.0/<site>/DDATA/<node>/<device>
# Control (ghi) — LUÔN qua HITL/dry-run gate
POST  /api/v1/equipment/{id}/commands         { command, args }  → proposeAction→confirm
POST  /api/v1/equipment/{id}/recipe           { recipeRef }
# Orchestration (quy trình)
POST  /api/v1/orchestration/workflows         # deploy 1 workflow đã compile
POST  /api/v1/orchestration/runs              { workflowRef, params } # chạy 1 lần
GET   /api/v1/orchestration/runs/{id}         # trạng thái/step/audit
# Inbound từ máy/hệ ngoài (ingest chuẩn-hoá)
POST  /api/v1/ingest/inspection               # vision adapter (đã có)
POST  /api/v1/ingest/event                    # event/alarm chuẩn-hoá
# Webhooks (đẩy ra ngoài)
POST  {customer_url}                          # đăng ký nhận sự kiện
```
- **Xác thực:** JWT (người dùng) + **API key per-machine/per-system** (đã có `MASTER_API_KEY` + machine API). Thêm **scope/role** cho từng client ngoài.
- **Versioned** (`/v1`), tài liệu **OpenAPI** tự sinh, **idempotency-key** cho lệnh, **HITL** cho mọi ghi điều khiển.
- **Adapter SDK:** chuẩn hoá pattern registry đã có (OT/vision/robot/MTConnect/SECS/VDA5050) thành **1 interface "EquipmentAdapter"** + bộ kit để bên thứ 3 viết adapter cho máy mới → cắm vào không cần sửa lõi.

---

# PHẦN D — KẾ HOẠCH THỰC HIỆN (theo nguyên tắc hệ sinh thái, phân pha)

| Pha | Mục tiêu | Giao gì | Phụ thuộc |
|---|---|---|---|
| **E0 — Capability & State chuẩn** | Định nghĩa "máy" thống nhất | Equipment Capability Model + áp **PackML state** cho các adapter; chuẩn hoá `EquipmentAdapter` interface (gộp OT/vision/robot/CNC/AGV/SECS) | đã có registry |
| **E1 — Unified API Gateway + SDK** | 1 hợp đồng giao tiếp | API `/v1` versioned + OpenAPI + auth scope per-client + **Adapter SDK** + webhooks | E0 |
| **E2 — Factory Orchestration Engine** | Thực thi quy trình đa-máy | Service FOE riêng (ISA-88 runtime: sequence/parallel/interlock/HITL/compensation), ra lệnh qua dispatcher đã có; bắt đầu bằng phối hợp các command-tool sẵn có | E0,E1 |
| **E3 — Visual Orchestration Studio + Digital Twin** | "Lập trình" low-code | Editor kéo-thả → compile → **mô phỏng (twin)** → deploy xuống FOE; version/rollback/HITL | E2 |
| **E4 — Edge Control Runtime** | Real-time + offline | Runtime gần line (đệm lệnh, resilience), kênh gRPC/OPC-UA; lộ trình **chứng nhận an toàn** (giữ safety ở PLC) | E2 |
| **E5 — AI-assisted Orchestration** | Tối ưu vòng kín | AI đề xuất/điều chỉnh chuỗi quy trình (HITL), dùng RCA/forecast đã có | E2,E3 |

**Nguyên tắc xuyên suốt:** additive · flag-gated · HITL cho mọi ghi · 1 UNS + 1 API + 1 auth + 1 master-data (không silo) · open standards · adapter-hoá để không khoá hãng · an toàn (safety) luôn ở L1.

## Khuyến nghị thứ tự & "build vs buy"
- **Bắt đầu E0+E1 ngay** (chuẩn hoá capability + API/SDK) — đây là *xương sống hệ sinh thái*, rủi ro thấp, mở khoá mọi thứ sau.
- **FOE (E2):** **build** một service riêng trong repo/ecosystem (Node hoặc một runtime phù hợp hơn cho orchestration như Temporal/BullMQ-workflow), KHÔNG nhồi vào monolith. Có thể **buy/dùng open-source workflow engine** (Temporal, Camunda/Zeebe-BPMN, Node-RED cho prototyping) làm lõi thực thi, bọc bằng API/UNS của ta.
- **Edge (E4):** chỉ khi cần real-time/offline thật; cân nhắc runtime công nghiệp (Node-RED edge, hoặc agent C/Rust) — **không** ép vào Node monolith.

---

# PHẦN E.0 — ✅ QUYẾT ĐỊNH ĐÃ CHỐT (2026-06-28)
1. **Mức điều khiển: CẢ HAI theo lộ trình** — bắt đầu điều phối cấp cao (HITL), mở rộng dần xuống edge real-time (E4) khi cần. Safety luôn ở PLC.
2. **Lõi orchestration: TỰ VIẾT FOE** (engine workflow riêng trong repo, không bọc Temporal/Zeebe). → kiểm soát toàn bộ; thiết kế module hoá để sau có thể thay lõi.
3. **Bắt đầu: E0 + E1** (Equipment Capability Model + PackML state + unified EquipmentAdapter; rồi Unified API `/v1` + OpenAPI + Adapter SDK). Đang triển khai.

# PHẦN E — CÂU HỎI ĐỊNH HƯỚNG (đã trả lời ở E.0)
1. **Mức "điều khiển" mục tiêu:** điều phối *cấp cao* (sequence operations/recipe, vẫn HITL) — hay tham vọng tới *điều khiển chuyển động/real-time*? (cái sau cần edge + safety-cert, lớn hơn nhiều).
2. **Quy mô máy/loại** cần phối hợp đồng thời trong 1 quy trình điển hình? (định cỡ FOE).
3. **Build hay buy lõi orchestration:** tự viết engine, hay bọc Temporal/Zeebe/Node-RED? (khuyến nghị: bọc open-source cho E2 để nhanh + tin cậy).
4. **Edge runtime** có cần ngay (mất mạng/độ trễ) hay để sau?
5. Bắt đầu từ **E0+E1** (capability + Unified API/SDK) tuần này chứ?

---

*(Thiết kế chiến lược — chưa thực thi. Chờ anh/chị chốt định hướng để vạch kế hoạch chi tiết E0→E2 và giao Agent chuyên môn.)*
