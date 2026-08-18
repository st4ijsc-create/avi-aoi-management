/**
 * aiModelRouter — HỒ SƠ ĐẶC TÍNH MODEL (G5-B, 2026-08-16).
 *
 * ─── LỚP LỖI ĐANG CANH ────────────────────────────────────────────────────────────────────────
 * Ngưỡng định tuyến (`easyMaxChars` 160 · `hardMinChars` 700 · `latencyPinMs` 700) được RÚT RA từ
 * một phép đo cụ thể trên MỘT roster cụ thể: Qwen3-30B-A3B (MoE, 3B active, cold-load 6,04 s) +
 * Qwen3-4B. Chúng nằm trong mã dưới dạng **số trần trong biểu thức**, chỉ có một câu chú thích
 * nhắc tới phép đo. Đổi roster sang model dense 27B (đặc tính khác hẳn) thì các số ấy **vẫn chạy,
 * vẫn xanh, và không còn đúng** — không có gì đỏ, không có gì kêu.
 *
 * ⇒ Lưới này canh HAI thứ, và cố ý KHÔNG canh thứ ba:
 *   (1) ngưỡng **rút được từ cấu hình/phép đo** — đổi nguồn thì quyết định đổi theo (nếu ai đó
 *       nối lại số trần vào biểu thức, ca ĐỎ);
 *   (2) chạy model **chưa có phép đo của ta** thì hệ phải **KÊU**, không im lặng dùng số của model
 *       khác (đây là phần chống lớp lỗi thật sự);
 *   (3) ✗ KHÔNG canh "ngưỡng phải bằng bao nhiêu là ĐÚNG" — chưa ai đo, và một con số bịa ra ở
 *       đây sẽ thành "thước xanh giả có hình dạng đúng bằng kết luận thật".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./aiGgufEngine", () => ({ ggufModelFileExists: vi.fn(() => false) }));

async function freshRouter() {
  vi.resetModules();
  return await import("./aiModelRouter");
}

const MOE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL";
const DENSE = "Qwen3.8-27B-Instruct-Q4_K_M";

const TOUCHED = [
  "GGUF_DEFAULT_MODEL", "GGUF_FAST_MODEL", "AI_CODE_ROUTER_ENABLED", "AI_THINKING_TIER_ENABLED",
  "AI_ROUTER_LATENCY_PIN_MS", "AI_ROUTER_EASY_MAX_CHARS", "AI_ROUTER_HARD_MIN_CHARS",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GGUF_DEFAULT_MODEL = `${MOE}.gguf`;
  process.env.GGUF_FAST_MODEL = "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf";
});
afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("hồ sơ mặc định — CANH TRÔI (số phải khớp phép đo đã ghi, không được đổi âm thầm)", () => {
  it("roster MoE hiện tại ⇒ hồ sơ 'measured-here' với đúng các số của phép đo 2026-08-02", async () => {
    const { activeRouterProfile } = await freshRouter();
    const p = activeRouterProfile();
    expect(p.provenance).toBe("measured-here");
    expect(p.measuredOn).toMatch(/2026-08-02/);
    expect(p.needsLocalMeasurement).toBe(false);
    // Các số RÚT RA — trôi một con số mà không sửa phép đo ⇒ ĐỎ.
    expect(p.easyMaxChars).toBe(160);
    expect(p.hardMinChars).toBe(700);
    expect(p.latencyPinMs).toBe(700);
    // Các số ĐO ĐƯỢC mà ngưỡng dựa vào.
    expect(p.deepColdLoadMs).toBe(6040);
    expect(p.fastColdLoadMs).toBe(1220);
  });

  it("hành vi định tuyến GIỮ NGUYÊN so với trước bản vá (không 'cải tiến' thuật toán)", async () => {
    const { route, classifyDifficulty } = await freshRouter();
    expect(classifyDifficulty({ task: "chat", text: "x".repeat(159) })).toBe("easy");
    expect(classifyDifficulty({ task: "chat", text: "x".repeat(300) })).toBe("medium");
    expect(classifyDifficulty({ task: "chat", text: "x".repeat(701) })).toBe("hard");
    // Ngân sách 699ms + medium ⇒ ghim Tier 1; 700ms ⇒ KHÔNG ghim (biên giữ nguyên).
    expect(route({ task: "chat", text: "x".repeat(300), latencyBudgetMs: 699 }).tier).toBe(1);
    expect(route({ task: "chat", text: "x".repeat(300), latencyBudgetMs: 700 }).tier).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★ ngưỡng RÚT ĐƯỢC từ cấu hình — đổi nguồn ⇒ quyết định đổi theo", () => {
  it("AI_ROUTER_LATENCY_PIN_MS đổi biên ghim Tier 1", async () => {
    process.env.AI_ROUTER_LATENCY_PIN_MS = "2000";
    const { route } = await freshRouter();
    // 1500ms: với ngưỡng cũ (700) KHÔNG ghim; với ngưỡng khai 2000 thì PHẢI ghim.
    expect(route({ task: "chat", text: "x".repeat(300), latencyBudgetMs: 1500 }).tier).toBe(1);
    expect(route({ task: "chat", text: "x".repeat(300), latencyBudgetMs: 2500 }).tier).toBe(2);
  });

  it("AI_ROUTER_EASY_MAX_CHARS / AI_ROUTER_HARD_MIN_CHARS đổi phép chấm độ khó", async () => {
    process.env.AI_ROUTER_EASY_MAX_CHARS = "40";
    process.env.AI_ROUTER_HARD_MIN_CHARS = "120";
    const { classifyDifficulty } = await freshRouter();
    expect(classifyDifficulty({ task: "chat", text: "x".repeat(39) })).toBe("easy");
    expect(classifyDifficulty({ task: "chat", text: "x".repeat(100) })).toBe("medium");
    expect(classifyDifficulty({ task: "chat", text: "x".repeat(121) })).toBe("hard");
  });

  it("giá trị env RÁC ⇒ bỏ qua + kêu, KHÔNG ném và KHÔNG lặng lẽ thành 0/NaN", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.AI_ROUTER_LATENCY_PIN_MS = "rat-nhanh";
    process.env.AI_ROUTER_EASY_MAX_CHARS = "-5";
    const { activeRouterProfile, classifyDifficulty } = await freshRouter();
    const p = activeRouterProfile();
    expect(p.latencyPinMs).toBe(700);
    expect(p.easyMaxChars).toBe(160);
    expect(classifyDifficulty({ task: "chat", text: "x".repeat(100) })).toBe("easy");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/AI_ROUTER_LATENCY_PIN_MS/));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★ model chưa có phép đo của ta ⇒ phải KÊU, không im lặng dùng số của model khác", () => {
  it("đổi sang dense 27B ⇒ hồ sơ nhận diện được, provenance KHÔNG phải 'measured-here'", async () => {
    process.env.GGUF_DEFAULT_MODEL = `${DENSE}.gguf`;
    const { activeRouterProfile } = await freshRouter();
    const p = activeRouterProfile();
    expect(p.label).toMatch(/27B/i);
    expect(p.provenance).not.toBe("measured-here");
    expect(p.needsLocalMeasurement).toBe(true);
    // Số decode là của NGƯỜI KHÁC — hồ sơ phải nói rõ nguồn + ngày.
    expect(p.deepDecodeTokPerSec).toBe(78);
    expect(p.measuredOn).toMatch(/2026-08-16/);
    // ⚠ Ngưỡng vẫn là ngưỡng MoE — CÓ CHỦ Ý (chưa đo thì không bịa số mới), nhưng phải khai.
    expect(p.thresholdsInheritedFrom).toMatch(/30B-A3B/i);
  });

  it("★ route() trên model chưa đo ⇒ CẢNH BÁO đúng một lần, nêu tên model và nguồn ngưỡng", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GGUF_DEFAULT_MODEL = `${DENSE}.gguf`;
    const { route } = await freshRouter();
    route({ task: "chat", text: "xin chao" });
    route({ task: "chat", text: "lan hai" });
    route({ task: "chat", text: "lan ba" });
    const hits = warn.mock.calls.filter((c) => /ngưỡng định tuyến/i.test(String(c[0])));
    expect(hits).toHaveLength(1);
    expect(String(hits[0][0])).toContain("27B");
    expect(String(hits[0][0])).toMatch(/30B-A3B/i);
  });

  it("model HOÀN TOÀN lạ ⇒ vẫn kêu (không có hồ sơ nào ⇒ mặc định phải là 'chưa đo')", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GGUF_DEFAULT_MODEL = "Llama-4-Maverick-Q4.gguf";
    const { route, activeRouterProfile } = await freshRouter();
    expect(activeRouterProfile().needsLocalMeasurement).toBe(true);
    route({ task: "chat", text: "xin chao" });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ngưỡng định tuyến/i));
  });

  it("khai NGƯỠNG bằng env trên model chưa đo ⇒ hết kêu (người vận hành ĐÃ đo và khai)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GGUF_DEFAULT_MODEL = `${DENSE}.gguf`;
    process.env.AI_ROUTER_LATENCY_PIN_MS = "900";
    process.env.AI_ROUTER_EASY_MAX_CHARS = "200";
    process.env.AI_ROUTER_HARD_MIN_CHARS = "900";
    const { route, activeRouterProfile } = await freshRouter();
    expect(activeRouterProfile().needsLocalMeasurement).toBe(false);
    route({ task: "chat", text: "xin chao" });
    expect(warn.mock.calls.filter((c) => /ngưỡng định tuyến/i.test(String(c[0])))).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★ VỊ TỪ trên BẢNG hồ sơ — không liệt kê tay từng mục", () => {
  it("∀ hồ sơ: có nguồn+ngày, ngưỡng dương, và ngưỡng ghim KHÔNG vô lý so với cold-load đã đo", async () => {
    const { ROUTER_MODEL_PROFILES } = await freshRouter();
    expect(ROUTER_MODEL_PROFILES.length).toBeGreaterThan(1);
    for (const p of ROUTER_MODEL_PROFILES) {
      expect(p.measuredOn.length, p.label).toBeGreaterThan(6);
      expect(p.label.length, p.label).toBeGreaterThan(2);
      for (const k of ["latencyPinMs", "easyMaxChars", "hardMinChars"] as const) {
        expect(p[k], `${p.label}.${k}`).toBeGreaterThan(0);
      }
      expect(p.easyMaxChars, p.label).toBeLessThan(p.hardMinChars);
      // Ghim Tier 1 chỉ có nghĩa khi ngân sách KHÔNG đủ cho một lượt nạp nguội model sâu.
      if (p.deepColdLoadMs !== null) {
        expect(p.latencyPinMs, `${p.label}: ngưỡng ghim vượt cold-load ⇒ luật ghim vô nghĩa`)
          .toBeLessThanOrEqual(p.deepColdLoadMs);
      }
      // Số ĐO của người khác KHÔNG được đội lốt phép đo của ta: hồ sơ nào không phải
      // "measured-here" thì BẮT BUỘC phải khai ngưỡng của nó thừa kế từ đâu.
      if (p.provenance !== "measured-here") {
        expect(p.thresholdsInheritedFrom, `${p.label}: dùng ngưỡng của model khác mà không khai`).toBeTruthy();
      } else {
        expect(p.thresholdsInheritedFrom, `${p.label}: đo tại chỗ thì không thừa kế ai`).toBeNull();
        expect(p.deepColdLoadMs, p.label).not.toBeNull();
      }
      // Trường CHƯA ĐO phải là `null` tường minh — cấm điền số bịa cho đủ ô.
      for (const k of ["deepColdLoadMs", "deepDecodeTokPerSec", "fastColdLoadMs", "fastDecodeTokPerSec"] as const) {
        const v = p[k];
        expect(v === null || (typeof v === "number" && v > 0), `${p.label}.${k}`).toBe(true);
      }
    }
  });

  it("∀ hồ sơ: vị từ `matches` khớp CHÍNH nó và KHÔNG khớp hồ sơ khác (không có mục chết/chồng lấn)", async () => {
    const { ROUTER_MODEL_PROFILES } = await freshRouter();
    for (const p of ROUTER_MODEL_PROFILES) {
      const hits = ROUTER_MODEL_PROFILES.filter((q) => q.matches.test(p.sampleBasename));
      expect(hits.map((h) => h.label), `basename mẫu "${p.sampleBasename}"`).toEqual([p.label]);
    }
  });
});
