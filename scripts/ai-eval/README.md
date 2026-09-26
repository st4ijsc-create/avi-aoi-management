# Bộ thước đo AI — `scripts/ai-eval/`

Nơi biến câu hỏi *"nó có chạy không?"* thành **số đo lại được**.

Mọi bộ ở đây đều **gọi thẳng mã sản phẩm** (import đúng service/classifier mà người dùng đi qua),
không viết lại logic. Con số vì thế là con số của hệ thật, không phải của một bản mô phỏng.

Báo cáo ghi vào `scripts/ai-eval/reports/*.json`.

---

## 0. Bộ nào cần model, bộ nào KHÔNG — đọc bảng này trước

| Bộ | Lệnh | Cần model? | Đo cái gì |
|---|---|---|---|
| **Gọi tool (regex)** | `npx tsx eval-toolcall.mjs` | **KHÔNG** | Chọn tool + trích tham số + từ chối, đường **regex** |
| **Gọi tool (+LLM)** | `npx tsx eval-toolcall.mjs --llm` | **CÓ** (model *fast*) | Thêm đường LLM dự phòng + **lift** của nó |
| **RAG vận hành** | `node eval-rag-operational.mjs` | **CÓ** (model **nhúng**) | precision@5 · MRR · nDCG@10 · recall@5, luật hit **chặt** |
| **RAG vận hành +rerank** | `node eval-rag-operational.mjs --rerank` | **CÓ** (nhúng **+** text) | **Lift của reranker** |
| **RAG vận hành +graph** | `node eval-rag-operational.mjs --graph` | **CÓ** (chỉ nhúng) | **Lift của GraphRAG** |
| **RAG lập trình** | `npx tsx eval-rag-programming.mjs` | **CÓ** (nhúng) | Recall trên kho manual hãng |
| **Sinh mã** | `npx tsx eval-codegen.mjs` | **CÓ** (model *code* 30B) | Chất lượng sinh chương trình + cổng an toàn |
| **Specialist** | `npx tsx eval-specialist.mjs` | **CÓ** (model text) | 8 bài chẩn đoán bug thật |
| **Mọi bộ** | `… --selfcheck` | **KHÔNG** | Bộ ca hợp lệ + wiring nguyên vẹn |

> **Luôn chạy `--selfcheck` trước.** Nó chứng minh harness nối đúng vào mã sản phẩm và bộ ca hợp lệ
> mà **không nạp một model nào** — nên chạy được cả khi GPU đang bận việc khác.

### `tsx` hay `node`?

* `eval-toolcall.mjs`, `eval-codegen.mjs`, `eval-rag-programming.mjs`, `eval-specialist.mjs` import
  **module TypeScript** ⇒ **bắt buộc `npx tsx`**.
* `eval-rag-operational.mjs` chạy được bằng **`node` trần**; nó chỉ import một file `.ts`
  (`aiSemanticGraph.ts`) và **chỉ khi truyền `--graph`**, qua `import()` động — nên đường mặc định
  không phụ thuộc vào cơ chế bóc kiểu của Node.
* `node --check <file>.mjs` chỉ kiểm **cú pháp**, không phân giải import.

---

## 1. Eval GỌI TOOL — `eval-toolcall.mjs` + `toolcall-cases.json`

**Lỗ đo lớn nhất của trục agent trước đây.** Hệ có **77 tool** đăng ký
(`server/services/aiLocalTools/**` — đo lúc chạy: 49 read · 26 write · 2 client) và việc **chọn**
tool do **regex** làm (`intentClassifier.classifyToolIntent`), với một đường LLM dự phòng chỉ chạy
khi regex trả `null` (`classifyToolIntentLLM`, cờ `AI_TOOL_LLM_FALLBACK`). **Chưa từng có phép đo
nào** nói regex gánh bao nhiêu phần trăm, sai ở đâu, và có đoán bừa tham số hay không.

### Bộ ca — 82 ca, 4 nhóm

| Nhóm | Số ca | Hỏi điều gì |
|---|---|---|
| `select` (a) | 24 | Chọn đúng tool. **12 cặp có dấu / không dấu** để đo trực tiếp mức tụt khi gõ không dấu |
| `args` (b) | 15 | Trích đúng `machineCode` / `lineCode` / `days` / mã lô / serial / ngưỡng |
| `refuse` (c) | 13 | **PHẢI KHÔNG chọn tool nào** — đo dương-tính-giả |
| `distractor` (d) | 30 (15 cặp) | Hai câu **gần giống** phải ra **hai tool KHÁC nhau** |

`expectTool` là **sự thật nghiệp vụ**, không phải hành vi hiện tại của regex — bộ ca được viết để
**làm đỏ** chỗ regex sai. Sửa một ca cho khớp hành vi hiện tại là nắn thước đo cho vừa vật đo.

### Chỉ số

| Chỉ số | Nghĩa |
|---|---|
| `toolAccuracyStrict` | Đúng **chính xác** `expectTool` / số ca có kỳ vọng |
| `toolAccuracyLenient` | Thuộc `{expectTool} ∪ acceptTools` (chỉ nới ở ca có lý lẽ ghi trong `note`) |
| `argsAccuracy` | Args khớp trên **mọi** ca có chấm args (`expectArgs` và/hoặc `forbidArgKeys`) — **kể cả ca chọn sai tool** (che đi là làm đẹp số liệu) |
| `refusalCorrectRate` | Nhóm `refuse` trả `null` / tổng nhóm `refuse` |
| `falsePositiveRate` | **Chọn tool khi lẽ ra không nên.** Chỉ số nguy hiểm nhất — nó là câu trả lời SAI được trình bày như dữ liệu thật |
| `clarifyRate` | Khi từ chối vì thiếu tham số, có **hỏi lại** không (hay im lặng) |
| `distractorPairRate` | Cặp ĐẠT khi **cả hai vế đúng** *và* **hai tool khác nhau**. Kèm `distractorPairsCollapsed` = số cặp **SẬP** về cùng một tool |
| `diacritics` | Accuracy câu **có dấu** vs **không dấu** + `dropPoints` |

### Tách `regexOnly` vs `withLlm`

`--llm` chạy **đúng đường ống `tryExecuteTool()`**: regex trước, chỉ khi `tool === null` mới gọi
LLM. Report in **lift từng chỉ số** ⇒ trả lời được *"bật `AI_TOOL_LLM_FALLBACK` có đáng không"*.

### Chạy

```bash
npx tsx scripts/ai-eval/eval-toolcall.mjs --selfcheck          # KHÔNG model
npx tsx scripts/ai-eval/eval-toolcall.mjs                      # nhánh regex, KHÔNG model
npx tsx scripts/ai-eval/eval-toolcall.mjs --llm                # + nhánh LLM (NẠP model)
npx tsx scripts/ai-eval/eval-toolcall.mjs --group distractor   # chỉ nhóm đối kháng
npx tsx scripts/ai-eval/eval-toolcall.mjs --ci --min 0.75      # cổng CI
```

Cờ: `--selfcheck` `--llm` `--group` `--only` `--limit` `--label` `--cases` `--out` `--ci` `--min` `--quiet`.
Báo cáo → `reports/toolcall-<label>.json`.

---

## 2. Eval RAG VẬN HÀNH — `eval-rag-operational.mjs` + `rag-operational-cases.json`

### Vì sao có bộ này: thước cũ đã **bão hoà**

`knowledge/rag-eval-results.json` báo **recall@5 = 151/151 = 1,000** suốt 7 lần chạy. Đọc luật hit
của `scripts/ai-kb/eval-rag.mjs` (≈dòng 195-201):

```js
srcOk = expectSourceContains.some(s => sourcePath.INCLUDES(s));   // "order", "production"…
kwOk  = expectKeywords.some(k => text.INCLUDES(k));
hit   = srcOk || kwOk;
```

Hai chỗ hỏng cộng dồn: (1) **khớp chuỗi con trên đường dẫn** — "order" trúng
`productionOrdersRouter.ts`, `workOrderService.ts`, `orderBy`…; (2) `||` với **từ khoá trong text** —
chỉ cần một chunk chứa chữ "OEE" là trúng, kể cả khi đó là mã nguồn router. Golden set cũ dựng khi
kho có **2.170 chunk**; kho nay **7.306**. ⇒ 1,000 không nói *"kho tốt"*, nó nói *"thước không phân
biệt được tốt với hỏng"*.

### Luật hit ở đây: **CHẶT**

Một chunk TRÚNG **khi và chỉ khi** `sourcePath` **bằng đúng** một mục `expectPaths`, **hoặc** bắt
đầu bằng một mục `expectPrefixes` (phải kết thúc bằng `/`). **Cấm** khớp chuỗi con, **cấm** khớp từ
khoá trong text.

### Bộ ca — 54 ca vận hành thật, 14 miền

Câu hỏi tiếng Việt kiểu người vận hành hỏi (*"máy AOI dừng đột ngột phải làm gì"*, *"sửa ngưỡng NG ở
đâu"*, *"báo cáo OEE xem ở màn nào"*), đường dẫn kỳ vọng chọn từ `knowledge/domain/`,
`knowledge/features/`, `knowledge/operational/`. Mỗi ca có **≥3 distractor** — tài liệu gần giống
nhưng sai, **không** tính vào recall mà trả lời câu hỏi khác: *"có tài liệu sai nào chen lên trên
tài liệu đúng không?"*.

Sáu ca cuối (`OP49`–`OP54`, cờ `hard: true`) hỏi theo **triệu chứng**, không nhắc tên màn hình
(*"camera máy AOI không phản hồi thì xử lý thế nào"*), vì 48 ca đầu phần lớn trùng tiêu đề tài liệu.

**Cầu chì:** harness kiểm tra **mọi** `expectPaths`/`distractors` **có thật** trong
`knowledge/chunks.jsonl` trước khi đo. Một golden set trỏ vào hư không sẽ cho recall 0 và bị đọc
nhầm thành *"retrieval hỏng"*.

### Chỉ số — bốn cái, vì chúng trả lời bốn câu hỏi khác nhau

| Chỉ số | Trả lời câu hỏi |
|---|---|
| `hitRateAt5` | *Có ít nhất một đoạn đúng trong top-5 không?* Cùng định nghĩa với "recall@5" cũ ⇒ **so sánh trực tiếp được**, chỉ khác ở luật hit |
| `precisionAt5` | *Trong 5 đoạn nhét vào ngữ cảnh LLM, mấy đoạn đáng?* Đây là thứ **lái chất lượng câu trả lời**; `hitRate` thì không |
| `mrr` | *Đoạn đúng đầu tiên đứng thứ mấy?* Đo **thứ tự** — đúng thứ reranker sinh ra để sửa |
| `ndcgAt10` | Vừa nhìn thứ tự vừa nhìn số lượng, chuẩn hoá theo `min(10, R)` |
| `recallAt5` | số chunk đúng trong top-5 **chia cho `R`**, với `R` = tổng chunk đúng **có thật** trong kho. ⚠ Trần của nó là `5/R`: tài liệu 12 chunk thì recall@5 **không thể** quá 0,42. `recallAt5Capped` là bản đã bỏ trần |
| `distractorAboveRate` | *Có tài liệu nhiễu chen lên trên tài liệu đúng không?* **Không suy ra được từ recall** |

### `--rerank` và `--graph`: lần đầu ghi được **lift**

`knowledge/rag-eval-results.json` để `reranked: null` và `graphRag: null` **suốt 7 lần chạy** — tức
chưa từng có phép đo nào nói hai cơ chế ấy có ích, dù `RAG_RERANKER_ENABLED` và
`KB_GRAPHRAG_ENABLED` đều **đang bật** trong `.env`.

* `--rerank` chấm lại top-`--pool` bằng model text (cùng prompt với `server/services/aiReranker.ts`),
  in lift của cả năm chỉ số. Cổng `RAG_RERANKER_ENABLED` được tôn trọng như production;
  `--force-rerank` bỏ qua cổng; `--no-rerank` ép tắt.
* `--graph` gọi **hàm sản phẩm thật** `loadSemanticGraph`/`expandWithGraph`
  (`server/services/aiSemanticGraph.ts`) — không phải bản chép lại.

### Chạy

```bash
node scripts/ai-eval/eval-rag-operational.mjs --selfcheck   # KHÔNG model
node scripts/ai-eval/eval-rag-operational.mjs               # baseline cosine (nạp model NHÚNG)
node scripts/ai-eval/eval-rag-operational.mjs --rerank      # + lift reranker (nạp thêm model TEXT)
node scripts/ai-eval/eval-rag-operational.mjs --graph       # + lift GraphRAG (chỉ cần model nhúng)
GGUF_GPU=false node scripts/ai-eval/eval-rag-operational.mjs   # ép CPU khi GPU đang bận
```

Cờ: `--k` `--pool` `--mrr-window` `--limit` `--only` `--domain` `--label` `--cases` `--out`
`--rerank`/`--force-rerank`/`--no-rerank` `--graph` `--ci` `--min` `--selfcheck` `--quiet`.
Báo cáo → `reports/rag-operational-<label>.json`.

> ⚠ `GGUF_EMBED_MODEL` **phải** khớp `knowledge/embeddings-meta.json.model`
> (nay: `Qwen3-Embedding-0.6B-f16`). Lệch model ⇒ vector truy vấn rơi vào **không gian khác** và mọi
> chỉ số là rác. Harness tự đối chiếu và **thoát 1** khi lệch — nó **không** cảnh báo suông rồi vẫn
> in ra một bảng số đẹp.

---

## 3. Eval SINH MÃ — `eval-codegen.mjs` + `codegen-cases.json`

Mỗi ca: gọi **thật** `generateProgram({ kind, request, vendor })`, rồi **độc lập** chạy lại
**oracle** `programmingAdapter.getAdapter(kind).validate(code)` — một lượt gọi thứ hai, do harness
sở hữu, vào đúng lớp an toàn kỹ sư dùng. `validationOk` là kết quả của **oracle**, không phải tự
khai của copilot.

| Chỉ số | Nghĩa |
|---|---|
| `codeProducedRate` | Sinh được mã / số ca **không phải ca an toàn** |
| `validPassRate` | Oracle `validation.ok` / số ca sinh được mã **và không bị từ chối** |
| `safetyRefusalRate` | Từ chối / số ca `mustRefuse` — **mục tiêu 1.0, cổng cứng** |
| `falseRefusalRate` | Từ chối / số ca không phải ca an toàn — mục tiêu 0.0 |
| `avgLatencyMs`, `avgCitations` | Trung bình trên các ca có gọi model |

**Cổng cứng duy nhất:** mọi ca `mustRefuse:true` **phải** bị từ chối; rò một ca ⇒ in `FAIL ✗` và
**thoát 1**. `validPassRate` thấp là **tín hiệu**, không phải lỗi harness.

```bash
npx tsx scripts/ai-eval/eval-codegen.mjs --selfcheck        # KHÔNG nạp model
npx tsx scripts/ai-eval/eval-codegen.mjs                    # đầy đủ (nạp model code 30B)
npx tsx scripts/ai-eval/eval-codegen.mjs --only iec61131-st --limit 3
```

> **Ghi trung thực:** tầng code hiện là Qwen3-30B-A3B-**Instruct** — model *tổng quát*, không phải
> model chuyên code. Đích có cấu trúc (`iec61131-pou` = POU JSON, `ir-flow` = IR-flow JSON) khó cho
> model tổng quát ⇒ `validPassRate` thấp ở hai loại ấy là **kỳ vọng được** và là **tín hiệu để nạp
> Qwen3-Coder-30B**, không phải khuyết tật. Việc lớp kiểm tra **bắt được** đầu ra hỏng (validate
> fail, không deploy gì) chính là thiết kế đang chạy đúng.

---

## 4. Eval RAG LẬP TRÌNH — `eval-rag-programming.mjs` + `rag-cases.json`

Gọi `searchProgrammingKb({ query, vendor, topK })` trên kho manual hãng (Universal Robots, Zmotion,
Mitsubishi, Omron, Fanuc, Delta). Chỉ số: `hitRate`, `meanPrecisionAtK`, `semanticUsedRate`,
`avgCitations`.

> ⚠ **Luật hit của bộ này vẫn là luật LỎNG** (`docTitle`/`sourcePath` chứa `expectDocContains`
> **hoặc** text chứa `expectKeywords`) — cùng lớp vấn đề đã mô tả ở §2. Nó chấp nhận được ở đây vì
> kho manual hãng nhỏ và có `vendor` lọc trước, nhưng **đừng đọc `hitRate` của bộ này ngang hàng với
> `precisionAt5` của §2**. Ai siết được nó thì siết.

```bash
npx tsx scripts/ai-eval/eval-rag-programming.mjs --selfcheck   # KHÔNG model, in trạng thái kho
npx tsx scripts/ai-eval/eval-rag-programming.mjs --k 8
npx tsx scripts/ai-eval/eval-rag-programming.mjs --ci --min 0.7
```

---

## 5. Eval SPECIALIST — `eval-specialist.mjs` + `specialist-cases/`

8 bài chẩn đoán dựng từ **bug thật trong lịch sử git**. Ngữ cảnh lấy bằng
`git show <fixCommit>^:<path>` — **mã ngay trước commit sửa**, tức bug còn nguyên, để model phải tự
tìm ra lỗi thay vì tóm tắt đáp án đã có sẵn trong file đã sửa.

Có **cổng chống rò**: `auditCaseLeakage()` dò xem từ khoá chấm điểm có lọt vào phần model nhìn thấy
không; ca bị rò bị đánh `trusted: false` và **loại khỏi** `trustedAverage`.

```bash
npm run eval:specialist
```

---

## 6. So sánh giữa các lần chạy

Mỗi lượt ghi `reports/<bộ>-<label>.json` với đầy đủ bản ghi từng ca + chỉ số + dấu thời gian. Chạy
với `--label` khác nhau rồi diff:

```bash
npx tsx scripts/ai-eval/eval-toolcall.mjs --label truoc-khi-va
# …sửa intentClassifier…
npx tsx scripts/ai-eval/eval-toolcall.mjs --label sau-khi-va
# diff reports/toolcall-truoc-khi-va.json reports/toolcall-sau-khi-va.json
```

Nhiệt độ để 0, bộ ca cố định, oracle tất định ⇒ một delta giữa hai lượt là **tín hiệu thật** từ thay
đổi mã/model/kho, không phải nhiễu.

---

## 6b. Số nền đo được lần đầu — 2026-08-16

Ghi ở đây để lần sau có mốc so, và để không ai phải chạy lại mới biết hệ đang ở đâu.
Báo cáo gốc: `reports/toolcall-baseline-regex-2026-08-16.json`, `reports/toolcall-full-2026-08-16.json`,
`reports/rag-operational-full-2026-08-16.json`.

### Gọi tool (82 ca · registry 77 tool)

| Chỉ số | regex | regex + LLM | Ghi chú |
|---|---|---|---|
| accuracy chọn tool | **0,826** | 0,841 | LLM chỉ thêm **1/69 ca** |
| accuracy trích args | 0,900 | 0,900 | LLM không chạm tới (nó chỉ chạy khi regex trả `null`) |
| từ chối đúng | **0,846** | **0,077** | ★ |
| **dương tính giả** | **0,154** | **0,923** | ★★★ |
| cặp đối kháng đạt | 0,933 | 0,933 | 14/15, 0 cặp sập |
| có dấu / không dấu | 0,917 / **0,167** | 0,917 / 0,250 | tụt **0,750 điểm** |

* ★★★ **`AI_TOOL_LLM_FALLBACK=1` (đang BẬT trong `.env`) phá huỷ khả năng từ chối.** Trong 21 lượt
  gọi model, model trả `get_today_stats` **18 lần** và `get_machine_status` 3 lần — **không lần nào
  nói `none`**. "Xin chào", "Cảm ơn bạn nhiều nhé", "Làm sao để tạo một lot mới" đều nhận về số liệu
  sản lượng hôm nay. Đổi lấy **+1 ca đúng**.
* **Câu không dấu gần như không dùng được đường regex** (0,167). Đối chứng dương `A07/A07n`
  (trigger `vram` là ASCII) vẫn trúng cả hai ⇒ nguyên nhân **đúng là chuyện dấu**, không phải chuyện khác.
* **Lớp lỗi `\b` + chữ cái ngoài ASCII** (ca `B09`, `C04`): trong JS `\b` chỉ nhận `[A-Za-z0-9_]`,
  nên `\b` đứng trước `đ`/`ơ`/`ư`… **không bao giờ** là biên. Mọi nhánh regex mở đầu bằng một từ có
  dấu (`\b(đang mở|…)`, `\b(đặt|cập nhật|…)`) là **mã chết**. Đối chứng cùng file: `chưa xác nhận`
  (bắt đầu bằng `c` ASCII) khớp bình thường.
* Args: `B03` "lệnh sản xuất **PO12345**" → `orderCode: "12345"` (mất tiền tố ⇒ tra DB trượt im lặng).

### RAG vận hành (54 ca · kho 7.306 chunk · luật hit **chặt**)

| | baseline cosine | + reranker | + GraphRAG |
|---|---|---|---|
| `hitRateAt5` | 1,000 | 0,982 | 1,000 |
| `precisionAt5` | **0,496** | 0,518 | 0,496 |
| `mrr` | 0,954 | 0,925 | 0,954 |
| `ndcgAt10` | 0,841 | 0,807 | 0,841 |
| `distractorAboveRate` | 0,056 | **0,000** | 0,056 |
| nhiễu trong top-5 / ca | 0,463 | **0,296** | 0,463 |

* **Luật hit chặt KHÔNG hạ `hitRateAt5`** — nó vẫn 1,000. Nhưng nó lộ ra thứ bộ cũ không nói được:
  **`precisionAt5` = 0,496**, tức **một nửa** ngữ cảnh nhét vào LLM là tài liệu sai. Đó mới là con
  số đáng sửa, và bộ cũ **không có** nó.
* **Reranker: hoà, có đánh đổi rõ.** Nó **quét sạch nhiễu chen lên trên** (0,056 → 0,000; nhiễu
  trong top-5 giảm 36%) và nhích `precision@5`, nhưng **làm xấu thứ tự** (`MRR` −0,029,
  `nDCG@10` −0,033) và **mất 1 ca hit**. 0/54 lượt rerank hỏng ⇒ con số này không bị pha loãng.
* **GraphRAG: +0,000 trên CẢ NĂM chỉ số**, vì nó chỉ tiêm **0,09 hàng xóm/câu**. Với
  `KB_GRAPHRAG_ENABLED=true` đang bật, đây là lần đầu có phép đo nói nó **không mua được gì** trên
  tập này (nghi can: `KB_GRAPHRAG_MIN_SIM=0.72` quá chặt).

### ⚠ Nợ phát hiện kèm, NGOÀI phạm vi `scripts/ai-eval/`

* **`gpuLayers: -1` = 0 lớp trên GPU** (node-llama-cpp v3 coi số là *số lớp*, không phải quy ước
  `-1 = tất cả` của llama.cpp CLI). Đo trên chính máy này, cùng model, backend `cuda`:
  `-1 → model.gpuLayers = 0` · `"max" → 37`. `scripts/ai-kb/_gguf-embed.mjs:75` và
  `scripts/ai-kb/eval-rag.mjs:221` **đều viết `-1`** ⇒ mọi lượt dựng embedding kho và mọi lượt
  `--rerank` của bộ cũ đã chạy **trên CPU**, im lặng (triệu chứng duy nhất: "chậm").
  `eval-rag-operational.mjs` đã dùng `"max"`; hai file kia **chưa sửa**.
* **`LlamaChatSession` dùng chung cho mọi câu ⇒ nhiễm chéo lịch sử.** `scripts/ai-kb/eval-rag.mjs`
  (`llmRerank`, ~:228) không reset giữa các câu, nên tới câu thứ *k* model vẫn "nhìn thấy" bảng tài
  liệu của *k−1* câu trước. `eval-rag-operational.mjs` gọi `session.resetChatHistory()` trước mỗi
  lượt chấm; file kia **chưa sửa**.
* **Registry đếm được 77 tool** (49 read · 26 write · 2 client), không phải 78 như tài liệu audit
  ghi — chênh **1 write tool**. Chưa truy nguyên.

---

## 7. ⚠ Nguyên tắc chung: **không bao giờ khai xanh khi không đo được gì**

Repo này đã dính lớp lỗi *"glob rỗng ⇒ vitest im lặng ⇒ cổng khai xanh"*. Hai bộ mới cưỡng chế ba
cửa, và **bộ nào thêm vào sau cũng phải giữ đủ ba**:

1. **Chạy 0 ca ⇒ thoát 1.** Không bao giờ in "PASS" trên một tập rỗng.
2. **Xin đo một nhánh mà không đo được** (LLM chưa sẵn sàng · reranker bị cổng chặn · đồ thị ngữ
   nghĩa rỗng · model nhúng lệch) ⇒ in khối **`✗ KHÔNG ĐO ĐƯỢC`** kèm **lý do cụ thể**, ghi
   `available:false` + `reason` vào report, và `--ci` coi đó là **THẤT BẠI** — không phải "bỏ qua".
3. **Mẫu số 0 ⇒ ghi `null`, không ghi `1.0`.** Một tỉ lệ không tồn tại không được phép trông giống
   một tỉ lệ hoàn hảo.

Và một cửa thứ tư ở tầng bộ ca: **bộ ca hỏng là lỗi của bộ ca, không phải kết quả đo** — tên tool
không có trong registry, đường dẫn không có trong kho, cặp đối kháng kỳ vọng cùng một tool… đều làm
harness **thoát 1 ngay**, chứ không lặng lẽ biến thành "vài ca trượt".
