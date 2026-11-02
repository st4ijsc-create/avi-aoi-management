# SCADA giao diện đẹp, mượt, chỉn chu — đặc tả thiết kế (bản để duyệt)

- **Ngày:** 2026-11-02 · **Tác giả:** phiên `scada-ui` · **Người duyệt:** dieu-phoi → chủ dự án
- **Trạng thái:** ĐẶC TẢ + MOCKUP. CHƯA có mã sản phẩm. Không chạm `.env` / :3000 / :8091 / GPU; không chạy DB; không đo trên máy chạy.
- **Mockup xem được:** [mockup.html](2026-11-02-scada-giao-dien-muot-mockup/mockup.html) (mở thẳng bằng trình duyệt; 4 trạng thái bấm đổi được) + ảnh [1 bình thường](2026-11-02-scada-giao-dien-muot-mockup/anh-1-binh-thuong.png) · [2 cảnh báo](2026-11-02-scada-giao-dien-muot-mockup/anh-2-canh-bao.png) · [3 dữ liệu cũ](2026-11-02-scada-giao-dien-muot-mockup/anh-3-du-lieu-cu.png).
- **Nhãn bằng chứng dùng trong tài liệu:** **[MÃ]** = đã đọc trong mã, có `tệp:dòng` · **[ĐỀ XUẤT]** = thiết kế mới, chưa có · **[CHƯA KIỂM]** = suy luận, cần đo / hỏi chủ sở hữu trước khi dựa vào.

---

## 0. Tóm tắt một trang

1. **Hạ tầng đẩy dữ liệu SCADA ĐÃ CÓ phía server nhưng KHÔNG AI DÙNG và đang TẮT.** Kênh `scada:subscribe` → `scada:snapshot` / `scada:delta` (≤ 1 khung / 250 ms, kiểm phạm vi TỪNG TAG, không `socket.join`) nằm sẵn ở `server/services/scada/scadaSocket.ts`; cờ `SCADA_SOCKET_ENABLED=false` mặc định (`.env.example:3342`); phía client **0 chỗ gọi** (`ScadaDiag.tsx:5` còn ghi rõ "không dùng kênh socket"). Việc phase 1 chủ yếu là **nối client + vá 3 lỗ hợp đồng** (§3.3), không phải dựng kênh mới.
2. **Hai điều dieu-phoi đã đo trong mã cần điều chỉnh:** (a) nút thắt `byteMau`/`getImageData` **đã được vá** từ 2026-09-18 (đệm theo chuỗi màu — `byteMau.ts:48-66`); mục "gỡ byteMau" của đề bài ⇒ chuyển thành "đo lại, nếu còn đỏ mới sửa". (b) Twin **đã có luồng đẩy** riêng (poll chỉ hạ xuống 30 s làm lưới an toàn — `TwinVanHanh.tsx:2538`); lỗ thật của twin là *huy hiệu "trực tiếp" khai đường kết nối chứ không khai tuổi con số* (đã ghi nhận ở Đợt 21 B-3). Faceplate và bảng kênh SCADA thì **đúng là hỏi vòng 2 s / 5 s** (`Faceplate.tsx:45`, `NganTagAdapter.tsx:238` = 2 s, `ChipTruyenThong.tsx:16` = 15 s).
3. **Nút thắt thật của "thiết bị → màn < 300 ms" KHÔNG nằm ở màn hình mà ở nguồn:** mặc định adapter hỏi thiết bị mỗi **5 s** (`POLL_MAC_DINH_MS`, `boDemHienTai.ts:71`) và tag có deadband có thể im tới 70 s mà vẫn "tươi" (`NGUONG_DEADBAND_MS`). Đẩy qua socket chỉ làm đoạn *bộ đệm → màn* < 300 ms; đoạn *thiết bị → bộ đệm* phụ thuộc chu kỳ quét / đăng ký của từng giao thức. Vì vậy mục tiêu đo được phải chia **theo tầng nguồn** (§2), không cam kết một con số chung.
4. **Lỗ hợp đồng quan trọng nhất (§3.3-A): kênh hiện chỉ đẩy khi giá trị ĐỔI. Một tag im lặng vì "không đổi" và một tag im lặng vì "đường truyền chết" trông giống hệt nhau trên client.** Muốn "dữ liệu cũ ⇒ dừng + xám" đúng, server phải gửi nhịp tim (heartbeat) kèm ngưỡng cũ riêng của từng tag.
5. **Sản phẩm ISA-101:** nền xám, màu CHỈ cho bất thường, bất thường luôn kèm hình + số ưu tiên + chữ. Dùng lại quy ước D10 đã có trong mã (tím gạch = cũ / không tin được; xám chấm = nghi ngờ).
6. **Phân pha:** Pha 1 = (1) đẩy + (2) hoạt ảnh trung thực + (3) màn quá trình 2D & faceplate v2. Pha 2 = (5) chế độ mô phỏng. Pha 3 = (4) tay nghề 3D. Đo mốc HIỆN TẠI (mục 6) là việc đầu tiên của pha 1, trước mọi sửa.

---

## 1. Hiện trạng đã đọc trong mã (chỉ-đọc)

| # | Phát hiện | Bằng chứng | Hệ quả |
|---|---|---|---|
| H1 | Server đã có kênh đẩy SCADA theo từng tag, kiểm phạm vi từng tag, đóng khung 250 ms, giới hạn 500 tag/đăng ký, 10 đăng ký/socket | `scadaSocket.ts:1-30` | Không dựng kênh mới; dùng lại + vá |
| H2 | Cờ bật mặc định TẮT; client không gọi | `.env.example:3342`; grep `scada:subscribe` toàn client = 0 chỗ dùng | Phải có quyết định BẬT (chủ dự án) + hook client |
| H3 | Kênh chỉ đẩy khi `dangKyThayDoi` báo đổi; không đẩy khi chỉ trôi thời gian | `scadaSocket.ts:145-173` (`khiBoDemDoi` → `cho` → `dayKhung`) | Lỗ heartbeat (§3.3-A) |
| H4 | Mỗi giá trị đã mang `[adapterId, tagKey, v, q, ts, ageMs, stale, reason]`; tuổi do SERVER tính ⇒ không phụ thuộc đồng hồ client | `scadaSocket.ts:34-44`, `boDemHienTai.ts` `GiaTriCoTuoi` | Đủ để "luôn hiện tuổi / chất lượng" mà không phát minh trường mới |
| H5 | Ngưỡng cũ của tag = `max(3·poll, deadband ? 70 s : 0)`; poll mặc định 5 s | `boDemHienTai.ts:28,172-176` | Client KHÔNG được tự đặt ngưỡng cũ cố định; phải nhận từ server |
| H6 | Faceplate hỏi `tagCuaAdapter` mỗi 2 s và `cheDo.danhSach` mỗi 5 s | `Faceplate.tsx:45,91-92` | Số nhảy bậc 2 s; tuổi tối đa hiển thị ≈ 2 s + poll nguồn |
| H7 | Twin vận hành đã có luồng đẩy; poll 30 s là lưới an toàn có chủ ý; badge "trực tiếp" khai đường nối ≠ tuổi số | `TwinVanHanh.tsx:2538-2549` | Pha 3 sửa cách KHAI, không bỏ poll an toàn |
| H8 | `byteMau`: đã có đệm; trước vá `getImageData` = 93 % main thread, 9,2 fps khi kéo (2026-09-18) | `byteMau.ts:48-66` | "Gỡ byteMau" ⇒ chỉ đo lại |
| H9 | Hiệu năng 3D đã khảo sát: tồn H2 (`frameloop="demand"` cho vài màn), H3 (nhãn `getBoundingClientRect`/khung), H5 (GLB meshopt/KTX2), H8 (18–27 fps ở vài góc, nghi overdraw) | `docs/superpowers/specs/2026-10-23-scada-k12-k14-luu-do-nha-may-ao-thu-vien.md` §5.2 | Pha 3 KẾ THỪA backlog này, không lập danh sách thứ hai |
| H10 | Chưa có màn quá trình 2D (mimic). K12 (lưu đồ điều khiển) / K13 (nhà máy ảo 3D) đã có đặc tả riêng; **K12 là SFC/lưu đồ logic, KHÔNG phải mimic** | cùng tệp trên §2–§3 | Mimic là hạng mục MỚI; không trùng K12 |
| H11 | Quy ước chất lượng D10 đã có: `bad`/`stale` ⇒ tím gạch; `uncertain` ⇒ viền chấm xám | `chatLuongHienThi.ts:5,48-57` | Dùng nguyên, không đổi bảng màu |
| H12 | Phạm vi nhà máy: "ngoài phạm vi ≡ không tồn tại"; socket kênh SCADA trả `denied` cùng hình dạng cho "không tồn tại" và "ngoài phạm vi" | `scadaSocket.ts:19-20` | Hợp đồng mới phải giữ tính chất này |

**Chưa kiểm (cần scada-master / đo):** deadband của tag có được áp TRƯỚC `dangKyThayDoi` không (ảnh hưởng tần suất khung); độ trễ thực của từng giao thức (Modbus poll, OPC UA monitored item, edge); việc `socket.ts` đăng ký `registerScadaHandlers` có điều kiện nào ngoài cờ.

---

## 2. Mục tiêu đo được (SLO) — mốc hiện tại điền ở pha 1, con số dưới đây là MỤC TIÊU ĐỀ XUẤT

Nguyên tắc: **fps là chỉ số nhiễu — KHÔNG dùng.** Dùng thời gian khung p95/p99, độ trễ đầu-cuối, độ trễ thao tác.

| Mã | Chỉ số | Cách đo | Mốc hiện tại | Mục tiêu đề xuất |
|---|---|---|---|---|
| L-A | Độ trễ **bộ đệm → màn** (server nhận mẫu tới pixel đổi) | Dấu `ts_server_phat` trong khung + `performance.now()` lúc commit DOM (đã trừ lệch đồng hồ bằng `ageMs`) | **[CHƯA ĐO]** hiện = poll 2 s ⇒ trung bình ~1 s, tối đa ~2 s | p95 ≤ 300 ms |
| L-B | Độ trễ **thiết bị → bộ đệm** theo tầng nguồn | Bộ mô phỏng nhà máy ghi tag có dấu thời gian, so với `ts` bộ đệm | **[CHƯA ĐO]**; mặc định poll 5 s | Tầng "nóng" (OPC UA subscription / Modbus ≤ 200 ms): p95 ≤ 250 ms; tầng "thường": = chu kỳ poll, **hiển thị tuổi thật** |
| L-C | **Thiết bị → màn** (= L-A + L-B) | Mô phỏng + Playwright đọc DOM | **[CHƯA ĐO]** | **p95 < 300 ms cho tag tầng "nóng"** (đúng yêu cầu), tag tầng thường: không hứa, chỉ hiện tuổi |
| F-1 | Thời gian khung p95 / p99 trên màn quá trình 2D | `PerformanceObserver` (`long-animation-frame`) + đo `requestAnimationFrame` delta, 60 s kịch bản cố định | n/a (chưa có màn) | p95 ≤ 16,7 ms, p99 ≤ 33 ms trên máy kiểm định |
| F-2 | Thời gian khung p95 / p99 trên `/twin` (xoay + dữ liệu sống) | Như trên; **không** dùng fps; ghi cả overdraw nếu H8 còn đỏ | **[CHƯA ĐO LẠI]** (23/10: khung xấu nhất 50 ms ở 41 máy; 18–27 fps ở vài góc) | p95 ≤ 20 ms, p99 ≤ 50 ms |
| O-1 | Độ trễ thao tác: bấm "Đổi…" → thấy kết quả `điều kiện`/hộp xác nhận | `performance.mark` quanh mutation | **[CHƯA ĐO]** | p95 ≤ 400 ms (không tính thời gian người nhập mã) |
| O-2 | Độ trễ **xác nhận** sau lệnh: gửi → trạng thái thiết bị đọc lại khớp | Từ nhật ký `scada_command_*` + `ts` mẫu xác nhận | **[CHƯA ĐO]** | Hiển thị đúng bất kể giá trị; mục tiêu p95 ≤ 2 chu kỳ quét tag đó |
| S-1 | Tỷ lệ khoảnh khắc màn hiện số "tươi" trong khi server báo cũ (sai trung thực) | Kiểm thử đột biến: ngắt nguồn, đếm khung có số không-gạch sau ngưỡng | n/a | **0** (đây là ràng buộc, không phải mục tiêu mềm) |

Phương pháp đo mốc (pha 1, Bước 0 — làm ở cửa sổ ngoài GPU, trên bản dev riêng, không đụng :3000):
1. Dùng bộ mô phỏng nhà máy có sẵn làm nguồn phát tag có dấu thời gian biết trước (L-B, L-C).
2. Kịch bản Playwright cố định (mở faceplate / màn quá trình, 60 s, tag đổi mỗi 100 ms) + `PerformanceObserver`. Ghi p50/p95/p99, không ghi trung bình.
3. Ghi kết quả vào `docs/…/mot-moc-do-giao-dien-muot.md` TRƯỚC khi sửa; sau sửa đo lại cùng kịch bản. Bất kỳ "cải thiện" nào không có hai con số cùng kịch bản = chưa chứng minh.

---

## 3. Kiến trúc dữ liệu đẩy (mục 1 của đề bài)

### 3.1 Sơ đồ

```
Thiết bị ──(poll | OPC UA subscription | edge push)──▶ boDemHienTai (RAM, theo adapter:tag, có ts + q + ngưỡng cũ)
                                                            │ dangKyThayDoi(keys)
                                                            ▼
                                   scadaSocket: đóng khung (mặc định 250 ms) ─▶ socket.emit đúng socket đã đăng ký
                                                            │   (KHÔNG join phòng, KHÔNG io.emit — census giữ nguyên)
                                                            ▼
                             client: MỘT socket dùng chung ─▶ kho `useScadaLive` (đếm tham chiếu đăng ký)
                                                            ▼
                         component (Số / Đồng hồ / Ký hiệu) đọc qua `useTagSong(adapterId, tagKey)` → {v, q, tuoiMs, cu}
```

### 3.2 Cái ĐÃ dùng lại được **[MÃ]**
- Hợp đồng `scada:subscribe/snapshot/delta/unsubscribe/error` và bộ giá trị 8 phần tử (§1 H1, H4).
- Kiểm quyền + phạm vi từng tag lúc đăng ký (`taoKiemPhamViTagScada`); ngoài phạm vi ≡ `denied` ≡ không tồn tại.
- Chặn khuếch đại: ≤ 1 lệnh subscribe đang chờ/socket (`BUSY`), 500 tag/đăng ký, 10 đăng ký/socket, mã lỗi tường minh thay vì cắt im lặng.
- Vòng đẩy chỉ tồn tại khi có ≥ 1 đăng ký.

### 3.3 Ba lỗ hợp đồng cần vá — phần server do **scada-master**; hợp đồng do scada-ui viết (dưới đây)

**A. Nhịp tim + ngưỡng cũ theo tag (BẮT BUỘC cho hoạt ảnh trung thực).**
Hiện client không có cách phân biệt "im vì không đổi" với "im vì chết". Đề xuất:
- Trong `scada:snapshot` mỗi giá trị kèm `staleAfterMs` (= ngưỡng cũ của adapter đó, H5).
- Thêm `scada:tick` `{subId, serverTs, adapters: [{adapterId, trangThai, tuoiMauMoiNhatMs}]}` mỗi **1000 ms** khi đăng ký còn sống (không phụ thuộc có đổi hay không). Tick KHÔNG mang giá trị tag ⇒ không mở thêm bề mặt rò dữ liệu.
- Client: một tag là **cũ** khi `(now_client − recvAt_của_mẫu_cuối + ageMs_lúc_nhận) > staleAfterMs` HOẶC server nói `stale`, HOẶC **mất tick > 3 s** (mất đường truyền ⇒ MỌI tag của đăng ký đó chuyển cũ, kể cả tag có deadband dài).
- Rủi ro cần scada-master xác nhận: tick 1 Hz × số socket × số đăng ký — ngân sách byte (§3.5).

**B. Nhịp khung tuỳ chọn theo đăng ký.** `chuKyDeltaMs = 250` cố định (`scadaSocket.ts:30`). Cho đăng ký xin `capMs ∈ {50,100,250,1000}` (kẹp phía server; mặc định 250). Màn quá trình xin 100 ms cho nhóm "nóng", bảng chẩn đoán xin 1000 ms. Ghi nhận: khung 100 ms làm L-A ≈ ≤ 100 ms + truyền; 250 ms làm L-A ≈ ≤ 250 ms ⇒ **chỉ 100 ms đạt mục tiêu < 300 ms với biên an toàn**.

**C. Trật tự và mất khung.** `delta` không có số thứ tự. Thêm `seq` tăng dần mỗi `subId`; client thấy nhảy cách ⇒ gửi lại `scada:subscribe` cùng `subId` để lấy `snapshot` mới (server đã hỗ trợ đăng ký lại cùng `subId`). Khi kết nối lại socket: **snapshot trước, rồi mới coi dữ liệu là tươi**; trong lúc chờ, mọi tag hiển thị **cũ**.

### 3.4 Dự phòng khi đẩy không có (`DISABLED`, mất kết nối, bị từ chối)
- Hạ về hỏi vòng (như hiện nay), **và luôn hiện pill "Chế độ hỏi vòng · tuổi tối đa ~N s"** (không im lặng). Pill "Đẩy trực tiếp" chỉ sáng khi có `scada:tick` trong 3 s.
- Hai pill KHÔNG bao giờ cùng sáng "trực tiếp" khi một con số đến từ poll (bài học Đợt 21 B-3, H7: khai tuổi con số, không khai đường nối).

### 3.5 Ngân sách và phạm vi
- Mỗi màn quá trình khai TRƯỚC danh sách tag của nó (từ định nghĩa màn, §5.4) ⇒ một đăng ký/màn, ≤ 150 tag (dưới trần 500; còn dư cho faceplate mở chồng).
- Ngân sách byte ước tính **[CHƯA KIỂM]**: 150 tag × ~60 byte × 10 khung/s ≈ 90 KB/s/người tồi nhất; thực tế delta chỉ mang tag đổi. Cần đo trong pha 1 trước khi chốt `capMs = 100` làm mặc định.
- **Phạm vi nhà máy:** không thêm `socket.join`, không `io.emit`. Mọi kênh mới dùng `socket.emit` tới đúng socket, kiểm TỪNG TAG lúc đăng ký (census "mọi `socket.join` sau cổng" giữ nguyên số). Kênh mô phỏng (§7) cũng tuân thủ.

### 3.6 Hợp đồng đề xuất (TypeScript, cho scada-master chốt) **[ĐỀ XUẤT]**

```ts
// vào
type SubscribeV2 = { subId?: string; tags: { adapterId: number; tagKey: string }[];
                     capMs?: 50 | 100 | 250 | 1000;             // B
                     nguon?: "that" | "mo_phong" };               // §7; mặc định "that"
// ra (thêm trường, KHÔNG đổi tuple cũ để client cũ vẫn chạy)
type SnapshotV2 = { subId: string; seq: number; serverTs: number;
                    values: GiaTriGoi[];                          // như cũ
                    staleAfterMs: Record<`${number}:${string}`, number>;  // A
                    denied: { adapterId: number; tagKey: string }[] };
type DeltaV2    = { subId: string; seq: number; serverTs: number; values: GiaTriGoi[] };
type Tick       = { subId: string; seq: number; serverTs: number;
                    adapters: { adapterId: number; trangThai: "connected"|"connecting"|"lost"|"disabled"; tuoiMauMoiNhatMs: number | null }[] };
```
Lý do giữ tuple 8 phần tử: `GiaTriGoi` đã có test + client của người khác (nếu có) chưa thấy; thêm trường ở phong bì ngoài thì không vỡ hợp đồng cũ. **[CHƯA KIỂM]**: scada-master xác nhận không có bên dùng ngoài.

### 3.7 Phía client **[ĐỀ XUẤT]**
- `client/src/lib/scadaLive.ts`: MỘT `Socket`, kho `Map<khoá, Mẫu>`, đếm tham chiếu đăng ký (mount thêm, unmount bớt; gộp trong 50 ms để không bão subscribe), tự đăng ký lại sau kết nối lại, đồng hồ cũ riêng chạy 4 Hz chỉ để lật cờ `cu`.
- `useTagSong(adapterId, tagKey)` trả `{ v, q, tuoiMs, cu, nguon: "day" | "hoi" | "mo_phong" }`. **Mọi** ký hiệu, ô số, faceplate đọc qua hook này — một cửa duy nhất, không component nào tự gọi `tagCuaAdapter`.
- Kiểm thử bắt buộc (đã có thói quen của dự án): đột biến "bỏ kiểm tick ⇒ tag cũ vẫn hiện tươi" PHẢI đỏ.

---

## 4. Quy tắc hoạt ảnh TRUNG THỰC (mục 2 của đề bài)

**Nguyên tắc gốc:** *màn hình có thể trễ hơn sự thật một chút và luôn nói rõ trễ bao nhiêu; không bao giờ đi trước sự thật.* Nội suy = làm mượt VỀ PHÍA mẫu đã nhận. Ngoại suy = đoán mẫu chưa nhận ⇒ **cấm**.

| # | Quy tắc | Chi tiết |
|---|---|---|
| T1 | **Số mượt** | Giá trị hiển thị tiến tới mẫu mới nhất theo hàm mũ (hằng số ~90 ms, kẹp ≤ 250 ms); không bao giờ vượt mẫu cuối. Số nguyên / bool / enum: đổi ngay, không tween (không có "trạng thái nửa chừng"). Kim đồng hồ / thanh mức dùng cùng bộ làm mượt. |
| T2 | **Cấm ngoại suy** | Không dùng đà (vận tốc × thời gian) để dự đoán giá trị. Ngoại lệ DUY NHẤT: cuộn nền băng tải theo tốc độ đo (T4) — và đó là *hiệu ứng nền*, không phải vị trí vật. |
| T3 | **Cũ ⇒ dừng + tím gạch** | Tag `cu` (§3.3-A): số bị gạch + tiền tố `~`, nhãn "cũ N s", ô viền tím chấm, hoạt ảnh liên quan **đóng băng**, biểu tượng thiết bị chuyển sang tím (không xanh / xám trơn — để không lẫn với "dừng thật"). Thanh trên cùng hiện banner "DỮ LIỆU CŨ N s — số đang hiện là mẫu cuối". |
| T4 | **Băng tải** | Chỉ cuộn nền theo `speed` ĐO ĐƯỢC (m/s × hằng quy đổi pixel); `speed = 0` tươi ⇒ đứng yên VÀ số "0.00" rõ (khác trạng thái cũ). **Không vẽ sản phẩm chạy trên băng** trừ khi có cảm biến/ghi sự kiện (PE-201); sản phẩm xuất hiện tại điểm cảm biến rồi dịch theo tốc độ đo, **biến mất khi mẫu tốc độ cũ**. |
| T5 | **Luôn hiện tuổi và chất lượng** | Faceplate luôn hiện "mẫu N s trước · chất lượng …". Màn quá trình: tuổi hiện ở ô số khi > 2 s hoặc cũ; chất lượng `uncertain` = viền chấm xám, `bad` = tím gạch (D10). |
| T6 | **STOP chỉ hiện trạng thái ĐÃ XÁC NHẬN** | Ba trạng thái tách bạch: **Đang chạy / Đã gửi lệnh DỪNG — chờ thiết bị xác nhận / Đã dừng (đọc lại)**. Chỉ trạng thái thứ ba mới làm biểu tượng sang "dừng". Dữ liệu cũ ⇒ "Không biết" (không "đang chạy", không "đã dừng"). **Nút DỪNG MÁY KHÔNG bị khoá khi dữ liệu cũ** (fail-safe: người vận hành luôn có đường dừng; máy chủ vẫn là trọng tài). |
| T7 | **Không giấu hạ cấp** | Chế độ hỏi vòng / mô phỏng / cũ luôn có nhãn nhìn thấy ngay (§3.4, §7). Cấm hoạt ảnh "đang sống" khi nguồn là poll 30 s. |
| T8 | **Giảm chuyển động** | `prefers-reduced-motion` ⇒ tắt cuộn băng, tween số còn 0 ms; dữ liệu và nhãn tuổi vẫn đủ (mockup đã tôn trọng cho pill). |
| T9 | **Chi phí** | Một vòng `requestAnimationFrame` cho cả màn; chỉ gắn vào phần tử đang hiển thị (IntersectionObserver); tab ẩn ⇒ dừng. Không `setState` mỗi khung — ghi thẳng thuộc tính SVG (`transform`/`stroke-dashoffset`) qua ref. |
| T10 | **Không che lỗi** | Mất `tick` > 3 s: banner đỏ-tím "mất đường truyền", MỌI giá trị cũ. Không có chế độ "giữ giá trị cuối cho đẹp". |

**Mockup minh hoạ:** trạng thái 1 (mượt), 2 (số 0.00 rõ + cảnh báo — khác hẳn), 3 (gạch tím + tuổi + băng tải đứng + trend có khoảng hở KHÔNG nối đường + "Không biết" ở STOP).

---

## 5. Chuẩn màn quá trình 2D theo ISA-101 + danh mục ký hiệu (mục 3 của đề bài)

### 5.1 Quy tắc hình ảnh (ISA-101 high-performance HMI) **[ĐỀ XUẤT]**
1. **Nền xám nhạt** (`--bg #d6d9dc`), thiết bị xám/đen. Mặc định "màn hình tĩnh": nhìn vào phải thấy *bình thường = yên*, *bất thường = nổi lên*.
2. **Màu chỉ cho bất thường**: đỏ = ưu tiên 1 (nghiêm trọng), cam = 2, vàng = 3; **mỗi ưu tiên có HÌNH riêng** (vuông / tam giác lên / tam giác xuống) **+ số + chữ** (không dựa riêng màu — người mù màu, in đen trắng). Xanh lá KHÔNG dùng làm "bình thường".
3. **Chạy / dừng bằng độ đậm**: chạy = đặc xám đậm; dừng = rỗng sáng. Van mở = đặc, đóng = rỗng. (Mockup.)
4. **Dữ liệu cũ / không tin được = tím gạch** (D10, H11) — màu chỉ-dành-cho-chất-lượng-dữ-liệu, không trùng ưu tiên cảnh báo.
5. **Giá trị số trong ô có viền** (numeric box), đơn vị nhỏ, một chữ số thập phân hợp lý theo `displayFormat`. Dải bình thường vẽ bằng thanh mức nhỏ (không dùng đồng hồ kim chiếm chỗ) khi cần xu hướng.
6. **Phân cấp màn L1–L4:** L1 tổng quan nhà máy/khu (chỉ KPI + bất thường) → L2 màn quá trình một khu (mockup) → L3 thiết bị (faceplate) → L4 chẩn đoán (trang `/scada/diag` sẵn có). Điều hướng: đường dẫn "breadcrumb" + bấm ký hiệu mở L3.
7. **Bảng cảnh báo trên cùng** (alarm strip) luôn nhìn thấy; bấm một cảnh báo ⇒ nhảy tới ký hiệu.
8. **Chữ nhỏ nhất 11 px; tương phản ≥ 4,5:1** cho giá trị; kiểm bằng `colour-palette`/công cụ tương phản trước khi chốt token.
9. **Giá trị không rơi vào màu cảnh báo khi dữ liệu cũ** (cũ thắng cảnh báo — không báo "mức cao" bằng một con số cũ).

### 5.2 Danh mục ký hiệu (thư viện SVG, mỗi ký hiệu = một component + test hình dạng)

| Ký hiệu | Mã gợi ý | Trạng thái nhận | Tag vai trò (binding) | Bình thường / bất thường / cũ |
|---|---|---|---|---|
| Motor | `Motor` | chạy · dừng · lỗi · cũ · cục bộ | `run_fb` (bool), `fault` (bool), `speed`/`current` (số, tuỳ chọn), `mode` (LOCAL/REMOTE) | đặc/rỗng · viền đỏ/cam + huy hiệu · tím |
| Băng tải | `BangTai` | chạy · dừng · lỗi · cũ | `speed` (m/s), `run_fb`, `pe` (cảm biến quang, tuỳ chọn) | cuộn theo speed · đứng + "0.00" · đứng + gạch tím |
| Van (đóng/mở) | `Van` | mở · đóng · đang di chuyển · kẹt · cũ | `open_fb`, `closed_fb`, `cmd` (tuỳ chọn) | đặc/rỗng · "đang di chuyển" khi cả hai FB sai · tím |
| Van điều chỉnh | `VanDieuChinh` | % mở | `pos_fb` (0–100) | thanh nhỏ · cảnh báo lệch SP |
| Bơm | `Bom` | chạy · dừng · lỗi · cũ | `run_fb`, `fault` | như Motor |
| Bồn / mức | `Bon` | mức · cao · thấp · cũ | `level` (%, m), ngưỡng LAL/LAH từ cấu hình báo động | thân xám · viền cam khi vượt · tím |
| Đường ống | `Ong` | có dòng · không · không biết | `flow` (tuỳ chọn) — **nếu không có tag lưu lượng thì KHÔNG hoạt ảnh dòng chảy** | tĩnh · — · — |
| Cảm biến rời rạc | `CamBienQuang` | thấy · không · cũ | `di` (bool) | rỗng/đặc · — · tím |
| Ô giá trị (numeric box) | `OSo` | số · cũ · uncertain · bad | bất kỳ tag số | viền thường · tím chấm · xám chấm |
| Chỉ báo cảnh báo | `HuyHieuCanhBao` | P1/P2/P3 | từ dịch vụ cảnh báo | hình + số + chữ |
| Huy hiệu chế độ | `HuyHieuCheDo` | REMOTE · LOCAL | `scadaKenh.cheDo` (đã có) | chữ viền đen (như hiện nay) |
| Ghi chú nguồn | `NhanNguon` | đẩy · hỏi vòng · mô phỏng | `useTagSong().nguon` | §3.4, §7 |

Quy ước đặt tên / vai trò tag (`run_fb`, `fault`, `speed`…) phải **bằng với census tag C-tag đã xếp lịch** — nếu census dùng tên khác, mimic theo census, không tự đặt. **[CHƯA KIỂM]** — scada-master / dieu-phoi cho biết tên vai trò hiện hành; nếu chưa có thì pha 1 chốt bảng vai trò này làm đầu vào của census.

### 5.3 Ràng buộc tag và an toàn
- Ký hiệu **chỉ ĐỌC** tag. Hành động (đổi giá trị, DỪNG) đi MỘT đường duy nhất: mở faceplate → `scadaCommands.request` + hộp xác nhận (đã có, B-T11). Không có "bấm vào van để mở" trên màn quá trình.
- Ký hiệu nhận `adapterId` + `tagKey` nên đi qua cùng kiểm phạm vi như mọi tag; tag bị `denied` hiển thị "không có quyền xem" (không "bình thường", không "cũ").
- **Trạng thái "an toàn giả"**: thiếu tag `fault` ⇒ ký hiệu hiển thị "không có tín hiệu lỗi cấu hình" (huy hiệu xám), KHÔNG mặc định "không lỗi". Thiếu dữ liệu ≠ bình thường.

### 5.4 Định nghĩa màn (dữ liệu, không hard-code) **[ĐỀ XUẤT]**
Màn quá trình là một tài liệu JSON có phiên bản: danh sách ký hiệu (loại, vị trí, `ratio`, binding vai trò → `{adapterId, tagKey}`), đường ống nối, lớp. Pha 1: định nghĩa **nằm trong mã** (một tệp cho màn mẫu) để chốt ký hiệu; pha sau (gắn K12/K14): soạn thảo + lưu theo phạm vi nhà máy, đi qua đường duyệt/kiểm phạm vi sẵn có. Mô hình dữ liệu của trình soạn thảo KHÔNG nằm trong phạm vi duyệt lần này.

---

## 6. Faceplate v2 (mục 3 mở rộng; xem mockup cột phải)

Giữ MỌI hành vi an toàn đã nghiệm thu (R1a/R1b: lý do ≥ 5 ký tự, `DieuKienChoPhep` không poll + không khoá nút, hộp xác nhận, TOTP, DỪNG MÁY luôn hiện, LOCAL ẩn lệnh). Thay đổi chỉ ở **cách hiển thị và nguồn dữ liệu**:

1. Giá trị lớn + đơn vị + **dòng tuổi/chất lượng thường trực**; số tween (T1); cũ ⇒ T3.
2. **Xu hướng 60 s** (spark): đường nối CHỈ giữa các mẫu tươi; khoảng không có mẫu = vùng tím gạch KHÔNG nối. Dùng bộ đệm lịch sử ngắn đã có phía server (`SO_LICH_SU_TOI_DA = 50`, `boDemHienTai.ts:70`) làm nguồn lúc mở; sau đó cộng dồn từ luồng đẩy. **[CHƯA KIỂM]** độ dày thời gian của 50 mẫu với poll 5 s = 250 s; với poll 100 ms chỉ ~5 s ⇒ cần xác nhận hoặc client tự cộng dồn từ lúc mở.
3. Vùng nhập + `DieuKienChoPhep` + lý do — GIỮ NGUYÊN; mockup chỉ đổi kiểu dáng.
4. **DỪNG MÁY** + ba trạng thái T6; nút KHÔNG bị khoá khi cũ.
5. Huy hiệu REMOTE/LOCAL giữ nguyên chữ viền đen.
6. Thay `useQuery(refetchInterval 2000/5000)` bằng `useTagSong` + chế độ hỏi vòng dự phòng (§3.4). `cheDo.danhSach` (5 s) giữ nguyên ở pha 1 (ít đổi; không nằm trong mục tiêu độ trễ) — ghi trong rủi ro.

---

## 7. Chế độ MÔ PHỎNG cho demo / đào tạo (mục 5 của đề bài; Pha 2)

**Mục tiêu:** twin / màn quá trình chạy theo bộ mô phỏng nhà máy ở nhịp cao để trình diễn và đào tạo, **không bao giờ lẫn với trạng thái thật**.

Quy tắc cứng:
1. **Nguồn tách bạch ở TẦNG DỮ LIỆU, không phải tầng hiển thị:** đăng ký `nguon: "mo_phong"` chỉ nhận dữ liệu từ adapter mô phỏng (cờ `simulated` đã có — nhật ký đã gắn "sim" theo cờ này, B-T8). Một đăng ký KHÔNG bao giờ trộn tag thật và tag mô phỏng; mix ⇒ `BAD_REQUEST`.
2. **Nhãn không thể bỏ sót:** viền xanh ngọc 4 px quanh màn, banner "MÔ PHỎNG — dữ liệu KHÔNG phải thiết bị thật", watermark chéo, pill "MÔ PHỎNG" thay "Đẩy trực tiếp", tiêu đề tab có tiền tố `[MÔ PHỎNG]`. Mockup trạng thái 4.
3. **Chỉ đọc:** mọi nút lệnh (Đổi, DỪNG) khoá; `scadaCommands.request` từ màn mô phỏng bị từ chối ở server (không chỉ ở UI).
4. **Không ghi vào dữ liệu sản xuất:** không đi vào bảng lịch sử/KPI/OEE/nhật ký lệnh thật; nếu bộ mô phỏng sinh sự kiện, sự kiện mang cờ `simulated` và các báo cáo mặc định loại trừ.
5. **Nhịp cao** (vd. 100 ms) CHỈ áp cho đăng ký mô phỏng; đăng ký thật vẫn theo `capMs` đã kẹp.
6. **Bật/tắt:** cờ riêng `SCADA_MO_PHONG_UI_ENABLED` (mặc định TẮT), quyền riêng (`machine_control` không đủ — cần quyền xem mô phỏng), ghi sổ kiểm toán khi bật.
7. Mô phỏng không dùng để "chứng minh" an toàn của logic điều khiển thật (chỉ trình diễn / đào tạo) — ghi ở chân trang.

Phụ thuộc: bộ mô phỏng nhà máy hiện có (và tham khảo Open Industry Project — mục memory đã ghi 2026-11-02) cung cấp adapter `simulated`. Chi tiết tích hợp là việc pha 2.

---

## 8. Tay nghề 3D twin (mục 4 của đề bài; Pha 3)

Không lập backlog thứ hai: **kế thừa K13 + §5 của spec 2026-10-23 (H2, H3, H5, H8)** và thêm các mục dưới đây. Mọi việc 3D phải mở đầu bằng đo F-2 (§2) và Performance trace GPU cho các góc xấu — **không đoán**.

| # | Việc | Ghi chú / bằng chứng |
|---|---|---|
| 3D-1 | **Đo lại** `/twin`: khung p95/p99, overdraw ở các góc 18–27 fps | H8; `byteMau` đã vá (H8 ở §1) ⇒ kỳ vọng nút thắt dịch chuyển sang GPU/overdraw. **Nếu đo cho thấy `byteMau` hết đỏ thì đóng mục "gỡ byteMau" của đề bài.** |
| 3D-2 | Chuẩn asset chung: ngân sách tam giác theo lớp (đối tượng nhỏ ≤ 2 k, máy ≤ 15 k, cả line ≤ 300 k vẽ cùng lúc), 2 LOD, vật liệu PBR (baseColor/ORM/normal tối đa 1024² cho thiết bị, 2048² cho nền) | Mô hình hiện **lẫn**: khối sinh ra + CAD nhập, không chuẩn ảnh chung. Cần kiểm kê trước (số mô hình, tam giác, vật liệu) — **[CHƯA KIỂM]** |
| 3D-3 | **Instancing** cho vật lặp (băng tải con lăn, thùng, pallet) | Giảm lệnh vẽ; kết hợp H5 (meshopt + KTX2) |
| 3D-4 | Ánh sáng môi trường: HDR cục bộ (không CDN), tone mapping ACES/AgX, bóng chỉ cho 1–2 nguồn, tắt bóng mềm trên thiết bị yếu | Đồng bộ H2 (`dpr ≤ 1,5`, tắt bóng) |
| 3D-5 | **Chỉ render liên tục khi có chuyển động** | `frameloop="demand"` đã dùng ở twin; mở rộng đúng nơi còn thiếu (H2) và `invalidate()` từ luồng đẩy chỉ khi dữ liệu thật sự đổi hiển thị; hoạt ảnh trung thực T1–T10 áp cho cả 3D |
| 3D-6 | Nhãn: sửa `layVungCam` (H3) rồi mới thêm nhãn mới | Tránh thêm chi phí lên chỗ đã nghẽn |
| 3D-7 | Huy hiệu "trực tiếp" khai TUỔI con số thay vì đường nối | Đợt 21 B-3 (H7) |
| 3D-8 | Harness đo hiệu năng trong CI (H7 của spec cũ) có đột biến | Làm cho F-1/F-2 không phụ thuộc cảm giác |

Phụ trách: **phiên twin** (chủ sở hữu mã 3D). scada-ui chỉ cung cấp `useTagSong` + quy tắc T1–T10 + token màu.

---

## 9. Phân pha

| Pha | Nội dung | Điều kiện vào | Kết quả nghiệm thu |
|---|---|---|---|
| **0 (đo)** | Đo mốc L-A/L-B/L-C, F-1 (trên màn hiện có), O-1, F-2 theo §2 | Chủ dự án duyệt đặc tả; ngoài cửa sổ GPU | Một tệp số liệu có p50/p95/p99, kịch bản cố định |
| **1a (hợp đồng)** | Chốt §3.6 với scada-master: `staleAfterMs`, `scada:tick`, `capMs`, `seq`; quyết định bật `SCADA_SOCKET_ENABLED` ở bản chạy | Pha 0 xong (có số đo ngân sách byte) | Hợp đồng có test đột biến (bỏ tick ⇒ đỏ) |
| **1b (client lõi)** | `scadaLive.ts` + `useTagSong` + pill nguồn + dự phòng hỏi vòng; thay Faceplate | 1a trên main | DOM test + đo lại L-A; S-1 = 0 |
| **1c (hoạt ảnh)** | Bộ làm mượt T1, đồng hồ cũ T3, băng tải T4, `reduced-motion` | 1b | Test mô phỏng thời gian (đột biến "ngoại suy" phải đỏ) |
| **1d (mimic + ký hiệu)** | 6 ký hiệu đầu (Motor, BangTai, Van, Bon, OSo, HuyHieuCanhBao) + một màn L2 mẫu + faceplate v2 | 1c; bảng vai trò tag chốt | Chụp ảnh bốn trạng thái như mockup; F-1 đạt |
| **2** | Chế độ mô phỏng §7 | 1d; quyết định chủ dự án về cờ + quyền | Nhãn không bỏ sót (đột biến "bỏ nhãn" đỏ); server từ chối lệnh từ nguồn mô phỏng |
| **3** | 3D theo §8 | Pha 0 F-2 đỏ thật; phiên twin nhận việc | F-2 đạt, hai con số cùng kịch bản |

Ước lượng thô **[CHƯA KIỂM, ±50 %]**: 0 = 1 ngày; 1a = 1 (hợp đồng + test) + phần server của scada-master; 1b = 3; 1c = 2; 1d = 5; 2 = 4; 3 = theo spec K13 (≥ 10). Số này để xếp thứ tự, không phải cam kết.

---

## 10. Rủi ro an toàn và cách chặn

| Rủi ro | Nguyên nhân | Chặn |
|---|---|---|
| Người vận hành tin số CŨ là số hiện tại | Kênh chỉ đẩy khi đổi (H3); số hiển thị giữ nguyên | §3.3-A tick + `staleAfterMs`; T3; đột biến S-1 = 0 |
| Hoạt ảnh "đang chạy" khi thiết bị đã dừng | Ngoại suy / băng tải cuộn theo lệnh thay vì theo đo | T2, T4: chỉ theo `speed` đo; `run_fb` cũ ⇒ đóng băng + tím |
| "Đã dừng" hiện trước khi thiết bị xác nhận | Hiển thị theo lệnh đã gửi | T6: ba trạng thái; chỉ đọc-lại mới đổi |
| Nhầm mô phỏng với thật | Màn giống nhau | §7: tách ở tầng dữ liệu + nhãn nhiều lớp + server từ chối lệnh; cờ TẮT mặc định |
| Rò dữ liệu ngoài phạm vi nhà máy | Kênh mới / phòng mới | Không `socket.join`; `socket.emit` tới đúng socket; kiểm từng tag; `denied` ≡ không tồn tại (H12); census giữ nguyên |
| Bão khung / tick làm nghẽn | 150 tag × 10 khung/s × nhiều người | Kẹp `capMs`; delta chỉ tag đổi; ngân sách byte đo ở pha 0 trước khi chốt mặc định; vòng đẩy dừng khi hết đăng ký |
| Ký hiệu "an toàn giả" (thiếu tag lỗi ⇒ hiện bình thường) | Mặc định "không lỗi" | §5.3: thiếu tín hiệu ⇒ huy hiệu xám "chưa cấu hình tín hiệu lỗi" |
| Đẹp hơn nhưng khó đọc ban đêm / mù màu | Chỉ dựa màu | §5.1-2: hình + số + chữ; kiểm tương phản; chế độ tối ở token (đề xuất, chưa vẽ) |
| Hoạt ảnh gây tốn CPU trên màn điều khiển | `setState` mỗi khung | T9: ghi thẳng thuộc tính, một rAF, dừng khi ẩn |
| Chỉnh `capMs` thấp làm server quá tải | Nhiều người xin 50 ms | Máy chủ kẹp theo tải; trần số đăng ký "nóng"/người; mặc định 250 trừ màn xin 100 |
| Mất `tick` bị đọc là "lỗi mạng" thay vì lỗi nguồn | Hai nguyên nhân khác nhau | Tick mang `trangThai` từng adapter ⇒ phân biệt "đường nối socket chết" với "adapter mất kết nối thiết bị" |
| Sửa mã an toàn | Faceplate v2 chạm gần lệnh | KHÔNG đụng `commandDispatcher`, OT driver, `lenhHmi`, `troLaiKenh`, `rateLimitConfig`, `context`, `trpc`; chỉ đổi lớp hiển thị + nguồn dữ liệu đọc |

---

## 11. Ai làm gì

| Việc | scada-ui (client) | scada-master (server) | twin | dieu-phoi | chủ dự án |
|---|---|---|---|---|---|
| Đặc tả + mockup | **Tác giả** | rà §3 | rà §8 | duyệt | duyệt hướng |
| Đo mốc (pha 0) | kịch bản Playwright + đo khung | cung cấp nguồn có dấu thời gian, ngân sách byte | đo F-2 | xếp cửa sổ ngoài GPU | — |
| Hợp đồng §3.6 | **Viết** | **Chốt + làm** (`staleAfterMs`, tick, `capMs`, `seq`) | — | merge | quyết định bật `SCADA_SOCKET_ENABLED` |
| `scadaLive` + hook + faceplate v2 | **Làm** | — | — | merge | — |
| Hoạt ảnh T1–T10 + ký hiệu + màn L2 | **Làm** | — | cho 3D dùng lại hook | merge | duyệt hình |
| Bảng vai trò tag ≡ census C-tag | đề xuất | **Chốt** | — | — | — |
| Mô phỏng (§7) | UI + nhãn | adapter `simulated`, từ chối lệnh, quyền | cảnh 3D | — | duyệt cờ + quyền |
| 3D (§8) | token màu, hook | — | **Làm** | merge | duyệt hình |
| Kiểm định độc lập | — | — | — | **kiem-dinh** (mọi pha có đột biến) | — |

---

## 12. Câu hỏi chờ quyết định

1. **Bật `SCADA_SOCKET_ENABLED` ở bản chạy** khi nào (phụ thuộc hợp đồng 1a)? Đây là việc của chủ dự án / dieu-phoi, scada-ui không đụng `.env`.
2. **Mục tiêu < 300 ms** hiểu theo tầng nguồn (§2) có chấp nhận không? Nếu muốn mọi tag đều < 300 ms thì phải đổi chu kỳ quét mặc định 5 s của adapter (việc server, ảnh hưởng tải thiết bị thật) — scada-ui không đề xuất làm.
3. **Có muốn màn L1 (tổng quan) ở pha 1** hay chỉ L2 + faceplate? Đặc tả chỉ cam kết L2 + L3.
4. **Chế độ tối** cho phòng điều khiển ban đêm: đưa vào pha 1d hay để sau? (ISA-101 thường có cả nền sáng và tối.)
5. **Bảng vai trò tag** (§5.2) — dùng tên nào, đã có census chưa?
6. **Quyền xem mô phỏng** (§7): vai trò nào?

---

## 13. Đã làm / chưa làm trong phiên này

- Đã làm: đọc mã (`scadaSocket.ts`, `socketPhatTheoNhaMay.ts`, `Faceplate.tsx`, `boDemHienTai.ts` các dòng cần, `chatLuongHienThi.ts`, `byteMau.ts` phần docblock, `TwinVanHanh.tsx` đoạn Đợt 21 B-3, spec K12–K14 §2/§5); dựng mockup HTML tĩnh và kiểm bằng trình duyệt tự động trên một cổng tạm (đã tắt), chụp 3 ảnh.
- **Chưa làm / chưa kiểm:** không chạy bất kỳ phép đo hiệu năng nào (mọi "mốc hiện tại" ghi CHƯA ĐO); không kiểm tính đúng của `scadaSocket.ts` vượt quá đọc mã; không xác minh bản chạy :3000; mockup dùng số giả lập 1 mẫu/giây, **không phải số đo**; màu/độ tương phản chưa kiểm bằng công cụ.
