/**
 * G0 phần C — ĐỒNG HỒ CHO RERANKER.
 *
 * Trước task này `aiReranker.ts` dài 759 dòng và KHÔNG có một `Date.now()` /
 * `performance.now()` nào. Con số duy nhất đang lưu hành là một dòng chú thích
 * ở `aiReranker.ts:~383` — *"CPU rerank of ~20 short docs is only tens of ms"* —
 * **không kèm một phép đo nào**. Reranker chạy CPU (`RAG_RERANKER_GPU=false`),
 * cross-encoder `bge-reranker-v2-m3-Q8_0` (635 MB, 25 lớp), 20 tài liệu × 480 ký
 * tự mỗi lượt truy vấn RAG. Không ai biết nó tốn bao nhiêu ms.
 *
 * Lưới này canh ba điều:
 *   1. mỗi lượt `rerank()` để lại một phép đo ĐỌC ĐƯỢC (`getRerankerTimings()`);
 *   2. phép đo phản ánh thời gian THẬT của backend (mock backend ngủ 40 ms ⇒ số đo
 *      phải ≥ 40 ms — không phải một hằng số 0 dán vào cho có);
 *   3. dòng log có cấu trúc KHÔNG rò câu hỏi hay nội dung tài liệu.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const BACKEND_DELAY_MS = 40;

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: async () => true,
  generateText: async () => {
    await new Promise((r) => setTimeout(r, BACKEND_DELAY_MS));
    return { text: '[{"i":0,"s":0.2},{"i":1,"s":0.9},{"i":2,"s":0.5}]' };
  },
}));

import { rerank, getRerankerTimings, getRerankerStatus, resetRerankerTimings, type RerankCandidate } from "./aiReranker";

const ENV_KEYS = ["RAG_RERANKER_ENABLED", "RAG_RERANKER_MODE", "GGUF_RERANKER_MODEL", "GGUF_MODELS_DIR"] as const;
let saved: Record<string, string | undefined>;

const CANDIDATES: RerankCandidate[] = [
  { id: "a", text: "alpha", score: 0.1 },
  { id: "b", text: "bravo", score: 0.9 },
  { id: "c", text: "charlie", score: 0.5 },
];

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetRerankerTimings();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("aiReranker — đồng hồ", () => {
  it("chưa chạy lượt nào ⇒ KHÔNG bịa số (null, không phải 0)", () => {
    const t = getRerankerTimings();
    expect(t.runs).toBe(0);
    expect(t.lastMs).toBeNull();
    expect(t.avgMs).toBeNull();
    expect(t.maxMs).toBeNull();
    expect(t.lastBackend).toBeNull();
  });

  it("backend llm ngủ 40 ms ⇒ số đo THẬT ≥ 40 ms, không phải hằng số", async () => {
    process.env.RAG_RERANKER_ENABLED = "true"; // mode mặc định = llm

    const out = await rerank("câu hỏi", CANDIDATES, 3);

    // Backend thật sự đã chạy (thứ tự bị đảo theo điểm 0.9 > 0.5 > 0.2).
    expect(out.map((r) => r.candidate.id)).toEqual(["b", "c", "a"]);

    const t = getRerankerTimings();
    expect(t.runs).toBe(1);
    expect(t.lastBackend).toBe("llm");
    expect(t.lastMs).not.toBeNull();
    expect(t.lastMs!).toBeGreaterThanOrEqual(BACKEND_DELAY_MS - 5);
    // Thời gian chấm điểm của backend nằm TRONG tổng thời gian của lượt rerank.
    expect(t.lastScoringMs).not.toBeNull();
    expect(t.lastScoringMs!).toBeLessThanOrEqual(t.lastMs!);
    expect(t.maxMs!).toBeGreaterThanOrEqual(t.lastMs!);
    expect(t.avgMs!).toBeGreaterThanOrEqual(BACKEND_DELAY_MS - 5);
  });

  it("hai lượt ⇒ runs=2 và avg/max cộng dồn đúng", async () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    await rerank("q1", CANDIDATES, 3);
    await rerank("q2", CANDIDATES, 3);

    const t = getRerankerTimings();
    expect(t.runs).toBe(2);
    expect(t.maxMs!).toBeGreaterThanOrEqual(t.avgMs!);
    expect(t.avgMs!).toBeGreaterThanOrEqual(BACKEND_DELAY_MS - 5);
  });

  it("reranker TẮT ⇒ vẫn ghi lượt, backend=identity, và KHÔNG log (tránh nhiễu)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await rerank("q", CANDIDATES, 3);

    const t = getRerankerTimings();
    expect(t.runs).toBe(1);
    expect(t.lastBackend).toBe("identity");
    expect(t.lastMs).not.toBeNull();
    expect(logSpy.mock.calls.some((c) => String(c[0]).startsWith("[aiReranker] rerank "))).toBe(false);
  });

  it("dòng log có cấu trúc: có số, KHÔNG có câu hỏi và KHÔNG có nội dung tài liệu", async () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await rerank("BIMAT_CAU_HOI_NGUOI_DUNG", [
      { id: "a", text: "BIMAT_NOI_DUNG_TAI_LIEU", score: 0.1 },
      { id: "b", text: "bravo", score: 0.9 },
      { id: "c", text: "charlie", score: 0.5 },
    ], 3);

    const line = logSpy.mock.calls.map((c) => c.map(String).join(" ")).find((l) => l.includes("[aiReranker] rerank "));
    expect(line).toBeDefined();
    expect(line).toMatch(/backend=llm/);
    expect(line).toMatch(/docs=3/);
    expect(line).toMatch(/topN=3/);
    expect(line).toMatch(/ms=\d+/);
    expect(line).not.toContain("BIMAT_CAU_HOI_NGUOI_DUNG");
    expect(line).not.toContain("BIMAT_NOI_DUNG_TAI_LIEU");
  });

  it("getRerankerStatus() mang theo phép đo để tầng trên hiển thị được", async () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    await rerank("q", CANDIDATES, 2);

    const s = getRerankerStatus();
    expect(s.enabled).toBe(true);
    expect(s.timings.runs).toBe(1);
    expect(s.timings.lastMs!).toBeGreaterThanOrEqual(BACKEND_DELAY_MS - 5);
    // Model GGUF chưa từng nạp trong ca này ⇒ null (chưa biết), không phải 0.
    expect(s.timings.contextLoadMs).toBeNull();
  });
});
