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
| DB | `postgresql://aoi@127.0.0.1:5434/aoi_management` | `.env` |
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
| `engineer1` | 51 | engineer | view✓ create✓ **delete✗** | view✓ | — | — |
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

**Lượt sống L2** · 22:55 · cùng ảnh chụp qua `trpc.vram.state` (panel đọc) — sau khi nhịp đo đã xong:

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

⚠ **Một quan sát đáng ghi:** `headroom.effectiveBytes` **KHÔNG đổi** (23.470.170.112 ở cả hai đầu) —
dư địa chỉ được tính lại ở **nhịp quyết định** kế tiếp, không phải ngay khi lệnh trả về. Ai đọc
`effectiveBytes` ngay sau một lệnh thu hồi sẽ thấy một con số **cũ**; bằng chứng đúng là
`ledger.localBytes` + danh sách hộ (và `leaseLeftLedger` trong kết quả lệnh).

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

### 8.1 🟠 U1 — đường Agent TỰ TRỊ **không được bản vá C-1 phủ** (tĩnh: có · sống: **CHƯA**)

`server/services/aiAgentOrchestrator.ts:411` — nhánh `step.kind === "read"`:

```ts
const result = await tool.handler(step.args ?? {});
```

**Không** đi qua `argsWithAuthCtx()`, dù `exec` (`ToolExecContext`, danh tính phiên thật) **đang ở
trong tầm** ngay tại đó — chính hàm này dùng `exec` ở dòng **389** (`buildClientAction`) và **505**
(`proposeAction`). ⇒ Trên đường tự trị, **cả 29 tool "hồi sinh"** vẫn nhận `__authCtx === undefined`
⇒ vẫn `PERMISSION_DENIED` + 0 byte dữ liệu.

⚠ **CHƯA NGHIỆM THU SỐNG, và tôi ghi thẳng là chưa**: đã chạy **2 lượt** `aiAgent.startSession`
(`AI_AGENTIC_ENABLED=1`, `supervisor1` ∈ `AGENTIC_ROLES`) với hai mục tiêu khác nhau
(*"Liệt kê danh sách sản phẩm đang có"*, *"Xem trạng thái tất cả máy đang offline rồi tổng hợp lại"*);
cả hai lượt **`plan.steps = []`** (`approvePlan` → `status:"done"`, `step:null`) nên **không bước `read`
nào chạy**. Đây là một **quan sát TĨNH có trích dẫn dòng**, không phải một phép đo — người sau phải
dựng được một plan có bước `read` rồi đo lại trước khi kết luận.

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
| **F3** | 🟡 | **Đường Agent TỰ TRỊ (`aiAgentOrchestrator:411`) không đi qua `argsWithAuthCtx()`** dù `exec` ở ngay trong tầm (dùng ở dòng 389 và 505). Tĩnh: có. **Sống: CHƯA** (planner trả plan rỗng 2/2 lượt). |
| **F4** | 🟡 | **`headroom.effectiveBytes` KHÔNG cập nhật ngay sau một lệnh thu hồi thành công** (23.470.170.112 ở cả hai đầu, dù 5.030 MiB đã rời sổ) — nó chỉ đổi ở nhịp quyết định kế tiếp. Agent đọc ô này ngay sau lệnh sẽ thấy số **CŨ**; bằng chứng đúng là `leaseLeftLedger` + `ledger.localBytes`. |

⚠ **Không phát hiện nào ở trên được vá trong Task 5** — task này ĐO, không chữa (ràng buộc của brief).

---

## 10. Chấm điều kiện ra của Pha 4

| # | điều kiện | chấm |
|---|---|---|
| 1 | Agent **truy vấn** được toàn bộ trạng thái, **mỗi trường nói đúng độ chắc chắn** | ✅ **ĐẠT** — §1 (L1 bắt được cả trạng thái `blind/ledger-only`) |
| 2 | Agent **ra lệnh** được, **có phân quyền**, đi qua **cơ chế đã có** | ✅ **ĐẠT** — §4 (9 lượt, 3 cổng khác nhau chặn đúng chỗ) |
| 3 | Mọi ô "đồng hồ không kim" có người đọc **hoặc** bị xoá kèm lý do | ✅ (bảng kiểm Task 4) + §1/§6 xác nhận **có người đọc THẬT** trên màn |
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
