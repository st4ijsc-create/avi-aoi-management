# Cấu hình vận hành theo máy — Thiết kế

**Mục tiêu (nguyên văn yêu cầu):** cấu hình từ server là **để tham khảo và hỗ trợ cài đặt lần đầu**; cấu hình **tại máy phải điều chỉnh được và đó mới là cấu hình chuẩn cho máy** — vì mỗi máy có điều kiện ngoại cảnh khác nhau, không thể áp một cấu hình cho tất cả.

Đây là *cấu hình vận hành của bản thân cỗ máy* (mô-men, tốc độ, phơi sáng, ngưỡng cảm biến…), **khác** với cấu hình sản phẩm/điểm đo đã làm ở đợt config-sync trước.

---

## 1. Hiện trạng (đã kiểm chứng trong mã)

| | Simulator | Server SYNAPSE |
|---|---|---|
| Tham số vận hành theo máy | **Không có.** Chỉ `MachineDescriptor` tĩnh trong `fleet.json`, đọc một lần lúc khởi động, không sửa được (`MachineDescriptor.cs:3`) | **Không có** cột riêng. Gần nhất là `machine_recipes.payload` jsonb *mờ*, theo **mã recipe** chứ không theo máy |
| Chiều máy → server | — | **Không tồn tại.** System A chỉ `check`/`get` (kéo xuống); `ack` chỉ ghi bóng drift `machine_config_state.reported*`, **không ghi nội dung** |
| Schema tham số theo loại máy | Chỉ gợi ý UX (`recipePayloadFields.ts`), không ràng buộc | **Đã có** `recipeSchemas.ts`: `screw_program`, `dispense_program`, `weld_profile`, `iot_settings` — nhưng `RECIPE_TYPED_SCHEMA_MODE` mặc định `off` |
| Cờ | — | `CONFIG_SYNC_GENERIC_ENABLED` mặc định **TẮT** (kéo xuống đang 500) |

Nghĩa là: **thiếu toàn bộ khái niệm "tham số vận hành của máy, sửa được tại máy"**, và chiều đẩy lên chưa có đường nào.

---

## 2. Mô hình dữ liệu — lớp đè, phạm vi theo cặp (máy × sản phẩm) (đã chốt)

```
baseline (server, khuyến nghị)      ──┐
điều chỉnh theo MÁY      (mọi sản phẩm)├──►  hiệu lực (máy thật sự chạy)
điều chỉnh theo MÁY × SẢN PHẨM        ─┘
```

Cấu hình hiệu lực gắn theo **cặp (máy, sản phẩm đang chạy)**, nhưng lớp điều chỉnh tách làm hai vì hai loại sai lệch có bản chất khác nhau:

| Lớp | Dùng cho | Ví dụ |
|---|---|---|
| **Theo máy** (`product = *`) | Đặc tính của chính cỗ máy, đúng với mọi sản phẩm | Cảm biến mô-men máy này đọc lệch 2%; băng tải chạy chậm hơn định mức; buồng máy đặt cạnh cửa sổ nên sáng hơn |
| **Theo máy × sản phẩm** | Khác biệt do sản phẩm | MODEL-B nền tối hơn nên cần phơi sáng cao hơn MODEL-A trên **cùng** máy đó |

**Thứ tự phân giải:** `baseline` → phủ bởi điều chỉnh *theo máy* → phủ bởi điều chỉnh *theo máy × sản phẩm*.

Nếu không tách, mỗi lần thêm sản phẩm mới kỹ thuật viên phải chỉnh lại toàn bộ sai lệch vốn thuộc về cỗ máy — sai và rất phiền.

**Máy không chạy sản phẩm** (IoT sensor/gateway): chỉ có lớp *theo máy*; giao diện không hiện chiều sản phẩm.

- **`baseline`** — bản khuyến nghị kéo từ server, kèm `version` + `checksum`. Máy **không bao giờ** sửa lớp này.
- **`adjustments`** — map **thưa**, chỉ chứa tham số đã đổi: `{ key: { value, by, at, note } }`, ở cả hai phạm vi.
- **`effective`** — kết quả phân giải. Đây là cấu hình máy chạy thật.

Mỗi dòng tham số trên giao diện phải nói rõ **giá trị đến từ đâu**: *khuyến nghị* / *chỉnh theo máy* / *chỉnh cho sản phẩm này*. Không có chỉ dấu này thì kỹ thuật viên không thể biết vì sao hai máy cùng loại lại chạy khác nhau.

Vì sao lớp đè chứ không phải bản sao: kéo baseline mới về **không xóa** điều chỉnh tại máy; luôn trả lời được "tham số nào đã lệch khỏi khuyến nghị, lệch bao nhiêu, ai chỉnh, lúc nào, vì sao"; và có nút *về mặc định* cho từng tham số.

**Xung đột khi kéo baseline mới:** không tự ghi đè, không tự bỏ. Hiện rõ *"khuyến nghị mới 12.2 · tại máy đang 12.6 (chỉnh bởi X, 2 ngày trước)"* và để người quyết giữ hay bỏ điều chỉnh.

**Đẩy lên server = báo cáo cấu hình THỰC TẾ của máy này, KHÔNG phải ghi đè baseline chung.** Đây là điểm quan trọng: nếu máy đẩy lên mà sửa luôn baseline thì lần sau mọi máy khác kéo về sẽ dính điều chỉnh riêng của một máy — đúng cái mà yêu cầu muốn tránh. Muốn biến cấu hình một máy thành khuyến nghị chung thì phải là hành động **"đề xuất thành chuẩn"** riêng, có ký duyệt (§6).

---

## 3. Bộ tham số theo loại máy

Bám vựng từ server đã định nghĩa (`recipeSchemas.ts`) để sau này đồng bộ sạch, **cộng** bộ AOI/AVI mới (server chưa có) — vì AOI là loại chịu ảnh hưởng ngoại cảnh nặng nhất, đúng trọng tâm yêu cầu.

| Loại máy | `configKind` | Tham số |
|---|---|---|
| SCREWDRIVE | `screw_program` | `torqueTarget` (Nm), `torqueTolerance` (Nm), `angleTarget` (°), `speedRpm`, `clampTimeMs`, `sequence[]` |
| DISPENSING | `dispense_program` | lưu lượng, áp suất, thời gian nhả, tốc độ di chuyển |
| WELDER | `weld_profile` | dòng, thời gian, lực ép, tiền/hậu nhiệt |
| IOT_SENSOR / IOT_GATEWAY | `iot_settings` | `sampleRateHz`, `reportIntervalSec`, `thresholds{}` |
| **AOI / AVI (mới)** | `aoi_inspection` | `exposureUs`, `gain`, `lightIntensity` (theo kênh sáng), `conveyorSpeed`, `fiducialTolerance`, `matchThreshold`, `retestPolicy` |

Mỗi tham số khai báo: khóa, nhãn vi/en, đơn vị, kiểu, **min/max (chặn cứng)**, bước nhảy, số lẻ, áp dụng cho loại máy nào.

**Chặn cứng min/max là bắt buộc**, không phải trang trí: đây là giao diện vận hành máy công nghiệp, không được để nhập mô-men ngoài dải an toàn. Server đã có `parameter_guardrails` — dải tại máy phải nằm trong dải đó.

---

## 4. Tham số phải THẬT SỰ tác động vào mô phỏng

Nếu sửa cấu hình mà máy chạy y hệt thì đây chỉ là cái form chết — vô nghĩa khi trình diễn. Cấu hình hiệu lực phải lái bộ mô phỏng:

- `speedRpm` / `clampTimeMs` → nhịp chu kỳ
- `torqueTarget` / `torqueTolerance` → phân bố giá trị mô-men sinh ra, và tỷ lệ NG khi dung sai bị siết
- `sampleRateHz` / `reportIntervalSec` → nhịp phát telemetry IoT
- `exposureUs` / `lightIntensity` / `matchThreshold` → tỷ lệ lỗi giả của AOI (siết ngưỡng → nhiều NG hơn)

Đây cũng là cách chứng minh cho khách rằng "chỉnh tại máy" là thật.

---

## 5. Giao diện

**Trên màn HMI (`/hmi/:code`) — tab "CÀI ĐẶT / SETTINGS"** trong thanh tab mà spec §8 vốn đã yêu cầu nhưng chưa dựng. Đây là chỗ đúng: kỹ thuật viên chỉnh máy ngay tại máy.

Mỗi dòng tham số hiển thị: nhãn song ngữ · **giá trị hiệu lực** (to, tabular) · đơn vị · dải cho phép · khuyến nghị từ server · dấu ◉ nếu đang lệch · nút *về mặc định*. Sửa xong áp dụng ngay, ghi vết.

**Trên `/machines/:code`** — mục cấu hình tương tự cho người xem từ xa, cùng nguồn dữ liệu.

Trạng thái đồng bộ dùng thang trạng thái sẵn có: *đã đồng bộ* / *lệch phiên bản* / *có điều chỉnh tại máy*. **Màu chỉ mang nghĩa trạng thái** (spec §2) — "có điều chỉnh tại máy" là trạng thái **bình thường và mong muốn**, không phải lỗi, nên không được tô đỏ.

---

## 6. Phía server (repo chính `avi-aoi-management`) — đã được duyệt sửa

1. **Bảng mới** lưu cấu hình *thực tế* máy báo lên (không đụng `machine_recipes`): `machineId`, `configKind`, `baselineVersion`, `adjustments` jsonb, `effective` jsonb, `checksum`, `reportedBy`, `reportedAt`. Kèm migration.
2. **Endpoint ghi máy→server**: `POST /api/machine/config-sync/report-settings` — máy tự xác thực bằng `mk_` key như các endpoint máy khác; ghi bảng trên; **không** sửa baseline.
3. **Bật chiều kéo xuống**: `CONFIG_SYNC_GENERIC_ENABLED` hiện tắt nên `check`/`get` đang 500.
4. **"Đề xuất thành chuẩn"** (tùy chọn, có thể để đợt sau): biến cấu hình một máy thành baseline chung — đi theo đúng khuôn ký duyệt 2 người + 2FA đang áp cho recipe.

**Ràng buộc thi công:** repo chính đang có nhiều thay đổi dở dang của việc khác. Tôi sẽ **không commit gì trong repo chính nếu chưa hỏi**, và chỉ đụng đúng các tệp của tính năng này.

---

## 7. Ngoài phạm vi đợt này

- Ký duyệt 2 người cho chỉnh sửa tại máy (máy phải chỉnh được ngay; kiểm soát bằng vết + dải chặn cứng).
- Lịch sử cấu hình dạng chuỗi thời gian đầy đủ (đợt này chỉ giữ vết theo tham số).
- Đẩy cấu hình cho nhiều máy cùng lúc.
