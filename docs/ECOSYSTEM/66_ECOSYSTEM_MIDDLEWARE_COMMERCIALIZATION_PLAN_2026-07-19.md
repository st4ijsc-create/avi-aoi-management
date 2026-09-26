# Doc 66 — Kế hoạch Middleware Trung gian cho Hệ sinh thái: bán 1 máy & bán nhiều máy

> **Bản kế hoạch (CHỜ DUYỆT)** cho một **phần mềm trung gian (edge middleware / connector-gateway)**
> kết nối máy của nhiều hãng vào **hệ sinh thái hiện tại** (avi-aoi-management / "SYNAPSE Factory
> Control Plane"), theo **đúng blueprint tham chiếu SYNAPSE** (`D:\SOURCES\SYNAPSE`), phục vụ hai
> tình huống thương mại: **bán 1 máy** và **bán nhiều máy + cả hệ sinh thái**.
>
> Ngày: 2026-07-19 · Nối tiếp doc 61 (contract máy đã kiểm chứng LIVE), doc 62 (simulator/EdgeCore),
> doc 65 (UI web/Tauri = shell). Tham chiếu: `SYN-RAOE-SDD-001` (SDD), `SYN-RAOE-DEVPLAN-001` (dev
> plan), `SYN-ECO-LDS-L1..L5-001` (5 tầng); manual 6 hãng `D:\SOURCES\AI Local\Manual`.
>
> Quyết định (người dùng chốt): **engine viết lại theo Go/Rust (đồng bộ SYNAPSE)**; **driver ưu tiên
> gần trọn ma trận 6 hãng**; UI web + Tauri (doc 65); viết kế hoạch trước, chờ duyệt.

---

## 0. Tài sản đã có (điểm khởi đầu, KHÔNG bỏ đi)

| Tài sản | Vai trò trong kế hoạch |
|---|---|
| **Hệ sinh thái hiện tại** (avi-aoi-management) — "SYNAPSE Factory Control Plane", có sẵn **contract máy `/api/v1/ingest/*`** (doc 61) + web UI + DB + auth | **Đích northbound** của middleware (đã proven LIVE) |
| **EdgeCore C#** (doc 62, 94 test) — driver/normalizer/transport/store-forward + 2 proof-driver (hot-folder AOI, MQTT) + simulator | **Prototype/oracle hợp đồng** để **de-risk** bản viết lại Go/Rust; giữ chạy trong lúc quá độ |
| **Blueprint SYNAPSE** (7 tài liệu) | **Kiến trúc + mô hình thương mại chuẩn** để bám theo |
| **Manual 6 hãng** | **Ma trận driver** cụ thể (Modbus/OPC-UA/SLMP/FINS/RMI/URScript/Zmotion-DLL) |

> Ý tưởng lớn: middleware = **"Machine Edition connector-gateway"** của mô hình SYNAPSE
> (DEVPLAN §4). Nó **nam-southbound nói mọi tiếng OT**, chuẩn hoá về canonical model, và
> **northbound đẩy vào hệ sinh thái hiện tại qua contract doc 61 đã kiểm chứng** (và/hoặc UNS
> Sparkplug B khi lên quy mô).

---

## 1. Định vị & chiến lược thương mại (theo SYNAPSE DEVPLAN §4)

**Một codebase → 3 Edition → đường nâng cấp liền mạch** (foldable, ADR-007):

| Edition | Kịch bản bán | Triển khai | Giá |
|---|---|---|---|
| **Machine Edition** | **BÁN 1 MÁY** (kèm máy OEM) | 1 IPC trong máy, all-in-one, broker nhúng, **UI Tauri (doc 65) + Local Agent** | **OEM perpetual + royalty ~3–5%/máy** + bảo trì năm |
| **Line Edition** | cụm/1 dây chuyền | 1 server công nghiệp / K3s | thuê bao theo số thiết bị (~10–20) |
| **Site Edition** | **BÁN NHIỀU MÁY + HỆ SINH THÁI** (cả nhà máy, đa hãng) | K8s HA + K3s edge mỗi zone | thuê bao bậc + dịch vụ tích hợp |
| **Federation (R4)** | đa nhà máy | lớp cloud enterprise | — |

**Chiến lược "Trojan horse" (DEVPLAN §4.4):** Machine Edition bán kèm gần-như-0-chi-phí-cảm-nhận →
mỗi máy xuất xưởng là một "đầu cầu" → sau bán cả nền tảng nhà máy; connector mở cho phép Site Edition
quản luôn **máy hãng khác** ⇒ khách khoá vào *nền tảng*, không phải *cái máy*. Doanh thu định kỳ =
bảo trì + thuê bao + dịch vụ tích hợp/twin/AI + (R4) marketplace adapter + **chương trình OEM cấp
license theo lô**.

---

## 2. Hai tình huống bán — luồng cụ thể

### 2.1 BÁN 1 MÁY — Machine Edition
- Ship **Machine Edition** trên IPC của máy: single-node profile (connector-gateway + fleet-mini +
  broker nhúng + **UI Tauri** + license). Với khách nó là "HMI + thu thập dữ liệu của máy".
- **Local Agent** xử lý phần cứng bản địa (serial/RS-485/USB/dongle, **DLL/SDK hãng** như Zmotion
  `zauxdll.dll`) → chuẩn hoá về canonical/UNS local. **UI không bao giờ chạm phần cứng.**
- Thêm loại máy/giao thức mới = **viết 1 connector plugin** từ template SDK, hoặc **sidecar bọc
  DLL** — **không đụng core**. Thêm 1 hãng = **chi phí cô lập, hằng số (1 plugin)**.
- **Northbound (mặc định):** đẩy RESULT/TELEMETRY/INSPECTION + config-sync + heartbeat vào **hệ sinh
  thái hiện tại qua contract doc 61** (đã kiểm chứng LIVE). Cấu hình bật/tắt.

### 2.2 BÁN NHIỀU MÁY + HỆ SINH THÁI — Line/Site/Federation
- Máy lẻ đang publish lên UNS local → **Join wizard (mDNS)** phát hiện và **bridge lên** Site broker
  = **"mở khoá", không cài lại, không mất dữ liệu, không cấu hình lại**. **Cấn trừ** giá trị các
  Machine Edition đã mua vào giá nâng cấp (DEVPLAN §4).
- Đa hãng: connector mở (OPC-UA/Modbus/RMI…) → Site quản cả máy hãng khác.
- Đa nhà máy: **Federation** ("tự chủ cục bộ, hợp nhất toàn cục", SDD §12.3) — mỗi site tự chủ ở
  edge/site, lớp enterprise gộp KPI / chia model AI / cân tải chéo site.

---

## 3. Kiến trúc (đồng bộ SYNAPSE, engine Go/Rust)

Bám tầng SYNAPSE (ISA-95). Middleware trọng tâm ở **L0–L1 (kết nối) + L2 (UNS/data-fabric)**;
northbound nối hệ sinh thái hiện tại.

```
  Máy hãng (Mitsubishi/Delta/Omron/FANUC/UR/Zmotion…)
        │  southbound: SLMP/MC · Modbus TCP/RTU · EtherNet-IP(CIP) · FINS · RMI(JSON) · URScript/RTDE · OPC-UA · Zmotion-DLL
   ┌────▼───────────────────────────────────────────────────────────────┐
   │ EDGE GATEWAY + CONNECTOR FRAMEWORK  (Rust edge <100ms · Go core)     │  ← LDS-L1 / SDD §5.5
   │  · Device Adapter SDK: connect/readTags/subscribe/executeCommand/    │
   │    getHealth/getSafetyStatus(read-only)/describe                     │
   │  · Canonical Device Model (Asset/Tag/Telemetry/Command/Event/Health) │
   │    URN urn:syn:asset:{site}:{line}:{cell}:{equipment}                │
   │  · Tag→UNS mapping (YAML, config-as-code, Git) · store-and-forward   │
   │  · Local Agent (serial/USB/dongle/DLL vendor via cgo/FFI/sidecar)    │
   └────┬───────────────────────────────────────────────┬────────────────┘
        │ northbound A (hệ sinh thái HIỆN TẠI)          │ northbound B (chuẩn SYNAPSE)
        ▼  contract doc 61 (ĐÃ PROVEN):                 ▼  UNS Sparkplug B (LDS-L2):
   POST /api/v1/ingest/{process-result,telemetry,           syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}
   inspection} · config-sync · heartbeat                     Birth/Death · schema registry (BACKWARD) · tiered store
   → avi-aoi-management (DB/UI/analytics)                    → Line/Site/Federation
```

**Engine (theo lựa chọn Go/Rust — DEVPLAN §6.3):** Go (core service/connector-framework/API),
**Rust** (edge/traffic đường nóng <100ms), Python (twin/AI về sau). Plugin **out-of-process**
(HashiCorp go-plugin) + `plugin.yaml` (SemVer apiVersion, JSON-Schema config → tự sinh UI cấu hình),
Ed25519-signed, **conformance suite** → registry nội bộ → (R4) marketplace. **EdgeCore C# = oracle**:
mọi hành vi connector/normalizer/transport Go/Rust phải khớp test-vector đã có (94 test + doc 61 §14).

**Ranh giới an toàn (bám SYNAPSE):** middleware là lớp *giám sát* (ISA-95 L2–L3), **không** thay
Safety PLC/E-stop/light-curtain; đọc trạng thái safety **read-only**; **không** có đường
cloud→device trực tiếp.

---

## 4. Ma trận DRIVER 6 hãng (từ manual thật) + ưu tiên

| Hãng | Thiết bị | Driver connector cần | Ưu tiên (người dùng chốt) | Tài sản mẫu |
|---|---|---|---|---|
| **Universal** | Delta/Omron/UR/PLC/drive nói chuẩn mở | **Modbus TCP/RTU** + **OPC-UA client** | ✅ **P1** (đòn bẩy cao nhất) | — |
| **FANUC** | CRX/LR-Mate/M-20iD @ R-30iB | **RMI** (TCP/JSON, port 16001) | ✅ **P1** (có sẵn code) | **crate Rust `Fanuc_RMI_API` + simulator** → tái dùng gần trực tiếp cho engine Rust |
| **Zmotion** | motion/vision/PLC/robot card | **DLL adapter** P/Invoke `zauxdll.dll`+`zmotion.dll` (`Zmcaux.cs`), `ZAux_Execute`, qua Ethernet/serial/PCI; Modbus TCP fallback | ✅ **P1** (có sẵn DLL) | DLL + `Zmcaux.cs` (Go/Rust gọi qua **cgo/FFI/sidecar** — Local Agent) |
| **Mitsubishi** | iQ-R/L PLC, MELFA CR800 | **SLMP** (TCP/UDP) + **MC-protocol** (legacy) | ✅ **P1** | manual SLMP/MC frame + device addressing |
| **Universal Robots** | UR5e/UR10e cobot | **URScript** over TCP (30001-3) + **RTDE** (30004) + Dashboard (29999) + Modbus TCP | ✅ **P1** | URScript manual = API |
| **Delta** | DVP/AS PLC, ASDA drive, robot | (phủ bởi Modbus/EtherNet-IP/OPC-UA) + EtherCAT/CANopen ở tầng drive | P2 | manual register map |
| **Omron** | NJ/NX Sysmac, G5/1S servo | **EtherNet/IP (CIP + Tag Data Link)** + **FINS** + OPC-UA | P2 | manual w506 |

**Phủ giao thức middleware cần:** Modbus TCP/RTU · EtherNet/IP (CIP+Tag Data Link) · Mitsubishi
SLMP/MC · Omron FINS · FANUC RMI · UR URScript/RTDE · OPC-UA · Zmotion DLL. (EtherCAT/MECHATROLINK/
CANopen/SSCNET/CC-Link là fieldbus drive↔controller — với tới qua PLC/controller, không phải PC
gateway trực tiếp.) SECS/GEM & MQTT **không** xuất hiện trong manual 6 hãng này (để roadmap khi có
máy bán dẫn/IoT — doc 62 §11).

**Lịch driver đề xuất:** **Đợt A (P1)** = Modbus+OPC-UA (universal) · FANUC RMI (tái dùng crate) ·
Zmotion DLL (tái dùng DLL) · Mitsubishi SLMP · UR URScript/RTDE. **Đợt B (P2)** = Omron
EtherNet-IP/FINS · Delta chi tiết register/EtherNet-IP. Mỗi driver = 1 connector plugin qua conformance.

---

## 5. Canonical model, mapping & Local Agent (LDS-L1)

- **6 thực thể canonical** (Asset/Tag/Telemetry/Command+Ack/Event/Health) + URN identity + ISA-95
  path + state machine (REGISTERED→COMMISSIONING→ACTIVE⇄MAINTENANCE→RETIRED) + "digital passport" +
  chống config-drift. **Ta đã có bản C# tương đương** (doc 62 models) → chuyển thẳng sang schema Go/Rust.
- **Tag→UNS mapping = file YAML khai báo, versioned Git** ("integration knowledge as an asset").
  Máy nói OPC-UA/Modbus → **chỉ cần YAML qua wizard (no-code)**; máy độc quyền → 1 plugin qua conformance.
- **Local Agent** (Go service trên IPC máy): serial/RS-485/USB/dongle + **DLL/SDK hãng** (Zmotion,
  và C#/C++ khác) qua cgo/sidecar; chuẩn hoá về UNS local. "Mọi thứ bản địa đổ về đây; UI không chạm phần cứng."
- **Store-and-forward** (RocksDB/đĩa): telemetry ≥24h, sự kiện chất lượng/traceability ≥7 ngày,
  replay ưu tiên + cờ `historical` (SDD §5.5) — bản C# đã có store-forward JSONL để tham chiếu.

---

## 6. License & Edition (DEVPLAN §4.3)

- **1 artifact, nhiều khoá**: file **license ký Ed25519** (edition, cờ module, giới hạn thiết bị,
  hạn bảo trì, hardware-fingerprint TPM/CPU/MAC, tùy chọn **USB dongle**). Cờ bật/tắt module (twin?
  AI? MES gateway?) + quota (số máy/robot).
- **Offline activation bắt buộc** (nhà máy air-gap); on-prem floating license đếm thiết bị concurrent;
  **ân hạn 30 ngày — không bao giờ dừng sản xuất vì license** (xử lý thương mại, không khoá máy).
- **Foldable (ADR-007):** cùng codebase chạy từ 1 IPC → site K8s HA; **không service nào được giả
  định Kafka/K8s tồn tại**; CI chạy E2E trên **cả hai profile** để chống "edition drift".

---

## 7. Nối với HỆ SINH THÁI HIỆN TẠI (điểm mấu chốt)

Middleware **đẩy northbound vào avi-aoi-management qua contract doc 61 ĐÃ KIỂM CHỨNG**:
`POST /api/v1/ingest/process-result | telemetry | inspection` · `config-sync/{check,get,ack}` ·
`heartbeat` · register→claim/enroll. **Đây là cầu nối "middleware ↔ hệ sinh thái hiện tại".** Ta đã
chứng minh LIVE cả 5 luồng (doc "live-verify": processResultId/inspectionId thật + đọc lại DB). Khi
hệ sinh thái nâng lên chuẩn SYNAPSE đầy đủ, thêm **northbound B = UNS Sparkplug B** song song (bật cờ).

> Vì vậy middleware **không chờ** hệ sinh thái viết lại Go/Rust: nó nói với platform hiện tại **ngay
> hôm nay** qua doc 61, và sẵn sàng UNS khi có.

---

## 8. Lộ trình (map release-train SYNAPSE R0–R4 vào tài sản của ta)

| Release | Nội dung | Dùng lại của ta |
|---|---|---|
| **R0 skeleton** | mono-repo Go/Rust; canonical model; 1 connector (Modbus) → northbound doc 61; UI Tauri (doc 65 U1) | EdgeCore models + doc 61 contract + simulator làm test-harness |
| **R1 "Connect & See"** | Connector framework v1 + **Đợt A driver (P1)**; store-forward; license v1; Machine-Edition alpha | crate FANUC + DLL Zmotion + test-vector C# |
| **R2 "Orchestrate"** | Machine-Edition GA + đóng gói OEM; **Join wizard** (mDNS bridge lên Site); on-prem license server; UNS local | doc 65 U2–U4 (UI đủ 7 màn + Tauri) |
| **R3 "Intelligence"** | connector Đợt B (Omron/Delta); Developer Portal v1 (SDK/conformance); (tùy) twin/AI | doc 62 §11 roadmap |
| **R4 "Scale & Autonomy"** | Federation đa site + marketplace adapter + OEM partner portal + IEC 62443 SL2 | — |

---

## 9. Rủi ro & giảm thiểu

- **Viết lại Go/Rust = lớn** → **de-risk bằng oracle C#**: mọi connector/normalizer/transport phải
  pass **cùng test-vector** đã có (94 test + doc 61 §14 live). Port từng phần, giữ EdgeCore C# +
  simulator chạy để đối chiếu.
- **Zmotion chỉ có DLL Windows** → gọi qua **Local Agent** (cgo/FFI/sidecar), không ép core Go/Rust
  phụ thuộc DLL; Modbus TCP làm fallback mở.
- **Đa giao thức** (rủi ro SDD §14 nêu đúng tên "middleware chuyển đổi") → **connector plugin cô lập
  + conformance + simulator sandbox** (ta đã có simulator!).
- **License chặn sản xuất** → ân hạn 30 ngày, xử lý thương mại (đúng nguyên tắc SYNAPSE).
- **An toàn** → chỉ giám sát, safety read-only, không cloud→device.

---

## 10. Tiêu chí hoàn thành kế hoạch (DoD — Plan 2)
1. Kiến trúc middleware Go/Rust theo LDS-L1/SDD §5.5 (edge gateway + adapter SDK + canonical model + store-forward + connector plugin).
2. **Ma trận driver 6 hãng** chốt + lịch Đợt A/B (P1 gồm Modbus/OPC-UA, FANUC RMI, Zmotion, Mitsubishi SLMP, UR).
3. Mô hình **3 Edition + license Ed25519 + foldable + Join-wizard** (bán 1 máy / bán nhiều máy + hệ sinh thái).
4. **Cầu northbound = contract doc 61** (đã proven) + UNS Sparkplug B (roadmap).
5. Lộ trình R0–R4 map vào tài sản hiện có (EdgeCore/simulator/contract) — de-risk bằng oracle C#.

---

*Doc 66 · Kế hoạch middleware thương mại (bán 1 máy & nhiều máy) · đồng bộ SYNAPSE (SDD/DEVPLAN/LDS) ·
driver 6 hãng từ manual thật · northbound doc 61 · CHỜ DUYỆT · 2026-07-19.*
d