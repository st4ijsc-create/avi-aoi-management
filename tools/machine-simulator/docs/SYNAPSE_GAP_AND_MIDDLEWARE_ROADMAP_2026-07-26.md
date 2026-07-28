# BÁO CÁO RÀ SOÁT & KẾ HOẠCH HOÀN THIỆN
## Phần mềm trung gian (Edge Middleware) cho hệ sinh thái SYNAPSE — chạy độc lập được, kết nối được khi cần

| | |
|---|---|
| Ngày lập | 26/07/2026 |
| Đối tượng rà soát | `tools/machine-simulator` (bộ `St4i.*`, .NET 10) — "St4i Machine Simulator" đang tiến hoá thành edge middleware |
| Tài liệu đối chiếu | Kế hoạch & thiết kế **SYNAPSE** tại `D:\SOURCES\SYNAPSE` (SYN-RAOE-SDD-001 v1.0 + KE-HOACH-PHAT-TRIEN + 5 tầng) |
| Phương pháp | 3 AI Agent rà soát song song: (1) chuẩn hoá 97 yêu cầu SYNAPSE, (2) kiểm kê hiện trạng theo mã nguồn, (3) phân tích contract + thương mại hoá |
| Trạng thái | **ĐANG THỰC HIỆN** — GĐ1 xong; GĐ2 xong (trừ B2); GĐ3 phần "Join" (WS-I) nay đã đóng advertise + reconciliation + xoay vòng chứng thư + lệnh khôi phục admin — chỉ còn auto-provision/trust-on-first-discovery; **WS-G-plugin (Connector SDK) nay đã có SEAM** (contract assembly độc lập + registry + `connectors.json` + bộ conformance — CHƯA có plugin loader/sidecar, xem §0-bis.2). Xem **§0-bis Tiến độ** (cập nhật 28/07/2026) |
| Cập nhật gần nhất | **28/07/2026** — nhánh `feat/machine-simulator`; sau đợt WS-I closeout (`09253325`), đợt **WS-G-plugin Connector SDK seam** đóng phần mã nguồn tại `2df998e3` (GP-1..GP-6b) + phần web/docs tại đợt này (GP-7) — xem `.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/` |

---

## Quyết định định hướng đã chốt (26/07/2026)

| # | Quyết định | Chốt |
|---|---|---|
| 1 | Ngăn xếp Machine Edition | **Giữ .NET/C#** (không viết lại Go/Rust) |
| 2 | Thứ tự ưu tiên | **Giai đoạn 1 "Độc lập bán được" TRƯỚC** |
| 3 | Hai hệ sinh thái | **UNS cục bộ = xương sống; ST4I + SYNAPSE = 2 connector bridge** |
| 4 | License/Edition | **Hoãn sang Giai đoạn 3** — tập trung core + hoàn thiện chức năng trước |
| 5 | CSDL single-node | **SQLite trước** (trừu tượng hoá qua interface để nâng PostgreSQL/Timescale sau) |
| 6 | Đa giao thức (GĐ2) | *(chưa chốt — thuộc Giai đoạn 2)* |
| 7 | Vision/AOI | **Không** đưa AOI thành hạng nhất ở GĐ1 — historian GĐ1 tập trung **automation results (cycle/result/telemetry) tổng quát**; chi tiết inspection AOI để phase sau |
| 8 | Vị trí tài liệu | Giữ tại `tools/machine-simulator/docs/` |
| 9 | Khởi động | **Bắt đầu WS-A** (Historian/OEE/Report) theo trình tự WS-A → (WS-C ‖ WS-D) → WS-F1 |
| 10 | Cách thực thi | **Subagent-driven** — mỗi task 1 subagent + review giữa các task |

---

## 0-bis. TIẾN ĐỘ THỰC HIỆN *(cập nhật 28/07/2026)*

> Nhánh `feat/machine-simulator`, tính tới đợt **WS-I closeout** @ `09253325` (đã có `669eba86` trong lịch
> sử, chưa push remote `fresh` tại thời điểm đóng đợt này). Mỗi workstream đóng bằng một **whole-branch
> review** (agent `opus` cho phần an toàn/mật mã/đồng thời) với kết luận MERGE-READY, không còn
> Critical/Important. Bộ test SAU WS-I closeout (theo `task-6-report.md`, lần chạy sạch cuối cùng):
> EngineApi 538 · EdgeCore 463 · EdgeService 28 (tổng 1029) · web build sạch · Playwright 171/171 (gồm
> visual/a11y 44/44, không đổi).
>
> **Sau đó, đợt WS-G-plugin (Connector SDK seam, GP-1..GP-7)** thêm 2 project test mới
> (`St4i.Connector.Abstractions.Tests`, `St4i.Connector.Conformance.Tests`) bên cạnh 3 project cũ. Bộ
> test hiện tại (đã tự chạy lại khi đóng GP-7, không lấy nguyên báo cáo cũ): EngineApi 609 · EdgeCore
> 530 · EdgeService 31 · Connector.Abstractions.Tests 45 · Connector.Conformance.Tests 11 (**tổng 1226**)
> · web build sạch. Playwright: chưa chạy lại TOÀN BỘ 171 bài của đợt WS-G-plugin — trang `/assets` (nơi
> GP-7 thêm thẻ trạng thái connector) không nằm trong 14 baseline visual/a11y hiện có (giống `/site`,
> `/alarms`, `/line` — chỉ có DOM-level spec riêng); spec DOM `20-assets.spec.ts` (2 bài, gồm kiểm tra
> a11y + không rò rỉ khoá i18n) đã chạy lại và PASS.

### 0-bis.1 Đã giao

| WS | GĐ | Đã giao | Commit | Tài liệu |
|---|---|---|---|---|
| **WS-A** Historian & Báo cáo | 1 | SQLite historian bền + `OeeCalculator` (A×P×Q, **3 nhóm tổn thất trung thực** thay vì six-big-losses) + 11 endpoint + xuất CSV/PDF + màn `/historian` `/reports` | `cd2d25cb` | *(chưa có §README riêng)* |
| **WS-C** Store-and-forward bền | 1 | Wire WAL SDK ra đĩa (`queuePath`), `WalFlushPump` + `WalMaintenance`, chứng minh replay đúng thứ tự qua restart | `7720774e` | *(chỉ ở bảng env §15.2)* |
| **WS-D-core** Bảo mật cục bộ | 1 | Cookie auth + user store + RBAC 3 vai + audit hash-chain + loopback-guard + `verifyTls` mặc định bật | `1491e9da` | §14 |
| **WS-F1** Đóng gói | 1 | EngineApi chạy **Windows Service** + MSI WiX v4 (dựng thật) + `remove-data.ps1` | `99cd6271` | §15 |
| **WS-FF** Fast-follows | 1 | `FleetSettingsStore` bền qua restart; DPAPI `LocalMachine` + ACL; xoá CVE NU1903 | `338f01ff` | §15.8 |
| **WS-B** UNS spine | 2 | Broker nhúng + **Sparkplug B** + NBIRTH/NDEATH + cây `syn/{site}/...` retained | `1b005dfb` | §16.1 |
| **WS-G-core** Policy | 2 | `PolicyEngine` default-deny (EstopGuard + RoleObligation) + `/v1/safety` chỉ-đọc (XC-R40) | `1b005dfb` | §16.2 |
| *(G2-5)* Cách ly lỗi | 2 | FleetHost N-slot, 1 driver chết không kéo sập pipeline khác | `1b005dfb` | §16.3 |
| **WS-H1a** Modbus TCP | 2 | `ModbusTcpDriver` (NModbus, MIT) chỉ-đọc, slot cách ly, telemetry `Verdict.Skip` (không bơm FPY) | `1b005dfb` | §16.4 |
| **WS-J** Asset Registry | 2 | `AssetRegistryStore` (SQLite, **ISA-95 URN**, vòng đời Provisioned→…→Decommissioned) + `/v1/assets` + màn `/assets` | `88b5b1b7` | §16.5 |
| **WS-D-field / EC** Danh tính + bridge | 3 | X.509 tự ký (ECDSA P-256, DPAPI+ACL) + bridge mTLS hướng lên Site theo **pinned trust** + `/v1/site*` + màn `/site` | `81c44e4a` | §17 |
| **WS-I / SD** mDNS join | 3 | `SiteDiscovery` (Makaretu, MIT) **browse-only** + `GET /v1/site/discover` + nút "Discover Sites" điền sẵn host/port | *(sub-2)* | §17.4–17.5 |
| **WS-H1b** OPC-UA | 3 | `OpcUaDriver` (OPC Foundation, **relicense MIT 04/12/2025**, pin 1.5.378.156) poll-only, slot cách ly, hiện trong roster/web | `d637c320` | §16.6 |
| **WS-G-core+** Alarm + Line | 3 | **ISA-18.2 AlarmEngine** (3 nguồn: Policy-DENY / DriverHealth / NG-rate, SQLite `alarms.db`, evaluator định kỳ) + **LineController PackML/ISA-88** trên FleetHost + `/v1/alarms` `/v1/line` + UNS `_line/state` + khoá alarm→Held + màn `/alarms` `/line` | `669eba86` | §18 |
| **WS-I closeout** | 3 | mDNS **advertise** (`_st4i-machine._tcp`, mặc định BẬT khi UNS bật) + **spool bền SQLite cho bridge** (`bridge-spool.db`) với **reconciliation** (resync record retained trước khi phát lại, seq tăng dần) + **xoay vòng chứng thư thiết bị** theo yêu cầu (`POST /v1/site/identity/rotate`, Admin-only) + hiển thị hạn dùng chứng thư + cảnh báo nguồn **`Identity`** (High, không bao giờ Critical) + verb khôi phục **`--reset-admin-password`** (ngoài băng, có audit) + trả hết nợ kỹ thuật WI-6 (WPF `IConvertible→ToDouble`, xslt khớp đuôi, `--install` pre-check) | `09253325` | §14.7, §17.8–§17.11, §18.1–§18.2 |
| **WS-G-plugin** Connector SDK — **SEAM** (chưa phải hệ plugin) | 3 | `St4i.Connector.Abstractions` (contract assembly `net10.0` thuần, ZERO dependency) + hợp đồng vòng đời `IDeviceDriver` viết thành XML doc + connector id mở (chuỗi tự do, 5 id có sẵn giữ nguyên chính tả) + `ConnectorRegistry` thay hard-code trong `FleetHost` + `connectors.json` (chỉ dispatch được Modbus/OPC-UA có sẵn) + `GET /v1/connectors` + thẻ trạng thái connector trên `/assets` + bộ **conformance suite** đóng gói được (`St4i.Connector.Conformance`, tìm ra và giúp sửa **2 lỗi độ tin cậy thật** ở Modbus/OPC-UA — xem §16.4/§16.6). **CHƯA có plugin loader/sidecar — đây là SEAM, không phải hệ plugin đầy đủ** (xem README §19.7) | `2df998e3` (mã nguồn GP-1..GP-6b) + đợt này (GP-7, web/docs) | §16.4, §16.6, §16.7, §19 |

### 0-bis.2 Đính chính cách đánh số giai đoạn

Trình tự **thi công** khác trình tự **§6**. Cụ thể: bốn đợt được ledger gọi là "GĐ3" (EC · mDNS · OPC-UA · Alarms+Line) thực chất gồm **WS-I của GĐ3** (EC + mDNS) và **hai hạng mục còn nợ của GĐ2** (WS-H1 đa giao thức, WS-G-core Line/Alarm). Vì vậy:

- **GĐ1 — XONG.** (License/Edition không thuộc GĐ1 theo quyết định #4.)
- **GĐ2 — XONG, trừ hai điểm:** `WS-B B2` (đảo chiều bridge — đã đánh giá riêng, **chủ động hoãn**) và `WS-H1` phần **Serial/RS-485** (chưa làm).
- **GĐ3 — MỚI XONG ~1/4–1/3.** §6 liệt kê 4 workstream; hiện trạng (2 trong 4 nay PARTIAL, nhưng
  `WS-G-plugin`'s phần đã xong chỉ là SEAM — không tính là "đã xong workstream"):

| WS-GĐ3 (§6) | Trạng thái | Còn thiếu |
|---|---|---|
| **WS-I** Join | **PARTIAL** — mDNS advertise ✅ xong, reconciliation seq-number + backfill ✅ xong (WS-I closeout) | auto-provision/trust-on-first-discovery (discover + advertise chỉ điền sẵn host/port; tin cậy vẫn phải dán tay PEM) |
| **WS-E-full** License/Edition | **CHƯA BẮT ĐẦU** | Toàn bộ (Ed25519, fingerprint, offline activation, feature-flags theo edition, grace 30 ngày, license-credit nâng cấp) |
| **WS-F4** Auto-update + LTS | **CHƯA BẮT ĐẦU** | Chỉ có nền (`Directory.Build.props`, `capabilities.version`); chưa có cơ chế phát hành/cập nhật, chưa có nhánh LTS |
| **WS-G-plugin** Connector SDK | **PARTIAL — mới có SEAM** (contract assembly + `IDeviceDriver` lifecycle contract + connector id mở + `ConnectorRegistry` + `connectors.json` chỉ dispatch Modbus/OPC-UA + conformance suite đóng gói được, tìm ra 2 lỗi thật đã sửa — README §19) | Plugin loader/sidecar (mô hình cô lập ĐÃ CHỌN là sidecar ngoài tiến trình — CHƯA XÂY); `plugin.yaml`/SemVer `apiVersion`/`configSchema`→UI tự sinh/ký số plugin; đăng gói NuGet cho contract assembly; `connectors.json` CHƯA onboard được hãng thứ ba tuỳ ý |

- **GĐ4 — CHƯA BẮT ĐẦU.**

### 0-bis.3 Bảng GAP cập nhật

| GAP | Trạng thái 28/07/2026 |
|---|---|
| **A** Dữ liệu bền & báo cáo | **DONE** (giữ 3 nhóm tổn thất thay vì six-big-losses — cố ý, trung thực) |
| **B** Xương sống middleware | **PARTIAL** — B1 ✅ · B2 ✅ · B3 ✅ · B5 ✅ · **B4 dở** (Modbus/OPC-UA cơ bản; Serial/SECS chưa) |
| **C** Cơ chế JOIN | **PARTIAL** — bridge ✅, định danh vị trí ✅, dual-connector ✅, **mDNS advertise ✅**, **reconciliation seq + resync record ✅**; **auto-provision/trust-on-first-discovery chưa** |
| **D** Bảo mật & an toàn | **PARTIAL** — D1–D3 ✅ · D4 ✅ (**xoay vòng cert thủ công/theo yêu cầu ✅ qua `POST /v1/site/identity/rotate`** — nhưng vẫn CHƯA EST/SCEP, CHƯA Site-CA, chưa tự động xoay trước hạn) · D5 ✅ · `--reset-admin-password` (khôi phục Admin ngoài băng) ✅ · **D6 (ký số + SBOM + quét CVE) chưa** |
| **E** Điều phối/Guardrail | **DONE** — E1 Policy ✅ · E2 LineController ✅ · E3 ISA-18.2 Alarm ✅ |
| **F** Thương mại hoá | **PARTIAL** — F2 ✅ · F3 ✅; **F1 license chưa** · **F4 auto-update/LTS chưa** · F5 HA thật chưa |
| **G** Plugin/SDK | **PARTIAL** — **G1 seam ✅** (contract assembly độc lập + `IDeviceDriver` lifecycle contract + connector id mở + `ConnectorRegistry`/`connectors.json` + conformance suite đóng gói được, tìm ra 2 lỗi thật đã sửa ở Modbus/OPC-UA); **G2 sidecar bọc DLL hãng CHƯA** (mô hình cô lập đã chọn, chưa xây); **G3 `plugin.yaml`/apiVersion/`configSchema`→UI/ký số CHƯA** |
| **H** Trí tuệ (T4) | **CHƯA BẮT ĐẦU** *(đúng chủ ý hoãn)* |

### 0-bis.4 Backlog đang treo *(đã ghi nhận, chưa làm)*

Mỗi mục dưới đây đều được ghi rõ trong ledger/blueprint hoặc mục "Honest deferrals" của README — **không có nợ ẩn**.

| Nhóm | Mục treo |
|---|---|
| Join/UNS | `WS-B B2` đảo chiều bridge (~34 file, rủi ro cao — đã đánh giá riêng); mDNS **auto-provision/trust-on-first-discovery** (discover + advertise chỉ điền sẵn host/port, tin cậy vẫn dán tay PEM); NCMD lệnh vào từ Site; bridge `Faulted` chưa có cơ chế TỰ ĐỘNG khởi động lại vòng lặp (áp lại Site link qua `PUT /v1/site`, hoặc xoay vòng danh tính, đều dựng lại bridge và gỡ lỗi ngay — KHÔNG cần restart tiến trình; chỉ thiếu phần TỰ ĐỘNG/giám sát); head-of-line blocking khi Site từ chối vĩnh viễn 1 message (chưa có dead-letter) |
| Bảo mật | EST/SCEP + Site CA; xoay vòng chứng thư CHỈ thủ công/theo yêu cầu (chưa tự động trước hạn); HMAC-khoá + neo audit ra ngoài (WORM); **D6 ký số MSI + SBOM + quét CVE** |
| Giao thức | Modbus 32-bit/float + gộp block + **RTU**; OPC-UA **subscriptions** + xác thực bằng cert + duyệt address-space; Serial RS-485; S7/EtherNet-IP; SECS/GEM |
| Alarm/Line | Tự động HOLD fleet **đang chạy** khi có Critical mới; hold theo từng máy; shelving/rationalization; trạng thái PackML chuyển tiếp đầy đủ; *(mới, Task 9)* **chưa có debounce** trước khi `Health` chuyển `Degraded` khiến `AlarmEvaluator` báo High — hiện raise ngay lần quan sát Degraded ĐẦU TIÊN (không cần vài lần liên tiếp); hành vi này có TỪ TRƯỚC (không phải do Task 9's Modbus timeout fix gây ra), đổi ngữ nghĩa cảnh báo là quyết định rộng hơn phạm vi task đó nên chỉ ghi nhận ở đây, chưa sửa |
| Đóng gói | Ký số MSI (cần chứng thư OV/EV); smoke cài/gỡ trên VM sạch + đo mốc ≤30 phút; MSIX; *(mới, Task 9)* MSI ghi đè lại `connectors.json` lên trên một bản operator đã tự sửa tay khi cài lại/upgrade — **giống hệt rủi ro đã có sẵn với `fleet.json`** (cả hai đều `CopyToOutputDirectory`/component MSI, không có bước "giữ file đã sửa tay" khi reinstall); chưa sửa, ghi nhận ở đây |
| Dữ liệu/Báo cáo | `run_events` theo từng máy (OEE Availability đa line); PdfSharp-GDI ⇒ chỉ chạy Windows; telemetry chưa có idempotency-key (rủi ro trùng khi replay WAL) |
| Plugin/SDK *(mới, sau WS-G-plugin seam)* | Plugin loader/sidecar ngoài tiến trình (mô hình cô lập ĐÃ CHỌN, CHƯA XÂY — loader đó PHẢI từ chối đăng ký bên thứ ba dưới id có sẵn, xem README §19.7); `plugin.yaml`/SemVer `apiVersion`/`configSchema`→UI tự sinh/ký số plugin; đăng gói NuGet cho `St4i.Connector.Abstractions`/`St4i.Connector.Conformance`; conformance suite chưa phủ `Waveforms` (không driver thật nào populate), chưa có negative-control cho `Id`/`Kind`/baseline `Health`, và chưa phủ `ScenarioAwareDriver` (wrapper `FleetHost` thật sự lắp vào slot mô phỏng); **hazard đã ghi nhận, chưa cần sửa thêm (đợt review toàn batch, fix 1 đã đóng phần FleetHost — per-slot try/catch quanh `Cts.Cancel()`):** một driver bên thứ ba đăng ký callback huỷ (`CancellationToken.Register`) chạy ĐỒNG BỘ ngay trong lock `_gate` khi `Estop()`/`Stop()` huỷ token slot của nó — `IDeviceDriver.ReadAsync`'s doc comment nay ghi rõ callback đó phải nhanh, KHÔNG throw, KHÔNG I/O chặn; `FleetHost` tự vệ được cho MỌI driver (per-slot, không riêng driver nào), nhưng một callback chậm (không throw) vẫn có thể kéo dài `Estop()` — chưa có cơ chế bound/timeout riêng cho chính callback đó |

*(Hàng "Kỹ thuật vặt" trước đây liệt kê ở đây đã được xử lý hết bởi **Task WI-6**
(`.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-6-brief.md`), nên đã bỏ khỏi bảng
backlog — không phải nợ ẩn, mà là backlog đã đóng: (1) WPF `MachineViewModel` nay dùng
`TelemetryNumeric.TryGet` giống 3 điểm gọi sẵn có, không còn `IConvertible→ToDouble` không chắn; (2)
**đính chính**: khoản nợ "khớp xslt mong manh" trước đây bị gán nhầm cho `remove-data.ps1` —
`packaging/remove-data.ps1` **không chứa xslt nào cả** (tra cứu chính xác theo tên service +
`%ProgramData%` cố định); khớp mờ thật sự nằm ở `packaging/installer/exclude-shell-and-engine-exe.xslt`
(`contains()` thay vì khớp đuôi chính xác) — nay đã sửa thành khớp hậu tố có phân cách đường dẫn, MSI đã
dựng lại và xác minh; (3) `--install` nay có bước kiểm tra trước, báo lỗi rõ ràng + mã thoát riêng nếu
service đã đăng ký (thay vì gọi `sc.exe create` trực tiếp), không còn xung đột âm thầm với tính năng
`ServiceFeature` của MSI.)*

---

## 0. Tóm tắt điều hành

**Hệ thống hiện tại là một sản phẩm HMI/edge được kỹ thuật hoá tốt, với một "đường ống middleware" thật sự (`EdgeCore`: driver → normalize → transport), nhưng CHƯA phải là một "phần mềm trung gian độc lập bán được" và CHƯA phải "kết nối hệ sinh thái được theo chuẩn platform".** Nó mạnh ở **Tầng 1 (Kết nối)** và **Tầng 5 (Ứng dụng/UI)**, gần như trống ở **Tầng 2 (UNS/Dữ liệu)**, **Tầng 3 (Điều phối)**, **Tầng 4 (Trí tuệ)**.

Ba phát hiện then chốt:

1. **Yêu cầu của bạn ≡ "Machine Edition" của SYNAPSE.** Kế hoạch SYNAPSE (§4) đã định nghĩa sẵn đúng bài toán bạn nêu: *một codebase "gập được" (collapsible), chạy single-node offline trên 1 IPC, khoá license, nhưng "join" được vào Site qua bridge UNS + mDNS — "không cài lại, không mất dữ liệu, license cũ được trừ vào giá mới".* Đây là kim chỉ nam cho toàn bộ kế hoạch dưới đây.

2. **Có HAI "hệ sinh thái" cần phân biệt — và đây là quyết định kiến trúc lớn nhất.** Máy hôm nay nói chuyện với **nền tảng ST4I AOI/AVI hiện có** (`avi-aoi-sim`) qua contract HTTP điểm-điểm (RESULT/inspection/telemetry/heartbeat/config-sync). Kế hoạch **SYNAPSE** lại là một trục **UNS/Sparkplug B** (`syn/{site}/...`). Đề xuất cốt lõi của báo cáo: **biến UNS cục bộ (embedded broker + Sparkplug B) thành "xương sống nội bộ" của máy**, còn ST4I và SYNAPSE chỉ là **hai connector bridge hướng ra ngoài** — nhờ đó vừa giữ tương thích ST4I hiện tại, vừa "nói được tiếng SYNAPSE" một cách bẩm sinh.

3. **Khoảng trống lớn nhất cho "chạy độc lập" KHÔNG phải là tính năng máy, mà là DỮ LIỆU BỀN.** Máy chạy offline rất tốt (Demo), HMI đẹp, config lưu đĩa và điều khiển được sim — nhưng **mọi dữ liệu sản xuất (kết quả/telemetry) chỉ nằm trong bộ đệm RAM, giới hạn ~200 chu kỳ/máy và mất khi khởi động lại.** Không có historian, không có OEE lịch sử, không có báo cáo/xuất dữ liệu, không có quản lý người dùng/RBAC/audit cục bộ, API cục bộ chạy HTTP không xác thực. Với một máy bán lẻ cho khách "chỉ mua 1 máy", **thiếu lưu trữ dữ liệu bền là lỗ hổng định danh.**

**Khuyến nghị chiến lược:** **Giữ nguyên .NET/C# cho Machine Edition** (không viết lại bằng Go/Rust). Điều này hợp lệ theo chính kế hoạch SYNAPSE (Local Agent + sidecar bọc DLL C#/C++, UI React đã trùng, WebView2 ≈ Tauri). Ngăn xếp Go/Rust/Temporal/K8s của SYNAPSE là cho **Line/Site Edition** — phần mà công ty OEM máy có thể chưa cần tự xây. Ta hoàn thiện Machine Edition theo 4 giai đoạn: **(P1) Độc lập bán được → (P2) Xương sống middleware & sẵn sàng kết nối → (P3) Join hệ sinh thái & license/edition → (P4) Trí tuệ tăng cường qua hệ sinh thái.**

---

## 1. Phạm vi & phương pháp

- **Đã đọc đầy đủ:** README máy (≈550 dòng, gần như một tài liệu thiết kế), toàn bộ 7 tài liệu SYNAPSE (dev-plan + SDD + 5 tầng), các doc `CONFIG_SYNC_*`, `MACHINE_CONFIG_DESIGN`, `PRODUCTION_UI_DESIGN`, `HMI_DESIGN_SPEC`, và mã nguồn `St4i.*` + `web/`.
- **3 Agent chuyên môn chạy song song**, kết quả lưu tại `scratchpad/FINDINGS_*.md` (ma trận 97 yêu cầu SYNAPSE; kiểm kê hiện trạng có trích dẫn file; phân tích contract/thương mại hoá).
- **Lưu ý dữ liệu:** README trỏ tới "doc 61/62 (ECOSYSTEM)" nhưng **các file này không tồn tại trong repo**; contract được dựng lại từ **SDK tham chiếu `St4iDeviceClient.cs` (được biên dịch thẳng vào `EdgeCore`)** + `examples/device-client` + doc máy. SYNAPSE là **tài liệu kế hoạch/thiết kế**, chưa có mã nguồn.

---

## 2. Hiện trạng hệ thống hiện tại

### 2.1 Kiến trúc & các lớp phần mềm (đánh giá: vững)

Hai front-end trên **một lõi không phụ thuộc WPF** `St4i.EdgeCore` (`IDeviceDriver → Normalizer → ITransport → EdgePipeline`):
- `St4iMachineSimulator` (WPF kiosk) · `St4i.EngineApi` (ASP.NET minimal-API :5199, REST+WS+phục vụ SPA React) · `St4i.DesktopShell` (WPF WebView2 ≈ Tauri) · `St4i.EdgeService` (headless) · `web/` (React 19/Vite, 11 màn, vi/en, 3 theme).
- **Điểm mạnh nền tảng:** seam `IDeviceDriver`/`Normalizer`/`ITransport` được thiết kế để mỗi giao thức mới chỉ thêm 1 driver + 1 mapping, không đụng pipeline — đúng tinh thần "kiến trúc mở, hiện thực tối giản" của SYNAPSE. ~360 test xUnit + Playwright.

### 2.2 Theo nhóm chức năng bạn yêu cầu

| Nhóm chức năng | Có gì hôm nay | Mức độ | Thiếu gì (tóm tắt) |
|---|---|---|---|
| **Kết nối** | Driver: 8 sim + Hot-folder AOI (thật). MQTT chỉ ở test. Transport Demo/Live/Auto + Switchable. SDK ingest/heartbeat/config-sync/enroll. Probe kết nối. | **PARTIAL — mạnh nhất** | MQTT chưa vào runtime; **chưa có Modbus/OPC-UA/Serial/SECS**; **chưa có UNS/Sparkplug**; store-and-forward **chỉ RAM** (WAL của SDK luôn `queuePath:null`). |
| **Cấu hình & Điều khiển** | Settings/mode; `DemoModeGate` (`ST4I_DEMO_ENABLED`); **MachineConfigStore** (baseline⊕machine⊕product, range-validate, có provenance, điều khiển sim thật); **ConfigSyncEngine** (check/pull/push/diff/history, checksum-drift, optimistic-lock, threshold-governance) + **Live backend đã wired thật**; Scenario; Onboarding register/claim/enroll; CredentialStore DPAPI. | **REAL — khá đầy đủ** | Mapping `mapping/*.json` là placeholder (chưa `FromJson`); push machine-config (`report-settings`) mới thiết kế; **chưa có Policy Engine / guardrail**. |
| **Quản lý** | Fleet run/start/stop/**E-STOP latch** (engine-owned); RegisterMachine động; health tối giản. | **MINIMAL** | **Không có Asset/Device Registry** (chỉ roster RAM + file cred); **không có Alarm/Andon** (chỉ là nhãn scenario); không có vòng đời tài sản/ISA-95 URN. |
| **Báo cáo** | FPY + pass-rate; **SPC (mean±3σ)**; telemetry/sparkline; cycle-log; **API Inspector** (WS realtime). | **REAL nhưng phù du** | **Không có OEE** (A×P×Q); **không có historian**; **không có xuất báo cáo (CSV/PDF/shift/serial lookup)**; **mọi dữ liệu run là RAM, mất khi restart** (≤200 chu kỳ/máy). |
| **Giao diện (UI)** | 11 màn web đều REAL (Dashboard/Machines/Products/Recipes/Onboarding/Inspector/Scenario/Settings…), **HMI living-twin** engine-driven, màn "Connect ecosystem". WPF app đầy đủ + kiosk/attract. 3 theme, i18n vi/en, ⌘K. | **REAL — mạnh** | Thiếu màn: historian/report, alarm center, audit log, quản lý người dùng, license. |
| **Trải nghiệm (UX)** | First-run "Connect ecosystem" (probe→auto-dismiss); onboarding wizard; đóng gói Demo↔Product bằng 1 cờ; a11y (aria+axe). | **REAL** | **Không có Simple/Expert mode**; chưa có setup wizard "quét mạng tìm thiết bị"; chưa có e-SOP. |

### 2.3 Theo 5 tầng SYNAPSE

| Tầng | Hiện trạng | Ghi chú |
|---|---|---|
| **T1 Kết nối/Trừu tượng** | **PARTIAL (mạnh nhất)** | Driver/transport/normalizer/creds/probe thật; nhưng thiếu Canonical Device Model, Asset Registry, đa giao thức OT, S&F bền. |
| **T2 UNS/Dữ liệu** | **VẮNG (gần như trống)** | Không UNS, không Sparkplug B, không cây topic, không historian, không OEE. Gần nhất: envelope chuẩn hoá + checksum. |
| **T3 Điều phối** | **TỐI THIỂU** | Có lập lịch nhịp (cadence), điều khiển fleet, vòng config-sync. Không Temporal/DAG, **không Policy Engine, không Line Controller**. |
| **T4 Trí tuệ** | **VẮNG** | Không AI/anomaly/PdM (sensor-drift là kịch bản scripted). |
| **T5 Ứng dụng/Cắt ngang** | **PARTIAL–STRONG** | 2 UI/WebView2/i18n/3 theme/inspector/DPAPI/health/selftest/packaging. Thiếu: **license, RBAC, audit bền, xuất metrics, e-SOP, ISA-18.2 alarm.** |

---

## 3. Đối chiếu SYNAPSE & phát hiện then chốt

### 3.1 Mô hình "Machine Edition" — đúng thứ bạn cần
Kế hoạch SYNAPSE §4: **một codebase → 3 edition** (Machine / Line / Site) qua *feature flag theo license*, không build riêng. Machine Edition = Integration Hub + Fleet-mini + **embedded broker** + UI (Tauri) + license; **bỏ Kafka/Twin/AI**; chạy 1 IPC, SQLite/PG đơn; **cài ≤30 phút**. Đây chính là "chạy độc lập 1 máy".

### 3.2 "Trojan horse" — khả năng JOIN tiềm ẩn phải xây sẵn dù standalone không dùng
Insight quan trọng nhất từ ma trận yêu cầu: **sản phẩm độc lập phải nhúng sẵn năng lực kết nối tiềm ẩn** — phát đúng cây topic `syn/{site}/...`, có Sparkplug Birth/Death, mDNS-discoverable, broker-bridgeable, có buffer ≥24h, license mở khoá được — để khi khách mua thêm/nâng cấp thì máy "gia nhập" Site *không cài lại, không mất dữ liệu, được trừ license*. **Nếu không xây sẵn từ đầu, sau này phải làm lại kiến trúc.**

### 3.3 Ranh giới an toàn — BẮT BUỘC, không thương lượng (XC-R40)
SYNAPSE (và do đó sản phẩm này) chỉ là **lớp điều phối/giám sát ISA-95 L2–L3**. **KHÔNG thay thế safety-PLC / E-stop / light curtain (ISO 10218, ISO/TS 15066).** Không có đường lệnh trực tiếp từ cloud xuống thiết bị; mọi lệnh qua Policy + audit; `getSafetyStatus` chỉ đọc, không có đường ghi. Phải in đậm trong mọi tài liệu và kiểm trong review an toàn trước mỗi pilot.

### 3.4 Ngoại lệ sản phẩm: Vision/AOI là chức năng LÕI, không phải "ecosystem-only"
SYNAPSE xếp Vision quality vào T4 (ecosystem-only). Nhưng **đây là sản phẩm cho máy AOI/AVI** (`avi-aoi-sim`) — xử lý **kết quả soi/khuyết tật cục bộ chính là nghiệp vụ lõi** (feed inspection/process-result đã tồn tại). Do đó: **pipeline kết quả AOI cục bộ = tính năng Machine bắt buộc**; chỉ phần AI nặng (phân loại khuyết tật bằng model, giảm false-call) mới là phần tăng cường qua hệ sinh thái.

---

## 4. Phân tích GAP (khoảng trống)

Ký hiệu ưu tiên: **P0** (chặn "bán được độc lập") · **P1** (chặn "middleware chuẩn / kết nối được") · **P2** (nâng cấp/hệ sinh thái).

### GAP-A — Dữ liệu bền & Báo cáo cục bộ *(P0 — lỗ hổng độc lập lớn nhất)*
| # | Thiếu | Ảnh hưởng |
|---|---|---|
| A1 | **Historian cục bộ** (kết quả/inspection/telemetry ghi đĩa, hiện chỉ RAM ≤200 chu kỳ, mất khi restart) | Máy standalone không giữ được dữ liệu sản xuất — không thể truy xuất, không thể chứng minh chất lượng |
| A2 | **OEE lịch sử (A×P×Q)** + six-big-losses; hiện chỉ có FPY tức thời | Không có chỉ số vận hành cốt lõi khách hàng cần |
| A3 | **Xuất báo cáo** (CSV/PDF, báo cáo ca, tra cứu theo serial/unit) + **genealogy/traceability** cục bộ | Không đáp ứng yêu cầu truy xuất & tuân thủ của nhà máy điện tử |
| A4 | Retention/tiering, event-time vs ingest-time, quality codes end-to-end | Dữ liệu không đủ tin cậy để báo cáo |

### GAP-B — Xương sống Middleware & Kết nối OT *(P1)*
| # | Thiếu | Ảnh hưởng |
|---|---|---|
| B1 | **UNS cục bộ: embedded broker + Sparkplug B + cây topic `syn/{site}/...`** + retained state | Không có "nguồn sự thật" nội bộ; không thể join hệ sinh thái |
| B2 | **Store-and-forward bền (đĩa) ≥24h** — chỉ cần *wire* WAL của SDK ra file (hiện `queuePath:null`) | Mất dữ liệu khi mất mạng/restart; chặn cả standalone lẫn join |
| B3 | **Canonical Device Model** (Asset/Tag/Telemetry/Command-Ack/Event/Health/SafetyState) + **Asset Registry (ISA-95 URN)** | Lõi không "trừu tượng hoá thiết bị" đúng nghĩa platform |
| B4 | **Đa giao thức OT**: Modbus TCP/RTU, OPC UA, Serial/RS-485, (SECS/GEM) — qua **Adapter SDK** | Chỉ nói HTTP + hot-folder; không cắm được thiết bị thật đa dạng |
| B5 | Mapping tag→canonical as-code (đưa `mapping/*.json` vào runtime + UI) | Placeholder chưa dùng |

### GAP-C — Cơ chế JOIN hệ sinh thái *(P1–P2)*
| # | Thiếu | Ảnh hưởng |
|---|---|---|
| C1 | **mDNS discovery** (Site tự thấy máy) + **broker bridge** (local UNS → Site broker) + **Join wizard** | Hiện phải gõ URL tay; không có "gia nhập không cài lại" |
| C2 | **Site/topology identity** (`syn/{site}/area/line/cell/...`) + reconciliation seq-number | Không có định danh vị trí để bridge |
| C3 | Kép connector: giữ **bridge ST4I hiện tại** + thêm **bridge SYNAPSE UNS** | Cần để không phá tương thích ST4I |

### GAP-D — Bảo mật & An toàn *(P0 phần cục bộ, P1 phần field/Zero-Trust)*
| # | Thiếu | Ảnh hưởng |
|---|---|---|
| D1 | **EngineApi cục bộ không xác thực** (HTTP thuần :5199, không auth/authz/HTTPS) | Chấp nhận được ở loopback, nhưng rủi ro khi mở LAN; cần bật auth + HTTPS/loopback-guard |
| D2 | **Không có RBAC/quản lý người dùng cục bộ**; trường `by` trong audit config là free-text không xác thực | Không biết "ai làm gì" — không đạt yêu cầu tuân thủ |
| D3 | **Audit bất biến (hash-chain/WORM ≥2 năm)** | Không có nhật ký kiểm toán tin cậy |
| D4 | **X.509 device identity + rotation**, **mTLS**, (SPIFFE/Vault) | Đang dùng 1 bearer `mk_` sống lâu; `verifyTls` **tắt được → chấp nhận mọi cert (MITM)** |
| D5 | **Chính thức hoá ranh giới an toàn** (`getSafetyStatus` RO, mã REJECTED `SAFETY_BLOCKED`, không đường ghi) | Bắt buộc theo XC-R40 |
| D6 | Signed update + SBOM + CVE scan | Chuỗi cung ứng phần mềm chưa an toàn |

### GAP-E — Điều phối/Guardrail cục bộ *(P1)*
| # | Thiếu | Ảnh hưởng |
|---|---|---|
| E1 | **Policy Engine (default-deny)** — mọi lệnh/hành động UI qua Policy, có audit, "no back-door" | Yêu cầu bắt buộc của platform (T3-R1, T5-R5) |
| E2 | **Line/Cell Controller** — máy trạng thái (IDLE→READY→PRODUCING⇄HELD…), readiness, recipe-lock, edge autonomy | Điều phối cấp máy cơ bản |
| E3 | ISA-18.2 **Alarm/Andon** (ưu tiên, runbook link, chống flood, MTTA/MTTR) | Không có hệ cảnh báo chuẩn |

### GAP-F — Thương mại hoá (License/Edition, Đóng gói, HA) *(P0–P1 tuỳ mục tiêu kinh doanh)*
| # | Thiếu | Ảnh hưởng |
|---|---|---|
| F1 | **Toàn bộ tầng license/edition** (Ed25519, fingerprint TPM/CPU/MAC, dongle tuỳ chọn, **offline activation**, feature flags, **grace 30 ngày — không bao giờ dừng sản xuất vì license**) | Không bán/OEM/khoá tính năng được; không có đường nâng cấp edition |
| F2 | **Installer thật** (MSI/MSIX/NSIS) — hiện chỉ "copy folder + double-click" | Không đạt "cài ≤30 phút" chuyên nghiệp |
| F3 | **Windows Service** cho EdgeService (hiện là console, hardcode DemoTransport) | Không chạy nền như một dịch vụ máy |
| F4 | **Auto-update + nhánh LTS** (1 LTS/năm, hỗ trợ 3 năm) | Gánh nặng hỗ trợ OEM nhiều phiên bản |
| F5 | **HA/buffering** (hiện không có; xem B2) | Độ sẵn sàng field |

### GAP-G — Khả năng mở rộng (Plugin/SDK) *(P2)*
| # | Thiếu | Ảnh hưởng |
|---|---|---|
| G1 | **Adapter/Connector SDK** + vòng đời discover→configure→validate→run→drain | Thêm hãng/thiết bị mới không "hằng số & cô lập" |
| G2 | **Sidecar bọc DLL C#/C++ của hãng** (gRPC), lõi không link DLL | Cần cho SDK Windows-only của thiết bị |
| G3 | `plugin.yaml` (SemVer apiVersion) + `configSchema`→**auto-sinh form UI** + conformance suite + ký số | Nền tảng "platform" đúng nghĩa (R3+) |

### GAP-H — Trí tuệ (T4) *(P2 — hoãn, trừ Vision/AOI lõi)*
Digital Twin, PdM, RL/Optimization, MLOps, Copilot: **ecosystem-only, hoãn**. **Ngoại lệ: pipeline kết quả AOI cục bộ là lõi** (mục 3.4); AI phân loại khuyết tật là tăng cường qua hệ sinh thái.

### Bảng tổng hợp ưu tiên GAP
| Ưu tiên | Nhóm GAP | Mục tiêu phục vụ |
|---|---|---|
| **P0** | A (dữ liệu bền/báo cáo), D1–D3 (auth/RBAC/audit cục bộ), F1 (license nếu bán OEM ngay) | **Bán được như máy độc lập** |
| **P1** | B (UNS/S&F/canonical/đa giao thức), E (Policy/Line Controller/Alarm), D4–D5 (device identity/safety), F2–F4 (installer/service/update) | **Middleware chuẩn + sẵn sàng kết nối** |
| **P2** | C (join wizard/bridge), G (plugin SDK), H (AI qua hệ sinh thái), edition nâng cao | **Gia nhập hệ sinh thái & mở rộng** |

---

## 5. Ý tưởng & định hướng kiến trúc

1. **Giữ .NET/C# cho Machine Edition — KHÔNG viết lại Go/Rust.** Hợp lệ theo chính SYNAPSE (Local Agent + sidecar C#/C++; UI React trùng khớp; WebView2 ≈ Tauri). Go/Rust/Temporal/K8s để dành cho Line/Site. → Bảo toàn ~360 test và toàn bộ đầu tư hiện có.

2. **UNS cục bộ làm "xương sống" nội bộ; ST4I và SYNAPSE là hai connector bridge.** `EdgeCore` phát mọi thứ lên **embedded MQTT + Sparkplug B (cây `syn/{site}/...`)**; từ đó: (a) **ST4I bridge** (giữ contract HTTP hiện tại — tương thích ngược), (b) **SYNAPSE bridge** (mDNS + broker bridge — tương lai), (c) **historian & UI cục bộ** đều subscribe UNS. → Một kiến trúc phục vụ cả standalone lẫn join, không phải làm hai lần.

3. **Historian nhúng = giá trị standalone.** SQLite (hoặc SQLite + phần time-series) ghi kết quả/telemetry/OEE bền, có retention; sinh báo cáo/xuất file, tra cứu theo serial. → Biến "app demo" thành "máy giữ dữ liệu của chính nó".

4. **Tái sử dụng hạt giống có sẵn (đòn bẩy lớn):** `Normalizer`/`MappingProfile` (đã shape sẵn cho canonical model + tag mapping), `ConfigSyncEngine` (đã có governance/optimistic-lock — nền cho recipe-lock), WAL của SDK (chỉ cần bật `queuePath`), `DemoModeGate`/`capabilities` (nền cho feature-flag/license), `TransportCoordinator`/`Switchable*` (nền cho multi-bridge).

5. **Policy Engine mỏng + ranh giới an toàn** đặt ngay trước mọi đường lệnh (kể cả UI) → khép "no back-door" và chuẩn bị cho Zero-Trust.

6. **License-as-feature-flags một artifact:** mở rộng `DemoModeGate`/`capabilities` thành license Ed25519 + fingerprint + offline activation + grace 30 ngày; edition = tập cờ, không build riêng.

7. **Đóng gói như sản phẩm thật:** MSI/MSIX + Windows Service + auto-update/LTS; giữ đường Tauri như tuỳ chọn.

---

## 6. Kế hoạch hoàn thiện (Roadmap 4 giai đoạn)

> Nguyên tắc: mỗi giai đoạn **chạy được end-to-end** và **giao được giá trị bán hàng**; CI kiểm cả 2 profile (single-node ↔ sẵn-sàng-cluster) để chống "edition drift".

### GIAI ĐOẠN 1 — "Máy độc lập bán được" *(P0)* — ✅ **XONG** *(28/07/2026)*
**Mục tiêu:** một khách mua 1 máy, không hệ sinh thái, vẫn có sản phẩm hoàn chỉnh & giữ được dữ liệu.
- **WS-A Historian & Báo cáo:** SQLite historian (kết quả/inspection/telemetry), **OEE A×P×Q + six-big-losses**, màn Historian/Report, xuất CSV/PDF, tra cứu serial/genealogy cục bộ. *(GAP-A)*
- **WS-C Store-and-forward bền:** wire WAL SDK ra đĩa (`queuePath`), replay theo thứ tự + cờ historical. *(GAP-B2)*
- **WS-D-core Bảo mật cục bộ:** auth + RBAC + quản lý người dùng cho EngineApi; **audit hash-chain**; loopback-guard/HTTPS; `verifyTls` mặc định bật. *(GAP-D1–D3)*
- **WS-F1 Đóng gói sản phẩm:** MSI/MSIX installer + **Windows Service** cho EdgeService; (đặt nền auto-update). *(GAP-F2–F3)*
- *(License/Edition đã hoãn sang Giai đoạn 3 theo quyết định #4 — nhưng vẫn giữ `capabilities`/feature-flag seam để mở khoá về sau không phải sửa kiến trúc.)*
- **Nghiệm thu:** cài ≤30 phút; chạy 1 ca không mạng, restart vẫn còn dữ liệu + OEE + báo cáo xuất được; đăng nhập phân quyền + audit "ai làm gì".

### GIAI ĐOẠN 2 — "Xương sống middleware & sẵn sàng kết nối" *(P1)* — ✅ **XONG** *(trừ `WS-B B2` chủ động hoãn + Serial chưa làm)*
**Mục tiêu:** đúng chuẩn "phần mềm trung gian", và nhúng sẵn khả năng join.
- **WS-B UNS spine:** embedded broker + **Sparkplug B** + cây topic `syn/{site}/...` + retained state; historian & UI subscribe UNS; **ST4I trở thành 1 bridge**. *(GAP-B1, C3)*
- **WS-J Canonical Model + Asset Registry** (ISA-95 URN, lifecycle, config-drift). *(GAP-B3)*
- **WS-H1 Đa giao thức qua Adapter SDK:** Modbus + OPC UA + Serial (đưa MQTT vào runtime; kích hoạt `mapping/*.json`). *(GAP-B4–B5)*
- **WS-G-core Guardrail:** Policy Engine default-deny + Line/Cell Controller + ISA-18.2 Alarm/Andon; chính thức hoá **safety boundary** + `getSafetyStatus`. *(GAP-E, D5)*
- **WS-D-field:** X.509 device identity + rotation + mTLS nội bộ. *(GAP-D4)*
- **Nghiệm thu:** cắm 1 thiết bị Modbus/OPC-UA thật qua adapter; mọi telemetry/kết quả đi qua UNS Sparkplug; mọi lệnh qua Policy + audit; onboard thiết bị mới trong vài giờ.

### GIAI ĐOẠN 3 — "Gia nhập hệ sinh thái & Edition" *(P2)* — 🔶 **ĐANG LÀM (~1/4)**
- **WS-I Join:** mDNS discovery + broker bridge local→Site + **Join wizard** ("không cài lại, không mất dữ liệu"); reconciliation seq-number. *(GAP-C)* — 🔶 **PARTIAL**: định danh X.509 + bridge mTLS + join thủ công + discover browse-only ✅; **advertise + reconciliation seq chưa**.
- **WS-E-full License/Edition:** feature-flags theo edition + license-credit nâng cấp; (license server on-prem là Site). *(GAP-F1)* — ⬜ **chưa bắt đầu**.
- **WS-F4 Auto-update + LTS.** *(GAP-F4)* — ⬜ **chưa bắt đầu** (mới có nền version/capabilities).
- **WS-G-plugin:** Connector SDK + **sidecar DLL hãng** + `plugin.yaml`/apiVersion + conformance + ký số. *(GAP-G)* — 🔶 **PARTIAL** (đính chính 28/07/2026 — dòng này trước đó mâu thuẫn với §0-bis cùng tài liệu): contract assembly độc lập + hợp đồng vòng đời `IDeviceDriver` + connector id mở + `ConnectorRegistry`/`connectors.json` + bộ conformance đóng gói được ✅ (**mới có SEAM** — xem §0-bis.2, README §19.7); **sidecar DLL hãng/plugin loader + `plugin.yaml`/apiVersion + ký số plugin chưa**.
- **Nghiệm thu:** 2 máy Machine Edition tự thấy nhau, bridge vào 1 Site giả lập không cài lại; mở khoá Line bằng license mới.

### GIAI ĐOẠN 4 — "Trí tuệ tăng cường qua hệ sinh thái" *(P2)* — ⬜ **chưa bắt đầu**
- Hook AI qua Policy (không đường lệnh trực tiếp): **Vision/AOI defect classify** (lõi sản phẩm — ưu tiên), PdM/anomaly recommendation-only; Twin/RL để Site. *(GAP-H)*

### Tương quan với lộ trình P1–P5 hiện có (README §12)
P2–P5 hiện tại (Sparkplug/Modbus/OPC-UA/SECS…) **nằm gọn trong WS-B/WS-H** của Giai đoạn 2. Báo cáo này **bổ sung** các trục mà lộ trình cũ chưa có: **historian/OEE/báo cáo, bảo mật cục bộ/RBAC/audit, license/edition, installer/service/auto-update, Policy/guardrail, join wizard** — chính là phần biến "công cụ" thành "sản phẩm trung gian độc lập kết nối được".

---

## 7. Đề xuất phân công AI Agent thực thi *(sau khi bạn duyệt)*
| Workstream | Agent chuyên môn đề xuất | Ghi chú |
|---|---|---|
| Thiết kế kiến trúc từng WS | `feature-dev:code-architect` | Blueprint trước mỗi WS lớn (UNS spine, historian, license) |
| Hiện thực .NET (WS-A/B/C/D/E/F) | `general-purpose` theo TDD (`superpowers:test-driven-development`) | Mỗi WS 1 nhánh/worktree |
| UI web (màn report/alarm/user/license) | `frontend-design` + `general-purpose` | Giữ design system/i18n/theme hiện có |
| Rà soát bảo mật (WS-D) | `security-review` / `/security-review` | Trước mỗi mốc field |
| Review chất lượng | `feature-dev:code-reviewer` / `/code-review` | Trước merge |

---

## 8. Câu hỏi cần bạn QUYẾT trước khi thực thi

1. **Chiến lược stack:** đồng ý **giữ .NET/C# cho Machine Edition** (không viết lại Go/Rust)? *(khuyến nghị: Có)*
2. **Ưu tiên mục tiêu trước:** làm **"độc lập bán được" (Giai đoạn 1) trước**, hay ưu tiên **"kết nối SYNAPSE" (Giai đoạn 2–3) trước**? *(khuyến nghị: Giai đoạn 1 trước)*
3. **Hai hệ sinh thái:** đồng ý hướng **UNS cục bộ là xương sống, ST4I + SYNAPSE là 2 bridge**? Máy hiện bán có cần giữ tương thích ST4I ngay không?
4. **License/Edition:** có cần **ngay ở Giai đoạn 1** (bán OEM liền) hay để Giai đoạn 3?
5. **DB single-node:** **SQLite** (nhẹ, đúng "SQLite/PG đơn") hay **PostgreSQL+TimescaleDB nhúng** (mạnh cho time-series/OEE)? *(khuyến nghị: SQLite trước, trừu tượng hoá để nâng PG sau)*
6. **Phạm vi giao thức Giai đoạn 2:** ưu tiên **Modbus + OPC UA** trước (SECS/GEM sau)? Có danh mục thiết bị thật cần cắm không?
7. **Vision/AOI:** xác nhận coi **pipeline kết quả AOI cục bộ là tính năng Machine lõi** (không hoãn theo T4)?
8. **Deploy tài liệu:** giữ báo cáo này tại `tools/machine-simulator/docs/…` hay chuyển sang `D:\SOURCES\SYNAPSE`?
