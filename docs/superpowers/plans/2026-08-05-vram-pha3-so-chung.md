# Pha 3 — Sổ chung xuyên tiến trình: từ "mỗi tiến trình một sổ" về MỘT MỐI

> **Cho người thực thi bằng agent:** BẮT BUỘC DÙNG SUB-SKILL `superpowers:subagent-driven-development`. Các bước dùng cú pháp checkbox (`- [ ]`).

**Mục tiêu:** Gỡ giả định cuối còn lại của cả kiến trúc — **mỗi tiến trình giữ một sổ riêng**. Sau pha này, `api` · `worker` · cron đọc **một sổ dùng chung**, giấy phép mồ côi được **nhận nuôi** thay vì bị nuốt vào nền, và `preempt()` với tới được hộ **ngoài tiến trình**.

> 🟠 **ĐÍNH CHÍNH (2026-08-05, review TOÀN NHÁNH — I-2): bản đầu của dòng trên kể `edge` và `sidecar` vào dân số đọc sổ chung. SAI, và mã KHÔNG hứa thế.** Chỉ **tiến trình Node gọi `startVramReconciler()`** mới công bố/đọc `vram_leases` (ràng buộc M-7, khai đúng ở `vramSharedLedgerStore.ts`). `edge` là dịch vụ **C#** (`tools/machine-simulator/src/St4i.EdgeService`) — nó không chạy broker một dòng nào; **sidecar** (`llama-server`) là **tiến trình con không có broker**, nó được đếm bằng **giấy phép do tiến trình cha giữ hộ** (và từ Task 4, bằng **nhận nuôi** khi cha đã chết). Hộ mồ côi của sidecar VÀO được sổ chung — nhưng qua người nhận nuôi, không phải do chính nó ghi.
>
> ⚠⚠ Kèm ràng buộc topo phải giữ: **một DB = một thiết bị GPU.** `vram_leases` không có cột host/device và `vram:baseline` là MỘT hàng cho cả DB. Xem đầu `drizzle/0312_vram_leases.sql` và docstring `drizzle/schema/vram.ts`.

**Kiến trúc:** Sổ chung nằm ở **DB**, bảng `vram_leases`.

> 🔴 **ĐÍNH CHÍNH (2026-08-05, do Task 2 phát hiện) — bản đầu của dòng này viết *"bảng `vram_leases` đã tồn tại từ Pha 1"*. SAI.** Pha 1 (migration `0310`) chỉ dựng **`vram_events`** — một nhật ký **chỉ-ghi-thêm**, và docstring của chính nó ghi rõ *"sổ cái SỐNG nằm trong bộ nhớ tiến trình"*. **Sổ chung ở DB CHƯA TỪNG TỒN TẠI**; migration `0312` là lượt tạo **đầu tiên** (đã áp lên cả `aoi_management` và `aoi_management_test`, owner `aoi`).
>
> **Hai bảng, hai vai — đừng nhầm:** `vram_events` = **LỊCH SỬ**, chỉ-ghi-thêm, **không ai đọc để quyết định**. `vram_leases` = **TRẠNG THÁI SỐNG**, có xoá, và **đường quyết định ĐỌC NÓ**.
>
> ⚠ Đây là một khẳng định **sự thật về CSDL** trong kế hoạch của controller mà không ai kiểm trước khi task khởi động — cùng lớp lỗi mà pha trước bắt được tám lần ở phía implementer. ⚠ **`reserve()` phải giữ ĐỒNG BỘ** — đó là lá chắn cấu trúc từ Pha 1 — nên nó **không được `await` DB**. Mô hình: mỗi tiến trình giữ **bản sao đọc** của sổ chung, làm mới theo nhịp reconciler; **quyết định** đọc bản sao đồng bộ; **ghi** đi qua DB bất đồng bộ sau khi đã quyết.

**Đây là pha ĐỔI HÀNH VI.** Một tiến trình nay có thể bị từ chối vì **tiến trình KHÁC** đang giữ chỗ.

**Tech Stack:** TypeScript · Node 24 · Vitest · Drizzle/Postgres · node-llama-cpp · nvidia-smi/PDH

## Global Constraints

1. ⚠⚠ **`reserve()` PHẢI GIỮ ĐỒNG BỘ.** Không `await` trên đường quyết định — kể cả `await` DB. Tính đồng bộ **LÀ** lá chắn cấu trúc, không phải tối ưu.
2. **KHÔNG viết lại `aiGgufEngine.ts`**; ba hàm `withGgufSlot` · `withGgufSlotGenerator` · `ensureTextContext` giữ nguyên ngữ nghĩa.
3. **Đ4 — KHÔNG TRỘN HAI THƯỚC.** Bộ đếm theo tiến trình chỉ cho **chênh lệch trong một cửa sổ**; `nvidia-smi`/`getVramState` cho **số tuyệt đối**.
4. **Đơn vị nội bộ luôn là BYTE.**
5. **Mọi lưới an toàn phải chứng minh bằng ĐỘT BIẾN**, khôi phục bằng `git checkout -- <file>`, chạy lại **TOÀN BỘ** sau mỗi lượt. ⚠ **COMMIT TRƯỚC, ĐỘT BIẾN SAU.**
6. **Vị từ dùng chung**: đổi **dân số** đầu vào ⇒ liệt kê **MỌI** nơi tiêu thụ, kiểm **TỪNG** nơi, ghi bảng vào báo cáo.
7. **Fixture đủ lớn để phân biệt** — ca về nhầm kích thước dùng số cỡ **17.000 MiB**.
8. **`blind`/`unverified`/tick-cũ phải làm hệ CHẶT HƠN.** *"Mù ⇒ chỉ-sổ"* **KHÔNG** an toàn: vì `max(L,A) ≥ L` nên `attributable = null` là **CHẶN TRÊN**.
9. **Không giá trị không hữu hạn nào** vào ống dẫn sự kiện (cột byte `bigint` ⇒ mất **cả lô**; `detail` `jsonb` ⇒ `null` im lặng).
10. 🔴 **LƯỚI PHẢI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE.** Ca quét hỏi *"file có nhập X không"* trả lời về **sự hiện diện**, **không nói gì về đường đi**. Lớp lỗi này tái diễn **NĂM lần** ở Pha 2B. **Khuôn đúng**: hàm dựng request + ca đọc **đúng object mà mã sản xuất gửi đi** — **không** ca tự khai bằng tay.
11. **`?? <mặc_định>` cho một đường ra là một DÂY — dây phải có LƯỚI.**
12. **Khi hai bản sao của một vị từ trùng nhau dưới một bất biến, thêm ca test KHÔNG giải được** — phải **đổi KIỂU** để bản sao sai **không viết ra được**.
13. **"Đặt cờ trước một lời gọi có thể ném, gỡ ngoài `finally`"** ⇒ chốt kẹt vĩnh viễn. Đã trả giá một lần.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `server/services/vram/vramSharedLedger.ts` | **MỚI.** Đọc/ghi sổ chung qua `vram_leases`; bản sao đọc đồng bộ; hoà giải xung đột. |
| `server/services/vram/vramAdoption.ts` | **MỚI.** Nhận nuôi giấy phép mồ côi; thu hồi giấy phép của tiến trình đã chết. |
| `server/services/vram/vramReconciler.ts` | **SỬA.** Nền dùng chung; làm mới bản sao đọc; N-WB-1. |
| `server/services/vram/vramBroker.ts` | **SỬA.** Quyết định đọc sổ chung; `preempt()` với tới hộ ngoài tiến trình. |
| `server/services/vram/vramPreempt.ts` | **SỬA.** Người thi hành xuyên tiến trình; C-2 nghiệm thu sống. |
| `drizzle/schema/vram.ts` + migration | **SỬA.** Cột cho quyền sở hữu tiến trình nếu thiếu. |

---

### Task 1: 🔴 C-2 — nghiệm thu SỐNG người thi hành thu hồi (nợ Pha 2B, làm TRƯỚC mọi thứ)

**Vì sao trước:** Pha 2B đổi ngữ nghĩa một đường **giết tiến trình thật** (`stopSidecar()` nay phải khai **chưa chết** thay vì `return true` vô điều kiện), nhưng **test giả `stopSidecar` nên ngữ nghĩa thật CHƯA TỪNG CHẠY**. Pha 3 sắp dựng thu hồi **xuyên tiến trình** trên đúng nền đó — dựng lên một thứ chưa ai chạy là xây trên cát.

- [ ] **Bước 1: Đo `stopSidecar()` mất bao lâu thấy `"exit"`** trên sidecar thật. Hạn mặc định **8.000 ms** — kiểm nó có đủ không. Ít nhất **5 lượt**, ghi số thô.
- [ ] **Bước 2: Nghiệm thu sống hai lượt** — (a) tiến trình **chưa chết** ⇒ người thi hành khai `failed`, sổ **KHÔNG** nhả, `freedBytes = 0`; (b) tiến trình **đã chết** ⇒ khai thành công, sổ nhả **đúng số byte**, `nvidia-smi` xác nhận.
- [ ] **Bước 3: Ca test dùng ngữ nghĩa THẬT**, không bản giả.
- [ ] **Bước 4: Đột biến** — cho người thi hành `return true` vô điều kiện ⇒ ca (a) phải đỏ. Khôi phục.
- [ ] **Bước 5: Commit.**

⚠ Không nối ống stdio vào tiến trình con. Dọn theo **đúng PID** (`nvidia-smi --query-compute-apps=pid`), **không quét mù theo tên**.

---

### Task 2: 🔴 Sổ chung — bản sao đọc ĐỒNG BỘ, ghi BẤT ĐỒNG BỘ

**Ràng buộc quyết định toàn bộ thiết kế:** `reserve()` **đồng bộ**. Nên:
- **Đọc**: bản sao trong bộ nhớ, làm mới theo nhịp reconciler (60 s) **và** sau mỗi lượt ghi của chính tiến trình này.
- **Ghi**: `INSERT`/`UPDATE` bất đồng bộ **SAU** khi đã quyết; nếu ghi hỏng ⇒ giấy phép vẫn có hiệu lực cục bộ nhưng phải **gắn cờ chưa đồng bộ** và **có tiếng**.
- **Độ trễ 60 s là ĐỘ TRỄ CƯỠNG CHẾ THẬT xuyên tiến trình** — phải khai, không được giấu.

⚠ **Bản sao đọc cũ là "phạm trù thứ ba"** đã học ở Pha 2B: nó **không phải `blind`** (có số), nhưng số **sai**. Chính sách đúng: **giữ số + cộng biên theo tuổi**, hạ `trusted` — **tuyệt đối không** đi qua `null`.

- [ ] **Bước 1: Đọc mã trước** — `vram_leases` (Pha 1), `vramBroker.ts` (sổ trong bộ nhớ), `vramTickCell.ts` (khuôn ô đọc đồng bộ đã có).
- [ ] **Bước 2: Test thất bại trước** — hai tiến trình, mỗi bên xin; bên thứ hai phải **thấy** giấy phép của bên thứ nhất.
- [ ] **Bước 3–5**: đỏ → cài đặt → xanh + shuffle.
- [ ] **Bước 6: Đột biến** — cho bản sao đọc **không bao giờ làm mới** ⇒ ca phải đỏ; cho ghi hỏng **im lặng** ⇒ ca phải đỏ.
- [ ] **Bước 7: Commit.**

---

### Task 3: 🔴 N-WB-1 — nền dùng chung (nợ nặng nhất của Pha 2B)

**Triệu chứng, nguyên văn từ review toàn nhánh:** `api` và `worker` **cùng chụp nền trên MỘT thiết bị** ⇒ nền của `api` **nuốt 17 GB của anh em**, và phản ứng duy nhất là **1.024 MiB**.

⚠ **Không vá được bằng số** — `nvidia-smi` trả `used_memory=[N/A]` trên WDDM nên mọi con số là **số bịa**; còn **bỏ nền** thì **NỚI LỎNG** (vì `max(L,A) ≥ L`). ⇒ Lời giải là **sổ chung**: nền chỉ được chụp bởi **một** tiến trình, các tiến trình khác **đọc** nó.

- [ ] **Bước 1: Chọn người chụp nền** — một vai trò duy nhất, có cơ chế bầu (leader-election đã có ở `backgroundJobs.ts`). Ghi rõ điều gì xảy ra khi **không ai** thắng.
- [ ] **Bước 2: Test thất bại trước** — hai tiến trình cùng sống; chỉ **một** chụp nền; bên kia **đọc**; nền **không** nuốt byte của anh em.
- [ ] **Bước 3–5**: đỏ → cài đặt → xanh.
- [ ] **Bước 6: Đột biến** — cho cả hai cùng chụp ⇒ ca phải đỏ.
- [ ] **Bước 7: Nghiệm thu SỐNG** — chạy **thật** `api` + `worker` cùng lúc, xác nhận nền **không** nuốt.
- [ ] **Bước 8: Commit.**

---

### Task 4: Nhận nuôi giấy phép mồ côi (§6)

Server khởi động lại trong khi sidecar còn giữ **7,8 GB** ⇒ sổ mất, thực tế còn. Reconciler dò tiến trình sidecar đang sống (**cổng + PID đã biết**) rồi **dựng lại giấy phép**. Cùng cơ chế bắt luôn **ca ngược**: tiến trình chết mà giấy phép còn treo.

⚠ Pha 2B đã dựng vị từ nhận diện tiến trình **của ta** với bằng chứng `CreationDate` — **dùng lại**, đừng dựng đường thứ hai.

- [ ] **Bước 1–5**: đọc mã → test đỏ → cài đặt → xanh → đột biến (bỏ nhận nuôi ⇒ ca đỏ; bỏ thu hồi-khi-chết ⇒ ca đỏ).
- [ ] **Bước 6: Nghiệm thu SỐNG** — sinh sidecar thật, giết server, khởi động lại, xác nhận giấy phép được **dựng lại đúng số byte**.
- [ ] **Bước 7: Commit.**

---

### Task 5: `preempt()` xuyên tiến trình + trả nốt nợ Pha 2B

- **Hoãn cho 5 hộ `background` còn lại** — hiện chỉ `kb:sync` được hoãn; **hai hộ trainer VỠ hợp đồng "Never rejects"** ⇒ job huấn luyện bị đánh **THẤT BẠI**, phải chạy lại tay. Gộp thành **helper dùng chung**, đừng chép.
- **`getKbSyncSchedulerStatus().defer` chưa ai đọc** — nối vào mặt sức khoẻ hoặc bỏ; đừng để một ô "đồng hồ không kim".
- **Ngân sách hoãn khôi phục mù ở cài đặt không DB** — nay có sổ chung, đọc lại được.

- [ ] **Bước 1–6**: như khuôn trên, kèm đột biến cho từng mục.
- [ ] **Bước 7: Commit.**

---

## Điều kiện ra của Pha 3

| # | Điều kiện | Cách kiểm |
|---|---|---|
| 1 | Người thi hành thu hồi **chỉ khai thành công khi byte THẬT SỰ đã nhả** | nghiệm thu sống Task 1 |
| 2 | Hai tiến trình thấy **cùng một sổ**; độ trễ cưỡng chế xuyên tiến trình được **khai** | test + nghiệm thu sống Task 2 |
| 3 | Nền chỉ do **một** tiến trình chụp; **không** nuốt byte của anh em | nghiệm thu sống Task 3 |
| 4 | Giấy phép mồ côi được **dựng lại đúng số byte** sau khởi động lại | nghiệm thu sống Task 4 |
| 5 | **Cả 6 hộ `background`** đều hoãn-không-chặn; trainer **không còn** bị đánh thất bại | test Task 5 |
| 6 | `npx vitest run server/services/vram/` xanh kể cả `--sequence.shuffle.tests`; `tsc` sạch; `i18n:check` 0 lệch | trước push |

⚠ **Ô 100,7 % của Đợt 2 phải được giải BẰNG CƠ CHẾ**, không bằng cấu hình — đó là điều kiện ra gốc của Pha 3 trong spec §10.
⚠ Nếu một điều kiện **không đạt**, ghi thẳng là **không đạt**. Tiền lệ: Pha 1 công bố cổng ra **chưa đạt**, và đó là kết quả **đúng**.
