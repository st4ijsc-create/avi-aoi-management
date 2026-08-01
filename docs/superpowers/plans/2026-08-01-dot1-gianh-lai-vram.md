# Đợt 1 — Giành lại VRAM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm máy chủ nạp được model 30B trở lại, và giành lại ~6 GB VRAM đang bị buffer mặc định chiếm — đủ để bảng đánh đổi roster của Đợt 0 phải viết lại.

**Architecture:** Ba sửa nhỏ, độc lập, mỗi cái đo được trước/sau bằng harness đã có (`scripts/ai-bench/bench.mjs`, đường race-free). (1) Khoá in-flight cho `loadGgufModel()` — bug làm app **không nạp nổi 30B mọi lần boot**. (2) Embedding đang cấp `contextSize: "auto"` (toàn bộ cửa sổ model) cho chunk tối đa ~600 token. (3) Sidecar thị giác không truyền `-np` nên `llama-server` tự lấy 4 khe song song.

**Tech Stack:** node-llama-cpp (GGUF) · llama-server (tiến trình riêng) · TypeScript · vitest · nvidia-smi

**Spec:** `docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md` §1.2 và §5 bước B+C · `docs/superpowers/specs/2026-08-01-ai-local-hybrid-internal-code-profile-design.md` §3 điều kiện 1
**Số đo nền:** `docs/superpowers/reports/2026-08-01-do0-roster-survey.md` (Đợt 0, `b0f2c350`)

## Global Constraints

- **Đợt này CÓ sửa mã sản xuất** (khác Đợt 0 chỉ-đo). ⇒ **TDD: test đỏ trước → chạy thấy đỏ → sửa tối thiểu → chạy thấy xanh.** Không bao giờ làm yếu assertion để test qua.
- **Mỗi thay đổi phải có số VRAM TRƯỚC và SAU**, đo bằng `node scripts/ai-bench/bench.mjs`. Không có số thì không được commit.
- **Cổng an toàn không được vỡ**: `npm run kb:eval` phải giữ **`recall@5 = 151/151`**. Đây là mốc Đợt 0 để lại; tụt là **dừng ngay, không đi tiếp**.
- ⚠ **`.env` KHÔNG được git track** ⇒ `git checkout -- .env` **lỗi im lặng**. Muốn hoàn nguyên phải `cp .env .env.dot1-backup` **trước khi sửa**, `cp` lại + `diff` sau, `rm` backup.
- ⚠ **`git worktree add` TREO trên repo này** (do `uploads/inspections` track hàng chục nghìn file). Đừng dùng. Đừng `git stash` trần.
- **KHÔNG `git add -A` / `git add -u`.** Cây có ~107 file việc dở của người khác (`knowledge/*`, `tools/machine-simulator/*`). Chỉ `git add` file bạn sửa, liệt kê tên.
- Sau mỗi lượt đo: **xác nhận VRAM về baseline (~1.200 MiB), không tiến trình `node.exe`/`llama-server.exe` treo.**
- ⚠ **ĐỪNG khởi động app** cho tới Task 4 — trước đó nó vẫn còn race (Task 1 vá xong mới boot được). Dùng `bench.mjs` hoặc script import thẳng module.
- Kiểm kiểu: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`. Lỗi **tiền tồn tại, không phải của bạn**: `client/src/pages/SessionManagement.tsx:195`.
- Test và comment viết **tiếng Việt**. **Không push.**

## Sự thật đã đo (Đợt 0) — dùng làm mốc

| Thành phần | VRAM delta (MiB) | Ghi chú |
|---|---|---|
| Qwen3-Coder-30B-A3B | 17.698 | |
| **Qwen3-Embedding-0.6B** | **5.664** | file chỉ 1,2 GB ⇒ **~4,5 GB là buffer** |
| Qwen2.5-Coder-1.5B (FIM) | 1.774 | |
| Qwen3-4B | 3.464 | |
| **Vision sidecar** (tiến trình riêng) | **7.821** | đo trực tiếp |
| Trần thiết bị | 32.607 | |

**Cấu hình liên quan:** `GGUF_DEFAULT_CTX=4096` · `GGUF_MAX_CTX=32768` · `GGUF_SEQUENCES` mặc định 4 · `LLAMA_VISION_CTX=8192` · `LLAMA_VISION_GPU_LAYERS=999`
**Chunk RAG dài nhất:** `maxChunkChars = 1800` ⇒ **~600 token**.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `server/services/aiGgufEngine.ts:593` (`loadGgufModel`) | **Sửa** — khoá in-flight chống race double-warm | 1 |
| `server/services/aiGgufEngine.inflight.test.ts` (**mới**) | Test: hai lượt nạp đồng thời cùng model ⇒ một lần nạp | 1 |
| `server/services/aiGgufEngine.ts:2235-2241` (`getEmbeddingContext`) | **Sửa** — `contextSize: "auto"` → giá trị nhỏ tường minh | 2 |
| `server/services/aiGgufEngine.embedCtx.test.ts` (**mới**) | Test: context nhúng dùng ctx nhỏ, không "auto" | 2 |
| `server/services/llamaVisionSidecar.ts:208-217` (mảng `args`) | **Sửa** — thêm `-np` | 3 |
| `server/services/llamaVisionSidecar.args.test.ts` (**mới**) | Test: mảng args chứa `-np` | 3 |
| `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md` (**mới**) | Báo cáo đo trước/sau | 1-4 |

---

## Task 1: Khoá in-flight — app nạp được model 30B trở lại

**Files:**
- Modify: `server/services/aiGgufEngine.ts` (hàm `loadGgufModel`, bắt đầu dòng 593)
- Test: `server/services/aiGgufEngine.inflight.test.ts` (**mới**)
- Create: `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md`

**Interfaces:**
- Produces: `loadGgufModel(config)` nay **an toàn khi gọi đồng thời** — hai lượt gọi cùng `modelId` chỉ nạp **một** lần. Task 4 dựa vào đây để boot app thật.

**Bối cảnh — vì sao task này đứng đầu:** Đợt 0 đo được **45/45 lượt nạp 30B thất bại** qua đường boot app, tái hiện **100% mọi lần khởi động**. Nguyên nhân: hai nơi độc lập cùng gọi `warmModel(GGUF_DEFAULT_MODEL)` mà `loadGgufModel()` **không có khoá**:
- `aiGgufEngine.ts:1038` (`warmModel`) ← `server/_core/backgroundJobs.ts:126-127`, delay 3000ms
- `aiLocalKnowledgeService.ts:2392-2418` ← `server/routes/aiLocalKnowledgeApi.ts:268`, delay 2000ms

⚠ **Kèm một hệ quả tinh vi phải giữ trong đầu:** `loadedModels.set()` (dòng ~660) **vô điều kiện** — không kiểm entry cũ, không `dispose()`. Với model **30B** thì lượt nạp sau **thất bại** nên không có `set()` thứ hai. Với model **4B** thì **cả hai thành công** ⇒ lượt sau ghi đè, bản đầu **mồ côi ~3.474 MiB**, `evictLRU()` không với tới, **chỉ restart mới dọn**. **Model càng nhỏ càng rò.** Khoá in-flight sửa cả hai.

- [ ] **Step 1: Đọc hàm hiện tại trước khi sửa**

Đọc `server/services/aiGgufEngine.ts` từ dòng **585 đến 675**. Cần nắm: `modelId` được tính từ đâu, `loadedModels.has()` ở dòng ~598 chặn cái gì, và `loadedModels.set()` ở dòng ~660 đặt gì.
⚠ **Khuôn ở Step 3 là HÌNH DẠNG, không phải mã dán thẳng** — phải khớp với cách `modelId` thật sự được tính trong mã.

- [ ] **Step 2: Viết test đỏ**

Tạo `server/services/aiGgufEngine.inflight.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Đếm số lần thực sự chạm tới lớp nạp model nặng.
const loadModelSpy = vi.fn();

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: async (opts: any) => {
      loadModelSpy(opts);
      // Giả lập nạp chậm để hai lượt gọi chắc chắn chồng nhau.
      await new Promise((r) => setTimeout(r, 50));
      return {
        createContext: async () => ({ dispose: async () => {} }),
        createEmbeddingContext: async () => ({ dispose: async () => {} }),
        dispose: async () => {},
      };
    },
    getVramState: async () => ({ used: 1_000_000_000, total: 32_000_000_000 }),
  })),
}));

describe("loadGgufModel — khoá in-flight", () => {
  beforeEach(() => {
    loadModelSpy.mockClear();
    vi.resetModules();
  });

  it("hai lượt gọi ĐỒNG THỜI cùng một model chỉ nạp MỘT lần", async () => {
    const { loadGgufModel } = await import("./aiGgufEngine");
    const cfg = { modelPath: "D:/SOURCES/16.AI/test-model.gguf" } as any;

    const [a, b] = await Promise.all([loadGgufModel(cfg), loadGgufModel(cfg)]);

    expect(a).toBe(b);
    expect(loadModelSpy).toHaveBeenCalledTimes(1); // ĐỎ trước khi vá: sẽ là 2
  });

  it("lượt gọi SAU khi lượt đầu xong vẫn dùng lại model đã nạp, không nạp lại", async () => {
    const { loadGgufModel } = await import("./aiGgufEngine");
    const cfg = { modelPath: "D:/SOURCES/16.AI/test-model.gguf" } as any;

    await loadGgufModel(cfg);
    await loadGgufModel(cfg);

    expect(loadModelSpy).toHaveBeenCalledTimes(1);
  });
});
```

⚠ **Mock phải mô tả thế giới CÓ THẬT.** Nếu chuỗi gọi thật khác mock này (ví dụ `getLlama()` nhận tham số, hoặc `loadModel` trả hình dạng khác), **sửa mock cho khớp mã thật**, đừng sửa mã sản xuất cho khớp mock. Đây là bài học đã trả giá 4 lần ở các đợt trước.

- [ ] **Step 3: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run server/services/aiGgufEngine.inflight.test.ts
```
Kỳ vọng: test đầu **ĐỎ** với `expected 1, received 2`. **Dán output đỏ vào báo cáo.**
Nếu nó xanh ngay, nghĩa là mock chưa tái hiện được race — **sửa mock, đừng bỏ qua**.

- [ ] **Step 4: Cài đặt khoá in-flight**

Thêm map in-flight ở phạm vi module (cạnh `loadedModels`), rồi bọc thân hàm hiện tại:

```ts
/** Đợt 1 Task 1 — chống race double-warm: hai nơi độc lập cùng gọi warmModel()
 *  (backgroundJobs.ts:126-127 delay 3000ms và aiLocalKnowledgeApi.ts:268 delay
 *  2000ms) khiến cùng một model 17 GB bị nạp hai lần chồng nhau ⇒ cudaMalloc lỗi
 *  (30B) hoặc rò bản sao mồ côi (4B, ~3.474 MiB, evictLRU không với tới).
 *  Khoá theo modelId: lượt thứ hai chờ lượt đầu thay vì nạp song song. */
const inFlightLoads = new Map<string, Promise<string>>();
```

Trong `loadGgufModel`, **sau khi `modelId` đã được tính** và **sau** phép kiểm `loadedModels.has(modelId)` hiện có:

```ts
const pending = inFlightLoads.get(modelId);
if (pending) return pending;

const loadPromise = (async () => {
  /* … TOÀN BỘ phần thân hiện tại từ sau chỗ này … */
})();

inFlightLoads.set(modelId, loadPromise);
try {
  return await loadPromise;
} finally {
  inFlightLoads.delete(modelId);
}
```

⚠ **`finally` là bắt buộc** — nạp thất bại mà không xoá khỏi map thì mọi lượt sau sẽ nhận lại đúng promise lỗi đó vĩnh viễn.
⚠ **KHÔNG đụng** `loadedModels.set()`, `evictLRU()`, `enforceVramGuard()` — chúng đúng, chỉ thiếu khoá ở tầng trên.

- [ ] **Step 5: Chạy test, xác nhận XANH**

```bash
npx vitest run server/services/aiGgufEngine.inflight.test.ts
npx vitest run server/services/aiGgufEngine.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```
Kỳ vọng: cả hai file test xanh; `tsc` chỉ còn lỗi tiền tồn tại `SessionManagement.tsx:195`.

- [ ] **Step 6: Đo VRAM không hồi quy**

```bash
node scripts/ai-bench/bench.mjs --models deep --iters 1 --warmup 0
```
Kỳ vọng: nạp thành công, delta ~17.700 MiB (khớp mốc Đợt 0), VRAM về baseline sau khi thoát.
Ghi số vào báo cáo. Tạo `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md` với mục **"§1 Khoá in-flight"**.

- [ ] **Step 7: Commit**

```bash
git add server/services/aiGgufEngine.ts server/services/aiGgufEngine.inflight.test.ts docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md
git commit -m "fix(ai/dot1-1): khoá in-flight cho loadGgufModel — chặn race double-warm"
```

---

## Task 2: Embedding thôi cấp phát toàn bộ cửa sổ ngữ cảnh

**Files:**
- Modify: `server/services/aiGgufEngine.ts:2235-2241` (`getEmbeddingContext`)
- Test: `server/services/aiGgufEngine.embedCtx.test.ts` (**mới**)
- Modify: `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md`

**Interfaces:**
- Consumes: khoá in-flight từ Task 1 (không bắt buộc, nhưng Task 4 cần cả hai).
- Produces: embedding tốn ít VRAM hơn — Task 4 dùng số mới để cộng lại bảng roster.

**Bối cảnh — nguyên nhân chính xác:** `getEmbeddingContext()` dòng 2238-2241 gọi:
```ts
loaded.embeddingContext = await loaded.model.createEmbeddingContext({
  contextSize: "auto",           // ← lấy TOÀN BỘ cửa sổ ngữ cảnh model được huấn luyện
  batchSize: loaded.config.batchSize ?? 512,
});
```
Model nhúng **cũng đã** được nạp kèm một context thường (`contextSize: GGUF_DEFAULT_CTX=4096`, `sequences: GGUF_SEQUENCES=4`) mà nó **không bao giờ dùng để sinh chữ**. ⇒ **trả tiền hai lần**.

**Chunk RAG dài nhất là `maxChunkChars = 1800` ⇒ ~600 token.** Cấp `contextSize: 1024` là **dư ~70% biên an toàn**.

- [ ] **Step 1: Đo TRƯỚC — lấy số của chính bạn**

```bash
node scripts/ai-bench/bench.mjs --models embed --iters 1 --warmup 0
```
Ghi `modelDeltaMib` vào báo cáo. Mốc Đợt 0: **5.664 MiB**. Nếu số bạn lệch nhiều, **nói ra** — máy có thể đã đổi.

- [ ] **Step 2: Viết test đỏ**

Tạo `server/services/aiGgufEngine.embedCtx.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const createEmbeddingContextSpy = vi.fn();

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: async () => ({
      createContext: async () => ({ dispose: async () => {} }),
      createEmbeddingContext: async (opts: any) => {
        createEmbeddingContextSpy(opts);
        return {
          getEmbeddingFor: async () => ({ vector: new Array(1024).fill(0) }),
          dispose: async () => {},
        };
      },
      dispose: async () => {},
    }),
    getVramState: async () => ({ used: 1_000_000_000, total: 32_000_000_000 }),
  })),
}));

describe("getEmbeddingContext — ngân sách ngữ cảnh", () => {
  beforeEach(() => {
    createEmbeddingContextSpy.mockClear();
    vi.resetModules();
  });

  it("KHÔNG dùng contextSize 'auto' — nó cấp toàn bộ cửa sổ model", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt để nhúng");

    const opts = createEmbeddingContextSpy.mock.calls[0][0];
    expect(opts.contextSize).not.toBe("auto");
  });

  it("ngữ cảnh đủ chứa chunk dài nhất (~600 token) và có biên an toàn", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt để nhúng");

    const opts = createEmbeddingContextSpy.mock.calls[0][0];
    expect(typeof opts.contextSize).toBe("number");
    expect(opts.contextSize).toBeGreaterThanOrEqual(1024); // chunk dài nhất ~600 token
    expect(opts.contextSize).toBeLessThanOrEqual(4096);    // không quay lại cấp thừa
  });
});
```

⚠ Tên hàm xuất khẩu thật có thể **không** phải `generateEmbedding` — đọc `aiGgufEngine.ts` quanh dòng **2181** và **2212** (nơi `getEmbeddingContext` được gọi) rồi **sửa mock/test cho khớp mã thật**.

- [ ] **Step 3: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run server/services/aiGgufEngine.embedCtx.test.ts
```
Kỳ vọng: **ĐỎ** — `contextSize` hiện là `"auto"`. Dán output.

- [ ] **Step 4: Sửa**

```ts
/** Đợt 1 Task 2 — "auto" cấp TOÀN BỘ cửa sổ ngữ cảnh model được huấn luyện, trong
 *  khi chunk RAG dài nhất chỉ ~600 token (knowledge/chunks-stats.json:
 *  maxChunkChars=1800). Đo được: embedding 0.6B (file 1,2 GB) chiếm 5.664 MiB —
 *  ~4,5 GB là buffer. 1024 cho biên an toàn ~70%. */
const EMBED_CTX = (() => {
  const raw = Number(process.env.GGUF_EMBED_CTX);
  return Number.isFinite(raw) && raw >= 256 ? Math.floor(raw) : 1024;
})();
```
rồi:
```ts
loaded.embeddingContext = await loaded.model.createEmbeddingContext({
  contextSize: EMBED_CTX,
  batchSize: loaded.config.batchSize ?? 512,
});
```
⚠ Giữ nguyên khối `catch` và thông điệp lỗi hiện có — nó có câu tiếng Việt cho người dùng.

- [ ] **Step 5: Chạy test + đo SAU**

```bash
npx vitest run server/services/aiGgufEngine.embedCtx.test.ts
node scripts/ai-bench/bench.mjs --models embed --iters 1 --warmup 0
```
Ghi delta mới vào báo cáo, **tính phần trăm giảm so với Step 1**.

- [ ] **Step 6: ⚠ CỔNG AN TOÀN — chất lượng truy hồi không được tụt**

```bash
npm run kb:eval
```
**Bắt buộc `recall@5 = 151/151`.** Tụt là **DỪNG NGAY, không đi tiếp** — nghĩa là ngữ cảnh nhỏ đã cắt mất nội dung chunk. Báo lại thay vì nới ngưỡng.
⚠ Sau khi chạy, `knowledge/rag-eval-results.json` sẽ đổi — **đó là hợp lệ**, ghi vào commit.

- [ ] **Step 7: Commit**

```bash
git add server/services/aiGgufEngine.ts server/services/aiGgufEngine.embedCtx.test.ts knowledge/rag-eval-results.json docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md
git commit -m "perf(ai/dot1-2): embedding thôi cấp contextSize auto — giành lại VRAM"
```

---

## Task 3: Sidecar thị giác thôi tự lấy 4 khe song song

**Files:**
- Modify: `server/services/llamaVisionSidecar.ts:208-217` (mảng `args`)
- Test: `server/services/llamaVisionSidecar.args.test.ts` (**mới**)
- Modify: `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md`

**Interfaces:**
- Produces: sidecar tốn ít VRAM hơn — Task 4 dùng số mới.

**Bối cảnh:** mảng `args` hiện có `-m --mmproj --host --port -ngl -c --jinja` — **không có `-np`**. `llama-server` mặc định `n_parallel=4` ⇒ **`LLAMA_VISION_CTX=8192` × 4 khe = 32.768 token**, cộng buffer mtmd 1.502 MiB. Đo trực tiếp ở Đợt 0: **7.821 MiB**.
Hệ chỉ mô tả **một ảnh mỗi lượt** — không có đường nào gửi 4 ảnh song song vào sidecar.

- [ ] **Step 1: Đo TRƯỚC**

Khởi sidecar bằng đúng tham số mã sản xuất, đo `nvidia-smi` trước/sau, rồi tắt:
```bash
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits
# khởi llama-server với args lấy từ llamaVisionSidecar.ts:208-217
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits
```
Ghi delta vào báo cáo. Mốc Đợt 0: **7.821 MiB**.
⚠ **Tắt sidecar sau khi đo**, xác nhận VRAM về baseline, không `llama-server.exe` treo.

- [ ] **Step 2: Viết test đỏ**

Tạo `server/services/llamaVisionSidecar.args.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Test cấu trúc: đọc chính mã nguồn để khẳng định args có "-np".
 *  Lý do không mock spawn: mảng args nằm trong closure của startPromise,
 *  không xuất khẩu ra ngoài. Đọc nguồn là cách rẻ và trung thực nhất. */
describe("llamaVisionSidecar — tham số spawn", () => {
  const src = readFileSync("server/services/llamaVisionSidecar.ts", "utf8");

  it("truyền -np để llama-server không tự lấy 4 khe song song", () => {
    expect(src).toContain('"-np"');
  });

  it("vẫn giữ các tham số bắt buộc hiện có", () => {
    for (const flag of ['"-m"', '"--mmproj"', '"-ngl"', '"-c"', '"--jinja"']) {
      expect(src).toContain(flag);
    }
  });
});
```

⚠ Đây là **test cấu trúc, không phải test hành vi** — nó chỉ chứng minh cờ có mặt, **không** chứng minh VRAM giảm. Bằng chứng VRAM là Step 1 + Step 5. **Ghi rõ giới hạn này trong báo cáo**, đừng để người đọc tưởng test xanh nghĩa là đã tiết kiệm được.

- [ ] **Step 3: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run server/services/llamaVisionSidecar.args.test.ts
```
Kỳ vọng: test đầu **ĐỎ**. Dán output.

- [ ] **Step 4: Sửa**

Thêm hằng cạnh `VISION_CTX` (dòng ~60):
```ts
/** Đợt 1 Task 3 — llama-server mặc định n_parallel=4 ⇒ LLAMA_VISION_CTX × 4 khe.
 *  Hệ chỉ gửi MỘT ảnh mỗi lượt, không đường nào gửi song song. Đo Đợt 0: sidecar
 *  chiếm 7.821 MiB, trong đó phần lớn là 4 khe × ctx 8192 + buffer mtmd 1.502 MiB. */
const VISION_PARALLEL = (() => {
  const n = parseInt(process.env.LLAMA_VISION_PARALLEL || "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
})();
```
rồi thêm vào mảng `args` (sau `-c`):
```ts
      "-np", String(VISION_PARALLEL),
```

- [ ] **Step 5: Chạy test + đo SAU**

```bash
npx vitest run server/services/llamaVisionSidecar.args.test.ts
```
Rồi lặp lại phép đo Step 1 với mã đã sửa. Ghi delta mới + **phần trăm giảm**.
⚠ **Chạy một lượt suy luận thật trên ảnh** để chắc sidecar vẫn hoạt động — tiết kiệm VRAM mà hỏng chức năng là thất bại. Ghi kết quả suy luận vào báo cáo.

- [ ] **Step 6: Commit**

```bash
git add server/services/llamaVisionSidecar.ts server/services/llamaVisionSidecar.args.test.ts docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md
git commit -m "perf(ai/dot1-3): sidecar thị giác truyền -np 1 — thôi cấp 4 khe song song"
```

---

## Task 4: Cộng lại bảng roster và nghiệm thu qua app thật

**Files:**
- Modify: `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md`
- Modify: `docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md` (§2 bảng số đo nền, §3 bốn case)
- Modify: `docs/superpowers/specs/2026-08-01-ai-local-hybrid-internal-code-profile-design.md` (§2.1 ngân sách)

**Interfaces:**
- Consumes: khoá in-flight (Task 1) · delta embedding mới (Task 2) · delta sidecar mới (Task 3).

**Bối cảnh:** spec chiến lược §5 ghi rõ *"bước C có thể làm đổi kết luận của bước D"*. Task này là lúc đó.

- [ ] **Step 1: Nghiệm thu Task 1 bằng app thật**

Đây là lần đầu app được khởi động trong đợt này — trước Task 1 nó **không nạp nổi 30B**.
```bash
npm run dev 2>&1 | tee /tmp/dot1-boot.log
```
Đợi qua cả hai mốc warm (2000ms và 3000ms), rồi:
```bash
grep -c "cudaMalloc failed" /tmp/dot1-boot.log     # kỳ vọng 0
grep -c "Model loaded in" /tmp/dot1-boot.log       # kỳ vọng 1 cho model mặc định, KHÔNG phải 2
```
⚠ **Nếu vẫn thấy `cudaMalloc failed`, DỪNG** — khoá chưa đủ, báo lại thay vì đi tiếp.

- [ ] **Step 2: Canh bốn dòng cảnh báo**

```bash
grep -nE "evicted LRU model|no idle model to evict|At capacity|gpuLayers.*auto" /tmp/dot1-boot.log
```
Ghi kết quả. **Dòng nguy nhất**: `no idle model to evict — deferring/allowing load with OOM risk`, và cảnh báo nhánh `catch` nạp lại với `gpuLayers:"auto"` (nghĩa là tier **âm thầm tụt xuống ~2,9 tok/s** mà không báo lỗi).

- [ ] **Step 3: Cộng lại bảng ngân sách**

Lập bảng trước/sau cho cả bốn case của spec chiến lược §3, dùng **số của chính bạn** từ Task 1-3:

| Case | Đợt 0 | Đợt 1 | Đổi kết luận? |
|---|---|---|---|
| 1 — một model xuyên suốt | 24.562 (75,3%) · đỉnh 32.383 (99,3%) | *(điền)* | *(điền)* |
| 2 — đồng thời đủ bộ | 42.312 (130%) ❌ | *(điền)* | *(điền)* |
| 3 — thị giác thường trú | 32.383 (99,3%) | *(điền)* | *(điền)* |
| 4 — hybrid `balanced` | 28.026 (86%) | *(điền)* | *(điền)* |

⚠ **Nhớ cộng +470-940 MiB mỗi model đang sinh** — mọi số trên là lúc nghỉ.
⚠ **Nếu Case 2 vẫn không khả thi, nói thẳng.** Đừng cứu kết luận vì đã tiết kiệm được VRAM.

- [ ] **Step 4: Cập nhật hai spec**

Sửa `2026-08-01-ai-local-model-strategy-design.md` §2 (bảng số đo nền) và §3 (bốn case) bằng số mới. Sửa `2026-08-01-ai-local-hybrid-internal-code-profile-design.md` §2.1.
⚠ **Ghi rõ số nào là Đợt 0, số nào là Đợt 1** — đừng ghi đè lịch sử. Người đọc cần thấy đã giành lại được bao nhiêu.

- [ ] **Step 5: Cổng an toàn cuối**

```bash
npm run kb:eval
npx vitest run server/services/aiGgufEngine.test.ts server/services/aiGgufEngine.inflight.test.ts server/services/aiGgufEngine.embedCtx.test.ts server/services/llamaVisionSidecar.args.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```
Kỳ vọng: `recall@5 = 151/151` · mọi test xanh · `tsc` chỉ còn `SessionManagement.tsx:195`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md docs/superpowers/specs/2026-08-01-ai-local-hybrid-internal-code-profile-design.md
git commit -m "docs(ai/dot1-4): cộng lại bảng roster với VRAM đã giành lại"
```

---

## Self-Review

**Spec coverage:** spec chiến lược §1.2 (buffer ăn nhiều hơn trọng số) → Task 2 + 3 · §5 bước B (vá race) → Task 1 · §5 bước C (chỉnh buffer) → Task 2 + 3 · §5 cảnh báo "bước C có thể đổi kết luận bước D" → Task 4 Step 3-4 · spec hồ sơ nội bộ §3 điều kiện 1 (vá race trước khi bật hồ sơ) → Task 1 · §4 bốn dòng log phải canh → Task 4 Step 2. **Đủ.**
⚠ **Chưa phủ**: spec chiến lược §5 bước **A** (thành phần nắm ngân sách VRAM) — **cố ý ngoài phạm vi**, là đợt riêng và lớn hơn hẳn. Và điều kiện 2 của spec hồ sơ (nối `aiProgrammingCopilot` qua `aiGateway`) — cũng đợt riêng.

**Placeholder scan:** không có "TBD". Hai chỗ **cố ý** để người thi công điền, đều kèm chỉ dẫn: bảng Task 4 Step 3 (điền số đo của chính họ) · tên hàm xuất khẩu ở Task 2 Step 2 (đọc mã thật rồi sửa test cho khớp).

**Type consistency:** `EMBED_CTX` (Task 2) và `VISION_PARALLEL` (Task 3) là hằng module, không tham chiếu chéo. `inFlightLoads` (Task 1) chỉ dùng trong `loadGgufModel`. Tên file báo cáo `2026-08-01-dot1-vram-reclaim.md` nhất quán ở cả 4 task.
