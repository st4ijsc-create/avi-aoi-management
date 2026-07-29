# Nâng giao diện lên chuẩn Production — Thiết kế

**Bối cảnh:** Machine Simulator đã được tái thiết kế theo HMI công nghiệp (H1–H5, [[HMI_DESIGN_SPEC]]) và có tính năng cấu hình máy ([[MACHINE_CONFIG_DESIGN]]). User chốt: **đây là sản phẩm bán cho khách**, nên cần đưa giao diện từ mức demo lên chuẩn production, mặc định chạy Live, và bản vẽ máy phải là twin động thật.

**Nhánh:** `feat/machine-simulator` (worktree `D:/SOURCES/avi-aoi-sim`). Không đụng repo chính trong đợt này (phần server đã tách nhánh `feat/machine-operating-config`).

Thiết kế này **sửa đổi** một phần HMI_DESIGN_SPEC.md: các quy tắc *thẩm mỹ* (radius 0, không đổ bóng, phẳng) trở thành **tham số theo theme**; các quy tắc *cấu trúc & thao tác* giữ nguyên (xem §4 — KHÔNG phải quy tắc an toàn thiết bị, xem chính §4).

---

## Quyết định đã chốt (từ brainstorm với user)

| | Chốt |
|---|---|
| Hệ theme | **3 theme là trọn bộ**: Glass (sáng) · Console (tối) · Warmth (ấm). **Bỏ** nút sáng/tối riêng. |
| Theme mặc định | **Glass** (sáng cao cấp). |
| Chế độ transport mặc định | **Live** (nối hệ sinh thái thật). |
| Demo | Chỉ khả dụng khi **cờ cấu hình bật** (biến môi trường cạnh .exe). Mặc định ẩn. |
| Auto | **Bỏ** khỏi giao diện & mặc định. |
| Live chưa cấu hình / mất kết nối | Màn **"Kết nối hệ sinh thái"**. |
| Bản triển lãm | File cấu hình cạnh engine đặt sẵn cờ Demo → chạy offline như cũ. |
| Ảnh động máy | **Mức 3** — engine phát sự kiện per-bước, bản vẽ là twin động thật. |

---

## Workstream 1 — Hệ 3 theme toàn app

### 1.1 Kiến trúc token
- Thêm chiều **theme** (`data-theme="glass|console|warmth"` trên `<html>`), thay cho `data-theme="light|dark"` hiện tại.
- Toàn bộ màu/bóng/bo-góc/glow đọc qua biến CSS; mỗi theme định nghĩa một bộ biến đầy đủ. **Không hex thô** ở call site (giữ grep-check hiện có).
- **Ba nhóm biến:**
  - *Nền tảng:* `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--divider`.
  - *Nhấn & tương tác:* `--accent`, `--accent-hover`, `--accent-contrast`, `--focus`.
  - *Hình thức theo theme:* `--radius`, `--radius-sm`, `--elevation` (bóng/none/glow), `--glow-run`, `--glass-blur`, `--panel-fill` (phẳng/gradient/kính).
- **Thang trạng thái GIỮ NGUYÊN qua cả 3 theme** (an toàn): `run/warn/fault/idle`. Chỉ tinh chỉnh độ sáng để tương phản đạt AA trên từng nền, **không đổi ý nghĩa**.

### 1.2 Ba theme (tinh từ mock `hmi-directions.html`)
- **Glass (mặc định, sáng):** nền xám-trắng mát xếp lớp, bóng cực nhẹ, `--radius: 8px`, nhấn navy `#1E3A8A`→azure `#2f6bff`, panel kính mờ cho overlay, bản vẽ trên "bàn sáng" gradient. Mềm bằng ánh sáng + chiều sâu.
- **Console (tối):** graphite/gần-đen xếp lớp, `--radius: 6px`, nhấn azure/cyan phát sáng `#38d6ff`, `--elevation` = quầng sáng + bóng sâu, phần tử live *tỏa sáng*. Đậm chất công nghệ cao.
- **Warmth (ấm):** giấy ấm + graphite mềm, `--radius: 5px`, nhấn navy + phụ amber, nút bấm chiều sâu vật lý thật-mà-mềm, chất liệu bề mặt tinh tế. Uy tín công nghiệp mạnh nhất.

### 1.3 Bộ chọn theme
- **Trong màn Cài đặt:** một nhóm chọn 3 theme, có xem trước (thumbnail nhỏ mỗi theme). Áp ngay, không reload.
- **Chuyển nhanh** trên topbar (nút xoay vòng hoặc menu nhỏ) để khách thử nhanh.
- **Bền vững:** lưu lựa chọn (localStorage phía web + `SettingsDto.Theme` phía engine để .exe nhớ qua lần chạy). Mặc định **Glass**.

### 1.4 Phủ toàn app
- Cả 11 route + mọi component (shell, dashboard, machines, detail, onboarding, inspector, scenario, settings, product/recipe config, HMI panel, BoardCanvas, các schematic) phải đọc đúng qua token → tự đúng ở cả 3 theme.
- **Bất biến cấu trúc giữ nguyên** ở mọi theme (xem §4 — không phải bất biến an toàn thiết bị).

### 1.5 Nợ kỹ thuật thị giác
- Baseline thị giác hiện gắn với light/dark → phải **dựng lại theo 3 theme** cho các màn chủ chốt (không nhân 3 mù quáng toàn bộ — chọn tập đại diện + các màn có rủi ro tương phản). Giữ ngưỡng `0.00002`, không nới.
- axe AA phải xanh trên **cả 3 theme** (đặc biệt Console tối và Warmth ấm — tương phản dễ trượt).

---

## Workstream 2 — Live-first (sản phẩm bán)

### 2.1 Mặc định Live
- Đổi mặc định engine `Program.cs` từ `TransportMode.Demo` → `TransportMode.Live`; topbar fallback `"Demo"` → `"Live"`; onboarding request `IsDemo=true` → theo chế độ hiện tại (Live mặc định).

### 2.2 Cờ bật Demo
- Engine đọc cờ lúc khởi động: biến môi trường **`ST4I_DEMO_ENABLED`** (đặt được trong file cấu hình cạnh `.exe`). Mặc định (không có cờ) = **tắt**.
- Cờ tắt: nút **DEMO không hiện** trong topbar; endpoint đổi-chế-độ **từ chối** chuyển sang Demo (trả về trạng thái "chế độ Demo chưa bật", không phải lỗi mơ hồ) — phòng thủ chiều sâu.
- Engine báo cờ này ra web qua endpoint (mở rộng `/v1/mode` hoặc thêm `/v1/capabilities`) để UI biết có render nút DEMO không.

### 2.3 Bỏ Auto
- Gỡ AUTO khỏi thanh chế độ và khỏi mặc định. Thanh chế độ chỉ còn **LIVE** (và **DEMO** khi cờ bật).
- Lớp `AutoTransport`/`SwitchableConfigSyncBackend` chọn Auto: giữ trong mã nếu gỡ ra quá sâu, nhưng **không nối** vào lựa chọn người dùng; hoặc gỡ hẳn nếu gọn. (Người thực thi quyết, ưu tiên gỡ khỏi bề mặt.)

### 2.4 Màn "Kết nối hệ sinh thái"
- Khi ở Live mà **chưa cấu hình URL máy chủ** hoặc **gọi `/v1/fleet` thất bại** → thay vì fleet rỗng vô nghĩa, hiện màn kết nối:
  - Nhập/sửa URL hệ sinh thái, trạng thái kết nối (đang thử / kết nối được / thất bại kèm lý do), nút thử lại.
  - Lối vào đăng ký/claim máy.
- Áp cho Dashboard / Danh sách máy (các màn cần fleet). Viết theo giọng sản phẩm: nói rõ cần làm gì, không đổ lỗi.

### 2.5 Bản triển lãm vẫn offline
- Bản `.exe` mang triển lãm: file cấu hình cạnh engine đặt `ST4I_DEMO_ENABLED=true` → khách bật máy là có fleet 11 máy giả offline. Bản giao khách: không có cờ → Live, nối thật.
- Tài liệu hóa 2 kiểu đóng gói (triển lãm vs sản phẩm) trong README.

---

## Workstream 3 — Twin động Mức 3

### 3.1 Vấn đề
Schematic hiện chạy vòng lặp CSS cố định, không bám máy thật. Cần bản vẽ **phản ánh đúng logic vận hành từng bước**.

### 3.2 Engine phát sự kiện per-bước
- Mở rộng dữ liệu per-chu-kỳ engine phát ra (qua WS `/v1/inspector/stream` hoặc kênh fleet): **pha chu kỳ** (đang di chuyển / đang tác nghiệp / hoàn tất), **chỉ số bước hiện tại**, **chuỗi điểm + kết quả từng điểm** (Đạt/NG theo đúng điểm), **vị trí đầu công tác**, giá trị đo per-bước (mô-men/phơi sáng…).
- Suy ra từ chính bộ mô phỏng đã có (đã lái bởi cấu hình hiệu lực) — không bịa; kết quả từng điểm phải nhất quán với tỷ lệ NG tổng.

### 3.3 Bản vẽ là twin
- Ba lớp schematic (AOI / Automation / IoT) đọc dòng sự kiện: đầu công tác **đi tuần tự qua từng điểm thật**, mũi/đầu quét tác nghiệp tại điểm, **mỗi điểm sáng theo kết quả CHÍNH nó**, trục Z hành trình mỗi lần, phễu đếm theo số thật, cung sóng IoT theo nhịp mẫu thật.
- **Bỏ vòng lặp CSS trang trí**; chuyển động = hàm của trạng thái thật. Idle = tĩnh. Tôn trọng `prefers-reduced-motion` (tĩnh, chỉ cập nhật số).
- Giữ `vector-effect: non-scaling-stroke`, đầu công tác đi CÙNG giá đỡ (không tái diễn lỗi "đầu trôi").

### 3.4 Nối với cấu hình
Siết dung sai mô-men → nhiều điểm đỏ hơn *hiện trên bản vẽ*; đổi ngưỡng khớp AOI → tỷ lệ điểm NG trên hình đổi. Đây là điểm demo mạnh nhất — bản vẽ *hiện ra* điều cấu hình đã lái.

---

## Trình tự thực thi (đề xuất)

Ba workstream tương đối độc lập; làm tuần tự để mỗi bước có phần mềm chạy được, review được:

1. **WS1 nền token + bộ chọn + Glass** trước (đổi kiến trúc theme, giữ app chạy) → rồi **Console + Warmth** → phủ 11 màn.
2. **WS2 Live-first** (engine default + cờ + bỏ Auto + màn kết nối + bản đóng gói).
3. **WS3 twin Mức 3** (engine event + 3 schematic + nối cấu hình).

Mỗi WS: TDD/subagent-driven, review opus, tự kiểm chứng live (chụp+Read), axe AA cả 3 theme, e2e xanh, ngưỡng thị giác giữ.

---

## Ngoài phạm vi
- 6 biến sáng/tối cho mỗi theme (chốt: 3 theme là trọn bộ).
- Theme tùy biến do khách tự định nghĩa màu.
- Twin động học vật lý đầy đủ (Mức 3 ở đây = per-bước đúng logic, không mô phỏng lực/va chạm).
- Phần server (đã tách nhánh riêng).

## Rủi ro
- **Khối lượng:** 3 theme × 11 màn + engine event là đợt nhiều ngày. Baseline thị giác tăng theo số theme.
- **Tương phản Console/Warmth:** dễ trượt axe AA — phải đo, không tin mắt.
- **WS3 cần engine phát thêm dữ liệu** — thay đổi giao kèu WS/fleet; phải giữ tương thích các màn khác đang đọc fleet.
- **Bất biến cấu trúc** (§4 — không phải bất biến an toàn thiết bị, xem §4 tự nói rõ) phải giữ qua mọi theme và qua twin mới — có test hồi quy sẵn (`12-hmi-safety-rail`), mở rộng cho đa theme.

## §4 — Bất biến GIỮ NGUYÊN qua mọi theme (không thương lượng)
- Màu trạng thái chỉ mang nghĩa trạng thái; không-có-dữ-liệu = màu chờ, không phải lỗi.
- Nút NGỪNG/RESET không bao giờ cuộn, không đổi chỗ giữa trạng thái/theme — yêu cầu ổn định/thao tác
  (operator phải luôn thấy đúng chỗ cũ), KHÔNG phải mạch an toàn: NGỪNG là chốt phần mềm giám sát
  (`FleetHost.Estop`), không phải thiết bị an toàn — xem README §1.
- Trang không cuộn; panel cuộn trong. Không cuộn ngang ở 1280px.
- Nhãn song ngữ; gloss EN NGOÀI phần tử `<label>`. Tabular-nums mọi số.
- Offline hoàn toàn (font đóng gói, 0 request ngoài). axe AA. Focus bàn phím hiện rõ. `prefers-reduced-motion`.
- Persona: operator panel-PC 10.1" 1280×800, 50cm, đeo găng.
