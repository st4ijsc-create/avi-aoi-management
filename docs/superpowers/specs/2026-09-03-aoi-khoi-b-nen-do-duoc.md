# Khối B — nền đo được trước khi thiết kế

**Ngày:** 2026-09-03 · Mọi con số kèm tên DB (luật Đ-28).

---

## 1. SỬA LẠI chẩn đoán Đ-19 của tôi

Tôi từng viết: *"cấp component không có bảng, Khối B phải bắt đầu bằng migration."* **Sai.**

`measurement_results` **đã chính là** cấp component — migration 0340 dọn sẵn đúng các trường của `componentV2`:

```
inspectionCaptureRowId → FK lên inspection_captures
componentExtId · ntf · ntfSource · errorCode · errorDesc · startedAt · completedAt
```

| Phép đo (`aoi_management_test`) | |
|---|---|
| tổng hàng `measurement_results` | **31 520** |
| có `inspectionCaptureRowId` | **0** |
| có `componentExtId` | **0** |

⇒ **Thiếu ĐƯỜNG GHI, không thiếu bảng.** Khối B nhẹ hơn ở phần lưu trữ.

## 2. Khoá nối KHÔNG cần thiết kế — máy đã dùng chung một UUID

Đo hai mẫu thật của máy:

| thực thể | `template-sync-sample.json` (cấu hình) | `dashboard-sample.json` (kết quả) |
|---|---|---|
| capture | `id` = `…000000001011` | `captureId` = `…000000001011` |
| component | `id` = `…000000010111` | `componentId` = `…000000010111` |

**Trùng khít.** Máy dùng **cùng một UUID** cho cùng một thực thể ở cả hai chiều ⇒ phép nối `componentId → pointDefId` là **join trực tiếp**, không cần bảng ánh xạ, không cần quy ước đặt tên.

Và cột đích **đã có sẵn ở cả hai phía**: `measurement_point_defs.componentExtId` (phía dạy) ↔ `measurement_results.componentExtId` (phía kết quả).

## 3. NHƯNG khoá đó rỗng ở CẢ HAI phía

| DB | tổng `measurement_point_defs` | `componentExtId` | `componentCode` | `refDesignator` | `captureRowId` |
|---|---|---|---|---|---|
| `aoi_management` | 110 | **0** | 34 | 34 | **0** |
| `aoi_management_test` | 2 785 | **0** | 0 | 0 | **0** |

⇒ Cột nối tồn tại ở cả hai bên và **chưa hàng nào được ghi ở bên nào**. Không nối được bằng mã — **phải có dữ liệu**.

## 4. Dữ liệu đó phải đến từ config sync — mà chiều hiện có ĐI NGƯỢC

`configSyncGeneric` (`machineApiRouters.ts:5095+`) có `configKind: ["recipe","device_settings","points","model"]` — nhưng:

- Gần như toàn bộ là **`.query()`** ⇒ **máy KÉO cấu hình TỪ hệ sinh thái**.
- Trong vùng đó **0 nơi ghi** `measurement_point_defs`.
- **Không endpoint nào nhận hình dạng cấu hình của máy**: `surfaceTemplateImagePath` · `markerWidth` · `relX` ⇒ **0 kết quả** ngoài test.

⇒ Cây dạy của máy (`template-sync-sample.json`) **chưa có hợp đồng, chưa có cửa** trong hệ sinh thái.

## 5. Thứ tự bắt buộc — hai nửa Khối B KHÔNG độc lập

```
config sync (máy → hệ)  ──cấp dữ liệu──▶  mở khoá cấp component (Đ-19 + BG-92)
```

Không có bước một thì bước hai **không có gì để join**. Mọi kế hoạch đảo thứ tự sẽ dừng ở chỗ `componentExtId IS NULL` trên 100% hàng.

## 6. Câu hỏi kiến trúc DUY NHẤT còn mở — ai sở hữu sự thật của dữ liệu dạy?

- **(a) Máy dạy rồi ĐẨY cây lên** — hệ sinh thái soi gương máy.
- **(b) Hệ định nghĩa điểm, máy KÉO về** — chiều `.query()` đang có.

**Bằng chứng đo được nghiêng hẳn về (a):** payload kết quả mang **UUID do máy sinh**, và hệ buộc phải nhận đúng UUID đó mới join được. Đường dẫn trong mẫu cấu hình (`D:/InspectProAOI/Solutions/MODEL-X-SOLUTION/…`) cũng là bản xuất từ giải pháp của **chính máy**.

Chọn (b) đồng nghĩa bắt máy nhận UUID của hệ — **mâu thuẫn với dữ liệu mẫu đang có**.

⚠ Đây là quyết định của chủ dự án vì nó định đoạt ai là nguồn sự thật, không phải một lựa chọn kỹ thuật thuần tuý.

---

## 7. QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (2026-09-03) — hướng (a): **máy đẩy cây dạy lên**

> Máy dạy xong thì **đẩy** cây cấu hình + **UUID của chính nó** lên hệ sinh thái. Hệ soi gương máy.

Quyết định này **khớp với bằng chứng đo được** ở §2: payload kết quả đã mang UUID do máy sinh, và hệ buộc phải nhận đúng UUID đó mới join được.

### Hệ quả kỹ thuật — sinh ra việc, theo thứ tự

| # | Việc | Vì sao bắt buộc |
|---|---|---|
| **B-1** | **Hợp đồng** cho cây dạy của máy (`surfaces[].positions[].captures[].components[]` + `roi`, `templateImagePath`, `markerWidth/Height`, `relX/relY`) | §4 đo được: **0 endpoint** nhận hình dạng này. Chưa có hợp đồng thì chưa có cửa. |
| **B-2** | **Cửa ingest cấu hình** (`.mutation`, máy → hệ), xác thực bằng `authenticateMachine` | Chiều hiện có là `.query()` — đi ngược. ⚠ Đặt điểm ghi **sau** xác thực ngay từ đầu; bài học I-4 vừa trả giá. |
| **B-3** | **Ghi `measurement_point_defs`**: `componentExtId` = `components[].id`, `captureRowId` nối lên cây | §3: cả hai cột hiện **0 hàng** ở cả hai DB. Đây là thứ đổ đầy khoá nối. |
| **B-4** | **Mở khoá cấp component** — ghi `measurement_results` với `inspectionCaptureRowId` + `componentExtId` (**Đ-19**) | §1: bảng và cột đã sẵn từ mig 0340; chỉ thiếu đường ghi. |
| **B-5** | **Nối lại spec-gate `evaluatePointResult`** trên đường v2 (**BG-92**) | Sau B-3 mới tra được `pointDefId` từ `componentExtId`. Trước đó **không thể** — đó là lý do BG-92 phải đóng cùng Đ-19. |
| **B-6** | **Version per-máy per-version** cho cây dạy | Yêu cầu gốc của chủ dự án; và không có version thì không biết kết quả thuộc bản dạy nào. |

### Ràng buộc mang sang từ 8 lượt review

- ⚠ **Nhận diện theo HÌNH DẠNG**, dùng lại vị từ đã có — **không** thêm vị từ thứ hai (lớp lỗi "hai nguồn sự thật" đã tốn 8 lượt để dọn).
- ⚠ **Điểm ghi nằm SAU xác thực.** `entityId` phải là FK máy thật, không phải nhãn máy tự khai (I-4).
- ⚠ **Không cắt đường cũ trước khi đường mới chứng minh chạy** (Đ-20).
- ⚠ Mọi lưới phải **đỏ được**; mọi con số DB kèm `current_database()` (Đ-28).
