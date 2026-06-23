# KẾ HOẠCH TỔNG THỂ – HỆ SINH THÁI NHÀ MÁY THÔNG MINH ST4I
### Thiết kế chuẩn → So sánh hiện trạng → Lộ trình nâng cấp toàn diện
**Ngày lập:** 2026-06-23 · **Doanh nghiệp:** Công ty TNHH ST4I — st4ijsc.com · **Trạng thái:** ⏳ CHỜ PHÊ DUYỆT

> Tài liệu này dựa trên hồ sơ gốc [`01_SYSTEM_BASELINE_AUDIT_2026-06.md`](./01_SYSTEM_BASELINE_AUDIT_2026-06.md). Mục tiêu: định nghĩa **một hệ sinh thái nhà máy thông minh tiêu chuẩn quốc tế** xoay quanh 4 giải pháp chủ lực của ST4I (Máy tự động hóa · Robotics · Computer Vision · IoT) với điểm nhấn **AI cục bộ (local-first)**, sau đó **so chiếu với hệ thống hiện tại** để xây **lộ trình nâng cấp toàn diện**.
>
> **⚠️ Quy trình:** Anh/chị **review & phê duyệt** tài liệu này trước. Sau khi duyệt, các **AI Agent chuyên môn** mới được gọi để thực thi từng workstream (xem §8 — Bảng phân công Agent).

---

## 1. Tầm nhìn & Định vị ST4I

**Mục tiêu chiến lược:** Trở thành nền tảng **"Smart Factory OS"** — một hệ điều hành nhà máy thống nhất mà ST4I triển khai cho các nhà máy lớn, hiện đại trên thế giới, hợp nhất 4 trụ cột giải pháp dưới một control-tower duy nhất, với AI chạy **local/on-prem** (không phụ thuộc cloud, bảo mật dữ liệu công nghiệp, độ trễ thấp tại biên).

| Trụ cột ST4I | Vai trò trong hệ sinh thái | Trạng thái nền tảng hiện tại |
|---|---|---|
| **1. Máy tự động hóa (Automation Machines)** | Lớp thiết bị + điều khiển: AOI/AVI, máy CNC, dây chuyền SMT, máy đo, băng tải… kết nối qua OT để giám sát & điều khiển. | ✅ AOI/AVI mạnh; ⚠️ OT framework đang xây (driver chưa kết nối hardware thật) |
| **2. Robotics** | Cánh tay/robot cộng tác, AGV/AMR, pick-and-place, gắp-đặt theo recipe; điều phối với MES & interlock an toàn. | ❌ Gần như chưa có (không có module robot/AGV/motion) |
| **3. Computer Vision** | Kiểm tra quang học, đo lường, nhận diện lỗi, OCR, anomaly detection, hướng dẫn lắp ráp bằng AR/vision. | ✅ Rất mạnh (ONNX + GGUF vision + pgvector + annotation) |
| **4. IoT** | Thu thập telemetry cảm biến/PLC, UNS, năng lượng, môi trường, predictive maintenance. | ✅ MQTT/UNS tốt; ⚠️ time-series & sensor ingest chưa hoàn chỉnh |
| **★ AI cục bộ (xuyên suốt)** | "Bộ não" local: copilot, RAG tri thức, quality-gate AI, anomaly, dự báo, agentic action có HITL. | ✅ Nền tảng local-AI hiếm có (GGUF/ONNX/RAG/HITL) — lợi thế cạnh tranh cốt lõi |

**Định vị khác biệt:** Hầu hết đối thủ (Siemens MindSphere, GE Proficy, AVEVA, Rockwell FactoryTalk) đều cloud-centric. **Lợi thế ST4I = AI local-first + tích hợp dọc trọn gói 4 trụ cột** — đây là tài sản phải được khuếch đại trong mọi quyết định kiến trúc.

---

## 2. Kiến trúc tham chiếu chuẩn (Reference Architecture)

Mô hình **7 lớp** theo chuẩn ISA-95 / RAMI 4.0 / IIRA, đóng vai trò "chuẩn vàng" để chấm điểm hệ thống hiện tại.

```
┌─────────────────────────────────────────────────────────────────────┐
│  L7  EXPERIENCE & APPS    Web control-tower · Mobile/PWA · Kiosk Andon │
│                           AR/HMI · Marketplace widget · Multi-tenant   │
├─────────────────────────────────────────────────────────────────────┤
│  L6  INTELLIGENCE (AI)    Local LLM copilot · RAG · Vision models      │
│                           Anomaly/Forecast · Agentic+HITL · MLOps      │
├─────────────────────────────────────────────────────────────────────┤
│  L5  ORCHESTRATION        ⚑ Unified event bus · Workflow/BPMN ·        │
│      (THIẾU)              Rules/Interlock · Digital Twin · Scheduler   │
├─────────────────────────────────────────────────────────────────────┤
│  L4  MES / QUALITY        Production · WIP/Genealogy · SPC/QMS · OEE · │
│                           BOM/Material · Maintenance · Energy/ESG      │
├─────────────────────────────────────────────────────────────────────┤
│  L3  DATA PLATFORM        Time-series (TSDB) · Relational · Vector ·   │
│                           Data lake · Stream processing · Governance   │
├─────────────────────────────────────────────────────────────────────┤
│  L2  CONNECTIVITY / UNS   Unified Namespace · Sparkplug B · OPC-UA ·   │
│                           MQTT broker HA · Protocol normalization      │
├─────────────────────────────────────────────────────────────────────┤
│  L1  EDGE / OT            PLC/CNC/Robot drivers · Vision edge ·        │
│                           Sensor gateway · Edge inference · Store-fwd  │
├─────────────────────────────────────────────────────────────────────┤
│  L0  DEVICES              AOI/AVI · CNC · Robot/AGV · Cảm biến · Camera │
└─────────────────────────────────────────────────────────────────────┘
  CROSS-CUTTING: Security (IEC 62443 / Zero-Trust) · Identity & RBAC ·
                 Observability · Licensing · Compliance · DevOps/CI-CD
```

**Nguyên tắc thiết kế chuẩn:**
1. **Event-driven & UNS-centric** — mọi dữ liệu chảy qua một Unified Namespace duy nhất; không tích hợp điểm-điểm.
2. **Local-first AI** — suy luận tại biên/on-prem; cloud chỉ tùy chọn cho federation đa nhà máy.
3. **Safety-by-design** — mọi lệnh điều khiển OT/Robot đi qua interlock + HITL + audit append-only.
4. **Multi-tenant thật** — cách ly tenant ở tầng dữ liệu (RLS), không chỉ app-layer.
5. **API-first & composable** — module hóa, license hóa, marketplace hóa.
6. **Observable & HA** — mọi thành phần có metric/trace/log; không SPOF.

---

## 3. Bản đồ năng lực chuẩn theo trụ cột (Capability Map)

### 3.1 Trụ cột MÁY TỰ ĐỘNG HÓA
- Kết nối đa giao thức thật (OPC-UA, Modbus TCP/RTU, S7, Mitsubishi MC, EtherNet/IP) — production-grade, không chỉ scaffold.
- Recipe management + deploy có version, rollback, A/B.
- Điều khiển có interlock + HITL + đọc xác nhận (read-back) + idempotency.
- Digital Twin thiết bị real-time (state, health, OEE, energy).
- Edge agent: store-and-forward khi mất mạng, OTA update firmware/model.

### 3.2 Trụ cột ROBOTICS *(khoảng trống lớn nhất)*
- Robot fleet registry (cobot, 6-axis, SCARA, AGV/AMR) + driver chuẩn (ROS2 bridge, vendor SDK: ABB/FANUC/KUKA/UR/Mitsubishi).
- Motion job orchestration: pick-and-place, dispensing, screw-driving theo recipe & vision-guided.
- AGV/AMR fleet management: traffic, charging, task dispatch, an toàn vùng.
- Vision-guided robotics: kết nối Computer Vision → tọa độ → robot (hand-eye calibration).
- Safety: interlock vùng, e-stop, đồng bộ với MES line-state.

### 3.3 Trụ cột COMPUTER VISION
- Pipeline kiểm tra cấu hình được: classify/detect/segment/OCR/anomaly/measure.
- Edge inference (TensorRT/OpenVINO) + model registry + drift monitor (✅ phần lớn đã có).
- Auto-labeling + active learning + human-in-the-loop annotation (✅ đã có).
- Defect taxonomy chuẩn (IPC-A-610) + heatmap + Pareto + RCA (✅ đã có).
- AR/visual work-instruction & guided assembly (❌ chưa có).

### 3.4 Trụ cột IoT
- Sensor/PLC ingest qua UNS với time-series store đúng nghĩa (TSDB hypertable + compression + retention).
- Predictive maintenance closed-loop (telemetry → anomaly → work-order → spare-part).
- Energy/ESG: ISO 50001 EnPI, carbon, peak-shaving (✅ schema có, ⚠️ ingest chưa thật).
- Environmental & condition monitoring (rung, nhiệt, áp suất).
- Edge-to-cloud federation (đa nhà máy, đa quốc gia).

### 3.5 Trụ cột AI CỤC BỘ (xuyên suốt)
- LLM copilot role-aware + agentic action có HITL (✅ đã có, cần mở rộng tool & độ tin cậy).
- RAG tri thức nhà máy (SOP, lịch sử, sự cố) — nâng cấp từ jsonl → vector store production + graph (✅ có, 🔴 cần upgrade).
- Vision-language cho kiểm tra & visual Q&A (✅ đã có).
- MLOps: training local, versioning, canary, A/B, calibration, drift (✅ đã có).
- AI governance: EU AI Act, model card, audit suy luận (⚠️ một phần).

---

## 4. So sánh Chuẩn ↔ Hiện trạng (Maturity Matrix)

**Thang điểm:** 0 = chưa có · 1 = scaffold/flag-off · 2 = partial/chưa kết nối thật · 3 = hoạt động cơ bản · 4 = production · 5 = best-in-class.

| # | Năng lực chuẩn | Điểm | Hiện trạng (dẫn chiếu baseline) |
|---|---|:--:|---|
| **L1 Edge/OT** |||
| 1 | Driver giao thức công nghiệp thật | **2** | Framework + code driver có; chưa kết nối hardware, thiếu native lib (§2.4) |
| 2 | Edge inference & store-and-forward | **2** | ONNX edge deploy có; store-forward/OTA model một phần |
| 3 | Edge agent OTA/firmware | **2** | FactoryAlert OTA có cho 1 loại; chưa tổng quát |
| **L2 Connectivity/UNS** |||
| 4 | Unified Namespace + Sparkplug B | **3** | UNS bridge + Sparkplug code tốt nhưng publish-only, flag-off |
| 5 | MQTT broker HA + TLS + auth thật | **2** | Aedes nhúng, **no-TLS, auth username-format** (CRIT-05 OPEN) |
| 6 | OPC-UA server/client production | **1** | `opcuaGateway.ts` scaffold no-op |
| **L3 Data Platform** |||
| 7 | Time-series store (TSDB) | **2** | Partition tháng; Timescale hypertable out-of-band, flag-off |
| 8 | Relational + schema governance | **3** | Mạnh nhưng nợ migration trùng số + journal lệch + json/jsonb trộn |
| 9 | Vector store production | **3** | pgvector HNSW tốt; KB text vẫn jsonb file |
| 10 | Stream processing/data lake | **1** | Chưa có stream processor/lake; xử lý trong service |
| 11 | Multi-tenant isolation (RLS) | **2** | Chỉ app-layer; denormalized code dễ lệch (OPEN) |
| 12 | Retention/archival policy | **1** | Không có chính sách hệ thống (OPEN) |
| **L4 MES/Quality** |||
| 13 | Production/WIP/Genealogy | **4** | ISA-95 + hash-chain + 21 CFR 11 sign-off (mạnh) |
| 14 | SPC/QMS | **4** | 12 SPC rule, Cpk, quality-gate, IPC-A-610 |
| 15 | OEE/Downtime | **4** | SEMI E10 6-state |
| 16 | BOM/Material/Traceability | **3** | Schema+router+UI; vài lineage/dispatch pending |
| 17 | Maintenance (PdM) closed-loop | **3** | Work-order + MTTR/MTBF; vòng kín chưa đầy đủ |
| 18 | Energy/ESG (ISO 50001) | **2** | Schema+EnPI+carbon UI; ingest điện chưa thật |
| **L5 Orchestration** *(THIẾU NHẤT)* |||
| 19 | Unified event bus | **1** | Event rời rạc qua socket/MQTT, không bus thống nhất |
| 20 | Workflow/BPMN engine | **0** | Chưa có |
| 21 | Rules/Interlock engine | **3** | Interlock có (alert-only/HITL), chưa orchestration rộng |
| 22 | Digital Twin real-time | **3** | DigitalTwinDashboard + 3D; chưa twin toàn nhà máy |
| 23 | APS Scheduler | **2** | scheduling schema + scheduleRuns; chưa tối ưu thật |
| **L6 Intelligence (AI)** |||
| 24 | Local LLM copilot + agentic HITL | **4** | Copilot role-aware + HITL + GBNF JSON (mạnh, hiếm) |
| 25 | RAG tri thức nhà máy | **3** | Hoạt động nhưng 🔴 upgrade-before-Q3/2026 (jsonl) |
| 26 | Vision/CV models + MLOps | **4** | ONNX+GGUF+drift+active-learning+calibration |
| 27 | Forecast/Anomaly | **3** | Time-series + anomaly; Holt-Winters short-window cần fix |
| 28 | AI governance (EU AI Act) | **2** | Audit suy luận một phần; model card chưa chuẩn |
| **L7 Experience/Apps** |||
| 29 | Web control-tower | **4** | 125 page, dashboard marketplace, realtime (mạnh) |
| 30 | Mobile/PWA operator | **2** | 2 mobile app chồng chéo, không PWA/kiosk |
| 31 | Multi-tenant UX + license gating | **3** | Tốt nhưng ot-control/AI-analytics chưa map module |
| 32 | AR/HMI guided | **0** | Chưa có |
| **★ ROBOTICS (trụ cột riêng)** |||
| 33 | Robot/AGV fleet + driver | **0** | Chưa có module robot/motion/AGV |
| 34 | Vision-guided robotics | **0** | Chưa có cầu nối CV→robot |
| **Cross-cutting** |||
| 35 | Security IEC 62443/Zero-Trust | **3** | 2FA, RBAC, license runtime-security; CORS/JWT/MASTER_KEY gap |
| 36 | Observability (metric/trace/log) | **2** | OTel/Sentry/Prometheus code-có, flag-off; chưa Grafana |
| 37 | HA/DR | **3** | Backup+replication+verify-restore; WAL/replica infra-deferred |
| 38 | DevOps/CI-CD | **3** | Dockerfile+compose+Playwright+CI scaffold |
| 39 | Audit coverage toàn diện | **2** | Chỉ site nhạy cảm, không interceptor global |

**Điểm trung bình ≈ 2.6/5.** Khớp đánh giá roadmap nội bộ (~5.8/10). **Phân bố:** rất mạnh ở L4 MES/Quality, L6 AI, L7 Web; rất yếu ở **L5 Orchestration**, **Robotics**, **time-series/multi-tenant/observability hạ tầng**.

---

## 5. Phân tích khoảng trống (Gap Analysis)

### 5.1 Khoảng trống chiến lược (Strategic)
- **G-A. Thiếu tầng điều phối hợp nhất (L5).** Đây là điểm yếu cốt lõi đã được audit nội bộ chỉ ra. Không có event bus/workflow engine khiến mỗi module tự xử lý realtime → khó mở rộng đa trụ cột.
- **G-B. Trụ cột Robotics gần như trống.** ST4I bán giải pháp robot nhưng nền tảng chưa có module robot/AGV/motion/vision-guided → khoảng trống lớn nhất so với định vị 4 trụ cột.
- **G-C. OT chưa chạm thiết bị thật.** Driver công nghiệp ở mức scaffold/flag-off → "smart factory" chưa khép vòng vật lý.
- **G-D. AI local chưa được khai thác như "bộ não điều phối".** Copilot mạnh nhưng chưa được nối vào event bus để chủ động giám sát/đề xuất/hành động xuyên module.

### 5.2 Khoảng trống hạ tầng (Foundational)
- Time-series store thật (TSDB hypertable + compression + retention).
- Multi-tenant RLS thật ở tầng DB.
- Observability bật production (Grafana/Loki/Tempo).
- HA/DR đầy đủ (WAL, replica, broker HA, Redis cluster).
- MQTT broker production (TLS + auth thật).

### 5.3 Nợ kỹ thuật (Technical Debt) — phải xử lý trước khi mở rộng
- 2 thế hệ migration trùng số + drizzle journal lệch (rủi ro schema drift).
- `index.ts` monolith 4591 dòng + REST viết tay bypass middleware.
- 3 lớp cache chồng nhau; rate-limit in-memory.
- Dead code (page `.bak/.disabled`, `reportScheduleRouter` dead, 2 mobile app trùng).
- Registry/license consistency (`ot-control`, AI-analytics chưa map module).
- Doc debt (DEPLOYMENT_GUIDE sai stack).
- Security defaults (CORS reflect-all, JWT 1 năm, MASTER_KEY mặc định).

---

## 6. Lộ trình nâng cấp toàn diện (Upgrade Roadmap)

> 6 phase, ưu tiên **củng cố nền móng trước, mở rộng trụ cột sau**. Mỗi phase có Mục tiêu · Workstream · Tiêu chí Done · Agent đề xuất (xem §8). Thời lượng là ước lượng tương đối, điều chỉnh khi duyệt.

### PHASE 0 — Hardening nền móng & Dọn nợ kỹ thuật *(P0, ~2–3 tuần)*
**Mục tiêu:** Loại bỏ rủi ro vận hành & security trước khi xây mới.
- WS0.1 — **Migration & schema governance:** hợp nhất 2 thế hệ migration, dọn file MySQL chết, đồng bộ drizzle journal, sửa runner để **fail-fast** có kiểm soát.
- WS0.2 — **Security hardening:** CORS allow-list bắt buộc, rút ngắn JWT + refresh-token, bắt buộc đổi `MASTER_API_KEY`, rate-limit Redis-store.
- WS0.3 — **Registry/license consistency:** thêm module `MOD_OT_CONTROL`, `MOD_AI` vào `module-registry.ts`; gate route OT/AI-analytics.
- WS0.4 — **Dọn dead code & doc:** xóa `.bak/.disabled`, wiring/xóa `reportScheduleRouter`, viết lại `DEPLOYMENT_GUIDE` đúng stack PostgreSQL/aedes.
- WS0.5 — **Audit coverage:** middleware audit tRPC global (mutation) thay vì site lẻ.
- ✅ **Done:** `tsc` xanh, migration chạy fail-fast, security checklist pass, 0 dead-page, license gate phủ 100% route.

### PHASE 1 — Data Platform & Connectivity production *(P1, ~3–4 tuần)*
**Mục tiêu:** Nền dữ liệu & kết nối đạt production cho mọi trụ cột.
- WS1.1 — **Time-series thật:** TimescaleDB hypertable in-pipeline cho `otTelemetry/oeeMetrics/machineHeartbeats/processResults`, compression + retention policy (`drop_chunks`).
- WS1.2 — **Multi-tenant RLS:** RLS theo tenant ở các bảng nóng + trigger đồng bộ denormalized code.
- WS1.3 — **MQTT broker production:** EMQX HA + TLS + auth thật (cert/credential), aedes chỉ dev.
- WS1.4 — **UNS hai chiều:** bật UNS bridge production, chuẩn hóa topic ISA-95 toàn hệ.
- WS1.5 — **Observability ON:** Grafana + Prometheus + OTel trace + log tập trung.
- ✅ **Done:** telemetry ghi hypertable + retention chạy; RLS test cách ly tenant; broker TLS; dashboard Grafana live.

### PHASE 2 — OT chạm thiết bị thật & Orchestration (L5) *(P1, ~4–6 tuần)*
**Mục tiêu:** Khép vòng vật lý + dựng tầng điều phối còn thiếu.
- WS2.1 — **OT driver production:** hoàn thiện + kiểm thử OPC-UA/Modbus/S7/EtherNet-IP/Mitsubishi với thiết bị/simulator thật; bật `OT_CONTROL_ENABLED` có read-back.
- WS2.2 — **Unified Event Bus:** chuẩn hóa event nội bộ (NATS/Redis Streams) thay socket rời rạc; mọi module publish/subscribe qua bus.
- WS2.3 — **Workflow/Rules engine:** orchestration đa module (vd: NG → interlock → robot rework → notify) với HITL & audit.
- WS2.4 — **Digital Twin toàn nhà máy:** twin real-time từ UNS, đồng bộ 3D layout.
- ✅ **Done:** ghi lệnh thiết bị thật an toàn (có HITL+read-back+audit); event bus phục vụ ≥3 module; ≥1 workflow đa-trụ-cột chạy E2E.

### PHASE 3 — Trụ cột ROBOTICS *(P2, ~5–7 tuần)*
**Mục tiêu:** Lấp khoảng trống trụ cột lớn nhất, đúng định vị ST4I.
- WS3.1 — **Robot/AGV fleet registry + driver** (ROS2 bridge + vendor SDK), tái dùng `otDriver` contract & command dispatcher.
- WS3.2 — **Motion job orchestration:** recipe pick-and-place/dispensing/screw, vision-guided (cầu CV→tọa độ, hand-eye calibration).
- WS3.3 — **AGV/AMR fleet management:** task dispatch, traffic, charging, safety zone, đồng bộ MES line-state.
- WS3.4 — **UI robotics:** trang fleet/teach/jog/job + twin robot.
- ✅ **Done:** điều khiển ≥1 robot/cobot qua nền tảng với interlock; vision-guided pick demo; AGV task dispatch.

### PHASE 4 — AI cục bộ thành "bộ não điều phối" *(P2, ~4–5 tuần)*
**Mục tiêu:** Khuếch đại lợi thế AI local-first.
- WS4.1 — **RAG production:** chuyển KB jsonl → vector store production + knowledge graph + ingest SOP/sự cố tự động (đóng 🔴 upgrade-before-Q3).
- WS4.2 — **Agentic copilot nối event bus:** AI chủ động giám sát telemetry/SPC/OEE, đề xuất hành động xuyên module (HITL bắt buộc).
- WS4.3 — **AI governance:** model card, audit suy luận đầy đủ, tuân thủ EU AI Act; fix Holt-Winters & AI Analytics N+1/date-cap.
- WS4.4 — **Edge AI mở rộng:** TensorRT/OpenVINO trên edge agent + auto-retrain closed-loop.
- ✅ **Done:** RAG mới đạt KPI accuracy/latency; ≥3 agentic workflow HITL; báo cáo governance per-model.

### PHASE 5 — Experience, Federation & Hệ sinh thái *(P3, ~4–6 tuần)*
**Mục tiêu:** Trải nghiệm hạng nhất + đa nhà máy + thương mại hóa module.
- WS5.1 — **Mobile/PWA hợp nhất:** gộp 2 mobile app, PWA offline, kiosk Andon/MES tablet, banner connection toàn cục.
- WS5.2 — **Multi-site federation:** đồng bộ đa nhà máy/đa quốc gia, edge-to-core, tenant isolation đầy đủ.
- WS5.3 — **AR/HMI guided assembly** (kết nối CV + work-instruction).
- WS5.4 — **Marketplace & packaging:** module marketplace, license-as-a-service, ESG/carbon dashboard hoàn chỉnh.
- ✅ **Done:** 1 PWA hợp nhất; federation 2 site demo; AR work-instruction PoC; marketplace module hóa.

---

## 7. Sắp xếp ưu tiên & Phụ thuộc

```
P0 Hardening ──► P1 Data/Connectivity ──► P2 OT+Orchestration ──┬─► P3 Robotics
                                                                 ├─► P4 AI brain
                                                                 └─► P5 Experience/Federation
```
- **Bắt buộc tuần tự:** P0 → P1 → P2 (nền móng). Robotics (P3), AI brain (P4) **phụ thuộc** event bus & OT thật ở P2.
- **Song song được:** P4 (AI) một phần chạy song song P3 (Robotics) sau khi P2 xong.
- **Quick wins ngay trong P0:** registry/license gate, dead-code cleanup, doc fix, security defaults — rủi ro thấp, giá trị cao.

**KPI thành công tổng thể:**
| Chỉ số | Baseline | Mục tiêu sau roadmap |
|---|---|---|
| Maturity trung bình | 2.6/5 | ≥ 4.0/5 |
| Trụ cột có module production | 2/4 (CV, IoT một phần) | 4/4 |
| Lệnh OT thật an toàn | 0 (simulated) | Có (HITL+read-back+audit) |
| Time-series retention | Không | Có policy + compression |
| Tenant isolation | App-layer | DB RLS |
| Observability | Flag-off | Grafana live |

---

## 8. Bảng phân công AI Agent chuyên môn (gọi sau khi PHÊ DUYỆT)

| Workstream | Agent chuyên môn đề xuất | Phạm vi |
|---|---|---|
| WS0.1 Migration/schema | `db-migration-agent` | Hợp nhất migration, journal, runner fail-fast |
| WS0.2 Security | `security-hardening-agent` (+ skill `/security-review`) | CORS/JWT/rate-limit/master-key |
| WS0.3 Registry/license | `backend-agent` | module-registry + route gate |
| WS0.4 Dead-code/doc | `cleanup-agent` | xóa dead code, viết lại doc |
| WS0.5 Audit coverage | `backend-agent` | middleware audit global |
| WS1.1–1.2 Data platform | `data-platform-agent` | TSDB hypertable, RLS, retention |
| WS1.3–1.4 Connectivity | `iot-connectivity-agent` | EMQX HA/TLS, UNS 2 chiều |
| WS1.5 Observability | `devops-agent` | Grafana/Prometheus/OTel |
| WS2.1 OT driver | `ot-driver-agent` | OPC-UA/Modbus/S7/EIP/MC production |
| WS2.2–2.3 Orchestration | `orchestration-agent` | event bus + workflow/rules |
| WS2.4 Digital Twin | `frontend-3d-agent` | twin toàn nhà máy |
| WS3.* Robotics | `robotics-agent` | fleet/driver/motion/AGV + UI |
| WS4.* AI brain | `ai-platform-agent` | RAG production, agentic, governance, edge AI |
| WS5.* Experience | `frontend-agent` + `mobile-agent` | PWA, federation, AR, marketplace |

> Mỗi Agent sẽ nhận: (1) trích đoạn liên quan từ baseline, (2) tiêu chí Done của workstream, (3) ràng buộc an toàn (safety-by-design, HITL, audit). Anh/chị có thể duyệt theo từng phase để kiểm soát phạm vi & ngân sách.

---

## 9. Checklist phê duyệt (dành cho anh/chị review)

Trước khi gọi Agent thực thi, vui lòng xác nhận:
- [ ] **Định vị 4 trụ cột + AI local-first** ở §1 đúng chiến lược ST4I?
- [ ] **Kiến trúc tham chiếu 7 lớp** (§2) là chuẩn mong muốn?
- [ ] **Maturity matrix** (§4) phản ánh đúng hiện trạng?
- [ ] **Thứ tự ưu tiên P0→P5** (§6–7) phù hợp nguồn lực & deadline?
- [ ] **Phạm vi Robotics (P3)** — có thiết bị robot thật để tích hợp/kiểm thử không? Vendor nào (UR/ABB/FANUC/KUKA/Mitsubishi)?
- [ ] **Hạ tầng** — có sẵn để bật production (TimescaleDB/EMQX/Redis cluster/Grafana/GPU edge)?
- [ ] **Bắt đầu từ phase nào?** (Khuyến nghị: **P0 trước** vì rủi ro thấp, mở khóa mọi phase sau.)

**Điều chỉnh mong muốn của anh/chị (ghi tại đây):**
> …

---

*(Tài liệu kế hoạch — chưa thực thi thay đổi mã nguồn. Chờ phê duyệt để gọi Agent chuyên môn theo §8.)*
