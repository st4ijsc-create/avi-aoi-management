/**
 * ★★★ BẢY BỀ MẶT NỘI BỘ CÒN NỢ — chữ model tới NGƯỜI hoặc vào BẢN GHI VĨNH VIỄN (G5-E).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO BẢY CHỖ NÀY LÀ "HIỂN THỊ" DÙ KHÔNG AI GỌI CHÚNG LÀ "BỀ MẶT CHAT"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới lượng từ (`thinkingSurfaces.quantifier.test.ts`) quét AST toàn `server/**` và đếm 30 điểm
 * gọi API sinh văn xuôi. Bảy điểm dưới đây **không** nằm trên đường chat, nhưng chữ của chúng:
 *   • hiện thẳng trên bảng phân tích / trang kế hoạch (`narrateAnalysis`,
 *     `interpretSPCViolations`, `narrateComparison`, `explainScheduleWithAIUnbounded`);
 *   • đi vào **thân THÔNG BÁO** đẩy tới điện thoại/Andon (`generateNotificationSummary`);
 *   • đi vào **hàng `ai_insights` lưu vĩnh viễn** rồi hiện trong luồng điều phối
 *     (`aiWatcher.generateAdvisory`) — nội tâm model không được nằm trong bản ghi vĩnh viễn;
 *   • là nhánh KHÔNG-streaming của provider router (`runText`), nơi KHÔNG có tuyến SSE nào cắt hộ
 *     (khác `generateNarrativeStream`, vốn được cắt ở hạ nguồn — xem sổ khai).
 *
 * CẢ BẢY gọi API sinh chữ **không ghim modelId** (hoặc ghim qua `resolveLogicalModel("chat")` =
 * model mặc định) ⇒ đổi roster sang một model họ Qwen3.x là cả bảy phát `<think>`.
 *
 * ⚠ Lưới canh HÀNH VI: mỗi ca gọi hàm THẬT, bơm đầu ra engine có thẻ, rồi soi chữ ở ĐÚNG ô mà
 * người dùng / bản ghi nhận được. Gỡ bộ cắt khỏi bất kỳ chỗ nào ⇒ ca tương ứng ĐỎ.
 *
 * ⚠ §8 KHÔNG HỒI QUY: roster đang chạy (Qwen3-30B-A3B-Instruct) không phát `<think>` ⇒ bản vá phải
 * là **no-op** với đầu ra hiện tại, từng ký tự so với hành vi TRƯỚC bản vá (sáu chỗ vốn đã `.trim()`
 * nên chuẩn so sánh là chuỗi đã trim; `runText` vốn KHÔNG trim nên phải giữ cả khoảng trắng biên).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  /** Đầu ra engine dùng cho MỌI điểm gọi trong tệp này. */
  text: "cau tra loi",
  /** Hàng trả về cho `db.select()...` (đường phân tích). */
  rows: [] as any[],
  /** Payload đã INSERT (đường aiWatcher → ai_insights). */
  daChen: [] as any[],
}));

const ketQua = (modelId?: string) => ({
  text: h.text,
  tokensPrompt: 3,
  tokensGenerated: 5,
  modelId: modelId || "mac-dinh",
  totalTimeMs: 1,
  tokensPerSecond: 5,
});

vi.mock("../aiGgufEngine", () => ({
  generateText: vi.fn(async (_o: any, m?: string) => ketQua(m)),
  chatCompletion: vi.fn(async (_o: any, m?: string) => ketQua(m)),
  generateJSON: vi.fn(async () => ({ data: {}, raw: "{}", modelId: "x", totalTimeMs: 1 })),
  describeImage: vi.fn(),
  generateTextStream: async function* () {},
  chatCompletionStream: async function* () {},
  isGgufAvailable: vi.fn(async () => true),
}));

/** DB giả phục vụ CẢ BA hình dạng truy vấn mà bảy bề mặt đi qua. */
function dbGia() {
  const chuoi: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (ok: any, ko: any) => Promise.resolve(h.rows).then(ok, ko);
        return () => chuoi;
      },
    },
  );
  return {
    select: () => chuoi,
    execute: async () => ({ rows: [] }),
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          h.daChen.push(v);
          return [{ id: 1 }];
        },
      }),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => dbGia()) }));

import { getDefectTrendWithNarration, interpretSPCViolations } from "../aiInspectionAnalytics";
import { generateNarrative } from "../aiProviderRouter";
import { generateComparisonWithNarration } from "../dataComparisonService";
import { generateNotificationSummary } from "../notificationService";
import { explainScheduleWithAI } from "../productionSchedulingService";
import { startAiWatcher, stopAiWatcher } from "../orchestration/aiWatcher";
import { eventBus } from "../../_core/eventBus";

const NOI_TAM = "Người dùng hỏi về lô 7. Ta chưa có số liệu, cứ đoán 98% cho chắc.";
const CAU_TRA_LOI = "Tỉ lệ ĐẠT của lô 7 là 96,4% theo báo cáo ca sáng.";
const CO_THE = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;

const ENV_KEYS = ["AI_THINKING_TAGS", "AI_THINKING_STARTS_OPEN", "AI_ORCHESTRATION_ENABLED", "AI_WATCHER_MIN_INTERVAL_MS"] as const;

beforeEach(() => {
  h.text = "cau tra loi";
  h.rows = [];
  h.daChen = [];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  stopAiWatcher();
  for (const k of ENV_KEYS) delete process.env[k];
});

function sach(chu: unknown): void {
  const s = String(chu ?? "");
  expect(s).not.toContain(NOI_TAM);
  expect(s).not.toContain("cứ đoán 98%");
  expect(s).not.toContain("<think>");
  expect(s).not.toContain("</think>");
}

/** Chuỗi ngày liên tiếp để phép quét SPC có dữ liệu. */
function hangXuHuong(tiLe: number[]): any[] {
  return tiLe.map((pass, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, "0")}`,
    total: 100,
    pass,
    fail: 100 - pass,
  }));
}

const KY: any = { startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-08-20T00:00:00Z") };

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — aiInspectionAnalytics::narrateAnalysis (diễn giải trên bảng phân tích)", () => {
  it("★ khối <think> KHÔNG ra ô `narration`", async () => {
    h.rows = hangXuHuong([98, 97, 99]);
    h.text = CO_THE;
    const r = await getDefectTrendWithNarration(KY);
    sach(r.narration);
    expect(r.narration).toContain("96,4%");
  });

  it("thẻ mở KHÔNG BAO GIỜ đóng ⇒ `narration` = null, không phun nguyên văn khối", async () => {
    h.rows = hangXuHuong([98, 97, 99]);
    h.text = `<think>${NOI_TAM}`;
    const r = await getDefectTrendWithNarration(KY);
    expect(r.narration).toBeNull();
  });

  it("tập thẻ khai báo được (AI_THINKING_TAGS) có hiệu lực", async () => {
    process.env.AI_THINKING_TAGS = "phan_tich_noi_bo";
    h.rows = hangXuHuong([98, 97, 99]);
    h.text = `<phan_tich_noi_bo>${NOI_TAM}</phan_tich_noi_bo>${CAU_TRA_LOI}`;
    const r = await getDefectTrendWithNarration(KY);
    expect(r.narration).not.toContain(NOI_TAM);
    expect(r.narration).not.toContain("phan_tich_noi_bo");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — aiInspectionAnalytics::interpretSPCViolations (diễn giải vi phạm SPC)", () => {
  it("★ khối <think> KHÔNG ra ô `interpretation`", async () => {
    // Một điểm rơi hẳn ngoài giới hạn ⇒ có vi phạm ⇒ đường AI được đi (không rẽ nhánh sớm).
    h.rows = hangXuHuong([98, 98, 98, 98, 98, 98, 98, 98, 98, 10]);
    h.text = CO_THE;
    const r = await interpretSPCViolations(KY, "yield");
    expect(r.interpretation).toBeTruthy();
    sach(r.interpretation);
    expect(r.interpretation).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — aiProviderRouter::runText (nhánh KHÔNG-streaming: báo cáo điều hành, RCA)", () => {
  it("★ khối <think> KHÔNG ra ô `text`", async () => {
    h.text = CO_THE;
    const r = await generateNarrative({ prompt: "tóm tắt ca sáng" });
    sach(r.text);
    expect(r.text).toContain("96,4%");
  });

  it("chat template MỞ SẴN khối (AI_THINKING_STARTS_OPEN): thẻ đầu tiên là thẻ ĐÓNG", async () => {
    process.env.AI_THINKING_STARTS_OPEN = "1";
    h.text = `${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const r = await generateNarrative({ prompt: "tóm tắt ca sáng" });
    sach(r.text);
    expect(r.text).toContain("96,4%");
  });

  it("các ô đo lường KHÔNG bị bản vá đụng tới", async () => {
    h.text = CO_THE;
    const r = await generateNarrative({ prompt: "x", modelId: "mo-hinh-y" });
    expect(r.model).toBe("mo-hinh-y");
    expect(r.tokensGenerated).toBe(5);
    expect(r.provider).toBe("gguf");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — dataComparisonService::narrateComparison (diễn giải so sánh kỳ)", () => {
  it("★ khối <think> KHÔNG ra ô `narration`", async () => {
    h.text = CO_THE;
    const r = await generateComparisonWithNarration({
      periodType: "day",
      currentStart: new Date("2026-08-10T00:00:00Z"),
      currentEnd: new Date("2026-08-11T00:00:00Z"),
    } as any);
    sach(r.narration);
    expect(r.narration).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — notificationService::generateNotificationSummary (thân THÔNG BÁO tới điện thoại/Andon)", () => {
  it("★ khối <think> KHÔNG ra thân thông báo", async () => {
    h.text = CO_THE;
    const r = await generateNotificationSummary([
      { type: "ALERT", title: "Máy 3 dừng", message: "Dừng 12 phút" },
    ]);
    sach(r);
    expect(r).toContain("96,4%");
  });

  it("thẻ CHÉO TÊN (<reasoning>…</reasoning>) cũng bị cắt", async () => {
    h.text = `<reasoning>${NOI_TAM}</reasoning>${CAU_TRA_LOI}`;
    const r = await generateNotificationSummary([{ type: "ALERT", title: "t", message: "m" }]);
    expect(r).not.toContain(NOI_TAM);
    expect(r).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — productionSchedulingService::explainScheduleWithAIUnbounded (diễn giải lịch)", () => {
  const LICH: any = {
    algorithm: "fifo",
    totalOrders: 3,
    scheduledOrders: 2,
    unschedulableOrders: [],
    conflicts: [{ type: "capacity", severity: "high", message: "quá tải" }],
    wipStatus: [{ lineName: "L1", utilizationRate: 91, completionPercentage: 40, inProgressOrders: 2 }],
    suggestions: ["dời đơn A"],
  };

  it("★ khối <think> KHÔNG ra lời giải thích lịch", async () => {
    h.text = CO_THE;
    const r = await explainScheduleWithAI(LICH);
    sach(r);
    expect(r).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — aiWatcher::generateAdvisory (chữ vào BẢN GHI VĨNH VIỄN `ai_insights`)", () => {
  it("★ khối <think> KHÔNG được lưu vào cột `body`", async () => {
    process.env.AI_ORCHESTRATION_ENABLED = "true";
    process.env.AI_WATCHER_MIN_INTERVAL_MS = "1";
    h.text = CO_THE;
    startAiWatcher();
    eventBus.publish("orchestration.triggered", { rule: "ng_burst", machine: "M-03", count: 5 }, "test");

    for (let i = 0; i < 200 && h.daChen.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(h.daChen.length).toBe(1);
    sach(h.daChen[0].body);
    expect(String(h.daChen[0].body)).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§8 — KHÔNG HỒI QUY: đầu ra roster HIỆN TẠI đi qua nguyên vẹn", () => {
  const SACH = "Kết quả: ĐẠT. Ngưỡng a < b, tỉ lệ < 0.5% và 3<4 vẫn ổn.";
  const SACH_CO_BIEN = "  Kết quả: ĐẠT.\n  Dòng hai.\t\n";

  it("narrateAnalysis: `narration` === đầu ra engine (hành vi cũ đã `.trim()`)", async () => {
    h.rows = hangXuHuong([98, 97, 99]);
    h.text = SACH;
    const r = await getDefectTrendWithNarration(KY);
    expect(r.narration).toBe(SACH);
  });

  it("interpretSPCViolations: `interpretation` === đầu ra engine", async () => {
    h.rows = hangXuHuong([98, 98, 98, 98, 98, 98, 98, 98, 98, 10]);
    h.text = SACH;
    const r = await interpretSPCViolations(KY, "yield");
    expect(r.interpretation).toBe(SACH);
  });

  it("★ runText: KHÔNG trim — giữ nguyên khoảng trắng biên, từng ký tự", async () => {
    h.text = SACH_CO_BIEN;
    const r = await generateNarrative({ prompt: "x" });
    expect(r.text).toBe(SACH_CO_BIEN);
  });

  it("narrateComparison / generateNotificationSummary / explainScheduleWithAI: nguyên vẹn", async () => {
    h.text = SACH;
    const so = await generateComparisonWithNarration({
      periodType: "day",
      currentStart: new Date("2026-08-10T00:00:00Z"),
      currentEnd: new Date("2026-08-11T00:00:00Z"),
    } as any);
    expect(so.narration).toBe(SACH);

    const tb = await generateNotificationSummary([{ type: "ALERT", title: "t", message: "m" }]);
    expect(tb).toBe(SACH);

    const lich = await explainScheduleWithAI({
      algorithm: "fifo",
      totalOrders: 1,
      scheduledOrders: 1,
      unschedulableOrders: [],
      conflicts: [],
      wipStatus: [],
      suggestions: ["x"],
    } as any);
    expect(lich).toBe(SACH);
  });

  it("aiWatcher: `body` lưu vào DB === đầu ra engine", async () => {
    process.env.AI_ORCHESTRATION_ENABLED = "true";
    process.env.AI_WATCHER_MIN_INTERVAL_MS = "1";
    h.text = SACH;
    startAiWatcher();
    eventBus.publish("orchestration.triggered", { rule: "ng_burst", machine: "M-09", count: 5 }, "test");
    for (let i = 0; i < 200 && h.daChen.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(h.daChen[0].body).toBe(SACH);
  });
});
