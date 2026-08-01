# Đợt 2 — Làm cho đo được, rồi giành nốt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm cho công cụ đo nói thật, làm cho tier code nhìn thấy được, giành nốt ~2 GB VRAM, và thôi nuốt lỗi im lặng — để quyết định roster đứng trên nền vững.

**Architecture:** Sáu việc độc lập, xếp theo thứ tự **phụ thuộc thật**: sửa harness trước (nó đã sai 3 lần và làm hỏng một tài liệu quyết định), rồi mới đo và sửa những thứ khác. Task 5 **chỉ điều tra, không vá** — bí ẩn CUDA chưa đủ hiểu để sửa an toàn.

**Tech Stack:** node-llama-cpp (GGUF) · TypeScript · tRPC · vitest · PostgreSQL · nvidia-smi

**Spec:** `docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md` §5 (lộ trình A/B/C) và §4 (kiến trúc) · `2026-08-01-ai-local-hybrid-internal-code-profile-design.md` §1 và §3
**Số đo nền:** `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md`

## Global Constraints

- **Đợt này SỬA MÃ SẢN XUẤT** ⇒ **TDD: test đỏ trước → chạy thấy đỏ (dán output) → sửa tối thiểu → xanh.** Không bao giờ làm yếu assertion.
- **Mọi thay đổi ảnh hưởng VRAM phải có số TRƯỚC và SAU.** Không số thì không commit.
- ⚠ **Đo bằng ĐƯỜNG SẢN XUẤT.** `scripts/ai-bench/bench.mjs` đã sai **ba lần liên tiếp** (không biết "vision" ⇒ sót 7,8 GB · hard-code `contextSize:"auto"` ⇒ sót 2,0 GB · context 1 sequence ⇒ sót ~1,36 GB **mỗi model text**). **Cho tới khi Task 1 xong, KHÔNG được dùng bench làm bằng chứng.**
- **Cổng an toàn**: `npm run kb:eval` giữ **`recall@5 = 151/151`**. Tụt là **DỪNG NGAY**, báo lại, **không nới ngưỡng**.
- ⚠ `.env` **KHÔNG git-track** ⇒ `git checkout -- .env` **lỗi im lặng**. Sao lưu thủ công: `cp .env .env.dot2-backup` trước · `cp` lại + `diff` sau · `rm` backup.
- ⚠ **KHÔNG dùng `tasklist`** kiểm tiến trình treo — trên máy này nó trả **RỖNG khi có 8 `node.exe` đang chạy**. Dùng `nvidia-smi` về baseline (~1.075 MiB) + `netstat -ano | grep -E ":3000|:8081"` trống.
- ⚠ **`git worktree add` TREO** trên repo này (do `uploads/inspections` track hàng chục nghìn file). Đừng dùng. Đừng `git stash` trần.
- **KHÔNG `git add -A` / `git add -u`.** Cây có ~107 file việc dở của người khác. Chỉ `git add` file bạn sửa, liệt kê tên.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`. Lỗi **tiền tồn tại**: `client/src/pages/SessionManagement.tsx:195`.
- Test và comment viết **tiếng Việt**. **Không push.**

## Sự thật đã đo (Đợt 0 + Đợt 1) — dùng làm mốc

| Thành phần | VRAM delta (MiB) | Ghi chú |
|---|---|---|
| Nền hệ điều hành | ~1.075 | |
| Qwen3-Coder-30B-A3B | **19.077** | đo bằng đường sản xuất |
| Qwen3-30B-A3B-Instruct | **19.094** | đo bằng đường sản xuất |
| Qwen3-Embedding-0.6B (sau Đợt 1) | **4.321** | trong đó model+ctx thường **3.649**, embedding ctx **654** |
| Vision sidecar (tiến trình riêng) | **7.821** | `kv_unified=true`, không giảm được bằng `-np` |
| Trần thiết bị | **32.607** | |

**Cấu hình:** `GGUF_DEFAULT_CTX=4096` · `GGUF_MAX_CTX=32768` · `GGUF_SEQUENCES` mặc định 4 · `EMBED_CTX` mặc định 2048 · `GGUF_MAX_CONCURRENCY=4`

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `scripts/ai-bench/bench.mjs` | **Sửa** — dùng đường sản xuất thay vì tự dựng context | 1 |
| `scripts/ai-kb/_gguf-embed.mjs` | **Sửa** — bỏ `contextSize:"auto"` hard-code | 1 |
| `server/services/programming/aiProgrammingCopilot.ts` | **Sửa** — đi qua `aiGateway` | 2 |
| `server/services/aiGgufEngine.ts` (`loadGgufModel` ~684-691) | **Sửa** — không tạo context thường cho model chỉ-nhúng | 3 |
| `server/services/aiGgufEngine.ts` (`getEmbeddingContext` ~2282) | **Sửa** — khoá in-flight | 3 |
| `server/services/kb/kbVectorStore.ts:68` | **Sửa** — thôi nuốt throw | 4 |
| `docs/superpowers/reports/2026-08-02-dot2-report.md` (**mới**) | Báo cáo — mỗi task nối một mục | 1-6 |

---

## Task 1: Harness đo thôi nói dối

**Files:**
- Modify: `scripts/ai-bench/bench.mjs` (dòng ~249 `createContext`, ~321 `createEmbeddingContext`)
- Modify: `scripts/ai-kb/_gguf-embed.mjs` (dòng ~71)
- Create: `docs/superpowers/reports/2026-08-02-dot2-report.md`

**Interfaces:**
- Produces: `npm run ai:bench` cho số **khớp đường sản xuất**. Task 3 và 6 dựa vào đây.

**Bối cảnh — vì sao task này đứng đầu:** `bench.mjs` có comment đầu file *"does NOT import any server/ source"* — chủ ý ban đầu là tự chứa. Nhưng nó **đã sai ba lần liên tiếp**, và lần thứ ba làm **tài liệu quyết định của Đợt 0 sai ~3.400 MiB theo hướng lạc quan** (công bố "99,3% sát trần" cho cấu hình thật ra đã ở 109,8%).

⚠ **Đây là đảo ngược một nguyên tắc thiết kế có chủ ý.** Lý do đảo: tính "tự chứa" bảo vệ khỏi việc phải khởi động app — nhưng **import `aiGgufEngine.ts` KHÔNG khởi động app** (Đợt 1 đã chứng minh: nhiều script import thẳng module và chạy tốt). Nên tính tự chứa **không mua được gì**, mà **trả giá bằng ba lần đo sai**.

- [ ] **Step 1: Đo TRƯỚC để có mốc so**

```bash
node scripts/ai-bench/bench.mjs --models deep --iters 1 --warmup 0
node scripts/ai-bench/bench.mjs --models embed --iters 1 --warmup 0
```
Ghi `modelDeltaMib` của cả hai. Mốc Đợt 1: `deep` bench báo **17.743** trong khi sản xuất là **19.105** (chênh **1.362**); `embed` bench báo **~5.620** trong khi sản xuất là **4.321** sau Đợt 1.

- [ ] **Step 2: Đọc đường sản xuất trước khi sửa**

Đọc `server/services/aiGgufEngine.ts` hàm `loadGgufModel` (dòng ~593-700) và `getEmbeddingContext` (~2282). Ghi lại **chính xác** nó tạo context với tham số gì.
⚠ **Đây là nguồn sự thật.** Bench phải khớp cái này, không phải ngược lại.

- [ ] **Step 3: Viết test đỏ — cổng chống drift**

Tạo `scripts/ai-bench/bench.production-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Cổng chống DRIFT: bench.mjs đã sai 3 lần vì tự dựng context khác đường sản
 *  xuất. Test này không đo VRAM — nó khẳng định bench KHÔNG còn hard-code tham
 *  số context riêng, mà lấy từ cùng nguồn với sản xuất. */
describe("bench.mjs — khớp đường sản xuất", () => {
  const src = readFileSync("scripts/ai-bench/bench.mjs", "utf8");

  it("KHÔNG còn hard-code contextSize 'auto' cho embedding", () => {
    expect(src).not.toMatch(/createEmbeddingContext\(\{\s*contextSize:\s*"auto"/);
  });

  it("KHÔNG còn tạo context text mà bỏ qua sequences", () => {
    const m = src.match(/model\.createContext\(\{[^}]*\}\)/s);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/sequences/);
  });
});
```

⚠ Tên file phải là `*.test.ts` (không phải `.unit.test.ts` — đây là test **server-side**, `vitest.config.ts:27` chỉ ép `.unit.test.ts` cho `client/`). Kiểm `vitest.config.ts` trước để chắc file này thật sự chạy.

- [ ] **Step 4: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run scripts/ai-bench/bench.production-parity.test.ts
```
Kỳ vọng: **cả hai ĐỎ**. Dán output.

- [ ] **Step 5: Sửa bench dùng đường sản xuất**

Cách **ưu tiên**: import `loadGgufModel` / `unloadGgufModel` từ `server/services/aiGgufEngine.ts` và bỏ hẳn phần tự dựng context. Bench chạy qua `tsx` nên import TypeScript được (Đợt 1 nhiều script đã làm vậy).

Nếu import gây vòng phụ thuộc hoặc kéo theo副 tác dụng không mong muốn (ví dụ khởi động scheduler), **đừng ép** — thay bằng: đọc **cùng biến môi trường** và truyền **cùng tham số** như sản xuất, kèm comment trỏ tới dòng sản xuất tương ứng. Ghi rõ trong báo cáo đã chọn cách nào **và vì sao**.

Sửa `scripts/ai-kb/_gguf-embed.mjs:71` tương tự: bỏ `contextSize:"auto"`, dùng cùng nguồn với `EMBED_CTX`.

- [ ] **Step 6: Chạy test XANH + đo lại**

```bash
npx vitest run scripts/ai-bench/bench.production-parity.test.ts
node scripts/ai-bench/bench.mjs --models deep --iters 1 --warmup 0
node scripts/ai-bench/bench.mjs --models embed --iters 1 --warmup 0
npm run kb:eval
```
Kỳ vọng: `deep` nay ≈ **19.1 GB** (khớp sản xuất, **không còn 17,7**); `embed` ≈ **4.321**; `kb:eval` giữ **151/151**.
⚠ **Nếu số bench vẫn khác sản xuất, task này CHƯA XONG** — đó chính là thứ nó tồn tại để sửa.

- [ ] **Step 7: Commit**

```bash
git add scripts/ai-bench/bench.mjs scripts/ai-kb/_gguf-embed.mjs scripts/ai-bench/bench.production-parity.test.ts docs/superpowers/reports/2026-08-02-dot2-report.md
git commit -m "fix(ai/dot2-1): harness đo dùng đường sản xuất — thôi sai lần thứ tư"
```

---

## Task 2: Tier code thôi vô hình với đo lường

**Files:**
- Modify: `server/services/programming/aiProgrammingCopilot.ts`
- Test: `server/services/programming/aiProgrammingCopilot.metrics.test.ts` (**mới**)
- Modify: `docs/superpowers/reports/2026-08-02-dot2-report.md`

**Interfaces:**
- Produces: lượt gọi copilot **ghi được** vào `ai_gateway_metrics`. Task 6 dùng để trả lời câu hỏi chưa ai trả lời được.

**Bối cảnh — vì sao task này đáng giá nhất về mặt quyết định:** chủ dự án ưu tiên *"nghiêng về model chuyên code"*. Ưu tiên đó **hiện không có dữ liệu nào chứng minh hay bác bỏ** — không phải vì tier code ít dùng, mà vì **không ai đo được nó**: `aiProgrammingCopilot.ts` gọi **thẳng** `aiGgufEngine`, **không qua** `aiGateway` (nơi ghi bảng metric) ⇒ **0 dòng** trong `ai_gateway_metrics`; `ai_model_metrics` cũng **0 dòng**, không có nguồn thay thế.

- [ ] **Step 1: Tìm ĐỦ các điểm gọi thẳng**

```bash
grep -nE "chatCompletion\(|generateJSON\(|generateText\(|generateFimNative\(|generateFim\(" server/services/programming/aiProgrammingCopilot.ts
```
⚠ Khảo sát Đợt 0 nêu **6 điểm** (dòng 372/390/440/458/771/807) nhưng **mã đã đổi** — lấy số của chính bạn, và **ghi rõ nếu khác 6**.

- [ ] **Step 2: Đọc hợp đồng của `aiGateway`**

Đọc `server/services/aiGateway.ts` — `planInference` / `routeInference` / chỗ gọi `enqueue(toRow(...))`. Ghi lại **chính xác** chữ ký và **trường nào bắt buộc** (`tier`, `task`, `model`, `tokensIn`, `tokensOut`, `latencyMs`, `outcome`).
⚠ **Bước này bắt buộc trước khi viết mã.** Sprint trước có hai lần tính năng không bao giờ hiện được vì `.map()` liệt kê tay thiếu trường — kiểm hợp đồng **trước**, đừng giả định.

- [ ] **Step 3: Viết test đỏ**

Tạo `server/services/programming/aiProgrammingCopilot.metrics.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueueSpy = vi.fn();

vi.mock("../aiGateway", async (orig) => {
  const actual = await (orig() as any);
  return { ...actual, enqueue: enqueueSpy };
});

describe("aiProgrammingCopilot — ghi được vào ai_gateway_metrics", () => {
  beforeEach(() => { enqueueSpy.mockClear(); vi.resetModules(); });

  it("một lượt sinh mã tạo ĐÚNG MỘT dòng metric với task='code'", async () => {
    const { copilotGenerate } = await import("./aiProgrammingCopilot");
    await copilotGenerate({ kind: "iec61131-st", prompt: "Viết block chớp đèn 1Hz" } as any);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const row = enqueueSpy.mock.calls[0][0];
    expect(row.task).toBe("code");
    expect(typeof row.model).toBe("string");
    expect(row.model).not.toBe("default"); // phải là tên GGUF thật
  });
});
```

⚠ **Tên hàm xuất khẩu và tên mock có thể SAI** — đọc mã thật (Step 1-2) rồi **sửa test cho khớp**, đừng sửa mã sản xuất cho khớp test. Nếu `aiGateway` không xuất `enqueue`, mock đúng thứ nó thật sự dùng.
⚠ Ghi chú `row.model` **không được là `"default"`**: Đợt 0 đo được tier `vision` ghi `model='default'` (`aiGateway.ts:866` `toRow()`) ⇒ không truy được về model cụ thể. Đừng lặp lỗi đó cho tier code.

- [ ] **Step 4: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run server/services/programming/aiProgrammingCopilot.metrics.test.ts
```
Kỳ vọng: **ĐỎ** — `enqueue` chưa từng được gọi. Dán output.

- [ ] **Step 5: Nối qua gateway**

⚠ **Giữ nguyên hành vi sinh mã.** Chỉ thêm đường ghi metric — **không** đổi model được chọn, **không** đổi tham số sinh, **không** đổi hình dạng trả về. Nếu đi qua `routeInference` làm đổi model được chọn thì **dừng và báo**: đó là thay đổi hành vi, cần quyết riêng.
⚠ Ghi metric hỏng **không được** làm hỏng việc sinh mã — bọc fail-open như các đường khác trong repo.

- [ ] **Step 6: Nghiệm thu bằng lượt gọi THẬT**

```bash
MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
"SELECT task, model, count(*) FROM ai_gateway_metrics WHERE task IN ('code','fim') GROUP BY task, model;"
```
Chạy **trước** và **sau** một lượt gọi copilot thật. Kỳ vọng: **từ 0 dòng thành ≥1 dòng, kèm tên model GGUF thật**.
⚠ Đây là bằng chứng duy nhất có giá trị — test mock không chứng minh dòng thật được ghi.

- [ ] **Step 7: Commit**

```bash
git add server/services/programming/aiProgrammingCopilot.ts server/services/programming/aiProgrammingCopilot.metrics.test.ts docs/superpowers/reports/2026-08-02-dot2-report.md
git commit -m "fix(ai/dot2-2): copilot lập trình đi qua aiGateway — tier code thôi vô hình"
```

---

## Task 3: Model nhúng thôi trả tiền hai lần

**Files:**
- Modify: `server/services/aiGgufEngine.ts` — `loadGgufModel` (~684-691) và `getEmbeddingContext` (~2282)
- Test: `server/services/aiGgufEngine.embedNoTextCtx.test.ts` (**mới**)
- Modify: `docs/superpowers/reports/2026-08-02-dot2-report.md`

**Interfaces:**
- Consumes: harness đã sửa (Task 1) — **bắt buộc**, vì đo bằng bench cũ sẽ ra số sai.
- Produces: delta model nhúng mới. Task 6 cộng lại bảng.

**Bối cảnh:** Đợt 1 mới trả **một nửa** khoản "trả tiền hai lần". Model nhúng vẫn được `loadGgufModel` tạo **context thường** (`contextSize = GGUF_DEFAULT_CTX = 4096`, `sequences = GGUF_SEQUENCES = 4`) mà nó **không bao giờ dùng để sinh chữ**.
Đo Đợt 1: model + ctx thường = **3.649 MiB** · embedding ctx = **654 MiB** ⇒ dư địa ước **~2,0 GB**.

**Và một khoản thứ hai, cùng lớp lỗi Task 1 của Đợt 1 vừa vá:** `getEmbeddingContext()` (~2282, **cách chỗ Đợt 1 sửa 3 dòng**) **không có khoá in-flight**. Đo: 4 lượt nhúng **tuần tự** = 654 MiB; **đồng thời** = **2.430 MiB** ⇒ **+1.776 MiB**, đỉnh **nhất thời vài giây** (T+8s về mức tuần tự), không rò vĩnh viễn. Tới được thật vì `GGUF_MAX_CONCURRENCY=4` và 6 nơi gọi do HTTP điều khiển.
⚠ Test `aiGgufEngine.test.ts:134` (*"caches… called once"*) chỉ chạy **tuần tự** ⇒ **cảm giác an toàn sai**.

- [ ] **Step 1: Đo TRƯỚC bằng đường sản xuất**

Viết script tạm import `loadGgufModel` + `generateEmbedding` thật, đo VRAM delta cho model nhúng. **Xoá script sau khi đo.**
⚠ **Không dùng bench cũ.** Nếu Task 1 chưa xong, task này **không chạy được** — báo lại.

- [ ] **Step 2: Viết test đỏ — hai mệnh đề**

Tạo `server/services/aiGgufEngine.embedNoTextCtx.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const createContextSpy = vi.fn();
const createEmbeddingContextSpy = vi.fn();

vi.mock("fs", async (orig) => {
  const actual = await (orig() as any);
  return { ...actual, existsSync: () => true, statSync: () => ({ size: 1_200_000_000 }) };
});

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: async () => ({
      createContext: async (o: any) => { createContextSpy(o); return { dispose: async () => {} }; },
      createEmbeddingContext: async (o: any) => {
        createEmbeddingContextSpy(o);
        await new Promise((r) => setTimeout(r, 50));
        return { getEmbeddingFor: async () => ({ vector: new Array(1024).fill(0) }), dispose: async () => {} };
      },
      dispose: async () => {},
    }),
    getVramState: async () => ({ used: 1_000_000_000, total: 32_000_000_000 }),
  })),
}));

describe("model nhúng — thôi trả tiền hai lần", () => {
  beforeEach(() => {
    createContextSpy.mockClear(); createEmbeddingContextSpy.mockClear(); vi.resetModules();
  });

  it("KHÔNG tạo context thường cho model chỉ dùng để nhúng", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await generateEmbedding("một câu tiếng Việt");
    expect(createContextSpy).not.toHaveBeenCalled();
  });

  it("hai lượt nhúng ĐỒNG THỜI chỉ tạo MỘT embedding context", async () => {
    const { generateEmbedding } = await import("./aiGgufEngine");
    await Promise.all([generateEmbedding("câu A"), generateEmbedding("câu B")]);
    expect(createEmbeddingContextSpy).toHaveBeenCalledTimes(1);
  });
});
```

⚠ Tên hàm xuất khẩu (`generateEmbedding`) và hình dạng mock **có thể sai** — đọc mã thật rồi **sửa test cho khớp**. Xem `aiGgufEngine.inflight.test.ts` và `aiGgufEngine.embedCtx.test.ts` (Đợt 1 tạo) để lấy đúng quy ước mock của file này.
⚠ Nếu test **xanh ngay**, mock chưa chạm đúng chỗ — **sửa mock, đừng bỏ qua**.

- [ ] **Step 3: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run server/services/aiGgufEngine.embedNoTextCtx.test.ts
```
Kỳ vọng: **cả hai ĐỎ**. Dán output.

- [ ] **Step 4: Sửa — hai chỗ**

**(a)** Trong `loadGgufModel`: **bỏ qua** việc tạo context thường khi model được nạp **chỉ để nhúng**. Cách nhận biết: thêm cờ vào `GgufModelConfig` (ví dụ `embeddingOnly?: boolean`) do đường nhúng truyền vào, **không** đoán theo tên file.
⚠ **Không** đổi hành vi cho model text — chúng vẫn cần context thường.

**(b)** Trong `getEmbeddingContext`: thêm **khoá in-flight** theo cùng khuôn Đợt 1 đã dùng cho `loadGgufModel` (map promise + `finally` xoá). ⚠ `finally` là **bắt buộc** — thiếu nó thì một lần lỗi làm hỏng vĩnh viễn.

- [ ] **Step 5: Chạy test XANH + đo SAU + cổng an toàn**

```bash
npx vitest run server/services/aiGgufEngine.embedNoTextCtx.test.ts server/services/aiGgufEngine.test.ts server/services/aiGgufEngine.embedCtx.test.ts server/services/aiGgufEngine.inflight.test.ts
npm run kb:eval
```
Rồi lặp lại phép đo Step 1. Ghi **delta mới + phần trăm giảm**.
⚠ `kb:eval` **bắt buộc 151/151**. Tụt là **DỪNG** — nghĩa là bỏ context thường đã phá đường nhúng.

- [ ] **Step 6: Commit**

```bash
git add server/services/aiGgufEngine.ts server/services/aiGgufEngine.embedNoTextCtx.test.ts knowledge/rag-eval-results.json docs/superpowers/reports/2026-08-02-dot2-report.md
git commit -m "perf(ai/dot2-3): model nhúng thôi tạo context thường + khoá in-flight"
```

---

## Task 4: Thôi nuốt lỗi im lặng

**Files:**
- Modify: `server/services/kb/kbVectorStore.ts:68` (`ingestKbChunks`)
- Test: `server/services/kb/kbVectorStore.ingestLog.test.ts` (**mới**)
- Modify: `docs/superpowers/reports/2026-08-02-dot2-report.md`

**Interfaces:**
- Produces: lỗi nhúng **hiện ra** thay vì biến mất.

**Bối cảnh:** `ingestKbChunks()` gọi `generateEmbedding()` trong `try/catch`, và **mọi lỗi bị nuốt thành `skipped++`**. Hệ quả đo được ở Đợt 1: chunk vượt `contextSize` làm `getEmbeddingFor()` **throw**, throw đó bị nuốt ⇒ **nội dung âm thầm vắng mặt khỏi `kb_chunks`** mà không ai biết.
Và `kb:eval` dùng embedding **dựng sẵn** nên **mù** với chính lỗi này.

⚠ Đây là **chân yếu thật** — không phải biên `EMBED_CTX` (chunk thật 1.879 token **đã chạy được**, nhúng thật `LONG_OK`, không throw).

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/kb/kbVectorStore.ingestLog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const errorSpy = vi.fn();

describe("ingestKbChunks — lỗi nhúng phải HIỆN RA", () => {
  beforeEach(() => { errorSpy.mockClear(); vi.resetModules(); });

  it("khi generateEmbedding throw, phải log LỖI kèm lý do — không im lặng", async () => {
    vi.spyOn(console, "error").mockImplementation(errorSpy);
    vi.doMock("../aiGgufEngine", () => ({
      generateEmbedding: async () => { throw new Error("Input is longer than the context size"); },
    }));

    const { ingestKbChunks } = await import("./kbVectorStore");
    const res = await ingestKbChunks([{ id: "c1", text: "x".repeat(9000) } as any]);

    expect(res.skipped).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(msg).toMatch(/c1/);                 // phải nêu chunk nào
    expect(msg).toMatch(/context size/i);      // phải nêu lý do thật
  });
});
```

⚠ Tên hàm/chữ ký (`ingestKbChunks`, hình dạng chunk, tên trường trả về `skipped`) **có thể sai** — đọc `kbVectorStore.ts` rồi **sửa test cho khớp mã thật**.

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run server/services/kb/kbVectorStore.ingestLog.test.ts
```
Kỳ vọng: **ĐỎ** — hiện không log gì. Dán output.

- [ ] **Step 3: Sửa**

Trong `catch`: **giữ nguyên** `skipped++` (không đổi hành vi luồng), **thêm** `console.error` nêu **chunk id** và **lý do thật** (`err?.message`).
⚠ **Đừng** đổi thành throw — đổi luồng là thay đổi hành vi, ngoài phạm vi. Việc của task này là **thôi im lặng**.

- [ ] **Step 4: Chạy test XANH**

```bash
npx vitest run server/services/kb/kbVectorStore.ingestLog.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add server/services/kb/kbVectorStore.ts server/services/kb/kbVectorStore.ingestLog.test.ts docs/superpowers/reports/2026-08-02-dot2-report.md
git commit -m "fix(ai/dot2-4): ingestKbChunks thôi nuốt lỗi nhúng im lặng"
```

---

## Task 5: Điều tra bí ẩn CUDA — CHỈ ĐO, KHÔNG VÁ

**Files:**
- Modify: `docs/superpowers/reports/2026-08-02-dot2-report.md`

**Interfaces:**
- Produces: mục "§5 Bí ẩn CUDA" — thu hẹp giả thuyết, **không** thay đổi mã.

⚠⚠ **RÀNG BUỘC TUYỆT ĐỐI: KHÔNG SỬA MÃ TRONG TASK NÀY.** Đường vòng đã biết (tạo CUDA context sớm) **có thể che mất vấn đề thật** — biến nó thành mã khi chưa hiểu cơ chế là **đổi một lỗi ồn ào lấy một lỗi im lặng**. Việc của bạn là **hiểu thêm**, không phải sửa.

**Đã biết (đừng đo lại):**
- App boot ⇒ `cudaMalloc failed` khi cấp **16.698,37 MiB**, tái hiện **3/3 lượt**.
- Nạp model nhỏ **trước** khi boot app ⇒ chính đường warm của app nạp 30B **thành công**. Tái hiện **3 lần độc lập**.
- Hoãn warm 120 s ⇒ **vẫn lỗi** ⇒ không phải tranh chấp thời gian.
- **Giả thuyết "hai backend" ĐÃ BỊ LOẠI**: `grep -c "llama.cpp engine initialized"` trên log boot = **1**, không phải 2.
- **Sau khi 16,7 GB thất bại, model 0,6B vẫn nạp được trong 1.669 ms** ⇒ VRAM **không** cạn.
- Lúc lỗi còn **~27-31 GB trống** trên thiết bị.

**Khuôn quan sát:** cấp phát lớn **ĐẦU TIÊN** sau khi khởi backend thì hỏng; có một cấp phát **nhỏ** đi trước thì không.

- [ ] **Step 1: Thu hẹp — cấp phát nhỏ nào là đủ?**

Thử lần lượt (mỗi lần một tiến trình sạch, đo `nvidia-smi` trước/sau):
1. nạp model **0,6B** trước → boot app → warm 30B
2. nạp model **1,5B** (FIM) trước → boot app → warm 30B
3. **không** nạp model nào, chỉ gọi `getLlama()` rồi boot app → warm 30B

Câu hỏi trả lời: **cần một model được nạp thật, hay chỉ cần backend được chạm?** Kết quả (3) là phép phân biệt quan trọng nhất.

- [ ] **Step 2: Thu hẹp — kích thước nào bắt đầu hỏng?**

Với app đã boot (trạng thái lỗi), thử nạp model theo thứ tự tăng dần: 0,6B → 1,5B → 4B → 30B. Ghi cái nào **đầu tiên** hỏng.
⇒ Nếu 4B nạp được mà 30B không, ta có **ngưỡng**. Nếu cả 4B cũng hỏng, ngưỡng thấp hơn nhiều.
⚠ Sau mỗi lượt: `nvidia-smi` về baseline, cổng trống.

- [ ] **Step 3: Ghi nhận, KHÔNG kết luận cơ chế**

Viết §5: đã loại được gì, khuôn quan sát mới, **ứng viên còn lại kèm phép thử rẻ cho từng cái**.
⚠ **Không phát biểu cơ chế nếu chưa đo được nó.** Đợt 0 và Đợt 1 đều có lỗi Critical vì suy cơ chế từ quan sát một chiều. Nếu bạn có giả thuyết, ghi là **giả thuyết kèm phép thử**, không phải kết luận.
⚠ **Nếu bạn tìm ra cơ chế và nó có cách sửa rõ ràng — vẫn KHÔNG sửa.** Ghi vào báo cáo, để đợt sau quyết.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/reports/2026-08-02-dot2-report.md
git commit -m "docs(ai/dot2-5): điều tra bí ẩn CUDA — thu hẹp giả thuyết, không vá"
```

---

## Task 6: Cộng lại bảng và trả lời câu hỏi roster

**Files:**
- Modify: `docs/superpowers/reports/2026-08-02-dot2-report.md`
- Modify: `docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md` (§2 bảng số đo nền, §3 bốn case)
- Modify: `docs/superpowers/specs/2026-08-01-ai-local-hybrid-internal-code-profile-design.md` (§2.1 ngân sách)

**Interfaces:**
- Consumes: harness đã sửa (T1) · dữ liệu tier code (T2) · delta nhúng mới (T3).

- [ ] **Step 1: Trả lời câu hỏi chưa ai trả lời được**

```bash
MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
"SELECT task, model, count(*) AS luot, sum(\"tokensIn\") AS tok_in, sum(\"tokensOut\") AS tok_out
 FROM ai_gateway_metrics GROUP BY task, model ORDER BY luot DESC;"
```
⚠ **Ghi rõ đây là lưu lượng DỰNG hay lưu lượng THẬT.** Nếu chỉ có vài lượt do bạn tự gọi lúc nghiệm thu T2, **nói thẳng là chưa đủ kết luận** — đừng để người đọc tưởng đã có hồ sơ lưu lượng.

- [ ] **Step 2: Đo lại 4B và FIM bằng đường sản xuất**

Hai model này **chưa bao giờ được đo bằng đường sản xuất** — mọi số hiện có là **SÀN** (bench cũ hụt ~1,36 GB mỗi model text). Đo lại bằng harness đã sửa ở T1.

- [ ] **Step 3: Cộng lại bảng bốn case**

| Case | Đợt 1 | Đợt 2 | Đổi kết luận? |
|---|---|---|---|
| 1 — một model xuyên suốt, nghỉ | 24.598 (75,4%) | *(điền)* | *(điền)* |
| 1 — khi vision thức | 32.419 (99,4%) · tải ~104,9% | *(điền)* | *(điền)* |
| 2 — đồng thời đủ bộ | 43.692 (134%) | *(điền)* | *(điền)* |
| 4 — `balanced`, nghỉ | 28.062 (86,1%, **SÀN**) | *(điền)* | *(điền)* |

⚠ Cộng thêm **+470-940 MiB mỗi model GGUF đang sinh** và **+117 MiB** sidecar đang suy luận.
⚠ **Nếu Case 2 vẫn không khả thi, nói thẳng.** Đợt 1 đã học: đừng cứu kết luận vì vừa tiết kiệm được VRAM.

- [ ] **Step 4: Cập nhật hai spec**

Ghi rõ **số nào Đợt 0 / Đợt 1 / Đợt 2** — không ghi đè lịch sử.
⚠ Chủ dự án **đã chấm A/B tiếng Việt** (2026-08-02): model chuyên code viết tiếng Việt **nhỉnh hơn**, mức **nhẹ**. ⇒ Điều kiện *"tiếng Việt Coder chấp nhận được → roster A"* **ĐẠT**; hồ sơ `balanced` **mất lý do tồn tại chính**. Phản ánh điều này khi viết kết luận.

- [ ] **Step 5: Nêu giới hạn còn lại**

Ít nhất: bí ẩn CUDA (T5 thu hẹp tới đâu) · lưu lượng tier code đủ hay chưa · những gì vẫn chưa đo.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/reports/2026-08-02-dot2-report.md docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md docs/superpowers/specs/2026-08-01-ai-local-hybrid-internal-code-profile-design.md
git commit -m "docs(ai/dot2-6): cộng lại bảng roster với số đo đường sản xuất"
```

---

## Self-Review

**Spec coverage:** spec chiến lược §5 bước **C** (chỉnh buffer) → T3 · §4.2 (42% lời gọi đi vòng, tier code vô hình) → T2 · §2 (harness sai) → T1 · §5 bước **B** phần còn lại (bí ẩn CUDA) → T5 (chỉ đo) · §3 bốn case → T6 · spec hồ sơ §3 điều kiện 2 (nối copilot qua gateway) → T2 · nợ "kbVectorStore nuốt throw" → T4.
⚠ **Cố ý ngoài phạm vi:** spec chiến lược §5 bước **A** (thành phần nắm ngân sách VRAM toàn cục cho cả 4 hộ tiêu thụ) — lớn hơn hẳn, cần spec riêng. Và **vá** bí ẩn CUDA — T5 chỉ điều tra.

**Placeholder scan:** không có "TBD". Các ô `*(điền)*` ở T6 là **số đo người thi công phải tự lấy**, kèm chỉ dẫn rõ — không phải placeholder bỏ ngỏ. Ba chỗ cố ý để người thi công quyết, đều kèm hướng dẫn khi gặp: T1 Step 5 (import hay khớp tham số — ghi rõ chọn gì và vì sao) · T2 Step 5 (nếu `routeInference` đổi model được chọn thì **dừng và báo**) · T5 Step 3 (có giả thuyết thì ghi là giả thuyết kèm phép thử).

**Type consistency:** `embeddingOnly?: boolean` (T3) là trường mới trên `GgufModelConfig`, chỉ T3 dùng. Tên file báo cáo `2026-08-02-dot2-report.md` nhất quán cả 6 task. Tên test không trùng file có sẵn (`inflight`/`embedCtx` là của Đợt 1; `embedNoTextCtx`/`ingestLog`/`metrics`/`production-parity` là mới).
