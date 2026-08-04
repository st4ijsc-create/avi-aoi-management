# Pha 2B — Cưỡng chế: từ chối trung thực thay cho tràn im lặng

> **Cho người thực thi bằng agent:** BẮT BUỘC DÙNG SUB-SKILL `superpowers:subagent-driven-development`. Các bước dùng cú pháp checkbox (`- [ ]`).

**Mục tiêu:** Bật cưỡng chế cấp phát VRAM theo mô hình §5.6c — `headroom = trần − max(ledgerTotalBytes, attributableBytes)` — với **từ chối trung thực**, **ưu tiên theo giá trị nhà máy**, và **ba kết cục** thay cho hai. Xoá/hấp thụ mọi cơ chế cũ để hệ về **một mối**.

**Kiến trúc:** Broker đã có sổ tin cậy sau Pha 2A. Pha 2B thêm **quyết định** vào đường `reserve()`. `reserve()` **phải giữ nguyên tính ĐỒNG BỘ** — đó là lá chắn cấu trúc từ Pha 1 — nên nó đọc **kết quả tick gần nhất** đã lưu sẵn, **không** `await` đầu dò.

**Đây là pha ĐỔI HÀNH VI.** Lần đầu trong toàn bộ chuỗi, một lượt xin cấp phát có thể bị **từ chối**.

**Tech Stack:** TypeScript · Node 24 · Vitest · node-llama-cpp · onnxruntime-node · Drizzle/Postgres

## Global Constraints

Sao nguyên văn từ spec `docs/superpowers/specs/2026-08-02-vram-broker-design.md`.

1. **`reserve()` phải giữ ĐỒNG BỘ.** Không `await` trên đường quyết định. Tính đồng bộ **là** lá chắn cấu trúc, không phải tối ưu hiệu năng.
2. **KHÔNG viết lại `server/services/aiGgufEngine.ts`.** Ba hàm `withGgufSlot` · `withGgufSlotGenerator` · `ensureTextContext` giữ nguyên ngữ nghĩa. Chỉ **rút phần sở hữu bộ nhớ** ra.
3. **Đ4 — KHÔNG TRỘN HAI THƯỚC.** Bộ đếm theo tiến trình chỉ dùng cho **chênh lệch trong một cửa sổ**; `nvidia-smi`/`getVramState` cho **số tuyệt đối** của thiết bị. Không cộng/trừ/so sánh chéo.
4. **Đơn vị nội bộ luôn là BYTE.** MiB chỉ ở câu log và câu cảnh báo.
5. **Mọi lưới an toàn phải chứng minh bằng ĐỘT BIẾN**: làm hỏng mã, chạy test, thấy **đúng** test đỏ, khôi phục, xác nhận `git status --porcelain server/` rỗng.
6. **Vị từ dùng chung**: task nào đổi **dân số** đầu vào của một vị từ phải liệt kê **tất cả** nơi tiêu thụ và kiểm **từng nơi**. Ghi bảng vào báo cáo.
7. **Fixture đủ lớn để phân biệt** — ca về nhầm kích thước dùng số cỡ **17.000 MiB**, không dùng cỡ 600 MiB.
8. **Ngưỡng lệch `512 MiB` và nhịp `60_000 ms` KHÔNG thừa kế sang đường cưỡng chế.** Chúng là tham số của **cái chuông**. Cưỡng chế dùng **`attributable` (số)**, không dùng `alarm` (boolean).
9. **Không được có đường nào tràn im lặng.** Cụm `"allowing temporary overflow"` phải biến mất khỏi repo.
10. 🔴 **ĐÍNH CHÍNH (2026-08-04, sau review Task 1) — "mù ⇒ chỉ-sổ" KHÔNG PHẢI suy biến an toàn. Nó là NHÁNH RỘNG RÃI NHẤT.**
    Bản đầu của mục này viết *"suy biến AN TOÀN: rơi về chỉ-sổ"* — **sai bản chất**, và sai theo hướng ru ngủ.
    Chứng minh: vì `headroom = trần − max(ledgerTotal, attributable)` và `max(L, A) ≥ L`, nên **`attributable = null` là CHẶN TRÊN của mọi headroom**. Rơi về chỉ-sổ ⇒ dư địa **lớn nhất có thể**, trong khi sổ chỉ nối **14/159** dòng ⇒ hệ mất tầm nhìn với **gần như cả tấm card**.
    ⇒ **Mọi đường sinh `blind` là một đường VÔ HIỆU HOÁ lớp bảo vệ.** Đã liệt kê **11 đường** như vậy; đường tệ nhất **không phải** đầu dò hỏng mà là lease `local-trainer` **ttl 2 giờ, đang bật, cố ý không commit** ⇒ mù **hàng giờ**.
    **Quy tắc thay thế, ràng buộc Task 2 và Task 5:**
    - `blind` / `unverified` phải làm hệ **CHẶT HƠN**, không lỏng hơn — Task 5 **không được** coi `blind` là an toàn.
    - Cổng ở Task 1 **VẪN CHỤP** nền và đánh dấu `unverified` thay vì từ chối, vì một nền **nhiễm** vẫn chặt hơn **chỉ-sổ**. Giá trị của cổng là **tầm nhìn** (nêu đích danh tiến trình), không phải việc từ chối.
    - Vẫn **TUYỆT ĐỐI KHÔNG ĐOÁN** byte của hộ lạ. Thôi biến "không biết bao nhiêu" thành "coi như không có gì" — hai việc khác nhau.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `server/services/vram/vramReconciler.ts` | **SỬA.** Nền từ chối tuyên bố sạch khi có PID lạ; lưu kết quả tick gần nhất đọc được **đồng bộ**. |
| `server/services/vram/vramHeadroom.ts` | **MỚI.** Hàm thuần tính `headroom` theo §5.6c. Tách riêng để test được không cần I/O. |
| `server/services/vram/vramBroker.ts` | **SỬA.** `reserve()` quyết định thật; `VramRefusedError`; thu hồi theo ưu tiên. |
| `server/services/vram/vramMeasureLock.ts` | **SỬA.** Ưu tiên trong hàng chờ (cổng 2). |
| `server/services/aiGgufEngine.ts` | **SỬA (chỉ rút, không viết lại).** Xoá `enforceVramGuard`, hấp thụ `ensureCapacity`/`evictLRU`. |
| `client/src/lib/errorCodes.ts` | **SỬA.** Mã lỗi cho từ chối trung thực. |
| `docs/superpowers/reports/2026-08-04-vram-pha2b-report.md` | **MỚI.** |

---

### Task 1: 🔴 CỔNG CỨNG — nền từ chối tuyên bố sạch khi có PID lạ

**Files:**
- Modify: `server/services/vram/vramReconciler.ts`
- Test: `server/services/vram/reconciler.baselinePids.test.ts` (tạo mới)

**Đây là cổng duy nhất còn chặn, và nó chặn vì lý do số học.** `attributable = deviceUsed − baseline` là **số chịu lực** của toàn bộ mô hình §5.6c. Mã tự khai ở `vramReconciler.ts` (khoảng `:250-257`): nếu server khởi động lại **trong khi tiến trình con còn sống** — điển hình sidecar thị giác 7,8 GB — thì khối đó **bị nuốt vào nền và ta sẽ KHÔNG BAO GIỜ THẤY NÓ**. Nền hụt 7,8 GB ⇒ `attributable` hụt 7,8 GB ⇒ **dư địa phóng đại đúng 7,8 GB** ⇒ cho cấp phát khi thiết bị đã đầy.

**Điều đã đo, dùng luôn:** trên máy WDDM này `nvidia-smi --query-compute-apps=pid,process_name` **liệt kê được PID** — chỉ cột `used_memory` là `[N/A]`. Vậy ta **biết được có ai đang giữ**, dù không biết **bao nhiêu**. Thế là đủ để **từ chối**, không đủ để **trừ**.

**Việc phải làm:**
1. Lúc chụp nền, lấy danh sách PID đang dùng GPU.
2. PID nào **không** phải tiến trình của ta (và không phải hậu duệ đã biết) ⇒ **TỪ CHỐI tuyên bố nền sạch**, ghi sự kiện nêu **tên tiến trình**, và giữ nền **chưa xác định**.
3. Nền chưa xác định ⇒ `attributable` **không tính được** ⇒ headroom rơi về **chỉ-sổ**, và **phải ghi rõ đang chạy mù** (ràng buộc 10).
4. ⚠ **Không được đoán** số byte của PID lạ. Đoán một con số rồi trừ đi là **tệ hơn** thừa nhận không biết.

- [ ] **Bước 1: Đọc mã trước.** Đọc `captureVramBaseline()` và khối chú thích tự khai quanh `:250-257`. Đọc `vramProcessProbe.ts` xem đã có sẵn đường lấy danh sách PID chưa (Task 1 Pha 2A dựng cây tiến trình — **dùng lại, đừng dựng đường thứ hai**).
- [ ] **Bước 2: Viết test thất bại trước** — có PID lạ giữ GPU ⇒ `captureVramBaseline()` **không** chốt nền; sự kiện ghi nêu **tên tiến trình**; headroom rơi về chỉ-sổ và có cờ "đang chạy mù". Fixture dùng số cỡ **17.000 MiB** cho khối bị nuốt (ràng buộc 7).
- [ ] **Bước 3: Chạy để thấy đỏ.** `npx vitest run server/services/vram/reconciler.baselinePids.test.ts`
- [ ] **Bước 4: Cài đặt.**
- [ ] **Bước 5: Chạy toàn bộ** `npx vitest run server/services/vram/` + một lượt `--sequence.shuffle.tests`.
- [ ] **Bước 6: Đột biến bắt buộc** — cho nhánh "có PID lạ" chốt nền như thường; ca ★ phải đỏ. Khôi phục, xác nhận cây sạch.
- [ ] **Bước 7: Nghiệm thu SỐNG** — sinh một tiến trình giữ VRAM, khởi động lại đường chụp nền, xác nhận nó **từ chối** và nêu đúng tên tiến trình.
  ⚠ **Không nối ống stdio vào tiến trình con nạp model** (làm con đứng im trước `getLlama()`, giả dạng hiện tượng đang đo). ⚠ **Dọn theo đúng PID**, không quét mù theo tên.
- [ ] **Bước 8: Commit.**

---

### Task 2: `headroom` theo §5.6c — hàm thuần, CHƯA cưỡng chế

**Files:**
- Create: `server/services/vram/vramHeadroom.ts`
- Test: `server/services/vram/vramHeadroom.test.ts`
- Modify: `server/services/vram/vramReconciler.ts` (lưu kết quả tick gần nhất, đọc **đồng bộ**)

**Interfaces:**
```ts
export interface HeadroomInput {
  readonly ceilingBytes: number;
  readonly ledgerTotalBytes: number;
  readonly attributableBytes: number | null;   // null = đối chiếu MÙ
  readonly safetyReserveBytes: number;
}
export interface HeadroomResult {
  readonly headroomBytes: number;
  readonly basis: "ledger-only" | "attributable" | "ledger";  // vế nào thắng
  readonly blind: boolean;                                     // true khi attributable === null
}
export function computeHeadroom(input: HeadroomInput): HeadroomResult;
```

**Công thức (§5.6c), chép nguyên văn:**
```
headroom = ceilingBytes − max(ledgerTotalBytes, attributableBytes) − safetyReserveBytes
```
`attributableBytes === null` ⇒ dùng **chỉ** `ledgerTotalBytes`, đặt `blind: true`.

⚠ **`max()` chứ KHÔNG `+`** — cộng sẽ đếm hai lần khoản mà sổ đã đặt cọc cho lease đang nạp. Và chính `max()` là thứ **tự nuốt khoản báo thiếu 128 MiB**, nên pha này **không cần** giải xong câu "bộ đệm lười hay cửa sổ cắt ngọn".

⚠ **Ràng buộc 1**: `reserve()` đồng bộ ⇒ hàm này **thuần và đồng bộ**; kết quả tick gần nhất phải đọc được **không `await`**. Reconciler hiện chỉ có `reconcileOnce()` bất đồng bộ — **thêm một ô lưu kết quả tick gần nhất**, đừng gọi lại đầu dò.

- [ ] **Bước 1: Viết test thất bại trước.** Bắt buộc có các ca: sổ thắng · `attributable` thắng · `attributable === null` ⇒ `blind: true` và dùng chỉ sổ · headroom **âm** (đã vượt trần) trả **âm**, không kẹp về 0 · `safetyReserve` được trừ đúng. Fixture cỡ **17.000 MiB**.
- [ ] **Bước 2: Chạy để thấy đỏ.**
- [ ] **Bước 3: Cài đặt hàm thuần.**
- [ ] **Bước 4: Thêm ô lưu kết quả tick gần nhất trong reconciler, đọc đồng bộ.**
- [ ] **Bước 5: Chạy toàn bộ + xáo thứ tự.**
- [ ] **Bước 6: Đột biến** — đổi `max` thành `+`; ca "không đếm hai lần" phải đỏ. Đổi `null ⇒ blind` thành coi như 0; ca mù phải đỏ. Khôi phục.
- [ ] **Bước 7: Commit.**

---

### Task 3: BA kết cục (§5.5) — diệt suy biến im lặng

**Files:**
- Modify: `server/services/aiGgufEngine.ts` (chỉ hai chỗ nêu dưới)
- Test: `server/services/vram/threeOutcomes.test.ts` (tạo mới)

**Đo được ở Ư0: `0/24` log chứa dòng lùi `gpuLayers:"auto"`** ⇒ lớp phòng thủ cuối **không bao giờ chạy**. Hai nguyên nhân độc lập, **cả hai phải vá**:
1. `isOom` **không khớp** chuỗi `"Failed to load model"` mà llama.cpp thật sự ném ⇒ nhánh hạ `gpuLayers` không với tới.
2. `warmModel` có `catch {}` **rỗng** ⇒ nuốt trọn thất bại nạp lúc khởi động.

⚠ **Cạm bẫy đã trả giá:** `Math.max(0, Math.min(totalLayers, -1)) === 0` — nên `gpuLayers: -1` **không** nghĩa "tất cả các lớp" mà nạp **0 lớp**, chạy CPU, chậm gấp bội, **và không báo gì**. Đường lùi phải đặt số lớp **tường minh**.

**Bốn bước xử lý khi driver từ chối sau khi đã qua cổng sổ (§5.5), mỗi bước MỘT sự kiện:**
1. **trả giấy phép NGAY** — driver từ chối mà lease còn treo thì sổ **cộng dư vĩnh viễn** và lượt sau bị từ chối trên **byte ma**;
2. **thử lại 2 lần, cách nhau 5 s** — vì trần **không tất định** (đo được 3 OK / 9 hỏng trên **cùng** một khối 16.698,37 MiB);
3. **hạ `gpuLayers` TƯỜNG MINH**, ghi sự kiện `degraded` kèm **số lớp thật đã nạp**;
4. **từ chối trung thực** (§5.3).

- [ ] **Bước 1: Đọc mã trước** — tìm `isOom` và `warmModel`, đọc chuỗi lỗi thật mà llama.cpp ném (đừng đoán từ tên hàm).
- [ ] **Bước 2: Viết test thất bại trước** — ca cho **từng** bước trong bốn bước, và một ca ★★ khẳng định **không có đường nào im lặng**: mọi nhánh thất bại đều để lại **ít nhất một** sự kiện.
- [ ] **Bước 3: Chạy để thấy đỏ.**
- [ ] **Bước 4: Cài đặt.**
- [ ] **Bước 5: Chạy toàn bộ + xáo thứ tự + `npx vitest run server/services/aiGgufEngine*`.**
- [ ] **Bước 6: Đột biến** — khôi phục `catch {}` rỗng; ca ★★ phải đỏ. Cho `isOom` về bản cũ; ca đường lùi phải đỏ. Khôi phục.
- [ ] **Bước 7: Commit.**

---

### Task 4: Từ chối trung thực (§5.3) + nối vào hệ mã lỗi

**Files:**
- Modify: `server/services/vram/vramBroker.ts`
- Modify: `client/src/lib/errorCodes.ts`
- Test: `server/services/vram/refusal.test.ts` (tạo mới)

`VramRefusedError` phải mang **bốn** thứ: **xin bao nhiêu · còn bao nhiêu · ai đang giữ gì · ai có thể nhường**. Không phải một câu "hết bộ nhớ".

Nối vào hệ mã lỗi Sprint 5 (`client/src/lib/errorCodes.ts`) để hiện thành câu tiếng Việt cho người vận hành.

⚠ **Chỉ nêu được "ai đang giữ" cho các hộ ĐÃ NỐI.** 89/157 điểm chưa nối ⇒ câu từ chối phải **nói rõ** phần không quy trách nhiệm được, thay vì ngụ ý danh sách là đầy đủ. Đây là hệ quả trực tiếp của §5.6b — đừng để câu lỗi hứa nhiều hơn dữ liệu.

- [ ] **Bước 1: Đọc `client/src/lib/errorCodes.ts`** xem khuôn mã lỗi hiện có; theo đúng khuôn, đừng phát minh khuôn mới.
- [ ] **Bước 2: Viết test thất bại trước** — lỗi mang đủ bốn thành phần; có phần "không quy trách nhiệm được"; câu tiếng Việt hiện ra đúng.
- [ ] **Bước 3–5: đỏ → cài đặt → xanh.**
- [ ] **Bước 6: Đột biến** — bỏ trường "ai có thể nhường"; ca tương ứng phải đỏ. Khôi phục.
- [ ] **Bước 7: Commit.**

---

### Task 5: 🔴 BẬT CƯỠNG CHẾ + ưu tiên (§5.2, gồm cổng 2)

**Files:**
- Modify: `server/services/vram/vramBroker.ts`
- Modify: `server/services/vram/vramMeasureLock.ts`
- Test: `server/services/vram/enforcement.test.ts`, `server/services/vram/measureLock.priority.test.ts`

**Đây là task ĐỔI HÀNH VI.** Đến đây `reserve()` mới thật sự từ chối.

**Ưu tiên (§5.2), chép nguyên văn:**
1. **`production`** — đường kiểm tra AOI. **Không bao giờ** bị thu hồi.
2. **`interactive`** — người vận hành: RCA, trợ lý, ghost-text.
3. **`background`** — nạp tri thức, huấn luyện, cron 03:00. **Nhường trước tiên.**

Chỉ thu hồi được giấy phép **đang nhàn rỗi** (`refCount === 0`) hoặc mức **thấp hơn** mức đang xin.

**Cổng 2 nằm ở đây:** khoá cửa sổ đo hiện là **FIFO không ưu tiên**, nên `onnx-session` mức `production` xếp sau việc nền **tối đa 180 s**. Đưa ưu tiên vào hàng chờ của khoá.
⚠ Ưu tiên trong hàng chờ **dễ gây chết đói** cho mức thấp. Phải có cơ chế chống chết đói (ví dụ nâng hạng theo thời gian chờ) **và test chứng minh nó**, nếu không ta vừa đổi một vấn đề độ trễ lấy một vấn đề treo vĩnh viễn.

🔴 **ĐÍNH CHÍNH (sau review Task 2) — hai câu dưới đây trong bản đầu là SAI, đọc trước khi viết ca:**
- *"`blind: true` ⇒ suy biến an toàn (chỉ-sổ)"* — **SAI**, xem ràng buộc toàn cục 10. Chỉ-sổ là **nhánh RỘNG RÃI NHẤT**.
- *"tick quá cũ ⇒ vứt `attributable` ⇒ `null`"* — **cũng là phép LÀM LỎNG**, không phải làm chặt, vì `null` là **chặn TRÊN**. Chính sách hết hạn đúng: **giữ số VÀ cộng biên theo tuổi**, rồi hạ `trusted` — **tuyệt đối không đi qua `attributableBytes = null`**.
- Tick cũ là một **phạm trù thứ ba chưa có cờ**: nó khai **số sai kèm dấu ĐÁNG TIN** (`blind: false`, `trusted` có thể `true`). Đừng gộp nó vào `blind`.

- [ ] **Bước 1: Viết test thất bại trước** — `production` không bị thu hồi · `background` nhường trước · chỉ thu hồi lease nhàn rỗi · **chống chết đói** · headroom âm ⇒ từ chối · **`blind`/`unverified` ⇒ hệ CHẶT HƠN** (mỗi mức suy giảm một chính sách riêng, không gộp) và **ghi rõ đang chạy mù**.
- [ ] **Bước 2: Chạy để thấy đỏ.**
- [ ] **Bước 3: Cài đặt.** ⚠ Giữ `reserve()` **đồng bộ** (ràng buộc 1) — đọc ô tick gần nhất, **không `await`**.
- [ ] **Bước 4: Chạy toàn bộ + xáo thứ tự ×2.**
- [ ] **Bước 5: Đột biến ×3** — cho phép thu hồi `production`; bỏ chống chết đói; cho `blind` coi thiết bị là trống. Mỗi cái phải có ca đỏ. Khôi phục.
- [ ] **Bước 6: Nghiệm thu SỐNG** — xin một khối vượt dư địa, xác nhận **từ chối trung thực** với đủ bốn thành phần, và hệ **vẫn chạy**.
- [ ] **Bước 7: Commit.**

---

### Task 6: Hoãn — không chặn (§5.4) cho việc nền

**Files:**
- Modify: `server/services/kbSyncScheduler.ts` (đọc mã trước để xác nhận đường thật)
- Test: `server/services/vram/deferNotBlock.test.ts`

Quyết định của chủ dự án: việc **`background`** bị từ chối thì **hoãn rồi thử lại**, **không** hỏng và **không** bỏ qua.

| | |
|---|---|
| Người bắt lỗi | **người giám sát** (`kbSyncScheduler`), không phải tiến trình con — con chưa kịp sinh ra |
| Lùi dần | thử lại sau **15 phút**, nhân đôi, trần **60 phút** |
| Đáy | `KB_SYNC_MAX_DEFER_HOURS`, mặc định **6 giờ** |
| Quá đáy | **KHÔNG âm thầm bỏ.** Ghi sự kiện `defer_exceeded` + cảnh báo nêu **ai đang giữ chỗ** |
| Tín hiệu sẵn có | biển báo *"KB có thể đã cũ"* **tự nổi lên** khi sync trượt — **dùng lại nó, đừng phát minh tín hiệu mới** |

⚠ **Không được có đường nào mà một lượt `kb:sync` biến mất không để lại vết.**

- [ ] **Bước 1–5**: đọc mã → test đỏ → cài đặt → xanh → đột biến (bỏ `defer_exceeded`; ca phải đỏ).
- [ ] **Bước 6: Commit.**

---

### Task 7: "Về một mối" (§8) — xoá và hấp thụ

**Files:**
- Modify: `server/services/aiGgufEngine.ts`, `server/services/ai/ocrService.ts`, `server/services/aiReranker.ts`
- Test: `server/services/vram/consolidation.test.ts`

| Đang chạy | Số phận |
|---|---|
| `enforceVramGuard()` (`aiGgufEngine.ts:503`, gọi ở `:592`) | **XOÁ** — thay bằng `reserve()`, vốn biết kích thước **trước** |
| `ensureCapacity()` (`:555`) | **HẤP THỤ** thành chính sách đếm của broker |
| `evictLRU()` (`:532`) | **HẤP THỤ** thành `preempt()` |
| `GGUF_VRAM_GUARD_PCT` · `GGUF_MAX_VRAM_MB` · `GGUF_MAX_LOADED_MODELS` · `AI_SESSION_CACHE_MAX` | giữ tên, **một người đọc duy nhất** |
| `recSessionCache` (`ai/ocrService.ts`) — `Map` **không giới hạn** | vào dưới broker |
| Ba khoá in-flight (`inFlightLoads` · `embeddingContextInFlight` · `textContextInFlight`) | **KHÔNG hấp thụ** (bài toán khác: chống làm trùng việc) — gộp **ba bản sao cùng hình dạng** thành **một helper** |

⚠ **Ràng buộc 2**: không viết lại `aiGgufEngine.ts`. Chỉ **rút phần sở hữu bộ nhớ** ra.
⚠ **Ràng buộc 9**: sau task này, `git grep "temporary overflow"` phải trả **rỗng**.
⚠ **Ràng buộc 6** áp mạnh: xoá `enforceVramGuard` đổi dân số nhiều vị từ. Bảng "vị từ → mọi nơi tiêu thụ → đã kiểm" là **bắt buộc**.

- [ ] **Bước 1: Đọc cả ba file trước.** Xác nhận từng mục còn tồn tại ở đúng dòng — bảng trên có thể đã trôi.
- [ ] **Bước 2–5**: test đỏ → cài đặt → xanh → đột biến.
- [ ] **Bước 6: `git grep "temporary overflow"` — phải rỗng.** Ghi kết quả vào báo cáo.
- [ ] **Bước 7: Commit.**

---

## Điều kiện ra của Pha 2B

| # | Điều kiện | Cách kiểm |
|---|---|---|
| 1 | Nền **từ chối** tuyên bố sạch khi có PID lạ | nghiệm thu sống Task 1 |
| 2 | `headroom` dùng `max(ledger, attributable)`; `blind`/`unverified` làm hệ **CHẶT HƠN**, mỗi mức một chính sách riêng | test Task 2 + Task 5 |
| 3 | **Không còn** suy biến im lặng — mọi nhánh thất bại để lại sự kiện | test Task 3 |
| 4 | Từ chối trung thực mang đủ **bốn** thành phần + phần không quy trách nhiệm được | test Task 4 |
| 5 | `production` không bị thu hồi; **chống chết đói** có test | test Task 5 |
| 6 | Không đường nào `kb:sync` biến mất không để lại vết | test Task 6 |
| 7 | `git grep "temporary overflow"` **rỗng** | Task 7 |
| 8 | `npx vitest run server/services/vram/` xanh kể cả `--sequence.shuffle.tests`; `kb:eval` 151/151; `tsc` sạch | trước push |

⚠ **Ba mục KHÔNG thuộc pha này, đã xét lại và hạ cấp có lý do** (spec §10): `seen` đo độ tươi · 89 điểm chưa nối · ưu tiên xuyên tiến trình (Pha 3). Nếu một điều kiện ra không đạt, **ghi thẳng là không đạt** — tiền lệ đã có ở Pha 1.
