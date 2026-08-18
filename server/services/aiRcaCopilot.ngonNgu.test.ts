/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ G4-A VIỆC 1 — **LỚP ③: RCA COPILOT NHẬN `lang` RỒI KHÔNG DÙNG NÓ.**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Đã xác minh trực tiếp trước bản vá: `synthesize(input, lang, ev)` khai tham số `lang` ở chữ ký,
 * và **thân hàm không tham chiếu nó một lần nào**. System prompt (~:500-505) + user prompt
 * (~:506-513) **100% tiếng Anh** ⇒ model trả về `cause` / `evidence` / `rationale` tiếng Anh,
 * trong khi `RcaResult.lang` khai `"vi"`. Bản ghi **tự khai một điều sai về chính nó** — và đây
 * chính là bug *"RCA sinh tiếng Anh"* đã ghi từ Đợt 0, còn nguyên tại gốc.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LƯỚI NÀY ĐO **CHUỖI THẬT SỰ RỜI KHỎI MÁY CHỦ ĐI TỚI MODEL**, không đo một hằng số.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nó bắt `generateJSON` — mặt tiếp xúc cuối cùng trước engine — và đọc `systemPrompt`/`prompt`
 * **y như model nhận được**. Khẳng định trên một hằng số của bảng câu sẽ xanh ngay cả khi ai đó
 * gỡ lượt gọi `cauBaoCao(...)` khỏi `synthesize` và viết lại chuỗi tiếng Anh tại chỗ.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

function terminal(rows: any[]): any {
  const t: any = {
    innerJoin: () => t,
    where: () => t,
    orderBy: () => t,
    limit: async (_n: number) => rows,
    then: (resolve: (v: any[]) => void) => resolve(rows),
  };
  return t;
}
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: (_cols?: any) => ({ from: (_tbl: any) => terminal([]) }),
    update: (_tbl: any) => ({ set: () => ({ where: async () => undefined }) }),
    insert: (_tbl: any) => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
    execute: async () => {
      throw new Error('relation "measurement_corrections" does not exist');
    },
  })),
}));

// Nguồn bằng chứng: đủ để `hasMeaningfulEvidence` bật (nếu không, `synthesize` không bao giờ chạy
// và lưới sẽ xanh trên một đường KHÔNG được đi — đúng lớp lỗi "xanh qua cơ chế khác").
vi.mock("./paretoAnalysisService", () => ({
  paretoByDefectType: vi.fn(async () => ({ items: [{ category: "Solder Bridge", count: 30, percentage: 60 }] })),
}));
vi.mock("./aiInspectionAnalytics", () => ({
  getControlChart: vi.fn(async () => ({ summary: { cpk: 0.8, outOfControlCount: 3, spcViolations: [] } })),
}));
vi.mock("./aiAnomalyDetection", () => ({ getAnomalyStats: vi.fn(async () => null) }));
vi.mock("./aiLocalKnowledgeService", () => ({ retrieveKnowledge: vi.fn(async () => ({ citations: [] })) }));
vi.mock("./aiCausalGraph", () => ({
  hybridDefectContext: vi.fn(async () => ({ causal: { defect: null, machine: null, causes: [] }, causalText: "", kbHits: [] })),
}));
vi.mock("./aiEdgeEnhanced", () => ({ readStorageBuffer: vi.fn(async () => Buffer.from("x")) }));
vi.mock("./aiVisionLanguage", () => ({ describeDefect: vi.fn(async () => null) }));
vi.mock("./aiModelRouter", () => ({
  route: () => ({ modelId: "x", maxTokens: 256, temperature: 0.2, contextSize: 2048 }),
  getRouterStats: () => ({ total: 0, byTier: {}, fastModelConfigured: false }),
}));

const generateJSON = vi.fn(async () => ({ data: { hypotheses: [] } }));
vi.mock("./aiGgufEngine", () => ({
  generateJSON: (...a: any[]) => generateJSON(...(a as [])),
  warmModel: vi.fn(async () => undefined),
}));

import { rankAndValidateHypotheses, runRca } from "./aiRcaCopilot";

const CO_HAN_TU = /\p{sc=Han}/u;
const CHU_LATIN_CO_DAU = /[À-ɏḀ-ỿ]/u;
function coChuCaiPhiAscii(s: string): boolean {
  for (const ch of s) if (ch.codePointAt(0)! > 127 && /\p{L}/u.test(ch)) return true;
  return false;
}

const prevFlag = process.env.AI_RCA_COPILOT_ENABLED;
afterAll(() => {
  if (prevFlag === undefined) delete process.env.AI_RCA_COPILOT_ENABLED;
  else process.env.AI_RCA_COPILOT_ENABLED = prevFlag;
});

beforeEach(() => {
  process.env.AI_RCA_COPILOT_ENABLED = "true";
  vi.clearAllMocks();
  generateJSON.mockResolvedValue({ data: { hypotheses: [] } } as any);
});

/** Lấy đúng cặp (systemPrompt, prompt) mà engine nhận. */
function promptDaGui(): { sys: string; user: string } {
  expect(generateJSON, "synthesize KHÔNG hề gọi model ⇒ lưới đang đo một đường không chạy").toHaveBeenCalled();
  const opts = (generateJSON.mock.calls[0] as any[])[1];
  return { sys: String(opts.systemPrompt), user: String(opts.prompt) };
}

describe("lớp ③ — câu dẫn gửi cho model phải theo `lang` được truyền vào", () => {
  it("lang=vi ⇒ system prompt VÀ user prompt là tiếng Việt", async () => {
    await runRca({ machineId: 7, defectType: "bridge", lang: "vi" });
    const { sys, user } = promptDaGui();
    expect(CHU_LATIN_CO_DAU.test(sys), `system prompt không phải tiếng Việt: ${sys.slice(0, 120)}`).toBe(true);
    expect(CHU_LATIN_CO_DAU.test(user), `user prompt không phải tiếng Việt: ${user.slice(0, 120)}`).toBe(true);
  });

  it("lang=zh ⇒ cả hai prompt là tiếng Trung", async () => {
    await runRca({ machineId: 7, defectType: "bridge", lang: "zh" });
    const { sys, user } = promptDaGui();
    expect(CO_HAN_TU.test(sys), `system prompt không phải tiếng Trung: ${sys.slice(0, 120)}`).toBe(true);
    expect(CO_HAN_TU.test(user), `user prompt không phải tiếng Trung: ${user.slice(0, 120)}`).toBe(true);
  });

  it("lang=en ⇒ ĐỐI CHỨNG DƯƠNG: hành vi cũ giữ nguyên, không một chữ phi-ASCII nào", async () => {
    await runRca({ machineId: 7, defectType: "bridge", lang: "en" });
    const { sys } = promptDaGui();
    expect(coChuCaiPhiAscii(sys), `system prompt en lẫn chữ phi-ASCII: ${sys}`).toBe(false);
  });

  it("KHÔNG khai `lang` ⇒ tiếng Việt (mặc định của `runRca` vốn đã là 'vi')", async () => {
    await runRca({ machineId: 7, defectType: "bridge" });
    expect(CHU_LATIN_CO_DAU.test(promptDaGui().sys)).toBe(true);
  });

  it("★ prompt phải NÊU ĐÍCH DANH ngôn ngữ phải trả lời — nhãn bằng chứng vẫn là tiếng Anh", async () => {
    // ⚠ Vì sao ca này tồn tại: `buildEvidenceDigest` sinh nhãn tiếng Anh (`Pareto top defects:`,
    //   `SPC:`) — chúng là **khoá dữ liệu**, cố ý KHÔNG dịch (luật phân công ở aiReportPhrases.ts).
    //   Một model đa ngữ **trôi theo ngôn ngữ của dữ liệu**, nên chỉ dịch câu dẫn là chưa đủ:
    //   câu dẫn phải nói thẳng "viết mọi trường văn xuôi bằng tiếng Việt".
    await runRca({ machineId: 7, defectType: "bridge", lang: "vi" });
    const { sys, user } = promptDaGui();
    expect(sys).toContain("tiếng Việt");
    expect(user).toContain("Pareto top defects"); // nhãn dữ liệu vẫn nguyên ⇒ không dịch nhầm khoá
  });
});

describe("lớp ③ — câu THAY THẾ khi model không kèm `rationale`", () => {
  const raw = [{ cause: "Nhiệt độ lò cao", confidence: 0.9, evidence: [], recommendedFix: { kind: "INVESTIGATE" } }];

  it("mặc định (không khai lang) ⇒ tiếng Việt, KHÔNG phải 'No rationale provided.'", () => {
    const out = rankAndValidateHypotheses(raw as any, { minConfidence: 0 });
    expect(out[0].recommendedFix.rationale).not.toBe("No rationale provided.");
    expect(CHU_LATIN_CO_DAU.test(out[0].recommendedFix.rationale)).toBe(true);
  });

  it("lang=zh ⇒ tiếng Trung", () => {
    const out = rankAndValidateHypotheses(raw as any, { minConfidence: 0, lang: "zh" });
    expect(CO_HAN_TU.test(out[0].recommendedFix.rationale)).toBe(true);
  });

  it("lang=en ⇒ ĐỐI CHỨNG DƯƠNG: câu tiếng Anh cũ còn nguyên", () => {
    const out = rankAndValidateHypotheses(raw as any, { minConfidence: 0, lang: "en" });
    expect(out[0].recommendedFix.rationale).toBe("No rationale provided.");
  });

  it("`rationale` do model cung cấp KHÔNG bị bản dịch ghi đè", () => {
    const coLyLe = [{ ...raw[0], recommendedFix: { kind: "INVESTIGATE", rationale: "  model nói vậy  " } }];
    const out = rankAndValidateHypotheses(coLyLe as any, { minConfidence: 0, lang: "zh" });
    expect(out[0].recommendedFix.rationale).toBe("model nói vậy");
  });
});
