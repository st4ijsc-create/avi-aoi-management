# Khuyết tật `intentClassifier`: BỐN chuỗi ngoài vựng từ `stepType` đi vào một mệnh đề `WHERE`

**Gửi:** đội server SYNAPSE (`synapse-platform`) — **khuyết tật này nằm HOÀN TOÀN trong cây của các
anh**, không có một dòng nào ở phía máy.
**Từ:** đội St4i Machine Simulator. **Ngày đo:** 2026-08-24, đo lại trên `main`.
**Chúng tôi đã sửa gì:** **KHÔNG MỘT DÒNG NÀO.** Đây là báo cáo, không phải một patch.

> Chúng tôi tìm ra nó trong lúc rà một việc khác, ghi lại, rồi **dừng** — vì `server/` là sản phẩm của
> các anh. Sở dĩ nó được gửi kèm bộ bàn giao `sync-points` là vì cả hai đều đi tới **cùng một đội**.
> Hai việc **không** phụ thuộc nhau; các anh xử lý cái nào trước cũng được.

---

## 1. Triệu chứng, nói bằng lời người dùng cuối

Người dùng hỏi trợ lý AI: *"xu hướng torque máy SCR-01 7 ngày"* hoặc *"xu hướng lượng keo máy
DIS-02"*.

Trợ lý trả lời: **"Chưa đủ dữ liệu … trong 7 ngày qua để phân tích xu hướng."**

**Bảng `process_results` CÓ dữ liệu.** Máy vẫn đang bắn lên, ingest vẫn nhận, dashboard vẫn vẽ. Chỉ
riêng trợ lý AI nói không có.

Điều này đúng với **mọi** câu hỏi mô-men xoắn và **mọi** câu hỏi lượng keo, và cũng đúng với công cụ
tương quan (*"tương quan torque với NG ở hạ nguồn"*).

---

## 2. Nguyên nhân, trỏ bằng TÊN và bằng SỐ DÒNG

`intentClassifier` ánh xạ từ khoá của người dùng sang `stepType` bằng **bốn chuỗi literal**, và
**không chuỗi nào thuộc vựng từ `stepType` đang được gieo**.

### 2.1 Bốn literal — đo lại ngày 2026-08-24

Tất cả trong `server/services/aiLocalTools/intentClassifier.ts`:

| # | dòng | hàm | literal | đi vào đối số |
|---|---|---|---|---|
| 1 | **`:172`** | `mapProcessMetric` | `"torque"` | `stepType` |
| 2 | **`:173`** | `mapProcessMetric` | `"dispense"` | `stepType` |
| 3 | **`:180`** | `mapCorrelationArgs` | `"torque"` | `upstreamStepType` |
| 4 | **`:181`** | `mapCorrelationArgs` | `"dispense"` | `upstreamStepType` |

Nguyên văn hai dòng đầu:

```
if (/torque|lực\s*siết|mô-?men/.test(q)) return { metricKey: "torque", stepType: "torque" };
if (/keo|dispense/.test(q))             return { metricKey: "volume", stepType: "dispense" };
```

🔴 **Ở mỗi dòng, `metricKey` ĐÚNG và `stepType` SAI.** `"torque"` là một **khoá METRIC**, không phải
một công đoạn; `"dispense"` cũng không phải mã công đoạn — mã thật là `glue_dispense`. Chính sự trùng
tên của `metricKey: "torque"` là thứ làm dòng ấy **đọc như thể nó đúng**.

Số dòng đo trên `main` ngày 2026-08-24. Nếu cây đã dịch, tìm bằng **tên hàm** —
`mapProcessMetric` và `mapCorrelationArgs`.

### 2.2 Vựng từ ĐÚNG — tám mã, do chính các anh gieo

`drizzle/0289_process_step_spec.sql`, **dòng 41–50**, `INSERT INTO "process_step_types"`:

`screw_tightening` · `glue_dispense` · `weld_spot` · `leak_test` · `functional_test` · `press_fit` ·
`label_apply` · `vision_check`

**Tám giá trị.** Cùng tám giá trị ấy được công bố ở `docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md:109`
và hiển thị cho khách tích hợp ở `client/src/components/apiDocs/AutomationProcessFeedSection.tsx:219`.
Chúng cũng là những mã mà `fleet.json` của máy chúng tôi phát ra.

**`"torque"` và `"dispense"` không có trong tám mã đó.** Ánh xạ đúng là:

| câu hỏi | `stepType` hiện tại (sai) | `stepType` đúng |
|---|---|---|
| mô-men / lực siết / torque | `"torque"` | **`"screw_tightening"`** |
| keo / dispense | `"dispense"` | **`"glue_dispense"`** |

### 2.3 Chuỗi ấy đi thẳng vào một mệnh đề `WHERE`

* `server/db/processResult.ts` **`:131`** — `if (opts.stepType) conds.push(eq(processResults.stepType, opts.stepType));`
  (và **`:130`** ngay trên nó là `machineId`, nên hai điều kiện **AND** với nhau).
* `server/services/aiLocalTools/insightHandlersF6.ts` **`:224`** — nhánh tương quan:
  `[eq(processResults.stepType, upstreamStepType), gte(processResults.measuredAt, since)]`.

Cột `process_results.stepType` không bao giờ chứa `"torque"` hay `"dispense"`, nên **kết quả luôn là
0 hàng**.

### 2.4 Hậu quả rơi ra ở đâu

`server/services/aiLocalTools/handlersF6.ts`, `getProcessMetricTrend`: khi `series.length < 2` nó trả

```
note: "NOT_FOUND"
textSummary: "Chưa đủ dữ liệu ${metricKey} cho ${scope} trong ${days} ngày qua để phân tích xu hướng."
```

Đó chính là câu ở §1.

---

## 3. 🔴 ĐỪNG đọc nó như "mã chết" — nó sai theo chiều NGƯỢC LẠI

Một cách đọc dễ mắc là *"nhánh này chắc chẳng bao giờ chạy"*. **Sai, và sai theo chiều làm nó nghe vô
hại.**

* Nhánh `mapProcessMetric` **luôn được chọn** khi câu hỏi có chữ *torque* / *lực siết* / *mô-men* /
  *keo* — và đó chính là **những câu người ta hỏi nhiều nhất** về hai loại máy này.
* Vì `stepType` **AND** với `machineId`, một `stepType` sai **không nới rộng** kết quả, nó **triệt
  tiêu** kết quả.
* Nên khuyết tật này **không phải mã không chạy**; nó là **mã chạy mọi lần và trả sai mọi lần**, với
  một câu trả lời (*"chưa đủ dữ liệu"*) **nghe như một sự thật về dữ liệu** chứ không như một lỗi.

Đó là điều làm nó khó thấy: không có exception, không có 500, không có dòng log đỏ. Chỉ có một trợ lý
AI bình thản nói rằng nhà máy không có số liệu.

---

## 4. 🔴 BA ASSERTION ĐANG GHIM KHUYẾT TẬT — dụng cụ đang đứng về phía lỗi

Sửa `intentClassifier.ts` **sẽ làm ba assertion đỏ**, và cả ba đang khẳng định **đúng giá trị sai**.
Trong `server/services/aiLocalTools/intentClassifier.f6.test.ts`:

| dòng | assertion |
|---|---|
| **`:18`** | `expect(a.stepType).toBe("torque");` |
| **`:28`** | `expect(a.stepType).toBe("dispense");` |
| **`:62`** | `expect(a.upstreamStepType).toBe("torque");` |

Cộng thêm **tên** của một bài test ở **`:23`** — *"maps 'lượng keo' → metricKey volume / stepType
dispense"* — cũng phải sửa, vì nó **mô tả** hành vi sai.

📎 **Hai đính chính về số dòng, ghi ra vì hồ sơ nội bộ của chúng tôi từng ghi khác:** (a) `:17` là
dòng `metricKey`, **assertion `stepType` nằm ở `:18`**; (b) hồ sơ chúng tôi ghi *"hai bài test"* —
**đo lại là BA assertion** trong ba khối `it()`, vì bản ghi cũ chỉ đếm nhánh `mapProcessMetric` và bỏ
sót nhánh `mapCorrelationArgs`.

**Ba assertion ấy phải sửa CÙNG bản sửa**, nếu không CI sẽ đỏ và người tiếp theo rất dễ "sửa" bằng
cách hoàn nguyên đúng bản sửa đúng.

---

## 5. Đề nghị

1. Đổi bốn literal ở `intentClassifier.ts:172,:173,:180,:181` sang `"screw_tightening"` /
   `"glue_dispense"`.
2. Cập nhật ba assertion `f6.test.ts:18,:28,:62` và tên bài test ở `:23`.
3. **Cân nhắc một cái chốt**: `mapProcessMetric`/`mapCorrelationArgs` đang tự do trả bất kỳ chuỗi nào.
   Ràng chúng vào chính bảng `process_step_types` (hoặc một hằng số dẫn xuất từ nó) thì lớp khuyết tật
   này **không tái diễn được** — hôm nay không có gì ngăn literal thứ năm ra đời.

**Kiểu dữ liệu KHÔNG phải rào cản:** `metricTrendParams` đã khai `stepType: z.string().min(1).max(64).optional()`
(`handlersF6.ts:216`), nên đây là đổi một **GIÁ TRỊ**, không phải đổi một **hình dạng**. Không có hợp
đồng nào bị nới, không có payload nào đổi hình.

---

## 6. Chúng tôi KHÔNG đo được gì — nói ở ngay chỗ kết luận hiện ra

* **Chúng tôi không chạy server của các anh.** Mọi thứ trên đây là đọc mã và đọc migration qua `git`.
  Chuỗi nhân quả *"stepType sai ⇒ 0 hàng ⇒ NOT_FOUND"* là **suy từ mã**, chưa phải một lần chạy quan
  sát được.
* **Chúng tôi không đo dữ liệu THẬT trong `process_results`.** Nếu vì lý do nào đó cột `stepType` ở
  môi trường của các anh có chứa `"torque"`, thì kết luận này sai — và đó là câu hỏi rẻ nhất để kiểm:
  `SELECT DISTINCT "stepType" FROM process_results;`
* **Chúng tôi không mở hết tập những chỗ gọi `mapProcessMetric`/`mapCorrelationArgs`.** Bốn literal ở
  §2.1 là những gì `git grep` tìm được trong hai hàm ấy; **có thể** còn chỗ khác trong `server/` viết
  cùng loại literal mà phép quét của chúng tôi không phủ. **Một tập không đếm hết KHÔNG phải một tập
  rỗng.**
