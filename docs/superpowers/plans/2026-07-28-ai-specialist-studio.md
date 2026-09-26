# Xưởng Agent chuyên môn (AI Specialist Studio) — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến 4 AI Agent chuyên môn (`data-analyst`, `backend-engineer`, `frontend-engineer`, `qa-optimizer`) từ "backend xây xong nhưng không có cửa vào" thành **gọi được từ UI, đọc được mã nguồn thật, và đo được chất lượng đầu ra**.

**Architecture:** Thêm một service chỉ-đọc `repoContextService` nạp nội dung file thật (có chặn bí mật + cap dung lượng) cộng RAG và đồ thị import, rồi chèn vào prompt của `runSpecialistAgent` đã có. Chuyển 3 procedure chạy-model sang **chạy nền trả `sessionId` ngay** (bảng phiên đã có sẵn cột `status`), siết RBAC toàn router về `admin`+`engineer`. Dựng trang `/ai-specialist-studio` giao việc/xem kết quả/lịch sử/audit/điểm chất lượng, và một nút "Giao việc →" ở Agent Command Center. Cuối cùng là thước đo kép: bảng chấm tay `ai_specialist_feedback` + bộ đề chuẩn 8 bài chạy CLI.

**Tech Stack:** TypeScript · tRPC · Drizzle ORM (postgres-js) · React 19 + TanStack Query · Vitest · node-llama-cpp (GGUF local) · i18next (vi/en/zh)

**Spec:** `docs/superpowers/specs/2026-07-28-ai-specialist-studio-design.md`

## Global Constraints

- Nhánh `feat/hmi-dep`. Mỗi task commit riêng, **chỉ stage file của task đó** — TUYỆT ĐỐI không `git add -A` (cây làm việc có sẵn thay đổi simulator/twin/knowledge chưa commit của người dùng). **Không push** (controller push ở chốt cuối).
- TDD: viết test đỏ trước → chạy để thấy đỏ → cài đặt tối thiểu → chạy để thấy xanh. **Không bao giờ làm yếu assertion để test qua.**
- `npx tsc --noEmit` phải sạch cho file đã chạm. Dùng `NODE_OPTIONS=--max-old-space-size=8192`. Lỗi `client/src/pages/SessionManagement.tsx(194,64)` là **có sẵn từ trước, không phải của bạn**.
- **Wave 1 là mức A (cố vấn).** TUYỆT ĐỐI không ghi file vào repo, không sinh patch, không tạo nhánh git, không đụng OT/điều khiển máy, không sửa 27 write-tool HITL.
- Chuỗi hiển thị cho người dùng phải qua `t(...)` với **mặc định tiếng Việt**; bổ sung khoá vào cả 3 file `client/src/i18n/locales/{vi,en,zh}.json`.
- Mọi truy vấn DB dùng drizzle builder; nếu dùng `db.execute(sql\`…\`)` thì nhớ postgres-js trả **rows trực tiếp** (khuôn `result.rows || result || []`).
- Bắt lỗi thiếu bảng/cột phải dùng cause-walker `isMissingTable`/`isMissingColumn` trong `server/_core/dbErrors.ts` (drizzle bọc mã lỗi pg trong `err.cause`) — **không** so sánh `err.code` trần.
- Không chạy model thật trong unit test. Mock `generateText` / `retrieveKnowledge`.
- Model GGUF chạy local ⇒ mã nguồn không rời máy; nhưng nội dung file vẫn phải qua `redactSecretsOnly()` trước khi vào prompt.

---

## Cấu trúc file

| File | Trách nhiệm | Task |
|---|---|---|
| `server/services/ai/repoContextService.ts` (**mới**) | Nạp ngữ cảnh repo chỉ-đọc: file thật + phụ thuộc + RAG | 1 |
| `server/services/ai/repoContextService.test.ts` (**mới**) | Test từng luật chặn + fail-safe | 1 |
| `server/services/aiSpecialistAgentService.ts` (sửa) | Chèn `repoContext` vào prompt | 2 |
| `server/services/aiSpecialistAgent.repoContext.test.ts` (**mới**) | Prompt có/không có mắt | 2 |
| `server/routers/aiSpecialistAgentRouter.ts` (sửa) | Chạy nền + siết RBAC + 2 procedure chấm điểm | 2, 3 |
| `server/routers/aiSpecialistAgentRouter.test.ts` (**mới**) | Chạy nền không chặn; lỗi ⇒ `failed` | 2 |
| `drizzle/0307_ai_specialist_feedback.sql` (**mới**) | Bảng chấm tay | 3 |
| `drizzle/schema/ai.ts` (sửa) | Khai báo bảng `aiSpecialistFeedback` | 3 |
| `server/db/aiSpecialist.ts` (sửa) | UPSERT feedback + bảng điểm | 3 |
| `server/db/aiSpecialistFeedback.test.ts` (**mới**) | UPSERT + tính % + tách có-mắt/không-mắt | 3 |
| `client/src/pages/AISpecialistStudio.tsx` (**mới**) | Trang Studio (4 thẻ) | 4, 5 |
| `client/src/lib/navigation.tsx` (sửa) | Mục nav + quyền | 4 |
| `client/src/App.tsx` (sửa) | Route + RouteGuard | 4 |
| `client/src/components/agentCenter/AgentDrillInDrawer.tsx` (sửa) | Nút "Giao việc →" | 5 |
| `scripts/ai-eval/eval-specialist.mjs` (**mới**) | Bộ đề chuẩn, chấm tự động | 6 |
| `scripts/ai-eval/specialist-cases/*.json` (**mới**, 8 file) | 8 bài từ bug thật | 6 |
| `scripts/ai-eval/eval-specialist.test.mjs` (**mới**) | Test hàm chấm | 6 |

---

## Task 1: `repoContextService` — cho agent "mắt"

**Files:**
- Create: `server/services/ai/repoContextService.ts`
- Test: `server/services/ai/repoContextService.test.ts`

**Interfaces:**
- Consumes: `redactSecretsOnly(text): { text: string; counts: RedactionCount }` từ `server/services/ai/aiSafety.ts:254`; `retrieveKnowledge(question, topK, context?): Promise<KbRetrieveResult>` từ `server/services/aiLocalKnowledgeService.ts:1576` (trả `{ question, intent, language, entities, confidence, citations, contexts }`).
- Produces: `classifyRepoPath(rel: string): RepoReadRejectReason | null` và `gatherRepoContext(input: GatherRepoContextInput): Promise<RepoContextResult>` — Task 2 dùng.

- [ ] **Step 1: Viết test đỏ cho luật chặn đường dẫn (hàm thuần)**

Tạo `server/services/ai/repoContextService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyRepoPath } from "./repoContextService";

describe("classifyRepoPath", () => {
  it("chấp nhận đường dẫn hợp lệ trong repo", () => {
    expect(classifyRepoPath("server/services/aiSpecialistAgentService.ts")).toBeNull();
    expect(classifyRepoPath("client/src/pages/AIHome.tsx")).toBeNull();
    expect(classifyRepoPath("drizzle/schema/ai.ts")).toBeNull();
  });

  it("từ chối đường dẫn tuyệt đối", () => {
    expect(classifyRepoPath("/etc/passwd")).toBe("ABSOLUTE");
    expect(classifyRepoPath("D:\\SOURCES\\secret.ts")).toBe("ABSOLUTE");
  });

  it("từ chối traversal và NUL", () => {
    expect(classifyRepoPath("../../../etc/passwd")).toBe("TRAVERSAL");
    expect(classifyRepoPath("server/../../outside.ts")).toBe("TRAVERSAL");
    expect(classifyRepoPath("server/a\u0000b.ts")).toBe("NUL");
  });

  it("chặn file bí mật", () => {
    expect(classifyRepoPath(".env")).toBe("DENIED_SECRET");
    expect(classifyRepoPath(".env.production")).toBe("DENIED_SECRET");
    expect(classifyRepoPath("certs/server.pem")).toBe("DENIED_SECRET");
    expect(classifyRepoPath("certs/server.key")).toBe("DENIED_SECRET");
    expect(classifyRepoPath("keys/id_rsa")).toBe("DENIED_SECRET");
  });

  it("chặn thư mục cấm", () => {
    expect(classifyRepoPath("node_modules/foo/index.js")).toBe("DENIED_DIR");
    expect(classifyRepoPath(".git/config")).toBe("DENIED_DIR");
    expect(classifyRepoPath("dist/index.js")).toBe("DENIED_DIR");
    expect(classifyRepoPath("uploads/x.json")).toBe("DENIED_DIR");
    expect(classifyRepoPath("knowledge/embeddings.jsonl")).toBe("DENIED_DIR");
  });

  it("chặn đuôi file ngoài danh sách cho phép", () => {
    expect(classifyRepoPath("assets/logo.png")).toBe("DENIED_EXT");
    expect(classifyRepoPath("bin/tool.exe")).toBe("DENIED_EXT");
  });

  it("chuẩn hoá dấu gạch ngược của Windows trước khi phân loại", () => {
    expect(classifyRepoPath("server\\services\\aiSafety.ts")).toBeNull();
    expect(classifyRepoPath("node_modules\\pkg\\a.js")).toBe("DENIED_DIR");
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/ai/repoContextService.test.ts`
Kỳ vọng: FAIL — không tìm thấy module `./repoContextService`.

- [ ] **Step 3: Cài đặt phần phân loại đường dẫn**

Tạo `server/services/ai/repoContextService.ts`:

```ts
/**
 * Wave 1 — Ngữ cảnh repo CHỈ-ĐỌC cho 4 specialist agent.
 *
 * Vì sao có file này: aiSpecialistAgentService KHÔNG có `fs` — trường `files[]`
 * chỉ được nhét vào prompt dưới dạng TÊN file, nên agent tư vấn mù. Service này
 * nạp nội dung THẬT (có giới hạn), file phụ thuộc (code-graph.json) và mảnh RAG.
 *
 * AN TOÀN: chỉ-đọc, KHÔNG có bất kỳ đường ghi nào; KHÔNG đăng ký vào toolRegistry
 * nên LLM không thể tự gọi với tham số tuỳ ý — chỉ service gọi với danh sách file
 * do NGƯỜI DÙNG nhập. Bí mật bị chặn 2 lớp: theo tên file + redactSecretsOnly().
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecretsOnly } from "./aiSafety";

export type RepoReadRejectReason =
  | "ABSOLUTE" | "TRAVERSAL" | "NUL" | "ESCAPE"
  | "DENIED_SECRET" | "DENIED_DIR" | "DENIED_EXT"
  | "NOT_FOUND" | "NOT_A_FILE" | "BUDGET_EXCEEDED";

const DENIED_FILE_PATTERNS: RegExp[] = [
  /^\.env$/i, /^\.env\./i, /\.pem$/i, /\.key$/i,
  /\.p12$/i, /\.pfx$/i, /\.keystore$/i, /^id_rsa/i,
];

const DENIED_DIR_PREFIXES = [
  "node_modules/", ".git/", "dist/", "uploads/",
  "knowledge/embeddings", ".superpowers/", ".playwright-mcp/",
];

const ALLOWED_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".sql", ".md", ".css", ".yml", ".yaml",
]);

/** Chuẩn hoá `\` → `/` và bỏ `./` đầu chuỗi. */
export function normalizeRepoPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Phân loại đường dẫn tương đối. Trả `null` nghĩa là HỢP LỆ để đọc.
 * Hàm thuần — không chạm đĩa (kiểm tra tồn tại là việc của gatherRepoContext).
 */
export function classifyRepoPath(input: string): RepoReadRejectReason | null {
  if (input.includes("\u0000")) return "NUL";
  const rel = normalizeRepoPath(input);
  if (!rel) return "NOT_FOUND";
  if (rel.startsWith("/") || /^[a-zA-Z]:\//.test(rel)) return "ABSOLUTE";
  if (rel.split("/").includes("..")) return "TRAVERSAL";

  const lower = rel.toLowerCase();
  for (const prefix of DENIED_DIR_PREFIXES) {
    if (lower.startsWith(prefix)) return "DENIED_DIR";
  }
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  for (const pattern of DENIED_FILE_PATTERNS) {
    if (pattern.test(base)) return "DENIED_SECRET";
  }
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return "DENIED_EXT";
  return null;
}
```

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/ai/repoContextService.test.ts`
Kỳ vọng: PASS 7/7.

- [ ] **Step 5: Viết test đỏ cho `gatherRepoContext` (đọc thật, cap, redact, fail-safe)**

Thêm vào cuối `server/services/ai/repoContextService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gatherRepoContext } from "./repoContextService";

vi.mock("../aiLocalKnowledgeService", () => ({
  retrieveKnowledge: vi.fn(),
}));
import { retrieveKnowledge } from "../aiLocalKnowledgeService";

describe("gatherRepoContext", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-"));
    fs.mkdirSync(path.join(root, "server", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "knowledge"), { recursive: true });
    fs.writeFileSync(path.join(root, "server/services/a.ts"), "export const A = 1;\n");
    fs.writeFileSync(path.join(root, "server/services/b.ts"), "export const B = 2;\n");
    fs.writeFileSync(path.join(root, ".env"), "DB_PASSWORD=supersecret\n");
    (retrieveKnowledge as any).mockResolvedValue({
      question: "q", intent: "howto", language: "vi", entities: [], confidence: 0.9,
      citations: [{ sourcePath: "server/services/b.ts", score: 0.81 }],
      contexts: ["nội dung liên quan"],
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("đọc nội dung THẬT của file được nêu", async () => {
    const r = await gatherRepoContext({ files: ["server/services/a.ts"], repoRoot: root, includeRag: false });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].path).toBe("server/services/a.ts");
    expect(r.files[0].content).toContain("export const A = 1;");
    expect(r.files[0].truncated).toBe(false);
    expect(r.totalBytes).toBeGreaterThan(0);
  });

  it("KHÔNG đọc file bí mật, đưa vào skipped", async () => {
    const r = await gatherRepoContext({ files: [".env"], repoRoot: root, includeRag: false });
    expect(r.files).toHaveLength(0);
    expect(r.skipped).toEqual([{ path: ".env", reason: "DENIED_SECRET" }]);
    expect(JSON.stringify(r)).not.toContain("supersecret");
  });

  it("cắt file vượt maxFileBytes và đánh dấu truncated", async () => {
    fs.writeFileSync(path.join(root, "server/services/big.ts"), "x".repeat(5000));
    const r = await gatherRepoContext({
      files: ["server/services/big.ts"], repoRoot: root, includeRag: false, maxFileBytes: 100,
    });
    expect(r.files[0].truncated).toBe(true);
    expect(r.files[0].content.length).toBeLessThanOrEqual(100);
    expect(r.files[0].bytes).toBe(5000);
  });

  it("dừng nạp khi vượt maxTotalBytes, phần còn lại là BUDGET_EXCEEDED", async () => {
    const r = await gatherRepoContext({
      files: ["server/services/a.ts", "server/services/b.ts"],
      repoRoot: root, includeRag: false, maxTotalBytes: 10,
    });
    expect(r.files).toHaveLength(1);
    expect(r.skipped).toEqual([{ path: "server/services/b.ts", reason: "BUDGET_EXCEEDED" }]);
  });

  it("file không tồn tại ⇒ NOT_FOUND, không ném", async () => {
    const r = await gatherRepoContext({ files: ["server/services/nope.ts"], repoRoot: root, includeRag: false });
    expect(r.skipped).toEqual([{ path: "server/services/nope.ts", reason: "NOT_FOUND" }]);
  });

  it("code-graph.json thiếu ⇒ dependencies rỗng, không ném", async () => {
    const r = await gatherRepoContext({
      files: ["server/services/a.ts"], repoRoot: root, includeRag: false, includeDependencies: true,
    });
    expect(r.dependencies).toEqual([]);
  });

  it("đọc file phụ thuộc từ code-graph.json khi có", async () => {
    fs.writeFileSync(
      path.join(root, "knowledge/code-graph.json"),
      JSON.stringify([{ from: "server/services/a.ts", to: "server/services/b.ts" }]),
    );
    const r = await gatherRepoContext({
      files: ["server/services/a.ts"], repoRoot: root, includeRag: false, includeDependencies: true,
    });
    expect(r.dependencies).toEqual(["server/services/b.ts"]);
  });

  it("retrieveKnowledge ném ⇒ ragSnippets rỗng, không ném", async () => {
    (retrieveKnowledge as any).mockRejectedValue(new Error("kb down"));
    const r = await gatherRepoContext({ objective: "sửa lỗi X", repoRoot: root, includeRag: true });
    expect(r.ragSnippets).toEqual([]);
  });

  it("lấy mảnh RAG khi bật", async () => {
    const r = await gatherRepoContext({ objective: "sửa lỗi X", repoRoot: root, includeRag: true });
    expect(r.ragSnippets.length).toBeGreaterThan(0);
    expect(r.ragSnippets[0].text).toBe("nội dung liên quan");
  });
});
```

- [ ] **Step 6: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/ai/repoContextService.test.ts`
Kỳ vọng: FAIL — `gatherRepoContext is not a function`.

- [ ] **Step 7: Cài đặt `gatherRepoContext`**

Thêm vào `server/services/ai/repoContextService.ts`:

```ts
export interface RepoFileRead {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  redacted: boolean;
}

export interface RepoContextResult {
  files: RepoFileRead[];
  skipped: Array<{ path: string; reason: RepoReadRejectReason }>;
  dependencies: string[];
  ragSnippets: Array<{ sourcePath: string; text: string; score: number }>;
  totalBytes: number;
}

export interface GatherRepoContextInput {
  files?: string[];
  objective?: string;
  includeRag?: boolean;
  includeDependencies?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  ragTopK?: number;
  /** Test seam — mặc định process.cwd(). */
  repoRoot?: string;
  /** Test seam — mặc định <repoRoot>/knowledge/code-graph.json. */
  codeGraphPath?: string;
}

export const DEFAULT_MAX_FILE_BYTES = 65_536;
export const DEFAULT_MAX_TOTAL_BYTES = 262_144;

/** Đọc file phụ thuộc từ code-graph.json. Fail-safe: lỗi/thiếu ⇒ []. */
function readDependencies(codeGraphPath: string, files: string[]): string[] {
  try {
    if (!fs.existsSync(codeGraphPath)) return [];
    const raw = JSON.parse(fs.readFileSync(codeGraphPath, "utf8"));
    if (!Array.isArray(raw)) return [];
    const wanted = new Set(files.map(normalizeRepoPath));
    const out = new Set<string>();
    for (const edge of raw) {
      const from = typeof edge?.from === "string" ? normalizeRepoPath(edge.from) : null;
      const to = typeof edge?.to === "string" ? normalizeRepoPath(edge.to) : null;
      if (from && to && wanted.has(from)) out.add(to);
    }
    return [...out];
  } catch {
    return [];
  }
}

export async function gatherRepoContext(input: GatherRepoContextInput): Promise<RepoContextResult> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const wantRag = input.includeRag ?? Boolean(input.objective);
  const wantDeps = input.includeDependencies ?? Boolean(input.files?.length);

  const files: RepoFileRead[] = [];
  const skipped: Array<{ path: string; reason: RepoReadRejectReason }> = [];
  let totalBytes = 0;

  for (const raw of input.files ?? []) {
    const rel = normalizeRepoPath(raw);
    const reason = classifyRepoPath(raw);
    if (reason) {
      skipped.push({ path: raw, reason });
      continue;
    }
    if (totalBytes >= maxTotalBytes) {
      skipped.push({ path: rel, reason: "BUDGET_EXCEEDED" });
      continue;
    }
    try {
      const abs = path.resolve(repoRoot, rel);
      // Chốt chặn cuối: sau resolve vẫn phải nằm trong gốc repo.
      const rootResolved = path.resolve(repoRoot);
      if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
        skipped.push({ path: rel, reason: "ESCAPE" });
        continue;
      }
      const stat = fs.statSync(abs);
      if (!stat.isFile()) {
        skipped.push({ path: rel, reason: "NOT_A_FILE" });
        continue;
      }
      const original = fs.readFileSync(abs, "utf8");
      const budgetLeft = maxTotalBytes - totalBytes;
      const limit = Math.min(maxFileBytes, budgetLeft);
      const truncated = original.length > limit;
      const sliced = truncated ? original.slice(0, limit) : original;
      const red = redactSecretsOnly(sliced);
      files.push({
        path: rel,
        content: red.text,
        bytes: stat.size,
        truncated,
        redacted: red.text !== sliced,
      });
      totalBytes += sliced.length;
    } catch {
      skipped.push({ path: rel, reason: "NOT_FOUND" });
    }
  }

  const dependencies = wantDeps
    ? readDependencies(input.codeGraphPath ?? path.join(repoRoot, "knowledge", "code-graph.json"), input.files ?? [])
    : [];

  let ragSnippets: RepoContextResult["ragSnippets"] = [];
  if (wantRag && input.objective) {
    try {
      const { retrieveKnowledge } = await import("../aiLocalKnowledgeService");
      const kb = await retrieveKnowledge(input.objective, input.ragTopK ?? 5);
      ragSnippets = (kb.contexts ?? []).map((text, i) => ({
        sourcePath: (kb.citations?.[i] as any)?.sourcePath ?? "(unknown)",
        text,
        score: Number((kb.citations?.[i] as any)?.score ?? 0),
      }));
    } catch {
      ragSnippets = [];
    }
  }

  return { files, skipped, dependencies, ragSnippets, totalBytes };
}
```

- [ ] **Step 8: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/ai/repoContextService.test.ts`
Kỳ vọng: PASS 16/16.

- [ ] **Step 9: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add server/services/ai/repoContextService.ts server/services/ai/repoContextService.test.ts
git commit -m "feat(ai/w1-1): repoContextService chỉ-đọc — cho specialist agent mắt (file thật + phụ thuộc + RAG)"
```

---

## Task 2: Nối "mắt" vào prompt + chạy nền + siết RBAC

**Files:**
- Modify: `server/services/aiSpecialistAgentService.ts` (`RunSpecialistAgentInput`, `buildUserPrompt`, `runSpecialistAgent`)
- Modify: `server/routers/aiSpecialistAgentRouter.ts` (3 procedure chạy-model + RBAC toàn router)
- Test: `server/services/aiSpecialistAgent.repoContext.test.ts`, `server/routers/aiSpecialistAgentRouter.test.ts`

**Interfaces:**
- Consumes: `gatherRepoContext(input): Promise<RepoContextResult>` và kiểu `RepoContextResult` từ Task 1.
- Produces: `RunSpecialistAgentInput.repoContext?: RepoContextResult`; 3 procedure `run` / `runWorkflowChain` / `runModuleAudit` nay **trả ngay `{ sessionId, started: true }`**; toàn router dùng `specialistProcedure = roleProcedure("admin","engineer").use(moduleGate("MOD_AI"))`. Task 4 dựa vào hình dạng trả về này.

- [ ] **Step 1: Viết test đỏ — prompt có/không có mắt**

Tạo `server/services/aiSpecialistAgent.repoContext.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(async () => ({
    text: JSON.stringify({ summary: "s", diagnosis: "d", actionPlan: [], patchHints: [], testPlan: [], optimizationIdeas: [], risks: [] }),
    modelId: "test-model",
    tokensGenerated: 10, tokensPrompt: 20, totalTimeMs: 100, tokensPerSecond: 5,
  })),
}));
import { generateText } from "./aiGgufEngine";
import { runSpecialistAgent } from "./aiSpecialistAgentService";

beforeEach(() => vi.clearAllMocks());

describe("runSpecialistAgent — repoContext", () => {
  it("KHÔNG có repoContext ⇒ prompt giữ nguyên hành vi cũ (chỉ tên file)", async () => {
    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
      files: ["server/services/a.ts"],
    });
    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Related files:");
    expect(prompt).toContain("server/services/a.ts");
    expect(prompt).not.toContain("FILE CONTENT");
  });

  it("CÓ repoContext ⇒ prompt chứa nội dung file THẬT + phụ thuộc + RAG", async () => {
    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
      files: ["server/services/a.ts"],
      repoContext: {
        files: [{ path: "server/services/a.ts", content: "export const A = 1;", bytes: 19, truncated: false, redacted: false }],
        skipped: [{ path: ".env", reason: "DENIED_SECRET" }],
        dependencies: ["server/services/b.ts"],
        ragSnippets: [{ sourcePath: "server/services/c.ts", text: "ngữ cảnh liên quan", score: 0.8 }],
        totalBytes: 19,
      },
    });
    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("FILE CONTENT");
    expect(prompt).toContain("export const A = 1;");
    expect(prompt).toContain("server/services/b.ts");
    expect(prompt).toContain("ngữ cảnh liên quan");
  });

  it("file bị cắt phải được nói rõ trong prompt (không giả vờ là đầy đủ)", async () => {
    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X",
      repoContext: {
        files: [{ path: "server/services/big.ts", content: "xxx", bytes: 999999, truncated: true, redacted: false }],
        skipped: [], dependencies: [], ragSnippets: [], totalBytes: 3,
      },
    });
    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("truncated");
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiSpecialistAgent.repoContext.test.ts`
Kỳ vọng: FAIL — prompt chưa chứa `FILE CONTENT`.

- [ ] **Step 3: Cài đặt — thêm `repoContext` vào input và prompt**

Trong `server/services/aiSpecialistAgentService.ts`, thêm import và mở rộng interface:

```ts
import type { RepoContextResult } from "./ai/repoContextService";
```

Thêm trường vào `RunSpecialistAgentInput` (sau `files?: string[];`):

```ts
  /** Wave 1 — ngữ cảnh repo đã nạp sẵn (nội dung file thật + phụ thuộc + RAG). */
  repoContext?: RepoContextResult;
```

Thêm hàm dựng khối ngữ cảnh, đặt ngay TRƯỚC `buildUserPrompt`:

```ts
/**
 * Wave 1 — dựng khối ngữ cảnh repo cho prompt. Trả chuỗi rỗng khi không có
 * repoContext, để prompt giữ NGUYÊN hành vi cũ (không đổi một byte).
 */
function buildRepoContextBlock(ctx?: RepoContextResult): string {
  if (!ctx) return "";
  const parts: string[] = [];

  if (ctx.files.length > 0) {
    const bodies = ctx.files.map((f) =>
      [
        `--- FILE CONTENT: ${f.path}${f.truncated ? " (truncated — only the first part is shown)" : ""}${f.redacted ? " (secrets redacted)" : ""} ---`,
        f.content,
      ].join("\n"),
    );
    parts.push(bodies.join("\n\n"));
  }

  if (ctx.skipped.length > 0) {
    parts.push(
      `Files NOT loaded (do not assume their content):\n${ctx.skipped
        .map((s) => `- ${s.path} (${s.reason})`)
        .join("\n")}`,
    );
  }

  if (ctx.dependencies.length > 0) {
    parts.push(`Files imported by the above:\n${ctx.dependencies.map((d) => `- ${d}`).join("\n")}`);
  }

  if (ctx.ragSnippets.length > 0) {
    parts.push(
      `Related context from the knowledge base:\n${ctx.ragSnippets
        .map((s) => `- (${s.sourcePath}) ${s.text}`)
        .join("\n")}`,
    );
  }

  return parts.join("\n\n");
}
```

Sửa `buildUserPrompt` — chèn khối ngữ cảnh ngay trước dòng "Focus your recommendations...":

```ts
function buildUserPrompt(input: RunSpecialistAgentInput): string {
  const repoBlock = buildRepoContextBlock(input.repoContext);
  return [
    `Objective: ${input.objective}`,
    `Module: ${input.moduleName ?? "(not specified)"}`,
    `Current behavior: ${input.currentBehavior ?? "(not specified)"}`,
    `Desired behavior: ${input.desiredBehavior ?? "(not specified)"}`,
    `Tech stack:\n${stringifyList(input.techStack)}`,
    `Constraints:\n${stringifyList(input.constraints)}`,
    `Acceptance criteria:\n${stringifyList(input.acceptanceCriteria)}`,
    `Related files:\n${stringifyList(input.files)}`,
    `Error logs:\n${input.errorLogs ?? "(none)"}`,
    "Code snippet:",
    input.codeSnippet ?? "(none)",
    ...(repoBlock ? [repoBlock] : []),
    "Focus your recommendations on this exact context only.",
  ].join("\n\n");
}
```

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiSpecialistAgent.repoContext.test.ts`
Kỳ vọng: PASS 3/3.

- [ ] **Step 5: Viết test đỏ — chạy nền không chặn**

Tạo `server/routers/aiSpecialistAgentRouter.test.ts`. Kiểm hành vi qua hàm nền tách riêng (đặt tên `runSpecialistSessionInBackground`, export từ router file để test được):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const completeMock = vi.fn(async () => {});
const appendMock = vi.fn(async () => {});
vi.mock("../db/aiSpecialist", () => ({
  createAiSpecialistSession: vi.fn(async () => ({ id: 42 })),
  appendAiSpecialistSessionStep: (...a: any[]) => appendMock(...a),
  completeAiSpecialistSession: (...a: any[]) => completeMock(...a),
  getAiSpecialistSessionById: vi.fn(async () => ({ id: 42 })),
  getAiSpecialistSessionDetail: vi.fn(async () => ({ id: 42 })),
  listAiSpecialistSessions: vi.fn(async () => []),
  getModuleImprovementStats: vi.fn(async () => ({})),
}));

const runAgentMock = vi.fn();
vi.mock("../services/aiSpecialistAgentService", () => ({
  runSpecialistAgent: (...a: any[]) => runAgentMock(...a),
  runSpecialistWorkflowChain: vi.fn(),
  listSpecialistAgents: vi.fn(() => []),
  buildWorkflowAgentOrder: vi.fn(() => ["backend-engineer"]),
  listModuleAuditPresets: vi.fn(() => []),
  getModuleAuditPreset: vi.fn(),
  SPECIALIST_BRIDGE_TOOLS: [],
  ensureSpecialistBridgeToolsRegistered: vi.fn(),
}));
vi.mock("../services/ai/repoContextService", () => ({
  gatherRepoContext: vi.fn(async () => ({ files: [], skipped: [], dependencies: [], ragSnippets: [], totalBytes: 0 })),
}));

import { runSpecialistSessionInBackground } from "./aiSpecialistAgentRouter";

beforeEach(() => { vi.clearAllMocks(); });

describe("runSpecialistSessionInBackground", () => {
  it("model lỗi ⇒ phiên được đánh dấu failed, KHÔNG ném ra ngoài", async () => {
    runAgentMock.mockRejectedValue(new Error("model boom"));
    await expect(
      runSpecialistSessionInBackground({
        sessionId: 42, userId: 1,
        runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
      }),
    ).resolves.toBeUndefined();
    expect(completeMock).toHaveBeenCalledWith(42, 1, expect.objectContaining({ status: "failed" }));
  });

  it("chạy xong ⇒ phiên completed + có bước được ghi", async () => {
    runAgentMock.mockResolvedValue({
      agent: { id: "backend-engineer" },
      modelId: "m",
      output: { summary: "ok" },
      metrics: { tokensPrompt: 1, tokensGenerated: 2, totalTimeMs: 3, tokensPerSecond: 4 },
    });
    await runSpecialistSessionInBackground({
      sessionId: 42, userId: 1,
      runInput: { agentId: "backend-engineer", objective: "x".repeat(20) },
    });
    expect(appendMock).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith(42, 1, expect.objectContaining({ status: "completed" }));
  });
});
```

- [ ] **Step 6: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/routers/aiSpecialistAgentRouter.test.ts`
Kỳ vọng: FAIL — `runSpecialistSessionInBackground` chưa tồn tại.

- [ ] **Step 7: Cài đặt chạy nền + siết RBAC**

Trong `server/routers/aiSpecialistAgentRouter.ts`:

(a) Đổi import và định nghĩa procedure chung — thay `import { router, protectedProcedure } from "../_core/trpc";` bằng:

```ts
import { router, roleProcedure, moduleGate } from "../_core/trpc";
import { gatherRepoContext } from "../services/ai/repoContextService";

/**
 * Wave 1 — siết RBAC: trước đây MỌI procedure là `protectedProcedure`, nghĩa là
 * bất kỳ user đăng nhập nào (kể cả operator) cũng chạy được model. Khuôn này
 * khớp aiAgentCenterRouter.ts:22 (roleProcedure + moduleGate("MOD_AI")).
 */
const specialistProcedure = roleProcedure("admin", "engineer").use(moduleGate("MOD_AI"));
```

Rồi thay **mọi** `protectedProcedure` trong file này bằng `specialistProcedure` (9 chỗ).

(b) Thêm cờ bật mắt vào `runInputSchema` (sau `files`):

```ts
  includeRepoContext: z.boolean().optional(),
```

(c) Thêm hàm nền (export để test được), đặt trên `export const aiSpecialistAgentRouter`:

```ts
/**
 * Wave 1 — chạy 1 phiên specialist ở tiến trình NỀN.
 * KHÔNG BAO GIỜ ném: mọi lỗi được ghi vào phiên dưới dạng status "failed", vì
 * hàm này chạy fire-and-forget (không ai await) — một promise reject không bắt
 * sẽ làm sập tiến trình Node.
 */
export async function runSpecialistSessionInBackground(args: {
  sessionId: number;
  userId: number;
  runInput: Parameters<typeof runSpecialistAgent>[0];
}): Promise<void> {
  const { sessionId, userId, runInput } = args;
  try {
    const result = await runSpecialistAgent(runInput);
    await appendAiSpecialistSessionStep({
      sessionId,
      stepOrder: 1,
      agentId: result.agent.id,
      status: "completed",
      inputPayload: runInput,
      outputPayload: result.output,
      modelId: result.modelId,
      tokensPrompt: result.metrics.tokensPrompt,
      tokensGenerated: result.metrics.tokensGenerated,
      totalTimeMs: result.metrics.totalTimeMs,
      tokensPerSecond: result.metrics.tokensPerSecond.toFixed(2),
    });
    await completeAiSpecialistSession(sessionId, userId, {
      status: "completed",
      summary: result.output.summary,
      aggregateOutput: { mode: "single", result: result.output, modelId: result.modelId },
    });
  } catch (error: any) {
    await completeAiSpecialistSession(sessionId, userId, {
      status: "failed",
      summary: error?.message ?? "Specialist run failed",
      aggregateOutput: { error: error?.message ?? "Unknown error" },
    }).catch(() => { /* phiên đã hỏng — không làm sập tiến trình nền */ });
  }
}
```

(d) Thay thân procedure `run` bằng bản chạy nền:

```ts
  run: specialistProcedure
    .input(runInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { saveHistory: _s, sessionId: _sid, includeRepoContext, ...runInput } = input;

      const created = await createAiSpecialistSession({
        userId: ctx.user.id,
        sessionType: "single",
        moduleName: runInput.moduleName,
        objective: runInput.objective,
        requestedAgents: [runInput.agentId],
        language: runInput.language ?? "vi",
        status: "running",
      });

      const repoContext =
        includeRepoContext === false
          ? undefined
          : await gatherRepoContext({ files: runInput.files, objective: runInput.objective });

      // Fire-and-forget: KHÔNG await — trả sessionId ngay để FE poll.
      void runSpecialistSessionInBackground({
        sessionId: created.id,
        userId: ctx.user.id,
        runInput: { ...runInput, repoContext },
      });

      return { sessionId: created.id, started: true as const };
    }),
```

Áp dụng cùng khuôn cho `runWorkflowChain` và `runModuleAudit`: tạo phiên → `gatherRepoContext` → `void` chạy nền (dùng `runSpecialistWorkflowChain` cho 2 procedure đó) → trả `{ sessionId, started: true }`.

- [ ] **Step 8: Chống phiên treo + test chống tụt quyền**

Phiên `running` quá lâu (tiến trình chết giữa chừng) sẽ treo mãi. Thêm vào `server/db/aiSpecialist.ts`:

```ts
/** Wave 1 — đánh dấu failed cho phiên đã chạy quá lâu (tiến trình nền chết giữa chừng). */
export async function expireStaleSpecialistSessions(timeoutMs: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - timeoutMs);
  const updated = await db
    .update(aiSpecialistSessions)
    .set({ status: "failed", summary: "Hết thời gian chờ — tiến trình nền không hoàn tất.", updatedAt: new Date() })
    .where(and(eq(aiSpecialistSessions.status, "running"), lt(aiSpecialistSessions.startedAt, cutoff)))
    .returning({ id: aiSpecialistSessions.id });
  return updated.length;
}
```

Thêm `lt` vào import `drizzle-orm` của file đó. Rồi gọi từ `runAgentHousekeepingOnce()` trong `server/services/aiAgentHousekeepingScheduler.ts` (cron đã chạy sẵn, mặc định BẬT):

```ts
  const { expireStaleSpecialistSessions } = await import("../db/aiSpecialist");
  const expiredSpecialist = await expireStaleSpecialistSessions(
    Number(process.env.AI_SPECIALIST_RUN_TIMEOUT_MS || 900_000),
  ).catch(() => 0);
```

Ghi `expiredSpecialist` vào log tổng kết + trả về trong đối tượng kết quả của hàm đó.

Thêm test chống tụt quyền vào `server/routers/aiSpecialistAgentRouter.test.ts`:

```ts
import fs from "node:fs";
it("KHÔNG còn procedure nào dùng protectedProcedure (chống tụt quyền về sau)", () => {
  const src = fs.readFileSync("server/routers/aiSpecialistAgentRouter.ts", "utf8");
  expect(src).not.toMatch(/\bprotectedProcedure\b/);
});
```

- [ ] **Step 9: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/routers/aiSpecialistAgentRouter.test.ts server/services/aiSpecialistAgent.repoContext.test.ts`
Kỳ vọng: PASS 6/6.

- [ ] **Step 10: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add server/services/aiSpecialistAgentService.ts server/routers/aiSpecialistAgentRouter.ts server/db/aiSpecialist.ts server/services/aiAgentHousekeepingScheduler.ts server/services/aiSpecialistAgent.repoContext.test.ts server/routers/aiSpecialistAgentRouter.test.ts
git commit -m "feat(ai/w1-2): nối mắt repo vào prompt specialist + chạy nền trả sessionId + siết RBAC admin/engineer + hết-hạn phiên treo"
```

---

## Task 3: Thước đo (a) — bảng chấm tay + 2 procedure

**Files:**
- Create: `drizzle/0307_ai_specialist_feedback.sql`
- Modify: `drizzle/schema/ai.ts` (thêm bảng `aiSpecialistFeedback` sau `aiSpecialistSessionSteps`)
- Modify: `server/db/aiSpecialist.ts` (thêm `upsertSpecialistFeedback`, `getSpecialistQualityScoreboard`)
- Modify: `server/routers/aiSpecialistAgentRouter.ts` (thêm `submitFeedback`, `getQualityScoreboard`)
- Test: `server/db/aiSpecialistFeedback.test.ts`

**Interfaces:**
- Consumes: `specialistProcedure` từ Task 2.
- Produces: `upsertSpecialistFeedback(input): Promise<{ ok: boolean }>`, `getSpecialistQualityScoreboard(userId?): Promise<QualityScoreboard>` với `QualityScoreboard = { rows: Array<{ agentId: string; moduleName: string | null; total: number; usefulPct: number; partialPct: number; uselessPct: number; withEyesUsefulPct: number | null; withoutEyesUsefulPct: number | null }>; overall: { total: number; usefulPct: number } }`. Task 5 hiển thị.

- [ ] **Step 1: Viết migration**

Tạo `drizzle/0307_ai_specialist_feedback.sql`:

```sql
-- Wave 1 — chấm tay chất lượng đầu ra của specialist agent.
-- Idempotent (IF NOT EXISTS) theo đúng khuôn migration 0298-0306.
CREATE TABLE IF NOT EXISTS "ai_specialist_feedback" (
  "id" serial PRIMARY KEY,
  "sessionId" integer NOT NULL,
  "userId" integer NOT NULL,
  "agentId" varchar(64) NOT NULL,
  "moduleName" varchar(255),
  "rating" varchar(16) NOT NULL,
  "usefulSections" json,
  "reason" text,
  "repoContextUsed" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_specialist_feedback_session_user"
  ON "ai_specialist_feedback" ("sessionId", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_feedback_agent"
  ON "ai_specialist_feedback" ("agentId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_specialist_feedback_module"
  ON "ai_specialist_feedback" ("moduleName");
```

- [ ] **Step 2: Khai báo bảng trong drizzle schema**

Thêm vào `drizzle/schema/ai.ts` ngay sau khối `aiSpecialistSessionSteps`:

```ts
/** Wave 1 — chấm tay mức hữu ích của một phiên specialist (1 người 1 phiếu/phiên). */
export const aiSpecialistFeedback = pgTable("ai_specialist_feedback", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  userId: integer("userId").notNull(),
  agentId: varchar("agentId", { length: 64 }).notNull(),
  moduleName: varchar("moduleName", { length: 255 }),
  rating: varchar("rating", { length: 16 }).notNull(),
  usefulSections: json("usefulSections").$type<string[]>(),
  reason: text("reason"),
  repoContextUsed: boolean("repoContextUsed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_ai_specialist_feedback_session_user").on(table.sessionId, table.userId),
  index("idx_ai_specialist_feedback_agent").on(table.agentId),
  index("idx_ai_specialist_feedback_module").on(table.moduleName),
]);

export type AiSpecialistFeedback = typeof aiSpecialistFeedback.$inferSelect;
export type InsertAiSpecialistFeedback = typeof aiSpecialistFeedback.$inferInsert;
```

Kiểm tra `boolean` và `uniqueIndex` đã có trong danh sách import ở đầu file; nếu thiếu thì thêm vào import từ `drizzle-orm/pg-core`.

- [ ] **Step 3: Viết test đỏ cho DB layer**

Tạo `server/db/aiSpecialistFeedback.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
const fakeDb = {
  insert: () => ({
    values: (v: any) => ({
      onConflictDoUpdate: ({ set }: any) => {
        const i = rows.findIndex((r) => r.sessionId === v.sessionId && r.userId === v.userId);
        if (i >= 0) rows[i] = { ...rows[i], ...set, ...v };
        else rows.push({ ...v });
        return Promise.resolve();
      },
    }),
  }),
  select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
};
// LƯU Ý: server/db/aiSpecialist.ts import getDb từ "./connection" (KHÔNG phải "../db").
vi.mock("./connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { upsertSpecialistFeedback, getSpecialistQualityScoreboard } from "./aiSpecialist";

beforeEach(() => { rows.length = 0; vi.clearAllMocks(); });

describe("upsertSpecialistFeedback", () => {
  it("chấm lại cùng phiên bởi cùng người ⇒ GHI ĐÈ, không tạo dòng trùng", async () => {
    await upsertSpecialistFeedback({ sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "partial", repoContextUsed: true });
    await upsertSpecialistFeedback({ sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe("useful");
  });
});

describe("getSpecialistQualityScoreboard", () => {
  it("tính đúng % theo agent × module", async () => {
    rows.push(
      { sessionId: 1, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: true },
      { sessionId: 2, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useless", repoContextUsed: true },
      { sessionId: 3, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useful", repoContextUsed: false },
      { sessionId: 4, userId: 7, agentId: "backend-engineer", moduleName: "ai", rating: "useless", repoContextUsed: false },
    );
    const sb = await getSpecialistQualityScoreboard();
    const row = sb.rows.find((r) => r.agentId === "backend-engineer" && r.moduleName === "ai")!;
    expect(row.total).toBe(4);
    expect(row.usefulPct).toBe(50);
    expect(row.uselessPct).toBe(50);
    expect(sb.overall.total).toBe(4);
    expect(sb.overall.usefulPct).toBe(50);
  });

  it("tách được có-mắt và không-mắt (để biết mắt có giúp thật không)", async () => {
    rows.push(
      { sessionId: 1, userId: 7, agentId: "qa-optimizer", moduleName: null, rating: "useful", repoContextUsed: true },
      { sessionId: 2, userId: 7, agentId: "qa-optimizer", moduleName: null, rating: "useful", repoContextUsed: true },
      { sessionId: 3, userId: 7, agentId: "qa-optimizer", moduleName: null, rating: "useless", repoContextUsed: false },
    );
    const row = (await getSpecialistQualityScoreboard()).rows.find((r) => r.agentId === "qa-optimizer")!;
    expect(row.withEyesUsefulPct).toBe(100);
    expect(row.withoutEyesUsefulPct).toBe(0);
  });

  it("không có phiếu nào ⇒ rows rỗng, overall 0, không ném", async () => {
    const sb = await getSpecialistQualityScoreboard();
    expect(sb.rows).toEqual([]);
    expect(sb.overall).toEqual({ total: 0, usefulPct: 0 });
  });
});
```

- [ ] **Step 4: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/db/aiSpecialistFeedback.test.ts`
Kỳ vọng: FAIL — chưa export `upsertSpecialistFeedback`.

- [ ] **Step 5: Cài đặt DB layer**

Thêm vào cuối `server/db/aiSpecialist.ts`:

```ts
import { aiSpecialistFeedback } from "../../drizzle/schema";

export type SpecialistRating = "useful" | "partial" | "useless";

export interface UpsertSpecialistFeedbackInput {
  sessionId: number;
  userId: number;
  agentId: string;
  moduleName?: string | null;
  rating: SpecialistRating;
  usefulSections?: string[];
  reason?: string | null;
  repoContextUsed: boolean;
}

export interface QualityScoreboardRow {
  agentId: string;
  moduleName: string | null;
  total: number;
  usefulPct: number;
  partialPct: number;
  uselessPct: number;
  withEyesUsefulPct: number | null;
  withoutEyesUsefulPct: number | null;
}

export interface QualityScoreboard {
  rows: QualityScoreboardRow[];
  overall: { total: number; usefulPct: number };
}

/** 1 người 1 phiếu / phiên — chấm lại thì ghi đè (khớp unique index sessionId+userId). */
export async function upsertSpecialistFeedback(
  input: UpsertSpecialistFeedbackInput,
): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  await db
    .insert(aiSpecialistFeedback)
    .values({
      sessionId: input.sessionId,
      userId: input.userId,
      agentId: input.agentId,
      moduleName: input.moduleName ?? null,
      rating: input.rating,
      usefulSections: input.usefulSections ?? [],
      reason: input.reason ?? null,
      repoContextUsed: input.repoContextUsed,
    })
    .onConflictDoUpdate({
      target: [aiSpecialistFeedback.sessionId, aiSpecialistFeedback.userId],
      set: {
        rating: input.rating,
        usefulSections: input.usefulSections ?? [],
        reason: input.reason ?? null,
        repoContextUsed: input.repoContextUsed,
        updatedAt: new Date(),
      },
    });
  return { ok: true };
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** Bảng điểm chất lượng, nhóm theo agent × module, kèm tách có-mắt/không-mắt. */
export async function getSpecialistQualityScoreboard(userId?: number): Promise<QualityScoreboard> {
  const db = await getDb();
  if (!db) return { rows: [], overall: { total: 0, usefulPct: 0 } };

  const all: any[] = await db
    .select()
    .from(aiSpecialistFeedback)
    .where(userId ? eq(aiSpecialistFeedback.userId, userId) : undefined as any);

  const groups = new Map<string, any[]>();
  for (const r of all) {
    const key = `${r.agentId}::${r.moduleName ?? ""}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  const rows: QualityScoreboardRow[] = [];
  for (const [key, items] of groups) {
    const [agentId, moduleRaw] = key.split("::");
    const withEyes = items.filter((i) => i.repoContextUsed === true);
    const withoutEyes = items.filter((i) => i.repoContextUsed !== true);
    rows.push({
      agentId,
      moduleName: moduleRaw === "" ? null : moduleRaw,
      total: items.length,
      usefulPct: pct(items.filter((i) => i.rating === "useful").length, items.length),
      partialPct: pct(items.filter((i) => i.rating === "partial").length, items.length),
      uselessPct: pct(items.filter((i) => i.rating === "useless").length, items.length),
      withEyesUsefulPct: withEyes.length
        ? pct(withEyes.filter((i) => i.rating === "useful").length, withEyes.length)
        : null,
      withoutEyesUsefulPct: withoutEyes.length
        ? pct(withoutEyes.filter((i) => i.rating === "useful").length, withoutEyes.length)
        : null,
    });
  }

  return {
    rows,
    overall: {
      total: all.length,
      usefulPct: pct(all.filter((i) => i.rating === "useful").length, all.length),
    },
  };
}
```

- [ ] **Step 6: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/db/aiSpecialistFeedback.test.ts`
Kỳ vọng: PASS 4/4.

- [ ] **Step 7: Thêm 2 procedure vào router**

Thêm vào `server/routers/aiSpecialistAgentRouter.ts` (dùng `specialistProcedure` của Task 2):

```ts
  submitFeedback: specialistProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      agentId: z.string().min(1).max(64),
      moduleName: z.string().max(255).optional(),
      rating: z.enum(["useful", "partial", "useless"]),
      usefulSections: z.array(z.enum([
        "diagnosis", "actionPlan", "patchHints", "testPlan", "optimizationIdeas", "risks",
      ])).max(6).optional(),
      reason: z.string().max(500).optional(),
      repoContextUsed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await getAiSpecialistSessionById(input.sessionId, ctx.user.id);
      if (!session) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Session does not belong to current user" });
      }
      return upsertSpecialistFeedback({ ...input, userId: ctx.user.id });
    }),

  getQualityScoreboard: specialistProcedure
    .input(z.object({ mineOnly: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getSpecialistQualityScoreboard(input?.mineOnly ? ctx.user.id : undefined);
    }),
```

Nhớ thêm `upsertSpecialistFeedback, getSpecialistQualityScoreboard` vào khối import từ `../db/aiSpecialist`.

- [ ] **Step 8: Chạy test + typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/db/aiSpecialistFeedback.test.ts server/routers/aiSpecialistAgentRouter.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add drizzle/0307_ai_specialist_feedback.sql drizzle/schema/ai.ts server/db/aiSpecialist.ts server/db/aiSpecialistFeedback.test.ts server/routers/aiSpecialistAgentRouter.ts
git commit -m "feat(ai/w1-3): bảng ai_specialist_feedback (mig 0307) + chấm tay + bảng điểm chất lượng có/không có mắt"
```

**LƯU Ý:** KHÔNG tự chạy migration lên DB. Controller chạy bằng owner `aoi` ở chốt cuối.

---

## Task 4: Trang Studio — thẻ "Giao việc" + "Kết quả"

**Files:**
- Create: `client/src/pages/AISpecialistStudio.tsx`
- Modify: `client/src/lib/navigation.tsx` (mục nav mới, section `agentOps`)
- Modify: `client/src/App.tsx` (route + RouteGuard)
- Modify: `client/src/i18n/locales/{vi,en,zh}.json`

**Interfaces:**
- Consumes: `trpc.aiSpecialistAgent.listAgents` · `.run` (trả `{ sessionId, started }` — Task 2) · `.getSessionDetail({ sessionId })` · `.submitFeedback` (Task 3).
- Produces: route `/ai-specialist-studio`, đọc query param `?agent=<id>` để chọn sẵn agent — Task 5 dùng để deep-link.

- [ ] **Step 1: Thêm mục nav (quyền admin+engineer)**

Trong `client/src/lib/navigation.tsx`, thêm vào nhóm `ai`, ngay sau mục `/ai-command-center`:

```tsx
      {
        // Wave 1 — cửa vào GIAO VIỆC cho 4 specialist agent. Cùng bộ quyền với
        // /ai-command-center vì đây là việc phát triển phần mềm, không phải vận hành.
        href: "/ai-specialist-studio",
        label: "nav.aiSpecialistStudio",
        icon: <Wrench className="h-4 w-4" />,
        description: "nav.aiSpecialistStudioDesc",
        requiredRole: ['admin', 'engineer'],
        permissionCategory: "admin",
        section: "agentOps",
      },
```

Thêm `Wrench` vào import icon từ `lucide-react` ở đầu file nếu chưa có.

- [ ] **Step 2: Thêm khoá i18n**

Thêm vào `client/src/i18n/locales/vi.json` (trong đối tượng `nav`):

```json
"aiSpecialistStudio": "Xưởng Agent chuyên môn",
"aiSpecialistStudioDesc": "Giao việc cho AI Agent chuyên môn: phân tích, refactor backend, UX frontend, chiến lược kiểm thử"
```

Tương ứng `en.json`: `"aiSpecialistStudio": "Specialist Studio"`, `"aiSpecialistStudioDesc": "Dispatch work to specialist AI agents: analysis, backend refactor, frontend UX, QA strategy"`.
Tương ứng `zh.json`: `"aiSpecialistStudio": "专家代理工作室"`, `"aiSpecialistStudioDesc": "向专业 AI 代理派发任务：分析、后端重构、前端 UX、测试策略"`.

- [ ] **Step 3: Thêm route**

Trong `client/src/App.tsx`, thêm import lazy cạnh các trang AI khác và route ngay sau `/ai-command-center`:

```tsx
      <Route path="/ai-specialist-studio"><RouteGuard navHref="/ai-specialist-studio"><AIPageWrapper><AISpecialistStudio /></AIPageWrapper></RouteGuard></Route>
```

- [ ] **Step 4: Dựng trang — thẻ Giao việc + Kết quả**

Tạo `client/src/pages/AISpecialistStudio.tsx`. Yêu cầu bắt buộc:

- Đọc `?agent=<id>` từ `window.location.search` để đặt agent mặc định.
- Form: chọn agent (4 nút thẻ, lấy tên từ `listAgents`) · **Mục tiêu** (`textarea`, bắt buộc, chặn gửi khi `< 10` ký tự) · **Module** (`input`) · **File liên quan** (`textarea`, mỗi dòng 1 đường dẫn, chuyển thành `string[]`) · công tắc **"Cho agent đọc mã nguồn"** (mặc định BẬT → `includeRepoContext`) · nhóm **Nâng cao** (`<details>`) chứa `currentBehavior`, `desiredBehavior`, `errorLogs`, `codeSnippet`.
- Bấm "Giao việc" → `runMutation.mutateAsync({...})` → lưu `sessionId` vào state.
- Khi có `sessionId`: `trpc.aiSpecialistAgent.getSessionDetail.useQuery({ sessionId }, { refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false) })` — **dừng poll khi không còn `running`**.
- Trạng thái `running`: hiện spinner + chữ "Đang chạy…" — **KHÔNG hiện thanh phần trăm giả**.
- Trạng thái `failed`: hiện `summary` (thông điệp lỗi thật) trong khối cảnh báo.
- Trạng thái `completed`: render 7 khối theo đúng khoá `summary` · `diagnosis` · `actionPlan` · `patchHints` · `testPlan` · `optimizationIdeas` · `risks` (lấy từ `aggregateOutput.result`), mỗi khối có nút sao chép; kèm dòng meta model/token/thời gian.
- Dưới kết quả: thanh chấm 3 nút (`Dùng được` / `Dùng được một phần` / `Vô dụng`) + ô lý do → `submitFeedback.mutateAsync({ sessionId, agentId, moduleName, rating, reason, repoContextUsed })`. Sau khi gửi hiện xác nhận đã ghi.
- **Câu chữ bắt buộc** dưới nút Giao việc (chống hiểu nhầm): `t("specialistStudio.advisoryNotice", "Agent chỉ đưa ra KHUYẾN NGHỊ — không có thay đổi nào được áp dụng vào mã nguồn.")`.
- Dùng primitive `Card`/`Button`/`Input`/`Textarea`/`Tabs` sẵn có trong `client/src/components/ui/`; mọi chuỗi qua `t(...)` với mặc định tiếng Việt.

Bộ khung bắt buộc cho phần cơ chế (giao việc → poll → hiển thị → chấm). Phần trình bày còn lại tự dựng theo phong cách các trang AI hiện có:

```tsx
const OUTPUT_SECTIONS = [
  "summary", "diagnosis", "actionPlan", "patchHints",
  "testPlan", "optimizationIdeas", "risks",
] as const;

export default function AISpecialistStudio() {
  const { t } = useTranslation();
  const preselected = new URLSearchParams(window.location.search).get("agent");
  const [agentId, setAgentId] = useState(preselected ?? "backend-engineer");
  const [objective, setObjective] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [filesText, setFilesText] = useState("");
  const [useEyes, setUseEyes] = useState(true);
  const [sessionId, setSessionId] = useState<number | null>(null);

  const agents = trpc.aiSpecialistAgent.listAgents.useQuery();
  const runMutation = trpc.aiSpecialistAgent.run.useMutation();

  // Poll CHỈ khi phiên còn chạy — dừng hẳn khi completed/failed.
  const session = trpc.aiSpecialistAgent.getSessionDetail.useQuery(
    { sessionId: sessionId! },
    {
      enabled: sessionId !== null,
      refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
    },
  );

  async function handleDispatch() {
    const files = filesText.split("\n").map((s) => s.trim()).filter(Boolean);
    const res = await runMutation.mutateAsync({
      agentId: agentId as any,
      objective,
      moduleName: moduleName || undefined,
      files: files.length ? files : undefined,
      includeRepoContext: useEyes,
      language: "vi",
    });
    setSessionId(res.sessionId);
  }

  const status = session.data?.status;
  const output = (session.data?.aggregateOutput as any)?.result;
  // ... render: form → nếu status==="running" hiện spinner (KHÔNG % giả)
  //             → nếu "failed" hiện session.data.summary trong khối cảnh báo
  //             → nếu "completed" render <SpecialistResultView output={output} /> + <FeedbackBar />
}
```

Thanh chấm điểm (tách thành component trong cùng file, Task 5 dùng lại):

```tsx
function FeedbackBar({ sessionId, agentId, moduleName, repoContextUsed }: {
  sessionId: number; agentId: string; moduleName?: string; repoContextUsed: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const submit = trpc.aiSpecialistAgent.submitFeedback.useMutation();

  const RATINGS = [
    { key: "useful", label: t("specialistStudio.rating.useful", "Dùng được") },
    { key: "partial", label: t("specialistStudio.rating.partial", "Dùng được một phần") },
    { key: "useless", label: t("specialistStudio.rating.useless", "Vô dụng") },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {RATINGS.map((r) => (
        <Button key={r.key} variant="outline" onClick={async () => {
          await submit.mutateAsync({ sessionId, agentId, moduleName, rating: r.key, reason: reason || undefined, repoContextUsed });
          setSaved(true);
        }}>{r.label}</Button>
      ))}
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder={t("specialistStudio.reasonPlaceholder", "Lý do (tuỳ chọn)")}
      />
      {saved && <span className="text-sm text-muted-foreground">{t("specialistStudio.feedbackSaved", "Đã ghi nhận")}</span>}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
Kỳ vọng: chỉ còn lỗi có sẵn `SessionManagement.tsx`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AISpecialistStudio.tsx client/src/lib/navigation.tsx client/src/App.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w1-4): trang /ai-specialist-studio — giao việc cho specialist agent + theo dõi phiên + chấm điểm"
```

---

## Task 5: Studio — Lịch sử/Audit/Chất lượng + nút ở Command Center

**Files:**
- Modify: `client/src/pages/AISpecialistStudio.tsx` (thêm 3 thẻ)
- Modify: `client/src/components/agentCenter/AgentDrillInDrawer.tsx` (nút "Giao việc →")
- Modify: `client/src/i18n/locales/{vi,en,zh}.json`

**Interfaces:**
- Consumes: `trpc.aiSpecialistAgent.listSessions` · `.getSessionDetail` · `.listModuleAuditPresets` · `.runModuleAudit` (trả `{ sessionId, started }`) · `.getQualityScoreboard` (Task 3).
- Produces: không có API mới.

- [ ] **Step 1: Thẻ "Lịch sử"**

Trong `AISpecialistStudio.tsx` thêm thẻ dùng `listSessions.useQuery({ limit: 20 })`: bảng gồm thời gian, `sessionType`, agent, module, `status` (badge màu theo `completed`/`failed`/`running`), mục tiêu rút gọn. Bấm 1 dòng → nạp `sessionId` đó vào thẻ Kết quả (tái dùng đúng khối render 7 phần của Task 4, **không sao chép lại mã** — tách thành component `SpecialistResultView` trong cùng file và dùng chung).

- [ ] **Step 2: Thẻ "Audit module"**

Dùng `listModuleAuditPresets.useQuery()` → hiện 5 thẻ preset (tên + module + mục tiêu rút gọn), mỗi thẻ một nút "Chạy audit" → `runModuleAudit.mutateAsync({ presetId })` → nhận `sessionId` → chuyển sang thẻ Kết quả và bắt đầu poll (tái dùng đúng cơ chế poll của Task 4).

- [ ] **Step 3: Thẻ "Chất lượng"**

Dùng `getQualityScoreboard.useQuery({ mineOnly: true })`. Hiện:
- Dòng tổng: tổng số phiếu + `% Dùng được`.
- Bảng theo agent × module: `total`, `usefulPct`, `partialPct`, `uselessPct`, `withEyesUsefulPct`, `withoutEyesUsefulPct` (hiện `—` khi `null`).
- Khối **"Luật quyết định mức B"** hiện trạng thái thật: cần `≥20 phiếu` và `usefulPct ≥ 50%`; hiện rõ còn thiếu bao nhiêu phiếu. Chưa đủ điều kiện thì ghi "Chưa đủ dữ liệu để quyết định" — **không** suy đoán.

- [ ] **Step 4: Nút "Giao việc →" ở Command Center**

Trong `client/src/components/agentCenter/AgentDrillInDrawer.tsx`, tại nhánh `SimpleAgentDetail`: khi `entry.kind === "specialist"`, thay dòng "Xem nhanh — chưa có hành động khả dụng ở đây." bằng nút điều hướng:

```tsx
{entry.kind === "specialist" && (
  <Button
    className="w-full"
    onClick={() => navigate(`/ai-specialist-studio?agent=${encodeURIComponent(specialistIdOf(entry.id))}`)}
  >
    {t("agentCenter.dispatchWork", "Giao việc →")}
  </Button>
)}
```

`specialistIdOf` chuyển id roster `specialist-data-analyst` → `data-analyst` (bỏ tiền tố `specialist-`). Các `kind` khác giữ nguyên dòng chữ cũ.

- [ ] **Step 5: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add client/src/pages/AISpecialistStudio.tsx client/src/components/agentCenter/AgentDrillInDrawer.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w1-5): Studio thẻ Lịch sử/Audit/Chất lượng + nút Giao việc từ Agent Command Center"
```

---

## Task 6: Thước đo (b) — bộ đề chuẩn 8 bài

**Files:**
- Create: `scripts/ai-eval/eval-specialist.mjs`
- Create: `scripts/ai-eval/specialist-cases/*.json` (8 file)
- Create: `scripts/ai-eval/eval-specialist.test.mjs`
- Modify: `package.json` (script `eval:specialist`)

**Interfaces:**
- Consumes: `runSpecialistAgent` + `gatherRepoContext` (chạy trực tiếp trong Node, không qua tRPC).
- Produces: `scoreCase(output, expected): { rootCause: number; location: number; fixDirection: number; total: number }` — hàm thuần, test được.

- [ ] **Step 1: Viết 8 ca đề từ bug THẬT**

Mỗi file `scripts/ai-eval/specialist-cases/<id>.json` theo đúng hình dạng:

```json
{
  "id": "w0-action-inbox-dead-import",
  "title": "Action Inbox không bao giờ trả cảnh báo bất thường",
  "agentId": "backend-engineer",
  "objective": "Hàm listAlerts trong server/services/aiActionInbox.ts luôn trả mảng rỗng cho nhánh bất thường dù dữ liệu bất thường có tồn tại. Tìm nguyên nhân gốc và cách sửa.",
  "files": ["server/services/aiActionInbox.ts", "server/routers/aiAnomalyRouter.ts"],
  "expected": {
    "rootCauseKeywords": ["import", "không tồn tại", "undefined", "latestForMachine"],
    "mustMentionFiles": ["server/services/aiActionInbox.ts"],
    "fixDirectionKeywords": ["readMachineStatuses", "nguồn thật", "aiAnomalyRouter"]
  },
  "notes": "Bug thật đã sửa ở Wave 0, commit 6b91c909."
}
```

8 ca lấy từ lịch sử git (dùng `git log --oneline` + nội dung commit để lấy đáp án thật). **Bắt buộc gồm 2 ca đã chốt:** `w0-action-inbox-dead-import` (ở trên) và `w0-vlm-description-not-surfaced` (mô tả VLM chỉ ghi vào `ai_image_embeddings.metadata` nên màn Repair Station đọc `measurement_results.aiAnalysisResult` không bao giờ thấy — commit `6b91c909`). 6 ca còn lại chọn từ các commit `fix(...)` trong `git log`, mỗi ca phải có nguyên nhân gốc rõ ràng và ghi `notes` trỏ đúng commit.

- [ ] **Step 2: Viết test đỏ cho hàm chấm**

Tạo `scripts/ai-eval/eval-specialist.test.mjs` (dùng `node:test` để tự chạy được, giống `scripts/ai-kb/check-kb-stale.test.mjs`):

```js
// Run: node scripts/ai-eval/eval-specialist.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCase } from "./eval-specialist.mjs";

const expected = {
  rootCauseKeywords: ["import", "undefined", "latestForMachine"],
  mustMentionFiles: ["server/services/aiActionInbox.ts"],
  fixDirectionKeywords: ["readMachineStatuses"],
};

test("đáp án hoàn hảo ⇒ 1.0", () => {
  const out = {
    summary: "Hàm import latestForMachine không tồn tại nên trả undefined.",
    diagnosis: "Lỗi ở server/services/aiActionInbox.ts",
    actionPlan: ["Dùng readMachineStatuses làm nguồn thật"],
  };
  const s = scoreCase(out, expected);
  assert.equal(s.rootCause, 1);
  assert.equal(s.location, 1);
  assert.equal(s.fixDirection, 1);
  assert.equal(s.total, 1);
});

test("thiếu hết ⇒ 0", () => {
  const s = scoreCase({ summary: "không liên quan" }, expected);
  assert.equal(s.total, 0);
});

test("nguyên nhân đạt ngưỡng 60% từ khoá ⇒ rootCause = 1", () => {
  const s = scoreCase({ summary: "import bị undefined" }, expected);
  assert.equal(s.rootCause, 1);
});

test("dưới ngưỡng 60% ⇒ rootCause = 0", () => {
  const s = scoreCase({ summary: "chỉ có import thôi" }, expected);
  assert.equal(s.rootCause, 0);
});
```

- [ ] **Step 3: Chạy test để thấy ĐỎ**

Chạy: `node scripts/ai-eval/eval-specialist.test.mjs`
Kỳ vọng: FAIL — không tìm thấy `./eval-specialist.mjs`.

- [ ] **Step 4: Cài đặt hàm chấm + CLI**

Tạo `scripts/ai-eval/eval-specialist.mjs`:

```js
/**
 * Wave 1 — bộ đề chuẩn cho 4 specialist agent.
 *
 * Chấm 3 tiêu chí, mỗi tiêu chí 0/1, điểm bài = trung bình:
 *   1. Đúng nguyên nhân — đạt >= 60% số rootCauseKeywords.
 *   2. Đúng chỗ        — nêu >= 1 file trong mustMentionFiles.
 *   3. Đúng hướng sửa  — chứa >= 1 fixDirectionKeywords.
 *
 * CHẠY THỦ CÔNG (mỗi lượt gọi model 30B mất vài phút — KHÔNG đưa vào CI):
 *   npm run eval:specialist
 */
export const ROOT_CAUSE_THRESHOLD = 0.6;

/** Gộp toàn bộ đầu ra agent thành một chuỗi thường để dò từ khoá. */
export function flattenOutput(output) {
  return JSON.stringify(output ?? {}).toLowerCase();
}

export function scoreCase(output, expected) {
  const hay = flattenOutput(output);
  const rcKeys = expected.rootCauseKeywords ?? [];
  const hits = rcKeys.filter((k) => hay.includes(String(k).toLowerCase())).length;
  const rootCause = rcKeys.length === 0 ? 0 : hits / rcKeys.length >= ROOT_CAUSE_THRESHOLD ? 1 : 0;

  const files = expected.mustMentionFiles ?? [];
  const location = files.some((f) => hay.includes(String(f).toLowerCase())) ? 1 : 0;

  const fixKeys = expected.fixDirectionKeywords ?? [];
  const fixDirection = fixKeys.some((k) => hay.includes(String(k).toLowerCase())) ? 1 : 0;

  return {
    rootCause,
    location,
    fixDirection,
    total: Number(((rootCause + location + fixDirection) / 3).toFixed(3)),
  };
}
```

Phần CLI, thêm vào cuối cùng file đó:

```js
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CASES_DIR = path.join(process.cwd(), "scripts", "ai-eval", "specialist-cases");
const OUT_DIR = path.join(process.cwd(), "knowledge", "eval");

async function main() {
  // import động: hai module này kéo theo engine GGUF, không nạp khi chỉ chạy test hàm chấm.
  const { runSpecialistAgent } = await import("../../server/services/aiSpecialistAgentService.ts");
  const { gatherRepoContext } = await import("../../server/services/ai/repoContextService.ts");

  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"));
  const results = [];

  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), "utf8"));
    try {
      const repoContext = await gatherRepoContext({ files: c.files, objective: c.objective });
      const run = await runSpecialistAgent({
        agentId: c.agentId, objective: c.objective, files: c.files, repoContext, language: "vi",
      });
      const score = scoreCase(run.output, c.expected);
      results.push({ id: c.id, title: c.title, ...score });
      console.log(`${score.total === 1 ? "✔" : score.total === 0 ? "✘" : "~"} ${c.id}  total=${score.total}  (rootCause=${score.rootCause} location=${score.location} fix=${score.fixDirection})`);
    } catch (err) {
      // Một ca lỗi model KHÔNG được làm hỏng cả lượt chạy.
      results.push({ id: c.id, title: c.title, rootCause: 0, location: 0, fixDirection: 0, total: 0, error: String(err?.message ?? err) });
      console.log(`✘ ${c.id}  total=0  (lỗi: ${err?.message ?? err})`);
    }
  }

  const avg = results.length
    ? Number((results.reduce((a, r) => a + r.total, 0) / results.length).toFixed(3))
    : 0;
  console.log(`\nĐiểm trung bình: ${avg}  (${results.length} ca)`);
  console.log(`Ngưỡng quyết định mức B: >= 0.6`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `specialist-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ average: avg, results }, null, 2));
  console.log(`Đã lưu: ${outFile}`);
}

// Chỉ chạy CLI khi gọi trực tiếp — import từ test sẽ KHÔNG kích hoạt phần này.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

**Lưu ý chạy:** hai import động là file TypeScript, nên script phải chạy qua `tsx`. Đặt script npm ở Step 6 là `tsx scripts/ai-eval/eval-specialist.mjs`, và giữ `node scripts/ai-eval/eval-specialist.test.mjs` cho test (test chỉ import `scoreCase`, không chạm TS).

- [ ] **Step 5: Chạy test để thấy XANH**

Chạy: `node scripts/ai-eval/eval-specialist.test.mjs`
Kỳ vọng: PASS 4/4.

- [ ] **Step 6: Thêm script npm**

Trong `package.json`, thêm vào `scripts`:

```json
"eval:specialist": "tsx scripts/ai-eval/eval-specialist.mjs"
```

- [ ] **Step 7: Commit**

```bash
git add scripts/ai-eval/ package.json
git commit -m "feat(ai/w1-6): bộ đề chuẩn 8 bài từ bug thật + chấm tự động (npm run eval:specialist)"
```

**LƯU Ý:** KHÔNG chạy `npm run eval:specialist` trong lúc thi công (tốn hàng chục phút GPU). Controller chạy ở bước nghiệm thu.

---

## Nghiệm thu Wave 1 (controller làm, sau khi cả 6 task xong)

1. Chạy migration `0307` bằng owner `aoi` (`aoi:aoi@127.0.0.1:5434/aoi_management`) — **không** dùng `avi_app` (bị 42501).
2. `npm run build` + khởi động lại `:3000`.
3. Đăng nhập `engineer1`, mở `/ai-specialist-studio`, giao 1 việc thật có bật mắt trên một module có sẵn → xác nhận: phiên `running` → `completed`, hiện đủ 7 khối, chấm điểm lưu được, thẻ Chất lượng lên số.
4. Vào `/ai-command-center`, bấm một agent kind `specialist` → thấy nút **"Giao việc →"** và nó điều hướng đúng agent.
5. Xác nhận `operator1` KHÔNG gọi được procedure specialist (RBAC).
6. Chạy `npm run eval:specialist` một lượt, lưu kết quả làm mốc đầu tiên.
