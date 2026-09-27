/**
 * Doc 80 · Đợt 1 · Task 8 · fix round 1 #4 — HUỶ trong lượt LÀM ẤM (`warmCodeModel`).
 *
 * Trước bản vá: `warmCodeModel()` không nhận signal ⇒ người dùng bấm Huỷ lúc model đang nạp nguội /
 * lượt warm 1 token đang chạy thì pipeline vẫn CHỜ hết lượt warm rồi mới tới điểm kiểm huỷ kế tiếp,
 * và lượt warm trên llama-server không bị abort.
 *
 *   §A — signal đi xuống `warmModel(modelId, ctx, signal)`; pipeline dừng NGAY cả khi lượt warm KHÔNG
 *        huỷ được (nạp in-process dùng chung, không được giết giữa chừng — xem chú thích tại chỗ).
 *   §B — `warmModel` THẬT → `generateText` → `serverGenerateText` → `postChatCompletion(body, signal)`:
 *        huỷ ⇒ llama-server GIẢ thấy kết nối ĐÓNG, không lùi in-process, không sự kiện G1-D giả.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ cheDo: "that" as "that" | "gia-ton-trong" | "gia-bo-qua", goiWarm: [] as unknown[][] }));

vi.mock("../aiGgufEngine", async (goc) => {
  const that = await goc<typeof import("../aiGgufEngine")>();
  return {
    ...that,
    warmModel: vi.fn(async (...a: unknown[]) => {
      h.goiWarm.push(a);
      if (h.cheDo === "that") return that.warmModel(...(a as Parameters<typeof that.warmModel>));
      const signal = a[2] as AbortSignal | undefined;
      // "gia-bo-qua": nạp nguội KHÔNG huỷ được — không bao giờ xong trong lưới.
      return new Promise<boolean>((r) => {
        if (h.cheDo === "gia-ton-trong") signal?.addEventListener("abort", () => r(false), { once: true });
      });
    }),
    chatCompletion: vi.fn(async () => {
      throw new Error("lưới này không được tới lượt sinh");
    }),
  };
});
vi.mock("../aiModelRouter", async (goc) => {
  const that = await goc<typeof import("../aiModelRouter")>();
  return {
    ...that,
    route: () => ({ tier: 2, modelId: "fake-code.gguf", requiresHitl: false, maxTokens: 1536, temperature: 0.3, jsonMode: false, contextSize: 65536, reason: "mock" }),
  };
});
vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({ query: "", enabled: false, semanticUsed: false, answerContext: "", citations: [], chunks: [] })),
}));
vi.mock("../aiGateway", () => ({
  planInference: vi.fn(async () => ({ decision: { modelId: "m" }, record: vi.fn() })),
}));

const fake = { luot: [] as Array<{ tMo: number; tDong?: number }> };
let fakeSrv: http.Server;

beforeAll(async () => {
  fakeSrv = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("{}");
      return;
    }
    if (req.url === "/v1/chat/completions") {
      req.resume();
      req.on("end", () => {
        const l: { tMo: number; tDong?: number } = { tMo: Date.now() };
        fake.luot.push(l);
        res.on("close", () => {
          if (!res.writableFinished) l.tDong = Date.now();
        });
        // treo: lượt warm "đang nạp/đang chạy" — chỉ dừng khi bị đóng
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => fakeSrv.listen(0, "127.0.0.1", r));
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${(fakeSrv.address() as AddressInfo).port}`;
  process.env.LLAMA_SERVER_MODEL = "fake-code.gguf";
});
afterAll(async () => {
  fakeSrv.closeAllConnections?.();
  await new Promise<void>((r) => fakeSrv.close(() => r()));
  for (const k of ["LLAMA_SERVER_ENABLED", "LLAMA_SERVER_URL", "LLAMA_SERVER_MODEL"]) delete process.env[k];
});

let loiConsole: string[] = [];
beforeEach(() => {
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  fake.luot = [];
  h.goiWarm = [];
  loiConsole = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void loiConsole.push(a.map(String).join(" ")));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  vi.restoreAllMocks();
});

/** Chờ tới khi điều kiện đúng (không dùng mốc giờ cố định: nạp module nguội dưới tải có thể > 1 s). */
async function cho(dk: () => boolean, ms = 10_000): Promise<boolean> {
  const het = Date.now() + ms;
  while (Date.now() < het) {
    if (dk()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return dk();
}

const hetGio = (ms: number) => new Promise<"HET_GIO">((r) => setTimeout(() => r("HET_GIO"), ms));

describe("§A — huỷ trong lượt warm dừng pipeline NGAY", () => {
  it.each([
    ["warm tôn trọng signal", "gia-ton-trong"],
    ["warm KHÔNG huỷ được (nạp nguội in-process)", "gia-bo-qua"],
  ] as const)("%s ⇒ generateProgram ném LoiCopilotBiHuy ≤ 1 s sau huỷ; warmModel nhận ĐÚNG signal", async (_ten, cheDo) => {
    h.cheDo = cheDo;
    const { generateProgram, LoiCopilotBiHuy } = await import("./aiProgrammingCopilot");
    const ac = new AbortController();
    const p = generateProgram({ kind: "iec61131-st", request: "toggle a run bit" }, { signal: ac.signal }).then(
      () => "XONG" as const,
      (e) => e,
    );
    // Lượt warm CỦA LƯỢT NÀY (nhận diện bằng signal — lượt treo của ca trước có thể gọi muộn).
    const cuaLuotNay = () => h.goiWarm.some((a) => a[2] === ac.signal);
    expect(await cho(cuaLuotNay), "warmModel không nhận signal của lượt").toBe(true);
    ac.abort();
    const kq = await Promise.race([p, hetGio(1000)]);
    expect(kq, "pipeline vẫn chờ lượt warm sau khi đã huỷ").toBeInstanceOf(LoiCopilotBiHuy);
  });

  it("đã huỷ TRƯỚC khi tới warm ⇒ không gọi warmModel", async () => {
    h.cheDo = "gia-bo-qua";
    const { generateProgram, LoiCopilotBiHuy } = await import("./aiProgrammingCopilot");
    const ac = new AbortController();
    let nha!: () => void;
    const choRetrieve = new Promise<void>((r) => (nha = r));
    // Huỷ ngay khi pipeline vừa báo stage `retrieve` (trước lượt warm).
    const p = generateProgram(
      { kind: "iec61131-st", request: "toggle a run bit" },
      {
        signal: ac.signal,
        onStage: (st) => {
          if (st === "retrieve") {
            ac.abort();
            nha();
          }
        },
      },
    ).catch((e) => e);
    await choRetrieve;
    expect(await Promise.race([p, hetGio(1000)])).toBeInstanceOf(LoiCopilotBiHuy);
    expect(h.goiWarm.filter((a) => a[2] === ac.signal)).toHaveLength(0);
  });
});

describe("§B — warmModel THẬT: huỷ ⇒ POST tới llama-server bị đóng, không lùi in-process", () => {
  it("★ lượt warm 1 token đang treo trên llama-server; huỷ ⇒ kết nối ĐÓNG ≤ 1 s, warmModel trả false", async () => {
    h.cheDo = "that";
    const { warmModel } = await import("../aiGgufEngine");
    const ac = new AbortController();
    const p = warmModel("fake-code.gguf", 8192, ac.signal);
    const bd = Date.now();
    while (fake.luot.length === 0 && Date.now() - bd < 5000) await new Promise((r) => setTimeout(r, 10));
    expect(fake.luot, "lượt warm không tới llama-server giả").toHaveLength(1);
    const tHuy = Date.now();
    ac.abort();
    expect(await Promise.race([p, hetGio(2000)])).toBe(false);
    const bd2 = Date.now();
    while (fake.luot[0].tDong === undefined && Date.now() - bd2 < 2000) await new Promise((r) => setTimeout(r, 10));
    expect(fake.luot[0].tDong, "llama-server giả KHÔNG thấy lượt warm bị đóng").toBeDefined();
    expect(fake.luot[0].tDong! - tHuy).toBeLessThanOrEqual(1000);
    expect(loiConsole.filter((l) => /TỪ CHỐI TRUNG THỰC/.test(l))).toEqual([]);
  });
});
