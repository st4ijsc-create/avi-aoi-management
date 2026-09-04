/**
 * Doc 34 · P1 — aiProgrammingKnowledgeService retrieval tests.
 *
 * Uses a TINY real on-disk fixture corpus under a temp dir (PROG_KB_DIR points at
 * it). Two collections:
 *   • mitsubishi/ — WITH embeddings.jsonl (semantic path)
 *   • zmotion/    — WITHOUT embeddings.jsonl (keyword-only path)
 *
 * The GGUF embedding engine and the reranker are MOCKED (no model/daemon load):
 *   • generateEmbedding → returns a fixed 1024-d unit vector matching chunk "m1"
 *   • rerank            → identity passthrough (preserves cosine order)
 *
 * Asserts: keyword-only works when embeddings absent; vendor & lang filters work;
 * PROG_KB_ENABLED=off returns an empty well-formed result; citations carry page +
 * docTitle.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIM = 1024;
function unit(seed: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[seed % DIM] = 1; // one-hot → already unit length
  return v;
}
const QUERY_VEC = unit(0); // matches chunk "m1" (its stored vector is unit(0))

// ─── Mocks: no GGUF model, no daemon ──────────────────────────────────────────
const generateEmbedding = vi.fn(async () => ({ embedding: QUERY_VEC, dimensions: DIM, modelId: "qwen3-embedding-0.6b" }));
const isGgufAvailable = vi.fn(async () => true);
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...(a as [])),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...(a as [])),
}));

// Reranker → identity passthrough (keeps cosine order deterministic; no model).
// G0 phần C — `RERANK_DELAY_MS` cho phép ca đo thời gian ép backend "tốn" một
// khoảng THẬT, để chứng minh `rerankMs` là phép ĐO chứ không phải hằng số 0.
let RERANK_DELAY_MS = 0;
vi.mock("./aiReranker", () => ({
  rerank: async (_q: string, candidates: Array<{ id: string }>, topN = 5) => {
    if (RERANK_DELAY_MS > 0) await new Promise((r) => setTimeout(r, RERANK_DELAY_MS));
    return candidates.slice(0, Math.max(1, topN)).map((candidate, i) => ({
      candidate,
      rerankScore: candidates.length > 0 ? 1 - i / candidates.length : 0,
    }));
  },
}));

// ─── Fixture corpus ───────────────────────────────────────────────────────────
let tmpDir: string;

const mitsubishiChunks = [
  { id: "m1", vendor: "Mitsubishi", docTitle: "MELSEC iQ-R Programming", sourcePath: "manuals/mitsubishi/melsec.pdf", page: 42, lang: "en", section: "MOV instruction", text: "The MOV instruction transfers data from a source device to a destination device.", keywords: ["mov", "instruction", "melsec"] },
  { id: "m2", vendor: "Mitsubishi", docTitle: "MELSEC iQ-R Programming", sourcePath: "manuals/mitsubishi/melsec.pdf", page: 88, lang: "vi", section: "Lệnh TIMER", text: "Lệnh TIMER dùng để tạo bộ đếm thời gian trong chương trình PLC.", keywords: ["timer", "dong ho"] },
];
const mitsubishiEmb = [
  { id: "m1", vector: unit(0) },
  { id: "m2", vector: unit(5) },
];
const zmotionChunks = [
  { id: "z1", vendor: "Zmotion", docTitle: "ZBasic Command Reference", sourcePath: "manuals/zmotion/zbasic.pdf", page: 12, lang: "en", section: "MOVE", text: "The MOVE command performs an absolute linear interpolation move on the specified axis.", keywords: ["move", "axis", "zbasic"] },
];
const manifest = {
  generatedAt: "2026-07-05T00:00:00.000Z",
  embedModel: "qwen3-embedding-0.6b-f16",
  totalChunks: 3,
  collections: [
    { vendor: "Mitsubishi", docs: 1, chunks: 2, sourceDir: "mitsubishi" },
    { vendor: "Zmotion", docs: 1, chunks: 1, sourceDir: "zmotion" },
  ],
};

function writeJsonl(file: string, rows: unknown[]): void {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n"), "utf8");
}

// Import AFTER mocks are registered.
import {
  searchProgrammingKb,
  getProgrammingKbStatus,
  reloadProgrammingKb,
  isProgrammingKbEnabled,
  getProgrammingKbVendorSlugs,
} from "./aiProgrammingKnowledgeService";

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "progkb-"));
  fs.mkdirSync(path.join(tmpDir, "mitsubishi"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "zmotion"), { recursive: true });
  writeJsonl(path.join(tmpDir, "mitsubishi", "chunks.jsonl"), mitsubishiChunks);
  writeJsonl(path.join(tmpDir, "mitsubishi", "embeddings.jsonl"), mitsubishiEmb);
  writeJsonl(path.join(tmpDir, "zmotion", "chunks.jsonl"), zmotionChunks);
  // zmotion has NO embeddings.jsonl → keyword-only collection.
  fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest), "utf8");

  process.env.PROG_KB_DIR = tmpDir;
  delete process.env.PROG_KB_EMBED_MODEL; // resolve query model from manifest
  process.env.PROG_KB_EMBED_DIM = "1024";
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "qwen3-embedding-0.6b" });
  isGgufAvailable.mockResolvedValue(true);
  process.env.PROG_KB_ENABLED = "true";
  reloadProgrammingKb(); // reset the module cache against the fixture dir
});

describe("aiProgrammingKnowledgeService", () => {
  it("loads both collections and reports totals via getProgrammingKbStatus", () => {
    const status = getProgrammingKbStatus();
    expect(status.enabled).toBe(true);
    expect(status.totalChunks).toBe(3);
    expect(status.collections).toHaveLength(2);
    const slugs = status.collections.map((c) => c.vendorSlug).sort();
    expect(slugs).toEqual(["mitsubishi", "zmotion"]);
    const zmo = status.collections.find((c) => c.vendorSlug === "zmotion")!;
    expect(zmo.hasEmbeddings).toBe(false);
    const mit = status.collections.find((c) => c.vendorSlug === "mitsubishi")!;
    expect(mit.hasEmbeddings).toBe(true);
    // query embed model resolved from manifest → matches corpus.
    expect(status.embedModelMatches).toBe(true);
  });

  it("keyword-only retrieval works when embeddings are absent (zmotion collection)", async () => {
    const res = await searchProgrammingKb({ query: "MOVE command axis interpolation", vendor: "zmotion" });
    expect(res.enabled).toBe(true);
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations[0].id).toBe("z1");
    // No usable vector for zmotion → semantic did not contribute.
    expect(res.semanticUsed).toBe(false);
    // generateEmbedding may be called once (mitsubishi has vectors) but is never
    // applied to zmotion chunks; result is still purely keyword-scored here.
  });

  it("uses the semantic vector when embeddings exist (mitsubishi 'm1' ranks first)", async () => {
    const res = await searchProgrammingKb({ query: "how does the data transfer instruction work" });
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations[0].id).toBe("m1"); // stored vector == query vector → cosine 1
    expect(res.semanticUsed).toBe(true);
  });

  it("vendor filter restricts results to the requested vendor", async () => {
    const res = await searchProgrammingKb({ query: "instruction move", vendor: "mitsubishi", topK: 10 });
    expect(res.citations.length).toBeGreaterThan(0);
    // z1 (Zmotion) must NOT appear.
    expect(res.citations.every((c) => c.vendor.toLowerCase() === "mitsubishi")).toBe(true);
    expect(res.citations.some((c) => c.id === "z1")).toBe(false);
  });

  it("lang filter restricts results to the requested language", async () => {
    const res = await searchProgrammingKb({ query: "lệnh timer instruction move", lang: "vi", topK: 10 });
    expect(res.citations.length).toBeGreaterThan(0);
    // Only the Vietnamese chunk m2 qualifies (m1=en, z1=en excluded).
    expect(res.citations.every((c) => c.id === "m2")).toBe(true);
    expect(res.chunks.every((c) => c.lang === "vi")).toBe(true);
  });

  it("citation shape carries page + docTitle (+ vendor/section/sourcePath)", async () => {
    const res = await searchProgrammingKb({ query: "MOV instruction", vendor: "mitsubishi" });
    const top = res.citations[0];
    expect(top).toBeDefined();
    expect(typeof top.docTitle).toBe("string");
    expect(top.docTitle.length).toBeGreaterThan(0);
    expect(typeof top.page).toBe("number");
    expect(top.vendor).toBe("Mitsubishi");
    expect(typeof top.sourcePath).toBe("string");
    // answerContext embeds the page citation "…, p.N".
    expect(res.answerContext).toMatch(/p\.\d+/);
  });

  it("PROG_KB_ENABLED=off → empty, well-formed result (no crash)", async () => {
    process.env.PROG_KB_ENABLED = "false";
    expect(isProgrammingKbEnabled()).toBe(false);
    const res = await searchProgrammingKb({ query: "MOV instruction" });
    expect(res.enabled).toBe(false);
    expect(res.citations).toEqual([]);
    expect(res.chunks).toEqual([]);
    expect(res.answerContext).toBe("");
    expect(res.semanticUsed).toBe(false);
  });

  // ─── G0 phần C — chi phí rerank phải ĐO ĐƯỢC từ tầng trên ──────────────────

  it("rerankMs mang số ĐO THẬT (backend chậm 40 ms ⇒ ≥ 35 ms), không phải hằng số", async () => {
    RERANK_DELAY_MS = 40;
    try {
      const res = await searchProgrammingKb({ query: "MOV instruction" });
      expect(typeof res.rerankMs).toBe("number");
      expect(res.rerankMs!).toBeGreaterThanOrEqual(35);
    } finally {
      RERANK_DELAY_MS = 0;
    }
  });

  it("PROG_KB_RERANKER_ENABLED=false ⇒ rerankMs = null (CHƯA CHẠY), KHÔNG phải 0", async () => {
    process.env.PROG_KB_RERANKER_ENABLED = "false";
    try {
      const res = await searchProgrammingKb({ query: "MOV instruction" });
      expect(res.citations.length).toBeGreaterThan(0); // vẫn trả kết quả cosine
      expect(res.rerankMs).toBeNull();
    } finally {
      delete process.env.PROG_KB_RERANKER_ENABLED;
    }
  });

  it("kết quả rỗng (cờ tắt) cũng khai rerankMs = null, không bỏ trống trường", async () => {
    process.env.PROG_KB_ENABLED = "false";
    const res = await searchProgrammingKb({ query: "MOV instruction" });
    expect(res.rerankMs).toBeNull();
  });

  it("degrades to an empty result when the corpus dir is absent (never throws)", async () => {
    const missing = path.join(tmpDir, "does-not-exist-xyz");
    const prev = process.env.PROG_KB_DIR;
    process.env.PROG_KB_DIR = missing;
    reloadProgrammingKb();
    const res = await searchProgrammingKb({ query: "anything" });
    expect(res.enabled).toBe(true);
    expect(res.citations).toEqual([]);
    // restore for subsequent tests
    process.env.PROG_KB_DIR = prev;
    reloadProgrammingKb();
  });

  // ─── ★★★ Phản hồi chủ dự án 2026-09-04 (sau task-v7) — "danh sách hãng chép tay là bản sao thứ
  // hai của một sự thật": `getProgrammingKbVendorSlugs()` phải đọc TỪ `manifest.json`, KHÔNG phải
  // một bảng hằng ở nơi gọi (`aiLocalKnowledgeService.detectProgrammingVendors`). Dùng CHÍNH cây
  // tmpDir thật (không mock fs) — viết một `manifest.json` KHÁC (hãng giả thêm vào, hoặc hỏng) rồi
  // `reloadProgrammingKb()` để buộc đọc lại đĩa. KHÔNG đụng `knowledge/programming/manifest.json`
  // thật của dự án — mọi thao tác ở đây chỉ chạm `tmpDir` (dọn ở `afterAll`).
  describe("getProgrammingKbVendorSlugs — nguồn THẬT là manifest.json, fail-safe khi hỏng", () => {
    afterEach(() => {
      // mọi ca dưới đây tự ghi đè manifest.json trong tmpDir — khôi phục bản gốc (2 hãng) +
      // reload, để không rò rỉ trạng thái sang các describe khác trong cùng tệp.
      fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      reloadProgrammingKb();
    });

    it("đọc đúng danh sách hãng từ manifest.json thật (fixture 2 hãng), viết thường", () => {
      expect(getProgrammingKbVendorSlugs().sort()).toEqual(["mitsubishi", "zmotion"]);
    });

    it("★★★ hãng thứ ba thêm vào manifest.json (KHÔNG đụng tệp thật của dự án, không cần thư mục thật) ⇒ NHẬN ĐƯỢC ngay — chứng minh nguồn là manifest, không phải bảng tay", () => {
      const withThirdVendor = {
        ...manifest,
        collections: [...manifest.collections, { vendor: "Acme-Robotics", docs: 1, chunks: 1, sourceDir: "acme-robotics" }],
      };
      fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(withThirdVendor), "utf8");
      reloadProgrammingKb();
      expect(getProgrammingKbVendorSlugs().sort()).toEqual(["acme-robotics", "mitsubishi", "zmotion"]);
    });

    it("manifest.json BỊ XOÁ ⇒ mảng RỖNG, KHÔNG throw (an toàn = không lọc, không phải lỗi)", () => {
      fs.rmSync(path.join(tmpDir, "manifest.json"));
      reloadProgrammingKb();
      expect(() => getProgrammingKbVendorSlugs()).not.toThrow();
      expect(getProgrammingKbVendorSlugs()).toEqual([]);
    });

    it("manifest.json JSON HỎNG (không parse được) ⇒ mảng RỖNG, KHÔNG throw", () => {
      fs.writeFileSync(path.join(tmpDir, "manifest.json"), "{ khong phai json hop le ][", "utf8");
      reloadProgrammingKb();
      expect(() => getProgrammingKbVendorSlugs()).not.toThrow();
      expect(getProgrammingKbVendorSlugs()).toEqual([]);
    });

    it("manifest.json thiếu hẳn trường `collections` ⇒ mảng RỖNG, KHÔNG throw", () => {
      fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ generatedAt: manifest.generatedAt }), "utf8");
      reloadProgrammingKb();
      expect(getProgrammingKbVendorSlugs()).toEqual([]);
    });

    it("`collections` không phải mảng (bị hỏng dạng khác) ⇒ mảng RỖNG, KHÔNG throw", () => {
      fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ ...manifest, collections: "khong-phai-mang" }), "utf8");
      reloadProgrammingKb();
      expect(getProgrammingKbVendorSlugs()).toEqual([]);
    });
  });
});
