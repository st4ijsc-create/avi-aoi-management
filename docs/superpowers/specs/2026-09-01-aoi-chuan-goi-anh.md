# Chuẩn gói ảnh AOI — một hợp đồng, hai đường vận chuyển

**Ngày:** 2026-09-01 · **Quyết định của chủ dự án** · **Thay thế** hướng (a) của BG-73 và BG-84.

---

## 1. Quyết định

> *"Đối với gói ảnh, cần đưa ra tiêu chuẩn đóng gói và nén. Ngoài ra file `.json` trong gói cần **giống hệt cấu trúc** của chuỗi JSON kết quả gửi về hệ sinh thái, để đảm bảo đồng bộ và tìm kiếm dễ dàng hơn."*

⇒ **`meta.json` trong gói KHÔNG còn là một hợp đồng riêng.** Nó là **chính payload kết quả v2.0**, cộng thêm **một** mảng tham chiếu ảnh.

**Một hợp đồng, hai đường vận chuyển:**
- **Đường trực tiếp** — máy `POST` payload v2.0 (JSON thuần), không ảnh.
- **Đường gói** — máy nén ZIP chứa **cùng payload đó** + thư mục ảnh.

---

## 2. Vì sao quyết định này đúng — đo được, không phải ý kiến

Đo hai mẫu thật (`dashboard-sample.json` ↔ `aoipackage-meta-sample.json`):

```
TRÙNG NHAU (8/12 trường gốc):
  type · identity · productId · serialNumber · productModel · overallResult · startedAt · completedAt
GÓI THIẾU:   ntf · machineProductIndex · summary · surfaces
GÓI CÓ THÊM: images[] → { captureId, surface, positionId, captureName, localImagePath, fileName }
```

**Hai hình dạng không hề xung khắc.** Gói ảnh chỉ đang **thiếu cây** và **thừa một mảng tham chiếu**. Và `images[].captureId` **chính là khoá join** sang `captures` trong cây — mối nối đã có sẵn, chỉ chưa có cây để nối vào.

**Cái giá của việc để hai hợp đồng tách rời** đã trả trong sáu lượt review:
- Cửa ZIP cuộn verdict từ `summary` **máy tự khai** thay vì từ dữ liệu ⇒ máy khai nhất quán sai đi lọt hoàn toàn (Đ-25/BG-68).
- `inferAoiOverallResult` là **bản logic chép tay thứ hai** ⇒ hai đường xử lý **ngược nhau** cho cùng một sản phẩm (BG-42).
- `metaJsonSchema` có **0 trường `.max()`** trong khi 6 trường ghi thẳng vào `varchar` (BG-52).
- Census `.max()` soi 2 schema, bỏ lọt cửa ZIP (BG-69).

⇒ Mỗi lần sửa một đường, đường kia lệch ra. **Một hợp đồng thì không có "đường kia".**

---

## 3. Chuẩn cấu trúc gói

```
<packageId>.zip
├── meta.json          ← BẮT BUỘC, ở GỐC. Hình dạng: payload v2.0 + images[]
└── images/
    ├── <fileName>     ← đường dẫn khớp images[].fileName
    └── …
```

**Bắt buộc:**
- `meta.json` ở **gốc** gói, tên **chính xác** (phân biệt hoa thường).
- Mọi ảnh nằm trong `images/`. **Bỏ fallback tên trần** hiện có (`zip.file(fileName)`) — một đường dẫn, một chỗ tìm.
- `images[].fileName` là đường dẫn **tương đối trong `images/`**, không chứa `..` và không tuyệt đối.

## 4. Chuẩn `meta.json`

**Bằng hợp đồng `machineDataContractV2` cộng đúng MỘT trường:**

```
meta.json = machineDataContractV2  +  images: ImageRef[]

ImageRef = {
  captureId    : string   // KHOÁ JOIN sang surfaces[].positions[].captures[].captureId
  fileName     : string   // đường dẫn tương đối trong images/
  captureName? : string
  sha256?      : string   // nếu có, PHẢI được kiểm — xem §6
}
```

**Bỏ khỏi `ImageRef`:** `surface` và `positionId` — chúng **suy được** từ `captureId` qua cây, và giữ lại là tạo **nguồn sự thật thứ hai** (đúng lớp lỗi vừa mất sáu lượt review để dọn).

**Bất biến bắt buộc, phải có lưới canh:**
1. **Mọi `images[].captureId` phải tồn tại** trong cây `surfaces[].positions[].captures[]`. Không tồn tại ⇒ **từ chối gói**, không âm thầm bỏ ảnh.
2. **Mọi `images[].fileName` phải có tệp thật** trong `images/`. Thiếu ⇒ từ chối.
3. Verdict cuộn từ **cây** (`measurements`/`components`), **không** từ `summary`. `summary` chỉ để đối chiếu và gắn cờ lệch.

## 5. Chuẩn nén

| Mục | Chuẩn | Vì sao |
|---|---|---|
| Định dạng | **ZIP**, `DEFLATE` | đã dùng, thư viện `JSZip` sẵn có, máy đọc được |
| Mức nén | **6** (mặc định) | ảnh đã nén sẵn; mức cao hơn tốn CPU máy mà gần như không giảm byte |
| Ảnh | **KHÔNG nén lại** (`STORE`) trong ZIP nếu đã là JPEG/PNG | nén lại tốn CPU, giảm <2% |
| Kích thước gói | **trần cứng phía máy chủ** | hiện `sizeBytes` **do client tự khai** (`z.number()`, không trần) — xem §6 |
| Số ảnh/gói | trần cứng | chống gói bệnh làm nghẽn `commit` |

## 6. Ba lỗ hiện có mà chuẩn này phải đóng

| Lỗ | Hiện trạng đo được | Chuẩn đòi |
|---|---|---|
| **`sha256` nhận rồi vứt** | nhận ở `presign`/`commit`, **không bao giờ kiểm** (BG-60) | nếu có `sha256` ⇒ **kiểm**; lệch ⇒ từ chối. Trường "trông như bảo đảm toàn vẹn mà không phải" nguy hiểm hơn không có |
| **`sizeBytes` do client tự khai** | `z.number()` không trần, không đối chiếu byte thật | trần cứng phía máy chủ **và** đối chiếu với byte nhận thật |
| **Fallback tên trần** | `zip.file(imagePath) \|\| zip.file(fileName)` | bỏ — một đường dẫn duy nhất |

## 7. Đường di trú — máy cũ không bị chặn đột ngột

⚠ Bài học đã trả giá: **cắt trước khi cái thay thế sẵn sàng là làm hệ thống tệ hơn** (xem Đ-20).

**Ba giai đoạn:**
1. **Nhận cả hai** — `meta.json` hình dạng cũ (`images[]` không cây) vẫn commit được như hôm nay; hình dạng mới đi đường cây đầy đủ. Nhận diện **theo hình dạng** (`Array.isArray(surfaces)`), dùng lại `laHinhDangCayV2` — **không** thêm vị từ thứ hai.
2. **Đếm được** — log/metric phân biệt hai hình dạng, để trả lời *"còn bao nhiêu máy gửi hình dạng cũ?"*. Đây là điều kiện tiên quyết của giai đoạn 3, và là lỗ BG-57 đang mở.
3. **Cắt** — khi số máy gửi hình dạng cũ về 0, bật cờ từ chối, dùng lại đúng `loiMayChuaNangCap` và `quyetDinhPhienBanIngest` đã có.

**Trong lúc di trú:** gói hình dạng cũ nằm `'failed'` và retry vô hạn (bản vá `8150ab6d`) — **không** chết `'dead'`. Đó là hành vi đã duyệt.

---

## 8. Việc phải làm — sinh ra từ chuẩn này

| Mã | Việc | Thay thế |
|---|---|---|
| **BG-85** ⛔ | `metaJsonSchema` = `machineDataContractV2` + `images[]`; **xoá** hợp đồng song song | thay hướng (a) BG-73 |
| **BG-86** ⛔ | Bất biến `captureId` ↔ cây + `fileName` ↔ tệp thật, **có lưới canh** | mới |
| **BG-87** | Kiểm `sha256`; trần `sizeBytes` phía máy chủ + đối chiếu byte thật; bỏ fallback tên trần | gộp BG-60 |
| **BG-88** | Chuẩn nén (mức 6, ảnh `STORE`) + tài liệu cho bên tích hợp máy | thay BG-84 |
| **BG-89** | Đếm được hai hình dạng (điều kiện tiên quyết để cắt) | gộp BG-57 |

⇒ Sau khi BG-85 xong, **BG-42/BG-53/BG-68/BG-76 tự tan** — chúng đều là hệ quả của việc có hai hợp đồng. `inferAoiOverallResult` không còn lý do tồn tại; cửa ZIP dùng thẳng `dichCayKetQua` như đường trực tiếp.

**Đây là lần đầu trong dự án một quyết định làm BIẾN MẤT nhiều món nợ hơn số nó tạo ra.**
