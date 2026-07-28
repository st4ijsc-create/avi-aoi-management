/**
 * Chốt cuối (post-Task-6 re-review), mục 1 — `confidence` PHẢI chỉ NÂNG, không bao giờ HẠ,
 * khi trộn thêm một nguồn Studio. Đúng lớp lỗi mà Task 3 (final-fix round, mục "I-1") sinh ra
 * để chữa — tái phát vì công thức TÍNH LẠI (sau khi trộn) không tính tới trường hợp:
 *
 *   Khi CHỈ 1 trích dẫn hệ thống sống sót lọc `MIN_CITATION_SCORE`, code cũ NHÂN ĐÔI nó làm
 *   top2 (`ranked[Math.min(1, ranked.length-1)] === ranked[0]` khi `ranked.length===1`). Sau
 *   khi trộn Studio, top2 đổi thành điểm Studio THẬT (thường THẤP HƠN điểm hệ thống duy nhất
 *   đó, vì nếu cao hơn nó đã lên vị trí top1) ⇒ confidence TỤT — một nguồn bổ sung khiến câu
 *   trả lời TỆ ĐI (rớt dưới ngưỡng 0.30 khiến answerQuestion() không gọi LLM nữa).
 *
 * Kịch bản CHÍNH XÁC theo số đo của reviewer:
 *   1 citation hệ thống điểm 0.25 ⇒ trước khi trộn: (0.25+0.25)/1.6 = 0.3125 ≥ 0.30.
 *   Thêm hit Studio điểm 0.18 (vừa qua sàn MIN_CITATION_SCORE) ⇒ SAU khi trộn (code cũ):
 *   (0.25+0.18)/1.6 = 0.26875 < 0.30 — tụt dưới ngưỡng.
 *
 * Để đạt CHÍNH XÁC điểm hệ thống 0.25 qua pipeline tính điểm thật (semantic*0.72 +
 * keyword*0.28, nhân các trọng số nguồn/loại/ngôn ngữ), bài test này:
 *   - `embedQuestionGguf()` (aiLocalKnowledgeService.ts) L2-CHUẨN HOÁ mọi vector câu hỏi
 *     trước khi dùng — một vector "thô" chỉ có MỘT thành phần khác 0 luôn bị kéo về đúng 1.0
 *     bất kể giá trị gốc, nên KHÔNG dùng được để dựng `semantic` phân số. Dùng vector 2-thành-
 *     phần ĐÃ có độ dài 1 sẵn (`biasedUnit`) — chuẩn hoá là phép đồng nhất, giữ nguyên giá trị
 *     đặt trước ⇒ semantic = 0.25/0.72 chính xác qua tích vô hướng với embedding chunk.
 *   - Câu hỏi + text/title/path/keywords của chunk dùng CHUỖI KHÔNG-CHỮ-CÁI-CHUNG (kiểm tra kỹ
 *     không trùng SUBSTRING nào — `keywordScore()` so bằng `.includes()`, không phải so token
 *     chính xác) ⇒ keyword=0 tuyệt đối, không chỉ "trông có vẻ không liên quan".
 *   - sourceType/sourcePath trung tính (không khớp bất kỳ regex trọng số ngôn ngữ/loại nào)
 *     ⇒ langWeight=typeWeight=routeWeight=feedbackWeight=1, không làm lệch số.
 *   - CHỈ MỘT chunk hệ thống trong toàn kho ⇒ `ranked.length === 1` (đúng điều kiện sinh bug).
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
/**
 * Vector ĐÃ chuẩn hoá độ dài 1 (đặt `value` tại `seedA`, `sqrt(1-value²)` tại `seedB`) — QUAN
 * TRỌNG: `embedQuestionGguf()` (aiLocalKnowledgeService.ts) gọi `l2normalizeVec()` trên MỌI
 * embedding câu hỏi trước khi dùng, nên một vector "thô" chỉ có một thành phần khác 0 (như
 * `unit()`) LUÔN bị chuẩn hoá về đúng 1.0 tại thành phần đó bất kể giá trị gốc — không thể
 * dùng để dựng một `semantic` PHÂN SỐ. Vector 2-thành-phần này đã có độ dài 1 SẴN (value² +
 * (1-value²) = 1) nên `l2normalizeVec` là PHÉP ĐỒNG NHẤT (chia cho norm=1) — giữ nguyên `value`
 * tại `seedA`. Tích vô hướng với `unit(seedA)` (embedding chunk) = `value` chính xác (thành
 * phần `seedB` không đóng góp gì vì embedding chunk bằng 0 tại đó).
 */
function biasedUnit(seedA: number, seedB: number, value: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seedA % DIM] = value;
  v[seedB % DIM] = Math.sqrt(Math.max(0, 1 - value * value));
  return v;
}

// score = semantic*0.72 + keyword*0.28, keyword=0 (không khớp từ khoá nào) ⇒ score = semantic*0.72.
// Muốn score = 0.25 ⇒ semantic = 0.25/0.72.
const TARGET_SCORE = 0.25;
const SEMANTIC_FOR_TARGET = TARGET_SCORE / 0.72;
const QUERY_VEC = biasedUnit(0, 1, SEMANTIC_FOR_TARGET);

// CHỈ MỘT chunk hệ thống. sourceType "technical" (không phải feature/domain/doc) ⇒
// typeWeight=1. sourcePath trung tính (không khớp VN_BOOST/EN_DEMOTE/NOISE regex) ⇒
// langWeight=1. Text/title/path/keywords của chunk dùng chuỗi vô nghĩa KHÔNG chia sẻ bất kỳ
// substring nào với QUESTION bên dưới (đã rà tay từng token — xem QUESTION) ⇒ keyword=0 tuyệt
// đối (keywordScore() so bằng `.includes()` — một câu hỏi tiếng Việt "trông không liên quan"
// vẫn có thể trùng substring với văn bản chunk qua các âm tiết thông dụng, như đã xảy ra ở
// vòng nháp đầu của bài test này — "liên"/"quan" trong câu hỏi khớp substring "khong_lien_quan"
// trong text, làm keyword≠0 ngoài ý muốn).
const chunks = [
  { id: "c1", sourceType: "technical", sourcePath: "misc/qzvbx-wklpt.md", title: "Qzvbx Wklpt Note", text: "QZVBX_WKLPT_FJRMD_HGNCX", keywords: [] },
];
const embeddings = [
  { id: "c1", sourceType: "technical", sourcePath: "misc/qzvbx-wklpt.md", title: "Qzvbx Wklpt Note", keywords: [], textLength: 20, embeddingDim: DIM, embedding: unit(0) },
];

// Câu hỏi gồm toàn token vô nghĩa TỪ MỘT BỘ CHỮ CÁI KHÁC HẲN chunk ở trên (đã rà tay: không
// token nào của câu hỏi là substring của "qzvbx_wklpt_fjrmd_hgncx"/title/path, và ngược lại;
// không token nào là stopword tiếng Việt/Anh trong STOP_WORDS).
const UNRELATED_QUESTION = "zzqx wvbn plkj asdh qwop mnbv";

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

vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
}));

const gatherStudioHitsMock = vi.fn();
vi.mock("./aiLocalKnowledgeStudio", () => ({ gatherStudioHits: (...a: any[]) => gatherStudioHitsMock(...a) }));

import { retrieveKnowledge, reloadKbArtifacts } from "./aiLocalKnowledgeService";

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });
  reloadKbArtifacts();
});

describe("retrieveKnowledge — confidence chỉ NÂNG, không bao giờ HẠ khi trộn Studio (Chốt cuối, mục 1)", () => {
  it("1 citation hệ thống điểm 0.25 (đã xác nhận) + hit Studio 0.18 ⇒ confidence VẪN ≥ 0.30 (không tụt dưới ngưỡng shouldUseLlm)", async () => {
    // Xác nhận trước: điểm hệ thống thật sự là 0.25 (không phải suy đoán) — nếu phép dựng
    // fixture ở trên sai, test này tự lộ ngay ở assertion đầu tiên thay vì âm thầm pass nhờ
    // trùng hợp số học khác.
    const withoutStudio = await retrieveKnowledge(UNRELATED_QUESTION, 5);
    expect(withoutStudio.citations).toHaveLength(1);
    expect(withoutStudio.citations[0]?.score).toBeCloseTo(0.25, 6);
    // (0.25+0.25)/1.6 = 0.3125 — công thức GỐC (chưa trộn) đã ≥ 0.30.
    expect(withoutStudio.confidence).toBeCloseTo(0.3125, 4);

    gatherStudioHitsMock.mockResolvedValue([
      { id: 901, text: "STUDIO_JUST_ABOVE_FLOOR", sourceRef: "studio-floor.pdf", score: 0.18, corpus: "manuals" },
    ]);
    const withStudio = await retrieveKnowledge(UNRELATED_QUESTION, 5, { callerRole: "engineer" });

    // Trộn đúng — citation hệ thống (0.25) vẫn đứng đầu, Studio (0.18) đứng sau.
    expect(withStudio.citations[0]?.score).toBeCloseTo(0.25, 6);
    expect(withStudio.citations[1]?.score).toBeCloseTo(0.18, 6);

    // BẤT BIẾN MỚI (Chốt cuối) — bổ sung một nguồn KHÔNG được làm confidence tệ đi.
    // Trước khi sửa (Math.max): (0.25+0.18)/1.6 = 0.26875 < 0.30 — ĐỎ ở đây.
    expect(withStudio.confidence).toBeGreaterThanOrEqual(0.3);
    // Mạnh hơn "≥0.30" đơn thuần: confidence sau khi trộn KHÔNG ĐƯỢC THẤP HƠN trước khi trộn —
    // đây là phát biểu tổng quát của "chỉ NÂNG, không HẠ" (không chỉ đúng ngay tại ngưỡng 0.30).
    expect(withStudio.confidence).toBeGreaterThanOrEqual(withoutStudio.confidence);
  });

  it("hit Studio CAO HƠN citation hệ thống duy nhất ⇒ confidence vẫn được NÂNG lên đúng theo điểm Studio thật (không bị khoá cứng ở giá trị nhân đôi)", async () => {
    // Ca đối chứng: Math.max không được biến confidence thành một TRẦN không bao giờ vượt qua
    // được — khi Studio THỰC SỰ tốt hơn, confidence phải phản ánh đúng, không bị "kẹt" ở công
    // thức nhân-đôi cũ.
    gatherStudioHitsMock.mockResolvedValue([
      { id: 902, text: "STUDIO_STRONG_HIT", sourceRef: "studio-strong.pdf", score: 0.95, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge(UNRELATED_QUESTION, 5, { callerRole: "engineer" });

    expect(res.citations[0]?.id).toBe("studio:manuals:902");
    // (0.95+0.25)/1.6 = 0.75 — cao hơn hẳn 0.3125 (giá trị nhân-đôi cũ) — Math.max phải chọn
    // giá trị THẬT này, không giữ nguyên 0.3125.
    expect(res.confidence).toBeCloseTo(0.75, 4);
  });
});
