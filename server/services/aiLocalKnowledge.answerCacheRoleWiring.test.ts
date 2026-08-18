/**
 * Chốt cuối (post-Task-6 re-review), mục 2 — dây nối `getCacheKey`'s `studioEligible` +
 * `kbContext.callerRole` KHÔNG có test nào canh chạy THẬT QUA `answerQuestion`/`streamAnswer`.
 *
 * `aiLocalKnowledge.answerCacheKey.test.ts` chỉ kiểm `getCacheKey()` THUẦN (không gọi
 * `answerQuestion`). `aiLocalKnowledge.studioRoleGate.test.ts` chỉ kiểm `retrieveKnowledge()`
 * trực tiếp (đã có `callerRole` sẵn trong context, không đi qua đường build `kbContext` từ
 * `execCtx.user.role` bên trong `answerQuestion`/`streamAnswer`). Reviewer chứng minh: xoá
 * `studioEligible` khỏi lời gọi `getCacheKey(...)` bên trong `answerQuestion`/`streamAnswer`
 * (aiLocalKnowledgeService.ts) ⇒ lỗ rò cache quay lại nguyên vẹn — KHÔNG test nào trong 2 file
 * trên đỏ. Cũng vậy nếu xoá `callerRole: execCtx.user.role` khỏi `kbContext`.
 *
 * File này khoá đúng DÂY NỐI đó: gọi `answerQuestion`/`streamAnswer` (không phải
 * `retrieveKnowledge` trực tiếp) hai lần với CÙNG câu hỏi/topK/tone-role nhưng KHÁC
 * `execCtx.user.role` thật (RBAC) — mô phỏng đúng kịch bản rò rỉ đã tìm ra ở Task 6:
 * "quality_inspector"/"maintenance"/"engineer" (RBAC thật) đều ánh xạ (mapAppRoleToAiRole,
 * aiChatRouter.ts) về CÙNG tone "engineer". Lần 1 role thật "engineer" (đủ quyền), lần 2 role
 * thật "maintenance" (KHÔNG đủ quyền) — CÙNG tone "engineer" truyền trực tiếp cho tham số thứ 4.
 *
 * Mirror khung mock của aiLocalKnowledgeSafety.test.ts (mock GGUF engine + DB, chạy dây nối
 * AI Gateway/safety thật) + gatherStudioHits mock của aiLocalKnowledge.studioRoleGate.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

const DIM = 1024;
function unit(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1;
  return v;
}
const QUERY_VEC = unit(0);

// Một chunk hệ thống khớp gần tuyệt đối — không phải trọng tâm bài test này (trọng tâm là
// cache+role), chỉ cần đủ để retrieveKnowledge trả về ổn định, có citations hệ thống thật.
const chunks = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/HUONG_DAN.md",
    title: "Hướng dẫn kiểm tra AOI",
    text: "Nội dung hướng dẫn kiểm tra AOI: bước 1 kiểm tra camera, bước 2 kiểm tra ánh sáng.",
    keywords: ["aoi"],
  },
];
const embeddings = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/HUONG_DAN.md",
    title: "Hướng dẫn kiểm tra AOI",
    keywords: ["aoi"],
    textLength: 60,
    embeddingDim: DIM,
    embedding: unit(0),
  },
];
const chunksJsonl = chunks.map((c) => JSON.stringify(c)).join("\n");
const embeddingsJsonl = embeddings.map((e) => JSON.stringify(e)).join("\n");

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => true,
    readFileSync: (p: string) => (String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl),
  },
  existsSync: () => true,
  readFileSync: (p: string) => (String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl),
}));

// ⚠ G2-C — `tryExecuteToolLoop` PHẢI có mặt ở đây. Factory liệt kê tay làm MỌI symbol không được
// nêu biến mất (đúng lớp lỗi đã ghi ở `ai/thinkingStrip.ts` §1 và `aiLlamaServerClient.ts`): thiếu dòng
// này thì service gọi `undefined(...)` và toàn bộ file này đỏ — đã xảy ra thật khi thêm vòng lặp.
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
  tryExecuteToolLoop: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" }, loop: null })),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
const generateText = vi.fn();
const generateTextStream = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateText: (...a: unknown[]) => generateText(...a),
  generateTextStream: (...a: unknown[]) => generateTextStream(...a),
}));

const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

const gatherStudioHitsMock = vi.fn();
vi.mock("./aiLocalKnowledgeStudio", () => ({ gatherStudioHits: (...a: any[]) => gatherStudioHitsMock(...a) }));

import { answerQuestion, streamAnswer, reloadKbArtifacts, type StreamEvent } from "./aiLocalKnowledgeService";

const STUDIO_HIT = { id: 777, text: "STUDIO_SECRET_ANSWER_TEXT", sourceRef: "studio-secret.pdf", score: 0.9, corpus: "manuals" };

// topK KHÔNG dùng ở bất kỳ file test nào khác trong repo (tránh đụng cache module-level nếu
// vitest gộp chung worker) — CỐ Ý giữ NGUYÊN giữa 2 lần gọi trong CÙNG một test (khác hẳn cách
// dùng nextTopK() của aiLocalKnowledgeSafety.test.ts) vì đây chính là biến canh: hai lần gọi
// PHẢI cùng câu hỏi + cùng topK + cùng tone-role để cache key CÓ THỂ trùng nếu thiếu
// `studioEligible` — đúng kịch bản rò rỉ cần khoá lại.
const PINNED_TOPK = 87001;
const QUESTION = "hướng dẫn kiểm tra AOI là gì";
const SAME_TONE_ROLE = "engineer"; // truyền y hệt cho cả 2 lần gọi — tham số 4 (tone), KHÔNG PHẢI RBAC

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "embed-stub" });
  getDbMock.mockResolvedValue({ insert: insertMock });
  gatherStudioHitsMock.mockResolvedValue([STUDIO_HIT]);
  generateText.mockResolvedValue({
    text: "Câu trả lời từ model (mock).",
    modelId: "stub-chat-model",
    totalTimeMs: 5,
    tokensGenerated: 4,
    tokensPrompt: 20,
    tokensPerSecond: 1,
  });
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: "Câu trả lời stream (mock)." };
    yield { type: "done", fullText: "Câu trả lời stream (mock).", tokensPrompt: 20, tokensGenerated: 4 };
  });
  reloadKbArtifacts();
});

describe("answerQuestion — dây nối cache-key + callerRole (Chốt cuối, mục 2)", () => {
  it("engineer (đủ quyền) rồi maintenance (KHÔNG đủ quyền, CÙNG tone 'engineer') — lần 2 KHÔNG được dùng cache của lần 1 và KHÔNG có trích dẫn Studio", async () => {
    const r1 = await answerQuestion(QUESTION, PINNED_TOPK, [], SAME_TONE_ROLE, undefined, {
      user: { id: 1, role: "engineer" },
      lang: "vi",
    } as any);

    // Xác nhận trước: lần 1 (đủ quyền) THẬT SỰ có trích dẫn Studio và KHÔNG phải cache-hit
    // (là lần tính đầu tiên) — nếu không, phần còn lại của test vô nghĩa.
    expect(r1.cached).toBe(false);
    expect(r1.citations.some((c) => c.origin === "studio")).toBe(true);

    const r2 = await answerQuestion(QUESTION, PINNED_TOPK, [], SAME_TONE_ROLE, undefined, {
      user: { id: 2, role: "maintenance" },
      lang: "vi",
    } as any);

    // ĐÂY LÀ ĐIỀU KHOÁ LẠI: nếu thiếu `studioEligible` trong khoá cache, r2 sẽ là cache-HIT
    // nguyên văn của r1 (cached:true, VẪN mang trích dẫn Studio) — KHÔNG test nào trong
    // answerCacheKey.test.ts/studioRoleGate.test.ts bắt được việc này vì cả hai không đi qua
    // answerQuestion() thật.
    expect(r2.cached).not.toBe(true);
    expect(r2.citations.some((c) => c.origin === "studio")).toBe(false);
    expect(r2.contexts).not.toContain("STUDIO_SECRET_ANSWER_TEXT");
    // Bằng chứng độc lập với nội bộ cache: kết quả lần 2 KHÔNG được là chính xác vật thể lần 1
    // (nếu là cache-hit, hai object 'answer'/'citations' sẽ giống hệt nhau).
    expect(r2.citations).not.toEqual(r1.citations);
  });

  it("NGƯỢC LẠI — hai lần cùng role đủ quyền ⇒ lần 2 ĐƯỢC phép là cache-hit (không phá tính năng cache hợp lệ)", async () => {
    const a1 = await answerQuestion(QUESTION, PINNED_TOPK + 1, [], SAME_TONE_ROLE, undefined, {
      user: { id: 1, role: "engineer" },
      lang: "vi",
    } as any);
    const a2 = await answerQuestion(QUESTION, PINNED_TOPK + 1, [], SAME_TONE_ROLE, undefined, {
      user: { id: 3, role: "engineer" },
      lang: "vi",
    } as any);

    expect(a1.cached).toBe(false);
    expect(a2.cached).toBe(true);
    expect(a2.citations.some((c) => c.origin === "studio")).toBe(true);
  });
});

describe("streamAnswer — dây nối cache-key + callerRole (Chốt cuối, mục 2)", () => {
  async function collectStream(question: string, topK: number, userRole: string, execCtx: any) {
    const events: StreamEvent[] = [];
    for await (const evt of streamAnswer(question, topK, [], userRole as any, undefined, execCtx)) {
      events.push(evt);
    }
    const meta = events.find((e) => e.type === "meta") as Extract<StreamEvent, { type: "meta" }> | undefined;
    const done = events.find((e) => e.type === "done") as Extract<StreamEvent, { type: "done" }> | undefined;
    return { events, meta, done };
  }

  it("engineer (đủ quyền) rồi maintenance (KHÔNG đủ quyền, CÙNG tone 'engineer') — lần 2 KHÔNG cache-hit và KHÔNG lộ trích dẫn Studio qua sự kiện 'meta'", async () => {
    const s1 = await collectStream(QUESTION, PINNED_TOPK + 2, SAME_TONE_ROLE, {
      user: { id: 1, role: "engineer" },
      lang: "vi",
    });
    expect(s1.done?.cached).toBe(false);
    expect(s1.meta?.citations?.some((c) => c.origin === "studio")).toBe(true);

    const s2 = await collectStream(QUESTION, PINNED_TOPK + 2, SAME_TONE_ROLE, {
      user: { id: 2, role: "maintenance" },
      lang: "vi",
    });
    expect(s2.done?.cached).not.toBe(true);
    expect(s2.meta?.citations?.some((c) => c.origin === "studio")).toBe(false);
  });
});
