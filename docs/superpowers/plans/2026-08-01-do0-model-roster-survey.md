# Đợt 0 — Khảo sát roster model AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trả lời bằng số liệu chạy được: roster model nào nên thường trú trên 32,6 GB VRAM, để bốn đợt sau (thị giác · dự báo năng suất · sinh PLC có kiểm chứng · máy chủ tại chỗ) không tranh nhau tài nguyên.

**Architecture:** Khảo sát-only. **Không đổi hành vi hệ thống.** Tái dụng hai bộ đo đã có (`scripts/ai-bench` có baseline sẵn, `scripts/ai-eval` import mã sản xuất thật), đọc bảng metric đã có (`ai_gateway_metrics`), và chỉ viết thêm phần nào hai bộ đó không phủ. Mọi thay đổi cấu hình diễn ra trong phiên đo rồi hoàn nguyên ngay.

**Tech Stack:** node-llama-cpp (GGUF) · PostgreSQL · tsx/node · nvidia-smi · Docker

**Spec:** `docs/superpowers/specs/2026-08-01-ai-model-roster-survey-design.md` (`7f1b1ea5`)

## Global Constraints

- **Đợt này KHÔNG đổi hành vi hệ thống.** Chỉ đo, chỉ đọc. Không commit thay đổi `.env` nào vào nhánh. Nếu một phép đo cần đổi cấu hình, đổi trong phiên rồi **hoàn nguyên ngay**, và ghi vào báo cáo là đã đổi gì.
- **KHÔNG xoá model khỏi đĩa.** `D:/SOURCES/16.AI` giữ nguyên 9 file / 46 GB.
- **KHÔNG nhúng lại kho tri thức**, không đụng `knowledge/embeddings.jsonl`.
- **KHÔNG tải model mới về.** Nếu thấy nên xét model ngoài kho, **ghi vào báo cáo** để chủ dự án quyết.
- **Mọi con số trong báo cáo phải kèm LỆNH tạo ra nó**, để lần sau chạy lại kiểm chứng được. Không ước lượng khi đọc — sprint trước có người tự đếm sai hai lần trong cùng một báo cáo vì ước lượng.
- **Chất lượng tiếng Việt do CHỦ DỰ ÁN chấm.** Agent chỉ được trình bày cạnh nhau, **không được kết luận "đạt"**.
- **Quyết định là ĐẦU RA của khảo sát.** Ưu tiên "nghiêng về model chuyên code" của chủ dự án chỉ là **tiêu chí phá hoà khi số liệu ngang nhau**. Nếu số liệu ngược lại, báo cáo trung thực.
- **KHÔNG `git add -A` / `git add -u`.** Cây có ~107 file việc dở của người khác (`knowledge/*`, `tools/machine-simulator/*`). Chỉ `git add` file bạn tạo, liệt kê tên.
- Chạy lệnh Postgres qua socket container: `MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -tAc "<SQL>"`. ⚠ Thiếu `MSYS_NO_PATHCONV=1` thì Git Bash dịch đường dẫn và lệnh hỏng.
- ⚠ **`git worktree add` TREO trên repo này** (do `uploads/inspections` track hàng chục nghìn file). Đừng dùng.
- Báo cáo viết **tiếng Việt**.

## Sự thật đã đo trước khi lập kế hoạch

| Hạng mục | Giá trị |
|---|---|
| GPU | RTX 5090, **32.607 MiB** |
| CPU | **i9-12900K**, 16 nhân / 24 luồng |
| RAM | **64 GB** |
| `GGUF_MAX_LOADED_MODELS` | 4 |
| `GGUF_VRAM_GUARD_PCT` | 90 |
| Vấn đề gốc | General-30B 17 GB + Coder-30B 17 GB = **34 GB > 32,6 GB** ⇒ không bao giờ cùng thường trú |
| Dư địa | một 30B + VL-8B + embed + rerank = **24,7 GB**, còn ~7,9 GB KV cache |

**Ba roster ứng viên** (không chốt trước):
- **A** — Coder-30B làm mọi tier + VL + embed + rerank = 24,7 GB
- **B** — Coder-30B + Qwen3-4B (tier general) + VL + embed + rerank = 27,1 GB
- **C** — Coder-30B trên GPU, General-30B đẩy sang RAM 64 GB

---

## Công cụ ĐÃ CÓ — dùng lại, đừng viết mới

| Công cụ | Lệnh | Đo sẵn cái gì |
|---|---|---|
| `scripts/ai-bench/bench.mjs` | `npm run ai:bench` | load ms · prefill tok/s · decode tok/s · **peak VRAM** cho từng logical model (`deep`/`fast`/`code`/`fim`/`embed`). Tự nạp `node-llama-cpp`, **không boot app**. Có baseline `baselines/baseline-2026-07-05.json` |
| `scripts/ai-eval/eval-codegen.mjs` | `npx tsx scripts/ai-eval/eval-codegen.mjs` | chất lượng sinh mã theo ngôn ngữ, **import mã sản xuất thật** |
| `scripts/ai-eval/eval-specialist.mjs` | `npm run eval:specialist` | chất lượng agent chuyên môn |
| `scripts/ai-kb/eval-rag.mjs` | `npm run kb:eval` | độ chính xác truy hồi RAG |
| bảng `ai_gateway_metrics` | SQL | **từng lượt gọi thật**: `tier`·`task`·`model`·`tokensIn/Out`·`latencyMs`·`outcome`·`createdAt` |

⚠ **`ai_gateway_metrics` hiện chỉ có 18 dòng** (27→30/07/2026). Đó **không phải** hồ sơ lưu lượng. Task 1 phải làm dày trước khi đọc.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `docs/superpowers/reports/2026-08-01-do0-roster-survey.md` (**mới**) | Báo cáo khảo sát — mỗi task nối thêm một mục | 1-7 |
| `scripts/ai-bench/baselines/roster-{A,B,C}.json` (**mới**) | Kết quả bench từng roster | 3 |
| `scripts/ai-survey/vi-quality-ab.mjs` (**mới**) | Sinh cặp câu tiếng Việt cạnh nhau cho chủ dự án chấm | 4 |
| `scripts/ai-survey/embed-space-probe.mjs` (**mới**) | Dò trộn không gian nhúng | 6 |

---

## Task 1: Đ1 — hồ sơ lưu lượng thật theo tier

**Files:**
- Create: `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`

**Interfaces:**
- Produces: mục "§1 Lưu lượng" trong báo cáo — bảng `task` × số lượt × tổng token × latency trung vị. Task 7 dùng để cân trọng số.

- [ ] **Step 1: Đọc dữ liệu đang có**

```bash
MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
"SELECT task, model, count(*) AS luot, sum(\"tokensIn\") AS tok_in, sum(\"tokensOut\") AS tok_out,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY \"latencyMs\") AS latency_p50
 FROM ai_gateway_metrics GROUP BY task, model ORDER BY luot DESC;"
```

Ghi nguyên output vào báo cáo. **Nếu tổng < 100 lượt, nói thẳng là chưa đủ để kết luận** — đừng suy diễn từ 18 dòng.

- [ ] **Step 2: Làm dày dữ liệu bằng phiên đại diện**

"Đại diện" định nghĩa cụ thể (để khỏi mơ hồ): một phiên có đủ **cả bốn nhóm việc**, mỗi nhóm **ít nhất 5 lượt**:
1. hỏi trợ lý tri thức (tier chat)
2. RCA / báo cáo (tier chat, prompt dài)
3. sinh hoặc sửa mã PLC (tier code)
4. xử lý ảnh kiểm tra (tier vision)

Khởi động app (`npm run dev`), thao tác qua giao diện hoặc gọi tRPC. **Ghi lại đã làm gì, bao nhiêu lượt.**

- [ ] **Step 3: Đọc lại sau khi làm dày**

Chạy lại SQL ở Step 1. Ghi bảng mới vào báo cáo, **kèm ghi chú rõ đây là lưu lượng dựng, không phải lưu lượng sản xuất**.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/reports/2026-08-01-do0-roster-survey.md
git commit -m "docs(do0-1): §1 hồ sơ lưu lượng thật theo tier"
```

---

## Task 2: Đ3 + Đ4 — đếm lần tráo model và đo KV cache

**Files:**
- Modify: `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`

**Interfaces:**
- Consumes: kịch bản phiên đại diện từ Task 1 Step 2.
- Produces: mục "§2 Tráo model & KV cache" — số lần evict ở roster hiện tại **và** roster A, cùng VRAM đỉnh.

**⚠ Đây là phép đo quan trọng nhất của cả đợt** — nó là lý do đợt này tồn tại. Phải cho thấy **cả hai chiều**: roster hiện tại evict > 0, roster A evict = 0. Chỉ đo chiều tốt là tô điểm.

- [ ] **Step 1: Xác định engine ghi log evict ở đâu**

Đọc `server/services/aiGgufEngine.ts:341-380`. Dòng `:366` ghi:
```
… ≥ <pct>% — evicted LRU model "<modelId>" before loading.
```
Xác nhận log này ra stdout của tiến trình server (không phải file riêng). Nếu ra chỗ khác, ghi rõ chỗ đó vào báo cáo.

- [ ] **Step 2: Đo roster HIỆN TẠI**

Khởi động app, chạy phiên đại diện (Task 1 Step 2), thu stdout:
```bash
npm run dev 2>&1 | tee /tmp/do0-roster-hientai.log
```
Đếm:
```bash
grep -c "evicted LRU model" /tmp/do0-roster-hientai.log
grep -o 'evicted LRU model "[^"]*"' /tmp/do0-roster-hientai.log | sort | uniq -c
```
Song song, lấy VRAM đỉnh (chạy trong terminal khác **trong lúc** phiên chạy):
```bash
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -l 1 > /tmp/do0-vram-hientai.csv
```

- [ ] **Step 3: Đo roster A**

Sửa `.env` **tạm thời**: đặt `GGUF_DEFAULT_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf` (cùng giá trị với `GGUF_CODE_MODEL`). **Không sửa gì khác.** Lặp lại Step 2 vào `/tmp/do0-roster-A.log` và `/tmp/do0-vram-A.csv`.

- [ ] **Step 4: HOÀN NGUYÊN `.env`**

⚠ **`.env` KHÔNG được git track** (nằm trong `.gitignore`). Nên `git checkout -- .env` **vô tác dụng** — nó không hoàn nguyên gì cả. Phải tự sao lưu trước khi sửa:

```bash
cp .env .env.do0-backup          # TRƯỚC khi sửa bất kỳ dòng nào
# … sửa, đo …
cp .env.do0-backup .env          # hoàn nguyên
diff .env .env.do0-backup && echo "ĐÃ HOÀN NGUYÊN ĐÚNG"
rm .env.do0-backup
```
⚠ **Bắt buộc.** Global constraint: không để lại thay đổi `.env` nào sau khi task xong.

- [ ] **Step 5: Đo KV cache dưới phiên dài nhất hệ hỗ trợ**

Đọc giới hạn context đang cấu hình (tìm `contextSize`/`n_ctx` trong `aiGgufEngine.ts`). Chạy một phiên agent **tới sát giới hạn đó**, ghi VRAM đỉnh và mốc bắt đầu thiếu. **Không đo phiên ngắn rồi ngoại suy.**

- [ ] **Step 6: Ghi báo cáo + commit**

Bảng: roster · số lần evict · model bị evict · VRAM đỉnh · context tối đa đạt được.
```bash
git add docs/superpowers/reports/2026-08-01-do0-roster-survey.md
git commit -m "docs(do0-2): §2 tráo model & KV cache — đo cả hai chiều"
```

---

## Task 3: Roster benchmark bằng harness có sẵn

**Files:**
- Create: `scripts/ai-bench/baselines/roster-A.json`, `roster-B.json`, `roster-C.json`
- Modify: `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`

**Interfaces:**
- Produces: mục "§3 Bench ba roster" — load ms · prefill/decode tok/s · peak VRAM mỗi roster, so với `baseline-2026-07-05.json`.

- [ ] **Step 1: Đọc harness trước khi chạy**

`cat scripts/ai-bench/README.md`. Xác nhận cách nó chọn model (đọc `GGUF_*` env) và cách ghi baseline. **Đừng sửa harness** — nó đã chạy đúng và có baseline lịch sử để so.

- [ ] **Step 2: Bench roster hiện tại làm mốc**

```bash
npm run ai:bench
```
Ghi kết quả. So với `scripts/ai-bench/baselines/baseline-2026-07-05.json` — nếu lệch nhiều so với baseline cũ, **nói ra**, vì nghĩa là máy hoặc cấu hình đã đổi từ 05/07.

- [ ] **Step 3: Bench roster A**

Đặt tạm `GGUF_DEFAULT_MODEL` = Coder-30B (như Task 2 Step 3), chạy `npm run ai:bench`, lưu kết quả vào `scripts/ai-bench/baselines/roster-A.json`.

- [ ] **Step 4: Bench roster B**

Đặt tạm `GGUF_DEFAULT_MODEL=Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf`, giữ `GGUF_CODE_MODEL`=Coder-30B. Chạy, lưu `roster-B.json`.

- [ ] **Step 5: Bench roster C**

Roster C đẩy General-30B sang RAM. Tìm biến điều khiển số lớp trên GPU (`GGUF_GPU_LAYERS` hoặc tương đương trong `aiGgufEngine.ts`); nếu **không có biến nào** làm được việc này, **ghi vào báo cáo là roster C chưa đo được và vì sao** — đừng bịa số.

- [ ] **Step 6: HOÀN NGUYÊN `.env` + commit**

```bash
cp .env.do0-backup .env && diff .env .env.do0-backup && rm .env.do0-backup   # .env KHÔNG git-track, phải sao lưu thủ công
git add scripts/ai-bench/baselines/roster-A.json scripts/ai-bench/baselines/roster-B.json docs/superpowers/reports/2026-08-01-do0-roster-survey.md
git commit -m "docs(do0-3): §3 bench ba roster ứng viên"
```
(Thêm `roster-C.json` vào lệnh `git add` nếu Step 5 đo được.)

---

## Task 4: Đ2 — A/B chất lượng tiếng Việt, chủ dự án chấm

**Files:**
- Create: `scripts/ai-survey/vi-quality-ab.mjs`
- Modify: `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`

**Interfaces:**
- Produces: mục "§4 A/B tiếng Việt" — **các cặp câu cạnh nhau, KHÔNG có kết luận đạt/không đạt**.

**⚠ Ràng buộc tuyệt đối: agent KHÔNG được chấm.** Chỉ sinh và trình bày. Kết luận là của chủ dự án. Sprint trước đã chứng minh tự nghiệm thu là chỗ dễ tự lừa nhất.

- [ ] **Step 1: Chọn 4 prompt từ đường chạy THẬT**

Không bịa prompt. Lấy prompt thật mà bốn dịch vụ này đang dùng:
- `server/services/aiRcaCopilot.ts` — phân tích nguyên nhân gốc
- `server/services/aiExecutiveReport.ts` — báo cáo điều hành
- dịch vụ cố vấn ngưỡng (tìm trong `server/services/ai*Threshold*` hoặc `aiCalibration.ts`)
- `server/services/aiLocalKnowledgeService.ts` — trợ lý tri thức

Ghi vào báo cáo prompt lấy từ file nào, dòng nào.

- [ ] **Step 2: Viết script sinh cặp**

`scripts/ai-survey/vi-quality-ab.mjs`: với mỗi prompt, gọi **hai** model — `Qwen3-30B-A3B-Instruct-2507` và `Qwen3-Coder-30B-A3B-Instruct` — cùng tham số sinh (temperature, max tokens), in ra markdown hai cột.

⚠ **Ẩn danh model trong bản cho chủ dự án đọc** (gọi là "Model 1" / "Model 2", ghi bảng ánh xạ ở cuối file riêng). Biết trước cái nào là cái nào sẽ làm lệch đánh giá.

- [ ] **Step 3: Chạy và ghi kết quả**

```bash
npx tsx scripts/ai-survey/vi-quality-ab.mjs > docs/superpowers/reports/2026-08-01-do0-vi-ab.md
```

- [ ] **Step 4: Ghi vào báo cáo chính + commit**

Mục §4 chỉ ghi: đã sinh bao nhiêu cặp, file ở đâu, **và câu "chờ chủ dự án chấm"**. Không kết luận.
```bash
git add scripts/ai-survey/vi-quality-ab.mjs docs/superpowers/reports/2026-08-01-do0-vi-ab.md docs/superpowers/reports/2026-08-01-do0-roster-survey.md
git commit -m "docs(do0-4): §4 cặp A/B tiếng Việt — chờ chủ dự án chấm"
```

---

## Task 5: Đ5 — độ trễ ghost-text (FIM)

**Files:**
- Modify: `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`

**Interfaces:**
- Produces: mục "§5 FIM" — độ trễ p50/p95 của `Qwen2.5-Coder-1.5B` so với `Qwen3-Coder-30B`.

**Bối cảnh:** ghost-text cần độ trễ cỡ gõ phím. `Qwen2.5-Coder-1.5B` cũ hai thế hệ nhưng nhỏ; Coder-30B mới hơn nhưng có thể quá chậm. **Chỉ đổi nếu số liệu ủng hộ** — không đổi vì "mới hơn thì tốt hơn".

- [ ] **Step 1: Đo bằng harness có sẵn**

`ai-bench` đã đo logical model `fim` (đọc `GGUF_FIM_MODEL`). Chạy `npm run ai:bench`, lấy phần `fim`.

- [ ] **Step 2: Đo Coder-30B ở vai FIM**

Đặt tạm `GGUF_FIM_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf`, chạy lại, lấy phần `fim`.

- [ ] **Step 3: Đo độ trễ đầu-cuối thật, không chỉ tok/s**

tok/s không phải thứ người gõ cảm nhận — **thời gian tới token đầu tiên (TTFT)** mới là. Lấy TTFT từ output bench cho cả hai. Nếu bench không tách TTFT riêng, ghi rõ và đo bằng cách khác, **đừng suy ra từ tok/s**.

- [ ] **Step 4: HOÀN NGUYÊN `.env` + ghi báo cáo + commit**

```bash
cp .env.do0-backup .env && diff .env .env.do0-backup && rm .env.do0-backup   # .env KHÔNG git-track, phải sao lưu thủ công
git add docs/superpowers/reports/2026-08-01-do0-roster-survey.md
git commit -m "docs(do0-5): §5 độ trễ FIM — 1.5B so với 30B"
```

---

## Task 6: Đ6 — toàn vẹn không gian nhúng

**Files:**
- Create: `scripts/ai-survey/embed-space-probe.mjs`
- Modify: `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`

**Interfaces:**
- Produces: mục "§6 Không gian nhúng" — có đường chạy nào trộn hai embedder không.

**⚠ Bẫy đã biết, nghiêm trọng:** kho RAG nhúng bằng `Qwen3-Embedding-0.6B-f16` (`knowledge/embeddings-meta.json`, 5.687 chunk), còn tìm-ảnh-theo-ảnh dùng `mxbai-embed-large` (`server/routers/aiImageSearchRouter.ts:153`). **Cả hai đều ra vector 1024 chiều**, nên phép canh kích thước ở `aiGgufEngine.ts:173` **về nguyên lý không thể** phát hiện trộn nhầm — nó cho qua và trả kết quả sai **âm thầm**.

Đây là nợ **tiền tồn tại**. Task này **chỉ đo và báo cáo, KHÔNG sửa** — sửa có thể phải nhúng lại toàn bộ, là đợt riêng.

- [ ] **Step 1: Truy vết mọi đường nhúng và mọi đường tìm**

```bash
grep -rn "embedModelBasename\|GGUF_EMBED_MODEL\|GGUF_EMBEDDING_MODEL" server/ scripts/ --include=*.ts --include=*.mjs | grep -v test
```
Lập bảng: **đường nào nhúng bằng model nào** × **đường nào tìm bằng model nào**. Bất kỳ ô nào lệch = bug âm thầm.

- [ ] **Step 2: Chứng minh phép canh kích thước không đủ**

Viết `scripts/ai-survey/embed-space-probe.mjs`: nhúng cùng một câu bằng **cả hai** model, in ra số chiều và độ tương đồng cosin giữa hai vector.
Kỳ vọng: **cùng 1024 chiều** (nên canh kích thước cho qua) nhưng **cosin thấp** (nên chúng là hai không gian khác nhau). Đó là bằng chứng bẫy có thật.

- [ ] **Step 3: Đối chiếu thứ hạng RAG trước/sau (chốt an toàn)**

```bash
npm run kb:eval
```
Lưu kết quả. Đây là mốc để đợt sau chứng minh không làm hỏng truy hồi.

- [ ] **Step 4: Ghi báo cáo + commit**

Ghi rõ: có trộn hay không · bằng chứng cosin · khuyến nghị (nhưng **không thực hiện**).
```bash
git add scripts/ai-survey/embed-space-probe.mjs docs/superpowers/reports/2026-08-01-do0-roster-survey.md
git commit -m "docs(do0-6): §6 toàn vẹn không gian nhúng — đo, không sửa"
```

---

## Task 7: Tổng hợp và khuyến nghị

**Files:**
- Modify: `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`

**Interfaces:**
- Consumes: §1-§6.
- Produces: mục "§7 Khuyến nghị" — một roster kèm lý do **bằng số liệu**, và danh sách việc phải làm khi đổi.

- [ ] **Step 1: Bảng quyết định**

Một bảng: ba roster × các trục đã đo (lưu lượng phục vụ được · số lần evict · VRAM đỉnh · KV headroom · tok/s · TTFT FIM). **Mỗi ô kèm nguồn số liệu.**

- [ ] **Step 2: Nêu rõ chỗ số liệu KHÔNG quyết được**

Chất lượng tiếng Việt (§4) đang chờ chủ dự án chấm. **Viết khuyến nghị dưới dạng điều kiện**: "nếu §4 cho thấy X thì chọn A; nếu cho thấy Y thì chọn B/C". Không giả định kết quả §4.

- [ ] **Step 3: Danh sách việc phải làm khi đổi roster**

Ít nhất phải có:
- `aiModelCard.ts:71/90/108/126` **ghim cứng** tên model — gỡ model khỏi `.env` mà quên đây thì hệ khai báo model không còn tồn tại.
- Quét toàn repo tìm mọi chỗ ghim cứng khác: `grep -rnE '"Qwen[0-9A-Za-z.-]*(30B|4B|8B|1\.5B|0\.6B)[^"]*"' --include=*.ts server/ client/ | grep -v test`
- Cách quay lui trong **một dòng** `.env`.

- [ ] **Step 4: Nêu giới hạn của chính khảo sát này**

Trung thực về chỗ yếu: lưu lượng là **dựng, không phải sản xuất**; roster C có thể chưa đo được; kiến thức về model mới hơn 5/2026 là chỗ cần chủ dự án xác nhận.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/reports/2026-08-01-do0-roster-survey.md
git commit -m "docs(do0-7): §7 tổng hợp + khuyến nghị roster có điều kiện"
```

---

## Self-Review

**Spec coverage:** §2(a) quyết-định-là-đầu-ra → Task 7 Step 2 (khuyến nghị có điều kiện) · §2(b) không đổi hành vi → Global Constraints + hoàn nguyên `.env` ở Task 2/3/5 · §2(c) quay lui một dòng → Task 7 Step 3 · §3.1 bẫy embedder → Task 6 · §3.2 ghim cứng tên model → Task 7 Step 3 · §3.3 đếm file ≠ lượt gọi → Task 1 · §4 Đ1-Đ6 → Task 1,2,3,4,5,6 · §5 ba roster → Task 3 · §6 không vỡ hệ sinh thái → Global Constraints · §7 nghiệm thu → Task 7 · §8 ngoài phạm vi → ghi trong Task 6 Step 4 (không sửa) và Global Constraints (không tải model mới). **Đủ.**

**Placeholder scan:** không có "TBD"/"tuỳ tình huống". Ba chỗ **cố ý** để ngỏ, đều kèm chỉ dẫn phải làm gì khi gặp: Task 3 Step 5 (nếu không có biến GPU-layers thì ghi là chưa đo được, đừng bịa) · Task 4 Step 1 (tìm dịch vụ cố vấn ngưỡng ở hai chỗ ứng viên) · Task 5 Step 3 (nếu bench không tách TTFT thì đo cách khác, đừng suy từ tok/s).

**Type consistency:** tên file báo cáo `2026-08-01-do0-roster-survey.md` dùng nhất quán ở cả 7 task. Tên baseline `roster-{A,B,C}.json` khớp giữa Task 3 Step 3-5 và File Structure. Ba roster A/B/C định nghĩa một lần ở đầu, tham chiếu nguyên vẹn về sau.
