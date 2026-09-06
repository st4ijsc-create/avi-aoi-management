# L-7 — Hàng rào cho AI điều khiển thiết bị thật (PLC / robot)

**Ngày** 2026-09-06 · **Lượt thiết kế, CHỈ ĐỌC** · không viết mã, không commit, **không một lệnh ghi
nào được gửi xuống thiết bị trong lượt này**.

**Quy ước đọc tài liệu này:**

- **[ĐO]** — đọc trực tiếp từ mã / cấu hình / cơ sở dữ liệu của chính dự án này, hôm nay.
- **[NGOÀI]** — chuẩn hoặc tài liệu bên ngoài, có ghi nguồn.
- **[ĐỀ XUẤT]** — thiết kế của tôi, **chưa ai kiểm chứng**, chủ dự án cần duyệt.

---

## 0. Tóm tắt cho người bận — đọc mục này trước

Chủ dự án đã duyệt "CÓ đi". Sau khi đọc mã, tôi trả lời: **có thể làm được an toàn, nhưng KHÔNG
phải bằng hàng rào đang có.** Ba câu quan trọng nhất:

1. **Hàng rào hiện tại rất tốt — nhưng nó được thiết kế cho NGƯỜI.** Nó chặn *"lệnh này có được
   phép không?"* rất chặt. Nó **không có một dòng nào** hỏi *"tại sao lại có 40 lệnh trong 10 giây?"*
   Đây chính là khác biệt giữa người và tác nhân AI. **[ĐO]**

2. **Máy này ĐANG mở cổng ghi thật.** `.env` dòng 586–588: `OT_CONTROL_ENABLED=true` và
   `ROBOT_CONTROL_ENABLED=true`. Trong `.env.example` cả hai là `false` kèm cảnh báo an toàn. 9/15
   adapter đã có bản ghi nghiệm thu `active` **không có hạn** (`expiresAt = NULL`), 3/3 robot cũng
   vậy. Nghĩa là ba cổng lớn nhất (chế độ · nghiệm thu · hạn nghiệm thu) **đều đang mở**. **[ĐO]**

3. **Cái đang cứu chúng ta hôm nay là một sự tình cờ, không phải một hàng rào.** Trong 42 tag của
   15 adapter, số tag có `writable = true` là **0**. Không có tag nào ghi được ⇒ mọi lệnh đều bị
   chặn ở cổng `TAG_NOT_WRITABLE`. Sổ `command_log` có **0 dòng** — chưa từng có lệnh nào chạy.
   **Một câu `UPDATE device_tags SET writable = true` là đủ để mở toang.** Đó không phải một
   hàng rào có chủ đích; đó là dữ liệu chưa ai điền. **[ĐO]**

**Khuyến nghị một dòng của tôi:** **CÓ làm — nhưng chỉ tới Mức 3 (ghi tham số không-an-toàn trên
máy đang dừng).** Mức 4 trở lên (chuyển động robot) tôi **khuyến nghị KHÔNG**, và mục 5 nói rõ vì sao.

---

## 1. `commandDispatcher` là gì và nó đòi gì — nguyên văn

**Tệp:** `server/services/ot/commandDispatcher.ts` (1.000+ dòng). **[ĐO]**

Đây là **cửa duy nhất** dẫn tới `driver.writeTags()` — hàm thật sự đẩy byte xuống PLC. Lời khai
nguyên văn ở đầu tệp (dòng 5–12):

> ```
> SAFETY:
>   - This module is NOT exported to tRPC. It is reachable ONLY from a write-tool's
>     execute(), which itself runs ONLY after the HITL confirm flow
>     (proposeAction → confirmAction; RBAC #1 + #2 + audit) in aiCopilotActions.
>   - dispatch() is the ONLY caller of driver.writeTags() (which reaches the
>     physical device). No other code path may call writeTags / dispatch.
> ```

### 1.1 Chuỗi cổng — đúng thứ tự mã chạy

| # | Cổng | Đòi gì | Không đạt thì sao |
|---|---|---|---|
| 1 | **Uỷ quyền** | `kind='hitl'`: hàng `ai_pending_actions` phải `confirmed`/`executed` **và** `userId === confirmedBy`. `kind='interlock'`: rule phải enabled + `approvedBy` khớp + `requiresHumanConfirm=false` + action ∈ {block_downstream, stop_line, reduce_speed} + cờ `INTERLOCK_AUTO_BLOCK_ENABLED` | `rejected / NOT_CONFIRMED` |
| 2 | **Chống lặp** | `idempotencyKey` chưa có dòng terminal trong `command_log` | trả kết quả cũ, **không** chạy lần hai |
| 3 | **Adapter + tag** | adapter tồn tại + `isEnabled`; **mỗi tag** phải `isEnabled` **và `writable === true`** | `rejected / ADAPTER_DISABLED` hoặc `TAG_NOT_WRITABLE` |
| 4 | **Driver** | phải có driver đang kết nối | `failed / ADAPTER_OFFLINE` |
| 5 | **Chế độ** | `OT_CONTROL_ENABLED === "true"` | ghi dòng `simulated`, **không chạm máy** |
| 5a | **Nghiệm thu (FAT)** | adapter phải có bản ghi commissioning `active`, chưa hết hạn, đã ký | ép xuống `simulated`, **bất kể cờ chế độ** |
| 5a-policy | **Chính sách** | chỉ khi `SEC_PLATFORM=true`. Đánh giá `ot.command.<verb>`; policy `require_approval` cần `policyContext.approved === true` (bốn-mắt) | `rejected / POLICY_DENIED` hoặc `POLICY_APPROVAL_REQUIRED` |
| 5a-safety | **Tiền kiểm safety-PLC** | đọc trạng thái **chỉ-đọc** của safety-PLC | `BLOCKED` → `rejected / SAFETY_BLOCKED`; **`UNKNOWN` → CHO QUA + cảnh báo** |
| 5a-bis | **Interlock đồng bộ** | không có rule interlock nào đang vi phạm nhắm vào máy/tag này | `rejected / INTERLOCK_BLOCKED`, fail-closed cả khi lỗi đánh giá |
| 5c | **Tuần tự hoá** | chỉ khi `OT_CMD_SERIALIZE_ENABLED`; hàng đợi/adapter, trần `OT_CMD_QUEUE_MAX` (10) | `rejected / BUSY` |
| 5b | **GHI THẬT** | `driver.writeTags()` dưới timeout `OT_CONTROL_TIMEOUT_MS` (5.000 ms) | `acked` / `failed` / `timeout` |
| G2.1 | **Đọc lại** | chỉ khi `OT_READBACK_ENABLED`; đọc lại 1 lần, so giá trị | khớp → `acked_verified`; lệch → `acked_unverified` (**chỉ cảnh báo, `ok` VẪN true**) |

**Mọi nhánh đều ghi một dòng `command_log`** (append-only, một `INSERT`, không `UPDATE`).

### 1.2 ★ Nó KHÔNG đòi gì — đây là phần quan trọng hơn

Đo bằng grep trên chính tệp đó: **[ĐO]**

- **KHÔNG có 2FA / step-up OTP.** `grep -c "stepUp|DPC_|fourEyes|four_eyes" commandDispatcher.ts`
  = **0**. Hệ có step-up 2FA (`server/_core/trpc.ts:525`) và bốn-mắt (`DPC_DEPLOY_APPROVAL_ENABLED`),
  nhưng chúng nằm ở đường **nạp chương trình** (`programmingRouter`), **không** ở đường ghi tag OT.
- **KHÔNG có trần tần suất.** `grep -niE "rate.?limit|throttle|perHour"` trên cả
  `commandDispatcher.ts`, `robotCommandDispatcher.ts`, `aiCopilotActions.ts` = **0 kết quả**.
  Trần duy nhất trong hệ là `AI_AUTONOMY_MAX_PER_HOUR=20`, và nó **chỉ áp cho đường tự-trị**
  (đang trơ, xem §3.2) — **không** áp cho đường HITL.
- **KHÔNG kiểm trạng thái máy.** `grep -niE "machineState|isRunning|maintenanceMode"` = **0**.
  Dispatcher **không biết** máy đang chạy hay đang dừng, đang ở chế độ tay hay tự động.
  Một lệnh `set_machine_param` gửi vào giữa lúc máy đang chạy sản xuất được chấp nhận y hệt
  lúc máy dừng.
- **KHÔNG có cửa sổ bảo trì.** Không có khái niệm thời gian nào trong toàn bộ chuỗi cổng.
- **KHÔNG có khoá thiết bị (LOTO).** Không có bảng/cột nào cho phép một kỹ sư "khoá" một máy
  lại để không ai — kể cả AI — ghi vào nó.
- **KHÔNG có nút dừng khẩn cắt được AI.** `SAFETY_ESTOP_ADAPTER_ENABLED` tồn tại nhưng
  `safetyEstopAdapter.ts` tự khai là **"SCAFFOLD ONLY"**, `NullSafetyPlcAdapter` trả
  `actuated:false`. Không có cờ nào cắt riêng đường AI mà giữ đường người.

---

## 2. Ai gọi được `dispatch()` hôm nay — grep thật

**[ĐO]** `grep -rn "commandDispatcher" server client shared drizzle` (bỏ tệp test) — có **5 điểm gọi
`dispatch` như một giá trị**, còn lại đều là chú thích khai "tôi KHÔNG gọi":

| Người gọi | Tệp | Đường vào | AI đi được? |
|---|---|---|---|
| **AI — điều khiển máy** | `aiLocalTools/writeHandlers/machineControl.ts:26` | 7 tool `kind:"write"` | ✅ **CÓ** |
| **AI — vision/SPI** | `aiLocalTools/writeHandlers/visionControl.ts:33` | `reject_divert`, `spi_printer_offset` | ✅ **CÓ** |
| Interlock engine | `interlock/interlockEngine.ts:39` | `kind='interlock'`, server-nội-bộ | ❌ AI **không** sinh được `kind='interlock'` |
| Facade thiết bị | `ot/adapterFacade.ts:37` | chỉ verb `tag.write` | gián tiếp |
| Nạp chương trình Mitsubishi | `programming/mitsubishi/…Adapter.ts:164` | import động | gián tiếp |
| UNS / Sparkplug (DCMD) | `unsPublisher.ts:41`, `uns/sparkplugCommand.ts` | lệnh từ MQTT ngoài | ⚠ **xem dưới** |

### 2.1 Bảy tool AI đang có, chạm thẳng vào PLC — **[ĐO]**

`server/services/aiLocalTools/writeHandlers/machineControl.ts`:

| Tool | Ghi gì | Quyền |
|---|---|---|
| `machine_start` | tag `cmd_start` = true | `machine_control/canCreate` |
| `machine_stop` | tag `cmd_stop` = true | canCreate |
| `machine_pause` | tag `cmd_pause` = true | canCreate |
| `machine_reset` | tag `cmd_reset` = true | canCreate |
| `select_recipe` | tag `recipe_select` = version | canCreate |
| `download_job` | tag `job_download` = jobId | canCreate |
| `set_machine_param` | **tag bất kỳ = giá trị bất kỳ** | `machine_control/canEdit` |

Cộng `visionControl.ts`: `reject_divert` (lệnh gạt phôi — chuyển động vật lý) và
`spi_printer_offset` (offset máy in kem hàn).

★★★ **`set_machine_param` là lỗ lớn nhất.** Lược đồ tham số của nó, nguyên văn:

```ts
const setParamParams = z.object({
  machineId: z.number().int().positive(),
  tagKey: z.string().min(1).max(128),
  value: z.union([z.number(), z.string(), z.boolean()]),
}).strict();
```

**Model tự chọn CẢ tag LẪN giá trị.** Không có danh sách trắng nào ở tầng tool. Thứ duy nhất
chặn nó là cột `deviceTags.writable` — một boolean **mỗi tag**, được đặt cho *"người vận hành có
được ghi tag này không"*, chứ **không** phải *"AI có được chạm tag này không"*. Hai câu hỏi khác nhau
đang dùng chung một câu trả lời.

Có một lớp `parameterGuardrailService` (chặn giá trị ngoài dải). Đo trạng thái thật: **[ĐO]**

- `.env`: `PARAM_GUARDRAIL_ENABLED=true` ✅
- `.env`: `PARAM_GUARDRAIL_STRICT` **vắng mặt** ⇒ mặc định `false`
- Bảng `parameter_guardrails`: **0 dòng**

⇒ Với `strict=false`, tham số **không có** guardrail thì *"cho qua + ghi log"*. Vì bảng rỗng,
**mọi** tham số đều không có guardrail ⇒ **lớp này hiện chặn đúng 0 giá trị.** Đây lại đúng lớp lỗi
"cờ bật mà tầng chết" mà chính repo này đã ghi nhiều lần.

### 2.2 Đường vào không qua AI, cũng không qua giao diện — ⚠ nêu để chủ dự án biết

`unsPublisher.ts` và `uns/sparkplugCommand.ts` nhận **DCMD/NCMD từ broker MQTT** rồi đưa vào
`dispatch()` với `kind='hitl'`. Cổng dispatcher vẫn đủ (vẫn cần hàng `ai_pending_actions` đã
confirmed), nhưng đây là một **bề mặt vào từ mạng ngoài** mà L-7 nên biết. Broker EMQX đang chạy
(`docker ps`: cổng 1884/18083). **[ĐO]**

---

## 3. ★★★ Hàng rào này cho NGƯỜI hay cho AI? — câu quan trọng nhất

**Trả lời: được thiết kế cho NGƯỜI.** Nó rất tốt ở việc trả lời *"lệnh này có hợp lệ không?"*
Nó **mù hoàn toàn** trước câu *"chuỗi lệnh này có hợp lý không?"* — và đó đúng là chỗ tác nhân AI
khác người.

### 3.1 Cái CÒN ĐỨNG VỮNG trước tác nhân AI ✅

Những cổng này là **bất biến cấu trúc**, không phụ thuộc sự mệt mỏi hay nghi ngờ của con người —
AI bấm nhanh bao nhiêu cũng không lách được:

| Hàng rào | Vì sao vẫn vững |
|---|---|
| **Một cửa duy nhất** | `dispatch()` là caller duy nhất của `writeTags()`. AI không có đường vòng. Bất biến **kiến trúc**, không phải bộ lọc. |
| **`tag.writable`** | Cột dữ liệu, AI không sửa được qua tool (không có tool nào ghi `device_tags`). Chặn **trước** mọi ghi. |
| **Cổng nghiệm thu (5a)** | Chỉ có thể **hạ cấp** ghi-thật thành mô phỏng, không bao giờ nâng cấp. Đúng hướng an toàn. |
| **Args đọc từ CSDL** | `confirmAction` chạy `execute()` với args **từ hàng `ai_pending_actions`**, không phải từ request. AI không tráo được giá trị giữa lúc người xem và lúc chạy (chống TOCTOU). ★ Đây là một thiết kế **thật sự tốt cho AI**. |
| **Chống lặp theo khoá** | Một `idempotencyKey` = tối đa một lần ghi. Cắt được vòng lặp "thử lại" của agent. |
| **Interlock fail-closed** | Lỗi đánh giá cũng **chặn**. Đúng hướng. |
| **Sổ append-only** | `command_log` chỉ `INSERT`, không `UPDATE`. Audit không bị viết lại. |
| **AI không sinh được `kind='interlock'`** | Nhánh tự-động-ghi mạnh nhất **đóng với AI ở tầng kiểu dữ liệu**. |

### 3.2 Cái GÃY trước tác nhân AI ❌ — nêu cụ thể

**① Không có trần tần suất — hàng rào gãy nặng nhất.** **[ĐO]** grep = 0.
Người bấm duyệt lần thứ 20 sẽ mỏi tay và bắt đầu nghi. Tác nhân AI đề xuất 20 lệnh trong 3 giây và
**không có gì trong hệ ghi nhận rằng đó là bất thường**. Cổng duyệt đúng 20/20 lần, sổ audit ghi
đúng 20 dòng, và không ai biết có chuyện gì đã xảy ra. Hàng đợi `OT_CMD_SERIALIZE` (trần 10) **không
phải** trần tần suất — nó chỉ xếp hàng để tránh tranh chấp, hàng vơi là nhận tiếp ngay.

**② Cửa duyệt được thiết kế với giả định "người đọc kỹ".** `preview()` trả về một `humanSummary`
kiểu *"Đặt tham số cwm_speed = 1200 cho máy #3"*. Với một người, một lần, mỗi vài phút — đọc được.
Với 40 thẻ trong một phút, mỗi thẻ khác nhau một con số — **thẻ thứ 25 sẽ được bấm mà không đọc.**
Đây không phải khiếm khuyết của mã; đây là giới hạn của người, và tác nhân AI khai thác nó
**mà không cần cố ý**.

**③ Không có "duyệt cả lô" — nhưng chưa có gì cấm nó xuất hiện.** Hôm nay mỗi lệnh một thẻ
(`AILocalChatBubble.tsx:212` khai *"Each write step is confirmed individually"*). ★ Cần **viết
thành bất biến**: khoảnh khắc ai đó thêm nút "Duyệt tất cả" vì thấy phiền, toàn bộ mô hình HITL
sụp — với AI, duyệt-cả-phiên là cửa mở toang.

**④ Tiền kiểm safety-PLC: `UNKNOWN` → CHO QUA.** Nguyên văn dòng 631–640: *"UNKNOWN ≠ BLOCKED:
một dây chuyền chưa cấu hình safety-PLC không được bị khoá chết"*. **Với người, đây là lựa chọn
đúng** (đừng khoá chết một dây chuyền vì thiếu cấu hình). **Với AI, đây là fail-OPEN.** Người biết
"safety-PLC của tôi chưa cắm" nên tự cẩn thận; AI chỉ thấy `UNKNOWN` rồi đi tiếp. Máy này có 1 bản
ghi `safety_plc_configs` nên hiện trả `OK` — nhưng cơ chế là fail-open, và một lỗi đọc bất kỳ cũng
map về `UNKNOWN` (dòng 165: *"NEVER to a spurious BLOCKED"*).

**⑤ Đọc lại (read-back) lệch giá trị chỉ **cảnh báo**, không phải lỗi.** Dòng 44–47:
*"mismatch → `acked_unverified` (WARN ONLY — ok STAYS true, NEVER 'failed')"*. Người nhìn thấy
`acked_unverified` sẽ dừng lại hỏi. Tác nhân AI đọc `ok:true` và đi tiếp bước sau. **Cùng một byte,
hai cách hiểu.** Với AI, "ghi xuống nhưng đọc lại không khớp" phải là **DỪNG**, không phải cảnh báo.

**⑥ Không kiểm trạng thái máy.** Người sẽ không gõ lệnh đổi tham số vào giữa lúc máy đang chạy
mẻ sản xuất — họ **nhìn thấy** máy đang chạy. AI không nhìn thấy gì; dispatcher cũng không hỏi.

**⑦ Cờ tự-trị: đang trơ nhưng chỉ cách một dòng `.env`.** **[ĐO]** `.env:864-865`:
`AI_AUTONOMY_ENABLED=true` với `AI_AUTONOMY_ALLOWLIST=` (rỗng) ⇒ hiện **trơ**.
Bảo vệ thật nằm ở `AUTONOMY_INELIGIBLE` — một danh sách cứng, **thắng cả allowlist**, đã có đủ
7 tool máy + 2 tool vision + `propose_defect_from_vision` + `write_project_file`. Đây là thiết kế
**đúng** (denylist thắng allowlist, "khi nghi ngờ thì CẤM"). ★ Nhưng nó là một **DANH SÁCH TÊN**,
và repo này đã bị lớp lỗi "danh sách thay vì bất biến" cắn nhiều lần: tool ghi thứ 8 thêm vào ngày
mai mà quên ghi tên vào đây thì nó **allowlist-able**. Có một lưới census
(`autonomyWriteToolCensus.test.ts`) canh việc này — ★ **hãy giữ lưới đó xanh như một cổng ra bắt buộc.**

★★★ Và `.env:1004`: **`AI_CODING_TU_TRI_GHI=1` đang BẬT** — vòng model tự ghi mã nguồn không người
duyệt. Cửa này **hẹp** (chỉ `apply_diff`, chỉ tệp mã, `apDungDiffTuTriDuoc()` từ chối mọi tên khác)
và **không** chạm PLC. Nhưng nó chứng minh một điều cho L-7: **trong dự án này, một bất biến an
toàn đã viết ra từng bị gỡ bằng đúng một dòng `.env`.** Mọi hàng rào L-7 phải được thiết kế với
giả định đó.

### 3.3 Bảng tổng — cái nào gãy trước AI

| Hàng rào | Với người | Với tác nhân AI |
|---|---|---|
| Một cửa duy nhất (`dispatch`) | vững | **vững** ✅ |
| `tag.writable` | vững | **vững** (nhưng sai *câu hỏi* — xem §4.1) ⚠ |
| Args đọc từ CSDL | vững | **vững** ✅ |
| Chống lặp theo khoá | vững | **vững** ✅ |
| Nghiệm thu (FAT) | vững | **vững** ✅ |
| Interlock fail-closed | vững | **vững** ✅ |
| **Cửa duyệt từng lệnh** | **vững** | **GÃY** — mệt-mỏi-vì-duyệt ❌ |
| **Trần tần suất** | không cần (người tự chậm) | **KHÔNG TỒN TẠI** ❌ |
| **Safety-PLC `UNKNOWN`→cho qua** | hợp lý | **fail-open** ❌ |
| **Read-back lệch = cảnh báo** | người sẽ dừng | **AI đi tiếp** ❌ |
| **Trạng thái máy** | người nhìn thấy | **KHÔNG TỒN TẠI** ❌ |
| **Nút dừng khẩn cắt AI** | — | **KHÔNG TỒN TẠI** ❌ |
| Denylist tự-trị | vững | vững nhưng **là danh sách** ⚠ |

---

## 4. [ĐỀ XUẤT] Thiết kế hàng rào CHO AI

Nguyên tắc xuyên suốt, rút từ chính bài học của repo này: **chặn bằng KIẾN TRÚC, không bằng bộ
lọc**, và **mọi hàng rào phải là BẤT BIẾN, không phải DANH SÁCH**.

### 4.1 Danh sách trắng thiết bị / thanh ghi — ★ hàng rào nền tảng

**Vấn đề:** `deviceTags.writable` trả lời *"người vận hành ghi được không?"*. L-7 cần một câu hỏi
**khác**: *"tác nhân AI được chạm tag này không?"* Dùng chung một cột cho hai câu hỏi là sai.

**[ĐỀ XUẤT]** Thêm một cột **thứ hai, độc lập**, mặc định **DENY**:

```
device_tags.aiWritable        boolean NOT NULL DEFAULT false
device_tags.aiWriteMin        numeric NULL     -- dải cho phép, cho tag số
device_tags.aiWriteMax        numeric NULL
device_tags.aiApprovedBy      integer NULL     -- ai khai
device_tags.aiApprovedAt      timestamp NULL
device_tags.aiApprovalRef     varchar  NULL    -- số biên bản/đánh giá rủi ro
```

Điều kiện ghi thành: `writable === true` **AND** `aiWritable === true` **AND** giá trị trong
`[aiWriteMin, aiWriteMax]`. Kiểm **trong `dispatch()`**, ngay cạnh cổng (3), **không** ở tầng tool —
để không tool mới nào lách được.

- **Ai khai?** Kỹ sư tự động hoá có quyền `machine_control/canManage`, **kèm chữ ký** (`aiApprovedBy`)
  và **số biên bản đánh giá rủi ro** (`aiApprovalRef`). Không phải quản trị hệ thống — người khai
  phải là người hiểu tag đó điều khiển cái gì trên máy.
- **Khai ở đâu?** Một màn riêng, tách khỏi màn sửa tag thường, có cảnh báo rõ. **Không** khai bằng
  SQL tay, **không** khai bằng seed.
- ★ **Vì sao mặc định `false` là bắt buộc:** hôm nay `writable=0/42` chỉ là ngẫu nhiên. Cột mới
  phải khiến *"chưa ai xét"* = *"cấm"*, chứ không phải *"chưa ai điền"* = *"tình cờ an toàn"*.
- ★ **Cấm dải mở**: một tag số không có `aiWriteMin/Max` ⇒ **từ chối**, không phải "cho qua + log".
  Đây đúng là lỗi `PARAM_GUARDRAIL_STRICT=false` đang mắc (§2.1) — đừng lặp lại nó.

### 4.2 Khô (dry-run) bắt buộc trước khi ướt — **CÓ, bắt buộc**

**[ĐỀ XUẤT]** Với AI, **mọi** lệnh phải chạy hai bước, **không có ngoại lệ, không có cờ tắt**:

1. **Khô:** `dispatch()` với `dryRun:true` → chạy **toàn bộ** chuỗi cổng, ghi `command_log`
   `simulated`, trả về: tag · địa chỉ vật lý · giá trị hiện tại đọc được · giá trị sẽ ghi ·
   mọi cổng đã qua. **Không** chạm `writeTags`.
2. **Người xem kết quả khô** rồi mới duyệt.
3. **Ướt:** chỉ chạy được nếu **tham chiếu tới đúng id của lần khô**, và lần khô đó **chưa quá
   2 phút** và **cùng adapter/tag/giá trị**.

Hạ tầng đã có sẵn 90% — nhánh `simulated` chạy đúng chuỗi cổng ấy rồi. Việc cần làm là **buộc**
đường AI phải đi qua nó và **ràng** lần ướt vào lần khô.

★ **Vì sao có hạn 2 phút:** một kết quả khô cũ mô tả một cái máy **đã không còn ở trạng thái đó**.
Đây là bài học "lý do hoãn có HẠN SỬ DỤNG" đã ghi trong bộ nhớ dự án.

### 4.3 Duyệt từng lệnh hay duyệt cả phiên? — ★ **TỪNG LỆNH. Viết thành bất biến.**

**[ĐỀ XUẤT]** **Duyệt-cả-phiên là cửa mở toang cho AI — cấm tuyệt đối.** Cụ thể:

- **Một lệnh = một thẻ duyệt = một lần bấm.** Không "Duyệt tất cả", không "Nhớ lựa chọn của tôi",
  không "Tin tưởng phiên này".
- **Thẻ phải hiện:** tên máy (không phải `#3`) · tag **và địa chỉ vật lý** (`D100`, `40001`) ·
  giá trị **hiện tại** · giá trị **sẽ ghi** · trạng thái máy (chạy/dừng) · **lệnh thứ mấy trong
  15 phút qua**.
- ★ **Chống mệt-mỏi-vì-duyệt** — bắt buộc, vì đây là chỗ hàng rào người gãy:
  - **Trễ bắt buộc**: thẻ ghi PLC không bấm được trong **3 giây** đầu.
  - **Từ lệnh thứ 3 trong 15 phút**: bắt **gõ lại giá trị** thay vì bấm nút.
  - **Từ lệnh thứ 5**: **chặn cứng**, đòi người thứ hai (§4.4).

### 4.4 Trần tần suất — **[ĐỀ XUẤT]** hàng rào MỚI, chưa tồn tại

Trong `dispatch()`, đếm `command_log` theo `(requestedBy, adapterId)` và theo `machineId`:

| Ngưỡng | Cửa sổ | Xử lý |
|---|---|---|
| 1 lệnh | 3 giây | cứng — dưới ngưỡng ⇒ `rejected / TOO_FAST` |
| 3 lệnh / máy | 15 phút | đòi gõ lại giá trị |
| 5 lệnh / máy | 15 phút | **chặn**, đòi **người thứ hai** duyệt |
| 10 lệnh / dây chuyền | 1 giờ | **chặn toàn dây chuyền**, phải kỹ sư trưởng mở khoá |
| 20 lệnh / ngày | 24 giờ | **chặn**, buộc rà soát |

★ **Vượt ngưỡng KHÔNG được tự hết hạn.** Nó phải **chốt lại** cho tới khi một **người** mở. Một
trần tự-mở-lại sau một giờ là một trần mà tác nhân AI chỉ cần **chờ**. Trần phải là cái phanh, không
phải cái đèn giao thông.

★ **Đếm phải dựa trên `command_log`** (sổ append-only trong CSDL), **không** phải biến trong bộ nhớ
tiến trình — restart tiến trình không được xoá trần. Đây là lỗi tương tự "cờ mua được 0" đã ghi.

### 4.5 Nút dừng khẩn — **[ĐỀ XUẤT]**

Cần **hai thứ khác nhau**, đừng lẫn:

**(a) Cầu dao AI** — thứ L-7 thật sự cần, và **chưa tồn tại**:

- Một cờ **trong CSDL** (không phải `.env` — `.env` cần restart, cấp cứu không chờ được), đọc
  **tươi mỗi lần `dispatch()`**, không nhớ đệm.
- **Ai bấm được:** *bất kỳ ai* đăng nhập được, kể cả người vận hành, kể cả không có quyền
  `machine_control`. Dừng phải **dễ hơn** chạy.
- **Cắt được gì:** tất cả `dispatch()` có nguồn gốc AI (mọi `actionId` trỏ tới `ai_pending_actions`).
  **Không** cắt đường người-vận-hành-trực-tiếp, **không** cắt `kind='interlock'` — nếu không, một
  lần bấm cầu dao AI sẽ vô hiệu hoá luôn cả phản ứng an toàn.
- **Mở lại:** chỉ bằng tay, bởi người khác người đã bấm, có ghi lý do. **Không** tự mở.
- **Đọc fail-closed:** không đọc được CSDL ⇒ coi như **đã bấm**.

**(b) E-stop vật lý** — ★ **[NGOÀI]** cái này **KHÔNG được** là phần mềm.
`safetyEstopAdapter.ts` tự khai đúng: *"ISO 13849 / IEC 62061 đòi hỏi đường dừng khẩn ĐỘC LẬP với
lớp phần mềm — thường là Safety PLC được chứng nhận, đấu cứng dual-channel, tự thực thi dừng
< 100 ms trong PHẦN CỨNG"*. **Lời khai này đúng và phải giữ nguyên.** Nút dừng khẩn của dây chuyền
**không bao giờ** được đi qua Node.js. Một `event-loop` bị nghẽn hay một `GC pause` là đủ để trễ
một lệnh dừng.

### 4.6 Sổ kiểm toán — phần lớn đã có, thiếu 3 thứ

**Đã có** **[ĐO]**: `command_log` append-only (chỉ `INSERT`), ghi ở **mọi** nhánh kể cả bị từ chối;
mang `requestedBy`/`confirmedBy`/`correlationId`/`idempotencyKey`/`readBackValue`; `audit_logs` là
hypertable với retention 365 ngày (mig 0349) chạy dưới role `avi_app` **WORM**. Đây là phần **mạnh
nhất** của hệ hiện tại.

**[ĐỀ XUẤT]** thêm ba thứ:

1. **Cột `initiatedByAi boolean`** trên `command_log`. Hôm nay phải suy ra từ việc `actionId` có
   trỏ vào `ai_pending_actions` hay không — một phép suy, không phải một lời khai. Người tra sổ
   sau tai nạn cần đọc thẳng, không cần suy.
2. **Ghi cả `promptHash` + `modelId` + phiên bản tool**. Sau một sự cố, câu đầu tiên sẽ là
   *"vì sao AI đề xuất cái đó?"* — không có hai trường này thì không trả lời được.
3. **Ai đọc:** một màn "Nhật ký lệnh AI xuống máy", **kỹ sư trưởng đọc hằng ngày**, có báo động khi
   chạm ngưỡng §4.4. ★ Một sổ không ai đọc là một sổ không tồn tại.

### 4.7 Trạng thái máy — **[ĐỀ XUẤT]** hàng rào MỚI, chưa tồn tại

Thêm cổng **(5a-state)** trong `dispatch()`, **chỉ cho lệnh có nguồn AI**:

| Loại lệnh | Yêu cầu trạng thái |
|---|---|
| Đọc | không yêu cầu |
| Ghi tham số **không** an toàn | máy **DỪNG** (`idle`/`stopped`) **hoặc** đang ở **chế độ bảo trì** |
| `select_recipe` / `download_job` | máy **DỪNG** + không có mẻ đang chạy |
| `machine_stop` / `machine_pause` | ✅ cho phép khi đang chạy (lệnh **giảm** năng lượng — an toàn hơn) |
| `machine_start` / `machine_reset` | ❌ **KHÔNG cho AI** — xem §5 |
| Chuyển động robot | ❌ **KHÔNG cho AI** — xem §5 |

★ **Nguyên tắc bất đối xứng — quan trọng:** **lệnh làm máy DỪNG thì dễ hơn lệnh làm máy CHẠY.**
Sai lầm theo hướng dừng làm mất sản lượng; sai lầm theo hướng chạy làm gãy máy hoặc thương tích.
Hai loại sai lầm này **không** cùng giá, nên **không** được cùng hàng rào.

★ **Không đọc trạng thái được ⇒ TỪ CHỐI** (fail-closed). Khác hẳn cách xử `UNKNOWN` của cổng
safety-PLC — vì ở đó fail-open được biện minh bằng "đừng khoá chết dây chuyền chưa cấu hình";
ở đây không có lý do đó, và đối tượng là AI chứ không phải người.

### 4.8 Hoàn tác — ★★★ mục phải đọc kỹ

Chia lệnh làm **ba nhóm**, và **nhóm 3 là lý do chính khiến tôi khuyến nghị dừng ở Mức 3**:

**Nhóm 1 — hoàn tác được thật.** Ghi một tham số số vào thanh ghi giữ (holding register), giá trị
cũ đã đọc được trước khi ghi. `readbackCompare` xác nhận. Ghi lại giá trị cũ là **thật sự** hoàn tác.
★ Bắt buộc: **luôn đọc và lưu giá trị cũ vào `command_log` trước khi ghi**, và cung cấp một nút
"Trả về giá trị cũ" đi qua **đúng** chuỗi cổng ấy (hoàn tác **không** phải một cửa hậu).

**Nhóm 2 — hoàn tác được về mặt trạng thái, KHÔNG hoàn tác được về hậu quả.** `select_recipe`,
`download_job`. Đổi recipe lại được — nhưng **200 sản phẩm đã chạy sai recipe thì không thu hồi
được**. Với nhóm này, "hoàn tác" chỉ là dừng chảy máu, không phải chữa lành. ⇒ Bắt buộc máy **DỪNG**
trước khi ghi.

**Nhóm 3 — KHÔNG hoàn tác được, chấm hết.** ★★★
**Chuyển động robot không có nút hoàn tác.** Một khớp đã quay 30° thì đã quay rồi. Nếu trên đường
quay đó có bàn tay người, có đồ gá, có một tấm phôi — thì:

- **thời gian từ lệnh sai tới hậu quả là mili-giây**, ngắn hơn thời gian người kịp phản ứng;
- **không có trạng thái nào để quay về** — "vị trí cũ" chỉ là một lệnh chuyển động **thứ hai**,
  cũng nguy hiểm y hệt, đôi khi hơn (đường về có thể quét qua chỗ khác);
- **hậu quả không nằm trong hệ phần mềm** — sổ audit ghi đầy đủ, và người vẫn bị thương.

Cùng nhóm này: `machine_start` (một băng tải khởi động khi có người đang với tay vào),
`machine_reset` (xoá trạng thái lỗi — có thể **gỡ** chính cái đang giữ máy an toàn), `reject_divert`
(cơ cấu gạt chuyển động thật).

★ **Hệ quả thiết kế — nói thẳng:** với Nhóm 3, **hàng rào phần mềm dù chặt tới đâu cũng không đủ**,
vì hàng rào phần mềm chỉ giảm **xác suất** sai, mà hậu quả một lần sai là **không đảo được và có
thể là thương tích người**. Nhân một xác suất nhỏ với một hậu quả không đảo được thì **không** ra
một con số chấp nhận được — chỉ ra một con số **chưa xảy ra**.

---

## 5. ★★★ Cái KHÔNG NÊN cho AI chạm, dù có hàng rào

Đây là mục tôi viết cẩn thận nhất. Với mỗi mục: **[ĐO]** trạng thái hôm nay trong dự án này.

### 5.1 ❌ Lệnh chuyển động robot — tuyệt đối không

**[ĐO]** `robotCommandDispatcher.runJob()`; `.env:588` `ROBOT_CONTROL_ENABLED=true`; 3/3 robot đã
commissioned, `expiresAt = NULL`. `robot_jobs` có 1 dòng.

**Vì sao không:** không hoàn tác được (§4.8 Nhóm 3). Hàng rào phần mềm giảm xác suất nhưng không
đổi được bản chất hậu quả. **[NGOÀI]** ISO 10218-1:2025 (bản sửa lớn 2025, đã hấp thụ toàn bộ
ISO/TS 15066 vào phần ứng dụng) đặt an toàn chuyển động ở tầng **chức năng an toàn được chứng nhận**,
không ở tầng phần mềm điều phối — và bản 2025 **bổ sung hẳn yêu cầu an ninh mạng vào phạm vi an
toàn robot**, đúng vì lý do một đường điều khiển phần mềm có thể bị điều khiển từ xa.
([ISO 10218-1:2025](https://www.iso.org/standard/73933.html) ·
[ISO 10218-2:2025](https://www.iso.org/standard/73934.html) ·
[tổng hợp A3](https://www.automate.org/robotics/blogs/updated-iso-10218-faq))

★ **Ngoại lệ duy nhất tôi thấy hợp lý:** AI được phép **soạn** một chương trình/quỹ đạo dưới dạng
**tệp text** để **người** nạp và chạy thử ở chế độ TEST với tốc độ giảm, trên pendant, có người
đứng cạnh. Đó là **L-3/L-4** (soạn thảo), **không phải** L-7 (điều khiển). ★ **Đây là ranh giới
đáng giữ: AI viết chương trình — người nạp và chạy.**

### 5.2 ❌ Ghi bất kỳ tham số an toàn nào

Giới hạn tốc độ an toàn, khoảng cách vùng, thời gian dừng, giới hạn mô-men, giới hạn hành trình,
ngưỡng cảm biến an toàn, tham số muting.

**[NGOÀI]** Đây là các **chức năng an toàn** thuộc SRP/CS theo ISO 13849-1:2023. Chúng có mức hiệu
năng (PL) đã được tính toán và thẩm định; một lần ghi từ hệ **không** an toàn làm **mất hiệu lực**
toàn bộ phép thẩm định đó — kể cả khi giá trị mới "trông có vẻ hợp lý".
([ISO 13849-1:2023](https://www.iso.org/standard/73481.html) ·
[giải thích SRP/CS — ReeR](https://www.reersafety.com/en/academy/industrial-safety-guide/iso-13849-12safety-of-machinery/))

★ **Hệ quả cứng:** những tham số này **không được nằm trên cùng một adapter** với tham số quy trình.
Chúng thuộc safety-PLC, và đường tới safety-PLC trong dự án này **phải giữ nguyên là chỉ-đọc**
(`plc/safetyPlcAdapter.ts` khai đúng: *"READ-ONLY: never calls writeTags"* — ★ **giữ nguyên bất
biến này, đừng bao giờ nới**).

### 5.3 ❌ Tắt / vô hiệu hoá / bỏ qua khoá liên động (interlock)

**[ĐO]** Có tool `kind:"write"` ở `aiLocalTools/writeHandlers/interlock.ts:102`. AI **không** sinh
được `kind='interlock'` cho `dispatch` (đúng), nhưng nó **có** tool sửa rule interlock.

**Vì sao không:** một interlock tồn tại vì ai đó đã phân tích rủi ro và kết luận rằng nếu không có
nó thì có người bị thương. AI **không có** ngữ cảnh đó — nó thấy interlock như một điều kiện làm
lệnh của nó thất bại, và "gỡ vật cản" là hành vi tối ưu hoá **hoàn toàn tự nhiên** của một tác nhân.
★ **Đây là chỗ tác nhân AI khác người rõ nhất và nguy hiểm nhất:** người biết interlock là hàng
rào; AI thấy nó là lỗi cần xử lý.

★ **[ĐỀ XUẤT] bất biến:** AI được **đề xuất** rule interlock ở dạng **trơ** (`enabled=false`,
`approvedBy=null`) — đúng như thiết kế hiện tại; và **không bao giờ** được gọi tool nào
`enabled=true`, `approvedBy`, xoá rule, hay nới ngưỡng của một rule đang bật. ★ Đặc biệt: **nới
ngưỡng nguy hiểm hơn tắt hẳn** — tắt thì thấy được, nới thì nhìn vẫn thấy interlock đang bật.

### 5.4 ❌ `machine_reset` và `machine_start`

`machine_reset` xoá trạng thái lỗi. Một trạng thái lỗi thường là **thứ đang giữ máy dừng vì một lý
do**. Reset nó = gỡ cái đang bảo vệ, mà **không hề biết** lý do gốc đã được xử lý chưa.
`machine_start` khởi động chuyển động vật lý mà không ai kiểm tra vùng làm việc có trống không.

★ Cả hai đều là **lệnh tăng năng lượng** — đúng phía sai của nguyên tắc bất đối xứng §4.7.
★ Đối lại: `machine_stop` và `machine_pause` **nên** cho AI, kể cả tự động — chúng **giảm** năng lượng.

### 5.5 ❌ Ghi khi có người trong vùng làm việc

**[ĐO]** — và đây là chỗ tôi phải nói thẳng nhất:
`safetyZoneService.ts` khai nguyên văn *"Humans are **SIMULATED** until UWB/LiDAR"*. Nghĩa là hệ
**không biết** có người trong vùng hay không. Không có cảm biến. **[ĐO]** `safety_plc_configs` có
đúng 1 dòng (seed all-clear từ mig 0270) ⇒ tiền kiểm safety-PLC hiện trả `OK` **từ dữ liệu seed**,
không phải từ một cảm biến thật.

★★★ **Hệ quả không tránh được:** **mọi hàng rào "chỉ ghi khi không có người trong vùng" hôm nay là
KHÔNG THỂ THỰC THI trong dự án này** — không phải vì mã sai, mà vì **thiếu cảm biến**. Bất kỳ thiết
kế nào dựa vào điều kiện đó đều đang dựa vào một phép đo không tồn tại. ⇒ Cho tới khi có
cảm biến hiện diện thật (UWB/LiDAR/màn quang) **đấu vào safety-PLC được chứng nhận**, hàng rào duy
nhất đứng vững là **hàng rào vật lý và quy trình**: máy phải DỪNG, và phải có LOTO.

### 5.6 ❌ Chuỗi nhiều lệnh không có người ở giữa

Dù mỗi lệnh riêng lẻ an toàn, một **chuỗi** có thể không. Ba lệnh mỗi lệnh đều hợp lệ vẫn có thể
đưa máy vào một trạng thái mà **không lệnh nào trong ba** tự tạo ra được.
**[ĐO]** Dispatcher khai *"NO auto-chaining: dispatch handles exactly one command request"* — ★ đúng,
**giữ nguyên**. ★ Và bổ sung: người duyệt lệnh thứ hai phải **nhìn thấy** lệnh thứ nhất trên thẻ.

### 5.7 ⚠ Nhắc lại rủi ro an ninh, không chỉ an toàn

**[NGOÀI]** IEC 61511 bản 2 yêu cầu **đánh giá rủi ro an ninh cho chính SIS**; IEC 62443 là bộ
chuẩn an ninh cho hệ điều khiển công nghiệp. Một điểm được nhấn mạnh trong tài liệu tổng hợp: truy
cập từ xa **luôn-bật** cho bất kỳ nhà cung cấp nào — *kể cả nhà cung cấp AI* — là một rủi ro
thường trực; truy cập phải **có thời hạn, có ghi log, có phạm vi hẹp**.
([IEC 61511](https://en.wikipedia.org/wiki/IEC_61511) ·
[cầu nối 61511↔62443 — ORS](https://www.ors-consulting.com/industrial-cybersecurity-and-process-safety-bridging-iec-61511-and-iec-62443) ·
[62443 cho AI sản xuất](https://ifactoryapp.com/industries/manufacturing-plant/ot-cybersecurity-manufacturing-ai-iec-62443))

★ **Áp vào đây:** model chạy **cục bộ** (llama-server trên máy này) là một điểm cộng lớn — không có
nhà cung cấp bên ngoài trên đường lệnh. Nhưng đường **DCMD qua MQTT** (§2.2) thì **là** một bề mặt
mạng, và nó dẫn vào **đúng** `dispatch()`. Cần được xét trong cùng khung.

### 5.8 Phân biệt bắt buộc / thực hành tốt — **[NGOÀI]**, nói rõ

| Nội dung | Loại |
|---|---|
| ISO 10218-1/-2:2025 (robot), ISO 13849-1:2023 (SRP/CS), IEC 62061, IEC 61508/61511 | **Chuẩn** — bắt buộc hay không tuỳ **luật sở tại** và hợp đồng. Ở EU, các chuẩn hài hoà cho suy đoán phù hợp Chỉ thị Máy; ở nơi khác thường là hợp đồng/khách hàng yêu cầu. **Chủ dự án là người biết bối cảnh pháp lý của mình — tôi không biết.** |
| E-stop phải độc lập phần mềm, dual-channel, phần cứng chứng nhận | **Yêu cầu chuẩn** (ISO 13849/IEC 62061) |
| Tham số an toàn không được ghi từ hệ không-an-toàn | **Yêu cầu chuẩn** (nguyên tắc SRP/CS) |
| Trần tần suất cho tác nhân AI, cầu dao AI, trễ 3 giây chống mệt-mỏi-vì-duyệt, khô-trước-ướt bắt buộc | **[ĐỀ XUẤT] của tôi.** Không chuẩn nào nói. Không có chuẩn nào viết riêng cho "tác nhân AI ghi xuống PLC" tại thời điểm này. |

★ **Nói thẳng:** phần lớn §4 là **thiết kế của tôi**, không phải trích chuẩn. Tôi không muốn lời
khuyên chung chung mượn uy tín của số hiệu chuẩn. Chuẩn nói về **hệ thống an toàn**; **chưa** có
chuẩn nào nói về **tác nhân AI ghi xuống PLC**. Đó chính là lý do L-7 cần được thiết kế cẩn thận
chứ không tra cứu ra được.

---

## 6. [ĐỀ XUẤT] Lộ trình theo rủi ro tăng dần — 5 mức, mỗi mức một cổng ra ĐO ĐƯỢC

★ Nguyên tắc: **mỗi mức phải chạy đủ lâu trong sản xuất thật rồi mới xét mức sau.** Không nhảy mức.
Cổng ra phải là **phép đo**, không phải lời khai.

### Mức 0 — HÔM NAY (đo được, không phải giả định)

**[ĐO]** `OT_CONTROL_ENABLED=true` · `ROBOT_CONTROL_ENABLED=true` · 9 adapter + 3 robot commissioned
không hạn · **0 tag `writable`** · **0 dòng `command_log`** · guardrail bảng rỗng + `STRICT=off`.

★★★ **Việc cần làm NGAY, trước cả Mức 1** — đây là dọn dẹp, không phải tính năng:

1. **Trả `OT_CONTROL_ENABLED` và `ROBOT_CONTROL_ENABLED` về `false`** trên máy này cho tới khi có
   quyết định chính thức. Cấu hình phải nói **đúng** ý định. ⚠ Hiện `.env` có chú thích
   *"only matters with real OT/robot hardware connected; none here"* — điều đó đúng **hôm nay**;
   nó **thôi đúng** vào đúng ngày ai đó cắm một PLC vào, và không có gì báo cho ai biết.
2. **Đặt hạn (`expiresAt`) cho 9 + 3 bản ghi commissioning.** Một nghiệm thu vĩnh viễn không phải
   là một nghiệm thu — cơ chế hết hạn đã được viết vào mã nhưng **chưa được dùng**.
3. **Bật `PARAM_GUARDRAIL_STRICT=true`** *hoặc* thừa nhận rõ rằng lớp guardrail hiện chặn 0 giá trị.
   Cờ bật mà tầng chết là lớp lỗi repo này đã trả giá nhiều lần.

**Cổng ra Mức 0:** ba việc trên xong; **và** một lần đo lại xác nhận `OT_CONTROL_ENABLED=false`
trong tiến trình **đang chạy** (đọc từ `/api/…` hoặc log khởi động, **không** đọc từ tệp `.env` —
bài học "đo với cờ tắt").

---

### Mức 1 — CHỈ ĐỌC trạng thái

AI đọc telemetry, trạng thái máy, cảnh báo, sổ lệnh. **Không** ghi gì. (Phần lớn đã có.)

**Cổng ra — đo được:**
- Trong 30 ngày liên tục: `SELECT count(*) FROM command_log WHERE initiatedByAi` = **0**.
- Census: **0** tool `kind:"write"` nào chạm `dispatch` đang **đăng ký** trên profile AI của line.
- Ablation: cố tình gọi một tool ghi ⇒ phải bị chặn, và **đọc được dòng từ chối trong sổ**
  (chặn mà không ghi sổ = không đo được).

**Cần gì để lên Mức 2:** cổng ra đạt + kỹ sư tự động hoá xác nhận số AI đọc ra **khớp với HMI**.

---

### Mức 2 — MÔ PHỎNG / khô (dry-run) bắt buộc

AI đề xuất lệnh; hệ chạy **toàn bộ** chuỗi cổng và trả kết quả khô; **không** ghi thật.
Đây là mức **học**: xem AI đề xuất cái gì khi được thả ra, **trước khi** nó có thể làm gì.

**Cổng ra — đo được:**
- ≥ 200 lệnh khô trong ≥ 30 ngày trên dây chuyền thật.
- Kỹ sư **đọc từng lệnh một** và phân loại: hợp lý / vô hại / **nguy hiểm nếu đã chạy thật**.
- ★ **Ngưỡng: số "nguy hiểm nếu đã chạy thật" phải bằng 0.** Không phải "ít". **Bằng 0.**
  Một lệnh nguy hiểm trong 200 lệnh mô phỏng nghĩa là **khoảng 0,5% lệnh thật sẽ nguy hiểm** —
  đó là một con số không chấp nhận được với một máy có thể làm người bị thương.
- ★ **Ablation bắt buộc:** đưa vào **10 tình huống bẫy đã biết** (máy đang chạy, interlock đang bật,
  tag ngoài dải, tag an toàn, giá trị vô lý…). Nếu hệ đo không **kêu** trên ca dương đã biết,
  thì kết quả "0 nguy hiểm" là **âm tính giả**, không phải an toàn — đây đúng bài học
  "sàng mật-độ-assertion" đã ghi trong bộ nhớ dự án.

**Cần gì để lên Mức 3:** cổng ra đạt + **toàn bộ §4.1–4.7 đã cài và có lưới** + `aiWritable` đã khai
cho **đúng những tag sẽ dùng ở Mức 3**, có chữ ký và số biên bản đánh giá rủi ro.

---

### Mức 3 — GHI THAM SỐ KHÔNG-AN-TOÀN, trên máy ĐANG DỪNG ★ **mức tôi khuyến nghị dừng lại**

Phạm vi **hẹp có chủ đích**:

- Chỉ tag có `aiWritable=true` + có dải `[min,max]` (§4.1).
- Chỉ tham số **quy trình** (tốc độ băng tải, nhiệt độ, thời gian giữ) — **tuyệt đối không** tham
  số an toàn (§5.2).
- Chỉ khi máy **DỪNG hoặc đang bảo trì** (§4.7).
- Khô-trước-ướt bắt buộc, hạn 2 phút (§4.2).
- Duyệt từng lệnh + trễ 3 giây (§4.3).
- Trần tần suất (§4.4) + cầu dao AI (§4.5a).
- **Một** dây chuyền, **một** ca, **có kỹ sư đứng cạnh**.

**Cổng ra — đo được:**
- ≥ 90 ngày, ≥ 3 tháng vận hành thật.
- **0** lệnh nào phải hoàn tác vì sai.
- **0** lần chạm trần tần suất mà không giải thích được nguyên nhân.
- **0** lần cầu dao AI bị bấm vì lo ngại an toàn.
- **100%** lệnh có `readback` = `acked_verified` (★ ở mức này `acked_unverified` phải được coi là
  **THẤT BẠI**, không phải cảnh báo — sửa đúng lỗ §3.2⑤).
- Kỹ sư trưởng đọc sổ **hằng tuần**, ký xác nhận.
- ★ **Ablation:** trong 90 ngày đó, cố tình gửi ≥ 5 lệnh vi phạm (máy đang chạy · ngoài dải · tag
  chưa `aiWritable` · vượt trần · sau khi bấm cầu dao) và **đọc được dòng từ chối tương ứng trong
  sổ**. Một hàng rào chưa bao giờ **được thấy** chặn là một hàng rào chưa được chứng minh.

---

### Mức 4 — Lệnh vòng đời DỪNG máy (`machine_stop`, `machine_pause`) ⚠ có điều kiện

Chỉ **giảm** năng lượng (§4.7). Rủi ro là **mất sản lượng**, không phải thương tích. Có thể xét
**sau** Mức 3 đủ dài.

**Điều kiện tiên quyết:** hoàn thành Mức 3 + tách bạch rõ ràng, đo được, rằng `machine_start`/
`machine_reset` **không** đi cùng gói. ★ Nguy cơ ở đây là **trôi phạm vi**: "đã cho stop rồi thì
cho start luôn cho tiện" là câu sẽ được nói ra, và nó phải bị từ chối.

**Cổng ra:** ≥ 90 ngày, 0 lần dừng ngoài ý muốn gây thiệt hại; mỗi lần dừng đều truy được nguyên nhân.

---

### Mức 5 — Chuyển động robot / `machine_start` / tham số an toàn ❌ **KHÔNG KHUYẾN NGHỊ**

★★★ **Tôi khuyến nghị KHÔNG lên mức này, và nói thẳng vì sao thay vì đưa ra điều kiện lấy lệ.**

Không phải vì hàng rào chưa đủ chặt — mà vì **loại rủi ro khác hẳn**. Mức 1–4 sai thì mất tiền, mất
sản lượng, mất thời gian; tất cả đều **đảo được**. Mức 5 sai thì có thể **có người bị thương**, và
điều đó **không đảo được**. Một hàng rào phần mềm giảm **xác suất**; nó **không** đổi được **hậu quả**.

Nếu chủ dự án vẫn muốn đi tiếp, thì tối thiểu — và tôi nêu ra không phải như một lộ trình mà như
một thước đo mức độ khó:

- Safety-PLC được **chứng nhận** thật, đấu cứng, **cảm biến hiện diện người thật** (không phải
  `HumanPos` mô phỏng như hôm nay);
- một **đánh giá rủi ro chính thức** cho riêng kịch bản "tác nhân AI phát lệnh", ký bởi kỹ sư an toàn
  có chứng chỉ — **không phải bởi tôi, và không phải bởi chủ dự án một mình**;
- xác nhận với **cơ quan/đơn vị chứng nhận** rằng cấu hình đó vẫn giữ được sự phù hợp;
- và một câu trả lời cho câu hỏi mà tôi **không** trả lời được: *"nếu chuyện đó xảy ra, ai chịu
  trách nhiệm?"*

★ Cho tới khi có cả bốn, câu trả lời của tôi là **không**.

---

## 7. Trả lời gọn 7 câu hỏi của brief

| # | Câu hỏi | Trả lời |
|---|---|---|
| 1 | `commandDispatcher` đòi gì | §1 — 11 cổng nối tiếp. **Không** đòi 2FA, **không** trần tần suất, **không** trạng thái máy, **không** cửa sổ bảo trì, **không** khoá thiết bị |
| 2 | Ai gọi được hôm nay | §2 — 5 điểm gọi; **AI đã đi được** qua 9 tool (7 máy + 2 vision). `set_machine_param` cho AI tự chọn tag lẫn giá trị |
| 3 | Cho NGƯỜI hay cho AI | §3 — **cho NGƯỜI.** 8 hàng rào vững, **6 gãy** trước tác nhân AI |
| 4 | Thiết kế hàng rào cho AI | §4 — 8 mục, gồm 4 hàng rào **hoàn toàn mới** (`aiWritable`, trần tần suất, cầu dao AI, cổng trạng thái máy) |
| 5 | Không nên cho AI chạm | §5 — **6 nhóm**, chi tiết, kèm đo trạng thái hôm nay |
| 6 | Lộ trình | §6 — 5 mức + Mức 0 dọn dẹp. **Khuyến nghị dừng ở Mức 3** |
| 7 | Chuẩn ngành | §5.8 — có ghi nguồn, có phân biệt bắt buộc / [ĐỀ XUẤT] của tôi |

---

## 8. Nói thẳng — phần tôi không chắc, và phần tôi cố ý không chiều lòng

1. **Tôi chưa gửi một lệnh nào xuống thiết bị** — đúng ràng buộc của brief. Toàn bộ tài liệu này là
   **đọc mã + đọc cấu hình + truy vấn chỉ-đọc CSDL**. Mọi lời khai về hành vi runtime là **suy từ
   mã**, chưa phải quan sát. Đặc biệt: tôi **chưa** thấy một lệnh thật nào chạy qua chuỗi cổng này
   (`command_log` = 0 dòng) ⇒ **chuỗi cổng này chưa từng được chứng minh trên dữ liệu thật.**
   ★ Đây là điều tôi lo nhất và muốn chủ dự án biết rõ.

2. **Tôi không biết bối cảnh pháp lý của nhà máy này.** Chuẩn nào bắt buộc, chuẩn nào tham khảo,
   phụ thuộc quốc gia, ngành và hợp đồng khách hàng. §5.8 nêu ra để chủ dự án tự chiếu.

3. **Tôi không đo được phần cứng.** Không biết PLC nào đang cắm, robot nào có thật, safety-PLC có
   được chứng nhận không. `safety_plc_configs` có 1 dòng seed — **[ĐO]** nó là dữ liệu mẫu từ
   migration 0270, không phải một thiết bị.

4. **Chủ dự án duyệt "CÓ đi" cho *hướng*, không phải cho *mọi mức*.** Tôi đã thiết kế hàng rào cho
   Mức 1–4 một cách nghiêm túc và tôi tin chúng làm được. Với Mức 5 tôi nói **không** —
   không phải vì thiếu ý tưởng hàng rào, mà vì tôi tin rằng ở đó **hàng rào phần mềm là công cụ
   sai**. Nếu điều này trái ý, tôi vẫn giữ nguyên: một thiết kế nói "tới đây thì dừng" có giá trị
   hơn một thiết kế chiều lòng.

5. ★ **Một quan sát tôi muốn nhấn mạnh, vì nó không nằm trong câu hỏi nào:** thứ đang giữ an toàn
   cho hệ này hôm nay **không phải** thiết kế nhiều tầng ở §1 — mà là việc **0/42 tag có
   `writable=true`**. Đó là dữ liệu chưa ai điền, không phải một quyết định an toàn. Một câu
   `UPDATE` là đủ để gỡ nó, và **không có gì trong hệ sẽ báo động.** Nếu chỉ có một việc được làm
   sau khi đọc tài liệu này, tôi mong đó là §4.1: biến cái an toàn tình cờ đó thành một hàng rào
   **có chủ đích, mặc định DENY, có chữ ký**.

---

## Nguồn [NGOÀI]

- [ISO 10218-1:2025 — Robotics, Safety requirements, Part 1: Industrial robots](https://www.iso.org/standard/73933.html)
- [ISO 10218-2:2025 — Part 2: Industrial robot applications and robot cells](https://www.iso.org/standard/73934.html)
- [A3/Automate — Updated ISO 10218 FAQ (2025)](https://www.automate.org/robotics/blogs/updated-iso-10218-faq)
- [The Robot Report — ISO 10218 major overhaul](https://www.therobotreport.com/iso-10218-industrial-robot-safety-standard-receives-major-overhaul/)
- [ISO 13849-1:2023 — Safety-related parts of control systems (SRP/CS)](https://www.iso.org/standard/73481.html)
- [ReeR — hướng dẫn SRP/CS theo ISO 13849-1/2](https://www.reersafety.com/en/academy/industrial-safety-guide/iso-13849-12safety-of-machinery/)
- [IEC 61511 — Functional safety, SIS cho ngành quy trình](https://en.wikipedia.org/wiki/IEC_61511)
- [ORS Consulting — cầu nối IEC 61511 ↔ IEC 62443](https://www.ors-consulting.com/industrial-cybersecurity-and-process-safety-bridging-iec-61511-and-iec-62443)
- [IEC 62443 cho AI trong sản xuất](https://ifactoryapp.com/industries/manufacturing-plant/ot-cybersecurity-manufacturing-ai-iec-62443)

## Tệp mã [ĐO] đã đọc

- `server/services/ot/commandDispatcher.ts` — cửa duy nhất, 11 cổng
- `server/services/ot/drivers/{modbus,mitsubishiMc,ethernetIp,s7,opcua,slmp}Driver.ts` — `writeTags`
- `server/services/robot/robotCommandDispatcher.ts` — đường robot
- `server/services/aiLocalTools/writeHandlers/{machineControl,visionControl,interlock}.ts` — tool AI
- `server/services/aiCopilotActions.ts` — vòng đời HITL
- `server/services/ai/autonomyPolicy.ts` — denylist tự-trị + `AI_CODING_TU_TRI_GHI`
- `server/services/ai/parameterGuardrailService.ts` — guardrail tham số
- `server/services/interlock/interlockGate.ts` — cổng interlock đồng bộ
- `server/services/safety/{safetyZoneService,estop/safetyEstopAdapter,plc/safetyPlcAdapter}.ts`
- `.env` (dòng 586–588, 774–782, 864–866, 1004) vs `.env.example` (1671–1962)
- CSDL `aoi_management` — truy vấn **chỉ đọc**: `device_adapters`, `device_tags`,
  `commissioning_records`, `robot_commissioning_records`, `command_log`, `robot_jobs`,
  `interlock_rules`, `safety_plc_configs`, `parameter_guardrails`
