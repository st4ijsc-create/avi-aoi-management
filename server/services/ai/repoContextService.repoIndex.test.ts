/**
 * G2-A — lưới cho `gatherRepoIndexContext()`: nối CHỈ MỤC REPO vào copilot lập trình.
 *
 * Lưới này canh đúng ba thứ mà một bản "nối dây" dễ làm sai và KHÔNG ai thấy:
 *   1. NGÂN SÁCH — khối trả về không bao giờ vượt trần token được giao;
 *   2. NGƯỠNG LIÊN QUAN — đoạn kém liên quan KHÔNG được chèn (top-N vô điều kiện = đổ nhiễu);
 *   3. CỔNG RẺ — hết ngân sách / cờ tắt ⇒ KHÔNG gọi tầng truy hồi (không embed, không đọc đĩa).
 *
 * Tầng truy hồi được TIÊM qua seam `gather` nên lưới này KHÔNG chạm GGUF, KHÔNG chạm đĩa.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  gatherRepoIndexContext,
  catTheoNganSachToken,
  repoIndexContextEnabled,
  REPO_INDEX_FLAG,
  REPO_INDEX_BLOCK_HEADER,
  REPO_INDEX_TRUNCATION_MARK,
  REPO_INDEX_DEFAULT_ON,
  REPO_INDEX_SOURCE_PREFIXES,
  laDuongDanMaNguon,
  type RepoContextResult,
} from "./repoContextService";
import { locKhoTheoTienTo } from "../aiLocalKnowledgeService";
import { uocLuongSoToken } from "../aiLlamaServerClient";

/** Một `gatherRepoContext` giả — trả đúng danh sách đoạn đã cho, ghi lại tham số nhận được. */
function gatherGia(snippets: RepoContextResult["ragSnippets"]) {
  const fn = vi.fn(async (input: any): Promise<RepoContextResult> => {
    void input;
    return { files: [], skipped: [], dependencies: [], ragSnippets: snippets, totalBytes: 0 };
  });
  return fn as unknown as typeof import("./repoContextService").gatherRepoContext & { mock: any };
}

function doan(sourcePath: string, chars: number, score: number) {
  return { sourcePath, text: "x".repeat(chars), score };
}

beforeEach(() => {
  process.env[REPO_INDEX_FLAG] = "true";
  delete process.env.AI_COPILOT_REPO_INDEX_MAX_TOKENS;
  delete process.env.AI_COPILOT_REPO_INDEX_TOP_K;
  delete process.env.AI_COPILOT_REPO_INDEX_MIN_SCORE;
});
afterEach(() => {
  delete process.env[REPO_INDEX_FLAG];
});

describe("G2-A · cờ bật/tắt", () => {
  it("cờ chưa gán → dùng mặc định khai trong hằng REPO_INDEX_DEFAULT_ON", () => {
    delete process.env[REPO_INDEX_FLAG];
    expect(repoIndexContextEnabled()).toBe(REPO_INDEX_DEFAULT_ON);
  });

  it("cờ TẮT → không chèn gì VÀ không gọi tầng truy hồi (đường lùi thật, không phải lùi trên giấy)", async () => {
    process.env[REPO_INDEX_FLAG] = "false";
    const gather = gatherGia([doan("server/routers/programmingRouter.ts", 200, 0.9)]);
    const r = await gatherRepoIndexContext({ query: "thêm procedure tRPC", maxTokens: 900, gather });
    expect(r.reason).toBe("flag-off");
    expect(r.block).toBe("");
    expect(r.tokens).toBe(0);
    expect((gather as any).mock.calls.length).toBe(0);
  });

  /**
   * ★★★ doc 79 · TRỤC 1 (D) — `boQuaCo` là thứ làm HAI ĐƯỜNG bật/tắt ĐỘC LẬP.
   *
   * Không có nó, đường lập trình (`AI_CODING_REPO_CONTEXT`) bị cờ của đường PLC
   * (`AI_COPILOT_REPO_INDEX_ENABLED`, mặc định TẮT) bịt lại trong im lặng — tính năng khai BẬT mà
   * không bao giờ chạy, đúng lớp "cờ mua được 0" đã trả giá ở `TENANT_RLS_ENABLED`.
   */
  it("★★★ `boQuaCo` bỏ qua CỜ nhưng KHÔNG bỏ qua hàng rào nào khác", async () => {
    process.env[REPO_INDEX_FLAG] = "false";
    const gather = gatherGia([doan("server/routers/programmingRouter.ts", 200, 0.9)]);
    const r = await gatherRepoIndexContext({ query: "thêm procedure tRPC", maxTokens: 900, gather, boQuaCo: true });
    expect(r.reason, "cờ TẮT + boQuaCo ⇒ vẫn phải truy hồi").toBe("ok");
    expect((gather as any).mock.calls.length).toBe(1);

    // …nhưng NGƯỠNG ĐIỂM vẫn cưỡng chế (không phải một cửa sau).
    const duoiNguong = gatherGia([doan("server/a.ts", 200, 0.1)]);
    const r2 = await gatherRepoIndexContext({ query: "x", maxTokens: 900, gather: duoiNguong, boQuaCo: true });
    expect(r2.reason).toBe("below-threshold");

    // …và CỔNG VÙNG MÃ NGUỒN vẫn cưỡng chế (tài liệu vận hành không lọt).
    const laTaiLieu = gatherGia([doan("knowledge/operational/robot-control.md", 200, 0.99)]);
    const r3 = await gatherRepoIndexContext({ query: "x", maxTokens: 900, gather: laTaiLieu, boQuaCo: true });
    expect(r3.reason).toBe("below-threshold");

    // …và NGÂN SÁCH vẫn là cổng RẺ đứng trước cổng TỐN.
    const khongDung = gatherGia([doan("server/a.ts", 200, 0.9)]);
    const r4 = await gatherRepoIndexContext({ query: "x", maxTokens: 0, gather: khongDung, boQuaCo: true });
    expect(r4.reason).toBe("no-budget");
    expect((khongDung as any).mock.calls.length).toBe(0);
  });

  it("★★ VẮNG `boQuaCo` ⇒ hành vi cũ KHÔNG đổi một byte (mọi người gọi cũ an toàn)", async () => {
    process.env[REPO_INDEX_FLAG] = "false";
    const gather = gatherGia([doan("server/a.ts", 200, 0.9)]);
    for (const them of [{}, { boQuaCo: false }, { boQuaCo: undefined }]) {
      const r = await gatherRepoIndexContext({ query: "x", maxTokens: 900, gather, ...them });
      expect(r.reason).toBe("flag-off");
    }
    expect((gather as any).mock.calls.length).toBe(0);
  });
});

describe("G2-A · cổng rẻ trước cổng tốn", () => {
  it("maxTokens ≤ 0 → 'no-budget' và KHÔNG gọi truy hồi (không embed, không rerank)", async () => {
    const gather = gatherGia([doan("server/a.ts", 200, 0.9)]);
    const r = await gatherRepoIndexContext({ query: "câu hỏi", maxTokens: 0, gather });
    expect(r.reason).toBe("no-budget");
    expect((gather as any).mock.calls.length).toBe(0);
  });

  it("query rỗng → 'no-query', không gọi truy hồi", async () => {
    const gather = gatherGia([doan("server/a.ts", 200, 0.9)]);
    const r = await gatherRepoIndexContext({ query: "   ", maxTokens: 900, gather });
    expect(r.reason).toBe("no-query");
    expect((gather as any).mock.calls.length).toBe(0);
  });
});

describe("G2-A · ngưỡng liên quan", () => {
  it("mọi đoạn dưới ngưỡng → 'below-threshold', KHÔNG chèn nhiễu vào prompt", async () => {
    const gather = gatherGia([doan("server/a.ts", 200, 0.10), doan("server/b.ts", 200, 0.2)]);
    const r = await gatherRepoIndexContext({ query: "moving average structured text", maxTokens: 900, minScore: 0.35, gather });
    expect(r.reason).toBe("below-threshold");
    expect(r.block).toBe("");
    expect(r.retrieved).toBe(2); // vẫn khai đã truy hồi được 2 — để log thấy ngưỡng đang cắt gì
  });

  it("chỉ đoạn ĐẠT ngưỡng mới vào khối", async () => {
    const gather = gatherGia([doan("server/hi.ts", 100, 0.80), doan("server/lo.ts", 100, 0.05)]);
    const r = await gatherRepoIndexContext({ query: "q", maxTokens: 900, minScore: 0.35, gather });
    expect(r.reason).toBe("ok");
    expect(r.snippets.map((s) => s.sourcePath)).toEqual(["server/hi.ts"]);
    expect(r.block).toContain("server/hi.ts");
    expect(r.block).not.toContain("server/lo.ts");
  });
});

describe("G2-A · cổng VÙNG (mã nguồn, không phải tài liệu)", () => {
  it("tài liệu điểm CAO vẫn bị loại; mã nguồn điểm THẤP HƠN vẫn được nhận", async () => {
    // Đây là hình dạng ĐO ĐƯỢC 2026-08-16 trên ca `tm-pick-place`:
    //   knowledge/operational/robot-control.md = 0,7146  ← nhiễu, nhưng điểm CAO NHẤT
    //   server/services/programming/zmotion/zmotionBasicAdapter.ts = 0,6429 ← đoạn ĐÚNG
    // Một cổng chỉ dựa vào điểm sẽ chọn đúng cái sai. Ca này khoá điều đó lại.
    const gather = gatherGia([
      doan("knowledge/operational/robot-control.md", 300, 0.7146),
      doan("docs/ECOSYSTEM/09_DEVICE_PROGRAMMING_CONTROL_STRATEGY_2026-06.md", 300, 0.6894),
      doan("server/services/programming/zmotion/zmotionBasicAdapter.ts", 300, 0.6429),
    ]);
    const r = await gatherRepoIndexContext({ query: "zmotion move axis", maxTokens: 900, minScore: 0.6, gather });
    expect(r.snippets.map((s) => s.sourcePath)).toEqual([
      "server/services/programming/zmotion/zmotionBasicAdapter.ts",
    ]);
    expect(r.block).not.toContain("robot-control.md");
    expect(r.block).not.toContain("docs/ECOSYSTEM");
  });

  it("chỉ có tài liệu → không chèn gì (đúng ca iec61131-st/-ld đã đo: toàn nhiễu)", async () => {
    const gather = gatherGia([
      doan("knowledge/features/monitoring/machine-sync.md", 300, 0.5864),
      doan("knowledge/features/ai/ai-chat.md", 300, 0.4939),
    ]);
    const r = await gatherRepoIndexContext({ query: "structured text moving average", maxTokens: 900, minScore: 0.6, gather });
    expect(r.reason).toBe("below-threshold");
    expect(r.block).toBe("");
  });

  it("nhận mọi vùng mã nguồn đã khai (server/client/shared/drizzle/scripts)", () => {
    for (const p of [
      "server/routers/x.ts", "client/src/a.tsx", "shared/b.ts", "drizzle/schema/c.ts", "scripts/d.mjs",
    ]) {
      expect(laDuongDanMaNguon(p), p).toBe(true);
    }
    for (const p of ["knowledge/x.md", "docs/y.md", "so-do-man-hinh.png", ""]) {
      expect(laDuongDanMaNguon(p), p).toBe(false);
    }
  });
});

describe("G2-A · ngân sách token (bất biến cứng)", () => {
  it("khối trả về KHÔNG BAO GIỜ vượt trần token được giao", async () => {
    // 5 đoạn × 1.800 ký tự ≈ 3.215 token — gấp hơn 3 lần trần 300.
    const gather = gatherGia([
      doan("server/a.ts", 1800, 0.9), doan("server/b.ts", 1800, 0.85), doan("server/c.ts", 1800, 0.8),
      doan("server/d.ts", 1800, 0.75), doan("server/e.ts", 1800, 0.7),
    ]);
    const tran = 300;
    const r = await gatherRepoIndexContext({ query: "q", maxTokens: tran, minScore: 0.3, gather });
    expect(r.reason).toBe("ok");
    expect(r.tokens).toBeLessThanOrEqual(tran);
    expect(uocLuongSoToken(r.block)).toBeLessThanOrEqual(tran);
  });

  it("đoạn hạng 1 quá dài → CẮT nó (không trả rỗng) và KHAI là đã cắt", async () => {
    const gather = gatherGia([doan("server/big.ts", 5000, 0.9)]);
    const r = await gatherRepoIndexContext({ query: "q", maxTokens: 200, minScore: 0.3, gather });
    expect(r.reason).toBe("ok");
    expect(r.snippets).toHaveLength(1);
    expect(r.snippets[0].truncated).toBe(true);
    expect(r.block).toContain(REPO_INDEX_TRUNCATION_MARK.trim());
    expect(r.tokens).toBeLessThanOrEqual(200);
  });

  it("đủ ngân sách → giữ NGUYÊN VĂN, không cắt oan", async () => {
    const gather = gatherGia([doan("server/a.ts", 200, 0.9), doan("server/b.ts", 200, 0.8)]);
    const r = await gatherRepoIndexContext({ query: "q", maxTokens: 900, minScore: 0.3, gather });
    expect(r.snippets).toHaveLength(2);
    expect(r.snippets.every((s) => !s.truncated)).toBe(true);
    expect(r.block.startsWith(REPO_INDEX_BLOCK_HEADER)).toBe(true);
    expect(r.block).toContain("[R1] server/a.ts");
    expect(r.block).toContain("[R2] server/b.ts");
  });
});

describe("G2-A · fail-safe + xuyên vai RBAC", () => {
  it("tầng truy hồi NÉM → kết quả rỗng, KHÔNG ném ra ngoài", async () => {
    const gather = vi.fn(async () => {
      throw new Error("kho hỏng");
    }) as any;
    const r = await gatherRepoIndexContext({ query: "q", maxTokens: 900, gather });
    expect(r.reason).toBe("empty");
    expect(r.block).toBe("");
  });

  it("truy hồi TREO (không settle) → quá hạn giờ, trả rỗng, KHÔNG treo người gọi", async () => {
    // Lớp lỗi ĐO ĐƯỢC ở đúng ngăn xếp này (codegen-coder30b-2026-08-16-INCOMPLETE.json): khi
    // thiếu VRAM, warmModel() hỏng bên trong node-llama-cpp và lời gọi KHÔNG resolve, KHÔNG
    // reject — 300 s vẫn chưa settle. Không có hạn giờ thì generateProgram treo VĨNH VIỄN. Ca
    // này dựng lại đúng hình dạng đó: promise KHÔNG BAO GIỜ settle.
    const gather = vi.fn(() => new Promise(() => {})) as any;
    const t0 = Date.now();
    const r = await gatherRepoIndexContext({ query: "q", maxTokens: 900, timeoutMs: 50, gather });
    expect(r.reason).toBe("timeout");
    expect(r.block).toBe("");
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("callerRole được XUYÊN xuống tầng truy hồi (cổng corpus Studio phải thấy ai đang hỏi)", async () => {
    const gather = gatherGia([doan("server/a.ts", 100, 0.9)]);
    await gatherRepoIndexContext({ query: "q", maxTokens: 900, callerRole: "engineer", gather });
    expect((gather as any).mock.calls[0][0]).toMatchObject({
      objective: "q",
      includeRag: true,
      includeDependencies: false,
      callerRole: "engineer",
    });
  });
});

describe("G2-A · catTheoNganSachToken", () => {
  it("vừa rồi thì trả nguyên văn", () => {
    const r = catTheoNganSachToken("abc", 100);
    expect(r).toEqual({ text: "abc", truncated: false });
  });
  it("cắt xong PHẢI vẫn ≤ trần (dấu hiệu cắt cũng tính vào ngân sách)", () => {
    const r = catTheoNganSachToken("y".repeat(9000), 120);
    expect(r.truncated).toBe(true);
    expect(uocLuongSoToken(r.text)).toBeLessThanOrEqual(120);
  });
  it("trần 0 → rỗng", () => {
    expect(catTheoNganSachToken("abc", 0)).toEqual({ text: "", truncated: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ VÁ LIVE 2026-08-20 — `cheDoVungMa`: BA cách áp cổng vùng, và cách thứ nhất đã hỏng ở live.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("VÁ LIVE · cheDoVungMa — thu hẹp kho TRƯỚC khi xếp hạng, hay lọc SAU, hay không lọc", () => {
  /** Top-8 THẬT đo ngày 2026-08-20 cho câu "phân quyền RBAC trong repo này hoạt động ra sao?". */
  const THAT_TOAN_KHO = [
    { sourcePath: "knowledge/features/admin/role-management.md", text: "vai trò", score: 0.5897 },
    { sourcePath: "docs/ECOSYSTEM/50_RBAC_PROCEDURE_MIGRATION_R4.md", text: "xem `server/_core/trpc.ts`", score: 0.4857 },
    { sourcePath: "knowledge/operational/process-analytics.md", text: "phân tích", score: 0.474 },
  ];

  it("★★★ mặc định (`sau`) — HÀNH VI CŨ Y NGUYÊN: lọc sau xếp hạng ⇒ 0 đoạn với chunk THẬT", async () => {
    const gather = gatherGia(THAT_TOAN_KHO);
    const r = await gatherRepoIndexContext({ query: "phân quyền RBAC", maxTokens: 900, minScore: 0.25, gather });
    expect(r.reason, "★★★ ĐÂY chính là triệu chứng live, tái lập tất định").toBe("below-threshold");
    expect(r.snippets.length).toBe(0);
    // Và KHÔNG xin thu hẹp kho — đường PLC không được đổi một byte hành vi.
    expect((gather as any).mock.calls[0][0].ragSourcePathPrefixes).toBeUndefined();
  });

  it("★★★ `corpus` — XIN thu hẹp kho ngay ở tầng truy hồi (cách DUY NHẤT lấy được thứ hạng tệp mã)", async () => {
    const gather = gatherGia([{ sourcePath: "server/services/aiLocalTools/readToolRbac.ts", text: "rbac", score: 0.41 }]);
    const r = await gatherRepoIndexContext({
      query: "phân quyền RBAC", maxTokens: 900, minScore: 0.25, gather, cheDoVungMa: "corpus",
    });
    expect(r.reason).toBe("ok");
    expect((gather as any).mock.calls[0][0].ragSourcePathPrefixes, "phải truyền bảng tiền tố XUỐNG tầng truy hồi")
      .toEqual(REPO_INDEX_SOURCE_PREFIXES);
  });

  it("★★★ `tat` — KHÔNG lọc vùng: chunk tài liệu sống sót (chúng là CẦU, không phải hàng)", async () => {
    const gather = gatherGia(THAT_TOAN_KHO);
    const r = await gatherRepoIndexContext({
      query: "phân quyền RBAC", maxTokens: 900, minScore: 0.25, gather, cheDoVungMa: "tat",
    });
    expect(r.reason).toBe("ok");
    expect(r.snippets.map((s) => s.sourcePath)).toContain("docs/ECOSYSTEM/50_RBAC_PROCEDURE_MIGRATION_R4.md");
    expect((gather as any).mock.calls[0][0].ragSourcePathPrefixes, "`tat` KHÔNG thu hẹp kho").toBeUndefined();
  });

  it("★★★ A/B trên ĐÚNG một biến — cùng đoạn, cùng ngưỡng, chỉ đổi `cheDoVungMa`", async () => {
    const doanDoc = [{ sourcePath: "docs/A.md", text: "abc", score: 0.9 }];
    const sau = await gatherRepoIndexContext({ query: "q", maxTokens: 900, gather: gatherGia(doanDoc), minScore: 0.25 });
    const tat = await gatherRepoIndexContext({
      query: "q", maxTokens: 900, gather: gatherGia(doanDoc), minScore: 0.25, cheDoVungMa: "tat",
    });
    expect(sau.reason).toBe("below-threshold");
    expect(tat.reason).toBe("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("VÁ LIVE · `locKhoTheoTienTo` — hàm THUẦN thu hẹp kho, đo không cần 162 MB chỉ mục", () => {
  const KHO = [
    { sourcePath: "server/routers/x.ts" },
    { sourcePath: "docs/ECOSYSTEM/79.md" },
    { sourcePath: "knowledge/operational/users.md" },
    { sourcePath: "Client\\src\\lib\\y.ts" }, // hoa/thường + dấu ngược của Windows
  ];

  it("★★★ vắng tiền tố ⇒ trả CHÍNH mảng gốc (0 byte đổi hành vi cho mọi người gọi cũ)", () => {
    expect(locKhoTheoTienTo(KHO, undefined)).toBe(KHO);
    expect(locKhoTheoTienTo(KHO, [])).toBe(KHO);
    expect(locKhoTheoTienTo(KHO, ["  ", ""])).toBe(KHO);
  });

  it("★★★ có tiền tố ⇒ chỉ giữ vùng mã, chuẩn hoá `\\` và hoa/thường", () => {
    const ra = locKhoTheoTienTo(KHO, ["server/", "client/"]).map((e) => e.sourcePath);
    expect(ra).toEqual(["server/routers/x.ts", "Client\\src\\lib\\y.ts"]);
  });

  it("★★★ KHÔNG có nhánh dự phòng 'rỗng thì trả cả kho' — dự phòng ấy là cửa sau mở lại chính lỗ này", () => {
    expect(locKhoTheoTienTo(KHO, ["khong-ton-tai/"])).toEqual([]);
  });
});
