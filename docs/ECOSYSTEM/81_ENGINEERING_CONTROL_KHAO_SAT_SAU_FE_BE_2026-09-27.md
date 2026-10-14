# Doc 81 — Khảo sát sâu module "Kỹ thuật & Điều khiển": bóc tách Frontend (main / sub / flyout) và độ hoàn thiện Backend cho thiết bị thật

> **Ngày:** 2026-09-27 · **Nhánh:** `feat/ai-local-L7-hang-rao` · **Người đọc:** chủ dự án (review trước khi chốt các đợt tiếp theo).
> **Vì sao có doc này:** chủ dự án hỏi *"đã bóc tách thật sự frontend và backend chưa; cái gì là main layout, cái gì là sub, cái nào chuyển sang flyout; backend các layer hoàn thiện đến đâu, đã dùng được với thiết bị thật chưa; GAP ở đâu"*. Doc 80 chấm điểm từng màn và từng cụm backend nhưng **chưa** tách từng vùng màn hình và **chưa** chạy driver với thiết bị/giả lập. Doc 81 làm đúng hai việc đó, bằng đo đạc.
> **Phụ lục** (thư mục [81_ENGINEERING_CONTROL_KHAO_SAT_SAU/](81_ENGINEERING_CONTROL_KHAO_SAT_SAU/)):
> [FE1 — Đo bố cục theo vùng 14 màn](81_ENGINEERING_CONTROL_KHAO_SAT_SAU/FE1_DO_BO_CUC_THEO_VUNG_14_MAN.md) ·
> [FE2 — Kiến trúc shell & layout ở mức mã](81_ENGINEERING_CONTROL_KHAO_SAT_SAU/FE2_KIEN_TRUC_SHELL_VA_LAYOUT_CODE.md) ·
> [BE1 — Driver kết nối hiện trường](81_ENGINEERING_CONTROL_KHAO_SAT_SAU/BE1_KET_NOI_HIEN_TRUONG_DRIVER.md) ·
> [BE2 — Điều khiển & lập trình thiết bị thật](81_ENGINEERING_CONTROL_KHAO_SAT_SAU/BE2_DIEU_KHIEN_VA_LAP_TRINH_THIET_BI_THAT.md) ·
> [BE3 — Ingest · realtime · runtime · nền tảng](81_ENGINEERING_CONTROL_KHAO_SAT_SAU/BE3_INGEST_REALTIME_RUNTIME_NEN_TANG.md)

## 0. Trả lời thẳng

| Câu hỏi | Trả lời ngắn |
|---|---|
| Đã bóc tách thật sự FE và BE chưa? | **Trước doc 81: chưa đủ sâu.** Nay: FE đo từng vùng của 14 màn ở 2 độ phân giải + 3 vai trò, gắn mỗi vùng với tệp:dòng component; BE chạy driver/adapter sản phẩm với giả lập giao thức và server giả, đo tải ingest/socket/MQTT trên một instance riêng. |
| Làm sao tối ưu hiển thị Frontend? | Ba màn soạn thảo hiện chỉ dành **0–15 % khung hình đầu** cho editor/canvas. Chuẩn hoá **5 mẫu bố cục** (§1.3), gom "trang trí" (breadcrumb kép, banner, thẻ KPI, hint) thành chip + popover, và chuyển **44 hộp thoại giữa màn hình** sang flyout. Mục tiêu đo được: editor ≥ 45 % khung đầu ở 1600×950. |
| Cái gì main, sub, flyout? | Bảng §1.2 cho từng màn; chi tiết từng vùng (toạ độ, kích thước, lý do) ở FE1. |
| Backend hoàn thiện đến đâu? | **Mức chung M2–M3** trên thang M0–M5 (§2.1). Lõi ingest/realtime tốt hơn mong đợi (700 req/s, 1.000 client socket p99 95 ms, MQTT 32k msg/s). Đường điều khiển/lập trình ở **M1–M2**. **Không lớp nào đạt M4** (chưa từng chứng minh trên thiết bị thật). |
| Đã dùng được với thiết bị thật chưa? | **Chưa.** Chưa từng có một dòng telemetry thật từ driver nào vào DB (100 % là giả lập `SIM-OT`); `command_log` = 0; deploy thật 0/3. Có **3 lỗi P0 ở driver** (treo vĩnh viễn, sập server, boot treo) và nhiều lỗ an toàn/giả mạo mà test mock không bắt được. |
| GAP ở đâu? | §3 — xếp theo thứ tự "phải xong trước khi nối thiết bị thật". |

## 1. Frontend

### 1.1 Đo được gì

| Chỉ số (1600×950 / 1366×768) | Hiện trạng | Mục tiêu |
|---|---|---|
| Editor/canvas trong khung đầu — IDE | 14,8 % / 3,5 % (có Copilot dock: 10,4 % / **0 %**) | ≥ 45 % / ≥ 40 % |
| — IR Editor | 8,2 % / 1,1 % (có dock: 2,8 % / **0 %**) | ≥ 50 % |
| — POU Studio | 12,9 % / 5,6 % | ≥ 50 % |
| — Orchestration | 15,1 % / **0 %** | ≥ 45 % |
| Khoảng dọc trước tiêu đề trang (shell) | **205 px** (259 px ở màn Beta) = 22–34 % khung | ≤ 100 px |
| Màn có 2 breadcrumb | **11/14** | 0 |
| Banner/notice trước nội dung chính (màn Beta) | 3 banner, 118–178 px | 0 banner (chip 1 dòng) |
| Thẻ KPI cao 130–146 px | 30 thẻ trên 6 màn | dải chip 32 px |
| Hộp thoại giữa màn hình | **32 Dialog + 12 AlertDialog**; Sheet/Drawer/Popover: **0** | tạo/sửa/duyệt qua flyout |
| Copilot dock che editor | 152 px (1600); **378 px = 53 % (1366)** | 0 — panel trong layout, đẩy nội dung |
| Trang cao nhất | Standards tab cảnh báo **8,3× chiều cao màn** (185 dòng không phân trang) | ≤ 1,5× (DataTable phân trang) |

Primitive cần cho thiết kế mới **đã có sẵn và đã dùng ở 14 trang khác** nhưng **0 trang Engineering dùng**: `WorkspaceShell` (panel co giãn), `ContextDrawer`/Sheet, `TabbedHub` (tab đồng bộ URL), `DataTable`, `EntityPicker/MachineSelect`, `EmptyState` (FE2 §2).

### 1.2 Main / Sub / Flyout theo màn (tóm tắt — chi tiết FE1 §2)

| Màn | MAIN (bề mặt chính) | SUB (panel phụ, luôn/thường thấy) | FLYOUT (mở theo hành động) | Thu vào header/status | Bỏ/gộp |
|---|---|---|---|---|---|
| **Hub** | Hộp việc (của tôi / toàn module) | Tư thế an toàn + luồng vàng số sống; danh mục công cụ (ô nhỏ 64 px, ghim, gần đây) | — | chip OT/Gate/Engine interlock | breadcrumb trong trang; banner luồng vàng tĩnh; **Studio** (gộp thành chế độ catalog) |
| **IDE** | Editor (tab: nguồn, Δ diff, Tags) | Explorer trái (dự án, phiên bản, tags, deploy); Inspector/Copilot phải; panel dưới (Vấn đề, Build/Mô phỏng, Lịch sử deploy, Ma trận máy×version) | Deploy wizard 4 bước (gồm canary); Sổ tay; Khi nào dùng | stepper luồng vàng → pipeline chips; chip "Triển khai thật"; thanh trạng thái | card "Trợ lý Lập trình AI" (lối vào AI thứ 3) |
| **IR Editor** | Canvas (cao hết màn, ≥60 % ngang) | Palette trái (gập); Inspector/Transpile phải; Explorer (luồng đã lưu, khối hàm) | Diff/Merge (tab editor); Khi nào dùng | toolbar metadata; chip "Xem trước — không deploy"; KPI → thanh trạng thái | — |
| **POU Studio** | Canvas LD/FBD/SFC | Xem trước ST/PLCopen (gập); **Explorer "Mở" (thêm)** | Khi nào dùng | chip khoá; KPI → thanh trạng thái | — |
| **Orchestration** | Canvas/Cây | Library trái; Inspector phải; panel dưới Runs / Chờ duyệt / Vấn đề | Trợ lý AI điều phối (sheet 420); So sánh phiên bản | tiêu đề sửa tại chỗ + toolbar | gợi ý chân trang |
| **ECN** | Danh sách ECN | Chi tiết có tab (Tổng quan / Đối tượng / Duyệt / Nhiệm vụ / Lịch sử) | Sheet tạo ECN; sheet ký duyệt (mật khẩu/OTP) | FilterBar → toolbar | — |
| **Recipes** | Chi tiết recipe (Tham số / Phiên bản / Duyệt / Triển khai / Máy đang chạy) | Danh sách recipe trái | Sheet tạo phiên bản; sheet duyệt; drawer triển khai nhiều máy | bộ chọn "Máy" (thay card 146 px); chip HITL | — |
| **Interlock** | Danh sách rule / Ma trận Cause×Effect | Panel dưới Sự kiện (lọc theo rule chọn) | Sheet sửa rule (revision nháp, MOC) | chip tư thế engine / OT / độ phủ | — |
| **Copilot** | (thành panel của IDE) | — | — | — | **trang riêng → chế độ scratch của IDE** |
| **Fleet** | Bản đồ + vùng | Tab phải: Tác vụ / Vùng / Sạc / Tài nguyên | Sổ đăng ký (operation, resource, charger) | 9 KPI → 1 dải chip 32 px | — (chuyển **Labs** theo doc 80) |
| **Safety** | Luồng sự kiện + bảng tin advisory | Xu hướng; phối hợp | — | chip "Tư vấn — không phải SIS ⓘ" (thay khối 88 px) | bảng nhân lực → Sản xuất›Ca; tuyên bố chân trang trùng |
| **Standards** | Cây kiểu thiết bị + chi tiết; DataTable ánh xạ cảnh báo (phân trang/ảo hoá) | Hiệu năng cảnh báo; Tuân thủ | Sheet chuẩn hoá cảnh báo | KPI → chip có ghi nguồn | CR → gộp luồng duyệt với ECN |
| **Integration** | Catalog connector (danh sách–chi tiết) | — | — | KPI với nhãn đúng ("đăng ký" ≠ "kết nối") | phiên bản recipe/lịch sử nạp → Recipes; worker thu ảnh → Vision |

### 1.3 Năm mẫu bố cục + shell

| Mẫu | Màn | Hình dạng |
|---|---|---|
| **P1 Workbench (IDE)** | IDE, IR, POU (+Copilot là panel phải) | cao hết màn, không cuộn trang: activity bar 40 · explorer 240–300 · tab editor · inspector 320–420 · panel dưới 180–320 · thanh trạng thái 24 |
| **P2 Canvas designer** | Orchestration, IR | palette · canvas · inspector · panel dưới Runs/Vấn đề |
| **P3 Danh sách–Chi tiết** | ECN, Recipes, Interlock, Standards, Integration | danh sách 35–40 % + chi tiết có tab; tạo/sửa/duyệt qua sheet |
| **P4 Cockpit** | Hub, Fleet, Safety | dải chip 32 px + một MAIN lớn + panel phụ |
| **P5 Launcher** | Studio | gộp vào Hub |

```
IDE mục tiêu (1600×950, sidebar rail 48)
┌ ◧Dự án▾ v2●nháp │ ✓Kiểm ⚒Build ⏵Mô phỏng ⇪Deploy… │ Soạn✓·Kiểm○·Build○·Deploy○ │ ⓘ │ Review ⏳ (40px) ┐
├─┬ EXPLORER 260 ─┬ [Main.bas●][Δ v1↔v2][Tags] (32) ──────────────────┬ INSPECTOR/COPILOT 380 ──┤
│📁│ ▾Dự án        │                                                     │ [Thuộc tính|Copilot]    │
│🔍│ ▾Phiên bản    │   EDITOR (MAIN) ~870×580  (≈45–61 % khung)          │                         │
│⎇ │ ▾Tags / IO    │                                                     │                         │
│⏵ │ ▾Deploy       │                                                     │                         │
├─┴───────────────┴─────────────────────────────────────────────────────┴─────────────────────────┤
│ [Vấn đề][Build/Mô phỏng][Lịch sử deploy][Ma trận máy×ver]  (200px, gập được)                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Ln1 Col1 · zmotion-basic · Triển khai thật: ON · Copilot ● (24px)                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Shell (áp cho mọi màn):** một breadcrumb, dời vào top bar (+101 px dọc); bỏ padding kép (+32–48 px); sidebar **tự thu gọn ở màn workbench** — nhưng phải sửa rail trước (hiện thu gọn chỉ còn 2 icon nhóm, mất điều hướng) bằng flyout submenu kiểu VS Code; **một lối vào AI mỗi ngữ cảnh** (workbench: Copilot là panel phải trong layout; màn khác: nút AI mở sheet phải, Esc đóng; dock không đè top bar); Beta / "Khi nào dùng" / ghi chú khoá → chip + popover.

**Thành phần dùng chung cần làm:** `PageHeaderCompact` · `NoticeChip+Popover` · `StatusChipStrip` · `WorkbenchShell` (trên `WorkspaceShell` sẵn có) · `SplitListDetail` + `DataTable` · `FlyoutHost` (một stack sheet phải/trang, đồng bộ URL `?flyout=`) · `DetailSheet` · `WizardDialog` · `VersionHistoryPanel` + `DiffView` + `RollbackConfirm` (hiện viết lại 4 lần) · `ApprovalQueue` (hiện 2 lần) · `CopilotPanel` (một lõi).

### 1.4 Vai trò
- **Supervisor:** sidebar chế độ "Đơn giản" **trống** (264 px vô ích); Hub báo "không có gì chờ" dù ECN đang chờ họ duyệt; phải xem layout soạn thảo với 7 nút mờ ⇒ cần Hub hộp-việc-trên-cùng và "chế độ duyệt" (chi tiết + sheet ký).
- **Operator:** vào được IR, POU, Copilot (công cụ soạn thảo/AI) nhưng **không** vào được Hub ⇒ chỉ nên thấy màn giám sát chỉ đọc.

### 1.5 Thứ tự làm FE (FE2 §5) và rủi ro
ECN (S) → Interlock (S/M) → Recipes (M) → Integration (M) → Safety (M/L) → Standards (L) → Fleet (L) → Orchestration (L) → **IDE (L — phải nâng ~40 `useState` lên Context/reducer trước khi tách card)** → IR + POU (L) → gộp Hub/Studio (S). Rủi ro: 5 trang có test DOM mới phải sửa cùng lúc; giữ nguyên `FeatureStatusGate` 4 trạng thái (Đợt 1 Task 1), `ConfirmWithReason` + OTP và maker-checker khi đưa vào component chung.

## 2. Backend

### 2.1 Ma trận mức hoàn thiện theo lớp

Thang: **M0** không có · **M1** khung/stub · **M2** cài thật + test mock · **M3** chạy thật end-to-end với giả lập qua mã sản phẩm · **M4** chứng minh trên thiết bị/tải thật · **M5** sẵn sàng sản xuất.

| Lớp | Thành phần | Mức | Bằng chứng then chốt | Phụ lục |
|---|---|---|---|---|
| **L0 Driver PLC** | OPC UA | **M3** | chạy đúng với server node-opcua; **không có bảo mật** (SignAndEncrypt ⇒ không kết nối); ghi Float/Int16/UInt* lỗi kiểu | BE1 |
| | SLMP 3E/4E (Mitsubishi) | **M3** | đúng với mock theo đặc tả; chỉ Int16 | BE1 |
| | Modbus TCP | M3 nhưng **P0 treo vĩnh viễn** | kill server ⇒ kẹt `reconnecting`; cổng đóng treo >10 s | BE1 |
| | Mitsubishi MC 1E (`mcprotocol`) | M2 — **P0 sập tiến trình** | `ETIMEDOUT` không bắt ⇒ `process.exit(1)` | BE1 |
| | S7, EtherNet/IP | M2 | chỉ kiểm nhánh lỗi (không có giả lập) | BE1 |
| | Khởi động gateway OT | **P0 boot treo** | 15 adapter DB ⇒ kẹt ở adapter Modbus thứ 3, HTTP không listen | BE1 |
| **L0 Giao thức khác** | MTConnect, CFX, VDA 5050, SECS/GEM | M3 | chạy với sim; phát hiện mất kết nối kém (MTConnect trả `[]` im lặng, VDA/SECS vẫn "connected") | BE1 |
| | Hot-folder AOI/AVI | M2 | 0 thư mục cấu hình; parser các hãng "ASSUMED SHAPE" | BE1 |
| | FOCAS, Euromap 63, IO-Link | M0–M1 | khung | BE1 |
| **L0 Robot** | Techman | M2 — **P0 treo + checksum sai + mọi reply = done** | T1 (BE2), driver treo (BE1) | BE1, BE2 |
| | UR / FANUC RMI | M2 | chưa chạy; HIL coi script hỏng là PASS | BE2 |
| | Zmotion | M1 | koffi chưa cài; deploy bỏ qua mọi cổng | BE2 |
| **L1 Ingest** | REST `/api/ot/ingest` | **M3** | 700 req/s; **lô ≥7.000 mẫu ⇒ `200 ok` nhưng 0 mẫu lưu** | BE3 |
| | Khoá máy ↔ thiết bị | **M1** | khoá ESP32 ghi được telemetry cho máy bắt vít | BE3 |
| | REST v1 (đường doc 61) | M2 | 429 sau 300 req/phút (limiter trình duyệt) | BE3 |
| | MQTT broker | M2 | 32k msg/s; nhận thiết bị lạ không mật khẩu; log flood 154 MB/phút; không TLS | BE3 |
| | Store-and-forward | server M2 · SDK M1 | WAL không nguyên tử; `ts` sai làm hỏng WAL; chưa thử DB sập | BE3 |
| | Lưu trữ Timescale | M3 | 69 GB / 234,8 triệu dòng; 10k mẫu/s ⇒ đầy ổ ~3 ngày | BE3 |
| **L2 Realtime** | Socket fan-out | **M3** | 1.000 client p99 95 ms | BE3 |
| | Xác thực/ACL socket | M1–M2 | `confirm_mapping` vô danh vào phòng máy, nhận 100 % telemetry, đánh dấu online; bão 1.000 sự kiện ⇒ ingest treo 18 s | BE3 |
| **L3 Đường lệnh** | commandDispatcher | M2 | `command_log` = 0; HITL không gắn với lệnh (594 bản ghi tái dùng được); sổ ghi SAU khi ghi thiết bị | BE2 |
| | robotCommandDispatcher | M2 | không kiểm safety-PLC; timeout không gửi abort | BE2 |
| | Interlock / Safety-PLC / Commissioning | M2 / M1–M2 / M2 | thiếu dữ liệu ⇒ cho qua; safety đọc SIM "OK", `UNKNOWN` cho qua; commissioning seed không gắn endpoint | BE2, BE3 |
| | Sparkplug DCMD (ĐANG BẬT) | M2 | broker EMQX :1884 nhận CONNECT ẩn danh; không actionId ⇒ bỏ qua HITL | BE2 |
| | `simTargets.validateUrscript` | **đường vòng nguy hiểm** | host tuỳ ý + tự `power on` + `brake release`, không qua cổng nào | BE2 |
| **L4 Deploy chương trình** | programmingService | M2 | WS-02/FLOW-02 còn mở; `verified` không bao giờ đạt | BE2 |
| | Zmotion / Mitsubishi / Techman / OpenPLC / gcode | M1 / M0–M2 / M1 (gửi `ScriptExit()`) / M0 / M0 | | BE2 |
| | Fleet canary | M2 | `simulated` tính là ĐẠT ⇒ promote sang máy thật | BE2 |
| **L5 Runtime** | FOE | M2 (M3 dry-run) | không lease; 2 node ⇒ 2 driver/run | BE3 |
| | VDA 5050 runtime | M2 | "done" = PUBACK; order có thể gửi 2 lần | BE2, BE3 |
| | Alarm → Andon | M2 | 0 sự kiện/7 ngày; CLEAR bị bỏ | BE3 |
| **L6 Nền tảng** | Topology / cấu hình | M2 / M1–M2 | một tiến trình; 224 cờ `*_ENABLED`, 366 biến không tài liệu | BE3 |
| | DB | M2 | **0 backup, 0 lần thử restore**; `shared_buffers` 128 MB; không replica | BE3 |
| | Bảo mật / quan sát | M1–M2 / M2 | HTTP+MQTT plaintext; `/metrics` không xác thực; **`/health` báo OK khi DB sập**; **đồng hồ server không đồng bộ (CMOS)** | BE3 |

### 2.2 Theo loại thiết bị — hôm nay có dùng được không?

| Thiết bị | Đọc dữ liệu (telemetry) | Ghi lệnh / tham số | Tải chương trình | Đường nên dùng | Việc tối thiểu tới M4 |
|---|---|---|---|---|---|
| Mitsubishi iQ-R / FX5U | **Giả lập được** (SLMP) | giả lập được ở tầng driver | KHÔNG | SLMP 3E binary (**không** dùng `mcprotocol`) | 32-bit; vá WS-02; tag writable + guardrail; commissioning gắn endpoint; bench FX5U; FAT |
| Siemens S7-1200/1500 | Chưa (OPC UA thiếu bảo mật; S7 chưa chạy) | KHÔNG | KHÔNG | OPC UA SignAndEncrypt | bảo mật OPC UA + ép kiểu; PLCSIM Advanced; FAT |
| Omron NJ/NX | Chưa | KHÔNG | KHÔNG | OPC UA | như Siemens |
| Zmotion ZMC | Chưa (Modbus sau khi sửa treo) | — | KHÔNG | — | koffi + DLL; deploy qua cổng ghi chung; FFI trong worker có timeout; CRC/đọc lại; ZDevelop ảo → ZMC |
| Robot Techman | Chưa (**P0 treo**) | **KHÔNG an toàn để thử** | KHÔNG (gửi `ScriptExit()`) | Modbus + Listen Node | sửa treo, checksum, ACK, bảng thanh ghi thật, danh sách trắng script |
| Robot UR | Chưa | chỉ giả lập | IR → URScript: simulated | URScript + RTDE | sửa HIL `accepted`; khoá `validateUrscript`; RTDE; URSim ⇒ M3 |
| OpenPLC (soft-PLC) | Modbus | Modbus | **M0** | — | client webserver + docker — **đích nhanh nhất để chứng minh deploy chương trình end-to-end** |
| AMR (VDA 5050) | giả lập được | giả lập được | — | VDA 5050 | ACK qua `state`; cancelOrder; broker có xác thực; AGV sim ⇒ M3 |
| Máy AOI/AVI nội bộ | **REST ingest (pilot live)** | recipe qua config-sync (tắt) | — | REST `/api/v1/ingest/inspection` | ràng buộc khoá↔thiết bị; bật config-sync; FAT |
| Máy AOI/AVI hãng | hot-folder (0 cấu hình) | — | — | hot-folder | file xuất thật từng hãng |
| CNC FANUC | MTConnect (agent) | — | — | MTConnect agent trên PC edge | `/sample` theo sequence; phát hiện agent chết |
| IoT ESP32 | REST telemetry `mk_` | — | — | REST | ràng buộc khoá↔thiết bị; không mất dữ liệu lô lớn |

### 2.3 Năng lực một node (BE3 §2)
Khuyến nghị hôm nay: **~1–2k mẫu/s chạy bền** (≈300–600 máy × 4–5 tag mỗi 1–2 s) qua gateway, lô 100–1.000. Chỗ gãy đầu tiên là **lưu trữ**: 10k mẫu/s ⇒ ~290 GB/ngày thô ⇒ đầy ổ ~3 ngày. Nén sau 1 ngày + bỏ 2 index thừa + continuous aggregate ⇒ ~5k mẫu/s.

### 2.4 Test xanh không phải bằng chứng
264/264 test mock đường điều khiển và 161/161 test driver đều xanh — **không test nào bắt được** 3 P0 driver, checksum Techman, HIL chấp nhận script hỏng, lệch FIFO TCP, mất dữ liệu lô lớn hay giả mạo thiết bị. Mọi lớp cần **test chạy với giả lập giao thức thật** (đã viết sẵn trong scratchpad của phiên khảo sát) trước khi coi là M3.

## 3. GAP — thứ tự phải làm

### 3.1 P0 — trước khi nối BẤT KỲ thiết bị thật nào (có thể làm bằng mã, đề xuất đưa vào Đợt 1B)

| # | GAP | Lớp | Phụ lục |
|---|---|---|---|
| 1 | Driver Modbus/Techman treo vĩnh viễn; MC 1E làm sập tiến trình; bật gateway OT làm boot treo (khởi động adapter phải không chặn `listen`, có timeout từng adapter) | L0 | BE1 |
| 2 | `validateUrscript` / `ursimPing` nhận host tuỳ ý (power on + nhả phanh); HIL chấp nhận script hỏng | L3/L4 | BE2 |
| 3 | Techman: checksum TMSCT sai, mọi reply = `done`, "deploy" gửi `ScriptExit()`, `params.script` tuỳ ý; TcpLineClient lệch FIFO sau timeout; robot timeout không gửi abort | L0/L3 | BE2 |
| 4 | Dispatcher: HITL không gắn với lệnh (tool/adapter/tag/giá trị); sổ ghi sau thiết bị (cần dòng "intent" trước); safety `UNKNOWN` cho lệnh chuyển động; Sparkplug DCMD không actionId; canary coi `simulated` là đạt | L3 | BE2, BE3 |
| 5 | Ingest: lô lớn mất dữ liệu im lặng; `ts` sai hỏng WAL; khoá máy ghi được cho máy khác; đường v1 dùng limiter trình duyệt; process-result gộp mọi lỗi thành 400 | L1 | BE3 |
| 6 | Socket `confirm_mapping` vô danh (vào phòng máy, đánh dấu online, bão làm nghẽn DB); MQTT nhận thiết bị lạ không mật khẩu + log flood | L1/L2 | BE3 |
| 7 | `/health` và `/readyz` báo OK khi DB sập; `/metrics` không xác thực | L6 | BE3 |
| 8 | OPC UA không có bảo mật (SignAndEncrypt) và ghi sai kiểu — bắt buộc cho Siemens/Omron/Euromap 77 | L0 | BE1 |

### 3.2 P0 vận hành — cần chủ dự án/IT, không làm được bằng mã

| # | Việc | Vì sao |
|---|---|---|
| O1 | **Backup + PITR + một lần diễn tập restore có biên bản** | hiện 0 backup, 0 lần thử restore |
| O2 | **NTP cho server và thiết bị** | đồng hồ server đang chạy CMOS không đồng bộ; mọi dấu thời gian telemetry/audit phụ thuộc |
| O3 | TLS cho HTTP và MQTT, CA nội bộ; broker EMQX :1884 bắt xác thực | hiện plaintext, EMQX nhận ẩn danh |
| O4 | Quyết định: giữ `SPARKPLUG_COMMAND_ENABLED` / `OT_CONTROL_ENABLED` / `ROBOT_CONTROL_ENABLED` = true khi các cổng còn thiếu? | cờ đang mở; thứ giữ an toàn hôm nay là dữ liệu chưa điền (0 tag writable) |
| O5 | Commissioning seed (`SIM-FAT-*`, không hết hạn, không gắn endpoint) — xoá/thu hồi trước khi có thiết bị thật | "đã FAT" giả |
| O6 | VLAN OT, firewall, bind interface OT | broker/HTTP đang bind `0.0.0.0` |

### 3.3 P1 — để đạt M4 theo từng họ thiết bị
Chuỗi bench (mỗi họ một bàn thử, theo checklist HW-FAT ở BE1 §3 và BE2 §4): **OpenPLC (nhanh nhất, chứng minh deploy chương trình end-to-end)** → Mitsubishi FX5U qua SLMP → Siemens S7-1500 qua OPC UA bảo mật → UR qua URSim → Techman → Zmotion → AMR. Cùng lúc: SLMP 32-bit, Modbus đọc gộp khối + kiểu 32-bit, MTConnect `/sample`, VDA 5050 ACK qua `state`, hot-folder với file thật từng hãng, lưu trữ (nén 1 ngày, cagg), leader/lease (FOE, interlock engine), store-and-forward nguyên tử + diễn tập DB sập.

### 3.4 P2 — lên M5
HA nhiều node (Redis adapter + EMQX + Postgres replica), metric ingest/MQTT/WAL/pool + Alertmanager, registry cờ có schema, RLS có hiệu lực, license gate, quy trình phát hành/rollback, chứng nhận/hồ sơ an toàn (phần mềm là BPCS — chức năng an toàn luôn nằm trên safety PLC có chứng nhận).

## 4. Đề xuất tiến độ

| Đợt | Nội dung | Ghi chú |
|---|---|---|
| **Đợt 1 (đang chạy)** | trung thực trạng thái (Task 1 xong), Hub + tư thế an toàn (Task 2 đang chạy), KPI, nhãn DEMO, review phiên bản IDE, POST cho preview, validator ST, Copilot stream, lỗ Đợt 0 | plan `docs/superpowers/plans/2026-09-27-engineering-control-dot1.md` |
| **Đợt 1B (đề xuất — chèn ngay sau Task 2)** | 8 nhóm P0 §3.1 | mã thuần, TDD + test với giả lập giao thức |
| **Đợt 2 — Bố cục** | shell (1 breadcrumb, padding, rail + flyout submenu, 1 lối vào AI), 5 mẫu bố cục, `FlyoutHost` + thành phần dùng chung, migrate theo §1.5 | nghiệm thu bằng số đo FE1 (editor ≥45 % khung đầu, 0 breadcrumb trùng, 0 banner trước nội dung) |
| **Bench M3→M4** | theo §3.3 | cần phần cứng/giả lập hãng + O1–O6 |

## 5. Quyết định cần chủ dự án

1. **Đồng ý chèn Đợt 1B (P0 §3.1) ngay sau Task 2 của Đợt 1**, trước các task giao diện còn lại? (khuyến nghị: **có**)
2. **O4:** trong lúc Đợt 1B chưa xong, có tắt `SPARKPLUG_COMMAND_ENABLED` (và giữ `OT_CONTROL`/`ROBOT_CONTROL`) không? Khuyến nghị: **tắt Sparkplug DCMD** vì broker EMQX đang nhận kết nối ẩn danh; hai cờ còn lại giữ vì chưa driver nào kết nối.
3. **O1/O2/O3/O6** giao ai (IT/vận hành) và khi nào?
4. **Bàn thử đầu tiên:** OpenPLC docker (không cần phần cứng) + một FX5U? Khuyến nghị: **OpenPLC trước**.
5. **Đợt 2 bố cục:** bắt đầu sau Đợt 1B, theo thứ tự FE2 §5 (ECN → … → IDE → IR/POU)?

**Đã chốt (2026-09-26):** (1) chèn Đợt 1B — plan `docs/superpowers/plans/2026-09-27-engineering-control-dot1b.md`; (2) không sửa `.env` từ phiên mã — Task 6 Đợt 1B chặn DCMD thiếu actionId ngay trong mã, cờ `SPARKPLUG_COMMAND_ENABLED` do chủ dự án tự quyết; (3) O1/O2/O3/O6 giao **bộ phận Kỹ thuật**; (4) bàn thử đầu tiên **OpenPLC docker**, sau đó FX5U; (5) Đợt 2 sau Đợt 1B theo FE2 §5. **QĐ7 doc 80 (2FA):** không phải điều kiện tiên quyết — nhà máy không có internet thì 2FA là rào cản; chức năng đã được chủ dự án tự kiểm, bật thủ công khi cần.

## 6. Phương pháp và giới hạn
5 tác tử khảo sát song song (2 FE, 3 BE), chỉ đọc repo; DB dev chỉ SELECT; đo tải trên instance riêng :3017 với DB `_test`; driver chạy với giả lập giao thức cục bộ (node-opcua, modbus-serial ServerTCP, mock SLMP theo đặc tả, sim MTConnect/HSMS/VDA 5050 của repo, listener AMQP) và server TCP giả cho robot. **Chưa có:** thiết bị thật, giả lập của hãng (PLCSIM, URSim, ZDevelop, TMflow, OpenPLC), diễn tập DB sập, HA nhiều node, TLS, soak dài. Tác dụng phụ đã ghi ở từng phụ lục (NBIRTH/NDEATH trùng id trên EMQX dùng chung; 2 máy pilot trong `_test`; 722 hàng fixture `_test` ở Đợt 0).

## 7. Kết quả Đợt 1B (2026-09-27)

Plan `docs/superpowers/plans/2026-09-27-engineering-control-dot1b.md`. **43 commit** `0816faa7d..ec4c13247` (192 tệp, +24,5k/−1,6k). Mỗi task: test tái hiện với giả lập giao thức thật trong tiến trình (ĐỎ trước khi vá) → vá → xanh → đột biến từng lớp; review từng task + vòng sửa; review toàn nhánh + một đợt sửa cuối + re-review. Quét cuối: **88/88 tệp test chạm tới, 1.285/1.285 xanh; `tsc` sạch**; chỉ còn 4 đỏ có sẵn trước Đợt 1B (xacThucBeMatRest, congGiayPhepAiCensus, appErrorParamsCoverage twinCanhRouter, viStringCoverage twin3d).

| # doc 81 §3.1 | Đã đóng | Task |
|---|---|---|
| 1 Driver treo/sập, boot treo | Modbus/Techman đóng có hạn + destroy; MC giữ listener `error` (0 uncaughtException/30 s); ghi ngoài miền ⇒ `ok:false`; OT khởi động nền SAU `listen`, hạn từng adapter (tôn trọng `timeoutMs`), song song có giới hạn, legacy tự nối lại | 1, 2 |
| 2 Đường vòng URScript, HIL | `simTargets` chỉ nhận `targetId` của đích sim cấu hình, từ chối nếu trùng host robot/adapter thật (chuẩn hoá IP, fail-closed khi DNS lỗi, cấm 0.0.0.0/::, nối bằng IP đã kiểm); HIL chỉ đạt khi thấy `Program running: true` + safety NORMAL | 3 |
| 3 Techman, TcpLineClient, robot timeout | checksum đúng tài liệu (`*08`); phản hồi phân loại, không bao giờ `done` khi lỗi; deploy không gửi `ScriptExit()`; danh sách trắng script; UR cấm `params.script/home`; start/reset/pause Techman bị từ chối tới FAT; TCP nối lại sau timeout; FANUC đối chiếu reply theo tên gói + SequenceID; timeout ⇒ gửi dừng TRƯỚC khi chốt; hàng rào epoch — không byte chuyển động sau STOP; **khoá chuyển động** sau mất kết nối (gỡ bằng STOP xác nhận hoặc `robot.clearMotionLock` có audit); mỗi robot một chuyển động | 4, 5, final |
| 4 Dispatcher / HITL / ledger / Sparkplug / canary | HITL gắn đúng lệnh (hash chuẩn tắc) + tiêu thụ một lần (FOR UPDATE + CAS) cho **cả OT lẫn robot**; sổ ghi intent TRƯỚC thiết bị; safety `UNKNOWN` chặn (OT & robot, một vocabulary); Sparkplug DCMD không actionId ⇒ từ chối; interlock tự động ghim đúng rule; canary `simulated` không promote sang máy ghi thật | 3, 6, final |
| 5 Ingest | chia khối ≤1000 (lô 7k/12k lưu đủ); 200 chỉ khi đủ, 207/400/503/413; `ts` hỏng/tương lai >24 h loại riêng; WAL nguyên tử (OT + edge UNS); khoá máy chỉ ghi cho chính máy (machineId ghim từ khoá, deviceId phải trùng mã); rate-limit v1 sang tầng OT theo khoá đã xác thực; process-result 400/429/503 đúng nghĩa | 7, 8 |
| 6 Socket / MQTT vô danh | `SOCKET_MACHINE_AUTH_MODE` mặc định **enforce** (trong mã); bắt tay machineCode+apiKey; sự kiện dùng máy đã xác thực; giới hạn tần suất socket/IP; duyệt đăng ký cấp `mk_` + audit; MQTT từ chối username lạ/thiếu mật khẩu, tự đăng ký chỉ khi bật cờ, log gộp (10.000 dòng → 1) | 9, 10, final |
| 7 health/metrics | `/readyz` = `SELECT 1` thật (client ping riêng, hạn 1,5 s, quá hạn = 503); `/health` liveness; `/metrics` token hoặc loopback nghiêm | 11 |
| 8 OPC UA | SignAndEncrypt/Basic256Sha256, PKI + trust-list (TOFU gốc riêng, cần cờ vận hành); ghi đúng kiểu; lỗi theo tag; `nsu=`; mật khẩu qua secretBox, che khỏi trình duyệt, **đổi endpoint/bảo mật phải nhập lại** (giao dịch FOR UPDATE) | 12, final |

**Mức sau Đợt 1B:** các P0 mã của §3.1 đã đóng ở mức M3 (chạy thật với giả lập qua mã sản phẩm). **Chưa có M4** — cần bàn thử (OpenPLC trước) + O1–O6 (giao Kỹ thuật).

**Việc cần làm TRƯỚC lần restart :3000 tới (hành vi đổi khi chạy bản mới):**
- Đặt `METRICS_TOKEN` + bỏ comment khối `authorization` trong `monitoring/prometheus/prometheus.yml` (nếu không, Prometheus qua `host.docker.internal` nhận 403).
- Máy nối socket bằng khoá plaintext / không khoá sẽ không lên online (cần `mk_`, hoặc `SOCKET_MACHINE_AUTH_MODE=off` / `MACHINE_SHARED_KEY_ALLOWED=true`).
- Tablet FactoryAlertSystem mới không tự đăng ký MQTT (admin tạo trước, hoặc bật `MQTT_AUTO_REGISTER_UNKNOWN=true` tạm).
- **ĐÍNH CHÍNH (Đợt 1 Task 4, `990dccdfa`):** preflight an toàn chặn khi `UNKNOWN`, NHƯNG trên dev cấu hình safety-PLC duy nhất là `SIM-SAFETY-PLC-1` và nó đọc **OK từ giả lập** ⇒ lệnh ghi OT thật / chuyển động robot **KHÔNG bị chặn** bởi preflight (`OT_CONTROL_ENABLED`, `ROBOT_CONTROL_ENABLED`, `SAFETY_PLC_ADAPTER_ENABLED` đều true). Trộn config thật + SIM: một SIM OK có thể che một PLC thật không đọc được. Cần quyết định: SIM có được thoả preflight không (khuyến nghị: không, với đích đã commission). Panel `safety.sourceHealth` nay hiện "⚠ SIM (preflight dựa vào GIẢ LẬP)".
- Gateway dùng một khoá máy cho nhiều thiết bị nhận 403.

**Còn mở (cần quyết định hoặc đợt sau):** robot `hitl` không kèm actionId vẫn chạy (vda5050Router/Adapter, ros2Bridge — đề xuất đóng); khoá `IOT_GATEWAY` chưa gắn danh sách thiết bị trên `/api/ot/ingest`; MQTT `factory/{fId}/{máy khác}/sensor/*` ghi được cho máy bất kỳ + cầu telemetry tin `asset_id` + subscribe `factory/#`; thiết bị MQTT đã đăng ký chưa có mật khẩu (cờ `MQTT_ALLOW_PASSWORDLESS_REGISTERED`, mặc định bật); Docker HEALTHCHECK dùng `/health` (luôn 200) hay `/readyz`; loại mẫu `ts` tương lai >24 h ở mọi nguồn; `new Date(ts)` không múi giờ ở 2 cửa ingest (BG-96/99); tài liệu `IoTTelemetrySection` + doc 61 §5.2 còn hướng dẫn `deviceId` kiểu cảm biến (nay 403); khoá chuyển động chỉ trong bộ nhớ; FOE tự cấp phê duyệt; giao thức thật (FANUC echo SequenceID, TM `OK;warnings`, MELFA `OPEN=`) phải xác nhận ở FAT. Chi tiết từng mục: ledger `.superpowers/sdd/2026-09-27-engineering-control-dot1b/progress.md`.

## 8. Kết quả Đợt 1C (2026-09-28)

Plan `docs/superpowers/plans/2026-09-27-engineering-control-dot1c.md` — thực thi các quyết định chủ dự án 2026-09-27 (§7 "Còn mở"). **36 commit** `a001fdc25..d314232c7` (không tính plan Đợt 2 `f5f1c0ec8`), ~142 tệp. Quy trình như Đợt 1B: ĐỎ → vá → xanh → đột biến từng lớp; review từng task; review toàn nhánh (0 Critical, 4 Important) → một đợt sửa cuối → re-review phát hiện thêm 1 lỗ Important có từ trước ⇒ sửa 2 vòng → re-review sạch. Quét cuối nhóm robot/api-v1/FOE/VDA5050: **985/986** (1 = test `binding.db` nhạy tải, chạy riêng 13/13 ×2); `tsc` sạch.

| Quyết định chủ dự án | Đã làm | Task |
|---|---|---|
| (1) SIM safety-PLC KHÔNG thoả preflight cho đích đã commission | `SAFETY_SIM_ONLY`; PLC thật không đọc được ⇒ `UNKNOWN` (không bị SIM che); đọc PLC song song, hạn từng PLC 4 s, tổng OT 5 s | 1, final M4 |
| (2) Cổng recipe CHẶT | phân phối recipe set, `recordRecipeLoad`, changeover đi qua cổng chặt; gợi ý "cập nhật set" chỉ khi bản active mới hơn | 2 |
| (3) Đóng robot `hitl` không actionId | dispatcher từ chối `HITL_ACTION_REQUIRED`; **lệnh DỪNG không bao giờ bị chặn** bởi HITL/policy DENY (ghi override) | 3 |
| (4b) Allowlist thiết bị cho gateway | bảng `gateway_device_allowlist` (mig **0361**, chủ dự án đã áp lên dev); khoá `IOT_GATEWAY` chỉ ghi cho thiết bị trong danh sách, ở cả `/api/ot/ingest` và v1 | 4 |
| (4c) Đóng MQTT ghi chéo máy | thiết bị chỉ publish/subscribe dưới nhánh của chính máy (`factory/{f}/{mã}/…`, `syn/{đường của mình}/…`); gắn thiết bị↔máy (`mqttClient.bindMachine`), đổi/xoá mật khẩu (`rotatePassword`/`clearCredential`, hiện một lần, audit không chứa bí mật, ngắt phiên) | 5, 5b |
| (4d) Lệch ts — tìm gốc & sửa | **gốc:** `new Date(chuỗi không múi giờ)` đọc theo TZ tiến trình Node (+07 dev đúng tình cờ, container UTC lệch 7 h) + 5 câu SQL thô ép naive theo TZ phiên. Sửa: ts không múi giờ bị từ chối `ts_no_timezone` ở **mọi cửa ingest**; 5 câu `AT TIME ZONE 'UTC'` (test chạy dưới 2 TZ phiên, ĐỎ đúng 2 ca trên mã cũ); bảng lệch giờ theo thiết bị trong `storeForward.getStatus().skewByDevice`; định dạng `… GMT+0700 (Indochina Time)` (BG-72) được nhận đúng 07:26:51Z | 6 |
| QĐ 2026-09-28 "có bật" | `INGEST_REQUIRE_TIME_OFFSET` **mặc định BẬT trong mã** (chỉ tắt khi `false/0/off/no`); lỗi mang mã `INVALID_VALUE`/`timeOffsetRequired` + vi/en/zh | 6 |
| Docker HEALTHCHECK | Dockerfile + compose → `/readyz`; Helm liveness giữ `/health` | 6 |

**Sửa từ review toàn nhánh (an toàn DỪNG):**
- Robot STOP khi DB sập/treo/không cấu hình: mỗi bước DB trên đường dừng có hạn 1 s; lỗi ⇒ **STOP vẫn gửi**, sổ ghi sau (best-effort). Chuyển động vẫn fail-closed.
- Idempotency: phát lại chỉ khi cùng (robot, khoá, loại lệnh) và lần trước `done`; STOP thất bại/bị từ chối ⇒ gửi lại.
- ros2Bridge không publish thông điệp do người gọi đưa; một job một kênh.
- **Lỗ có từ trước, lộ ra sau Task 3:** `run_job {jobType:"abort", params:{order}}` qua api/v1/FOE bỏ qua mọi cổng chuyển động và driver VDA5050 publish thành LỆNH CHẠY ⇒ "abort" làm AGV chạy. Đóng bằng **ba lớp độc lập** (dispatcher tước params; mọi driver dùng MỘT bộ phân loại `server/services/robot/stopJob.ts` và chỉ gửi lệnh dừng cố định của hãng; adapter VDA5050 tự dựng instantActions). Đột biến từng lớp: gỡ một lớp, robot vẫn không chạy.

**Việc cần làm TRƯỚC lần restart :3000 tới (thêm vào danh sách §7):**
- Máy AOI gửi `inspectionTime` **không múi giờ** (mẫu thật `2026-08-18T09:30:00.150`) sẽ bị **từ chối** — cần máy gửi `Z`/`+07:00`, hoặc đặt `INGEST_REQUIRE_TIME_OFFSET=false` tạm. Mục WAL cũ phát lại vẫn được lưu (gắn `machine_naive`).
- Thiết bị telemetry/cảm biến gửi ts không múi giờ bị loại `ts_no_timezone` (đếm theo thiết bị trong `skewByDevice`).
- Thiết bị MQTT phải được gắn máy (Cấu hình → MQTT) mới ghi được sensor/telemetry; với `MQTT_REQUIRE_PASSWORD=false` không có danh tính thiết bị ⇒ ingest MQTT bị từ chối (log cảnh báo một lần khi khởi động).
- Gateway: điền `gateway_device_allowlist` cho từng khoá `IOT_GATEWAY`.
- AGV sau STOP ở trạng thái tạm dừng (`startPause`) tới khi có lệnh tiếp tục (`stopPause`, đi qua cổng chuyển động).
- Chưa đo "sau" trên runtime: cần build + restart :3000 (chủ dự án quyết).

**Cần chủ dự án quyết:**
1. **OT soft-stop khi safety-PLC chỉ SIM / không đọc được:** hiện bị từ chối (thông báo nói rõ "dùng E-STOP phần cứng"). Lý do: "stop" OT là ghi tag do người gọi chọn, chưa có metadata ghim tag dừng ⇒ miễn theo tên là lỗ. Muốn cho đi an toàn cần **ghim tag/giá trị dừng theo máy** — làm thành task?
2. **STOP khi DB sập + `FIELD_V2` bật:** kiểm quyền (ai được ra lệnh) cần DB ⇒ STOP phần mềm bị từ chối trong ~1 s (trước: treo). Giữ như vậy (E-STOP phần cứng không ảnh hưởng)?
3. Đường ZIP/tree v2: `completedAt`/`startedAt` không múi giờ vẫn đọc là UTC (ngoài phạm vi Task 6) — có áp luật từ chối như `inspectionTime`?
4. 5 thủ tục `kbStudio` có thuộc SKU AI không (census giấy phép AI)?

**Còn mở:** `safety_plc_configs` chưa theo đích (một PLC thật offline chặn mọi lệnh ghi thật); VDA5050 publish order hai lần (driver + adapter, chưa có caller); `docGioTuongNhaMay` còn regex ngày cùng lỗi M2; ghi sổ STOP dry-run chưa có hạn; bảng skew gồm cả mẫu do server đóng dấu; `revokeLinkedMqttClientsTx` không ngắt phiên; audit_logs đọc không theo phạm vi (enhancedAuditRouter); app FactoryAlertSystem không gửi mật khẩu MQTT (đổi mật khẩu tablet = khoá ngoài, UI đã cảnh báo); nhiều đỏ có sẵn không thuộc đợt (AOIPackages clientErrorCoverage/rawErrorMessageCensus, viStringCoverage F12, i18n-check kbStudio/repoWs, `server/mqtt.test.ts` testNGAlert ×2 từ `d467c6b56`). Ledger: `.superpowers/sdd/2026-09-27-engineering-control-dot1c/progress.md`.

**Sự cố vận hành 2026-09-28:** DB dev :5434 không trả lời (cổng TCP vẫn mở) — gốc: ổ C: đầy (0,5 GB; đĩa ảo Docker 195 GB), trùng lúc một truy vấn tổng hợp 14 ngày nặng. Chủ dự án dọn C:; khởi động lại Docker cần **`wsl --shutdown`** (VM WSL "up 4 days", restart Docker Desktop đơn thuần không đủ). Bài học: không chạy tổng hợp nặng trên DB dev; nên dời đĩa Docker sang D:.

## 9. Kết quả Đợt 1D (2026-09-28 → 10-02)

Plan `docs/superpowers/plans/2026-09-28-engineering-control-dot1d.md` — thực thi quyết định chủ dự án ở §8: (1) OT soft-stop "làm ngay" bằng ghim tag/giá trị DỪNG; (3) `completedAt`/`startedAt` ZIP/tree v2. **13 commit** `5e17b0929..ee1150a33` (52 tệp, +5,8k/−0,1k), migration **0362**. Quy trình: ĐỎ → vá → xanh → đột biến từng lớp; review từng task + vòng sửa; review toàn nhánh (0 Critical, 2 Important) → đợt sửa cuối → re-review sạch. Quét cuối: 22 tệp test chạm tới **321/321**; vùng lân cận 702/704 (2 robot/vda5050 không chạm, chạy riêng xanh); `tsc` sạch; census không đỏ mới.

| Hạng mục | Đã làm | Task |
|---|---|---|
| Ghim tag DỪNG theo tag | `device_tags.stop_value/stop_pinned_by/stop_pinned_at` (mig 0362); `deviceAdapter.tags.setStopPin` — quyền sửa + lý do ≥5 ký tự + audit trước/sau (control_audit_log + audit_logs, cùng giao dịch FOR UPDATE); chỉ tag writable + enabled, giá trị đúng kiểu | 1 |
| Ghim tự gỡ khi nghĩa tag đổi | đổi address/dataType/scale/offset/adapter, tắt writable/enabled, xoá tag; **sửa adapter đổi đích** (endpoint/protocol/machine/tuỳ chọn kết nối) gỡ MỌI ghim; áp ở **cả ba đường ghi**: router, import mapping-as-code, CLI `scripts/mappings-import.mjs`; bật lại tag KHÔNG hồi sinh ghim | 1 |
| Sửa lỗi có sẵn | `tags.update`/`adapter.update` trước đây ĐẶT LẠI cờ không gửi (bật/tắt "enabled" ⇒ tag thành chỉ đọc) — nay giữ nguyên | 1 |
| Dispatcher | lệnh `stop/e_stop` OT được miễn preflight an toàn (SIM_ONLY/UNKNOWN/BLOCKED) **chỉ khi** mọi lệnh ghi khớp đúng ghim của adapter đích; thiết bị nhận **giá trị ghim**, không bao giờ giá trị người gọi; kiểm lại với hàng tag bước 3 (kiểu, writable, enabled) và **kết nối đang chạy phải khớp cấu hình adapter hiện tại**; đọc ghim lỗi ⇒ không miễn; `machine_stop` gửi đúng ghim; bị từ chối ⇒ `stopPinReason` (no_pins, unpinned_tag, value_mismatch, pin_tag_changed, adapter_connection_stale…) | 2, final |
| UI | màn adapter: mục "Tag dừng phần mềm" (giá trị theo kiểu, lý do bắt buộc, cảnh báo), chip "Tag dừng"; tắt Writable/Enabled trên tag đang ghim phải xác nhận; nhắc soát lại commissioning; lý do từ chối dịch vi/en/zh; danh sách tag DỪNG trong hộp "Sổ ký" (System Health) | 3, final |
| ZIP/tree v2 ts | cờ **riêng** `INGEST_REQUIRE_PACKAGE_TIME_OFFSET` (mặc định **TẮT** — chủ dự án chốt vì mẫu máy AOI thật gửi giờ không múi giờ ở mọi cấp); bật ⇒ mọi `completedAt/startedAt` (board/position/capture/component) không múi giờ bị từ chối `INVALID_VALUE`/`timeOffsetRequired`, ZIP bị từ chối TRƯỚC khi ghi; `inspectionTime` giữ `INGEST_REQUIRE_TIME_OFFSET` (mặc định bật) | 4 |

**Việc cần làm TRƯỚC lần restart :3000 tới (thêm vào §7, §8):**
- **Áp migration 0362 lên DB dev TRƯỚC khi restart** `node scripts/apply-migration-0362.mjs --dev-only` (đã kiểm 2026-10-02: dev CHƯA có cột). Bản mới thiếu cột ⇒ mọi đọc `device_tags` hỏng (dispatcher, CRUD tag, commissioning, khởi động OT); bản cũ chạy được với cột mới ⇒ áp trước là an toàn. Script tự bỏ cuộc sau 5 s nếu không lấy được khoá bảng.
- Sau khi **trỏ lại adapter** sang thiết bị khác, phải **khởi động lại khung OT** (hệ thống chưa có reconnect từng adapter) trước khi lệnh DỪNG ghim được miễn preflight; trong lúc chờ, DỪNG đi preflight đầy đủ (`adapter_connection_stale`).
- Ghim tag DỪNG là cấu hình an toàn: giá trị sai = lệnh "dừng" có thể khởi động máy. Kỹ thuật ghim theo tài liệu PLC của từng máy, soát ở commissioning.
- Bật `INGEST_REQUIRE_PACKAGE_TIME_OFFSET=true` chỉ khi phần mềm máy AOI đã gửi `Z`/`+07:00`.

**Cần chủ dự án quyết:**
1. Lệnh DỪNG ghim bị từ chối `BUSY` khi hàng đợi adapter đầy — cho DỪNG chen hàng đợi?
2. Rào AI (L-7) vẫn từ chối `machine_stop` qua trợ lý AI khi an toàn BLOCKED/UNKNOWN (và khi `AI_OT_CONTROL_ENABLED` tắt — mặc định) — có cho AI dùng DỪNG ghim không? (Ruling R-1D-g: hiện KHÔNG.)

**Còn mở:** chưa trang nào gửi lệnh DỪNG OT nên câu lý do từ chối mới chỉ chứng minh ở mức unit; form sửa tag gỡ ghim không hỏi trước (có báo sau); `adapter.update` gỡ mọi ghim không báo trên UI; CLI import không ghi được người thực hiện; test dấu vân kết nối dùng bản chép ánh xạ adapter (nên thêm một test qua `loadEnabledAdapters` thật); `validateMachinePayload` mất vị trí lỗi lồng nhau; chưa có test tranh chấp FOR UPDATE khi hai người ghim cùng lúc; `commissioningRecheckRequired` chưa có màn nào đọc. Ledger: `.superpowers/sdd/2026-09-28-engineering-control-dot1d/progress.md`.

## 10. Kết quả Đợt 1E (2026-10-02)

Plan `docs/superpowers/plans/2026-10-02-engineering-control-dot1e.md` — chủ dự án chốt 2026-10-02: (1) **DỪNG ghim chen hàng đợi: Có**; (2) **trợ lý AI dùng DỪNG ghim khi an toàn BLOCKED/UNKNOWN: KHÔNG** (rào L-7 giữ nguyên, R-1D-g). **2 commit** `62369982a..3b72dac49`, không migration, không cờ mới.

- Khi `OT_CMD_SERIALIZE_ENABLED` bật và hàng đợi lệnh của adapter đầy, lệnh DỪNG **đã ghim đúng** (Đợt 1D) không còn bị `BUSY`: chạy ngay sau lệnh ghi đang gửi dở (không cắt được byte đang trên dây — chờ tối đa hạn ghi ~5 s, ~10 s khi bật đọc lại).
- **Lệnh đang CHỜ trước DỪNG bị huỷ** (ruling R-1E-a, khuôn hàng rào abort robot): chạy chúng sau DỪNG có thể khởi động lại máy. Lệnh gửi SAU DỪNG vẫn chạy theo thứ tự. Lệnh bị huỷ không bao giờ tới thiết bị, có dòng sổ `SUPERSEDED_BY_STOP` và mã lỗi `OT_COMMAND_SUPERSEDED_BY_STOP` ("Lệnh đang chờ đã bị huỷ vì có lệnh DỪNG — gửi lại nếu cần", vi/en/zh); gửi lại cần khoá idempotency mới. Một DỪNG chưa ghim đang chờ cũng bị huỷ (DỪNG ghim thay nó, R-1E-b).
- Cờ tắt (mặc định): không hàng đợi, DỪNG chạy ngay — y như trước.
- Kiểm: OT + equipment **831/831**; 11 đột biến đều đỏ; `tsc` sạch; census không đỏ mới.

**Còn mở:** lệnh ghi quá hạn thì hàng đợi đi tiếp trong khi driver có thể vẫn đang ghi ⇒ DỪNG có thể tới driver chồng với lệnh quá hạn (có từ trước Đợt 1E); câu dịch không hiện khoá lệnh DỪNG (có trong params + sổ).

## 11. Kết quả Đợt 2 — Bố cục (2026-10-04)

Plan `docs/superpowers/plans/2026-09-27-engineering-control-dot2-bo-cuc.md` — dựng lại bố cục 14 màn theo năm mẫu (§1.3). **106 commit** `02e3991ae..ef913de25` (~180 tệp), Task 1–15 kèm các vòng sửa, cộng **đợt sửa cuối** sau review toàn nhánh (22 commit `338628af0..8ef727d19`: I-1/I-3/I-4, M-1..M-10, các mục FINAL-WAVE; báo cáo `.superpowers/sdd/2026-09-27-engineering-control-dot2-bo-cuc/final-fix-report.md`); không migration. Hành vi nghiệp vụ/an toàn giữ nguyên, trừ một lỗi an toàn có từ trước lộ ra khi tách state IDE (Task 12b): "+ tạo dự án" không xoá build của dự án cũ ⇒ build cũ deploy được dưới dự án mới. Nay "+ tạo" reset như bấm chọn dự án, kết quả build/mô phỏng về trễ bị bỏ, và server từ chối deploy khi `expectedProjectId` ≠ dự án của build (kiểm trước OTP, sau giấy phép + quyền + phạm vi).

**Kết quả đo nghiệm thu (đo lại ở đợt sửa cuối, HEAD `044780702`, `after.json`):** **10/10 mục tiêu §1.1 đạt** trên thiết bị đo **đã commit** (mọi số dưới đây tái lập được bằng `scripts/ui-metrics/engineeringLayout.mjs`, không còn số từ bản sao thước). "Dialog → flyout" nay trọn: "Từ chối phiên bản" trong IDE là sheet. Còn một chỗ ngoài trạng thái thước đo: POU khi **mở** Explorer "Mở" 49,3 % < 50 % (số Task 14, chưa đo lại; mặc định gập: 61,7 %) — panel phải của POU nay gập được, nhưng tổ hợp "mở Explorer + gập panel phải" không phải trạng thái thước đo. Không ngưỡng nào bị hạ.

| Mục tiêu (§1.1) | Gốc Đợt 2 (`baseline.json`) | SAU (`after.json`) | Đạt? |
|---|---|---|---|
| IDE ≥45 % @1600 / ≥40 % @1366, kể cả mở Copilot | 17,7 / 6,5 % (mở Copilot 9,5 / 0,8 %) | **49,3 / 41,4 %** (mở Copilot như nhau) | ✅ |
| IR, POU ≥50 % @1600 | IR 4,8 %, POU 8,7 % | IR **51,4 %**, POU **61,7 %** (mở Copilot như nhau — thước nay KIỂM Copilot thật sự hiện ở biến thể mở và ẩn ở biến thể đóng) | ✅ ở trạng thái mặc định — POU mở Explorer "Mở": 49,3 % ❌ (giải thích dưới) |
| Orchestration ≥45 % @1600 | 6,0 % | **49,1 %** | ✅ |
| Khoảng dọc trước tiêu đề ≤100 px | 157–279 px | **67 px** (5 màn workbench) / **79 px** (các màn còn lại) | ✅ 14/14 |
| Màn có 2 breadcrumb | 11/14 | **0/14** | ✅ |
| Banner trước nội dung chính | 2–7 khối/màn (tới 574 px) | **0** ở mọi màn × kích thước × biến thể | ✅ |
| Dải KPI chip 32 px thay thẻ 130–146 px | 30 MetricCard trên 6 màn, dải 130–146 px | **0** MetricCard; chip `data-layout-kpi`, dải **32 px** | ✅ |
| Dialog tạo/sửa/duyệt → flyout | 32 Dialog + 12 AlertDialog trong tệp trang | 10/10 hành động khai báo mở **sheet** (+1 popover Sổ tay); `Dialog` giữa màn trong module **0** (`VersionReviewPanel` "Từ chối phiên bản" → sheet); AlertDialog chỉ còn cho xác nhận phá huỷ / bỏ thay đổi (rollback IDE nay qua `RollbackConfirm` dùng chung) + 1 "Kiểm định sự kiện" (dưới) | ✅ |
| Copilot/AI che nội dung = 0 | dock che tới 640 px² (thước); FE1: 378 px = 53 % @1366 | `coverMain` **0**, `aiInsideMain` **0** ở 8/8 bản ghi có Copilot | ✅ |
| Trang cao nhất (Standards tab cảnh báo) ≤1,5× | 8,10× / 10,02× (Task 9) | **1,00× / 1,12×** (màn `equipment-standards-alarms` của thước, `?tab=alarms`) | ✅ |
| (Ràng buộc 10) không cuộn ngang ở 1366 | — | cuộn ngang cấp trang (`hScroll`: tài liệu + `<main>`) **0 px ở 36/36** bản ghi — gác cứng của thước (≥1366: >1 px là LỖI); cuộn ngang **bên trong** ô: bảng Recipes/Integration + dải tab Copilot (dưới); cột thao tác Interlock nay dính phải | ✅ |

**Bảng TRƯỚC → SAU theo màn** (1600 / 1366; "vùng làm việc" = `workspacePct`, chỉ số nghiệm thu editor/canvas; gốc = `baseline.json`; mốc sau shell `baseline-sau-shell.json` và bảng đủ 34 bản ghi × 15 chỉ số ở báo cáo Task 16):

| Màn | Vùng làm việc % | Đỉnh MAIN px | h1 px | Banner trước MAIN | Breadcrumb | KPI (thẻ cũ → chip) | Che MAIN px² | Cao trang × | Hành động mở |
|---|---|---|---|---|---|---|---|---|---|
| Hub | 34,0/20,2 → 46,4/38,2 | 444/470 → 120 | 205 → 79 | 3 → 0 | 2 → 1 | 0 → 2 chip 32 px | 1152/576 → 0 | 2,28/2,92 → 1,00 | — |
| Studio ⚠ **bí danh** (nay Hub `?tab=catalog`) | 52,7/48,3 → 46,4/38,3 | 134 → 120 | không h1 → 79 | 0 → 0 | 1 → 1 | 0 → 2 chip | 2304 → 0 | 1,02/1,03 → 1,00 | — |
| IDE | 17,7/6,5 → **49,3/41,4** | 649/665 → 105 | 205 → 67 | 7 → 0 | 2 → 1 | — | 0 → 0 | 2,92/3,79 → 1,00 | Sổ tay: popover |
| IDE + Copilot | 9,5/0,8 → **49,3/41,4** | 685/741 → 105 | 205 → 67 | 7 → 0 | 2 → 1 | — | 0 → 0 | 3,09/3,89 → 1,00 | Sổ tay: popover |
| ECN | 47,2/38,0 → 55,2/59,4 | 347 → 124 | 157 → 79 | 2 → 0 | 1 → 1 | — | 1152 → 0 | 1,11/1,37 → 1,00/1,11 | Thay đổi mới: dialog → sheet |
| Recipes | 8,2/9,5 → 36,4/32,0 | 511 → 137 | 207 → 79 | 2 → 0 | 2 → 1 | — | 0 → 0 | 1,00/1,21 → 1,00 | Lưu phiên bản mới: dialog → sheet |
| Interlock | 39,0/28,4 → 59,8/52,6 | 399 → 125 | 205 → 79 | 3 → 0 | 2 → 1 | 0 → 3 chip | 1152 → 0 | 1,58/1,95 → 1,00 | Test (dry-run): sheet; Thêm quy tắc: khoá với engineer (đúng quyền) |
| Orchestration | 6,0/0 → **49,1**/41,2 | 790/810 → 105 | 259 → 67 | 5 → 0 | 2 → 1 | — | 1152/0 → 0 | 1,76/2,20 → 1,00 | Phiên bản, Nhân bản: dialog → sheet |
| IR | 4,8/0 → **51,4**/43,8 | 704/740 → 105 | 259 → 67 | 5 → 0 | 2 → 1 | 4 thẻ 130 px → 0 | 0 → 0 | 2,75/3,48 → 1,00 | Project ir-flow mới: dialog → sheet |
| IR + Copilot | 0,6/0 → **51,4**/43,8 | 822/895 → 105 | 259/279 → 67 | 5 → 0 | 2 → 1 | 4 → 0 | 640/0 → 0 | 2,94/3,87 → 1,00 | như trên |
| POU | 8,7/0 → **61,7**/55,3 | 629/649 → 105 | 259 → 67 | 5 → 0 | 2 → 1 | 4 thẻ 130 px → 0 | 0 → 0 | 1,47/1,88 → 1,00 | Lưu vào project: dialog → sheet |
| POU + Copilot | 3,5/0 → **61,7**/55,3 | 689/817 → 105 | 259/279 → 67 | 5/6 → 0 | 2 → 1 | 4 → 0 | 0 → 0 | 1,56/2,15 → 1,00 | như trên |
| Copilot ⚠ **bí danh** (nay IDE `?copilot=scratch`) | 12,9/18,7 → 51,3/43,6 | 315 → 105 | 157 → 67 | 2 → 0 | 1 → 1 | — | 0 → 0 | 1,00/1,03 → 1,00 | — |
| Fleet | 16,6/0,2 → 40,4/33,8 ¹ | 653/673 → 120 | 259 → 79 | 6 → 0 | 2 → 1 | 9 thẻ 130 px → 5/3 chip | 1152 → 0 | 1,20/1,51 → 1,00 | — |
| Safety | 0/0 → 46,4/40,4 | 805/825 → 120 | 259 → 79 | 7 → 0 | 2 → 1 | 4 thẻ 130 px → 4/2 chip | 1152/0 → 0 | 1,80/2,27 → 1,00 | Báo cáo tiệm cận: dialog → sheet |
| Standards | 15,7/0 → 64,5/58,2 | 669/689 → 120 | 259 → 79 | 6 → 0 | 2 → 1 | 5 thẻ 146 px → 4/2 chip | 1152 → 0 | 1,89/2,37 → 1,01/1,02 | Đăng ký loại: dialog → sheet |
| Standards — tab cảnh báo (màn mới của thước) | — (FE1/gốc không đo tab này; Task 9: cao 8,10/10,02×) | **56,3/59,8** | 120 | 79 | 0 | 1 | 4/2 chip | 0 | **1,00/1,12** | Chuẩn hóa cảnh báo: sheet |
| Integration | 22,6/7,2 → 64,1/57,8 | 673/693 → 120 | 259 → 79 | 6 → 0 | 2 → 1 | 4 thẻ 130 px → 3 chip | 1152 → 0 | 1,31/1,70 → 1,00 | — |

¹ Fleet thấp hơn số Task 16 (41,7/35,2) vì dòng chẩn đoán tiếng Anh thô của lưới 40×40 rỗng (đọc `factoryId=1` dự phòng) đã biến mất: lưới nay chỉ đọc khi biết nhà máy; MAIN co đúng phần dòng đó (hiệu chuẩn lại 1366: −3,87 % diện tích). Fleet không có ngưỡng % riêng.

⚠ **Hai bí danh KHÔNG cùng loại (ruling R-2-x).** Studio và Copilot đã gộp ở Task 15; URL cũ chỉ còn chuyển hướng. Số TRƯỚC là trang cũ (launcher Studio; form Copilot), số SAU là trang đích (tab Danh mục của Hub; IDE chưa mở dự án + Copilot). Không đọc hai dòng này như cải thiện hay thoái lui của cùng một màn — vd vùng làm việc "Studio" 52,7 → 46,4 % là hai trang khác nhau.

**Giải thích chỗ chưa đạt (không hạ ngưỡng):**
1. **Dialog duyệt — đã sửa ở đợt sửa cuối.** "Từ chối phiên bản" (`components/engineering/VersionReviewPanel.tsx`) nay là sheet bên phải, hợp đồng giữ nguyên (lý do bắt buộc sau trim, chỉ người KHÁC tác giả có quyền, Huỷ không gọi server). AlertDialog còn lại: 10 là xác nhận phá huỷ/không hoàn tác hoặc bỏ thay đổi chưa lưu (bỏ sửa, xoá biến, rollback, lưu trữ recipe, xoá workflow, chạy tiếp run có thể ra lệnh thật, huỷ tác vụ, đóng phân công, huỷ phối hợp) — đúng ngoại lệ của mục tiêu; **1** là "Kiểm định sự kiện an toàn?" (Safety): chỉ ghi dấu người duyệt, không phá huỷ, nên theo đúng chữ thì không thuộc ngoại lệ. Wizard deploy 4 bước của IDE là `WizardDialog` theo thiết kế §1.2–1.3 (bước ký duyệt dùng ConfirmWithReason + OTP).
2. **POU khi mở Explorer "Mở": 49,3 % @1600** (Task 14, ruling R-2-u; không đo lại). Mặc định Explorer gập ⇒ 61,7 %, và thước đo trạng thái mặc định. Mở Explorer (240–300 px theo §1.3) lấy đúng phần đó của canvas. Đợt sửa cuối cho panel phải của POU **gập được** (nút trên thanh editor; mở Copilot thì panel tự mở lại) — người dùng có thể lấy lại chỗ cho canvas khi mở Explorer; tổ hợp này không được thước đo nên không ghi số.
3. Màn danh sách không có ngưỡng % riêng. Recipes thấp nhất (36,4/32,0 %) vì MAIN là danh sách + chi tiết rỗng khi `_test` không có recipe — ghi để theo dõi, không phải trượt ngưỡng.

**Quan sát từ ảnh chụp (ngoài thước, để chủ dự án xem):**
- Canvas IR/POU: nút điều khiển + minimap của React Flow và bảng "THÊM · LD" của POU hiện khối trắng, chữ trống trên nền tối.
- ~~Fleet hiện câu chẩn đoán tiếng Anh thô "empty 40x40 grid …"~~ — đợt sửa cuối: lưới chỉ đọc khi biết nhà máy; không có hình học ⇒ trạng thái trống (đã dịch) giữ đúng khung bản đồ.
- Breadcrumb top bar bị cắt ở 1366 khi sidebar mở ("Kỹ thuật & Điều khiển (").
- Tab "Copilot" ở panel phải IR/POU bị cắt (dải tab cuộn ngang trong 319 px).
- Cuộn ngang bên trong bảng: Recipes (lịch sử triển khai, 1366), Integration; Interlock (1366) — cột thao tác nay **dính phải** nên Duyệt/Bật/Tắt luôn thấy (kiểm sống: ô thao tác nằm trong MAIN, `position: sticky`).

**Phương pháp và MSA.** Thước `scripts/ui-metrics/engineeringLayout.mjs` (Task 1; README cùng thư mục) chạy Playwright trên instance tự dựng từ mã nguồn: server tsx :3016 `ROLE=api` không nạp `.env`, Vite dev :5176, DB `aoi_management_test`, hồ sơ cờ `dev`, mọi tích hợp ra ngoài tắt, user đo tạm `uim_engineer` (role engineer). 14 màn + tab cảnh báo Standards × 1600×950 / 1366×768 + 3 biến thể mở Copilot = **36 bản ghi**. MAIN = `[data-layout-main]` ở mọi màn, hiệu chuẩn `recorded-match` 36/36.
- Đợt sửa cuối (ruling R-2-z1) đưa vào thước đã commit: màn `equipment-standards-alarms` (`tabOf`: bản ghi hiệu chuẩn riêng, bản ghi mới chỉ khi attribute trùng phần tử của trang mẹ), phép đo `hScroll` (cuộn ngang cấp trang, gác cứng ≥1366), kiểm biến thể Copilot THẬT SỰ hiện/ẩn (`COPILOT_PROBE`, LỖI nếu không), `KNOWN_PROCS` Fleet có `fleet.robotPositions` + `twin.occupancyGrid`; tự kiểm 34 → **37** ca (T30–T32), gác 29 → **32**. `--calibrate` có chủ đích: ECN (phần tử mang attribute div → section, hình học lệch 0), Fleet 1366 (−3,87 %, ¹), tab cảnh báo mới.
- Lần 1 (`--shots`, kèm đối chứng dương) và lần 2 (`--mutation`) đều `pass=true`: 0 lỗi, tự kiểm **37/37** ca, gỡ từng gác **32/32 gác đỏ** (đo lại 0 lần), 0 kết nối ngoài danh sách, 0 trôi dữ liệu trên 57 bảng, cổng 3016/5176 "trống" sau khi tắt, user đo đã xoá, `gitDirty` rỗng (đo đúng HEAD `044780702`). `after.json` = lần 2.
- `--compare` lần 1 ↔ lần 2: **756 phép so, 0 lệch**, mọi cổng MSA đạt. So với `after.json` của Task 16: 714 phép so chung, **4** đổi — đều là Fleet (`mainPct`/`workspacePct` × 2 kích thước, ¹); mọi màn khác trùng từng số (đổi shell R-2-z4 sang `--shell-chrome-h` không đổi hình học).
- Kiểm sống thêm (instance tự dựng, sau đó tắt): bơm một hàng chrome 32 px (như thanh license nghiêm trọng R-2-i) ⇒ `--shell-chrome-h` 56 → 88 px, Interlock/Recipes/IDE/Fleet/Hub không tràn (tài liệu và `<main>` 0 px); tab cảnh báo Standards vốn cao 1,12× ở 1366 thì phần cuộn tăng đúng 32 px.
- "Thêm quy tắc" Interlock khoá với engineer (đúng quyền).
- Ảnh 36 bản ghi: `.playwright-mcp/do-bo-cuc/anh/` (lần 1 của đợt sửa cuối; không commit).

**Test.** Task 16: **123 tệp, 2 099/2 110 xanh** (11 đỏ trong 5 tệp census, trong đó 1 của module). Đợt sửa cuối:
- quét các tệp test chạm trong cả Đợt 2 (`git diff --name-only 130f000ce..HEAD`, 53 tệp, 3 lô): **932/932 xanh**;
- bộ module + census (63 tệp: trang Engineering/IDE/IR/POU/Orchestration/ECN/Recipes/Interlock/Fleet/Safety/Standards/Integration, `components/{engineering,programming,patterns,orchestration}`, shell, contexts, `lib/` nav + census): **1 035/1 043**; 8 đỏ đều của bên khác — `rawErrorMessageCensus` **về 4** (twin3d ×3, AOIPackages; `RecipeManagement` đã sửa: trường lỗi đã dịch đổi tên `{ machineId, text }`), `clientErrorCoverage` (AOIPackages), `viStringCoverage` (twin3d hình-3);
- `tsc --noEmit` 0 lỗi; khoá i18n mồ côi do Đợt 2 để lại: 53 → **0** (vi/en/zh).

`congGiayPhepAiCensus`, `programmingCopilotStream.sseCensus`, `layoutKitI18n`, `errorMessageI18nCoverage`, `navKeyResolution`, `engineeringNavRouteGuardParity` xanh. Không build, không chạm `dist/`, không kết nối DB dev.

### Cần chủ dự án quyết

**Thay đổi hành vi có chủ ý trong Đợt 2 (đều đã review; ghi để chủ dự án biết):**
- **Giấy phép nghiêm trọng (R-2-i):** read-only / locked / không có license / server license mất liên lạc ⇒ thanh đỏ ≤32 px dưới top bar hoặc chip đỏ luôn hiện, CTA admin hiện sẵn — ngoại lệ có chủ ý cho chỉ tiêu "0 banner". Cảnh báo sắp hết hạn, hết hạn quyền, Beta vẫn là chip.
- **Một lối vào AI (R-2-b/j):** dock Copilot cố định đã **xoá**; IDE/IR/POU có Copilot nằm trong layout, màn khác mở sheet chat từ nút AI trên top bar; chat và Copilot không bao giờ chồng nhau.
- **Panel dưới gập mặc định (R-2-l)** trên Interlock, Orchestration, IDE…; số lượng (sự kiện chưa xử lý, chờ duyệt) luôn hiện ngoài panel; lựa chọn mở/gập của từng người được nhớ.
- **Chip trạng thái ghim (R-2-p):** số liệu an toàn/cảnh báo không bao giờ bị gộp vào "+N"; "+N" mang màu nghiêm trọng nhất của chip bị ẩn.
- **Hub:** 4 nhóm nghiêm trọng (recipe chạy chưa duyệt, sự kiện interlock mở, sự kiện an toàn chưa kiểm định, fleet bế tắc) luôn hiện ở mọi phạm vi hộp việc (R-2-y).
- **Điều hướng theo vai trò (R-2-w):** Operator/Viewer chỉ thấy 4 màn giám sát; menu không bao giờ hiện màn mà route chặn. Quyền phía server KHÔNG đổi.
- **Recipes:** triển khai vẫn **một máy mỗi lần xác nhận** như cũ (R-2-n) — kế hoạch có dòng "triển khai nhiều máy" nhưng không thêm khả năng tác động mới.
- **ECN / Standards / Recipes:** nút duyệt bị xám cho chính tác giả (trước: bấm được rồi server từ chối) — cùng luật, báo sớm hơn.
- **IDE (12b — sửa lỗi an toàn có sẵn):** tạo dự án mới / DEMO / deep link xoá sạch build/sim/diagnostics cũ; kết quả build đến muộn bị bỏ; server từ chối deploy khi `expectedProjectId` khác dự án của build (trước OTP, chỉ sau khi đã qua licence + quyền + phạm vi).
- **Kích thước:** top bar IDE 48 px (sơ đồ ghi 40; R-2-t — giữ nút 40 px để dễ chạm); explorer/inspector IDE 240/320 px (sơ đồ 260/380); IR explorer 200 px (R-2-u); panel cạnh giữ bề rộng px cố định, vùng chính tối thiểu 400 px.
- **Fleet:** bản đồ/vị trí/vùng làm mới mỗi 5 s khi trang mở (trước: chỉ ở tab Bản đồ); dừng khi tab trình duyệt ẩn.
- **Copilot:** trang riêng → chế độ "scratch" trong IDE; Operator/Viewer (không có `machine_control`) mất lối vào Copilot phía client — đúng doc 81 §1.4, cần chủ dự án xác nhận.

**Cần quyết:**
1. **Triển khai recipe nhiều máy** một lần xác nhận — có làm không, và chính sách khi một máy từ chối giữa chừng (dừng / tiếp tục / hoàn tác)?
2. **Màn đích cho nội dung chưa dời:** phiên bản recipe/lịch sử nạp → Recipes, worker thu ảnh → Vision (doc 81 §1.2), bảng nhân lực → Sản xuất › Ca — đều cần route/IA mới; hiện để tại chỗ kèm liên kết (worker thu ảnh và nhân lực chưa có liên kết vì chưa có màn đích).
3. **Copilot cho Operator/Viewer** — chấp nhận mất lối vào (theo §1.4) hay giữ một lối vào chỉ đọc?
4. **Hộp việc "của tôi" thật** (theo người được giao) — cần trường assignee phía server.
5. **Nhãn "Triển khai thật: ON"** khi adapter còn "(sắp có)" (thực tế chỉ mô phỏng) — giữ hay đổi chữ?
6. **Fleet sang "Labs"** (doc 80) — task IA riêng, chưa làm.
7. **POU khi mở "Mở":** canvas 49,3 % @1600 (mặc định gập 61,7 %) — chấp nhận?

**Cần người kiểm tay trên trình duyệt thật (chưa đo được tự động):** hộp OTP đè lên wizard deploy (staging, tới bước OTP rồi huỷ); lịch sử flyout (F5/back) trên vài trang; Copilot stream khi đổi cỡ cửa sổ qua 1024 px; màn hình điện thoại.

**Còn mở (đợt sau):** truy vấn lưới bản đồ Fleet chưa kiểm phạm vi nhà máy phía server (có từ trước); kênh thời gian (latency) cho caller ngoài phạm vi ở deploy (chỉ người đã có quyền); kết quả `startWatch`/`fleetResult` đến muộn; kích thước panel người dùng lưu trước đợt này bị bỏ một lần.
- (sau đợt sửa cuối) POU: gập panel phải khi Copilot đang mở ⇒ Copilot "mở" trên panel 0 px, nút AI đóng thay vì hiện; Fleet@1600 hiệu chuẩn chỉ còn biên 2,99 %/3 %; lưới bản đồ Fleet không tải khi vùng chưa có `factoryId` (chủ dự án lưu ý dữ liệu); form tạo ECN mất dữ liệu sau câu "Bỏ thay đổi?" (dialog cũ giữ khi Huỷ); dưới 1024 px chọn dòng chuyển sang tab panel dưới; sheet IDE/IR/POU chưa đồng bộ URL (chưa có FlyoutHost).

**Đã chốt (2026-10-04):** (3) Copilot cho Operator/Viewer — **chấp nhận mất lối vào** (đúng §1.4); (1) triển khai recipe nhiều máy — **KHÔNG**, giữ một máy mỗi lần xác nhận; (5) nhãn deploy — **đổi**: khi adapter của dự án còn "(sắp có)" hiện "Mô phỏng (adapter sắp có)" thay "Triển khai thật: ON" (task nhỏ sau Đợt 2). Gộp Đợt 2 vào main + push: đồng ý.

**Đã chốt (2026-10-05):** (2) màn đích — **làm cả 3** (phiên bản recipe/lịch sử nạp → Recipes, worker thu ảnh → Vision, bảng nhân lực → Sản xuất › Ca) trong **Đợt 3** riêng; (4) hộp việc "của tôi" — **theo người được giao** (thêm trường assignee, có migration) trong Đợt 3; (6) **Fleet dời sang Labs** trong Đợt 3; (7) POU 49,3 % khi mở "Mở" — **chấp nhận**. Đợt 3: viết plan, chủ dự án duyệt rồi mới làm. Migration 0362 — **đã áp lên DB dev 2026-10-05** (Claude chạy theo uỷ quyền; 3 cột + quyền avi_app đã kiểm). Kiểm trên trình duyệt thật — Claude làm bằng Playwright trên DB `_test`.

**Đã chốt (2026-10-05, duyệt plan Đợt 3 `docs/superpowers/plans/2026-10-05-engineering-control-dot3.md`):** QĐ-3a người được giao lưu ở **bảng chung `engineering_assignments`**; QĐ-3b nhóm **Labs ẩn mặc định**, mỗi người tự bật (⌘K vẫn tìm thấy; cảnh báo bế tắc trên Hub vẫn luôn hiện); QĐ-3c trang **Vision › Thu ảnh giữ cổng cũ** (quyền cảnh báo máy + cờ thu ảnh trực tiếp, không thêm MOD_AI). **Duyệt thực thi Đợt 3.** Kiểm trình duyệt thật 2026-10-05: 6/6 mục đạt; lỗi phát hiện (tên biến môi trường lộ ra UI khi Copilot tắt, nút/tab bị khuất ở màn điện thoại, điều khiển React Flow trắng ở chế độ tối, chữ bị cắt ở 1366, tiêu điểm sau Huỷ OTP) sửa ở Đợt 3 Task 0.

## 12. Kết quả Đợt 3 (2026-10-05)

Plan `docs/superpowers/plans/2026-10-05-engineering-control-dot3.md` thực hiện các mục "Đã chốt 2026-10-05" ở §11: dời nội dung về đúng màn, hộp việc "Của tôi" theo người được giao, Fleet sang Labs. Thêm Task 0 sửa lỗi phát hiện khi kiểm trình duyệt thật (ruling R-3-a).
- **33 commit** `3a3996c8c`…`97a11dce7`: Task 0–5 kèm các vòng sửa, rulings R-3-a..g.
- **Một migration (0363)**.
- Hành vi nghiệp vụ và an toàn giữ nguyên. Mọi mutation dời chỗ giữ đúng target, cổng, xác nhận và payload (R-2-n). Không có thao tác hàng loạt. Quyền phía server không đổi, trừ phần giao việc mới (dưới).
- Ledger: `.superpowers/sdd/2026-10-05-engineering-control-dot3/progress.md`.

### 12.1 Dời màn (Task 1–3, 5)

| Nội dung | Trước | Nay | URL cũ |
|---|---|---|---|
| Phiên bản recipe (tích hợp) | Integration `?tab=recipes` | **Recipes** tab Phiên bản: thêm Phát hành, Rollback, Ghi nhận nạp. Tạo và lưu trữ gộp về bộ của Recipes; lưu trữ nay cần quyền sửa và có hộp xác nhận | `/equipment-integration?tab=recipes` ⇒ `/recipes?tab=versions` |
| Lịch sử nạp | Integration `?tab=history` | **Recipes** tab "Lịch sử nạp" (theo mã hoặc theo máy) | `?tab=history` ⇒ `/recipes?tab=history` |
| Worker thu ảnh | Integration `?tab=acquisition` | **Vision › Thu ảnh** `/vision/acquisition` | `?tab=acquisition` ⇒ `/vision/acquisition` |
| Bảng nhân lực | Safety `?tab=workforce` | **Sản xuất › Ca** `/production/shifts`: lọc theo ca, cột Ca, sheet chi tiết chỉ đọc | `/safety-workforce?tab=workforce` (và `?flyout=workforce-assign/reassign`) ⇒ `/production/shifts` |
| Fleet | Kỹ thuật › Điều phối `/fleet-orchestration` | **Kỹ thuật › Labs — thử nghiệm** `/labs/fleet-orchestration` | `/fleet-orchestration` ⇒ `/labs/fleet-orchestration` |

- **Mọi chuyển hướng** là REPLACE và giữ nguyên query, kể cả `?filter=deadlock`, `?flyout=…&flyoutId=…`, khoá lặp và `%20`. Chúng nằm trong `client/src/lib/engineeringLegacyRedirects.tsx` và mỗi cái có test.
- Chuyển hướng **chỉ** chạy khi người dùng mở được màn đích. Người không có quyền ở lại trang cũ, nên không ai bị đưa vào trang từ chối.
  - Operator/Viewer (không có `machine_control`) giữ một tab **chỉ xem** "Phiên bản & lịch sử nạp" trên Integration (R-3-b).
- **Cổng** giữ như chỗ cũ:
  - Recipes: `machine_control`.
  - Thu ảnh: quyền cảnh báo máy cộng cờ thu ảnh trực tiếp, **không** MOD_AI (QĐ-3c). Giấy phép là MOD_OT_CONTROL như Integration.
  - Ca: `machine_status`, giấy phép MOD_OT_CONTROL. Phối hợp người–robot **ở lại** Safety.
  - Fleet: `machine_status` + MOD_OT_CONTROL + cờ FLEET_ORCH, không đổi.
- **Lối vào khi thiếu giấy phép:**
  - SKU có OT mà không có MOD_AI: mục bí danh `/engineering/vision-acquisition` trong menu Kỹ thuật, cộng chip "Worker thu ảnh → Vision › Thu ảnh" trên Integration (R-3-d).
  - SKU không có MOD_PRODUCTION: bí danh `/engineering/production-shifts`, cộng chip "Nhân lực → Sản xuất › Ca" trên Safety.
- **Labs** ẩn mặc định. Mỗi người tự bật "Hiện Labs" ở chân thanh bên; lựa chọn lưu theo người dùng **trên trình duyệt đó**.
  - ⌘K, RouteGuard và deep link không lọc Labs.
  - Cảnh báo bế tắc Fleet trên Hub vẫn ghim (R-2-y) và mở đúng `/labs/fleet-orchestration?filter=deadlock` khi Labs đang ẩn (đã kiểm sống).
  - Ghim/Gần đây lưu URL cũ được đọc như URL mới.
- **TabbedHub (R-3-c, sửa lỗi chung có từ trước):** tab không hoạt động nay ẩn thật. Trước đó mỗi tab ẩn để lại một hộp rỗng 8 px.

### 12.2 Hộp việc "Của tôi" theo người được giao (Task 4, migration 0363)

- **Lưu trữ:** bảng chung `engineering_assignments` (QĐ-3a). Mỗi mục có tối đa một phân công active (unique một phần).
  - `avi_app` chỉ được SELECT/INSERT và UPDATE cột `active`; không DELETE, nên lịch sử chỉ thêm.
  - Cột `pending_episode` cho biết phân công thuộc **đợt chờ duyệt** nào.
  - `orchestration_runs.pending_epoch` cùng trigger tăng mỗi lần run vào `held`/`awaiting_confirm`.
- **Migration 0363 ĐÃ ÁP lên DB dev ngày 2026-10-05** (controller chạy theo uỷ quyền chủ dự án) bằng lệnh `node scripts/apply-migration-0363.mjs --dev-only`. Đã kiểm:
  - cột và index;
  - quyền `avi_app`;
  - chuỗi trigger `[0,1,1,1,2,2]`, đo trong giao dịch hoàn tác.
- Từ R-3-g, mọi script apply 0357–0363 **từ chối chạy** nếu không ghi đúng một đích `--dev-only` / `--test-only` / `--both`.
- **Bốn thủ tục** `engineering.assign`, `unassign`, `assignments`, `assignableUsers` áp cho năm loại: ECN, recipe nháp, quy tắc interlock, changeover, orchestration run đang giữ.
  - Mỗi lần giao hoặc bỏ giao ghi 1 dòng `control_audit_log` và 1 dòng `notifications` có deep link, trong cùng giao dịch. Thông báo bỏ giao trung tính: chỉ loại và #id, không tiêu đề.
  - Giao dùng CAS (`expectedAssigneeUserId`), nên hai người giao cùng lúc ⇒ CONFLICT.
  - Người được giao không tồn tại, không hoạt động hoặc không xem được trang đều nhận **một** lỗi chung, không lộ trạng thái người dùng.
- **Được giao ≠ được duyệt.** Approve/reject và maker-checker **không đổi** một dòng.
  - Người giao phải qua **đúng** sàn vai trò, 2FA, giấy phép và bit quyền của đường duyệt/sửa thật (R-3-e): `ACTUATION_ROLES` + 2FA cho recipe/interlock/changeover/orchestration, `ECN_DECISION_ROLES` cho ECN. Operator/viewer/user dù có đủ bit quyền vẫn bị từ chối, với 0 audit, 0 thông báo, 0 dòng.
  - Test trên `_test`:
    - người được giao không có quyền duyệt bấm duyệt ⇒ bị từ chối ở cả năm đường;
    - tác giả tự giao cho mình ⇒ vẫn bị maker-checker chặn.
- **Phân công chỉ sống trong một đợt chờ duyệt (R-3-f).** Mục rời trạng thái chờ (duyệt/từ chối/đóng) thì phân công "chết" lười theo trạng thái và đợt; lượt giao kế tiếp tắt nó (audit `expire`).
  - Ví dụ: mục sửa lại rồi chờ duyệt lần nữa ⇒ người được giao cũ **không** thấy nó.
- **Hub** có 3 phạm vi:
  - **Của tôi**;
  - **Chờ duyệt (tôi có quyền)**, mặc định và giữ nghĩa URL cũ;
  - **Toàn module**.

  4 nhóm nghiêm trọng luôn ghim với số toàn module ở mọi phạm vi (R-2-y). Luật "tên chỉ khi có quyền xem" giữ nguyên. Nhóm đọc lỗi hiện "—", không bao giờ hiện 0.
- **UI giao việc** "Giao cho" có ở 5 chỗ: ECN DetailSheet, tab Duyệt của Recipes, sheet quy tắc Interlock, hàng đợi changeover, khối duyệt của run Orchestration. Cột "Người được giao" có trong các danh sách tương ứng.
- **Chuông thông báo của app không đọc bảng `notifications`.** Dòng thông báo được ghi (có test) nhưng chưa có chuông nào hiện nó; theo plan, không tự làm chuông mới.

### 12.3 Lỗi sửa ở Task 0 (kiểm trình duyệt thật 2026-10-05)

- **Tên biến môi trường lộ ra UI khi Copilot tắt:** nay là mã `DISABLED` với câu vi/en/zh. Census mới quét đường Copilot.
- **Copilot qua ngưỡng 1024 px:**
  - thu hẹp ⇒ panel vẫn hiện;
  - rời tab Copilot ở chế độ hẹp ⇒ đóng như chọn tab inspector khác.
  - Dải tab hẹp xuống hàng.
- **Header trang dưới 640 px** xuống hàng: Recipes ở 375 px còn 0 nút bị cắt (trước: "Lưu phiên bản mới" tràn 434 > 375).
- **React Flow chế độ tối** trên 5 canvas (IR, POU, Orchestration, BOM, Causal): điều khiển và minimap theo token app, không còn khối trắng. Có census.
- **Breadcrumb trang hiện tại** không còn bị cắt ở 1366: Hub 98/123 → 123/123 px, Fleet 77/98 → 98/98. Tab Copilot ở inspector IR/POU luôn vừa (trước tràn 46 px).
- **Tiêu điểm sau Huỷ/Esc OTP** quay về nút deploy.
- **Cảnh báo "phải bật 2FA"** chỉ hiện khi `deployPreview` nói cổng 2FA thật sự chặn. Chỉ đổi câu báo, không đổi cổng.

### 12.4 Kết quả đo nghiệm thu

**Thước đo và lần chạy:**
- Thước đã commit: `scripts/ui-metrics/engineeringLayout.mjs`, HEAD `97a11dce7`, `gitDirty` rỗng.
- Phạm vi: 14 màn Kỹ thuật, tab cảnh báo Standards và **2 màn mới** (Thu ảnh, Ca), mỗi màn × 1600×950 / 1366×768, cộng 3 biến thể mở Copilot (IDE/IR/POU) = **40 bản ghi**. Fleet đo ở URL Labs.
- **Lần 1** (đối chứng dương) và **lần 2** (`--mutation`) đều `pass=true`. Cả hai:
  - 0 lỗi;
  - tự kiểm **37/37** ca;
  - 0 kết nối ngoài danh sách;
  - 0 trôi dữ liệu trên 59 bảng;
  - cổng 3016/5176 trống sau khi tắt;
  - user đo đã xoá.

  Lần 2 thêm: gỡ từng gác ⇒ gỡ từng gác **32/32 gác đỏ** (đo lại 0 lần).
- Hiệu chuẩn `recorded-match` **40/40**. Biến thể Copilot hiện thật 6/6 (open) và ẩn 6/6 (closed). `coverMain` 0 và `aiInsideMain` 0 ở mọi bản ghi. Cuộn ngang cấp trang 0 px ở 40/40.
- Cảnh báo duy nhất: "Thêm quy tắc" của Interlock khoá với role đo (engineer), đúng quyền như ở Đợt 2.
- **MSA** lần 1 ↔ lần 2: **840 phép so, 0 lệch**, mọi cổng MSA đạt (kể cả dữ liệu giống nhau giữa hai lần).
- Kết quả lưu ở `do-bo-cuc/after-dot3.json` (= lần 2).

**So với `after.json` (cuối Đợt 2):**
- 756 phép so chung, **32 khác 0**. Mọi dòng khác đều do một task Đợt 3; không có dòng lệch không giải thích được.
- **0 dòng lệch** ở IDE (kể cả mở Copilot), IR, POU, ECN, Interlock, Orchestration, Fleet và bí danh Copilot.
- `sameDataAcrossRuns` sai chỉ vì dữ liệu `_test` dùng chung đã đổi sau 2026-10-04:
  - dòng test của phiên khác (factories, machines, users…, `program_deployments` 3323→3329 như Task 0 đã ghi);
  - hai bảng mới được băm (`engineering_assignments`, `shift_configs`).

**Bảng TRƯỚC → SAU** cho các màn có đổi (1600 / 1366):

| Màn | MAIN % | Vùng làm việc % | Khối trên vùng làm việc px | Cao trang × | Nguyên nhân |
|---|---|---|---|---|---|
| Hub | 49,8/41,9 → 49,3/41,4 | 46,4/38,2 → 45,9/37,7 | = | 1,00 | R-3-c: hộp rỗng 8 px của tab ẩn biến mất (MAIN 808→800 / 626→618 px) |
| Studio ⚠ bí danh (Hub `?tab=catalog`) | 49,6/41,8 → 49,1/41,2 | 46,4/38,3 = | 52 → 44 | 1,00 | R-3-c (hộp rỗng của tab ẩn nằm trên vùng làm việc) |
| Safety | 49,4/43,9 → 48,9/43,3 | 46,4/40,4 → 45,9/39,8 | = | 1,00 | R-3-c; tab Nhân lực đã dời đi (Task 3) không đổi hình học |
| Standards | 69,3/63,9 → 66,6/60,7 | 64,5/58,2 → 61,8/55,0 | = | 1,01/1,02 → **1,00** | R-3-c (4 tab ẩn × 8 px, MAIN 818→786 / 636→604) |
| Standards — tab cảnh báo | 60,8/65,1 → 58,0/65,1 | 56,3/59,8 → 54,2/60,6 | 53 → 45 | 1,00/1,12 → 1,00/**1,08** | R-3-c |
| Recipes | 39,5/35,6 = | 36,4/32,0 → 35,6/31,0 | 60 → 76 | 1,00 | Task 1: tiêu đề h2 20 px thành hàng tab 36 px (Lịch sử triển khai / Lịch sử nạp) |
| Integration | 68,0/62,3 → 66,6/60,7 | 64,1/57,8 → 62,8/56,2 | = | 1,00 | Task 1: bỏ hai tab, mất 2 × `mt-2` rỗng ở đáy (MAIN 802→786 / 620→604) |
| Fleet (nay `/labs/fleet-orchestration`) | 42,8/36,5 = | 40,4/33,8 = | = | 1,00 | Task 5: cùng trang, chỉ đổi URL và breadcrumb ⇒ 0 dòng lệch |
| **Thu ảnh** (mới; trước = tab Integration) | 16,6/19,7 → 16,3/19,3 | 12,9/15,3 = | 44 → 40 | 1,00 | Task 2: hàng công cụ 32 px thay hàng tab 36 px; 2 chip của trang thay 3 chip của Integration |
| **Ca** (mới; trước = tab Safety) | 51,1/45,8 → 48,8/43,1 | 48,1/42,4 → 45,8/39,7 | — | 1,14/1,26 → **1,00** | Task 3: trang vừa khung, bảng tự cuộn bên trong |

**Đọc bảng:**
- Hai màn mới có TRƯỚC/SAU **không cùng loại** (README thước, "Màn dời ra trang riêng"). Trước là MAIN của trang mẹ (hàng tab + bảng); sau là MAIN của trang mới.
  - Ca "giảm" % vì tab cũ tràn khung (trang cuộn 1,14/1,26×). Nay MAIN bằng đúng MAIN của Safety (936×792 so với 936×794 px).
  - Thu ảnh MAIN nhỏ (16–19 %) vì `_test` không có worker nào; bảng trống. Không có ngưỡng % riêng.
- Các dòng R-3-c **không mất nội dung**: đỉnh vùng làm việc và nội dung giữ nguyên, chỉ mất khoảng trống rỗng dưới đáy.

**Mục tiêu §1.1 trên 2 màn mới:**
- đỉnh h1 79 px (≤100);
- 1 breadcrumb;
- 0 banner trước MAIN;
- chip 32 px;
- hành động tạo mở **sheet** (Khởi động worker, Phân công);
- che 0 px²;
- cao trang 1,00×;
- không cuộn ngang ở 1366.

10/10 mục tiêu §1.1 của Đợt 2 vẫn đạt trên các màn cũ (số không đổi, trừ các dòng trong bảng trên).

### 12.5 Test

- **Bộ module + census: 146 tệp, 2 524/2 537 xanh.**
  - Bộ gồm 123 tệp của Task 16 Đợt 2, mọi tệp test Đợt 3 tạo hoặc chạm (trừ test DB), toàn bộ test trang Kỹ thuật/Vision/Ca, `components/{engineering,orchestration,changeover}` và các census client/server.
  - **13 đỏ trong 6 tệp census, tất cả của bên khác.** Không tệp nào Đợt 3 chạm:
    - `appErrorParamsCoverage`: `twinCanhRouter.ts` (9 khoá).
    - `appErrorCoverage`: `cuaIngestScan.ts` ×2, `aoiPackageRouter.ts`.
    - `dataErrorStringCensus` F14: `machineDataContract.ts:187`.
    - `clientErrorCoverage`: `AOIPackages.tsx`.
    - `rawErrorMessageCensus`: twin3d ×3 (`occtWorker`, `NhapBanVe`, `XuongThietKe`) và `AOIPackages`.
    - `viStringCoverage` hình-3: `TwinVanHanh` và `components/twin3d`; 34 chỗ, 4 lần chạm trần.
- **Server giao việc (Task 4) trên `_test`:** `engineeringAssignment.db`, `assignmentService`, `oversightRouter` và `applyMigrationTargetFlag` đạt **90/90**.
- Census Đợt 3 xanh:
  - `navLabs` (danh sách cho phép Labs);
  - `navLicenseFieldsCensus` (`licenseModule` / `onlyWhenModuleMissing` / `ignoreGroupCategory`);
  - `copilotKhongTenBienMoiTruong`;
  - `useResolvedTheme` (`colorMode` trên mọi `<ReactFlow>`);
  - `phamViDocCensus` (ghim lại có ghi chú ngày 2026-10-05);
  - `congGiayPhepAiCensus`;
  - `engineeringNavRouteGuardParity`;
  - `navRouteGuardRoles` (R-2-w).
- Không build, không chạm `dist/`. Phép đo và test của task này không kết nối DB dev.

### Cần chủ dự án quyết

**Thay đổi hành vi có chủ ý trong Đợt 3 (đã review):**
- Phiên bản recipe/lịch sử nạp dời sang **Recipes**; người không mở được Recipes (thiếu quyền **hoặc** thiếu giấy phép MOD_ENGINEERING) giữ **đầy đủ** chức năng cũ trên Integration (R-3-h); Operator/Viewer giữ bản chỉ xem (R-3-b). Lưu trữ ở Recipes nay cần quyền sửa + xác nhận.
- **Vision › Thu ảnh** (`/vision/acquisition`) giữ đúng cổng cũ (QĐ-3c); khách chỉ có giấy phép OT có lối vào trong menu Kỹ thuật + liên kết trên Integration.
- **Sản xuất › Ca** (`/production/shifts`) cho đúng các vai trước đây thấy tab nhân lực ở Safety; ô "Sản xuất" trong bộ mở ứng dụng nay mở được cho kỹ sư/bảo trì/người xem (chỉ chứa trang Ca). Phối hợp người–robot vẫn ở Safety.
- **Hộp việc "Của tôi"** theo người được giao (migration 0363 — **đã áp dev 2026-10-05**): người giao phải có cùng vai + quyền (+2FA khi bắt buộc) như người duyệt; **được giao ≠ được duyệt**; phân công tự hết hiệu lực khi mục rời trạng thái chờ (kể cả run điều phối bị giữ lại cùng bước).
- **Fleet → Labs** (`/labs/fleet-orchestration`, nhóm Labs ẩn mặc định, mỗi người tự bật — lưu theo trình duyệt); cảnh báo bế tắc trên Hub luôn hiện và mở được Fleet.
- Mọi script áp migration 0357–0363 nay **bắt buộc** chỉ rõ đích (`--dev-only` / `--test-only` / `--both`).

**Đã chốt (2026-10-06):** giữ ô "Sản xuất" mở được cho kỹ sư/bảo trì/người xem; **thêm chọn ca khi phân công + lọc ca phía server**; danh mục công cụ Hub ẩn Fleet khi Labs tắt (ghim cá nhân giữ nguyên); **sửa chip đầu trang 640–1023 px** (gộp vào "+N", chip nghiêm trọng vẫn ghim); **nối chuông thông báo với bảng notifications**; duyệt ECN **giữ không 2FA** (theo nguyên tắc 2FA bật thủ công) — sửa ghi chú sai trong mã; **thống nhất lưu trữ recipe cần xác nhận** ở cả Recipes và Integration; xoá 10 ECN rác của test cũ trong `_test` (đã xoá). Gộp Đợt 3 vào main + push; 6 việc trên làm ở **Đợt 3b**.

**Còn mở:** danh sách người được giao giới hạn 300; tuỳ chọn "Hiện Labs" theo trình duyệt (chưa có kho tuỳ chọn người dùng phía server); canvas Causal chưa kiểm trên trình duyệt (người dùng thử không có quyền).

### Đợt 3b (2026-10-06 → 10-09)

Plan `docs/superpowers/plans/2026-10-06-engineering-control-dot3b.md` — 6 việc chủ dự án chốt 2026-10-06, không migration.
- **Sản xuất › Ca:** phân công có thể gắn ca (tuỳ chọn; chỉ ca trong phạm vi người dùng và nhà máy của line đã chọn, ghi tên nhà máy); lọc ca chạy phía server trên toàn bộ dữ liệu.
- **Hub:** danh mục công cụ ẩn Fleet khi Labs tắt (ghim cá nhân giữ nguyên, cảnh báo bế tắc vẫn luôn hiện).
- **Đầu trang hẹp (640–1280 px):** hết chip bị cắt; chip thường gộp vào "+N" (mang màu nghiêm trọng nhất của chip bị ẩn), **thông tin an toàn luôn hiện** (tư thế Interlock, thông báo HITL của Recipes, cờ triển khai IDE/IR, giấy phép); từ 1024 px trở lên đầu trang ≤48 px, dưới đó 3 màn xuống dòng (IDE, Copilot scratch, Recipes ở 640 px).
- **Lưu trữ recipe** cần xác nhận ở cả Recipes và Integration; ghi chú 2FA của duyệt ECN sửa cho đúng (không 2FA, không đổi hành vi).
- **Chuông thông báo** đọc bảng `notifications` (chỉ của người đang đăng nhập, chỉ mở liên kết nội bộ, đánh dấu đã đọc/tất cả, theo ngôn ngữ app); sửa lỗi đếm chưa đọc trả về chuỗi.
- **Bảo mật** (phát hiện của review tự động + review toàn nhánh): danh sách phân công nay theo phạm vi nhà máy; giao lại/xác nhận/đóng phân công nhà máy khác trả như "không tìm thấy"; giao việc từ chối operator/line/trạm/nhà máy ngoài phạm vi (lỗ **có từ trước**); người phụ trách nhiều nhà máy phải chọn nhà máy; **sửa lỗ chuyển hướng ra ngoài có từ trước** ở trang đăng nhập (`?next=`) và đăng nhập SAML (`redirect`/`RelayState`).
- **Thước đo bố cục** tự gieo dữ liệu mẫu có đánh dấu trong `_test` và tự dọn (không còn phụ thuộc dữ liệu rác); theo dõi thêm bảng thông báo.
- Kiểm: quét test chạm 1178/1179 (1 quá hạn khi chạy song song, chạy riêng 42/42); `tsc` sạch; mọi đột biến đỏ.

**Đã chốt (2026-10-09):** phân công không gắn nhà máy — đếm trên dev: 2 hàng, 0 thiếu nhà máy, 0 lệch ⇒ không cần sửa dữ liệu; chip "Phù hợp tiêu chuẩn" không ghim; sửa chuyển hướng SAML trước khi gộp; gộp + push.

**Còn mở:** tuỳ chọn tắt báo 1 giờ không còn xoá số trên chuông cho phần thông báo phía server; ca "đang chạy" lấy theo giờ trình duyệt, không theo múi giờ nhà máy; luồng ACS của SAML mới kiểm bằng đọc mã, chưa gọi HTTP thật.

### Đợt 3c (2026-10-09)

Plan `docs/superpowers/plans/2026-10-09-engineering-control-dot3c.md` — đóng 3 mục "Còn mở" của Đợt 3b, không migration.
- **Chuông — tắt báo 1 giờ:** khi đang tắt, số trên chuông CHỈ gồm mục khẩn (thông báo server URGENT chưa đọc + cảnh báo hệ sinh thái critical); cảnh báo socket, cảnh báo dưới critical và thông báo server thường không đếm, không toast (critical vẫn toast). Hết hạn ⇒ số trở lại, không cần thao tác. Có dòng giải thích khi đang tắt. **Thay đổi hành vi:** tắt báo không còn giấu mục khỏi DANH SÁCH (trước: giấu cả mục critical).
- **Sản xuất › Ca — ca đang chạy:** ca mặc định chọn theo **múi giờ nhà máy** (ca qua đêm đúng); không xác định được múi giờ ⇒ dùng giờ trình duyệt và form ghi rõ điều đó. Phần tính giờ dùng chung client/server ở `shared/factoryTime.ts` (một bản cài đặt).
- **SAML ACS:** test HTTP thật `server/_core/samlAcsRelay.db.test.ts` — 5 giá trị RelayState xấu + thiếu ⇒ về "/", đường nội bộ đi đúng; kiểm chữ ký chỉ tắt trong tiến trình test (thư viện XML-DSig chưa cài), một ca riêng chứng minh khi bật thì bị từ chối.
- Kiểm: review spec ✅/chất lượng ✅, 5 điểm nhỏ đã sửa (vòng sửa 1); test chạm 268/268; `tsc` sạch; mọi đột biến đỏ.

**Còn mở:** `/api/saml/acs` chưa nằm trong danh sách miễn kiểm origin (`originCheck.ts`) — có từ trước, chỉ ảnh hưởng nếu bật chế độ `enforce`; quản trị viên chưa chọn line ⇒ ca toàn hệ thống dùng giờ trình duyệt (form có ghi chú); test `safetyAssignmentShift.dot3b.db.test.ts` để lại hàng `d3b1-*` trong `audit_logs` của `_test` mỗi lần chạy.

## 13. Kết quả Đợt 4 (2026-10-09 → 10-10)

Plan `docs/superpowers/plans/2026-10-09-engineering-control-dot4.md` — đóng các mục "Còn mở" §8–§12 mà chủ dự án chọn (nhóm A+B+C+D). Migration **0364** (`robot_motion_locks`) và **0365** (`user_settings.uiPrefs`) — đã áp `_test`; **dev chưa áp** (chủ dự án quyết).

### Quyết định của chủ dự án
- **QĐ-4a:** bước OT/robot của điều phối chỉ chạy khi có cổng `hitl_gate` do **người khác** (không phải chủ run) duyệt; không có cổng ⇒ dừng với thông báo rõ.
- **QĐ-4b:** ân hạn **1 giây** trước khi đặt lại phiên driver khi lệnh ghi quá hạn.
- **QĐ-4c:** khoá chuyển động robot lưu DB; khởi động lại vẫn khoá.
- **M7 (2026-10-10):** PLC an toàn gắn **robot** bảo vệ **cả trạm** của robot đó (nghiêng về an toàn); robot chỉ gắn line ⇒ coi như có thể ở bất kỳ trạm nào của line.
- **B3 (2026-10-10):** sau lệnh DỪNG chỉ **cảnh báo**, không tự ghi lại.
- Gộp main + push **cuối Đợt 4** (Đợt 3c gộp cùng).

### Nhóm A — bảo mật và phạm vi
- **Safety-PLC theo đích:** kiểm trước lệnh chỉ đọc cấu hình của đích **thực sự được ghi** (adapter → máy → trạm → line → nhà máy, hợp với máy/robot người gọi) + cấu hình không gắn đích; không phân giải được ⇒ mọi cấu hình. Bảng nguồn an toàn dùng **cùng một** bộ so khớp; đích truyền vào bảng được kiểm **phạm vi** từng id (ngoài phạm vi ≡ không tồn tại).
- **Sổ kiểm toán** (`activityFeed`, `masterDataList`) theo phạm vi; `activityFeed` trước đây **lỗi mọi lần gọi** (đọc cột TEXT như JSON) — đã sửa.
- **Twin:** 4 thủ tục đọc nhà máy kiểm phạm vi; ngoài phạm vi trả như không tìm thấy.
- **Ngừng máy ⇒ ngắt phiên MQTT đang sống** (sau khi commit).
- **Điều phối không tự duyệt (QĐ-4a):** duyệt gắn với **mã băm định nghĩa** (deploy lại ⇒ duyệt cũ mất hiệu lực; màn Studio ghim mã băm lúc mở); run tạo qua API = chủ là người tạo khoá API (không xác định ⇒ từ chối bước OT/robot); "Tiếp tục" không phải duyệt; cổng từ edge sync không được tính; bộ điều phối lệnh tự đọc lại cổng từ DB. Deploy từ chối: bước DỪNG OT không xác định được adapter duy nhất, bước robot thiếu robot (Studio có ô chọn robot).
- Quét bảo mật tự động bắt 2 lỗ trong quá trình làm (vượt cổng duyệt; bảng nguồn an toàn lộ trạng thái nhà máy khác) — đều đã đóng và có test.

### Nhóm B — robot và OT
- VDA5050 gửi mỗi order **một lần**; log DỪNG ở dry-run có hạn 1 s.
- **DỪNG sau lệnh ghi quá hạn (QĐ-4b, chỉ khi `OT_CMD_SERIALIZE_ENABLED` bật):** giữ chỗ hàng đợi tới khi lệnh cũ xong hoặc hết ân hạn 1 s ⇒ đặt lại phiên trong ngân sách; lệnh quá hạn ghi "kết cục không rõ — có thể đã áp". Sau DỪNG: **chỉ đọc** giá trị trong cửa sổ rủi ro 10 s; lệch/không đọc được/kết nối đổi ⇒ **một** cảnh báo critical (hiện cả khi tắt báo) + audit; **không bao giờ tự ghi**. Trễ DỪNG tối đa ≈ 11,25 s cho mỗi lệnh quá hạn đứng trước.
- **Khoá chuyển động lưu DB (mig 0364):** khởi động lại vẫn khoá; DB lỗi lúc nạp ⇒ khởi động **khoá** (`persistUnknown`); xoá khoá chỉ xoá bản ghi nó thay thế (không xoá nhầm khoá mới hơn).
- Ngày nhà máy: chuỗi không có múi giờ đọc theo giờ nhà máy; chuỗi có múi giờ (Z, ±hh:mm, EST, UTC+7…) đọc như cũ. Bảng lệch đồng hồ bỏ mẫu do server đóng dấu thời gian.

### Nhóm C — UX và dữ liệu
- Sửa tag sẽ gỡ stop pin ⇒ hỏi xác nhận (luật dùng chung client/server); cập nhật adapter báo số pin đã gỡ.
- CLI import `--apply` bắt buộc `--actor` (ghi vào audit).
- "Sổ ký" hiện chip "cần kiểm lại" khi stop pin đổi sau chữ ký.
- Lỗi lồng nhau báo đúng vị trí; kết quả fleet cũ không còn hiện khi đổi dự án (A → B → A bắt đầu lại).
- Tìm người được giao vượt giới hạn 300 (có cờ "thu hẹp tìm kiếm").
- Thông báo "bị DỪNG thay thế" ghi mã lệnh DỪNG.
- Canvas Causal kiểm trên trình duyệt (sáng/tối) — đúng.

### Nhóm D — tuỳ chọn giao diện theo tài khoản (mig 0365)
- "Hiện Labs" và kích thước panel lưu theo tài khoản (danh sách khoá cho phép, ≤16 KB, đầy thì bỏ khoá bố cục cũ nhất); localStorage vẫn là bản tức thì; máy mới đăng nhập lấy tuỳ chọn phía server; tab cũ của người khác không ghi đè. DB chưa áp 0365 ⇒ app dùng localStorage, không báo lỗi.

### Kiểm
- Mỗi nhóm: review nhiệm vụ → vòng sửa → review lại (A: 3 vòng, B: 2 vòng + B3 làm lại theo QĐ, C/D: 1 vòng); review toàn nhánh Đợt 3c + 4 → một vòng sửa cuối.
- RED → GREEN → đột biến cho mọi thay đổi hành vi; `tsc` sạch. Review toàn nhánh: 1114/1115 (1 test chập chờn — đã sửa: tập gộp 70 tệp 1140/1140 hai lần); vòng sửa cuối 131 tệp 1747/1747; sửa N1 cuối 30/30, quét rộng 230/234 (4 đỏ có từ trước của phiên khác: twin3d, twinCanh).
- Vòng sửa cuối thêm: bước DỪNG robot của điều phối không tra cứu gì trước khi gửi; DỪNG OT tra cứu song song có hạn 1 s; lệnh ghi thường chờ quá hạn kiểm an toàn thì kiểm lại ngay trước khi ghi (nhường DỪNG đang xếp hàng); deploy kiểm robot tồn tại; khi bắt đầu chạy kiểm lại định nghĩa **chỉ với bước không phải DỪNG** (bước DỪNG lỗi tự thất bại lúc chạy, các DỪNG khác vẫn đi — L-7).

### Cần chủ dự án quyết / biết
- **Áp 0364 lên dev TRƯỚC khi khởi động lại server bản gộp:** dev bật `ROBOT_GATEWAY_ENABLED`; thiếu bảng ⇒ mọi robot khởi động **khoá** (`persistUnknown`) mỗi lần restart và thao tác xoá khoá không được lưu. 0365 an toàn khi chưa áp; hai migration áp theo thứ tự nào cũng được.
- **`OT_CMD_SERIALIZE_ENABLED` đang tắt mặc định** ⇒ toàn bộ bảo vệ B3 không chạy; DỪNG vẫn có thể chồng lệnh ghi quá hạn.
- Workflow trên dev có bước robot thiếu robot / bước DỪNG không rõ adapter sẽ bị từ chối khi deploy hoặc khi bắt đầu chạy cho tới khi sửa.
- Run tạo qua khoá API mà người tạo khoá không còn hoạt động ⇒ bước OT/robot bị từ chối.

**Còn mở:** người cầm khoá API (không phải người tạo) vẫn tự duyệt được run của mình (cần danh tính theo từng người cầm khoá); mã băm duyệt không phủ binding adapter / tag map / chương trình robot; điều phối chưa có phạm vi tenant (robot của nhà máy khác không bị chặn ở deploy); VDA5050: lệnh chuyển động instantActions qua driver thật chưa từng chạy (có từ trước); ngắt kết nối muộn của phiên cũ có thể làm hỏng phiên mới mà DỪNG đang dùng (DỪNG thất bại hiển thị rõ); cảnh báo B3 chỉ trong bộ nhớ (restart mất), cửa sổ 10 s là ước lượng; danh sách người được giao chưa giới hạn theo nhà máy (có từ trước); thay đổi stop pin cùng lúc với chữ ký có thể không bật chip; canvas Causal chưa kiểm khi có licence thật; hộp thông báo critical B3 bị bỏ với người tắt thông báo trong app (luồng cảnh báo critical vẫn mang). Deploy không chặn bước DỪNG chưa ghim (ghim đổi được sau deploy — kiểm lúc chạy vẫn là chốt); lệnh kiểu DỪNG chưa ghim không được kiểm an toàn lại trước khi ghi (như trước); bản ghi uỷ quyền DỪNG robot ghi chủ run làm người xác nhận (chỉ là bản ghi); `ensureOrchestrationAction` vẫn chờ DB không giới hạn (có từ trước).

## 14. Kết quả Đợt 5 (2026-10-10 → 10-11)

Plan `docs/superpowers/plans/2026-10-10-engineering-control-dot5.md` — khảo sát lại 37 mục "Còn mở" §7–§13 bằng mã (`.superpowers/sdd/2026-10-10-engineering-control-dot5/survey-*.md`): **6 mục đã đóng từ trước** (1, 2, 3, 5, 7, 14), 31 mục làm trong Đợt 5. Không migration.

### Quyết định của chủ dự án (2026-10-10)
- 14 mục nhỏ theo khuyến nghị khảo sát; 13 (kênh thời gian deploy) và 16 (form ECN sau "Bỏ thay đổi?") **chấp nhận, đóng**; 18 (sheet IDE/IR/POU chưa đồng bộ URL) **hoãn** tới khi làm lại các màn đó.
- **24:** run tạo qua khoá API **không bao giờ** chạy bước OT/robot không phải DỪNG (DỪNG vẫn chạy).
- **26:** điều phối theo phạm vi nhà máy; khoá API không khai `dataScopeMode` bị từ chối; DỪNG ngoài phạm vi chặn ở deploy, cho chạy lúc start/run.
- **37:** Claude build + restart sau khi gộp Đợt 5.

### Nhóm E — bảo mật điều phối
- Run từ API không tác động (lý do `apiRun`, kiểm ở engine và cả hai bộ điều phối lệnh).
- **Phạm vi nhà máy ở MỌI lối vào** (deploy/rollback/xoá/start/duyệt/từ chối/huỷ/xem/lịch sử/replay/hub/giao việc/edge/API v1); ngoài phạm vi ≡ không tồn tại; census tự tìm mọi tệp chạm bảng điều phối.
- **Huỷ/từ chối khi KHÔNG quyết được phạm vi trong 1 s ⇒ TỪ CHỐI** ("chưa xác minh được phạm vi — thử lại; dùng DỪNG trực tiếp / E-STOP"). Lý do: huỷ run **huỷ cả các bước DỪNG còn lại** (không phải thao tác giảm năng lượng); không đường DỪNG thiết bị nào đi qua kiểm này.
- Duyệt cổng gắn **mã băm ràng buộc** (adapter, tag, robot) tính phía server; cấu hình đổi sau khi duyệt ⇒ duyệt mất hiệu lực.
- Một bộ phân loại DỪNG dùng chung: chỉ **DỪNG thật** (ghim DỪNG OT / job dừng robot) được miễn — không theo tên lệnh. DỪNG điều phối (kể cả lồng trong khối, bù trừ) có giới hạn chờ DB.

### Nhóm F — runtime OT/robot
- VDA5050 instantActions chuyển động chạy qua driver thật (qua đủ khoá chuyển động, robot tắt, HITL; gửi đúng một lần).
- Ngắt kết nối muộn không phá phiên mới — mọi driver (cả plugin), có hợp đồng kiểm theo census.
- Cửa sổ rủi ro sau DỪNG theo adapter + biến `OT_STALE_WRITE_RISK_TTL_MS` (10–60 s); DỪNG chưa ghim được kiểm an toàn lại (≤ ~5 s); DỪNG ghim không bao giờ chậm thêm.
- Mốc thời gian trạng thái VDA5050 tương lai/không múi giờ bị loại.
- **Thông báo an toàn vượt "tắt thông báo"** chỉ khi server tự ghi nhận sự kiện từ đường thiết bị (không trường nào do người dùng/API đặt được); lặp trong 60 s chỉ hạ xuống giao bình thường, **không bao giờ bỏ**.
- Chữ ký nghiệm thu và thay đổi stop pin được xếp thứ tự (khoá + ghi chữ ký đang hiệu lực) — cả đường CLI.

### Nhóm G — MQTT, ingest, tài liệu
- App tablet 1.0.17: ô "Mật khẩu MQTT của thiết bị" (Android Keystore AES-GCM), **chỉ gửi tới đúng broker đã lưu**, đọc không bao giờ xoá, hỏng hẳn ⇒ yêu cầu nhập lại.
- **Mặc định `MQTT_ALLOW_PASSWORDLESS_REGISTERED` = false.** Thứ tự triển khai: cập nhật app → cấp mật khẩu → lật cờ (DEPLOY_LAN_GUIDE).
- **Sửa lỗ có từ trước:** kiểm origin và giới hạn tần suất phân biệt hoa/thường và dạng địa chỉ (`/API/...`, `http://host/...`, `#`, `//a@b/...`) — nay dùng chung một hàm lấy đường như Express định tuyến; không nạp được ⇒ đóng.
- Tài liệu IoT/doc 61 đúng luật thật (allowlist gateway, `ts` có múi giờ, 403/429); test dấu vân kết nối qua loader thật; test tranh chấp ghim; SAML ACS miễn kiểm origin đúng đường; test Đợt 3b không còn để lại hàng audit.

### Nhóm H — UX và đo
- POU: gập panel đóng Copilot; Interlock màn hẹp không nhảy tab; bản đồ Fleet lấy nhà máy theo phạm vi; quản trị chưa chọn line dùng múi giờ chung nếu mọi nhà máy cùng múi.
- **Danh sách "Giao cho" và giao việc theo nhà máy** (một luật chung; với run: người được giao phải thấy mọi đích không phải DỪNG); mọi trường hợp ngoài phạm vi trả như không tồn tại.
- Cổng licence không còn chờ batch chậm (0,9 s thay vì ~75 s); canvas Causal kiểm có/không licence AI.
- Test trình duyệt câu từ chối DỪNG (vi/en) với hàng rào không chạm thiết bị thật; Fleet @1600 khớp bản ghi đo.

### Kiểm
- Mỗi nhóm: review → vòng sửa → review lại (E: 3 vòng, G: 3 vòng, F: 2, H: 1); review toàn nhánh → một vòng sửa cuối → review lại.
- Quét bảo mật tự động bắt thêm 7 lần trong đợt (rò mật khẩu tablet, lối vào chưa kiểm phạm vi ×2, nguồn sự kiện giả mạo, throttle nuốt cảnh báo, cho qua khi chưa quyết phạm vi, lộ thông tin giao việc) — đều đã đóng có test.
- `tsc` sạch. Review toàn nhánh: 822/825 (3 đỏ twin3d có từ trước); vòng sửa cuối 47 tệp 662/662, app tablet 37/37, kiểm Kotlin 53/53, 41 đột biến đều đỏ; review lại vòng cuối 184/184 — **sẵn sàng gộp**. Dữ liệu rác `_test` từ các lần chạy bị ngắt: 91 → 0 hàng.

### Cần chủ dự án quyết / làm trước khi khởi động lại
- **Tablet:** đếm thiết bị MQTT đăng ký không mật khẩu trên dev; nếu có (hoặc chưa rõ) đặt `MQTT_ALLOW_PASSWORDLESS_REGISTERED=true` trong `.env` trước restart; build APK 1.0.17 (chưa có).
- **Run đang dở:** kết thúc/huỷ run đã qua cổng duyệt (duyệt cũ không có mã băm ràng buộc ⇒ không còn tính) và mọi run tạo qua khoá API trước khi gộp (không có dấu vết để nhận diện).
- **Khoá API** dùng điều phối / edge sync: đặt `dataScopeMode` (factory/global) — không thì 403.
- **Người dùng không phải admin chưa gắn nhà máy:** không thấy điều phối, danh sách "Giao cho" chỉ có admin.
- **Dữ liệu vùng Fleet chưa gắn nhà máy (mục 19a):** chạy truy vấn chỉ-đọc `group-H-h3a-zones-no-factory.sql` trên dev rồi quyết gán.
- **Huỷ run có nên vẫn chạy các bước DỪNG còn lại?** (hiện huỷ cả chúng — có từ trước).
- **Bộ đọc nền safety-PLC:** E-stop từ safety-PLC thật chưa vượt "tắt thông báo" vì PLC chỉ được đọc khi người dùng thao tác.

**Còn mở:** chương trình nằm trong bộ điều khiển robot/PLC không được mã băm duyệt phủ; tự động hoá VDA5050/ROS2 tự cấp quyền (gắn đúng job, một lần, có hạn — cùng loại mục 24); app tablet chưa chạy trên thiết bị thật; kết nối tablet → broker nhúng không mã hoá; webhook `orchestration.run.finished` gửi mọi người đăng ký; quan sát/danh sách theo phiên bản workflow hiện tại; một số khác biệt thời gian phản hồi (missing nhanh hơn ngoài phạm vi); mỗi lần chạy test H6 để lại 1 hàng `command_log` không xoá được trong `_test`; bắt tay plugin chưa có số thế hệ; replay sự kiện tin cậy giữa nhiều instance (Redis). Nhỏ (review cuối): khi bộ phân loại DỪNG lỗi toàn phần, huỷ/từ chối run không thấy được trả "chưa xác minh" còn id không tồn tại trả "không tìm thấy"; tài khoản admin bị tắt làm người được giao đi nhánh nhanh (lộ qua thời gian); census `registerDriver` chưa bắt import đổi tên; sự kiện không có robot/line dùng chung một khoá giới hạn 10 s.

### Đợt 6 (2026-10-11) — huỷ run vẫn gửi bước DỪNG

Plan `docs/superpowers/plans/2026-10-11-engineering-control-dot6.md` — quyết định chủ dự án 2026-10-11 ("Huỷ vẫn chạy bước DỪNG").
- **Huỷ (abort) và từ chối cổng (reject)** bỏ mọi bước thường nhưng **vẫn gửi các bước DỪNG thật còn lại** và các bước bù trừ DỪNG đến hạn (thứ tự ngược), mỗi lần gửi có hạn thời gian + audit. Chỉ DỪNG thật (ghim DỪNG OT / job dừng robot) — bước "stop" chưa ghim không bao giờ được gửi; nhánh chưa đi không đoán (ghi audit).
- **Chỉ gửi khi run đã tác động** (đã thử ít nhất một lệnh không phải DỪNG, kể cả lỗi/quá hạn); không quyết được (restart, DB lỗi, run chạy ở edge/instance khác) ⇒ **vẫn gửi**. Run tạo qua khoá API không tác động nên không có DỪNG khi huỷ.
- Huỷ hai lần chỉ gửi một lần; ghi "đã huỷ" về muộn hoặc phản hồi mất ⇒ huỷ lại / nút **"Gửi lại các bước DỪNG"** gửi lại DỪNG chưa xác nhận (không gửi lại cái đã xác nhận), **chỉ trong 15 phút sau khi huỷ** (quá ⇒ "quá cũ — dùng DỪNG trực tiếp"), cùng kiểm quyền/phạm vi như huỷ, có audit.
- Studio: nút Huỷ/thông báo nói rõ DỪNG vẫn được gửi; đếm chỉ DỪNG đã xác nhận (vi/en/zh). Trường hợp xấu nhất mỗi lượt quét ≈ 8 s.
- Kiểm: review → 3 vòng sửa (quét bảo mật bắt 3 điểm: lệch trạng thái khi ghi muộn, run ở edge bị coi "chưa tác động", khoá gửi lại bị cắt) → review lại sẵn sàng gộp; engine 56/56, Studio 66 + 13; đột biến đều đỏ.

**Còn mở (Đợt 6):** huỷ từ trung tâm không dừng được walker của run đang chạy ở edge (chỉ gửi DỪNG); gửi lại có thể lặp một DỪNG mà phản hồi trước còn đang chờ (DỪNG lặp vô hại); từ chối cổng có hook QT mà phản hồi mất thì việc quét để lại cho lần huỷ sau.

### Đợt 7 — chính sách tự động hoá VDA5050 / ROS2 (quyết định chủ dự án 2026-10-11)

- **Giữ nguyên quyền tự cấp** của đường tự động (bộ điều hợp VDA5050, cầu ROS2): khi một lệnh CHUYỂN ĐỘNG tự động không có bản ghi xác nhận của người, hệ thống tự tạo một bản ghi `ai_pending_actions` (`vda5050.automation` / `ros2.automation`) **gắn đúng một lệnh** (mã băm `robotPayloadHash` của chính job sẽ gửi), **dùng một lần** (dispatcher tiêu thụ confirmed→executed dưới khoá dòng), **có hạn** (5 phút), **có kiểm toán** (hàng ghi công cụ + chủ sở hữu). Không có người thứ hai xác nhận — đây là chủ ý, đã được chấp nhận.
- **Công tắc "tắt tự động hoá" theo từng robot** (màn Điều khiển Robot; `robot.disableAutomation` / `robot.enableAutomation`, lý do bắt buộc, audit ghi TRƯỚC khi đổi): khi TẮT, quyền tự cấp bị **từ chối ở cả hai cửa** — lúc tạo (không tạo bản ghi ⇒ dispatcher từ chối `HITL_ACTION_REQUIRED`) và lúc tiêu thụ (quyền đã cấp ngay trước khi tắt ⇒ `NOT_CONFIRMED` `AUTOMATION_OFF`); mỗi lần từ chối ghi log + audit `robot.automationRefused`. Census `robotAutomationSwitchCensus.dot7` chứng minh không có cửa thứ ba.
- **Tắt** chỉ cần quyền `machine_control/canEdit` (chỉ giữ lại chuyển động, không bao giờ đứng sau sàn vai/2FA); **bật lại** cần thêm sàn vai actuation (admin/supervisor/engineer + 2FA).
- **Lệnh DỪNG không bị ảnh hưởng**: DỪNG không bao giờ tạo hay tiêu thụ quyền tự cấp. Lệnh người vận hành tự bấm (`manual`) và lệnh mang actionId do người xác nhận không phải tự động hoá.
- **Khi không quyết được** (không đọc được công tắc: mất CSDL, lỗi truy vấn, giá trị lạ) ⇒ coi như **TẮT** (từ chối quyền tự cấp; chỉ giữ lại chuyển động). Lưu ở `system_settings` khoá `robot.automation.off.<robotId>` (không cần migration).

### Đợt 7 — ghi chú nhóm I (điều phối)

- **Ref quy trình theo không gian phạm vi (quyết định chủ dự án 2026-10-11, mig 0367):** ref duy nhất theo cặp (ref, `scopeKey`). `scopeKey` = `global` (admin, khoá API `global`, trình nạp hệ thống / template QT) hoặc `f:<id nhà máy tăng dần>` của phạm vi người tạo. Ref trơn được phân giải TRONG tầm nhìn người gọi: không gian của chính họ › `global` › quy trình duy nhất họ xem được; nhiều quy trình cùng ref mà họ đều xem được ⇒ `refAmbiguous` (mở quy trình từ danh sách — Studio gửi kèm mã quy trình). Deploy lại là idempotent; nhà máy khác dùng cùng ref ⇒ deploy / nhân bản / chạy trả lời Y HỆT ref chưa có. **Dữ liệu cũ:** mọi quy trình trước 0367 ⇒ `global` (ref vốn đã duy nhất toàn cục; cách phân giải cho người đang xem được chúng không đổi). **Rollout:** áp `node scripts/apply-migration-0367.mjs --dev-only` TRƯỚC khi build + khởi động lại :3000 với mã mới (mã khai cột `scopeKey`).
- **Huỷ từ trung tâm dừng walker ở edge (I1) — còn TIỀM ẨN:** trung tâm (đồng bộ edge không bao giờ ghi đè run đã huỷ / đang bị từ chối / đã kết thúc; trả `abortRequested`) đã có hiệu lực qua `edgeRuntime.syncRunResult` và `POST /api/v1/edge/sync`. Nửa phía edge (`edgeRuntime.executeAssignedRun` + `setCentralSync`: đồng bộ tiến độ, huỷ run cục bộ, chờ lượt tiến độ đang bay trước kết quả cuối) **chưa có máy biên nào nối** — không có lối gọi sản xuất nào trong repo. Khi một máy biên được nối, trung tâm không tới được ⇒ walker chạy tiếp tới lần đồng bộ đầu tiên tới được trung tâm (dùng DỪNG trực tiếp / E-STOP; lệnh huỷ ở trung tâm cũng gửi các bước DỪNG từ trung tâm).
- **Danh sách run có giới hạn cứng:** lọc phạm vi chạy trong SQL trước LIMIT; mỗi lượt phán xét tối đa 2 000 định nghĩa (hơn ⇒ danh sách báo "bị cắt"), trang tối đa 500, hub tối đa 2 000 run chờ.

## 15. Kết quả Đợt 7 (2026-10-11)

Plan `docs/superpowers/plans/2026-10-11-engineering-control-dot7.md` — các mục còn mở sau Đợt 6 không cần phần cứng. Migration **0366** (MAINTAIN cho `avi_app` trên 2 view cache — **đã áp dev**) và **0367** (tên workflow theo phạm vi — `_test`; **dev phải áp trước khi khởi động lại**).

### Quyết định của chủ dự án (2026-10-11)
- Mã hoá tablet ↔ broker nhúng làm ngay; **khoá TLS do quản trị cấp** bằng script (server chỉ đọc + kiểm, không tự sinh) — sau 4 vòng quét bảo mật trên bản tự sinh trong `data/`.
- Claude build APK 1.0.18; chủ dự án thử máy thật.
- Khoá máy mới không còn `edge:sync` mặc định; **đã thu hồi 1.669 khoá máy test/QA trên dev** (không xoá; giữ 38 khoá SIM-L*/ESP32).
- Tự động hoá VDA5050/ROS2 tự cấp quyền **giữ nguyên** (gắn một job, dùng một lần, có hạn, có audit) + công tắc tắt tự động hoá theo từng robot.
- Tên workflow **duy nhất theo cặp (tên, phạm vi nhà máy)**; tên thường hiểu trong phạm vi người gọi (deploy lại cập nhật đúng workflow; tích hợp không đổi).

### Chính sách tự động hoá robot
Luồng tự động VDA5050/ROS2 được tự cấp quyền chuyển động cho **đúng một job**, **một lần**, **có hạn thời gian**, **có audit**; không cần người thứ hai. Công tắc theo robot (chỉ trong phạm vi nhà máy của người thao tác, có audit) tắt luồng này; DỪNG không bao giờ bị ảnh hưởng.

### Nhóm I — điều phối
- Huỷ/từ chối ở trung tâm truyền tới walker trên edge (edge vẫn gửi DỪNG); đồng bộ edge không bao giờ đưa run đã kết thúc về "đang chạy" (phần edge chưa có lối gọi production — tiềm ẩn).
- Màn duyệt gắn mã băm ràng buộc (cả "Tiếp tục" run đang giữ, kiểm phía server).
- Webhook `orchestration.run.finished` chỉ tới người đăng ký có phạm vi chứa nhà máy của run; run hiển thị theo phiên bản đã chạy; danh sách run lọc phạm vi trong SQL có trần (báo "một số run không được liệt kê").
- Tên workflow theo phạm vi (mig 0367) — mọi đường tra theo tên dùng không gian tên của người gọi; không quyết được ⇒ từ chối.

### Nhóm J — mã hoá tablet
- Broker nhúng có cổng **MQTTS 8884**; khoá + chứng chỉ do **script quản trị** (`scripts/provision-mqtt-tls.ps1`) tạo trong thư mục bảo vệ (`C:\ProgramData\avi-aoi\mqtt-tls`, chỉ SYSTEM/Administrators/tài khoản server); server chỉ đọc qua một handle và kiểm chủ sở hữu, danh sách quyền (theo SID), không link — nghi ngờ ⇒ không mở TLS (cổng thường và :3000 không ảnh hưởng). Thẻ quản trị hiện vân tay/trạng thái.
- **App tablet 1.0.18**: MQTT qua TLS ghim vân tay chứng chỉ; mật khẩu không bao giờ đi qua kết nối thường khi đã có vân tay; lệch ⇒ "chứng chỉ đã đổi". APK release ký bằng keystore của repo (arm64-v8a, armeabi-v7a) — **chưa chạy trên thiết bị thật**.
- **Mật khẩu keystore release từng nằm trong tài liệu từ `ab65cb8ef`** — đã gỡ khỏi tài liệu, vẫn còn trong lịch sử git ⇒ coi là lộ.

### Nhóm K — khoá và nền tảng
- Khoá máy mới không có `edge:sync` mặc định; script thu hồi gắn đúng tệp danh sách (sha256), một giao dịch, không xoá, có audit.
- **refresh_qw_caches lỗi mỗi 5 phút** do `avi_app` thiếu quyền MAINTAIN trên view của `aoi` (PG17) — mig 0366 đã áp dev, refresh chạy được.
- Bắt tay plugin có số thế hệ; census `machineDataContract` hết đỏ.

### Nhóm L — kiểm trình duyệt (`_test`, cổng riêng)
- Đạt: OTP đè wizard deploy; F5/Back/Forward trên ECN/Interlock/Orchestration; Copilot qua 6 lần đổi cỡ qua 1024 px (máy chủ AI giả lập); 15 màn ở 390/412 px.
- Sửa: tiêu điểm sau đóng wizard; tab Tiêu chuẩn thiết bị và Hub trên điện thoại; Back sau F5 với flyout; chỉ báo "Copilot đang chạy"; thanh trạng thái trên điện thoại; nhãn tab Interlock.
- **Deploy khi step-up/2FA tắt (hoặc bỏ qua ở chế độ nội bộ) không còn hiện ô OTP** mà server bỏ qua — bước xác nhận nói rõ; khi bật thì như cũ; không xác định được ⇒ vẫn hỏi OTP.

### Kiểm
- Mỗi nhóm review → vòng sửa → review lại (J: 3 vòng + thiết kế lại bởi agent mới); review toàn nhánh → một vòng sửa cuối. Quét bảo mật bắt thêm 8 lần (cổng ACL Windows ×4, cạn tài nguyên danh sách run, gate mô phỏng QT theo tên, …) — đã xử lý.
- `tsc` sạch. Review toàn nhánh: 665/665 tệp test đổi, app 43/43, không đỏ mới. Vòng sửa cuối (gate mô phỏng QT gắn đúng workflow của run, edge chạy theo workflowId, mọi lối vào không quyết được phạm vi ⇒ `scopeUnverified`, kiểm mig 0367 lúc khởi động — huỷ/từ chối vẫn gửi DỪNG khi thiếu 0367, script cấp khoá `-Repair`/`-Rotate` an toàn): 2.924 test pass (13 đỏ có từ trước, không thuộc tệp đổi), 79/80 đột biến đỏ, app 88/88; review lại vòng cuối 152/152 — **sẵn sàng gộp**.
- Hướng dẫn cấp khoá: chạy script từ thư mục riêng trong hồ sơ quản trị viên (không dùng thư mục mới dưới ProgramData — người dùng cục bộ tạo trước và tráo script được).

### Trước khi khởi động lại
1. `node scripts/apply-migration-0367.mjs --dev-only` (trước build/restart).
2. Cấp khoá TLS bằng quyền Administrator với `-ServerAccount` (thư mục chưa có trên máy này) — tới lúc đó :3000 báo "TLS chưa cấp", cổng thường vẫn chạy.
3. Mở tường lửa TCP 8884; giữ cổng thường tới khi tablet chuyển xong.
4. Sao lưu chứng chỉ + khoá ngoại tuyến (và trước mỗi `-Rotate`).
5. Báo người vận hành: xác nhận deploy không có ô OTP khi step-up tắt.
6. Báo tích hợp: tên workflow theo phạm vi (có thể trả `refAmbiguous`), webhook chỉ tới người thấy được run, khoá máy mới không có `edge:sync`.

**Còn mở:** bộ đọc nền safety-PLC; checksum chương trình trong bộ điều khiển; danh tính người cầm khoá API; replay sự kiện tin cậy nhiều instance; sheet IDE/IR/POU đồng bộ URL; đổi mật khẩu keystore release (lộ qua lịch sử git); app 1.0.18 chưa thử thiết bị thật; phần edge của huỷ-tới-edge chưa có lối gọi production. Nhỏ: `-Repair` đặt ACL thư mục theo đường dẫn (khe tráo junction khi thư mục đang mở); QT bù trừ bị bỏ qua nếu tra mẫu toàn cục lỗi (chưa có lối production); người xem thấy được tín hiệu tồn tại qua mô phỏng theo tên khi phạm vi không quyết được (đã chấp nhận ở R-7-d).

## 16. Kết quả Đợt 8 (2026-10-11)

Plan `docs/superpowers/plans/2026-10-11-engineering-control-dot8.md`. Migration **0368** (cấu hình safety-PLC: duyệt hai người + trạng thái đọc bền vững) — `_test`; áp dev trước khởi động lại.

### Quyết định của chủ dự án (2026-10-11)
- Làm bộ đọc nền safety-PLC ngay (backend mô phỏng, cờ tắt mặc định); **duyệt hai người** cho cấu hình đọc PLC thật; **giữ tắt, thử trên bench trước**.
- Giữ phương án C cho khoá API (run qua API không tác động).
- Sheet IDE/IR/POU lên FlyoutHost ngay.
- Khung checksum chương trình bộ điều khiển (OpenPLC/mô phỏng).

### Nhóm N — bộ đọc nền safety-PLC (`SAFETY_PLC_POLLER_ENABLED`, tắt)
- Chỉ đọc, không bao giờ ghi/tác động PLC; đọc không quyết được ⇒ "không rõ/mất kết nối", không bao giờ "đã nhả"/"ổn". Sửa kèm lỗi có từ trước: giá trị tag không đọc được từng bị coi là `false` (bộ đọc sẽ báo "đã nhả E-stop", kiểm trước lệnh coi PLC sạch) ⇒ nay là "không rõ".
- Chuyển trạng thái **ghi bền vững trước** khi tiến; mất sự kiện ⇒ có dấu "events lost"; sức khoẻ từ bản ghi DB (giống nhau mọi instance, đồng hồ DB); không có bản ghi ⇒ "stale"; mỗi đợt mất giám sát một cảnh báo, chỉ đánh dấu đã xử lý khi cảnh báo đã ghi bền; màn An toàn hiện từng PLC mất kết nối/không rõ/stale.
- **Duyệt hai người**: người duyệt khác MỌI người đã sửa trường quan trọng kể từ lần duyệt trước (tạo cũng là sửa); duyệt gắn dấu vân cấu hình hiện tại trong một giao dịch có khoá; cấu hình cũ bắt đầu chưa duyệt; đổi đích/sửa ⇒ mất tin cậy; mọi thao tác ghi audit; phạm vi nhà máy. Chỉ cấu hình đã duyệt + chưa đổi mới sinh sự kiện **vượt "tắt thông báo"**; trần theo người nhận chỉ hạ cấp, không bỏ; cảnh báo "DỪNG chưa xác nhận" (Đợt 3/4) **không bị trần**.
- Một instance đọc (khoá leader); kiểm thử Modbus và OPC-UA đầu-cuối trên máy chủ giả lập.

### Nhóm O — checksum chương trình bộ điều khiển
- Khả năng `readProgramChecksum` của adapter; duyệt gắn checksum của mọi adapter run ghi vào khi adapter hỗ trợ; đổi chương trình sau duyệt ⇒ duyệt mất hiệu lực (engine + hai bộ điều phối); không đọc được trên adapter hỗ trợ ⇒ từ chối; màn duyệt ghi rõ "đã kiểm (checksum …, mô phỏng)" hoặc "không kiểm được trên bộ điều khiển này".
- **OpenPLC không lộ checksum/chương trình** (v3 web, v4 REST) ⇒ "không kiểm được"; hiện chỉ driver mô phỏng hỗ trợ. Bước DỪNG không đọc bộ điều khiển (L-7); lệnh kiểu DỪNG chưa ghim có thể bị từ chối/chậm ≤ 1 s khi checksum không đọc được.

### Nhóm P — sheet IDE/IR/POU
- 5 sheet (IDE dự án mới / ký hiệu / gắn thiết bị, IR dự án mới, POU lưu) dùng FlyoutHost: URL, F5/Back/link sâu, hỏi "Bỏ thay đổi?", trả tiêu điểm; rộng 560 px như màn khác; bố cục đo 504 phép so — không lệch.

### Nhóm Q — còn lại
- Ba test đỏ trong module là test cũ (mã đúng) — sửa test, chặt hơn.
- Từ chối cổng khi không xác định được mẫu QT: vẫn huỷ + gửi DỪNG, ghi rõ "chưa bù trừ — làm tay".
- Huỷ-tới-edge vẫn tiềm ẩn: edge gateway production không chạy workflow, không có lối kéo run, không có khoá edge.
- Script cấp khoá TLS `-Repair` khoá thư mục qua handle không theo link, từ chối mục lạ.

### Kiểm
- Mỗi nhóm review → vòng sửa → review lại (N: 1 vòng + 6 lượt quét bảo mật, thiết kế lại theo hướng "ghi bền trước"); review toàn nhánh → vòng sửa cuối → review lại → vòng NF nhỏ. Vòng cuối: tệp chạm 1.123/1.123, đột biến 72/72 + 8/8; `tsc` sạch; không tệp tracked bị xoá.

### Trước khi bật bộ đọc safety-PLC (trên bench trước)
1. 0368 đã áp; restart lần đầu với cờ tắt.
2. Tắt cấu hình mô phỏng; kiểm số kết nối PLC cho phép (bộ đọc + kiểm trước lệnh mở kết nối riêng).
3. Bật `SAFETY_PLC_ADAPTER_ENABLED`, `SAFETY_AUDIT_ENABLED`, rồi `SAFETY_PLC_POLLER_ENABLED`; chưa duyệt cấu hình nào (cảnh báo đi đường thường); kiểm màn An toàn "● alive" và từng PLC.
4. Sau khi quan sát ổn: hai admin khác nhau duyệt từng cấu hình PLC thật để bật vượt "tắt thông báo".

**Còn mở:** danh tính người cầm khoá API (giữ C); replay sự kiện tin cậy nhiều instance; reader checksum cho bộ điều khiển thật (theo hãng); huỷ-tới-edge (cần lối kéo run + khoá edge nếu dùng edge chạy workflow); `-Repair` chạy quyền Administrator chưa thử lab; một nhấn-nhả E-stop ngắn hơn chu kỳ đọc không thấy; việc của chủ dự án: cấp khoá TLS, đổi mật khẩu keystore, thử APK 1.0.18.

## 17. Kết quả Đợt 9 (2026-10-12)

Plan `docs/superpowers/plans/2026-10-12-engineering-control-dot9.md` — chủ dự án: "hoàn tất các phần đang mở". Migration **0369** (danh tính người cầm khoá API), **0370** (edge chạy workflow), **0371** (tin cậy tiêu thụ một lần + chốt/heartbeat) — `_test`; áp dev theo thứ tự trước khởi động lại.

### Quyết định của chủ dự án (2026-10-12)
- Làm phương án A cho khoá API (thay C); edge chạy workflow đầy đủ; checksum S7 theo tài liệu; E-stop ngắn qua OPC-UA subscription + bit chốt Modbus; chặn replay đa instance.

### Nhóm R — danh tính người cầm khoá API
- Khoá ghi "cấp cho ai" (chỉ admin đổi, audit trong cùng giao dịch, khoá dòng chống đua); run ghi khoá khởi động (chỉ trong INSERT, không đổi được). Duyệt run tạo qua API chỉ tính khi người duyệt ≠ người khởi động, người cầm khoá (cả trước đây), người tạo — một nguồn `deriveRunApprovalIdentity` cho engine, hai bộ điều phối, edge, QT. Khoá **đang tắt hoặc hết hạn ⇒ không tác động**; bật lại/gia hạn chỉ admin. DỪNG luôn được.

### Nhóm S — edge chạy workflow (cờ `EDGE_EXECUTION_ENABLED` tắt)
- Khoá theo node (băm, xoay/thu hồi, chỉ đọc từ tệp, quyền tệp chặt), endpoint kéo run/tiến độ/huỷ theo node; edge áp cùng cổng như trung tâm; huỷ trung tâm dừng walker edge (DỪNG vẫn gửi); chỉ nạp robot của node; một chủ ghi trạng thái robot; khoá chuyển động đọc trước khi chuyển động; run không nhận được ⇒ "edge không liên lạc được" sau 10 phút. E2E hai tiến trình qua HTTP.
- **Giới hạn thiết kế (review: hạng C):** edge vẫn giữ đăng nhập DB trung tâm ⇒ khoá node không phải ranh giới với một edge bị chiếm. Không chặn gộp khi cờ tắt; **chặn bật** ngoài vùng tin cậy trung tâm. Chưa có ô chọn "chạy trên edge" trong Studio.

### Nhóm T — checksum chương trình Siemens S7 (bật theo adapter)
- Theo tài liệu (RFC 1006, Wireshark s7comm, Snap7): SHA-256 trên định danh CPU (mã, serial, tên module, **firmware**), địa chỉ adapter, danh sách khối và thông tin từng khối OB/FB/FC/DB/SDB; SFC/SFB phủ bằng firmware; khối bảo vệ/không đọc được/gói bị cắt ⇒ không đọc được ⇒ từ chối; hạn theo adapter (mặc định 1 s, tối đa 10 s). **Phát hiện thay đổi, không chống giả mạo** với người có quyền ghi PLC; **chưa kiểm trên PLC thật** (FAT).

### Nhóm U — E-stop ngắn và tin cậy đa instance
- OPC-UA: subscription có hàng đợi (bắt nhấn-nhả ngắn), chu kỳ/keep-alive có trần, đọc kiểm tra định kỳ, đồng hồ đơn điệu; không đạt ⇒ chuyển đọc định kỳ (hiện rõ). Modbus: bit chốt chỉ đọc (mẫu chương trình PLC trong hướng dẫn); khi chốt đang bật hiện "E-stop lần đầu thấy lúc T, chốt chưa reset" (không chặn; không với DỪNG). Heartbeat tag tuỳ chọn; "heartbeat stale" hiển thị riêng.
- Quyền vượt "tắt thông báo" là một dòng DB tiêu thụ đúng một lần — replay từ instance khác/Redis không lấy được lần thứ hai.

### Kiểm
- Mỗi nhóm review → vòng sửa (R: 3 + 2 lượt quét; T: 1 + 3 lượt quét; U: 2 + 2 lượt quét; S: 2 lượt quét); commit tích hợp tệp dùng chung; review toàn nhánh → vòng sửa cuối → review lại: **sẵn sàng gộp**. Vòng cuối: 2.100 test pass, 0 lỗi; 199/199 tệp đổi; `tsc` sạch.

### Trước khởi động lại
1. Xác nhận 0368 đã có trên dev; áp **0369 → 0370 → 0371** `--dev-only`.
2. Build + restart; giữ `EDGE_EXECUTION_ENABLED` và `SAFETY_PLC_POLLER_ENABLED` tắt.

**Còn mở:** edge bỏ đăng nhập DB trung tâm (lớn ~1 đợt) hoặc vai trò Postgres theo node (vừa); trung tâm chưa đọc khoá chuyển động do edge đặt và bộ đếm thế hệ khoá dùng chung; robot chỉ edge tới được không có ghi trạng thái; vài điểm nhỏ (node bận bị coi "không liên lạc", CLI đọc mật khẩu từ biến môi trường, đếm sai TOTP); S7 cần FAT; việc của chủ dự án: cấp khoá TLS, đổi mật khẩu keystore, thử APK 1.0.18.

## 18. Kết quả Đợt 10 — edge không còn đăng nhập DB trung tâm (2026-10-12 → 10-13)

Plan `docs/superpowers/plans/2026-10-12-engineering-control-dot10.md`; thiết kế + sổ phán quyết (R-10-a … R-10-bs) trong `.superpowers/sdd/2026-10-12-engineering-control-dot10/`. Migration **0372–0376** — chỉ `_test`; áp dev theo **runbook cắt chuyển `docs/EDGE_GATEWAY.md` §8.13**.

### Quyết định của chủ dự án (2026-10-12)
- D1–D14 theo khuyến nghị; D5 (edge mất trung tâm ⇒ GIỮ việc không phải STOP) giữ; D6 telemetry robot edge mặc định thường + duyệt hai người mới được tin cậy.

### Kết quả theo nhóm
- **A — hợp đồng, ký, migration, bẫy DB:** Ed25519 trên payload chuẩn hoá, tách theo `typ`, chuỗi keyset ký bởi khoá đang tin, ghim phiên bản; tin cậy chỉ từ TỆP khoá (bảng DB là bản sao); mọi envelope gắn node + credential + nonce/jti + TTL tính từ lần gửi đầu. 0372–0376: uỷ quyền từng bước, con trỏ báo cáo + bản ghi nội dung (băm, chống tái dùng seq), sở hữu thiết bị theo **kỷ nguyên chủ bất biến**, khoá chuyển động có `writerInstanceId`, duyệt tin cậy hai người trong DB, mọi hàm ghim `search_path = pg_catalog, public, pg_temp` (0376 ghim lại 9 hàm cũ, 4 hàm từng khai thác được bằng bảng TEMP che bóng). STOP không bao giờ bị xoá / hết hạn / mồ côi: chuyển theo chủ mới, `device_pending_stops`, ack chỉ qua hàm bảo vệ (edge: khớp nút + đích + kỷ nguyên; trung tâm: chỉ sau bản ghi thực thi thật); ý định ghi OT mồ côi giải quyết qua hàm bảo vệ, đúng một kết quả, kết quả thật đến muộn được giữ làm bằng chứng. Bẫy DB trên edge phủ mọi `postgres(` (census).
- **B — điểm thẩm quyền trung tâm:** cấu hình ký (chỉ thiết bị của nút trong nhà máy của nút), claim + gói chạy ký, `/authorize` từng bước với **chẵn lẻ cổng đầy đủ** với trung tâm (chính sách, preflight safety-PLC — tập trung tâm ⊆ tập ký, sở hữu, phạm vi nhà máy, khoá, duyệt), báo cáo theo seq (xung đột nội dung ⇒ 409), hàng lệnh lock/clear/STOP (STOP không bao giờ hết hạn/giữ lại; thiếu chữ ký ⇒ `cmd-stop-unsigned` riêng), mọi báo cáo NỚI trạng thái phải gắn đủ + bị từ chối khi có bằng chứng ngược.
- **C — engine một walker hai kho:** `RunStore` (trung tâm nguyên văn, edge không đọc DB); trạng thái tiếp tục suy từ HÀNG bước + sổ uỷ quyền (không bao giờ gửi lại bước đã gửi; STOP luôn gửi lại); kiểm chẵn lẻ trung tâm = edge 59/59.
- **D — phía thiết bị:** tách giai đoạn thiết bị không đổi hành vi; front-end edge (xác minh → cổng cục bộ → tiêu thụ sổ nhật ký → thiết bị → báo cáo); sở hữu thiết bị (chỉ cùng nhà máy), khoá chuyển động nhiều bản sao, quét STOP còn nợ; **STOP console qua `robot.consoleStop`** với xác thực suy giảm chỉ cho STOP (JWT + bộ nhớ phiên ≤ 15 phút, vô hiệu theo thế hệ) khi DB treo/chết.
- **E — runtime edge:** sổ nhật ký JSONL segment (chỉ gửi bản ghi đã fsync, kỷ nguyên mới khi tắt không sạch), client nút, nguồn cấu hình ghim, STOP đi đường nhanh trước mọi việc, gắn/tháo robot từng cái (khoá → STOP → tháo, có kiểm), khởi động không DB (0 lần chạm bẫy).
- **F — kiểm + vận hành:** E2E hai tiến trình (edge không `DATABASE_URL`/`JWT_SECRET`/`SECRET_ENCRYPTION_KEY`, preflight bật) 12/12; bộ tấn công 20/20 (nút B giả nút A, replay, đổi payload, claim cũ, tin cậy giả, STOP chữ ký hỏng che bản ký, ack giả đích, lùi cấu hình, khác nhà máy, tái dùng seq); CLI đăng ký nút / sở hữu thiết bị / khoá ký (chứng minh admin trước khi ghi, mật khẩu chỉ từ TTY/stdin, 2FA sai tính vào khoá tài khoản); hành động "giải quyết STOP / ý định ghi / kết quả muộn"; compose edge không bí mật trung tâm; hướng dẫn `EDGE_GATEWAY.md` §8.

### Kiểm
- Mỗi nhóm review → vòng sửa (A 12, B 6, C 5, D 8, E 7, F2 3) → ~98 cờ quét bảo mật, mỗi cờ được phán quyết; hai commit tích hợp tệp dùng chung; review toàn nhánh (0 Critical, 7 Important, 9 Minor) → một vòng sửa cuối (đã sửa hết) → review lại (thêm 1 Important: gỡ khoá chuyển động thiếu phạm vi nhà máy — đã sửa) → hai đợt sửa dư nhỏ.
- Cuối cùng: `tsc` sạch; foe/robot/OT/edge 2.790, 0 lỗi; project nối tiếp (E2E 12/12, tấn công 20/20, s3/s4, census seed) 65/65; ~90 đột biến của vòng cuối đều bị diệt. Bộ test dùng chung trạng thái `_test` chạy bằng `pnpm test:serial` (`pnpm test:all` chạy cả hai) — **CI `ci.yml` hiện chỉ chạy `pnpm test` nên chưa chạy bộ nối tiếp.** **Diễn tập áp mới 0372–0376** trên DB nháp dựng từ chuỗi migration tới 0371: áp hai lần, 10/10 kiểm, bộ DB nhóm A 73/73 — bắt được một lỗi thật (bước kiểm của 0374 ghim mã lỗi phụ thuộc thứ tự trigger ⇒ trên dev sẽ báo FAILED), đã sửa.

### Thay đổi hành vi trung tâm được chấp thuận (ghi chú phát hành)
- Lệnh CHUYỂN ĐỘNG robot cần phạm vi nhà máy đọc từ DB (thất bại đóng) ⇒ robot chưa đặt chỗ không còn được người dùng bị giới hạn phạm vi di chuyển; STOP chỉ từ chối khi cả hai nhà máy đều biết và khác nhau (R-10-bc).
- Chuyển động trung tâm đọc chủ sở hữu + khoá đã lưu (thất bại đóng); lệnh OT tới adapter do edge sở hữu: STOP được xếp cho nút, ghi khác ⇒ `ADAPTER_OWNED_BY_EDGE`; khoá của người vận hành (`robot.requestMotionLock`) không bị STOP xác nhận gỡ; đọc chủ sở hữu lỗi ⇒ trung tâm không kết nối robot nào.
- Nút edge v1 (đăng nhập DB) không còn chạy workflow (R-10-l — cờ edge execution vẫn tắt ở production).
- `EDGE_CENTRAL_URL` phải là https (http chỉ loopback hoặc cờ lab).

### Giới hạn được chấp nhận (nói thẳng)
- Edge bị chiếm vẫn điều khiển được thiết bị CỦA CHÍNH nó; các kiểm ở trung tâm chống nhầm lẫn và mạng thù địch, không chống edge bị chiếm.
- avi_app vẫn ghi được hàng quyền/phân công ⇒ kiểm vai trò trong DB là phòng thủ chiều sâu; 2FA không kiểm được trong DB.
- STOP console khi KHÔNG có phiên robot và DB chết ⇒ không gửi được (cảnh báo thật "KHÔNG GỬI STOP"); xác thực suy giảm: bản sao khác chỉ hết hạn sau ≤ 15 phút.
- Hai bảng WORM mới chưa có chính sách lưu giữ (R-10-an); đảo thứ tự khoá ack STOP ↔ đổi chủ (bộ phát hiện deadlock + thử lại).
- Hàng seed `SIM-SAFETY-PLC-1` (không gắn nhà máy) chặn mọi uỷ quyền edge ở chế độ thật cho tới khi gắn nhà máy hoặc tắt.

### Trước khởi động lại (runbook `EDGE_GATEWAY.md` §8.13)
1. Truy vấn kết quả trùng theo ý định ghi = 0; kiểm 0125/0327.
2. Dừng :3000 → áp **0372 → 0376** `--dev-only` (cửa sổ yên tĩnh) → build → khởi động; giữ `EDGE_EXECUTION_ENABLED` tắt.
3. Cắt chuyển edge (khi bật): tạo khoá ký, đăng ký nút, đánh dấu sở hữu thiết bị, phát bundle, gỡ `DATABASE_URL` khỏi edge, đổi mật khẩu avi_app, chặn :5432.

**Đã thực hiện 2026-10-14 (chủ dự án duyệt):** gộp main `a9c1f40c3` + push; kiểm trước trên dev: kết quả trùng = 0, nhưng **`app_tenant_allows` trên dev đã bị một lần chạy lại 0125 cũ đảo về thân trước 0327** (lệch RLS có từ trước) ⇒ áp lại 0327, rồi 0372 → 0376 `--dev-only` (mỗi tệp tự kiểm + ghi sổ cái), `migrate-standalone` ghi nhận 0057/0066/0125/0234 bằng probe (thân 0327 còn hiệu lực), không còn gì chờ; SIM-SAFETY-PLC-1 gắn SIM-FAC (có dòng audit); build `52c2c1485` + khởi động :3000 — `/readyz` ready, không `persistUnknown`, không dòng "thiếu 0374". CI chạy thêm `pnpm test:serial`.

**Còn mở:** chính sách lưu giữ bảng WORM; FAT S7 và thử bench bộ đọc safety-PLC; việc của chủ dự án từ trước (khoá TLS, mật khẩu keystore, APK 1.0.18).

## 19. Kết quả Đợt 11 — phần còn mở sau Đợt 10 (2026-10-14)

Plan `docs/superpowers/plans/2026-10-14-engineering-control-dot11.md`; sổ phán quyết R-11-a … R-11-o trong `.superpowers/sdd/2026-10-14-engineering-control-dot11/`. Migration **0377** — chỉ `_test`.

### Quyết định của chủ dự án (2026-10-14)
- Bảng chỉ-ghi-thêm (WORM) của Đợt 10: **giữ vĩnh viễn, chỉ cảnh báo dung lượng**.
- Edge: chuẩn bị + thử MỘT nút mô phỏng trên máy này, nút thật vẫn tắt.
- `OT_CMD_SERIALIZE_ENABLED`: đo trên `_test` rồi đề xuất.
- Dọn tồn đọng: 6 census đỏ có từ trước, ghim 6 hàm còn lại + thứ tự khoá, test lệch giờ truy vấn thô, bench bộ đọc safety-PLC.
- Giữa đợt: cơ chế "làn ưu tiên STOP" khi bật hàng đợi ghi OT đẻ lỗ mới 4 vòng liền ⇒ chủ dự án chọn **đơn giản hoá** (R-11-n).

### Kết quả theo nhóm
- **G — cảnh báo dung lượng bảng WORM:** 13 bảng (báo cáo/bằng chứng/tin cậy 0363–0376 + `command_log`, `control_audit_log`), kiểm mỗi giờ, ngưỡng cảnh báo/nghiêm trọng (mặc định 2/10 GiB, 20/100 triệu hàng, chỉnh bằng env), cảnh báo bền vững loại riêng `worm_table_size` (tôn trọng giới hạn + tuỳ chọn người nhận, không lặp sau khởi động lại), bảng dung lượng ở trang sức khoẻ hệ thống; không xoá gì.
- **H — mig 0377:** 2 hàm plpgsql ghim `search_path`; 4 hàm SQL lõi (`app_tenant_allows`, `factory_timezone`, `db_storage_timezone`, `to_factory_time`) **định danh đầy đủ** thay vì ghim vì ghim chặn nội tuyến (đo 105 ms → 5 s / 300k hàng trên 82 chính sách RLS) — reviewer chứng minh không còn tên nào che bóng được; một thứ tự khoá thiết bị → yêu cầu cho mọi đường ack/giải quyết/quét STOP (deadlock 22–24/25 → 0); quét STOP trung tâm khoá thiết bị có hạn 1 s rồi vẫn gửi STOP (8 s → ≤1,6 s khi hàng bị giữ); các trình áp migration cũ từ chối chạy sau 0377 trừ khi áp lại 0377 ngay sau.
- **I — census đỏ:** 6 census xanh (thông điệp thô client twin3d/AOIPackages → mã i18n, khoá i18n twinCanh, `appError` ở router gói AOI, test luồng KB, công thức yield dùng chung cho RF test cell; fakeUtc chỉ đỏ do tải) + một mỏ neo đột biến cũ; test lệch giờ truy vấn thô chạy lần đầu 10/10, không lệch.
- **K — đo hàng đợi ghi OT:** bật cờ: đọc-lại nhất quán 8/8 (tắt: 1/8), p99 2,6 s ở 40 lệnh đồng thời một thiết bị (thông lượng 178 → 15/s), thiết bị khác nhau độc lập. Phát hiện và sửa: lệnh dừng không ghim từng bị xếp sau/BUSY; ghi phát trước STOP có thể tới thiết bị SAU STOP (cả khi tắt cờ) ⇒ **bộ đếm STOP theo thiết bị** huỷ ghi phát trước STOP đã xác minh (`STOPPED_BEFORE_WRITE`).
- **Đơn giản hoá (R-11-n, R-11-o):** bật cờ ⇒ STOP ghim/đã xác minh gửi thẳng như khi tắt, chỉ chờ lệnh đang trên dây; STOP giống hệt đang gửi thì dùng chung kết quả thật; bỏ ~570 dòng làn/nhóm/gộp. Lệnh nhãn "stop" giá trị chưa xác minh đi đường thường với mọi cổng; tối đa 2 chờ/thiết bị, quá thì từ chối `STOP_UNVERIFIED_QUEUE_FULL` + cảnh báo (chỉ người dùng STOP ghim); hành động interlock có danh sách chờ riêng, được nhận trước; STOP đã xác minh huỷ lệnh có thể khởi động lại máy (ghi giá trị khác giá trị ghim vào thẻ dừng).
- **L — bench safety-PLC:** máy này KHÔNG có OpenPLC (không cài gì). Script `scripts/safety-plc-bench.ts` chạy bộ đọc thật qua driver Modbus thật với điểm Modbus bất kỳ; tự kiểm với server Modbus trong repo 11/11 (nhấn/nhả e-stop, nhấn ngắn bắt được khi có bit chốt, cửa an toàn, mất/có PLC, 0 lần ghi).

### Thời gian STOP (tắt cờ / bật cờ)
- STOP ghim sau 6 lệnh ghi: 16–20 ms / chỉ chờ lệnh đang trên dây (≈50 / 240 / 1.035 ms cho lệnh 20 / 200 / 1.000 ms); đọc-lại treo 18–22 ms / 4,97 s.
- Lệnh dừng chưa xác minh sau 6 lệnh: 0,27 s / 1,64 s; hàng đầy: 0,29 s / 0,94 s.

### Kiểm
- Mỗi nhóm review → vòng sửa; ~11 cờ quét bảo mật trên làn STOP ⇒ đơn giản hoá; review toàn nhánh (2 Critical + 2 Important, cờ bật) → vòng sửa cuối → đơn giản hoá → review lại: **sẵn sàng gộp khi cờ `OT_CMD_SERIALIZE_ENABLED` tắt**. Cuối: 4.008 test OT/edge/robot/điều phối xanh cả tắt và bật cờ; project nối tiếp 65/65; `tsc` sạch; đột biến đều bị diệt.

### Thay đổi hành vi khi TẮT cờ (production, ghi chú phát hành)
- Lệnh ghi phát ngay trước một STOP đã xác minh bị huỷ (`STOPPED_BEFORE_WRITE` — người vận hành thấy "gửi lại nếu cần"); lệnh nhãn "stop" chưa xác minh còn đang qua cổng bị STOP đã xác minh thay thế (`SUPERSEDED_BY_STOP`).
- Quét STOP trung tâm gửi STOP ngay cả khi hàng thiết bị đang bị giữ (cảnh báo một lần mỗi đợt giữ); ghi trạng thái robot đăng ký không chặn và không bao giờ bị ghi đè bởi trạng thái cũ hơn kém an toàn hơn.
- Một test cũ (`pinnedStop.dot1d` "1E đối chứng") được sửa vì khẳng định hành vi BUSY đã bỏ có chủ đích (R-11-g).

**Còn mở:** áp 0377 lên dev (ngoài giờ — bước kiểm làm mới 2 materialized view, có thể chặn dashboard tới 60 s); bật `OT_CMD_SERIALIZE_ENABLED` (đề xuất: được, giờ đã sạch); cài OpenPLC để bench thật; thử nút edge mô phỏng (cần chủ dự án nhập mật khẩu admin + 2FA); bộ đếm STOP theo tiến trình (nhiều bản sao: chỉ trong tiến trình); FAT S7; việc của chủ dự án (khoá TLS, mật khẩu keystore, APK 1.0.18).

## 20. Kết quả Đợt 12 — phần còn mở sau Đợt 11 không cần quyết định (2026-10-15)

Plan `docs/superpowers/plans/2026-10-15-engineering-control-dot12.md`; sổ phán quyết R-12-a … R-12-f trong `.superpowers/sdd/2026-10-15-engineering-control-dot12/`. Migration **0378** — chỉ `_test`.

### Kết quả theo nhóm
- **N — robot mô phỏng có khoá chuyển động thật; gỡ khoá robot không có bộ khoá:** driver sim có khoá chuyển động như driver thật (robot sim giao cho edge nhận gỡ khoá ký rồi di chuyển được); robot không có bộ khoá nhưng mang hàng khoá đã lưu (vd `ownerChanged` sau khi trả từ edge) chỉ gỡ qua thao tác gỡ khoá có audit (phạm vi nhà máy, lý do, khớp thế hệ, audit trước, có giới hạn thời gian, lỗi cũng ghi audit) — không bao giờ tự gỡ. Sửa thêm: trả robot từ edge từng kẹt vĩnh viễn (STOP xác nhận gỡ khoá rồi tháo bị từ chối "chưa khoá") ⇒ edge khoá lại sau STOP. Đổi cài đặt robot trên edge: trạng thái **"đang làm an toàn"** đặt trước STOP, STOP không gỡ được, kiểm lại sau khi ghi sổ uỷ quyền ⇒ không lệnh di chuyển nào lọt khe; robot kẹt ở trạng thái này hiện "degraded" và được thử lại; robot trung tâm không kết nối được hiện khoá + lý do và được thử gắn lại.
- **O — cho nút edge nghỉ hưu:** lệnh `retire-node` + thao tác chỉ admin trong app, có audit; mig 0378: từ chối khi nút còn giữ thiết bị / có yêu cầu STOP-khoá mở / có run chưa xong (nêu đích danh), thu hồi mọi credential trong cùng giao dịch, giữ hàng (không xoá — bằng chứng WORM tham chiếu), không bao giờ cấp lại credential / thiết bị / run / claim, mã không đăng ký lại được; không thể chèn nút đã nghỉ sẵn; hiển thị "đã nghỉ" trong trạng thái fleet. Đăng ký nút mới tạo giao thức v2 (trước đó tạo v1 — một cuộc cắt chuyển thật sẽ không chạy được).
- **P — STOP chia sẻ giữa nhiều máy chủ trung tâm:** STOP đã xác minh gửi xong ⇒ báo qua kênh NOTIFY riêng; máy chủ khác huỷ lệnh ghi thường còn đang qua cổng (không bao giờ huỷ STOP; trên thiết bị có ghim, lệnh nhãn "stop" ghi giá trị khác cũng bị huỷ). Tin ký HMAC (khoá dẫn xuất từ `SECRET_ENCRYPTION_KEY` hoặc `OT_STOP_EPOCH_HMAC_KEY`; không có khoá ⇒ TẮT, một cảnh báo mỗi đợt), chống lặp, giới hạn tuổi, bộ nhớ có trần không fail-open, kết nối riêng ngoài pool (trễ khi pool bão hoà 270 → 11–25 ms), lời chào ký lúc khởi động phát hiện lệch khoá; trạng thái hiện ở trang sức khoẻ hệ thống. Listener đổi chủ cũng có heartbeat + tự nối lại + đồng bộ lại.
- **Dọn:** census `emitHandledBy` ghim lại kèm test chứng minh bộ theo dõi dung lượng chỉ đọc catalog; test `safetySimOnly` giữ khoá seed riêng; 10 khoá i18n AI-coding thiếu từ tháng 9 ⇒ `pnpm i18n:check` xanh.

### Kiểm
- Mỗi nhóm review → vòng sửa; 4 cờ quét bảo mật (#110–#113) đều được ghim bằng test đỏ trước rồi sửa; review toàn nhánh (0 Critical, 2 Important) → một vòng sửa cuối → review lại: **sẵn sàng gộp**. dot12 138/138, robot/OT/edge 2.556/2.556, project nối tiếp 66/66, `i18n:check` xanh, `tsc` sạch; đột biến của vòng cuối 45/45.

### Ghi chú vận hành
- Dev hiện chưa có `SECRET_ENCRYPTION_KEY` / `OT_STOP_EPOCH_HMAC_KEY` ⇒ sau khởi động lại, đồng bộ STOP giữa máy chủ TẮT kèm một cảnh báo (dev chạy một máy chủ nên không mất gì); phải đặt khoá trước khi thêm máy chủ trung tâm thứ hai.
- Áp 0378 lúc yên tĩnh (chờ khoá có thể giữ yêu cầu STOP tới edge ≤ 5 s); app vẫn chạy khi chưa có 0378 (nghỉ hưu nút trả "thiếu migration 0378").

**Còn mở:** thử nút edge mô phỏng trên dev (chờ chủ dự án nhập thông tin admin — `scratchpad/edge-trial/OWNER-SETUP.md`); khoá HMAC cho nhiều máy chủ; 223 nút nghỉ hưu của test trên `_test` (không xoá được, theo thiết kế); +2 kết nối DB mỗi máy chủ; nợ cũ ngoài module (35 chuỗi tiếng Việt twin3d, 115 lỗi kiểu ở tệp test); việc phần cứng/chủ dự án (FAT S7, PLC an toàn thật, khoá TLS, mật khẩu keystore, APK 1.0.18, bật hàng đợi ghi OT).
