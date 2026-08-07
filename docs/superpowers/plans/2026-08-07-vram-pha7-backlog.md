# Pha 7 — Backlog sau Pha 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng backlog Pha 6 để lại — **hai bề mặt CÓ NGƯỜI GHI mà KHÔNG AI ĐỌC**, **hai danh sách viết tay**, và **một mặt người bị bỏ rơi trong khi mặt Agent được cưỡng chế ba bản**.

**Architecture:** Không thêm cơ chế mới. Mọi mục là **suy ra thay vì liệt kê**, **nối chặng cuối đã bỏ dở**, hoặc **cân lại hai mặt lệch nhau**.

**Tech Stack:** TypeScript · tRPC · Drizzle · vitest · React 19

## Xếp hạng theo RỦI RO ĐO ĐƯỢC

| # | Mục | Vì sao hạng này |
|---|---|---|
| 1 | **Mặt NGƯỜI bị bỏ rơi** | **841 khoá thiếu ở CẢ BA locale** / 13.859 khoá mã tham chiếu. Mặt **Agent** bị cưỡng chế **ba bản thật**; mặt **người** có **0** phép canh. Bất đối xứng đo được. |
| 2 | **Chặng cuối chưa ai nhận** | Khuôn chung của Pha 6: Task 1·2·5 **đều dừng ở BIÊN PAYLOAD**. `truncatedIdentityWrites` **0 người đọc**; `notAnInvariant`/`variesWith`/`beforeAfterEvidence` **424 B/lượt, ≈298 KiB/giờ/panel, 0 lượt đọc**. |
| 3 | **`VARCHAR_LIMITS` viết tay** | `vramEventLog.ts:157` chưa neo vào drizzle. Task 5 đóng lượng từ cho `vram_leases`, **không** cho `vram_events`. |
| 4 | **3 file tự khai pha NGOÀI cổng** | `appErrorParamsCoverage` · `aiGgufEngine` · `kbSyncScheduler.evalGate` — **theo cấu tạo không bao giờ được canh**. |
| 5 | **Lưới I-3 chưa xuyên file** | Nối `.mutate(`↔`useMutation` **trong cùng file**; prop-drilling ⇒ cầu chì đỏ, chưa phủ. |

## CẦN CHỦ DỰ ÁN QUYẾT TRƯỚC (cả hai **cần DDL**)

**A. Sổ mã OTP đã dùng MẤT KHI RESTART** (cửa sổ hở **120 s**), và **hai bản sao `ROLE=api` sẽ có HAI sổ**. Đóng hẳn cần **bảng/cột mới**.
**B. Lời khai cắt danh tính DỪNG Ở BIÊN TIẾN TRÌNH** — anh em đọc hàng đã cắt **vẫn không biết**. Đóng hẳn cần **nới cột** hoặc **cột cờ mới**.
⇒ **KHÔNG task nào dưới đây được chạy DDL.** Nếu đường đúng cần DDL ⇒ **DỪNG VÀ HỎI**.

## Global Constraints

Kế thừa **toàn bộ** §Global Constraints của `2026-08-06-vram-pha6-backlog.md`. Nhắc lại những điều đắt nhất, cộng **ba điều MỚI của Pha 6**:

- ⚠⚠⚠ **COMMIT TRƯỚC, ĐỘT BIẾN SAU**; khôi phục **`git checkout HEAD -- <file>`**; chạy lại **TOÀN BỘ**.
- ⚠⚠⚠ **Cổng theo ĐƯỜNG DẪN TƯỜNG MINH, `ls` KIỂM TRƯỚC KHI TIN.** Glob rỗng ⇒ **vitest im lặng, cổng khai XANH** (**bốn** lần, một lần che **18 ca đỏ**).
- ⚠⚠⚠ **"ĐÃ SỬA" chỉ đúng khi `git show <commit>:<file>` xác nhận.**
- ⚠⚠ **"Cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"** — **MƯỜI LĂM** lần. Lời giải **mỗi lần**: **ĐẢO LƯỢNG TỪ** + **SUY RA TỪ MỘT NGUỒN CÓ ĐO**.
- ⚠⚠ **MỚI — "hai bộ suy ĐỘC LẬP canh HAI NỬA của MỘT câu ở hai phạm vi"**: cái **YẾU hơn** canh nửa **NGUY HIỂM hơn**, và lời giải **đã có sẵn cùng nhánh**. ⇒ **Dùng lại `server/routers/deployProcedureScan.ts`**, đừng viết bộ suy thứ N+1.
- ⚠⚠ **MỚI — "lưới KHOÁ ĐÚNG CÁI VỪA SỬA, không canh BẤT BIẾN"**: bản vá sửa 3 hình dạng, lưới khoá đúng 3 hình dạng ấy ⇒ **2 hồi quy mới ship được**. ⇒ **Đo bằng CÙNG MỘT TẬP ĐẦU VÀO qua các phiên bản**, đừng đo bằng **số đếm**.
- ⚠⚠ **MỚI — phép ĐẾM lật quyết định (đã BỐN lần)**: **đếm trước khi đổi một cơ chế dùng chung**. Task 6 đếm ra **8 điểm TOTP/4 file**, và điểm **nguy nhất KHÔNG PHẢI** cái đang vá.
- ⚠⚠ **Kiểm LƯỢNG TỪ của mọi luật: "tồn tại" hay "với mọi"?**
- ⚠ **NẠP ≠ KÍCH HOẠT** — bao đóng nhập từ `worker.ts` có **520 file**; đừng suy an toàn từ *"không import được"*.
- ⚠ **KHÔNG** trainer, **KHÔNG** `kb:sync`, **KHÔNG** DDL/seed, **KHÔNG** cấp quyền. **KHÔNG tự sinh sub-agent.** **243+ mục bẩn** — không đụng.
- ⚠ **Nợ CÓ TRƯỚC:** `canUseAgentic({role:"engineer"})` · flake `wiring.inprocess` + `visionControl.tools` + `vramReconciler.test.ts` (**8 điểm `setImmediate`**) · 16 file đỏ `server/routers/**` · 5 ca `server/services/programming/**` · 10 ca đỏ `server/services/ai/**` (`42501`) · 1 ca đỏ `programmingRouter.safetyGuard.test.ts`.

**Cổng kiểm chung:** khối lệnh ở §"Cổng kiểm chung" của kế hoạch **Pha 5** — nay **16 đường**. ⚠ `vramPha5Gate.test.ts` ghim `CONG`=16, `FILE_CANH`=73.

**Máy chủ đang chạy:** PID **35216**. Đừng giết trừ khi task đòi redeploy — và khi đó **tắt theo PID**, báo cáo rõ.

---

### Task 1: Mặt NGƯỜI được cưỡng chế NGANG mặt Agent

**Nợ đo được:** **841 khoá** mã tham chiếu **thiếu ở CẢ BA locale** / 13.859. Riêng `vramBroker.*`: **30/33**. Mà `i18n:check` **XANH** — nó có **BA lỗ lượng từ**: quét khoá **trong file dịch** thay vì khoá **mã tham chiếu** · `present.length < 2 ⇒ continue` · chỉ so **placeholder**, không so **sự có mặt**.

⚠⚠ **Bất đối xứng là phần đáng nhớ:** bề mặt **Agent** bị cưỡng chế **ba bản thật** (Pha 5 Task 4); bề mặt **người** có **0** phép canh. Cùng một hệ, hai chuẩn.

- [ ] **Bước 1: ĐO trước.** Chạy phép đếm hiện tại; ghi **841 / 13.859** có còn đúng không. ⚠ **Tự đếm, đừng tin con số này.**
- [ ] **Bước 2: ca ĐỎ.** Một khoá `vramBroker.*` **vắng ở cả ba** ⇒ `i18n:check` phải **ĐỎ**. Hôm nay nó **xanh**.
- [ ] **Bước 3: vá ba lỗ lượng từ.** ⚠ **Đảo lượng từ**: hỏi *"MỌI khoá mã tham chiếu có mặt ở cả ba không"*, **không** hỏi *"các khoá trong file dịch có lệch nhau không"*.
- [ ] **Bước 4: BASELINE có bậc thang.** 841 khoá là **nợ toàn repo ~25 màn** — không đóng trong một task. ⇒ Ghim **con số hiện tại**, và luật là ***"số chỉ được GIẢM"***. ⚠ Thêm khoá thiếu mới ⇒ **ĐỎ**; dịch một khoá đã ghim mà **không hạ số** ⇒ **ĐỎ** (bậc thang đóng **cả hai chiều**).
- [ ] **Bước 5: dịch đủ `vramBroker.*`** (30/33) — đây là bề mặt Pha 4–6 vừa dựng.
- [ ] **Bước 6: đột biến.** Xoá một khoá khỏi **cả ba** ⇒ đỏ · khỏi **một** ⇒ đỏ · dịch một khoá đã ghim mà không hạ số ⇒ đỏ · và **không bắt nhầm**.
- [ ] **Bước 7: commit.**

**Cổng ra:** khoá vắng ở cả ba ⇒ **đỏ**; bậc thang đóng **hai chiều**; `vramBroker.*` đủ ba ngôn ngữ.

---

### Task 2: Chặng cuối — payload RA MÀN HÌNH

**Khuôn chung Pha 6 (chỉ ghép cả nhánh mới thấy):**
> **Task 1, 2 và 5 ĐỀU dừng lời khai ở BIÊN PAYLOAD và đều gọi đó là "tới được người đọc".**

Hai hệ quả đo được: `truncatedIdentityWrites` (Task 5) **0 điểm đọc** ở `client/**` và `vramTools.ts` · `notAnInvariant`/`variesWith`/`beforeAfterEvidence` **424 B/lượt, ≈298 KiB/giờ/panel, 0 lượt đọc**.

- [ ] **Bước 1: đếm** mọi ô **CÓ NGƯỜI GHI mà KHÔNG AI ĐỌC** trên mặt đọc VRAM. **Tự `git grep`**, đừng tin danh sách này.
- [ ] **Bước 2: với MỖI ô — người đọc THẬT hoặc BỊ XOÁ.** Không có lựa chọn thứ ba (luật Task 4 Pha 4). ⚠ **Người đọc thật** = hiện ra cho **người** hoặc vào **`textSummary`** cho **Agent** — **không** phải "có mặt trong payload".
- [ ] **Bước 3:** ⚠ Nhớ **Agent chỉ nhận `textSummary`** (`aiLocalKnowledgeService:2070/2351/2396` — đã đo hai lần). Ô nào chỉ ở `data.state` thì **Agent không bao giờ thấy**.
- [ ] **Bước 4: đột biến.** Gỡ một người đọc ⇒ ca đỏ **kèm con trỏ đích danh** · thêm một ô mới **không người đọc** ⇒ ca đỏ (**đảo lượng từ**, đừng liệt kê ô).
- [ ] **Bước 5: commit.**

**Cổng ra:** **0** ô có-người-ghi-không-ai-đọc trên mặt đọc VRAM, và lưới bắt được ô **thứ N+1**.

---

### Task 3: `VARCHAR_LIMITS` thôi là danh sách viết tay

**Nợ:** `server/services/vram/vramEventLog.ts:157` giữ **danh sách bề rộng viết tay** cho `vram_events`. Task 5 đã neo `vram_leases` vào drizzle bằng **hai lượng từ hai chiều** (thiếu cột ⇒ đỏ · thừa mục ⇒ đỏ) — **chưa** làm cho `vram_events`.

- [ ] **Bước 1:** đọc phép neo Task 5 đã dựng (`∀-A`/`∀-B`) — **dùng lại**, đừng viết cái thứ hai.
- [ ] **Bước 2: ca ĐỎ** — thêm cột `varchar` vào schema `vram_events` mà không khai ⇒ đỏ; và **chiều ngược** (mục ở hằng, không có cột thật) ⇒ đỏ.
- [ ] **Bước 3: cài.** ⚠ `sanitizeVramEvent()` **đã** khai `truncatedFields` ⇒ hậu quả nhẹ hơn `vram_leases`; **đừng** đổi hành vi, chỉ neo lượng từ.
- [ ] **Bước 4: đột biến** cả hai chiều + **không bắt nhầm**.
- [ ] **Bước 5: commit.**

---

### Task 4: Ba file tự khai pha NGOÀI cổng + lưới I-3 xuyên file

**4a.** `appErrorParamsCoverage` · `aiGgufEngine` · `kbSyncScheduler.evalGate` tự khai một pha nhưng **nằm ngoài cổng** ⇒ **theo cấu tạo không bao giờ được canh**. Reviewer đã đo hộ: **3 file / 30 ca / 1,24 s**.
**4b.** Lưới I-3 (Task 1b) nối `.mutate(`↔`useMutation` **trong cùng file**; prop-drilling ⇒ **cầu chì đỏ**, chưa phủ.

- [ ] **Bước 1:** thêm 3 đường vào §Cổng kiểm chung của kế hoạch **Pha 5**, cập nhật `CONG` và `FILE_CANH` ở `vramPha5Gate.test.ts`.
- [ ] **Bước 2: ca ĐỎ** — một lưới mới **ngoài cổng** ⇒ đỏ (đã có cơ chế, kiểm nó còn sống).
- [ ] **Bước 3: 4b** — mở rộng lưới I-3 **xuyên file**. ⚠ Nếu chi phí vượt giá trị ⇒ **khai rõ vùng mù trong docstring**, đừng để người sau đọc màu xanh thành "đã phủ".
- [ ] **Bước 4: đột biến** + **không bắt nhầm**. **Bước 5: commit.**

---

## Sau khi xong 4 task

- **Review TOÀN NHÁNH** trên model mạnh nhất. ⚠ **CHÍN pha liên tiếp** lượt này bắt được thứ review-theo-task **KHÔNG THỂ** bắt. **Đừng bỏ.**
- Lăng kính: **"an toàn là HỆ QUẢ của thứ khác đang hỏng"** (đã **sáu** lần) · **"hàng rào không ai canh"** · **"lượng từ sai"** · **"độc lập về nguồn ≠ độc lập về sai lầm"** · **"lưới khoá đúng cái vừa sửa"** · **"trả nợ đẻ nợ nặng hơn"** (đã **ba** lần).
- Push · memory · đối chiếu backlog: mục nào **đóng**, mục nào **còn**, mục nào **MỚI SINH RA từ chính lượt trả nợ này**.
