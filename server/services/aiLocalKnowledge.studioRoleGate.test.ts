/**
 * Final-fix round, Task 6 (SECURITY, product-owner decision) — role gate for retrieveKnowledge's
 * Training Studio corpus merge. Companion to aiLocalKnowledge.studioMerge.integration.test.ts
 * (which covers merge CORRECTNESS for an eligible caller); this file covers WHO is eligible.
 *
 * Mirrors that file's mock scaffolding (WS-G4 / studioMerge.integration.test.ts) so the Studio
 * merge block (aiLocalKnowledgeService.ts) actually executes without a real DB or model.
 *
 * Required scenarios (final-fix-brief.md, Task 6):
 *  - admin ⇒ has Studio citations
 *  - engineer ⇒ has Studio citations
 *  - operator ⇒ NO Studio citations at all, system-source results UNCHANGED vs an empty Studio
 *    corpus
 *  - unrecognized/undefined role ⇒ NO Studio citations (fail-closed)
 *  - `contexts` (not just `citations`) must never carry Studio text for an ineligible caller —
 *    `contexts` is what actually gets fed into the LLM prompt, so citations-only checks would
 *    miss the real leak path.
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

const chunks = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/A.md", title: "A", text: "SYSTEM_TEXT_C1", keywords: ["aoi"] },
  { id: "c2", sourceType: "doc", sourcePath: "docs/B.md", title: "B", text: "SYSTEM_TEXT_C2", keywords: ["aoi"] },
];
const embeddings = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/A.md", title: "A", keywords: ["aoi"], textLength: 20, embeddingDim: DIM, embedding: unit(0) },
  { id: "c2", sourceType: "doc", sourcePath: "docs/B.md", title: "B", keywords: ["aoi"], textLength: 20, embeddingDim: DIM, embedding: unit(0) },
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

const STUDIO_HIT = { id: 101, text: "STUDIO_SECRET_TEXT", sourceRef: "studio-doc.pdf", score: 0.9, corpus: "manuals" };

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });
  gatherStudioHitsMock.mockResolvedValue([STUDIO_HIT]);
  reloadKbArtifacts();
});

describe("retrieveKnowledge — Task 6 role gate (canAccessStudioCorpus)", () => {
  it("admin ⇒ CÓ trích dẫn Studio", async () => {
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "admin" });
    expect(res.citations.some((c) => c.origin === "studio")).toBe(true);
    expect(res.contexts).toContain("STUDIO_SECRET_TEXT");
  });

  it("engineer ⇒ CÓ trích dẫn Studio", async () => {
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });
    expect(res.citations.some((c) => c.origin === "studio")).toBe(true);
    expect(res.contexts).toContain("STUDIO_SECRET_TEXT");
  });

  it("operator ⇒ KHÔNG có bất kỳ trích dẫn Studio nào — citations VÀ contexts", async () => {
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "operator" });
    expect(res.citations.some((c) => c.origin === "studio")).toBe(false);
    expect(res.citations.some((c) => String(c.id).startsWith("studio:"))).toBe(false);
    // contexts là thứ THẬT SỰ nhồi vào prompt LLM — đây là đường rò thật, không chỉ citations.
    expect(res.contexts).not.toContain("STUDIO_SECRET_TEXT");
    expect(res.contexts.some((t) => t.includes("STUDIO_SECRET_TEXT"))).toBe(false);
  });

  it("operator ⇒ kết quả nguồn hệ thống KHÔNG đổi so với khi kho Studio rỗng (không lộ sự tồn tại)", async () => {
    const withStudioHit = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "operator" });

    gatherStudioHitsMock.mockResolvedValue([]);
    const withEmptyStudio = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "operator" });

    // Không có cách nào từ output phân biệt "bị chặn quyền" với "kho rỗng" — đúng yêu cầu
    // "không rò rỉ sự tồn tại": im lặng là đúng, nói ra ("có N tài liệu bạn không được xem")
    // mới là sai.
    expect(withStudioHit.citations).toEqual(withEmptyStudio.citations);
    expect(withStudioHit.contexts).toEqual(withEmptyStudio.contexts);
    expect(withStudioHit.confidence).toBe(withEmptyStudio.confidence);
  });

  it("vai trò KHÔNG xác định (context không có callerRole) ⇒ KHÔNG có trích dẫn Studio (fail-closed)", async () => {
    const res = await retrieveKnowledge("hỏi về AOI", 5, {});
    expect(res.citations.some((c) => c.origin === "studio")).toBe(false);
    expect(res.contexts).not.toContain("STUDIO_SECRET_TEXT");
  });

  it("context hoàn toàn undefined (không truyền) ⇒ KHÔNG có trích dẫn Studio (fail-closed)", async () => {
    const res = await retrieveKnowledge("hỏi về AOI", 5);
    expect(res.citations.some((c) => c.origin === "studio")).toBe(false);
    expect(res.contexts).not.toContain("STUDIO_SECRET_TEXT");
  });

  it("vai trò lạ/gõ sai (vd 'Admin' hoa, hoặc rác) ⇒ KHÔNG có trích dẫn Studio (fail-closed, allowlist khớp chính xác)", async () => {
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "Admin" });
    expect(res.citations.some((c) => c.origin === "studio")).toBe(false);
  });

  it("mọi vai trò RBAC KHÁC admin/engineer (supervisor/quality_inspector/maintenance/viewer/user) ⇒ KHÔNG có trích dẫn Studio", async () => {
    for (const role of ["supervisor", "quality_inspector", "maintenance", "viewer", "user"]) {
      const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: role });
      expect(res.citations.some((c) => c.origin === "studio")).toBe(false);
      expect(res.contexts).not.toContain("STUDIO_SECRET_TEXT");
    }
  });

  it("gatherStudioHits KHÔNG được gọi khi role không đủ quyền (không chỉ lọc kết quả — không truy vấn luôn)", async () => {
    await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "operator" });
    expect(gatherStudioHitsMock).not.toHaveBeenCalled();
  });

  it("gatherStudioHits ĐƯỢC gọi khi role đủ quyền", async () => {
    await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });
    expect(gatherStudioHitsMock).toHaveBeenCalled();
  });
});
