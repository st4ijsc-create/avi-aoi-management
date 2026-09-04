/**
 * ★★★ VIỆC 1 (`docs/superpowers/specs/2026-09-04-ai-local-danh-gia-hien-trang-va-lo-trinh.md` §8,
 * B4) — `retrieveKnowledge` phải truy hồi từ CORPUS LẬP TRÌNH (`aiProgrammingKnowledgeService.
 * searchProgrammingKb`, doc 34 P1 — tài liệu hãng PLC/robot/motion + SDK) khi `context.route ===
 * "vscode"`, và **KHÔNG BAO GIỜ** chạm kho vận hành nhà máy (`knowledge/*` cấp gốc, đọc qua
 * `ensureDataLoaded`/`node:fs`) trên đường đó — đúng CÒN MỞ #5 mà báo cáo Việc 2
 * (`.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-v2-report.md`) để lại: "route vscode
 * vẫn quét CHUNG kho KB vận hành".
 *
 * ─── MOCK BỘ PHẬN ────────────────────────────────────────────────────────────────────────────────
 * `node:fs` giả cho kho vận hành (đúng khuôn `aiLocalKnowledge.vscodeRouteGate.test.ts`) — NHƯNG
 * bọc `readFileSync`/`existsSync` bằng `vi.fn()` để ĐẾM được số lần gọi, vì phép đo cốt lõi ở đây
 * là "route vscode có chạm fs của kho vận hành hay KHÔNG" (0 lần = đã tách miền thật, không phải
 * "gọi rồi bỏ kết quả"). `./aiProgrammingKnowledgeService` bị mock TOÀN BỘ — lưới này đo ĐÚNG MỘT
 * ranh giới (route → đúng hàm nào được gọi), không đo lại chính bộ chấm điểm PROG KB (đã có lưới
 * riêng `aiProgrammingKnowledgeService.test.ts`).
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC: gỡ gate `context?.route === "vscode"` đầu `retrieveKnowledge` (hoặc bỏ
 *   early-return) ⇒ §A/§B ĐỎ (searchProgrammingKb không được gọi / kho vận hành BỊ chạm cho route
 *   vscode). §C tồn tại để canh chiều ngược lại (đảo gate làm hỏng đường WEB).
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

// ─── kho VẬN HÀNH giả (chỉ dùng bởi ca §C — đối chứng route web) ───────────────────────────────
const opsChunks = [
  {
    id: "ops1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/OEE.md",
    title: "Chỉ số OEE",
    text: "OEE là tích của availability, performance và quality.",
    keywords: ["oee"],
  },
];
const opsEmbeddings = [
  {
    id: "ops1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/OEE.md",
    title: "Chỉ số OEE",
    keywords: ["oee"],
    textLength: 60,
    embeddingDim: DIM,
    embedding: unit(0),
  },
];
const opsChunksJsonl = opsChunks.map((c) => JSON.stringify(c)).join("\n");
const opsEmbeddingsJsonl = opsEmbeddings.map((e) => JSON.stringify(e)).join("\n");

const fsExistsSync = vi.fn(() => true);
const fsReadFileSync = vi.fn((p: string) => (String(p).includes("chunks") ? opsChunksJsonl : opsEmbeddingsJsonl));
vi.mock("node:fs", () => ({
  default: { existsSync: (...a: unknown[]) => fsExistsSync(...(a as [string])), readFileSync: (...a: unknown[]) => fsReadFileSync(...(a as [string])) },
  existsSync: (...a: unknown[]) => fsExistsSync(...(a as [string])),
  readFileSync: (...a: unknown[]) => fsReadFileSync(...(a as [string])),
}));

const searchProgrammingKb = vi.fn();
// ★ Khớp `manifest.json` thật (6 hãng) — cần mock riêng vì `detectProgrammingVendors` giờ đọc danh
// sách hãng qua `getProgrammingKbVendorSlugs()` thay vì một bảng chép tay (phản hồi chủ dự án
// 2026-09-04, xem `aiLocalKnowledge.vendorDetect.test.ts` §E/§F cho lưới của chính cơ chế đọc động).
const getProgrammingKbVendorSlugs = vi.fn(() => ["delta", "fanuc", "mitsubishi", "omron", "universal-robots", "zmotion"]);
vi.mock("./aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: (...a: unknown[]) => searchProgrammingKb(...a),
  getProgrammingKbVendorSlugs: () => getProgrammingKbVendorSlugs(),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateText: vi.fn(),
  generateTextStream: vi.fn(),
}));

import { retrieveKnowledge } from "./aiLocalKnowledgeService";

beforeEach(() => {
  vi.clearAllMocks();
  fsExistsSync.mockReturnValue(true);
  fsReadFileSync.mockImplementation((p: string) => (String(p).includes("chunks") ? opsChunksJsonl : opsEmbeddingsJsonl));
  isGgufAvailable.mockResolvedValue(false);
});

const progHit = {
  query: "read modbus register",
  enabled: true,
  semanticUsed: false,
  answerContext: "[1] Delta AS300 (delta, p.42) · Modbus\nĐọc thanh ghi qua Modbus RTU...",
  citations: [
    {
      id: "delta:abc123",
      vendor: "delta",
      docTitle: "AS300_PM_EN_20180612",
      page: 42,
      section: "Modbus",
      sourcePath: "Delta/AS300_PM_EN_20180612.pdf",
      score: 0.81,
    },
  ],
  chunks: [
    {
      id: "delta:abc123",
      vendor: "delta",
      docTitle: "AS300_PM_EN_20180612",
      page: 42,
      section: "Modbus",
      sourcePath: "Delta/AS300_PM_EN_20180612.pdf",
      lang: "en",
      text: "Đọc thanh ghi qua Modbus RTU...",
      score: 0.81,
    },
  ],
  rerankMs: 3,
};

describe("§A — VIỆC 1: route vscode ⇒ retrieveKnowledge dùng CORPUS LẬP TRÌNH", () => {
  it("★★★ gọi searchProgrammingKb, KHÔNG chạm fs của kho vận hành", async () => {
    searchProgrammingKb.mockResolvedValue(progHit);
    const r = await retrieveKnowledge("read modbus register on Delta AS300", 5, { route: "vscode" });

    expect(searchProgrammingKb).toHaveBeenCalledTimes(1);
    // ★ B3 (spec "lọc theo hãng") — câu hỏi nêu ĐÚNG MỘT hãng ("Delta", viết hoa tên riêng) ⇒
    // `vendor: "delta"` giờ được truyền để LỌC trước khi chấm điểm (đo được ở B1). Trước bản vá
    // này, lời gọi KHÔNG có `vendor` — xem `aiLocalKnowledge.vendorFilterWiring.test.ts` cho lưới
    // riêng của cả ba nhánh (0/1/nhiều hãng) và `aiLocalKnowledge.vendorDetect.test.ts` cho vị từ.
    expect(searchProgrammingKb).toHaveBeenCalledWith({ query: "read modbus register on Delta AS300", topK: 5, vendor: "delta" });
    // ★★★ Phép đo cốt lõi: kho vận hành (fs) không bị đọc DÙ MỘT LẦN cho route vscode.
    expect(fsReadFileSync).not.toHaveBeenCalled();

    expect(r.citations).toHaveLength(1);
    expect(r.citations[0].sourcePath).toBe("Delta/AS300_PM_EN_20180612.pdf");
    expect(r.citations[0].sourceType).toBe("vendor_manual");
    expect(r.citations[0].title).toContain("delta");
    expect(r.citations[0].title).toContain("p.42");
    expect(r.contexts).toEqual(["Đọc thanh ghi qua Modbus RTU..."]);
    expect(r.intent).toBe("general");
  });

  it("★★ corpus lập trình RỖNG (PROG_KB_ENABLED tắt / 0 chunk) ⇒ kết quả RỖNG, KHÔNG rơi về kho vận hành", async () => {
    searchProgrammingKb.mockResolvedValue({
      query: "x",
      enabled: false,
      semanticUsed: false,
      answerContext: "",
      citations: [],
      chunks: [],
      rerankMs: null,
    });
    const r = await retrieveKnowledge("hỏi gì đó về PLC", 5, { route: "vscode" });

    expect(searchProgrammingKb).toHaveBeenCalledTimes(1);
    expect(fsReadFileSync).not.toHaveBeenCalled();
    expect(r.citations).toEqual([]);
    expect(r.contexts).toEqual([]);
    expect(r.confidence).toBe(0);
  });

  it("★★ searchProgrammingKb ném lỗi ⇒ fail-safe kết quả RỖNG, KHÔNG rơi về kho vận hành, KHÔNG throw", async () => {
    searchProgrammingKb.mockRejectedValue(new Error("corpus disk error"));
    const r = await retrieveKnowledge("bất kỳ câu hỏi nào", 5, { route: "vscode" });

    expect(fsReadFileSync).not.toHaveBeenCalled();
    expect(r.citations).toEqual([]);
    expect(r.contexts).toEqual([]);
  });
});

// ─── Cố định số đo THẬT từ B5 (`task-v1-report.md`) — 6 câu hỏi ĐÚNG miền chạy keyword-only trên
// corpus thật cho score 0,7116–0,9217; câu hỏi VẬN HÀNH lạc miền ("OEE hôm nay của line 2...") cho
// score 0,2913–0,3511. Dùng NGUYÊN các con số đo được (không bịa) làm fixture cho ngưỡng 0,5.
const onDomainHit = {
  query: "Mitsubishi MELSERVO J4 mã lỗi (error code) tra ở đâu?",
  enabled: true,
  semanticUsed: false,
  answerContext: "",
  citations: [
    { id: "mitsubishi:aaa", vendor: "mitsubishi", docTitle: "MELSERVO J4 error codes", page: 13, section: "", sourcePath: "Mitsubishi/MELSERVO J4 error codes.pdf", score: 0.921669 },
    { id: "mitsubishi:bbb", vendor: "mitsubishi", docTitle: "MELSERVO J4 error codes", page: 20, section: "", sourcePath: "Mitsubishi/MELSERVO J4 error codes.pdf", score: 0.921669 },
  ],
  chunks: [
    { id: "mitsubishi:aaa", vendor: "mitsubishi", docTitle: "MELSERVO J4 error codes", page: 13, section: "", sourcePath: "Mitsubishi/MELSERVO J4 error codes.pdf", lang: "en", text: "Error code AL.010 ...", score: 0.921669 },
    { id: "mitsubishi:bbb", vendor: "mitsubishi", docTitle: "MELSERVO J4 error codes", page: 20, section: "", sourcePath: "Mitsubishi/MELSERVO J4 error codes.pdf", lang: "en", text: "Error code AL.020 ...", score: 0.921669 },
  ],
  rerankMs: null,
};
const offDomainNoiseHit = {
  query: "OEE hôm nay của line 2 là bao nhiêu?",
  enabled: true,
  semanticUsed: false,
  answerContext: "",
  citations: [
    { id: "fanuc:xxx", vendor: "fanuc", docTitle: "Tablet_TP_operator_manual_B-84274EN_04", page: 92, section: "", sourcePath: "Fanuc/Tablet_TP_operator_manual_B-84274EN_04.pdf", score: 0.351073 },
    { id: "mitsubishi:yyy", vendor: "mitsubishi", docTitle: "CR800 Series Controller Detailed explanations of functions and operations", page: 130, section: "", sourcePath: "Mitsubishi/CR800 Series Controller Detailed explanations of functions and operations.pdf", score: 0.351073 },
    { id: "delta:zzz", vendor: "delta", docTitle: "968851404-DELTA-IA-ROBOT-DRAStudio-RL-EN-20240920", page: 224, section: "", sourcePath: "Delta/968851404-DELTA-IA-ROBOT-DRAStudio-RL-EN-20240920.pdf", score: 0.291313 },
  ],
  chunks: [
    { id: "fanuc:xxx", vendor: "fanuc", docTitle: "Tablet_TP_operator_manual_B-84274EN_04", page: 92, section: "", sourcePath: "Fanuc/Tablet_TP_operator_manual_B-84274EN_04.pdf", lang: "en", text: "(nhiễu, không liên quan tới OEE)", score: 0.351073 },
    { id: "mitsubishi:yyy", vendor: "mitsubishi", docTitle: "CR800 Series Controller Detailed explanations of functions and operations", page: 130, section: "", sourcePath: "Mitsubishi/CR800 Series Controller Detailed explanations of functions and operations.pdf", lang: "en", text: "(nhiễu, không liên quan tới OEE)", score: 0.351073 },
    { id: "delta:zzz", vendor: "delta", docTitle: "968851404-DELTA-IA-ROBOT-DRAStudio-RL-EN-20240920", page: 224, section: "", sourcePath: "Delta/968851404-DELTA-IA-ROBOT-DRAStudio-RL-EN-20240920.pdf", lang: "en", text: "(nhiễu, không liên quan tới OEE)", score: 0.291313 },
  ],
  rerankMs: null,
};

describe("§D — B5 bắt được: câu hỏi lạc miền vẫn nhận NHIỄU điểm thấp từ ĐÚNG corpus ⇒ ngưỡng 0,5", () => {
  it("★★★ câu hỏi ĐÚNG miền (score đo thật 0,92) ⇒ GIỮ citation", async () => {
    searchProgrammingKb.mockResolvedValue(onDomainHit);
    const r = await retrieveKnowledge("Mitsubishi MELSERVO J4 mã lỗi tra ở đâu?", 5, { route: "vscode" });
    expect(r.citations).toHaveLength(2);
    expect(r.citations[0].sourcePath).toBe("Mitsubishi/MELSERVO J4 error codes.pdf");
  });

  it("★★★ câu hỏi VẬN HÀNH lạc miền (score đo thật 0,29–0,35, ĐÚNG corpus nhưng NHIỄU) ⇒ RỖNG, không phải top-1 yếu nhất", async () => {
    searchProgrammingKb.mockResolvedValue(offDomainNoiseHit);
    const r = await retrieveKnowledge("OEE hôm nay của line 2 là bao nhiêu?", 5, { route: "vscode" });
    expect(r.citations).toEqual([]);
    expect(r.contexts).toEqual([]);
    expect(r.confidence).toBe(0);
  });
});

/**
 * ★★★ §G — task-v10 (NỢ 1): câu hỏi KHÔNG nêu hãng/dòng sản phẩm nào (`detectProgrammingVendors`
 * rỗng) không được gắn citation vendor_manual dù điểm hybrid VƯỢT ngưỡng 0,5 — đo THẬT bằng
 * `eval-vscode-route.mjs` cho thấy ngưỡng tuyệt đối KHÔNG tách được câu ngoài-miền (VSC-09 top1
 * 0,697 · VSC-10 top1 0,560) khỏi câu đúng-miền (0,649–0,734, CHỒNG LẤN) — xem docblock lớn cạnh
 * `MIN_PROG_KB_CITATION_SCORE`. Fixture điểm 0,92 dưới đây CỐ Ý cao hơn hẳn cả hai ca đo thật, để
 * khẳng định: đây không phải "hạ ngưỡng", mà là một GATE khác hẳn — không hãng nào ⇒ luôn rỗng.
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC: gỡ vế `&& detectedVendors.length > 0` khỏi điều kiện `keepIdx` ⇒ ca
 *   đầu tiên dưới đây phải ĐỎ trở lại (citation lạc miền xuất hiện dù điểm 0,92).
 */
describe("§G — task-v10 NỢ 1: KHÔNG hãng nào nêu tên ⇒ RỖNG dù điểm rất cao", () => {
  it("★★★ câu hỏi C# chung chung (không nêu hãng nào) + citation điểm 0,92 (mock, cao hơn cả đo thật) ⇒ vẫn RỖNG", async () => {
    searchProgrammingKb.mockResolvedValue(onDomainHit); // citations score 0,921669 — KHÔNG liên quan câu hỏi dưới
    const r = await retrieveKnowledge(
      "Trong C#, class System.IO.Ports.SerialPort cấu hình baud rate/parity/stop bits thế nào để giao tiếp Modbus RTU với một thiết bị bất kỳ?",
      5,
      { route: "vscode" },
    );
    expect(r.citations).toEqual([]);
    expect(r.contexts).toEqual([]);
    expect(r.confidence).toBe(0);
  });

  it("★ ĐỐI CHỨNG cùng khối: CÙNG fixture điểm 0,92, câu hỏi ĐÚNG nêu hãng (Mitsubishi MELSERVO) ⇒ vẫn GIỮ citation (không phá §D ca 1)", async () => {
    searchProgrammingKb.mockResolvedValue(onDomainHit);
    const r = await retrieveKnowledge("Mitsubishi MELSERVO J4 mã lỗi tra ở đâu?", 5, { route: "vscode" });
    expect(r.citations).toHaveLength(2);
  });
});

describe("§B — ĐỐI CHỨNG: route KHÁC vscode (web) — hành vi CŨ, không đổi", () => {
  it("★★★ route vắng/web ⇒ dùng kho vận hành (fs được đọc), searchProgrammingKb KHÔNG được gọi", async () => {
    const r = await retrieveKnowledge("OEE hôm nay bao nhiêu", 5, undefined);

    expect(searchProgrammingKb).not.toHaveBeenCalled();
    expect(fsReadFileSync).toHaveBeenCalled();
    expect(r.citations.some((c) => c.sourcePath === "domain/knowledge/OEE.md")).toBe(true);
  });

  it("★★ route = '/factory-command' (path web, không phải 'vscode') ⇒ vẫn dùng kho vận hành", async () => {
    // ★ Không assert lại `fsReadFileSync` ở ca này: `ensureDataLoaded` cache dữ liệu Ở PHẠM VI
    // MODULE (`dataCache`), nên lượt thứ hai trong CÙNG tệp lưới hợp lệ đọc từ cache, không đọc
    // lại đĩa — đó là hành vi ĐÚNG của kho vận hành, không phải hồi quy của bản vá này. Phép đo
    // "route vscode không chạm fs" ở §A không bị ảnh hưởng vì route vscode never gọi
    // `ensureDataLoaded` (early-return TRƯỚC dòng đó — xem `retrieveKnowledge`).
    const r = await retrieveKnowledge("OEE hôm nay bao nhiêu", 5, { route: "/factory-command" });

    expect(searchProgrammingKb).not.toHaveBeenCalled();
    expect(r.citations.some((c) => c.sourcePath === "domain/knowledge/OEE.md")).toBe(true);
  });
});
