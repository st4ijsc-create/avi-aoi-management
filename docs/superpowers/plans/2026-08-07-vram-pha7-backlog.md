# Pha 7 — Backlog sau Pha 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng backlog Pha 6 để lại — **hai bề mặt CÓ NGƯỜI GHI mà KHÔNG AI ĐỌC**, **hai danh sách viết tay**, và **một mặt người bị bỏ rơi trong khi mặt Agent được cưỡng chế ba bản**.

**Architecture:** Không thêm cơ chế mới. Mọi mục là **suy ra thay vì liệt kê**, **nối chặng cuối đã bỏ dở**, hoặc **cân lại hai mặt lệch nhau**.

**Tech Stack:** TypeScript · tRPC · Drizzle · vitest · React 19

## Xếp hạng theo RỦI RO ĐO ĐƯỢC

| # | Mục | Vì sao hạng này |
|---|---|---|
| 1 | ~~**Mặt NGƯỜI bị bỏ rơi**~~ → **hàng rào canh CÁI HÀNG RÀO** | ⚠ **ĐÍNH CHÍNH:** mục gốc **đã đóng** ở `1ada0526` (nền nay **817+20**, `vramBroker.*` **0/36** thiếu). Nợ **còn lại**: chính `i18n:check` **không ai canh** — vitest ❌ · 16 đường cổng ❌ · CI ❌ (0/7 workflow); và *"nền chỉ được thu hẹp"* **không có lượng từ máy** (probe M6: phình tay ⇒ **XANH**). |
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

> ## ⚠⚠⚠ ĐÍNH CHÍNH (2026-08-07) — **BẢN TASK 1 GỐC MÔ TẢ TRẠNG THÁI ĐÃ KHÔNG CÒN ĐÚNG**
>
> Task 1 như soạn ban đầu **đã được thực thi trọn vẹn** ở commit **`1ada0526`**
> (*"fix(vram/pha6): I-1 — `i18n:check` thôi mù THEO CẤU TẠO, + 33 nhãn `vramBroker.*` × 3 bản"*),
> **tổ tiên của HEAD**. Kế hoạch này được soạn từ **báo cáo review Pha 6**, **không** từ **mã đã
> vá** — nên nó mô tả trạng thái **trước** bản vá. Con số `841 / 13.859 / 30-of-33` là ảnh chụp
> **trước** `1ada0526`.
>
> **Phép đếm ĐỘC LẬP tại HEAD (Pha 7 Bước 1):** **13.919** khoá mã tham chiếu · **817** thiếu cả ba
> · **20** thiếu một phần · `vramBroker.*` **0/36** thiếu (đủ ba bản). Khớp chính xác nền đã ghim.
> **Sáu đột biến** xác nhận cổng ra của Task 1 gốc **ĐẠT** (thiếu cả ba ⇒ đỏ · thiếu một ⇒ đỏ ·
> bậc thang **hai chiều** ⇒ đỏ · khoá cố ý rỗng **không bị bắt nhầm**).
>
> ⇒ **Phạm vi Task 1 chuyển sang §4.1 + §4.2 dưới đây** — hai nợ mà bản gốc **không** phủ, cùng
> một lớp lỗi *"hàng rào không ai canh"* nhưng ở **một tầng cao hơn: hàng rào canh CÁI HÀNG RÀO**.

**Trớ trêu đo được:** Pha 6 dựng `i18n:check` để cân **mặt người** với **mặt Agent** — rồi **chính bộ cưỡng chế mới** lại **không ai canh**: vitest ❌ · trong 16 đường cổng ❌ · trong CI ❌ (`grep -rn "i18n" .github/workflows/` = **0/7 workflow**) · có test canh chính nó ❌. **Hoàn nguyên PASS B thì MỌI cổng vẫn XANH** — lưới giả, ở tầng **công cụ**.

#### §4.1 — bộ cưỡng chế mặt NGƯỜI phải được canh NGANG mặt Agent

- [x] **Bước 1: ĐO trước.** Hoàn nguyên PASS B (`git show 1ada0526^:…`) **+** xoá `vramBroker.preempt` khỏi cả ba ⇒ `i18n:check` **exit 0** và cổng **1902/1902 XANH (111 file)**.
- [x] **Bước 2: chọn hình dạng, VIẾT LÝ DO.** Chọn **CẢ HAI** — vitest **và** CI: chúng canh **hai lúc khác nhau** (lượt chạy cục bộ vs lượt đẩy), và cái đắt nhất là lượt **đẩy** vì đó là lúc không ai ngồi xem.
- [x] **Bước 3: cài.** `client/src/lib/i18nQuantifierGate.unit.test.ts` (**thực thi script thật** trên bộ đầu vào dựng sẵn) + bước `i18n:check` trong `.github/workflows/ci.yml`. `FILE_CANH` 73 → **74**, `CONG` giữ **16**.
- [x] **Bước 4: đột biến** — hoàn nguyên **từng lỗ** trong ba lỗ ⇒ **mỗi lỗ một ca đỏ riêng**.

#### §4.2 — *"nền chỉ được THU HẸP"* phải có lượng từ MÁY cưỡng chế

**Probe M6:** thêm tay một tên vào `missingInAllLocales`, **không dịch gì** ⇒ **exit 0, XANH**. Luật nói *"∀ lượt thay đổi, |nền| không tăng"*; máy chỉ kiểm *"∃ mục trong nền ⇒ tha"*.

- [x] **Bước 5: ca ĐỎ** — thêm mục vào nền mà không dịch ⇒ **ĐỎ**.
- [x] **Bước 6: cài.** **Hai** phép canh cho **hai cửa thoát**: `_ghim` (con số do chính công cụ viết ⇒ **sửa tay** ⇒ đỏ) + `scripts/i18n-baseline-tran.json` (**trần** ở file riêng mà `--update-baseline` **không bao giờ ghi** ⇒ phình qua cửa sinh-lại ⇒ đỏ). ⚠ Đường **so với `git show HEAD:…`** đã **LOẠI**: nó chỉ bắt lượt phình **chưa commit**; commit xong thì `HEAD` **chứa** nền đã phình ⇒ xanh vĩnh viễn, và cổng phải phụ thuộc git.
- [x] **Bước 7: đột biến** cả hai chiều + **không bắt nhầm** (hạ nền hợp lệ ⇒ xanh).
- [x] **Bước 8: commit.**

**Cổng ra:** hoàn nguyên **bất kỳ** lỗ nào trong ba lỗ ⇒ **có cổng đỏ**; thêm mục vào nền mà không dịch ⇒ **đỏ**; hạ nền hợp lệ ⇒ **xanh**.

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

---

### Task 5: HAI MỤC CẦN DDL (chủ dự án duyệt 2026-08-08)

⚠⚠⚠ **TASK NÀY SOẠN SQL, KHÔNG CHẠY SQL.** Chủ dự án đã duyệt **hướng**, nhưng còn phải duyệt **nội dung migration** trước khi áp. **Không `db:push`, không `drizzle-kit migrate`, không `psql` ghi.**

**A · Sổ mã OTP phải SỐNG SÓT qua restart và DÙNG CHUNG giữa tiến trình**
Task 6 Pha 6 dựng sổ **trong bộ nhớ** ⇒ hai lỗ: **restart ⇒ sổ rỗng lại**, mã dùng lại được trong **120 s** còn hiệu lực; **hai bản sao `ROLE=api` ⇒ hai sổ riêng**, mã tiêu ở A vẫn dùng được ở B.
⚠ Hôm nay **chưa nguy hiểm** — đã đo: `.env` **không đặt `ROLE`** ⇒ **một** tiến trình. Lỗ thứ hai chỉ mở khi **nhân bản để chịu tải**.

**B · Cờ "đã cắt danh tính" phải đi CÙNG DỮ LIỆU**
`owner` dựng từ **đường dẫn tuyệt đối** ⇒ **≥365 ký tự** / cột **160**. Task 5 Pha 6 khai đúng khi cắt, nhưng cờ **không nằm trong DB** ⇒ tiến trình **anh em** đọc lại hàng ấy **không biết** nó đã mất chữ.
⚠ **KHÔNG nới cột** — Task 5 đã đo và bác: trần đường dẫn Windows là **32.767**, *"không bề rộng nào đuổi kịp — nới cột chỉ **DỜI CHỖ NÓI DỐI**"*. Đường đúng là **thêm một cột cờ**.

- [ ] **Bước 1: ĐO trước.** (A) dựng lượt phát lại **qua restart** ⇒ ghi lại nó **qua được**. (B) tiến trình anh em đọc hàng đã cắt ⇒ ghi lại nó **không thấy cờ**. **Hai ca ĐỎ.**
- [ ] **Bước 2: đếm bề mặt.** ⚠ **Đếm trước khi đổi một cơ chế dùng chung** đã lật quyết định **BỐN lần**. (A) `git grep` mọi chỗ đọc/ghi sổ OTP; (B) mọi chỗ đọc `owner` từ sổ chung.
- [ ] **Bước 3: SOẠN SQL, DỪNG, TRÌNH CHỦ DỰ ÁN.** Một migration **duy nhất** cho cả A và B. Ghi vào báo cáo **nguyên văn SQL** + **lượt hoàn tác**. ⚠ **DỪNG Ở ĐÂY.**
- [ ] **Bước 4:** (sau khi duyệt) áp migration lên **cả** `aoi_management` **và** `aoi_management_test`, owner **`aoi`** (GOTCHA đã trả giá: DDL bằng `avi_app` ⇒ **42501**).
- [ ] **Bước 5: cài mã**, dùng lại vị từ/bộ suy đã có — **đừng viết cái thứ N+1**.
- [ ] **Bước 6: ĐỐI CHỨNG DƯƠNG** — (A) mã **mới** vẫn qua; (B) `owner` **ngắn** ⇒ cờ **false**, và **ô BIÊN** (dài **đúng bằng** trần) ⇒ **không** khai là đã cắt.
- [ ] **Bước 7: đột biến.** (A) restart ⇒ mã cũ **vẫn bị chặn**; hai tiến trình ⇒ mã tiêu ở A **bị chặn** ở B. (B) gỡ cờ ⇒ ca đỏ; anh em đọc ⇒ **thấy** cờ. Cộng **KHÔNG bắt nhầm**.
- [ ] **Bước 8: sổ phải TỰ DỌN** — nếu không nó phình vô hạn. Ca đo được, không chỉ khai.
- [ ] **Bước 9: commit.**

**Cổng ra:** (A) mã tiêu rồi ⇒ **chặn qua restart VÀ qua tiến trình khác**; mã mới ⇒ **vẫn qua**. (B) hàng bị cắt ⇒ **mọi** người đọc **thấy cờ**, kể cả tiến trình anh em.
