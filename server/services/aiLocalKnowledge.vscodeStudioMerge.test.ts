/**
 * ★★★ VIỆC 8 (`docs/superpowers/specs/2026-09-04-ai-local-danh-gia-hien-trang-va-lo-trinh.md` §12,
 * vá lỗ hổng do CHÍNH Việc 1 tạo ra) — `retrieveProgrammingKnowledgeForVscode` (nhánh route "vscode"
 * của `retrieveKnowledge`) giờ CŨNG trộn `kb_studio_chunks` (Training Studio) vào kết quả tài liệu
 * hãng, thay vì chỉ phục vụ đường web như trước. Xem docblock lớn ngay phía trên hàm đó trong
 * `aiLocalKnowledgeService.ts` cho B1 (chữ ký `gatherStudioHits`) và B2 (vì sao HAI ngưỡng riêng,
 * KHÔNG sort chung điểm vendor/Studio — hai không gian nhúng khác nhau, Qwen3-Embedding vs mxbai).
 *
 * ─── MOCK BỘ PHẬN ────────────────────────────────────────────────────────────────────────────────
 * Cùng khuôn `aiLocalKnowledge.progKbRouteGate.test.ts`: `node:fs` giả CÓ ĐẾM LƯỢT GỌI (phép đo cốt
 * lõi §D dưới đây: route vscode — kể cả khi Studio hoạt động — vẫn KHÔNG được chạm fs của kho vận
 * hành, dù một lần); `./aiProgrammingKnowledgeService` mock toàn bộ; `./aiGgufEngine` mock toàn bộ
 * (điều khiển được `embedQuestion()` có ra vector hay không); THÊM MỚI so với tệp kia:
 * `./aiLocalKnowledgeStudio` mock toàn bộ (điều khiển `gatherStudioHits` — không chạm DB thật).
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC (đã tự tay xác nhận bằng ablation thủ công, xem báo cáo task-v8):
 *   - gỡ `canAccessStudioCorpus(...)` (hoặc luôn trả `true`) ⇒ §B ĐỎ (role không đủ quyền vẫn thấy
 *     Studio — hồi quy BẢO MẬT, đúng cổng mà `kbStudioAccess.ts` yêu cầu).
 *   - gỡ nhánh `vendorResult` sớm-rỗng-vẫn-thử-Studio (khôi phục early-return `empty()` cũ ngay sau
 *     `searchProgrammingKb`) ⇒ §A ĐỎ (Studio không còn cứu được một câu hỏi vendor không match).
 *   - đổi `MIN_STUDIO_CITATION_SCORE` về ngưỡng CŨ 0,18 (giá trị lỏng đã ĐO SỐNG rồi BÁC BỎ — xem
 *     docblock lớn trong `aiLocalKnowledgeService.ts`) ⇒ §C1 ĐỎ (hit Studio 0.40 — đúng cụm nhiễu
 *     đo được — lọt qua oan). ★ CHÚ Ý cho người sửa sau: `MIN_STUDIO_CITATION_SCORE` và
 *     `MIN_PROG_KB_CITATION_SCORE` HIỆN cùng bằng 0,5 — TRÙNG SỐ NGẪU NHIÊN (hai không gian nhúng
 *     khác nhau, hai cụm đo độc lập, xem B2), KHÔNG PHẢI một hằng số dùng chung — đừng gộp chúng
 *     lại thành MỘT biến khi thấy giá trị giống nhau, đó đúng lớp lỗi "chép tay hai nơi" đã cắn dự
 *     án này nhiều lần trước.
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

// ─── kho VẬN HÀNH giả (chỉ dùng bởi ca §E — đối chứng route web) ───────────────────────────────
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

const gatherStudioHits = vi.fn();
vi.mock("./aiLocalKnowledgeStudio", () => ({
  gatherStudioHits: (...a: unknown[]) => gatherStudioHits(...a),
}));

import { retrieveKnowledge } from "./aiLocalKnowledgeService";

beforeEach(() => {
  vi.clearAllMocks();
  fsExistsSync.mockReturnValue(true);
  fsReadFileSync.mockImplementation((p: string) => (String(p).includes("chunks") ? opsChunksJsonl : opsEmbeddingsJsonl));
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: unit(1), dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });
  gatherStudioHits.mockResolvedValue([]);
  searchProgrammingKb.mockResolvedValue({
    query: "x",
    enabled: false,
    semanticUsed: false,
    answerContext: "",
    citations: [],
    chunks: [],
    rerankMs: null,
  });
});

const emptyVendorResult = {
  query: "x",
  enabled: false,
  semanticUsed: false,
  answerContext: "",
  citations: [],
  chunks: [],
  rerankMs: null,
};

function vendorHit(score: number) {
  return {
    query: "read modbus register",
    enabled: true,
    semanticUsed: false,
    answerContext: "",
    citations: [
      { id: "delta:abc", vendor: "delta", docTitle: "AS300_PM_EN", page: 42, section: "Modbus", sourcePath: "Delta/AS300_PM_EN.pdf", score },
    ],
    chunks: [
      { id: "delta:abc", vendor: "delta", docTitle: "AS300_PM_EN", page: 42, section: "Modbus", sourcePath: "Delta/AS300_PM_EN.pdf", lang: "en", text: "Đọc thanh ghi qua Modbus RTU...", score },
    ],
    rerankMs: 3,
  };
}

function studioHit(id: string, score: number, text = "Nội dung tài liệu Studio người dùng nạp") {
  return { id, text, sourceRef: `studio-doc-${id}.md`, score, corpus: "default" };
}

describe("§A — VIỆC 8: vendor RỖNG nhưng Studio có hit ⇒ KHÔNG còn trả rỗng oan (lỗ hổng B1 đã vá)", () => {
  it("★★★ B1 ĐƯỜNG CƠ SỞ (trước bản vá): vendor rỗng + Studio có 1 hit hợp lệ ⇒ trước đây trả empty(), giờ PHẢI thấy citation Studio", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.62)]);
    const r = await retrieveKnowledge("tài liệu nội bộ nói gì về cổng debug?", 5, { route: "vscode", callerRole: "engineer" });

    expect(gatherStudioHits).toHaveBeenCalledTimes(1);
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0].sourceType).toBe("studio");
    expect(r.citations[0].origin).toBe("studio");
    expect(r.citations[0].sourcePath).toBe("studio-doc-s1.md");
    expect(r.contexts).toEqual(["Nội dung tài liệu Studio người dùng nạp"]);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("★★ vendor RỖNG + Studio CŨNG rỗng ⇒ vẫn trả empty() y hệt hành vi cũ (không lỗi)", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([]);
    const r = await retrieveKnowledge("câu hỏi không khớp gì cả", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.citations).toEqual([]);
    expect(r.contexts).toEqual([]);
    expect(r.confidence).toBe(0);
  });
});

describe("§B — BẢO MẬT: caller KHÔNG đủ quyền (canAccessStudioCorpus) ⇒ Studio KHÔNG BAO GIỜ được gộp", () => {
  it("★★★ callerRole vắng ⇒ gatherStudioHits KHÔNG được gọi dù Studio có hit thật", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.9)]);
    const r = await retrieveKnowledge("hỏi gì đó", 5, { route: "vscode" });
    expect(gatherStudioHits).not.toHaveBeenCalled();
    expect(r.citations).toEqual([]);
  });

  it("★★★ callerRole = 'operator' (không nằm trong allowlist admin/engineer) ⇒ gatherStudioHits KHÔNG được gọi", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.9)]);
    const r = await retrieveKnowledge("hỏi gì đó", 5, { route: "vscode", callerRole: "operator" });
    expect(gatherStudioHits).not.toHaveBeenCalled();
    expect(r.citations).toEqual([]);
  });

  it("★★ callerRole = 'admin' (CŨNG nằm trong allowlist) ⇒ gatherStudioHits ĐƯỢC gọi", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.9)]);
    const r = await retrieveKnowledge("hỏi gì đó", 5, { route: "vscode", callerRole: "admin" });
    expect(gatherStudioHits).toHaveBeenCalledTimes(1);
    expect(r.citations).toHaveLength(1);
  });
});

describe("§C — B2: HAI NGƯỠNG RIÊNG cho hai thang điểm khác nhau (không trộn bừa)", () => {
  // ★★★ Số đo THẬT (task-v8, POST sống `/api/ai/local-kb/stream`, corpus Studio thật lúc đo: 1 tài
  // liệu thử "AVI-STUDIO-PROBE-TASKV8" + 3 chunk có sẵn từ corpus vận hành cũ "so-tay-bao-tri-w2"):
  // câu hỏi ĐÚNG tài liệu ghi 0,7303 · ba chunk KHÔNG liên quan (quy trình thay vòi hút, ảnh chụp
  // màn hình duyệt ngưỡng) lọt qua ngưỡng CŨ 0,18 với 0,3134–0,4040 — phát hiện SỐNG dẫn tới nâng
  // `MIN_STUDIO_CITATION_SCORE` 0,18→0,5 (xem docblock lớn trong aiLocalKnowledgeService.ts). Ca
  // dưới đây dùng NGUYÊN VĂN hai đầu của cụm đo được làm fixture — không đoán/không bịa số đẹp.
  it("★★★ Studio score 0.40 (từng lọt qua ngưỡng CŨ 0,18 trong đo sống, ĐÚNG cụm nhiễu đo được) ⇒ NGƯỠNG MỚI 0,5 loại bỏ — không còn UI KHOAN DUNG kiểu 'giữ top-1 dù yếu' của nhánh web", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.4)]);
    const r = await retrieveKnowledge("hỏi gì đó", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.citations).toEqual([]);
  });

  it("★★★ Studio score 0.73 (ĐÚNG cụm tín hiệu đo được — tài liệu thử khớp thật) ⇒ giữ", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.73)]);
    const r = await retrieveKnowledge("hỏi gì đó", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0].score).toBeCloseTo(0.73);
  });

  it("★★★ Studio score 0.10 (dưới cả ngưỡng CŨ lẫn ngưỡng MỚI) ⇒ bị loại ở CẢ HAI đời ngưỡng", async () => {
    searchProgrammingKb.mockResolvedValue(emptyVendorResult);
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.1)]);
    const r = await retrieveKnowledge("hỏi gì đó", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.citations).toEqual([]);
  });

  it("★★ vendor score 0.4 (< 0.5, ngưỡng vendor RIÊNG không đổi) ⇒ vẫn bị loại NGAY CẢ KHI Studio đang hoạt động cùng lượt", async () => {
    searchProgrammingKb.mockResolvedValue(vendorHit(0.4));
    gatherStudioHits.mockResolvedValue([]);
    const r = await retrieveKnowledge("read modbus register on Delta AS300", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.citations).toEqual([]);
  });

  it("★★★ CẢ HAI nguồn cùng có hit hợp lệ ⇒ nối THEO THỨ TỰ CỐ ĐỊNH (vendor trước, Studio sau) — KHÔNG sắp lại theo điểm thô dù Studio điểm CAO HƠN vendor (hai thang không so sánh được)", async () => {
    searchProgrammingKb.mockResolvedValue(vendorHit(0.55)); // vendor thấp hơn nhưng đứng TRƯỚC
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.95)]); // Studio cao hơn nhưng đứng SAU
    const r = await retrieveKnowledge("read modbus register on Delta AS300", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.citations).toHaveLength(2);
    expect(r.citations[0].sourceType).toBe("vendor_manual");
    expect(r.citations[0].score).toBeCloseTo(0.55);
    expect(r.citations[1].sourceType).toBe("studio");
    expect(r.citations[1].score).toBeCloseTo(0.95);
    // Cặp context PHẢI đi đúng theo citation cùng index.
    expect(r.contexts[0]).toBe("Đọc thanh ghi qua Modbus RTU...");
    expect(r.contexts[1]).toBe("Nội dung tài liệu Studio người dùng nạp");
  });
});

describe("§D — ★★★ KHÔNG kéo theo kho VẬN HÀNH: fs của knowledge/* KHÔNG được chạm, dù Studio đang hoạt động", () => {
  it("★★★ Studio có hit thật, callerRole hợp lệ ⇒ fs (mock TOÀN BỘ node:fs) vẫn KHÔNG được gọi lần nào", async () => {
    searchProgrammingKb.mockResolvedValue(vendorHit(0.8));
    gatherStudioHits.mockResolvedValue([studioHit("s1", 0.7)]);
    await retrieveKnowledge("read modbus register on Delta AS300", 5, { route: "vscode", callerRole: "engineer" });
    expect(fsReadFileSync).not.toHaveBeenCalled();
    expect(fsExistsSync).not.toHaveBeenCalled();
  });
});

describe("§E — ĐỐI CHỨNG bắt buộc: route WEB không đổi hành vi bởi Việc 8", () => {
  it("★★★ route vắng/web ⇒ vẫn dùng kho vận hành (fs đọc), searchProgrammingKb/gatherStudioHits(qua đường vscode) KHÔNG được gọi trên nhánh này", async () => {
    const r = await retrieveKnowledge("OEE hôm nay bao nhiêu", 5, { callerRole: "engineer" });
    expect(searchProgrammingKb).not.toHaveBeenCalled();
    expect(fsReadFileSync).toHaveBeenCalled();
    expect(r.citations.some((c) => c.sourcePath === "domain/knowledge/OEE.md")).toBe(true);
  });
});

describe("§F — FAIL-SAFE: một nhánh Studio hỏng không được làm rớt phần vendor đã có", () => {
  it("★★ gatherStudioHits ném lỗi ⇒ citation vendor VẪN còn nguyên, không throw", async () => {
    searchProgrammingKb.mockResolvedValue(vendorHit(0.8));
    gatherStudioHits.mockRejectedValue(new Error("db down"));
    const r = await retrieveKnowledge("read modbus register on Delta AS300", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0].sourceType).toBe("vendor_manual");
  });

  it("★★ embedQuestion không có vector (CẢ GGUF lẫn Ollama fallback đều thất bại) ⇒ Studio bị bỏ qua SẠCH, vendor vẫn trả đúng, KHÔNG throw", async () => {
    // embedQuestion() rơi về embedQuestionOllama() (fetch thật) khi GGUF không sẵn sàng — máy dev
    // này CÓ THỂ đang chạy một dịch vụ thật ở OLLAMA_BASE_URL, nên phải chặn CẢ hai đường để ca này
    // tất định (không phụ thuộc có tiến trình nào đang lắng nghe cổng đó hay không). ★ Câu hỏi PHẢI
    // KHÁC mọi câu hỏi khác trong tệp lưới này: `embedQuestion()` có cache trong-tiến-trình theo
    // CHÍNH VĂN BẢN câu hỏi (`embedCache`, phạm vi module) — dùng lại "read modbus register on Delta
    // AS300" (đã được §D/§F ca 1 nhúng thành công trước đó) sẽ ăn cache và bỏ qua hoàn toàn nhánh
    // GGUF/Ollama đang bị chặn ở đây, làm ca này tự thoả (đã tự bắt được lỗi này khi viết lưới).
    isGgufAvailable.mockResolvedValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in test"));
    searchProgrammingKb.mockResolvedValue(vendorHit(0.8));
    const r = await retrieveKnowledge("read modbus register on Delta AS300 — câu hỏi riêng, chưa từng nhúng", 5, { route: "vscode", callerRole: "engineer" });
    expect(gatherStudioHits).not.toHaveBeenCalled();
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0].sourceType).toBe("vendor_manual");
    fetchSpy.mockRestore();
  });
});
