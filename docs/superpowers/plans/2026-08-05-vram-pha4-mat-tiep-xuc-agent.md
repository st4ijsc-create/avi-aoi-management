# Pha 4 — Mặt tiếp xúc backend cho AI Agent: lắp KIM vào những chiếc đồng hồ đã dựng

> **Cho người thực thi bằng agent:** BẮT BUỘC DÙNG SUB-SKILL `superpowers:subagent-driven-development`. Các bước dùng cú pháp checkbox (`- [ ]`).

**Mục tiêu:** Cho AI Agent **truy vấn được trạng thái VRAM** và **ra lệnh được**, có phân quyền. Đây là pha cuối của spec, và là bước biến cơ chế của bảy pha trước thành thứ Agent **dùng được** — đúng yêu cầu gốc của chủ dự án: *"AI Agent cần nắm rõ cả hệ sinh thái và có thể quản lý, bảo hành hệ sinh thái, thay vì chỉ giới hạn trong một kịch bản cụ thể."*

**Kiến trúc:** Router tRPC đọc **sổ chung** (`vram_leases`) + **nhật ký** (`vram_events`) + **kết quả tick gần nhất**. Lệnh đi qua broker/preempt **đã có**, không dựng đường thứ hai.

⚠ **Pha 4 KHÔNG đổi hành vi cấp phát.** Nó **phơi ra** và **ra lệnh**, không tự quyết. Mọi lệnh phải đi qua đúng cơ chế Pha 2B/3 đã dựng.

**Tech Stack:** TypeScript · Node 24 · Vitest · tRPC · Drizzle/Postgres · i18next

---

## ★★★ ĐIỀU LÀM PHA NÀY KHÁC MỌI PHA TRƯỚC

Bảy pha vừa rồi để lại một danh sách dài những **"đồng hồ không kim"** — số đã chảy tới cửa quyết định, cửa chưa mở. **Pha 4 là nơi chúng có người đọc**, hoặc bị xoá.

| Ô | Ai dựng | Người tiêu thụ hôm nay |
|---|---|---|
| `getKbSyncSchedulerStatus().defer` | 2B Task 6 | **không ai** |
| `trusted` / `degradedReasons` | 3 Task 2 | chỉ trong module |
| `baselineUnverifiedReasons` | 3 Task 3 | chỉ trong module |
| `vramBeginFailureState()` | 2B Task 3 | chỉ trong module |
| `foreignLedgerBytes` / `foreignLeases` | 3 Task 2/5 | câu từ chối (một phần) |
| `VRAM_SIDECAR_TTL_MS` | — | **không ai** |

⚠ **Quy tắc của pha:** mỗi ô ở trên phải **có người đọc** sau Pha 4, **hoặc** bị **xoá kèm lý do**. Không được để nguyên. Giữ một ô không ai đọc là giữ một lời hứa không ai giữ.

> 🔴 **ĐÍNH CHÍNH (2026-08-05, review Task 1) — bảng trên SAI một hàng, và luật của Task 4 BỊ VÒNG TRÒN.**
>
> 1. **Hàng 1 sai từ Pha 3**: `getKbSyncSchedulerStatus()` **đã có** người tiêu thụ — `aiLocalKnowledgeService.ts:1486-1492`.
> 2. ⚠⚠ **Luật *"nối vào router HOẶC xoá"* không đóng được gì**, vì *"nối vào router"* **chính là việc Task 1 vừa làm** ⇒ một ô không ai đọc chỉ **dời ra sau một endpoint không ai gọi**. Nguyên văn lời tự khai của Task 1: *"nếu dừng ở đây thì chỉ là dời đồng hồ không kim ra sau một endpoint."*
> 3. **Và AI Agent của repo này KHÔNG tiêu thụ qua tRPC** — nó đi qua `aiLocalTools/toolRegistry.ts`. Task 1 dựng cửa cho **người**, không phải cho **Agent**.
> 4. Đã có một **đồng hồ VRAM CÓ người đọc nói SỐ KHÁC**: `AIBrainDashboard.tsx:145` ← `trpc.aiGguf.health` — số **thô**, **không qua broker**. Hai nguồn số cho cùng một thứ là lớp lỗi "hai bản sao vị từ".
>
> **⇒ CỔNG RA CỦA TASK 4 ĐỔI THÀNH:** `git grep` phải cho **≥1 điểm gọi thật NGOÀI** `server/routers/**` **và ngoài** `server/services/vram/**`. Người đọc thật tối thiểu: **một `Tool` đăng ký trong `toolRegistry`** (để Agent dùng được) **và** panel `AIBrainDashboard` chuyển sang nguồn qua broker (để hai đồng hồ thôi nói hai số).

---

## Global Constraints

1. ⚠⚠ **`reserve()` PHẢI GIỮ ĐỒNG BỘ.** Lá chắn cấu trúc từ Pha 1. Router **không được** làm nó `await` thêm gì.
2. **KHÔNG dựng đường thứ hai.** Lệnh của Agent đi qua **đúng** `broker.preempt()` / `reserve()` / cơ chế hoãn đã có. Hai đường là hai bản sao vị từ.
3. 🔴 **PHÂN QUYỀN LÀ BẮT BUỘC.** Lệnh **giết được tiến trình** và **thu hồi được VRAM của người khác**. Theo đúng khuôn RBAC + `role-floor` sẵn có trong repo — **đừng phát minh khuôn mới**. Lệnh phá huỷ phải ở mức quyền **cao nhất** dùng cho actuation.
4. **Đơn vị nội bộ luôn là BYTE**; MiB chỉ ở câu chữ. **Đ4 — không trộn hai thước.**
5. **Không giá trị không hữu hạn nào** ra API hay vào ống dẫn sự kiện (cột `bigint` ⇒ mất **cả lô**; `jsonb` ⇒ `null` im lặng; **cột CHUỖI phải cắt**).
6. 🔴 **LƯỚI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE** — tái diễn **MƯỜI** lần. Ca phải đi qua **đường thật**, đọc **đúng object mã sản xuất gửi đi**; **fixture khác nhau ĐÚNG Ở CHIỀU đang kiểm**.
7. **`?? <mặc_định>` là một DÂY — dây phải có LƯỚI.**
8. **Hai bản sao vị từ trùng nhau dưới một bất biến ⇒ ĐỔI KIỂU**, đừng thêm ca.
9. **"Đặt cờ trước lời gọi có thể ném, gỡ ngoài `finally`"** ⇒ chốt kẹt vĩnh viễn.
10. **Vị từ dùng chung: liệt kê MỌI nơi tiêu thụ, kiểm TỪNG nơi, ghi bảng.**
11. **Câu chữ KHÔNG được hứa nhiều hơn dữ liệu** — lớp lỗi này đã bắt **chín lần**. Agent đọc API này để **quyết định**; một trường nói quá sẽ thành một hành động sai.
12. ⚠ **`tsc` chính KHÔNG canh file test** — dùng `npm run check:tests` (cổng mới, danh sách cách ly 174 file). **File test MỚI được canh mặc định** ⇒ đừng thêm vào danh sách cách ly.
13. ⚠⚠ **"ĐÃ SỬA" chỉ đúng khi `git show <commit>:<file>` xác nhận.**

---

### Task 1: Router ĐỌC — phơi trạng thái, không hứa quá

**Files:** `server/routers/vramRouter.ts` (mới) · test kề bên · nối vào router gốc.

**Phải phơi:** sổ chung (cục bộ + anh em, **phân biệt được**) · `headroom` kèm **`basis`** và **`blind`** · `trusted` + `degradedReasons` · `baselineVerified` + `baselineUnverifiedReasons` · `attributable`/`ledgerTotal` · tuổi tick · trạng thái hoãn của **cả 6 hộ `background`** · `vramBeginFailureState()`.

⚠ **Mỗi trường phải nói đúng độ chắc chắn của nó.** Ví dụ bắt buộc:
- `unledgeredBytes` là **ƯỚC LƯỢNG**, và `unknownCount > 0` làm nó **mất tin cậy** — API phải nói ra, không để Agent tưởng đó là số đo.
- Danh sách "đang giữ" chỉ phủ **hộ đã nối** (14–15 điểm trên ~160 dòng liệt kê, và bản liệt kê **tự khai là CẬN DƯỚI**) ⇒ phải có trường nói rõ **phần không quy trách nhiệm được**.
- `attributable = null` là **CHẶN TRÊN**, không phải "không biết" trung tính.

- [ ] **Bước 1: Đọc mã trước** — khuôn router trong `server/routers/`, khuôn RBAC, và các ô ở bảng "đồng hồ không kim".
- [ ] **Bước 2: Test thất bại trước** — ca khẳng định **mỗi** trường độ-chắc-chắn có mặt và đúng giá trị ở **cả hai** chiều.
- [ ] **Bước 3–5:** đỏ → cài đặt → xanh + `--sequence.shuffle.tests`.
- [ ] **Bước 6: Đột biến** — bỏ trường "không quy trách nhiệm được" ⇒ ca đỏ · cho `unledgeredBytes` ra ngoài **không kèm** cảnh báo `unknownCount` ⇒ ca đỏ · cho một giá trị không hữu hạn lọt ra API ⇒ ca đỏ.
- [ ] **Bước 7: Commit.**

---

### Task 2: Router RA LỆNH — có phân quyền, đi qua cơ chế đã có

**Lệnh tối thiểu:** `preempt(owner)` (thu hồi một hộ **thu hồi được**) · `releaseStale(leaseId)` (dọn hàng ma đã chứng minh) · `retryDeferred(owner)` (đẩy một hộ `background` đang hoãn thử lại ngay).

⚠⚠ **`preempt` GIẾT ĐƯỢC TIẾN TRÌNH.** Pha 3 vừa vá một Critical đúng ở đường này: **giết nhầm rồi báo cáo thành công**, vì đường phá huỷ **không hỏi `ctime`** dù bằng chứng nằm sẵn trong cấu trúc.
⇒ Lệnh của Agent **phải đi qua đúng đường đã vá**, và **phải trả về bằng chứng**: `reclaimed` / `failed` / `freedBytes`, kèm lý do khi `failed`. **Không được** khai thành công khi byte chưa nhả.

- [ ] **Bước 1: Đọc mã trước** — `broker.preempt()`, `coThiHanhThuHoi()`, khuôn RBAC + `role-floor` cho actuation.
- [ ] **Bước 2: Test thất bại trước** — quyền thấp ⇒ **từ chối**; hộ **không thu hồi được** ⇒ từ chối **có lý do**, không "im lặng thành công"; hộ **đang bận** ⇒ không bị đụng.
- [ ] **Bước 3–5:** đỏ → cài đặt → xanh.
- [ ] **Bước 6: Đột biến** — bỏ kiểm quyền ⇒ ca đỏ · khai thành công khi `freedBytes = 0` ⇒ ca đỏ · gọi thẳng `process.kill` thay vì qua đường đã vá ⇒ ca đỏ.
- [ ] **Bước 7: Commit.**

---

### Task 3: Câu chữ cho người vận hành + Agent (i18n)

Nối vào hệ mã lỗi Sprint 5 (`client/src/lib/errorCodes.ts`), **ba ngôn ngữ**, theo đúng khuôn có sẵn.

⚠ **Bẫy đã trả giá ở Pha 2B:** `sanitizeFreeParams` từng là **một lượt quét**, nên payload tự huỷ **tái tạo cú pháp sau khi làm sạch**; một biến thể làm `i18n.t()` **không trả về** (treo worker **>8 phút**). Bề mặt thật: **id model trong DB · `.env` · tên tệp `.gguf`** — và nay **thêm** tên hộ đến từ **tiến trình khác**.
⇒ Mọi giá trị đi vào câu chữ phải qua **cùng** hàm làm sạch đã có (**bất động**: `S(S(x)) === S(x)`), **đừng viết hàm thứ hai**.

- [ ] **Bước 1–5:** đọc khuôn → test đỏ → cài đặt → xanh → `i18n:check` 0 lệch.
- [ ] **Bước 6: Đột biến** — cho một tên hộ chứa cú pháp i18next đi thẳng vào câu ⇒ ca đỏ.
- [ ] **Bước 7: Commit.**

---

### Task 4: Trả nốt "đồng hồ không kim" — mỗi ô CÓ NGƯỜI ĐỌC hoặc BỊ XOÁ

Đi qua **từng** ô ở bảng đầu kế hoạch. Với mỗi ô: **nối vào router** (Task 1/2) **hoặc xoá kèm lý do**. **Không để nguyên.**

⚠ `VRAM_SIDECAR_TTL_MS` **chưa ai tiêu thụ** — hoặc nối, hoặc xoá.
⚠ `getKbSyncSchedulerStatus().defer` — **cả 6 hộ `background`**, không chỉ `kb:sync`. Nhớ: 3/6 hộ **không hoãn** (suy giảm tại chỗ) — API phải phân biệt **"đang hoãn"** với **"không có cơ chế hoãn"**, đừng gộp.

- [ ] **Bước 1: Bảng kiểm** — liệt kê từng ô, trạng thái sau task, và lý do nếu xoá. Vào báo cáo.
- [ ] **Bước 2–6:** test đỏ → cài đặt → xanh → đột biến (xoá một người đọc ⇒ ca đỏ).
- [ ] **Bước 7: Commit.**

---

### Task 5: Nghiệm thu SỐNG — Agent thật truy vấn và ra lệnh

⚠ **Không thể thay bằng test.** Bảy pha vừa rồi, **nghiệm thu sống bắt được ba thứ mà không suy luận nào thấy** — trong đó một khuyết tật chỉ lộ ra khi chạy thật (*"một nhịp vứt đi bằng chứng của chính nó"*).

- [ ] **Bước 1:** dựng trạng thái thật — sidecar `llama-server` thật giữ ~7,8 GB.
- [ ] **Bước 2:** Agent **truy vấn** ⇒ thấy đúng hộ, đúng số byte, đúng cờ độ-chắc-chắn. Ghi số thô.
- [ ] **Bước 3:** Agent **ra lệnh thu hồi** ⇒ `nvidia-smi` xác nhận byte **thật sự nhả**; API trả `freedBytes` khớp.
- [ ] **Bước 4:** ra lệnh với **quyền thấp** ⇒ **bị từ chối**, và **không byte nào đổi**.
- [ ] **Bước 5:** ra lệnh lên một hộ **không thu hồi được** ⇒ **thất bại trung thực**, không "im lặng thành công".
- [ ] **Bước 6: Commit + báo cáo.**

⚠ Không nối ống stdio vào tiến trình con. Dọn theo **đúng PID** (`nvidia-smi --query-compute-apps=pid`), **không quét mù theo tên**. `getLlama()` **không nạp được** trong `tsx` trần — dùng sidecar thật.

---

## Điều kiện ra của Pha 4

| # | Điều kiện | Cách kiểm |
|---|---|---|
| 1 | Agent **truy vấn** được toàn bộ trạng thái, **mỗi trường nói đúng độ chắc chắn** | test Task 1 + nghiệm thu sống |
| 2 | Agent **ra lệnh** được, **có phân quyền**, lệnh đi qua **cơ chế đã có** | test Task 2 + nghiệm thu sống |
| 3 | **Mọi ô "đồng hồ không kim"** có người đọc **hoặc** bị xoá kèm lý do | bảng kiểm Task 4 |
| 4 | Câu chữ ba ngôn ngữ, **không đường tiêm nào**, `i18n:check` 0 lệch | test Task 3 |
| 5 | Lệnh phá huỷ **không bao giờ khai thành công khi byte chưa nhả** | test Task 2 + nghiệm thu sống bước 5 |
| 6 | `npx vitest run server/services/vram/` xanh kể cả shuffle · `npm run check` **và** `npm run check:tests` exit 0 · `i18n:check` 0 lệch | trước push |

⚠ **`reserve()` vẫn phải ĐỒNG BỘ** sau pha này — kiểm bằng mã, không bằng chữ ký.
⚠ Nếu một điều kiện **không đạt**, ghi thẳng là **không đạt**. Tiền lệ: Pha 1 công bố cổng ra **chưa đạt**, và đó là kết quả **đúng**.
