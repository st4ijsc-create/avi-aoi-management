# Pha 4 — Task 5: NGHIỆM THU SỐNG (Agent thật truy vấn và ra lệnh)

**Nhánh:** `feat/hmi-dep` · **HEAD lúc bắt đầu:** `552b0c0e` · **Ngày đo:** 2026-08-05
**Kế hoạch:** `docs/superpowers/plans/2026-08-05-vram-pha4-mat-tiep-xuc-agent.md` §Task 5 (kèm T5-A, T5-B, N-7, N-8)

> ⚠ Task này **ĐO**, không sửa. Không một dòng mã sản xuất nào bị đổi để một lượt nghiệm thu qua.
> `git status --porcelain -- server/ client/` **RỖNG** trước khi bắt đầu (kiểm lúc 22:26).

---

## 0. Hệ được đo — thật, không dựng cảnh tắt

| Thành phần | Giá trị đo được | Nguồn |
|---|---|---|
| Tiến trình ứng dụng | `npm run dev` (tsx, `server/_core/index.ts`), **PID 2128**, `http://localhost:3000` | `netstat -ano`, log khởi động |
| `processKey` của broker | `all:2128:1785943999021` | `vram.state.processKey` |
| DB | `127.0.0.1:5434/aoi_management`, **vai kết nối `avi_app`** (không phải `aoi` — bản đầu ghi sai; đo lại bằng `select current_user` ⇒ `avi_app`) | `.env` + `current_user` |
| GPU | RTX 5090, **32.607 MiB** tổng | `nvidia-smi` |
| Model ĐÃ NẠP THẬT | Qwen3-30B-A3B-Instruct (deep), Qwen3-4B-Instruct (fast), Qwen3-Embedding-0.6B, bge-reranker-v2-m3 | log `[aiGgufEngine] Loading model:` |
| `AI_TOOL_LLM_FALLBACK` | `1` (BẬT) | `.env:208` |
| `ACTUATION_STEPUP_2FA` | `true` (BẬT) | `.env:568` |
| `AI_AGENTIC_ENABLED` | `1` (BẬT) | `.env:448` |

**Đường Agent được dùng cho mọi lượt T5-A:** `POST /api/ai/local-kb/stream`
→ `sdk.authenticateRequest(req)` (phiên THẬT, cookie thật)
→ `buildExecCtx(user, …)` → `streamAnswer()` → **`tryExecuteTool()`** → `argsWithAuthCtx()` → `tool.handler()` → `checkPermission()` (DB thật).

⚠ **Đây là ĐẦU ĐƯỜNG, không phải một seam.** Không lượt nào tiêm `__authCtx` bằng tay — đúng thứ mà "215/215 xanh" của Task 4 **không** chứng minh được.

### Tài khoản dùng để đo (không tạo mới, không đổi quyền của ai)

| user | id | role | `machine_control` | `machine_status` (alias của `machine_monitoring`) | `settings_products` | `analytics_root_cause` |
|---|---|---|---|---|---|---|
| `supervisor1` | 49 | supervisor | view✓ create✓ **delete✗** | view✓ | view✓ | view✓ |
| `engineer1` | 51 | engineer | view✓ create✓ **delete✗** | view✓ create✓ edit✓ delete✗ | **view✓ create✓ edit✓** (bản đầu ghi "—" là **SAI**) | **KHÔNG CÓ HÀNG** |
| `operator1` | 48 | operator | **KHÔNG CÓ HÀNG** | view✓ | **KHÔNG CÓ HÀNG** | **KHÔNG CÓ HÀNG** |
| `p1_audit_op` | 1545 | operator | **0 hàng quyền nào** | **0** | **0** | **0** |
| `p1_audit_admin` | 1546 | admin | (god-mode) | (god-mode) | (god-mode) | (god-mode) |

⚠ Hai tài khoản `p1_audit_*` là tài khoản kiểm toán **có sẵn của repo** (`scripts/audit/audit-account.mjs`), bị khoá lúc nghỉ. Đã bật để đo và **đã khoá lại** — xem §7.

---

*(báo cáo được ghi DẦN — các mục dưới bổ sung sau mỗi lượt đo)*

## 1. NHÓM 1 — Agent TRUY VẤN: gọi được mặt đọc và nhận SỐ THẬT

**Lượt sống L1** · 22:36 · user `p1_audit_admin` (uid 1546) · `POST /api/ai/local-kb/ask`
Câu hỏi: `"trạng thái vram"` → bộ phân loại chọn **`get_vram_state`** (`provider=tool`), `textSummary` dài **3.517 ký tự**.

Trích nguyên văn ba dòng đầu Agent nhận được:

```
Dư địa hiệu lực: 25.391 MiB (thô 29.487 MiB) · trần 32.607 MiB · đang dùng 2.096 MiB.
basis=ledger-only (MÙ ⇒ con số này là CHẶN TRÊN, không phải trạng thái an toàn) · trusted=false · ĐANG SUY GIẢM vì: probe-blind, unverified-baseline.
attributable KHÔNG BIẾT (probe-blind) ⇒ headroom-upper-bound: dư địa đang là CHẶN TRÊN.
```

⇒ **ĐẠT.** Agent nhận **cả con số LẪN cờ độ-chắc-chắn** trong cùng một bản tóm tắt — đúng điều
`vramTools.tomTat()` tồn tại để giữ. Lượt này bắt được hệ ở **nhịp đo đầu chưa xong**
(`basis=ledger-only`, `blind`, `probe-blind`), tức chính trạng thái mà một bản tóm tắt cẩu thả sẽ
in "còn 25 GB" rồi để Agent đọc một **chặn trên** thành một trạng thái an toàn.

**Lượt sống L2** · 22:55 · **một lượt `fetch` JSON tới `trpc.vram.state`** từ đúng phiên trình duyệt
(`atMs 1785945331310`) — sau khi nhịp đo đã xong.

> 🔴 **ĐÍNH CHÍNH (review) — BẢN ĐẦU TỰ MÂU THUẪN VỚI ẢNH CỦA CHÍNH NÓ.**
> Bản đầu viết *"cùng ảnh chụp"* rồi để bảng dưới đứng cạnh `t5b-01`, trong khi **`t5b-01` in
> `23.387 MiB`** còn bảng ghi **`22.383 MiB`** — lệch **1.004 MiB**, dù mọi ô khác khớp từng MiB.
> **Truy ra rồi, và không ô nào sai — sai là LỜI KHAI về nguồn:**
> • bảng dưới đến từ **lượt `fetch` JSON lúc 22:55** (`effectiveBytes = 23.470.170.112 B` = 22.383 MiB);
> • ảnh **khớp** bảng là **`t5b-00-initial.png`** (in đúng **22.383 MiB**), không phải `t5b-01`;
> • **`t5b-01`** chụp **muộn hơn ~2 phút** và in **23.387 MiB** — một **nhịp poll KHÁC**
>   (`VramBrokerPanel` dùng `usePollingInterval(5000)`, tức panel tự làm mới **mỗi 5 giây**).
> ⇒ Con số VRAM trên panel là **đại lượng ĐANG CHẢY**; hai ảnh chụp cách nhau 2 phút **phải** khác
> nhau. Bài học ghi lại: một báo cáo dán bảng số cạnh một ảnh chụp **khác thời điểm** thì tự huỷ
> giá trị làm bằng chứng của cả hai, kể cả khi cả hai đều đúng.

| ô | giá trị ĐO ĐƯỢC (byte) | quy ra |
|---|---|---|
| `headroom.effectiveBytes` | 23.470.170.112 | 22.383 MiB |
| `headroom.ceilingBytes` | 34.190.458.880 | 32.607 MiB |
| `headroom.basis` / `blind` / `trusted` | `attributable` / `false` / `true` | — |
| `ledger.localBytes` | 7.471.882.240 | 7.126 MiB |
| `ledger.foreign` | `known:true, bytes:0, holders:[]` | **không có tiến trình anh em** |
| `attributable` | `{known:true, bytes:7.499.063.296}` | 7.152 MiB |
| `unattributed.bytes` | 27.181.056 (26 MiB) · `wiredSiteCount 15/159` | — |
| `baseline` | `verified:true, origin:"captured"` | — |
| `tick` | `present:true, ageMs 7.058, stale:false` | — |
| `processKey` | `all:2128:1785943999021` | — |

**Sáu hộ THẬT trong sổ cục bộ** (không phải fixture):

| owner | bytes | reclaim |
|---|---|---|
| `cuda-backend` | 452.595.712 | `no-reclaimer / production-never-preempted` |
| `gguf:Qwen3-Embedding-0.6B-f16` | 1.193.291.776 | **`reclaimable-here / gguf-idle-model`** |
| `gguf-embed-ctx:Qwen3-Embedding-0.6B-f16` | 551.575.552 | `no-reclaimer / busy-in-use` |
| `cuda-backend:reranker` | 0 | `no-reclaimer / busy-in-use` |
| `reranker:D:\SOURCES\16.AI\bge-reranker-v2-m3-Q8_0.gguf` | 0 | `no-reclaimer / busy-in-use` |
| `gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL` | 5.274.419.200 | **`reclaimable-here / gguf-idle-model`** |

---

## 2. NHÓM 3 (một nửa) — vai thấp quyền BỊ TỪ CHỐI, và **KHÔNG BYTE NÀO ĐỔI**

**Lượt sống L3** · 22:57–22:58 · trình duyệt thật, phiên thật **`engineer1` (uid 51, role engineer)**
· màn `/ai-brain` · bấm nút **"Thu hồi (gguf-idle-model)"** của hộ `gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL` (5.030 MiB).

Kết quả **ĐO ĐƯỢC** (console của trình duyệt, `.playwright-mcp/console-…log`):

```
[ERROR] Failed to load resource: the server responded with a status of 403 (Forbidden)
        @ http://127.0.0.1:3000/api/trpc/vram.preempt?batch=1
[ERROR] [API Mutation Error] TRPCClientError: Yêu cầu mã xác thực 2 bước (OTP 6 số) cho lệnh điều khiển/triển khai.
```

**Không byte nào đổi** — đo hai đầu:

| thước | TRƯỚC (22:57:19) | SAU (22:58:18) | chênh |
|---|---|---|---|
| `nvidia-smi memory.used` | **8.647 MiB** | **8.656 MiB** | +9 MiB (nhiễu của app đang chạy, **không** phải một lượt nhả) |
| `vram.state.ledger.localBytes` | 7.471.882.240 | **7.471.882.240** | **0** |
| `vram.state.headroom.effectiveBytes` | 23.470.170.112 | **23.470.170.112** | **0** |
| 6 hộ trong sổ | 6 hộ, byte y hệt | **6 hộ, byte y hệt** | **0** |

⇒ **ĐẠT** cho phần "bị từ chối + không tác dụng phụ".

### 🔴 NHƯNG: lượt này bắt được một khuyết tật mà không suy luận nào thấy

Lệnh **dừng ở `requireFreshTotp`, chưa hề tới cổng RBAC** (`requirePermission("machine_control","canDelete")`).
Nguyên nhân là cấu hình ĐANG CHẠY: `.env:568` `ACTUATION_STEPUP_2FA=true`.

`VramBrokerPanel.tsx` gọi `preempt.mutate({ owner: h.owner })` và
`releaseStale.mutate({ leaseKey })` — **không kèm `totpCode`, và không dùng `StepUpOtpDialog`**
(hook step-up **đã có sẵn** trong repo và đang được `EngineeringWorkspace` / `ApprovalsInbox` /
`OrchestrationStudio` dùng đúng khuôn `stepUp.guard((totpCode) => m.mutate({...payload, totpCode}))`).

⇒ **Trên deployment này, HAI nút phá huỷ của panel VRAM KHÔNG BẤM ĐƯỢC với BẤT KỲ vai nào** —
kể cả admin. Lệnh không bao giờ tới broker, nên `onSuccess` (chỗ duy nhất gọi
`translateVramPreemptCommand` / `translateVramReleaseStaleCommand`) là **NHÁNH KHÔNG TỚI ĐƯỢC**.
Đây **đúng lớp lỗi T5-B tồn tại để bắt**: cổng AST xanh vì lời gọi **có trong cây cú pháp**;
người dùng thật không bao giờ chạy tới nó.

⚠ Đây là khuyết tật **của mã sản xuất**, **KHÔNG được vá trong task này** (task đo, không chữa).

---

## 3. (T5-A) BÁN KÍNH NỔ CỦA BẢN VÁ C-1 — bảng theo LỚP RỦI RO

Mọi lượt: `POST /api/ai/local-kb/stream`, phiên đăng nhập THẬT (`/api/auth/login` + `/api/auth/verify-2fa` bằng TOTP thật),
ngắt ngay sau sự kiện `tool` để khỏi chờ lượt sinh chữ. **Không lượt nào tiêm `__authCtx` bằng tay.**

| # | lớp | câu hỏi | tool ĐÃ CHẠY | role ĐƯỢC PHÉP → kết quả | role BỊ TỪ CHỐI → kết quả | ĐẠT? |
|---|---|---|---|---|---|---|
| A1 | (a) đọc dữ liệu nghiệp vụ `readToolsP2bc` | `danh sách sản phẩm` | **`list_products`** | `supervisor1` → **`data.count = 4`**, `items[0] = {id:30, code:"GB300", name:"GB300 PCB BOARD"}` · `dataLen = 751` | `operator1` **và** `p1_audit_op` → `note:"PERMISSION_DENIED"`, `count:0`, `items:[]` · *"Bạn không có quyền xem dữ liệu \"settings_products\""* | ✅ **ĐẠT** (N-7 có giá trị cụ thể: **`GB300 PCB BOARD`**) |
| A2 | (b) phân tích/tổng hợp `analyticsTools` | `pareto lỗi nhiều nhất` | **`analytics_defect_pareto`** | `supervisor1` → truy vấn CHẠY THẬT nhưng **`totalDefects: 0`**, `topN: []` (`note:"NOT_FOUND"`) | `operator1` **và** `p1_audit_op` → `note:"PERMISSION_DENIED"`, **`data: null`** | ⚠ **CHƯA ĐẠT theo N-7** — xem A2′ |
| A3 | (c) lập trình thiết bị `readToolsProgramming` | `tra cứu tài liệu lập trình` | 🔴 **`get_today_stats`** (KHÔNG phải tool của lớp này) | — | — | 🔴 **KHÔNG NGHIỆM THU ĐƯỢC** — xem §3.1 |
| A4 | (d) hạ tầng VRAM `vramTools` | `trạng thái vram` | **`get_vram_state`** | `supervisor1` → `dataLen = 8.719`, **`Dư địa hiệu lực: 22.383 MiB`**, `basis=attributable`, `trusted=true`, 6 hộ có tên | *(xem dưới)* | ✅ (phần được phép) |

⚠ **A2 phân biệt được nhưng KHÔNG thoả N-7 nguyên văn**: hai lượt **không cùng rỗng**
(`{"groupBy":"defectType","totalDefects":0,…}` ≠ `null`, và `note` khác nhau), nhưng lượt ĐƯỢC PHÉP
**không nêu được một giá trị nghiệp vụ cụ thể** vì DB không có NG nào trong 7 ngày. Theo đúng chữ của
N-7 ⇒ ghi thẳng là **chưa đạt**, và đã chạy lượt bù A2′ (§3.2).

### 3.1 🔴 PHÁT HIỆN — cả **8/8** tool `readToolsProgramming` KHÔNG VỚI TỚI ĐƯỢC từ đường Agent NL

Đây là bán kính nổ theo **chiều ngược lại** với cái Task 4 đo: bản vá C-1 làm `__authCtx` tới được
tool, nhưng với lớp (c) **bộ phân loại không bao giờ chọn được tool** — nên chúng vẫn là mã chết
trên đường Agent, chỉ vì một lý do khác.

**Cơ chế, truy được bằng mã + đo được bằng 3 lượt sống:**
1. Cả 8 tool đều có **tham số BẮT BUỘC**: `retrieve_programming_kb.query` · `lookup_error_code.code` ·
   `syntax_check/compile/simulate.{kind,code}` · `generate_program.request` · **`calc.expression`** ·
   **`read_project_file.path`**.
2. `intentClassifier.extractArgsForTool()` **KHÔNG có `case` nào** cho 8 tên đó ⇒ luôn trả `{}`.
3. `tool.parameters.safeParse({})` **hỏng** ⇒ `classifyToolIntent` trả `INVALID_ARGS…`, `tool: null`.
4. Rơi xuống LLM fallback (`AI_TOOL_LLM_FALLBACK=1`, model THẬT đang nạp) — và prompt của nó
   (`buildClassifierPrompt`) **không liệt kê quy tắc trích args cho tool nào của lớp này**.

**Ba lượt sống, cùng một câu hỏi, ba danh tính:**

| user | quyền `machine_status` (alias của `machine_monitoring`) | tool ĐÃ CHẠY | kết quả |
|---|---|---|---|
| `supervisor1` (49) | canView ✓ | `get_today_stats` | trả **DỮ LIỆU** (`total:0, ok:0, ng:0`) |
| `operator1` (48) | canView ✓ | `get_today_stats` | trả **DỮ LIỆU** |
| `p1_audit_op` (1545) | **0 hàng quyền nào** | `get_today_stats` | **VẪN trả DỮ LIỆU** |

⚠ Lượt thứ ba đáng chú ý riêng: một tài khoản **không một bit quyền nào** vẫn nhận dữ liệu — vì tool
mà bộ phân loại rơi vào (`get_today_stats`) **không khai `requiredPermission`**. Đây **không phải** lỗi
của Pha 4; nó là nợ có sẵn của lớp GĐ1. Ghi lại vì lượt sống bắt được.

⇒ **Kết luận lớp (c): CHƯA NGHIỆM THU.** Không dựng được lượt "được phép" lẫn lượt "bị từ chối" cho
lớp này trên đường Agent NL, vì **không lượt nào chạm tới tool của lớp**.

> 🔴 **ĐÍNH CHÍNH HẠNG (review) — LỚP (c) LÀ MỘT NỢ CHẶN, KHÔNG PHẢI MỘT Ô TRỐNG.**
> Bản đầu đóng khung nó như *"không dựng được cảnh"* — nghe ngang hàng với một mục thiếu số. Sai hạng.
> Nội dung thật của nó: **hai ranh giới AN NINH** — chặn thoát thư mục (`read_project_file`) và hộp
> cát biểu thức (`calc`) — **CHƯA TỪNG CHẠY MỘT LẦN NÀO** trên đường Agent, ở một lớp mà **cả 8/8
> tool đều nằm ở sàn quyền THẤP NHẤT** (`machine_monitoring/canView`, tức gần như mọi vai đều có).
> ⇒ Đây là **nợ CHẶN của cổng ra**, phải trả trước khi ai đó sửa `extractArgsForTool` (ngày lớp này
> với tới được là ngày hai ranh giới ấy nhận đầu vào thật lần đầu, **chưa từng có lưới sống nào**).

### 3.2 (A2′) Lượt bù cho lớp (b) — **N-7 nay ĐẠT**

Nguyên nhân A2 rỗng đã ĐO ĐƯỢC, không suy đoán: `select max("createdAt") from product_inspections`
= **`2026-07-19T00:27:13.571Z`**, tức **17 ngày** trước lượt đo, còn cửa sổ mặc định của
`analytics_defect_pareto` là **7 ngày**. `extractArgsForTool` có `DAYS_REGEX` cho tool này ⇒ đổi câu hỏi
thành `"pareto lỗi nhiều nhất 60 ngày"` là đủ, **không cần chạm dữ liệu**.

| lượt | user | kết quả **ĐO ĐƯỢC** |
|---|---|---|
| A2′ được phép | `supervisor1` | `totalDefects:` **89**, `pareto80Count: 4`, `dataLen 516`; **`{"category":"Cao linh kiện C12","count":28,"percentage":31.46}`** |
| A2′ bị từ chối | `operator1` | `PERMISSION_DENIED`, **`data: null`**, `dataLen 4` |

⇒ Lớp (b) **ĐẠT**, và giá trị cụ thể là **"Cao linh kiện C12 — 28 NG (31,46%)"**.

### 3.3 Bảng T5-A đầy đủ theo yêu cầu nguyên văn (lớp · tool đại diện · role được phép · role bị từ chối · kết quả thật)

| lớp | tool đại diện | role ĐƯỢC PHÉP | kết quả thật (giá trị cụ thể) | role BỊ TỪ CHỐI | kết quả thật | trạng thái |
|---|---|---|---|---|---|---|
| (a) `readToolsP2bc` | `list_products` (`settings_products/canView`) | `supervisor1` (49) | `count:4`; **`code:"GB300", name:"GB300 PCB BOARD"`**; `dataLen 751` | `operator1` (48) · `p1_audit_op` (1545) | `PERMISSION_DENIED`; `count:0, items:[]`; `dataLen 88` | ✅ ĐẠT |
| (b) `analyticsTools` | `analytics_defect_pareto` (`analytics_root_cause/canView`) | `supervisor1` (49) | A2 (7 ngày): `totalDefects:0, topN:[]` ⇒ chưa đạt N-7 · **A2′ (60 ngày): `totalDefects:89`, `"Cao linh kiện C12": 28 (31,46%)`, `dataLen 516`** | `operator1` · `p1_audit_op` | `PERMISSION_DENIED`; **`data:null`**; `dataLen 4` | ✅ **ĐẠT qua A2′** (§3.2) |
| (c) `readToolsProgramming` | *(không tool nào của lớp được chọn)* | — | 🔴 cả 3 danh tính đều rơi vào `get_today_stats` | — | — | 🔴 KHÔNG NGHIỆM THU ĐƯỢC |
| (d) `vramTools` | `get_vram_state` (`machine_control/canView`) | `supervisor1` (49) | `dataLen 8.719`; **`Dư địa hiệu lực: 22.383 MiB`**, `basis=attributable`, `trusted=true`, 6 hộ có tên | `operator1` (48) · `p1_audit_op` (1545) | `PERMISSION_DENIED`; **`{"state":null,"rows":[]}`**; `dataLen 24` | ✅ ĐẠT |

⚠ **Vì sao hai lượt từ chối KHÔNG cùng rỗng với lượt được phép** (điều N-7 đòi phân biệt được):
lớp (a) 751 byte ↔ 88 byte · lớp (d) **8.719 byte ↔ 24 byte**. Chênh lệch là **dữ liệu thật**, không
phải hai bản rỗng khác nhãn.

---

## 4. NHÓM 2 + NHÓM 4 — Agent RA LỆNH: ba lệnh, đúng cổng quyền, và **hỏng TRUNG THỰC**

Mọi lượt: HTTP `POST /api/trpc/vram.<lệnh>?batch=1` với **cookie phiên THẬT** + **TOTP TƯƠI** sinh từ
`two_factor_secret` trong DB (vì `.env` bật `ACTUATION_STEPUP_2FA=true`). Không giả lập middleware nào.

| # | lệnh | danh tính | HTTP | kết quả **ĐO ĐƯỢC** | cổng nào chặn |
|---|---|---|---|---|---|
| C1 | `preempt` | `operator1` (operator) | **403** | `FORBIDDEN` — *"Required role: admin or supervisor or engineer"* | **role-floor** (`actuationProcedure`) |
| C2 | `retryDeferred` | `maint1` (maintenance) | **403** | `FORBIDDEN` — *"Required role: …"* | **role-floor** |
| C3 | `preempt` | `engineer1` **+ OTP TƯƠI HỢP LỆ** | **403** | `FORBIDDEN` — **"Bạn không có quyền delete cho module \"machine_control\""** | 🎯 **`requirePermission(machine_control, canDelete)`** |
| C4 | `retryDeferred` | `engineer1` (canCreate ✓) | **200** | `outcome:"refused"`, `reason:"no-defer-chain-in-this-process"`, `hostedHere:true` | *(qua hết cổng — lệnh CHẠY)* |
| C5 | `preempt("cuda-backend")` | `p1_audit_admin` | 200 | `outcome:"refused"`, `reason:"production-never-preempted"`, `freedBytes:0`, `leaseLeftLedger:false`, `ledgerBytesBefore == ledgerBytesAfter == 7.471.882.240` | — |
| C6 | `preempt("gguf-embed-ctx:…")` | `p1_audit_admin` | 200 | `outcome:"refused"`, `reason:"busy-in-use"`, sổ **không đổi** | — |
| C7 | `preempt("__ho-khong-ton-tai-t5__")` | `p1_audit_admin` | 200 | `outcome:"refused"`, `reason:"owner-not-in-local-ledger"`, sổ **không đổi** | — |
| C8 | `releaseStale("khong-ton-tai:1:1#zzz")` | `p1_audit_admin` | 200 | `outcome:"refused"`, `reason:"row-not-in-shared-ledger-replica"`, `freedBytes:0`, `rowKind:null`, `durability:null` | — |
| C9 | `releaseStale` | `operator1` | **403** | `FORBIDDEN` — role-floor | **role-floor** |

★ **C3 là lượt quan trọng nhất của nhóm này.** Nó chứng minh **SỐNG** đúng điều I-1 (review Task 2)
bắt Task 2 phải sửa: `deployProcedure` một mình chỉ trả lời *"anh có phải engineer không"*.
`engineer1` **qua** role-floor, **qua** 2FA, **qua** step-up OTP tươi — rồi bị chặn ở
`requirePermission("machine_control","canDelete")`. Nếu Task 2 dừng ở `deployProcedure` như bản đầu,
lượt này sẽ **đi thẳng vào thân thủ tục giết tiến trình**.

★ **NHÓM 4 — "hỏng trung thực" đạt trên BA nguyên nhân khác nhau** (C5/C6/C7) + một cho `releaseStale`
(C8). Cả bốn: `freedBytes: 0`, `leaseLeftLedger: false`, và **sổ trước == sổ sau, tới từng byte**.
Không một lượt nào khai thành công.

---

## 5. NHÓM 2 (bước 3) — RA LỆNH THU HỒI THẬT: `nvidia-smi` xác nhận byte **THẬT SỰ NHẢ**

**Lượt sống L4** · 23:13:35 → 23:14:07 · **bấm nút trong màn `/ai-brain`**, phiên `p1_audit_admin` (admin).
Cửa sổ step-up 2FA được mở bằng **đúng cơ chế của repo** (một mutation mang `totpCode` tươi, với
`owner: "__t5-prime-stepup__"` → `refused/owner-not-in-local-ledger`, **không chạm hộ nào**).

| thước | TRƯỚC (23:13:35) | SAU (23:14:07) | **chênh** |
|---|---|---|---|
| **`nvidia-smi memory.used`** | **8.640 MiB** | **3.589 MiB** | **−5.051 MiB THẬT SỰ NHẢ** |
| `nvidia-smi memory.free` | 23.551 MiB | 28.602 MiB | +5.051 MiB |
| `vram.state.ledger.localBytes` | 7.471.882.240 | **2.197.463.040** | **−5.274.419.200 B = −5.030 MiB** |
| số hộ trong sổ cục bộ | 6 | **5** | hộ `gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL` **RỜI SỔ** |

⇒ **ĐẠT.** Hai thước độc lập khớp nhau trong **21 MiB** (5.051 thiết bị vs 5.030 sổ — phần chênh là
ngữ cảnh CUDA của model cũng được nhả cùng). Đây là *"byte thật sự nhả"* theo đúng nghĩa Bước 3.

⚠ **Một quan sát đáng ghi:** `headroom.effectiveBytes` **KHÔNG đổi** (23.470.170.112 ở cả hai đầu)
dù 5.030 MiB đã rời sổ.

> 🔴 **ĐÍNH CHÍNH (review) — BẢN ĐẦU CHẨN ĐOÁN SAI CƠ CHẾ**, và chẩn đoán sai khiến người sau sửa
> nhầm chỗ. Bản đầu viết *"dư địa chỉ được tính lại ở nhịp quyết định kế tiếp"* — như thể con số bị
> **cache**. **KHÔNG PHẢI.** `decisionStateFor()` (`vramBroker.ts:846`) **tính mới ở MỖI lượt đọc**.
>
> **Thủ phạm thật là công thức**, và nó khớp **đúng từng byte** với chính hai số tôi đã ghi:
> ```
> headroom_raw = ceiling − max(ledgerTotal, attributable) − safetyReserve
> effective    = raw − staleMargin − sharedLedgerMargin
> ```
> • **TRƯỚC**: `max(7.471.882.240, 7.499.063.296)` = **attributable** (thiết bị thấy nhiều hơn sổ);
> • **SAU**: `ledgerTotal` tụt xuống 2.197.463.040, nhưng **`attributable` vẫn là 7.499.063.296** —
>   nó đến từ **phép đo thiết bị của NHỊP TRƯỚC**, chưa có nhịp mới sau lệnh ⇒ `max(...)` **y nguyên**.
> • Kiểm số: `34.190.458.880 − 7.499.063.296 − 1.073.741.824 = 25.617.653.760` (= `rawBytes` đã ghi);
>   `25.617.653.760 − 1.073.741.824 − 1.073.741.824 = 23.470.170.112` (= `effectiveBytes` đã ghi). ✔
>
> ⇒ Phát biểu ĐÚNG: **`used` bị GHIM bởi một phép đo tick CŨ**, không phải "dư địa bị cache". Hệ quả
> thực hành không đổi — bằng chứng đúng vẫn là `leaseLeftLedger` + `ledger.localBytes` — nhưng ai
> muốn sửa phải chạm **nhịp đo**, không phải chạm chỗ tính headroom.

---

## 6. (T5-B) NHÁNH CHẾT — RENDER THẬT, CHỤP MÀN HÌNH, ĐỌC BẰNG MẮT ĐỦ **TÁM** CÂU

Màn `/ai-brain` (`AIBrainDashboard` → `VramBrokerPanel`) render THẬT trong trình duyệt Chromium
(Playwright), phiên đăng nhập THẬT, locale **English** (nên câu chữ hiện ra là bản `en` của
`errorCodes.ts` — chứng minh luôn rằng ba locale được nối, không phải chuỗi cứng tiếng Việt).

| # | hàm `translateVram*` | câu **ĐỌC ĐƯỢC BẰNG MẮT** (nguyên văn trên màn) | ảnh |
|---|---|---|---|
| 1 | `translateVramScope` | *"This result reflects only what the RESPONDING PROCESS can see (see observedFromProcessKey); other processes in the cluster may see something different. Don't read it as a cluster-wide claim."* | `t5b-01`, `t5b-06` |
| 2 | `translateVramNonFiniteFields` (nhánh **mảng rỗng**) | *"No numeric field was blocked for being non-finite in this snapshot."* | `t5b-01`, `t5b-06` |
| 3 | `translateVramEstimateUsable` (nhánh **usable**) | *"This figure is an ESTIMATE, not a measurement — but every off-ledger allocation could be estimated, so it is safe to use in calculations."* | `t5b-01`, `t5b-06` |
| 4 | `translateVramHolderListIsLowerBound` | *"This \"holders\" list only covers holders that have been WIRED into the ledger — it declares itself a LOWER BOUND, not a complete list. Reading an empty list as \"nobody holds anything\" is WRONG."* | `t5b-01`, `t5b-06` |
| 5a | `translateVramHostedHere(**true**)` | *"The responding process CONFIRMS it hosts this holder."* (hộ `cron:kb-sync`) | `t5b-03`, `t5b-06` |
| 5b | `translateVramHostedHere(**null**)` | *"It is UNDETERMINED whether this process hosts the holder — no mechanism can answer that for this holder. Don't read this as \"not hosted\"."* (5 hộ còn lại) | `t5b-03`, `t5b-06` |
| 6 | `translateVramPreemptCommand` | *"Reclaimed holder gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL: its lease has left the ledger (leaseLeftLedger: true) — that is the evidence, not freedBytes."* | **`t5b-04`** |
| 7 | `translateVramReleaseStaleCommand` | *"Command to clean up row api:4304:1785946518923#lease-1 was REFUSED: The process that owns this row has NOT been proven dead (missing full role:pid:bootMs evidence, or the process table couldn't be read) — cleaning up a row without solid proof of death is RISKY. The command refuses until proof is strong enough."* | **`t5b-05`** |
| 8 | `translateVramRetryDeferredCommand` | *"Command to rearm holder cron:kb-sync was REFUSED: cron:kb-sync DOES run in this process, but there is currently no live defer chain (deferStreak === null) — there's nothing to rearm because the most recent request wasn't refused, or already succeeded."* | **`t5b-03`** |

⇒ **ĐỦ 8/8 CÂU HIỆN RA THẬT.** Không câu nào phải viện tới mệnh đề thoát N-8.

### 6.1 Cách dựng được ba câu KẾT CỤC LỆNH (N-8 — ghi lại vì hai trong ba **không tự nhiên có**)

- **Câu 8 (`retryDeferred`)** — bấm được ngay: `actuationProcedure` **không** có `requireFreshTotp`,
  và `engineer1` có `machine_control/canCreate`. Nút chỉ **một** cái bấm được trong sáu
  (`vramRetryButtonDisabled` khoá 5 hộ `unreachable`) — lưới N-5 của Task 4 **chạy đúng trên màn thật**.
- **Câu 6 (`preempt`)** — phải **mở cửa sổ step-up 2FA trước**, vì panel không gửi `totpCode`
  (xem §2). Đã mở bằng **đúng cơ chế của repo**: một mutation `vram.preempt` mang `totpCode` tươi với
  `owner: "__t5-prime-stepup__"` (⇒ `refused/owner-not-in-local-ledger`, **không chạm hộ nào**), rồi
  bấm nút thật trong 10 phút cửa sổ còn mở.
  ⚠ Người vận hành thật **không có đường nào làm bước này từ màn `/ai-brain`** — đó là khuyết tật §2.
- **Câu 7 (`releaseStale`)** — nút **KHÔNG RENDER** ở trạng thái mặc định, và lý do nằm ở **CẤU TRÚC**:
  `VramBrokerPanel` chỉ render nút khi `h.leaseKey !== null`; `vramReadModel.hoCucBo()` gán
  `leaseKey: null` cho **MỌI hộ cục bộ** (dòng 820, có chủ ý — sổ cục bộ là chủ), chỉ `hoAnhEm()`
  (dòng 852) mang `r.leaseKey`. Deployment mặc định chạy **MỘT tiến trình** ⇒
  `foreign.holders = []` ⇒ **không nút nào**.
  **Cách duy nhất dựng được:** một **tiến trình anh em THẬT** giữ giấy phép VRAM. Đã dựng:
  `ROLE=api PORT=3100 npm run dev` (chọn `ROLE=api` **có chủ ý** để **không** chạy scheduler —
  tránh retention/backup đụng dữ liệu). Kết quả đo: `vram_leases` có thêm **3 hàng**
  `api:4304:1785946518923#lease-{1,6,7}`; sau **một nhịp làm mới sổ chung (60 s)** panel hiện
  **3 hộ anh em + 3 nút** ⇒ bấm được ⇒ câu 7 hiện ra.
  Đã tắt anh em **theo đúng PID** (`taskkill /F /PID 4304 /T`, không quét theo tên); GPU
  **5.895 → 3.496 MiB**; nhịp đối chiếu **tự dọn 3 hàng ma** (đo lại `vram_leases`: **0 hàng** còn
  mang `api:4304`) ⇒ không dựng được lượt `released`, chỉ lượt `refused` — và **`refused` cũng là
  một câu hiện ra**, đúng nguyên văn N-8.

### 6.2 Hai điều màn thật chứng minh mà cổng AST không chứng minh được

1. **`vramRetryButtonDisabled` chạy đúng**: 6 nút `data-testid="vram-retry"`, **1 bấm được**
   (`reachable-here`) / **5 bị khoá** (`unreachable`) — đo bằng `button.disabled` trên DOM thật.
2. **Nhánh `declared-by-owner-process` render thật**: hộ anh em `gguf:Qwen3-Embedding-0.6B-f16`
   của `api:4304` hiện *"chỉ tiến trình chủ thu hồi được — lệnh từ đây sẽ bị từ chối"* thay vì một
   nút thu hồi. Trước khi có tiến trình anh em, nhánh này **chưa từng chạy**.

### 6.3 Ảnh chụp (đã tự chụp + tự Read bằng mắt, không nhờ ai xác nhận hộ)

| ảnh | nội dung |
|---|---|
| `assets/2026-08-05-vram-pha4-nghiem-thu-song/t5b-00-initial.png` | Panel VRAM render lần đầu — thẻ VRAM đã đổi sang *"theo broker (số đang cưỡng chế)"* |
| `…/t5b-01-panel-read.png` | Toàn trang — 4 câu mặt đọc + 6 hộ thật |
| `…/t5b-02-preempt-denied-engineer.png` | Sau lượt bấm bị 403 của `engineer1` — **sổ không đổi**, hộ 5.030 MiB còn nguyên |
| `…/t5b-03-sentence8-retryDeferred.png` | **Câu 8** + cả hai nhánh `hostedHere` + 1/6 nút `vram-retry` bấm được |
| `…/t5b-04-sentence6-preempt-reclaimed.png` | **Câu 6** (`reclaimed`) sau lượt thu hồi THẬT |
| `…/t5b-05-sentence7-releaseStale.png` | **Câu 7** (`refused / process-not-proven-dead`) trên hàng của anh em `api:4304` |
| `…/t5b-06-panel-full-with-sibling.png` | Toàn trang có **3 hộ anh em** + 3 nút `releaseStale` + nhánh `declared-by-owner-process` |

---

## 7. Trạng thái hệ sau khi đo — đã trả về nguyên trạng

| việc | trạng thái |
|---|---|
| Tài khoản kiểm toán `p1_audit_admin` / `p1_audit_op` | **ĐÃ KHOÁ LẠI** bằng `node scripts/audit/audit-account.mjs off` — kiểm lại: cả hai `isActive:false`, `passwordHash` = `LOCKED-…` |
| Quyền của `operator1`/`supervisor1`/`maint1`/`engineer1` | **KHÔNG ĐỔI** — vẫn đúng **85** hàng như trước khi đo (không cấp, không thu hồi bit quyền nào) |
| Tiến trình anh em `api:4304` | **ĐÃ TẮT theo đúng PID** (`taskkill /F /PID 4304 /T`), cổng 3100 giải phóng, GPU 5.895 → 3.496 MiB |
| Hàng ma của anh em trong `vram_leases` | **nhịp đối chiếu TỰ DỌN** — đo lại: 0 hàng mang `api:4304` |
| ⚠ **Hàng của tiến trình ĐÃ CHẾT còn sót trong `vram_leases`** (bản đầu **bỏ sót**, người review bắt) | **CÓ, và nó TỰ LÀNH** — vế này ĐÚNG và BỀN, người review Task 5 xác nhận độc lập bằng lượt đo sống riêng (hàng của tiến trình chết biến mất sạch ngay khi một tiến trình mới lên). 🔴 **ĐÍNH CHÍNH (RR-3, vòng re-review) — BỎ vế "tổng = 0 byte ⇒ vô hại", nó KHÔNG PHẢI một tính chất bền.** `cuda-backend` ước lượng bằng 0 khi khởi động **không có căn cứ đo** (đúng log khởi động: *"KHÔNG CÓ CĂN CỨ NÀO để ước lượng … Ước lượng = 0"*) — nên "0 byte" là **một ảnh chụp may mắn tại một thời điểm**, không phải hằng số. Người review đo lại **ngay lúc review** và thấy **3 hàng / 13.309.882.369 B** (khác 0), với **cả hai tiến trình đứng tên còn SỐNG** (PID 2728 giữ :3000, PID 39328 giữ :3100) ⇒ đó là **giấy phép đang hiệu lực, không phải rác**. Tự đo lại lần nữa **ngay tại lượt sửa này** (`2026-08-05T17:55:45Z`, SELECT trực tiếp DB, không qua ứng dụng): **3 hàng / 3.646.205.953 B**, mang `processKey` `all:31772` (cổng 3000) và `api:13404` (cổng 3100) — tại thời điểm đo, cả hai tiến trình cũng đang SỐNG (xác nhận bằng `netstat` + `Get-CimInstance Win32_Process`, dòng lệnh khớp `server/_core/index.ts`); hai server này sau đó **đã bị tắt theo PID** — xem RR-4 (§14.4). ⇒ **Phát biểu ĐÚNG duy nhất**: hàng của một **tiến trình đã chết** bị nhịp đối chiếu dọn sạch ở lượt khởi động kế tiếp (`lapKeHoachNhanNuoi` → `xoaHangMa`) — điều này **không** kéo theo "tổng byte luôn bằng 0"; tổng byte là hàm của **bao nhiêu tiến trình đang sống và họ đang giữ bao nhiêu**, không phải một hằng số quan sát được một lần rồi coi là quy luật. |
| Model `gguf:Qwen3-4B-Instruct` đã thu hồi | nạp lại theo nhu cầu (đường bình thường của `getOrLoadModel`) — không cần can thiệp |
| Mã sản xuất | **KHÔNG SỬA MỘT DÒNG NÀO.** `git status --porcelain -- server/ client/` vẫn RỖNG sau khi đo |
| Trainer · `kb:sync` · DDL/migration | **KHÔNG chạy cái nào** |
| Script/cảnh tạm | nằm trong scratchpad, **đã xoá** sau khi xong (§9) |

---

## 8. ĐƯỜNG NÀO ĐÃ ĐI · ĐƯỜNG NÀO **CHƯA** ĐI

> ⚠ *"Nghiệm thu sống chỉ chứng minh ĐÚNG ĐƯỜNG MÌNH VỪA ĐI."* Ở Wave 2, **40% đề xuất vô hình lọt
> qua lượt live đầu tiên**, và một Critical **chỉ tồn tại ở cấu hình khác**. Mục này liệt kê **cả hai vế**.

### ĐÃ ĐI
1. `POST /api/ai/local-kb/stream` + `/ask` — phiên thật, `buildExecCtx`, `tryExecuteTool`, `argsWithAuthCtx`, `checkPermission` trên DB thật. **17 lượt**, 5 danh tính.
2. `POST /api/trpc/vram.{state,preempt,releaseStale,retryDeferred}` — **9 lượt lệnh** + 4 lượt đọc, có role-floor · 2FA · step-up OTP tươi · `requirePermission`.
3. Màn `/ai-brain` render thật trong Chromium, **bấm 4 nút thật**, đọc 8 câu bằng mắt, `nvidia-smi` hai đầu.
4. Cấu hình ĐANG CHẠY của deployment này: `ACTUATION_STEPUP_2FA=true`, `AI_TOOL_LLM_FALLBACK=1`, `AI_AGENTIC_ENABLED=1`, model GGUF **nạp thật**.
5. Topology **một tiến trình** (`all:2128`) **VÀ** topology **hai tiến trình** (`all:2128` + `api:4304`).

### CHƯA ĐI — và đây là phần quan trọng hơn
| # | đường chưa đi | vì sao nó có thể giấu lỗi |
|---|---|---|
| U1 | **`aiAgentOrchestrator`** (Agent TỰ TRỊ) — xem §8.1 | Đây là đường Agent **THỨ HAI**, và nó **không đi qua `tryExecuteTool()`** ⇒ bản vá C-1 **không phủ nó**. |
| U2 | 8 tool `readToolsProgramming`, gồm **chặn đường dẫn `read_project_file`** và **hộp cát `calc`** | **CHƯA TỪNG CHẠY** trên đường Agent — 3 lượt sống đều rơi sang tool khác (§3.1). Ranh giới an ninh **chưa được nghiệm thu**. |
| U3 | Topology `ROLE=api` + `ROLE=worker` **thật** (cron sống ở `worker`) | Câu `retryDeferred` **chỉ** đo được ở nhánh `no-defer-chain-in-this-process`; nhánh `host-not-running-in-this-process` **và** nhánh `retry-armed` (có chuỗi hoãn SỐNG) **chưa chạy**. |
| U4 | Lượt `releaseStale` **`released`** (chủ hàng CHỨNG MINH ĐƯỢC đã chết) | Nhịp đối chiếu tự dọn hàng ma trước khi kịp ra lệnh ⇒ nhánh `released` + `durability:"queued-for-shared-ledger"` **chưa chạy**. |
| U5 | `preempt` các nhánh `reclaimer-returned-false` / `reclaimer-threw` / `no-bytes-freed` | Chỉ đo được `production-never-preempted`, `busy-in-use`, `owner-not-in-local-ledger`, `reclaimed`. Ba nhánh **hỏng của người thi hành** chưa chạy. |
| U6 | `preempt` hộ `vision-sidecar` và `orphan-pid` (**hộ 7,8 GB**) | Sidecar thị giác **không sống** trong lượt đo (`nvidia-smi` không có `llama-server`), nên hai người thi hành ấy chưa chạy. Đã thu hồi hộ `gguf-idle-model` **5.030 MiB** thay thế. |
| U7 | Locale `vi` và `zh` **trên màn thật** | Trình duyệt ở `en`; ba locale mới chỉ được `i18n:check` + test Task 3 canh. |
| U8 | `headroom.blind = true` / `basis = "ledger-only"` **trên panel** | Chỉ bắt được ở **lượt L1** (qua tool, lúc nhịp đo đầu chưa xong), **không** chụp được trên màn. |
| **U9** | ⚠⚠ **TOÀN BỘ MẶT SUY GIẢM** — `blind` · `trusted=false` · `degradedReasons[]` · `baseline.verified=false` · `foreign.known=false` · `foreign.stale=true` | **7/7 ảnh đều in nhãn `tin cậy`**, `degradedReasons: []`, `baseline.verified: true`. ⇒ **không một badge suy giảm nào từng render**. Đây là **nửa nguy hiểm hơn** của panel: nó chỉ xuất hiện đúng lúc hệ đang hỏng, tức đúng lúc người trực cần đọc nó. |
| **U10** | **Nhánh CẢNH BÁO của câu 2 và câu 3** (`translateVramNonFiniteFields` khi mảng **KHÔNG rỗng**; `translateVramEstimateUsable(false, n)`) | 2/8 câu chỉ chạy **nhánh hiền**. Nhánh dữ dội — *"N ô BỊ CHẶN (fail-closed HỢP LỆ)"* và *"KHÔNG ĐÁNG TIN, đừng dùng để tính"* — **chưa từng hiện trên màn**. |
| **U11** | Hai lệnh chạy **CÙNG LÚC** (hai người vận hành, hoặc Agent + người) | Mọi lượt đo đều **tuần tự**. Tranh chấp trên cùng một hộ / cùng cửa sổ đo chưa chạm tới. |
| **U12** | **Sổ chung khi DB CHẬM hoặc MẤT** | Đo trong điều kiện DB khoẻ (`foreign.known: true`, `ageMs` 7–11 s). Nhánh `never-refreshed-blind-to-siblings` + `stale: true` chưa chạy trên màn lẫn trên tool. |
| **U13** | Giá trị **`-Infinity`/`NaN`** đi tới API (đường fail-closed `nonFiniteFields`) | `nonFiniteFields: []` ở **mọi** lượt ⇒ đường chặn chưa từng kích hoạt bằng dữ liệu thật. |
| **U14** | **Dư địa ÂM** (đã dùng vượt trần) | GPU rộng rãi suốt lượt đo (đỉnh 8,6/32,6 GB). |
| **U15** | **Ba vai chưa từng đọc tool**: `quality_inspector`, `it_admin`, `manager` | Chỉ đo 5 danh tính (admin · supervisor · engineer · operator · maintenance). |
| **U16** | `preempt` một hộ **ĐANG BẬN THẬT** (`refCount > 0` giữa lúc suy luận) | Chỉ gặp `busy-in-use` ở trạng thái tĩnh, chưa gặp lúc có request đang bay. |
| **U17** | **Anh em CÒN SỐNG ra lệnh chéo** (tiến trình A `preempt` hộ của B) | Chỉ đo `declared-by-owner-process` ở **mặt đọc**; chưa bấm lệnh từ tiến trình không phải chủ. |
| **U18** | **Tab ẩn** (`usePollingInterval` tạm dừng rồi quay lại) | Mọi lượt đo với tab đang hiện. |
| **U19** | 🔴 **U1 "chưa đi ĐƯỢC"** — planner trả `steps: []` nên **không mục tiêu người dùng thật nào** từng chạy qua đường tự trị | ⚠ Lỗ §8.1 đã được đóng bằng **lưới ở mức đơn vị** (seam thay planner). Nhưng **đường end-to-end THẬT** — mục tiêu người dùng → planner THẬT → bước read — **vẫn chưa từng chạy**, vì planner đang hỏng. Khi planner được sửa, **phải đo lại toàn bộ §8.1 trên đường thật**. |
| **U20** | GPU **gần đầy** (lượt xin bị TỪ CHỐI thật giữa lúc panel đang mở) | Chưa dựng được cảnh nghẽn. |
| **U21** | **Một máy · một locale · một card** | Toàn bộ đo trên 1 máy dev, RTX 5090, trình duyệt `en`. Kết luận không mở rộng sang cấu hình khác — và Wave 2 đã có tiền lệ *"một Critical chỉ tồn tại ở cấu hình khác"*. |

### 8.1 🔴 U1 — đường Agent TỰ TRỊ **FAIL-OPEN** (bản đầu ghi **SAI CHIỀU**) — ĐÃ SỬA + ĐÃ ĐO

> 🔴 **ĐÍNH CHÍNH NẶNG NHẤT CỦA CẢ BÁO CÁO.** Bản đầu xếp mục này **🟡** và mô tả nó là **fail-closed**
> (*"vẫn `PERMISSION_DENIED` + 0 byte dữ liệu"*). **NÓ FAIL-OPEN.** Đây là một **lỗ leo thang quyền**,
> không phải một ô hiển thị thiếu.
>
> **Vì sao tôi bỏ sót:** tôi đọc `argsWithAuthCtx` như một hàm **GÁN** danh tính, nên "bỏ qua nó"
> đọc thành "không có danh tính ⇒ bị từ chối". Nhưng việc **ĐẦU TIÊN** hàm ấy làm là **XOÁ
> `__authCtx` do đầu vào bịa** — chính bản vá **N-1/N-4** của Task 4. **Bỏ qua nó = bỏ luôn bước XOÁ.**

`server/services/aiAgentOrchestrator.ts:411` (trước khi sửa) — nhánh `step.kind === "read"`:

```ts
const result = await tool.handler(step.args ?? {});
```

**Chuỗi khai thác**, mỗi mắt xích là mã thật:

| # | mắt xích | vì sao nó cho qua |
|---|---|---|
| 1 | `aiAgentPlanner.buildPlannerPrompt()` | ghép **NGUYÊN VĂN mục tiêu người dùng** vào prompt (`` `Mục tiêu: ${goal}` ``) |
| 2 | `aiAgentPlanner` → `tool.parameters.safeParse(rawArgs)` | `__authCtx` là ô **ĐÃ KHAI** trong mọi schema read tool ⇒ `safeParse` **GIỮ NGUYÊN** nó |
| 3 | `aiAgentOrchestrator.ts:411` | `tool.handler(step.args)` — **không XOÁ, không GÁN** |
| 4 | `_core/accessControl.ts:135-137` | `if (isAdmin && !scopedAdminEnabled()) return true` — **KHÔNG ĐỌC DB** |

⇒ **god-mode trên cả 29 read tool có RBAC**, chỉ bằng một mục tiêu viết khéo.

⚠⚠⚠ **VÀ ĐÂY LÀ ĐIỂM ĐẮT NHẤT — "PLANNER ĐANG HỎNG" KHÔNG PHẢI MỘT CỔNG.**
Lượt nghiệm thu đầu chạy **2 lượt** `startSession` và nhận `plan.steps = []` cả hai, nên tôi kết luận
*"chưa nghiệm thu sống được"*. Nhưng thứ chặn là **planner đang trả kế hoạch rỗng**, **không phải một
phép kiểm nào**. Đúng khuôn **"215/215 xanh suốt thời gian tool chết"**: planner được sửa ngày nào
thì lỗ mở ngày đó. **Một khuyết tật bị che bởi một khuyết tật khác vẫn là một khuyết tật đang mở.**

**ĐÃ SỬA + ĐÃ ĐO** (xem §13): lượt đo từ **đầu đường tự trị** với `__authCtx` bịa trong `step.args`:
trước bản vá `checkPermission` nhận **`(999, "admin", …)`** và bước read **TRẢ VỀ DỮ LIỆU**; sau bản
vá nó nhận **`(7, "supervisor", …)`** và trả `PERMISSION_DENIED` + `state: null`.

⚠ **Lớp lỗi: "lưới theo FILE, không theo ĐƯỜNG THOÁT" — lần thứ MƯỜI MỘT.** Bản vá C-1 đi tới **một**
đường thoát và để lại đường thứ hai. ⇒ Không vá đúng dòng 411: xem §13 (bản kiểm đếm **MỌI** điểm gọi).

---

## 9. MỤC KHÔNG LÀM ĐƯỢC — ghi thẳng là **CHƯA ĐẠT**

| mục (nguyên văn yêu cầu) | trạng thái | lý do **ĐO ĐƯỢC** |
|---|---|---|
| *"`read_project_file` phải có lượt THỬ VƯỢT RÀO riêng: `../`, đường dẫn tuyệt đối, symlink"* | 🔴 **CHƯA ĐẠT** | Tool **không với tới được** từ đường Agent. 2 lượt sống: `"open file main.st"` → `get_today_stats`; `"đọc file ../../.env"` → *(cùng lớp)*. Cơ chế: `extractArgsForTool` không có `case "read_project_file"` ⇒ `path` (bắt buộc) không bao giờ có ⇒ `INVALID_ARGS` ⇒ LLM fallback chọn tool khác. **Không ghi được câu từ chối nguyên văn vì chưa lượt nào tới được hàm.** |
| *"`calc` phải có lượt THỬ VƯỢT RÀO riêng: `process`/`require`/`global`/vòng lặp vô hạn"* | 🔴 **CHƯA ĐẠT** | Cùng cơ chế. 2 lượt sống: `"tính 2+3*4 bằng bao nhiêu"` → `get_today_stats`; `"calc 2+3*4"` → `get_machine_status`. `expression` (bắt buộc) không bao giờ được trích. |
| *"Mỗi lớp phải có MỘT lượt với role BỊ TỪ CHỐI"* — **lớp (c)** | 🔴 **CHƯA ĐẠT** | Không lượt nào chạm tool của lớp (c) ⇒ không có gì để từ chối. Lượt của `p1_audit_op` (**0 hàng quyền**) **vẫn nhận dữ liệu**, vì tool nó rơi vào (`get_today_stats`) không khai `requiredPermission`. |
| *"đủ TÁM câu `translateVram*` đọc được bằng mắt"* | ✅ **ĐẠT 8/8** | Xem §6 (kèm 7 ảnh). |
| *"`nvidia-smi` xác nhận byte thật sự nhả"* | ✅ **ĐẠT** | −5.051 MiB thiết bị / −5.030 MiB sổ (§5). |
| *"lệnh phá huỷ không bao giờ khai thành công khi byte chưa nhả"* | ✅ **ĐẠT** | 4 lượt từ chối với 4 `reason` khác nhau, `freedBytes:0`, sổ trước == sau (§4). |

### Bốn phát hiện của lượt sống (không suy luận nào thấy trước)

| # | mức | phát hiện |
|---|---|---|
| **F1** | 🟠 | **Hai nút phá huỷ của panel VRAM không bấm được với BẤT KỲ vai nào** trên cấu hình đang chạy: `ACTUATION_STEPUP_2FA=true` nhưng `VramBrokerPanel` không gửi `totpCode` và không dùng `StepUpOtpDialog` (hook **đã có** và đang được 3 màn khác dùng đúng khuôn). ⇒ `onSuccess` — chỗ **duy nhất** gọi `translateVramPreemptCommand`/`translateVramReleaseStaleCommand` — là **nhánh không tới được** từ UI. Đúng lớp lỗi T5-B. |
| **F2** | 🟠 | **8/8 tool `readToolsProgramming` là mã chết trên đường Agent** vì `extractArgsForTool` không có case ⇒ tham số bắt buộc không bao giờ có. Bản vá C-1 nối được **danh tính**, nhưng lớp này thiếu **tham số**. |
| **F3** | 🔴 **CRITICAL** (bản đầu xếp 🟡 và ghi **SAI CHIỀU**) | **Đường Agent TỰ TRỊ (`aiAgentOrchestrator:411`) FAIL-OPEN**: bỏ `argsWithAuthCtx` = bỏ bước **XOÁ** `__authCtx` bịa ⇒ `checkPermission(999,"admin")` ⇒ `accessControl` `return true` **không đọc DB** ⇒ god-mode trên 29 read tool. **ĐÃ ĐO SỐNG** (999 tới cổng, dữ liệu chảy) và **ĐÃ SỬA** — §8.1 + §13. ⚠ "Planner trả plan rỗng" **không phải một cổng**. |
| **F4** | 🟡 | **`headroom.effectiveBytes` KHÔNG đổi sau một lệnh thu hồi thành công** (23.470.170.112 ở cả hai đầu, dù 5.030 MiB đã rời sổ). ⚠ **Cơ chế ĐÃ ĐÍNH CHÍNH** (§5): **không** phải cache — `decisionStateFor()` tính mới mỗi lượt đọc; thủ phạm là `used = max(ledgerTotal, attributable)` bị **GHIM bởi `attributable` của nhịp đo CŨ**. Kiểm bằng số học từ chính hai ảnh chụp: khớp tới từng byte. Agent đọc ô này ngay sau lệnh thấy số **CŨ**; bằng chứng đúng là `leaseLeftLedger` + `ledger.localBytes`. |

⚠ **Không phát hiện nào ở trên được vá trong Task 5** — task này ĐO, không chữa (ràng buộc của brief).

---

## 10. Chấm điều kiện ra của Pha 4

| # | điều kiện | chấm |
|---|---|---|
| 1 | Agent **truy vấn** được toàn bộ trạng thái, **mỗi trường nói đúng độ chắc chắn** | ✅ **ĐẠT** — §1 (L1 bắt được cả trạng thái `blind/ledger-only`) |
| 2 | Agent **ra lệnh** được, **có phân quyền**, đi qua **cơ chế đã có** | ✅ **ĐẠT** — §4 (9 lượt, 3 cổng khác nhau chặn đúng chỗ) |
| 3 | Mọi ô "đồng hồ không kim" có người đọc **hoặc** bị xoá kèm lý do | ⚠ **ĐẠT CÓ ĐIỀU KIỆN** (bản đầu chấm ✅ — **mâu thuẫn với §6.1 của chính nó**). Mặt ĐỌC: người đọc thật, render thật, không điều kiện. **Ba ô KẾT CỤC LỆNH thì không**: câu 6 chỉ hiện sau khi mở cửa sổ step-up **bằng một lượt gọi NGOÀI màn** (người vận hành không có đường làm), câu 7 chỉ hiện khi **có tiến trình anh em** (topology mặc định một tiến trình ⇒ nút không render). ⇒ trong cấu hình **mặc định đang chạy**, ba ô này **chưa có người đọc thật sự dùng được**. |
| 3b | ⚠ **`reserve()` vẫn phải ĐỒNG BỘ** (kiểm bằng MÃ, không bằng chữ ký) | ✅ **ĐẠT** — `vramBroker.ts:920` `export function reserve(request, ctx): VramReserveOutcome` — **không `async`**, **không trả `Promise`**, và **không một `await` nào** trong thân (mọi `await`/`async` trong vùng đó nằm trong **chú thích**). Bản đầu **bỏ sót** không chấm điều kiện này. |
| 4 | Câu chữ ba ngôn ngữ, không đường tiêm, `i18n:check` 0 lệch | ✅ — §11; và §6 chứng minh **nhánh `en` chạy thật** |
| 5 | Lệnh phá huỷ **không bao giờ khai thành công khi byte chưa nhả** | ✅ **ĐẠT** — §4 (4 lượt) + §5 (lượt thành công có bằng chứng thiết bị) |
| 6 | test vram xanh · `check` · `check:tests` · `i18n:check` | ✅ — §11 |
| **T5-A** | mỗi lớp rủi ro một lượt sống, mỗi lớp một role bị từ chối, `read_project_file` + `calc` vượt rào | 🔴 **CHƯA ĐẠT** — 3/4 lớp đạt; **lớp (c) + hai lượt vượt rào KHÔNG dựng được** (§9) |
| **T5-B** | render thật + chụp + đọc đủ 8 câu | ✅ **ĐẠT 8/8** — §6 |

⇒ **CỔNG RA CỦA TASK 5: CHƯA ĐẠT TOÀN PHẦN**, và đó là kết quả **ĐÚNG** — đúng tiền lệ Pha 1.
Phần chưa đạt **không phải** ở cơ chế VRAM (Pha 4 làm xong việc của nó), mà ở **bán kính nổ an ninh
của bản vá C-1**: lớp `readToolsProgramming` — nơi có `read_project_file` và `calc`, hai ranh giới
an ninh **chưa từng chạy** — vẫn **không với tới được** từ đường Agent.

---

## 11. Cổng kiểm trước khi commit — chạy lại sau khi đo

| lệnh | kết quả |
|---|---|
| `npx vitest run server/services/vram/ server/routers/vramRouter* client/src/lib/errorCodes*` | **39 file · 717/717 XANH** (8,29 s) |
| `npx vitest run server/services/aiLocalTools/` (đường THẬT của tool — brief ghi `server/services/ai/aiLocalTools*`, thư mục đó **không tồn tại**, nên glob rỗng) | **22 file · 224/224 XANH** |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run check` | **exit 0** |
| `npm run check:tests` | **exit 0** |
| `npm run i18n:check` | **0 key(s) with placeholder mismatch across en/vi/zh** |
| `git status --porcelain -- server/ client/` | **RỖNG** — không một dòng mã sản xuất nào bị đổi |

⚠ **Đính chính đường dẫn trong brief:** `server/services/ai/aiLocalTools*` không khớp file nào
(tool nằm ở `server/services/aiLocalTools/`). Đã chạy **cả hai** để glob rỗng không lặng lẽ thành
"xanh vì không có ca nào".

---

## 12. Dọn dẹp

Script/cảnh tạm đặt trong scratchpad
`C:\Users\Admin\AppData\Local\Temp\claude\d--SOURCES-avi-aoi-management\0a077309-…\scratchpad\`
(`lib-login.cjs`, `lib-ask.cjs`, `lib-trpc.cjs`, `t5a*.cjs`, `t5-cmd.cjs`, `t-*.cjs`, `*.log`,
`*-raw.json`) — **ĐÃ XOÁ** sau khi trích hết số vào báo cáo này. Không file tạm nào nằm trong repo.
Ảnh chụp được chuyển vào `docs/superpowers/reports/assets/2026-08-05-vram-pha4-nghiem-thu-song/`
và commit cùng báo cáo. Thư mục `.playwright-mcp/` đã nằm trong `.gitignore` (dòng 194).

---

## 13. 🔴 BẢN VÁ CRITICAL — đóng đường thoát thứ hai của `__authCtx` (vòng review Task 5)

⚠ Task 5 vốn **chỉ ĐO**. Ngoại lệ duy nhất này là **theo yêu cầu của vòng review**, vì thứ tìm ra
không phải một ô hiển thị sai mà là một **đường LEO THANG QUYỀN đang mở**.

### 13.1 Bản kiểm đếm MỌI điểm gọi `Tool.handler(` và cách xử từng cái

`git grep -n "\.handler(" -- 'server/**/*.ts'` (đã trừ `*.test.ts`) — **4 kết quả**, xử **hết**:

| # | vị trí | là `Tool.handler`? | xử |
|---|---|---|---|
| 1 | `services/aiLocalTools/index.ts:199` (`tryExecuteTool`) | **CÓ** | ĐÃ đúng từ Task 4 — giữ nguyên, nay nhập `argsWithAuthCtx` từ `toolRegistry` |
| 2 | `services/aiAgentOrchestrator.ts:411` (Agent tự trị) | **CÓ** | 🔴 **ĐÃ SỬA** → `tool.handler(argsWithAuthCtx(tool, step.args ?? {}, exec))` |
| 3 | `services/aiLocalTools/index.ts:49` | **KHÔNG** — nằm trong **chú thích** (docstring). AST không thấy chú thích. | không phải điểm gọi |
| 4 | `services/streaming/inProcessAdapter.ts:72` (`sub.handler(msg)`) | **KHÔNG** — `sub` là bản ghi **đăng ký pub/sub**, không phải `Tool`. Phân biệt **không theo tên biến**: file này **không import gì từ `aiLocalTools`** nên không thấy được kiểu `Tool`. | không phải điểm gọi |

Ngoài `server/`: `scripts/pilot-ai-persona.mjs`, `scripts/pilot-dispensing.mjs` gọi thẳng
`tool.handler({...})` — **script dev chạy tay, không có phiên, không nhận đầu vào từ ai**; chúng
không tiêm danh tính nên không phải đường leo thang. Ghi lại để người sau không tưởng là bỏ sót.

### 13.2 Bản vá

**Đổi CHỖ Ở, không chỉ thêm một lời gọi.** `argsWithAuthCtx` từng là **hàm private của `index.ts`**.

> 🔴 **ĐÍNH CHÍNH (re-review) — câu dưới đây bị bản đầu phát biểu QUÁ MẠNH.** Bản đầu viết
> *"private CHÍNH LÀ lỗ hổng"*, đọc như thể private khiến đường thoát thứ hai **không viết ra được**
> bản đúng. **Sai theo nghĩa đen**: tác giả `aiAgentOrchestrator.ts` hoàn toàn **viết được** bản đúng
> — export hàm ra (đúng việc bản vá này vừa làm), gọi qua `tryExecuteTool()`, hoặc tự viết phép làm
> sạch riêng. Private **không chặn** ai cả.
> ⇒ **Phát biểu đúng:** với một bất biến **XUYÊN NGANG** (mọi người gọi `Tool.handler` đều phải qua),
> đóng gói (private) là **công cụ SAI**, không phải "lỗ hổng" theo nghĩa nó ngăn cản viết đúng. Nó sai
> vì nó khiến lựa chọn **ĐÚNG** đòi **sửa một module khác** (import hàm private ra ngoài được thì đã
> không còn private), còn lựa chọn **RẺ NHẤT tại chỗ** — gọi thẳng `tool.handler(step.args)` — không
> đòi gì cả. Một bất biến an ninh mà con đường rẻ nhất lại là con đường fail-open thì sớm muộn cũng bị
> chọn. Private không "gây" ra lỗ; nó làm cho **mặc định trở thành fail-open**.

Nay hàm nằm ở
`aiLocalTools/toolRegistry.ts` (module **LÁ**, chỉ import `zod`), **cạnh đúng kiểu `Tool` mà nó bảo
vệ**, nên mọi người gọi `Tool.handler` đều với tới được **mà không tạo vòng nhập** —
`aiAgentOrchestrator` **vốn đã** import `./aiLocalTools/toolRegistry`, nên bản vá **không thêm một
cạnh phụ thuộc nào**. Đây là chỗ đặt bất biến **cùng module với kiểu nó bảo vệ**, biến "dễ viết đúng
hơn" thành "khó viết sai mà không bị lưới AST bắt" (§13.3 xác nhận bằng đột biến M3 — file mới, chưa
ai import, vẫn rơi vào lưới).

```
git show 6c1de901:server/services/aiAgentOrchestrator.ts | sed -n '411p'
  → const result = await tool.handler(step.args ?? {});          ← TRƯỚC (fail-open)

git show <HEAD>:server/services/aiAgentOrchestrator.ts
  → const result = await tool.handler(argsWithAuthCtx(tool, step.args ?? {}, exec));   ← SAU
```

### 13.3 Lưới — theo ĐƯỜNG THOÁT, không theo FILE

**A. `server/services/aiAgentOrchestrator.authCtx.test.ts` (5 ca) — đi từ ĐẦU đường tự trị.**
Seam duy nhất là `planGoal` (đứng đúng chỗ **người sản xuất args không tin được** đứng) và
`checkPermission` (**thứ đang được ĐO**). Registry thật, `get_vram_state` thật, `argsWithAuthCtx` thật.

| ca | bất biến |
|---|---|
| ★★★ `__authCtx` BỊA ⇒ cổng RBAC **không bao giờ** nhận `[999,'admin']` | chống leo thang |
| ★★★ cổng nhận **đúng** `(7,'supervisor')` | phiên là nguồn DUY NHẤT |
| ★★★ **ô bịa không mua được một byte nào — DÙ cổng nói CÓ với nó** | ⚠ `checkPermission` được lập trình trả `true` **chỉ cho danh tính bịa** (mô phỏng đúng `accessControl.ts:135-137`). Một `mockResolvedValue(false)` phẳng sẽ xanh **vì lý do sai**. |
| ★★ chiều NGƯỢC — phiên hợp lệ ⇒ đọc được trạng thái THẬT | chống "vá bằng cách chặn hết" |
| ★★ args **KHÔNG** mang `__authCtx` ⇒ vẫn **GÁN** danh tính phiên | neo nửa **GÁN** (chỉ XOÁ mà quên GÁN thì tool chết trên đường tự trị) |

**B. `authCtxInjection.test.ts` (+5 ca) — BẢN KIỂM ĐẾM trên AST.**
Bất biến: *"KHÔNG một điểm gọi `Tool.handler(` nào trong mã sản xuất được nhận args chưa qua
`argsWithAuthCtx(...)`"* — **liệt kê bằng AST, không bằng danh sách chép tay**, nên một điểm gọi MỚI
(file mới, tên biến khác) rơi vào lưới ngay.
⚠ Phân biệt *"có phải `Tool.handler` không"* **KHÔNG theo tên biến**: một file chỉ gọi được
`Tool.handler` nếu nó **thấy kiểu `Tool`** (có `import` từ `aiLocalTools/**`). Đó là lý do
`sub.handler(msg)` của pub/sub rơi ra ngoài **theo cấu trúc**, không bằng một dòng miễn trừ.
⚠ Bất biến phát biểu về cái đối số **PHẢI LÀ** (`CallExpression` với callee `argsWithAuthCtx`), không
phải "có chứa chuỗi" — kèm **lưới-cho-lưới** chạy **sáu** hình dạng lách (biến trung gian · `?:` ·
`??` · `&&` · hàm khác · trần) và **một** chiều dương.

### 13.4 Hai đột biến bắt buộc — kết quả

| đột biến | ca ĐỎ |
|---|---|
| (M1) `__authCtx` **bịa** trong `step.args` đi qua đường orchestrator tự trị | 4 ca (xem §13.5) |
| (M2) gỡ `argsWithAuthCtx` ở **bất kỳ** điểm gọi `tool.handler(` nào | 2 ca kiểm đếm (xem §13.5) |

### 13.5 Kết quả đột biến — **COMMIT TRƯỚC, ĐỘT BIẾN SAU**, `git checkout --` sau mỗi lượt

Bản vá đã commit ở **`47969de5`** trước khi chạy đột biến; sau mỗi lượt đều `git checkout -- <file>`
và xác nhận `git status --porcelain -- server/ client/` **RỖNG**.

| đột biến | thao tác | ca ĐỎ | ghi chú |
|---|---|---|---|
| **M1** — gỡ cổng ở **Agent tự trị** | `aiAgentOrchestrator.ts:429` → `tool.handler(step.args ?? {})` | 🔴 **6 ĐỎ** | 4 ca hành vi (`checkPermission` nhận **999** trở lại; bước read **trả về dữ liệu** thay vì `PERMISSION_DENIED`) + **2 ca kiểm đếm** |
| **M2** — gỡ cổng ở **`tryExecuteTool`** (điểm gọi CÒN LẠI) | `index.ts:146` → `tool.handler(decision.args)` | 🔴 **9 ĐỎ** | 7 ca N-1/N-4 + **2 ca kiểm đếm** ⇒ *"gỡ ở **BẤT KỲ** điểm gọi nào ⇒ đỏ"* được chứng minh ở **cả hai** điểm |
| **M3** (tự thêm) — **ĐIỂM GỌI MỚI trong FILE MỚI** | tạo `services/__t5MutationProbe.ts` gọi `tool.handler(args)` | 🔴 **2 ĐỎ**, kèm **con trỏ chính xác**: `services/__t5MutationProbe.ts:5 → handler(args)` | Chứng minh lưới **liệt kê bằng AST**, không phải một danh sách chép tay: một file **chưa từng tồn tại** vẫn rơi vào lưới. Đây là bất biến mà M1/M2 **không** chứng minh được. |

⚠ M3 là đột biến quan trọng nhất về mặt cấu trúc: nó là thứ phân biệt *"lưới theo ĐƯỜNG THOÁT"* với
*"lưới theo FILE"* — đúng lớp lỗi đã tái diễn **mười một** lần trong chuỗi pha này.

### 13.6 Xác nhận bằng `git show` (không tin lời khai)

```
git show 6c1de901:server/services/aiAgentOrchestrator.ts | grep -n "tool.handler("
  411:        const result = await tool.handler(step.args ?? {});                                  ← TRƯỚC

git show 47969de5:server/services/aiAgentOrchestrator.ts | grep -n "tool.handler("
  429:        const result = await tool.handler(argsWithAuthCtx(tool, step.args ?? {}, exec));      ← SAU

git show 47969de5:server/services/aiLocalTools/toolRegistry.ts | grep -n "export function argsWithAuthCtx"
  264:export function argsWithAuthCtx(tool: Tool<any, any>, args: unknown, execCtx?: ToolExecContext): unknown {

git show 47969de5:server/services/aiLocalTools/index.ts | grep -n "import { argsWithAuthCtx }\|await tool.handler("
  51:import { argsWithAuthCtx } from "./toolRegistry";
  146:    const result = await tool.handler(argsWithAuthCtx(tool, decision.args, execCtx));
```

### 13.7 Cổng kiểm sau bản vá + sau đột biến

> 🔴 **ĐÍNH CHÍNH (RR-1, vòng re-review) — DÒNG "61 file · 945/945 XANH" DƯỚI ĐÂY LÀ SAI, VÀ SAI
> ĐÚNG LỚP LỖI MÀ MỤC NÀY TỒN TẠI ĐỂ ĐÓNG.** Lệnh được gõ trong một shell không tự giãn `*`
> (native executable, không phải cmdlet) ⇒ token `server/services/aiAgentOrchestrator*` được vitest
> nhận **NGUYÊN VĂN làm bộ lọc chuỗi**, không khớp file nào (ký tự `*` theo nghĩa đen không có trong
> tên file thật) ⇒ **cả hai file test vừa sửa (`aiAgentOrchestrator.test.ts`,
> `aiAgentOrchestrator.replan.test.ts`) bị loại KHỎI lượt chạy một cách IM LẶNG**, và bộ 61 file/945 ca
> còn lại (đúng bằng hai glob của báo cáo GỐC: 39 + 22) vẫn báo "xanh" bình thường. Kết quả: bản vá
> **thật sự đẻ ra 18 ca đỏ** ở hai file đó (đo được ở vòng review: TRƯỚC vá 1 đỏ/41 xanh → SAU vá
> 19 đỏ/23 xanh), mà dòng cổng kiểm này không hề thấy — **sửa file A, chạy lưới theo glob của file B**,
> đúng lớp lỗi "lưới theo FILE, không theo ĐƯỜNG THOÁT" đã tái diễn ở đây **lần thứ MƯỜI MỘT, nay ở
> TẦNG QUY TRÌNH** (không phải ở mã lưới). Đã đóng ở **§14** (vòng sửa cuối) — xem đó để có con số
> ĐÚNG, đo bằng đường dẫn tường minh (không dùng `*`), cả bình thường lẫn xáo trộn thứ tự ca.

| lệnh (nguyên văn lúc ghi — GIỮ LẠI để làm bằng chứng của chính lỗi này) | kết quả đã khai (SAI, xem đính chính trên) |
|---|---|
| `npx vitest run server/services/vram/ server/routers/vramRouter* client/src/lib/errorCodes* server/services/aiLocalTools/ server/services/aiAgentOrchestrator*` | ~~61 file · 945/945 XANH~~ — **glob `aiAgentOrchestrator*` khớp 0 file, âm thầm** |
| …cùng lệnh **`--sequence.shuffle.tests`** | ~~945/945 XANH~~ (cùng lỗ hổng glob) |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run check` | **exit 0** (mục này không phụ thuộc glob, vẫn đúng) |
| `npm run check:tests` | **exit 0** (như trên) |
| `npm run i18n:check` | **0 lệch** (như trên) |
| `git status --porcelain -- server/ client/` | **RỖNG** (như trên) |

⚠ **Đính chính glob của brief (người review xác nhận): `server/services/ai/aiLocalTools*` KHÔNG khớp
file nào** — tool nằm ở `server/services/aiLocalTools/`. Dùng nguyên văn glob đó thì bộ ca của lớp
tool **im lặng biến mất** khỏi lượt chạy mà vẫn báo "xanh". (Cùng bài học: đường dẫn/glob sai khớp
"0 file" không phải "0 lỗi" — phải luôn đối chiếu SỐ FILE, không chỉ SỐ CA xanh.)

### 13.8 Còn treo — chuyển bàn giao **review toàn nhánh**

| # | mục | vì sao KHÔNG sửa ở đây |
|---|---|---|
| **F1** 🟠 | `VramBrokerPanel` không gửi `totpCode`, không dùng `StepUpOtpDialog` ⇒ hai nút phá huỷ **không bấm được với BẤT KỲ vai nào** khi `ACTUATION_STEPUP_2FA=true`. **Người review xác nhận độc lập** (supervisor1 qua role-floor vẫn 403 ở step-up). | Là **sửa UI**, không phải lỗ an ninh; nằm ngoài phạm vi vòng review này. |
| **F2** 🟠 | 8/8 tool `readToolsProgramming` không với tới được (thiếu `case` trong `extractArgsForTool`) ⇒ hai ranh giới an ninh (`read_project_file`, `calc`) **chưa từng chạy**. | ~~Là **nợ CHẶN** (§3.1) — sửa nó là mở một bề mặt mới, phải có lưới sống trước.~~ 🔴 **ĐÍNH CHÍNH — CÂU NÀY SAI CHIỀU.** Xem §15. |
| **U19** 🟡 | Đường tự trị **end-to-end THẬT** vẫn chưa chạy (planner trả `steps: []`). | ~~Bản vá đã đóng lỗ ở mức đơn vị; khi planner được sửa **phải đo lại §8.1 trên đường thật**.~~ 🔴 **ĐÍNH CHÍNH — LỜI HOÃN ĐÃ HẾT HIỆU LỰC.** Xem §15. |

---

## 14. Vòng sửa CUỐI (re-review có phạm vi `6c1de901..a3ae3d2a`) — đóng RR-1..RR-4

> Review vòng 2 kết luận **KHÔNG DUYỆT** vì đúng **một** mục vượt Minor: bản vá §13 đẻ ra **18 ca đỏ**
> ở hai file test có sẵn mà không ai chạy (RR-1, 🟠 CHẶN), cộng ba mục 🟡 Minor (RR-2/RR-3/RR-4).
> Mục này đóng cả bốn, tại HEAD hiện tại — **không sửa gì khác** ngoài phạm vi được giao.

### 14.1 RR-1 (CHẶN) — đóng: `1 đỏ → 19 đỏ` ⇒ về lại `1 đỏ` (nợ có sẵn, không thuộc lượt vá)

**Gốc rễ đã xác nhận đúng như review chỉ ra:** `server/services/aiAgentOrchestrator.test.ts:112` và
`server/services/aiAgentOrchestrator.replan.test.ts:120` giả `./aiLocalTools/toolRegistry` bằng một
factory phẳng khai `getTool/isWriteTool/isClientTool` — **thiếu `argsWithAuthCtx`**. Sau bản vá §13
(dòng 429 gọi `tool.handler(argsWithAuthCtx(tool, step.args ?? {}, exec))`), `argsWithAuthCtx` trong
hai file này là `undefined` ⇒ gọi nó **ném `TypeError`** ⇒ mọi bước `read` `failed` ⇒ phiên `paused`
thay vì trạng thái mong đợi.

**Bản vá (mỗi file một chỗ, giữ nguyên phần còn lại của mock):**

```ts
// TRƯỚC (thiếu argsWithAuthCtx):
vi.mock("./aiLocalTools/toolRegistry", () => ({
  getTool: (name: string) => tools[name],
  isWriteTool: (t: any) => !!t && t.kind === "write",
  isClientTool: (t: any) => !!t && t.kind === "client",
}));

// SAU (importOriginal — giữ `argsWithAuthCtx` THẬT, chỉ override 3 export còn lại):
vi.mock("./aiLocalTools/toolRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./aiLocalTools/toolRegistry")>();
  return {
    ...actual,
    getTool: (name: string) => tools[name],
    isWriteTool: (t: any) => !!t && t.kind === "write",
    isClientTool: (t: any) => !!t && t.kind === "client",
  };
});
```

Chọn nhánh **"tốt hơn"** mà review gợi ý (`importOriginal()` + ghi đè có chọn lọc), không phải stub
`(_t, a) => a`: `toolRegistry.ts` là module **LÁ THẬT** (chỉ `import { z } from "zod"`, đã xác nhận ở
§13.1), nên `importOriginal()` không kéo theo side-effect hay vòng nhập nào; và giữ hàm THẬT nghĩa là
phép làm sạch `__authCtx` **thật sự chạy** trong cả hai bộ ca này, không chỉ được giả lập bằng identity.
(Với các tool cục bộ trong hai file này — `parameters: {}`, không có `.shape` — hành vi quan sát được
**giống hệt** identity, vì `argsWithAuthCtx` không tìm thấy khoá `__authCtx` trong schema để gán lại;
nhưng dùng bản thật vẫn đúng nguyên tắc hơn một stub.)

**Đo lại — hai chiều, cùng cặp file, đúng cách review đã đo:**

| bản | lệnh | kết quả |
|---|---|---|
| SAU vá (bản này) | `npx vitest run server/services/aiAgentOrchestrator.test.ts server/services/aiAgentOrchestrator.replan.test.ts` | **1 đỏ / 41 xanh** |

Ca đỏ duy nhất còn lại: `agentic gate (server role) > manager is allowed; worker/engineer are not`
(`aiAgentOrchestrator.test.ts:157`, `expect(canUseAgentic({role:"engineer"})).toBe(false)` nhận
`true`) — **nợ có sẵn**, không thuộc lượt vá này. Xác nhận `AGENTIC_ROLES` **giống hệt** ở `6c1de901`
(TRƯỚC vá C-1) và HEAD hiện tại:
```
git show 6c1de901:server/services/aiAgentOrchestrator.ts | grep -n AGENTIC_ROLES
  81:const AGENTIC_ROLES = new Set(["manager", "it_admin", "admin", "supervisor", "maintenance", "engineer"]);
(HEAD hiện tại: cùng một dòng, cùng danh sách) → "engineer" ĐÃ nằm trong tập từ trước bản vá này.
```
⇒ **KHÔNG nhận, KHÔNG sửa** ca này — đúng ràng buộc của vòng sửa.

### 14.2 RR-2 (Minor) — đóng bằng SỬA LƯỚI (không chỉ ghi docstring)

`thayKieuTool()` (trong `authCtxInjection.test.ts`) trước đây chỉ duyệt `sf.statements` (top-level)
tìm `ts.isImportDeclaration` — mù với `await import(...)` vì đó là một `CallExpression` (callee
`ImportKeyword`), và trong mã sản xuất mẫu này luôn nằm **lồng trong thân hàm**, không phải statement
top-level (`aiAutoProposer.ts:314,671`, `aiThresholdTuneScheduler.ts:244`).

**Bản vá:** đổi từ duyệt `sf.statements` (nông) sang duyệt **toàn bộ cây** (đệ quy `ts.forEachChild`),
bắt cả hai hình dạng: `ImportDeclaration` tĩnh **và** `CallExpression` với `expression.kind ===
ts.SyntaxKind.ImportKeyword` mà đối số đầu là chuỗi chứa `"aiLocalTools"`.

**Xác nhận bằng đột biến độc lập (cùng khuôn M3 của review, KHÔNG dùng lại file của họ):** dựng tạm
`server/routers/__rr2ProbeDyn.ts` —

```ts
export async function probeDyn(soLieu: Record<string, unknown>): Promise<unknown> {
  const reg = await import("../services/aiLocalTools/toolRegistry");
  const x = reg.getTool("get_vram_state");
  if (!x || typeof x.handler !== "function") return null;
  return await x.handler(soLieu); // KHÔNG qua argsWithAuthCtx
}
```

| lượt | kết quả |
|---|---|
| **TRƯỚC vá lưới** (giả định — không chạy lại, review đã đo: 12/12 xanh, lưới KHÔNG bắt) | mù, đúng RR-2 |
| **SAU vá lưới**, có probe | 🔴 **2 ĐỎ**, kèm con trỏ chính xác: `routers/__rr2ProbeDyn.ts:6 → handler(soLieu)` |
| **SAU vá lưới**, đã xoá probe | ✅ **12/12 XANH** (về lại đúng số ca cũ, không có ca nào bị thêm/bớt ngoài ý muốn) |

File probe **đã xoá** ngay sau khi xác nhận (`server/routers/__rr2ProbeDyn.ts` không còn trong cây —
`git status --porcelain -- server/` rỗng). ⇒ RR-2 đóng bằng **sửa lưới thật**, không chỉ thu hẹp lời
khai trong docstring — ba điểm gọi import-động hiện có trong mã sản xuất
(`aiAutoProposer.ts:314,671`, `aiThresholdTuneScheduler.ts:244`) **vẫn chưa gọi `.handler(` nào** (đã
kiểm lại), nên chưa có lỗ sống thứ ba — nhưng nay nếu ai đó thêm một lời gọi `.handler(` cạnh một
`await import("...aiLocalTools...")`, lưới **thấy được**.

### 14.3 RR-3 (Minor) — đóng: sửa câu, giữ vế ĐÚNG, bỏ vế KHÔNG BỀN

Xem bản sửa trực tiếp trong §7 (dòng "Hàng của tiến trình ĐÃ CHẾT còn sót…"): đã bỏ *"tổng 0 byte ⇒
vô hại"*, giữ *"tự lành"*, và tự đo lại **ngay tại lượt sửa này** (`postgres` npm package, SELECT trực
tiếp, không qua ứng dụng, `2026-08-05T17:55:45Z`): **3 hàng / 3.646.205.953 B**, `processKey`
`all:31772` + `api:13404` — cả hai còn sống tại thời điểm đo (xác nhận PID bằng
`Get-CimInstance Win32_Process`, dòng lệnh khớp `server/_core/index.ts`). Không phải rác — đây chính
là hai server dev mà RR-4 xử lý ngay dưới đây.

### 14.4 RR-4 (Minor) — đóng: hai server dev đã TẮT theo PID

**Xác nhận hai server dev đang chạy, khớp mô tả của RR-4** (cổng 3000 + 3100, cùng lệnh
`server/_core/index.ts` qua `tsx`; PID khác con số review ghi vì máy đã khởi động lại giữa hai vòng
review — cùng CHỨC NĂNG, không phải cùng tiến trình):

```
netstat -ano | grep -E ":3000 |:3100 "
  TCP 0.0.0.0:3000 LISTENING 31772
  TCP 0.0.0.0:3100 LISTENING 13404
Get-CimInstance Win32_Process -Filter 'ProcessId=31772 or ProcessId=13404'
  → cả hai: node.exe --require tsx/preflight.cjs ... server/_core/index.ts
```

**Đo TRƯỚC khi tắt** (`2026-08-05T17:59:56Z`): `nvidia-smi` **2.128 MiB**.

**Tắt theo đúng PID** (không quét theo tên, không giết bừa):
```
taskkill /F /PID 31772 /T   → SUCCESS (2 tiến trình: 31772 + con 18992)
taskkill /F /PID 13404 /T   → SUCCESS (2 tiến trình: 13404 + con 39400)
```

**Đo SAU khi tắt** (`2026-08-05T18:00:16Z`, sau khi đợi driver giải phóng bộ nhớ): `nvidia-smi`
**1.277 MiB** — **−851 MiB** đúng chiều (hai tiến trình dev ăn VRAM đã rời khỏi thiết bị). Cổng 3000 +
3100 hết `LISTENING` — chỉ còn vài dòng `SYN_SENT` của client cũ đang thử kết nối lại rồi tự hết hạn,
không phải tiến trình máy chủ.

⚠ **Ghi lại phát hiện `vram:baseline` "nền BẨN" mà RR-4 nêu** (đo bởi người review lúc trước, không
tái lập lại vì trạng thái máy đã đổi giữa hai vòng): lúc review đo, `vram:baseline` trong
`vram_leases` = **12.404.695.041 B (11.830 MiB)** trong khi thiết bị lúc đó chỉ dùng **2.017 MiB** —
lệch hơn 5 lần, đúng dấu hiệu **baseline chụp lúc một model đang nạp giữa chừng** (nền bẩn), hợp với
đường **U9** (hai tiến trình chạy đồng thời) mà báo cáo đã ghi là **CHƯA ĐI** ở mức "hai lệnh cùng
lúc" — nay ghi thêm biến thể "hai TIẾN TRÌNH cùng lúc làm bẩn baseline của nhau" như một hệ quả cụ thể
đã quan sát được. Không sửa cơ chế `baseline` ở lượt này (ngoài phạm vi bốn mục RR).

### 14.5 Ghi chú vận hành cho người sau (theo yêu cầu của review)

⚠ **`git checkout <commit> -- <file>` GHI VÀO INDEX, không chỉ working tree.** Nếu dùng nó để xem/áp
tạm nội dung một commit cũ lên một file (ví dụ để chạy đột biến thủ công), thao tác khôi phục đúng
là **`git checkout HEAD -- <file>`** (nạp lại từ HEAD, bỏ qua index) — dùng `git checkout -- <file>`
đơn thuần sau đó sẽ khôi phục **từ index**, tức vẫn giữ nguyên bản commit cũ vừa nạp, KHÔNG quay lại
bản trên HEAD. Người review vòng 1 đã tự vấp lỗi này và ghi lại; không ai trong vòng sửa cuối cần
dùng `git checkout <commit> -- <file>`, nên không có gì để khôi phục ở đây — ghi lại thuần tuý để bàn
giao cho lượt sau (đặc biệt nếu ai đó tái chạy đột biến M1/M2/M3 của §13.4).

### 14.6 Cổng kiểm CUỐI CÙNG — đường dẫn tường minh, không dùng ký tự `*` chưa được shell giãn

> Bài học rút từ chính đính chính ở §13.7: chạy lại với **đường dẫn liệt kê rõ**, không glob, để
> không lặp lại đúng lỗi vừa đóng.

| lệnh | kết quả |
|---|---|
| `npx vitest run server/services/vram/ server/services/aiLocalTools/ server/routers/vramRouter client/src/lib/errorCodes server/services/aiAgentOrchestrator` | **72/73 file · 1256/1257 ca** — **1 đỏ DUY NHẤT** là `canUseAgentic` (nợ có sẵn, §14.1), mọi ca khác XANH kể cả 18 ca RR-1 vừa đóng |
| …cùng lệnh **`--sequence.shuffle.tests`** | **cùng kết quả**: 72/73 file · 1256/1257 ca, cùng một ca đỏ |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run check` | **exit 0** |
| `npm run check:tests` | **exit 0** |
| `npm run i18n:check` | **0 key(s) with placeholder mismatch across en/vi/zh** |
| `git status --porcelain -- server/ client/` | Chỉ 3 file test bị đổi (RR-1 × 2 + RR-2 × 1) — **KHÔNG một dòng mã sản xuất nào** |

### 14.7 Trạng thái hệ sau vòng sửa cuối

| việc | trạng thái |
|---|---|
| Hai server dev :3000 (PID 31772) + :3100 (PID 13404) | **ĐÃ TẮT theo PID** (§14.4); GPU 2.128 → 1.277 MiB |
| `vram_leases` sau khi tắt | 3 hàng còn lại mang `processKey` của hai tiến trình vừa tắt — **CHƯA tự dọn** (đúng cơ chế đã ghi: chỉ tiến trình SỐNG kế tiếp mới đối chiếu và xoá hàng của tiến trình chết; không có tiến trình nào đang chạy ⇒ chưa ai chạy nhịp đối chiếu). Sẽ tự dọn ở lần `npm run dev` kế tiếp. |
| Mã sản xuất | **KHÔNG SỬA MỘT DÒNG NÀO** — chỉ 3 file `*.test.ts` bị đổi (RR-1: 2 file, RR-2: 1 file) + báo cáo này |
| File tạm | `server/routers/__rr2ProbeDyn.ts` (RR-2) và hai script SELECT (`__rr_leases_check*.cjs`, RR-3) **đã xoá**, không nằm trong repo |
| Trainer · `kb:sync` · DDL/migration | **KHÔNG chạy cái nào** |
| 243 mục bẩn có sẵn của việc khác | **KHÔNG đụng, KHÔNG dọn, KHÔNG stage** |
| Sub-agent | **KHÔNG sinh** |

---

## 15. 🔴 ĐÍNH CHÍNH F2 + U19 (2026-08-06, sau review TOÀN NHÁNH) — **ĐÃ ĐO, KHÔNG CÒN LÀ NỢ**

### 15.1 F2 — câu *"nợ CHẶN, phải có lưới sống trước"* **SAI CHIỀU**

Người review bác chẩn đoán §3.1 và **đo được**: `classifyToolIntentLLM` (`AI_TOOL_LLM_FALLBACK=1`,
BẬT trên hệ đang chạy) **KHÔNG gọi `extractArgsForTool` một lần nào** — nó liệt kê MỌI tool bằng
`listTools()`, để model sinh `args`, rồi `tool.parameters.safeParse(parsed.args)`. ⇒ *"mã chết"*
không phải một tính chất **cấu trúc**; nó là quan sát về **hành vi của một model phân loại nhỏ
dưới ~5 câu hỏi**. **Bề mặt đã mở sẵn từ trước.**

⇒ Việc đúng **không phải hoãn** — mà là **nghiệm thu nó ngay**. Người review đã chạy cả 8 tool
bằng bộ phân loại **stub** (không nạp model, không tốn một byte VRAM) và ghi được **nguyên văn** hai
câu từ chối mà báo cáo này khai là *"không ghi được vì chưa lượt nào tới được hàm"*. Cả **6 payload
T5-A gọi tên đều bị chặn** (`PATH_REJECTED` · `INVALID_EXPRESSION`), đối chứng dương `calc 2+3*4 = 14`,
lượt bị từ chối `PERMISSION_DENIED` + **0 byte dữ liệu**. Bảng đầy đủ: §4.2 của báo cáo review toàn nhánh.

**T5-A lớp (c) ⇒ 🔴 CHƯA ĐẠT → ✅ ĐẠT** (còn payload symlink, đóng ở §15.2).

### 15.2 N7 — payload **symlink** (mảnh cuối của T5-A) — **ĐO ĐƯỢC 2026-08-06**

Harness: `PROG_WORKSPACE_DIR` trỏ một thư mục tạm, file bí mật đặt **NGOÀI** nó; đi qua
`tryExecuteTool()` với bộ phân loại stub (`reason: LLM_MATCH`, handler **CHẠY**), danh tính phiên THẬT.

| biến thể | dựng được? | kết quả **ĐO ĐƯỢC** |
|---|---|---|
| **symlink FILE** (`fs.symlinkSync(..., "file")`) | ❌ **KHÔNG** — `EPERM: operation not permitted` (Windows đòi `SeCreateSymbolicLinkPrivilege`/Developer Mode) | lượt đọc trả `NOT_FOUND` · `bytes=null` · `content=null` (không có link để đi) |
| **junction THƯ MỤC** ra ngoài workspace — **thoát mạnh hơn** (thoát cả một cây, không chỉ một file) | ✅ **CÓ** | 🟢 **BỊ CHẶN**: `note: PATH_REJECTED` · *"Đường dẫn thoát khỏi thư mục làm việc bị từ chối."* · `bytes=null` · `content=null`. Chặn bởi `realpathStillContained()` (`readToolsProgramming.ts:193`). |
| **ĐỐI CHỨNG DƯƠNG** `ok.txt` trong workspace | ✅ | `Đọc "ok.txt" (19 byte)` — **giá trị cụ thể**, phân biệt được với hai lượt trên |

⇒ **Ranh giới symlink ĐỨNG VỮNG** ở biến thể dựng được, và biến thể ấy **mạnh hơn** biến thể không
dựng được. **T5-A ⇒ ✅ ĐẠT ĐỦ.**

> 🟠 **PHÁT HIỆN MỚI của lượt đo này — `realpathStillContained()` KHÔNG chặn được NTFS HARD LINK.**
> `fs.linkSync(<file ngoài>, <trong workspace>)` dựng **THÀNH CÔNG** (không cần đặc quyền nào), và
> lượt đọc **THÀNH CÔNG**: `bytes = 57`, `content = "DATABASE_URL=postgres://aoi:SUPERSECRET@…"` —
> **nội dung bí mật ngoài workspace về tới Agent**. Cơ chế: hard link **không đổi `realpath`** (cùng
> inode, đường dẫn tự phân giải về chính nó) nên vị từ ấy trả `true`.
> **Hạng:** thấp hơn lớp payload-chuỗi vì đòi kẻ tấn công **đã ghi được** vào `PROG_WORKSPACE_DIR`
> trên **cùng ổ đĩa** — nhưng lời khai *"confined to the programming workspace root"* ở docstring
> `read_project_file` **rộng hơn sự thật**. ⇒ Nợ Pha 5 (N13).

### 15.3 U19 / §8.1 — **ĐÃ ĐO LẠI TRÊN BỀ MẶT ĐANG SỐNG, KHÔNG CHỜ PLANNER**

Lời hoãn *"khi planner được sửa mới đo lại"* hết hiệu lực: `aiAgentOrchestrator.ts:429` lấy
`step.args` **thẳng** và `tryExecuteTool` + LLM fallback **đang sống** — cùng một lớp *"an toàn là
HỆ QUẢ của một thứ khác đang hỏng"*, lần thứ BA trong Pha 4.

Đo trên đường SỐNG (`classifyToolIntentLLM` stub sinh args mang `__authCtx` **BỊA**
`{userId: 999, role: "admin"}`, phiên THẬT là `supervisor` id 7, `checkPermission` chỉ trả `true`
cho `(999, "admin")`):

| # | đo | kết quả **ĐO ĐƯỢC** |
|---|---|---|
| 1 | đối số THẬT `checkPermission` nhận | **`[7, "supervisor", "machine_monitoring", "canView"]`** — danh tính PHIÊN. `999`/`admin` **KHÔNG BAO GIỜ** chạm cổng. |
| 2 | kết cục | `note: PERMISSION_DENIED` · *"Bạn không có quyền dùng công cụ lập trình (machine_monitoring)…"* · `bytes = null` · `content = null` ⇒ **0 byte** |
| 3 | `argsWithAuthCtx()` trả gì (⇐ **CÙNG hàm** mà `aiAgentOrchestrator:429` gọi) | `{"path":"ok.txt","__authCtx":{"userId":7,"role":"supervisor"}}` — `__authCtx` bịa **BỊ XOÁ**, gán lại từ phiên |
| 4 | cùng payload, **KHÔNG** `execCtx` (lời gọi cũ) | `checkPermission` **KHÔNG được gọi lần nào** (`[]`) · `PERMISSION_DENIED` · 0 byte |

⇒ **§8.1 nay FAIL-CLOSED, đo được trên bề mặt đang sống** — không phụ thuộc planner. **U19 ĐÓNG.**
⚠ Điều **chưa** đo được và vẫn treo: lượt **planner THẬT sinh `plan.steps` khác rỗng** (cần model
thật). Nhưng bất biến mà §8.1 canh **không đi qua planner** — nó đi qua `argsWithAuthCtx`, và hàm ấy
vừa được đo trực tiếp. Nợ còn lại là *"planner có hoạt động không"*, **không phải** *"lỗ có mở không"*.

---
