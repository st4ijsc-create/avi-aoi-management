# Pha 6 — Backlog sau Pha 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng backlog Pha 4+5 để lại: **hai lỗ an ninh còn sống**, **hai bề mặt chưa từng chạy**, và **một bẫy đo lường đã suýt làm hỏng một kết luận**.

**Architecture:** Không thêm cơ chế mới. Ưu tiên theo **rủi ro đo được**, không theo thứ tự phát hiện.

**Tech Stack:** TypeScript · tRPC · Drizzle · vitest · React 19

## Xếp hạng theo RỦI RO ĐO ĐƯỢC (không theo thứ tự phát hiện)

| # | Mục | Vì sao hạng này |
|---|---|---|
| 1 | **M-4 step-up cache** | **ĐANG SỐNG, đo được**: `engineer1` gọi `preempt` **không `totpCode`** vẫn qua, vì cache 10 phút/`sessionToken`. **UI che, máy chủ không đóng.** |
| 2 | **`effectiveBytes` bẫy đo** | Trôi **426 MiB** giữa hai lượt đọc cách vài giây. **Pha 4 dùng nó làm bằng chứng và TRÚNG NHỜ MAY.** |
| 3 | **F2 — 8 tool KB không với tới** | `extractArgsForTool` 41 `case`, **0** cho `readToolsProgramming` ⇒ đường Agent NL mù; và **hai ranh giới an ninh chưa từng chạy**. |
| 4 | **N1 `releaseStale` chưa từng chạy** | Qua **HAI pha**, chưa một lượt thành công. Đường phá huỷ **chưa ai chứng minh**. |
| 5 | **N4 mặt suy giảm chưa render** | **Hai lượt nghiệm thu liên tiếp**, 5/5 ảnh đều `tin cậy`. |
| 6 | **I-2 đầu thứ ba** | Sổ chung **cắt `owner` ÂM THẦM**, không cờ. |

## Global Constraints

Kế thừa **toàn bộ** §Global Constraints của `2026-08-06-vram-pha5-tra-no.md`. Nhắc lại năm điều đắt nhất, cộng **ba điều MỚI của Pha 5**:

- ⚠⚠⚠ **COMMIT TRƯỚC, ĐỘT BIẾN SAU**; khôi phục **`git checkout HEAD -- <file>`** (`git checkout <commit> --` **GHI VÀO INDEX**); chạy lại **TOÀN BỘ**.
- ⚠⚠⚠ **Cổng theo ĐƯỜNG DẪN TƯỜNG MINH, `ls` KIỂM TRƯỚC KHI TIN.** Glob rỗng ⇒ **vitest im lặng, cổng khai XANH**. Tái diễn **BỐN lần**, một lần che **18 ca đỏ**.
- ⚠⚠⚠ **"ĐÃ SỬA" chỉ đúng khi `git show <commit>:<file>` xác nhận.**
- ⚠⚠ **"Cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"** — Pha 5 tái diễn **CHÍN** lần ở chín trục. Lời giải **mỗi lần**: **ĐẢO LƯỢNG TỪ**, phát biểu **cái nó PHẢI LÀ**.
- ⚠⚠ **MỚI — kiểm LƯỢNG TỪ của mọi luật: "tồn tại" hay "với mọi"?** Ba luật ngôn ngữ từng là *tồn tại* nên mảnh ASCII lọt vào bản `vi`/`zh` **không vi phạm gì**.
- ⚠⚠ **MỚI — "hàng rào KHÔNG AI CANH"**: *"ai gỡ nó cũng không thấy ca nào đỏ"* **KHÔNG** phải lý do không canh — nó **CHÍNH LÀ** lý do phải canh. Pha 5 gặp **hai** lần.
- ⚠⚠ **MỚI — độc lập về NGUỒN không đảm bảo độc lập về SAI LẦM.** Hai cổng "độc lập" cùng canh **TẬP** thay vì **ÁNH XẠ** ⇒ hoán vị hai giá trị giữ nguyên tập, cả hai xanh.
- ⚠ **KHÔNG** trainer, **KHÔNG** `kb:sync`, **KHÔNG** DDL/seed. **KHÔNG tự sinh sub-agent.** **243+ mục bẩn** — không đụng.
- ⚠ **Nợ CÓ TRƯỚC, KHÔNG phải phát hiện:** `canUseAgentic({role:"engineer"})` · flake `wiring.inprocess` + `visionControl.tools` (riêng file xanh) · 16 file đỏ `server/routers/**` · 10 ca đỏ `server/services/ai/**` (`42501`).

**Cổng kiểm chung:** dùng **nguyên khối lệnh** ở §"Cổng kiểm chung" của kế hoạch Pha 5 (11 đường, đã vá). ⚠ `server/services/vram/vramPha5Gate.test.ts` cưỡng chế danh sách ấy — **thêm lưới mới thì phải cập nhật cổng**, nếu không nó ĐỎ.

---

### Task 1: M-4 — step-up 2FA đóng ở MÁY CHỦ, không chỉ ở UI

**Nợ đang SỐNG, đo được ở nghiệm thu Pha 5:** `engineer1` gọi `vram.preempt` **không có `totpCode`** vẫn **qua** step-up, vì cache **10 phút** theo `sessionToken` dùng chung **mọi** `deployProcedure`. Giao diện hỏi OTP **mỗi lần bấm** ⇒ **UI che, máy chủ không đóng**.

⚠ Đây **đúng lớp "mặt đọc hứa nhiều hơn mặt lệnh"**, chiều ngược: UI **chặt hơn** máy chủ, nên người đọc mã UI sẽ tưởng đã đóng.

**Files:** `server/_core/trpc.ts` (`requireFreshTotp`) · `server/routers/vramRouter.ts` · test cạnh chúng

- [ ] **Bước 1: ĐO trước.** Dựng lượt gọi `preempt` **không `totpCode`** sau khi đã có một lượt step-up khác trong 10 phút ⇒ ghi lại nó **qua được**. Đây là ca ĐỎ.
- [ ] **Bước 2: đếm bề mặt.** `git grep` mọi thủ tục dùng `requireFreshTotp`. **Ghi bảng** — đổi ngữ nghĩa cache sẽ chạm **tất cả**. ⚠ Bài học Pha 5: **đếm trước khi đổi một bit dùng chung** (`canDelete` gánh 10 thủ tục).
- [ ] **Bước 3: chọn hình dạng và VIẾT LÝ DO.** Hai đường: (a) cache **theo thủ tục**, không theo phiên; (b) lệnh phá huỷ đòi `totpCode` **tường minh mỗi lượt**. Nêu đường **không chọn** và vì sao.
- [ ] **Bước 4: cài.** ⚠ **Chỉ THU HẸP**, không nới gì.
- [ ] **Bước 5: đột biến.** Bỏ phép siết ⇒ ca đỏ · gọi **có** `totpCode` hợp lệ ⇒ **vẫn qua** (đối chứng dương) · một thủ tục `deployProcedure` **khác** ⇒ **không bị bắt nhầm**.
- [ ] **Bước 6: commit.**

**Cổng ra:** lệnh phá huỷ VRAM **không** qua được bằng OTP của một lượt khác; lượt có OTP đúng **vẫn qua**.

---

### Task 2: `effectiveBytes` — bẫy đo lường phải KHÔNG DÙNG ĐƯỢC làm bằng chứng

**Nợ:** trôi **426 MiB** giữa hai lượt đọc cách vài giây, thuần theo `foreign.ageMs` (margin leo 0 → 1.073.741.824 B trong ~5 s). ⚠ **Pha 4 dùng nó làm bằng chứng "không đổi" và TRÚNG NHỜ MAY.**

**Files:** `server/services/vram/vramReadModel.ts` · test cạnh nó

- [ ] **Bước 1: tái lập phép trôi**, ghi số. Nếu không tái lập được thì **điều tra, đừng đi tiếp**.
- [ ] **Bước 2: ĐỔI KIỂU** để `effectiveBytes` **không dùng được** làm bất biến so-sánh-trước-sau — ví dụ gói nó cùng `ageMs`/`marginBytes` để người đọc **buộc phải thấy** nó phụ thuộc thời gian. ⚠ Phép thử: viết một ca so `effectiveBytes` trước/sau ⇒ **`tsc` phải ĐỎ** hoặc lưới phải đỏ.
- [ ] **Bước 3: ghi bất biến ĐÚNG vào docstring**: `rawBytes` + `localBytes` + danh sách hộ + `nvidia-smi`. ⚠ **Docstring phải KHỚP mã** — Pha 5 gặp **ba** lần docstring mâu thuẫn hợp đồng, một lần **ban phước cho lỗi**.
- [ ] **Bước 4: đột biến.** Dùng `effectiveBytes` làm bằng chứng trước/sau ⇒ ca đỏ · dùng `rawBytes` ⇒ **xanh**.
- [ ] **Bước 5: commit.**

**Cổng ra:** không viết ra được một ca dùng `effectiveBytes` làm bất biến trước/sau.

---

### Task 3: F2 — 8 tool `readToolsProgramming` với tới được từ đường Agent

**Nợ Pha 4, vẫn mở.** `extractArgsForTool` có **41 `case`** và **0** cho nhóm này ⇒ đường Agent ngôn ngữ tự nhiên **không với tới**; **hai ranh giới an ninh** (chặn đường dẫn · hộp cát) **chưa từng chạy** trên đường đó.
⚠ Pha 4 từng khai nhóm này *"bất khả đạt"* — **SAI**: `classifyToolIntentLLM` (đang BẬT) **không đi qua** `extractArgsForTool`, reviewer chạy được **cả 8** bằng stub.

**Files:** `server/services/aiLocalTools/**` · test cạnh

- [ ] **Bước 1: đếm và liệt kê** đúng 8 tool + tham số bắt buộc của từng cái. **Tự `git grep`, đừng tin tài liệu này.**
- [ ] **Bước 2: ca ĐỎ trước** — hỏi bằng ngôn ngữ tự nhiên ⇒ tool **được chọn VÀ nhận đủ tham số**.
- [ ] **Bước 3: cài `case` còn thiếu.** ⚠ **Đảo lượng từ**: dựng lưới *"MỌI tool đã đăng ký PHẢI có đường lấy tham số"* — **đừng** liệt kê 8 tên.
- [ ] **Bước 4: nghiệm thu hai ranh giới an ninh** trên đường Agent thật: `read_project_file` với hard link ⇒ **từ chối**; `calc` với biểu thức thoát hộp cát ⇒ **từ chối**. **Đối chứng dương**: file thường đọc được, `calc 2+3*4 = 14`.
- [ ] **Bước 5: đột biến.** Thêm một tool mới **không** có `case` ⇒ ca đỏ.
- [ ] **Bước 6: commit.**

**Cổng ra:** 8/8 tool với tới được; hai ranh giới an ninh **chạy thật** và **chặn thật**.

---

### Task 4: N1 + N4 — hai bề mặt CHƯA TỪNG CHẠY

**N1 — `releaseStale` chưa một lượt thành công qua HAI pha.** Topology một tiến trình ⇒ không bao giờ có hàng ma. Đường **phá huỷ** này chưa ai chứng minh.
**N4 — mặt SUY GIẢM chưa từng render**, hai lượt nghiệm thu liên tiếp 5/5 ảnh đều `tin cậy`.

- [ ] **Bước 1: dựng cảnh cho N1** — hai tiến trình thật (Pha 3 đã làm được: `ROLE=api PORT=3100`), giết một, để lại hàng ma, rồi `releaseStale`. ⚠ Nếu **không dựng được** thì ghi rõ **vì sao** và **cách duy nhất dựng được** — **không** bỏ qua im lặng.
- [ ] **Bước 2: đo** — hàng rời sổ, `nvidia-smi` trước/sau, và câu chữ trả về **nói đúng chuyện gì đã xảy ra**.
- [ ] **Bước 3: dựng cảnh cho N4** — ép mặt đọc vào từng trạng thái suy giảm (`blind` · `ledger-only` · `trusted:false` · tick cũ · `-Infinity`), **render thật, tự chụp, tự đọc**.
- [ ] **Bước 4:** ⚠ **TỰ CHỤP VÀ TỰ ĐỌC** — subagent tự nghiệm thu thị giác **không đáng tin**. **Ảnh trắng = thất bại khởi động.**
- [ ] **Bước 5: commit** báo cáo + ảnh vào `docs/superpowers/reports/`.

**Cổng ra:** `releaseStale` có **một lượt thành công đo được**; **mọi** trạng thái suy giảm có **một ảnh đọc được bằng mắt**.

---

### Task 5: I-2 đầu thứ ba — sổ chung thôi cắt `owner` ÂM THẦM

**Nợ:** sổ chung cắt `owner` **không cờ** ⇒ danh tính hộ anh em **mất chữ mà không ai biết**. Pha 5 đóng đầu **đọc**, để hở đầu **ghi**.
⚠ Đóng đúng cách cần **DDL nới cột** **hoặc** **đổi kiểu**. **KHÔNG tự chạy DDL** — khai rõ và hỏi.

- [ ] **Bước 1: đo** — `max(length(owner))` hiện tại vs trần; và **`owner` sản xuất dài nhất có thể** (nó dựng từ **đường dẫn tuyệt đối**, `ocrService.ts:384`).
- [ ] **Bước 2:** chọn **đổi kiểu** (mang cờ `daCat`) hoặc **nới cột** (DDL — **hỏi trước**). Nêu đường không chọn và vì sao.
- [ ] **Bước 3: ca ĐỎ** — `owner` vượt trần ⇒ **phải khai đã cắt**, không im lặng.
- [ ] **Bước 4: đột biến** — bỏ cờ ⇒ ca đỏ · `owner` **đúng bằng trần** ⇒ **không** khai là đã cắt (biên).
- [ ] **Bước 5: commit.**

**Cổng ra:** không còn đường nào cắt `owner` mà không khai.

---

## Sau khi xong 5 task

- **Review TOÀN NHÁNH** trên model mạnh nhất. ⚠ **TÁM pha liên tiếp, lượt này bắt được thứ review-theo-task KHÔNG THỂ bắt.** Đừng bỏ.
- Lăng kính: **"an toàn là HỆ QUẢ của thứ khác đang hỏng"** (đã **năm** lần — tìm lần thứ sáu) · **"hàng rào không ai canh"** · **"lượng từ sai"** · **"độc lập về nguồn ≠ độc lập về sai lầm"**.
- Push · memory · đối chiếu lại backlog: mục nào **đóng**, mục nào **còn**, mục nào **MỚI SINH RA từ chính lượt trả nợ này** (Pha 5 đẻ nợ nặng hơn **hai** lần).

## KHÔNG làm ở Pha 6 — cần chủ dự án quyết

- **9 thủ tục** còn trên `machine_control/canDelete` (nguy nhất `programming.deleteProject` — xoá **cascade mã nguồn**, không OTP) — quyết định RBAC toàn hệ.
- **31 thủ tục** trên `machine_control/canView`, **31/31 `protectedProcedure` trần** — đã mở từ 2026-07-10, **không** do Pha 5.
- Step-up **hở** ở `orchestration.deployWorkflow` + `programming.deployBuild`.
- **6 tên module** dùng qua `requirePermission` **không có** trong `PERMISSION_MODULES`.
- **brand `input`** của lệnh (thứ duy nhất bảo vệ người gọi **chưa tồn tại**) · **harness render `.tsx`** (repo **0** file `*.test.tsx`).

---

### Task 1b: SIẾT NỐT 5 thủ tục `deployProcedure` còn lại (quyết định chủ dự án 2026-08-06)

**Vì sao có task này.** Task 1 siết `requirePerCallFreshTotp` cho **hai** lệnh phá huỷ VRAM, và **hoãn** 5 thủ tục còn lại với lý do *"`deployToFleet` chạy 200 máy, `deployBuild` gọi tuần tự từng máy ⇒ siết toàn cục sẽ gãy giữa chừng"*.

⚠⚠ **Review Task 1 chứng minh lý do ấy SAI SỰ THẬT:** vòng lặp fleet nằm **TRONG MÁY CHỦ, trong MỘT request tRPC** (`fleetRollout.ts:229,266` → `programmingService.ts:818` — lời gọi hàm, **không qua middleware**). Client gọi **đúng một lần**, và **5/5** điểm gọi client **đã bọc `stepUp.guard` và đã gửi `totpCode`**.
⇒ **Không còn rào cản kỹ thuật nào.** Chủ dự án chốt: **SIẾT NỐT.**

**Năm thủ tục:** `orchestration.deployWorkflow` · `programming.deployBuild` · `programming.approveDeployment` · `programming.rollbackDeployment` · `programming.deployToFleet`.

**Đóng luôn mối lo #1 của Task 1:** hôm nay một lượt VRAM có OTP **hâm nóng cache dùng chung** ⇒ sau `preempt`, `deployBuild` chạy **10 phút không hỏi mã**. Siết nốt là hết.

- [ ] **Bước 1: ĐO trước, từng thủ tục.** Với **mỗi** cái trong 5: dựng lượt gọi **không `totpCode`** sau một lượt step-up khác trong 10 phút ⇒ ghi lại nó **qua được**. **Năm ca ĐỎ**, không phải một.
- [ ] **Bước 2: xác minh lại tiền đề** (đừng tin tài liệu này): `git grep` từng điểm gọi client của 5 thủ tục ⇒ **có bọc `stepUp.guard`** và **có gửi `totpCode`** không? ⚠ Nếu **một** cái không ⇒ **DỪNG VÀ HỎI**, đừng siết mù.
- [ ] **Bước 3: cài.** Dùng **đúng** `requirePerCallFreshTotp` của Task 1 — **đừng viết vị từ thứ hai**.
- [ ] **Bước 4: ĐỐI CHỨNG DƯƠNG cho từng thủ tục** — lượt **có** `totpCode` hợp lệ ⇒ **vẫn qua**. ⚠ Không có nó thì bản vá **chặn hết** cũng xanh.
- [ ] **Bước 5: đột biến.** Gỡ phép siết ở **mỗi** thủ tục ⇒ ca đỏ đích danh · một thủ tục **KHÔNG** thuộc 5+2 ⇒ **không bị bắt nhầm** · **thủ tục MỚI** chain `deployProcedure` trong **file mới** ⇒ ca đỏ (**phép thử M3**).
- [ ] **Bước 6:** ⚠ **Đảo lượng từ** — sau task này, bất biến đúng là ***"MỌI thủ tục chain `deployProcedure` PHẢI chain `requirePerCallFreshTotp`"***, tức **gộp vào chính `deployProcedure`** thay vì chain tay 7 chỗ. Cân nhắc và **viết lý do** nếu không chọn.
- [ ] **Bước 7: commit.**

**Cổng ra:** cả **7** thủ tục (2 VRAM + 5 này) **không** qua được bằng OTP của một lượt khác; **7/7** lượt có OTP đúng **vẫn qua**; thủ tục ngoài tập **giữ nguyên** cache phiên.

⚠ **Còn mở sau task này** (khai, không vá): **không chống phát lại** — cùng một mã dùng lại được **~90 s** (`speakeasy window:1`). Đóng nó cần **cơ chế MỚI** (sổ mã đã dùng) ⇒ mục riêng, cần chủ dự án duyệt.

---

## QUYẾT ĐỊNH CHỦ DỰ ÁN 2026-08-07 (sau review toàn nhánh Pha 6)

**1. Redeploy — ĐÃ LÀM.** PID 30108 (bản `ebfec4a5`) đã tắt theo PID; build lại; PID mới **35216**, health **200**. Server và client nay **cùng một bản** ⇒ C-1 (`/ai-brain` trắng trang) hết hiệu lực trên hệ đang chạy.

**2. BA tuyến REST deploy — GHI NHẬN, KHÔNG SIẾT.**
`POST /api/v1/equipment/:id/commands` · `/api/v1/orchestration/workflows` · `/api/v1/orchestration/runs` **deploy được chỉ bằng API key**, **không** step-up 2FA, **không** role-floor; bản ghi để lại `createdBy: null`. Probe thật: **201 + 2 lượt INSERT**.

⚠⚠ **ĐÂY LÀ TRẠNG THÁI CÓ CHỦ Ý, KHÔNG PHẢI LỖ HỔNG BỎ QUÊN.** Lý do: REST là bề mặt **máy-gọi-máy** (SDK, tích hợp ngoài, edge); siết nó sẽ **gãy hợp đồng API** với mọi máy đang gọi. Nợ **CÓ TRƯỚC** module VRAM (`59948375`, 2026-06-28).

⇒ **Bất biến ĐÚNG, phải viết đúng ở mọi chỗ nhắc tới:**
> *"Lệnh deploy qua **tRPC** đòi OTP mỗi lượt. Qua **REST** thì **KHÔNG** — cổng duy nhất là API key."*

⚠ **Câu SAI phải xoá nếu gặp:** *"deploy workflow luôn cần OTP"* — nó đúng cho **một** cửa vào, sai cho cửa kia. Đúng lớp *"lưới theo FILE, không theo ĐƯỜNG THOÁT"*, ở tầng **giao thức**.

**3. Chống phát lại — LÀM. Xem Task 6.**

---

### Task 6: CHỐNG PHÁT LẠI mã OTP (quyết định chủ dự án 2026-08-07)

**Nợ:** cùng một mã OTP **dùng lại được ~90 giây** (`speakeasy` `window:1` — chấp nhận mã của nhịp trước để bù lệch đồng hồ). Pha 6 đã siết cửa sổ **10 phút → ~90 s** (**6,7×**), nhưng **không** đóng được phát lại: đó cần **một cơ chế MỚI**.

**Kịch bản hỏng:** ai đọc trộm được mã (nhìn màn hình · log · chụp gói tin) có **~90 giây** để dùng lại nó trên **một lệnh khác**.

**Cổng ra:** một mã OTP tiêu được **ĐÚNG MỘT LẦN**; lượt thứ hai với **cùng mã** ⇒ **từ chối**, kể cả trong cửa sổ hợp lệ.

- [ ] **Bước 1: ĐO trước.** Dựng hai lượt gọi liên tiếp với **cùng một mã** trong ~90 s ⇒ ghi lại lượt thứ hai **qua được**. Đây là ca ĐỎ.
- [ ] **Bước 2: đếm bề mặt.** `git grep` mọi chỗ xác minh TOTP. ⚠ Bài học đã lật quyết định **bốn lần**: **đếm trước khi đổi một cơ chế dùng chung**.
- [ ] **Bước 3: chọn hình dạng, VIẾT LÝ DO.** Sổ mã đã dùng: trong bộ nhớ (mất khi restart) · trong DB (**cần DDL — HỎI TRƯỚC**) · trong bảng phiên đã có. Nêu đường **không chọn** và vì sao. ⚠ Nhớ topo **nhiều tiến trình** — sổ trong bộ nhớ **không** chặn được lượt phát lại đi vào tiến trình khác.
- [ ] **Bước 4: cài.** ⚠ **Chỉ THU HẸP.** Giữ nguyên mọi tầng đang có.
- [ ] **Bước 5: ĐỐI CHỨNG DƯƠNG bắt buộc** — mã **mới, hợp lệ** ⇒ **vẫn qua**. Không có nó thì bản vá **chặn hết** cũng xanh.
- [ ] **Bước 6: đột biến.** Bỏ sổ ⇒ ca đỏ · cùng mã **ở tiến trình khác** ⇒ ca đỏ · mã mới ⇒ **vẫn qua** · một thủ tục **ngoài** tập ⇒ **không bắt nhầm**.
- [ ] **Bước 7:** ⚠ **Đảo lượng từ** — luật phải là ***"MỌI lượt xác minh TOTP đều đi qua sổ"***, suy từ bộ suy đã có (`deployProcedureScan.ts`), **không liệt kê**.
- [ ] **Bước 8: commit.**

⚠ **Sổ phải TỰ DỌN** — nếu không nó phình vô hạn. Và **KHÔNG được** dựng người ghi/người đọc **mới** cho một bất biến đã có chủ.
