# Đợt 1 — Giành lại VRAM: báo cáo thực thi

Nhánh: `feat/hmi-dep` · Kế hoạch: `docs/superpowers/plans/2026-08-01-dot1-gianh-lai-vram.md`

> File này được nối thêm mục theo từng task của Đợt 1 (Task 1 → Task 4). Mỗi mục là một `§N` độc lập, không sửa lại các mục trước.

---

## §1 Khoá in-flight — app nạp được model 30B trở lại (Task 1)

### Vấn đề

Đợt 0 đo được **45/45 lượt nạp model 30B thất bại** qua đường boot app, tái hiện **100%** mọi lần khởi động. Nguyên nhân: hai nơi độc lập trong app cùng gọi `warmModel(GGUF_DEFAULT_MODEL)` mà `loadGgufModel()` (`server/services/aiGgufEngine.ts`) **không có khoá đồng thời**:

- `server/services/aiGgufEngine.ts:1038` (`warmModel`) ← gọi từ `server/_core/backgroundJobs.ts:126-127`, delay 3000ms sau boot.
- `server/services/aiLocalKnowledgeService.ts:2392-2418` ← gọi từ `server/routes/aiLocalKnowledgeApi.ts:268`, delay 2000ms sau boot.

Cả hai đường đều gọi cùng `modelId`. Khi chồng nhau, cả hai lượt cùng vượt qua `loadedModels.has(modelId)` (model chưa nạp xong ở lượt đầu) và cùng gọi `llama.loadModel()` song song:
- Model **30B**: lượt hai `cudaMalloc` lỗi (không đủ VRAM cho 2 bản ~17 GB cùng lúc) ⇒ boot thất bại.
- Model **4B** (nhỏ hơn): **cả hai lượt đều thành công**. `loadedModels.set(modelId, …)` ở dòng ~660 là **vô điều kiện** (không kiểm entry cũ, không `dispose()`), nên lượt sau ghi đè lượt trước trong map — bản đầu trở thành **mồ côi ~3.474 MiB VRAM**, `evictLRU()` (chỉ duyệt các entry còn trong `loadedModels`) không với tới được nó. Chỉ restart tiến trình mới dọn. Model càng nhỏ càng rò nhiều (lượt càng dễ thành công song song).

### Sửa

Thêm map in-flight ở phạm vi module (`server/services/aiGgufEngine.ts`, cạnh khai báo `loadedModels`) và bọc thân hàm `loadGgufModel` (giữ nguyên logic có sẵn — chỉ thêm khoá ở tầng gọi):

```ts
const inFlightLoads = new Map<string, Promise<string>>();
```

Trong `loadGgufModel`, **sau khi `modelId` đã được tính** (`path.basename(resolvedPath, ".gguf")`) và **sau** phép kiểm `loadedModels.has(modelId)` hiện có: nếu `modelId` đang có một `Promise` in-flight, lượt gọi thứ hai trả về đúng promise đó thay vì nạp song song. Toàn bộ thân hàm nạp (từ `getLlama()` tới `loadedModels.set(...)`) được bọc trong một IIFE async, promise của nó được ghi vào `inFlightLoads` trước khi `await`, và được **xoá khỏi map trong `finally`** — kể cả khi nạp thất bại (nếu không xoá, mọi lượt gọi sau sẽ nhận lại đúng promise lỗi đó vĩnh viễn, không bao giờ thử nạp lại).

**Không đụng** `loadedModels.set()`, `evictLRU()`, `enforceVramGuard()` — các hàm này đúng, chỉ thiếu khoá ở tầng trên.

### TDD — bằng chứng ĐỎ trước khi sửa

File test mới: `server/services/aiGgufEngine.inflight.test.ts`. Mock `node-llama-cpp` với `loadModel` giả nạp chậm (50ms) để hai lượt gọi `Promise.all([loadGgufModel(cfg), loadGgufModel(cfg)])` chắc chắn chồng nhau (race thật). **Lưu ý so với mã mẫu trong brief**: mã mẫu không mock `fs`, nhưng `loadGgufModel()` gọi `resolveModelPath()` → `fs.existsSync()` THẬT trên đĩa; đường dẫn test giả (`test-model.gguf`) không tồn tại trên máy này, nên nếu không mock `fs` thì `resolveModelPath()` sẽ throw "file not found" ngay lập tức ở cả hai lượt gọi, `loadModelSpy` không bao giờ được chạm tới, và test không chứng minh được gì về race. Đã sửa mock (thêm `vi.mock("fs", …)` giống quy ước sẵn có ở `server/services/aiGgufEngine.test.ts`) để mô tả đúng thế giới thật thay vì sửa mã sản xuất cho khớp mock.

Chạy trước khi vá (`npx vitest run server/services/aiGgufEngine.inflight.test.ts`), output đỏ:

```
 ❯ server/services/aiGgufEngine.inflight.test.ts (2 tests | 1 failed) 215ms
   × loadGgufModel — khoá in-flight > hai lượt gọi ĐỒNG THỜI cùng một model chỉ nạp MỘT lần 157ms
     → expected "spy" to be called 1 times, but got 2 times

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/services/aiGgufEngine.inflight.test.ts > loadGgufModel — khoá in-flight > hai lượt gọi ĐỒNG THỜI cùng một model chỉ nạp MỘT lần
AssertionError: expected "spy" to be called 1 times, but got 2 times
 ❯ server/services/aiGgufEngine.inflight.test.ts:66:26

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

(Test thứ hai — hai lượt gọi TUẦN TỰ — đã xanh ngay cả trước khi vá, vì lượt thứ hai luôn thấy `loadedModels.has()` đã true; đúng như kỳ vọng, đây không phải test của race.)

### Sau khi vá — bằng chứng XANH

- `npx vitest run server/services/aiGgufEngine.inflight.test.ts` → **2/2 xanh** (`loadModelSpy` chỉ bị gọi 1 lần dù `Promise.all` hai lượt đồng thời).
- `npx vitest run server/services/aiGgufEngine.test.ts` (bộ test cũ, không đổi) → **12/12 xanh**, không hồi quy.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → chỉ còn lỗi tiền tồn tại `client/src/pages/SessionManagement.tsx(195,64)`.

### Đo VRAM không hồi quy

Lệnh: `node scripts/ai-bench/bench.mjs --models deep --iters 1 --warmup 0` (model `Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf`, 16.5 GB trên đĩa).

| Mốc | VRAM (MiB) |
|---|---|
| Baseline trước khi chạy | 1.178 |
| Peak sau khi nạp + sinh | 18.926 |
| **Delta model** | **17.748** (khớp mốc Đợt 0 ~17.700 MiB) |
| Sau khi tiến trình bench thoát | 1.177 |

Nạp **thành công 1 lần duy nhất** (`loaded in 41399.6ms`), không còn lỗi `cudaMalloc`. Sau khi bench thoát: VRAM về baseline (1.177 MiB, sai số đo trong khoảng nhiễu bình thường so với 1.178 MiB trước khi chạy), `tasklist` xác nhận **không còn `node.exe` treo**.

Baseline JSON đầy đủ (không commit — nằm trong `.gitignore` của thư mục bench): `scripts/ai-bench/baselines/2026-08-01T14-21-51-546Z.json`.

### Mối lo / việc để lại cho task sau

- Task này chỉ khoá **in-flight LOAD**. Chưa xử lý bản đồ ngân sách VRAM toàn cục cho 4 hộ tiêu thụ (nợ Đợt 0, ngoài phạm vi Đợt 1) — vẫn có thể OOM nếu nhiều model khác nhau được yêu cầu đồng thời (không cùng `modelId`, nên khoá này không áp dụng).
- Chưa test riêng nhánh "nạp thất bại → `finally` xoá khỏi `inFlightLoads` → lượt sau thử lại thành công" bằng test hành vi (đã xác nhận đúng bằng đọc mã + bộ test OOM-fallback hiện có trong `aiGgufEngine.test.ts` vẫn xanh, chứng tỏ đường lỗi/retry cũ không bị khoá mới phá vỡ, nhưng không có test riêng cho "khoá được giải phóng sau lỗi rồi lượt sau tự thử lại và thành công").

---

## §2 Ngữ cảnh nhúng — embedding thôi cấp phát toàn bộ cửa sổ ngữ cảnh (Task 2)

### Vấn đề

`getEmbeddingContext()` (`server/services/aiGgufEngine.ts`, khi vá ở dòng ~2261-2264) gọi:
```ts
loaded.embeddingContext = await loaded.model.createEmbeddingContext({
  contextSize: "auto",           // lấy TOÀN BỘ cửa sổ ngữ cảnh model được huấn luyện
  batchSize: loaded.config.batchSize ?? 512,
});
```
`"auto"` cấp phát toàn bộ cửa sổ ngữ cảnh mà model nhúng hỗ trợ — bất kể chunk RAG thực tế dài bao nhiêu. Chunk RAG dài nhất trong `knowledge/chunks-stats.json` (`maxChunkChars=1800`) chỉ ~600 token. Model nhúng còn được `loadGgufModel()` nạp kèm một `context` **thường** (`createContext({ contextSize: GGUF_DEFAULT_CTX=4096, sequences: GGUF_SEQUENCES=4, ... })`, dòng ~662-668) mà nó **không bao giờ dùng để sinh chữ** — nên `"auto"` là trả tiền lần thứ hai cho một cửa sổ ngữ cảnh không tương xứng nhu cầu.

Tên hàm export thật đúng như mã mẫu trong brief: `generateEmbedding` (`aiGgufEngine.ts:2187`, gọi `getEmbeddingContext()` ở dòng 2204/2235).

### Sửa

Thêm hằng số `EMBED_CTX` (đọc `GGUF_EMBED_CTX`, mặc định **1024** — dư ~70% biên an toàn so với ~600 token của chunk dài nhất) cạnh các hằng cấu hình GGUF khác (`resolveContextSize`), rồi dùng nó thay `"auto"` trong `getEmbeddingContext()`. Khối `catch` và các câu thông điệp lỗi tiếng Việt hiện có **giữ nguyên không đổi**.

### TDD — bằng chứng ĐỎ trước khi sửa

File test mới: `server/services/aiGgufEngine.embedCtx.test.ts`. **Lệch so với mã mẫu trong brief**: mã mẫu thiếu `vi.mock("fs", ...)` — giống bẫy Task 1 đã gặp, `loadGgufModel()` → `resolveModelPath()` gọi `fs.existsSync()` THẬT, nên đã thêm mock `fs` theo đúng quy ước sẵn có ở `aiGgufEngine.test.ts`/`aiGgufEngine.inflight.test.ts`. Cũng gọi `generateEmbedding(text, "embed-model")` với `modelId` tường minh (thay vì để hàm tự `resolveEmbedModelBasename()` từ env) để test không phụ thuộc `GGUF_EMBED_MODEL`/`readdirSync` thật — cùng quy ước với test `generateEmbedding` hiện có trong `aiGgufEngine.test.ts`.

Chạy trước khi vá (`npx vitest run server/services/aiGgufEngine.embedCtx.test.ts`), output đỏ:
```
 ❯ server/services/aiGgufEngine.embedCtx.test.ts (2 tests | 2 failed) 83ms
   × getEmbeddingContext — ngân sách ngữ cảnh > KHÔNG dùng contextSize 'auto' — nó cấp toàn bộ cửa sổ model 74ms
     → expected 'auto' not to be 'auto' // Object.is equality
   × getEmbeddingContext — ngân sách ngữ cảnh > ngữ cảnh đủ chứa chunk dài nhất (~600 token) và có biên an toàn 8ms
     → expected 'string' to be 'number' // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/services/aiGgufEngine.embedCtx.test.ts > getEmbeddingContext — ngân sách ngữ cảnh > KHÔNG dùng contextSize 'auto' — nó cấp toàn bộ cửa sổ model
AssertionError: expected 'auto' not to be 'auto' // Object.is equality
 ❯ server/services/aiGgufEngine.embedCtx.test.ts:71:34

 FAIL  server/services/aiGgufEngine.embedCtx.test.ts > getEmbeddingContext — ngân sách ngữ cảnh > ngữ cảnh đủ chứa chunk dài nhất (~600 token) và có biên an toàn
AssertionError: expected 'string' to be 'number' // Object.is equality
Expected: "number"
Received: "string"
 ❯ server/services/aiGgufEngine.embedCtx.test.ts:79:37

 Test Files  1 failed (1)
      Tests  2 failed | 0 passed (2)
```

### Sau khi vá — bằng chứng XANH

- `npx vitest run server/services/aiGgufEngine.embedCtx.test.ts` → **2/2 xanh**.
- Toàn bộ họ test `aiGgufEngine.*.test.ts` (6 file: `aiGgufEngine.test.ts`, `aiGgufEngine.inflight.test.ts`, `aiGgufEngine.fim.server.test.ts`, `aiGgufEngine.llamaServerFallback.test.ts`, `aiGgufEngine.modelResolver.equivalence.test.ts`, `aiGgufEngine.textModelGuard.test.ts`) → **64/64 xanh**, không hồi quy.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → chỉ còn lỗi tiền tồn tại `client/src/pages/SessionManagement.tsx(195,64)`.

### ⚠ Phát hiện quan trọng: `scripts/ai-bench/bench.mjs` KHÔNG đo được sửa này

Lệnh đo TRƯỚC (`node scripts/ai-bench/bench.mjs --models embed --iters 1 --warmup 0`): `modelDeltaMib` = **5.624 MiB** (mốc Đợt 0: 5.664 MiB, lệch ~0,7% — trong nhiễu bình thường). Lệnh đo SAU (cùng lệnh, sau khi vá): `modelDeltaMib` = **5.618 MiB** — **gần như không đổi**.

Nguyên nhân: `bench.mjs` được thiết kế **tự chứa** (comment ở đầu file: "does NOT import any server/ source", để chạy được mà không boot app) — nó có `benchEmbedModel()` **RIÊNG**, tự gọi `model.createEmbeddingContext({ contextSize: "auto" })` **HARD-CODE** ở dòng 321, hoàn toàn độc lập với `aiGgufEngine.ts`. Sửa `EMBED_CTX` trong mã sản xuất **không** chạm tới đường đo này. (Cùng một khuôn: `scripts/ai-kb/_gguf-embed.mjs`, dùng bởi `kb:eval`, cũng hard-code `contextSize: "auto"` ở dòng 71 — độc lập tương tự, xem mục an toàn bên dưới.)

Để có số THẬT phản ánh đúng mã đã sửa, đã viết một script tạm (`scripts/ai-bench/_tmp-real-embed-check.mjs`, chạy bằng `npx tsx`, **không boot Express/route** — chỉ `import("../../server/services/aiGgufEngine.ts")` rồi gọi thẳng `generateEmbedding()` production, đúng cách `server/services/kb/kbVectorStore.ts:68` gọi thật; đã xoá sau khi đo xong, không commit):

| Cấu hình | VRAM delta thật (model + context thường + embedding context) |
|---|---|
| TRƯỚC (`contextSize: "auto"`, đo lại bằng cách tạm sửa `EMBED_CTX` về `"auto"` rồi phục hồi ngay) | **7.694 MiB** |
| SAU (`contextSize: EMBED_CTX = 1024`, mã đã vá) | **4.204 MiB** |
| **Giảm** | **3.490 MiB (~45,4%)** |

Số THẬT (7.694 MiB) cao hơn số `bench.mjs` báo (5.624 MiB) vì `bench.mjs` chỉ gọi `createEmbeddingContext`, **không** gọi `model.createContext()` — trong khi đường sản xuất thật (`loadGgufModel()`) luôn tạo CẢ HAI context cho model nhúng (context thường `GGUF_DEFAULT_CTX=4096` + embedding context), đúng khoản "trả tiền hai lần" đã nêu trong bối cảnh brief. Sau khi vá, số thật giảm ~45% — lớn hơn nhiều so với con số ước tính ban đầu từ `bench.mjs` (vốn không đo được khoản tiết kiệm này).

**Khuyến nghị để lại cho việc sau (ngoài phạm vi Task 2, không tự ý sửa)**: `scripts/ai-bench/bench.mjs:321` và `scripts/ai-kb/_gguf-embed.mjs:71` nên gọi qua `EMBED_CTX`/production path (hoặc ít nhất đọc `GGUF_EMBED_CTX`) để công cụ đo và cổng an toàn phản ánh đúng mã sản xuất — hiện tại cả hai đường đo được chỉ định trong brief đều **không nhạy** với thay đổi này.

### ⚠ Cổng an toàn — `npm run kb:eval`

**`recall@5 = 151/151 = 1.000`** (không đổi, không hồi quy) — giữ đúng mốc Đợt 0. Ghi chú trung thực: `kb:eval` gọi `scripts/ai-kb/_gguf-embed.mjs` (`embedTextGguf`), **không** gọi `aiGgufEngine.generateEmbedding()`, nên cổng an toàn này **không thực sự tập luyện qua đường mã vừa sửa** — nó xác nhận không có hồi quy ở KHO TRI THỨC hiện có (đúng vai trò "cổng an toàn"), nhưng không phải bằng chứng recall cho `EMBED_CTX=1024` trên đường sản xuất thật. Đường sản xuất thật (`kbVectorStore.ts`, dùng bởi tính năng tìm kiếm RAG sống của app) đã được xác nhận đúng qua unit test + đo VRAM thật ở trên. `knowledge/rag-eval-results.json` đổi hợp lệ theo brief, đã đưa vào commit.

### Đo VRAM không hồi quy sau khi thoát

Sau mỗi lượt đo (bench.mjs và script tạm): `nvidia-smi` xác nhận VRAM về gần baseline (~1.0-1.5 GB, dao động bình thường), không còn `node.exe` treo (kiểm bằng `tasklist`/quan sát tiến trình thoát).

### Mối lo / việc để lại cho task sau (trước review vòng 1)

- **Công cụ đo trong brief (`bench.mjs`) và cổng an toàn (`kb:eval` → `_gguf-embed.mjs`) đều không đi qua `aiGgufEngine.ts`** — bất kỳ thay đổi tương lai nào ở `EMBED_CTX`/`getEmbeddingContext()` sẽ **không** được hai công cụ này phát hiện. Task 4 (roster VRAM) nên dùng số thật (xem số đã cập nhật ở mục review vòng 1 bên dưới) thay vì số `bench.mjs` báo.
- `GGUF_EMBED_CTX` là biến môi trường mới, chưa có trong `.env` hiện tại của máy này (không sửa `.env` theo đúng ràng buộc của task) — mặc định trong mã đã đủ dùng, không bắt buộc set.

---

### ⚠ Review vòng 1 — Important: 1024 KHÔNG đủ, sửa lên 2048

**Phát hiện của reviewer**: brief gốc ước lượng chunk RAG dài nhất "~600 token" từ `maxChunkChars=1800` (`knowledge/chunks-stats.json`) — đây là **trần công bố**, không phải trần được thực thi. `scripts/ai-kb/build-knowledge-chunks.mjs` (`chunkText()`) không chặn cứng khi gặp khối văn bản không có ranh giới đoạn/câu (ví dụ bảng markdown). Đo THẬT bằng tokenizer của chính model nhúng (Qwen3-Embedding-0.6B) trên chunk dài nhất thực tế đang có trong `knowledge/chunks.jsonl` (đã tự kiểm chứng lại độc lập, khớp số reviewer đưa ra):

- Chunk `doc:docs/ECOSYSTEM/27_AOI_AVI_END_TO_END_AUDIT_UPGRADE_PLAN_2026-07.md#23`: **6.135 ký tự → 1.879 token thật** (đo bằng `model.tokenize()` thật, không phải ước lượng ký tự/4).
- Vượt `EMBED_CTX=1024` cũ tới **83%**.
- node-llama-cpp xác nhận thực nghiệm: input vượt `contextSize` thì **THROW** (`"Input is longer than the context size that this LlamaContext was created with..."`), không cắt âm thầm.
- Đường sản xuất thật `server/services/kb/kbVectorStore.ts:68` (`ingestKbChunks()`) gọi `generateEmbedding(content)` với `chunk.text` chưa cắt — throw đó bị `try/catch` nuốt thành `skipped++`, khiến nội dung **âm thầm vắng mặt** khỏi `kb_chunks`. Đường này hiện dormant (`KB_PGVECTOR_ENABLED` chưa bật) nhưng route không tự kiểm cờ trước khi chạy. **Đây là lỗi Task 2 mang vào** — trước Task 2 (còn `"auto"`) đường này chưa từng throw kiểu đó.

**Lựa chọn: (a) nâng `EMBED_CTX` mặc định lên 2048.** Lý do: sửa đúng lỗi vừa tạo ra bằng thay đổi tối thiểu, không mở thêm mặt trận hành vi mới (không đụng tới cách `kbVectorStore.ts` xử lý input — đó là thay đổi hành vi cần cân nhắc riêng, ngoài phạm vi task này). 2048/1879 ≈ **biên an toàn ~9%** — sát nhưng đủ cho chunk dài nhất hiện có; vẫn giữ phần lớn khoản tiết kiệm so với `"auto"`.

**Sửa mã**: `EMBED_CTX` mặc định `2048` (thay `1024`), cộng **Minor 1**: thêm trần trên `Math.min(value, GGUF_MAX_CTX)` — nhất quán với `resolveContextSize()`/`GGUF_MAX_CTX` đã có sẵn trong cùng file cho đúng mục đích (chặn KV-cache phi lý).

**TDD — test mới, ĐỎ trước khi sửa** (thêm vào `aiGgufEngine.embedCtx.test.ts`, mock `createEmbeddingContext`/`getEmbeddingFor` được nâng cấp để **mô phỏng đúng hành vi throw thật** của node-llama-cpp khi input vượt `contextSize`, thay vì im lặng chấp nhận mọi độ dài như mock cũ):
```
 ❯ server/services/aiGgufEngine.embedCtx.test.ts (3 tests | 2 failed) 132ms
   × ngữ cảnh đủ chứa chunk dài nhất THẬT (1.879 token đo bằng tokenizer thật) và có biên an toàn 14ms
     → expected 1024 to be greater than or equal to 1879
   × KHÔNG throw khi nhúng input dài bằng đúng chunk RAG thật dài nhất (1.879 token) — review round 1 Important 15ms
     → promise rejected "Error: Input is longer than the context s…" instead of resolving

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/services/aiGgufEngine.embedCtx.test.ts > ... > ngữ cảnh đủ chứa chunk dài nhất THẬT ...
AssertionError: expected 1024 to be greater than or equal to 1879

 FAIL  server/services/aiGgufEngine.embedCtx.test.ts > ... > KHÔNG throw khi nhúng input dài bằng đúng chunk RAG thật dài nhất ...
AssertionError: promise rejected "Error: Input is longer than the context s…" instead of resolving
Caused by: Error: Input is longer than the context size that this LlamaContext was created with (1879 > 1024)
 ❯ Object.getEmbeddingFor server/services/aiGgufEngine.embedCtx.test.ts:25:21
 ❯ server/services/aiGgufEngine.ts:2214:48
```
Test dài (test thứ 3) dùng chuỗi giả 1.879 "từ" (tokenize giả đếm theo khoảng trắng, không phụ thuộc nội dung thật trên đĩa) — mô phỏng đúng độ dài token đã đo được, không đọc file `knowledge/chunks.jsonl` thật trong test (giữ test tự chứa, nhanh, không phụ thuộc dữ liệu kho tri thức có thể đổi).

**Sau khi vá (2048)**: `npx vitest run server/services/aiGgufEngine.embedCtx.test.ts` → **3/3 xanh**. Toàn bộ họ `aiGgufEngine.*.test.ts` (7 file, gồm file mới) → **67/67 xanh**, không hồi quy. `tsc --noEmit` chỉ còn lỗi tiền tồn tại `SessionManagement.tsx:195`.

**Đo VRAM thật sau khi đổi 1024→2048** (cùng phương pháp script tạm `_tmp-real-embed-check.mjs`, import thẳng `generateEmbedding()` sản xuất, không boot app; đã xoá sau khi đo, không commit; chạy 2 lần để kiểm tính ổn định):

| Cấu hình | VRAM delta thật (model + context thường 4096 + embedding context) |
|---|---|
| TRƯỚC (`"auto"`) | 7.694 MiB |
| SAU — 1024 (đã bị review bác vì không đủ) | 4.204 MiB |
| **SAU — 2048 (giá trị cuối, đã chọn)** | **4.321-4.324 MiB** (2 lần đo, ổn định) |
| **Giảm so với `"auto"`** | **~3.370-3.373 MiB (~43,8%)** |

So với 1024, 2048 chỉ tốn thêm **~120 MiB** (~2,9%) — vẫn giữ được phần lớn khoản tiết kiệm 45,4%→43,8% (chênh ~1,6 điểm phần trăm) trong khi phủ đúng chunk dài nhất THẬT thay vì chunk ước lượng sai.

**`npm run kb:eval` sau khi đổi**: **`recall@5 = 151/151 = 1.000`** — không đổi (nhắc lại: gate này không đi qua `aiGgufEngine.ts` — xem giải thích ở mục an toàn phía trên — nên không phải bằng chứng recall cho 2048, chỉ xác nhận không hồi quy kho tri thức hiện có). `knowledge/rag-eval-results.json` đổi lại lần nữa (hợp lệ), đã đưa vào commit review vòng 1.

### Minor 2 — GHI NHẬN, KHÔNG SỬA trong task này: khoản "trả tiền hai lần" mới xử lý MỘT NỬA

Task 2 chỉ sửa `embeddingContext` (dòng ~2271). **Context thường vẫn được tạo cho model nhúng** — `loadGgufModel()` (`aiGgufEngine.ts:672-677`) gọi `model.createContext({ contextSize: GGUF_DEFAULT_CTX=4096, sequences: GGUF_SEQUENCES=4, ... })` cho **MỌI** model được nạp qua đường này, kể cả model nhúng chỉ dùng cho `getEmbeddingFor()` chứ không bao giờ `session.prompt()`. Đây là khoản còn tồn, **không thuộc phạm vi Task 2** (Task 2 chỉ giao "Modify: `aiGgufEngine.ts:2235-2241`"), để lại cho đợt sau:

- Số đo thật ở trên (4.321-4.324 MiB) **đã bao gồm** cả context thường 4096 này — nếu đợt sau loại bỏ nó cho model nhúng (ví dụ: bỏ qua `createContext()` khi `purpose==="embed"` và model chỉ từng được dùng cho embedding), VRAM embedding có thể còn giảm thêm đáng kể.
- Task 4 (cộng bảng roster VRAM toàn hệ) cần biết con số 4.321-4.324 MiB là "đã trừ được nửa vấn đề", không phải mức sàn tuyệt đối.

### Mối lo / việc để lại cho task sau (cập nhật sau review vòng 1)

- Biên an toàn 2048/1879 (~9%) là **sát**, không phải rộng rãi — nếu kho tri thức tương lai sinh ra chunk dài hơn (ví dụ bảng markdown lớn hơn), có thể lại vượt trần và throw/skip âm thầm như lần này. Khuyến nghị thật sự triệt để (ngoài phạm vi Đợt 1): chặn cứng `chunkText()` ở `build-knowledge-chunks.mjs` theo đúng `maxChunkChars` đã công bố, VÀ/HOẶC thêm phòng vệ ở tầng `generateEmbedding()`/`ingestKbChunks()` để throw do vượt `contextSize` không bị nuốt âm thầm thành `skipped++` mà log rõ ràng.
- Minor 2 ở trên: context thường 4096 cho model nhúng vẫn chưa bị động tới — còn dư địa tiết kiệm VRAM cho đợt sau.
- Công cụ đo (`bench.mjs`) và cổng an toàn (`kb:eval` → `_gguf-embed.mjs`) vẫn không đi qua `aiGgufEngine.ts` như đã nêu trước review vòng 1 — chưa có gì thay đổi ở điểm này.

---

## §3 Sidecar thị giác — thôi tự lấy 4 khe song song (Task 3)

### ⚠ KẾT QUẢ CHÍNH: giả thuyết Đợt 0 KHÔNG đúng cho build llama-server hiện có — VRAM không giảm

Brief giao việc dựa trên giả thuyết của Đợt 0: mảng `args` (`server/services/llamaVisionSidecar.ts:208-217`) thiếu `-np` ⇒ `llama-server` mặc định `n_parallel=4` ⇒ `LLAMA_VISION_CTX=8192` × 4 khe = 32.768 token KV-cache ⇒ phần lớn của 7.821 MiB đo được ở Đợt 0 là do nhân bốn. Sửa: thêm `-np 1`.

Đã thêm `-np` đúng như brief, test cấu trúc xanh, **nhưng đo VRAM thật trước/sau bằng cách tự khởi `llama-server.exe` với đúng tham số mã sản xuất cho thấy giả thuyết đó SAI cho build hiện có trên máy này** (`D:/SOURCES/16.AI/llama-cuda/llama-server.exe`, build ngày 26/06/2026). Log khởi động (cả hai phía, trước và sau khi vá) đều in:

```
llama_server: n_parallel is set to auto, using n_parallel = 4 and kv_unified = true
```

`kv_unified = true` **ngay cả ở `n_parallel=4` mặc định** — nghĩa là build này đã dùng một khối KV-cache DÙNG CHUNG cỡ đúng bằng `-c` (8192 token), không nhân theo số khe song song. Dòng `n_slots = 4` / mỗi khe log `n_ctx = 8192` chỉ là cửa sổ logic mỗi chuỗi được phép dùng TRONG khối cache chung, không phải 4 khối cache riêng biệt 8192 mỗi khối. Đây là hành vi mặc định tương đối mới của llama.cpp (cùng build có tính năng "prompt cache" từ PR #16391 và `-fit` auto-fit tham số — một build khá gần đây), có vẻ được thiết kế **chính để tránh** đúng kiểu lãng phí mà Đợt 0 giả định.

### Đo TRƯỚC (mã chưa vá, không có `-np`)

Khởi `llama-server.exe` trực tiếp bằng đúng tham số mã sản xuất đọc từ `llamaVisionSidecar.ts:208-217` lúc đó (`-m <model> --mmproj <mmproj> --host 127.0.0.1 --port 8081 -ngl 999 -c 8192 --jinja`), đo `nvidia-smi --query-gpu=memory.used`, chạy **2 lần lặp lại** để kiểm nhiễu đo:

| Lượt | Baseline (MiB) | Sau khi ready (MiB) | Delta (MiB) |
|---|---|---|---|
| Lượt 1 | 1.196 | 9.026 | **7.830** |
| Lượt 2 | 1.197 | 9.023 | **7.826** |

Khớp rất sát mốc Đợt 0 (**7.821 MiB**, lệch ~0,1%) — xác nhận phương pháp đo đúng và đúng cấu hình.

### Sửa (TDD)

Test cấu trúc mới: `server/services/llamaVisionSidecar.args.test.ts` (đúng nội dung mã mẫu trong brief — đọc trực tiếp `llamaVisionSidecar.ts` bằng `readFileSync`, khẳng định `"-np"` có mặt trong nguồn cùng các cờ bắt buộc khác). Lý do không mock `spawn`: mảng `args` nằm trong closure của `startPromise`, không xuất khẩu — đây là **test cấu trúc có chủ ý**, không phải test hành vi.

**Output ĐỎ** (trước khi vá):
```
 ❯ server/services/llamaVisionSidecar.args.test.ts (2 tests | 1 failed) 15ms
   × llamaVisionSidecar — tham số spawn > truyền -np để llama-server không tự lấy 4 khe song song
     → expected '/**\n * WS-G2 — Local llama.cpp multi…' to contain '"-np"'

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  server/services/llamaVisionSidecar.args.test.ts > llamaVisionSidecar — tham số spawn > truyền -np để llama-server không tự lấy 4 khe song song
AssertionError: expected '/**\n * WS-G2 — Local llama.cpp multi…' to contain '"-np"'

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```
(Test thứ hai — giữ nguyên các cờ bắt buộc — đã xanh ngay từ đầu, đúng như kỳ vọng vì các cờ đó chưa hề bị đụng tới.)

Sửa: thêm hằng `VISION_PARALLEL` (đọc `LLAMA_VISION_PARALLEL`, mặc định `"1"`) cạnh `VISION_CTX`, rồi thêm `"-np", String(VISION_PARALLEL)` vào mảng `args` sau `-c`. **Lệch so với brief**: comment mẫu trong brief khẳng định chắc nịch giả thuyết "4 khe × ctx 8192 = 32.768 token" là nguyên nhân của 7.821 MiB — sau khi đo thật (xem trên), đã **viết lại comment** trong mã để không để lại một khẳng định sai trong codebase cho người đọc sau: comment hiện tại nêu rõ giả thuyết ban đầu, kết quả đo thực tế phủ định nó, giải thích `kv_unified=true`, và ghi rõ lý do vẫn giữ `-np=1` (dọn theo logic dù không tiết kiệm VRAM đo được + phòng hờ build tương lai đổi mặc định).

Sau khi vá: `npx vitest run server/services/llamaVisionSidecar.args.test.ts` → **2/2 xanh**. `server/services/llamaVisionSidecar.test.ts` (bộ test hành vi có sẵn, mock `spawn`) → **11/11 xanh**, không hồi quy — log spawn trong test giờ hiện `... -c 8192 -np 1 --jinja`. `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → chỉ còn lỗi tiền tồn tại `client/src/pages/SessionManagement.tsx(195,64)`.

⚠ **Giới hạn của test cấu trúc**: test này chỉ chứng minh cờ `-np` có mặt trong mã nguồn. Nó **không** và **không thể** chứng minh VRAM giảm — bằng chứng VRAM chỉ đến từ phép đo `nvidia-smi` trực tiếp trên `llama-server.exe` thật, ở trên và dưới đây. Test xanh ⇏ tiết kiệm VRAM (và trong trường hợp cụ thể này, số đo thật cho thấy **không có** khoản tiết kiệm nào).

### Đo SAU (mã đã vá, có `-np 1`)

Cùng phương pháp, cùng tham số mã sản xuất (giờ có thêm `-np 1`):

| | Baseline (MiB) | Sau khi ready (MiB) | Delta (MiB) |
|---|---|---|---|
| SAU (`-np 1`) | 1.200 | 9.027 | **7.827** |

| So sánh | Delta (MiB) |
|---|---|
| TRƯỚC (trung bình 2 lượt) | 7.828 |
| SAU (`-np 1`) | 7.827 |
| **Giảm** | **~1 MiB (~0,01%)** — nằm trong nhiễu đo, **không phải khoản tiết kiệm thật** |

**Kết luận trung thực: `-np 1` không giảm VRAM sidecar thị giác đo được trên máy/build này.** Mốc Đợt 0 (7.821 MiB) và các mốc đo lại ở Task 3 (7.826–7.830 MiB) phản ánh đúng chi phí cố định của model (Qwen3-VL-8B Q4_K_XL, ~5,15 GB trên đĩa) + mmproj (F16, log báo `[mtmd] estimated worst-case memory usage of mmproj is 1502.33 MiB` — khớp con số "buffer mtmd 1.502 MiB" trong brief) + MỘT khối KV-cache dùng chung cỡ `-c`=8192 + buffer tính toán — không phải chi phí nhân bốn như giả thuyết.

Sau mỗi lượt đo (cả 3 lượt: 2 TRƯỚC + 1 SAU): đã `taskkill //F //IM llama-server.exe`, chờ, xác nhận `nvidia-smi` về **1.188–1.199 MiB** (khớp baseline máy ~1.150–1.200 MiB nêu trong brief) và `tasklist` xác nhận **không còn `llama-server.exe` treo**. Ghi chú kỹ thuật: PID trả về từ `$!` trong git-bash **không khớp** PID Windows thật của tiến trình con (`llama-server.exe` chạy qua MSYS wrapper) — `taskkill //F //PID <PID của $!>` báo "process not found" dù tiến trình vẫn sống; phải kill theo tên (`taskkill //F //IM llama-server.exe`) mới tắt được. Đã tự kiểm chứng bằng `tasklist` trước/sau mỗi lần.

### Lượt suy luận THẬT trên ảnh THẬT

Dùng `test-pcb-image.jpg` có sẵn trong repo (ảnh cận cảnh bo mạch PCB xanh với nhiều IC, tinh thể thạch anh, tụ điện — đã tự xem ảnh để xác nhận nội dung trước khi đánh giá câu trả lời). Gọi thẳng `POST /v1/chat/completions` (đúng định dạng `describeImageViaSidecar()` dùng: `image_url` data-URI base64) với prompt "Describe this image in one sentence." — chạy ở **cả hai phía** (trước và sau khi vá) để so sánh:

- **TRƯỚC** (`n_parallel=4` mặc định): *"A close-up view of a green printed circuit board (PCB) densely populated with various electronic components, including integrated circuits, resistors, and capacitors, showcasing the intricate inner workings of modern electronics."*
- **SAU** (`-np 1`): **câu trả lời giống hệt từng ký tự** với TRƯỚC.

Cả hai đều mô tả đúng nội dung ảnh (PCB xanh, linh kiện điện tử, IC) — không có suy giảm chất lượng. `usage.prompt_tokens=264`, `completion_tokens=42` giống nhau ở cả hai lượt; `timings` (tốc độ sinh) dao động nhẹ (178 vs 131 token/s) — bình thường, không liên quan tới `-np` (do biến thiên tải hệ thống giữa hai lần chạy, không phải do đổi tham số).

### ⚠ Phát hiện thêm về điểm mù (nối tiếp Task 2)

Đây **không phải** một điểm mù của công cụ đo — phép đo Task 3 khởi thẳng `llama-server.exe` thật với đúng tham số mã sản xuất, không qua lớp trung gian nào có thể che giấu sai lệch. Thay vào đó, đây là **điểm mù trong chuỗi suy luận nhân quả của chính Đợt 0**: giả thuyết "`llama-server` mặc định `n_parallel=4` ⇒ nhân bốn KV-cache" đã được chấp nhận làm căn cứ giao việc mà **chưa được xác minh trực tiếp trên build `llama-server.exe` thật đang cài trên máy** — build đó tự động chọn `kv_unified=true` ngay cả ở `n_parallel=4`, vô hiệu hoá hoàn toàn phép nhân giả định. Nếu Đợt 0 đã đọc log khởi động của chính sidecar (dòng `kv_unified = true` xuất hiện ngay ở giây đầu tiên) thay vì suy luận từ tài liệu/hiểu biết chung về `llama.cpp`, giả thuyết sai này đã có thể được phát hiện sớm hơn. Bài học cho các đợt sau: với hành vi phụ thuộc **phiên bản binary bên thứ ba** (ở đây là `llama-server.exe`, không phải mã TypeScript của repo), luôn xác minh bằng log runtime thật của đúng binary đang cài, không suy luận từ hành vi "mặc định" chung chung của dự án thượng nguồn.

### Mối lo

- **Task 3 không giành lại VRAM nào đo được** (~0,01%, trong nhiễu đo) — khác với kỳ vọng ban đầu của brief. Task 4 (bảng roster VRAM toàn hệ) **không nên cộng khoản tiết kiệm nào từ Task 3** — sidecar thị giác vẫn chiếm ~7.821-7.830 MiB khi hoạt động, y hệt trước khi vá.
- Thay đổi vẫn được giữ lại (`-np 1`) vì vô hại, dọn dẹp về mặt logic (hệ chỉ gửi 1 ảnh/lượt, không cần 4 khe), và là phòng vệ rẻ tiền cho trường hợp một build `llama-server` tương lai đổi mặc định `kv_unified` — nhưng **không phải là khoản "giành lại VRAM"** như tên Đợt 1 kỳ vọng.
- Nếu Đợt 1/Task 4 cần thật sự giảm 7,8 GB của sidecar thị giác, hướng khả thi duy nhất còn lại (ngoài phạm vi Task 3, cần bàn riêng) là: giảm `LLAMA_VISION_CTX` (hiện 8192, có thể thử ~4096 nếu prompt thực tế không cần cửa sổ lớn), đổi sang bản quant nhỏ hơn của model/mmproj, hoặc unload sidecar tích cực hơn khi idle (`IDLE_TIMEOUT_MS`, đã có sẵn cơ chế, không thuộc Task 3).
- Không tìm thấy vấn đề tương tự "công cụ đo tự chứa, không import mã sản xuất" như Task 2 (`bench.mjs`/`_gguf-embed.mjs`) — phép đo Task 3 không dùng công cụ trung gian nào, đo trực tiếp trên tiến trình `llama-server.exe` thật.

---

## §4 Tổng hợp — nghiệm thu app thật và cộng lại bảng roster (Task 4)

### ⚠ KẾT QUẢ CHÍNH 1: app VẪN không nạp được model 30B — nhưng KHÔNG còn vì race

Nghiệm thu bằng app thật (`npm run dev`, **3 lượt boot**, đợi qua cả hai mốc warm 2000ms và 3000ms):

| Chỉ số | Kỳ vọng của brief | THỰC TẾ (cả 3 lượt) |
|---|---|---|
| `cudaMalloc failed` | **0** | **1 mỗi lượt boot** ❌ |
| Số lần nạp model mặc định | **1** (không phải 2) | **1** ✅ |

**Hai kết quả này phải đọc CÙNG NHAU.** Đợt 0 thấy 45/45 lượt lỗi vì **hai** lượt nạp song song. Nay chỉ còn **một** lượt nạp — nghĩa là **khoá in-flight của Task 1 hoạt động đúng trong app thật** — nhưng chính lượt nạp duy nhất đó vẫn lỗi:

```
[aiGgufEngine] Loading model: D:\SOURCES\16.AI\Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf
[node-llama-cpp] ggml_backend_cuda_buffer_type_alloc_buffer: allocating 16698.37 MiB on device 0: cudaMalloc failed: out of memory
[node-llama-cpp] alloc_tensor_range: failed to allocate CUDA0 buffer of size 17509509120
[aiGgufEngine] deep model warm FAILED for "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL" — ...
```

Hai đường warm (`aiLocalKnowledgeService.ts:2431` mốc 2000ms · `aiGgufEngine.initDeepModelWarmup` mốc 3000ms) **đều gọi cùng `GGUF_DEFAULT_MODEL`** — đúng cặp gây 45/45 lỗi ở Đợt 0. Log chỉ còn **một** dòng `Loading model:` cho model 30B ⇒ khoá đã gộp hai lượt thành một.

⇒ **Có một nguyên nhân THỨ BA, khác hẳn race, chưa từng được biết tới.** Ba phép đo phân biệt sau đây khoanh vùng nó:

| # | Phép thử | Kết quả |
|---|---|---|
| 1 | `bench.mjs --models deep` (tiến trình gọn, cùng máy, cùng lúc) | **NẠP ĐƯỢC**, 19,3 s, không lỗi |
| 2 | Script tạm gọi **thẳng `warmModel()` của mã sản xuất** (`aiGgufEngine.ts`), tiến trình gọn, không boot Express | **NẠP ĐƯỢC**, 18,1 s, delta **19.094 MiB** |
| 3 | App thật, warm hoãn tới **120 giây** (`GGUF_WARM_DELAY_MS=120000`) để loại trừ tranh chấp lúc boot | **VẪN LỖI**, y hệt |

**Kết luận có bằng chứng:**
- **Đường nạp model của mã sản xuất KHÔNG hỏng** (phép thử 2 — cùng hàm, cùng `getLlama({gpu:"auto"})`, cùng `loadModel({gpuLayers:"max"})`).
- **Không phải tranh chấp thời điểm boot** (phép thử 3 — sau 120 s, app đã lắng, vẫn lỗi).
- **Không phải hết VRAM thiết bị.** Lấy mẫu `nvidia-smi` mỗi giây suốt lượt boot: VRAM **chưa bao giờ vượt 1.208 MiB** trước lúc lỗi, và ở lượt hoãn-120s app chỉ giữ **5.496 MiB** — nghĩa là còn **~27 GB trống** khi một lệnh `cudaMalloc` 16.698 MiB bị từ chối.
- ⇒ Nguyên nhân nằm ở **trạng thái của chính tiến trình app** (một giới hạn cấp-tiến-trình, không phải cấp-thiết-bị). **Chưa truy được nguyên nhân cụ thể — cần một đợt riêng.** Không suy đoán thêm ở đây; đúng bài học Task 3 đã trả giá.

### ✅ Đã đóng được một khoản nợ của Task 1 — bằng bằng chứng sống

Task 1 để lại Minor: *"chưa có test cho nhánh nạp THẤT BẠI → `finally` xoá `inFlightLoads` → lượt sau tự thử lại"*. Lượt boot thứ 3 chứng minh điều đó **trên app thật**: lượt nạp #1 (mốc 2000ms) thất bại → lượt nạp #2 (mốc 120 s) **chạy một lượt nạp MỚI** (dòng log `Loading model:` xuất hiện lần thứ hai), chứ không nhận lại promise lỗi đã ghi nhớ. Khoá được giải phóng đúng. **Minor này đóng.**

### ⚠ KẾT QUẢ CHÍNH 2: nhánh `catch` "âm thầm tụt tier" KHÔNG chạy — và đó là tin XẤU hơn

Bốn dòng cảnh báo mà spec hồ sơ §4 yêu cầu canh, `grep -nE "evicted LRU model|no idle model to evict|At capacity|gpuLayers.*auto"` trên **cả 3 lượt boot**:

| Dòng log | Xuất hiện? |
|---|---|
| `evicted LRU model "<id>" before loading` | **không** |
| `no idle model to evict — deferring/allowing load with OOM risk` | **không** |
| `At capacity (4/4)` | **không** |
| cảnh báo nhánh `catch` nạp lại `gpuLayers:"auto"` | **không** |

Dòng thứ tư vắng mặt là điều đáng chú ý nhất. Mã có sẵn nhánh phục hồi (`aiGgufEngine.ts:648-681`): gặp OOM thì đuổi hết model rảnh rồi **nạp lại với `gpuLayers:"auto"`** (offload một phần, phần còn lại chạy CPU). Nhánh này **không chạy lần nào** trong 3 lượt boot.

Đọc mã cho thấy lý do khả dĩ: `isOom` kiểm tra `err.message` của JS có chứa `"out of memory"`/`"cudamalloc"`/`"failed to allocate"`/`"unable to allocate"` không — nhưng những chữ đó nằm ở **stderr của lớp C++ node-llama-cpp**, không nằm trong `err.message` mà JS nhận được. ⚠ **Đây là suy luận từ mã cộng với sự VẮNG MẶT của dòng log — chưa bắt được nguyên văn `err.message` để xác nhận.** Cần một phép đo riêng mới kết luận chắc.

**Hệ quả thực tế thì đã chắc, không cần suy luận:** app **không** rơi xuống tier chậm ~2,9 tok/s như spec cảnh báo — nó **không có model sinh chữ sâu nào cả**. Về mặt vận hành, đây **tệ hơn** kịch bản "âm thầm chậm" mà spec hồ sơ §4 lo. Bù lại, nó **hỏng ồn ào** (`deep model warm FAILED`) chứ không im lặng, nên vẫn phát hiện được — nhưng chỉ khi có người đọc log.

### ⚠ KẾT QUẢ CHÍNH 3: bảng roster Đợt 0 sai theo HAI hướng, cộng lại thiếu ~3.400 MiB

Đây là điểm quan trọng nhất của Task 4. Bảng số đo nền của Đợt 0 (spec chiến lược §2) **đánh giá thấp chi phí thật ở hai chỗ độc lập**, cả hai đều do `scripts/ai-bench/bench.mjs` **không đi qua mã sản xuất**:

**(a) Model nhúng — thiếu 2.030 MiB.** Đợt 0 ghi `embed = 5.664 MiB`. Nhưng `bench.mjs:321` tự gọi `createEmbeddingContext({contextSize:"auto"})` **hard-code, không import `aiGgufEngine.ts`**, và **không** gọi `model.createContext()` — trong khi `loadGgufModel()` sản xuất tạo **cả hai** context. Chi phí THẬT trước khi sửa: **7.694 MiB** (Task 2, §2).

**(b) MỌI model text GGUF — thiếu ~1.350 MiB mỗi model.** Phát hiện MỚI ở Task 4. `bench.mjs:249` tạo context bằng `model.createContext({contextSize, batchSize:512, flashAttention:true})` — **không truyền `sequences`** (mặc định **1**) và `contextSize` suy từ độ dài prefill của bài đo. Đường sản xuất (`aiGgufEngine.ts:684-689`) tạo `contextSize = GGUF_DEFAULT_CTX = 4096` với `sequences = GGUF_SEQUENCES = 4`. Đo trực tiếp qua `warmModel()` sản xuất:

| Model | Đợt 0 (`bench.mjs`) | Đường SẢN XUẤT (Task 4) | Thiếu |
|---|---|---|---|
| Qwen3-30B-A3B-Instruct | 17.750 | **19.094** | **+1.344** |
| Qwen3-Coder-30B-A3B | 17.698 | **19.077** | **+1.379** |
| Qwen3-4B-Instruct | 3.464 | *(chưa đo lại)* | *(chưa biết)* |
| Qwen2.5-Coder-1.5B (FIM) | 1.774 | *(chưa đo lại)* | *(chưa biết)* |

⇒ Đây là **lần thứ BA** harness đo có điểm mù đúng chỗ quan trọng (Đợt 0: `bench.mjs` không biết "vision" ⇒ sót 7,8 GB · Task 2: `bench.mjs`/`_gguf-embed.mjs` hard-code `"auto"` ⇒ sót 2,0 GB · Task 4: `bench.mjs` tạo context 1 sequence ⇒ sót ~1,35 GB **mỗi model text**).

**Xác nhận độc lập trong app SỐNG:** lấy mẫu `nvidia-smi` lúc app nạp model nhúng ⇒ 5.520 − 1.203 = **4.317 MiB**, khớp số 4.321 MiB của Task 2 (lệch 0,1%). Đây là lần đầu con số Task 2 được xác nhận **trong tiến trình app thật**, không phải script đo.

### Bảng số đo nền — cộng lại

| Thành phần | Đợt 0 công bố | TRƯỚC Đợt 1 (thật, đường sản xuất) | SAU Đợt 1 | Nguồn |
|---|---|---|---|---|
| Nền hệ điều hành | ~1.200 | ~1.200 (đo 1.194-1.211) | ~1.200 | Task 4 |
| Qwen3-Coder-30B-A3B | 17.698 | **19.077** | **19.077** (Đợt 1 không đụng) | Task 4 |
| Qwen3-30B-A3B-Instruct | 17.750 | **19.094** | **19.094** (Đợt 1 không đụng) | Task 4 |
| Qwen3-4B-Instruct | 3.464 | *chưa đo lại* (≥3.464) | *chưa đo lại* | Đợt 0 |
| Qwen2.5-Coder-1.5B (FIM) | 1.774 | *chưa đo lại* (≥1.774) | *chưa đo lại* | Đợt 0 |
| **Qwen3-Embedding-0.6B** | 5.664 ❌ **sai** | **7.694** | **4.321** | Task 2 |
| **Vision sidecar** | 7.821 | 7.826-7.830 | **7.827 — KHÔNG giảm** | Task 3 |
| **Trần thiết bị** | 32.607 | 32.607 | 32.607 | `nvidia-smi` |

**Tổng giành lại của cả Đợt 1: 3.373 MiB (~3,3 GiB), TOÀN BỘ đến từ model nhúng.**

| Nguồn | Kế hoạch kỳ vọng | Thực tế |
|---|---|---|
| Embedding (`"auto"` → `EMBED_CTX=2048`) | ~4,5 GB | **7.694 → 4.321 = giành lại 3.373 MiB** |
| Sidecar (`-np 1`) | ~1,9 GB | **~0 — tiền đề của kế hoạch SAI** (`kv_unified=true`) |
| **Tổng** | **~6,4 GB** | **~3,37 GB — bằng khoảng MỘT NỬA kỳ vọng** |

⚠ Con số 4.321 MiB **đã bao gồm** context thường (4096 × 4 sequences) mà `loadGgufModel()` vẫn tạo cho model nhúng dù nó không bao giờ sinh chữ (`aiGgufEngine.ts:684-689`, Minor 2 của Task 2). Task 2 mới xử lý **một nửa** khoản "trả tiền hai lần" ⇒ **còn dư địa cho đợt sau**, chưa phải mức sàn.

### Bảng bốn case — cộng lại bằng số thật

Trần **32.607 MiB**. Mọi số là **lúc nghỉ**; cột "dưới tải" cộng thêm **+470-940 MiB mỗi model GGUF đang sinh** (mốc Đợt 0 §3) và **+117 MiB** cho sidecar thị giác đang suy luận (đo ở review Task 3, 4 lượt ảnh đồng thời).

| Case | TRƯỚC Đợt 1 (thật) | SAU Đợt 1 | Đổi kết luận? |
|---|---|---|---|
| **1 — một model xuyên suốt**, lúc nghỉ | 27.971 (85,8%) | **24.598 (75,4%)** | không đổi — vốn đã vừa, nay rộng hơn |
| **1 — khi vision thức** | 35.792 (**109,8% ❌**) | **32.419 (99,4%)** | ★ **ĐỔI MỘT NỬA** — hết "không thể tồn tại", nhưng **dưới tải 33.476 = 102,7% VẪN VƯỢT TRẦN** |
| **2 — đồng thời đủ bộ** | 47.065 (**144,3% ❌**) | **43.692 (134,0% ❌)** | **KHÔNG ĐỔI — vẫn KHÔNG KHẢ THI** |
| **3 — thị giác thường trú** | 35.792 (**109,8% ❌**) | **32.419 (99,4%)** | ★ **ĐỔI MỘT NỬA** — như Case 1 vision thức |
| **4 — hybrid `balanced`**, lúc nghỉ | 31.435 (96,4%) | **28.062 (86,1%)** | ★ **ĐỔI** — từ "sát trần, không còn chỗ sinh" thành "có biên thật" (2 model cùng sinh = 29.942, 91,8%) |
| **4 — `balanced` + vision thức** | 39.256 (**120,4% ❌**) | **35.883 (110,0% ❌)** | **KHÔNG ĐỔI — vẫn vượt trần** |

Thành phần từng case (cột SAU Đợt 1):
- Case 1 / 3: `1.200 + 19.077 (Coder-30B) + 4.321 (embed) = 24.598`; `+ 7.821 (vision) = 32.419`.
- Case 2 (mức **tối thiểu**, chỉ 2 model 30B + embed): `1.200 + 19.077 + 19.094 + 4.321 = 43.692`. Đủ bộ thật (thêm 4B + FIM + vision) = **56.751 (174,0%)**.
- Case 4: `1.200 + 19.077 + 3.464 (4B, số Đợt 0 chưa đo lại ⇒ đây là SÀN) + 4.321 = 28.062`; `+ 7.821 = 35.883`.

⚠ **Case 4 dùng số 4B của Đợt 0 (`bench.mjs`) nên là số SÀN.** Nếu model 4B cũng đắt thêm ~1.350 MiB như hai model 30B thì Case 4 lúc nghỉ ≈ **29.412 (90,2%)** — **ước lượng, CHƯA ĐO**. Kết luận "có biên thật" vẫn đứng ở cả hai mức, nhưng biên hẹp hơn nhiều so với con số 86,1%.

### Kết luận nào ĐỔI, kết luận nào KHÔNG — nói thẳng

**ĐỔI:**
1. **Case 4 `balanced` là case được lợi rõ nhất.** Từ 96,4% (sát trần, không đủ chỗ cho buffer sinh) xuống 86,1% — nay chịu được hai model cùng sinh (91,8%). Đây là khoản giành lại **có giá trị vận hành thật**.
2. **Case 1/3 khi vision thức thôi "không thể tồn tại"** — 109,8% ❌ xuống 99,4%. Nhưng xem mục KHÔNG ĐỔI #2.
3. **Bảng roster Đợt 0 phải bị coi là KHÔNG ĐÁNG TIN cho tới khi đo lại bằng đường sản xuất.** Đợt 0 công bố Case 1 + vision = 32.383 MiB (99,3%, "sát trần"). Số thật lúc đó là **35.792 MiB (109,8%)** — **một cấu hình đã VƯỢT TRẦN được công bố là vừa.** Sai lệch 3.409 MiB.

**KHÔNG ĐỔI:**
1. **Case 2 vẫn KHÔNG KHẢ THI — và không phải chuyện gần.** Chỉ riêng nền + hai model 30B đã là `1.200 + 19.077 + 19.094 = 39.371 MiB`, **vượt trần 6.764 MiB khi embedding bằng KHÔNG**. Khoản giành lại 3.373 MiB **không tới một nửa** chỗ còn thiếu. Câu của spec §3 giữ nguyên: *trên 32,6 GB, KHÔNG cấu hình nào cho phép đủ bộ cùng lúc.*
2. **Case 1/3 vẫn không chịu được tải khi vision thức.** 32.419 + 940 (30B sinh) + 117 (vision sinh) = **33.476 = 102,7%**, vượt trần. Lúc nghỉ thì vừa, hễ có người dùng thật là vỡ. **Đừng đọc 99,4% là "đã giải quyết".**
3. **Hồ sơ `balanced` vẫn KHÔNG được để vision thức** (110,0%). Đợt 1 không đổi điều này.
4. **Dự đoán của spec chiến lược §5 SAI.** Spec viết: *"Nếu giải phóng được 6,4 GB thì Case 3 từ 99,3% xuống ~79%"*. Thực tế giải phóng **3,37 GB** (một nửa), và Case 3 xuống **99,4%** — **không phải 79%**, mà gần như đúng bằng con số 99,3% cũ, vì con số 99,3% cũ vốn đã sai (thật là 109,8%). Hai sai số gần như triệt tiêu nhau, che mất cả hai.
5. **Spec hồ sơ nội bộ §5 cũng SAI**: dự đoán hồ sơ `internal-code` "từ 75,3% xuống ~61%, đỉnh vision từ 99,3% xuống ~85%". Thực tế: **75,4%** và **99,4%**.

### Mối lo

1. **Điều kiện 1 của spec hồ sơ nội bộ CHƯA ĐẠT.** Spec ghi rõ: không bật hồ sơ khi app chưa nạp nổi 30B. Race đã vá, nhưng **app vẫn không nạp được** vì nguyên nhân thứ ba. **Chưa được bật hồ sơ `internal-code`.**
2. **Nguyên nhân thứ ba chưa truy được** — đã khoanh vùng ("tiến trình app, không phải thiết bị, không phải thời điểm, không phải mã nạp"), chưa có gốc rễ. Cần một đợt riêng, và nó **chặn toàn bộ bước D** của lộ trình.
3. **`bench.mjs` đã sai ba lần liên tiếp ở đúng chỗ quyết định.** Mọi số Đợt 0 chưa được đo lại bằng đường sản xuất (4B, FIM) phải coi là **sàn, không phải giá trị**. Khuyến nghị mạnh: sửa `bench.mjs` gọi qua mã sản xuất, hoặc bỏ nó và đo bằng `warmModel()` — nếu không, đợt sau lại quyết trên số sai.
4. **Nhánh `catch` `gpuLayers:"auto"` có thể là mã chết.** Nếu đúng như suy luận (`err.message` không mang chữ OOM), thì cơ chế phục hồi mà spec hồ sơ §4 coi là "nguy hiểm nhất vì âm thầm" thực ra **chưa từng chạy** — cần một phép đo riêng để xác nhận, và nếu đúng thì bốn dòng log phải canh của spec chỉ còn ba.
5. **Khoản "trả tiền hai lần" mới trả một nửa**: context thường 4096 × 4 sequences vẫn được tạo cho model nhúng. Còn dư địa, chưa đo được bao nhiêu.
6. **Chưa nghiệm thu chức năng qua giao diện.** Task 4 chỉ đo VRAM và đọc log; không mở trình duyệt, không thử một lượt hỏi-đáp thật. App **không có model sinh chữ sâu** nên lượt thử đó chắc chắn hỏng — nhưng điều đó **chưa được kiểm chứng**, chỉ suy ra từ log.
