# SCADA giao diện đẹp, mượt, chỉn chu — đặc tả thiết kế (bản để duyệt)

- **Ngày:** 2026-11-02 · **Tác giả:** phiên `scada-ui` · **Người duyệt:** dieu-phoi → chủ dự án
- **Trạng thái:** v3 (chủ dự án DUYỆT v2 ngày 2026-11-02; quyết định ở §12A). v2 (thêm §7B động học máy + §7C thư viện khuôn, Pha 2). ĐẶC TẢ + MOCKUP. CHƯA có mã sản phẩm. Không chạm `.env` / :3000 / :8091 / GPU; không chạy DB; không đo trên máy chạy.
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

### 3.8 Phán quyết của scada-master cho hợp đồng 1a (2026-11-03, nhánh `feat/scada-1a`) **[ĐÃ CHỐT, chờ lên main]**
Client CHƯA viết mã theo các trường này cho tới khi 1a lên main.
- **A1** `staleAfterMs` lấy từ MỘT nguồn: `nguongCuCuaAdapter` (logic `nguongCuMs` đã xuất). Poll 5 s ⇒ 15 000; có deadband ⇒ 70 000.
- **A2** Ngưỡng đổi giữa phiên đăng ký: delta kế (hoặc tick nếu chưa có delta) mang thêm trường tuỳ chọn `staleAfterMs` CHỈ chứa các khoá đã đổi; client gộp vào bản đồ của mình, KHÔNG đăng ký lại.
- **A3/B1** Vẫn MỘT `setInterval`. Nhịp mỗi socket = min `capMs` của các đăng ký còn sống (≥ 50). Tick 1000 ms cho mỗi đăng ký còn sống. `seq` chung một dãy cho snapshot/delta/tick theo (socket, subId); đăng ký lại ⇒ `seq` về 0.
- **B2** `TOO_MANY_HOT` là mã lỗi mới. Hot (`capMs` < 250) ≤ 2 mỗi socket và ≤ 3 mỗi người dùng, đếm THEO TIẾN TRÌNH. Hằng số ở `GIOI_HAN`.
- **B3** `ganGiam`: KHÔNG có trong 1a.
- `nguon` ≠ "that" ⇒ BAD_REQUEST; `capMs` ngoài tập {50,100,250,1000} ⇒ BAD_REQUEST.
- **F5**: từ khi F5 lên main, máy chủ ngắt socket khi quyền/phạm vi/phiên đổi (lý do "io server disconnect"). `client/src/lib/socketNoiLai.ts` đã nối lại có lùi. `useScadaLive` PHẢI đăng ký lại sau nối lại và hiện mọi tag là cũ cho tới khi snapshot mới về (đúng §3.3 C).
- **Q5** phòng `robot:{id}` ĐÃ qua cổng phạm vi (PASS, `socket-robot-pham-vi.md`) ⇒ phản chiếu robot (2A) không bị chặn ở điểm này; 1a siết thêm census phòng→cổng.
- **Q6** thẻ vai trò tag (C-tag): task riêng sau 1a. Q1/Q3/Q4 (deadband trước `dangKyThayDoi`, chi phí đo của tick, bộ nhận ngoài): trả lời trong `task-1a-report.md`, scada-master sẽ gửi số khi xong.

#### 3.8.1 Hợp đồng CUỐI (`server/services/scada/scadaSocket.ts:61-124`, kiem-dinh ĐẠT ở d5e5270d9 trên `feat/scada-1a`; chờ dieu-phoi gộp main)
```ts
export const CAP_MS_HOP_LE = [50, 100, 250, 1000] as const;
export type CapMs = (typeof CAP_MS_HOP_LE)[number];
export type MaLoiScada = "BAD_REQUEST" | "TOO_MANY_TAGS" | "TOO_MANY_SUBS" | "TOO_MANY_HOT" | "DISABLED" | "BUSY";
export type GiaTriGoi = [adapterId, tagKey, v, q, ts, ageMs, stale, reason];   // KHÔNG đổi
export type KhoaTagScada = `${number}:${string}`;
export type TagScada = { adapterId: number; tagKey: string };
export type ScadaSubscribe = { subId?: string; tags: TagScada[]; capMs?: CapMs /* vắng => 250 */; nguon?: "that" };
export type ScadaSnapshot = { subId: string; seq: number /* 0 */; serverTs: number; values: GiaTriGoi[];
                              staleAfterMs: Record<KhoaTagScada, number>; denied: TagScada[] };
export type ScadaDelta    = { subId: string; seq: number; serverTs: number; values: GiaTriGoi[];
                              staleAfterMs?: Record<KhoaTagScada, number> /* chỉ khoá ĐÃ ĐỔI — gộp vào bản đồ */ };
export type ScadaTickAdapter = { adapterId: number; trangThai: TrangThaiKetNoi | null; tuoiMauMoiNhatMs: number | null };
export type ScadaTick     = { subId: string; seq: number; serverTs: number; adapters: ScadaTickAdapter[];
                              staleAfterMs?: Record<KhoaTagScada, number> };
```
- `TrangThaiKetNoi = "connecting" | "connected" | "lost" | "disabled"`. ⚠ `trangThai` có thể `null` = "không rõ" (trung tâm không có phiên cho adapter đó — do edge sở hữu / chưa từng báo): KHÔNG hiện như đã kết nối; dùng `tuoiMauMoiNhatMs` để biết tuổi.
- `seq`: một dãy cho mỗi (socket, subId), chung snapshot/delta/tick; snapshot = 0; đăng ký lại cùng subId ⇒ snapshot mới, `seq` 0. Ngưỡng cũ = `max(3·poll, deadband ? 70 000 : 0)` (poll 5 s ⇒ 15 000).
- Lỗi `scada:error {code}`: `capMs` ngoài tập, `nguon` ≠ "that" ⇒ BAD_REQUEST; nóng (`capMs` < 250) > 2/socket hoặc > 3/người dùng (theo tiến trình) ⇒ TOO_MANY_HOT. Không đổi: 500 tag/đăng ký, 10 đăng ký/socket, BUSY. Socket máy: snapshot `denied` = tất cả, không tick.
- `GIOI_HAN`: tagMoiDangKy 500, dangKyMoiSocket 10, chuKyDeltaMs 250, buocVongMs 50, capMsToiThieu 50, tickMs 1000, nguongNongMs 250, nongMoiSocket 2, nongMoiNguoi 3.
- Từ F5: socket bị máy chủ ngắt ("io server disconnect") ⇒ MỌI đăng ký SCADA của nó bị giải phóng; client đăng ký lại sau nối lại và hiện cũ cho tới khi có snapshot.
- Chi phí đo (scripts/scada-1a-bench.ts): tick ≈ 1,1–1,9 µs và ~350 B mỗi đăng ký mỗi giây (5 adapter); 600 đăng ký cùng tick: 1,1 ms; 1000: 1,3 ms. ĐẮT là bùng nổ delta (600 đăng ký × 150 tag đổi cùng lúc ≈ 40 ms trong một bước 50 ms) — đầu vào cho B3; trần nóng 2/3 là tạm cho tới pha 0.
- Q1 (ngân sách byte): deadband chỉ áp trước `dangKyThayDoi` khi `OT_TAG_DEADBAND_ENABLED` BẬT — mặc định TẮT ⇒ mỗi chu kỳ poll đánh dấu mọi tag đã poll là đổi ⇒ một delta mỗi chu kỳ chứa mọi tag, ≈ 1,8 KB/s mỗi đăng ký 150 tag ở poll 5 s, KHÔNG phụ thuộc `capMs`. ⇒ cập nhật SLO O-1/O-2 theo số này ở pha 0. Q4: không có nơi nhận nào khác của `scada:snapshot/delta` (chỉ test) ⇒ thêm trường không phá ai.

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

## 7B. Mô hình động học máy — máy 2/3 trục, máy + băng tải, robot (bổ sung v2, Pha 2)

**Câu hỏi của chủ dự án:** máy 2 trục / 3 trục, máy + băng tải, robot có hiển thị / mô phỏng ĐÚNG chuyển động thật không? **Hiện trạng (dieu-phoi đo, tôi đối chiếu một phần mã): chưa.** Twin chỉ tô màu trạng thái, mô hình đứng yên (animation duy nhất: mũi tên dòng chảy, `DongChayLine.tsx`); khớp robot ở `RobotCockpit` là thanh 2D nhận `robot:telemetry` (`RobotCockpit.tsx:482-502`; server phát `socket.ts:2390` vào phòng `robot:{id}`), tab 3D là glTF đứng yên. FK/IK/va chạm/Rapier có ở SERVER (`server/services/programming/sim/{kinematicModel,ik,collision,rapierPhysics}.ts`; `kinematicModel.ts` có sẵn `rotAxis`, `translateAxis`, `dhTransform`, kiểu khớp `revolute | prismatic | fixed`). Chưa có mô tả trục gắn tag vị trí; chưa có mô phỏng vật trên băng tải theo cảm biến.

### 7B.1 Khuôn máy khai báo bằng DỮ LIỆU **[ĐỀ XUẤT]**
Một tài liệu có phiên bản `KhuonDongHoc` (Zod, cùng phong cách `pouModel`), KHÔNG hard-code theo từng máy:
```ts
type Truc = {
  id: string;                         // "X", "Y", "Z", "J1"…
  loai: "tinh_tien" | "quay";         // prismatic | revolute (khớp kiểu `JointType` đã có)
  cha: string | null;                 // cây cha–con (Z gắn trên Y gắn trên X…)
  truc: [number, number, number];     // hướng trục trong hệ cha
  gocToaDo: { vitri: [number,number,number]; xoay: [number,number,number] };  // pivot
  gioiHan: { min: number; max: number; donVi: "mm" | "deg" | "rad" };
  boPhan3D: string[];                 // tên node glTF chuyển động theo trục này
  tag: { feedback: TagRef; setpoint?: TagRef };   // 7B.2
  heSo?: { tySo: number; lech: number };           // đơn vị thô → kỹ thuật, khai tường minh
  tanSoToiThieuHz?: number;           // nhịp cần có để gương được coi là mượt (7B.3)
};
type KhuonDongHoc = { phienBan: number; loai: "gian_2_truc" | "xyz_3_truc" | "bang_tai" | "robot_6_truc" | "tuy_chinh";
                      truc: Truc[]; bangTai?: { tocDoTag: TagRef; chieuDai: number; camBien?: { tag: TagRef; viTri: number }[] };
                      robot?: { dh?: DhRow[]; urdf?: string } };   // dùng lại chuỗi `kinematicModel` phía server
```
Khuôn mẫu pha 2: **giàn 2 trục (XY)**, **XYZ 3 trục**, **băng tải** (tốc độ + cảm biến), **robot 6 trục** (DH / URDF). **Không viết FK thứ hai** cho robot: dùng lại `kinematicModel` (cách dùng: 7B.7). Chuỗi động học robot hiện là "sample" ⇒ **pilot phải thay bằng mô hình URDF của đúng robot**; chưa dùng được để hiển thị thật.

### 7B.2 Gắn trục vào tag VỊ TRÍ THỰC, không phải setpoint
- Chế độ gương CHỈ đọc `tag.feedback` (encoder / vị trí thực). `setpoint` chỉ để vẽ "bóng mục tiêu" mờ (tuỳ chọn), **không bao giờ** điều khiển hình chính. Trục thiếu `feedback` ⇒ không vào chế độ gương ("không có tín hiệu vị trí thực"), KHÔNG rơi về setpoint (cùng nguyên tắc §5.3: thiếu dữ liệu ≠ bình thường).
- Kiểm hợp lý lúc nạp khuôn: đơn vị, hệ số; giá trị ngoài `[min,max]` ⇒ kẹp hình + cờ "ngoài dải" (không vẽ máy xuyên khung).
- Tag qua cùng kiểm phạm vi nhà máy; trục `denied` ⇒ đứng + "không có quyền".

### 7B.3 Tốc độ dữ liệu — trục cần 20–50 Hz, không thể 2 s
| Nguồn | Hiện có | Cần cho gương |
|---|---|---|
| Robot | `robot:telemetry` đã đẩy (tần số **[CHƯA ĐO]**); phòng `robot:{id}` — **[CHƯA KIỂM]** đã qua cổng phạm vi chưa (census socket) | Dùng lại; thêm `ts` thiết bị + `seq` nếu chưa có; đo nhịp thật ở pha 0 |
| Trục máy (PLC/servo) | adapter poll mặc định 5 s (`POLL_MAC_DINH_MS`) | Tầng "nóng" 20–50 Hz **chỉ cho trục đang xem**, qua edge / đăng ký OPC UA / Modbus nhanh; `capMs = 50` (§3.3-B) |
| Băng tải | tốc độ + cảm biến từ tag thường | cảm biến cạnh: sự kiện có `ts` thiết bị; tốc độ ≤ 10 Hz đủ |

- Chỉ trục đang hiển thị lên tầng nóng: mở khung ⇒ đăng ký, đóng ⇒ huỷ (đếm tham chiếu §3.7). Trục không xem giữ nhịp thường.
- **Băng thông [CHƯA KIỂM, ước tính]:** ~50 byte/mẫu. 6 trục × 50 Hz ≈ 15 KB/s/người xem; XYZ 3 trục ≈ 7,5 KB/s. Giảm: khung delta dùng **chỉ số tag thay vì chuỗi** (đề xuất cho 1a), **deadband theo trục** (vd. 0,05 mm / 0,05°) để trục đứng không phát; trục đứng vẫn có `tick` (§3.3-A) nên "không đổi" ≠ "mất dữ liệu".
- Trần số trục "nóng" mỗi người (vd. 12) và mỗi nhà máy; vượt ⇒ mã lỗi tường minh (không cắt im lặng).
- **Chạm đúng phát hiện (3) §0:** nguồn mặc định 5 s không thể gương. Tầng nóng cần cấu hình nguồn (việc server / edge), không sửa được bằng UI.

### 7B.4 Mô hình 3D và công cụ "rig"
- CAD nhập phải **giữ cây bộ phận + pivot** (đường `occtWorker`); nếu đang gộp thành một lưới thì pha 2A mở đầu bằng **kiểm kê** (bao nhiêu mô hình giữ được cây node) — **[CHƯA KIỂM]**.
- Công cụ **rig** trong TwinStudio: chọn node → gán `Truc.boPhan3D`, đặt pivot/trục bằng gizmo, kéo thử trượt trong giới hạn (xem trước cục bộ, KHÔNG ghi tag), lưu `KhuonDongHoc` có phiên bản qua đường duyệt/kiểm phạm vi sẵn có. Cảnh báo khi node gán hai trục hoặc cha–con sai thứ tự.
- Chuẩn asset §8 (3D-2) áp dụng: chuyển động chỉ đổi ma trận node, **không đổi hình học theo khung** (giữ instancing và `frameloop="demand"`).

### 7B.5 Hai chế độ TÁCH BẠCH
| | (a) GƯƠNG | (b) MÔ PHỎNG |
|---|---|---|
| Nguồn | tag `feedback` thật (đẩy 20–50 Hz) | simulator / PLC ảo; Rapier cho vật và băng tải |
| Nhãn | pill "GƯƠNG · tuổi N ms" | viền + banner xanh ngọc "MÔ PHỎNG" (§7) |
| Dữ liệu cũ | trục đứng + **tím gạch**, số "~", tuổi (T3) | không áp dụng (nguồn nội bộ) |
| Lệnh | không; lệnh đi faceplate như cũ | khoá |
| Vật trên băng | **không vẽ** ngoài cảm biến thật (T4) | do Rapier sinh, nhãn "ước tính" |
| Trộn | **cấm** — một khung nhìn một chế độ; đổi chế độ ⇒ đổi nguồn ở tầng dữ liệu (§7-1) | |

- **Gương luôn kèm SỐ CHÍNH XÁC bên cạnh** hình (bảng: trục · vị trí thật · đơn vị · tuổi mẫu · chất lượng). Hình là minh hoạ, số mới là sự thật.
- Làm mượt (T1) chỉ nội suy VỀ phía mẫu đã nhận, kẹp ≤ 1 chu kỳ mẫu; không ngoại suy đà (T2). Cũ ⇒ đóng băng.
- Băng tải gương: cuộn theo tốc độ đo; vật chỉ xuất hiện tại cảm biến thật, dịch theo tốc độ đo, biến mất khi mẫu tốc độ cũ.

### 7B.6 Giới hạn độ chính xác và an toàn (phải hiển thị / phát biểu rõ)
1. Độ chính xác hình bị chặn bởi tần số mẫu + độ trễ (L-A/L-B). Không tuyên bố chính xác hơn mẫu; màn ghi "tần số mẫu thực N Hz, tuổi N ms" (đo thật, không số danh định).
2. Hình có thể **trễ** so với máy; không bao giờ **đi trước** (T2). Có thể bỏ khung hiển thị, **không bỏ mẫu** trong bảng số.
3. Va chạm / khoảng cách trong mô phỏng chỉ để **tư vấn**. **An toàn thuộc PLC / safety PLC; twin không bao giờ là hệ an toàn** (chân trang cố định trên mọi khung gương và mô phỏng).
4. Khuôn sai (hệ số, pivot, đơn vị) ⇒ hình sai mà trông tin cậy: khuôn mới phải qua **hiệu chuẩn** — đặt trục về hai vị trí đã biết, so hình ↔ số đo; hiện "khuôn chưa hiệu chuẩn" tới khi xong.
5. Khuôn / rig KHÔNG ghi tag, KHÔNG đụng `commandDispatcher` / OT driver / `lenhHmi`.

### 7B.7 Quyết định kiến trúc còn mở (scada-master + twin)
- **FK ở đâu:** (i) client dùng chung mã thuần TS tách từ `kinematicModel` (không RTT; cần test khớp client ≡ server trên bộ tư thế cố định); (ii) server tính pose rồi đẩy (thêm tải + trễ). **Đề xuất (i)** cho giàn/XYZ/băng tải/robot. **[CHƯA KIỂM — tuỳ khả năng tách mã.]**
- **Rapier:** mô phỏng (b) chạy server (`rapierPhysics.ts` có sẵn) rồi đẩy pose: một nguồn sự thật, dễ gắn nhãn — đề xuất server.

### 7B.8 Pilot đề xuất
**(1)** một máy 3 trục XYZ (adapter mô phỏng, 50 Hz) · **(2)** một băng tải có cảm biến PE (adapter mô phỏng) · **(3)** robot UR (URSim có sẵn; thay chuỗi "sample" bằng URDF UR thật). Mỗi cái: gương + một ca mô phỏng. Tiêu chí (đo, không cảm giác): hình↔số đo khớp ở tư thế tĩnh trong độ phân giải mẫu; đột biến "ngoại suy" và "rơi về setpoint" đỏ; cũ ⇒ đóng băng (S-1 = 0); độ trễ thiết bị→hình p95 ≤ 150 ms ở trục nóng (**mục tiêu đề xuất**, chốt sau pha 0); khung p95 theo F-1/F-2.

**Mockup:** khung "Máy 3 trục XYZ — chế độ GƯƠNG" trong `mockup.html` (ảnh `anh-4-pha2-guong-thu-vien-canh.png`): hình trục theo mẫu giả lập 25 Hz, bảng số kèm tuổi; nút trạng thái "cũ" ⇒ đóng băng + tím gạch.

---

## 7C. Thư viện khuôn thiết bị — ghép robot nhện, robot 6 trục các hãng, băng tải (bổ sung v2, Pha 2)

Mục đích: **một thư viện nhỏ các HỌ động học, mỗi họ một bộ giải; thiết bị cụ thể = họ + tham số + mô hình 3D + vai trò tag; ghép vào cảnh bằng CỔNG NỐI.** Thêm hãng / biến thể = thêm dữ liệu, không thêm mã. `KhuonDongHoc` của §7B.1 trở thành *một dạng* của "khuôn" dưới đây (họ giàn / nối tiếp).

### 7C.1 Lớp 1 — HỌ ĐỘNG HỌC (tập nhỏ, mỗi họ một bộ giải)

| Họ | Phủ | Bộ giải (nguồn) | Trạng thái |
|---|---|---|---|
| `noi_tiep` | robot 6 trục các hãng, SCARA, cobot | FK từ URDF/DH: `twin/pipeline/urdfParser.ts` + `urdfToKinematicChain.ts` + `programming/sim/kinematicModel.ts` (**[MÃ]** các tệp có thật). Hãng khác = URDF/tham số khác, **cùng mã** | Có; chuỗi hiện là "sample" ⇒ cần URDF thật cho pilot |
| `delta_song_song` | robot nhện (delta parallel) | FK/IK dạng đóng, 3 tay + trục quay tuỳ chọn (tham số: bán kính đế/bàn kẹp, chiều dài tay trên/dưới, góc motor) | **CHƯA có** — việc mới. ⚠ `server/services/robot/drivers/deltaRobotDriver.ts` là driver **hãng Delta**, KHÔNG phải robot nhện — không dùng lẫn tên |
| `gian_cartesian` | giàn 2/3 trục | chuỗi trục tịnh tiến (§7B.1) | Chưa có mô tả; FK tầm thường |
| `bang_tai_duong` | băng tải thẳng / cong / nghiêng / nhập / rẽ; belt hoặc con lăn | **đường tâm** = chuỗi đoạn {thẳng, cung(R, góc), nghiêng(Δz)}, tham số hoá theo độ dài cung `s`; nhập/rẽ = nút nối đường tâm; con lăn: bước con lăn, vùng tích luỹ | Chưa có (việc mới) |
| họ nhỏ | bàn xoay, bàn chuyển, thang nâng | một trục quay / tịnh tiến + hành trình rời rạc | Chưa có; sau pilot |

Quy tắc: một họ chỉ khai **ba thứ** — (1) tham số có kiểu + giới hạn, (2) hàm `pose(giaTriTrục) → ma trận node`, (3) danh sách **vai trò tag** bắt buộc/tuỳ chọn. Mọi thứ khác (hình, cổng nối, gương, mô phỏng) dùng chung.

### 7C.2 Lớp 2 — KHUÔN = họ + tham số + mô hình 3D + VAI TRÒ TAG **[ĐỀ XUẤT]**
```ts
type Khuon = {
  id: string; phienBan: number; ho: "noi_tiep"|"delta_song_song"|"gian_cartesian"|"bang_tai_duong"|"khac";
  thamSo: Record<string, number | string>;             // dài, rộng, bán kính cung, góc, độ nghiêng; hoặc URDF/DH
  mo_hinh3D: { loai: "glb_tinh" | "urdf_mesh" | "sinh_tham_so"; nguon?: string };   // băng tải: SINH, không cần CAD từng biến thể
  vaiTro: Record<string, { bat_buoc: boolean; kieu: "so"|"bool"|"su_kien"; donVi?: string; mang?: boolean }>;
  // ví dụ nối tiếp: q1..q6 (số, thực), mode; băng tải: toc_do (số, thực), chay (bool), cam_bien[] (bool/sự kiện, mang theo vị trí s)
  cong: Cong[];                                         // 7C.3
  hieuChuan: { daHieuChuan: boolean; nguoi?: string; ngay?: string };   // 7B.6-4
};
```
- **Băng tải sinh tham số** (như Factory IO): dài, rộng, bán kính cong, góc cong, độ nghiêng, kiểu belt/con lăn, bước con lăn ⇒ hình + đường tâm + cổng nối sinh từ tham số; **không có CAD cho từng biến thể**. Đây là thứ phân biệt "đẹp, đồng nhất, đổi tham số là xong" với "mô hình lẫn lộn" (đề bài mục 4).
- **Robot các hãng:** URDF hãng + mesh từng khâu giữ cây node (7B.4). Khác hãng = khác URDF, cùng bộ giải `noi_tiep`.
- **Vai trò tag** (`q1..q6`, `toc_do`, `chay`, `cam_bien[]`…) **phải bằng tên trong census C-tag** (đã nêu §5.2: nếu census dùng tên khác thì theo census). Thiếu vai trò bắt buộc ⇒ khuôn không vào chế độ gương (7B.2).
- Khuôn có phiên bản, đi qua đường duyệt/kiểm phạm vi sẵn có; thư viện có phạm vi (dùng chung toàn hệ thống / riêng nhà máy) — **[CHƯA KIỂM]** theo mô hình K14 (thư viện thiết bị) đã có đặc tả riêng; tránh dựng thư viện thứ hai: đối chiếu K14 trước khi làm.

### 7C.3 Lớp 3 — THỂ HIỆN trong cảnh: đặt + CỔNG NỐI
```ts
type Cong = { id: string; huong: "vao"|"ra"|"nap"|"do"|"de"|"bich_dung_cu";
              viTri: [number,number,number]; huongMat: [number,number,number]; caoDo: number;
              tuongThich?: { rongMm?: number; kieu?: string[] } };
```
- Băng tải: cổng vào/ra có **hướng + cao độ + bề rộng**; robot: **đế** + **mặt bích dụng cụ**; máy: điểm **nạp / dỡ**.
- **Hít khi kéo thả:** gần cổng tương thích trong ngưỡng ⇒ hít + đặt; kiểm **hướng đối diện, cao độ khớp (±dung sai), bề rộng tương thích**; lệch ⇒ báo lý do cụ thể (không nối im lặng).
- **Kết nối suy từ hình học** (placement-as-truth, như OIP): "băng tải A ra → băng tải B vào" được SUY từ hai cổng trùng nhau, không khai đồ thị tay riêng. Hệ quả cần ghi nhận: **sửa vị trí = sửa kết nối**; luôn hiện danh sách kết nối suy ra để người dùng kiểm.
- Gắn tag thật vào vai trò; chọn chế độ **gương** hoặc **mô phỏng** (7B.5) cho cả cụm.

### 7C.4 Hành vi chế độ GƯƠNG theo họ (trung thực — T1–T10)
| Họ | Đầu vào thật | Hiển thị | Ranh giới trung thực |
|---|---|---|---|
| `noi_tiep` | `q1..qn` thực | FK(q) → pose từng khâu (FK ở client hoặc server đẩy pose — 7B.7) | cũ ⇒ đóng băng + tím gạch; số q kèm tuổi |
| `delta_song_song` | 3 góc motor thực (+ góc xoay) | FK delta → bàn kẹp | như trên; chưa có bộ giải ⇒ **chưa hứa độ chính xác** tới khi có test khớp số liệu hãng |
| `gian_cartesian` | vị trí trục thực | tịnh tiến node theo trục | như trên |
| `bang_tai_duong` | tốc độ thực (+ cảm biến) | cuộn bề mặt theo tốc độ đo (T4) | **Vị trí vật CHỈ BIẾT tại cảm biến.** Giữa hai cảm biến: nội suy theo tốc độ đo, **gắn nhãn "ước lượng"** (hình ảnh khác: viền nét đứt / mờ), biến mất khi mẫu tốc độ hoặc cảm biến cũ; **không bịa vật** khi chưa có cảm biến báo. Vật ước lượng KHÔNG được dùng để ra quyết định (chỉ hình minh hoạ) |
| mô phỏng (mọi họ) | simulator / PLC ảo + **Rapier** | vật, va chạm, tích luỹ trên con lăn | nhãn "MÔ PHỎNG" (§7); va chạm chỉ tư vấn (7B.6) |

⚠ **Ngoại suy trong băng tải** (nội suy giữa hai cảm biến theo tốc độ) là ngoại lệ DUY NHẤT được ngoại suy theo đà, và chỉ được phép vì: (a) bị chặn giữa hai điểm đo thật, (b) gắn nhãn "ước lượng", (c) tắt khi dữ liệu cũ. Đây là cập nhật cho T2/T4 ở §4 (cùng thay đổi: T4 "sản phẩm dịch theo tốc độ đo" nay đi kèm nhãn "ước lượng" khi ở giữa hai cảm biến).

### 7C.5 Quy trình thêm thiết bị mới
1. Chọn **họ**. 2. Nhập **URDF/CAD** hoặc **sinh tham số** (băng tải). 3. **Trình hướng dẫn gắn vai trò tag** (liệt kê vai trò bắt buộc; gợi ý tag từ adapter trong phạm vi; không cho gán tag ngoài phạm vi). 4. **Kiểm**: giới hạn trục, đơn vị, hệ số, đủ vai trò, đối chiếu census; chạy thử trượt cục bộ (không ghi tag); **hiệu chuẩn** (7B.6-4). 5. **Đặt + hít** vào cảnh. Mỗi bước có kiểm thử đột biến ở pha triển khai (vd. "bỏ kiểm cao độ cổng" ⇒ đỏ).

### 7C.6 Pilot Pha 2 (cập nhật 7B.8)
(1) **robot UR** (URSim có sẵn; URDF UR thật) · (2) **một robot nhện** (bộ giải delta MỚI + kiểm khớp số liệu hãng/bài toán chuẩn) · (3) **một băng tải thẳng + một băng tải con lăn cong** (sinh tham số) · (4) **một giàn 3 trục**. Cảnh ghép: băng tải → robot → máy, nối bằng cổng.
Tiêu chí: hình ↔ số đo khớp tại tư thế tĩnh; cổng lệch cao độ/hướng bị từ chối có lý do; băng tải: vật chỉ xuất hiện khi cảm biến báo, "ước lượng" biến mất khi cảm biến cũ; delta: FK so với bài toán chuẩn trong sai số khai báo; đột biến "ngoại suy ngoài khoảng giữa hai cảm biến" đỏ.

### 7C.7 Rủi ro riêng của thư viện
| Rủi ro | Chặn |
|---|---|
| Bộ giải delta sai mà hình vẫn trông đúng | Test khớp bài toán chuẩn + số liệu hãng; tới khi đạt: nhãn "chưa kiểm chứng" trên mọi khung delta |
| Kết nối suy từ hình học sai (kéo lệch 1 cm đổi nối) | Hít có ngưỡng + dung sai khai; hiện danh sách kết nối suy ra; đổi kết nối thành sự kiện có xác nhận |
| Thư viện tự sinh số lượng khuôn / tham số lớn gây hỗn loạn | Phiên bản + duyệt; đối chiếu K14 để không có hai thư viện |
| Tham số băng tải sinh hình mà không có tag tốc độ | Thiếu `toc_do` ⇒ không gương (cuộn nền bị TẮT, không cuộn theo hằng số) |
| Người dùng tưởng vật "ước lượng" là vật thật | Hình khác biệt + chú giải cố định + biến mất khi cũ; không dùng ở khung L1 |

**Mockup v2:** thêm (i) khung "Máy 3 trục XYZ — chế độ GƯƠNG", (ii) bảng chọn khuôn theo họ, (iii) cảnh ghép băng tải → robot → máy có cổng nối (hít OK / lệch cao độ).

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
| **2A** | Mô hình động học máy §7B — chế độ GƯƠNG: khuôn dữ liệu, trục ↔ tag feedback, tầng nóng 20–50 Hz, rig TwinStudio, pilot 3 trục + băng tải + robot UR | 1d; kiểm kê CAD giữ cây node; chốt FK client/server; nguồn nóng cấu hình được | Hình↔số đo khớp; cũ ⇒ đóng băng; đột biến "ngoại suy"/"rơi về setpoint" đỏ |
| **2B** | Chế độ mô phỏng §7 + mô phỏng động học (Rapier, vật trên băng) | 2A; quyết định chủ dự án về cờ + quyền | Nhãn không bỏ sót (đột biến "bỏ nhãn" đỏ); server từ chối lệnh từ nguồn mô phỏng |
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

0. (§7B) FK chạy ở client (mã dùng chung + test khớp server)? Trần số trục "nóng"/người? URDF robot UR do hãng cấp hay tự khai? Phòng `robot:{id}` đã qua cổng phạm vi chưa (scada-master/twin kiểm)?

1. **Bật `SCADA_SOCKET_ENABLED` ở bản chạy** khi nào (phụ thuộc hợp đồng 1a)? Đây là việc của chủ dự án / dieu-phoi, scada-ui không đụng `.env`.
2. **Mục tiêu < 300 ms** hiểu theo tầng nguồn (§2) có chấp nhận không? Nếu muốn mọi tag đều < 300 ms thì phải đổi chu kỳ quét mặc định 5 s của adapter (việc server, ảnh hưởng tải thiết bị thật) — scada-ui không đề xuất làm.
3. **Có muốn màn L1 (tổng quan) ở pha 1** hay chỉ L2 + faceplate? Đặc tả chỉ cam kết L2 + L3.
4. **Chế độ tối** cho phòng điều khiển ban đêm: đưa vào pha 1d hay để sau? (ISA-101 thường có cả nền sáng và tối.)
5. **Bảng vai trò tag** (§5.2) — dùng tên nào, đã có census chưa?
6. **Quyền xem mô phỏng** (§7): vai trò nào?

---

## 12A. QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (duyệt v2, 2026-11-02) — v3 ghi lại, thay cho các câu hỏi §12

| # | Câu hỏi | Quyết định | Hệ quả cho đặc tả |
|---|---|---|---|
| 1 | Khi nào bật `SCADA_SOCKET_ENABLED` | Bật **khi hợp đồng 1a lên main và đã kiểm**. Chủ dự án tự sửa `.env`; dieu-phoi báo dòng cần thêm. (Lưu ý: kênh cần **cả** `SCADA_LIVE_CACHE_ENABLED=true` và `SCADA_SOCKET_ENABLED=true`, thiếu một ⇒ `scada:error DISABLED` — `.env.example:3338-3342`.) | scada-ui KHÔNG đụng `.env`; pha 1b chỉ merge được trước khi bật vì client có dự phòng hỏi vòng (§3.4) |
| 2 | SLO theo tầng nguồn | **Chấp nhận**: < 300 ms chỉ cho tag tầng "nóng"; tầng thường hiện tuổi. **KHÔNG đổi chu kỳ quét mặc định 5 s.** | §2 giữ nguyên; xoá khả năng "đổi poll mặc định" khỏi mọi phương án |
| 3 | Phạm vi pha 1 | **L2 + L3 (faceplate).** L1 tổng quan để pha sau. | §5.1-6, §9: L1 ra khỏi pha 1 |
| 4 | Chế độ tối | **SAU pha 1**, thành bước riêng. | Token màu pha 1 chỉ chế độ sáng; không vẽ chế độ tối trong pha 1 |
| 5 | Tên vai trò tag | **Theo tên census C-tag** (scada-master kiểm kê). Chưa chốt ⇒ §5.2 ghi tạm, đánh dấu **"chờ C-tag"**. | Bảng §5.2 và `Khuon.vaiTro` (§7C.2) là **TẠM — chờ C-tag**; không viết mã ký hiệu ràng buộc tên cho tới khi census chốt |
| 6 | Quyền xem / chạy mô phỏng | **CHỈ kỹ sư + admin.** | §7-6: quyền xem mô phỏng = kỹ sư + admin (không operator); server kiểm, không chỉ UI |
| 0a | FK client hay server | **Mô-đun dùng chung client/server + test khớp.** | §7B.7 chọn (i) với điều kiện: tách `kinematicModel` thành mô-đun thuần dùng chung, test chéo client ≡ server trên bộ tư thế cố định |
| 0b | Trần trục nóng | **12 / người dùng** (điều chỉnh sau đo pha 0). | §7B.3 |
| 0c | URDF robot | Ưu tiên **bản hãng / ROS-Industrial**; không có thì **tự khai + kiểm giới hạn**. | §7B.1, §7C.5 bước 4 |
| 0d | Phòng `robot:{id}` có qua cổng phạm vi chưa | dieu-phoi chuyển **scada-master** kiểm. | Chặn gương robot (2A) cho tới khi có kết luận |

**Việc kế tiếp (dieu-phoi giao):**
1. **Pha 0 (đo mốc)** — việc đầu tiên, sau B-T12, trên bản dev riêng, ngoài cửa sổ GPU, không đụng :3000. Kế hoạch: [pha0-ke-hoach.md](2026-11-02-scada-giao-dien-muot-pha0-ke-hoach.md) — **gửi dieu-phoi duyệt TRƯỚC khi chạy**.
2. **1a (hợp đồng)** — soạn §3.6 thành brief cho scada-master: [1a-brief-scada-master.md](2026-11-02-scada-giao-dien-muot-1a-brief-scada-master.md). scada-master làm **SAU hàng an toàn A2 đang chạy**.

---

## 13. Đã làm / chưa làm trong phiên này

- Đã làm: đọc mã (`scadaSocket.ts`, `socketPhatTheoNhaMay.ts`, `Faceplate.tsx`, `boDemHienTai.ts` các dòng cần, `chatLuongHienThi.ts`, `byteMau.ts` phần docblock, `TwinVanHanh.tsx` đoạn Đợt 21 B-3, spec K12–K14 §2/§5); dựng mockup HTML tĩnh và kiểm bằng trình duyệt tự động trên một cổng tạm (đã tắt), chụp 3 ảnh.
- **Chưa làm / chưa kiểm:** không chạy bất kỳ phép đo hiệu năng nào (mọi "mốc hiện tại" ghi CHƯA ĐO); không kiểm tính đúng của `scadaSocket.ts` vượt quá đọc mã; không xác minh bản chạy :3000; mockup dùng số giả lập 1 mẫu/giây, **không phải số đo**; màu/độ tương phản chưa kiểm bằng công cụ.
