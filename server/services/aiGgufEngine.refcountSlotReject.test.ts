/**
 * Đợt 2 — review TOÀN NHÁNH, Important-1: `refCount` RÒ VĨNH VIỄN khi `withGgufSlot()` TỪ CHỐI slot.
 *
 * KHUÔN LỖI (lặp lại ở 8 hàm):
 *
 *   const { loaded } = await getOrLoadModel(...);   // ← refCount++ ĐÃ XẢY RA
 *   return withGgufSlot(async () => {
 *     try { ...suy luận... } finally { releaseModel(loaded); }   // ← nhả nằm TRONG fn
 *   });
 *
 * `withGgufSlot()` (server/services/ggufConcurrency.ts) reject **TRƯỚC KHI `fn` chạy** ở HAI đường:
 *   - `:80-81`  hàng đợi đầy   → `GgufOverloadError`
 *   - `:87-92`  hết thời gian chờ (`GGUF_INFER_TIMEOUT_MS`, mặc định 120 s) → `GgufSlotTimeoutError`
 * Cả hai đường đó `fn` KHÔNG BAO GIỜ chạy ⇒ `releaseModel(loaded)` KHÔNG BAO GIỜ chạy ⇒ `refCount`
 * kẹt >0 **vĩnh viễn**, mỗi lượt bị từ chối cộng thêm 1.
 *
 * HẬU QUẢ: `evictLRU()` (`aiGgufEngine.ts:435`) bỏ qua MỌI model có `refCount > 0` ⇒ khối trọng số
 * ~19 GB bị GHIM tới khi restart tiến trình. Không có đường tự lành.
 *
 * VÌ SAO DỄ XẢY RA (không phải góc hiếm): `.env` đang đặt `GGUF_MAX_CONCURRENCY=4`, hàng đợi mặc
 * định 8, timeout 120 s — mà một lượt sinh của model 30B mất hàng chục giây. Chỉ cần đủ người dùng
 * đồng thời là chạm cả hai đường từ chối.
 *
 * ⚠ Đây là lỗi TIỀN TỒN TẠI, không phải hồi quy của Đợt 2. Nhưng vòng sửa 2 của Task 3 đã nêu ĐÚNG
 * lớp lỗi này cho `ensureTextContext()` (vá 6 điểm, xem aiGgufEngine.embedAliasSelfHeal.test.ts) và
 * tuyên bố đã đóng — trong khi lỗ này nằm ~25 dòng BÊN DƯỚI, ở đúng cùng 6 hàm đó (+2 hàm stream).
 *
 * Mock node-llama-cpp/fs/aiLlamaServerClient/aiModelRouter COPY nguyên khuôn từ
 * aiGgufEngine.embedAliasSelfHeal.test.ts để chạy generateText()/generateEmbedding() THẬT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the llama-server client (default OFF → in-process path, like production) ───
vi.mock("./aiLlamaServerClient", () => ({
  shouldUseServerForText: () => false,
  shouldUseServerForFim: () => false,
  preflightHealthy: async () => false,
  preflightHealthyForFim: async () => false,
  serverGenerateText: async () => {
    throw new Error("server path must not be used in these tests");
  },
  serverGenerateJSON: async () => {
    throw new Error("server path must not be used in these tests");
  },
  generateFimViaServer: async () => {
    throw new Error("server path must not be used in these tests");
  },
  llamaServerStrict: () => false,
  llamaServerEnabled: () => false,
  llamaServerHealthy: async () => false,
}));

vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({
    enabled: false,
    modelConfigured: false,
    fileExists: false,
    active: false,
    reason: "disabled",
  }),
}));

// ─── node-llama-cpp so the in-process path runs with no real model/GPU ───
const EMBED_DIM = 1024;

/**
 * CỔNG CHẶN: khi mở khoá (`gate !== null`) mọi lượt `session.prompt()` treo tới khi test gọi
 * `openGate()`. Đây là thứ giữ slot semaphore bị chiếm để lượt thứ ba bị TỪ CHỐI — đúng kịch bản
 * sản xuất (lượt sinh 30B mất hàng chục giây).
 */
let gate: Promise<void> | null = null;
let openGate: (() => void) | null = null;
function closeGate() {
  gate = new Promise<void>(res => {
    openGate = res;
  });
}
function releaseGate() {
  openGate?.();
  gate = null;
  openGate = null;
}

function makeFakeModel() {
  return {
    size: 1234,
    tokenize: (t: string) => t.split(" "),
    createContext: vi.fn(async () => ({
      getSequence: () => ({ dispose: vi.fn() }),
      dispose: vi.fn(),
    })),
    createEmbeddingContext: vi.fn(async () => ({
      getEmbeddingFor: async () => {
        if (gate) await gate;
        return { vector: new Array(EMBED_DIM).fill(0.01) };
      },
      dispose: vi.fn(),
    })),
    dispose: vi.fn(),
  };
}
const GiB = 1024 * 1024 * 1024;
const fakeLlama = {
  loadModel: vi.fn(async () => makeFakeModel()),
  getVramState: vi.fn(async () => ({ total: 32 * GiB, used: 2 * GiB, free: 30 * GiB, unifiedSize: 0 })),
  createGrammarForJsonSchema: vi.fn(async () => ({ parse: (s: string) => JSON.parse(s) })),
};
class FakeChatSession {
  constructor(_opts: any) {}
  async prompt(_p: string, _opts: any) {
    if (gate) await gate;
    return "in-process answer";
  }
}
vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: FakeChatSession,
  LlamaJsonSchemaGrammar: class {},
}));

vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
    statSync: vi.fn(() => ({ size: 1234, mtime: new Date(), isFile: () => true })),
  };
  return { default: api, ...api };
});

const DEFAULT_FILE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf";
const DEFAULT_BASE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  gate = null;
  openGate = null;
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = DEFAULT_FILE;
  process.env.GGUF_EMBED_DIM = String(EMBED_DIM);
  process.env.GGUF_MAX_LOADED_MODELS = "4";
  process.env.GGUF_MAX_VRAM_MB = "0";
  delete process.env.GGUF_EMBED_MODEL;
  delete process.env.LLAMA_SERVER_ENABLED;
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

/** refCount hiện tại của model mặc định, đọc qua API công khai của engine. */
function refCountOf(eng: any, modelId = DEFAULT_BASE): number {
  const info = eng.getLoadedGgufModels().find((m: any) => m.modelId === modelId);
  if (!info) throw new Error(`model ${modelId} không còn resident`);
  return info.refCount;
}

/** Nhường vòng lặp sự kiện để lượt gọi trước kịp tới `semaphore.acquire()` — thứ tự A→B→C phải
 *  xác định, không phụ thuộc cách microtask xen kẽ. */
const tick = () => new Promise<void>(r => setImmediate(r));

describe("review toàn nhánh I-1 — withGgufSlot TỪ CHỐI slot không được rò refCount", () => {
  it("hàng đợi đầy (GgufOverloadError): lượt bị từ chối PHẢI nhả refCount", async () => {
    // Đúng cấu hình reviewer tái hiện: 1 slot chạy, hàng đợi chứa 1 ⇒ lượt thứ BA bị từ chối ngay.
    process.env.GGUF_MAX_CONCURRENCY = "1";
    process.env.GGUF_QUEUE_MAX = "1";
    const eng = await freshEngine();

    // Nạp sẵn model bằng một lượt chạy trọn vẹn ⇒ điểm xuất phát refCount = 0.
    await eng.generateText({ prompt: "warm" });
    expect(refCountOf(eng)).toBe(0);

    closeGate(); // từ đây mọi prompt() treo → A giữ slot, B xếp hàng, C bị từ chối

    const A = eng.generateText({ prompt: "A" });
    await tick();
    const B = eng.generateText({ prompt: "B" });
    await tick();
    const C = eng.generateText({ prompt: "C" });
    // Gắn handler NGAY (không await tick trước) — C bị từ chối trong tick kế tiếp, để trần một
    // nhịp là Node báo unhandled rejection và vitest coi cả lượt chạy là bẩn.
    const cRejects = expect(C).rejects.toThrow(/quá tải|overload/i);
    await tick();
    await cRejects;

    const afterReject = refCountOf(eng);
    console.log(`[probe] refCount ngay sau khi C bị reject   = ${afterReject}`);

    releaseGate();
    await A;
    await B;

    const afterAll = refCountOf(eng);
    console.log(`[probe] refCount sau khi A và B hoàn tất    = ${afterAll}`);

    // C đã bị từ chối và A/B đã xong ⇒ KHÔNG lượt nào còn giữ tham chiếu.
    // Nếu vỡ ở đây: evictLRU() (:435) bỏ qua model này MÃI MÃI ⇒ ~19 GB ghim tới khi restart.
    expect(afterAll).toBe(0);
    // Và ngay tại thời điểm C bị từ chối, chỉ A + B được phép giữ tham chiếu.
    expect(afterReject).toBe(2);
  });

  it("hết thời gian chờ slot (GgufSlotTimeoutError): lượt bị từ chối PHẢI nhả refCount", async () => {
    // Đường từ chối THỨ HAI (ggufConcurrency.ts:87-92) — hàng đợi còn chỗ nhưng chờ quá hạn.
    process.env.GGUF_MAX_CONCURRENCY = "1";
    process.env.GGUF_QUEUE_MAX = "8";
    process.env.GGUF_INFER_TIMEOUT_MS = "60";
    const eng = await freshEngine();

    await eng.generateText({ prompt: "warm" });
    expect(refCountOf(eng)).toBe(0);

    closeGate();
    const A = eng.generateText({ prompt: "A" });
    await tick();
    const B = eng.generateText({ prompt: "B" }); // xếp hàng rồi hết hạn 60 ms
    const bRejects = expect(B).rejects.toThrow(/thời gian chờ|timeout/i);
    await tick();

    await bRejects;
    console.log(`[probe] refCount ngay sau khi B hết hạn     = ${refCountOf(eng)}`);

    releaseGate();
    await A;

    const afterAll = refCountOf(eng);
    console.log(`[probe] refCount sau khi A hoàn tất         = ${afterAll}`);
    expect(afterAll).toBe(0);
  });

  it("generateEmbedding bị từ chối slot: PHẢI nhả refCount (cùng khuôn, :2439)", async () => {
    process.env.GGUF_MAX_CONCURRENCY = "1";
    process.env.GGUF_QUEUE_MAX = "1";
    const eng = await freshEngine();

    await eng.generateEmbedding("khởi động", DEFAULT_BASE);
    expect(refCountOf(eng)).toBe(0);

    closeGate();
    const A = eng.generateEmbedding("A", DEFAULT_BASE);
    await tick();
    const B = eng.generateEmbedding("B", DEFAULT_BASE);
    await tick();
    const C = eng.generateEmbedding("C", DEFAULT_BASE);
    const cRejects = expect(C).rejects.toThrow(/quá tải|overload/i);
    await tick();
    await cRejects;

    releaseGate();
    await A;
    await B;

    expect(refCountOf(eng)).toBe(0);
  });

  it("generateTextStream bị từ chối slot: PHẢI nhả refCount (withGgufSlotGenerator, :1962)", async () => {
    process.env.GGUF_MAX_CONCURRENCY = "1";
    process.env.GGUF_QUEUE_MAX = "1";
    const eng = await freshEngine();

    await eng.generateText({ prompt: "warm" });
    expect(refCountOf(eng)).toBe(0);

    closeGate();
    // Generator chỉ acquire khi bắt đầu lặp ⇒ phải gọi .next() để tới điểm từ chối.
    const gA = eng.generateTextStream({ prompt: "A" });
    const pA = gA.next();
    await tick();
    const gB = eng.generateTextStream({ prompt: "B" });
    const pB = gB.next();
    await tick();
    const gC = eng.generateTextStream({ prompt: "C" });
    const cNext = gC.next();
    const cRejects = expect(cNext).rejects.toThrow(/quá tải|overload/i);
    await tick();
    await cRejects;

    releaseGate();
    // ⚠ Generator chỉ NHẢ slot khi nó KẾT THÚC (finally của withGgufSlotGenerator), không phải khi
    // yield chunk đầu. Phải đóng hẳn A rồi B mới tới lượt — nếu không, B kẹt trong hàng đợi.
    await pA;
    await gA.return(undefined as any);
    await pB;
    await gB.return(undefined as any);

    expect(refCountOf(eng)).toBe(0);
  });

  it("ĐƯỜNG THÀNH CÔNG không được nhả HAI LẦN (chống double-release)", async () => {
    // Bản vá phải nhả ĐÚNG MỘT LẦN. Nếu nhả hai lần, lượt đang bay khác bị trừ mất tham chiếu ⇒
    // evictLRU() có thể đuổi một model ĐANG DÙNG — hỏng theo hướng ngược lại, khó thấy hơn.
    process.env.GGUF_MAX_CONCURRENCY = "4";
    process.env.GGUF_QUEUE_MAX = "8";
    const eng = await freshEngine();

    await eng.generateText({ prompt: "warm" });
    expect(refCountOf(eng)).toBe(0);

    closeGate();
    const A = eng.generateText({ prompt: "A" });
    await tick();
    const B = eng.generateText({ prompt: "B" });
    await tick();

    // Hai lượt đang bay, cả hai đều CHẠY (không lượt nào bị từ chối) ⇒ đúng 2 tham chiếu.
    expect(refCountOf(eng)).toBe(2);

    releaseGate();
    await A;
    await B;
    expect(refCountOf(eng)).toBe(0);

    // Lượt kế tiếp vẫn chạy bình thường — model không bị nhả quá tay thành âm/không đuổi nhầm.
    const after = await eng.generateText({ prompt: "sau" });
    expect(typeof after.text).toBe("string");
    expect(refCountOf(eng)).toBe(0);
  });
});
