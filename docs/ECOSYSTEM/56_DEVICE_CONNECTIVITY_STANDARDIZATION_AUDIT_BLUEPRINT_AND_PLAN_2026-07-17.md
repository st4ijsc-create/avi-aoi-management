# Doc 56 — AUDIT + BLUEPRINT + KẾ HOẠCH: Chuẩn hóa kết nối thiết bị AVI/AOI · Máy tự động hóa nội bộ · IoT tự phát triển

**Ngày:** 2026-07-17 · **Branch:** `automation-orchestration-r0` · **Trạng thái: 🔶 CHỜ DUYỆT — CHƯA THỰC THI BẤT KỲ THAY ĐỔI CODE NÀO**

Yêu cầu gốc: chuẩn hóa để 3 nhóm thiết bị — (1) máy AVI/AOI hiện có, (2) máy tự động hóa nội bộ (bắt vít, điểm keo, hàn…), (3) thiết bị IoT tự phát triển — cùng kết nối qua API theo MỘT chuẩn: đăng ký & kết nối · dữ liệu API · cài đặt & đồng bộ · quản lý cấu hình; kèm UI quản lý trực quan chuyên nghiệp, dashboard phân tích, AI local hỗ trợ trọn vẹn kỹ thuật viên + công nhân + quản lý. **Triển khai máy nội bộ trước.**

Kế thừa: doc 51 (machine API P0–P3), doc 54 (GĐ0–3 devices), doc 55 (variant/config-sync), doc 16/18/19 (automation orchestration), doc 28 (ST4I Standard Inspection Feed), doc 08/09 (control plane, device programming).

---

## 0. Phương pháp & mức tin cậy

- Workflow **23 agent, 4 pha**: 10 agent audit song song theo trục → 10 agent **kiểm chứng đối kháng** (mỗi finding P0/P1 bị chủ động tìm cách bác bỏ bằng file:line) → 2 agent tổng hợp (blueprint + kế hoạch) → 1 agent phản biện độc lập. ~3,67M token, 1.568 tool call.
- **111 findings**: 15 P0 · 48 P1 · 36 P2 · 12 P3. Toàn bộ 63 finding P0/P1 đã qua kiểm chứng đối kháng: **37 CONFIRMED · 25 PARTIAL (phần sai ghi rõ trong phụ lục) · 1 REFUTED (bị loại khỏi thiết kế)**. P2/P3 chưa kiểm chứng độc lập (đều kèm bằng chứng file:line của agent audit).
- CODE là nguồn sự thật (đọc code + .env, KHÔNG chạy app/DB): "LIVE" = code wired + cờ bật; lượng dữ liệu thật trong DB chưa kiểm chứng.
- Phản biện độc lập chấm **8/10** — "duyệt được sau khi vá gap HIGH socket-credential + bổ sung bảng QĐ"; cả hai đã xử lý trong Phần D & B của doc này.

## 1. Tóm tắt điều hành

**Bảng điểm 10 trục × 3 nhóm thiết bị** (0–100, mức sẵn sàng production trong phạm vi trục):

| Trục | Key | AVI/AOI | Automation | IoT |
|---|---|---|---|---|
| Luồng đăng ký & khởi tạo thiết bị | `reg-onboard` | 72 | 45 | 22 |
| Tầng kết nối & giao thức | `connect-protocol` | 74 | 52 | 38 |
| Chuẩn hóa dữ liệu API | `api-data-std` | 72 | 28 | 35 |
| Chuẩn hóa cài đặt & đồng bộ cấu hình | `config-sync` | 72 | 38 | 12 |
| Tầng quản lý & giao diện | `mgmt-ui` | 72 | 45 | 15 |
| Tầng theo dõi & realtime | `realtime-monitor` | 68 | 52 | 34 |
| Dashboard & tầng phân tích dữ liệu | `dashboard-analytics` | 74 | 24 | 32 |
| Tầng AI local (3 persona) | `ai-local` | 74 | 47 | 18 |
| Taxonomy loại máy & mở rộng schema | `taxonomy-extensibility` | 72 | 55 | 15 |
| Hiện trạng thật automation + IoT | `automation-iot-reality` | 82 | 55 | 48 |
| **Trung bình** | | **73.2** | **44.1** | **26.9** |

**Bức tranh:** nền AVI/AOI trưởng thành (~73.2) và phần lớn hạ tầng chuẩn hóa ĐÃ TỒN TẠI dưới dạng seam chất lượng cao (enroll met_/claim mct_/khóa mk_ hash-at-rest, /v1/assets URN, device_types versioned registry, machine data contract, OT drivers 6 protocol, recipe catalog, store-forward, PKI nội bộ, capability model). Máy tự động hóa (~44.1) KHÔNG thiếu nền — thiếu **mắt xích cuối**: không có endpoint ingest nhận credential máy cho `process_results` (4 trục độc lập hội tụ cùng kết luận), pipeline config-sync hard-wired cho measurement-points AOI, dashboard/analytics process-result gần bằng 0. IoT (~26.9) thiếu **identity first-class** (enum không có loại IOT, `machines.stationId` NOT NULL, thiết bị MQTT rơi vào registry hình-điện-thoại không lifecycle). Kết luận chiến lược: **NỐI + BẬT + CHUẨN HÓA trên nền sẵn có — không rewrite.**

**15 finding P0** (chi tiết + bằng chứng ở Phụ lục A):

| ID | Trục | Phát hiện | Trạng thái | Kiểm chứng |
|---|---|---|---|---|
| REG-1 | reg-onboard | Danh tính máy yếu vẫn là MẶC ĐỊNH: machineCode-only (không bí mật) + shared plaintext apiKey default allow, plaintext lộ qua listPaged cho mọi user đăng nhập | LIVE | ◐ PARTIAL |
| CONN-1 | connect-protocol | Máy automation không có đường machine-credential để ghi process-result per-unit (screw/glue/weld) | MISSING | ✔ CONFIRMED |
| CONN-2 | connect-protocol | Đường auth yếu default-ALLOW: shared plaintext key + bare machineCode (không secret) vẫn ingest được | LIVE | ◐ PARTIAL |
| API-1 | api-data-std | Máy automation không có đường ingest RESULT bằng machine credential — processResult.record đòi session user | STUB | ◐ PARTIAL |
| API-2 | api-data-std | machineDataContract v1.0 đã DRIFT so với schema ingest thực và schemaVersion không được enforce ở ingest | STUB | ✔ CONFIRMED |
| CONFIG-SYNC-1 | config-sync | Pipeline version-sync (version/delta/tombstone/notify) hard-wired cho measurement points AOI — máy automation/IoT không có đường pull config tương đương | MISSING | ✔ CONFIRMED |
| CONFIG-SYNC-2 | config-sync | Drift detection recipe = 0: máy không có kênh báo config/recipe ĐANG CHẠY; ST4I program_version bị strip; 'xác nhận nạp' chỉ đọc catalog server | MISSING | ✔ CONFIRMED |
| MGMTUI-1 | mgmt-ui | Chưa có taxonomy 3 nhóm thiết bị trong UI; client MACHINE_TYPES lệch server (thiếu 4 type SMT, không có type IoT/WELDING) | MISSING | ◐ PARTIAL |
| MGMTUI-2 | mgmt-ui | Hành trình onboard phân mảnh 6+ entry point; wizard generic bị khóa cứng bước 'Deploy AI model' → máy không-phải-AOI không thể hoàn thành | LIVE | ✔ CONFIRMED |
| MGMTUI-3 | mgmt-ui | Trang Đăng ký máy vẫn hiển thị apiKey plaintext qua machine.listPaged — hở đường mà doc 54 P0-1 đã bịt ở list/get | LIVE | ✔ CONFIRMED |
| RTM-1 | realtime-monitor | IoT không có mô hình định danh riêng: bắt buộc là machines-row đủ hierarchy, telemetry chưa map thì vô hình toàn tuyến | MISSING | ◐ PARTIAL |
| dashboard-analytics-1 | dashboard-analytics | process_results (dữ liệu máy automation) KHÔNG có bất kỳ surface dashboard nào — 0 usage phía client | STUB | ◐ PARTIAL |
| TAX-1 | taxonomy-extensibility | Thêm loại máy mới = migration pg enum + ≥5 điểm sync thủ công — deviceTypes data-driven KHÔNG thể tự thêm loại | LIVE | ✔ CONFIRMED |
| TAX-2 | taxonomy-extensibility | Nhóm IoT tự phát triển KHÔNG có mô hình thiết bị first-class ở bất kỳ tầng nào | MISSING | ◐ PARTIAL |
| AIR-2 | automation-iot-reality | Không có endpoint machine-key để máy automation tự đẩy KẾT QUẢ CHU TRÌNH (process_results) — mảnh thiếu trung tâm của 'tiêu chuẩn hóa dữ liệu API' cho máy bắt vít/điểm keo | MISSING | ✔ CONFIRMED |

**Lời giải:** Phần A (blueprint 8 trục) + Phần C (kế hoạch 8 đợt Đ0–Đ7, pilot nội bộ ở Đ3: 1 máy bắt vít HTTP JSON + 1 ESP32 nhiệt-ẩm, sim đi đường ingest thật trước → thiết bị thật) + Phần D (7 điều chỉnh bắt buộc sau phản biện, gồm tách Đ2a/Đ2b → thực tế 9 đợt).

---

## 2. 🔑 PHẦN B — QUYẾT ĐỊNH CHỜ DUYỆT (QĐ1–QĐ11)

> **Quy tắc mặc định:** nếu anh/chị duyệt tổng thể mà không chọn riêng QĐ nào, phương án **khuyến nghị** của QĐ đó được áp dụng. Có thể duyệt kiểu "tất cả theo khuyến nghị, riêng QĐx chọn phương án Y".

### QĐ1 — Mô hình định danh cho thiết bị IoT tự phát triển (ESP32, cảm biến, gateway) — chúng "là gì" trong hệ thống?

- A. IoT = 1 machines row (machineType IOT_SENSOR/IOT_GATEWAY mới + station ảo IOT-<workshop> tự tạo, mqtt_clients thêm cột machineId link về): hưởng TRỌN lifecycle 7 trạng thái, URN, claim/enroll, presence sweep, ~50 AI tool, dashboard — chi phí 1 migration nhỏ + 1 quy ước station; nhược: bảng machines chứa cả thiết bị không phải máy sản xuất (cần cờ countsTowardOee=false để không méo KPI).
- B. Bảng iot_devices riêng (FK optional về stations/machines): ngữ nghĩa "sạch" hơn; nhược: phải xây lại toàn bộ credential lifecycle, presence, resolver cho AI/dashboard — đắt gấp nhiều lần, đi ngược nguyên tắc tái dùng, AI layer phải thêm resolver song song.
- C. Mở rộng mqtt_clients thành registry IoT: rẻ nhất trước mắt; nhược: kế thừa mô hình "điện thoại Android" (không URN/scope/lifecycle/link hierarchy) — audit 3 trục độc lập đều kết luận đây là ngõ cụt.

**Khuyến nghị:** Chọn A. Ba trục audit độc lập (REG-4, AILOCAL-6, TAX-2) hội tụ cùng khuyến nghị; toàn bộ tầng tool AI, presence, claim/enroll, genealogy tự phủ IoT mà không viết resolver mới. Chọn station ảo thay vì nới stationId nullable để không đụng các INNER JOIN 4 tầng đang chạy.

**Đợt bị chặn nếu chưa chọn:** Đợt 2, Đợt 6

### QĐ2 — Namespace topic MQTT cho thiết bị MỚI (automation + IoT): theo chuẩn syn/ 6-aspect hay tiếp tục avi/ legacy?

- A. Fleet mới dùng syn/ ngay từ firmware đầu tiên (đúng contract validate — topicToSubject chỉ nhận syn/, quarantine bật được), avi/ đóng băng cho máy AOI cũ với dual-publish trong giai đoạn chuyển tiếp: sạch dài hạn, enforce schema từ ngày 1; nhược: đội firmware học topic convention v2, vận hành thêm cờ dual-publish một thời gian.
- B. Tiếp tục avi/ cho mọi thiết bị: đồng nhất hiện tại, đỡ 1 khái niệm; nhược: nằm NGOÀI mọi contract validation (không enforce schema được), sau này chuyển là breaking cho fleet đã đông — đúng vết nợ mà máy AOI cũ đang chịu.
- C. Đặt namespace thứ ba riêng cho automation/iot: không có lợi ích nào bù lại việc nuôi 3 hệ topic — chỉ tăng phân mảnh.

**Khuyến nghị:** Chọn A. Chỉ syn/ đi qua ingestValidation (CONTRACT_VALIDATE mode=log đã chạy live); thiết bị mới chưa có client legacy nên chi phí chuyển đổi = 0 — đây là thời điểm rẻ nhất để chốt, để sau khi fleet đông mới đổi là breaking.

**Đợt bị chặn nếu chưa chọn:** Đợt 2, Đợt 4, Đợt 7

### QĐ3 — Thời điểm siết đường auth yếu machineCode-only (hiện default-ALLOW — ai trong LAN biết machineCode là giả được máy)?

- A. Siết TRƯỚC đợt onboard đầu tiên: chạy machine-key-rotation-report → rotate hết máy AOI sang mk_ → read-only → deny (runbook 52): nền sạch trước khi nhân số credential; nhược: cần cửa sổ phối hợp sản xuất, máy AOI nào sót chưa rotate sẽ đứt ingest.
- B. Song song hai tốc độ: nhóm automation/iot bị CẤM machineCode-only ngay từ đầu bằng policy theo deviceClass (0 rủi ro vì chưa có máy), còn AOI cũ chạy runbook 52 theo cửa sổ bảo trì, chốt deny toàn cục trước khi fleet mới vượt ~10 thiết bị: không chặn tiến độ chuẩn hóa; nhược: lỗ giả mạo trong LAN còn mở thêm vài tuần cho nhóm AOI cũ.
- C. Giữ nguyên allow vô thời hạn: không chấp nhận được — REG-1/CONN-2 xếp P0, mở rộng thiết bị trên nền này là nhân rủi ro nền tảng.

**Khuyến nghị:** Chọn B. Tách rủi ro đúng chỗ: fleet mới sạch tuyệt đối từ ngày 1 (policy per-deviceClass trong cờ MACHINE_CRED_MK_ONLY_ENABLED), AOI cũ siết có kiểm soát bằng telemetry weak-auth + read-only trung gian sẵn có, không block lộ trình W1-W3.

**Đợt bị chặn nếu chưa chọn:** Đợt 2, Đợt 7

### QĐ4 — Cường độ credential cho thiết bị IoT trên LAN xưởng: chỉ mk_ API key / password MQTT, hay bắt buộc cert X.509 (PKI nội bộ đã xây sẵn)?

- A. Giai đoạn 1 dùng mk_ key (HTTP) + password per-device (MQTT, hash-at-rest sẵn); cert mTLS là opt-in về sau: firmware ESP32 đơn giản, tốc độ triển khai nhanh; nhược: key nằm trên thiết bị LAN có thể bị trích — chấp nhận được cho nội bộ giai đoạn đầu với ACL topic + admission enforce.
- B. Bắt buộc device cert ngay từ thiết bị đầu tiên (deviceIdentityService + internal CA Ed25519 sẵn): an ninh mạnh nhất, danh tính cứng; nhược: TLS client-cert trên ESP32 + vận hành CA/rotate 90 ngày làm chậm đáng kể đợt pilot, đội firmware phải học thêm một tầng.

**Khuyến nghị:** Chọn A kèm lộ trình rõ: khi >10 thiết bị bật MQTT_ADMISSION_ENFORCE; lớp IOT_GATEWAY và thiết bị vùng nhạy cảm chuyển cert trước (deviceCertificates.deviceId = machine URN, MQTT_MTLS permissive→strict) — tận dụng PKI đã xây mà không trả chi phí cert cho từng cảm biến rẻ tiền ngay đợt đầu.

**Đợt bị chặn nếu chưa chọn:** Đợt 2, Đợt 7

### QĐ5 — Phạm vi pilot đợt triển khai đầu tiên với máy nội bộ?

- A. Pilot hẹp ratify chuẩn: 1 máy bắt vít HTTP JSON + 1 ESP32 nhiệt-ẩm (đúng 2 kịch bản nghiệm thu §9) + tùy chọn 1 adapter Modbus chạy sim; green-gate xong mới nhân rộng từng loại máy: rủi ro thấp, spec Feed v1 được thực tế kiểm chứng trước khi client đông; nhược: phủ chậm hơn ~1-2 đợt.
- B. Onboard đồng loạt cả 3 loại máy automation (vít + keo + hàn) + đợt IoT cùng lúc: phủ nhanh, sớm có số liệu toàn cảnh; nhược: spec v1 chưa được ratify — nếu phải sửa breaking khi 3 đội firmware đã tích hợp thì chi phí sửa nhân 3; tải đội cơ điện/firmware dồn cục.

**Khuyến nghị:** Chọn A. Kỷ luật additive-only chỉ an toàn khi v1 đã đúng; 1 máy + 1 thiết bị đủ chứng minh trọn chuỗi đăng ký→dữ liệu→config→dashboard→AI, và mọi loại máy sau đó onboard bằng data thuần (không sửa code) nên tốc độ nhân rộng không phụ thuộc đội dev.

**Đợt bị chặn nếu chưa chọn:** Đợt 1, Đợt 3

### QĐ6 — Tư thế enforcement cho fleet MỚI: strict ngay từ ngày 1 hay quan sát log-only một thời gian?

- A. Strict-from-day-1 cho máy mới: bắt buộc ts kèm offset, unit thuộc registry, schema quarantine trên syn/, typed recipe enforce, guardrail STRICT cho WELDER/SCREWDRIVE — máy CŨ vẫn giữ log-only: chuẩn có răng ngay, không tái diễn 'chuẩn trên giấy'; nhược: firmware đợt đầu bị reject nhiều hơn — cần bộ conformance fixtures + endpoint validate để đội firmware tự test trước khi nối.
- B. Log-only 2-4 tuần cho cả máy mới rồi mới siết: ít friction lúc đầu; nhược: dữ liệu sai đã lọt vào analytics/mart trong thời gian đó, và kinh nghiệm của chính hệ này (hàng loạt cờ enforce OFF thành nợ) cho thấy 'bật sau' thường bị trôi.

**Khuyến nghị:** Chọn A. Fleet mới là firmware nội bộ tự kiểm soát — đây là lợi thế duy nhất mà máy vendor AOI không có; trả chi phí conformance 1 lần ở pilot (QĐ5) rẻ hơn nhiều so với làm sạch dữ liệu + ép fleet đông tuân thủ về sau.

**Đợt bị chặn nếu chưa chọn:** Đợt 1, Đợt 4, Đợt 7

### QĐ7 — Cam kết nguồn lực NỘI DUNG tri thức AI (không phải code): có bắt buộc gói tri thức đi kèm mỗi loại máy onboard không?

- A. Bắt buộc trong Definition-of-Done của mỗi đợt onboard loại máy mới: bộ how-to/SOP tiếng Việt (xử lý sự cố, thao tác chuẩn) + bảng mã lỗi + manual vendor controller đưa vào corpus KB (pipeline ingest là contract mở — thêm thư mục + chạy script, zero code): AI phục vụ được cả 3 persona ngay khi máy lên sóng; chi phí: ~vài ngày công kỹ sư/loại máy.
- B. Onboard máy trước, bổ sung tri thức sau khi tích lũy sự cố thật: đợt đầu nhanh hơn; nhược: đúng gap AILOCAL-2 — AI trả lời không căn cứ cho máy mới trong giai đoạn người dùng đặt nhiều câu hỏi nhất, rủi ro mất niềm tin vào AI local ngay từ đầu.

**Khuyến nghị:** Chọn A. Audit xác nhận điểm nghẽn duy nhất của tầng AI là CONTENT chứ không phải hạ tầng (2.186 chunks hiện có 0 dòng về vít/keo/hàn/IoT); đầu tư vài ngày công/loại máy đổi lấy AI hữu dụng cho kỹ thuật viên + công nhân + quản lý ngay từ pilot.

**Đợt bị chặn nếu chưa chọn:** Đợt 6, Đợt 7

### QĐ8 — Cổng nghiệm thu đợt Pilot (Đ3): green-gate bằng simulator có đủ để tiếp tục Đ4, hay bắt buộc thiết bị THẬT (ESP32 + controller máy vít) chạy xong mới được sang đợt sau?

- A. Hai cổng tách rời: green-gate KỸ THUẬT bằng simulator đi đúng đường ingest thật (enroll→mk_→REST→dashboard→AI, kill-test 0-mất-0-trùng) cho phép sang Đ4 ngay; nghiệm thu NHÀ MÁY bằng thiết bị thật chạy song song trong 1-2 tuần sau (đội cơ điện flash firmware theo SDK + conformance fixtures) — tiến độ không phụ thuộc lịch phần cứng; nhược: có khoảng thời gian chuẩn 'mới được chứng minh bằng sim'.
- B. Bắt buộc thiết bị thật trước khi sang Đ4: bằng chứng thuyết phục tuyệt đối, phát hiện sớm vấn đề chỉ có trên HW thật (TLS/clock/reset); nhược: lịch phụ thuộc đội cơ điện + linh kiện, mọi đợt sau bị chặn nếu firmware trễ — đúng loại phụ thuộc mà kế hoạch cần tránh.

**Khuyến nghị:** Chọn A. Simulator của repo đi đúng đường ingest/auth thật (không ghi tắt DB) nên giá trị chứng minh kỹ thuật tương đương; rủi ro chỉ-thấy-trên-HW được đóng bằng cổng nghiệm thu nhà máy tách riêng, và Đ4 (config-sync) vẫn kiểm chứng được bằng chính máy sim đó.

**Đợt bị chặn nếu chưa chọn:** Đợt 3, Đợt 7

### QĐ9 — Nhịp bật cờ (activation cadence) cho ~22 cờ mới default-OFF: bật dần per-đợt sau mỗi green-gate hay gom về cuối lộ trình mới bật?

- A. Per-đợt: mỗi cờ bật staging ngay sau green-gate đợt tương ứng, prod trong ≤1 tuần (phạm vi pilot trước, toàn nhà máy sau), đo bằng counter/telemetry có sẵn trong response; riêng cờ ENFORCEMENT mạnh (quarantine, STRICT, enforce-mode) vẫn theo lộ trình QĐ6 ở Đ7; nhược: cần kỷ luật theo dõi sau mỗi đợt.
- B. Gom về Đ7 bật một lượt: ít thao tác vận hành giữa chừng; nhược: lặp lại đúng vết nợ doc 48 ('framework đẳng cấp SAU CỜ-TẮT → production ~⅓'), pilot Đ3 không thể chạy vì các cờ nền tảng còn OFF, và bug chỉ lộ khi bật đồng loạt — khó cô lập.

**Khuyến nghị:** Chọn A. Pilot Đ3 vốn đã ép phải bật cờ Đ1-Đ2 ở prod phạm vi hẹp; bật per-đợt biến mỗi green-gate thành kích hoạt thật có đo lường, tránh tái diễn 'chuẩn trên giấy' — kinh nghiệm trực tiếp của chính hệ này (doc 48 R1 activation).

**Đợt bị chặn nếu chưa chọn:** Đợt 3, Đợt 7

### QĐ10 — Số phận kênh SSE (server bật, zero consumer — RTM-11): tắt hẳn cho gọn hay chuẩn hóa thành kênh sự kiện nhẹ cho thiết bị/hệ ngoài? (Blueprint để P3 chưa quyết)

- A. Tắt SSE_ENABLED trong đợt hardening Đ7: giảm diện tích bảo trì + 1 heartbeat timer chết; thiết bị nhẹ nhận sự kiện qua MQTT retained notify (đã chuẩn hóa ở Đ4) + HTTP poll backstop — đủ cho firmware nội bộ; nhược: nếu sau này cần kênh event HTTP-only cho hệ ngoài thì phải mở lại.
- B. Chuẩn hóa SSE thành kênh công bố (channel telemetry/alerts/andon, hợp đồng trong doc 57/58): thêm lựa chọn cho thiết bị không đủ sức chạy socket.io; nhược: nuôi thêm một transport thứ 4 song song MQTT/socket/poll trong khi chưa có consumer thật nào — ngược nguyên tắc hội tụ đường chuẩn của chính doc 56.

**Khuyến nghị:** Chọn A. Doc 56 đang cố gom 5-6 cửa về ít đường chuẩn hơn; giữ một transport zero-consumer đi ngược mục tiêu đó. Firmware nội bộ (lợi thế tự kiểm soát) dùng MQTT retained + poll là đủ; chỉ mở lại SSE khi xuất hiện consumer thật với yêu cầu cụ thể.

**Đợt bị chặn nếu chưa chọn:** Đợt 7

### QĐ11 — Phạm vi staged rollout canary (CONFIG-SYNC-7 — nhấc FleetRolloutStrategy cho recipe deploy + points bump): làm trong Đ7 hay hoãn sang lộ trình sau khi fleet đủ lớn?

- A. Hoãn sang sau Đ7, chỉ làm khi fleet cùng loại vượt ~10 máy: với pilot 1-2 thiết bị và nhân rộng ban đầu vài máy/loại, fan-out tức thì có bán kính sự cố nhỏ và rollback recipe (previousRecipeId) + revertPointsConfig đã có; tiết kiệm 1 việc L cho đợt cuối vốn đã nặng; nhược: nếu nhân rộng nhanh hơn dự kiến thì phải chèn việc này gấp.
- B. Làm ngay trong Đ7 như blueprint gợi ý 'đợt sau': chuẩn rollout có sẵn trước khi fleet đông, không phải chèn gấp; nhược: xây tầng canary cho fleet 2-3 máy là over-engineering ở thời điểm đó, chiếm chỗ các việc hardening/tài liệu có ROI cao hơn.

**Khuyến nghị:** Chọn A với ngưỡng kích hoạt tường minh: ghi vào doc 58 điều kiện 'fleet cùng machineType >10 hoặc recipe áp cho >1 line' thì phải dựng canary trước lần deploy kế tiếp; khung FleetRolloutStrategy + test đã sẵn nên chi phí chèn sau ổn định (~L, không phát sinh thiết kế mới).

**Đợt bị chặn nếu chưa chọn:** Đợt 7


---

## 3. PHẦN A — BLUEPRINT CHUẨN HÓA (kiến trúc sư tổng hợp; đã áp điều chỉnh Phần D)

> Lưu ý đọc: mọi chỗ viết `syn/` trong phần này đọc là `synapse/` (điều chỉnh GAP-2, Phần D).

# DOC 56 — BLUEPRINT CHUẨN HÓA KẾT NỐI THIẾT BỊ: AVI/AOI + MÁY TỰ ĐỘNG HÓA NỘI BỘ + IoT TỰ PHÁT TRIỂN

Tài liệu THIẾT KẾ (chưa thực thi, chờ duyệt). Kế thừa doc 51 (machine API P0–P3 đã xong), doc 54 (GĐ0–3 devices), doc 55 (variant/config-sync), doc 16/18/19 (automation orchestration). Mọi dẫn chiếu finding đã qua kiểm chứng: REFUTED bị loại (vd API-8 — thực tế `POST /api/ot/ingest` ĐÃ LIVE), PARTIAL chỉ dùng phần đúng theo verdict_proof.

---

## 0. NGUYÊN TẮC & KIẾN TRÚC ĐÍCH

### 0.1 Nguyên tắc thực thi (bắt buộc theo quy ước repo)
1. **Cờ default-OFF, OFF = byte-identical** cho mọi thay đổi hành vi. Ngoại lệ duy nhất: 4 vá bảo mật P0 đi thẳng theo tiền lệ doc 54 P0-1/P0-2 (liệt kê ở §10 W0).
2. **Không rewrite** — mọi trục NHẤC pattern sẵn có lên tầng generic: bump-version/delta/tombstone/notify của points-sync, bộ durability của submitInspection (idempotency ledger + WAL + batch + provenance), catalog machine_recipes, mart/metricRegistry, toolRegistry AI HITL.
3. **Migration guarded** (IF NOT EXISTS / ADD VALUE IF NOT EXISTS / ON CONFLICT DO NOTHING), cột mới nullable; enum ADD VALUE là additive không rollback được — vô hại khi không dùng, ghi rõ trong từng file mig.
4. **Green-gate mỗi đợt**: tsc (heap 8GB) + test + LIVE proof (sim harness sẵn: sim-factory, sensor-generator, bench doc 53).
5. **Data-driven onboarding**: sau W1–W3, thêm "1 máy bắt vít HTTP JSON" hoặc "1 ESP32 nhiệt-ẩm" = thao tác dữ liệu/UI thuần, KHÔNG sửa code lõi (chứng minh §9).

### 0.2 Hợp đồng "một thiết bị là gì" — dùng chung 3 nhóm
| Thành phần | Chuẩn | Nền sẵn có (tái dùng) |
|---|---|---|
| Danh tính | 1 machines row + URN `urn:syn:asset` + deviceClass (aoi_avi/automation/iot) + deviceTypeKey | machines + lifecycle 7 trạng thái, /v1/assets + urnService, device_types |
| Credential | mk_ hash-at-rest (HTTP) / password per-device (MQTT) / cert PKI opt-in; cấp qua claim mct_ hoặc enrollment met_; TTL + cảnh báo hết hạn | machineAuthService, machineClaimTokens, machine_enrollment_tokens, deviceIdentityService |
| Dữ liệu | 3 loại message: RESULT (per-serial) · TELEMETRY (time-series) · EVENT (alarm/state) | process_results + product_inspections · ot_telemetry + /api/ot/ingest + telemetryBus · contracts/canonical 6 schema + andon |
| Cấu hình | catalog versioned (machine_recipes) + desired/reported shadow + notify + drift | machine_recipes (đã có cột machineType) + pattern points-sync + configDriftService |
| Hiện diện | heartbeat (metric qua /api/ot/ingest hoặc endpoint) → recency sweep → machine_status_logs | machinePresenceService (LIVE), connectionSupervisor |
| Tự mô tả | deviceTypeKey → device_types: attributesSchema + telemetry tags + supportedCommands + alarm map | equipmentStandards (EQ_GOVERN đã ON) + capabilityModel register-and-go |

### 0.3 Sơ đồ pipeline đích
```
Thiết bị (AOI | bắt vít/keo/hàn | ESP32)
  │ đăng ký: machine.register | machine.enroll(met_) | POST /v1/assets → duyệt → claim(mct_) → mk_
  ▼
RESULT    ─ POST /api/v1/ingest/process-result (MỚI, P0)  → process_results → genealogy/interlock/SPC/mart
          ─ POST /api/v1/ingest/inspection (sẵn, AOI)      → product_inspections
TELEMETRY ─ POST /api/ot/ingest (sẵn, LIVE) + alias /v1    → telemetryBus → ot_telemetry → presence/dashboard
          ─ MQTT syn/... theo telemetry.schema.json        → (subscriber mới) → telemetryBus
EVENT     ─ MQTT syn/... event.schema + alarm ISA-18.2     → andon/alert/escalation
CONFIG    ─ checkConfigVersion/getActiveConfig/ack (MỚI)   → machine_recipes + machine_config_state (+ MQTT retained notify)
```

---

## 1. TRỤC 0 — NỀN TAXONOMY & DEVICE CLASS (tiền đề mọi trục)

**Hiện trạng.** machineTypeEnum pg-enum cứng 21 giá trị là chuẩn thật; thêm loại máy = migration + đồng bộ tay ≥5 file và đã vỡ thật (client thiếu 4 loại SMT, fork thứ ba IMPORT_MACHINE_TYPES tự thừa nhận) — TAX-1, TAX-3; thiếu hẳn WELDER và lớp IoT (TAX-6, AIR-3, REG-4); device_types versioned tree đã bật (EQ_GOVERN=true live) nhưng DB chỉ 5 row demo sai vocabulary và machines không persist deviceTypeKey (TAX-4 phần đúng, MGMTUI-5 phần đúng).

**Thiết kế đích.**
- Migration `0286` theo template 0242: `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'WELDER' | 'IOT_SENSOR' | 'IOT_GATEWAY'`; thêm `'weld'` vào robotJobTypeEnum; `machines ADD COLUMN device_type_key varchar(64) NULL`.
- **deviceClass** là thuộc tính dẫn xuất, khai MỘT nơi: `server/constants/machineTypes.ts` thêm `DEVICE_CLASS_BY_TYPE` (map 24 type → aoi_avi|automation|iot); client bỏ hằng compile-time — thêm tRPC `machine.listTypes` trả {type, deviceClass, labelKey} từ server, refactor 4 dropdown (Step1MachineInfo, MachinesTab, FactorySetupWizard, MQTTReplay) dùng query này; XÓA fork `factoryConfigIO.IMPORT_MACHINE_TYPES` (TAX-3).
- Capability profiles mới qua `registerCapabilityProfile` (không sửa core, capabilityModel.ts): WELDER (telemetry weld_current/tip_temp/weld_time), IOT_SENSOR (telemetry-only, `capabilities.countsTowardOee=false`), IOT_GATEWAY.
- Seed device_types đủ 24 leaf vào DB: script `scripts/seed-device-types.mjs` từ buildSeedTypes (idempotent theo uq_devtype_key_version, origin='seed'); sửa `scripts/seed-engineering-data.mjs` adapterKind 'aoi'→'vision' (sai vocabulary); khai `attributesSchema` + required cho leaf automation (torque_target/torque_tolerance; volume_target/viscosity; weld profile) — TAX-11; stamp `machines.device_type_key` lúc approve + backfill máy cũ qua resolveDeviceTypeForMachineType.
- i18n: nhãn machineType_* cho 4 SMT + 3 type mới × 3 ngôn ngữ.
- Hoãn (đợt sau): hợp nhất mqtt_topic_templates.deviceType (taxonomy thứ ba avi/aoi/spi/other — TAX-8) về deviceTypeKey.

**Cờ + migration.** Enum ADD VALUE là additive (không cần cờ hành vi — máy không dùng thì không ảnh hưởng); phần UI grouping theo deviceClass gate bằng `DEVICE_CLASS_UI_ENABLED` (default OFF). Migration `0286_device_class_types.sql` guarded ADD VALUE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS; rollback: cột device_type_key có thể DROP, enum value để nguyên (ghi chú vô hại).

**File chạm:** drizzle/schema/enums.ts, drizzle/0286, server/constants/machineTypes.ts, server/services/equipment/capabilityModel.ts, server/services/standards/deviceTypeRegistry.ts, scripts/seed-*, client/src/constants/machineTypes.ts (+4 dropdown), i18n locales.

---

## 2. TRỤC 1 — TIÊU CHUẨN HÓA ĐĂNG KÝ & KẾT NỐI (hạng mục 1)

**Hiện trạng.** Luồng register→approve→claim→ingest của AOI đã LIVE chuẩn (lifecycle 7 trạng thái, mk_ hash-at-rest) nhưng: nền auth còn machineCode-only default-allow + plaintext apiKey lộ qua listPaged (REG-1 phần đúng, CONN-2 phần đúng — shared-key đã deny live); 2 cơ chế an toàn claim/enrollment xây xong backend mà UI vứt token hoặc 0 UI (REG-2, REG-3); IoT không có identity first-class (REG-4, CONN-4, RTM-1); 5–6 cửa onboarding không hội tụ (REG-6, CONN-5); TTL khóa chưa nối dây (REG-9); PKI đứng ngoài luồng (REG-10); không SDK thiết bị (REG-11).

**Thiết kế đích.**
1. **MỘT luồng chuẩn "Thêm thiết bị"** trên cùng state machine MACHINE_LIFECYCLE_TRANSITIONS, 3 kênh vào:
   - Kênh tự-báo: `machine.register` (đã nhận đủ machineType sau Trục 0);
   - Kênh hàng loạt: zero-touch enrollment met_ (server ĐÃ đủ: `machine.enroll` + `issueEnrollmentToken/listEnrollmentTokens/revokeEnrollmentToken` tại hierarchyRouters:1028–1157) — chỉ xây UI: tab "Mã gia nhập thiết bị" trong Factory Config hub (mint show-once + QR, list, revoke; chọn machineType/scopes/serialPattern/maxUses/TTL) rồi bật `ENROLLMENT_ENABLED` staging→prod;
   - Kênh declarative: `POST /v1/assets` (hệ thống ngoài/ERP).
2. **Credential chuẩn mới — mk_-only** (cờ `MACHINE_CRED_MK_ONLY_ENABLED`): khi ON, approve máy thuộc deviceClass automation/iot KHÔNG ghi `machines.apiKey` plaintext; `redeemMachineClaimToken` đổi sang mint mk_ qua machineAuthService.issueMachineKey (hiện claim trả machines.apiKey — thứ mà sharedMachineKeyPolicy=deny đang từ chối, REG-3 verdict); UI MachineRegistration thêm dialog show-once claimToken sau approve + nút "Cấp lại claim token" (pattern Step4Credential). TTL: bật `MACHINE_KEY_DEFAULT_TTL_DAYS=180` cho khóa mới + cron tuần `listExpiringMachineKeys(14)` → action inbox (REG-9; consumer mới trong backgroundJobs, cờ `MACHINE_KEY_EXPIRY_ALERT_ENABLED`).
3. **Siết weak-auth** theo runbook doc 52 (QĐ3): report → rotate 15 máy AOI → `MACHINE_CODE_ONLY_ALLOWED=read-only` → `deny`. Nhóm automation/iot bị CẤM machineCode-only ngay từ đầu: authenticateMachine thêm policy theo deviceClass (máy có deviceClass ≠ aoi_avi ⇒ bắt buộc mk_) — nằm trong cờ MACHINE_CRED_MK_ONLY_ENABLED.
4. **IoT identity** (QĐ1 — khuyến nghị machines-row): machineType IOT_SENSOR/IOT_GATEWAY; station: quy ước **station ảo `IOT-<workshopCode>`** tạo tự động per-workshop (KHÔNG nới stationId nullable — tránh vỡ các INNER JOIN 4 tầng, RTM-1); migration `0290` thêm `mqtt_clients.machine_id NULL FK` → thiết bị MQTT sau approve link về 1 machines row + URN, hưởng chung claim/enroll/lifecycle; retire machine ⇒ hook revoke passwordHash MQTT + chặn tự hồi sinh PENDING (REG-8). Gate toàn bộ bằng `IOT_DEVICE_CLASS_ENABLED`.
5. **MQTT cho fleet mới**: bắt buộc per-device password (hash-at-rest sẵn); bật `MQTT_ADMISSION_ENFORCE` khi >10 thiết bị (AIR-9); namespace theo QĐ2 (syn/); mTLS theo QĐ4 — enroll thêm option "cấp cert" trả privateKeyPem 1 lần, quy ước deviceCertificates.deviceId = machine URN (REG-10).
6. **Máy nói PLC** (điểm keo/hàn đời PLC): đường device_adapters + OT driver — track vận hành bật `OT_GATEWAY_ENABLED` + FAT 1 driver với sim trước máy thật (AIR-1); SECS/MTConnect chỉ khi có target thật (AIR-5).
7. **SDK/firmware mẫu** (REG-11): thư mục `examples/device-client/` — Python + Arduino C++ minh họa 4 bước register/enroll → claim → ingest (idempotencyKey + retry + local queue) → heartbeat; link từ ApiDocs. Zero code server.
8. **Vá bảo mật đi thẳng (W0, tiền lệ doc 54)**: strip apiKey khỏi `getMachinesPaged` (MGMTUI-3/REG-1); socket `machine:confirm_mapping` verify apiKey như sync_started (RTM-6); sửa lệch tên biến SMTP_PASS↔SMTP_PASSWORD (RTM-5).

**Cờ + migration.** Cờ mới: `MACHINE_CRED_MK_ONLY_ENABLED`, `IOT_DEVICE_CLASS_ENABLED`, `MACHINE_KEY_EXPIRY_ALERT_ENABLED` (đều OFF). Cờ sẵn bật theo lộ trình: ENROLLMENT_ENABLED, MQTT_ADMISSION_ENFORCE, MQTT_MTLS_ENABLED, MACHINE_CODE_ONLY_ALLOWED (siết), MACHINE_KEY_DEFAULT_TTL_DAYS. Migration: `0290_mqtt_client_machine_link.sql` (ADD COLUMN IF NOT EXISTS machine_id NULL, FK ON DELETE SET NULL; rollback DROP COLUMN).

**File chạm:** server/routers/hierarchyRouters.ts (approve/claim nhánh cờ), server/services/machineAuthService.ts (policy theo deviceClass), server/db/hierarchy.ts (redeem claim mint mk_), server/_core/socket.ts (vá confirm_mapping), client MachineRegistration.tsx + factoryConfig/EnrollmentTokensTab.tsx (mới), drizzle/schema/mqtt.ts, server/services/mqttService.ts (lifecycle hook), examples/device-client/ (mới).

---

## 3. TRỤC 2 — TIÊU CHUẨN HÓA DỮ LIỆU API (hạng mục 2): envelope RESULT / TELEMETRY / EVENT

**Hiện trạng.** Máy automation KHÔNG có đường machine-credential ghi kết quả per-serial — processResult.record đòi session user, /v1 chỉ có ingest/inspection (CONN-1, API-1, AIR-2 = P0 trung tâm); TELEMETRY thì ĐÃ có đường LIVE `/api/ot/ingest` + MQTT sensor (API-8 REFUTED) nhưng vô hình trong OpenAPI/ApiDocs (AIR-8); metrics jsonb tự do không schema/limits/curve (API-4); contract v1.0 drift ~10 trường và schemaVersion không enforce (API-2); envelope request 3 kiểu (API-5); đơn vị chỉ chuẩn chiều dài dù bảng units_of_measure + unit_conversions ĐÃ tồn tại chưa seed (API-6 phần đúng); canonical 6 schema đã viết, mode=log ĐÃ chạy trên syn/ nhưng chưa quarantine và avi/ ngoài contract (API-3 phần đúng); alarm taxonomy ON nhưng trống mã screw/glue/weld (API-7 phần đúng); docs chỉ phủ AOI (API-11).

**Thiết kế đích.**
1. **Endpoint RESULT mới (P0, ROI cao nhất — AIR-2):**
   - tRPC `machineApi.submitProcessResult` (+ `submitProcessResultBatch` theo mẫu submitInspectionBatch: auth-once, per-item isolation) và REST `POST /api/v1/ingest/process-result` — auth `authenticateMachine` scope `ingest:write`, rate-limit tier machine-ingest sẵn, wrap `recordProcessResult` (service + genealogy hash-chain tự có).
   - Bộ durability tái dùng NGUYÊN pattern submitInspection: idempotency ledger bảng mới `process_idempotency_keys` (mirror inspection_idempotency_keys — tách bảng để không đụng ràng buộc unique trên hypertable process_results), WAL store-forward (`PROCESS_STORE_FORWARD_ENABLED`, tái dùng khung inspectionStoreForward), provenance `server_received_at timestamptz` + `time_source`.
   - **Bắt buộc ts kèm offset ngay từ v1** (fleet mới, không nợ fake-UTC — API-10): reject naive time.
2. **Spec "ST4I Standard Process Feed v1"** — doc mới `docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md` theo đúng khuôn kỷ luật doc 28 (spec_version, additive-only, reject-unsupported, rawExtras, conformance fixtures):
   ```
   { schemaVersion:"1.0", machineCode|x-api-key, serialNumber, stepType,  // từ danh mục process_step_types
     result: pass|fail|warn|skip, ts(ISO, bắt buộc offset),
     recipe?: {code, version, checksum},
     metrics?: [{name, value, unit?, lsl?, usl?, nominal?}],
     waveforms?: [{name, unit, rateHz?, samples:[[t,v],...]}]   // cap kích thước (~64KB), lưu cột jsonb riêng
     idempotencyKey? }
   ```
   Đăng ký vào machineDataContract registry entry `process-result@1.0` + OpenAPI path + AsyncAPI channel; validate opt-in qua machineContractRouter.validate cho đội firmware tự test.
3. **TELEMETRY**: chuẩn hóa `/api/ot/ingest` (CanonicalSample[]) làm đường chính (đã LIVE) + alias versioned `POST /api/v1/ingest/telemetry` (cùng handler) đưa vào OpenAPI + ApiDocs với ví dụ ESP32 (temperature/humidity) và máy vít (torque) — AIR-8, API-11. MQTT: subscriber mới topic syn/ telemetry → parse theo telemetry.schema.json → telemetryBus (đóng gap RTM-2, gate `MQTT_TELEMETRY_BRIDGE_ENABLED`).
4. **EVENT**: máy mới publish syn/ theo event.schema.json; alarm: seed `master_alarms`/`alarm_taxonomy` cho 3 họ máy nội bộ (TORQUE_OUT_OF_SPEC, SCREW_FLOAT, GLUE_CLOG, GLUE_PRESSURE_LOW, WELD_TEMP_HIGH...) — quy định firmware nội bộ dùng `nativeCode = standardCode` để bỏ tầng map (API-7); mapAlarm → andon đã LIVE (EQ_INTEG=true).
5. **Envelope thống nhất**: endpoint MỚI dùng response envelope `{ok,data,error}` + ApiHttpError (envelope.ts); request có schemaVersion; MQTT dùng nguyên canonical schemas (API-5). Giữ backward tuyệt đối cho submitInspection.
6. **Sửa drift contract inspection (API-2)**: sinh machineDataContract v1.1 TRỰC TIẾP từ submitInspectionCoreObject (một nguồn sự thật), thêm field `schemaVersion` optional log-only vào submitInspection, contract-test CI so contract↔zod.
7. **Unit registry đa dimension (API-6)**: ADD VALUE dimension `torque/pressure/flow/current/frequency` vào enum units; SEED units_of_measure (Nm, kgf·cm, mL, mg, kPa, °C, A...) + unit_conversions (bảng + CRUD đã có từ mig 0123 — chỉ seed + nối consumer); validate unit tại ingest process-result: fleet mới reject unit lạ không kèm conversion.
8. **stepType vocabulary**: bảng `process_step_types` data-driven (code unique, nameVi, machineType?, active) seed screw_tightening/glue_dispense/weld_spot/leak_test/functional_test... (TAX-12); zod ingest check tồn tại (mode log→enforce).
9. **Validate theo device type (API-9)**: submitProcessResult resolve deviceTypeKey của máy → validate metrics theo attributesSchema (mode log trước) — device_types thành nơi DUY NHẤT khai "máy loại X gửi trường gì".

**Cờ + migration.** Cờ mới: `PROCESS_RESULT_INGEST_ENABLED` (endpoint), `PROCESS_STORE_FORWARD_ENABLED`, `MQTT_TELEMETRY_BRIDGE_ENABLED`, `PROCESS_ATTR_VALIDATE_MODE=off|log|enforce`. Cờ sẵn: CONTRACT_VALIDATE_INGEST_MODE log→quarantine cho syn/ fleet mới (QĐ6), CONTRACT_REGISTRY_PERSIST_ENABLED=true. Migration: `0287_process_feed_hardening.sql` (process_results ADD COLUMN IF NOT EXISTS server_received_at/time_source/idempotency_key/waveforms — nullable; CREATE TABLE IF NOT EXISTS process_idempotency_keys), `0288_process_step_spec.sql` (process_step_types + seed), `0292_units_dimensions_seed.sql` (ADD VALUE + seed ON CONFLICT DO NOTHING), `0293_alarm_seed_automation.sql` (kiểu 0231). Rollback: DROP TABLE bảng mới, cột nullable không đọc khi cờ OFF.

**File chạm:** server/routers/machineApiRouters.ts (+submitProcessResult), server/api/v1/router.ts + openapi.ts + envelope.ts, server/services/processResultService.ts, server/services/inspection/ (nhân khung store-forward), server/contracts/machineDataContract.ts, server/services/mqttService.ts (bridge), drizzle/schema/process.ts + masterdata.ts, docs/ECOSYSTEM/57_*.md, client/src/pages/ApiDocs.tsx.

---

## 4. TRỤC 3 — TIÊU CHUẨN HÓA CÀI ĐẶT & ĐỒNG BỘ (hạng mục 3): config-sync generic

**Hiện trạng.** Chuỗi version/delta/tombstone/MQTT-notify chất lượng cao nhưng hard-wired vào measurement points AOI — automation/IoT không có đường pull config nào (CONFIG-SYNC-1); drift recipe = 0, heartbeat không nhận reported-state, ST4I strip program_version (CONFIG-SYNC-2); deploy chỉ flip catalog+ledger, máy vật lý không nhận gì — chặn bởi thiếu gateway/HW chứ không phải cờ control (CONFIG-SYNC-4 phần đúng); IoT chỉ có sendConfigureCommand bắn-1-lần retain=false, không desired/reported (CONFIG-SYNC-6); notify phụ thuộc MQTT_ENABLED + namespace avi/ hardcode (CONFIG-SYNC-9).

**Thiết kế đích.**
1. **Nhóm endpoint machine-facing generic** (gate `CONFIG_SYNC_GENERIC_ENABLED`), key theo (machine, configKind), nhại đúng pattern points-sync:
   - `machineApi.checkConfigVersion {configKind}` → `{code, version, checksum, updatedAt}` (mirror checkPointsVersion) — đọc active `machine_recipes` (resolve thứ tự: recipe per-machineId → recipe per-machineType);
   - `machineApi.getActiveConfig {configKind}` → payload đầy đủ + checksum;
   - `machineApi.ackConfigApplied {configKind, code, version, checksum, status: applied|failed, error?}` → ghi reported vào shadow;
   - REST proxy `/api/machine/config-sync/{check|get|ack}` theo mẫu `/api/machine/*` sẵn có. Auth: authenticateMachine (mk_).
   - `configKind` vocabulary: `recipe` (automation) · `device_settings` (IoT — TÁI DÙNG machine_recipes làm catalog versioned+approve cho cả config IoT, vì bảng đã hỗ trợ machineType-level) · `points` (alias đường AOI hiện hữu, giữ nguyên byte) · `model` (edge AI — đã có đường riêng).
2. **Bảng shadow `machine_config_state`** (mig `0289`): (machineId FK, configKind, desiredRecipeId FK, desiredVersion, desiredChecksum, notifiedAt, reportedCode, reportedVersion, reportedChecksum, reportedAt, driftState in_sync|drift|unknown, updatedAt; UNIQUE(machineId, configKind)) — trả lời CONFIG-SYNC-6 (device shadow) cho cả 3 nhóm.
3. **Deploy flow nối liền**: recipes.deploy (sẵn, SoD 2FA) → cập nhật desired trong shadow → MQTT notify **retained** per-device `syn/v1/machine/{machineCode}/config/{configKind}` chỉ chứa {code, version, checksum} (con trỏ version — payload luôn pull qua HTTP để không lộ secret trên broker; retain=true nên thiết bị offline reconnect là thấy — khắc phục retain=false hiện tại) + poll backstop qua checkConfigVersion; máy PLC đi đường commandDispatcher select_recipe sau FAT, wire `recipe_deployments.commandLogId` (cột chờ sẵn).
4. **Drift 2 chiều (CONFIG-SYNC-2)**, gate `CONFIG_DRIFT_REPORT_ENABLED`: heartbeat thêm field optional `running:[{configKind, code, version, checksum}]` (additive zod — máy cũ không đổi byte) → server so desired/catalog → set driftState + alert qua routeAlert; ST4I feed thôi strip program_version, so với recipe active của máy; sweep drift tái dùng khung configDriftService (hash chuẩn, alert 1-lần-per-episode).
5. **Points-sync AOI giữ nguyên** như configKind đặc thù; các cờ hardening doc 55 (variant/optimistic-lock/snapshot) bật theo lịch riêng đã duyệt (CONFIG-SYNC-8).
6. **Staged rollout** (CONFIG-SYNC-7, đợt sau): nhấc FleetRolloutStrategy (canary→verify→promote đã test cho DPC) thành tầng chung cho recipe deploy + points bump; gate promote bằng cửa sổ fail-rate ngắn.

**Cờ + migration.** Cờ mới: `CONFIG_SYNC_GENERIC_ENABLED`, `CONFIG_DRIFT_REPORT_ENABLED` (OFF). Cờ vận hành: MQTT_ENABLED vào checklist nhà máy, MQTT_TOPIC_DUAL_PUBLISH khi cần song song avi/↔syn/. Migration: `0289_machine_config_state.sql` (CREATE TABLE IF NOT EXISTS; rollback DROP TABLE).

**File chạm:** server/routers/machineApiRouters.ts (+3 procedure + heartbeat additive), server/_core/index.ts (REST proxy), server/services/mqttService.ts (notify retained syn/), server/routers/machineRecipeRouter.ts (deploy → shadow), server/services/lineController/recipeSetService.ts (verify đọc reported), server/services/vision/adapters/st4iStandard.ts (program_version), drizzle/schema/ (bảng mới).

---

## 5. TRỤC 4 — TIÊU CHUẨN HÓA QUẢN LÝ CẤU HÌNH (hạng mục 4): governance

**Hiện trạng.** machine_recipes.payload là jsonb tự do — approve 2 người đang ký trên blob không kiểm chứng được (CONFIG-SYNC-3); parameter_guardrails có khung generic + đang ON nhưng bảng 0 ROW trong DB live và recipe payload đi vòng không bị check (CONFIG-SYNC-5 phần đúng, AILOCAL-7); không có spec limits per stepType nên server không gate được pass/fail và Threshold Advisor không có nền (API-4, AILOCAL-5); enforcement capability tier-2 OFF (TAX-5 phần đúng — riêng /v1 commands ĐÃ chặn theo capability); 2–3 sổ đồng bộ tách rời không có timeline hợp nhất (CONFIG-SYNC-10).

**Thiết kế đích.**
1. **Typed recipe schema per machineType** (`RECIPE_TYPED_SCHEMA_MODE=off|log|enforce`): `server/services/recipes/recipeSchemas.ts` — zod discriminated union `screw_program {steps[{order, torqueTarget, tolerance, angle}]}` / `dispense_program {path, volumeTarget, speed, pressure}` / `weld_profile {current, tipTemp, time}` / `iot_settings {sampleIntervalSec, thresholds...}`; validate tại recipes.create + approve; diff UI nâng từ diff-text lên diff per-step (đợt sau).
2. **Spec limits first-class**: bảng `process_spec_limits` (mig 0288): (machineType?, productModelId?, stepType, metricKey, unit, lsl, usl, nominal, active, createdBy/approvedBy...; thứ tự resolve: product-specific > machineType default). Consumer: (a) spec-gate server tại submitProcessResult (`PROCESS_SPEC_GATE_ENABLED` — server tự đánh giá pass/fail per metric như spec-gate inspection); (b) SPC/CPK nguồn 2 (Trục 6); (c) Threshold Advisor (Trục 7).
3. **Guardrail có răng**: bước BẮT BUỘC trong wizard onboarding nhập dải min/max/maxStep cho mọi writable tag (seed parameter_guardrails — hiện 0 row); `recipes.approve` chạy checkAgainstGuardrail map các key trong typed payload → paramKey (bịt đường vòng CONFIG-SYNC-5); bật `PARAM_GUARDRAIL_STRICT=true` cho machineType nguy hiểm (WELDER/SCREWDRIVE — không dải = từ chối) + `PARAM_VERIFY_ENABLED` (closed-loop degraded→Andon) trước khi nối máy automation thật.
4. **Capability enforcement cho máy MỚI**: bật `CAPABILITIES_VALIDATION_ENFORCED` (tier-2) đối với máy tạo mới sau cờ, giữ warn cho máy cũ (REG-7); stamp deviceTypeVersion lúc approve.
5. **Config timeline hợp nhất per máy** (CONFIG-SYNC-10): tRPC `machineConfigTimeline` UNION 3 sổ (product_sync_logs, recipe_deployments+recipe_load_log, program_deployments) chuẩn hóa `{machineId, configKind, code, version, actor, at, source}` → tab "Cấu hình" trong MachineCockpit (kèm desired/reported + badge drift). Không bảng mới.
6. **Golden config**: dùng nguyên isGolden (recipe) + goldenSampleReferences pattern.

**Cờ + migration.** Cờ mới: `RECIPE_TYPED_SCHEMA_MODE`, `PROCESS_SPEC_GATE_ENABLED` (OFF). Cờ sẵn bật theo lộ trình: PARAM_GUARDRAIL_STRICT, PARAM_VERIFY_ENABLED, CAPABILITIES_VALIDATION_ENFORCED. Migration: process_spec_limits nằm trong `0288` (CREATE TABLE IF NOT EXISTS; rollback DROP).

**File chạm:** server/services/recipes/recipeSchemas.ts (mới), server/routers/machineRecipeRouter.ts (validate+guardrail hook), server/services/ai/parameterGuardrailService.ts (map key), server/routers/ (machineConfigTimeline), client MachineCockpit.tsx (tab Cấu hình), client wizard (bước guardrail).

---

## 6. TRỤC 5 — CONSOLE QUẢN LÝ HỢP NHẤT (hạng mục 5)

**Hiện trạng.** Hub/cockpit/wizard cho AOI rất mạnh nhưng: leak apiKey plaintext qua listPaged trên trang Đăng ký máy (MGMTUI-3); hành trình onboard phân mảnh 6+ entry, wizard generic khóa cứng bước Deploy AI model (MGMTUI-2); client thiếu 4 type SMT + không có IoT (MGMTUI-1 phần đúng); kết quả process 0 UI chuyên dụng (MGMTUI-4 phần đúng — chỉ có genealogy hit); IoT không có trang quản lý, monitor drop sample machineId null (MGMTUI-6 phần đúng); RBAC dồn admin (MGMTUI-8); trùng lặp mapping legacy (MGMTUI-9).

**Thiết kế đích.**
1. **Vá P0 (W0)**: server strip apiKey getMachinesPaged; UI cột API key → trạng thái "đã cấp/chưa cấp" + hành động "Xoay key" show-once (đồng nhất MachinesTab đã đúng).
2. **Wizard hợp nhất "Thêm thiết bị"** (`DEVICE_ONBOARD_WIZARD_V2_ENABLED`, route `/device-onboarding`): bước 1 chọn deviceClass/machineType (từ machine.listTypes) → rẽ nhánh:
   - aoi_avi: giữ nguyên các bước AoiOnboardingWizard (deploy model chỉ ở nhánh này — gỡ hard-block cho nhánh khác);
   - automation: thông tin máy → chọn giao thức (HTTP push | PLC adapter (DeviceOnboardingWizard OT nhúng) | MQTT) → recipe khởi tạo (typed) → **bước bắt buộc seed guardrail** → credential show-once (mk_ + QR) → sign-off;
   - iot: chọn kênh (HTTP /api/ot/ingest | MQTT) → khai metric schema (tham chiếu deviceType attributes) → station ảo tự gán → credential show-once (+ option cert QĐ4) → sign-off.
   Tái dùng nguyên khung draft-resumable server-side + show-once + commissioning sign-off của AoiOnboardingWizard; 2 wizard cũ giữ nguyên route, nav trỏ về 1 mục "Thêm thiết bị" (TAB_REDIRECTS pattern doc 47).
3. **DeviceHub/UnifiedDeviceMonitor**: filter theo deviceClass; thêm nguồn 'iot'; sửa drop `machineId==null` → cache keyed deviceId + khu "Thiết bị chưa map" từ ot_telemetry.deviceId có machineId null (RTM-1) — gate IOT_DEVICE_CLASS_ENABLED.
4. **MachineCockpit** thêm 2 tab theo machineType: "Kết quả process" (bảng + trend metric, Trục 6) và "Cấu hình" (timeline + desired/reported/drift, Trục 4).
5. **Enrollment tokens UI** trong Factory Config hub (Trục 1); ConnectivityHub hiện link mqtt_client ↔ machine.
6. **RBAC**: approve/listPending chuyển adminProcedure → requirePermission (module machine_registration) để engineer duyệt được; giữ regenerateApiKey admin-only (MGMTUI-8); client gate bằng usePermissions + nút khóa kèm lý do.
7. **Đợt sau**: refactor 6 trang cũ sang DataTable/EmptyState/FilterBar, tách 2 monolith, gộp mapping legacy về 1 nơi (MGMTUI-7/9).

**Cờ + migration.** Cờ mới: `DEVICE_ONBOARD_WIZARD_V2_ENABLED` (route ẩn khi OFF). Không migration (trừ các bảng đã khai ở trục khác). RBAC đổi procedure là thay đổi hành vi server → đi cùng cờ wizard hoặc tách cờ `MACHINE_APPROVE_RBAC_OPEN_ENABLED` (khuyến nghị tách để bật độc lập).

**File chạm:** client/src/pages/DeviceOnboardingHubV2 (mới, tái dùng components/aoiOnboarding), MachineRegistration.tsx, DeviceHub/UnifiedDeviceMonitor.tsx, MachineCockpit.tsx, lib/navigation.tsx, server/routers/hierarchyRouters.ts (RBAC), i18n.

---

## 7. TRỤC 6 — DASHBOARD PHÂN TÍCH THEO DEVICE TYPE (hạng mục 6)

**Hiện trạng.** process_results 0 surface dashboard chuyên dụng (dashboard-analytics-1 phần đúng — chỉ AI card pull-based); mart/BI/KPI hoàn toàn inspection-centric, không dataset process (D-2 phần đúng); SPC/CPK neo cứng measurementPointDefId (D-3); OEE đếm sản lượng chỉ từ product_inspections + OEE_SNAPSHOT/REPORTING_MART còn OFF ở prod (D-4, D-5); IoT chỉ có trend per-machine, không dashboard môi trường (D-6); không rules engine cảnh báo ngưỡng theo deviceType (RTM-3 phần đúng); báo cáo đẩy 100% inspection (D-12, AILOCAL-4 phần đúng).

**Thiết kế đích.**
1. **ProcessAnalytics** (`PROCESS_ANALYTICS_ENABLED`): expose 2 helper sẵn `aggregateProcessResultStats` + `getProcessMetricSeries` qua processResultRouter (query RBAC user) → trang `ProcessAnalytics.tsx` (per-machine/per-stepType: stacked pass/fail/warn, metric series band mean±2σ — nhân bản SensorTrendTab, template UI theo EnergyAnalyticsPage) + tab "Kết quả process" trong MachineCockpit + khối process trong Traceability theo serial (listBySerial sẵn).
2. **Mart process** (`PROCESS_MART_ENABLED`): bảng `fact_process_hourly` (mig 0291: bucketHour timestamptz, machineId, machineType, stepType, pass/fail/warn/skip count, metricAggregates jsonb, shiftCode; UNIQUE(bucketHour, machineId, stepType)) refresh trong reportingMartService (nhân pattern idempotent-upsert + shift classifier); dataset `process_daily` + `sensor_daily` vào /api/bi + /api/export.
3. **KPI qua metricRegistry — cửa DUY NHẤT khai KPI mới** (D-10): YAML `contracts/metrics/screw_defect_rate.yaml`, `glue_volume_avg.yaml`, `weld_dpmo.yaml`... + handler `processResult.*`/`sensor.*` trong IMPLEMENTATIONS; dashboard/BI/report đều gọi computeMetric.
4. **SPC/CPK nguồn 2** (`SPC_PROCESS_SOURCE_ENABLED`): spcCalculation + cpkSnapshotScheduler nhận nguồn process_results.metrics theo process_spec_limits (identity + USL/LSL đã có ở Trục 4) — tái dùng nguyên math Cp/Cpk/Nelson (D-3).
5. **OEE automation** (`OEE_PROCESS_SOURCE_ENABLED`): oeeSnapshotScheduler đếm sản lượng COALESCE(product_inspections, process_results) theo machineType; IOT_* bị loại nhờ capabilities.countsTowardOee=false; vận hành: bật OEE_SNAPSHOT_ENABLED + REPORTING_MART_ENABLED prod + idealCycleTime per product-machine (mig 0285 sẵn) (D-4/D-5).
6. **EnvironmentDashboard IoT** (`ENV_DASHBOARD_ENABLED`): tổng hợp machine_sensor_readings + ot_telemetry theo workshop/khu — heatmap nhiệt/ẩm + overlay multi-machine; aggregate endpoint mới trên sensorRouter (multi-machine readSeries) (D-6).
7. **Alert ngưỡng theo deviceType** (`DEVICE_ALERT_TEMPLATE_ENABLED`): mở rộng interlock_rules thêm cột `machine_type` nullable (mig 0294) — rule template áp mọi máy cùng type (torque ngoài dải, áp keo tụt, nhiệt hàn lệch, nhiệt-ẩm vượt ngưỡng); action 'alert' nối routeAlert/escalation ladder (không chỉ Andon); kích hoạt INTERLOCK_ENGINE_ENABLED alert-only làm nền (RTM-3). Không xây engine mới — deriveObserved/evaluateCondition pure sẵn.
8. **Báo cáo đẩy**: reportScheduler content builder + prompt aiExecutiveReport thêm section "Công đoạn automation" (top máy fail, CPK tuần) + "Môi trường" (min/max nhiệt-ẩm, vi phạm ngưỡng) (D-12).
9. **Track vận hành**: cài TimescaleDB + re-apply 0172/0271, bật SPC_CENTRAL_ALERT_ENABLED, tách SIM_OT_TELEMETRY khỏi .env chính trước khi máy thật vào (RTM-10, D-7).

**Cờ + migration.** Cờ mới: `PROCESS_ANALYTICS_ENABLED`, `PROCESS_MART_ENABLED`, `SPC_PROCESS_SOURCE_ENABLED`, `OEE_PROCESS_SOURCE_ENABLED`, `ENV_DASHBOARD_ENABLED`, `DEVICE_ALERT_TEMPLATE_ENABLED` (đều OFF). Migration: `0291_fact_process_hourly.sql`, `0294_interlock_machine_type_scope.sql` (ADD COLUMN nullable). Rollback: DROP TABLE / DROP COLUMN.

**File chạm:** server/routers/processResultRouter.ts, server/services/reportingMartService.ts, server/api/export/{biRouter,exportRouter}.ts, contracts/metrics/*, server/services/{spcCalculation,cpkSnapshotScheduler,oeeSnapshotScheduler}.ts, server/services/interlock/*, server/routers/sensorRouter.ts, client ProcessAnalytics.tsx + EnvironmentDashboard.tsx (mới), reportScheduler/aiExecutiveReport.

---

## 8. TRỤC 7 — AI LOCAL PHỦ 3 PERSONA (hạng mục 7)

**Hiện trạng.** Stack model + khung tool HITL đã trưởng thành và ON (AILOCAL-1); nhưng KB 0 tri thức bắt vít/keo/hàn/IoT, autosync tắt (AILOCAL-2); RCA evidence AOI-bound — automation ra evidence rỗng (AILOCAL-3); báo cáo đẩy không có section process (AILOCAL-4 phần đúng); Threshold/Setup Advisor thiếu nền process spec (AILOCAL-5); IoT vô hình với mọi tool (AILOCAL-6); parameter_guardrails 0 row + STRICT/VERIFY tắt trong khi OT_CONTROL live (AILOCAL-7); worker thiếu cầu SOP↔AI (AILOCAL-9).

**Thiết kế đích.** KHÔNG xây AI mới — 5 việc trên nền sẵn:
1. **Content KB theo machine-type** (QĐ7): gói tri thức bắt buộc khi onboard mỗi loại máy — `knowledge/domain/screw-*.md, glue-*.md, weld-*.md, iot-*.md` (how-to VN cho công nhân/kỹ thuật, theo mẫu aoi-*.md) + corpus vendor controller vào `knowledge/programming/<vendor>/` (contract chunks/embeddings/manifest mở — zero code) + golden-code mẫu; bật `KB_AUTOSYNC_ENABLED` (cron 03:00 sẵn).
2. **Generalize 5 service persona** (`AI_PROCESS_PERSONA_ENABLED`):
   - aiRcaCopilot.gatherEvidence + 2 nguồn fail-safe: pareto stepType-fail từ aggregateProcessResultStats + alarm/telemetry gần nhất (getLatestTelemetry + lookup_error_code — tool sẵn); system prompt template theo machineType; bật RCA_QUANTITATIVE_ENABLED;
   - aiExecutiveReport + aiTodayBriefing: section automation/môi trường (helper sẵn F6 đã dùng);
   - aiThresholdAdvisor: nguồn 2 đọc process_spec_limits + process metrics (math thuần thống kê tái dùng);
   - aiSetupAdvisor: RELATED_TYPES thêm họ automation (SCREWDRIVE/DISPENSING/WELDER), bundle theo machineType (recipe + guardrail thay vì points/model);
   - aiAutoProposer: trigger metric-drift EWMA (aiTimeSeriesEngine sẵn) → proposeAction create_maintenance_workorder / propose_interlock_rule (2 write-tool đã đăng ký).
3. **IoT hưởng nguyên tầng tool** nhờ QĐ1 (machines row): ~50 tool machine-anchored tự phủ; thêm 1 read-tool `list_iot_devices` (health/last-seen/firmware) + trigger vi "thiết bị iot", "cảm biến" (`AI_IOT_TOOLS_ENABLED`).
4. **An toàn ghi trước khi nối máy thật**: seed parameter_guardrails qua wizard (Trục 4) + PARAM_GUARDRAIL_STRICT cho WELDER/SCREWDRIVE + PARAM_VERIFY_ENABLED — khung propose→RBAC→confirm→interlock→commission→audit giữ nguyên.
5. **Persona công nhân**: nút "Hỏi AI về bước này" trong SopViewer truyền context route+SOP-step vào KbQueryContext (cơ chế C3a sẵn); generateNarrative fast-tier viết lại alert automation thành 1 câu vi dễ hiểu (pattern aiIssueClassifier); SOP máy automation viết xong ingest thẳng KB. Voice→Andon 1-tap đã LIVE dùng chung.
6. **Ops**: bật `LLAMA_SERVER_ENABLED` (deep model out-of-process — binary sẵn) theo runbook scripts/ai/llama-server.md.

**Cờ + migration.** Cờ mới: `AI_PROCESS_PERSONA_ENABLED`, `AI_IOT_TOOLS_ENABLED` (OFF; khi thực thi có thể tách nhỏ hơn per-service). Cờ sẵn bật: KB_AUTOSYNC_ENABLED, RCA_QUANTITATIVE_ENABLED, PARAM_GUARDRAIL_STRICT, PARAM_VERIFY_ENABLED, LLAMA_SERVER_ENABLED. Không migration (dùng bảng Trục 4).

**File chạm:** server/services/{aiRcaCopilot,aiExecutiveReport,aiTodayBriefing,aiThresholdAdvisor,aiSetupAdvisor,aiAutoProposer}.ts, server/services/aiLocalTools/ (+list_iot_devices), knowledge/, client SopViewer.tsx.

---

## 9. CHỨNG MINH "ONBOARD KHÔNG SỬA CODE LÕI" (tiêu chí nghiệm thu)

**Kịch bản A — máy bắt vít HTTP JSON** (sau W1+W2, không sửa code):
1. Admin mint enrollment token (UI Trục 1) machineType=SCREWDRIVE, serialPattern `SCRW-*`, scope ingest:write — hoặc kỹ thuật viên đi wizard nhánh automation.
2. Máy gọi `machine.enroll {token, serial}` → tự-approve → nhận mk_ (hoặc claim show-once).
3. Firmware POST `/api/v1/ingest/process-result` mỗi chu trình vít (Feed v1: serial, stepType=screw_tightening, result, metrics torque/angle + lsl/usl, waveform cap) + POST `/api/ot/ingest` heartbeat/telemetry.
4. Kỹ sư tạo `machine_recipes` screw_program (typed, guardrail-checked) → approve SoD → deploy → máy nhận notify retained / poll `checkConfigVersion` → `ackConfigApplied` → shadow in_sync; đổi tay tại HMI ⇒ drift alert.
5. Dashboard/AI tự có nhờ machineType: ProcessAnalytics, mart, CPK torque, alert template SCREWDRIVE, RCA/exec-report đọc process, ChatBubble trả lời từ KB screw-*.
→ Mọi bước là DATA (enum + profile + spec limits + recipe nhập UI).

**Kịch bản B — ESP32 nhiệt-ẩm** (sau W2, không sửa code):
1. Wizard nhánh IoT: đăng ký IOT_SENSOR → station ảo `IOT-<ws>` tự gán → approve → mk_ show-once (hoặc enrollment token cho fleet).
2. Firmware POST `/api/v1/ingest/telemetry` batch `[{metric:'temperature'},{metric:'humidity'}]`/30s — hoặc MQTT syn/ + password per-device.
3. Presence tự có (recency sweep); hiện trong DeviceHub filter iot; EnvironmentDashboard heatmap; alert template IOT_SENSOR (ngưỡng nhiệt-ẩm); AI list_iot_devices/get_ot_telemetry_latest trả lời được.

---

## 10. LỘ TRÌNH THỰC THI 6 ĐỢT (mỗi đợt green-gate: tsc 8GB + test + LIVE proof)

| Đợt | Nội dung | Migration | LIVE proof |
|---|---|---|---|
| **W0 — vá nền** | 4 vá bảo mật đi thẳng (strip listPaged apiKey; verify apiKey ở machine:confirm_mapping; SMTP env-name; UI hiển thị claimToken đã trả về) + Trục 0 taxonomy (enum, client sync, profiles, seed device_types, i18n) | 0286 | dropdown 24 type, tsc, listPaged không còn apiKey |
| **W1 — RESULT ingest** | submitProcessResult + REST /v1 + batch + idempotency + WAL + spec doc 57 + contract v1.1 + OpenAPI/ApiDocs + units seed + alarm seed + step types | 0287, 0288, 0292, 0293 | curl mk_ ghi process_results, retry idempotent, sim emitter SCREWDRIVE trong sim-factory |
| **W2 — đăng ký hợp nhất** | Enrollment UI + claim show-once + MACHINE_CRED_MK_ONLY + wizard V2 + IoT identity (station ảo, mqtt link) + monitor unmapped + SDK mẫu + RBAC approve | 0290 | onboard kịch bản B bằng sensor-generator; enroll batch 3 máy sim |
| **W3 — config-sync generic** | 3 endpoint config + shadow + notify retained syn/ + drift heartbeat + typed recipe + guardrail seed flow + timeline hợp nhất | 0289 | deploy recipe → máy sim pull → ack → giả drift → alert |
| **W4 — dashboard** | ProcessAnalytics + mart + BI dataset + metric YAML + SPC/OEE nguồn process + EnvironmentDashboard + alert template + report sections | 0291, 0294 | trang process có số thật từ sim; OEE máy sim automation; heatmap |
| **W5 — AI** | KB content 3 họ máy + generalize 5 persona + list_iot_devices + STRICT/VERIFY + llama-server | — | RCA máy vít sim ra evidence; exec report có section automation; chat trả lời SOP keo |

**Track vận hành song song (không code, checklist):** runbook 52 rotation→read-only→deny (QĐ3); bật OT_GATEWAY + FAT driver với sim rồi PLC thật (AIR-1/AIR-11); cài TimescaleDB + bật REPORTING_MART/OEE_SNAPSHOT/SPC_CENTRAL_ALERT prod; tách SIM_OT_TELEMETRY về .env.sim trước máy thật; điền SMTP/FCM credential + smoke andon đỏ; MQTT_ENABLED + ADMISSION_ENFORCE theo ngưỡng thiết bị; quyết SSE tắt hay chuẩn hóa (P3, không chặn).

---

## 11. BẢNG TỔNG HỢP CỜ MỚI & MIGRATION

**Cờ MỚI (tất cả default-OFF, OFF = byte-identical):** DEVICE_CLASS_UI_ENABLED · MACHINE_CRED_MK_ONLY_ENABLED · IOT_DEVICE_CLASS_ENABLED · MACHINE_KEY_EXPIRY_ALERT_ENABLED · PROCESS_RESULT_INGEST_ENABLED · PROCESS_STORE_FORWARD_ENABLED · PROCESS_ATTR_VALIDATE_MODE · MQTT_TELEMETRY_BRIDGE_ENABLED · CONFIG_SYNC_GENERIC_ENABLED · CONFIG_DRIFT_REPORT_ENABLED · RECIPE_TYPED_SCHEMA_MODE · PROCESS_SPEC_GATE_ENABLED · DEVICE_ONBOARD_WIZARD_V2_ENABLED · MACHINE_APPROVE_RBAC_OPEN_ENABLED · PROCESS_ANALYTICS_ENABLED · PROCESS_MART_ENABLED · SPC_PROCESS_SOURCE_ENABLED · OEE_PROCESS_SOURCE_ENABLED · ENV_DASHBOARD_ENABLED · DEVICE_ALERT_TEMPLATE_ENABLED · AI_PROCESS_PERSONA_ENABLED · AI_IOT_TOOLS_ENABLED.

**Cờ SẴN CÓ bật theo lộ trình (không phải code mới):** ENROLLMENT_ENABLED, MQTT_ADMISSION_ENFORCE, MQTT_MTLS_ENABLED, MACHINE_CODE_ONLY_ALLOWED (siết), MACHINE_KEY_DEFAULT_TTL_DAYS, CONTRACT_VALIDATE_INGEST_MODE=quarantine (syn/ fleet mới), CONTRACT_REGISTRY_PERSIST_ENABLED, INTERLOCK_ENGINE_ENABLED, CAPABILITIES_VALIDATION_ENFORCED, PARAM_GUARDRAIL_STRICT, PARAM_VERIFY_ENABLED, KB_AUTOSYNC_ENABLED, RCA_QUANTITATIVE_ENABLED, LLAMA_SERVER_ENABLED, OEE_SNAPSHOT_ENABLED, REPORTING_MART_ENABLED, SPC_CENTRAL_ALERT_ENABLED, OT_GATEWAY_ENABLED, MQTT_TOPIC_DUAL_PUBLISH, FIELD_V2_ENABLED (tùy chọn).

**Migration (đều guarded, rollback ghi trong file):**
| # | Nội dung | Guard | Rollback |
|---|---|---|---|
| 0286 | ADD VALUE WELDER/IOT_SENSOR/IOT_GATEWAY (+robot 'weld'); machines.device_type_key NULL | ADD VALUE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS | DROP COLUMN; enum value giữ (vô hại) |
| 0287 | process_results +server_received_at/time_source/idempotency_key/waveforms (nullable); CREATE process_idempotency_keys | IF NOT EXISTS | DROP TABLE/COLUMN |
| 0288 | CREATE process_step_types (+seed) + process_spec_limits | IF NOT EXISTS + ON CONFLICT DO NOTHING | DROP TABLE |
| 0289 | CREATE machine_config_state (UNIQUE machineId+configKind) | IF NOT EXISTS | DROP TABLE |
| 0290 | mqtt_clients.machine_id NULL FK SET NULL | IF NOT EXISTS | DROP COLUMN |
| 0291 | CREATE fact_process_hourly | IF NOT EXISTS | DROP TABLE |
| 0292 | ADD VALUE dimension torque/pressure/flow/current/frequency + seed units_of_measure/unit_conversions | IF NOT EXISTS + ON CONFLICT | seed xóa được; enum giữ |
| 0293 | Seed alarm_taxonomy/master_alarms 3 họ máy (kiểu 0231) | ON CONFLICT DO NOTHING | DELETE theo vendor key |
| 0294 | interlock_rules.machine_type NULL | IF NOT EXISTS | DROP COLUMN |

---

## 12. RỦI RO CHÍNH & GIẢM THIỂU
1. **Enum ADD VALUE không rollback** — chấp nhận (additive, tiền lệ 0241/0242); tên value chốt trước khi merge.
2. **Hypertable process_results** — không thêm unique index trực tiếp (Timescale tương lai đòi partition key); dùng bảng ledger process_idempotency_keys riêng (đúng pattern inspection).
3. **Siết weak-auth làm đứt máy AOI chưa rotate** — theo runbook 52 có report + read-only trung gian + cửa sổ bảo trì (QĐ3).
4. **Spec Feed v1 sửa breaking sau khi client đông** — pilot hẹp ratify trước (QĐ5) + kỷ luật additive-only + conformance fixtures + endpoint validate cho firmware tự test (QĐ6).
5. **SIM đang che presence/dashboard** — bắt buộc tách SIM_OT_TELEMETRY trước khi nối máy thật (RTM-10, track vận hành W2).
6. **Guardrail 0 row + OT_CONTROL live** — wizard bắt buộc seed dải + STRICT cho máy nguy hiểm TRƯỚC khi FAT điều khiển (Trục 4/7).
7. **tsc OOM** — giữ heap 8GB theo memory doc 54; mỗi đợt commit nhỏ có OFF-proof.


---

## 4. PHẦN C — KẾ HOẠCH THỰC THI THEO ĐỢT (đọc kèm 7 điều chỉnh bắt buộc ở Phần D — Đ0 việc 2 và Đ2 có thay đổi)

# KẾ HOẠCH THỰC THI DOC 56 — CHUẨN HÓA KẾT NỐI THIẾT BỊ (8 đợt Đ0–Đ7)

Hiện thực hóa blueprint doc 56 (7 trục) trên nền audit đã kiểm chứng. Mọi đợt tuân quy ước repo: **cờ default-OFF (OFF = byte-identical)**, không rewrite (nhấc pattern sẵn có), migration guarded + rollback ghi trong file, green-gate mỗi đợt = `tsc` (NODE_OPTIONS=--max-old-space-size=8192) + test nhắm đích + bằng chứng LIVE + OFF-proof.

**Điều chỉnh so với blueprint (phát hiện khi đọc disk):**
1. **Đánh số migration dồn +1**: `drizzle/0286_product_variant.sql` ĐÃ tồn tại (doc 55). Dải mới **0287–0295** (nội dung giữ nguyên bảng §11 blueprint; số cuối cùng chốt theo thứ tự merge thực tế):

| Blueprint | Số mới (dự kiến) | Nội dung | Đợt |
|---|---|---|---|
| 0286 | **0287** | ADD VALUE WELDER/IOT_SENSOR/IOT_GATEWAY (+robot 'weld') + machines.device_type_key NULL | Đ0 |
| 0287 | **0288** | process_results +server_received_at/time_source/idempotency_key/waveforms; CREATE process_idempotency_keys | Đ1 |
| 0288 | **0289** | CREATE process_step_types (+seed) + process_spec_limits | Đ1 |
| 0292 | **0290** | ADD VALUE dimension torque/pressure/flow/current/frequency + seed units_of_measure/unit_conversions | Đ1 |
| 0293 | **0291** | Seed alarm_taxonomy/master_alarms 3 họ máy (kiểu 0231) | Đ1 |
| 0290 | **0292** | mqtt_clients.machine_id NULL FK ON DELETE SET NULL | Đ2 |
| 0289 | **0293** | CREATE machine_config_state (UNIQUE machineId+configKind) | Đ4 |
| 0291 | **0294** | CREATE fact_process_hourly | Đ5 |
| 0294 | **0295** | interlock_rules.machine_type NULL | Đ5 |
| — | 0296 (tùy chọn) | mqtt_topic_templates.deviceType → deviceTypeKey (TAX-8, hoãn được) | Đ7 |

2. **Chèn Đợt 3 = PILOT NỘI BỘ** tách riêng ngay sau nền đăng ký + ingest (blueprint W0→W5 ánh xạ: Đ0=W0, Đ1=W1, Đ2=W2, **Đ3=Pilot (mới)**, Đ4=W3+Trục 4, Đ5=W4, Đ6=W5, **Đ7=hardening+tài liệu (mới)**).

**Quy ước ước lượng:** S ≈ ≤0,5 ngày-agent · M ≈ 1–2 ngày · L ≈ 3–5 ngày. Mỗi đợt = 1 chuỗi commit nhỏ tuần tự (KHÔNG chạy 2 đợt song song trên cùng file — bài học doc 24), đều có OFF-proof.

**Bảng tổng quan:**

| Đợt | Tên | Migration | Deliverable nhìn thấy được |
|---|---|---|---|
| Đ0 | Vá nền bảo mật + taxonomy device-class | 0287 | Dropdown 24 loại máy; trang Đăng ký máy hết lộ apiKey; dialog claim-token show-once |
| Đ1 | Chuẩn RESULT ingest + spec Feed v1 | 0288–0291 | ApiDocs section mới; curl mk_ ghi kết quả; AI chat card hiển thị process của máy sim |
| Đ2 | Đăng ký & kết nối hợp nhất | 0292 | Wizard "Thêm thiết bị" V2; tab Mã gia nhập; thiết bị IoT hiện trong DeviceHub |
| Đ3 | **PILOT NỘI BỘ** (1 máy vít + 1 ESP32, sim→thật) | — | Demo end-to-end + trang ProcessAnalytics v1 |
| Đ4 | Config-sync generic + governance cấu hình | 0293 | Deploy recipe → máy nhận → ack; tab "Cấu hình" + badge drift |
| Đ5 | Dashboard phân tích theo device type | 0294, 0295 | ProcessAnalytics đầy đủ, EnvironmentDashboard heatmap, OEE máy vít |
| Đ6 | AI local phủ 3 persona | — | RCA máy vít ra evidence; exec report có section automation; chat trả lời SOP keo |
| Đ7 | Hardening + tài liệu tích hợp + nhân rộng | (0296 tùy chọn) | Doc onboard "không sửa code"; máy DISPENSING onboard thuần data |

---

## Đợt 0 — Vá nền bảo mật + Taxonomy device-class (Trục 0 + 4 vá P0)

**Mục tiêu:** đóng 4 lỗ bảo mật đi thẳng (tiền lệ doc 54 P0-1/P0-2) + nền taxonomy 24 machineType/deviceClass để mọi đợt sau tham chiếu.

**Đầu việc:**
1. Strip `apiKey` khỏi `getMachinesPaged` + UI cột API key → trạng thái "đã cấp/chưa cấp" + hành động Xoay key show-once (MGMTUI-3/REG-1) — `server/db/hierarchy.ts:360`, `server/routers/hierarchyRouters.ts:1188`, `client/src/pages/MachineRegistration.tsx:876` — **S**
2. Verify `apiKey` tại socket `machine:confirm_mapping` trước setOnline/broadcast, đồng nhất với `sync_started` (RTM-6) — `server/_core/socket.ts:330` — **S**
3. Sửa lệch tên biến SMTP: `emailService` đọc cả `SMTP_PASSWORD` lẫn `SMTP_PASS` (RTM-5, phần code; điền credential là việc con người) — `server/services/emailService.ts` — **S**
4. Dialog show-once **claimToken** ngay sau approve (approve ĐÃ trả về nhưng UI vứt) + nút "Cấp lại claim token" (backend `issueClaimToken` sẵn) theo pattern `Step4Credential` (REG-3) — `client/src/pages/MachineRegistration.tsx` — **M**
5. Migration **0287**: `ADD VALUE IF NOT EXISTS 'WELDER'|'IOT_SENSOR'|'IOT_GATEWAY'` + `'weld'` vào robotJobTypeEnum + `machines.device_type_key varchar(64) NULL` — `drizzle/schema/enums.ts`, `drizzle/schema/hierarchy.ts`, `drizzle/0287` — **S**
6. `DEVICE_CLASS_BY_TYPE` một nơi ở server + tRPC `machine.listTypes` trả {type, deviceClass, labelKey}; refactor 4 dropdown client (Step1MachineInfo, MachinesTab, FactorySetupWizard, MQTTReplay) dùng query; **xóa fork** `IMPORT_MACHINE_TYPES` (TAX-1/TAX-3/MGMTUI-1) — `server/constants/machineTypes.ts`, `server/routers/hierarchyRouters.ts`, `client/src/constants/machineTypes.ts` + 4 file, `client/src/components/factoryConfig/factoryConfigIO.ts` — **M**
7. Capability profiles mới qua `registerCapabilityProfile` (không sửa core): WELDER (weld_current/tip_temp/weld_time), IOT_SENSOR (telemetry-only, `countsTowardOee=false`), IOT_GATEWAY — `server/services/equipment/capabilityModel.ts` — **S**
8. Seed `device_types` đủ 24 leaf vào DB (script `scripts/seed-device-types.mjs` idempotent theo uq_devtype_key_version, origin='seed'; EQ_GOVERN đã ON live nên ghi được) + sửa `seed-engineering-data.mjs` adapterKind 'aoi'→'vision' + khai `attributesSchema` + required cho leaf automation (torque_target/tolerance; volume_target/viscosity; weld profile — TAX-4/TAX-11) + stamp `machines.device_type_key` lúc approve + backfill máy cũ qua `resolveDeviceTypeForMachineType` — `scripts/seed-*`, `server/services/standards/deviceTypeRegistry.ts`, `server/routers/hierarchyRouters.ts` — **M**
9. i18n nhãn machineType_* cho 4 SMT + 3 type mới × 3 ngôn ngữ — `client/src/i18n/locales/*` — **S**

**Migration:** 0287 (guarded ADD VALUE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS; rollback: DROP COLUMN device_type_key; enum value giữ nguyên — ghi chú vô hại trong file).

**Cờ:** `DEVICE_CLASS_UI_ENABLED` (OFF — chỉ gate phần grouping UI theo class; enum/seed là additive không cần cờ; 4 vá bảo mật đi thẳng theo tiền lệ doc 54).

**GREEN-GATE:** tsc 8GB pass · mở rộng `server/routers/machineListPaged.test.ts` (assert items không chứa apiKey) + test mới verify apiKey ở confirm_mapping (mô phỏng socket client) + test `machine.listTypes` trả 24 type/deviceClass · LIVE: (a) gọi listPaged bằng user thường → JSON không có chuỗi `apiKey`; (b) script socket giả confirm_mapping sai key → bị từ chối, không sinh machine_status_logs; (c) Playwright dropdown đủ 24 loại + tạo máy WELDER/IOT_SENSOR thành công, DB row có device_type_key sau approve; (d) OFF-proof DEVICE_CLASS_UI_ENABLED.

**Rủi ro chính:** enum ADD VALUE không rollback (chấp nhận, chốt tên trước merge — tiền lệ 0241/0242); refactor 4 dropdown chạm 4 trang → Playwright regression.

---

## Đợt 1 — Chuẩn dữ liệu RESULT + spec "ST4I Standard Process Feed v1" (Trục 2 lõi)

**Mục tiêu:** máy automation ghi được kết quả per-serial bằng mk_ với đầy đủ bộ durability của submitInspection; spec + docs công bố; đường TELEMETRY hiện có được versioned + tài liệu hóa.

**Đầu việc:**
1. tRPC `machineApi.submitProcessResult` + `submitProcessResultBatch` (theo mẫu submitInspectionBatch: auth-once, per-item isolation, rate-charge per item) wrap `recordProcessResult` (genealogy hash-chain tự có), auth `authenticateMachine` scope `ingest:write`, rate tier machine-ingest sẵn (CONN-1/API-1/AIR-2) — `server/routers/machineApiRouters.ts`, `server/services/processResultService.ts` — **L**
2. REST `POST /api/v1/ingest/process-result` + alias `POST /api/v1/ingest/telemetry` (cùng handler `/api/ot/ingest` sẵn LIVE) với envelope `{ok,data,error}` + ApiHttpError; đăng ký OpenAPI + AsyncAPI (API-5/AIR-8) — `server/api/v1/router.ts`, `openapi.ts`, `envelope.ts`, `server/services/contracts/apiSpec.ts` — **M**
3. Durability: migration **0288** (cột nullable `server_received_at`/`time_source`/`idempotency_key`/`waveforms` + bảng ledger riêng `process_idempotency_keys` — KHÔNG unique trên hypertable) + WAL `processStoreForward` nhân khung `inspectionStoreForward.ts` (+test sẵn làm mẫu); **bắt buộc ts kèm offset từ v1, reject naive time** (API-10, chờ QĐ6) — `drizzle/0288`, `server/services/process/processStoreForward.ts` (mới) — **L**
4. Spec **doc 57** `docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md` theo khuôn kỷ luật doc 28 (spec_version, additive-only, reject-unsupported, rawExtras, conformance fixtures) + đăng ký `machineDataContract` entry `process-result@1.0` + endpoint `machineContractRouter.validate` cho firmware tự test (chờ QĐ5 ratify ở pilot) — `docs/ECOSYSTEM/57`, `server/contracts/machineDataContract.ts` — **M**
5. Sửa drift contract inspection: sinh v1.1 TRỰC TIẾP từ `submitInspectionCoreObject`, thêm `schemaVersion` optional log-only vào submitInspection, contract-test CI so contract↔zod (API-2) — `server/contracts/machineDataContract.ts`, `server/routers/machineApiRouters.ts`, `.github/workflows/` — **M**
6. Migration **0289**: bảng `process_step_types` data-driven + seed (screw_tightening/glue_dispense/weld_spot/leak_test/functional_test…) + bảng `process_spec_limits` (machineType?/productModelId?/stepType/metricKey/unit/lsl/usl/nominal — consumer nối ở Đ4/Đ5); zod ingest check stepType tồn tại mode log→enforce (TAX-12/API-4) — `drizzle/0289`, `drizzle/schema/process.ts`, `masterdata.ts` — **M**
7. Migration **0290**: ADD VALUE dimension torque/pressure/flow/current/frequency + seed `units_of_measure`/`unit_conversions` (bảng + CRUD sẵn từ 0123, chỉ seed); validate unit tại ingest mới — fleet mới reject unit lạ không kèm conversion (API-6, chờ QĐ6) — `drizzle/0290` — **M**
8. Migration **0291**: seed `alarm_taxonomy`/`master_alarms` 3 họ máy (TORQUE_OUT_OF_SPEC, SCREW_FLOAT, GLUE_CLOG, GLUE_PRESSURE_LOW, WELD_TEMP_HIGH…) — quy định firmware nội bộ `nativeCode = standardCode`; mapAlarm→andon đã LIVE EQ_INTEG (API-7) — `drizzle/0291` — **S**
9. Validate metrics theo `deviceTypeKey → attributesSchema` mode log (`PROCESS_ATTR_VALIDATE_MODE=off|log|enforce`) (API-9) — `server/routers/machineApiRouters.ts` — **M**
10. ApiDocs: section "Automation Process Feed" + "IoT Telemetry" với ví dụ ESP32 (temperature/humidity) và máy vít (torque) (API-11/AIR-8) — `client/src/pages/ApiDocs.tsx` + `components/apiDocs/` — **M**
11. Sim emitter SCREWDRIVE process-result trong sim-factory đi **đúng đường ingest thật** (mk_ + REST, không ghi thẳng DB) — làm đạo cụ cho green-gate + Đ3 — `scripts/sim-factory/` — **M**

**Migration:** 0288, 0289, 0290, 0291 (đều IF NOT EXISTS / ON CONFLICT DO NOTHING; rollback: DROP TABLE bảng mới, cột nullable không đọc khi cờ OFF, seed xóa theo key, enum dimension giữ).

**Cờ:** `PROCESS_RESULT_INGEST_ENABLED`, `PROCESS_STORE_FORWARD_ENABLED`, `PROCESS_ATTR_VALIDATE_MODE` (đều OFF). Cờ sẵn liên quan: `CONTRACT_VALIDATE_INGEST_MODE` giữ log (quarantine dời Đ7 theo QĐ6).

**GREEN-GATE:** tsc 8GB · test mới `server/routers/machineApiProcessResult.test.ts` (submit 200 bằng mk_; retry cùng idempotencyKey không nhân đôi; batch per-item isolation; reject ts naive; unit lạ; stepType lạ log) theo mẫu `machineApiIdempotency.test.ts`/`machineApiBatchIngest.test.ts` + contract-test CI + conformance fixtures qua `machineContractRouter.validate` · LIVE: (a) curl mk_ POST process-result 2 lần cùng idempotencyKey → đếm SQL đúng 1 row; (b) emitter sim SCREWDRIVE chạy 10 phút liên tục; (c) AI chat card `get_machine_process_result` (tool F6 sẵn) hiển thị số máy sim; (d) `/openapi.json` có path mới; (e) OFF-proof: cờ tắt → PRECONDITION_FAILED, các đường cũ byte-identical.

**Rủi ro chính:** machineApiRouters.ts là monolith ~4.3k dòng — Đ1 và Đ4 cùng chạm → tuần tự hóa tuyệt đối; hypertable process_results không nhận unique trực tiếp (đã né bằng ledger riêng — đúng pattern inspection).

---

## Đợt 2 — Đăng ký & kết nối hợp nhất (Trục 1 + phần UI Trục 5)

**Mục tiêu:** MỘT luồng "Thêm thiết bị" 3 kênh trên cùng lifecycle; IoT có identity first-class; credential chuẩn mk_-only cho fleet mới; SDK mẫu.

**Đầu việc:**
1. UI tab **"Mã gia nhập thiết bị"** trong Factory Config hub: mint show-once + QR, list, revoke; chọn machineType/scopes/serialPattern/maxUses/TTL (backend `issueEnrollmentToken/list/revoke` sẵn tại hierarchyRouters:1028–1157) (REG-2) — `client/src/components/factoryConfig/EnrollmentTokensTab.tsx` (mới), `DataSettings.tsx` — **M**
2. **MACHINE_CRED_MK_ONLY_ENABLED**: approve máy deviceClass automation/iot không ghi `machines.apiKey` plaintext; `redeemMachineClaimToken` mint mk_ qua `machineAuthService.issueMachineKey`; `authenticateMachine` policy theo deviceClass — deviceClass ≠ aoi_avi ⇒ bắt buộc mk_ (REG-1/CONN-2, chờ QĐ3) — `server/routers/hierarchyRouters.ts`, `server/db/hierarchy.ts`, `server/services/machineAuthService.ts` — **M**
3. TTL + cảnh báo hết hạn: `MACHINE_KEY_DEFAULT_TTL_DAYS=180` cho khóa mới + cron tuần `listExpiringMachineKeys(14)` → action inbox (`MACHINE_KEY_EXPIRY_ALERT_ENABLED`) (REG-9) — `server/_core/backgroundJobs.ts` — **S**
4. **IoT identity** (chờ QĐ1): migration **0292** `mqtt_clients.machine_id NULL FK`; station ảo `IOT-<workshopCode>` tạo tự động per-workshop (KHÔNG nới stationId nullable); lifecycle hook retire → revoke passwordHash MQTT + chặn tự hồi sinh PENDING (REG-4/REG-8); gate `IOT_DEVICE_CLASS_ENABLED` — `drizzle/schema/mqtt.ts`, `drizzle/0292`, `server/services/mqttService.ts`, `server/db/hierarchy.ts` — **M**
5. **Wizard hợp nhất "Thêm thiết bị" V2** (`DEVICE_ONBOARD_WIZARD_V2_ENABLED`, route `/device-onboarding`): bước 1 chọn deviceClass/machineType (machine.listTypes Đ0) → nhánh aoi_avi giữ nguyên AoiOnboardingWizard (deploy model CHỈ ở nhánh này — gỡ hard-block Step4DeployModel cho nhánh khác); nhánh automation: máy → giao thức (HTTP push | PLC adapter nhúng DeviceOnboardingWizard OT | MQTT) → recipe khởi tạo → **bước bắt buộc seed guardrail** → mk_ show-once + QR → sign-off; nhánh iot: kênh (HTTP | MQTT) → metric schema từ deviceType → station ảo → mk_ show-once (+option cert, chờ QĐ4) → sign-off. Tái dùng khung draft-resumable + show-once + sign-off của aoiOnboarding; nav 2 wizard cũ trỏ về 1 mục (TAB_REDIRECTS doc 47) (MGMTUI-2/REG-6) — `client/src/pages/DeviceOnboardingHubV2.tsx` (mới) + `components/aoiOnboarding/*`, `lib/navigation.tsx` — **L**
6. DeviceHub/UnifiedDeviceMonitor: filter theo deviceClass + nguồn 'iot' + sửa drop `machineId==null` → cache keyed deviceId + khu **"Thiết bị chưa map"** từ ot_telemetry.deviceId có machineId null (MGMTUI-6/RTM-1) — `client/src/pages/UnifiedDeviceMonitor.tsx:211`, `DeviceHub.tsx` — **M**
7. RBAC: approve/listPending chuyển adminProcedure → `requirePermission` module machine_registration, cờ riêng `MACHINE_APPROVE_RBAC_OPEN_ENABLED`; kèm seed permission matrix + backfill grant per-user nếu cần (tiền lệ mig 0269 doc 47 — checkPermission đọc per-USER); giữ regenerateApiKey admin-only; client gate usePermissions + nút khóa kèm lý do (MGMTUI-8) — `server/routers/hierarchyRouters.ts`, client — **M**
8. **SDK/firmware mẫu** `examples/device-client/`: Python + Arduino C++ minh họa enroll(met_)/claim(mct_) → mk_ → ingest (idempotencyKey + retry + local queue) → heartbeat; link từ ApiDocs; zero code server (REG-11/CONN-6 phần device-side) — `examples/device-client/` (mới) — **M**
9. MQTT fleet mới: bắt buộc per-device password (hash-at-rest sẵn); subscriber **`MQTT_TELEMETRY_BRIDGE_ENABLED`**: topic syn/ telemetry → parse theo `telemetry.schema.json` → telemetryBus (đóng RTM-2, chờ QĐ2); enroll option "cấp cert" trả privateKeyPem 1 lần, `deviceCertificates.deviceId = machine URN (chờ QĐ4)` — `server/services/mqttService.ts` — **M**

**Migration:** 0292 (ADD COLUMN IF NOT EXISTS machine_id NULL FK SET NULL; rollback DROP COLUMN) + (nếu cần) migration grant RBAC nhỏ theo tiền lệ 0269.

**Cờ:** `MACHINE_CRED_MK_ONLY_ENABLED`, `IOT_DEVICE_CLASS_ENABLED`, `MACHINE_KEY_EXPIRY_ALERT_ENABLED`, `DEVICE_ONBOARD_WIZARD_V2_ENABLED`, `MACHINE_APPROVE_RBAC_OPEN_ENABLED`, `MQTT_TELEMETRY_BRIDGE_ENABLED` (đều OFF). Cờ sẵn bật staging: `ENROLLMENT_ENABLED`.

**GREEN-GATE:** tsc 8GB · mở rộng `server/routers/machineEnroll.test.ts` (enroll → mint mk_; deviceClass iot bị chặn machineCode-only khi MK_ONLY bật) + `machineClaimKey.test.ts` (redeem mint mk_ khi cờ ON, giữ hành vi cũ khi OFF) + test mới mqttTelemetryBridge + test permission theo mẫu `permissions.*.test.ts` · LIVE: (a) mint met_ token qua UI (show-once + QR) rồi script enroll batch **3 máy sim** một lượt → tự approve → mk_; (b) sensor-generator ESP32 onboard qua wizard nhánh iot → hiện DeviceHub filter iot, khu "chưa map" hiển thị deviceId lạ; (c) retire máy iot → MQTT connect fail (password revoked); (d) engineer duyệt được máy khi cờ RBAC ON; (e) OFF-proof toàn bộ cờ.

**Rủi ro chính:** đổi ngữ nghĩa redeem claim (trả mk_ thay machines.apiKey) — backward giữ nguyên khi cờ OFF, test 2 nhánh; RBAC mở rộng sai grant → engineer tự duyệt máy tự tạo (giữ SoD: người tạo ≠ người duyệt, đã có trong lifecycle); wizard V2 là khối UI lớn — tách commit theo nhánh.

---

## Đợt 3 — PILOT NỘI BỘ: 1 máy bắt vít HTTP JSON + 1 ESP32 nhiệt-ẩm (sim trước → thiết bị thật) (chờ QĐ5)

**Mục tiêu:** ratify chuẩn end-to-end trên đúng 2 kịch bản nghiệm thu §9 blueprint: **đăng ký → gửi dữ liệu → hiện realtime → vào dashboard → AI trả lời được câu hỏi về máy đó**. Chạy THẬT qua simulator (đường ingest thật, không ghi tắt DB) trước, thiết bị thật sau (chờ QĐ8). Deliverable dashboard: ProcessAnalytics v1.

**Đầu việc:**
1. **Pilot A (sim)** — máy vít `SCRW-SIM-01`: client mô phỏng firmware chuẩn (chạy từ `examples/device-client` chế độ sim hoặc `scripts/sim`): enroll bằng met_ token → nhận mk_ → mỗi chu trình POST `/api/v1/ingest/process-result` (Feed v1: serial, stepType=screw_tightening, result, metrics torque/angle + lsl/usl, waveform cap) + POST `/api/v1/ingest/telemetry` heartbeat/torque — `scripts/sim/` hoặc `examples/device-client/` — **M**
2. **Pilot B (sim)** — ESP32 nhiệt-ẩm: chỉnh `scripts/sim/sensor-generator.mjs` (sẵn có) gửi qua `/api/v1/ingest/telemetry` bằng mk_ của device IOT_SENSOR đã enroll (station ảo tự gán) — **S**
3. **ProcessAnalytics v1** (`PROCESS_ANALYTICS_ENABLED`): expose 2 helper sẵn `aggregateProcessResultStats` + `getProcessMetricSeries` qua `processResultRouter` (query RBAC user) → trang `ProcessAnalytics.tsx` (per-machine/per-stepType: stacked pass/fail/warn, metric series band mean±2σ nhân bản SensorTrendTab, template EnergyAnalyticsPage) + tab "Kết quả process" trong MachineCockpit (dashboard-analytics-1/MGMTUI-4) — `server/routers/processResultRouter.ts`, `client/src/pages/ProcessAnalytics.tsx` (mới), `MachineCockpit.tsx` — **L**
4. **Đo end-to-end + báo cáo pilot**: checklist 5 chặng cho cả A và B — (i) enroll/approve + credential show-once; (ii) dữ liệu vào process_results/ot_telemetry; (iii) presence ONLINE qua recency sweep + UnifiedDeviceMonitor sparkline; (iv) ProcessAnalytics/SensorTrend hiển thị; (v) **AI trả lời bằng tool SẴN CÓ** (`get_machine_process_result`, `get_process_metric_trend`, `get_ot_telemetry_latest` — F6 đã LIVE, không chờ Đ6); kill-test: tắt API 2 phút → SDK retry + idempotency → không mất/không trùng (đếm SQL); đo latency ingest→socket + throughput (pattern bench doc 53) — **M**
5. **Chuyển thiết bị thật** (việc phối hợp con người, chờ QĐ8): đội cơ điện flash ESP32 thật + controller máy vít thật dùng SDK mẫu; firmware tự test qua `machineContractRouter.validate` + conformance fixtures doc 57 trước khi nối; lặp checklist (4) — **M** (phần agent: hỗ trợ debug + xác nhận số liệu)
6. Vệ sinh môi trường pilot: tách `SIM_OT_TELEMETRY_ENABLED` về `.env.sim` (RTM-10) + giới hạn emitter theo danh sách machineId sim để presence honest trước khi thiết bị thật vào — `.env`/`.env.sim`, `server/services/simOtTelemetryService.ts` — **S** (kèm mục vận hành)

**Migration:** không.

**Cờ:** `PROCESS_ANALYTICS_ENABLED` (OFF→bật staging trong đợt). Bật prod phạm vi pilot các cờ Đ1–Đ2 (`PROCESS_RESULT_INGEST`, `IOT_DEVICE_CLASS`, `ENROLLMENT`, `MACHINE_CRED_MK_ONLY`…) theo nhịp QĐ9.

**GREEN-GATE:** tsc 8GB · test mới cho 2 query processResultRouter (aggregate/series RBAC) · **LIVE (bằng chứng trung tâm của toàn dự án):** log/video chuỗi 5 chặng cho cả 2 thiết bị sim; kill-test 0-mất-0-trùng; AI chat trả lời "máy SCRW-SIM-01 hôm nay pass/fail bao nhiêu, torque trend?" và "nhiệt độ khu vực cảm biến ESP32?"; báo cáo pilot (latency/throughput). Cổng "thiết bị thật" nghiệm thu theo QĐ8 (không chặn Đ4).

**Rủi ro chính:** SIM che presence thật (RTM-10 — bắt buộc việc 6 trước khi nối thiết bị thật); firmware thật trễ tiến độ (tách 2 cổng theo QĐ8, sim-gate đi trước); spec Feed v1 lộ khiếm khuyết khi ratify — sửa NGAY tại pilot khi client còn hẹp (đúng mục đích QĐ5).

---

## Đợt 4 — Config-sync generic + Governance cấu hình (Trục 3 + Trục 4)

**Mục tiêu:** máy pull config versioned theo (machine, configKind) + shadow desired/reported + drift 2 chiều; recipe typed + spec limits + guardrail có răng; timeline cấu hình hợp nhất.

**Đầu việc:**
1. 3 endpoint machine-facing (`CONFIG_SYNC_GENERIC_ENABLED`), nhại pattern points-sync: `machineApi.checkConfigVersion {configKind}` (mirror checkPointsVersion, đọc active machine_recipes resolve per-machineId → per-machineType) · `getActiveConfig` (payload + checksum) · `ackConfigApplied` (ghi reported vào shadow) + REST proxy `/api/machine/config-sync/{check|get|ack}`; configKind vocabulary: `recipe` | `device_settings` (tái dùng machine_recipes làm catalog IoT) | `points` (alias đường AOI, giữ nguyên byte) | `model` (đường riêng sẵn) (CONFIG-SYNC-1/6) — `server/routers/machineApiRouters.ts`, `server/_core/index.ts` — **L**
2. Migration **0293**: bảng `machine_config_state` (machineId, configKind, desired*, notifiedAt, reported*, driftState, UNIQUE(machineId, configKind)) — `drizzle/0293` — **S**
3. Deploy flow nối liền: `recipes.deploy` (SoD 2FA sẵn) → cập nhật desired shadow → MQTT notify **retained** `syn/v1/machine/{machineCode}/config/{configKind}` chỉ chứa {code, version, checksum} (payload luôn pull HTTP; retain=true khắc phục bắn-1-lần; chờ QĐ2 namespace) + poll backstop; wire `recipe_deployments.commandLogId` cho đường PLC sau FAT (CONFIG-SYNC-4/9) — `server/routers/machineRecipeRouter.ts`, `server/services/mqttService.ts` — **M**
4. Drift 2 chiều (`CONFIG_DRIFT_REPORT_ENABLED`): heartbeat thêm field optional `running:[{configKind, code, version, checksum}]` (additive zod — máy cũ không đổi byte) → so desired/catalog → driftState + alert qua routeAlert; ST4I feed thôi strip `program_version`, so với recipe active; sweep tái dùng khung configDriftService (CONFIG-SYNC-2) — `server/routers/machineApiRouters.ts` (heartbeat), `server/services/vision/adapters/st4iStandard.ts` — **M**
5. Typed recipe schema per machineType (`RECIPE_TYPED_SCHEMA_MODE=off|log|enforce`): zod discriminated union `screw_program`/`dispense_program`/`weld_profile`/`iot_settings`; validate tại recipes.create + approve (CONFIG-SYNC-3, enforce theo QĐ6) — `server/services/recipes/recipeSchemas.ts` (mới), `server/routers/machineRecipeRouter.ts` — **M**
6. Spec-gate server tại submitProcessResult theo `process_spec_limits` (bảng đã tạo Đ1): `PROCESS_SPEC_GATE_ENABLED` — server tự đánh giá pass/fail per metric như spec-gate inspection (API-4) — `server/services/processResultService.ts` — **M**
7. Guardrail có răng: bước BẮT BUỘC trong wizard (Đ2) nhập dải min/max/maxStep cho mọi writable tag (seed `parameter_guardrails` — DB live đang 0 row); `recipes.approve` chạy `checkAgainstGuardrail` map key trong typed payload → paramKey (bịt đường vòng CONFIG-SYNC-5/AILOCAL-7) — `server/services/ai/parameterGuardrailService.ts`, `machineRecipeRouter.ts`, client wizard — **M**
8. Capability enforcement máy MỚI: bật `CAPABILITIES_VALIDATION_ENFORCED` tier-2 cho máy tạo sau cờ (giữ warn máy cũ) + stamp deviceTypeVersion lúc approve (REG-7/TAX-5) — `server/services/standards/capabilitiesValidation.ts`, `hierarchyRouters.ts` — **S**
9. Config timeline hợp nhất: tRPC `machineConfigTimeline` UNION 3 sổ (product_sync_logs, recipe_deployments+recipe_load_log, program_deployments) chuẩn hóa {machineId, configKind, code, version, actor, at, source} → tab "Cấu hình" MachineCockpit kèm desired/reported + badge drift (CONFIG-SYNC-10) — server router mới + `client/src/pages/MachineCockpit.tsx` — **M**
10. Cập nhật sim pilot A: máy vít sim pull recipe → ack → giả drift (khai version khác trong heartbeat) — `scripts/sim` — **S**

**Migration:** 0293 (CREATE TABLE IF NOT EXISTS; rollback DROP TABLE).

**Cờ:** `CONFIG_SYNC_GENERIC_ENABLED`, `CONFIG_DRIFT_REPORT_ENABLED`, `RECIPE_TYPED_SCHEMA_MODE`, `PROCESS_SPEC_GATE_ENABLED` (đều OFF). Cờ vận hành: `MQTT_ENABLED` vào checklist nhà máy (poll backstop hoạt động khi thiếu), `MQTT_TOPIC_DUAL_PUBLISH` khi cần song song avi/↔syn/.

**GREEN-GATE:** tsc 8GB · test mới `server/routers/machineConfigSync.test.ts` (check/get/ack; resolve per-machine→per-type; shadow transitions; drift detect qua heartbeat) + `server/services/recipes/recipeSchemas.test.ts` + mở rộng `machineRecipeRouter.test.ts` (approve validate + guardrail hook) và `parameterGuardrailRouter.test.ts` · LIVE: (a) tạo recipe screw_program typed qua UI → approve SoD → deploy → máy sim pull thấy version mới + nhận notify retained sau reconnect → ack → `machine_config_state` in_sync (SQL); (b) giả drift → driftState=drift + alert trong AlertCenter; (c) recipe torque ngoài dải guardrail bị approve TỪ CHỐI; (d) tab Cấu hình hiển thị timeline 3 nguồn; (e) OFF-proof: đường points-sync AOI byte-identical.

**Rủi ro chính:** notify phụ thuộc MQTT_ENABLED per-site — poll backstop là bắt buộc trong spec firmware; typed schema enforce sớm chặn recipe cũ — mode log trước, enforce theo QĐ6 ở Đ7; heartbeat additive phải giữ tuyệt đối backward (test máy cũ không gửi field mới).

---

## Đợt 5 — Dashboard phân tích theo device type (Trục 6)

**Mục tiêu:** automation/IoT có mặt trong mart/KPI/SPC/OEE/alert/report; dashboard môi trường IoT.

**Đầu việc:**
1. Mart process (`PROCESS_MART_ENABLED`): migration **0294** bảng `fact_process_hourly` (bucketHour, machineId, machineType, stepType, pass/fail/warn/skip, metricAggregates jsonb, shiftCode; UNIQUE(bucketHour, machineId, stepType)) + refresh trong `reportingMartService` (nhân pattern idempotent-upsert + shift classifier) + dataset `process_daily`/`sensor_daily` vào `/api/bi` + `/api/export` (dashboard-analytics-2) — `drizzle/0294`, `server/services/reportingMartService.ts`, `server/api/export/{biRouter,exportRouter}.ts` — **L**
2. KPI qua metricRegistry — cửa DUY NHẤT khai KPI mới (D-10): YAML `screw_defect_rate.yaml`, `glue_volume_avg.yaml`, `weld_dpmo.yaml` + handler `processResult.*`/`sensor.*` trong IMPLEMENTATIONS — `contracts/metrics/`, `server/services/semantics/metricRegistry.ts` — **M**
3. SPC/CPK nguồn 2 (`SPC_PROCESS_SOURCE_ENABLED`): spcCalculation + cpkSnapshotScheduler nhận nguồn process_results.metrics theo `process_spec_limits` (identity + USL/LSL từ Đ1/Đ4) — tái dùng nguyên math Cp/Cpk/Nelson (dashboard-analytics-3) — `server/services/{spcCalculation,cpkSnapshotScheduler}.ts` — **L**
4. OEE automation (`OEE_PROCESS_SOURCE_ENABLED`): oeeSnapshotScheduler đếm sản lượng COALESCE(product_inspections, process_results) theo machineType; IOT_* loại nhờ `countsTowardOee=false` (dashboard-analytics-4) — `server/services/oeeSnapshotScheduler.ts` — **M**
5. EnvironmentDashboard IoT (`ENV_DASHBOARD_ENABLED`): aggregate endpoint mới trên sensorRouter (multi-machine readSeries) + heatmap nhiệt/ẩm theo workshop/khu + overlay multi-machine (nhân bản SensorTrendTab, template EnergyAnalyticsPage) (dashboard-analytics-6) — `server/routers/sensorRouter.ts`, `client/src/pages/EnvironmentDashboard.tsx` (mới) — **L**
6. Alert template theo deviceType (`DEVICE_ALERT_TEMPLATE_ENABLED`): migration **0295** `interlock_rules.machine_type` nullable — rule template áp mọi máy cùng type (torque ngoài dải, áp keo tụt, nhiệt hàn lệch, nhiệt-ẩm vượt ngưỡng); action 'alert' nối routeAlert/escalation ladder; nền INTERLOCK_ENGINE_ENABLED alert-only (RTM-3 — không xây engine mới, deriveObserved/evaluateCondition pure sẵn) — `drizzle/0295`, `server/services/interlock/*` — **M**
7. Báo cáo đẩy: reportScheduler content builder thêm section "Công đoạn automation" (top máy fail, CPK tuần) + "Môi trường" (min/max nhiệt-ẩm, vi phạm ngưỡng) (D-12; phần prompt AI để Đ6) — `server/services/reportScheduler.ts` — **M**
8. Drill hoàn chỉnh: ProcessAnalytics → machine → serial (listBySerial sẵn) → genealogy; khối process trong Traceability theo serial (dashboard-analytics-8 nhánh automation) — client — **M**

**Migration:** 0294, 0295 (IF NOT EXISTS; rollback DROP TABLE/COLUMN).

**Cờ:** `PROCESS_MART_ENABLED`, `SPC_PROCESS_SOURCE_ENABLED`, `OEE_PROCESS_SOURCE_ENABLED`, `ENV_DASHBOARD_ENABLED`, `DEVICE_ALERT_TEMPLATE_ENABLED` (đều OFF). Phụ thuộc cờ vận hành prod: `REPORTING_MART_ENABLED`, `OEE_SNAPSHOT_ENABLED`, `SPC_CENTRAL_ALERT_ENABLED` (mục Việc con người — không tính vào green-gate code).

**GREEN-GATE:** tsc 8GB · test refresh mart idempotent (chạy 2 lần cùng bucket → không nhân đôi) + test metric YAML compute + test OEE nguồn process + test interlock rule machine_type scope · LIVE: (a) `fact_process_hourly` có row từ pilot sim (SQL); (b) ProcessAnalytics + EnvironmentDashboard render số thật; (c) OEE máy vít sim có A/P/Q trong OEEDashboard; (d) rule template torque ngoài dải bắn alert vào AlertCenter; (e) `/api/bi` dataset process_daily trả dữ liệu + export XLSX font Việt; (f) OFF-proof.

**Rủi ro chính:** mart/OEE "demo đẹp prod trắng" nếu cờ vận hành prod chưa bật (dashboard-analytics-5) — tách rõ checklist go-live; trend dài hạn chạm trần perf khi chưa có Timescale (việc vận hành, không chặn đợt).

---

## Đợt 6 — AI local phủ 3 persona (Trục 7)

**Mục tiêu:** KHÔNG xây AI mới — generalize 5 service persona sang process/telemetry, nạp content KB 3 họ máy + IoT, thêm 1 read-tool IoT.

**Đầu việc:**
1. Content KB theo machine-type (chờ QĐ7 — khung/ingest do agent, NỘI DUNG tiếng Việt do kỹ sư — xem Việc con người): `knowledge/domain/screw-*.md, glue-*.md, weld-*.md, iot-*.md` theo mẫu aoi-*.md + corpus vendor controller vào `knowledge/programming/<vendor>/` (contract chunks/embeddings/manifest mở — zero code) + golden-code mẫu; bật `KB_AUTOSYNC_ENABLED` (cron 03:00 sẵn) (AILOCAL-2) — `knowledge/` — **M**
2. RCA generalize (`AI_PROCESS_PERSONA_ENABLED`): gatherEvidence + 2 nguồn fail-safe — pareto stepType-fail từ `aggregateProcessResultStats` + alarm/telemetry gần nhất (getLatestTelemetry + lookup_error_code — tool sẵn); system prompt template theo machineType; bật `RCA_QUANTITATIVE_ENABLED` (AILOCAL-3) — `server/services/aiRcaCopilot.ts` — **M**
3. Exec report + briefing: section automation/môi trường (helper F6 sẵn dùng) (AILOCAL-4) — `server/services/{aiExecutiveReport,aiTodayBriefing}.ts` — **M**
4. Threshold Advisor nguồn 2 đọc `process_spec_limits` + process metrics (math thống kê tái dùng); Setup Advisor: RELATED_TYPES thêm họ automation (SCREWDRIVE/DISPENSING/WELDER), bundle theo machineType (recipe + guardrail thay vì points/model) (AILOCAL-5) — `server/services/{aiThresholdAdvisor,aiSetupAdvisor}.ts` — **M**
5. AutoProposer: trigger metric-drift EWMA (aiTimeSeriesEngine sẵn) → proposeAction `create_maintenance_workorder`/`propose_interlock_rule` (2 write-tool đã đăng ký, khung HITL giữ nguyên) (AILOCAL-4) — `server/services/aiAutoProposer.ts` — **M**
6. Read-tool `list_iot_devices` (health/last-seen/firmware) + trigger vi "thiết bị iot"/"cảm biến" (`AI_IOT_TOOLS_ENABLED`) — nhờ QĐ1 machines-row, ~50 tool machine-anchored tự phủ IoT (AILOCAL-6) — `server/services/aiLocalTools/` — **S**
7. Persona công nhân: nút "Hỏi AI về bước này" trong SopViewer truyền context route+SOP-step vào KbQueryContext (cơ chế C3a sẵn); generateNarrative fast-tier viết lại alert automation thành 1 câu vi dễ hiểu (pattern aiIssueClassifier) (AILOCAL-9) — `client/src/pages/SopViewer.tsx`, server — **M**

**Migration:** không (dùng bảng Đ1/Đ4).

**Cờ:** `AI_PROCESS_PERSONA_ENABLED`, `AI_IOT_TOOLS_ENABLED` (OFF; khi thực thi có thể tách nhỏ per-service). Cờ sẵn bật: `KB_AUTOSYNC_ENABLED`, `RCA_QUANTITATIVE_ENABLED`; `LLAMA_SERVER_ENABLED` + `PARAM_GUARDRAIL_STRICT`/`PARAM_VERIFY_ENABLED` thuộc mục vận hành (trước khi nối máy automation thật).

**GREEN-GATE:** tsc 8GB · test RCA evidence với fixture process fail-burst (assert ≥2 evidence thay vì rỗng) + test tool list_iot_devices + test RELATED_TYPES setupAdvisor · LIVE: (a) bơm fail-burst máy vít sim → RCA copilot ra ≥2 evidence thật (pareto stepType + alarm) thay vì "cần người xem"; (b) chạy tay exec report → có section automation + môi trường tiếng Việt; (c) chat hỏi "cách xử lý trượt lực siết" → trả lời trích dẫn KB screw-*; (d) `list_iot_devices` liệt kê ESP32 pilot kèm last-seen; (e) OFF-proof: cờ tắt → 5 persona giữ hành vi AOI cũ byte-identical.

**Rủi ro chính:** chất lượng phụ thuộc CONTENT do người viết (QĐ7 — Definition-of-Done từng loại máy); deep-model in-process tranh VRAM — bật LLAMA_SERVER out-of-process theo runbook (vận hành).

---

## Đợt 7 — Hardening + tài liệu tích hợp + nhân rộng (đợt cuối)

**Mục tiêu:** chuẩn "có răng" cho fleet mới theo QĐ6; đóng nợ UI/taxonomy; bộ tài liệu để đội máy nội bộ **onboard máy mới không cần sửa code**; chứng minh nhân rộng bằng loại máy thứ 2.

**Đầu việc:**
1. Siết enforcement fleet mới (chờ QĐ6): `CONTRACT_VALIDATE_INGEST_MODE=quarantine` cho syn/ fleet mới + `CONTRACT_REGISTRY_PERSIST_ENABLED=true`; `PROCESS_ATTR_VALIDATE_MODE=enforce`; `RECIPE_TYPED_SCHEMA_MODE=enforce`; `PARAM_GUARDRAIL_STRICT=true` cho WELDER/SCREWDRIVE + `PARAM_VERIFY_ENABLED` — đo bằng counter sẵn trong response trước khi flip — cờ + theo dõi, code đã xong ở Đ1/Đ4 — **M**
2. Hoàn tất runbook 52 (chờ QĐ3): theo dõi telemetry weak-auth → `MACHINE_CODE_ONLY_ALLOWED=read-only` → `deny` toàn cục trước khi fleet mới vượt ~10 thiết bị (phần rotate máy AOI là việc con người) — **S** (code chỉ giám sát/report)
3. Staged rollout config (CONFIG-SYNC-7, chờ QĐ11): nhấc FleetRolloutStrategy (canary→verify→promote đã test cho DPC) thành tầng chung cho recipe deploy + points bump; gate promote bằng cửa sổ fail-rate ngắn — `server/services/programming/fleetRollout.ts`, recipe/points routers — **L** (có thể hoãn theo QĐ11 nếu fleet còn <10 máy)
4. **Tài liệu tích hợp** `docs/ECOSYSTEM/58_DEVICE_ONBOARDING_GUIDE.md`: hướng dẫn onboard máy mới KHÔNG sửa code (checklist kịch bản A/B §9: mint token → enroll → Feed v1/telemetry → recipe/spec limits/guardrail nhập UI → dashboard/AI tự có), link spec doc 57 + SDK examples/device-client + bảng mã lỗi + conformance validate; cập nhật `ADAPTER_SDK.md` hết stale + deprecate master-key query param trong `EXTERNAL_INSPECTION_API.md` (CONN-5/API-11) — docs + `client/src/pages/ApiDocs.tsx` — **M**
5. Gỡ nợ UI cụm thiết bị (MGMTUI-7/9): 6 trang cốt lõi sang DataTable/EmptyState/FilterBar; tách 2 monolith (MachineRegistration, MqttClientManagement) <400 dòng/file; gộp mapping legacy về 1 nơi + tab device-management thành hub-link (pattern doc 47) — client — **L**
6. Hợp nhất taxonomy thứ ba: `mqtt_topic_templates.deviceType` (avi/aoi/spi/other) → tham chiếu deviceTypeKey, giữ giá trị cũ làm alias (TAX-8, migration 0296 tùy chọn guarded) — `drizzle/schema/mqtt.ts` — **M**
7. **Nghiệm thu nhân rộng:** onboard loại máy thứ 2 (điểm keo DISPENSING) hoàn toàn bằng data/UI theo doc 58 — enum + profile + spec limits + recipe + guardrail đều nhập UI; chứng minh tiêu chí §9 "không sửa code lõi" bằng git log — **M** (chủ yếu thao tác data + xác minh)
8. Bench SLA trên phần cứng thật: chạy lại harness doc 53 + bench-ingest.mjs sau khi Timescale cài (RTM-7) → ratify ngưỡng vào doc 58 — **S** (phần cài Timescale là việc con người)

**Migration:** 0296 (tùy chọn, guarded; rollback DROP COLUMN/alias giữ).

**Cờ:** không cờ mới; flip dần cờ sẵn theo QĐ3/QĐ6/QĐ9 (+ quyết SSE theo QĐ10).

**GREEN-GATE:** tsc 8GB · full test suite (`npm run test:db:setup` trước) + contract-gate CI + `contractsRouter.quarantine.test.ts` · LIVE: (a) publish message sai schema lên syn/ → vào `contract_quarantine` + UI review; (b) firmware chưa conform bị `machineContractRouter.validate` chỉ lỗi cụ thể; (c) máy DISPENSING onboard end-to-end → dashboard/AI tự có, git log chứng minh 0 commit code lõi; (d) recipe ngoài dải STRICT bị từ chối trên máy WELDER/SCREWDRIVE; (e) doc 58 được đội máy nội bộ dùng thật cho 1 lượt onboard.

**Rủi ro chính:** siết enforce làm reject firmware chưa conform — bắt buộc chạy fixtures + validate endpoint trước khi flip; refactor UI rộng — Playwright regression từng trang; staged rollout đụng đường points AOI đang chạy — giữ points là configKind alias byte-identical, canary chỉ áp cho fleet mới trước.

---

## VIỆC CON NGƯỜI / VẬN HÀNH (AI agent KHÔNG tự làm — tách khỏi green-gate code)

**Trước/đi cùng Đ3 (pilot):**
1. Cấp phát phần cứng pilot + firmware thật: đội cơ điện flash ESP32 nhiệt-ẩm + controller máy bắt vít HTTP JSON theo SDK `examples/device-client` + conformance fixtures doc 57 (chờ QĐ8).
2. Tách `SIM_OT_TELEMETRY_ENABLED` khỏi `.env` chính về `.env.sim` (RTM-10) — quyết định demo song song hay tắt hẳn.
3. Bật cờ prod phạm vi pilot theo nhịp QĐ9; `ENROLLMENT_ENABLED` staging→prod với token TTL ngắn.
4. Điền credential SMTP (đúng tên biến sau vá Đ0) + Firebase service-account (FCM) → smoke-test andon đỏ ra người thật (RTM-5; tồn từ doc 54).

**Trước khi nối máy automation thật / máy PLC:**
5. Bật `OT_GATEWAY_ENABLED` + tạo device_adapters row + FAT 1 driver (modbus/mitsubishi-mc) với `scripts/sim` trước, PLC thật sau (AIR-1/AIR-11); cân nhắc pilot edge gateway per-line (AIR-10).
6. Seed dải `parameter_guardrails` cho mọi writable tag của máy thật (qua bước wizard Đ2/Đ4) + bật `PARAM_GUARDRAIL_STRICT` (WELDER/SCREWDRIVE) + `PARAM_VERIFY_ENABLED` TRƯỚC khi FAT điều khiển (AILOCAL-7 — DB live đang 0 row).
7. Chạy runbook 52 theo cửa sổ bảo trì: machine-key-rotation-report → rotate 15 máy AOI sang mk_ → `MACHINE_CODE_ONLY_ALLOWED=read-only` → `deny` (QĐ3).

**Hạ tầng dữ liệu/model (go-live prod):**
8. Cài extension TimescaleDB trên DB chính (`aoi@127.0.0.1:5434/aoi_management`) + re-apply 0172/0271 (idempotent) + chuyển native retention (RTM-7/D-7; memory 2026-07-10: 3 mig Timescale đang fail vì thiếu extension).
9. Bật cờ vận hành prod: `REPORTING_MART_ENABLED`, `OEE_SNAPSHOT_ENABLED` (single worker) + idealCycleTime per product-machine (mig 0285 sẵn), `SPC_CENTRAL_ALERT_ENABLED` (dashboard-analytics-4/5/11).
10. Bật `LLAMA_SERVER_ENABLED` + chạy llama-server.exe out-of-process theo runbook `scripts/ai/llama-server.md`; tải GGUF thinking model hoặc tắt AI_THINKING_TIER (AILOCAL-1).
11. MQTT: đưa `MQTT_ENABLED=true` vào checklist môi trường nhà máy; bật `MQTT_ADMISSION_ENFORCE` khi fleet >10 thiết bị; lộ trình `MQTT_MTLS_ENABLED` permissive→strict cho IOT_GATEWAY/vùng nhạy cảm (QĐ4/AIR-9); `MQTT_TOPIC_DUAL_PUBLISH` giai đoạn chuyển tiếp avi/↔syn/ (QĐ2).
12. Khi scale ≥2 instance: bật đồng bộ `EVENTBUS_REDIS_ENABLED` + `WORKER_LEADER_ELECTION_ENABLED` (RTM-8 — đã có test, chỉ là runbook).

**Nội dung (song hành Đ6, chờ QĐ7):**
13. Kỹ sư thiết bị viết bộ how-to/SOP tiếng Việt + bảng mã lỗi cho screw/glue/weld/IoT (~vài ngày công/loại máy) + thu thập manual vendor controller (PDF) để agent ingest vào KB; đây là Definition-of-Done của mỗi đợt onboard loại máy mới.

---

## 5. RỦI RO CHÍNH

# BẢNG RỦI RO CHÍNH & GIẢM THIỂU

| # | Rủi ro | Mức | Ảnh hưởng | Giảm thiểu |
|---|---|---|---|---|
| R1 | Enum ADD VALUE không rollback được (0287, 0290) | Thấp | Giá trị enum thừa vĩnh viễn nếu đổi ý | Chấp nhận additive (tiền lệ 0241/0242); chốt tên value trước khi merge; ghi chú "vô hại khi không dùng" trong file mig |
| R2 | Hypertable process_results không nhận unique index (Timescale tương lai đòi partition key) | Trung bình | Idempotency vỡ nếu làm sai | Bảng ledger riêng `process_idempotency_keys` (đúng pattern inspection_idempotency_keys) — KHÔNG đụng unique trên bảng chính |
| R3 | Siết weak-auth làm đứt ingest máy AOI chưa rotate | Cao | Mất dữ liệu inspection production | QĐ3 hai tốc độ: fleet mới mk_-only ngay (0 rủi ro vì chưa có máy), AOI cũ theo runbook 52 có report + read-only trung gian + cửa sổ bảo trì; deny toàn cục chỉ sau khi rotation report sạch |
| R4 | Spec Feed v1 phải sửa breaking sau khi client firmware đông | Cao | Chi phí sửa nhân theo số đội tích hợp | QĐ5 pilot hẹp ratify trước (Đ3 sửa spec ngay khi client còn 1-2); kỷ luật additive-only + conformance fixtures + endpoint validate cho firmware tự test (QĐ6) |
| R5 | SIM_OT_TELEMETRY đang bật che presence/dashboard thật — trộn dữ liệu khi thiết bị thật vào | Cao | Pilot mất tính honest, dashboard sai | Việc vận hành bắt buộc TRƯỚC khi nối thiết bị thật (Đ3 việc 6): tách về .env.sim hoặc giới hạn emitter theo machineId sim; kiểm tra meta.source trước nghiệm thu |
| R6 | parameter_guardrails 0 row + OT_CONTROL đã live — lệnh ghi nguy hiểm chỉ còn HITL người | Cao | An toàn máy hàn/vít khi nối thật | Wizard Đ2 có bước BẮT BUỘC seed dải; Đ4 approve-hook chặn recipe ngoài dải; bật STRICT + PARAM_VERIFY trước FAT điều khiển (mục vận hành 6) |
| R7 | tsc OOM trên repo lớn | Trung bình | Green-gate chậm/treo | Giữ NODE_OPTIONS=--max-old-space-size=8192 (memory doc 54); commit nhỏ, mỗi commit có OFF-proof |
| R8 | machineApiRouters.ts monolith (~4.3k dòng) bị Đ1 và Đ4 cùng chạm | Trung bình | Conflict/regression đường AOI đang chạy | Tuần tự hóa tuyệt đối (không 2 đợt song song trên cùng file — bài học doc 24); test regression bộ machineApi*.test.ts đầy đủ trước merge |
| R9 | Firmware/thiết bị thật trễ tiến độ so với kế hoạch | Trung bình | Pilot kéo dài, chặn nhịp | QĐ8 tách 2 cổng: green-gate kỹ thuật bằng sim (đường ingest thật), nghiệm thu nhà máy bằng thiết bị thật chạy song song — không chặn Đ4+ |
| R10 | Site chưa bật MQTT_ENABLED → notify config không tới máy | Trung bình | Convergence chậm | Poll backstop `checkConfigVersion` là BẮT BUỘC trong spec firmware (doc 57); notify retained chỉ là tối ưu; MQTT_ENABLED vào checklist nhà máy |
| R11 | "Cờ bật sau thành nợ" — code xong OFF rồi không ai bật (vết doc 48) | Cao | Chuẩn nằm trên giấy, giá trị production = 0 | QĐ9 nhịp bật cờ per-đợt (staging ngay sau green-gate, prod trong ≤1 tuần, đo counter); mục Việc vận hành liệt kê tường minh từng cờ prod; Đ7 rà lại toàn bộ bảng cờ |
| R12 | RBAC mở approve cho engineer sai grant | Trung bình | Engineer tự tạo + tự duyệt máy | Cờ riêng MACHINE_APPROVE_RBAC_OPEN_ENABLED; giữ SoD người tạo ≠ người duyệt; backfill grant theo tiền lệ mig 0269 + test permissions.*.test.ts; regenerateApiKey giữ admin-only |
| R13 | Dashboard/mart "demo đẹp, prod trắng" (REPORTING_MART/OEE_SNAPSHOT prod còn OFF, Timescale chưa cài) | Trung bình | Quản lý mất niềm tin số liệu | Tách rõ: green-gate code (Đ5) dùng dữ liệu pilot sim qua đường thật; checklist go-live vận hành (mục 8-9) là điều kiện nghiệm thu nhà máy, ghi trong doc 58 |
| R14 | Nội dung KB trễ (phụ thuộc kỹ sư viết — QĐ7) | Trung bình | AI trả lời không căn cứ cho máy mới đúng lúc user hỏi nhiều nhất | QĐ7-A: gói tri thức là Definition-of-Done của onboard loại máy; agent dựng sẵn template/khung + pipeline ingest zero-code từ Đ6 để kỹ sư chỉ điền nội dung |
| R15 | Đổi ngữ nghĩa redeem claim (mint mk_ thay machines.apiKey) phá máy AOI cũ đang dùng claim | Thấp | Máy cũ nhận key bị deny | Chỉ đổi dưới cờ MACHINE_CRED_MK_ONLY_ENABLED theo deviceClass automation/iot; nhánh aoi_avi giữ nguyên byte khi OFF; test 2 nhánh trong machineClaimKey.test.ts |
| R16 | Số migration lệch blueprint (0286 đã bị doc 55 chiếm) gây nhầm lẫn khi đối chiếu tài liệu | Thấp | Áp nhầm/miss migration | Bảng ánh xạ số cũ→mới ngay đầu kế hoạch; số cuối chốt theo thứ tự merge; tên file giữ nguyên semantic (vd `*_device_class_types.sql`) |

---

## 6. PHẦN D — PHẢN BIỆN ĐỘC LẬP (8/10) & ĐIỀU CHỈNH BẮT BUỘC

> Agent phản biện độc lập đối chiếu blueprint + kế hoạch với yêu cầu gốc và repo. 7 gap dưới đây đều được CHẤP NHẬN thành điều chỉnh bắt buộc của kế hoạch (có hiệu lực ghi đè Phần A/C tại chỗ tương ứng).

**Đánh giá tổng thể của phản biện:** Blueprint + kế hoạch thuộc loại tốt hiếm thấy: phủ đủ 7 hạng mục gốc + 3 nhóm thiết bị + 3 persona AI, tôn trọng "máy nội bộ trước" bằng đợt pilot riêng (Đ3) với tiêu chí nghiệm thu "onboard không sửa code lõi" đo được; kiểm chứng trên repo cho thấy gần như toàn bộ viện dẫn là thật và chính xác đến mức file:line (cờ sẵn có, helper, bảng, 4.347 dòng machineApiRouters, 0286 đã bị chiếm → renumber đúng), mỗi đợt đều có green-gate + OFF-proof + rollback, bảng rủi ro thực chất. Tuy nhiên còn 1 mâu thuẫn nội tại nghiêm trọng chưa ai nhìn thấy (socket sync so plaintext machines.apiKey trong khi chính kế hoạch sẽ NULL cột đó ở runbook 52 §3.f — nguy cơ vỡ presence fleet AOI đang chạy), cộng vài lỗi chi tiết kỹ thuật thật (namespace `syn/` không tồn tại — thực tế `synapse/` + ACL chưa phủ topic config mới; 0290 vi phạm gotcha enum-cùng-transaction mà chính 0242 ghi chú; station ảo thiếu line cha NOT NULL; countsTowardOee chưa tồn tại) và thiếu bảng QĐ1-QĐ11 để user duyệt trọn vẹn. Đánh giá: 8/10 — duyệt được sau khi vá gap HIGH về socket-credential và bổ sung bảng QĐ; các gap còn lại sửa trong 1 vòng chỉnh sửa nhỏ, không đổi cấu trúc 8 đợt.

### GAP-1 [HIGH] Mâu thuẫn nội tại: socket sync so plaintext machines.apiKey trong khi lộ trình mk_/rotation sẽ NULL chính cột đó — máy AOI đang chạy sẽ vỡ presence

Bằng chứng repo: server/_core/socket.ts:584-591 (`machine:sync_started`) xác thực bằng `machine.apiKey !== data.apiKey` (so sánh plaintext cột machines.apiKey). Đ0 việc 2 của plan nhân bản đúng cách so sánh này sang `machine:confirm_mapping` (socket.ts:330) và đi THẲNG không cờ. Nhưng runbook 52 §3.f (docs/ECOSYSTEM/52, dòng 255-266) — được chính plan thực thi ở Đ7 việc 2 + Việc con người 7 — chạy `UPDATE machines SET "apiKey" = NULL` với ghi chú 'Sản xuất không đổi'. Sau bước dọn này, mọi máy AOI dùng luồng socket realtime (STEP 5 sync flow trong ApiDocs) bị 'Invalid machine ID or API Key' → presence/mapping/realtime của fleet 15 máy đang chạy vỡ — vi phạm ràng buộc 'máy AOI đang chạy không được vỡ'. Fleet mới mk_-only (Đ2, không có plaintext apiKey) cũng vĩnh viễn không dùng được surface socket. Blueprint Trục 1 và plan không có dòng nào dạy socket path nhận khóa mk_. Thêm nữa: LIVE proof Đ0 chỉ test 'sai key bị từ chối', không chứng minh 15 máy AOI thật vẫn pass (firmware hiện có thể gửi apiKey rỗng vì trường này chưa bao giờ bị kiểm).

**Đề xuất của phản biện:** Đ0 việc 2 đổi cách vá: verify qua machineAuthService.authenticateMachine (nhận cả mk_ header lẫn legacy theo policy) thay vì so sánh plaintext; chạy chế độ log-only đếm mismatch trên fleet thật 1 tuần trước khi enforce; thêm điều-kiện-tiên-quyết vào runbook 52 §3.f: 'socket sync_started/confirm_mapping đã nhận mk_ + 0 mismatch'; test machineClaimKey/socket với máy mk_-only.

**➡ Quyết nghị:** CHẤP NHẬN — SỬA CÁCH LÀM Đ0 việc 2: socket `machine:sync_started`/`machine:confirm_mapping` xác thực qua `machineAuthService.authenticateMachine` (nhận cả `mk_` lẫn legacy theo policy) thay vì so plaintext `machines.apiKey`; chạy log-only đếm mismatch trên fleet thật ≥1 tuần trước khi enforce; THÊM điều-kiện-tiên-quyết vào runbook 52 §3.f: "socket sync đã nhận mk_ + 0 mismatch" mới được `UPDATE machines SET "apiKey" = NULL`; thêm test socket với máy mk_-only. Điều chỉnh này GHI ĐÈ mô tả Đ0 việc 2 trong Phần C.

### GAP-2 [MEDIUM] Namespace MQTT `syn/` trong blueprint không tồn tại — thực tế là `synapse/`, và ACL doc 51 chỉ phủ nhánh private theo deviceId, chưa có đường cho topic config theo machineCode

Blueprint dùng `syn/` xuyên suốt như chuỗi load-bearing sẽ vào spec firmware doc 57: notify retained `syn/v1/machine/{machineCode}/config/{configKind}` (Trục 3), 'subscriber topic syn/ telemetry' (Trục 2), 'CONTRACT_VALIDATE_INGEST_MODE=quarantine cho syn/ fleet mới' (Đ7). Thực tế repo: server/services/mqtt/topicRebrand.ts rebrand `avi/` ↔ `synapse/` (toSynapseTopic/toAviTopic, MQTT_TOPIC_DUAL_PUBLISH chỉ bridge 2 namespace này); mqttService.ts:470-613 ACL đánh giá trên canonical `avi/` với nhánh private per-device `avi/client/{ownDeviceId}/…` — topic scheme thứ ba key theo machineCode (a) không được canonical hóa nên matcher/dual-publish/quarantine không phủ, (b) thiết bị không thể subscribe topic config của mình vì ACL chỉ mở nhánh theo deviceId; việc mở rộng ACL (dùng link mqtt_clients.machine_id của mig 0292) KHÔNG nằm trong file-chạm của Đ4 việc 3 (chỉ ghi mqttService notify retained) và không có test mqttTopicAcl mới.

**Đề xuất của phản biện:** Chốt trong QĐ2: hoặc dùng namespace `synapse/` sẵn có, hoặc thêm alias `syn/` vào topicRebrand + canonicalization; đặt topic config dưới nhánh private device sẵn có (`{ns}/client/{deviceId}/config/{configKind}`) hoặc thêm rule ACL machineCode-branch dựa trên mqtt_clients.machine_id; bổ sung file mqttTopicAcl + test vào Đ4 việc 3.

**➡ Quyết nghị:** CHẤP NHẬN — mọi chỗ blueprint/plan viết `syn/` đọc là **`synapse/`** (namespace canonical thật của topicRebrand.ts; không tồn tại namespace `syn/`). Topic config retained đặt dưới nhánh private device sẵn có `{ns}/client/{deviceId}/config/{configKind}` HOẶC thêm rule ACL machineCode-branch dựa trên link `mqtt_clients.machine_id` (mig 0292); Đ4 việc 3 bổ sung file `server/services/mqttService.ts` (ACL) + test `mqttTopicAcl` mới. Lựa chọn cụ thể chốt trong QĐ2.

### GAP-3 [MEDIUM] Migration 0290 (units) gộp ADD VALUE enum + seed dùng giá trị mới trong cùng file — vi phạm gotcha đã ghi trong chính repo (0242)

uomDimensionEnum là pgEnum thật (drizzle/schema/masterdata.ts:256 `dimension: uomDimensionEnum(...)`). Template được blueprint viện dẫn — drizzle/0242_smt_machine_types.sql dòng 13-15 — tự ghi chú: 'mỗi ADD VALUE phải là một câu lệnh auto-commit riêng (Postgres không cho dùng giá trị enum mới trong cùng transaction đã thêm nó). Migration này KHÔNG tham chiếu các giá trị mới ở nơi khác nên an toàn'. Plan Đ1 việc 7 lại gộp 'ADD VALUE dimension torque/pressure/flow/current/frequency + seed units_of_measure/unit_conversions' vào MỘT migration 0290 — các row seed dùng dimension mới sẽ fail nếu chạy chung transaction. Bảng rủi ro R1 chỉ nói 'không rollback được', không nhắc hazard này.

**Đề xuất của phản biện:** Tách 0290 thành 2 file áp tuần tự (0290a chỉ ADD VALUE, 0290b seed ON CONFLICT DO NOTHING) hoặc chuyển seed sang script scripts/seed-*.mjs idempotent như seed-device-types; ghi chú thứ tự áp trong cả 2 file; rà tương tự cho mọi migration ADD VALUE + tham chiếu (0287 hiện an toàn vì không tham chiếu giá trị mới).

**➡ Quyết nghị:** CHẤP NHẬN — Đ1 việc 7: tách migration 0290 thành 2 file áp tuần tự (0290a chỉ `ALTER TYPE ... ADD VALUE`; 0290b seed `units_of_measure`/`unit_conversions` với `ON CONFLICT DO NOTHING`) hoặc chuyển seed sang script `scripts/seed-*.mjs` idempotent (theo mẫu seed-device-types) — tuân gotcha enum-cùng-transaction đã ghi trong `drizzle/0242_smt_machine_types.sql`. Rà mọi migration ADD VALUE khác trong kế hoạch theo cùng quy tắc.

### GAP-4 [MEDIUM] Station ảo IoT `IOT-<workshopCode>` thiếu mắt xích line ảo (stations.lineId NOT NULL) và cơ chế `countsTowardOee` chưa hề tồn tại

Blueprint Trục 1 QĐ1 chọn 'station ảo IOT-<workshopCode> tạo tự động per-workshop (KHÔNG nới stationId nullable)'. Nhưng schema thật: stations.lineId NOT NULL (drizzle/schema/hierarchy.ts:167) + unique (lineId, code) — station treo dưới LINE chứ không dưới workshop, nên station ảo per-workshop bắt buộc phải có line cha; blueprint/plan không nói tạo line ảo nào, quy ước code line, hay cách loại line/station ảo khỏi line-dashboard/line-controller/OEE line-level. Đồng thời grep toàn repo `countsTowardOee` = 0 match — blueprint viết 'IOT_* bị loại nhờ capabilities.countsTowardOee=false' (Trục 0 + Trục 6) như thể cơ chế sẵn có, thực tế phải THÊM field vào EquipmentCapability (capabilityModel.ts) VÀ wiring oeeSnapshotScheduler/mart đọc field đó — đầu việc này không được liệt kê tường minh ở Đ0 việc 7 hay Đ5 việc 4.

**Đề xuất của phản biện:** Bổ sung vào Đ2 việc 4: quy ước line ảo `IOT-<ws>` (idempotent, isActive, ẩn khỏi line-analytics bằng filter deviceClass) hoặc đổi sang station ảo per-line có sẵn; thêm đầu việc tường minh 'mở rộng EquipmentCapability + oeeSnapshotScheduler/reportingMart filter countsTowardOee' vào Đ0/Đ5 kèm test.

**➡ Quyết nghị:** CHẤP NHẬN — Đ2 việc 4 bổ sung: quy ước **line ảo** `IOT-<workshopCode>` (idempotent, isActive, ẩn khỏi line-analytics bằng filter deviceClass) làm cha cho station ảo (vì `stations.lineId` NOT NULL); Đ0 việc 7 + Đ5 việc 4 THÊM đầu việc tường minh: mở rộng `EquipmentCapability` thêm field `countsTowardOee` (hiện CHƯA tồn tại — grep = 0) + wiring `oeeSnapshotScheduler`/`reportingMart` đọc field đó + test.

### GAP-5 [MEDIUM] 11 QĐ được viện dẫn làm cổng chặn nhưng không có mục liệt kê quyết định để user duyệt

Yêu cầu gốc: user REVIEW + DUYỆT kế hoạch trước khi thực thi. Plan gắn hầu hết đầu việc quan trọng vào 'chờ QĐn' (QĐ1 IoT identity, QĐ2 namespace, QĐ3 weak-auth, QĐ4 mTLS, QĐ5 ratify spec, QĐ6 enforcement, QĐ7 KB, QĐ8 cổng thiết bị thật, QĐ9 nhịp bật cờ, QĐ10 SSE, QĐ11 staged rollout) nhưng cả blueprint lẫn plan đều KHÔNG có mục nào liệt kê các QĐ với phương án/khuyến nghị/default — QĐ8-QĐ11 thậm chí không xuất hiện trong bất kỳ doc nào trên disk (grep docs/ECOSYSTEM = 0). Tiền lệ repo là doc 55 với mục '14 QĐ §6' để duyệt một lượt. Thiếu bảng này thì phê duyệt không hoàn tất được và các đợt sẽ tự-chặn giữa chừng (Đ1 việc 3/7 'chờ QĐ6', Đ2 việc 2 'chờ QĐ3', Đ3 'chờ QĐ5/QĐ8'...).

**Đề xuất của phản biện:** Thêm §'Quyết định chờ duyệt' vào doc 56: bảng QĐ1-QĐ11 gồm câu hỏi, 2-3 phương án, khuyến nghị + hệ quả, và hành-vi-mặc-định nếu user không chọn (để đợt không bị treo); đánh dấu QĐ nào chặn đợt nào.

**➡ Quyết nghị:** ĐÃ XỬ LÝ TRONG DOC NÀY — Phần B liệt kê đầy đủ QĐ1–QĐ11 kèm phương án/khuyến nghị/đợt-bị-chặn; quy tắc mặc định ghi ở đầu Phần B.

### GAP-6 [LOW] Cập nhật firmware OTA cho IoT tự phát triển không nằm trong chuẩn 'cài đặt & đồng bộ' mà không tuyên bố out-of-scope

Hạng mục gốc (3) 'tiêu chuẩn hóa cài đặt & đồng bộ' cho thiết bị IoT tự phát triển thường bao gồm phân phối firmware. configKind vocabulary của Trục 3 chỉ có `recipe | device_settings | points | model` — không có `firmware`; toàn kế hoạch chỉ có read-tool `list_iot_devices` hiển thị firmware version (Trục 7). Hạ tầng gần kề đã có (FleetRolloutStrategy canary→verify→promote, nhánh `avi/edge/{id}/model-update`, program_deployments) nên đây là lỗ hổng phạm vi có thể bị user hỏi lại khi duyệt, dù không chặn pilot.

**Đề xuất của phản biện:** Thêm 1 QĐ hoặc 1 dòng tuyên bố phạm vi trong doc 56/57: firmware OTA là out-of-scope đợt này, reserve configKind `firmware` trong vocabulary (additive) + định hướng tái dùng FleetRolloutStrategy ở đợt sau.

**➡ Quyết nghị:** CHẤP NHẬN — TUYÊN BỐ PHẠM VI: firmware OTA cho thiết bị IoT là **out-of-scope** đợt này; reserve giá trị `firmware` trong vocabulary `configKind` (additive, chưa implement); đợt sau tái dùng `FleetRolloutStrategy` (canary→verify→promote) + nhánh `avi/edge/{id}/model-update` làm nền OTA.

### GAP-7 [LOW] Đ2 quá to: gộp thay đổi credential an ninh (MK_ONLY/TTL/IoT identity/RBAC) với khối UI lớn nhất (wizard V2 ba nhánh) — pilot Đ3 bị buộc vào rủi ro UI không cần thiết

Đ2 có 9 đầu việc trong đó wizard V2 là L (3 nhánh, tái cấu trúc AoiOnboardingWizard + gỡ hard-block Step4DeployModel + TAB_REDIRECTS) đứng cạnh các thay đổi hành vi bảo mật nhạy cảm (đổi ngữ nghĩa redeem claim mint mk_, policy authenticateMachine theo deviceClass, RBAC approve mở cho engineer, lifecycle hook revoke MQTT). R8/bài học doc 24 chỉ chống chạy song song trên cùng file, chưa xử lý độ phình của đợt: regression wizard (Playwright, khối UI mới lớn nhất toàn kế hoạch) sẽ giam green-gate của cả các cờ credential mà pilot Đ3 cần (Đ3 kịch bản A/B thực chất chỉ cần enroll token + mk_ + script, không cần wizard).

**Đề xuất của phản biện:** Tách Đ2a (backend credential/identity + EnrollmentTokensTab + SDK mẫu — đủ cho Đ3 chạy pilot bằng met_ token + script) và Đ2b (wizard V2 + DeviceHub/monitor + RBAC UI), cho phép Đ2b hoàn thiện song song ngay sau khi Đ3 khởi động; giữ nguyên thứ tự còn lại.

**➡ Quyết nghị:** CHẤP NHẬN — TÁCH Đ2 thành **Đ2a** (backend credential/identity: redeem claim mint mk_, policy per-deviceClass, RBAC approve, lifecycle hook revoke MQTT + EnrollmentTokensTab + SDK mẫu — đủ cho Đ3 pilot chạy bằng met_ token + script) và **Đ2b** (wizard V2 ba nhánh + DeviceHub/monitor + RBAC UI — hoàn thiện song song ngay sau khi Đ3 khởi động). Thứ tự các đợt còn lại giữ nguyên.


---

## 7. Bước tiếp theo sau khi duyệt

1. Anh/chị chọn QĐ1–QĐ11 (hoặc "tất cả theo khuyến nghị") — QĐ3/QĐ5/QĐ6/QĐ8 chặn các đợt sớm.
2. Thực thi Đ0 → Đ7 (9 đợt sau tách Đ2a/Đ2b), mỗi đợt: cờ default-OFF (OFF = byte-identical) → tsc (heap 8GB) + test nhắm đích + LIVE proof → commit riêng → bật cờ theo QĐ9.
3. Mục "VIỆC CON NGƯỜI / VẬN HÀNH" (cuối Phần C) cần đội vận hành thực hiện song song — không nằm trong green-gate code.

## Phụ lục A — Kết quả audit chi tiết 10 trục (findings + bằng chứng + kiểm chứng đối kháng)

### A.1 Luồng đăng ký & khởi tạo thiết bị (`reg-onboard`) — AOI/AVI **72** · Automation **45** · IoT **22**

**Căn cứ chấm điểm:** Chấm theo tiêu chí: một máy thuộc nhóm đó HÔM NAY có tự gia nhập được hệ thống đến bước 'gửi dữ liệu chuẩn với credential riêng' hay không. aoi_avi: luồng register→approve→claim→ingest LIVE đầy đủ, throttle/audit/lifecycle enforce thật — trừ điểm vì 2 đường auth yếu vẫn default allow, claim-token/enrollment không có UI, runbook rotation doc 52 chưa chạy. automation: đăng ký + cấp mk_ key được (enum có SCREWDRIVE/DISPENSING, enroll type-agnostic) nhưng bước cuối 'gửi dữ liệu' đứt (không endpoint ingest nhận credential máy cho process-result) và wizard onboarding đều AOI-shaped. iot: không có identity first-class — phải giả dạng machineType khác + treo station mặc định, hoặc rơi vào mqtt_clients hình-điện-thoại không credential lifecycle; PKI/mTLS đều OFF.

**Tóm tắt trục:** Luồng đăng ký cho AVI/AOI là CHUẨN HÓA THẬT và đang LIVE: register public (throttle + pending-cap + station validate) → admin approve → claim-token/config → ingest, với lifecycle 7 trạng thái enforce nghiêm (transition map, reason bắt buộc, revoke credential atomic khi retire) và bộ khoá mk_ hash-at-rest có cấp/rotate/thu hồi đầy đủ. Nhưng ba điểm gãy quyết định: (1) nền auth vẫn mặc định chấp nhận machineCode-only và shared plaintext key — plaintext còn lộ cho mọi user đăng nhập qua listPaged, và runbook rotation doc 52 chưa ai chạy; (2) hai cơ chế cấp credential an toàn (claim token, zero-touch enrollment với batch serialPattern) đã xây trọn backend + test nhưng một cái bị UI vứt token, một cái flag OFF + 0 UI — nên thực tế vận hành vẫn là copy plaintext key thủ công; (3) chuỗi đứt ở bước cuối cho nhóm mới: máy automation enroll xong không có endpoint ingest nào nhận credential máy cho process-result (processResult.record đòi session người dùng), còn IoT hoàn toàn không có identity first-class (enum thiếu loại IOT, machines ép stationId, thiết bị MQTT rơi vào registry hình-điện-thoại-Android không link machines/URN, PKI + mTLS đều OFF). Việc chuẩn hóa 3 nhóm KHÔNG cần xây mới: enrollment tokens + claim + lifecycle + /v1/assets URN + device_types đã là bộ khung đúng — cần nối UI, bật cờ có kiểm soát, thêm machineType IoT, hợp nhất mqtt_clients về machines, và mở 1 endpoint ingest process-result nhận authenticateMachine.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- machineAuthService — issuer mk_ hash-at-rest dùng chung bảng api_keys, scope vocabulary + wildcard, chính sách weak-auth 3 nấc + telemetry getWeakAuthUsage (server/services/machineAuthService.ts) — mọi nhóm thiết bị mới nên phát hành credential qua đúng issuer này
- Zero-touch enrollment tokens — met_ hash-at-rest, serialPattern batch allowlist, atomic burn, scopes per-token (server/db/hierarchy.ts:709-996 + hierarchyRouters.ts:1024-1161) — chỉ thiếu UI + bật cờ là dùng được cho fleet automation/IoT
- Claim token mct_ single-use (server/db/hierarchy.ts machineClaimTokens + redeemMachineClaimToken, test server/routers/machineClaimKey.test.ts) — cơ chế handoff credential không lộ key
- State machine lifecycle 7 trạng thái + revoke credential atomic trong transition (drizzle/schema/hierarchy.ts:221-248, server/db/hierarchy.ts transitionMachineLifecycle + revokeMachineCredentialsTx) — mở rộng cho mọi identity kết nối thay vì chế mới
- /v1/assets asset registry — URN urn:syn:asset + ISA-95 path, đăng ký declarative 'registered' với onboarding.next_steps honest (server/api/v1/assets.ts, server/services/assetRegistry/urnService) — backbone hợp nhất identity 3 nhóm máy
- device_types versioned registry + conformance + capabilitiesValidation 2-tier (drizzle/schema/equipmentStandards.ts, server/services/standards/*) — chỗ định nghĩa contract SCREWDRIVE/DISPENSING/IOT, đừng xây registry mới
- Pattern wizard AOI onboarding 5 bước — draft resumable server-side, show-once key + QR (client/src/pages/AoiOnboardingWizard.tsx, components/aoiOnboarding/Step4Credential.tsx) — nhân bản cho nhánh automation/iot
- Device PKI nội bộ — internal CA Ed25519 + SPIFFE-lite + deviceCertificates issue/rotate/revoke (server/services/security/deviceIdentityService.ts, internalCa.ts) — sẵn cho IoT identity cứng
- MQTT broker aedes + topic ACL default-ON + password hash-at-rest + seam mTLS (server/services/mqttService.ts) — nền kết nối IoT, chỉ cần nối identity về machines
- deviceAdapters/deviceTags + config-drift snapshot sha256 (drizzle/schema/ot.ts, drizzle/schema/assetRegistry.ts, configDriftService) — mô hình cấu hình kết nối chuẩn cho thiết bị server-pull
- Machine data contract versioned JSON-Schema (server/routers/machineContractRouter.ts + server/contracts/machineDataContract.ts) — chỗ công bố contract ingest mới cho process-result/telemetry
- processResults + recordProcessResult (drizzle processResults, server/db/processResult.ts, server/services/processResultService) — bảng dữ liệu generic pass/fail/metrics cho máy automation đã có sẵn, chỉ thiếu endpoint nhận credential máy

**Findings (11):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| REG-1 | P0 | LIVE | all | Danh tính máy yếu vẫn là MẶC ĐỊNH: machineCode-only (không bí mật) + shared plaintext apiKey default allow, plaintext lộ qua listPaged cho mọi user đăng nhập | ◐ PARTIAL |
| REG-2 | P1 | FLAG_OFF | automation,iot | Zero-touch enrollment (met_ token, batch serialPattern, mint mk_ scoped) hoàn chỉnh backend nhưng flag OFF và KHÔNG có UI quản trị | ✔ CONFIRMED |
| REG-3 | P1 | STUB | all | Luồng claim-token (đường cấp credential an toàn duy nhất) ĐỨT ở UI: approve trả claimToken nhưng frontend vứt bỏ, issueClaimToken không có nút | ◐ PARTIAL |
| REG-4 | P1 | MISSING | iot | IoT không có identity first-class: enum thiếu loại IOT/SENSOR/GATEWAY, machines bắt buộc stationId, MQTT tự-đăng-ký rơi vào registry hình-điện-thoại-Android không link machines | ✔ CONFIRMED |
| REG-5 | P1 | MISSING | automation,iot | Máy automation enroll xong KHÔNG có endpoint ingest nhận credential máy: processResult.record đòi session người dùng, /v1/ingest chỉ nhận payload inspection-shaped | ◐ PARTIAL |
| REG-6 | P2 | LIVE | all | 5 surface onboarding song song không hội tụ: register tự-báo, POST /v1/assets declarative, 2 wizard UI, MQTT auto-pending — mỗi cái stamp trạng thái khác nhau | — |
| REG-7 | P2 | FLAG_OFF | automation,iot | Mapping machine→deviceTypeKey không bắt buộc và không enforce: machines không có cột deviceTypeKey, EQ_GOVERN warn-only + OFF, capabilities validation tier-2 OFF | — |
| REG-8 | P2 | LIVE | iot | Lifecycle 7 trạng thái enforce chuẩn cho machines nhưng các identity IoT/edge KHÔNG có lifecycle — thiết bị MQTT soft-deleted tự hồi sinh về PENDING | — |
| REG-9 | P2 | STUB | all | Vệ sinh hạn khoá chưa nối dây: TTL mặc định 0 (khoá vĩnh viễn), listExpiringMachineKeys không có consumer nào (không cron/router/UI) | — |
| REG-10 | P2 | FLAG_OFF | iot,automation | Device PKI X.509/SPIFFE-lite (cấp/rotate/thu hồi cert 90 ngày) đã xây nhưng OFF và đứng NGOÀI luồng đăng ký máy — consumer duy nhất là MQTT mTLS (cũng OFF) | — |
| REG-11 | P3 | MISSING | automation,iot | Không có SDK/firmware mẫu phía thiết bị cho chuỗi register→claim/enroll→ingest→heartbeat — mỗi đội máy nội bộ sẽ tự chế client lệch chuẩn | — |

#### REG-1 [P0/LIVE] Danh tính máy yếu vẫn là MẶC ĐỊNH: machineCode-only (không bí mật) + shared plaintext apiKey default allow, plaintext lộ qua listPaged cho mọi user đăng nhập

- **Khoảng trống:** Nền auth mà mọi nhóm thiết bị mới sẽ kế thừa đang ở trạng thái yếu nhất: máy automation/IoT onboard hôm nay vẫn có thể (và theo doc 51 §5.6 vẫn được HƯỚNG DẪN) dùng machineCode-only; plaintext key đọc được bởi bất kỳ user đăng nhập nào qua listPaged. Chuẩn hóa đăng ký mà giữ nguyên nền này = chuẩn hóa trên cát.
- **Khuyến nghị:** Máy automation/IoT mới ban hành mk_-only ngay từ đầu (không ghi machines.apiKey); strip apiKey khỏi getMachinesPaged như đã làm với machine.list; thực thi runbook 52 theo giai đoạn (report → rotate → read-only → deny) trước khi mở rộng nhóm thiết bị.
- **Bằng chứng:** `server/services/machineAuthService.ts:125` — sharedMachineKeyPolicy() default "allow"; dòng 133 machineCodeOnlyPolicy() default "allow" — biết mã máy = LÀ máy đó, bỏ qua scope · `server/routers/hierarchyRouters.ts:897` — approve mint `mach_${nanoid(32)}` lưu PLAINTEXT vào machines.apiKey (drizzle/schema/hierarchy.ts:269 varchar unique) · `server/db/hierarchy.ts:360` — getMachinesPaged() select FULL row (gồm apiKey) — machine.listPaged (hierarchyRouters.ts:1188-1197, protectedProcedure mọi role) trả plaintext apiKey; chỉ machine.list (dòng 1182) được strip theo doc 42 · `docs/ECOSYSTEM/52_P0_MACHINE_AUTH_ROTATION_RUNBOOK.md:3` — "TRẠNG THÁI: … CHƯA AI CHẠY CÁC BƯỚC NÀY" — cơ chế siết 3 nấc allow→read-only→deny đã xây nhưng rotation chưa thực thi
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG: machineCodeOnlyPolicy default "allow" (machineAuthService.ts:132-134) và .env KHÔNG set MACHINE_CODE_ONLY_ALLOWED → đường không-bí-mật đang LIVE (authenticateMachine nhánh machine-code :523-542); approve mint `mach_${nanoid(32)}` plaintext (hierarchyRouters.ts:897) lưu thẳng machines.apiKey varchar unique (approveMachine db/hierarchy.ts:1107, schema hierarchy.ts:269); getMachinesPaged select FULL row (db/hierarchy.ts:360) và machine.listPaged là protectedProcedure trả nguyên items cho mọi role (hierarchyRouters.ts:1188-1196) → plaintext apiKey lộ cho mọi user đăng nhập; runbook 52 dòng 3 "CHƯA AI CHẠY" đúng nguyên văn. SAI 2 điểm: (1) shared plaintext key KHÔNG còn default-allow ở deployment thật — .env:607 `MACHINE_SHARED_KEY_ALLOWED=false` (doc 54 Đợt F, comment .env:605-606: 15 máy đã provision key hash vào api_keys) → sharedMachineKeyPolicy = deny live, chỉ còn là default trong code; (2) chi tiết "chỉ machine.list được strip" đã cũ — getById cũng strip apiKey (hierarchyRouters.ts:1238-1244, doc 54 P0-1). Trục P0 (danh tính máy yếu LIVE qua machineCode-only + leak listPaged) vẫn đứng.

#### REG-2 [P1/FLAG_OFF] Zero-touch enrollment (met_ token, batch serialPattern, mint mk_ scoped) hoàn chỉnh backend nhưng flag OFF và KHÔNG có UI quản trị

- **Khoảng trống:** Đây chính là cơ chế được thiết kế để onboard HÀNG LOẠT máy bắt vít/điểm keo/IoT (token allowlist theo dải serial + scopes tối thiểu) nhưng đang tối đèn: không bật được vì thiếu UI cho admin và chưa từng chạy thật. Máy mới hôm nay vẫn phải đi vòng register→chờ admin duyệt từng con.
- **Khuyến nghị:** Xây màn hình admin mint/list/revoke enrollment token (hiện plaintext 1 lần + QR để kỹ thuật viên quét vào firmware), bật ENROLLMENT_ENABLED ở staging với token TTL ngắn, viết SOP cho đợt lắp máy nội bộ đầu tiên.
- **Bằng chứng:** `server/routers/hierarchyRouters.ts:670` — enrollmentEnabled() = ENROLLMENT_ENABLED === "true" (default FALSE); enroll publicProcedure (1028-1098) tự-approve + tự-tạo máy + mint mk_ qua issuer chung; issueEnrollmentToken adminProcedure (1104-1145) hoạt động bất kể flag · `server/db/hierarchy.ts:709` — Bảng machine_enrollment_tokens (hash-at-rest, serialPattern prefix-match chống ReDoS, maxUses tới 100k, scopes per-token) + redeem atomic burn WHERE useCount<maxUses RETURNING (947-958) — single-use thật · `client/src` — grep "issueEnrollmentToken|enrollmentToken|claimKey" toàn client/src = 0 file — không màn hình mint/list/revoke token nào tồn tại
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### REG-3 [P1/STUB] Luồng claim-token (đường cấp credential an toàn duy nhất) ĐỨT ở UI: approve trả claimToken nhưng frontend vứt bỏ, issueClaimToken không có nút

- **Khoảng trống:** Doc 51 P0 đã bịt lỗ config-trả-plaintext-key bằng claim token, nhưng vì UI không hiển thị token nên người vận hành thực tế chỉ còn 2 lựa chọn xấu: đọc plaintext apiKey từ bảng máy (REG-1) hoặc bật lại MACHINE_CONFIG_EXPOSE_APIKEY. Vòng đời credential cấp-phát đang đứt đúng một mắt xích cuối.
- **Khuyến nghị:** Dialog show-once claimToken (copy + QR, giống Step4Credential của AOI wizard) ngay sau approve + nút 'Cấp lại claim token' trên từng máy đã duyệt.
- **Bằng chứng:** `server/routers/hierarchyRouters.ts:934` — approve trả { claimToken, claimExpiresAt } (mint best-effort tại 913); issueClaimToken adminProcedure re-mint độc lập (944-976) vì token chết trước khi kỹ thuật viên ra tới máy · `client/src/pages/MachineRegistration.tsx:258` — approveMutation onSuccess chỉ toast apiKey?.substring(0,20) — claimToken không được hiển thị ở bất kỳ đâu; grep "claim" cả file = 0 hit · `server/routers/machineClaimKey.test.ts` — Hành vi backend được test đầy đủ (291 dòng) — vấn đề thuần UI wiring
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG phần wiring: approve trả {claimToken, claimExpiresAt} (hierarchyRouters.ts:930-937, mint best-effort :913), issueClaimToken adminProcedure re-mint độc lập (:944-976); client approveMutation onSuccess chỉ toast apiKey?.substring(0,20) (MachineRegistration.tsx:258-262), grep "claim" cả file 1509 dòng = 0 hit, grep "claimToken|issueClaimToken|claimKey" toàn client/src = 0 hit; machineClaimKey.test.ts đúng 291 dòng. SAI phần định khung "đường cấp credential an toàn DUY NHẤT / chỉ còn 2 lựa chọn xấu": tồn tại đường UI an toàn đang sống — AoiOnboardingWizard Step 4 (client/src/components/aoiOnboarding/Step4Credential.tsx:27-119) gọi machineApi.issueKey cấp mk_ scoped hash-at-rest, hiển thị plaintext MỘT LẦN kèm copy + QR (route /aoi-onboarding có trong App.tsx); machine.regenerateApiKey cũng được wire ở MachinesTab.tsx:95 và DataSettings.tsx:317. Thêm nữa, ở env live MACHINE_SHARED_KEY_ALLOWED=false (.env:607) thì key mà claimKey trả (machines.apiKey, hierarchyRouters.ts:1003) bị chính authenticateMachine từ chối (machineAuthService.ts:496-516) — mắt xích đứt ở UI là thật nhưng nó không phải con đường an toàn duy nhất.

#### REG-4 [P1/MISSING] IoT không có identity first-class: enum thiếu loại IOT/SENSOR/GATEWAY, machines bắt buộc stationId, MQTT tự-đăng-ký rơi vào registry hình-điện-thoại-Android không link machines

- **Khoảng trống:** ESP32 tự phát triển hôm nay có đúng 2 đường đều lệch chuẩn: (1) giả dạng machineType AUTOMATION qua register — vào được nhưng model sai và kẹt hierarchy station; (2) connect MQTT — thành 'điện thoại' PENDING trong registry riêng, không URN, không scope, không credential lifecycle. Hai registry (machines / mqtt_clients) song song không hội tụ về một asset identity.
- **Khuyến nghị:** Thêm machineType IOT_SENSOR/IOT_GATEWAY (ADD VALUE migration như 0241 đã làm cho SMT), nới stationId hoặc quy ước station 'unassigned' per-workshop, thêm cột machineId vào mqtt_clients để 1 thiết bị MQTT sau approve = 1 machines row + URN, hưởng chung claim/enroll + lifecycle.
- **Bằng chứng:** `drizzle/schema/enums.ts:15` — machineTypeEnum 21 giá trị (AVI…WAVE_SOLDER) — không có loại nào cho sensor/gateway/thiết bị IoT tự chế; register/enroll đều z.enum(MACHINE_TYPES) (hierarchyRouters.ts:703, 1037) · `drizzle/schema/hierarchy.ts:262` — machines.stationId notNull + FK RESTRICT — thiết bị môi trường/năng lượng không thuộc station nào vẫn bị ép treo vào getDefaultStation() · `drizzle/schema/mqtt.ts:8` — mqtt_clients thiết kế cho điện thoại Android (deviceId=Android ID, osVersion, screenResolution, fcmToken) — không có machineId/URN, không machineType · `server/services/mqttService.ts:1330` — Thiết bị MQTT lạ auto-tạo mqtt_clients PENDING (username 'deviceId:deviceName:deviceModel', không cần bí mật khi chưa đặt password; MQTT_REQUIRE_PASSWORD default off dòng 385)
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### REG-5 [P1/MISSING] Máy automation enroll xong KHÔNG có endpoint ingest nhận credential máy: processResult.record đòi session người dùng, /v1/ingest chỉ nhận payload inspection-shaped

- **Khoảng trống:** Chuỗi onboarding cho máy bắt vít/điểm keo/hàn đứt ở bước cuối: máy đăng ký được, được duyệt, nhận mk_ key ingest:write — rồi không có API nào nhận dữ liệu process của nó bằng key đó. Muốn gửi torque phải nhét vào contract inspection (sai ngữ nghĩa) hoặc đi qua OT adapter server-pull (cấu hình tay từng con).
- **Khuyến nghị:** Mở POST /v1/ingest/process-result dùng authenticateMachine + scope ingest:write, tái dùng recordProcessResult/insertProcessResult sẵn có; bổ sung idempotency giống submitInspection; công bố trong machineContractRouter.
- **Bằng chứng:** `server/routers/processResultRouter.ts:32` — record: protectedProcedure — kênh duy nhất ghi process_results (torque/dispensing/pass-fail generic) yêu cầu cookie user đăng nhập, mk_/apiKey máy bị từ chối · `server/api/v1/router.ts:305` — POST /ingest/inspection là endpoint ingest REST duy nhất (reuse submitInspection — bắt buộc shape inspection AVI/AOI); không có /ingest/process-result hay /ingest/telemetry · `server/api/v1/scopes.ts:19` — ingest:write mô tả 'Ingest inspection results' — scope mặc định của enrollment (ENROLLMENT_DEFAULT_SCOPES db/hierarchy.ts:738) chỉ mở được cửa inspection
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG nửa process_results: processResult.record là protectedProcedure đòi session user (processResultRouter.ts:32-37), recordProcessResult không có call-site nhận credential máy (grep: chỉ router này + adapter server-pull mtconnect/secsgem + test) → máy cầm mk_ không ghi được process_results (torque per-serial). SAI nửa "endpoint ingest REST duy nhất / không có /ingest/telemetry": tồn tại POST /api/ot/ingest (server/_core/index.ts:336-407, doc 48 R3) — endpoint PUSH telemetry cho máy, auth đúng authenticateMachine với scope "ingest:write" (x-api-key/body.apiKey/machineCode, :367-373), nhận batch CanonicalSample[] {metric,value,unit,quality,protocol} vào telemetry bus với rate-tier riêng (:289-296) — tức máy enroll xong CÓ endpoint nhận dữ liệu bằng key máy (telemetry, kể cả torque dạng metric), chỉ là không ghi vào bảng process_results. Kéo theo evidence "ingest:write chỉ mở được cửa inspection" cũng sai (mở cả /api/ot/ingest); mô tả scope nằm ở scopes.ts:70 chứ không phải :19 (dòng 19 là hằng số). Khoảng trống thật còn lại hẹp hơn mô tả: thiếu đường machine-credential cho process-result first-class (per-serial pass/fail), không phải thiếu toàn bộ ingest.

#### REG-6 [P2/LIVE] 5 surface onboarding song song không hội tụ: register tự-báo, POST /v1/assets declarative, 2 wizard UI, MQTT auto-pending — mỗi cái stamp trạng thái khác nhau

- **Khoảng trống:** Không tồn tại MỘT luồng chuẩn 'thêm thiết bị mới' phân nhánh theo nhóm máy. Kỹ thuật viên lắp máy điểm keo không biết đi cửa nào; mỗi cửa cho ra machine ở trạng thái đầu đời khác nhau nên báo cáo commissioning không nhất quán.
- **Khuyến nghị:** Hợp nhất thành 1 wizard 'Thêm thiết bị' rẽ nhánh aoi_avi/automation/iot trên cùng state machine registered→commissioning→active; /v1/assets làm backbone; 2 wizard cũ thành nhánh chuyên biệt.
- **Bằng chứng:** `server/routers/hierarchyRouters.ts:699` — machine.register → pending + commissioning; enroll → approved + active (db/hierarchy.ts:991-992); mỗi đường một tổ hợp trạng thái · `server/api/v1/assets.ts:398` — POST /assets (scope assets:write) → lifecycle 'registered' + onboarding.next_steps honest — nhưng không đường nào trong UI dẫn tới nó · `client/src/pages/AoiOnboardingWizard.tsx:1` — Wizard W2-D 5 bước hard-wired cho máy KIỂM QUANG (vendor vision adapter, hot-folder, dry-run sample export); MachineOnboardingWizard.tsx (WS-2) 5 bước khác cũng kết ở deploy-model AOI · `server/services/mqttService.ts:1330` — Đường thứ 5: MQTT connect lạ auto-tạo pending trong registry riêng

#### REG-7 [P2/FLAG_OFF] Mapping machine→deviceTypeKey không bắt buộc và không enforce: machines không có cột deviceTypeKey, EQ_GOVERN warn-only + OFF, capabilities validation tier-2 OFF

- **Khoảng trống:** Máy automation mới có thể vào hệ với capabilities trống → các tầng sau (adapter kind, dashboard, AI advisor) không suy ra được contract dữ liệu của máy. Registry device_types versioned + conformance đã xây đủ nhưng đứng ngoài luồng tạo máy.
- **Khuyến nghị:** Khi chuẩn hóa: seed device_types cho SCREWDRIVE/DISPENSING/IOT_*, bật EQ_GOVERN + tier-2 cho MÁY MỚI (giữ warn cho máy cũ), thêm cột deviceTypeVersion stamp lúc approve.
- **Bằng chứng:** `drizzle/schema/hierarchy.ts:259` — Bảng machines không có cột deviceTypeKey/deviceTypeVersion — chỉ machineType pgEnum; mapping gián tiếp qua device_types.mappedMachineTypes (equipmentStandards.ts:93) · `server/routers/hierarchyRouters.ts:101` — commissionGovernanceWarning: khi EQ_GOVERN_ENABLED (default OFF — deviceTypeRegistry.ts:41) chỉ TRẢ CHUỖI CẢNH BÁO, không chặn tạo máy; comment ghi rõ 'không lưu deviceTypeVersion (cần migration)' · `server/services/standards/capabilitiesValidation.ts:14` — Tier 2 CAPABILITIES_VALIDATION_ENFORCED default OFF — capabilities rác/trống vẫn lưu, chỉ stamp kết quả validate

#### REG-8 [P2/LIVE] Lifecycle 7 trạng thái enforce chuẩn cho machines nhưng các identity IoT/edge KHÔNG có lifecycle — thiết bị MQTT soft-deleted tự hồi sinh về PENDING

- **Khoảng trống:** Câu hỏi (e) trả lời: CÓ và enforce THẬT — nhưng chỉ cho bảng machines. Ba registry kết nối còn lại (mqtt_clients, edge_nodes, device_adapters) không có khái niệm vòng đời, nên 'thu hồi một thiết bị IoT' hiện không tồn tại như một thao tác có bảo đảm.
- **Khuyến nghị:** Khi hợp nhất identity (REG-4), cho mọi thiết bị kết nối hưởng chung MACHINE_LIFECYCLE_TRANSITIONS; retire thiết bị MQTT phải revoke passwordHash/cert và chặn re-activate tự động.
- **Bằng chứng:** `drizzle/schema/hierarchy.ts:221` — MACHINE_LIFECYCLE_STATUSES 7 trạng thái + transition map; enforce tại db.transitionMachineLifecycle (CONFLICT nếu sai) + revoke TOÀN BỘ credential atomic cùng transaction khi retire/decommission (server/db/hierarchy.ts:660-692, 1124-1129) + control_audit_log (hierarchyRouters.ts:1564-1576); register/enroll chặn máy retired (719-724) · `drizzle/schema/mqtt.ts:22` — mqtt_clients chỉ có approvalStatus PENDING/APPROVED/REJECTED — không commissioning/retired · `server/services/mqttService.ts:1304` — Client soft-deleted (isActive=false) reconnect → tự re-activate về PENDING — 'gỡ bỏ' thiết bị IoT không phải trạng thái chung cuộc · `drizzle/schema/edge.ts:27` — edge_nodes chỉ có status online/offline/degraded, không lifecycle, không credential

#### REG-9 [P2/STUB] Vệ sinh hạn khoá chưa nối dây: TTL mặc định 0 (khoá vĩnh viễn), listExpiringMachineKeys không có consumer nào (không cron/router/UI)

- **Khoảng trống:** Vòng đời credential có cấp/rotate/revoke (machineApi.issueKey/rotateKey/revokeKey RBAC admin_system — machineApiRouters.ts:2736-2773, AOI wizard Step4 dùng) nhưng khâu 'cảnh báo trước khi hết hạn' — điều kiện tiên quyết để dám bật TTL cho cả fleet — chưa tồn tại.
- **Khuyến nghị:** Cron tuần gọi listExpiringMachineKeys(14) → đẩy action inbox/alert sẵn có; sau đó bật MACHINE_KEY_DEFAULT_TTL_DAYS=180 cho khoá cấp mới.
- **Bằng chứng:** `server/services/machineAuthService.ts:179` — machineKeyDefaultTtlDays(): unset/0 → expiresAt null (không hạn) — opt-in chưa ai bật; comment dặn 'Pair it with listExpiringMachineKeys() + a cron' · `server/services/machineAuthService.ts:694` — listExpiringMachineKeys() viết xong nhưng grep toàn server = chỉ chính nó + machineAuthService.test.ts — không cron, không tRPC procedure, không UI đọc

#### REG-10 [P2/FLAG_OFF] Device PKI X.509/SPIFFE-lite (cấp/rotate/thu hồi cert 90 ngày) đã xây nhưng OFF và đứng NGOÀI luồng đăng ký máy — consumer duy nhất là MQTT mTLS (cũng OFF)

- **Khoảng trống:** Tầm nhìn 'chuẩn hóa kết nối' cho IoT nội bộ tự phát triển cần identity mạnh hơn API key (thiết bị nằm trên LAN xưởng, key dễ trích). Hạ tầng CA + mint + revoke đã có đủ nhưng enroll/approve không cấp cert và identity cert không map về machine/URN — hai hệ danh tính rời nhau.
- **Khuyến nghị:** Thêm option 'cấp cert' vào enroll (trả privateKeyPem 1 lần cùng mk_ key), quy ước deviceCertificates.deviceId = machine URN, lộ trình bật MQTT_MTLS permissive→strict cho thiết bị IoT mới.
- **Bằng chứng:** `server/services/security/deviceIdentityService.ts:31` — devicePkiEnabled() default OFF (verify trả soft-allow); issueDeviceCert cấp Ed25519 leaf ký bởi internal CA, kinds adapter/robot/edge_node/plc/generic — deviceId là chuỗi tự do, không FK/ràng buộc gì tới machines · `server/services/mqttService.ts:1234` — evaluateMqttPeerCert chỉ chạy khi MQTT_MTLS_ENABLED (default OFF, dòng 404) — nơi duy nhất cert được kiểm khi thiết bị kết nối

#### REG-11 [P3/MISSING] Không có SDK/firmware mẫu phía thiết bị cho chuỗi register→claim/enroll→ingest→heartbeat — mỗi đội máy nội bộ sẽ tự chế client lệch chuẩn

- **Khoảng trống:** Máy AVI/AOI có vendor software riêng nên tự lo được; máy bắt vít/ESP32 nội bộ thì đội cơ điện phải tự đọc tRPC/REST để code firmware — nguy cơ mỗi máy một kiểu (bỏ heartbeat, bỏ idempotency, hardcode key). CHƯA CHẮC: có thể tồn tại repo firmware nội bộ ngoài monorepo này.
- **Khuyến nghị:** Publish reference client (Python + C/C++ Arduino) 4 bước: register → poll config → claimKey/enroll → submit + heartbeat, kèm mẫu lưu key an toàn và retry/store-forward; link từ ApiDocs.tsx.
- **Bằng chứng:** `docs/ECOSYSTEM/ADAPTER_SDK.md:1` — 'Adapter SDK' thực chất là guide viết EquipmentAdapter PHÍA SERVER + tích hợp REST /api/v1 — không có client/agent mẫu chạy TRÊN thiết bị · `d:/SOURCES/avi-aoi-management` — Không tồn tại thư mục sdk/; grep client-side chỉ có wizard UI; doc 28 (feed spec) mô tả payload nhưng không kèm reference implementation firmware


### A.2 Tầng kết nối & giao thức (`connect-protocol`) — AOI/AVI **74** · Automation **52** · IoT **38**

**Căn cứ chấm điểm:** aoi_avi: đường ingest trưởng thành LIVE (mk_ key + claim/enrollment token, idempotency ledger, batch 200/req, 3 tầng rate-limit theo credential, delta-sync + MQTT notify) — trừ điểm vì weak-auth default allow, WAL durability default OFF, tRPC không versioned. automation: hạ tầng nền có sẵn (OT drivers 6 protocol, capability profiles SCREWDRIVE/DISPENSING, /api/ot/ingest LIVE, PackML + /v1 commands HITL) nhưng thiếu đường machine-credential ghi process-result per-unit, edge gateway OFF, HW-FAT chưa chạy. iot: dùng được ngay /api/ot/ingest + MQTT self-register, nhưng không có registry first-class (mqtt_clients hình tablet Android), MQTT identity spoofable mặc định, sensor topic OFF + identity unbound, không có client SDK.

**Tóm tắt trục:** Trục connect-protocol: một thiết bị mới hiện có 5-6 cửa gửi dữ liệu (tRPC machineApi 22 procedures + REST proxies /api/machine/*, REST /api/v1 versioned, /api/ot/ingest telemetry, MQTT aedes + sensor-topic flag-OFF, OT driver poll + edge gateway flag-OFF, hot-folder st4i) — phân mảnh, chưa tuyên bố đường CHUẨN per device-profile và ADAPTER_SDK.md đã stale so với code. Lõi auth khá thống nhất và trưởng thành (một bảng api_keys chung, mk_ key hash-at-rest, claim/enrollment token, scopes, 3 tầng rate-limit theo credential, idempotency ledger + unique index, batch 200/req) — doc 51 P0 leak config-trả-apiKey đã vá thật bằng claim token (kiểm chứng /api/machine/config không còn trả key). NHƯNG nền còn 2 lỗ mặc định: weak-auth (shared key + bare machineCode) default-ALLOW, và MQTT identity tự khai không secret (password opt-in, mTLS OFF, admission log-only). Cho nhóm aoi_avi đường ingest đã production-grade (74); nhóm automation bị chặn đúng một chỗ quan trọng: processResult.record đúng semantics thì chỉ user-session gọi được — máy không có machine-credential path ghi kết quả per-unit (52); nhóm iot thiếu registry first-class (mqtt_clients hình tablet Android, /v1/assets bắt buộc station + machineType enum không có class IOT) và sensor path OFF + identity unbound (38). Durability WAL (OT + inspection) xây xong nhưng default OFF; chuẩn dữ liệu syn/ 6-aspect + Sparkplug + contract-quarantine cũng OFF — nghĩa là 'luật chuẩn hóa' đã viết đủ, việc còn lại chủ yếu là mở 1 endpoint process-result cho máy, thêm class/registry IoT, siết 2 default yếu, và bật các cờ enforce theo lộ trình warn-then-deny đã có sẵn telemetry.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- machineAuthService (mk_ key hash-at-rest, scopes, rate-limit per-key, weak-auth telemetry warn-then-deny, DbUnavailableError seam) — server/services/machineAuthService.ts — dùng NGUYÊN cho máy automation/IoT, không xây auth mới
- Một bảng api_keys phục vụ cả /v1 lẫn machine tRPC (mig 0126+0178: machineId, revokedAt) — drizzle/schema + server/api/v1/auth.ts — credential model thống nhất sẵn
- Claim token (mct_) + zero-touch enrollment token (met_, allowlist serialPattern + maxUses, mig 0283) — server/db/hierarchy.ts:530-1060 — lifecycle cấp khoá không cần admin từng máy, tái dùng cho fleet IoT
- /api/ot/ingest + telemetryBus + ot_telemetry unique (deviceId,metric,ts) 0247 ON CONFLICT DO NOTHING — server/_core/index.ts:356, drizzle/schema/ot.ts — đường telemetry idempotent generic cho MỌI thiết bị, gateway pattern (1 credential N deviceId) đã hỗ trợ
- inspectionStoreForward + ot/storeForward (WAL JSONL + backfill idempotent + dead-letter, bounded) — server/services/inspection/inspectionStoreForward.ts, server/services/ot/storeForward.ts — chỉ cần bật cờ
- submitInspectionBatch pattern (auth-once, heartbeat-once, per-item isolation, rate-charge per item) — server/routers/machineApiRouters.ts:2568 — template cho batch process-result
- MQTT topic ACL thuần + admission gate (canPublish/canSubscribe, matchesMqttFilter, pairing scope) — server/services/mqttService.ts:466-870 — mở rộng cho namespace sensor/iot thay vì viết ACL mới
- contracts/canonical 6 JSON schema (telemetry/state/event/health/command/command_ack) + CONTRACT_VALIDATE_INGEST_MODE quarantine seam — contracts/canonical/, server/services/mqttService.ts:191 — chuẩn payload đã công bố, chỉ việc enforce
- UNS publisher + Sparkplug B + topicV2 ISA-95 + isa95Resolver — server/services/unsPublisher.ts, server/services/uns/ — đường chuẩn hóa topic cho thiết bị mới
- equipmentRegistry + capabilityModel (SCREWDRIVE/DISPENSING/ASSEMBLY profiles đã có, T_TORQUE/T_VOLUME telemetry tags) + registerCapabilityProfile register-and-go — server/services/equipment/capabilityModel.ts:360-430 — thêm class IOT không cần sửa core
- OT driverRegistry 6 protocol + ConnectionSupervisor HA + deadband 0253 — server/services/ot/ — southbound automation sẵn khung
- edgeGatewayRuntime + edge_nodes registry + UNS store-forward biên ≥24h — server/services/edge/edgeGatewayRuntime.ts, drizzle/schema/edge.ts — mô hình edge tự chủ khi cần tách gateway
- st4i-standard adapter + hotFolderService + doc 28 spec (JSON/CSV/XML, spec_version additive-only) — server/services/vision/adapters/st4iStandard.ts — KHUÔN MẪU viết spec tương tự cho automation feed (st4i process-result spec)
- /v1 openapi.json + asyncapi.json self-describe + envelope {ok,data,error} + v1Guard license/audit — server/api/v1/, server/_core/index.ts:1037-1047 — bộ khung công bố contract
- webhookBridge HMAC-signed outbound (inspection.committed, equipment.command.executed...) — server/api/v1/webhookBridge.ts — kênh đẩy sự kiện cho hệ thống IoT nội bộ tiêu thụ
- processResultService + genealogy hash-chain (serialNumber, stepType, metrics, recipeRef) — server/services/processResultService.ts — bảng đích đúng cho automation, chỉ thiếu cửa machine-credential
- Rate-limit 3 tầng theo credential (createMachineIngestLimiter R6 body-key sau NAT, createOtIngestLimiter, per-key 600/min) — server/_core/index.ts:287-311 — không cần thiết kế lại throttling

**Findings (12):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| CONN-1 | P0 | MISSING | automation,iot | Máy automation không có đường machine-credential để ghi process-result per-unit (screw/glue/weld) | ✔ CONFIRMED |
| CONN-2 | P0 | LIVE | all | Đường auth yếu default-ALLOW: shared plaintext key + bare machineCode (không secret) vẫn ingest được | ◐ PARTIAL |
| CONN-3 | P1 | LIVE | iot,aoi_avi | MQTT identity spoofable mặc định: deviceId tự khai qua username, password opt-in, mTLS OFF, admission log-only | ✔ CONFIRMED |
| CONN-4 | P1 | MISSING | iot | Không có registry first-class cho thiết bị IoT — mqtt_clients hình-tablet, /v1/assets bắt buộc station + machineType enum | ✔ CONFIRMED |
| CONN-5 | P1 | LIVE | all | Phân mảnh 5-6 đường ingest với 3+ kiểu credential — chưa tuyên bố đường CHUẨN cho thiết bị mới; ADAPTER_SDK.md stale | ✔ CONFIRMED |
| CONN-6 | P1 | FLAG_OFF | all | Durability store-forward (OT WAL + inspection WAL) default OFF — DB down là mất telemetry, máy ăn error | ◐ PARTIAL |
| CONN-7 | P2 | MISSING | all | Versioning giao thức không đồng nhất: /v1 URL-versioned + OpenAPI/AsyncAPI, còn tRPC machineApi KHÔNG có version negotiation | — |
| CONN-8 | P2 | FLAG_OFF | iot | MQTT sensor ingest (factory/{fId}/{machineCode}/sensor/{type}) flag OFF + identity từ topic không bind với deviceId đã authenticate + nằm ngoài topic ACL | — |
| CONN-9 | P2 | FLAG_OFF | automation | Đường southbound automation (PLC poll): 6 OT driver registered LIVE nhưng edge gateway process OFF, mDNS join thiếu lib, HW chưa FAT | — |
| CONN-10 | P2 | FLAG_OFF | all | Chuẩn dữ liệu UNS syn/ 6-aspect + Sparkplug + contract validation + NATS đều default OFF — 'chuẩn hóa dữ liệu API' trên MQTT chưa enforce | — |
| CONN-11 | P3 | MISSING | aoi_avi,automation | REST /v1 thiếu batch ingest tương đương tRPC; vài inconsistency nhỏ (heartbeat bắt buộc apiKey) | — |
| CONN-12 | P3 | FLAG_OFF | aoi_avi | variantCode trên MQTT points-config-changed (doc 55): code xong + test xanh, gated PRODUCT_VARIANT_ENABLED OFF; ACL phủ variant theo cấu trúc | — |

#### CONN-1 [P0/MISSING] Máy automation không có đường machine-credential để ghi process-result per-unit (screw/glue/weld)

- **Khoảng trống:** Một máy bắt vít muốn báo 'serial X, bước torque-4, pass, torque=1.2Nm' không có endpoint nào nhận bằng mk_ key: submitInspection sai semantics (ghi vào product_inspections + yield FPY), /api/ot/ingest mất liên kết serial/genealogy, còn processResult.record đúng bảng thì chỉ user session gọi được. Đây là chỗ chặn onboard chuẩn hóa nhóm automation.
- **Khuyến nghị:** Mở machine-facing procedure (vd machineApi.submitProcessResult hoặc POST /api/v1/ingest/process-result, scope ingest:write) wrap recordProcessResult, tái dùng authenticateMachine + enforceMachineIngestRateLimit + idempotencyKey pattern của submitInspection; thêm batch tương tự submitInspectionBatch.
- **Bằng chứng:** `server/routers/processResultRouter.ts:32` — processResult.record là protectedProcedure — bắt buộc USER SESSION (cookie login), máy không thể gọi bằng mk_ key · `server/services/processResultService.ts:46` — recordProcessResult có semantics đúng cho automation (serialNumber + stepType + result pass/fail + metrics + recipeRef + genealogy chain) nhưng không expose cho machine credential · `server/_core/index.ts:356` — /api/ot/ingest chỉ nhận CanonicalSample timeseries — không có serial-unit result, không link genealogy · `server/routers/machineApiRouters.ts:586` — submitInspection mang semantics inspection AOI (product_inspections, OK/NG/NTF, points config, NG alert) — dùng cho kết quả bắt vít/điểm keo là shoehorn sai bảng
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONN-2 [P0/LIVE] Đường auth yếu default-ALLOW: shared plaintext key + bare machineCode (không secret) vẫn ingest được

- **Khoảng trống:** Ai trong LAN biết machineCode là giả được máy và bơm inspection/NG. Toàn bộ hạ tầng rotate (mk_ key, claim token 0273, enrollment token 0283, tri-state read-only, rotation report script) đã LIVE nhưng cờ sản xuất chưa siết. Mở rộng thêm 2 nhóm máy mới trên nền default yếu sẽ nhân rủi ro nền tảng.
- **Khuyến nghị:** Trước khi onboard automation/IoT: chạy machine-key-rotation-report, rotate hết máy AOI hiện có sang mk_, flip 2 cờ theo lộ trình allow→read-only→deny (runbook doc 52). QUY ĐỊNH máy nhóm mới CHỈ được cấp mk_/enrollment token ngay từ đầu — không mở đường machineCode cho chúng.
- **Bằng chứng:** `server/services/machineAuthService.ts:125` — sharedMachineKeyPolicy() default "allow" (MACHINE_SHARED_KEY_ALLOWED unset) · `server/services/machineAuthService.ts:133` — machineCodeOnlyPolicy() default "allow" — doc 51 §5.6 ghi nhận machineCode-only vẫn là phương thức DOCUMENTED chính · `server/services/machineAuthService.ts:523` — Nhánh machineCode-only: KHÔNG có secret nào, chỉ tra getMachineByCode rồi cho qua khi policy=allow · `server/services/machineAuthService.ts:317` — Warn-then-deny telemetry (recordWeakAuthUse + Prometheus) đã có sẵn để flip an toàn — chưa flip
- **Kiểm chứng đối kháng (PARTIAL):** Các bằng chứng code-default đều đúng nguyên văn: sharedMachineKeyPolicy default 'allow' (machineAuthService.ts:125), machineCodeOnlyPolicy default 'allow' (:133), nhánh machineCode NO-secret (:523-542), telemetry warn-then-deny (:317). NHƯNG headline 'shared plaintext key ... vẫn ingest được' SAI với hệ đang chạy: .env:607 MACHINE_SHARED_KEY_ALLOWED=false → shared-key bị DENY live (đã flip). Chỉ còn nửa machineCode-only là ĐÚNG/LIVE: MACHINE_CODE_ONLY_ALLOWED KHÔNG có trong .env (grep .env = chỉ 4 cờ, thiếu nó) → default allow → biết machineCode giả được máy submitInspection thật. Nên: đúng phần machineCode, sai phần shared-key (đã siết).

#### CONN-3 [P1/LIVE] MQTT identity spoofable mặc định: deviceId tự khai qua username, password opt-in, mTLS OFF, admission log-only

- **Khoảng trống:** Topic ACL (default ON) chỉ giới hạn 'device nào được topic nào' nhưng KHÔNG chứng minh 'client này đúng là device đó': attacker connect với username = deviceId của thiết bị APPROVED không password sẽ thừa hưởng nguyên branch avi/client/{id} của nó. Với IoT tự phát triển (đông, rẻ, dễ lộ credential) đây là mô hình trust không đạt chuẩn hóa.
- **Khuyến nghị:** Chuẩn onboarding MQTT cho thiết bị mới: bắt buộc per-device password (đã có hash-at-rest 0178 + upgrade tự động) hoặc mTLS device cert (deviceIdentityService đã có, doc 37 PKI); bật MQTT_REQUIRE_PASSWORD + MQTT_ADMISSION_ENFORCE sau giai đoạn quan sát; nêu rõ trong SOP đăng ký thiết bị.
- **Bằng chứng:** `server/services/mqttService.ts:1250` — authenticate parse username 'deviceId:deviceName:deviceModel' — deviceId là identity duy nhất, tự khai · `server/services/mqttService.ts:1277` — Password chỉ verify khi MQTT_REQUIRE_PASSWORD=true VÀ device row có passwordHash/password — thiết bị APPROVED chưa đặt password bị chiếm deviceId tự do · `server/services/mqttService.ts:385` — MQTT_REQUIRE_PASSWORD default false · `server/services/mqttService.ts:404` — MQTT_MTLS_ENABLED default OFF; admission gate MQTT_ADMISSION_ENFORCE default false (dòng 572 — flag+log only)
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONN-4 [P1/MISSING] Không có registry first-class cho thiết bị IoT — mqtt_clients hình-tablet, /v1/assets bắt buộc station + machineType enum

- **Khoảng trống:** Thiết bị IoT nội bộ hiện phải giả dạng 'machine tại station' (machines table) hoặc 'tablet' (mqtt_clients) để tồn tại trong hệ thống. Không có nơi khai: loại thiết bị IoT, firmware, schema metric nó phát, credential lifecycle riêng. Mục tiêu 'tiêu chuẩn hóa đăng ký & kết nối' cho nhóm iot chưa có chỗ đứng dữ liệu.
- **Khuyến nghị:** Thêm device class IOT_SENSOR/IOT_GATEWAY (register-and-go capability profile đã hỗ trợ class mới không cần sửa core) hoặc bảng iot_devices riêng nối machines/stations optional; cho phép /v1/assets đăng ký asset không-station; tái dùng api_keys.machineId pattern cho credential per-device.
- **Bằng chứng:** `drizzle/schema/mqtt.ts:8` — mqtt_clients.deviceId comment 'Android ID'; các cột deviceModel (Samsung, Xiaomi), osVersion Android, fcmToken, screenResolution — registry MQTT sinh ra cho TABLET cảnh báo, không phải IoT sensor · `server/api/v1/assets.ts:421` — POST /v1/assets validate class theo machineTypeEnum và bắt buộc stationId tồn tại — sensor môi trường/energy meter không gắn station không đăng ký được · `drizzle/schema/enums.ts:15` — machineTypeEnum 21 giá trị: toàn máy sản xuất (AVI…WAVE_SOLDER) — KHÔNG có class IOT/SENSOR/GATEWAY · `drizzle/schema/ot.ts:108` — ot_telemetry.deviceId là text tự do soft-map (không FK) — telemetry IoT trôi nổi không neo vào danh mục thiết bị nào
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONN-5 [P1/LIVE] Phân mảnh 5-6 đường ingest với 3+ kiểu credential — chưa tuyên bố đường CHUẨN cho thiết bị mới; ADAPTER_SDK.md stale

- **Khoảng trống:** Một integrator máy mới phải tự đoán giữa: tRPC body-credential, REST proxy, /v1 Bearer scoped key, /api/ot/ingest, MQTT, hot-folder. Mỗi đường một tài liệu, một kiểu lỗi, một rate tier. Chưa có 'ONE recommended path per device profile' — đúng tinh thần phân mảnh mà đề bài nghi ngờ. Docs công bố (ADAPTER_SDK, EXTERNAL_INSPECTION_API) lệch code thực.
- **Khuyến nghị:** Ra quyết định chuẩn: profile VISION → /v1/ingest/inspection (hoặc tRPC), profile AUTOMATION → process-result endpoint mới + /api/ot/ingest, profile IOT → /api/ot/ingest hoặc MQTT UNS; đưa /api/ot/ingest vào /v1 (POST /v1/ingest/telemetry) cho versioned + OpenAPI; cập nhật ADAPTER_SDK.md + deprecate master-key query param.
- **Bằng chứng:** `docs/ECOSYSTEM/ADAPTER_SDK.md:157` — Bảng endpoint ghi /orchestration/* là '501 — coming in E2' trong khi code đã live (router.ts:341-485); bảng scope thiếu ~15 scope mới (assets/data/policy/lines/orders/advice) · `server/_core/index.ts:574` — REST proxy /api/machine/submit-inspection song song với tRPC machineApi.submitInspection và /api/v1/ingest/inspection — 3 cửa cùng một pipeline · `server/_core/index.ts:356` — /api/ot/ingest là cửa thứ 4 (telemetry) nằm NGOÀI /api/v1 (không versioned, không trong OpenAPI v1) · `apidocs/EXTERNAL_INSPECTION_API.md:5` — External API còn khuyên dùng master-key qua query param — trái posture least-privilege của /v1 scopes
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONN-6 [P1/FLAG_OFF] Durability store-forward (OT WAL + inspection WAL) default OFF — DB down là mất telemetry, máy ăn error

- **Khoảng trống:** Cơ chế WAL disk-backed + backfill idempotent + dead-letter đã xây hoàn chỉnh và có test, nhưng production profile chưa bật. Máy automation/IoT gửi liên tục sẽ chịu mất mẫu khi DB flap. Device-side thì không có SDK offline buffer nào được publish (không có packages/ hay sdk/ trong repo).
- **Khuyến nghị:** Bật OT_STORE_FORWARD_ENABLED + INSPECTION_STORE_FORWARD_ENABLED trong production profile (đã doc 27 §11); với IoT yếu, viết client reference (retry + idempotencyKey + local queue) như một mẫu SDK mỏng kèm doc 28-style spec.
- **Bằng chứng:** `server/services/ot/storeForward.ts:39` — OT_STORE_FORWARD_ENABLED default OFF — khi tắt, telemetryBus insert fail là SILENTLY DROPPED (chính header file ghi nhận) · `server/services/inspection/inspectionStoreForward.ts:69` — INSPECTION_STORE_FORWARD_ENABLED default OFF (fallback theo OT_STORE_FORWARD_ENABLED cũng OFF) · `server/routers/machineApiRouters.ts:2525` — Cờ tắt → transient DB error throw thẳng về máy thay vì buffer + ACK queued
- **Kiểm chứng đối kháng (PARTIAL):** Các dữ kiện code-default đúng: OT_STORE_FORWARD_ENABLED default OFF (storeForward.ts:39-44), INSPECTION fallback OFF (inspectionStoreForward.ts:69-77), cờ tắt → throw transient về máy (machineApiRouters.ts:2525). .env.example cũng ship OFF (:770). Không có SDK device-side publish (không có packages/ hay sdk/; apps/machine-shell/local-agent/README = 'Spec only') — ĐÚNG. NHƯNG kết luận load-bearing STATUS=FLAG_OFF / 'production profile chưa bật' / 'sẽ mất mẫu khi DB flap' SAI với hệ đang chạy: .env:594 OT_STORE_FORWARD_ENABLED=true VÀ .env:598 INSPECTION_STORE_FORWARD_ENABLED=true đều đã BẬT (doc 27 Đợt 2 prod profile). Cơ chế + code-default đúng, nhưng trạng thái 'đang OFF ở production' bị bác bỏ.

#### CONN-7 [P2/MISSING] Versioning giao thức không đồng nhất: /v1 URL-versioned + OpenAPI/AsyncAPI, còn tRPC machineApi KHÔNG có version negotiation

- **Khoảng trống:** Máy cũ nói chuyện với server mới dựa hoàn toàn vào kỷ luật additive-only zod (optional fields). Khi chuẩn hóa 3 nhóm máy, không có cách nào biết máy đang chạy contract đời nào để deprecate an toàn (ngoài doc 28 spec_version — chỉ vision feed).
- **Khuyến nghị:** Thêm header X-ST4I-Contract-Version (hoặc field protocolVersion) máy gửi kèm, server stamp vào telemetry weak-auth-style; công bố deprecation policy; giữ additive-only như doc 28 §7 làm luật chung.
- **Bằng chứng:** `server/routers/machineApiVersionGate.test.ts:2` — 'machineApiVersionGate' thực chất test spec-gate VERSION-EXACT points-config (0282) — không phải protocol version gate · `server/api/v1/router.ts:578` — /v1/openapi.json self-describe LIVE; _core/index.ts:1047 thêm /api/v1/asyncapi.json cho MQTT · `server/routers/machineApiRouters.ts:2862` — clientVersion chỉ được LƯU (syncMeasurementPoints) — không gate/negotiate hành vi nào · `server/services/plugins/pluginRegistry.ts:5` — apiVersion gate tồn tại nhưng CHỈ cho plugin manifest, không cho machine protocol

#### CONN-8 [P2/FLAG_OFF] MQTT sensor ingest (factory/{fId}/{machineCode}/sensor/{type}) flag OFF + identity từ topic không bind với deviceId đã authenticate + nằm ngoài topic ACL

- **Khoảng trống:** Đây lẽ ra là đường MQTT tự nhiên nhất cho IoT sensor nội bộ nhưng: đang OFF, và khi bật thì mọi client MQTT (kể cả tablet) giả được reading của bất kỳ máy nào. Việc siết topic ngoài brand namespace đã được doc 51 ghi là 'bước sau' — chưa làm.
- **Khuyến nghị:** Khi chuẩn hóa iot: đưa sensor topic vào ACL (map machineCode→deviceId owner qua bảng gán), hoặc chuyển convention sang avi/client/{deviceId}/sensor/... để ACL sẵn có tự phủ; rồi mới bật PDM_SENSOR_INGEST_ENABLED.
- **Bằng chứng:** `server/services/sensorIngestService.ts:21` — PDM_SENSOR_INGEST_ENABLED default false — đường sensor→machine_sensor_readings đang inert · `server/services/sensorIngestService.ts:32` — machineCode lấy từ TOPIC — ai publish topic đó là ghi hộ máy đó, không đối chiếu deviceId authenticate · `server/mqttTopicAcl.test.ts:178` — Test khẳng định deviceA publish 'factory/1/MC-01/sensor/temp' được ALLOW — deliberate out-of-scope của ACL (QĐ#1)

#### CONN-9 [P2/FLAG_OFF] Đường southbound automation (PLC poll): 6 OT driver registered LIVE nhưng edge gateway process OFF, mDNS join thiếu lib, HW chưa FAT

- **Khoảng trống:** Máy bắt vít/điểm keo đời PLC (không HTTP client) sẽ đi đường adapter poll — framework đủ (drivers + supervisor HA + deadband 0253) nhưng chưa từng chạy trên HW thật (doc 54 còn HW-FAT), và mô hình 'edge gateway gần máy' vẫn OFF nên mọi poll đi từ server trung tâm.
- **Khuyến nghị:** Với đợt máy automation nội bộ đầu tiên: FAT 1 driver/1 máy thật (modbus hoặc mitsubishi-mc), sau đó mới quyết bật EDGE_GATEWAY_MODE per-line; cài bonjour-service nếu muốn join wizard mDNS.
- **Bằng chứng:** `server/services/ot/index.ts:18` — registerDriver: stub/opcua/modbus/s7/mitsubishi-mc/ethernet-ip/slmp — đăng ký load-time LIVE · `server/services/edge/edgeGatewayRuntime.ts:48` — EDGE_GATEWAY_MODE default OFF — gateway chỉ chạy trong server process trung tâm; standalone edge (npm run start:edge) chưa dùng · `server/services/edge/joinWizardService.ts:18` — mDNS discovery cần bonjour-service CHƯA cài — discoverPeers() refuse MDNS_NOT_AVAILABLE (static peers dùng được) · `drizzle/schema/ot.ts:33` — device_adapters default status='disabled', isEnabled=false — mọi adapter phải bật tay từng cái

#### CONN-10 [P2/FLAG_OFF] Chuẩn dữ liệu UNS syn/ 6-aspect + Sparkplug + contract validation + NATS đều default OFF — 'chuẩn hóa dữ liệu API' trên MQTT chưa enforce

- **Khoảng trống:** Đã có đủ 'luật' (6 JSON schema canonical, topic v2 ISA-95, Sparkplug B, quarantine seam) nhưng tất cả OFF nên dữ liệu MQTT thực tế vẫn là payload tự do avi/ legacy. Ba nhóm thiết bị mới nếu onboard bây giờ sẽ lại bám topic legacy, tăng nợ chuyển đổi.
- **Khuyến nghị:** Cho thiết bị MỚI (automation/iot): quy định publish theo syn/ contract ngay từ đầu + bật CONTRACT_VALIDATE_INGEST_MODE=log để đo compliance, sau đó quarantine. Máy AOI cũ giữ legacy đến R-3 grace window.
- **Bằng chứng:** `server/services/unsPublisher.ts:6` — UNS_BRIDGE_ENABLED tắt = no-op; UNS_SPARKPLUG_ENABLED default OFF (dòng 94) · `server/services/mqttService.ts:191` — CONTRACT_VALIDATE_INGEST_MODE=off default — validate inbound theo contracts/canonical chỉ chạy khi bật (mode log/quarantine) · `contracts/canonical/telemetry.schema.json:5` — Schema chuẩn syn/{site}/{area}/{line}/{cell}/{equip}/telemetry đã công bố + registry gate — sẵn để enforce · `server/services/streaming/natsAdapter.ts:39` — natsUrl() null khi chưa cấu hình — streaming bus optional chưa bật

#### CONN-11 [P3/MISSING] REST /v1 thiếu batch ingest tương đương tRPC; vài inconsistency nhỏ (heartbeat bắt buộc apiKey)

- **Khoảng trống:** Máy tích hợp qua /v1 (con đường 'chuẩn' được ADAPTER_SDK khuyến nghị) chịu thiệt so với tRPC về throughput sau mất mạng (benchmark doc 53: ~36 insp/s per-request).
- **Khuyến nghị:** Thêm POST /v1/ingest/inspections (mảng) wrap submitInspectionBatch caller; đồng nhất input schema heartbeat.
- **Bằng chứng:** `server/api/v1/router.ts:306` — /v1/ingest/inspection chỉ single-board — máy REST-only reconnect sau outage không có đường batch · `server/routers/machineApiRouters.ts:2568` — submitInspectionBatch (200 board/request, auth-once, per-item isolation) CHỈ có trên tRPC · `server/_core/index.ts:977` — REST /api/machine/heartbeat bắt buộc apiKey trong khi checkPointsVersion/getPoints chấp nhận machineCode — không đồng nhất trong cùng bộ proxy

#### CONN-12 [P3/FLAG_OFF] variantCode trên MQTT points-config-changed (doc 55): code xong + test xanh, gated PRODUCT_VARIANT_ENABLED OFF; ACL phủ variant theo cấu trúc

- **Khoảng trống:** Không phải gap kỹ thuật — trạng thái đúng như doc 55 công bố (default OFF byte-identical). Ghi nhận để trục config-sync/UI biết đường MQTT variant đã sẵn khi bật cờ.
- **Khuyến nghị:** Khi bật PRODUCT_VARIANT_ENABLED, thêm test subscribe-side cho máy chỉ nghe variant của mình (hiện chỉ có test publish-side).
- **Bằng chứng:** `server/services/mqttService.ts:2574` — buildPointsConfigChangedMessage: variantCode thêm level topic avi/points-config-changed/{code}/{variantCode} + payload field; absent = byte-identical · `server/mqttTopicAcl.test.ts:152` — avi/points-config-changed/* là server-only namespace (check segs[1]) → device không publish được ở MỌI depth, kể cả variant level — ACL phủ by construction · `server/routers/machineApiRouters.ts:599` — submitInspection nhận variantCode optional — inert khi PRODUCT_VARIANT_ENABLED OFF (commit 3202693b)


### A.3 Chuẩn hóa dữ liệu API (`api-data-std`) — AOI/AVI **72** · Automation **28** · IoT **35**

**Căn cứ chấm điểm:** aoi_avi 72: ingest zod enforce LIVE + idempotency WAL + provenance 0275 + unit-convert + spec doc 28 + OpenAPI; trừ điểm vì contract v1.0 drift, schemaVersion không enforce, 3 kiểu error envelope, inspectionTime timestamp-không-tz. automation 28: có process_results + machineType SCREWDRIVE/DISPENSING + capability profile nhưng KHÔNG có đường ingest bằng machine credential, không schema/limits/curve per process, không docs, không alarm code. iot 35: telemetryBus + ot_telemetry (timestamptz, quality enum) + canonical UNS schemas là nền tốt nhất hệ nhưng validate + sensor-ingest đều flag OFF, không REST telemetry ingest, không device data contract enforce.

**Tóm tắt trục:** Trục api-data-std: hệ đã có GẦN ĐỦ linh kiện chuẩn hóa dữ liệu API nhưng chúng chưa khớp thành một chuẩn duy nhất và phần enforce chủ yếu nằm sau cờ OFF. (a) Envelope: response {ok,data,error} chuẩn ở /api/v1, nhưng request của máy không có envelope chung — submitInspection là flat body không schemaVersion, UNS syn/... có envelope asset_id/ts/seq nhưng chỉ MQTT, error envelope vẫn 3 kiểu. (b) Taxonomy RESULT/TELEMETRY/EVENT: tách đúng ở tầng bảng (process_results + ot_telemetry + event.schema.json) và 6 canonical JSON-Schema đã viết, song CONTRACT_VALIDATE_INGEST_MODE + CONTRACT_REGISTRY_PERSIST đều default OFF và topic legacy avi/... nằm ngoài mọi contract. (c) Kết quả automation: bảng process_results generic (metrics jsonb) NHẬN ĐƯỢC scalar torque/volume nhưng KHÔNG nhét được curve/profile, không limits, và nghiêm trọng nhất — router ghi là protectedProcedure nên máy không có đường ingest bằng API key: automation hiện phải giả dạng inspection AOI. (d) Đơn vị chỉ chuẩn hóa chiều dài (mm-family); timezone có provenance 0275 LIVE nhưng offset bắt buộc OFF và inspectionTime vẫn timestamp-không-tz; alarm taxonomy ISA-18.2 đẹp + seed 5 vendor servo/PLC/robot nhưng EQ_GOVERN OFF và trống mã cho screw/glue/weld. (e) Contract enforce ở ingest: zod LIVE rất chặt cho AOI nhưng machineDataContract v1.0 công bố đã DRIFT (thiếu ~10 trường mới của doc 51/55) và không được enforce — OpenAPI sinh từ contract cũ nên docs cũng sai. (f) Docs integrator chỉ phủ AOI/AVI. Ưu tiên đề xuất: (1) mở machine-facing submitProcessResult + REST /ingest/process-result tái dùng nguyên pattern durability của submitInspection; (2) hợp nhất contract↔zod một nguồn sự thật + contract-test CI; (3) spec 'ST4I Standard Process Feed v1' theo khuôn doc 28; (4) bật dần validate log→quarantine cho fleet máy mới trên topic syn/...; (5) unit registry đa dimension. Điểm: aoi_avi 72 · automation 28 · iot 35.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- Response envelope {ok,data,error} + wrap() fail-safe + ApiHttpError — server/api/v1/envelope.ts (dùng cho mọi REST ingest mới)
- telemetryBus.CanonicalSample + ot_telemetry single canonical store (timestamptz, quality enum, uq device/metric/ts idempotency) — server/services/telemetryBus.ts + drizzle/schema/ot.ts (IoT telemetry đổ thẳng vào đây, KHÔNG xây store mới)
- Canonical JSON-Schemas 6 loại message + schemaRegistry.checkBackwardCompat + ingestValidation 3-mode (off/log/quarantine) + bảng contract_quarantine — contracts/canonical/*.schema.json, server/services/contracts/{schemaRegistry,ingestValidation}.ts, drizzle/schema/contracts.ts
- machineDataContract versioned registry + z.toJSONSchema export + machineContractRouter.validate — server/contracts/machineDataContract.ts (khuôn versioning cho process-result contract, sau khi sửa drift API-2)
- process_results generic result table (pass/fail/warn/skip + metrics jsonb + getProcessMetricSeries time-bucket) — drizzle/schema/process.ts + server/db/processResult.ts (đích ghi cho automation, chỉ thiếu machine-facing API)
- Spec doc 28 st4i-standard (versioning additive-only + validation rules + conformance fixtures) + vision adapter registry — docs/ECOSYSTEM/28_*.md, server/services/vision/adapters/st4iStandard.ts (+__fixtures__)
- device_types versioned hierarchy + attributesSchema + CR workflow backward-compat + alarm_taxonomy/master_alarms ISA-18.2 (seed 5 vendor thật) — drizzle/schema/equipmentStandards.ts, server/services/standards/*
- Toàn bộ pattern độ bền ingest của submitInspection: authenticateMachine + idempotencyKey/inspection_idempotency_keys + WAL store-forward + provenance serverReceivedAt/timeSkew/timeSource + batch MACHINE_INGEST_BATCH_MAX — server/routers/machineApiRouters.ts:586-836, drizzle/schema/inspection.ts:103-146
- convertMeasuredValueToDefUnit unit-conversion seam (mismatch→skip-gate an toàn) — server/services/pointResultEvaluator.ts:187-202 (mở rộng đa dimension)
- OpenAPI 1249 dòng tay + /openapi.json + AsyncAPI builder + DevPortal tRPC — server/api/v1/openapi.ts, server/services/contracts/apiSpec.ts, docs/ECOSYSTEM/DEVELOPER_PORTAL.md
- API_SCOPES + requireScope + hashed machine key (mk_) lifecycle mint/rotate/revoke — server/api/v1/{scopes,guard}.ts + machineApiRouters listKeys/issueKey/rotateKey/revokeKey
- unsTagMappings per-tag conditioning (rename/scale/offset/unit/cast/deadband) — drizzle/schema/ot.ts:361-401 (chuẩn hóa tag IoT không cần code)

**Findings (12):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| API-1 | P0 | STUB | automation,iot | Máy automation không có đường ingest RESULT bằng machine credential — processResult.record đòi session user | ◐ PARTIAL |
| API-2 | P0 | STUB | aoi_avi | machineDataContract v1.0 đã DRIFT so với schema ingest thực và schemaVersion không được enforce ở ingest | ✔ CONFIRMED |
| API-3 | P1 | FLAG_OFF | all | Taxonomy TELEMETRY/EVENT/STATE/HEALTH đã thiết kế chuẩn (canonical JSON-Schema + quarantine) nhưng enforcement toàn bộ flag OFF | ◐ PARTIAL |
| API-4 | P1 | MISSING | automation | process_results thiếu contract: metrics jsonb tự do — không schema per stepType, không lsl/usl, không nhét được torque CURVE | ✔ CONFIRMED |
| API-5 | P1 | MISSING | all | Không có request-envelope chuẩn chung cho 3 nhóm thiết bị; error envelope vẫn 3 kiểu song song | ✔ CONFIRMED |
| API-6 | P1 | STUB | automation,iot | Chuẩn hóa đơn vị chỉ có chiều dài (mm-family); không canonical unit registry cho torque/volume/pressure/temperature | ◐ PARTIAL |
| API-7 | P1 | FLAG_OFF | all | Alarm taxonomy ISA-18.2 có schema + seed 5 vendor thật nhưng EQ_GOVERN_ENABLED OFF và trống mã cho screw/dispense/weld/AOI | ◐ PARTIAL |
| API-8 | P1 | FLAG_OFF | iot | IoT ingest phân mảnh 3 đường đều flag OFF hoặc thiếu: không REST POST telemetry cho thiết bị HTTP-only | ✖ REFUTED |
| API-9 | P2 | FLAG_OFF | automation,iot | deviceTypes.attributesSchema (contract per device type) chỉ là governance metadata — không validate payload ở bất kỳ seam ingest nào | — |
| API-10 | P2 | FLAG_OFF | aoi_avi | Timezone: rào chắn offset và provenance đã xây (0275) nhưng INGEST_REQUIRE_TIME_OFFSET OFF; cột inspectionTime vẫn timestamp-không-tz với 'fake UTC shift' | — |
| API-11 | P2 | STUB | automation,iot | Docs tích hợp cho bên gắn máy chỉ phủ AOI/AVI — không trang nào cho automation process result hay IoT telemetry | — |
| API-12 | P3 | FLAG_OFF | automation | Spec doc 28 (st4i-standard) là khuôn versioning additive-only tốt nhất hệ nhưng chỉ định nghĩa inspection; hot-folder OFF | — |

#### API-1 [P0/STUB] Máy automation không có đường ingest RESULT bằng machine credential — processResult.record đòi session user

- **Khoảng trống:** Máy bắt vít/điểm keo/hàn muốn gửi kết quả process buộc phải (a) giả dạng inspection AOI (OK/NG/NTF + measurements point-based — sai taxonomy) hoặc (b) không gửi được. Bảng đích và taxonomy result (pass/fail/warn/skip) đã tồn tại nhưng thiếu hẳn seam auth máy (authenticateMachine + API key + idempotency + WAL) như submitInspection có.
- **Khuyến nghị:** Thêm machineApi.submitProcessResult (publicProcedure + authenticateMachine + idempotencyKey + WAL store-forward tái dùng từ submitInspection) ghi vào process_results, và REST POST /api/v1/ingest/process-result với scope ingest:write. Giữ nguyên taxonomy pass/fail/warn/skip, thêm cột provenance như inspection (serverReceivedAt/timeSource).
- **Bằng chứng:** `server/routers/processResultRouter.ts:32` — record: protectedProcedure — cần session cookie user, máy dùng apiKey KHÔNG gọi được; đây là API duy nhất ghi process_results · `server/api/v1/router.ts:306` — REST v1 chỉ có POST /ingest/inspection (reuse submitInspection AOI-shape); grep toàn server không có ingest/telemetry, ingest/event, ingest/process nào khác · `server/routers/machineApiRouters.ts:2480` — submitInspection publicProcedure + apiKey là đường máy DUY NHẤT — chỉ nhận inspection-shape (serialNumber + overallResult OK/NG/NTF + measurements) · `drizzle/schema/process.ts:14` — process_results (serialNumber, stepType, result pass/fail/warn/skip, metrics jsonb) — bảng generic ĐÃ CÓ từ Sprint F2, sẵn sàng nhận torque/dispense
- **Kiểm chứng đối kháng (PARTIAL):** LÕI P0 ĐÚNG: record=protectedProcedure (processResultRouter.ts:32; trpc.ts:129-132 đòi ctx.user → máy apiKey bị UNAUTHORIZED); writer DUY NHẤT của process_results là insertProcessResult (server/db/processResult.ts:7-13) ← recordProcessResult (processResultService.ts:68) ← chỉ router này + test, không idempotencyKey/WAL; REST v1 chỉ có POST /ingest/inspection (server/api/v1/router.ts:306-334); /edge/sync ghi orchestrationRunSteps chứ không phải process_results (edgeCoordinator.ts:397). SAI 2 chi tiết evidence: 'grep toàn server không có ingest/telemetry nào khác' và 'submitInspection là đường máy DUY NHẤT' — POST /api/ot/ingest TỒN TẠI, không cờ gate, auth authenticateMachine (x-api-key/body.apiKey/machineCode) scope ingest:write (server/_core/index.ts:356-373, doc48 R3). Tuy nhiên nó chỉ nhận TELEMETRY CanonicalSample (không serialNumber, không pass/fail) → không thay được RESULT ingest, kết luận P0 giữ nguyên.

#### API-2 [P0/STUB] machineDataContract v1.0 đã DRIFT so với schema ingest thực và schemaVersion không được enforce ở ingest

- **Khoảng trống:** Tồn tại HAI nguồn sự thật song song: contract versioned công bố cho đối tác (cũ, thiếu ~10 trường) và zod ingest thực (mới). Máy tích hợp theo JSON-Schema công bố sẽ không biết idempotencyKey/variantCode/unit — mất luôn các cơ chế chống trùng và variant vừa xây ở doc 51/55. Versioning `schemaVersion` chỉ tồn tại trên giấy vì ingest không nhận trường này.
- **Khuyến nghị:** Sinh machineDataContract TRỰC TIẾP từ submitInspectionCoreObject (export + reuse, thêm bản v1.1 additive) để một nguồn sự thật; thêm trường schemaVersion optional vào submitInspection (default 1.0, log-only trước) và contract test CI so sánh contract vs zod thực (đã có tiền lệ .github/workflows/contract-gate.yml).
- **Bằng chứng:** `server/contracts/machineDataContract.ts:14` — measurementV1 chỉ có 7 trường (pointId/pointCode/measuredValue/result/remark/defectCatalogCode/defectSeverity) — thiếu unit, unitScaleToCanonical, imageBase64, 11 cột valueZ..valueThickness so với schema thực · `server/contracts/machineDataContract.ts:52` — Registry chỉ có 1 phiên bản "1.0"; validateMachinePayload là opt-in (máy tự gọi trước), không nằm trên đường ingest · `server/routers/machineApiRouters.ts:586` — submitInspectionCoreObject là schema THẬT đã tiến hoá (variantCode:603, idempotencyKey:626, pointsConfigVersion:633, panelId/boardIndex:660-661, unit:674) — grep machineDataContract|schemaVersion trong file này = 0 match: contract không được import, payload không khai báo version · `server/api/v1/openapi.ts:132` — InspectionIngest trong OpenAPI sinh từ machineContractJsonSchema(LATEST) — tức OpenAPI công bố cũng thiếu các trường mới: tài liệu drift theo contract
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### API-3 [P1/FLAG_OFF] Taxonomy TELEMETRY/EVENT/STATE/HEALTH đã thiết kế chuẩn (canonical JSON-Schema + quarantine) nhưng enforcement toàn bộ flag OFF

- **Khoảng trống:** Tách RESULT/TELEMETRY/EVENT về mặt bảng đã có (process_results + ot_telemetry + event schema) nhưng lúc ingest không gì được enforce: máy gửi telemetry sai shape vẫn chảy hết vào pipeline; traffic avi/... của máy AOI hiện hành nằm ngoài mọi contract. Khi onboard máy automation/IoT mới sẽ không có gate nào bắt sai schema từ ngày đầu.
- **Khuyến nghị:** Cho fleet máy MỚI (automation/IoT): bật CONTRACT_VALIDATE_INGEST_MODE=log ngay để đo, chuyển quarantine khi ổn; quy định máy nội bộ mới bắt buộc publish lên topic syn/... (đã có subject map + quarantine + UI review). Seed registry (CONTRACT_REGISTRY_PERSIST_ENABLED=true) để version lineage được lưu DB.
- **Bằng chứng:** `contracts/canonical/telemetry.schema.json:29` — Envelope chuẩn asset_id/ts/seq/metrics[] (name,value,unit,quality) required asset_id+ts+metrics — có đủ 6 file: telemetry/state/event/health/command/command_ack · `server/services/contracts/ingestValidation.ts:48` — CONTRACT_VALIDATE_INGEST_MODE default "off" — hook return ngay, không validate gì; mode log/quarantine phải bật tay · `server/services/contracts/ingestValidation.ts:61` — topicToSubject chỉ nhận topic syn/... — topic legacy avi/... (traffic máy AOI thật hôm nay) return null → skip mọi validate ở mọi mode · `drizzle/schema/contracts.ts:16` — contract_schemas registry + BACKWARD compat gate: 'Inert until CONTRACT_REGISTRY_PERSIST_ENABLED=true (default OFF)'
- **Kiểm chứng đối kháng (PARTIAL):** Code đúng như trích: default 'off' (ingestValidation.ts:48-51), topicToSubject chỉ nhận syn/ → topic avi/ trả null skip Ở MỌI MODE (:60-66), registry persist default OFF (drizzle/schema/contracts.ts:16; .env live không set CONTRACT_REGISTRY_PERSIST_ENABLED), đủ 6 file contracts/canonical/*.json. SAI ở 'enforcement toàn bộ flag OFF / mode phải bật tay': .env:685 (doc48 R1 activation) ĐÃ đặt CONTRACT_VALIDATE_INGEST_MODE=log → validate+count+warn đang chạy trên seam thật mqttService.ts:196-198 (validateInboundMqtt) + telemetryBus.ts:609 (filterTelemetrySamples). Hệ quả nêu trong gap vẫn đúng một phần: mode log KHÔNG chặn (applyInvalid trả ok:true, ingestValidation.ts:179-183), quarantine chưa bật, và traffic avi/ của máy AOI vẫn ngoài mọi contract.

#### API-4 [P1/MISSING] process_results thiếu contract: metrics jsonb tự do — không schema per stepType, không lsl/usl, không nhét được torque CURVE

- **Khoảng trống:** Máy bắt vít gửi torque curve, máy keo gửi volume/pressure profile, máy hàn gửi weld profile — hiện chỉ nhét được GIÁ TRỊ CUỐI (scalar) vào metrics; đường cong phải bỏ hoặc tự chế vào ot_telemetry.meta không chuẩn. Không có khái niệm spec limits (min/max torque) per stepType nên server không thể tự gate pass/fail như spec-gate của inspection.
- **Khuyến nghị:** Định nghĩa 'ST4I Standard Process Feed v1' (mô phỏng doc 28): header (machine_code/serial/step_type/recipe/ts offset bắt buộc/result) + metrics[] {name,value,unit,lsl,usl,nominal} + waveforms[] {name,unit,samples[[t,v]]} (cap kích thước, lưu jsonb hoặc file-ref). Thêm bảng process_step_specs (limits per stepType per product) tái dùng pattern measurement_point_definitions.
- **Bằng chứng:** `drizzle/schema/process.ts:26` — metrics: jsonb $type<Record<string, number | string | boolean>> — scalar only: torque curve (mảng điểm thời gian) hoặc weld profile KHÔNG biểu diễn được; không có chỗ cho limits per metric · `server/routers/processResultRouter.ts:25` — zod metrics: z.record(z.union([number,string,boolean])) — xác nhận không nhận array/object lồng nhau · `drizzle/schema/inspection.ts:103` — Đối chứng: inspection có đủ provenance (serverReceivedAt/timeSkewSeconds/clockSkewFlagged/timeSource:127 + idempotencyKey:134 + pointsConfigVersion:141) — process_results không có trường nào tương đương · `docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md:11` — Spec chuẩn công bố duy nhất chỉ định nghĩa 'one inspection result for one board/panel side' — chưa có bản tương đương cho process result
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### API-5 [P1/MISSING] Không có request-envelope chuẩn chung cho 3 nhóm thiết bị; error envelope vẫn 3 kiểu song song

- **Khoảng trống:** Mỗi endpoint một kiểu: máy AOI gửi flat tRPC body, IoT gửi UNS envelope qua MQTT, external API dùng {success,message}. Chuẩn hóa 'đăng ký & truyền nhận' cho 3 nhóm cần MỘT envelope tối thiểu (device identity + ts + schemaVersion + payload type) dùng chung cho HTTP lẫn MQTT — hiện chưa tồn tại và chưa có quyết định thiết kế.
- **Khuyến nghị:** Chốt envelope request chuẩn v1: {schemaVersion, deviceId/machineCode, ts (offset bắt buộc), messageType: result|telemetry|event, seq?, payload} — MQTT dùng nguyên telemetry.schema.json làm gốc, HTTP wrap tương đương. Áp cho endpoint MỚI (process-result, iot telemetry REST) trước, giữ backward cho submitInspection cũ.
- **Bằng chứng:** `server/api/v1/envelope.ts:16` — Response envelope {ok,data,error} nhất quán CHỈ ở /api/v1; tRPC machineApi (đường máy thật) trả shape tRPC riêng · `server/routers/machineApiRouters.ts:586` — submitInspection payload flat — không có id/ts/deviceType/siteId/schemaVersion chuẩn; định danh máy bằng apiKey|machineCode ad-hoc trong body · `contracts/canonical/telemetry.schema.json:10` — UNS envelope (asset_id/ts/seq) chỉ tồn tại cho đường MQTT syn/... — không áp cho HTTP/tRPC ingest · `docs/ECOSYSTEM/51_AVI_AOI_MACHINE_API_AUDIT_AND_UPGRADE_PLAN_2026-07-13.md:187` — Doc 51 xác nhận: 'Error contract phân mảnh 3 kiểu' — tRPC / {ok,data,error} / external {success,message}; §12 mới sửa REST proxy map lỗi thật
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### API-6 [P1/STUB] Chuẩn hóa đơn vị chỉ có chiều dài (mm-family); không canonical unit registry cho torque/volume/pressure/temperature

- **Khoảng trống:** Bài học mil-vs-mm của AOI đã được vá cho chiều dài, nhưng máy bắt vít (Nm/kgf·cm), máy keo (ml/mg/kPa), máy hàn (°C/A) không có bảng chuyển đổi hay danh mục đơn vị chuẩn — hai máy cùng loại gửi đơn vị khác nhau sẽ trộn số liệu sai trong dashboard mà không ai phát hiện. CHƯA CHẮC mức độ ảnh hưởng thực tế vì chưa có máy automation nào đang gửi dữ liệu.
- **Khuyến nghị:** Mở rộng pointResultEvaluator thành unitRegistry đa dimension (length/torque/volume/pressure/temp/current) với canonical unit per dimension; seed bảng units (code, dimension, toCanonicalFactor); validate unit tại ingest process-result mới (reject unit lạ không kèm scale — mạnh tay được vì fleet automation là máy nội bộ mới).
- **Bằng chứng:** `server/services/pointResultEvaluator.ts:187` — convertMeasuredValueToDefUnit: chỉ lengthUnitToMm (um/mil/mm/cm/m/inch, dòng 140-162) + unitScaleToCanonical explicit; khác dimension → mismatch=true và SKIP gate · `drizzle/schema/ot.ts:116` — ot_telemetry.unit là text tự do — không danh mục, không validate · `contracts/canonical/telemetry.schema.json:21` — unit mô tả 'UCUM-ish' — chỉ là khuyến nghị chuỗi, không enforce · `drizzle/schema/equipmentStandards.ts:56` — DeviceTypeAttribute.unit?: string — free text trong attributesSchema, không có bảng đơn vị chuẩn để đối chiếu
- **Kiểm chứng đối kháng (PARTIAL):** Đúng: chuyển đổi tự động chỉ có chiều dài — lengthUnitToMm um/mil/mm/cm/m/inch/nm (pointResultEvaluator.ts:126-162), khác dimension → mismatch=true SKIP gate (:187-202); ot_telemetry.unit text tự do (drizzle/schema/ot.ts:116); 'UCUM-ish' chỉ là mô tả (telemetry.schema.json:21); DeviceTypeAttribute.unit free text (equipmentStandards.ts:56). SAI mệnh đề 'không có bảng chuyển đổi hay danh mục đơn vị chuẩn': units_of_measure (dimension enum length/mass/volume/time/temperature/count/percent/other + isBase, drizzle/schema/masterdata.ts:252-266, enums.ts:313) + unit_conversions (factor+offset affine, hỗ trợ cả °C→°F, masterdata.ts:276-289, mig 0123) TỒN TẠI kèm CRUD masterDataRouter.ts:863-903 — nhưng mig 0123 không seed dòng nào, không consumer nào ngoài CRUD (grep server/ = 2 file router+test), enum thiếu dimension torque/pressure → hệ quả 'trộn số liệu không ai phát hiện' vẫn đúng.

#### API-7 [P1/FLAG_OFF] Alarm taxonomy ISA-18.2 có schema + seed 5 vendor thật nhưng EQ_GOVERN_ENABLED OFF và trống mã cho screw/dispense/weld/AOI

- **Khoảng trống:** Chuẩn hóa EVENT/alarm cho máy automation cần bảng map nativeCode→standardCode nhưng seed hiện tại phủ servo/PLC/robot component — chưa phủ máy hoàn chỉnh nội bộ (bắt vít/keo/hàn). Toàn bộ layer sau cờ OFF nên adapters/andon hiện không normalize mã lỗi nào cả.
- **Khuyến nghị:** Bật EQ_GOVERN_ENABLED ở staging; định nghĩa standardCode set cho 3 họ máy nội bộ (TORQUE_OUT_OF_SPEC, SCREW_FLOAT, GLUE_CLOG, GLUE_PRESSURE_LOW, WELD_TEMP_HIGH...) — vì máy tự phát triển nên đội chủ động quy định nativeCode = standardCode ngay từ firmware, đỡ tầng map.
- **Bằng chứng:** `drizzle/schema/equipmentStandards.ts:125` — alarm_taxonomy (vendor nativeCode → standardCode + ISA-18.2 severity + recommendedAction) + master_alarms (181) rationalization/shelving đầy đủ · `server/routers/equipmentStandardsRouter.ts:90` — Mọi procedure throw CONFLICT 'Equipment governance disabled (set EQ_GOVERN_ENABLED=true)' — default OFF · `server/services/standards/alarmTaxonomyVendorSeed.ts:34` — Seed thật từ manual vendor nhưng chỉ 5 vendor (delta/fanuc/mitsubishi/omron/zmotion) × 4 machineType (SERVO/PLC/ROBOT/MOTION) — không có mã lỗi máy bắt vít, máy keo, máy hàn, và cũng không có AOI · `docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md:79` — defect_code IPC-A-610 là taxonomy LỖI SẢN PHẨM cho inspection — không thay được taxonomy ALARM THIẾT BỊ cho automation
- **Kiểm chứng đối kháng (PARTIAL):** Đúng phần gap phủ: alarm_taxonomy (equipmentStandards.ts:125) + master_alarms (:181) tồn tại; seed KHÔNG có mã alarm cho máy bắt vít/keo/hàn/AOI (grep SCREW|DISPENS|WELD|AOI trong services/standards chỉ ra deviceTypeRegistry.ts:100,104 map device-type, 0 alarm code; machineType seed chỉ SERVO/PLC/ROBOT/MOTION + AUTOMATION). SAI 3 điểm: (1) cờ KHÔNG off — .env:544 EQ_GOVERN_ENABLED=true VÀ .env:547 EQ_INTEG_ENABLED=true → tầng normalize adapter→Andon đang hoạt động (alarmNormalizer.ts:37-39 gate EQ_INTEG; mapAlarm được gọi runtime tại focasAdapter.ts:149, euromapAdapter.ts:130, mtconnectFieldMap.ts:234, adapterAlarmBridge.ts:66) → 'hiện không normalize mã lỗi nào cả' sai; (2) 'Mọi procedure throw CONFLICT' sai — requireFlag() chỉ ở 9 mutation, read ops (status:146, listAlarmMappings:181, mapAlarm:194) mở không cần cờ (header equipmentStandardsRouter.ts:17-23); (3) '5 vendor' thiếu chính xác — vendorSeed có 6 key gồm universal-robots (alarmTaxonomyVendorSeed.ts:93-116), cộng kuka/siemens/universal_robots ở seed minh hoạ (alarmTaxonomy.ts:59-74).

#### API-8 [P1/FLAG_OFF] IoT ingest phân mảnh 3 đường đều flag OFF hoặc thiếu: không REST POST telemetry cho thiết bị HTTP-only

- **Khoảng trống:** Mục tiêu 'thiết bị IoT nội bộ tự phát triển dùng API để kết nối/truyền nhận' hiện chỉ đạt được qua MQTT syn/... (không validate) hoặc topic sensor/... (cờ OFF, chỉ numeric đơn). Thiết bị HTTP-only (ESP32 gọi REST) không có endpoint. Ba đường không chung device-identity model (machineCode vs deviceId vs adapter.code).
- **Khuyến nghị:** Thêm POST /api/v1/ingest/telemetry (scope ingest:write, batch CanonicalSample[], validate bằng telemetry.schema.json qua ingestValidation source 'api' — enum đã có sẵn) đổ vào telemetryBus.ingestTelemetry; bật PDM_SENSOR_INGEST_ENABLED cho fleet sensor MQTT; chốt quy ước deviceId thống nhất giữa 3 đường.
- **Bằng chứng:** `server/services/sensorIngestService.ts:29` — Đường 1 — MQTT topic factory/{factoryId}/{machineCode}/sensor/{sensorType} → machine_sensor_readings, sau cờ PDM_SENSOR_INGEST_ENABLED default false (dòng 21-23) · `server/services/telemetryBus.ts:45` — Đường 2 — CanonicalSample → ot_telemetry: LIVE nhưng chỉ reader nội bộ (OT drivers, MQTT broker) gọi; không expose cho thiết bị HTTP · `server/api/v1/router.ts:185` — Đường 3 — /equipment/:id/telemetry chỉ GET (đọc); grep toàn server không có POST ingest/telemetry — thiết bị IoT HTTP-only không có endpoint đẩy dữ liệu · `server/services/iolink/ioLinkProfile.ts:17` — Path HTTP/REST của IO-Link master là 'DESCRIPTOR/seam only... no HTTP OtDriver registered today' + validationStatus assumed
- **Kiểm chứng đối kháng (REFUTED):** Hai vế chính của finding đều sai. (1) 'Thiết bị HTTP-only không có endpoint đẩy dữ liệu / grep toàn server không có POST ingest telemetry': POST /api/ot/ingest TỒN TẠI và LIVE không cờ gate (server/_core/index.ts:334-408, doc48 R3 'HIGH-THROUGHPUT OT TELEMETRY INGEST (machine-to-machine)'), auth per-machine authenticateMachine qua x-api-key/body.apiKey/machineCode scope ingest:write (:367-373), body {samples: CanonicalSample[]} → ingestTelemetry → ot_telemetry, rate-tier riêng; hỗ trợ cả gateway 'one gateway credential forwards many devices' qua deviceId (:375-380) — đây chính là REST POST telemetry cho ESP32/IoT nội bộ, đồng thời bác luôn evidence 2 'telemetryBus không expose cho thiết bị HTTP'. (2) 'đều flag OFF': .env:540 PDM_SENSOR_INGEST_ENABLED=true — đường MQTT sensor/ đang BẬT ở env live (default false chỉ đúng trong code + .env.example:1011). Phần còn đúng lẻ tẻ (ioLink HTTP driver chỉ là seam ioLinkProfile.ts:17-21; /api/v1 chỉ GET /equipment/:id/telemetry router.ts:185) không đủ giữ headline P1.

#### API-9 [P2/FLAG_OFF] deviceTypes.attributesSchema (contract per device type) chỉ là governance metadata — không validate payload ở bất kỳ seam ingest nào

- **Khoảng trống:** Hệ đã có sẵn cơ chế 'mỗi device type một contract dữ liệu versioned + backward-compat gate' — đúng thứ cần cho chuẩn hóa automation/IoT — nhưng nó chưa nối vào validation dữ liệu thật. Máy khai deviceType SCREWDRIVE vẫn gửi metrics tên gì cũng được.
- **Khuyến nghị:** Khi xây submitProcessResult (API-1): resolve deviceType của máy → validate metrics[] theo attributesSchema (mode log trước). Như vậy device_types trở thành nơi DUY NHẤT khai báo 'máy loại X gửi trường gì, kiểu gì, đơn vị gì' — trùng khớp mục tiêu 'tiêu chuẩn hóa quản lý cấu hình'.
- **Bằng chứng:** `drizzle/schema/equipmentStandards.ts:85` — attributesSchema: DeviceTypeAttribute[] (name/dataType/unit/required) — về lý thuyết là contract dữ liệu per device type, có version SemVer + CR workflow backward-compat · `server/routers/hierarchyRouters.ts:97` — Điểm enforce duy nhất: commissionGovernanceWarning khi TẠO máy — 'Ở mức CẢNH BÁO (không chặn)' và cũng sau cờ eqGovernEnabled() OFF · `server/routers/machineApiRouters.ts:586` — Grep deviceTypeRegistry/attributesSchema trên 15 file dùng nó: không file nào là seam ingest (machineApiRouters/telemetryBus/mqttService không import) — payload máy không bao giờ được so với attributesSchema

#### API-10 [P2/FLAG_OFF] Timezone: rào chắn offset và provenance đã xây (0275) nhưng INGEST_REQUIRE_TIME_OFFSET OFF; cột inspectionTime vẫn timestamp-không-tz với 'fake UTC shift'

- **Khoảng trống:** Doc 28 bắt buộc offset cho máy vendor ngoài, nhưng đường machineApi nội bộ vẫn nhận giờ naive (tag machine_naive). Với máy automation/IoT MỚI (tự phát triển firmware) không có lý do chấp nhận naive time — nếu tái dùng pattern inspection sẽ kế thừa luôn hack fake-UTC.
- **Khuyến nghị:** Endpoint ingest MỚI cho automation/IoT: bắt buộc offset ngay từ v1 (không cần cờ backward vì fleet mới); cột thời gian dùng timestamptz như ot_telemetry. Cho AOI cũ: theo dõi tỉ lệ timeSource=machine_naive rồi bật INGEST_REQUIRE_TIME_OFFSET theo lộ trình doc 51 QĐ#1.
- **Bằng chứng:** `server/routers/machineApiRouters.ts:720` — refineInspectionTime: parseable luôn enforce; explicit UTC offset CHỈ khi INGEST_REQUIRE_TIME_OFFSET bật (default OFF — chờ telemetry timeSource nói fleet sẵn sàng) · `drizzle/schema/inspection.ts:111` — Provenance LIVE mọi row: serverReceivedAt/timeSkewSeconds/clockSkewFlagged/timeSource (machine_utc|machine_naive|server) — đo được thiệt hại lệch giờ · `server/routers/machineApiRouters.ts:821` — inspectionAlreadyPersisted áp 'fake UTC' shift (raw.getTime() − getTimezoneOffset()*60000) — hack bù cột timestamp không timezone, dễ vỡ nếu đổi TZ server · `drizzle/schema/ot.ts:103` — Đối chứng: ot_telemetry.ts là timestamp withTimezone — chuẩn đúng đã có sẵn trong hệ

#### API-11 [P2/STUB] Docs tích hợp cho bên gắn máy chỉ phủ AOI/AVI — không trang nào cho automation process result hay IoT telemetry

- **Khoảng trống:** Đội firmware nội bộ làm máy bắt vít/IoT sẽ không tìm được tài liệu 'gửi dữ liệu thế nào' — mọi hướng dẫn hiện hữu đều là inspection AOI. Nguy cơ mỗi đội tự chế format riêng, phá mục tiêu chuẩn hóa ngay từ đầu.
- **Khuyến nghị:** Sau khi chốt API-1/API-4: thêm section 'Automation Process Feed' + 'IoT Telemetry' vào ApiDocs.tsx (payload mẫu + error codes + idempotency) và channel AsyncAPI tương ứng; sinh từ code (như InspectionIngest) để không drift.
- **Bằng chứng:** `client/src/pages/ApiDocs.tsx:90` — Menu Third-Party Integration: Machine Sync / Hierarchy Tree & MQTT (+ machineApi, inspection) — grep torque|screw|glue|process result|iot trong 3556 dòng = 0 nội dung cho 2 nhóm máy mới · `docs/ECOSYSTEM/DEVELOPER_PORTAL.md:6` — Portal trỏ OpenAPI 3.1 + AsyncAPI 2.6 qua trpc.devPortal — có thật nhưng AsyncAPI seed chỉ 4 channel (telemetry/events/cmd/robot state), không channel process-result · `server/services/contracts/apiSpec.ts:100` — SEED_UNS_CHANNELS: 4 channel; payloadRef Telemetry/EquipmentEvent/Command/RobotState — xác nhận phạm vi AsyncAPI hiện tại · `docs/ECOSYSTEM/51_AVI_AOI_MACHINE_API_AUDIT_AND_UPGRADE_PLAN_2026-07-13.md:346` — Doc 51 đã cảnh báo doc-drift: EXTERNAL_INSPECTION_API.md không nhắc /api/v1, envelope khác nhau → integrator parse sai

#### API-12 [P3/FLAG_OFF] Spec doc 28 (st4i-standard) là khuôn versioning additive-only tốt nhất hệ nhưng chỉ định nghĩa inspection; hot-folder OFF

- **Khoảng trống:** Toàn bộ kỷ luật versioning (spec_version, additive-only, reject-unsupported, rawExtras) mới chỉ áp cho inspection feed. Ba nhóm máy chuẩn hóa cần cùng kỷ luật này ở mọi payload — hiện chưa được nâng thành quy tắc chung của mọi contract (submitInspection còn không nhận schemaVersion — xem API-2).
- **Khuyến nghị:** Nâng §7 doc 28 thành 'ST4I Data Contract Policy' áp cho mọi feed (inspection/process/telemetry/event); viết 'ST4I Standard Process Feed v1' theo cùng template + conformance fixtures như st4i-standard đã có.
- **Bằng chứng:** `docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md:327` — §7 versioning: spec_version required, additive-only trong major, unknown fields → rawExtras lossless, reject version lạ — đúng chuẩn muốn nhân rộng · `server/services/vision/index.ts:28` — Adapter st4i-standard registered thật cùng koh-young/cognex/keyence/tri (side-effect import) · `server/services/vision/hotFolderService.ts:37` — Master flag HOT_FOLDER_INGEST_ENABLED default OFF — đường file-drop chưa chạy production


### A.4 Chuẩn hóa cài đặt & đồng bộ cấu hình (`config-sync`) — AOI/AVI **72** · Automation **38** · IoT **12**

**Căn cứ chấm điểm:** aoi_avi 72: chuỗi points-sync trọn vẹn và LIVE (bump atomic + poll checkPointsVersion + deltaSync tombstone + MQTT notify + UI-bump doc51-P0 đã vá + stale/ahead tagging tại ingest), trừ điểm vì mọi lớp hardening (optimistic-lock, snapshot-gate, variant, fiducial) default-OFF, không có staged rollout, MQTT_ENABLED opt-in. automation 38: catalog recipe versioned+approve+rollback+UI LIVE nhưng thiếu toàn bộ last-mile (máy không pull được recipe, không notify, đẩy thật DRY-RUN, payload không schema, drift = 0). iot 12: chỉ có kênh configure MQTT ad-hoc không version/không persist/không desired-state; chưa có entity thiết bị IoT.

**Tóm tắt trục:** Trục config-sync phân hóa rõ theo 3 nhóm máy. (a) Cơ chế đồng bộ hiện tại KHÔNG generic: toàn bộ chuỗi version/delta/tombstone/MQTT-notify hard-wired vào measurement points của AOI (version sống ở product_models, payload là points/fiducials/lighting, topic avi/points-config-changed) — chất lượng rất cao và LIVE, nhưng automation/IoT không tái dùng trực tiếp được. (b) Recipe automation có catalog chuẩn đáng ngạc nhiên (machine_recipes versioned + second-approver + golden + ledger + rollback + recipe-set cấp line + UI RecipeManagement, machineType đã liệt kê SCREWDRIVE/DISPENSING) nhưng đứt ở last-mile: payload jsonb không schema, máy không có endpoint pull recipe bằng apiKey, và cả 3 đường đẩy xuống máy thật (commandDispatcher select_recipe, SECS-GEM S7, DPC deploy) đều DRY-RUN/flag-OFF. (c) Drift 2 chiều: AOI có nửa chiều (máy khai pointsConfigVersion tại ingest → tag stale/ahead LIVE); recipe automation = 0 (ST4I program_version bị strip, verifyItems chỉ đọc catalog, configDriftService chỉ cover adapter server-side và OFF). (d) parameterGuardrails thiết kế generic đúng hướng (machine|machine_type × paramKey) nhưng PARAM_GUARDRAIL_ENABLED OFF và chỉ chặn đường set_machine_param — recipe payload đi vòng không bị check. (e) Staged rollout chỉ có cho DPC programs (canary fleetRollout, simulated); recipe và points-config là fan-out tức thì, rollback thì có (previousRecipeId, revertPointsConfig). (f) Doc 51 P0 XÁC NHẬN ĐÃ VÁ LIVE không cờ: mọi sửa/xóa điểm đo trên UI đi qua bumpAndNotifyPointsConfig (bump atomic propagate lỗi + MQTT best-effort), chỉ phụ thuộc vận hành MQTT_ENABLED. Doc 55 (variant/fiducial/single-tx) đúng như tuyên bố: code + test đủ, mọi cờ default-OFF nên chưa có giá trị production. Con đường chuẩn hóa ngắn nhất là NHẤC các pattern sẵn có (bump-atomic+delta+notify, catalog+approve, canary, drift-hash) lên tầng generic (machine, configKind) thay vì xây mới.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- Pattern version-sync trọn vẹn của points AOI để generic hóa: bumpPointsConfigVersion atomic (col=col+1 RETURNING, chống lost-update) + checkPointsVersion poll + deltaSyncPoints diff-since-version + tombstone deletedCodes — server/routers/machineApiRouters.ts (3320, 3432, 3960) + server/db/product.ts
- Catalog recipe versioned sẵn cho automation: machine_recipes (code+version, checksum, isGolden, second-approver, unique-active-per-code) + recipe_deployments (ledger + previousRecipeId rollback, cột commandLogId chờ wire) — drizzle/schema/ot.ts:151/198; machineTypeEnum đã có SCREWDRIVE/DISPENSING/ROBOT
- machineRecipeRouter đầy đủ vòng đời approve(SoD)/deploy/rollback/setGolden/genealogy với actuation 2FA + license MOD_OT_CONTROL — server/routers/machineRecipeRouter.ts; UI RecipeManagement.tsx (diff LineDiff, ledger, golden)
- recipeSetService cấp line: recipe set theo sản phẩm + distribute + verify + khóa suốt lô + verifyRecipeSetRef cho lineReadiness — server/services/lineController/recipeSetService.ts (mig 0259)
- parameterGuardrails generic (scope machine|machine_type × paramKey) + parameter_change_log closed-loop verify + parameterGuardrailService (resolve/check/strict) — drizzle/schema/parameterGuardrails.ts, server/services/ai/parameterGuardrailService.ts (mig 0261)
- DPC pipeline staged deploy: program_projects/artifacts/builds/sim_runs/deployments (four-eyes, HITL sign-off, staging→production, idempotencyKey) + fleetRollout canary→promote+autoRollback — drizzle/schema/programming.ts, server/services/programming/fleetRollout.ts
- configDriftService: hash chuẩn secret-redacted + stableStringify + baseline approve + sweep non-overlapping + alert 1-lần-per-episode — server/services/assetRegistry/configDriftService.ts (pattern drift tái dùng cho recipe/IoT, mig 0252)
- Hạ tầng MQTT sẵn: ACL topic per-device (canPublish/canSubscribe doc51-P0), sendConfigureCommand + CONFIGURE_ACK + mqttMessageLogs, dual-publish avi/↔synapse/, contract validate syn/* (CONTRACT_VALIDATE_INGEST_MODE) — server/services/mqttService.ts (763, 1607, 1563)
- authenticateMachine per-machine apiKey + scopes (ingest:write/equipment:read) + rate-limit + key-rotation signal trong heartbeat — server/services/machineAuthService.ts (dùng chung cho endpoint config generic mới)
- SECS-GEM S7 PP↔recipe binding (PPID=code@v, PP body = JSON envelope của machine_recipes) cho máy hỗ trợ GEM — server/services/secsgem/gem300.ts:660
- st4iStandard adapter + visionAdapterRegistry đã parse program_name/program_version từ feed máy (hot-folder + API) — server/services/vision/adapters/st4iStandard.ts:110, docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md
- Golden baseline pattern có approve-SoD + one-active-per-key DB invariant: goldenSampleReferences (AOI) và isGolden (recipe) — drizzle/schema/goldenSample.ts, mẫu cho 'golden config' automation

**Findings (10):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| CONFIG-SYNC-1 | P0 | MISSING | automation,iot | Pipeline version-sync (version/delta/tombstone/notify) hard-wired cho measurement points AOI — máy automation/IoT không có đường pull config tương đương | ✔ CONFIRMED |
| CONFIG-SYNC-2 | P0 | MISSING | automation,iot | Drift detection recipe = 0: máy không có kênh báo config/recipe ĐANG CHẠY; ST4I program_version bị strip; 'xác nhận nạp' chỉ đọc catalog server | ✔ CONFIRMED |
| CONFIG-SYNC-3 | P1 | MISSING | automation | machine_recipes.payload là jsonb TỰ DO — không có schema chuẩn per machineType cho torque-sequence/glue-path/weld-profile | ✔ CONFIRMED |
| CONFIG-SYNC-4 | P1 | FLAG_OFF | automation | Cả 3 đường đẩy recipe/program xuống máy thật đều OFF/simulated — deploy hiện tại chỉ flip catalog + ledger | ◐ PARTIAL |
| CONFIG-SYNC-5 | P1 | FLAG_OFF | all | parameterGuardrails generic + closed-loop verify nhưng PARAM_GUARDRAIL_ENABLED default OFF và chỉ enforce tại set_machine_param — recipe payload không bị guardrail check | ◐ PARTIAL |
| CONFIG-SYNC-6 | P1 | STUB | iot | Config IoT: chỉ có sendConfigureCommand MQTT ad-hoc — không version, retain=false (offline là mất), không desired/reported state, không approve | ✔ CONFIRMED |
| CONFIG-SYNC-7 | P2 | MISSING | all | Staged rollout (pilot 1 máy → line) chỉ tồn tại cho DPC programs (simulated) — recipe deploy và points-config bump là fan-out tức thì toàn fleet | — |
| CONFIG-SYNC-8 | P2 | FLAG_OFF | aoi_avi | Toàn bộ lớp hardening sync AOI (doc 51+55) default-OFF: optimistic-lock, snapshot-gate, variant per-variant version+tombstone, fiducial — đang chạy mức cơ bản last-writer-wins | — |
| CONFIG-SYNC-9 | P2 | FLAG_OFF | all | Kênh notify config phụ thuộc MQTT_ENABLED (opt-in) và namespace topic 'avi/' hardcoded — nhóm máy mới sẽ kế thừa namespace AVI legacy | — |
| CONFIG-SYNC-10 | P3 | MISSING | all | Hai sổ đồng bộ tách rời (product_sync_logs cho points AOI, recipe_load_log/recipe_deployments cho recipe) — chưa có timeline cấu hình hợp nhất per máy | — |

#### CONFIG-SYNC-1 [P0/MISSING] Pipeline version-sync (version/delta/tombstone/notify) hard-wired cho measurement points AOI — máy automation/IoT không có đường pull config tương đương

- **Khoảng trống:** Máy bắt vít/điểm keo/hàn muốn nhận chương trình (torque sequence, quỹ đạo keo, profile hàn) không có endpoint nào tương đương getPoints/deltaSyncPoints: machineApiRouters (kênh authenticate apiKey duy nhất của máy) không expose recipe; machineRecipeRouter yêu cầu session user + RBAC machine_control nên máy không gọi được. Không có bảng version per (machine, configKind), không delta, không tombstone cho recipe.
- **Khuyến nghị:** Generic hóa pattern sẵn có: thêm nhóm endpoint machine-facing `checkConfigVersion / getConfig / deltaSyncConfig` key theo (machineCode, configKind) đọc từ machine_recipes active + configVersion, tái dùng nguyên mẫu bump-atomic + tombstone + MQTT notify của points-sync; giữ points-sync AOI như một configKind đặc thù.
- **Bằng chứng:** `server/routers/machineApiRouters.ts:3432` — checkPointsVersion trả pointsConfigVersion gắn với product_models — version sống ở PRODUCT, payload là measurement points · `server/routers/machineApiRouters.ts:3960` — deltaSyncPoints: diff theo sinceVersion + tombstone deletedCodes — chỉ cho measurement_point_defs (points/fiducials/lighting) · `server/services/mqttService.ts:2599` — Topic notify hard-code `avi/points-config-changed/{productModelCode}` — không có topic config-changed generic per machine/configKind · `server/routers/machineApiRouters.ts:2254` — grep 'recipe' toàn router máy (4347 dòng) chỉ ra 3 hit đều là 'lighting recipe' của point — KHÔNG có endpoint máy pull machine_recipes payload bằng apiKey
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONFIG-SYNC-2 [P0/MISSING] Drift detection recipe = 0: máy không có kênh báo config/recipe ĐANG CHẠY; ST4I program_version bị strip; 'xác nhận nạp' chỉ đọc catalog server

- **Khoảng trống:** Không tồn tại kênh nào để máy automation báo 'tôi đang chạy recipe code@version, checksum X' (heartbeat machineApiRouters.ts:3402 chỉ nhận apiKey; không field configVersion/recipeChecksum). Một máy vặn vít bị đổi chương trình tại chỗ (HMI local) sẽ chạy lệch spec vô hạn mà server tin catalog. CHƯA CHẮC: đường SECS-GEM S7 có thể query PP đang chọn nhưng chưa đọc thấy sweep so khớp nào dùng nó.
- **Khuyến nghị:** Thêm reported-state vào heartbeat/ingest: máy gửi {configKind, code, version, checksum} → server so với active trong catalog → tag drift + alert (tái dùng aiSmartAlertRouter và pattern stale/ahead của submitInspection). Với ST4I feed: thôi strip program_version, so với recipe_deployments active của máy.
- **Bằng chứng:** `server/services/vision/adapters/st4iStandard.ts:110` — program_version máy khai trong feed chuẩn ST4I chỉ được giữ ở rawExtras — 'Stripped by submitInspection's zod today' (visionAdapterRegistry.ts:102) — không so với recipe expected · `server/services/lineController/recipeSetService.ts:220` — verifyItems 'kiểm mọi trạm đã nạp đúng recipe' thực chất query lại machineRecipes active trong CATALOG — không hỏi máy, giả định sổ sách = thực tế máy · `server/services/assetRegistry/configDriftService.ts:37` — configDriftService chỉ hash config adapter+tags SERVER-SIDE vs baseline approved; CONFIG_DRIFT_ENABLED default OFF — không phải máy báo running config · `server/routers/machineApiRouters.ts:1232` — AOI thì CÓ một nửa: máy khai pointsConfigVersion tại submitInspection → tag current/stale/ahead LIVE (không cờ) — pattern này chưa nhân rộng cho recipe automation
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONFIG-SYNC-3 [P1/MISSING] machine_recipes.payload là jsonb TỰ DO — không có schema chuẩn per machineType cho torque-sequence/glue-path/weld-profile

- **Khoảng trống:** Không thể validate một chương trình vặn vít (n bước × torque target ± tolerance, đơn vị Nm) hay quỹ đạo keo khi create/approve — approve second-person đang ký trên một blob JSON không kiểm chứng được. Diff giữa 2 version (LineDiff trong RecipeManagement.tsx) chỉ là diff text JSON, không diff ngữ nghĩa per-step.
- **Khuyến nghị:** Định nghĩa typed recipe schema per machineType (zod discriminated union: screw_program {steps[{order, torqueTarget, tolerance, angle}]}, dispense_program {path, volume, speed}, weld_profile...) validate tại recipes.create/approve; thêm 'WELDING' vào machineTypeEnum; giữ payload jsonb làm storage nhưng gate bằng schema.
- **Bằng chứng:** `drizzle/schema/ot.ts:161` — payload: jsonb('payload').$type<Record<string, unknown>>() — opaque, không cấu trúc · `server/routers/machineRecipeRouter.ts:131` — recipes.create nhận payload: z.record(z.string(), z.unknown()) — zero validation ngữ nghĩa (thứ tự vít, torque target ± tolerance, đơn vị) · `server/routers/machineRecipeRouter.ts:69` — machineTypeEnum đã có SCREWDRIVE / DISPENSING / AUTOMATION / ROBOT — ý định hỗ trợ automation có sẵn nhưng dừng ở enum; enums.ts:15 còn KHÔNG có loại WELDING
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONFIG-SYNC-4 [P1/FLAG_OFF] Cả 3 đường đẩy recipe/program xuống máy thật đều OFF/simulated — deploy hiện tại chỉ flip catalog + ledger

- **Khoảng trống:** Một kỹ sư bấm Deploy trên RecipeManagement thấy 'deployed' nhưng máy vật lý không nhận gì — trạng thái catalog và máy tách rời từ thiết kế (an toàn có chủ đích cho AOI nhưng chặn đứng automation onboarding, vì máy bắt vít cần NHẬN chương trình mới chạy được). Đây là deferral có chủ ý chờ hardware-FAT (doc 37 Đợt E), không phải bug.
- **Khuyến nghị:** Khi triển khai máy nội bộ: chọn 1 đường làm chuẩn theo loại máy (Modbus/OPC-UA qua commandDispatcher cho PLC-based; MQTT pull qua endpoint CONFIG-SYNC-1 cho máy tự phát triển), bật OT_CONTROL_ENABLED theo từng máy đã FAT + giữ nguyên gate HITL/2FA; wire recipe_deployments.commandLogId (cột đã có, ot.ts:214) để ledger nối tới lệnh thật.
- **Bằng chứng:** `server/routers/machineRecipeRouter.ts:8` — 'recipes.deploy ONLY flips the active version + writes a recipe_deployments ledger row… does NOT push a select_recipe command to any device' · `server/services/ot/commandDispatcher.ts:106` — OT_CONTROL_ENABLED !== 'true' (DEFAULT) → dispatcher DRY-RUN, select_recipe ghi commandLog status='simulated' · `server/services/programming/fleetRollout.ts:19` — DPC program deploy: 'với cờ deploy OFF (mặc định) mọi deploy được ghi simulated (KHÔNG ghi xuống HW)' — DPC_DEPLOY_ENABLED OFF · `server/services/secsgem/gem300.ts:34` — S7 PP-Load binding PPID=code@v tái dùng machine_recipes — có codec + test nhưng in-memory PP store, 'flag-OFF safety'
- **Kiểm chứng đối kháng (PARTIAL):** Đúng cấu trúc, SAI về tư thế cờ live. ĐÚNG: recipes.deploy chỉ flip catalog + ledger, không import commandDispatcher (machineRecipeRouter.ts:8-12 — structural, không phụ thuộc cờ); gem300 PP store in-memory + GEM300_ENABLED default OFF (gem300.ts:34-45,:60-62) và vắng trong .env → OFF thật; fleetRollout.ts:19 trích đúng nguyên văn. SAI: claim 'cả 3 đường đều OFF/simulated' — .env live đặt OT_CONTROL_ENABLED=true (.env:508) và DPC_DEPLOY_ENABLED=true (.env:518, kèm DPC_VERSION_REVIEW/DEPLOY_APPROVAL/ACTUATION_STEPUP_2FA=true :521-523) — 2/3 đường KHÔNG ở trạng thái cờ OFF/dry-run như mô tả. Máy vật lý vẫn không nhận gì nhưng vì OT_GATEWAY_ENABLED bị comment (.env:469) → không driver → status 'failed' ADAPTER_OFFLINE (commandDispatcher.ts:560-561), hoặc commissioning-gate ép 'simulated' khi adapter chưa commissioned (:580-584) — chặn bởi thiếu gateway/HW/commissioning, không phải bởi cờ control OFF. Status đề xuất: FLAG_OFF → chỉ đúng cho GEM300; kết luận 'catalog và máy tách rời' vẫn đứng.

#### CONFIG-SYNC-5 [P1/FLAG_OFF] parameterGuardrails generic + closed-loop verify nhưng PARAM_GUARDRAIL_ENABLED default OFF và chỉ enforce tại set_machine_param — recipe payload không bị guardrail check

- **Khoảng trống:** Thiết kế guardrail đã đúng hướng generic (machine_type scope khớp nhu cầu chuẩn hóa 3 nhóm máy) nhưng đang bất hoạt (cờ OFF) và có lỗ hổng đường vòng: giá trị nguy hiểm đi qua recipe payload thay vì set_machine_param thì không bị chặn.
- **Khuyến nghị:** Bật PARAM_GUARDRAIL_ENABLED sau khi seed dải cho máy nội bộ đầu tiên; thêm bước checkAgainstGuardrail vào recipes.approve/deploy (map các key trong typed payload CONFIG-SYNC-3 → paramKey guardrail); dùng machine_type scope làm default dải cho cả nhóm SCREWDRIVE/DISPENSING.
- **Bằng chứng:** `drizzle/schema/parameterGuardrails.ts:35` — Bảng generic scope='machine'|'machine_type' × paramKey (ví dụ trong comment: 'torque_nm', 'temp_c') + parameter_change_log closed-loop verify improved/degraded · `server/services/ai/parameterGuardrailService.ts:42` — paramGuardrailEnabled() = PARAM_GUARDRAIL_ENABLED === 'true' — default OFF; PARAM_VERIFY_ENABLED cũng OFF · `server/services/aiLocalTools/writeHandlers/machineControl.ts:338` — HARD enforcement chỉ tại execute() của set_machine_param (đường AI HITL); machineRecipeRouter.create/approve/deploy không import guardrail — recipe chứa torque ngoài dải vẫn approve+deploy được
- **Kiểm chứng đối kháng (PARTIAL):** Lỗ hổng đường vòng ĐÚNG, nhưng claim 'đang bất hoạt (cờ OFF)' SAI với môi trường live. ĐÚNG: bảng generic scope machine|machine_type × paramKey (vd 'torque_nm','temp_c') + parameter_change_log closed-loop (parameterGuardrails.ts:35-59,:45,:77+); HARD enforce chỉ tại execute() của set_machine_param (machineControl.ts:338-368); machineRecipeRouter.ts:19-44 không import guardrail nào → recipe payload chứa torque ngoài dải vẫn create/approve/deploy được; PARAM_VERIFY_ENABLED vắng trong .env → OFF đúng. SAI: paramGuardrailEnabled() default OFF chỉ là default code (parameterGuardrailService.ts:42-44) — .env live đặt PARAM_GUARDRAIL_ENABLED=true (.env:691) → guardrail ĐANG hoạt động tại set_machine_param trong deployment này, không 'bất hoạt'. Status FLAG_OFF chỉ đúng cho nửa verify; nửa guardrail đang ON.

#### CONFIG-SYNC-6 [P1/STUB] Config IoT: chỉ có sendConfigureCommand MQTT ad-hoc — không version, retain=false (offline là mất), không desired/reported state, không approve

- **Khoảng trống:** Thiết bị IoT tự phát triển cần mô hình 'desired config bền + device pull/push khi reconnect + báo reported + server diff' (kiểu device shadow). Hiện chỉ có lệnh bắn-1-lần: không nguồn sự thật persist theo device, không version/rollback, không audit ai đổi gì. mqtt_clients có settings per-client nhưng không phải config có vòng đời.
- **Khuyến nghị:** Xây bảng device_config (deviceId, configVersion, desiredJson, reportedJson, reportedAt) + endpoint pull-on-connect (tái dùng authenticateMachine apiKey) + MQTT notify retained per-device; so desired vs reported = drift IoT — cùng một bộ máy version/notify với CONFIG-SYNC-1 để 3 nhóm máy chung một chuẩn.
- **Bằng chứng:** `server/services/mqttService.ts:1607` — sendConfigureCommand(deviceId, {settings: Record<string,any>}) → topic avi/client/{deviceId}/configure, qos1 retain:false — thiết bị offline lúc publish sẽ không bao giờ nhận · `server/services/mqttService.ts:1563` — CONFIGURE_ACK inbound avi/client/{deviceId}/ack có log vào mqttMessageLogs nhưng không có reconcile loop nào re-send khi thiếu ack · `server/routers/mqttOeeRouters.ts:907` — Caller là mqttOeeRouters (station/process/topics cho app alert) — không đi qua approve/version/ledger nào · `drizzle/schema/g3.ts:1` — grep 'desiredConfig|reportedConfig|deviceShadow' toàn server = 0 file — pattern device-twin desired/reported chưa tồn tại
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### CONFIG-SYNC-7 [P2/MISSING] Staged rollout (pilot 1 máy → line) chỉ tồn tại cho DPC programs (simulated) — recipe deploy và points-config bump là fan-out tức thì toàn fleet

- **Khoảng trống:** Đổi points config một product = mọi máy AOI chạy product đó nhận version mới cùng lúc; đổi recipe một line = cả line. Sai số spec lan toàn fleet trước khi kịp phát hiện. Variant per-máy (PRODUCT_VARIANT_ENABLED) có thể giả lập pilot nhưng không phải thiết kế rollout.
- **Khuyến nghị:** Nhấc FleetRolloutStrategy (canary→verify→promote, đã viết + test cho DPC) lên thành tầng chung cho cả recipe deploy và points-config: pilot machine list per productModel/line, gate promote bằng yield/NG-rate cửa sổ ngắn sau khi pilot nhận version mới.
- **Bằng chứng:** `server/services/programming/fleetRollout.ts:49` — FleetRolloutStrategy {canaryCount, promoteOnVerified, autoRollbackOnMismatch} — canary→promote CÓ nhưng chỉ cho program_deployments (DPC, cờ OFF nên simulated) · `server/services/lineController/recipeSetService.ts:374` — distributeRecipeSet đẩy MỌI item của line trong một vòng lặp — per-máy isolated error nhưng không có pha pilot/canary · `server/routers/machineApiRouters.ts:3320` — bumpPointsConfigVersion + publishPointsConfigChanged phát MQTT retained cho MỌI máy cùng productModel ngay lập tức — không có cách thử 1 máy trước · `server/routers/productRouters.ts:1752` — Rollback thì CÓ: revertPointsConfig (doc51 P3) + recipe previousRecipeId one-step + fleetRollout autoRollback

#### CONFIG-SYNC-8 [P2/FLAG_OFF] Toàn bộ lớp hardening sync AOI (doc 51+55) default-OFF: optimistic-lock, snapshot-gate, variant per-variant version+tombstone, fiducial — đang chạy mức cơ bản last-writer-wins

- **Khoảng trống:** Code + test đã có (kiểm chứng: doc 55 §0-bis '6 commit, mọi cờ default-OFF byte-identical' khớp code), nhưng chưa cờ nào bật nên giá trị production = 0. Đây là bước 2 của lộ trình cờ 2-bước đã duyệt, cần lịch bật ON có chủ đích.
- **Khuyến nghị:** Lên lịch bật tuần tự trên môi trường thật theo thứ tự rủi ro tăng dần: SPEC_GATE_SNAPSHOT_ENABLED (read-only re-grade) → MACHINE_SYNC_OPTIMISTIC_LOCK (sau khi client máy gửi expectedUpdatedAt) → PRODUCT_VARIANT_ENABLED khi có sản phẩm biến thể đầu tiên; đo bằng các counter đã trả sẵn trong response (staleConflicts, blindOverwrites, snapshotGatedPoints).
- **Bằng chứng:** `server/routers/machineApiRouters.ts:266` — MACHINE_SYNC_OPTIMISTIC_LOCK default OFF — POINTS_PUSH ghi blind, chỉ audit 'blind-overwrite' khi máy có gửi expectedUpdatedAt · `server/routers/machineApiRouters.ts:1271` — SPEC_GATE_SNAPSHOT_ENABLED default OFF — board stale vẫn bị gate bằng limits LIVE (split-brain doc51 QĐ#2 chưa đóng trong production) · `server/routers/machineApiRouters.ts:330` — PRODUCT_VARIANT_ENABLED default OFF — variantCode ở 6 procedure + deltaSync tombstone per-variant + MQTT topic variant (mqttService.ts:2598) đều INERT; test VariantGate/mqttPointsConfigVariant xanh cả 2 trạng thái cờ · `server/routers/machineApiRouters.ts:295` — MACHINE_FIDUCIAL_REGISTRATION default OFF — điểm đo lệch bàn gá vẫn ghi tọa độ observed thô

#### CONFIG-SYNC-9 [P2/FLAG_OFF] Kênh notify config phụ thuộc MQTT_ENABLED (opt-in) và namespace topic 'avi/' hardcoded — nhóm máy mới sẽ kế thừa namespace AVI legacy

- **Khoảng trống:** Câu hỏi (f) đã đóng ở tầng code — UI sửa/xóa điểm đo LUÔN bump version + notify. Rủi ro còn lại là vận hành: site chưa set MQTT_ENABLED=true thì convergence lùi về chu kỳ poll của máy; và chuẩn hóa topic cho automation/iot nên quyết ngay namespace (synapse/ hay avi/) trước khi có client mới subscribe, vì đổi sau là breaking.
- **Khuyến nghị:** Chốt quyết định namespace trước khi onboard nhóm máy mới: client automation/IoT mới subscribe synapse/* ngay từ đầu (bật MQTT_TOPIC_DUAL_PUBLISH), giữ avi/* cho máy AOI cũ; đưa MQTT_ENABLED=true vào checklist môi trường nhà máy (runbook doc 19).
- **Bằng chứng:** `server/services/mqttService.ts:373` — MQTT_ENABLED = process.env.MQTT_ENABLED === 'true' — broker tắt mặc định; publishPointsConfigChanged (2620) return sớm khi OFF, máy chỉ còn poll · `server/services/mqttService.ts:11` — Rebrand avi/→synapse/ qua MQTT_TOPIC_DUAL_PUBLISH + dual-subscribe 'Both flags default OFF = legacy-only' · `server/routers/productRouters.ts:88` — (f) doc51-P0 XÁC NHẬN ĐÃ VÁ LIVE không cờ: bumpAndNotifyPointsConfig — DB bump propagates lỗi, MQTT best-effort; gọi tại update/delete/revert điểm đo (dòng 98/1561/1752/4003)

#### CONFIG-SYNC-10 [P3/MISSING] Hai sổ đồng bộ tách rời (product_sync_logs cho points AOI, recipe_load_log/recipe_deployments cho recipe) — chưa có timeline cấu hình hợp nhất per máy

- **Khoảng trống:** Khi chuẩn hóa 3 nhóm máy, kỹ thuật viên cần một câu trả lời duy nhất 'máy này đang chạy config gì, ai đổi lúc nào' — hiện phải tra 2-3 chỗ (getSyncHistory, deployments.list, program_deployments) với 3 mô hình dữ liệu khác nhau.
- **Khuyến nghị:** Không cần bảng mới — xây view/tRPC hợp nhất 'config timeline per machine' UNION 3 nguồn (product_sync_logs, recipe_deployments+recipe_load_log, program_deployments) chuẩn hóa về {machineId, configKind, code, version, actor, at, source}; gắn vào MachineCockpit.
- **Bằng chứng:** `server/routers/machineApiRouters.ts:3341` — createProductSyncLog ghi POINTS_PUSH/DELTA_SYNC per máy — thế giới points · `drizzle/schema/equipmentIntegration.ts:50` — recipe_load_log (WHO loaded WHICH code@version onto WHICH machine) — thế giới recipe, ghi qua recordGenealogySafe · `server/routers/machineRecipeRouter.ts:269` — genealogy query theo recipe CODE, deployments.list theo machineId — không join được với sync history points của cùng máy


### A.5 Tầng quản lý & giao diện (`mgmt-ui`) — AOI/AVI **72** · Automation **45** · IoT **15**

**Căn cứ chấm điểm:** aoi_avi: hành trình đăng ký→duyệt→key→giám sát đầy đủ và khá chuyên nghiệp (2 wizard + hub + cockpit 11 tab + Factory Config hub doc47 + tab Biến thể doc55 LIVE), trừ điểm vì leak apiKey listPaged và DS không đều. automation: type máy đã có trong enum + cockpit/OEE/adapter OT generic, nhưng wizard chính bị khóa bước deploy AI model, kết quả process (torque/dispense) không có UI, 4 type SMT không chọn được từ client. iot: gần như trống — không có type, không trang quản lý, fleet drop telemetry deviceId-only, edge/field đều flag OFF.

**Tóm tắt trục:** Trục QUẢN LÝ & GIAO DIỆN đã rất mạnh cho AOI/AVI và có nền tảng tốt bất ngờ cho mở rộng: hub hóa chuẩn (DeviceHub fleet hợp nhất, ConnectivityHub 2 cấp, Factory Config hub doc 47 với cây + health + wizard + audit), cockpit máy 11 tab generic theo machineType, 2 wizard onboarding + wizard OT adapter, UI governance device-type tree + alarm taxonomy ISA-18.2 đầy đủ (chỉ chờ bật cờ), i18n VN ~14.5k key và RBAC client/server nhất quán. Tuy nhiên cho mục tiêu chuẩn hóa 3 nhóm thiết bị: (1) chưa có khái niệm device-class nào trong UI, client MACHINE_TYPES lệch server 4 type SMT và không có type IoT — máy mới ngoài danh sách không đăng ký được từ UI; (2) hành trình onboard phân mảnh 6+ entry và wizard 'generic' thực chất bị khóa ở bước deploy AI model nên máy automation/IoT không thể hoàn thành; (3) trang Đăng ký máy còn leak apiKey plaintext qua listPaged (đường duy nhất doc 54 P0-1 chưa bịt) — phải vá trước khi nhân số credential lên theo IoT; (4) máy automation gửi kết quả process (torque/dispense) có backend Sprint F2 nhưng 0 UI hiển thị; (5) IoT thuần API hoàn toàn không có màn quản lý, fleet monitor drop telemetry không gắn machineId. Điểm sẵn sàng: aoi_avi 72, automation 45, iot 15. Khuyến nghị lộ trình UI: vá leak listPaged → thống nhất taxonomy + đồng bộ constant → wizard hợp nhất rẽ nhánh theo nhóm (tái dùng khung AoiOnboardingWizard) → tab process-results trong cockpit → IoT registry giai đoạn 1 dựa trên UnifiedDeviceMonitor + ApiKeysPage.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- AoiOnboardingWizard pattern (draft resumable server-side + dry-run validate + credential show-once + commissioning sign-off) — client/src/components/aoiOnboarding/* + server aoiOnboarding router: khung chuẩn để generalize wizard onboard 3 nhóm thiết bị
- DeviceHub + UnifiedDeviceMonitor — client/src/pages/DeviceHub.tsx, UnifiedDeviceMonitor.tsx: bảng fleet hợp nhất machine+OT adapter+edge node với sparkline realtime qua socket telemetry:sample, density/fullscreen; chỉ cần thêm nguồn 'iot' keyed deviceId
- Factory Config hub (doc 47) — client/src/pages/DataSettings.tsx + client/src/components/factoryConfig/* (FactoryTree, ConfigHealthPanel, FactorySetupWizard, ImportExport, Audit, MachinesTab dùng DataTable): mẫu hub CRUD phân cấp + RBAC settings_factory chuẩn
- MachineCockpit 11 tab generic (/machine/:id) — client/src/pages/MachineCockpit.tsx: overview/health/telemetry/OEE/alarms/recipes/programs/genealogy/3D/maintenance/actions dùng được cho mọi machineType; kèm QR asset-tag print trong MachineRegistration.tsx:193
- EquipmentStandards UI trọn bộ (device type tree versioned + resolveType + ISA-18.2 alarm taxonomy + change-request board + conformance) — client/src/pages/EquipmentStandards.tsx + server/services/standards/*: chỉ cần bật EQ_GOVERN_ENABLED + seed thay vì xây mới
- ConnectivityHub 2 cấp gom 9 surface MQTT/UNS — client/src/pages/ConnectivityHub.tsx: mẫu hub-tab có per-tab RBAC và deep-link ?tab= giữ nguyên
- DeviceOnboardingWizard OT 6 bước (protocol→adapter→tag→test→enable→confirm live, honest no-fake-data) — client/src/components/DeviceOnboardingWizard.tsx + deviceAdapter router testConnection
- ControlPlane capability/PackML viewer — client/src/pages/ControlPlane.tsx + equipmentRouter + docs/ECOSYSTEM/ADAPTER_SDK.md (EquipmentAdapter contract): nền hiển thị hợp đồng năng lực chuẩn hóa cho mọi thiết bị
- Design-system primitives doc 39 — client/src/components/DataTable.tsx + client/src/components/patterns/ (PageHeader, MetricCard, StatusBadge, EmptyState, EntityPicker, ImportExportBar, ConnectionChip, ScopeFilterBar): đủ bộ để đồng nhất các trang thiết bị cũ
- ApiKeysPage mint key scoped /api/v1 show-once — client/src/pages/ApiKeysPage.tsx + apiKey router: dùng ngay cho credential thiết bị IoT
- i18n VN 14.452 key + machineTypeLabel helper (client/src/lib/machineTypeLabel.ts) + RouteGuard/PermissionGate/usePermissions + requirePermission server: hạ tầng i18n/RBAC sẵn cho trang mới

**Findings (9):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| MGMTUI-1 | P0 | MISSING | automation,iot | Chưa có taxonomy 3 nhóm thiết bị trong UI; client MACHINE_TYPES lệch server (thiếu 4 type SMT, không có type IoT/WELDING) | ◐ PARTIAL |
| MGMTUI-2 | P0 | LIVE | all | Hành trình onboard phân mảnh 6+ entry point; wizard generic bị khóa cứng bước 'Deploy AI model' → máy không-phải-AOI không thể hoàn thành | ✔ CONFIRMED |
| MGMTUI-3 | P0 | LIVE | all | Trang Đăng ký máy vẫn hiển thị apiKey plaintext qua machine.listPaged — hở đường mà doc 54 P0-1 đã bịt ở list/get | ✔ CONFIRMED |
| MGMTUI-4 | P1 | STUB | automation | Kết quả process máy automation (torque/dispense/hàn) có backend nhưng KHÔNG có bất kỳ UI nào hiển thị | ◐ PARTIAL |
| MGMTUI-5 | P1 | FLAG_OFF | all | UI quản trị Device Type tree + ISA-18.2 alarm taxonomy + conformance ĐÃ CÓ đầy đủ nhưng toàn bộ mutation sau cờ EQ_GOVERN_ENABLED default OFF | ◐ PARTIAL |
| MGMTUI-6 | P1 | MISSING | iot | IoT: không có trang quản lý thiết bị IoT thuần API; fleet monitor drop telemetry không gắn machineId; các surface gần nhất đều flag OFF | ◐ PARTIAL |
| MGMTUI-7 | P2 | LIVE | all | Chất lượng UI cụm trang thiết bị không đều: 6 trang cốt lõi dùng raw Table/0 EmptyState, 2 monolith 1500-2000 dòng, MqttClientManagement đầy kiểu any | — |
| MGMTUI-8 | P2 | LIVE | all | RBAC lệch trong hành trình: duyệt máy + xoay key admin-only trong khi tạo máy đã mở engineer; tab Pending bắn 403 cho non-admin | — |
| MGMTUI-9 | P3 | LIVE | aoi_avi,automation | Trùng lặp chức năng còn sót: 'Quản lý thiết bị' trong MonitoringSettings nhúng 2 component mapping legacy song song với Đăng ký máy | — |

#### MGMTUI-1 [P0/MISSING] Chưa có taxonomy 3 nhóm thiết bị trong UI; client MACHINE_TYPES lệch server (thiếu 4 type SMT, không có type IoT/WELDING)

- **Khoảng trống:** Wizard onboarding (Step1MachineInfo) và Factory Config MachinesTab đều render dropdown từ client MACHINE_TYPES → không thể đăng ký 4 loại máy SMT từ UI dù DB nhận; máy IoT không có chỗ đứng trong phân loại. Mọi trang lọc/badge theo machineType phẳng, không nhóm được theo 3 lớp thiết bị mà user muốn chuẩn hóa.
- **Khuyến nghị:** Thêm trường deviceClass (aoi_avi|automation|iot) ở tầng metadata (map từ machineType, IOT_* type mới) + đồng bộ lại client mirror từ server constant (import chung hoặc codegen), bổ sung nhãn i18n 3 ngôn ngữ. Dùng deviceClass làm filter chuẩn trong DeviceHub/MachinesTab/registration.
- **Bằng chứng:** `client/src/constants/machineTypes.ts:5` — Mảng client chỉ 17 type, dừng ở ROBOT — thiếu MOUNTER/REFLOW/STENCIL_PRINTER/WAVE_SOLDER dù comment dòng 3 ghi 'KEEP IN SYNC with server' · `server/constants/machineTypes.ts:35` — Server + drizzle enum có 21 type (thêm 4 type SMT, mig 0241); không type nào cho IoT sensor/gateway, không có welding cơ khí (chỉ REFLOW/WAVE_SOLDER cho PCB) · `client/src/i18n/locales/vi.json` — settings.machineType_MOUNTER/REFLOW/STENCIL_PRINTER/WAVE_SOLDER MISSING (đã verify bằng node); SCREWDRIVE='Trạm bắt vít', DISPENSING='Trạm bơm keo' thì có · `client/src/pages` — grep 'iot|IoT|IOT' toàn client/src = 0 match — khái niệm nhóm aoi_avi/automation/iot chưa tồn tại ở bất kỳ UI/schema nào
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG: client/src/constants/machineTypes.ts:5-23 chỉ 17 type dừng ở ROBOT dù comment dòng 3 ghi 'KEEP IN SYNC'; server/constants/machineTypes.ts:12-39 có 21 type (thêm MOUNTER/REFLOW/STENCIL_PRINTER/WAVE_SOLDER, không có type IoT/WELDING); vi.json:8339-8355 chỉ 17 key machineType_* (thiếu 4 SMT); grep '\b(iot|IoT|IOT)\b' client/src = 0 match; dropdown Step1MachineInfo.tsx:102, MachinesTab.tsx:191, FactorySetupWizard.tsx:645, MQTTReplay.tsx:554 đều render từ mảng 17 type. SAI: tuyên bố 'không thể đăng ký 4 loại máy SMT từ UI' — factoryConfigIO.ts:17-22 định nghĩa IMPORT_MACHINE_TYPES đủ 21 giá trị (comment dòng 14-16 tự nhận constant client thiếu nên không dùng), FactoryConfigImportExport.tsx:124,208 gọi trpc.import.importMachines với zod server z.enum(MACHINE_TYPES) 21 type (dataRouters.ts:114) → import CSV/Excel trong trang Cấu hình nhà máy (DataSettings.tsx) VẪN đăng ký được máy SMT từ UI.

#### MGMTUI-2 [P0/LIVE] Hành trình onboard phân mảnh 6+ entry point; wizard generic bị khóa cứng bước 'Deploy AI model' → máy không-phải-AOI không thể hoàn thành

- **Khoảng trống:** Người quản lý phải tự biết chọn đúng 1 trong 3 wizard + 3 trang quản lý tùy loại máy; wizard 'generic' thực chất là wizard AOI (bước 4 hard-block). Không có một luồng 'đăng ký máy mới' hợp nhất rẽ nhánh theo loại thiết bị.
- **Khuyến nghị:** Hợp nhất thành 1 wizard device-class-aware: chọn nhóm thiết bị ở bước 1 → các bước sau theo profile (aoi_avi: giữ deploy model; automation: chọn adapter/protocol + recipe thay model; iot: chọn kênh API/MQTT + claim key). Tái dùng khung AoiOnboardingWizard (draft resumable + show-once credential + sign-off). Bước deploy model chuyển thành optional/skip theo machineType.
- **Bằng chứng:** `client/src/components/onboarding/Step4DeployModel.tsx:111` — Nút Next disabled={!state.deploymentId} — bắt buộc deploy AI model (trpc.aiModel.list READY + edgeDeployment.deployModel) mới qua bước; máy bắt vít/bơm keo/IoT không có model vision → kẹt vĩnh viễn ở bước 4/5 · `client/src/lib/navigation.tsx:684` — Section 'connect' chứa 7 mục chồng chức năng: /machine-onboarding, /aoi-onboarding, /machine-registration, /monitoring-setting?tab=device-management (legacy), /device-adapters, /hot-folders, /connectivity · `client/src/pages/AoiOnboardingWizard.tsx:1` — Wizard AOI 5 bước là pattern TỐT NHẤT (draft resumable server-side, dry-run validate, credential show-once, commissioning sign-off) nhưng chỉ dành cho AOI/AVI · `client/src/components/DeviceOnboardingWizard.tsx:1` — Wizard thứ 3 (OT adapter 6 bước, modal trong /device-monitor) tách rời hoàn toàn 2 wizard kia — không chia sẻ state/flow
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### MGMTUI-3 [P0/LIVE] Trang Đăng ký máy vẫn hiển thị apiKey plaintext qua machine.listPaged — hở đường mà doc 54 P0-1 đã bịt ở list/get

- **Khoảng trống:** apiKey là credential ingest của máy (doc 51 P0 từng cảnh báo rò key theo serialNumber). Khi mở rộng cho automation/IoT, số credential tăng — đường leak này thành bề mặt tấn công nội bộ rộng. Mâu thuẫn trực tiếp với hardening doc 54 P0-1/P0-2 (đã xóa apiKey khỏi read path và update).
- **Khuyến nghị:** Strip apiKey trong getMachinesPaged (map bỏ cột như list), đổi UI cột API key thành trạng thái 'đã cấp/chưa cấp' + hành động 'Xoay key' (admin, show-once) — đồng nhất với MachinesTab Factory Config đã làm đúng (chỉ hiện key lúc regenerate).
- **Bằng chứng:** `server/routers/hierarchyRouters.ts:1188` — listPaged: protectedProcedure (không requirePermission, không admin) → mọi user đăng nhập gọi được · `server/db/hierarchy.ts:360` — getMachinesPaged: db.select().from(machines) — trả FULL row gồm cột apiKey, không strip như machine.list (hierarchyRouters.ts:1182 đã strip) và machine.get (1243 đã omit) · `client/src/pages/MachineRegistration.tsx:876` — Tab 'Tất cả/Đã duyệt' render cột API key với nút Eye toggle + Copy — hiển thị machine.apiKey plaintext cho bất kỳ ai có machine_status view (operator/maintenance đều có)
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### MGMTUI-4 [P1/STUB] Kết quả process máy automation (torque/dispense/hàn) có backend nhưng KHÔNG có bất kỳ UI nào hiển thị

- **Khoảng trống:** Một máy bắt vít gửi kết quả pass/fail + torque metrics về hệ thống sẽ 'vô hình' trong mọi màn quản lý — không bảng kết quả, không drill-down theo serial, không màn cấu hình ngưỡng cho stepType. Kỹ thuật viên không thể kiểm chứng máy automation đã kết nối đúng chuẩn dữ liệu.
- **Khuyến nghị:** Thêm tab 'Kết quả process' vào MachineCockpit (theo machineId) + khối process-results trong InspectionDetail/Traceability theo serial (tái dùng listBySerial có sẵn); bổ sung section Process Result API vào ApiDocs làm chuẩn tích hợp cho đội máy nội bộ.
- **Bằng chứng:** `server/routers/processResultRouter.ts:39` — processResult.record + listBySerial tồn tại (Sprint F2), bảng process_results (drizzle/schema/process.ts:14) với metrics jsonb + stepType + recipeRef · `client/src` — grep 'processResult|process-results' toàn client = 0 file — không trang nào gọi listBySerial; TraceabilityLineage chỉ dùng traceability.bySerial/byLot · `client/src/components/apiDocs/MachineSection.tsx:30` — ApiDocs dev-portal chỉ tài liệu hóa machineApi AOI (submitInspection/uploadImage/syncMeasurementPoints/points/heartbeat) — không có mục process-results hay telemetry ingest cho automation/IoT
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG: processResultRouter.ts:31-48 record + listBySerial tồn tại (bảng process_results với metrics jsonb/stepType/recipeRef); grep 'processResult|process-results' client/src = 0 file — không trang nào gọi listBySerial, không bảng kết quả process, không màn cấu hình ngưỡng stepType; 6 file apiDocs/ không tài liệu hóa process-results. SAI: 'máy automation sẽ vô hình trong MỌI màn quản lý — không drill-down theo serial' — processResultService.ts:70-107 TỰ ĐỘNG append genealogy event 'station' payload {kind:'processResult', stepType, result, metrics} vào hash-chain; client TraceabilityLineage.tsx:392 mount ForwardSearchPanel dùng trpc.genealogy.getBySerial (ForwardSearchPanel.tsx:78) và genealogyAggregate.ts:148-153 hiển thị station-hit + result (đếm FAIL/NG) → drill-down theo serial CÓ hiện pass/fail của máy automation. Phần vẫn thiếu thật: metrics torque/stepType không được render, không UI chuyên biệt.

#### MGMTUI-5 [P1/FLAG_OFF] UI quản trị Device Type tree + ISA-18.2 alarm taxonomy + conformance ĐÃ CÓ đầy đủ nhưng toàn bộ mutation sau cờ EQ_GOVERN_ENABLED default OFF

- **Khoảng trống:** Câu hỏi (c): deviceTypes/contracts/alarm-taxonomy CÓ UI quản trị (không chỉ DB) — nhưng ở chế độ read-preview. Muốn 'tiêu chuẩn hóa quản lý cấu hình' cho máy automation/IoT nội bộ thì registry loại thiết bị + alarm map phải ghi được; hiện kỹ sư không đăng ký được device type mới cho máy bắt vít/IoT từ UI. CHƯA CHẮC dữ liệu seed hierarchy đã phủ các loại máy automation nội bộ (chưa kiểm tra seed).
- **Khuyến nghị:** Bật EQ_GOVERN_ENABLED ở môi trường nội bộ + seed device-type hierarchy cho nhóm automation (Screw/Dispense/Weld) và iot (Sensor/Gateway); nối dialog 'register device type' vào wizard onboarding hợp nhất (MGMTUI-2) để type mới sinh ra đúng chuẩn governance.
- **Bằng chứng:** `client/src/pages/EquipmentStandards.tsx:4` — 4 tab: Hierarchy (device type tree versioned + resolveType merged attributes/commands/PackML + dialog register type), Alarm taxonomy (vendor nativeCode→standardCode + upsert), Change requests (ESB board), Compliance/conformance — 1567 dòng, DS patterns chuẩn · `server/services/standards/deviceTypeRegistry.ts:41` — EQ_GOVERN_ENABLED === 'true' — default OFF; equipmentStandardsRouter.ts:90 mutation ném CONFLICT khi cờ tắt (UI hiện banner preview) · `server/routers/hierarchyRouters.ts:97` — W5-20: enforcement nghiệm thu khi tạo máy CHỈ chạy khi EQ_GOVERN_ENABLED bật — hiện tạo máy không qua gate chuẩn hóa nào
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG về code: EquipmentStandards.tsx đúng 1567 dòng, 4 tab như mô tả (header dòng 4-15); deviceTypeRegistry.ts:40-42 eqGovernEnabled() default OFF; equipmentStandardsRouter.ts:88-92 requireFlag ném CONFLICT; .env.example:1751 EQ_GOVERN_ENABLED=false. SAI về hiện trạng vận hành: (a) .env:544 'EQ_GOVERN_ENABLED=true' — đã BẬT từ 2026-07-02 (khối comment doc 22/23 P2 staging smoke-test) và server load dotenv tại server/_core/index.ts:1 → môi trường hiện tại mutations KHÔNG bị chặn, kỹ sư ĐĂNG KÝ ĐƯỢC device type từ UI; (b) 'hiện tạo máy không qua gate chuẩn hóa nào' gây hiểu lầm: hierarchyRouters.ts:97-108 commissionGovernanceWarning kể cả khi cờ BẬT cũng chỉ 'mức CẢNH BÁO (không chặn)' (comment dòng 98) — không tồn tại hard-gate ở cả hai trạng thái cờ; (c) seed hierarchy CÓ phủ máy automation nội bộ: deviceTypeRegistry.ts:100 SCREWDRIVE/DISPENSING/PACKAGING → ProcessAutomation, capabilityModel.ts:377 profile SCREWDRIVE kèm telemetry T_TORQUE, :389 MOUNTER.

#### MGMTUI-6 [P1/MISSING] IoT: không có trang quản lý thiết bị IoT thuần API; fleet monitor drop telemetry không gắn machineId; các surface gần nhất đều flag OFF

- **Khoảng trống:** Thiết bị IoT tự phát triển muốn hiện diện trong UI buộc phải giả dạng 'machine' (chiếm code máy, gán station) hoặc vô hình. Không có màn đăng ký IoT (device model, kênh API/MQTT, schema dữ liệu), không danh sách IoT, không trang chi tiết. Hạ tầng gần nhất (field liveness board, edge nodes, adapter) hoặc OFF hoặc không dành cho HTTP-API device.
- **Khuyến nghị:** Giai đoạn 1 (rẻ): cho phép DeviceRow từ nguồn 'iot' trong UnifiedDeviceMonitor keyed theo deviceId (bỏ continue machineId==null, thêm cache keyed deviceId) + dùng ApiKeysPage mint key scope ingest gán deviceId. Giai đoạn 2: trang IoT Registry riêng (đăng ký device → cấp key show-once → khai schema metric → giám sát) tái dùng pattern AoiOnboardingWizard + bật FIELD_V2 cho liveness board.
- **Bằng chứng:** `client/src/pages/UnifiedDeviceMonitor.tsx:211` — onTelemetry: `if (s.machineId == null) continue;` — sample chỉ có deviceId (IoT chưa map máy) bị bỏ qua khỏi live value + sparkline; hàng fleet chỉ build từ machines + OT adapters + edge nodes · `client/src/pages/MqttClientManagement.tsx:556` — Trang 'Thiết bị' trong ConnectivityHub thực chất quản lý client thông báo ANDROID/IOS/WEB/DESKTOP (tablet operator) — không phải IoT device registry · `server/services/field/fieldHealthService.ts:35` — FIELD_V2_ENABLED default OFF (FieldDevices tab = preview); server/services/edge/edgeCoordinator.ts:36 EDGE_RUNTIME_ENABLED default OFF (EdgeNodesPage banner disabled) · `client/src/pages/ApiKeysPage.tsx:2` — Scoped API-key cho /api/v1 có UI mint/revoke tốt (admin_system) — dùng được cho IoT nhưng không liên kết gì tới khái niệm 'thiết bị IoT' (key rời, không gán device)
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG: UnifiedDeviceMonitor.tsx:211 'if (s.machineId == null) continue;' — sample chỉ có deviceId (interface dòng 58 deviceId: string|null) bị drop khỏi live value/sparkline; MqttClientManagement.tsx:556-559 deviceType chỉ ANDROID/IOS/WEB/DESKTOP (client thông báo, không phải IoT registry); FIELD_V2_ENABLED không xuất hiện trong .env (chỉ .env.example:1820 =false) → FieldDevices thật sự ở chế độ preview (fieldHealthService.ts:34-36, FieldDevices.tsx:24-25 discovery/register cần cờ); ApiKeysPage.tsx:1-8 key /api/v1 rời, admin_system, không gán device; grep iot client = 0 — không có trang đăng ký/danh sách/chi tiết IoT nào khác (pdmSensor cũng không có UI). SAI một phần: 'edgeCoordinator.ts:36 EDGE_RUNTIME_ENABLED default OFF (EdgeNodesPage banner disabled)' — .env:535 'EDGE_RUNTIME_ENABLED=true' (dotenv load ở server/_core/index.ts:1) → edge runtime ĐANG BẬT trong môi trường thực tế, không còn disabled.

#### MGMTUI-7 [P2/LIVE] Chất lượng UI cụm trang thiết bị không đều: 6 trang cốt lõi dùng raw Table/0 EmptyState, 2 monolith 1500-2000 dòng, MqttClientManagement đầy kiểu any

- **Khoảng trống:** Câu hỏi (d): primitives doc 39 chỉ phủ ~nửa cụm thiết bị; cảm giác 'chuyên nghiệp hiện đại' không đồng nhất giữa trang mới (MachinesTab, hub) và trang cũ (MqttClientManagement phong cách 2 thế hệ trước, filter/sort/export thiếu). Responsive tổng thể ổn (grid md:, flex-wrap tab), density/fullscreen chỉ có ở UnifiedDeviceMonitor.
- **Khuyến nghị:** Đợt refactor UI khi chuẩn hóa 3 nhóm: chuyển 6 trang trên sang DataTable/EmptyState/FilterBar chuẩn, tách MqttClientManagement + MachineRegistration thành component con (<400 dòng/file), bổ sung 4 nhãn machineType_* SMT ×3 ngôn ngữ.
- **Bằng chứng:** `client/src/pages/MachineRegistration.tsx:821` — 1509 dòng, raw Table thủ công (không DataTable primitive doc 39), grep EmptyState=0; tương tự MqttClientManagement (2010 dòng, editingClient: any ×6), DeviceAdapterManagement, EdgeNodesPage, UnifiedDeviceMonitor, EquipmentStandards đều EmptyState=0 · `client/src/components/factoryConfig/MachinesTab.tsx:283` — Ngược lại MachinesTab/ProductMachineMapping/WorkstationManagement/ProcessManagement dùng chuẩn DataTable + StatusBadge + EntityPicker — chỉ ~17 file toàn app import DataTable · `client/src/i18n/locales/vi.json` — i18n VN rất tốt: 14.452 key (machineRegistration=128, mqtt=590, cockpit=160, eqStandards=170, onboarding=91) — dark mode qua token DS + dark: variant; điểm trừ là 4 nhãn machineType SMT thiếu

#### MGMTUI-8 [P2/LIVE] RBAC lệch trong hành trình: duyệt máy + xoay key admin-only trong khi tạo máy đã mở engineer; tab Pending bắn 403 cho non-admin

- **Khoảng trống:** Doc 46 đã nêu single-admin bottleneck. Khi scale lên hàng chục máy automation + IoT nội bộ, mọi phê duyệt/cấp key dồn về 1 admin; engineer setup máy xong vẫn phải chờ. UI không hiện-nhưng-khóa (pattern U4 doc 26) mà để query fail.
- **Khuyến nghị:** Chuyển approve/listPending sang requirePermission (vd module machine_registration hoặc settings_factory canEdit) để engineer duyệt được; client gate query bằng usePermissions + hiện nút khóa kèm lý do. Giữ regenerateApiKey admin-only (đúng theo doc 54 P0-2).
- **Bằng chứng:** `server/routers/hierarchyRouters.ts:873` — machine.approve: adminProcedure; listPending (867) adminProcedure; regenerateApiKey (1307) adminProcedure — trong khi create (1261) roleProcedure(admin,supervisor,engineer) và hierarchy CRUD đã mở settings_factory cho engineer (doc 47, mig 0269) · `client/src/pages/MachineRegistration.tsx:233` — pendingQuery = trpc.machine.listPending.useQuery() gọi vô điều kiện — nav item chỉ gate machine_status view (operator/maintenance vào được trang) → non-admin nhận FORBIDDEN noise ở tab mặc định 'pending'

#### MGMTUI-9 [P3/LIVE] Trùng lặp chức năng còn sót: 'Quản lý thiết bị' trong MonitoringSettings nhúng 2 component mapping legacy song song với Đăng ký máy

- **Khoảng trống:** Người dùng mới không biết đăng ký máy ở đâu là chuẩn; 3 đường tạo mapping (manualMapping tại MonitoringSettings, tại MqttClientManagement, station-assign tại MachineRegistration) dễ tạo dữ liệu lệch nhau.
- **Khuyến nghị:** Áp pattern doc 47: biến tab device-management thành hub-link (redirect vào /machine-registration + /connectivity?tab=clients), rút ManualMachineMapping/MachineMapping legacy về một nơi duy nhất rồi gỡ nav item.
- **Bằng chứng:** `client/src/pages/MonitoringSettings.tsx:245` — Tab device-management nhúng ManualMachineMapping + MachineMapping ('autoRegistrationLegacy' WebSocket) + card link sang /connectivity?tab=clients — chức năng đăng ký/mapping trùng với /machine-registration và manualMapping trong MqttClientManagement · `client/src/lib/navigation.tsx:713` — Nav vẫn trỏ '/monitoring-setting?tab=device-management' ngay CẠNH mục '/machine-registration' cùng section connect — hai lối vào cùng một việc (đúng loại trùng lặp doc 47 đã dọn ở Factory Config nhưng chưa dọn ở nhóm devices)


### A.6 Tầng theo dõi & realtime (`realtime-monitor`) — AOI/AVI **68** · Automation **52** · IoT **34**

**Căn cứ chấm điểm:** aoi_avi: chuỗi realtime end-to-end LIVE (socket presence + telemetry bus + alert + andon + war-room, FE socket-first có poll dự phòng) nhưng notification out-of-band chết vì thiếu credential và còn lỗ presence-spoof. automation: hạ tầng generic (OT drivers + presence sweep + FCV/UnifiedDeviceMonitor) dùng được ngay, nhưng chưa từng chứng minh với HW thật, alert theo tham số quy trình (torque/pressure) chỉ có qua interlock flag-OFF. iot: có /api/ot/ingest LIVE + auth + rate tier riêng, nhưng mô hình định danh bắt buộc là machines-row đủ hierarchy (không có machineType IOT), MQTT broker không persist telemetry thiết bị, thiết bị chưa map thì vô hình hoàn toàn.

**Tóm tắt trục:** Tầng theo dõi + realtime có XƯƠNG SỐNG THẬT và phần lớn đang LIVE cho aoi_avi: (a) pipeline end-to-end = thiết bị → [OT drivers / MTConnect / SECS / CFX / ROS2 / HTTP /api/ot/ingest] → telemetryBus (ingestTelemetry: bulk-insert ot_telemetry + broadcast telemetry:sample) → socket.io (rooms global/machine, Redis adapter) → FE socket-first với poll 45-120s làm backstop (FactoryCommandView, UnifiedDeviceMonitor, MachineCockpit, WarRoom, Dashboard) — KHÔNG phải polling giả-realtime; NHƯNG nhánh MQTT broker nhúng không persist telemetry thiết bị (chỉ info/ack mobile app) và presence 'ONLINE LIVE' hiện tại là sim-backed (SIM_OT_TELEMETRY_ENABLED=true ngay trong .env). (b) Presence phân mảnh 4 cơ chế (socket AVI|AOI hard-typed, sweep telemetry-recency MACHINE_PRESENCE LIVE, mqttClients riêng, field_device_health generic FLAG_OFF) — chưa có hợp đồng heartbeat chuẩn per-deviceType, và IoT không map machines-row đủ hierarchy thì vô hình toàn tuyến (P0 nhóm iot). (c) Alert engine hiện = 5 rule hạ tầng MQTT + yield/NG/offline inspection-centric + escalation ladder always-on; ngưỡng telemetry per-metric CHỈ có trong interlock telemetry_tag (flag OFF, per-machine) → máy bắt vít/điểm keo chưa có alert quy trình; notification out-of-band (SMTP/FCM) chết vì credential rỗng, Slack không tồn tại. (d) Andon machine-agnostic LIVE trên web kể cả 1-tap OperatorHome, alarm MTConnect/SECS đã bridge ISA-18.2 (EQ_INTEG on); thiếu SLA-escalation flag + andon mobile. (e) Scale: đo thật ~10k pts/s INSERT / ~36 inspection/s (artifact máy dev, doc 53 0-loss), COPY path + Timescale + coalesce chưa bật — SLA prod chưa lập. (f) War-room LIVE (briefing dữ liệu thật + socket invalidate); HA Redis (presence/cooldown/socket) LIVE nhờ REDIS_URL nhưng EVENTBUS fan-out + leader election OFF → multi-instance chưa trọn. Kết luận: automation kế thừa ~80% hạ tầng (chỉ thiếu alert quy trình + kích hoạt), iot cần nhất mô hình định danh thiết bị + MQTT ingest; ưu tiên P0/P1: identity IoT, MQTT→bus, rules engine theo deviceType, hợp nhất presence, điền credential notification, vá confirm_mapping.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- telemetryBus (server/services/telemetryBus.ts) — CanonicalSample + ingestTelemetry: MỘT đường normalize→resolve→bulk-insert→broadcast cho MỌI protocol, có tap, Redis fan-out, COPY fast-path; mọi nhóm thiết bị mới CHỈ cần map về CanonicalSample
- POST /api/ot/ingest (server/_core/index.ts:356) + machineAuthService scope ingest:write + tier rate-limit riêng 300k/min/key (server/_core/rateLimitConfig.ts:70) — đường HTTP ingest chuẩn sẵn cho IoT, đã hoạt động không cờ
- machinePresenceService + machinePresenceStore (server/services/machinePresenceService.ts, server/_core/machinePresenceStore.ts) — presence suy từ recency telemetry (transport-agnostic) + store Redis TTL multi-instance; automation qua OT adapter đã tự có presence nhờ connectionSupervisor.ts:368
- field_device_health (drizzle/schema/fieldHealth.ts) + fieldHealthService/deviceStream (server/services/field/) — lớp liveness generic deviceKey machine:/robot:/device:<externalId> có TTL per-device, chỉ cần bật FIELD_V2_ENABLED thay vì xây registry IoT mới
- Shared socket client (client/src/lib/socketManager.ts) + useEcosystemEvents (client/src/hooks/useEcosystemEvents.ts) — envelope EcosystemEvent thống nhất 17 kind trên ecosystem:event/alerts:stream; pattern socket-first + poll-backstop đã chuẩn ở WarRoom/FactoryCommandView/UnifiedDeviceMonitor/MachineCockpit
- andonService (server/services/andon/andonService.ts) — machine-agnostic (line/station/machine), MTTA/MTTR, idempotency 30s, fan-out notification, seam andonRobotDispatch; dùng thẳng cho máy automation
- adapterAlarmBridge + alarmNormalizer ISA-18.2 (server/services/equipment/) — đường chuẩn hóa alarm vendor→taxonomy→Andon (EQ_INTEG_ENABLED=true đang LIVE); mở rộng cho alarm PLC/screw/glue thay vì viết mapping riêng
- interlock ruleEvaluator/interlockGate (server/services/interlock/) — engine đánh giá ngưỡng đã hỗ trợ sourceType telemetry_tag đọc ot_telemetry, pure + có test; nền cho rules engine alert theo deviceType
- Benchmark harnesses: scripts/bench/bench-inspection-ingest.mjs (doc 53, đã chạy LIVE 100 máy 0-loss) + bench-ingest.mjs tầng OT — dùng lại để lập SLA trên phần cứng prod
- stateStore + unsStreamGateway (server/services/stateStore/) — snapshot trạng thái theo ISA-95 path với db-fallback honest, phục vụ /v1/state cho hệ ngoài đọc 'bây giờ thế nào' không cần socket
- simOtTelemetryService + scripts/sim-factory + scripts/sim (modbus-slave/opcua-server/mtconnect-agent/sensor-generator) — bộ giả lập đúng-đường-ingest để nghiệm thu onboard automation/IoT trước khi có HW
- EquipmentAdapter + capabilityModel + ADAPTER_SDK.md (docs/ECOSYSTEM/ADAPTER_SDK.md) — hợp đồng adapter/telemetryTags/PackML cho bên thứ ba, khung chuẩn hóa đăng ký thiết bị mới

**Findings (11):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| RTM-1 | P0 | MISSING | iot | IoT không có mô hình định danh riêng: bắt buộc là machines-row đủ hierarchy, telemetry chưa map thì vô hình toàn tuyến | ◐ PARTIAL |
| RTM-2 | P1 | MISSING | iot,automation | MQTT broker nhúng KHÔNG persist telemetry thiết bị vào telemetry bus — chỉ xử lý info/ack của mobile app | ◐ PARTIAL |
| RTM-3 | P1 | FLAG_OFF | automation,iot | Không có rules engine cảnh báo theo ngưỡng telemetry per-deviceType; engine duy nhất đọc ot_telemetry là interlock (flag OFF, per-machine) | ◐ PARTIAL |
| RTM-4 | P1 | STUB | all | Presence/heartbeat phân mảnh 4 cơ chế; lớp generic field_device_health thiết kế sẵn nhưng FLAG_OFF | ✔ CONFIRMED |
| RTM-5 | P1 | STUB | all | Notification out-of-band (email/FCM/Slack) chết vì thiếu credential — escalation chỉ tới được màn hình | ✔ CONFIRMED |
| RTM-6 | P1 | LIVE | aoi_avi | Presence spoofing: machine:confirm_mapping set máy ONLINE + broadcast mà không verify apiKey | ✔ CONFIRMED |
| RTM-7 | P2 | LIVE | all | Scale: telemetry INSERT ~10k pts/s single-node, COPY fast-path OFF, Timescale chưa cài; SLA inspection prod chưa lập | — |
| RTM-8 | P2 | FLAG_OFF | all | Realtime-HA nửa vời: Redis LIVE cho presence/cooldown/socket-adapter nhưng telemetry fan-out + leader election OFF | — |
| RTM-9 | P2 | LIVE | all | Andon máy automation: web 1-tap LIVE và machine-agnostic, nhưng SLA auto-escalation OFF và mobile app không có andon | — |
| RTM-10 | P2 | LIVE | all | .env đang bật SIM_OT_TELEMETRY — presence/dashboard hiện 'sống' nhờ telemetry tổng hợp, nguy cơ trộn dữ liệu khi máy thật vào | — |
| RTM-11 | P3 | STUB | all | SSE bật server-side nhưng zero consumer phía client — kênh song song chết, socket.io là kênh duy nhất thật | — |

#### RTM-1 [P0/MISSING] IoT không có mô hình định danh riêng: bắt buộc là machines-row đủ hierarchy, telemetry chưa map thì vô hình toàn tuyến

- **Khoảng trống:** Một cảm biến/thiết bị IoT tự phát triển muốn hiện diện trên tầng theo dõi phải giả dạng một 'machine' với đủ chuỗi station→line→workshop→factory. Không có loại thiết bị IOT, không có đường presence/hiển thị cho deviceId chưa map — dữ liệu vẫn ghi vào ot_telemetry nhưng vô hình ở presence sweep, UnifiedDeviceMonitor và fleet list. Đây là điểm chặn chuẩn hóa onboard nhóm iot.
- **Khuyến nghị:** Chuẩn hóa định danh thiết bị: (1) thêm machineType IOT/SENSOR hoặc kích hoạt field_device_health (deviceKey 'device:<externalId>' đã thiết kế sẵn, FIELD_V2_ENABLED) làm registry cho thiết bị không-machine; (2) UnifiedDeviceMonitor thêm khu 'thiết bị chưa map' từ ot_telemetry.deviceId có machineId null (dữ liệu đã có sẵn); (3) nới INNER JOIN hierarchy hoặc cho phép station 'unassigned' cho IoT.
- **Bằng chứng:** `drizzle/schema/enums.ts:15` — machineTypeEnum chỉ có AVI…WAVE_SOLDER (có SCREWDRIVE/DISPENSING cho automation) — KHÔNG có giá trị IOT/SENSOR/GATEWAY · `server/services/telemetryBus.ts:141` — resolveMachineIds chỉ resolve deviceId qua machines.code; không khớp → machineId=null (negative-cache 60s), row vẫn insert nhưng mồ côi · `server/services/machinePresenceService.ts:141` — sweepPresenceFromTelemetry JOIN ot_telemetry.machineId = machines.id + isActive=true → thiết bị không có machines-row KHÔNG BAO GIỜ có presence · `client/src/pages/UnifiedDeviceMonitor.tsx:211` — handler telemetry:sample: `if (s.machineId == null) continue;` — sample chưa map bị bỏ qua khỏi UI live · `server/db/machine.ts:63` — getAllMachinesWithStatus INNER JOIN station→line→workshop→factory — máy/thiết bị thiếu 1 tầng hierarchy biến mất khỏi trang giám sát fleet
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG phần lõi: machineTypeEnum không có IOT/SENSOR/GATEWAY (drizzle/schema/enums.ts:15-39); machines.stationId NOT NULL → bắt buộc đủ hierarchy (drizzle/schema/hierarchy.ts:262); resolveMachineIds chỉ map qua machines.code, row chưa map insert mồ côi + negative-cache 60s (server/services/telemetryBus.ts:141-183); sweep presence JOIN machines isActive → không machines-row là không bao giờ có presence (machinePresenceService.ts:141-151); UI live bỏ sample machineId null (client/src/pages/UnifiedDeviceMonitor.tsx:211); fleet INNER JOIN 4 tầng (server/db/machine.ts:63-68). SAI phần tuyệt đối hóa 'bắt buộc giả dạng machine / vô hình toàn tuyến': (1) thiết bị poll-được có thể onboard làm OT-adapter KHÔNG cần machines-row — device_adapters.machineId nullable (drizzle/schema/ot.ts:20), create nhận machineId optional (server/routers/deviceAdapterRouter.ts:52,144), wizard cho chọn 'none' (client/src/components/DeviceOnboardingWizard.tsx:300) — và adapter row hiện online/offline ngay trong UnifiedDeviceMonitor (UnifiedDeviceMonitor.tsx:277-297); (2) thiết bị MQTT hiện diện qua bảng mqtt_clients + stale-checker + trang quản lý MQTT (mqttService.ts:2335-2374). Tuy nhiên các đường này vẫn không cho presence-history/machine_status_logs, không live-telemetry UI, không fleet/OEE — nên gap chuẩn hóa IoT về bản chất vẫn đúng.

#### RTM-2 [P1/MISSING] MQTT broker nhúng KHÔNG persist telemetry thiết bị vào telemetry bus — chỉ xử lý info/ack của mobile app

- **Khoảng trống:** Transport IoT tiêu chuẩn nhất (MQTT — broker aedes đã có sẵn auth/approval/ACL) không có đường xuống ot_telemetry: thiết bị publish dữ liệu vào broker thì dữ liệu KHÔNG được lưu, không presence từ payload, không lên dashboard. Nhóm iot hiện chỉ có một đường chuẩn là HTTP /api/ot/ingest.
- **Khuyến nghị:** Viết một MQTT→telemetryBus subscriber (đăng ký topic chuẩn ví dụ avi/device/{deviceId}/telemetry/#, parse payload → CanonicalSample[] → ingestTelemetry) — tái dùng nguyên auth/ACL aedes + mqttClients approval flow đã có; công bố hợp đồng topic/payload trong tài liệu chuẩn hóa thiết bị (kiểu doc 28 cho inspection).
- **Bằng chứng:** `server/services/mqttService.ts:1500` — aedes.on('publish') chỉ match 2 pattern: avi/client/{deviceId}/info (DEVICE_INFO) và avi/client/{deviceId}/ack (CONFIGURE_ACK); mọi topic khác chỉ mirror UNS northbound (processAedesPublish) rồi rơi · `server/services/telemetryBus.ts:33` — telemetryProtocolEnum có giá trị 'mqtt' và 'sparkplug' nhưng grep toàn server: KHÔNG một caller nào ingestTelemetry với protocol mqtt/sparkplug — Sparkplug chỉ publish-only (unsPublisher) · `server/_core/index.ts:356` — Đường ingest generic duy nhất cho thiết bị là POST /api/ot/ingest (HTTP, per-machine key scope ingest:write) — LIVE không cờ
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG phần lõi: không tồn tại đường MQTT → ot_telemetry/telemetry-bus — grep toàn server: caller ingestTelemetry chỉ gồm HTTP /api/ot/ingest (server/_core/index.ts:346,392), cfxClient, mtconnectPoller, ot/ingest, ros2Bridge, secsGemBringup, simOtTelemetry — KHÔNG có mqttService; protocol 'mqtt'/'sparkplug' chỉ xuất hiện trong test (telemetryBus.copy.test.ts:210...); /api/ot/ingest LIVE không cờ (index.ts:356-393). SAI phần 'chỉ match 2 pattern info/ack, mọi topic khác rơi / dữ liệu KHÔNG được lưu': aedes.on('publish') gọi processAedesPublish cho MỌI topic (mqttService.ts:1500-1507), trong đó có nhánh thứ 3 — sensor ingest: topic factory/{factoryId}/{machineCode}/sensor/{type} → INSERT machine_sensor_readings source='mqtt' (mqttService.ts:207-213 + sensorIngestService.ts:209-264), cờ PDM_SENSOR_INGEST_ENABLED=true ĐANG BẬT trong .env:540 → MQTT CÓ một đường persist telemetry cảm biến LIVE (nuôi PdM). Giới hạn của đường này khớp tinh thần finding: không vào ot_telemetry/bus, không tạo presence máy, không lên telemetry:sample dashboard, và vẫn đòi machineCode đã map (unknown → skip, sensorIngestService.ts:226-233). Phụ: Sparkplug không hoàn toàn publish-only — unsSubscriber decode DDATA inbound nhưng chỉ cho KPI federation, cờ OFF (server/services/federation/unsSubscriber.ts:1-30).

#### RTM-3 [P1/FLAG_OFF] Không có rules engine cảnh báo theo ngưỡng telemetry per-deviceType; engine duy nhất đọc ot_telemetry là interlock (flag OFF, per-machine)

- **Khoảng trống:** Máy bắt vít/điểm keo/hàn cần alert theo tham số quy trình (torque ngoài dải, áp keo tụt, nhiệt hàn lệch) — hiện KHÔNG có engine nào đánh giá được, trừ interlock telemetry_tag đang flag-OFF, cấu hình per-machine (không template theo deviceType), và chỉ ra Andon chứ không vào thang notification/escalation. AOI hưởng đủ alert (yield/NG/offline) — automation/IoT thì gần trắng.
- **Khuyến nghị:** Kích hoạt INTERLOCK_ENGINE_ENABLED (alert-only, an toàn) làm nền, rồi mở rộng: rule template theo machineType/metric (thay vì per-machineId), nối kết quả vào routeAlert/alertEscalation ladder thay vì chỉ Andon. Tránh xây engine mới — deriveObserved/evaluateCondition (ruleEvaluator.ts) đã pure + có test.
- **Bằng chứng:** `scripts/seed-alert-rules.mjs:28` — 5 rule doc 54 GĐ1 đều là hạ tầng MQTT (Độ trễ MQTT, message thất bại, throughput, broker disconnect, client offline) — ruleTypeEnum enums.ts:78, không phải rule máy · `drizzle/schema/enums.ts:58` — alertTypeEnum của alertSettings = yield_rate | ng_count | machine_status | machine_offline — inspection/presence-centric, không có ngưỡng metric · `server/services/interlock/interlockGate.ts:100` — sourceType 'telemetry_tag' ĐÃ đọc ot_telemetry (metric + threshold + windowSize) → Andon, nhưng gated INTERLOCK_ENGINE_ENABLED (chỉ bật trong .env.sim, KHÔNG có trong .env) và rule theo machineId đơn lẻ · `server/services/equipment/adapterAlarmBridge.ts:23` — comment tự nhận: 'the OT adapter (opcua/modbus/s7/eip/mc) ingest path is PURE TELEMETRY — NO alarm/fault surface today'
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG phần lõi: 5 rule seed đều là hạ tầng MQTT (scripts/seed-alert-rules.mjs:26-62; ruleTypeEnum enums.ts:78); alertTypeEnum chỉ yield_rate|ng_count|machine_status|machine_offline (enums.ts:58); engine ngưỡng duy nhất trên ot_telemetry là interlock telemetry_tag per-machine (interlockGate.ts:100-114, rule.machineId đơn lẻ) gated INTERLOCK_ENGINE_ENABLED — KHÔNG có trong .env (grep chỉ .env.sim:106=true, .env.example:1475=false); comment 'PURE TELEMETRY — NO alarm surface' đúng nguyên văn (adapterAlarmBridge.ts:22-25); không có engine threshold-rule cấu hình theo deviceType. SAI 2 điểm: (a) 'chỉ ra Andon chứ không vào thang notification' — interlock block/stop raise Andon ĐỎ và andonService fan-out notifyOwner + sendAlertEmail + webhook cho red/call/safety (andonService.ts:74-141); chỉ action='alert' (vàng) là socket-only; (b) 'automation/IoT gần trắng' bị nói quá — pipeline PdM đang LIVE: PDM_SENSOR_INGEST_ENABLED=true (.env:540) + PDM_WORKORDER_ENABLED=true (.env:192) đánh giá vibration/current/torque/temperature (Isolation-Forest/CUSUM, predictiveMaintenanceService.ts:162-234) ra predictive alerts/work orders; EQ_INTEG_ENABLED=true (.env:547) bật cầu alarm MTConnect/SECS→Andon; rule CLIENT_OFFLINE phủ thiết bị MQTT offline. Vẫn đúng: đó là ML-scoring/hạ tầng, không phải rules engine ngưỡng quy trình per-deviceType.

#### RTM-4 [P1/STUB] Presence/heartbeat phân mảnh 4 cơ chế; lớp generic field_device_health thiết kế sẵn nhưng FLAG_OFF

- **Khoảng trống:** Không có MỘT hợp đồng heartbeat/presence chuẩn cho cả 3 nhóm: AOI dùng socket riêng, MQTT client có bảng riêng không hợp nhất, automation/IoT dựa vào recency telemetry (TTL 120s + sweep 60s — trễ tới ~3 phút), còn lớp generic nhất (field_device_health per-device TTL) chưa bật. Người vận hành nhìn 3 nguồn sự thật khác nhau tùy transport.
- **Khuyến nghị:** Chọn machine_status_logs làm sổ cái presence duy nhất (đã có duration + FE đọc sẵn): nối mqttClients connect/disconnect → recordPresenceEvent (map deviceId→machine), bật FIELD_V2_ENABLED cho thiết bị không-machine, và công bố hợp đồng heartbeat chuẩn (metric 'heartbeat' qua /api/ot/ingest — sim emitter đã mẫu hóa đúng cách này).
- **Bằng chứng:** `server/_core/socket.ts:268` — Cơ chế 1: machine:register/heartbeat qua socket.io — interface hard-typed type: 'AVI' | 'AOI', chỉ phục vụ máy kiểm quang · `server/services/machinePresenceService.ts:25` — Cơ chế 2: sweep suy presence từ recency ot_telemetry (MACHINE_PRESENCE_ENABLED=true trong .env — LIVE, transport-agnostic, ghi machine_status_logs) · `server/services/mqttService.ts:2337` — Cơ chế 3: mqttClients.connectionStatus ONLINE/DISCONNECTED + stale-checker riêng — bảng riêng, không nối machine_status_logs · `drizzle/schema/fieldHealth.ts:40` — Cơ chế 4: field_device_health deviceKey 'robot:<id>'|'machine:<id>'|'device:<externalId>' + TTL per-device — CHÍNH LÀ lớp chuẩn hóa cần, nhưng FIELD_V2_ENABLED default OFF · `server/services/ot/connectionSupervisor.ts:368` — Adapter OT connect/disconnect đã gọi recordPresenceEvent (gated MACHINE_PRESENCE_ENABLED) — automation qua OT driver ĐÃ có đường presence
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### RTM-5 [P1/STUB] Notification out-of-band (email/FCM/Slack) chết vì thiếu credential — escalation chỉ tới được màn hình

- **Khoảng trống:** Toàn bộ chuỗi alert → escalation → notify đã nối dây và chạy lịch, nhưng khi ca đêm không ai nhìn dashboard thì không gì tới được người thật: email/FCM thiếu credential, Slack sender không tồn tại (chỉ có webhook generic). Đây là mục 'human item' tồn từ doc 54 và ảnh hưởng cả 3 nhóm thiết bị.
- **Khuyến nghị:** Điền credential SMTP + Firebase service-account (việc vận hành, không phải code); cân nhắc thêm 1 sender webhook→Slack/Teams template dùng webhookRouter sẵn có. Xong thì smoke-test qua andon đỏ.
- **Bằng chứng:** `server/services/emailService.ts:20` — SMTP_HOST/USER/PASSWORD thiếu → 'email notifications disabled'; .env hiện có SMTP_HOST nhưng SMTP_USER= và SMTP_PASS= RỖNG · `server/services/fcmService.ts:14` — FCM HTTP v1 code hoàn chỉnh nhưng FIREBASE_SERVICE_ACCOUNT_JSON/FIREBASE_PROJECT_ID không có trong .env → push chết · `server/services/alertEscalationService.ts:7` — Thang escalation L0→L3 theo SLA severity chạy always-on mỗi 60s (index.ts:5146 startEscalationScheduler) — nhưng đầu ra ngoài socket/in-app phụ thuộc các kênh trên · `server/services/andon/andonService.ts:74` — Andon đỏ/call/safety fan-out notifyOwner + sendAlertEmail + webhook — mã sẵn, kênh email/push cùng chết theo credential
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### RTM-6 [P1/LIVE] Presence spoofing: machine:confirm_mapping set máy ONLINE + broadcast mà không verify apiKey

- **Khoảng trống:** Bất kỳ kết nối socket khai clientType=machine đều có thể giả một machineId bất kỳ thành ONLINE, phát status_update giả và làm bẩn machine_status_logs/uptime — làm mất niềm tin vào chính tầng theo dõi. Heartbeat sau đó cũng được nhận vì identity-guard chỉ so socketId đã ghi bởi chính confirm_mapping giả.
- **Khuyến nghị:** Thêm verify apiKey (giống sync_started) vào machine:confirm_mapping trước khi setOnline/broadcast; đồng thời mở rộng machine:register nhận đủ machineType (hiện hard-typed AVI|AOI) khi chuẩn hóa onboard automation.
- **Bằng chứng:** `server/_core/socket.ts:330` — handler machine:confirm_mapping nhận {machineId, machineCode, apiKey} nhưng KHÔNG kiểm tra apiKey — set connectedMachines + presence.setOnline + ghi machine_status_logs + broadcast machine:status_change ngay · `server/_core/socket.ts:584` — đối chiếu: machine:sync_started CÓ verify (machine.apiKey !== data.apiKey → sync_error) — chứng tỏ chuẩn verify tồn tại nhưng confirm_mapping bỏ sót · `server/_core/socket.ts:106` — handshake middleware: clientType==='machine' bypass session-cookie với lời hứa 'authenticate per-event via apiKey' — lời hứa không được giữ ở confirm_mapping
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### RTM-7 [P2/LIVE] Scale: telemetry INSERT ~10k pts/s single-node, COPY fast-path OFF, Timescale chưa cài; SLA inspection prod chưa lập

- **Khoảng trống:** Nền ingest đủ cho vài trăm máy automation tần suất giây, nhưng: ot_telemetry là bảng PG thường (3 migration Timescale 0125/0234/0235 fail vì extension chưa cài — theo memory DB sync), COPY path chưa bật, coalesce FE chưa bật ở .env, và chưa có con số SLA nào lập trên phần cứng production. CHƯA CHẮC: trạng thái hypertable hiện tại chưa kiểm chứng trực tiếp DB trong audit này.
- **Khuyến nghị:** Trước khi onboard hàng loạt automation/IoT: cài timescaledb + cutover, bật TELEMETRY_EMIT_COALESCE_MS=250 ở .env, và chạy lại harness doc 53 + bench-ingest.mjs trên phần cứng thật để ratify ngưỡng SLA (harness đã sẵn, chỉ thiếu môi trường).
- **Bằng chứng:** `server/services/telemetryBus.ts:250` — comment đo thật: INSERT path ~10k pts/s single-node + trần 65535 bind-param (~5957 rows/statement); COPY path giải cả hai nhưng OT_INGEST_COPY_ENABLED default OFF (line 264) · `docs/ECOSYSTEM/53_P1_INGEST_BENCHMARK_HARNESS.md:10` — benchmark inspection ĐÃ CHẠY LIVE 100 máy: 0 loss/0 dup/0×429 (chính trực giữ vững) nhưng throughput ~31-36/s là artifact máy dev — SLA thật cần phần cứng prod + máy phát tải riêng · `server/_core/rateLimitConfig.ts:70` — tier OT ingest riêng 300k/min/key (≈5000 req/s) đã tách khỏi bucket /api 300/min — sẵn cho fleet lớn · `server/_core/socket.ts:978` — emit coalescing TELEMETRY_EMIT_COALESCE_MS default 0 (chỉ .env.sim đặt 250ms) — firehose telemetry:sample đẩy thẳng từng batch tới mọi client global-room

#### RTM-8 [P2/FLAG_OFF] Realtime-HA nửa vời: Redis LIVE cho presence/cooldown/socket-adapter nhưng telemetry fan-out + leader election OFF

- **Khoảng trống:** Ở single-node hiện trạng thì đủ; nhưng câu chuyện 'war-room HA' của doc 54 GĐ2 chỉ trọn khi scale ≥2 instance: thiếu EVENTBUS_REDIS_ENABLED thì realtime telemetry chỉ thấy cục bộ per-instance, thiếu leader election thì scheduler (sweep presence, evaluator, escalation) double-fire.
- **Khuyến nghị:** Ghi vào runbook triển khai nhà máy: khi lên ≥2 instance phải bật đồng bộ EVENTBUS_REDIS_ENABLED + WORKER_LEADER_ELECTION_ENABLED (cả hai đã có test: otManager.ha.test / alertHaLogic.test). Không cần code mới.
- **Bằng chứng:** `server/_core/machinePresenceStore.ts:238` — REDIS_URL có trong .env → presence store Redis TTL 90s multi-instance LIVE (mode auto) · `server/services/alertEvaluationService.ts:62` — cooldown alert Redis SET-NX atomic cross-instance (claimTriggerSlot) + broadcastAlertToWarRoom qua alerts:stream — LIVE dưới MQTT_ENABLED=true · `server/services/telemetryBus.ts:185` — cross-instance telemetry fan-out cần EVENTBUS_REDIS_ENABLED — KHÔNG có trong .env → client nối instance khác không thấy sample ingest ở instance này · `server/_core/workerLeader.ts:47` — WORKER_LEADER_ELECTION_ENABLED=false trong .env — advisory-lock leader election sẵn nhưng tắt (đúng cho single-node hiện tại)

#### RTM-9 [P2/LIVE] Andon máy automation: web 1-tap LIVE và machine-agnostic, nhưng SLA auto-escalation OFF và mobile app không có andon

- **Khoảng trống:** Nền andon dùng được ngay cho máy bắt vít/điểm keo (schema + service + board + MTTA/MTTR đều machine-agnostic, alarm MTConnect/SECS đã bridge qua ISA-18.2 với EQ_INTEG_ENABLED=true). Thiếu: cờ SLA escalation chưa bật, mobile không có andon, và andonRobotDispatch (flag OFF) chưa dùng. CHƯA CHẮC: grant andon/canCreate cho role operator trong DB thật chưa kiểm chứng.
- **Khuyến nghị:** Bật ANDON_SLA_ESCALATION_ENABLED (+ đặt ANDON_SLA_*_MIN theo chính sách nhà máy); xác minh grant andon/canCreate cho operator; thêm màn andon raise/ack vào FactoryAlertSystem nếu công nhân automation làm việc xa kiosk.
- **Bằng chứng:** `server/routers/andonRouter.ts:32` — raise/quickReport gated andon/canCreate (protectedProcedure) — scope lineId/stationId/machineId bất kỳ loại máy; quickReport có classifier fail-safe · `client/src/pages/OperatorHome.tsx:181` — trang công nhân có trpc.andon.raise (callMaintenance) + component QuickIssueReport — đường 1-tap cho công nhân đứng máy LIVE trên web · `server/_core/backgroundJobs.ts:373` — sweepAndonSlaBreaches gated ANDON_SLA_ESCALATION_ENABLED — không có trong .env → andon đỏ không ai ack sẽ KHÔNG tự leo thang · `FactoryAlertSystem/src` — grep 'andon' toàn bộ src mobile app = 0 file — app RN chỉ nhận NG-alert qua MQTT/FCM, công nhân không raise/ack andon từ điện thoại

#### RTM-10 [P2/LIVE] .env đang bật SIM_OT_TELEMETRY — presence/dashboard hiện 'sống' nhờ telemetry tổng hợp, nguy cơ trộn dữ liệu khi máy thật vào

- **Khoảng trống:** Mọi máy active đủ hierarchy đang được emitter bơm heartbeat/machine_state/cycle_time/temperature mỗi 30s → tất cả hiện ONLINE bất kể thực tế. Khi máy automation thật bắt đầu gửi telemetry, sample sim (cùng deviceId=machine.code) sẽ trộn lẫn và che khuất offline thật — dashboard mất tính honest.
- **Khuyến nghị:** Trước khi nối máy thật: chuyển SIM_OT_TELEMETRY_ENABLED về .env.sim; nếu cần demo song song thì giới hạn emitter theo danh sách machineId sim hoặc lọc meta.source='SIM-OT' khỏi presence sweep.
- **Bằng chứng:** `.env` — SIM_OT_TELEMETRY_ENABLED=true + SIM_OT_TELEMETRY_INTERVAL_MS=30000 nằm trong .env (không chỉ .env.sim), cùng MACHINE_PRESENCE_ENABLED=true · `server/services/simOtTelemetryService.ts:35` — header tự cảnh báo: 'CHỈ bật trên env Full-Sim, KHÔNG bật ở production nơi ot_telemetry đến từ adapter/máy thật'; sample mang meta.source='SIM-OT' và deviceId=machine.code · `docs/ECOSYSTEM/54_DEVICES_AND_ENGINEERING_LIVE_COMPLETION_AUDIT_2026-07-16.md:432` — GĐ1 proven: 144 telemetry/36 máy → presence changed — tức bằng chứng 'ONLINE LIVE' hiện tại là sim-backed, chưa có máy nào tự phát heartbeat thật

#### RTM-11 [P3/STUB] SSE bật server-side nhưng zero consumer phía client — kênh song song chết, socket.io là kênh duy nhất thật

- **Khoảng trống:** Lớp SSE là mã chết đang bật cờ — thêm một heartbeat timer 25s và diện tích bảo trì mà không ai dùng. Với thiết bị IoT tự phát triển muốn NHẬN sự kiện nhẹ (không đủ sức chạy socket.io client), SSE lẽ ra là kênh phù hợp nhưng chưa có hợp đồng channel/event công bố.
- **Khuyến nghị:** Quyết một trong hai: tắt SSE_ENABLED cho gọn, hoặc chuẩn hóa nó thành kênh sự kiện cho thiết bị/hệ thống ngoài (công bố channel: telemetry/alerts/andon) — sseBroadcast đã hỗ trợ channel filter sẵn.
- **Bằng chứng:** `server/_core/sse.ts:48` — GET /api/stream (SSE_ENABLED=true trong .env) + sseBroadcast theo channel — server sẵn sàng · `client/src` — grep 'EventSource' toàn client/src = 0 file — không trang nào tiêu thụ SSE; toàn bộ FE realtime đi qua getSharedSocket (socketManager.ts)


### A.7 Dashboard & tầng phân tích dữ liệu (`dashboard-analytics`) — AOI/AVI **74** · Automation **24** · IoT **32**

**Căn cứ chấm điểm:** Điểm = mức sẵn sàng production của TẦNG DASHBOARD/PHÂN TÍCH cho từng nhóm máy, dựa hoàn toàn trên đọc code + cờ trong .env (KHÔNG chạy app/DB — 'LIVE' nghĩa là code đã wire + cờ bật; lượng dữ liệu thật trong DB prod chưa kiểm chứng). aoi_avi 74: bộ dashboard quản lý rất đầy (Dashboard/ProductionDashboard/DrillDown/StationAnalysis/OEE/ComparisonStudio/WarRoom), Pareto-MTBF-takt LIVE, export VN-font đã giải, NHƯNG mart + OEE-snapshot còn cờ OFF ở production và TimescaleDB chưa cài. automation 24: có bảng landing process_results + ingest (SECS-GEM/MTConnect/tRPC) nhưng 0 dashboard, 0 mart, 0 CPK/SPC, 0 BI dataset cho torque/keo/hàn. iot 32: sensor trend per-machine + Energy Analytics LIVE, nhưng không có dashboard môi trường/fleet, sensor bắt buộc gắn machineCode, không downsample.

**Tóm tắt trục:** Trục dashboard-analytics phân hóa cực mạnh giữa 3 nhóm máy. AOI/AVI (~74): bộ dashboard persona quản lý thực sự dày — Dashboard chính (comparison/shift/top-bottom/hourly), ProductionDashboard (station overview + defect Pareto + trend + SPC summary + false-call/escape), DrillDownDashboard (Corporate→Machine spine), StationAnalysis + InspectionDetail (ảnh board + overlay điểm đo + golden-diff), OEEDashboard (SEMI E10), ComparisonStudio/WarRoom (so ca/line qua fact_inspection_hourly), Pareto/MTBF/takt doc 54 P2.5 LIVE trong oeeService, export VN-font đã giải triệt để (Be Vietnam Pro embed), BI feed /api/bi + báo cáo cron + AI executive report (EXEC_REPORT_ENABLED=true) chạy thật. Nhưng 2 cờ nền tảng còn OFF ở production (REPORTING_MART_ENABLED, OEE_SNAPSHOT_ENABLED — hiện Full-Sim daemon ghi thẳng oee_metrics/fact_inspection_hourly nên dev nhìn 'sống' còn production sẽ trắng) và TimescaleDB chưa cài (0271 guarded no-op). AUTOMATION (~24): bảng process_results + ingest SECS-GEM/MTConnect + machineType SCREWDRIVE/DISPENSING đã có, backend query helpers viết sẵn — nhưng 0 màn hình, 0 mart, 0 CPK (SPC neo measurementPointDefId), 0 BI dataset; OEE không bao giờ tính được vì đếm sản lượng chỉ từ product_inspections. IOT (~32): pipeline sensor LIVE (PDM_SENSOR_INGEST_ENABLED=true) nhưng UI duy nhất là trend per-machine trong MachineCockpit; không có dashboard môi trường/fleet; điểm sáng là EnergyAnalyticsPage làm mẫu chuẩn. Kết luận: khoảng cách chủ yếu là WIRING + kích hoạt cờ + nhân bản pattern có sẵn (mart/metricRegistry/SensorTrendTab), không phải xây mới từ đầu. Lưu ý: audit thuần đọc code + .env, không chạy app/DB nên khối lượng dữ liệu thật chưa kiểm chứng.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- server/db/processResult.ts — aggregateProcessResultStats + getProcessMetricSeries (time-bucket avg trên jsonb metrics, safe numeric cast): backend dashboard automation viết sẵn, chỉ cần expose qua tRPC
- server/services/semantics/metricRegistry.ts + contracts/metrics/*.yaml — khung metric-as-code versioned (fingerprint guard, honest-null, delegation) làm cửa khai KPI chuẩn cho cả 3 nhóm máy
- drizzle/schema/reportingMart.ts + server/services/reportingMartService.ts — pattern star-schema + refresh idempotent (sentinel COALESCE, shift classifier factory-local) nhân bản trực tiếp cho fact_process_hourly
- server/services/oeeService.ts — computeOEE/resolveIdealCycleTimeSec (mig 0285 configured-first) + getDowntimePareto + MTBF/MTTR + getLineTaktUtilization: phần downtime/takt đã machine-type-agnostic (đọc downtime_events)
- server/utils/kpi.ts — math yield/FPY/DPMO/sigma canonical đã LOCKED (doc 27 #4), tái dùng cho DPMO hàn khi có nguồn opportunities
- server/services/fontAssets.ts + server/assets/fonts (Be Vietnam Pro + NotoSansSC .ttf có sẵn trên đĩa) + server/api/export/exportRouter.ts (CSV/JSON/XLSX/PDF streamed) + biRouter.ts (API-key scope bi:read, paging nextToken) — khung export/BI chỉ cần thêm dataset mới
- client/src/components/patterns (MetricCard/chartColor/chartTooltipStyle/EmptyState) + components/drilldown (DrillSpine/DrillNode) — bộ UI kit dashboard nhất quán cho trang phân tích mới
- server/routers/sensorRouter.ts + sensorIngestService.ts (topic factory/*/*/sensor/* LIVE, PDM_SENSOR_INGEST_ENABLED=true) + MachineCockpit SensorTrendTab (band mean±2σ) — nhân bản thành dashboard môi trường IoT đa máy
- server/services/warRoomService.ts (briefing so-ca đọc fact_inspection_hourly) + ComparisonStudio/ControlTower/ExecutiveMobile — chuỗi so sánh line/ca cấp quản lý đã dựng, chỉ chờ mart bật ở production
- server/services/reportScheduler.ts + reportDeliveryService.ts (default-ON, retry+DLQ) + aiExecutiveReport (EXEC_REPORT_ENABLED=true LIVE, tiếng Việt) — kênh phát hành báo cáo định kỳ dùng chung
- server/functions/cachedStatistics.ts — pattern matview freshness-guard + fallback live-query + read-replica seam (getReadDb) áp dụng cho mọi bảng pre-agg mới
- client/src/pages/EnergyAnalyticsPage.tsx + server/services/energyAnalyticsService.ts — mẫu hoàn chỉnh 'IoT meter → analytics tabs' (peak demand/forecast/EnPI) để copy cho sensor môi trường
- scripts/sim-factory/sim-live-daemon.mjs + scripts/sim/sensor-generator.mjs — hạ tầng Full-Sim sinh dữ liệu dashboard, mở rộng thêm emitter process_results cho SCREWDRIVE/DISPENSING để demo/dev nhóm automation

**Findings (12):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| dashboard-analytics-1 | P0 | STUB | automation | process_results (dữ liệu máy automation) KHÔNG có bất kỳ surface dashboard nào — 0 usage phía client | ◐ PARTIAL |
| dashboard-analytics-2 | P1 | MISSING | automation | Tầng KPI/mart/BI hoàn toàn inspection-centric — không có chỗ chứa KPI automation (CPK torque, tỷ lệ vít lỗi, DPMO hàn, lượng keo TB) | ◐ PARTIAL |
| dashboard-analytics-3 | P1 | MISSING | automation | SPC/CPK engine neo cứng vào measurementPointDefId — không có đường tính CPK cho metric process (torque/keo) | ✔ CONFIRMED |
| dashboard-analytics-4 | P1 | FLAG_OFF | automation,aoi_avi | OEE pipeline đếm sản lượng CHỈ từ product_inspections → máy automation vĩnh viễn không có OEE; kèm OEE_SNAPSHOT_ENABLED đang OFF | ✔ CONFIRMED |
| dashboard-analytics-5 | P1 | FLAG_OFF | aoi_avi | REPORTING_MART_ENABLED OFF — WarRoom/ComparisonStudio/ExecutiveMobile đọc fact_inspection_hourly sẽ RỖNG ở production (Full-Sim đang che) | ✔ CONFIRMED |
| dashboard-analytics-6 | P1 | MISSING | iot | IoT sensor (nhiệt/ẩm/rung) chỉ có trend per-machine trong MachineCockpit — không có dashboard môi trường/fleet, sensor không gắn máy không có chỗ hiển thị | ✔ CONFIRMED |
| dashboard-analytics-7 | P2 | STUB | all | TimescaleDB chưa cài — mọi hardening time-series (0271) no-op; phân tích cửa sổ dài quét bảng thô, retention chỉ app-level | — |
| dashboard-analytics-8 | P2 | LIVE | aoi_avi | Drill-down KPI→máy→board→ảnh defect: liền mạch cho AOI ở đường chính nhưng còn 3 đứt gãy | — |
| dashboard-analytics-9 | P2 | LIVE | automation,iot | CustomDashboard builder có sẵn nhưng dataSource là danh sách cứng inspection-metrics — không tự dựng được dashboard automation/IoT | — |
| dashboard-analytics-10 | P2 | LIVE | all | Semantic metric registry (metric-as-code versioned) là nền chuẩn hóa KPI tốt nhất hiện có nhưng mới phủ 5 metric inspection/OEE | — |
| dashboard-analytics-11 | P3 | FLAG_OFF | aoi_avi | SPC_CENTRAL_ALERT_ENABLED OFF — vi phạm SPC không đổ về central alert engine | — |
| dashboard-analytics-12 | P3 | LIVE | automation,iot | Báo cáo định kỳ + AI executive report LIVE nhưng nội dung 100% inspection/OEE — automation & IoT vắng mặt trong mọi báo cáo | — |

#### dashboard-analytics-1 [P0/STUB] process_results (dữ liệu máy automation) KHÔNG có bất kỳ surface dashboard nào — 0 usage phía client

- **Khoảng trống:** Máy bắt vít/điểm keo/hàn đã có đường ingest (SECS-GEM liveDispatch, MTConnect poller, tRPC record, REST genealogyApi) đổ vào process_results, nhưng kỹ thuật viên/quản lý KHÔNG có bất kỳ dashboard nào xem kết quả: không tỷ lệ fail theo máy/ca, không trend metric (torque/volume), không top stepType lỗi. Đây là hố chặn trải nghiệm chuẩn hóa nhóm automation dù backend đọc đã viết sẵn.
- **Khuyến nghị:** Bước rẻ nhất: expose 2 helper sẵn có (aggregateProcessResultStats + getProcessMetricSeries) qua processResultRouter, rồi dựng trang ProcessAnalytics (per-machine + per-stepType: pass/fail/warn stacked, metric series với band mean±2σ tái dùng pattern SensorTrendTab của MachineCockpit) và nhúng tab 'Process' vào MachineCockpit cho máy machineType ∈ {SCREWDRIVE, DISPENSING, WAVE_SOLDER…}.
- **Bằng chứng:** `server/routers/processResultRouter.ts:31` — tRPC router chỉ có `record` + `listBySerial` — không có endpoint aggregate/series nào cho UI · `server/db/processResult.ts:29` — Helpers giàu tính năng ĐÃ TỒN TẠI (aggregateProcessResultStats, getProcessMetricSeries — time-bucket avg trên jsonb metrics) nhưng comment ghi rõ 'Used by handlersF6 / insightHandlersF6' — chỉ AI tools dùng · `client/src` — grep `trpc.processResult` và `processResult` toàn bộ client/src = 0 match — không màn hình nào hiển thị pass/fail rate, trend torque, lượng keo · `drizzle/schema/process.ts:14` — Bảng process_results hypertable-ready, metrics jsonb, machineType denormalized — hạ tầng dữ liệu sẵn sàng, chỉ thiếu tầng hiển thị
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG phần lõi: router chỉ có record+listBySerial (server/routers/processResultRouter.ts:31-49, không endpoint aggregate/series cho UI); helpers giàu tính năng aggregateProcessResultStats/getProcessMetricSeries (server/db/processResult.ts:71,114) chỉ được import bởi handlersF6.ts:21-23 + insightHandlersF6 (AI tools, đúng comment processResult.ts:29-31); grep 'trpc.processResult' client = 0 match; không trang dashboard nào cho process_results. SAI phần bằng chứng: grep 'processResult' client/src KHÔNG phải 0 match — client/src/components/AIToolResultCard.tsx:290-306 render card type 'process_result' (Pass/Fail/Warn/Skip + 'Tỉ lệ fail %' — dòng 491-521) và 'process_metric_trend' (sparkline MetricTrendBody dòng 533) trong AI chat, nuôi bởi chính các helper F6 đó ⇒ kỹ thuật viên CÓ THỂ xem pass/fail-rate + trend metric qua hỏi AI assistant (pull-based), chỉ là không có dashboard chuyên dụng. Ngoài ra InterlockRuleManagement.tsx:53 có source 'process_result'/'ng_rate' (interlockGate.ts:63-88 đếm fail process_results) — giám sát dạng rule, không phải dashboard.

#### dashboard-analytics-2 [P1/MISSING] Tầng KPI/mart/BI hoàn toàn inspection-centric — không có chỗ chứa KPI automation (CPK torque, tỷ lệ vít lỗi, DPMO hàn, lượng keo TB)

- **Khoảng trống:** Muốn dashboard quản lý xem 'tỷ lệ vít lỗi theo ca', 'CPK torque tuần', 'lượng keo trung bình/board' thì hiện KHÔNG có bảng pre-agg, không dataset BI, không metric definition. Mọi KPI đều bắt nguồn từ product_inspections/measurement_results.
- **Khuyến nghị:** Nhân bản pattern mart sẵn có: thêm fact_process_hourly (grain bucketHour+machineId+stepType, cột pass/fail/warn + p50/avg các metric khai báo) refresh bởi reportingMartService (đã có khung idempotent-upsert + shift classifier); thêm dataset `process_daily` vào /api/bi + /api/export; thêm YAML metric mới (vd SCREW_DEFECT_RATE@v1, GLUE_VOLUME_AVG@v1) vào contracts/metrics tận dụng metricRegistry versioned.
- **Bằng chứng:** `drizzle/schema/reportingMart.ts:75` — Mart chỉ có 1 fact: fact_inspection_hourly (grain bucketHour+machineId+productModelId+shiftCode, cột ok/ng/ntf/yield/fpy) — không có fact cho process metrics · `server/api/export/biRouter.ts:93` — BI feed /api/bi chỉ 3 dataset: inspections_daily, defect_pareto, machine_oee — không dataset process/sensor · `server/api/export/exportRouter.ts:415` — Aggregate export datasets = yield / oee / defect-pareto + raw inspections/measurements — không process_results · `contracts/metrics/dpmo.yaml:14` — DPMO định nghĩa source = measurement_results (1 dòng = 1 opportunity) — DPMO hàn từ process_results không tính được; opportunity model IPC deferred (gap M12)
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG phần lõi: mart chỉ có 1 fact inspection-grain fact_inspection_hourly (drizzle/schema/reportingMart.ts:75-104, cột ok/ng/ntf/yield/fpy); export aggregate chỉ yield/oee/defect-pareto (server/api/export/exportRouter.ts:415,846-849) + raw inspections/measurements (dòng 624,741), không process_results; dpmo.yaml:13-20 source=measurement_results, IPC opportunity DEFERRED gap M12; contracts/metrics chỉ có oee/apq/fpy/throughput/dpmo — không metric definition cho torque/keo/hàn. SAI 2 điểm: (1) '/api/bi chỉ 3 dataset' — BI_DATASETS (server/api/export/biRouter.ts:93-136) có 6 dataset (thêm defect_category, yield_by_product, shift), tuy vẫn KHÔNG có dataset process/sensor; (2) 'Mọi KPI đều bắt nguồn từ product_inspections/measurement_results' — energy KPI (kwhPerUnit/EnPI của EnergyAnalyticsPage) đếm good-units TỪ process_results result='pass' (server/db/energy.ts:108-129, energyAnalyticsService.ts:84) — ngoại lệ có thật dù không phải KPI chất lượng automation.

#### dashboard-analytics-3 [P1/MISSING] SPC/CPK engine neo cứng vào measurementPointDefId — không có đường tính CPK cho metric process (torque/keo)

- **Khoảng trống:** CPK torque là KPI chuẩn ngành cho máy bắt vít nhưng toàn bộ chuỗi SPC (config → violation → cpk_history → quality gate cpk_threshold) chỉ hoạt động trên measurement_results của AOI/AVI. Metric process không có identity + spec limits nên không thể vẽ control chart hay tính Cp/Cpk. CHƯA CHẮC: có thể workaround bằng cách ghi torque như measurementPointDef ảo, nhưng chưa thấy code nào làm vậy.
- **Khuyến nghị:** Chuẩn hóa 'process metric definition' first-class (bảng process_metric_defs: machineType/stepType + metricKey + unit + USL/LSL/nominal), rồi cho spcCalculation + cpkSnapshotScheduler nhận nguồn thứ hai từ process_results.metrics theo defs này — tái dùng nguyên math Cp/Cpk/Nelson rules hiện có.
- **Bằng chứng:** `drizzle/schema/spc.ts:99` — cpk_history.measurementPointDefId NOT NULL — bản ghi CPK bắt buộc gắn point def (khái niệm AOI points-config) · `drizzle/schema/spc.ts:35` — spc_configurations cũng key theo measurementPointDefId — control chart/rule Nelson chỉ chạy trên measurement_results · `drizzle/schema/process.ts:26` — Metric automation nằm trong jsonb `metrics` không định danh, không USL/LSL — SPC engine không nhìn thấy
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### dashboard-analytics-4 [P1/FLAG_OFF] OEE pipeline đếm sản lượng CHỈ từ product_inspections → máy automation vĩnh viễn không có OEE; kèm OEE_SNAPSHOT_ENABLED đang OFF

- **Khoảng trống:** Hai tầng vấn đề: (1) cấu trúc — computeOEE lấy đầu vào sản lượng từ product_inspections nên nhóm automation không bao giờ có A/P/Q dù có process_results và downtime_events; (2) vận hành — cờ snapshot OFF nên ở production oee_metrics thưa/gián đoạn (dashboard OEE + BI machine_oee + report OEE_REPORT gần rỗng).
- **Khuyến nghị:** Mở rộng nguồn đếm sản lượng của computeOEE: COALESCE(product_inspections, process_results theo machineType) — process_results đã có measuredAt + result đủ để đếm total/good. Production: bật OEE_SNAPSHOT_ENABLED=true (single worker) + cấu hình idealCycleTimeSec per product-machine (mig 0285 đã sẵn).
- **Bằng chứng:** `server/services/oeeSnapshotScheduler.ts:165` — Đếm totalCount/goodCount: `FROM product_inspections` — máy SCREWDRIVE/DISPENSING không có inspection ⇒ luôn rơi vào skippedNoProduction · `server/services/oeeSnapshotScheduler.ts:49` — ENABLED = env OEE_SNAPSHOT_ENABLED (default false); .env hiện KHÔNG có dòng này → cron snapshot không chạy, oee_metrics chỉ ghi khi bấm tay hoặc do sim daemon · `drizzle/0285_product_machine_ideal_cycle_time.sql:1` — Mig 0285 idealCycleTime per (product, machine) TỒN TẠI thật + resolveIdealCycleTimeSec configured-first (doc 54 P2.2 xác nhận đúng) — phần OEE-trust đã làm · `scripts/sim-factory/sim-live-daemon.mjs:21` — Full-Sim đang che khuất: sim daemon tự ghi oee_metrics calculatedBy='SIM-LIVE' nên OEEDashboard có số trong env dev
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### dashboard-analytics-5 [P1/FLAG_OFF] REPORTING_MART_ENABLED OFF — WarRoom/ComparisonStudio/ExecutiveMobile đọc fact_inspection_hourly sẽ RỖNG ở production (Full-Sim đang che)

- **Khoảng trống:** Chuỗi phân tích so-ca/so-line cấp quản lý phụ thuộc mart nhưng job refresh mặc định tắt và không nằm trong .env hiện tại; đồng thời router mart phía server (reportingMart.*) là API mồ côi chưa màn hình nào gọi. Rủi ro 'demo đẹp, prod trắng'.
- **Khuyến nghị:** Đưa REPORTING_MART_ENABLED=true vào runbook go-live (doc 45 §6 đã có verify step); khi chuẩn hóa 3 nhóm máy thì mart refresh cũng là chỗ gắn fact_process_hourly (finding -2) để 1 job phục vụ cả 3 nhóm.
- **Bằng chứng:** `server/services/reportingMartService.ts:57` — reportingMartEnabled() = env REPORTING_MART_ENABLED === 'true' (default OFF); .env hiện không set — chỉ .env.example:2130 ghi hướng dẫn · `server/services/warRoomService.ts:244` — briefing so-ca SELECT trực tiếp FROM fact_inspection_hourly (nguồn shift-grain duy nhất) — 4 trang FE dùng: WarRoom/ControlTower/ComparisonStudio/ExecutiveMobile · `scripts/sim-factory/sim-live-daemon.mjs:25` — Env dev có số vì sim daemon GHI THẲNG fact_inspection_hourly — không phải nhờ mart service; production tắt sim sẽ trơ bảng rỗng · `client/src` — grep trpc.reportingMart client = 0 match — reportingMartRouter (routers.ts:444) chưa có consumer UI trực tiếp nào
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### dashboard-analytics-6 [P1/MISSING] IoT sensor (nhiệt/ẩm/rung) chỉ có trend per-machine trong MachineCockpit — không có dashboard môi trường/fleet, sensor không gắn máy không có chỗ hiển thị

- **Khoảng trống:** Nhóm iot tự phát triển cần dashboard: bản đồ nhiệt/ẩm theo khu vực, so sánh rung giữa các máy, cảnh báo ngưỡng môi trường. Hiện không có trang tổng hợp cross-machine/cross-zone; ot_telemetry (source SIM-OT đang chạy) chỉ phục vụ realtime state (stateStore/assetCockpit/api-v1), không có analytics view.
- **Khuyến nghị:** Dựng EnvironmentDashboard tổng hợp machine_sensor_readings theo khu (heatmap + multi-machine overlay tái dùng SensorTrendTab); nới topic convention cho phép `sensor/{deviceCode}` không phải machine (map qua bảng thiết bị IoT khi chuẩn hóa đăng ký); lấy EnergyAnalyticsPage làm template UI phân tích IoT.
- **Bằng chứng:** `server/services/sensorIngestService.ts:8` — Topic convention `factory/{factoryId}/{machineCode}/sensor/{sensorType}` — machineCode BẮT BUỘC resolve về machines.code; thiết bị IoT độc lập (cảm biến phòng, tủ điện) không có landing · `client/src/pages/MachineCockpit.tsx:338` — SensorTrendTab (trpc.sensor.listTypes/readSeries + band mean±2σ) là UI sensor DUY NHẤT — chỉ xem 1 máy/1 loại sensor mỗi lần · `.env:540` — PDM_SENSOR_INGEST_ENABLED=true — pipeline ingest LIVE (điểm cộng), sim sensor-generator.mjs tồn tại · `client/src/lib/navigation.tsx` — grep 'IoT' = 0 match — không có mục điều hướng/dashboard IoT nào trong IA · `client/src/pages/EnergyAnalyticsPage.tsx:1` — Ngoại lệ tốt: Energy Analytics (meter IoT — recipeEnergy/peakDemand/powerFactor/forecast/enpi) là mẫu phân tích IoT hoàn chỉnh duy nhất
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### dashboard-analytics-7 [P2/STUB] TimescaleDB chưa cài — mọi hardening time-series (0271) no-op; phân tích cửa sổ dài quét bảng thô, retention chỉ app-level

- **Khoảng trống:** Khi 3 nhóm máy cùng đổ telemetry (ot_telemetry, process_results, machine_sensor_readings) thì plain-table + không compression/continuous-aggregate sẽ là trần perf cho dashboard trend dài hạn (tuần/tháng). Mig đã viết sẵn, chỉ chờ hạ tầng. CHƯA CHẮC trạng thái DB thật (không được phép kết nối DB) — 0271 header nói 'Postgres 17 + TimescaleDB 2.28' nhưng .env và memory 2026-07-10 nói extension chưa cài.
- **Khuyến nghị:** Việc ops thuần: cài extension timescaledb trên DB chính rồi re-apply 0172/0271 (idempotent, tự no-op→apply); sau đó set RETENTION_OT_TELEMETRY_DAYS=0 theo hướng dẫn trong .env để chuyển sang native retention.
- **Bằng chứng:** `.env:233` — 'Disabled: no tsdb role / avi_aoi_ts DB / timescaledb extension on this PG' — TSDB_URL bị comment; khớp memory doc DB-sync (0125/0234/0235 fail vì thiếu extension) · `drizzle/0271_timescale_hardening.sql:96` — Guard: 'timescaledb not installed — storage-tier hardening NOT applied: ot_telemetry stays a plain table' + ghi db_feature_status để ops thấy UNMET · `.env:242` — RETENTION_OT_TELEMETRY_DAYS=90 — retention app-level (dataRetentionService) là hàng rào tạm cho bảng volume cao nhất · `server/functions/cachedStatistics.ts:13` — Perf dashboard hiện dựa matview hourly_yield_cache freshness-guarded (<2× interval, MATVIEW_REFRESH_ENABLED=true LIVE) + statsCache 30s + read-replica seam — đỡ được mức hiện tại

#### dashboard-analytics-8 [P2/LIVE] Drill-down KPI→máy→board→ảnh defect: liền mạch cho AOI ở đường chính nhưng còn 3 đứt gãy

- **Khoảng trống:** Persona quản lý đi từ KPI xuống ảnh lỗi được qua Dashboard chính, nhưng nhánh ProductionDashboard→StationAnalysis→(fail history) đứt ở bước cuối; DrillDownDashboard không mang OEE; nhóm automation không có drill tương đương (không có trang bắt đầu).
- **Khuyến nghị:** Gắn onClick→/inspection/:id vào fail-history rows của StationAnalysis (rec.id đã có trong data); thêm cột OEE (đọc oee_metrics) vào tier Machine của drillDown router; thiết kế drill automation: ProcessAnalytics → machine → serial (listBySerial đã có) → genealogy view.
- **Bằng chứng:** `client/src/pages/DrillDownDashboard.tsx:12` — Honest-degradation tự khai: tier Workshop & Station KHÔNG có rollup (backend collapse), OEE không nằm trong drill spine · `client/src/pages/StationAnalysis.tsx:916` — Fail-history rows render barcode + failedPoints nhưng KHÔNG có navigate/link sang /inspection/:id — ngõ cụt ngay trước bước xem ảnh · `client/src/pages/Dashboard.tsx:2805` — Đường sống: window.open(`/inspection/${id}`) từ bảng inspection của Dashboard chính · `client/src/pages/InspectionDetail.tsx:600` — Điểm cuối chuỗi rất tốt: ảnh board + overlay measurement points + golden-diff (W7-C) — /inspection/:id RouteGuard history_view · `client/src/pages/ProductionDashboard.tsx:1397` — ProductionDashboard → /station-analysis/:id (kèm date window) và defect → /correlation-analysis — 2 nhánh drill hoạt động

#### dashboard-analytics-9 [P2/LIVE] CustomDashboard builder có sẵn nhưng dataSource là danh sách cứng inspection-metrics — không tự dựng được dashboard automation/IoT

- **Khoảng trống:** Mục tiêu 'UI quản lý trực quan chuyên nghiệp' cho 3 nhóm máy sẽ cần dashboard tùy biến per-nhà-máy; builder hiện tại không thể trỏ tới process metric (torque) hay sensor series (nhiệt độ khu A) vì widget không có khái niệm nguồn dữ liệu động.
- **Khuyến nghị:** Thêm widget type 'metric-query' nhận (nguồn: semanticMetric | processMetricSeries | sensorSeries) + tham số scope — bọc các endpoint đã có (metricRegistry.computeMetric, getProcessMetricSeries, sensor.readSeries) thay vì viết query mới.
- **Bằng chứng:** `client/src/components/DashboardWidgetLibrary.tsx:94` — kpi-card dataSource options cố định: yield_rate/ng_rate/oee/inspection_count/machine_uptime; bar-chart: ng_by_machine/yield_by_product… — enum đóng · `client/src/pages/CustomDashboard.tsx:59` — Hạ tầng layout/widget/share (dashboardWidget router, public/private, grid editor) đã hoàn chỉnh — chỉ thiếu nguồn dữ liệu mở

#### dashboard-analytics-10 [P2/LIVE] Semantic metric registry (metric-as-code versioned) là nền chuẩn hóa KPI tốt nhất hiện có nhưng mới phủ 5 metric inspection/OEE

- **Khoảng trống:** Khi thêm KPI automation/IoT mà không đi qua registry, hệ sẽ tái phát bệnh 'mỗi dashboard một công thức' (đã từng bị với yield trước doc 27 #4). Registry hiện chưa có implementation handler nào đọc process_results/sensor.
- **Khuyến nghị:** Coi contracts/metrics là CỬA DUY NHẤT khai KPI mới cho cả 3 nhóm: thêm handler `processResult.*` và `sensor.*` vào IMPLEMENTATIONS table, mỗi KPI automation/IoT một YAML có version + notes đơn vị — dashboard/BI/report đều gọi computeMetric thay vì tự SUM.
- **Bằng chứng:** `server/services/semantics/metricRegistry.ts:6` — 'MỘT ĐỊNH NGHĨA — MỘT SỰ THẬT': định nghĩa YAML versioned + fingerprint guard + delegation sang impl canonical (oeeService/kpi.ts) + honest-null — đúng kiến trúc cần cho chuẩn hóa KPI 3 nhóm máy · `contracts/metrics` — Chỉ 5 file: oee, availability_performance_quality, fpy, dpmo, throughput — tất cả scope equipment/factory trên nguồn inspection

#### dashboard-analytics-11 [P3/FLAG_OFF] SPC_CENTRAL_ALERT_ENABLED OFF — vi phạm SPC không đổ về central alert engine

- **Khoảng trống:** Dashboard SPC hiển thị violation nhưng chuỗi 'phân tích → cảnh báo → hành động' (predictive_alerts + notify) đứt vì cờ. Ảnh hưởng persona quản lý nhận cảnh báo chủ động.
- **Khuyến nghị:** Bật SPC_CENTRAL_ALERT_ENABLED=true theo staged-flip doc 38 §quick-win (caller/scheduler có sẵn, rollback = tắt cờ).
- **Bằng chứng:** `server/services/spcCentralAlertBridge.ts:45` — return envTrue(process.env.SPC_CENTRAL_ALERT_ENABLED) — default OFF, không có trong .env (chỉ .env.example:2127) · `server/routers/productRouters.ts:3542` — Caller đã wire sẵn (fire-and-forget) — chỉ chờ lật cờ

#### dashboard-analytics-12 [P3/LIVE] Báo cáo định kỳ + AI executive report LIVE nhưng nội dung 100% inspection/OEE — automation & IoT vắng mặt trong mọi báo cáo

- **Khoảng trống:** Hạ tầng report (cron per-row + delivery worker retry/DLQ default-ON + font VN) rất tốt và tái dùng được ngay, nhưng khi máy automation/IoT lên sóng thì báo cáo ca/ngày gửi quản lý sẽ không nói gì về chúng.
- **Khuyến nghị:** Thêm section 'Process/Automation' (top máy fail, CPK tuần) và 'Environment' (min/max nhiệt-ẩm, cảnh báo vượt ngưỡng) vào content builder của reportScheduler + prompt của aiExecutiveReport — chỉ là mở rộng content, không cần hạ tầng mới.
- **Bằng chứng:** `server/services/reportScheduler.ts:28` — ScheduledReportType = NG_VISUAL | DAILY/WEEKLY/MONTHLY_SUMMARY | OEE_REPORT | MACHINE_HEALTH | CUSTOM — không loại báo cáo process/sensor · `.env:428` — EXEC_REPORT_ENABLED=true + SCHEDULE=shift,day,week + LANG=vi + email — AI executive report đang chạy thật (điểm mạnh persona quản lý) · `server/services/fontAssets.ts:9` — VN-font PDF đã giải triệt để (Be Vietnam Pro embed + NotoSansSC cho zh, .ttf có mặt trên đĩa server/assets/fonts) — rủi ro doc 32 đã đóng


### A.8 Tầng AI local (3 persona) (`ai-local`) — AOI/AVI **74** · Automation **47** · IoT **18**

**Căn cứ chấm điểm:** Điểm = mức AI local thực sự phục vụ được 3 persona (kỹ thuật/công nhân/quản lý) cho từng nhóm máy. aoi_avi 74: toàn stack model LIVE trên disk + đủ persona (RCA/Threshold/Setup advisor, exec report vi, briefing, chat HITL) — trừ điểm vì KB autosync OFF, deep-model in-process (rủi ro VRAM), guardrail rows chưa chắc có. automation 47: chat PULL-tools (torque/keo/cycle-time, telemetry, line insight) + Programming Copilot 91,678 chunks rất mạnh, NHƯNG mọi advisor/push-persona (RCA, threshold, setup, exec, briefing, auto-proposer) đều AOI-bound, KB không có tri thức quy trình bắt vít/keo/hàn. iot 18: AI layer hoàn toàn machine-anchored — thiết bị IoT không phải machines row là vô hình với mọi tool/KB/persona.

**Tóm tắt trục:** Tầng AI local THỰC TẾ trưởng thành hơn memory ghi nhận: toàn bộ model (Qwen3-30B/4B/Coder-30B/VL-8B/Embedding + reranker + llama-server.exe) có thật trên disk, env đầy đủ, mọi cờ persona chính (RCA, Threshold/Setup Advisor, exec report vi, auto-propose, programming copilot, /v1 gateway, OT_CONTROL, PARAM_GUARDRAIL) đang ON — khác hẳn trạng thái 'thiếu env' của doc 54; rủi ro còn lại là vận hành (deep-model in-process cạnh embedder, LLAMA_SERVER_ENABLED chưa bật, thinking model chưa tải). Kiến trúc tool-registry HITL (44 read + 27 write tool, propose→RBAC→confirm→interlock→audit) là nền chuẩn hóa rất tốt cho cả 3 nhóm máy. NHƯNG mức phủ lệch mạnh theo nhóm: aoi_avi được phục vụ trọn 3 persona; automation chỉ được phục vụ ở đường PULL (chat có tool torque/keo/cycle-time + Programming Copilot 91.678 chunks manual PLC/robot — tài sản mạnh nhất) trong khi mọi bộ não PUSH và advisor (RCA evidence, threshold/setup, exec report, briefing, auto-proposer) đều hard-wired vào bảng inspection AOI (grep processResults = 0 ở cả 5 service); iot gần như vô hình vì mọi tool đều machine-anchored và edge_nodes không được tham chiếu. KB là điểm nghẽn content: 2.186 chunks ops toàn AOI how-to, không một dòng tri thức bắt vít/keo/hàn/IoT, autosync tắt, embeddings cũ 18 ngày. An toàn ghi: khung đủ tốt kể cả cho máy nguy hiểm, nhưng cần seed parameter_guardrails + bật STRICT trước khi nối máy automation thật vì OT_CONTROL đã live. Tiếng Việt end-to-end đạt. Kết luận cho kế hoạch chuẩn hóa: KHÔNG cần xây AI mới — cần (1) nạp content KB theo machine-type, (2) generalize 5 service persona sang process_results/telemetry, (3) chốt mô hình 'IoT device = machines row' để thừa hưởng nguyên tầng tool, (4) seed guardrail trong wizard onboard.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- toolRegistry + tryExecuteTool (HITL propose→confirm, RBAC per-tool, client-action navigate/prefill) — server/services/aiLocalTools/toolRegistry.ts + index.ts: thêm tool automation/IoT mới chỉ là registerTool, không đổi khung an toàn
- aiProviderRouter + aiGgufEngine + aiModelRouter (tier fast/deep/code/thinking, pin modelId, VRAM guard, generationGuard chống degenerate) — server/services/aiProviderRouter.ts, aiGgufEngine.ts, aiModelRouter.ts
- Programming KB contract (chunks.jsonl/embeddings.jsonl/manifest per-vendor + page-cited) + aiProgrammingKnowledgeService + lookup_error_code — thêm vendor screw/glue/weld = thêm thư mục corpus, zero code
- parameterGuardrailService + bảng parameter_guardrails/parameter_change_log (min/max/maxStep + closed-loop verify degraded→Andon) — server/services/ai/parameterGuardrailService.ts: dùng làm chuẩn spec an toàn khi onboard máy automation
- commandDispatcher + interlockGate fail-closed + commissioning gate (server/services/ot/commandDispatcher.ts) — mọi write AI xuống máy bất kỳ nhóm nào đều đi qua 1 cổng duy nhất, có commandLog audit
- F6 line-monitoring tools (get_machine_process_result / get_process_metric_trend torque-keo-cycle / get_ot_telemetry_latest / analyze_line_bottleneck / correlation) — server/services/aiLocalTools/handlersF6.ts + insightHandlersF6.ts: đường đọc automation ĐÃ CÓ, chỉ cần nối vào RCA/exec-report
- aiTimeSeriesEngine (EWMA anomaly + forecast + CI) — server/services/aiTimeSeriesEngine.ts: dùng cho drift-trigger auto-proposer automation
- aiIssueClassifier fast-tier + andon.quickReport + QuickIssueReport voice vi-VN + useOfflineQueue — luồng công nhân 1-tap dùng chung cho mọi loại máy
- AILocalChatBubble global + ConfirmActionCard + AIToolResultCard + KbQueryContext page-context (C3a) — client: mọi trang máy automation/IoT mới tự có AI đi kèm
- aiReranker (bge-reranker-v2-m3 GGUF) + semantic graph + kbVectorStore — retrieval chất lượng cao dùng chung mọi corpus mới
- OpenAI-compatible /v1 gateway (server/routes/openaiGateway.ts, ON tại .env:657) — thiết bị IoT/edge tự phát triển có thể gọi AI local qua chuẩn OpenAI với service-identity
- aiModelAvailability + db_feature_status 'ai_models' health card — mở rộng presence-check cho model automation mới là thêm entry manifest

**Findings (10):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| AILOCAL-1 | P1 | LIVE | all | Stack model AI local ĐÃ cấu hình đầy đủ + model có thật trên disk (khác ghi chú doc 54) — nhưng deep-model chạy in-process, llama-server tách tiến trình chưa bật | ✔ CONFIRMED |
| AILOCAL-2 | P1 | MISSING | automation,iot | KB/RAG KHÔNG có tri thức domain máy bắt vít / điểm keo / hàn / IoT — chỉ AOI how-to + manual controller; KB autosync đang TẮT, embeddings cũ ~18 ngày | ✔ CONFIRMED |
| AILOCAL-3 | P1 | LIVE | automation | RCA Copilot (kỹ thuật viên) LIVE nhưng toàn bộ evidence pipeline AOI-bound — sự cố máy automation cho ra evidence rỗng → 'cần người xem' | ✔ CONFIRMED |
| AILOCAL-4 | P1 | LIVE | automation,iot | Persona QUẢN LÝ + push-AI (exec report, briefing, auto-proposer, action inbox) chỉ tính KPI từ productInspections/dailyStatistics — máy automation & IoT vắng mặt trong mọi báo cáo đẩy | ◐ PARTIAL |
| AILOCAL-5 | P1 | MISSING | automation | Threshold Advisor + Setup Advisor không có khái niệm 'process spec' cho automation — schema không tồn tại bảng spec torque/keo/hàn để AI tư vấn | ✔ CONFIRMED |
| AILOCAL-6 | P1 | MISSING | iot | Nhóm IoT vô hình với tầng AI: mọi read-tool đều machine-anchored, edge_nodes không được tool nào tham chiếu, không persona nào biết đến thiết bị IoT | ✔ CONFIRMED |
| AILOCAL-7 | P1 | LIVE | all | Guardrail hành động ghi: khung HITL/RBAC/interlock rất chắc và ĐANG BẬT, nhưng bảng parameter_guardrails không có seed + STRICT/VERIFY tắt → set_machine_param ngoài dải vẫn lọt nếu kỹ sư chưa nhập dải | ✔ CONFIRMED |
| AILOCAL-8 | P2 | LIVE | automation | Programming Copilot (doc 34) là tài sản mạnh nhất cho KỸ THUẬT automation — LIVE đầy đủ với 8 tool + refuse an toàn; chỉ thiếu corpus vendor thiết bị chuyên dụng | — |
| AILOCAL-9 | P2 | LIVE | all | Persona CÔNG NHÂN: nền tảng tốt (voice→Andon 1-tap, briefing, bubble chat role-basic vi) nhưng SOP viewer không có AI hook và không có hướng dẫn thao tác máy automation | — |
| AILOCAL-10 | P3 | LIVE | all | Tiếng Việt end-to-end: ĐẠT trên toàn tầng AI (vi mặc định, vi/en/zh song song) — chỉ còn citations/manual tiếng Anh | — |

#### AILOCAL-1 [P1/LIVE] Stack model AI local ĐÃ cấu hình đầy đủ + model có thật trên disk (khác ghi chú doc 54) — nhưng deep-model chạy in-process, llama-server tách tiến trình chưa bật

- **Khoảng trống:** Trái với memory doc 54 ('AI-model-server env còn thiếu'), env + model file đã đủ để chạy NGAY: chat/KB/RAG, RCA, exec report, vision, programming copilot. Điểm chết còn lại: (1) deep model 30B Q4 (~17.7GB) nạp in-process cạnh embedder — dưới tải song song (GGUF_MAX_LOADED_MODELS=4, RTX 5090 32GB) có thể fail-load → degrade offline template; (2) thinking model chưa tải; (3) việc server có ĐANG chạy hay không CHƯA CHẮC (audit tĩnh, không chạy runtime).
- **Khuyến nghị:** Bật LLAMA_SERVER_ENABLED=true + LLAMA_SERVER_URL theo runbook scripts/ai/llama-server.md để deep model chạy out-of-process (binary llama-server.exe đã có sẵn); tải GGUF_THINKING_MODEL hoặc tắt AI_THINKING_TIER_ENABLED cho log sạch; thêm smoke check /api health 'ai_models' vào quy trình khởi động nhà máy.
- **Bằng chứng:** `.env:118` — GGUF_MODELS_DIR=D:/SOURCES/16.AI + GGUF_DEFAULT_MODEL=Qwen3-30B, GGUF_FAST_MODEL=Qwen3-4B, GGUF_EMBED_MODEL=Qwen3-Embedding-0.6B, GGUF_VISION_MODEL/MMPROJ=Qwen3-VL-8B (dòng 118-148); đã ls disk: TẤT CẢ file .gguf tồn tại, kèm llama-cuda/llama-server.exe · `.env:265` — LLAMA_SERVER_BIN + LLAMA_VISION_PORT 8081 (vision sidecar mtmd) cấu hình xong; aiProviderRouter.describeImage degrade trung thực khi sidecar thiếu (aiProviderRouter.ts:291-295) · `server/services/aiProviderRouter.ts:2` — Local-only GGUF (cloud OpenAI đã gỡ) — toàn bộ narrative/JSON/vision/stream đi qua aiGgufEngine; modelId pin theo doc 48 R1 · `server/services/aiModelAvailability.ts:75` — Startup honesty check models/manifest.json → db_feature_status 'ai_models' (models/dinov2.onnx cũng có mặt) · `.env:505` — AI_THINKING_TIER_ENABLED=true nhưng GGUF_THINKING_MODEL KHÔNG đặt → tier thinking fallback deep model (log warn); LLAMA_SERVER_ENABLED/LLAMA_SERVER_URL hoàn toàn vắng trong .env (grep=0) → deep model nạp IN-PROCESS node-llama-cpp, đúng kịch bản tranh chấp VRAM với embedder mà doc 48 R5 cảnh báo
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AILOCAL-2 [P1/MISSING] KB/RAG KHÔNG có tri thức domain máy bắt vít / điểm keo / hàn / IoT — chỉ AOI how-to + manual controller; KB autosync đang TẮT, embeddings cũ ~18 ngày

- **Khoảng trống:** Câu hỏi (b) trả lời dứt khoát: kỹ thuật viên hỏi 'lỗi trượt lực siết xử lý sao', công nhân hỏi 'SOP thay keo', AI chỉ trả lời được bằng suy luận LLM không căn cứ hoặc trích manual PLC không liên quan. Pipeline ingest (chunks.jsonl + embeddings.jsonl + manifest, per-vendor dir) là contract MỞ — thiếu CONTENT chứ không thiếu plumbing.
- **Khuyến nghị:** Chuẩn hóa gói tri thức theo machine-type khi onboard máy mới: (1) thêm thư mục knowledge/programming/<vendor> cho torque-controller/dispenser/welder + chạy lại ingest; (2) viết bộ domain how-to VN cho từng loại máy automation + thiết bị IoT (mẫu sẵn ở knowledge/domain/aoi-*.md); (3) bật KB_AUTOSYNC_ENABLED=true (cron 03:00 sẵn có).
- **Bằng chứng:** `knowledge/chunks-stats.json:1` — Ops KB = 2.186 chunks (doc 980, service 330, type 305…) — domain/ chỉ có aoi-defect-types, aoi-thresholds, aoi-troubleshooting, aoi-workflow, commission-a-new-pcb…; KHÔNG một file nào về screw/torque, dispensing, welding, IoT · `knowledge/programming/manifest.json:1` — Programming KB 91.678 chunks nhưng chỉ 6 vendor CONTROLLER: delta 29.440 / fanuc 11.735 / mitsubishi 26.361 / omron 17.511 / universal-robots 2.467 / zmotion 4.164 — không có manual torque-driver (HIOS/Kolver/Atlas), dispenser (Nordson/Musashi), soldering (Apollo/JUKI), datasheet thiết bị IoT nội bộ · `server/services/kbSyncScheduler.ts:153` — KB_AUTOSYNC_ENABLED không có trong .env (grep=0) → scheduler log 'disabled' — KB không tự cập nhật · `knowledge/embeddings-meta.json:2` — generatedAt 2026-06-29 — corpus embed lần cuối ~18 ngày trước (hôm nay 2026-07-17), trước cả doc 51/54/55
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AILOCAL-3 [P1/LIVE] RCA Copilot (kỹ thuật viên) LIVE nhưng toàn bộ evidence pipeline AOI-bound — sự cố máy automation cho ra evidence rỗng → 'cần người xem'

- **Khoảng trống:** Máy SCREWDRIVE/DISPENSING fail-burst nằm ở process_results (stepType + metrics jsonb) và alarm ở ot_telemetry/andon — RCA không đọc các bảng này nên hypotheses gần như luôn rỗng cho automation (degrade trung thực nhưng vô dụng). Riêng nhánh quantitativeCorrelations (defectCorrelationService) có chạm process metrics thượng nguồn nhưng chỉ khi tương quan với defect AOI hạ nguồn.
- **Khuyến nghị:** Thêm 2 nguồn evidence fail-safe vào gatherEvidence: (1) pareto stepType-fail từ process_results theo machineId; (2) alarm/telemetry gần nhất (getLatestTelemetry + lookup_error_code từ PROG KB — tool đã có sẵn). Đổi system prompt thành template theo machineType. Không cần đổi khung HITL/fix.
- **Bằng chứng:** `server/services/aiRcaCopilot.ts:485` — System prompt cứng: 'You are an SMT/AOI manufacturing root-cause analyst' · `server/services/aiRcaCopilot.ts:135` — gatherEvidence 9 nguồn: paretoByDefectType (defect AOI), SPC defectRate (productInspections), anomaly ảnh, vision ảnh NG, audit config, KB, causal graph, corrections (measurement_corrections), quantitative correlation — grep processResults trong file = 0 · `.env:355` — AI_RCA_COPILOT_ENABLED=true — đang bật thật · `client/src/pages/TechnicianCopilot.tsx:2` — UI 1-tap fix qua HITL confirm chuẩn, vi/en/zh, kiosk-friendly — surface đã hoàn thiện, chỉ thiếu evidence nguồn automation
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AILOCAL-4 [P1/LIVE] Persona QUẢN LÝ + push-AI (exec report, briefing, auto-proposer, action inbox) chỉ tính KPI từ productInspections/dailyStatistics — máy automation & IoT vắng mặt trong mọi báo cáo đẩy

- **Khoảng trống:** Quản lý nhận exec summary ca/ngày/tuần tiếng Việt đều đặn nhưng nội dung 100% máy quang; fail-rate công đoạn bắt vít/keo/hàn và health thiết bị IoT không bao giờ xuất hiện trừ khi tự gõ hỏi chat. Auto-proposer không bao giờ đề xuất gì cho automation.
- **Khuyến nghị:** Thêm section 'Công đoạn automation' vào exec report + briefing (aggregate process_results theo stepType — helper aggregateProcessResultStats đã có ở db layer, F6 dùng rồi); thêm trigger auto-proposer cho metric drift (analyzeTimeSeries EWMA đã sẵn) đề xuất create_maintenance_workorder/propose_interlock_rule (2 write-tool đã đăng ký).
- **Bằng chứng:** `server/services/aiExecutiveReport.ts:127` — Nguồn: productInspections, getYieldTrendData, paretoByDefectType, PdM risk — grep processResults = 0; (điểm cộng: bug modelId doc 48 ĐÃ fix, dòng 425 pin decision.modelId) · `server/services/aiTodayBriefing.ts:1` — Briefing role-aware vi/en/zh (maintenance/operator/manager/quality) — yield/NG đều từ inspection AOI; grep processResults = 0 · `server/services/aiAutoProposer.ts:1` — Trigger duy nhất có write-proposal = NG-burst → adjust_ng_threshold (AOI). Không có trigger torque-drift/glue-underfill/weld-temp; grep processResults = 0 (cả aiActionInbox.ts) · `client/src/pages/ManagementInsight.tsx:5` — Đường PULL của quản lý (NL Q&A qua trpc.aiChat.chat) NGƯỢC LẠI đã phủ automation: analytics tools + F6 insight (analyze_line_bottleneck, correlation) đọc processResults (insightHandlersF6.ts:17) · `.env:428` — EXEC_REPORT_ENABLED=true, SCHEDULE=shift,day,week, LANG=vi, NOTIFY roles admin,supervisor — đang chạy thật, chỉ sai phạm vi dữ liệu
- **Kiểm chứng đối kháng (PARTIAL):** ĐÚNG phần lõi: aiExecutiveReport.ts gatherKpis chỉ productInspections(:127-141) + getYieldTrendData(:173) + pareto(:188) + PdM(:204); modelId pin :425; grep processResults = 0 trong cả 4 service push (aiExecutiveReport/aiTodayBriefing/aiAutoProposer/aiActionInbox — không file nào nằm trong 19 file server/services có processResults); aiAutoProposer.ts:156 chỉ rule 'ng_burst' → adjust_ng_threshold (:131), không trigger torque/glue/weld; pull-path ManagementInsight.tsx:4-5 → insightHandlersF6.ts:17 import processResults; .env:428-436 exec report đang chạy. SAI phần khái quát 'máy automation & IoT vắng mặt trong MỌI báo cáo đẩy / 100% máy quang': mục pdmRiskMachines (aiExecutiveReport.ts:199-227) và machinesNeedingAttention (aiTodayBriefing.ts:185-189) gọi computeFailureRisk trên MỌI machines row; predictiveMaintenanceService đọc bảng máy-generic (downtime_events :277, machine_health_history :583, machine_sensor_readings :606, machine_heartbeats :638); DB live (đọc read-only): machines có SCREWDRIVE×3/AUTOMATION×6/FEEDER/ASSEMBLY/ROBOT... với machine_health_history (AUTOMATION 6377 row, FEEDER 3201...) + downtime → máy automation CÓ THỂ xuất hiện trong exec report/briefing ở mục rủi ro máy. Phần vẫn đúng: fail-rate CÔNG ĐOẠN từ process_results và thiết bị IoT ngoài machines không bao giờ vào báo cáo đẩy.

#### AILOCAL-5 [P1/MISSING] Threshold Advisor + Setup Advisor không có khái niệm 'process spec' cho automation — schema không tồn tại bảng spec torque/keo/hàn để AI tư vấn

- **Khoảng trống:** Mục tiêu 'chuẩn hóa cài đặt' cho automation thiếu nền: không có nơi khai giới hạn torque min/max theo sản phẩm-công đoạn thì Threshold Advisor/auto-tune không thể mở rộng, Setup Advisor không thể pre-fill cấu hình máy bắt vít mới từ máy tương tự. parameterGuardrails (min/max/maxStep per machine+param, mig 0261) là seam gần nhất nhưng đang gắn machine-level, không gắn product/step.
- **Khuyến nghị:** Khi thiết kế chuẩn hóa config (trục config-sync), thêm bảng process_spec_limits (productModelId+stepType+metricKey → LSL/USL/target) rồi POINT Threshold Advisor vào đó (suggestThresholds tái dùng được vì thuần thống kê); mở rộng RELATED_TYPES cho họ automation; Setup Advisor sinh bundle theo machineType thay vì mặc định vision.
- **Bằng chứng:** `server/services/aiThresholdAdvisor.ts:203` — Toàn bộ thống kê trên measurementResults + pointDefId join productInspections — khái niệm điểm-đo AOI; flags .env AI_THRESHOLD_ADVISOR/AUTOTUNE=true nhưng chỉ tác dụng nhóm quang · `server/services/aiSetupAdvisor.ts:42` — RELATED_TYPES chỉ AOI/AVI/SPI/AXI + ICT/FCT — SCREWDRIVE/DISPENSING (enums.ts:27-28) không có họ tương tự; template similarity còn chạy same-type (dòng 218) nhưng bundle đề xuất là measurement points + DEFAULT_MODEL='dinov2-small' (thuần vision) · `drizzle/schema/process.ts:14` — process_results.metrics là jsonb tự do; grep toàn schema 'processSpec|stepSpec|torqueMin' = 0 — KHÔNG có bảng spec-limit per stepType/product để advisor thống kê Cpk và đề xuất
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AILOCAL-6 [P1/MISSING] Nhóm IoT vô hình với tầng AI: mọi read-tool đều machine-anchored, edge_nodes không được tool nào tham chiếu, không persona nào biết đến thiết bị IoT

- **Khoảng trống:** Nếu chuẩn đăng ký IoT sắp tới model thiết bị = machines + deviceAdapters (protocol mqtt/http) thì AI 'ăn theo' được ngay các tool telemetry/machine_status; nếu model riêng (device registry mới) thì TOÀN BỘ tầng AI phải thêm resolver mới. Đây là quyết định kiến trúc phải chốt TRƯỚC khi onboard IoT — hiện chưa có gì.
- **Khuyến nghị:** Chốt nguyên tắc: mọi thiết bị IoT đăng ký chuẩn hóa đều có machines row (machineType nhóm IOT_*) + deviceAdapter để tái dùng nguyên vẹn ~50 tool hiện có; bổ sung 1 read-tool list_iot_devices (health/last-seen/firmware) và trigger vi 'thiết bị iot', 'cảm biến'. Tránh xây registry AI song song.
- **Bằng chứng:** `server/services/aiLocalTools/handlersF6.ts:619` — get_ot_telemetry_latest .refine bắt buộc machineCode + resolveMachine trên bảng machines — thiết bị IoT không phải machines row thì AI không đọc được telemetry dù dữ liệu đã nằm trong ot_telemetry · `server/services/aiLocalTools/index.ts:1` — grep 'edgeNodes|edge_nodes|iot' trên toàn server/services/aiLocalTools = 0 file — không tool nào cho edge node / IoT device registry · `drizzle/schema/edge.ts:27` — edgeNodes tồn tại trong schema (heartbeat, deploy) nhưng chỉ phục vụ edge-AI deploy, không nối vào chat/copilot
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AILOCAL-7 [P1/LIVE] Guardrail hành động ghi: khung HITL/RBAC/interlock rất chắc và ĐANG BẬT, nhưng bảng parameter_guardrails không có seed + STRICT/VERIFY tắt → set_machine_param ngoài dải vẫn lọt nếu kỹ sư chưa nhập dải

- **Khoảng trống:** Câu hỏi (e): chuỗi an toàn propose→RBAC→confirm→interlock→commission→audit là ĐỦ TỐT về kiến trúc, kể cả cho automation (máy hàn/bắt vít nguy hiểm hơn AOI). Lỗ hổng thực dụng: guardrail bật nhưng có khả năng cao là bảng rỗng → mọi set_machine_param (nhiệt hàn, lực siết…) chỉ còn HITL người xác nhận là hàng rào cuối, trong khi OT_CONTROL đã live. Closed-loop verify (degraded→Andon) cũng đang tắt.
- **Khuyến nghị:** Trước khi nối máy automation thật: seed parameter_guardrails cho mọi tag writable (bắt buộc trong wizard onboard máy — trục registration); bật PARAM_GUARDRAIL_STRICT=true (không dải = từ chối) cho machineType nguy hiểm (WELD/SCREWDRIVE); bật PARAM_VERIFY_ENABLED để sweep degraded→Andon.
- **Bằng chứng:** `.env:508` — OT_CONTROL_ENABLED=true (dry-run ĐÃ GỠ) + ROBOT_CONTROL_ENABLED=true; dòng 691 PARAM_GUARDRAIL_ENABLED=true; PARAM_GUARDRAIL_STRICT và PARAM_VERIFY_ENABLED vắng (grep=0) → mặc định OFF · `server/services/ai/parameterGuardrailService.ts:20` — STRICT OFF = 'param KHÔNG có guardrail: cho qua + log' — enforcement chỉ áp cho param ĐÃ có row · `drizzle/0261_parameter_guardrails.sql:1` — Migration tạo bảng nhưng grep scripts/ tìm seed parameterGuardrails = 0 — không có script nạp dải chuẩn; số row thực tế CHƯA CHẮC (audit không kết nối DB) · `server/services/aiLocalTools/writeHandlers/machineControl.ts:342` — Điểm mạnh xác nhận: execute enforce guardrail HONEST-REJECT (không clamp), preview cảnh báo trước, mọi lệnh qua dispatch() với interlockGate fail-closed + commissioning gate + audit (commandDispatcher.ts:98,106); AI không có code path tự confirm (aiAutoProposer chỉ proposeAction) · `server/services/aiLocalTools/toolRegistry.ts:186` — assertExecutable bắt write-tool thiếu preview/permission fail loudly — thiết kế nền tốt để mở rộng automation/IoT
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AILOCAL-8 [P2/LIVE] Programming Copilot (doc 34) là tài sản mạnh nhất cho KỸ THUẬT automation — LIVE đầy đủ với 8 tool + refuse an toàn; chỉ thiếu corpus vendor thiết bị chuyên dụng

- **Khoảng trống:** Kỹ thuật viên lập trình PLC Delta/Mitsubishi/Omron, robot Fanuc/UR, motion Zmotion cho máy tự chế đã được hỗ trợ trọn: tra manual có trích trang, tra mã lỗi, sinh + lint + mô phỏng chương trình. Thiếu duy nhất: corpus controller chuyên dụng của máy bắt vít/keo/hàn (trùng AILOCAL-2) và bộ few-shot/golden-code cho các pattern công đoạn đó.
- **Khuyến nghị:** Tận dụng nguyên trạng khi onboard máy automation: chỉ cần bổ sung vendor dir corpus + golden-code mẫu (knowledge/golden-code đã có chỗ). Không xây gì mới.
- **Bằng chứng:** `.env:654` — GGUF_CODE_MODEL=Qwen3-Coder-30B + PROG_KB_ENABLED=true + AI_PROGRAMMING_COPILOT_ENABLED=true + AI_CODE_ROUTER_ENABLED=true + OPENAI_GATEWAY_ENABLED=true tại /v1 (dòng 657-659) — external tools gọi được chat/completions/embeddings · `server/services/aiLocalTools/readToolsProgramming.ts:9` — 8 tool: retrieve_programming_kb / lookup_error_code (RAG mã lỗi servo-drive-PLC) / syntax_check / compile / simulate (device-free by contract) / generate_program / calc / read_project_file + write_project_file HITL confined workspace · `server/services/aiLocalTools/readToolsProgramming.ts:620` — generate_program REFUSED cho safety-logic (E-stop do kỹ sư chứng nhận viết) — copilot-refuse doc 54 GĐ3 có thật trong code

#### AILOCAL-9 [P2/LIVE] Persona CÔNG NHÂN: nền tảng tốt (voice→Andon 1-tap, briefing, bubble chat role-basic vi) nhưng SOP viewer không có AI hook và không có hướng dẫn thao tác máy automation

- **Khoảng trống:** Plumbing công nhân gần đủ (báo sự cố giọng nói tiếng Việt là điểm sáng thật sự). Thiếu: (1) cầu nối SOP↔AI (đứng ở bước 3 hỏi 'làm sao biết siết đủ lực?'); (2) nội dung SOP/how-to automation trong KB (trùng AILOCAL-2) nên bubble trả lời rỗng cho máy mới; (3) cảnh báo automation đến worker chưa có lớp 'giải thích dễ hiểu' (alert text kỹ thuật thô).
- **Khuyến nghị:** Thêm nút 'Hỏi AI về bước này' trong SopViewer truyền context route+SOP-step vào KbQueryContext (cơ chế context C3a đã có); khi viết SOP máy automation thì ingest thẳng vào KB; dùng generateNarrative fast-tier viết lại alert automation thành 1 câu vi dễ hiểu (pattern aiIssueClassifier tái dùng).
- **Bằng chứng:** `client/src/components/QuickIssueReport.tsx:2` — 'Báo sự cố' 1-nút + mic Web Speech vi-VN → trpc.andon.quickReport; AI fast-tier phân loại reason/severity (aiIssueClassifier.ts:162, Qwen3-4B) → Andon; mount ở OperatorHome.tsx:202,320 + ProductionDashboard.tsx:911; useOfflineQueue hỗ trợ offline · `client/src/App.tsx:560` — AILocalChatBubble mount global 1 lần — mọi role kể cả operator hỏi được; answer level 'basic' cho worker (aiLocalKnowledgeService.ts:177-181) · `client/src/pages/SopViewer.tsx:1` — grep 'AI|assistant|copilot|chat' trong SopViewer = 0 — xem SOP thuần tĩnh, không có 'hỏi AI về bước này', không AI sinh/giải thích SOP · `client/src/components/MachineAISummary.tsx:2` — Card AI per-machine cho operator (anomaly/PdM/insight + nút Hỏi AI) — nhưng anomaly đọc AOI image embeddings, máy automation chỉ còn PdM

#### AILOCAL-10 [P3/LIVE] Tiếng Việt end-to-end: ĐẠT trên toàn tầng AI (vi mặc định, vi/en/zh song song) — chỉ còn citations/manual tiếng Anh

- **Khoảng trống:** Câu hỏi (f): đạt. Gap nhỏ: system prompt nội bộ (RCA analyst…) tiếng Anh — model đa ngữ nên output vẫn vi, không phải lỗi; manual vendor + phần lớn KB code-chunk tiếng Anh nên citation hiển thị cho công nhân là tiếng Anh.
- **Khuyến nghị:** Khi bổ sung corpus automation, ưu tiên bản dịch/tóm tắt tiếng Việt cho lớp domain how-to (công nhân đọc), giữ manual gốc tiếng Anh cho lớp kỹ thuật; không cần refactor code.
- **Bằng chứng:** `.env:430` — EXEC_REPORT_LANG=vi + TZ Asia/Ho_Chi_Minh; briefing/guardrail/dispatcher/tool textSummary đều có bộ ba vi/en/zh (vd machineControl.ts hàm w() dòng 74-76) · `server/services/aiLocalTools/intentClassifier.ts:46` — Trigger + clarify message thuần Việt ('lực siết', 'mô-men', 'lượng keo', 'xu hướng chỉ số'…); AI_TOOL_LLM_FALLBACK=1 (.env:163) bật LLM fallback khi heuristic trượt · `server/services/aiLocalKnowledgeService.ts:48` — KbLanguage vi/en/zh + follow-up suggestions 3 thứ tiếng; embedding Qwen3-Embedding đa ngôn ngữ (dim 1024)


### A.9 Taxonomy loại máy & mở rộng schema (`taxonomy-extensibility`) — AOI/AVI **72** · Automation **55** · IoT **15**

**Căn cứ chấm điểm:** Điểm = mức sẵn sàng production của MÔ HÌNH LOẠI MÁY & khả năng mở rộng schema cho từng nhóm. aoi_avi 72: 5 lớp inspection first-class ở mọi tầng (enum, capability profile, seed tree, MQTT template, contract v1) nhưng governance OFF và machine→deviceType không persisted. automation 55: SCREWDRIVE/DISPENSING/AUTOMATION/ASSEMBLY/+4 SMT đã có enum + capability profile (torque/dispense_volume) + processResults + genealogy union, nhưng client drift chặn tạo máy SMT từ UI, WELDER thiếu, device_types DB trống, attribute contract mỏng, mọi enforcement OFF. iot 15: THIẾU HẲN lớp thiết bị IoT — không có machineType, không registry, không AdapterKind iot-http/iot-mqtt, stationId NOT NULL ép hierarchy giả; chỉ tái dùng được nền telemetry/UNS.

**Tóm tắt trục:** Trục taxonomy: hệ thống có HAI hệ mô hình loại máy song song — machineTypeEnum pg enum cứng 21 giá trị là chuẩn THẬT mà runtime dùng (cột machines.machineType, validate /v1/assets, capability profile, commandAuthz), còn device_types versioned inheritance tree (Equipment→Robot/Inspection/TestCell/ProcessAutomation, CR workflow + conformance) là nền chuẩn hóa ĐÚNG HƯỚNG nhưng đang ngủ: EQ_GOVERN_ENABLED OFF, DB chỉ 5 row demo, machines không persist deviceTypeKey. Trả lời câu hỏi chính: (a) máy vít (SCREWDRIVE) + điểm keo (DISPENSING) ĐÃ first-class với capability profile torque/dispense_volume; máy hàn (WELDER) và IoT (IOT_SENSOR) THIẾU HẲN — thêm mới cần migration ADD VALUE + sync tay ≥5 file, và drift đã xảy ra thật (client thiếu 4 loại SMT, fork danh sách thứ ba tự thừa nhận); (b) hai hệ không mâu thuẫn dữ liệu nhưng chỉ enum có hiệu lực — deviceTypes row đơn thuần KHÔNG làm máy loại mới ghi được DB; (c) capabilities LIVE ở đọc/Tier-1 stamp/drift-scan nhưng mọi enforcement (Tier-2, FIELD_V2, commissioning) OFF hoặc warning-only; (d) alarm taxonomy seed thật ~122 mã (servo/robot/PLC/motion) nhưng thiếu vendor vít/keo/hàn, attributesSchema automation mỏng và không có required; (e) hierarchy 6 cấp FK + URN/ISA-95 + processResults + genealogy union ĐỦ — gap là đường máy-tự-đẩy processResults chưa có; (f) con đường đúng: ngắn hạn ADD VALUE WELDER/IOT_* + đồng bộ 3 danh sách về 1 nguồn; trung hạn seed device_types đủ 21 leaf + cột machines.deviceTypeKey + bật EQ_GOVERN; dài hạn hạ enum thành legacy, nguồn sự thật chuyển sang deviceTypes.typeKey và mở AdapterKind iot-mqtt/iot-http. Điểm: aoi_avi 72 / automation 55 / iot 15.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- capabilityModel.ts — registry capability register-and-go (registerCapabilityProfile) + mergeCapability per-machine override + fallbackProfile fail-safe: thêm lớp máy mới KHÔNG cần sửa core (server/services/equipment/capabilityModel.ts:426-433)
- deviceTypeRegistry — cây kế thừa đa cấp versioned SemVer + resolveType merge parent→child + preferNode published>draft (server/services/standards/deviceTypeRegistry.ts) + schema device_types/CR-workflow/conformance (drizzle/schema/equipmentStandards.ts) — nền governance loại máy đã xây xong, chỉ cần seed + bật cờ
- capabilitiesValidation 2-tier gate + weekly drift-scan cron (default ON) + stamp jsonb 0191 (server/services/standards/capabilitiesValidation.ts) — cơ chế validate máy-vs-contract dùng ngay cho automation/IoT
- alarm_taxonomy + master_alarms + alarmNormalizer→Andon (ISA-18.2/EEMUA-191) với seed thật 0231/0232 (mitsubishi/UR/fanuc/delta/omron/zmotion) — pattern seed mã alarm vendor chuẩn để nhân bản cho vendor vít/keo/hàn
- process_results hypertable (serialNumber+machineId+stepType+metrics jsonb, drizzle/schema/process.ts) + recordProcessResult service + genealogy union /v1/genealogy (server/api/v1/genealogyApi.ts) — đường dữ liệu kết quả công đoạn automation đã có schema đầy đủ
- POST /v1/assets declarative registration + lifecycleStatus 'registered' + urnService URN/ISA-95 path + MACHINE_LIFECYCLE_TRANSITIONS (server/api/v1/assets.ts:398-476, drizzle/schema/hierarchy.ts:221-248) — luồng đăng ký chuẩn tái dùng cho cả 3 nhóm
- EquipmentAdapter facade data-driven theo AdapterKind + registerEquipmentAdapter (server/services/equipment/equipmentAdapter.ts) + ADAPTER_SDK.md (docs/ECOSYSTEM/ADAPTER_SDK.md) — khung viết adapter iot-mqtt/iot-http không đụng core
- pluginRegistry manifest + validateManifest version-gate (server/services/plugins/pluginRegistry.ts) — kênh driver bên thứ ba/tự phát triển có kiểm soát
- Migration template ALTER TYPE ADD VALUE IF NOT EXISTS (drizzle/0242_smt_machine_types.sql) — công thức thêm machineType an toàn additive đã kiểm chứng
- contractSchemas registry UNS subject + backward-compat gate + quarantine (drizzle/schema/contracts.ts, flag CONTRACT_REGISTRY_PERSIST_ENABLED) — nền chuẩn hóa message contract cho telemetry IoT
- machineDataContract versioned zod→JSON-Schema (server/contracts/machineDataContract.ts) — pattern hợp đồng dữ liệu máy phiên bản hóa, mở rộng thêm process-result/iot-telemetry v1

**Findings (12):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| TAX-1 | P0 | LIVE | automation,iot | Thêm loại máy mới = migration pg enum + ≥5 điểm sync thủ công — deviceTypes data-driven KHÔNG thể tự thêm loại | ✔ CONFIRMED |
| TAX-2 | P0 | MISSING | iot | Nhóm IoT tự phát triển KHÔNG có mô hình thiết bị first-class ở bất kỳ tầng nào | ◐ PARTIAL |
| TAX-3 | P1 | LIVE | automation | 3 bản sao MACHINE_TYPES đã lệch nhau — UI không tạo được 4 loại máy SMT | ✔ CONFIRMED |
| TAX-4 | P1 | FLAG_OFF | all | Nền chuẩn hóa device_types (versioned tree + CR workflow + conformance) hoàn chỉnh nhưng ngủ: flag OFF, DB gần trống, machines không persist deviceTypeKey | ◐ PARTIAL |
| TAX-5 | P1 | FLAG_OFF | all | Capabilities model LIVE ở tầng đọc/validate nhưng mọi ENFORCEMENT đều OFF — contract không có răng | ◐ PARTIAL |
| TAX-6 | P1 | MISSING | automation | Máy hàn tự động (welding) không có machineType — WAVE_SOLDER chỉ cover hàn sóng PCB | ✔ CONFIRMED |
| TAX-8 | P1 | LIVE | automation,iot | mqttTopicTemplates dùng taxonomy THỨ BA (avi/aoi/spi/other) — không chuẩn hóa được topic cho automation/IoT | ✔ CONFIRMED |
| TAX-7 | P2 | LIVE | automation | Alarm taxonomy ISA-18.2 đã seed ~122+ mã vendor THẬT nhưng thiếu vendor máy vít/keo/hàn; master_alarms chỉ 4 row demo | — |
| TAX-9 | P2 | LIVE | automation,iot | Registry thiết bị song song không ràng buộc: robots / device_adapters / mqtt_clients / edge_nodes tách rời machines | — |
| TAX-10 | P2 | LIVE | all | Hierarchy + genealogy đủ cho cả 3 nhóm: FK chain 6 cấp + URN/ISA-95 + processResults union vào /v1/genealogy | — |
| TAX-11 | P2 | STUB | automation,iot | attributesSchema cho nhánh automation mỏng: node ProcessAutomation trống, không attribute nào required → Tier-2 không có gì để chặn | — |
| TAX-12 | P3 | LIVE | automation,iot | stepType của process_results là free-text — chưa có danh mục công đoạn chuẩn (process-step taxonomy) | — |

#### TAX-1 [P0/LIVE] Thêm loại máy mới = migration pg enum + ≥5 điểm sync thủ công — deviceTypes data-driven KHÔNG thể tự thêm loại

- **Khoảng trống:** machineTypeEnum (hard enum) là chuẩn THẬT được code dùng; device_types versioned tree chỉ là overlay governance — một row deviceTypes mới KHÔNG làm máy loại mới ghi được xuống DB vì insert machines.machineType vẫn fail enum cast. Hôm nay: SCREWDRIVE (máy vít) + DISPENSING (điểm keo) ĐÃ CÓ sẵn trong enum + capability profile; WELDER và IOT_SENSOR THIẾU — cần migration + sửa 5-6 file.
- **Khuyến nghị:** Ngắn hạn: migration ADD VALUE 'WELDER', 'IOT_SENSOR', 'IOT_GATEWAY' theo template 0242 + registerCapabilityProfile (register-and-go, không cần sửa DEFAULT_PROFILES). Trung hạn: hợp nhất nguồn sự thật — sinh client list từ server constant (build-time import hoặc tRPC query enumValues), thêm cột machines.deviceTypeKey rồi từng bước hạ machineTypeEnum thành legacy alias của deviceTypes.typeKey.
- **Bằng chứng:** `drizzle/schema/enums.ts:15` — machineTypeEnum pg enum cứng 21 giá trị — cột machines.machineType (hierarchy.ts:266) cast theo enum này, giá trị lạ = lỗi DB · `server/api/v1/assets.ts:419` — POST /v1/assets validate `class` theo machineTypeEnum.enumValues — WELDER/IOT_SENSOR trả 400 cho tới khi có migration · `server/constants/machineTypes.ts:12` — Comment tự nhận quy trình: thêm loại mới phải sửa enum + list này (+ client mirror + migration + i18n + capabilityModel + CLASS_PARENT deviceTypeRegistry.ts:96-105) · `drizzle/0242_smt_machine_types.sql:18` — Template chuẩn ALTER TYPE ADD VALUE IF NOT EXISTS (additive, an toàn) — bằng chứng con đường duy nhất là migration
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### TAX-2 [P0/MISSING] Nhóm IoT tự phát triển KHÔNG có mô hình thiết bị first-class ở bất kỳ tầng nào

- **Khoảng trống:** Con đường duy nhất cho IoT hôm nay là giả dạng máy AUTOMATION trên một station giả + apiKey máy, nhưng ingest chỉ có /v1/ingest/inspection (inspection-shaped) — không khớp dữ liệu sensor. Tầng lưu (ot_telemetry có telemetryProtocolEnum 'mqtt'/'sparkplug', stateStore/UNS) ĐÃ SẴN nhận dữ liệu IoT nhưng tầng ĐĂNG KÝ/ĐỊNH DANH thiết bị thiếu hẳn.
- **Khuyến nghị:** Thêm typeKey 'IoTDevice' (con của Equipment) vào seed tree + machineType 'IOT_SENSOR'/'IOT_GATEWAY' (migration ADD VALUE) + AdapterKind 'iot-mqtt'/'iot-http' qua registerEquipmentAdapter (data-driven, không sửa core switch). Quyết định thiết kế cần chốt: (a) IoT dùng chung bảng machines (nới stationId nullable hoặc quy ước station ảo per-workshop) hay (b) bảng iot_devices riêng FK về machines — khuyến nghị (a) để hưởng trọn lifecycle/URN/health/asset-registry sẵn có.
- **Bằng chứng:** `drizzle/schema/enums.ts:15` — machineTypeEnum không có giá trị IOT/SENSOR/GATEWAY nào; grep 'iot' toàn drizzle/schema chỉ trúng 1 comment energy meter (g3.ts:12) · `server/services/equipment/capabilityModel.ts:58` — AdapterKind: ot-opcua/modbus/s7/mitsubishi-mc/ethernet-ip/stub/vision/robot/mtconnect/secsgem/vda5050/focas/euromap — KHÔNG có iot-http/iot-mqtt cho thiết bị tự chế nói REST/MQTT · `drizzle/schema/enums.ts:219` — otProtocolEnum (device_adapters) = opcua/modbus/s7/mitsubishi-mc/ethernet-ip/stub/slmp — không có mqtt/http, nên IoT device không đăng ký được làm OT adapter · `drizzle/schema/hierarchy.ts:262` — machines.stationId NOT NULL (fk restrict) — sensor môi trường/xưởng không gắn station buộc phải tạo station giả · `drizzle/schema/mqtt.ts:5` — mqtt_clients là registry app Android (deviceModel Samsung/Xiaomi, fcmToken) — không phải IoT device registry
- **Kiểm chứng đối kháng (PARTIAL):** 5 evidence đều đúng nguyên văn: enum không IOT/SENSOR/GATEWAY (enums.ts:15-39); grep -i 'iot' drizzle/schema chỉ trúng g3.ts:12; AdapterKind không iot-http/iot-mqtt (capabilityModel.ts:58-73); otProtocolEnum=opcua/modbus/s7/mitsubishi-mc/ethernet-ip/stub/slmp không mqtt/http (enums.ts:219); machines.stationId NOT NULL onDelete restrict (hierarchy.ts:262-263); mqtt_clients là registry app Android — deviceModel/osVersion/fcmToken (mqtt.ts:5-38); HTTP ingest chỉ POST /v1/ingest/inspection (server/api/v1/router.ts:305-309, guard.ts:42). PHẦN SAI: câu 'con đường DUY NHẤT là giả dạng máy AUTOMATION trên station giả + apiKey máy' quá tuyệt đối — device_adapters.machineId NULLABLE (drizzle/schema/ot.ts:20) cho phép đăng ký thiết bị nói protocol công nghiệp (modbus/opcua/slmp — phổ biến trên sensor DIY ESP32/PLC nhỏ) làm adapter STANDALONE không cần machine/station/apiKey, và telemetryBus chấp nhận deviceId chưa map với machineId null ('not-yet-mapped devices still ingest' — server/services/telemetryBus.ts:11-12,49-50). Bế tắc đăng ký chỉ đúng trọn vẹn cho thiết bị IoT tự chế nói REST/MQTT.

#### TAX-3 [P1/LIVE] 3 bản sao MACHINE_TYPES đã lệch nhau — UI không tạo được 4 loại máy SMT

- **Khoảng trống:** Drift đang sống trong production: form tạo máy/wizard/onboarding không chọn được 4 loại SMT trong khi import Excel lại cho phép — bằng chứng thực nghiệm rằng cơ chế sync tay 3 danh sách chắc chắn sẽ vỡ tiếp khi thêm loại automation/IoT mới.
- **Khuyến nghị:** Sửa ngay client machineTypes.ts thêm 4 giá trị SMT + xóa fork IMPORT_MACHINE_TYPES (dùng lại 1 nguồn). Bền vững: client lấy danh sách loại máy từ server (tRPC query trả machineTypeEnum.enumValues hoặc deviceTypes tree) thay vì hằng compile-time.
- **Bằng chứng:** `client/src/constants/machineTypes.ts:5` — Chỉ 17 giá trị — THIẾU MOUNTER/REFLOW/STENCIL_PRINTER/WAVE_SOLDER dù enum + server constant có 21 (comment 'KEEP IN SYNC' đã vỡ) · `client/src/components/factoryConfig/factoryConfigIO.ts:14` — Fork danh sách THỨ BA IMPORT_MACHINE_TYPES đủ 21 giá trị, comment thừa nhận: 'Bản client/src/constants/machineTypes.ts đang thiếu 4 loại SMT nên KHÔNG dùng ở đây' · `client/src/components/factoryConfig/MachinesTab.tsx:191` — Dropdown tạo máy map MACHINE_TYPES (17) — cùng pattern ở FactorySetupWizard.tsx:645 và onboarding Step1MachineInfo.tsx:102
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### TAX-4 [P1/FLAG_OFF] Nền chuẩn hóa device_types (versioned tree + CR workflow + conformance) hoàn chỉnh nhưng ngủ: flag OFF, DB gần trống, machines không persist deviceTypeKey

- **Khoảng trống:** Đây chính là nền chuẩn hóa loại máy mà mục tiêu automation/IoT cần, nhưng đang là tài sản ngủ: không seed đủ, không flag, không FK — nên mọi luồng runtime vẫn neo vào hard enum. Không thể trace 'máy này tuân thủ contract phiên bản nào' vì version chỉ nằm trong stamp jsonb.
- **Khuyến nghị:** Lộ trình kích hoạt: (1) service seed 21 leaf từ buildSeedTypes vào DB (origin='seed', idempotent theo uq_devtype_key_version); (2) migration thêm machines.deviceTypeKey nullable + backfill qua resolveDeviceTypeForMachineType; (3) bật EQ_GOVERN_ENABLED staging theo runbook doc 19/23; (4) mở rộng tree cho SCREW_DRIVER/GLUE_DISPENSER/WELDER/IoTDevice qua CR workflow thay vì sửa code.
- **Bằng chứng:** `server/services/standards/deviceTypeRegistry.ts:40` — eqGovernEnabled(): EQ_GOVERN_ENABLED default OFF (.env.example:1751 = false); seed in-memory 21 leaf + 6 node cấu trúc (Equipment→Robot/Inspection/TestCell/ProcessAutomation) với resolveType merge kế thừa parent→child hoạt động PURE · `server/routers/equipmentStandardsRouter.ts:89` — Mọi mutation (đăng ký type/CR/publish/alarm mapping) throw CONFLICT khi flag OFF; reads (hierarchyTree/resolveType) LIVE không cần flag · `scripts/seed-engineering-data.mjs:210` — DB device_types chỉ được seed 5 row demo (Equipment/Robot/CollaborativeRobot/AOI/SPI — adapterKind 'aoi' còn sai vocabulary) — không có leaf automation nào persisted · `drizzle/schema/hierarchy.ts:309` — machines chỉ có capabilities + capabilitiesValidation jsonb — KHÔNG có cột deviceTypeKey/deviceTypeVersion; link chỉ ephemeral qua mappedMachineTypes lúc validate (doc 27 M8 vẫn mở)
- **Kiểm chứng đối kháng (PARTIAL):** PHẦN SAI (cốt lõi status FLAG_OFF): .env thực tế của repo đặt EQ_GOVERN_ENABLED=true (.env:544) và .env.sim:160 cũng =true → eqGovernEnabled() TRẢ TRUE khi server chạy env này, mutations governance (register/CR/publish) KHÔNG bị chặn; claim 'không flag'/'tài sản ngủ' không đúng với môi trường hiện hành (default code OFF tại deviceTypeRegistry.ts:40-42 và .env.example:1751=false thì đúng). PHẦN ĐÚNG: mutations gated requireFlag() throw CONFLICT (equipmentStandardsRouter.ts:88-92, 8 call sites :219-516), reads không cần flag; seed DB chỉ 5 row demo Equipment/Robot/CollaborativeRobot/AOI/SPI với adapterKind 'aoi' sai vocabulary — AdapterKind hợp lệ là 'vision' (scripts/seed-engineering-data.mjs:210-216 vs capabilityModel.ts:58-73,362); machines KHÔNG có cột deviceTypeKey/deviceTypeVersion — link chỉ nằm trong stamp jsonb capabilitiesValidation {deviceTypeKey, deviceTypeVersion?} (hierarchy.ts:27-36, 309-312); seed in-memory 21 leaf + 6 node cấu trúc với resolveType merge parent→child pure (deviceTypeRegistry.ts:96-105, 126+).

#### TAX-5 [P1/FLAG_OFF] Capabilities model LIVE ở tầng đọc/validate nhưng mọi ENFORCEMENT đều OFF — contract không có răng

- **Khoảng trống:** Một máy vít khai capabilities rác hoặc thiếu thuộc tính bắt buộc vẫn onboard trót lọt; một lệnh ngoài supportedCommands không bị chặn bởi capability (chỉ bị chặn bởi HITL/dry-run gate chung). UI hầu như không phân nhánh theo loại máy (SCREWDRIVE/DISPENSING chỉ xuất hiện trong i18n label).
- **Khuyến nghị:** Trước khi onboard automation hàng loạt: seed required attributes cho các leaf automation rồi bật CAPABILITIES_VALIDATION_ENFORCED; sửa commandAuthz dùng getCapabilitiesForMachine (merged per-machine) thay vì default per-type; thêm bước UI ẩn command không thuộc supportedCommands của máy.
- **Bằng chứng:** `server/services/standards/capabilitiesValidation.ts:47` — Tier-2 CAPABILITIES_VALIDATION_ENFORCED default OFF (chỉ Tier-1 stamp warning); drift-scan cron tuần default ON (:53-55) — phần LIVE thật · `server/routers/hierarchyRouters.ts:1363` — updateMachine validate + stamp capabilitiesValidation mỗi lần save (Tier-1 LIVE, migration 0191); chặn chỉ khi flag on + blockingErrors · `server/services/field/commandAuthz.ts:19` — requiredPermission của CommandDescriptor chỉ enforce khi FIELD_V2_ENABLED (default OFF → { ok:true, skipped:true }); và dùng getDefaultCapability(machineType) — KHÔNG dùng per-machine merged override, nên disabledCommands của máy cụ thể không được tôn trọng ở authz · `server/routers/hierarchyRouters.ts:97` — commissionGovernanceWarning: khi tạo máy chỉ CẢNH BÁO chuỗi nếu machineType không có device type published/fail conformance — không chặn, không lưu · `client/src/pages/MachineCockpit.tsx:893` — UI hiển thị 'Resolved capability' + CapabilitiesValidationBadge — phần adapt-UI theo capability LIVE nhưng mới ở mức hiển thị, chưa ẩn/hiện control theo supportedCommands
- **Kiểm chứng đối kháng (PARTIAL):** PHẦN ĐÚNG: CAPABILITIES_VALIDATION_ENFORCED default OFF, không set trong .env (capabilitiesValidation.ts:47-50; grep .env chỉ có EQ_GOVERN_ENABLED); drift-scan default ON (:53-55); updateMachine stamp tier-1 + chặn chỉ khi flag on (hierarchyRouters.ts:1362-1383 — lưu ý validate CHỈ khi payload đụng field capabilities, tạo máy mới không validate); FIELD_V2_ENABLED=false (.env.example:1820, không set trong .env) → authorizeCommand trả {ok:true,skipped:true} (commandAuthz.ts:88) và dùng getDefaultCapability không merge per-machine (:56-57); commissionGovernanceWarning chỉ cảnh báo, không chặn/lưu (hierarchyRouters.ts:96-108); SCREWDRIVE/DISPENSING trong client chỉ xuất hiện ở i18n label + constants (grep client = 0 phân nhánh logic); MachineCockpit.tsx:893-895 hiển thị capability + badge. PHẦN SAI: câu 'một lệnh ngoài supportedCommands không bị chặn bởi capability' — POST /v1/equipment/:id/commands CHẶN 400 unsupported_command theo capability MERGED per-machine (server/api/v1/router.ts:255-266; resolveCapability = getCapabilitiesForMachine per-machine :74-76; disabledCommands per-machine ĐƯỢC filter trước khi find — capabilityModel.ts:549-551) → enforcement capability có răng LIVE không cần flag ở đường /v1; chỉ đường dispatcher OT/robot (commandAuthz FIELD_V2) là advisory như finding mô tả.

#### TAX-6 [P1/MISSING] Máy hàn tự động (welding) không có machineType — WAVE_SOLDER chỉ cover hàn sóng PCB

- **Khoảng trống:** Trong 3 loại máy automation user nêu (vít/keo/hàn), 2 loại đầu đã first-class, loại hàn thiếu cả machineType lẫn capability profile lẫn robot job verb. Nếu ép dùng AUTOMATION generic sẽ mất telemetry đặc thù (dòng hàn, nhiệt độ mũi hàn, thời gian hàn) trong capability contract.
- **Khuyến nghị:** Migration ADD VALUE 'WELDER' + registerCapabilityProfile với telemetry weld_current/tip_temp/weld_time + thêm 'weld' vào robotJobTypeEnum (ALTER TYPE ADD VALUE) + CLASS_PARENT WELDER→ProcessAutomation. Gói chung một migration với IOT_SENSOR để một lần ALTER.
- **Bằng chứng:** `drizzle/schema/enums.ts:34` — Nhóm SMT có WAVE_SOLDER (hàn sóng/selective PCB) nhưng không có WELDER/SOLDER_ROBOT tổng quát cho hàn điểm/laser/ultrasonic; grep WELD toàn schema = 0 ngoài WAVE_SOLDER · `drizzle/schema/robot.ts:16` — robotJobTypeEnum có 'dispense','screw' (verbs automation) nhưng không có 'weld' — cả nhánh robot job cũng thiếu verb hàn
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### TAX-8 [P1/LIVE] mqttTopicTemplates dùng taxonomy THỨ BA (avi/aoi/spi/other) — không chuẩn hóa được topic cho automation/IoT

- **Khoảng trống:** Mọi máy vít/keo/hàn/IoT khi định nghĩa mẫu topic MQTT đều phải là 'other' và mượn khung inspection — tức tầng chuẩn hóa kết nối MQTT (một mục tiêu chính của user) đang khóa theo AOI. Đây là taxonomy song song thứ ba (sau machineTypeEnum và deviceTypes.typeKey).
- **Khuyến nghị:** Migration đổi mqtt_topic_templates.deviceType → varchar tham chiếu deviceTypes.typeKey (giữ giá trị cũ làm alias), thêm cột processResultTopic/telemetryTopic; hoặc gộp hẳn vào UNS topic convention (uns_tag_mappings + contractSchemas subject 'syn/...') đang có sẵn để tránh nuôi 2 hệ topic.
- **Bằng chứng:** `drizzle/schema/enums.ts:122` — deviceTypeEnum = ['avi','aoi','spi','other'] — enum riêng, không liên quan machineTypeEnum lẫn deviceTypes.typeKey · `drizzle/schema/mqtt.ts:398` — mqtt_topic_templates.deviceType dùng enum trên; template chỉ có inspectionResultTopic/ngAlertTopic/statusTopic/commandTopic/heartbeatTopic — shape thuần inspection, không có processResultTopic/telemetryTopic
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### TAX-7 [P2/LIVE] Alarm taxonomy ISA-18.2 đã seed ~122+ mã vendor THẬT nhưng thiếu vendor máy vít/keo/hàn; master_alarms chỉ 4 row demo

- **Khoảng trống:** Cơ chế chuẩn hóa alarm (mapAlarm + alarmNormalizer→Andon, gated EQ_INTEG_ENABLED OFF) đã hoàn chỉnh và có dữ liệu nền servo/PLC/motion (đúng linh kiện bên trong máy vít/keo), nhưng mã alarm cấp MÁY của các vendor automation và bộ master alarm rationalized cho automation chưa có.
- **Khuyến nghị:** Khi chốt danh sách máy automation nội bộ, trích bảng mã lỗi từ manual vendor thành migration seed kiểu 0231 (pattern đã chuẩn); dùng cột deviceTypeKey để scope theo typeKey mới thay vì machineType.
- **Bằng chứng:** `drizzle/0231_alarm_taxonomy_vendor_seed.sql:9` — Seed thật vào DB: Mitsubishi MR-J4 servo (55 mã), Universal Robots, Fanuc, Delta ASDA, Omron NJ/NX, Zmotion + 0232 Omron bổ sung — idempotent ON CONFLICT DO NOTHING · `drizzle/schema/equipmentStandards.ts:125` — alarm_taxonomy có cột machineType/deviceTypeKey varchar scoping — schema sẵn sàng cho automation, chỉ thiếu dữ liệu vendor chuyên dụng (Atlas Copco/Desoutter vít, Nordson/Musashi keo, trạm hàn) · `scripts/seed-engineering-data.mjs:225` — master_alarms (rationalization EEMUA-191: priority/consequence/timeToRespond/shelving) chỉ được seed 4 row demo — chưa có bộ master alarm cho automation

#### TAX-9 [P2/LIVE] Registry thiết bị song song không ràng buộc: robots / device_adapters / mqtt_clients / edge_nodes tách rời machines

- **Khoảng trống:** Khi chuẩn hóa đăng ký 3 nhóm thiết bị, mỗi thiết bị cần MỘT định danh gốc; hiện một máy tự động dùng robot + PLC có thể rơi vào 3 registry (machines, robots, device_adapters) mà không có ràng buộc toàn vẹn — đếm tài sản/health/genealogy dễ lệch. CHƯA CHẮC mức trùng thực tế trong DB (không kết nối DB theo nguyên tắc audit).
- **Khuyến nghị:** Chốt machines (+URN) là asset gốc: thêm robots.machineId + backfill, coi robots/device_adapters là 'connection profile' của machine (giống hướng doc 44 asset identity); deprecate workstations hoặc migrate về stations.
- **Bằng chứng:** `drizzle/schema/robot.ts:20` — robots là bảng độc lập (code unique riêng, lineId/stationId soft không FK, KHÔNG có machineId) — một robot vật lý có thể vừa là machines row (machineType ROBOT) vừa là robots row không link · `drizzle/schema/ot.ts:20` — device_adapters.machineId nullable soft-link — adapter OT có thể tồn tại không gắn máy nào · `drizzle/schema/hierarchy.ts:339` — workstations là bảng station SONG SONG legacy (khác stations) với factoryId/workshopId/lineId soft — hai khái niệm 'trạm' cùng tồn tại

#### TAX-10 [P2/LIVE] Hierarchy + genealogy đủ cho cả 3 nhóm: FK chain 6 cấp + URN/ISA-95 + processResults union vào /v1/genealogy

- **Khoảng trống:** Điểm mạnh nhất của trục này — KHÔNG cần migration hierarchy mới cho automation. Gap duy nhất: processResults chỉ ghi được qua tRPC protectedProcedure (processResultRouter.ts:32 — cần session người dùng); máy automation KHÔNG tự đẩy kết quả được (không có đường apiKey/MQTT — grep processResult trong mqttService = 0, /v1 chỉ có /ingest/inspection) → genealogy automation sẽ rỗng trên thực tế (chi tiết thuộc trục API/ingest).
- **Khuyến nghị:** Giữ nguyên schema; bổ sung đường ingest máy-tự-đẩy cho processResults (/v1/ingest/process-result auth bằng machine apiKey + MQTT topic) — tái dùng recordProcessResult service sẵn có.
- **Bằng chứng:** `drizzle/schema/hierarchy.ts:52` — corporates→factories→workshops→production_lines→stations→machines FK RESTRICT (0180) + partial unique code active + lifecycle transitions app-enforced (MACHINE_LIFECYCLE_TRANSITIONS:232-240) · `drizzle/schema/hierarchy.ts:301` — machines.urn + isa95_path (0251, urnService sync) — định danh asset chuẩn UNS cho mọi loại máy · `server/api/v1/genealogyApi.ts:119` — GET /v1/genealogy/{unitId} union productInspections + processResults (join machines) time-ordered — 'board qua máy vít nào' trả lời được NGAY khi processResults có dữ liệu · `drizzle/schema/process.ts:14` — process_results hypertable-ready: serialNumber + machineId + stepType + metrics jsonb + recipeRef — bảng kết quả công đoạn generic cho automation đã tồn tại từ Sprint F2

#### TAX-11 [P2/STUB] attributesSchema cho nhánh automation mỏng: node ProcessAutomation trống, không attribute nào required → Tier-2 không có gì để chặn

- **Khoảng trống:** Contract loại máy cho automation hiện chỉ mô tả telemetry, không mô tả THAM SỐ CẤU HÌNH đặc thù (torque_target/torque_tolerance cho vít, volume_target/viscosity cho keo, weld profile cho hàn) và không có ràng buộc bắt buộc — nghĩa là 'chuẩn hóa quản lý cấu hình' theo loại máy chưa có xương sống dữ liệu.
- **Khuyến nghị:** Nâng seed tree: khai attributesSchema đặc thù + required cho từng leaf automation (qua CR workflow khi bật EQ_GOVERN, hoặc sửa buildSeedTypes); dùng làm hợp đồng validate machines.capabilities và sau này validate recipe/settings per-type.
- **Bằng chứng:** `server/services/standards/deviceTypeRegistry.ts:172` — Node ProcessAutomation (cha của AUTOMATION/ASSEMBLY/FEEDER/SCREWDRIVE/DISPENSING/PACKAGING/4 SMT) không khai attributesSchema — chỉ Equipment base có 5 attr (vendor/model/protocol/pack_ml_state/utilization_rate) và leaf lấy từ telemetry profile (SCREWDRIVE có torque, DISPENSING có dispense_volume) · `server/services/standards/deviceTypeRegistry.ts:108` — EQUIPMENT_BASE_ATTRS: không attr nào set required:true — validateCapabilities.blockingErrors chỉ sinh từ required (capabilitiesValidation.ts:176-182), nên cả seed tree hiện không thể tạo blocking error nào

#### TAX-12 [P3/LIVE] stepType của process_results là free-text — chưa có danh mục công đoạn chuẩn (process-step taxonomy)

- **Khoảng trống:** Thiếu vocabulary chuẩn cho công đoạn (screw_tightening/glue_dispense/weld/solder/leak_test...) và contract phiên bản hóa tương ứng — dashboard phân tích chéo máy automation sẽ phân mảnh theo chuỗi tùy hứng của từng máy.
- **Khuyến nghị:** Thêm bảng danh mục process_step_types (data-driven, không pg enum — theo repo convention varchar) hoặc gắn stepType vào supportedCommands/telemetry của deviceTypes; mở rộng MACHINE_CONTRACT_VERSIONS thêm schema 'process-result v1' tái dùng zod→JSON-Schema đã có.
- **Bằng chứng:** `drizzle/schema/process.ts:20` — stepType varchar(64) tự do + machineType nullable snapshot — máy vít A ghi 'screw', máy B ghi 'screw_tightening' sẽ vỡ phân tích Pareto/dashboard theo công đoạn · `server/contracts/machineDataContract.ts:14` — Machine data contract versioned (v1) chỉ định nghĩa cho inspection (overallResult OK/NG/NTF + measurements) — chưa có contract version cho process-result/telemetry payload của automation/IoT


### A.10 Hiện trạng thật automation + IoT (`automation-iot-reality`) — AOI/AVI **82** · Automation **55** · IoT **48**

**Căn cứ chấm điểm:** Điểm = mức 'dùng được NGAY' trong live env (.env thật), không phải mức code. aoi_avi 82: submitInspection + store-forward + hot-folder + ST4I adapter + MQTT ACL đều LIVE. automation 55: driver/capability/recipe/dispatcher là code thật chất lượng cao nhưng OT_GATEWAY tắt ở live, result-ingest machine-key thiếu, connector SECS/MTConnect không có target, robot vendor scaffold — mới chứng minh E2E trong DB _sim. iot 48: 2 đường ingest LIVE thật (HTTP /api/ot/ingest + MQTT sensor→PdM) nhưng thiếu device-class IoT, thiếu HTTP-poll driver, endpoint không được tài liệu hóa, provisioning phải mượn machine registry.

**Tóm tắt trục:** HIỆN TRẠNG THẬT automation/IoT: nền tảng KHÔNG rỗng — 2 đường ingest cho thiết bị ngoài AOI/AVI đã LIVE hôm nay: (1) POST /api/ot/ingest (HTTP JSON, per-machine key, CanonicalSample, rate-tier riêng — server/_core/index.ts:356) và (2) MQTT factory/{fid}/{code}/sensor/{type} → machine_sensor_readings (PDM_SENSOR_INGEST_ENABLED=true). Đăng ký chuẩn hóa cũng LIVE: machine.register nhận đủ 21 machineType (SCREWDRIVE/DISPENSING/MOUNTER…) → admin duyệt → claimKey một-lần. OT framework PLC (7 driver thật opcua/modbus/s7/mc/eip/slmp + HA + deadband + store-forward WAL) là code production-grade NHƯNG OT_GATEWAY_ENABLED bị comment ở .env live (dòng 469) trong khi OT_CONTROL_ENABLED=true (508) — southbound polling chỉ mới chạy trong Full-Sim DB _sim (OPC-UA/Modbus thật; S7/EIP cố ý không serve). CON ĐƯỜNG NGẮN NHẤT HÔM NAY — (i) máy bắt vít HTTP JSON: register(SCREWDRIVE)→duyệt→claimKey→POST /api/ot/ingest metric torque = CHẠY NGAY; kết quả từng chu trình vít = GAP P0 duy nhất (process_results có schema+service+stats nhưng record là protectedProcedure session-user, /api/v1 chỉ có ingest/inspection) → build mỏng 1 endpoint /api/v1/ingest/process-result gọi recordProcessResult là xong chuỗi; tạm thời có thể mượn /api/v1/ingest/inspection dạng ST4I (mỗi vít = 1 point). (ii) ESP32 nhiệt-ẩm: đường HTTP (register→apiKey→/api/ot/ingest metric temperature/humidity) hoặc MQTT (credential mqtt_clients, MQTT_REQUIRE_PASSWORD=true, sensorType free-form) — cả hai LIVE, không phải build gì; thiếu chịu: không có machineType IoT (phải khai man AUTOMATION/FEEDER — AIR-3) và /api/ot/ingest vô hình trong OpenAPI/ApiDocs (AIR-8). ĐỐI CHIẾU DOC 16/18/19: 8 Khối doc 16 đều đã build thành framework flag-gated đúng như doc 18 tuyên bố; doc 19 runbook đã kích hoạt phần lớn ở .env live (FLEET_ORCH/RESOURCE, TWIN_LIVE, SAFETY_AUDIT+WORKFORCE, EQ_GOVERN, EQ_INTEG, DPC_IR_V2, PDM_SENSOR_INGEST, SECS_GEM, MTCONNECT, FOE — /orchestration hết 501, foeEngine thật) NHƯNG: FIELD_V2, ANDON_ROBOT_DISPATCH, AI_ROBOT_ANOMALY, ERP_INBOUND/OUTBOX, PDM_AUTO_WORKORDER chưa bật; SECS/MTConnect bật cờ mà không có target (SECS_GEM_EQUIPMENT/MTCONNECT_SOURCES trống → honest no-op); seam doc 18 còn nguyên: N-1 FOCAS/Euromap, N-2 robot vendor scaffold (chỉ sim đủ, ROBOT_CONTROL=true), N-4 safety advisory, Zmotion koffi shim chưa có; seam ĐÃ đóng: N-6 mapAlarm wired đủ MTConnect/SECS/FOCAS/Euromap, N-10 đóng một nửa (flags bật nhưng gateway OT chưa sống). KẾT LUẬN: để onboard nội bộ đợt đầu chỉ cần 4 việc nhỏ: (1) endpoint machine-key cho process_results [P0], (2) bật OT_GATEWAY + adapter row cho máy nói PLC, (3) thêm machineType IOT_SENSOR/WELDING, (4) tài liệu hóa /api/ot/ingest — còn lại tận dụng tài sản sẵn có.

**Hạ tầng sẵn có nên TẬN DỤNG (reusable assets):**
- POST /api/ot/ingest + telemetryBus CanonicalSample (server/_core/index.ts:356, server/services/telemetryBus.ts) — đường HTTP JSON ingest LIVE cho MỌI thiết bị, có deviceId soft-resolution (1 gateway credential forward nhiều device) + rate tier riêng per-machine
- Luồng đăng ký chuẩn machine.register → duyệt → claimKey một-lần (server/routers/hierarchyRouters.ts:699, :982) — nhận mọi machineType, throttle per-IP, pending cap, audit không plaintext
- OT driver framework 7 protocol + ConnectionSupervisor HA + deadband/sampling per-tag + plugin sidecar SDK (server/services/ot/*, drizzle/schema/ot.ts device_adapters/device_tags, scripts/plugin-scaffold.mjs)
- process_results + processResultService + aggregateProcessResultStats/getProcessMetricSeries (drizzle/schema/process.ts, server/db/processResult.ts) — schema kết quả automation đã đúng, chỉ thiếu endpoint machine-key
- capabilityModel 21 profiles + deviceTypeRegistry inheritance tree (server/services/equipment/capabilityModel.ts:377 SCREWDRIVE torque / DISPENSING volume; server/services/standards/deviceTypeRegistry.ts) — nền chuẩn hóa loại thiết bị
- ST4I Standard Inspection Feed spec + adapter chuẩn + genericJson + hot-folder (docs/ECOSYSTEM/28_*, server/services/vision/adapters/st4iStandard.ts, hotFolderService.ts) — mẫu 'tự phát hành spec + adapter conformance' nên nhân bản cho process-result
- MQTT broker aedes nhúng + topic ACL secure-by-default + admission gate + sensorIngestService PdM (server/services/mqttService.ts, sensorIngestService.ts:31) — đường IoT MQTT LIVE: factory/{fid}/{code}/sensor/{type} → machine_sensor_readings
- UNS publisher trọn bộ: Sparkplug-B encoder/node + topic v2 ISA-95 + aggregates + cmd-ack (server/services/unsPublisher.ts, server/services/uns/*) — cờ đã ON live, chờ producer OT
- Store-forward WAL 2 tầng: telemetry (OT_STORE_FORWARD) + inspection (INSPECTION_STORE_FORWARD) + edge UNS buffer ≥24h idempotent replay (server/services/ot/storeForward.ts, server/services/edge/edgeGatewayRuntime.ts) — đều bật live
- Edge gateway process per-line đóng gói sẵn (server/edge/edgeGatewayMain.ts, deploy/edge/Dockerfile.edge) — dùng làm IoT gateway biên khi triển khai xưởng
- commandDispatcher HITL đầy đủ gate (write-tag whitelist, commissioning, interlock, readback, 2FA actuation) (server/services/ot/commandDispatcher.ts) — chuẩn control duy nhất, ADAPTER_SDK.md cấm mọi đường ghi trực tiếp
- Bộ simulator protocol thật: sim-factory (OPC-UA/line + Modbus + MTConnect + scenario runner phá hoại) + scripts/sim (hsms-equipment SECS, vda5050-agv, sensor-generator MQTT PdM, opcua-server, modbus-slave, mtconnect-agent) — harness nghiệm thu pre-hardware cho mọi nhóm máy
- ADAPTER_SDK.md register-and-go (registerEquipmentAdapter/registerCapabilityProfile/registerDriver/registerProgrammingAdapter) — thêm vendor không sửa core, đã có registryU4b.test chứng minh behaviour-preserving

**Findings (12):**

| ID | Sev | Trạng thái | Phạm vi | Phát hiện | Kiểm chứng |
|---|---|---|---|---|---|
| AIR-1 | P1 | FLAG_OFF | automation | OT gateway TẮT ở .env live trong khi OT_CONTROL_ENABLED=true — southbound PLC polling không chạy, control path armed nhưng mọi lệnh ra ADAPTER_OFFLINE | ✔ CONFIRMED |
| AIR-2 | P0 | MISSING | automation | Không có endpoint machine-key để máy automation tự đẩy KẾT QUẢ CHU TRÌNH (process_results) — mảnh thiếu trung tâm của 'tiêu chuẩn hóa dữ liệu API' cho máy bắt vít/điểm keo | ✔ CONFIRMED |
| AIR-3 | P1 | MISSING | iot,automation | Thiếu device-class cho IoT: MACHINE_TYPES không có SENSOR/IOT/GATEWAY — ESP32 phải giả dạng AUTOMATION/FEEDER; thiếu luôn WELDING (chỉ có WAVE_SOLDER) | ✔ CONFIRMED |
| AIR-4 | P1 | MISSING | iot | Không có HTTP/REST poll driver trong OT framework — thiết bị IoT/REST chỉ PUSH được, không POLL được; IO-Link HTTP path là descriptor 'assumed' | ✔ CONFIRMED |
| AIR-5 | P1 | STUB | automation | Connector chuẩn công nghiệp bật cờ nhưng KHÔNG có target: SECS_GEM_ENABLED=true không có SECS_GEM_EQUIPMENT, MTCONNECT_ENABLED=true nhưng MTCONNECT_SOURCES comment, CFX tắt — 'LIVE trên giấy' | ✔ CONFIRMED |
| AIR-6 | P1 | STUB | automation | Robot vendor drivers là scaffold (Fanuc/Mitsubishi/Delta throw 'not installed'; chỉ sim chạy đủ, Techman/UR một phần) trong khi ROBOT_CONTROL_ENABLED=true ở live | ◐ PARTIAL |
| AIR-7 | P2 | STUB | automation | Zmotion deploy thiếu FFI shim koffi (zauxdll.dll) — validate/compile/simulate chạy thật, deploy fail honest với TODO | — |
| AIR-8 | P2 | LIVE | iot,automation | POST /api/ot/ingest — đường ingest IoT/automation chính — KHÔNG có trong OpenAPI v1 lẫn ApiDocs UI; contract chỉ tồn tại trong code | — |
| AIR-9 | P2 | FLAG_OFF | iot,aoi_avi | MQTT admission gate chỉ flag+log (MQTT_ADMISSION_ENFORCE default off) và mTLS device-PKI chưa bật — thiết bị chưa APPROVED vẫn pub/sub business topics | — |
| AIR-10 | P2 | FLAG_OFF | all | Edge gateway process per-line đã build TRỌN (entrypoint + Dockerfile + UNS store-forward ≥24h + heartbeat degraded) nhưng chưa từng chạy — EDGE_GATEWAY_MODE unset | — |
| AIR-11 | P2 | STUB | automation | Full-Sim cố ý KHÔNG serve S7/EtherNet-IP → máy SCREWDRIVE/PACKAGING trong nhà máy ảo không có telemetry qua driver thật — câu chuyện demo máy vít chưa được chứng minh E2E | — |
| AIR-12 | P3 | LIVE | automation | Recipe rollout dừng ở catalog/ledger (by design): recipe_sets + distributeRecipeSet + verify đủ, nhưng không có đường select_recipe tự đẩy xuống máy | — |

#### AIR-1 [P1/FLAG_OFF] OT gateway TẮT ở .env live trong khi OT_CONTROL_ENABLED=true — southbound PLC polling không chạy, control path armed nhưng mọi lệnh ra ADAPTER_OFFLINE

- **Khoảng trống:** Toàn bộ năng lực kéo-poll PLC (nền tảng cho máy điểm keo/hàn nói Modbus/S7/OPC-UA) đã build xong + có HA supervisor + deadband nhưng KHÔNG chạy ở môi trường live. commandDispatcher getActiveDriver() trả undefined → mọi command HITL kết thúc ADAPTER_OFFLINE dù cờ control đã bật.
- **Khuyến nghị:** Trước khi onboard máy automation nội bộ đầu tiên: bật OT_GATEWAY_ENABLED=true ở live + tạo device_adapters row (UI DeviceAdapterManagement có sẵn) + smoke với modbus-slave.mjs/opcua-server.mjs trong scripts/sim. Đồng thời rà lại cặp cờ control/gateway thành một checklist nhất quán.
- **Bằng chứng:** `.env:469` — `# OT_GATEWAY_ENABLED=true` bị comment; dòng 508 `OT_CONTROL_ENABLED=true` — cấu hình lệch nhau · `server/services/ot/otManager.ts:33` — flagEnabled() đọc OT_GATEWAY_ENABLED === 'true'; startOt() return false khi tắt → không adapter nào active · `.env.sim:1` — OT_GATEWAY_ENABLED=true chỉ có trong .env.sim (Full-Sim, DB _sim riêng) — chưa từng chạy live prod · `server/services/ot/index.ts:18` — 7 driver đăng ký thật: stub/opcua/modbus/s7/mitsubishi-mc/ethernet-ip/slmp — modbus dùng modbus-serial, opcua dùng node-opcua (code thật, không stub)
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AIR-2 [P0/MISSING] Không có endpoint machine-key để máy automation tự đẩy KẾT QUẢ CHU TRÌNH (process_results) — mảnh thiếu trung tâm của 'tiêu chuẩn hóa dữ liệu API' cho máy bắt vít/điểm keo

- **Khoảng trống:** Máy bắt vít gửi HTTP JSON hôm nay chỉ có 2 lựa chọn: (a) nhét kết quả vít vào /api/v1/ingest/inspection theo dạng ST4I/genericJson (mỗi vít = 1 measurement point — chạy được nhưng semantics là 'inspection', lệch nghiệp vụ); (b) chờ build endpoint. interlockGate + genealogy đã đọc process_results nên dữ liệu đổ vào đây sẽ kích hoạt cả chuỗi phía sau.
- **Khuyến nghị:** Build MỎNG (~1 ngày): POST /api/v1/ingest/process-result với scope ingest:write, gọi thẳng recordProcessResult (zod input đã có ở processResultRouter — chỉ chuyển auth sang authenticateMachine như /api/ot/ingest). Thêm vào openapi.ts. Đây là mảnh ROI cao nhất toàn trục.
- **Bằng chứng:** `server/routers/processResultRouter.ts:32` — record = protectedProcedure (session user đăng nhập) — máy không auth được bằng apiKey · `drizzle/schema/process.ts:14` — process_results (Sprint F2) đã có đủ: serialNumber/machineId/stepType/result pass-fail-warn-skip/metrics jsonb/recipeRef — thiết kế đúng cho torque/dispense volume · `server/api/v1/openapi.ts:1` — Quét toàn bộ paths /api/v1: ingest duy nhất là /api/v1/ingest/inspection (vision-shaped) — không có /ingest/process-result, không có /ingest/telemetry · `server/db/processResult.ts:71` — aggregateProcessResultStats + getProcessMetricSeries đã có sẵn — tầng analytics chờ dữ liệu
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AIR-3 [P1/MISSING] Thiếu device-class cho IoT: MACHINE_TYPES không có SENSOR/IOT/GATEWAY — ESP32 phải giả dạng AUTOMATION/FEEDER; thiếu luôn WELDING (chỉ có WAVE_SOLDER)

- **Khoảng trống:** Đăng ký ESP32 hôm nay CHẠY ĐƯỢC (register → duyệt → claimKey → apiKey → /api/ot/ingest) nhưng type bị khai man làm hỏng analytics-by-type, capability resolution (fallbackProfile ot-stub), và OEE/presence semantics (sensor không có 'operationStatus'). Máy hàn tự động cũng phải dùng AUTOMATION chung chung.
- **Khuyến nghị:** Thêm 2-3 enum value (IOT_SENSOR, IOT_GATEWAY, WELDING) vào machineTypeEnum + MACHINE_TYPES + capability profile tối giản (telemetry-only, không PackML control) + migration ADD VALUE. Cân nhắc cờ 'countsTowardOee=false' trong capabilities jsonb cho nhóm IoT.
- **Bằng chứng:** `server/constants/machineTypes.ts:12` — 21 type: AVI..AUTOMATION, FEEDER, SCREWDRIVE, DISPENSING, MOUNTER, REFLOW... — không có type IoT/sensor nào, không có WELDING · `drizzle/schema/hierarchy.ts:262` — machines.stationId NOT NULL (fk restrict) — sensor môi trường cấp phòng vẫn buộc gắn station (register dùng default station) · `server/routers/hierarchyRouters.ts:703` — machine.register nhận z.enum(MACHINE_TYPES) — ESP32 đăng ký được NGAY nhưng phải khai man type · `server/services/equipment/capabilityModel.ts:377` — SCREWDRIVE có profile torque, DISPENSING có volume — nhưng không có profile nào cho sensor node
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AIR-4 [P1/MISSING] Không có HTTP/REST poll driver trong OT framework — thiết bị IoT/REST chỉ PUSH được, không POLL được; IO-Link HTTP path là descriptor 'assumed'

- **Khoảng trống:** Thiết bị IoT tự phát triển nếu chỉ expose REST endpoint (không push) thì chưa kéo được vào telemetry. IO-Link master qua OPC-UA thì FULLY WIRED, nhưng đường moneo/IoT-core REST chưa chạy. Với thiết bị TỰ PHÁT TRIỂN có thể ép firmware push nên gap này không chặn đứng, nhưng chặn chuẩn hóa 'mọi giao thức đều poll được'.
- **Khuyến nghị:** Ưu tiên THẤP hơn AIR-2/AIR-3 vì firmware nội bộ nên push /api/ot/ingest. Khi cần: viết httpDriver.ts implement OtDriver (readTags = GET + JSONPath per tag.address), registerDriver('http') — khung NotImplementedDriver + otProtocolEnum cần thêm value.
- **Bằng chứng:** `server/services/iolink/ioLinkProfile.ts:17` — Ghi rõ: 'There is NO HTTP OtDriver registered today, so the HTTP plan is a DESCRIPTOR/seam only' · `server/services/iolink/ioLinkProfile.ts:33` — validationStatus: 'assumed' — nodeId/REST path lắp theo convention, chưa verify vendor/IODD · `server/services/ot/index.ts:18` — Registry chỉ có stub/opcua/modbus/s7/mitsubishi-mc/ethernet-ip/slmp — không có 'http'
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AIR-5 [P1/STUB] Connector chuẩn công nghiệp bật cờ nhưng KHÔNG có target: SECS_GEM_ENABLED=true không có SECS_GEM_EQUIPMENT, MTCONNECT_ENABLED=true nhưng MTCONNECT_SOURCES comment, CFX tắt — 'LIVE trên giấy'

- **Khoảng trống:** Trạng thái thật của tích hợp thiết bị bán dẫn/CNC/SMT chuẩn: framework code tốt + simulator có sẵn (scripts/sim/hsms-equipment.ts, mtconnect-agent.mjs) nhưng zero kết nối cấu hình — đúng seam N-1 doc 18 còn nguyên. Máy hàn/bắt vít nội bộ KHÔNG cần SECS nên không chặn mục tiêu nội bộ, nhưng bảng năng lực phải ghi STUB chứ không phải LIVE.
- **Khuyến nghị:** Khi demo: cấu hình SECS_GEM_EQUIPMENT trỏ scripts/sim/hsms-equipment.ts và MTCONNECT_SOURCES trỏ mtconnect-agent.mjs để chuyển STUB→LIVE-sim có bằng chứng. Ghi rõ trong tài liệu bán hàng: SECS-GEM = monitor-only, chưa full E30.
- **Bằng chứng:** `.env:484` — SECS_GEM_ENABLED=true (dòng 502 MTCONNECT_ENABLED=true) nhưng grep SECS_GEM_EQUIPMENT/MTCONNECT_SOURCES = 0 dòng active → bringup parse [] → logged no-op · `server/services/secsgem/hsmsClient.ts:5` — Header honest: 'This is a CONNECT/TEST skeleton, NOT a production HSMS driver' — có HSMS state machine + SECS-II codec + S1F1/F2, S1F13/14/17/18, S5/S6 live dispatch; thiếu S2F33-37 report linking, spooling, multi-block · `server/services/secsgem/secsGemBringup.ts:61` — parseEquipmentConfig đọc env SECS_GEM_EQUIPMENT — honest-degrade [] khi thiếu · `server/services/cfx/cfxClient.ts:107` — CFX_ENABLED không set trong .env → IPC-CFX (chuẩn SMT automation) OFF hoàn toàn
- **Kiểm chứng đối kháng:** ✔ CONFIRMED

#### AIR-6 [P1/STUB] Robot vendor drivers là scaffold (Fanuc/Mitsubishi/Delta throw 'not installed'; chỉ sim chạy đủ, Techman/UR một phần) trong khi ROBOT_CONTROL_ENABLED=true ở live

- **Khoảng trống:** Đúng seam N-2 doc 18 chưa đóng — cần SDK/HW thật. Điểm tốt: jobType 'screw'/'dispense' đã first-class trong contract, VDA5050 (AGV qua MQTT) là vendor đầy đủ và có simulator vda5050-agv.mjs. Nếu máy bắt vít nội bộ dùng cobot cell thì đường Techman là gần nhất.
- **Khuyến nghị:** Không build thêm cho tới khi có robot thật. Với cell vít dùng controller PLC thường (không robot arm) → đi đường OT adapter (AIR-1), không đường robot.
- **Bằng chứng:** `server/services/robot/robotDriver.ts:5` — Header: 'Only sim runs fully; vendor drivers are scaffolds (connect throws)' — RobotJobType đã có 'screw' và 'dispense' verbs · `.env:510` — ROBOT_CONTROL_ENABLED=true + ROBOT_GATEWAY_ENABLED=true (509) + VDA5050_ENABLED=true (503) — control armed nhưng không robot thật nào nối được · `server/services/robot/ursimBridge.ts:1` — URSim bridge (dashboard 29999 + URScript primary 30001) có thật cho UR simulator; URSIM_ENABLED không set trong .env
- **Kiểm chứng đối kháng (PARTIAL):** SAI ở luận điểm trung tâm: câu 'Fanuc/Mitsubishi/Delta throw not installed / chỉ sim chạy đủ' trích từ header CŨ robotDriver.ts:4-8 đã STALE. Thực tế doc 24 Tier-2/C4 đã thay scaffold bằng client protocol thật: fanucDriver.ts:2 'REAL RMI client' TCP 16001/two-socket, spec-verified đối chiếu manual B-84184EN/03 (robot/index.ts:35 fanuc='spec-verified'); mitsubishiRobotDriver.ts:2-4 'REAL... Replaces the prior NotImplemented scaffold' (MELFA R3 ASCII, 'assumed'); delta là code TCP thật nhưng protocol BỊA → phân loại 'mock' + self-guard ROBOT_MOCK_VENDORS_ENABLED (index.ts:38,62-68,77); vendorRegistry.test.ts:48 khẳng định KHÔNG vendor nào resolve NotImplementedRobotDriver; 'not installed' duy nhất còn lại là techmanDriver.ts:202 (guard thiếu package modbus-serial). ĐÚNG các phần còn lại: .env:503/509/510 VDA5050/ROBOT_GATEWAY/ROBOT_CONTROL=true; RobotJobType có 'screw'/'dispense' (robotDriver.ts:15); vda5050 first-class 'spec-verified' + sim vda5050-agv.mjs; ursimBridge.ts:8-10 dashboard 29999 + URScript 30001/30002, URSIM_ENABLED chỉ có .env.example:1981; và gap THẬT vẫn tồn tại — mọi vendor 'assumed'/'mock' chưa HW-FAT (index.ts:34-42), không robot thật nào nối. Bản chất gap là CHƯA VALIDATE HW, không phải 'driver là scaffold'.

#### AIR-7 [P2/STUB] Zmotion deploy thiếu FFI shim koffi (zauxdll.dll) — validate/compile/simulate chạy thật, deploy fail honest với TODO

- **Khoảng trống:** Doc 37 ghi 'Zmotion koffi' đã làm — thực tế signatures đã transcribe nhưng shim FFI chưa tồn tại trong repo (memory doc 37 nói 'device-PKI + GEM live-loop' commit, còn koffi binding là seam). Máy điểm keo/bắt vít nội bộ nếu dùng ZMC controller sẽ author+simulate được nhưng chưa download chương trình qua platform.
- **Khuyến nghị:** Khi có ZMC thật trên bàn: thêm koffi binding (~nửa ngày, signatures đã pin sẵn trong comment) + FAT theo doc 20. Không chặn onboarding telemetry/result.
- **Bằng chứng:** `server/services/programming/zmotion/zmotionBasicAdapter.ts:20` — 'the actual call needs an FFI binding (koffi / ffi-napi). That shim is NOT yet present, so deploy() fails honestly' — sequence đã pin đúng ZAux_OpenEth→BasDown→Close từ Zmcaux.cs thật · `.env:1` — DPC_DEPLOY_ENABLED=true + DPC_STREAMING_ENABLED=true live — gate mở nhưng adapter chặn cuối bằng honest-fail

#### AIR-8 [P2/LIVE] POST /api/ot/ingest — đường ingest IoT/automation chính — KHÔNG có trong OpenAPI v1 lẫn ApiDocs UI; contract chỉ tồn tại trong code

- **Khoảng trống:** Đội firmware IoT nội bộ muốn tích hợp phải đọc source code server mới biết endpoint + shape CanonicalSample. Đây là lỗ hổng 'tiêu chuẩn hóa dữ liệu API' dạng tài liệu, không phải dạng code.
- **Khuyến nghị:** Thêm path /api/ot/ingest (hoặc alias /api/v1/ingest/telemetry) vào openapi.ts + section trong ApiDocs.tsx/ThirdPartySection với ví dụ ESP32 (metric temperature/humidity) và ví dụ máy vít (metric torque). Zero code runtime thay đổi.
- **Bằng chứng:** `server/_core/index.ts:356` — Route LIVE vô điều kiện: authenticateMachine scope ingest:write, body {samples: CanonicalSample[]}, deviceId string cho phép 1 gateway credential forward nhiều device · `server/api/v1/openapi.ts:1` — Quét paths: không có /api/ot/ingest (nó nằm ngoài /api/v1) — bên tích hợp đọc openapi.json sẽ không biết endpoint tồn tại · `server/_core/rateLimitConfig.ts:82` — OT_INGEST_PATHS có rate tier riêng per-machine — hạ tầng production-grade nhưng vô hình với người dùng API

#### AIR-9 [P2/FLAG_OFF] MQTT admission gate chỉ flag+log (MQTT_ADMISSION_ENFORCE default off) và mTLS device-PKI chưa bật — thiết bị chưa APPROVED vẫn pub/sub business topics

- **Khoảng trống:** Đường MQTT cho IoT nội bộ (ESP32 → sensor topic → PdM) LIVE với password auth + topic ACL default-enforce, nhưng vòng admission theo approvalStatus mới ở chế độ quan sát. Chấp nhận được cho nội bộ giai đoạn đầu; phải siết trước khi mở rộng đại trà.
- **Khuyến nghị:** Khi số thiết bị IoT >10: bật MQTT_ADMISSION_ENFORCE=true (đã có code + test), lộ trình sau đó MQTT_MTLS_ENABLED với device PKI doc 37. Viết SOP tạo credential mqtt_clients cho firmware team.
- **Bằng chứng:** `server/services/mqttService.ts:554` — doc 51 P1 admission gate: un-APPROVED device confined to pairing scope — nhưng dòng 749 admissionSoft khi MQTT_ADMISSION_ENFORCE=false (default) → allow + warn · `.env:610` — MQTT_REQUIRE_PASSWORD=true (tốt) nhưng không có MQTT_ADMISSION_ENFORCE / MQTT_MTLS_ENABLED trong .env · `server/services/sensorIngestService.ts:31` — Topic factory/{fid}/{code}/sensor/{type} → machine_sensor_readings; sensorType free-form ≤50 chars (humidity OK); máy không khớp machines.code → skip

#### AIR-10 [P2/FLAG_OFF] Edge gateway process per-line đã build TRỌN (entrypoint + Dockerfile + UNS store-forward ≥24h + heartbeat degraded) nhưng chưa từng chạy — EDGE_GATEWAY_MODE unset

- **Khoảng trống:** Kiến trúc chuẩn hóa kết nối theo tầng (mỗi line 1 gateway, biên tự chủ khi mất central) đã sẵn sàng nhưng zero giờ bay. Khi onboard máy automation nội bộ rải nhiều xưởng, đây là hình thái triển khai đúng thay vì all-in-one poll từ server trung tâm.
- **Khuyến nghị:** Pilot 1 line: build image edge, trỏ EMQX central, kill-test central broker để chứng minh WAL ≥24h + ordered replay. Dùng luôn làm 'IoT gateway' cho cụm ESP32 (gateway credential forward deviceId).
- **Bằng chứng:** `server/edge/edgeGatewayMain.ts:1` — Entrypoint tồn tại; deploy/edge/Dockerfile.edge + docker-compose.edge.yml có sẵn · `docs/EDGE_GATEWAY.md:27` — 'With EDGE_GATEWAY_MODE unset, the all-in-one server runs everything in one process and the edge entrypoint is simply never used' · `server/services/edge/edgeGateway.test.ts:137` — Test dùng tag 'torque' làm fixture — pipeline edge được thiết kế sẵn cho telemetry automation; replay idempotent theo deviceId|tag|ts

#### AIR-11 [P2/STUB] Full-Sim cố ý KHÔNG serve S7/EtherNet-IP → máy SCREWDRIVE/PACKAGING trong nhà máy ảo không có telemetry qua driver thật — câu chuyện demo máy vít chưa được chứng minh E2E

- **Khoảng trống:** Bằng chứng E2E 'máy automation qua OT driver' hiện chỉ có OPC-UA (conveyor/feeder) + Modbus (assembly) trong DB _sim. s7Driver/ethernetIpDriver có unit test nhưng chưa có vòng poll sống nào. Khi chốt chuẩn onboard máy vít nói S7, chưa có harness chứng minh.
- **Khuyến nghị:** Nếu máy vít nội bộ thật nói S7: thêm S7 server sim (node-snap7 loopback hoặc chuyển máy sim SCREW sang modbus unitId mới — 1 giờ) để green-gate trước khi chạm PLC thật. Nếu máy vít nói HTTP JSON: bỏ qua, đi đường /api/ot/ingest.
- **Bằng chứng:** `scripts/sim-factory/simulator.mjs:19` — 'KHÔNG serve s7 / ethernet-ip → các adapter đó là KHUNG: gateway thử connect rồi fail-safe skipped (honest)' · `scripts/sim-factory/topology.mjs:96` — SCREW role type SCREWDRIVE protocol s7, tag torque 40004 Nm — máy + adapter được seed nhưng simulator không phục vụ · `scripts/sim-factory/README.md:29` — conveyor-OPCUA + power-OPCUA + assembly-Modbus chạy THẬT qua node-opcua/modbus-serial; screwdrive-S7* + packaging-EtherNetIP* = khung

#### AIR-12 [P3/LIVE] Recipe rollout dừng ở catalog/ledger (by design): recipe_sets + distributeRecipeSet + verify đủ, nhưng không có đường select_recipe tự đẩy xuống máy

- **Khoảng trống:** Chuẩn hóa 'cài đặt & đồng bộ' cho máy automation: catalog versioned + second-approver + genealogy đã production-grade; mảnh cuối (máy tự kéo recipe active của mình qua API) chưa có endpoint machine-key GET — máy HTTP JSON không tự hỏi 'tôi nên chạy recipe nào'.
- **Khuyến nghị:** Thêm GET /api/v1/machines/{id}/active-recipe (scope equipment:read hoặc machine-key) trả getActiveRecipe — máy vít poll lúc đổi model. Nhỏ, đóng vòng config-sync cho máy không PLC.
- **Bằng chứng:** `server/services/lineController/recipeSetService.ts:23` — 'Deploy ở đây = catalog/ledger flip — KHÔNG push lệnh select_recipe xuống thiết bị (đường HITL commandDispatcher riêng)' — có xác nhận nạp + khóa set suốt lô · `server/routers/machineRecipeRouter.ts:8` — recipes.deploy chỉ flip active version + ledger; actuationProcedure (role-floor + 2FA) cho approve/deploy/rollback · `server/services/ot/commandDispatcher.ts:26` — Đường đẩy thật: HITL dispatch select_recipe qua OT adapter — cần AIR-1 mở gateway + commissioning mới chạy

