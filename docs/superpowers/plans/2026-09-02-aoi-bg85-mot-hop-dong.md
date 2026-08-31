# BG-85…BG-89 — Một hợp đồng, hai đường vận chuyển

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development`. Các bước dùng checkbox `- [ ]`.

**Mục tiêu:** Hợp nhất `meta.json` của gói ZIP về **chính hợp đồng kết quả v2.0** (`machineDataContractV2`) cộng **một** mảng tham chiếu ảnh. Xoá hợp đồng song song `metaJsonSchema`.

**Chuẩn (quyết định chủ dự án):** `docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md`
**Backlog toàn cảnh:** `docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md`

---

## Vì sao pha này khác mọi pha trước

Bảy lượt review toàn nhánh, bảy lần tìm ra Critical. **Phần lớn trong số đó là hệ quả của việc có HAI hợp đồng cho cùng một thứ** — sửa một đường, đường kia lệch ra:

| Nợ | Nguyên nhân gốc |
|---|---|
| BG-42 | `inferAoiOverallResult` là **bản logic chép tay thứ hai** ⇒ hai đường xử lý **ngược nhau** |
| BG-53 | hai nơi gọi cùng hàm, **nuôi hai đầu vào khác nhau** |
| BG-68 | cửa ZIP cuộn verdict từ **lời khai** thay vì dữ liệu |
| BG-76 | `ngCount` và `overallResult` **cùng hàng, hai nguồn** |
| BG-72/91 (×3 vòng) | cùng một trường, vá **nửa đường**, ba lần |

⇒ **Pha này là việc duy nhất trong backlog làm BIẾN MẤT nhiều nợ hơn số nó tạo ra.**

⚠ Và một phần đã làm sẵn: bản vá C-2 (`d22389bd`) nâng trần thời gian cho `machineDataContractV2` ở **cả 4 cấp cây** ⇒ khi nó trở thành `meta.json`, **không phải làm lại**.

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **KHÔNG đổi mặc định** `INSPECTION_STORE_FORWARD_ENABLED`, `INGEST_REJECT_LEGACY_MACHINE_ENABLED`.
- **Nghiệm thu DB bằng vai `avi_app`**. ⚠ **KHÔNG có DELETE** trên `product_inspections` (WORM) — nói rõ để lại bao nhiêu hàng; **đừng** `DELETE … .catch(() => {})`.
- ⚠ `data/inspection-store-forward*.jsonl` là **tệp THẬT** — đừng ghi vào.
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC.** ⚠ **Hoàn tác đột biến và chứng minh** (`git status --short` sạch).
- ⚠ **NHỚ COMMIT.** Đã ba lần công việc suýt mất vì báo "XONG" mà không commit.
- **Câu hỏi bắt buộc trong mọi báo cáo:** *"bản vá này chuyển thứ gì từ lớp nào sang lớp nào, và ai đang phụ thuộc vào phân lớp cũ?"* — đã tìm ra chiều thứ hai **bốn lần liên tiếp**.
- Hai cổng Pha 0 xanh (3/3, 4/4). `npm run check` sạch.
- Cây làm việc **dùng chung** (`client/src/**` trừ `AoiPackageSection.tsx`, `knowledge/**`, `server/services/aiLocalTools/**`, `vscode-extension/**`) — đừng đụng.

---

## ⚠ Ràng buộc an toàn xuyên suốt: KHÔNG cắt trước khi thay thế sẵn sàng

Bài học Đ-20 đã trả giá. **262 gói `committed` là dữ liệu thật.** Mọi task phải:
- Giữ đường cũ **nhận được** cho tới khi đường mới chứng minh chạy;
- Nhận diện **theo hình dạng**, dùng lại `laHinhDangCayV2` — **không** thêm vị từ thứ hai;
- Trả lời được: *"gói đang bay giữa chừng lúc triển khai thì sao?"*

---

### Task 1 (BG-85 ⛔) — `metaJsonSchema` = `machineDataContractV2` + `images[]`

**Files:** `server/routers/aoiPackageRouter.ts`, `server/contracts/` + lưới

- [ ] **Bước 1: Đo TRƯỚC** — chạy `metaJsonSchema.safeParse` và `machineDataContractV2.safeParse` trên **cùng** mẫu máy thật `D:\SOURCES\AOIData\aoipackage-meta-sample.json`, chép nguyên văn cả hai kết quả. Đây là baseline.
- [ ] **Bước 2:** Khai `ImageRef` theo §4 của chuẩn:
```
ImageRef = { captureId: string, fileName: string, captureName?: string, sha256?: string }
```
⚠ **BỎ `surface` và `positionId`** — chúng suy được từ `captureId` qua cây. Giữ lại là tạo **nguồn sự thật thứ hai**, đúng lớp lỗi bảy lượt review vừa dọn.
- [ ] **Bước 3:** `metaJsonSchema` mới = `machineDataContractV2.extend({ images: z.array(ImageRef).optional() })`.
⚠ Dùng **`.extend()` trên chính đối tượng**, không chép trường — chép là tạo lại hợp đồng song song.
- [ ] **Bước 4: Ba bất biến §4, mỗi cái một lưới:**
  1. Mọi `images[].captureId` **tồn tại** trong cây `surfaces[].positions[].captures[]`. Không tồn tại ⇒ **TỪ CHỐI gói**, không âm thầm bỏ ảnh.
  2. Mọi `images[].fileName` **có tệp thật** trong `images/`. Thiếu ⇒ từ chối.
  3. Verdict cuộn từ **cây**, `summary` chỉ để **đối chiếu và gắn cờ lệch**.
- [ ] **Bước 5:** Xoá `inferAoiOverallResult` — cửa ZIP dùng thẳng `dichCayKetQua` như đường trực tiếp.
⚠ Nếu còn hộ tiêu thụ, **báo trước khi xoá**.
- [ ] **Bước 6: Đường di trú** — hình dạng cũ vẫn **nhận vào** (không khoá `'dead'`), hình dạng mới đi đường cây. Nhận diện bằng `laHinhDangCayV2`.
- [ ] **Bước 7: Đột biến** — bỏ bất biến 1 ⇒ lưới phải ĐỎ. Chép nguyên văn.

**Bốn mệnh đề (đo bằng `SELECT` sau commit thật):**
1. Gói hình dạng **mới** (cây + `images[]`) ⇒ commit được, verdict cuộn từ **cây**, đủ ba cấp.
2. `images[].captureId` **không có** trong cây ⇒ **từ chối**, không commit im lặng.
3. **CHỐNG HỒI QUY:** 262 gói `committed` hiện có **không đổi verdict**.
4. **CHỐNG HỒI QUY:** gói hình dạng cũ **vẫn nhận vào**, không khoá `'dead'`.

---

### Task 2 (BG-87) — ba lỗ chuẩn nén/toàn vẹn

**Files:** `server/routers/aoiPackageRouter.ts`, `server/_core/index.ts` + lưới

| Lỗ | Hiện trạng đo được | Chuẩn đòi |
|---|---|---|
| `sha256` **nhận rồi vứt** | nhận ở `presign`/`commit`, **không bao giờ kiểm** | có `sha256` ⇒ **kiểm**; lệch ⇒ từ chối |
| `sizeBytes` **client tự khai** | `z.number()` không trần, không đối chiếu byte thật | **trần cứng phía máy chủ** + đối chiếu byte nhận |
| **Fallback tên trần** | `zip.file(imagePath) \|\| zip.file(fileName)` | **bỏ** — một đường dẫn duy nhất |

⚠ *"Trường trông như bảo đảm toàn vẹn mà không phải"* nguy hiểm hơn không có trường.

**Ba mệnh đề:** `sha256` lệch ⇒ từ chối · `sizeBytes` vượt trần ⇒ từ chối trước khi tải · ảnh ngoài `images/` ⇒ không tìm thấy (không fallback).

---

### Task 3 (BG-89 + BG-88) — đếm được hai hình dạng, và tài liệu cho bên tích hợp

**BG-89** là **điều kiện tiên quyết** để bao giờ dám cắt hình dạng cũ. Hiện `quyetDinhPhienBanIngest` **không log, không counter, không audit** ở **cả hai** trạng thái cờ ⇒ câu hỏi *"còn bao nhiêu máy gửi hình dạng cũ?"* **không trả lời được từ mã**.

- [ ] Phát tín hiệu **đếm được** cho cả hai hình dạng, ở **mọi** cửa ingest.
- [ ] Lưới khẳng định tín hiệu **thật sự phát ra** (không phải chỉ có mã ghi log).
- [ ] **BG-88:** tài liệu chuẩn nén (mức 6, ảnh `STORE`) + cấu trúc gói cho bên tích hợp máy. Dùng lại lưới `taiLieuMetaJsonKhopHopDong.test.ts` (Pha 1F Task 7) để ví dụ mới **cũng** được canh.

---

## Cổng ra

- [ ] Mẫu máy thật (sau khi máy đổi sang hình dạng mới) ⇒ commit được, verdict từ **cây**.
- [ ] `captureId` không có trong cây ⇒ **từ chối**; `fileName` thiếu tệp ⇒ **từ chối**.
- [ ] **262 gói `committed` không đổi verdict**; hình dạng cũ **vẫn nhận vào**.
- [ ] `inferAoiOverallResult` **đã xoá**, hoặc còn kèm lý do ghi rõ.
- [ ] `sha256` lệch ⇒ từ chối · `sizeBytes` vượt trần ⇒ từ chối · không còn fallback tên trần.
- [ ] Đếm được **hai hình dạng** ở mọi cửa, có lưới chứng minh tín hiệu phát ra thật.
- [ ] `npm run check` sạch · hai cổng Pha 0 xanh.
- [ ] **BG-42/53/68/76 tự tan** — chứng minh bằng cách chỉ ra mã sinh ra chúng đã biến mất.

**Còn mở sau pha này:** BG-39 gđ2 (gác cửa ZIP) · Đ-19 + **Khối B** · BG-36 · BG-70/71/74/75/77/83/90/93…99 · §6 giao thức version · §3.6 dọn mồ côi · **Khối C** · **Khối D**.
