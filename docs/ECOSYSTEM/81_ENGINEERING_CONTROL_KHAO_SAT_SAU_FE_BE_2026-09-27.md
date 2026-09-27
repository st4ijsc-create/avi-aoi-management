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
