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

### Mối lo / việc để lại cho task sau

- **Công cụ đo trong brief (`bench.mjs`) và cổng an toàn (`kb:eval` → `_gguf-embed.mjs`) đều không đi qua `aiGgufEngine.ts`** — bất kỳ thay đổi tương lai nào ở `EMBED_CTX`/`getEmbeddingContext()` sẽ **không** được hai công cụ này phát hiện. Task 4 (roster VRAM) nên dùng số thật (4.204 MiB / giảm 45,4%) thay vì số `bench.mjs` báo (5.618 MiB / gần như không đổi).
- `GGUF_EMBED_CTX` là biến môi trường mới, chưa có trong `.env` hiện tại của máy này (không sửa `.env` theo đúng ràng buộc của task) — mặc định `1024` trong mã đã đủ dùng, không bắt buộc set.
