/**
 * ★★★ 2026-08-18 (nhóm B #1) — **CẢ BA ĐƯỜNG CHỌN TOOL ĐỀU ĐI QUA CỔNG PHẠM VI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — "LƯỚI THEO FILE, KHÔNG THEO ĐƯỜNG THOÁT" (đã đếm 11 lần ở repo).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `handlers.scopeDb.test.ts` gọi THẲNG `tool.handler(...)`. Nó chứng minh **cái hàm** lọc đúng —
 * nó KHÔNG chứng minh rằng **đường người dùng thật sự đi** có ghé qua hàm ấy. Hôm nay có **ba**
 * đường chọn tool, cả ba đang BẬT trong cấu hình đang chạy:
 *
 *   1. **regex**    `classifyToolIntent()`      — bộ chọn tức thời, không model.
 *   2. **native**   `classifyToolIntentLLM()`   — model TỰ chọn tool (`AI_NATIVE_TOOLCALLS_ENABLED`).
 *   3. **vòng lặp** `tryExecuteToolLoop()`      — model chọn NHIỀU VÒNG (`AI_TOOL_LOOP_ENABLED=1`).
 *
 * Một bản vá chỉ chặn đường (1) là **không đủ**, và không có phép đo nào ở tầng handler nói được
 * điều đó. File này đi từ **ĐẦU ĐƯỜNG** (`tryExecuteTool` / `tryExecuteToolLoop`) cho cả ba.
 *
 * ⚠ Bộ phân giải phạm vi bị chặn ở đây **có chủ đích**: luật thật của nó ("admin = toàn cục; còn
 * lại = nhà máy được gán") đã có lưới riêng chạy trên CSDL THẬT (`handlers.scopeDb.test.ts`,
 * `aiAnalyticsScope.test.ts`). Ở đây đo đúng MỘT thứ: **đường đi**.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Cổng RBAC: luôn CHO QUA, để thứ duy nhất còn chặn được là PHẠM VI. ──
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

// ── Bộ phân giải phạm vi (module thật có lưới riêng — xem docblock trên). ──
const resolveFactoryScope = vi.fn();
const factoryIdsInScope = vi.fn();
vi.mock("../../_core/aiAnalyticsScope", () => ({
  resolveFactoryScope: (...a: unknown[]) => resolveFactoryScope(...a),
  factoryIdsInScope: (...a: unknown[]) => factoryIdsInScope(...a),
}));

// ── CSDL giả: KHÔNG lọc gì cả (đó chính là điểm mấu chốt). Nếu cổng phạm vi bị gỡ, hai hàng
//    dưới đây — gồm cả TÊN nhà máy B — sẽ đi thẳng ra kết quả. Ta ĐẾM cả số lượt truy vấn. ──
const ghi = { where: [] as unknown[] };
const HANG = [
  { factoryId: 1, factoryCode: "FAC_A", factoryName: "Nhà máy A", total: 100, ok: 90, ng: 10 },
  { factoryId: 2, factoryCode: "FAC_B", factoryName: "Nhà máy BÍ MẬT B", total: 500, ok: 250, ng: 250 },
];
function fakeDb() {
  const where = (c: unknown) => {
    ghi.where.push(c);
    // Hai hình dạng truy vấn: `.where().groupBy().orderBy()` (factory_stats) và `.where()` được
    // await thẳng (_sumNgRange) — cùng một đối tượng phục vụ cả hai (khuôn của analyticsTools.test).
    const t: any = Promise.resolve(HANG);
    t.groupBy = () => ({ orderBy: () => Promise.resolve(HANG) });
    return t;
  };
  return { select: () => ({ from: () => ({ leftJoin: () => ({ where }), where }) }) };
}
vi.mock("../../db/connection", () => ({ getDb: async () => fakeDb() }));

/**
 * ⚠ Cầu chì của vòng lặp (`ai/autonomyPolicy.isKillSwitchTripped`) đọc CSDL và **fail-CLOSED** khi
 * CSDL hỏng — với `db` giả ở trên nó nhảy ngay vòng 1 và `stop === "kill_switch"`. Ca vòng lặp khi
 * ấy sẽ **xanh vì lý do sai**: nó không đo cổng phạm vi, nó đo cầu chì. Chặn cầu chì ở trạng thái
 * "chưa nhảy" để phép đo nói đúng thứ nó tự nhận, và ca vòng lặp còn khẳng định thẳng
 * `stop !== "kill_switch"` để hỏng ấy không bao giờ quay lại trong im lặng.
 */
vi.mock("../ai/autonomyPolicy", () => ({ isKillSwitchTripped: async () => false }));

/** Seam BỘ CHỌN TOOL — đứng đúng chỗ hai bộ chọn thật đứng (khuôn của `authCtxInjection.test.ts`). */
const chon = vi.hoisted(() => ({
  regex: null as { tool: string | null; args: Record<string, unknown>; reason: string } | null,
  llm: null as { tool: string | null; args: Record<string, unknown>; reason: string } | null,
  /** Số lượt bộ chọn vòng ≥2 đã được hỏi (để chứng minh vòng lặp CHẠY THẬT nhiều vòng). */
  soVongTiepTheo: 0,
}));
vi.mock("./intentClassifier", async (importOriginal) => {
  const that = await importOriginal<typeof import("./intentClassifier")>();
  return {
    ...that,
    classifyToolIntent: (q: string, c?: unknown) =>
      chon.regex ?? (that.classifyToolIntent as any)(q, c),
    classifyToolIntentLLM: async () => chon.llm ?? { tool: null, args: {}, reason: "LLM_NO_TOOL" },
    decideNextToolLLM: async () => {
      chon.soVongTiepTheo++;
      return chon.llm ?? { tool: null, args: {}, reason: "LOOP_DONE" };
    },
  };
});

import { tryExecuteTool, tryExecuteToolLoop } from "./index";
import { toolKhongCoGiDeNoi } from "../aiLocalKnowledgeService";

/** Phiên THẬT do máy chủ tự đọc — nguồn danh tính DUY NHẤT (xem `argsWithAuthCtx`). */
const PHIEN = { user: { id: 77, role: "engineer", name: "E" }, lang: "vi" as const };
/** Danh tính BỊA — thứ một model có thể nhét vào args. */
const BIA = { userId: 999, role: "admin" };

/**
 * ⚠⚠ BỘ PHÂN GIẢI GIẢ PHẢI **PHỤ THUỘC DANH TÍNH**, nếu không lưới mù đúng lớp lỗi nguy hiểm nhất.
 *
 * Bản nháp đầu dùng `mockResolvedValue(...)` — trả cùng một phạm vi cho MỌI danh tính. Đột biến
 * M7 (*"chỉ vá đường regex; đường native/vòng lặp chạy bằng một `__authCtx` toàn quyền"*) khi ấy
 * **SỐNG SÓT** trên hai ca rò dữ liệu: danh tính bịa đi tới nơi, nhưng bộ phân giải giả vẫn trả
 * "phạm vi rỗng" nên kết quả vẫn là TỪ CHỐI và lưới vẫn xanh. Một phạm vi **không đọc danh tính**
 * là một phép đo không thể phát hiện việc danh tính bị đánh tráo.
 * ⇒ Nay `role === "admin"` ⇒ TOÀN CỤC, đúng như luật thật (`getUserAssignmentCodes`).
 */
const KHONG_GAN = () => {
  resolveFactoryScope.mockImplementation(async (u: { role?: string }) =>
    u?.role === "admin"
      ? { isGlobal: true, factoryCodes: [], corporateCodes: [] }
      : { isGlobal: false, factoryCodes: [], corporateCodes: [] },
  );
  factoryIdsInScope.mockResolvedValue([]);
};
const GAN_A = () => {
  resolveFactoryScope.mockImplementation(async (u: { role?: string }) =>
    u?.role === "admin"
      ? { isGlobal: true, factoryCodes: [], corporateCodes: [] }
      : { isGlobal: false, factoryCodes: ["FAC_A"], corporateCodes: [] },
  );
  factoryIdsInScope.mockResolvedValue([1]);
};
const TOAN_CUC = () => {
  resolveFactoryScope.mockImplementation(async () => ({ isGlobal: true, factoryCodes: [], corporateCodes: [] }));
  factoryIdsInScope.mockRejectedValue(new Error("KHÔNG được gọi với phạm vi toàn cục"));
};

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionMock.mockResolvedValue(true);
  ghi.where.length = 0;
  chon.regex = null;
  chon.llm = null;
  chon.soVongTiepTheo = 0;
  delete process.env.AI_TOOL_LOOP_ENABLED;
  KHONG_GAN();
});
afterEach(() => {
  delete process.env.AI_TOOL_LOOP_ENABLED;
});

/** Hai tool của mục #1, cùng một luật ⇒ mọi ca chạy cho CẢ HAI (không chép tay hai lần). */
const MUC_TIEU = [
  { ten: "get_factory_stats", cauHoi: "so sánh nhà máy", args: { days: 3 } },
  { ten: "get_ng_compare", cauHoi: "NG tháng này so với tháng trước", args: { period: "month" as const } },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ĐƯỜNG 1/3 — REGEX (`classifyToolIntent`, bộ chọn thật)", () => {
  it("★★★ bộ chọn THẬT (không seam) vẫn chọn đúng hai tool đang được vá — nếu không, ba ca dưới là chân lý rỗng", async () => {
    const { classifyToolIntent } = await vi.importActual<typeof import("./intentClassifier")>("./intentClassifier");
    await import("./index"); // đảm bảo sổ đăng ký đã nạp
    expect(classifyToolIntent("so sánh nhà máy").tool).toBe("get_factory_stats");
    expect(classifyToolIntent("NG tháng này so với tháng trước").tool).toBe("get_ng_compare");
  });

  it.each(MUC_TIEU)("★★★ $ten — 0 GÁN qua đường regex ⇒ TỪ CHỐI TRUNG THỰC, và KHÔNG một truy vấn nào chạy", async ({ cauHoi }) => {
    const r = await tryExecuteTool(cauHoi, undefined, PHIEN);
    expect(r.result, "tool phải chạy tới nơi, không bị nuốt").not.toBeNull();
    expect(r.result!.note).toBe("PERMISSION_DENIED");
    expect(r.result!.textSummary).toMatch(/chưa được gán/i);
    expect(JSON.stringify(r.result), "TÊN nhà máy B rò qua đường regex").not.toContain("BÍ MẬT B");
    expect(ghi.where, "một lượt bị từ chối KHÔNG được chạm tới một hàng dữ liệu nào").toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ĐƯỜNG 2/3 — NATIVE TOOL-CALLING (model TỰ chọn tool, `classifyToolIntentLLM`)", () => {
  it.each(MUC_TIEU)("★★★ $ten — model tự chọn tool ⇒ vẫn phải qua cổng phạm vi", async ({ ten, args }) => {
    // regex TRƯỢT ⇒ `chonToolVong1` rơi sang bộ chọn LLM. Đây đúng hình dạng đường native.
    chon.regex = { tool: null, args: {}, reason: "NO_TRIGGER_MATCH" };
    chon.llm = { tool: ten, args: { ...args }, reason: "NATIVE_TOOLCALL" };

    const r = await tryExecuteTool("câu hỏi mà regex không khớp", undefined, PHIEN);
    expect(r.decision.tool, "phải thật sự đi đường LLM").toBe(ten);
    expect(r.result!.note).toBe("PERMISSION_DENIED");
    expect(JSON.stringify(r.result), "TÊN nhà máy B rò qua đường native").not.toContain("BÍ MẬT B");
    expect(ghi.where).toHaveLength(0);
  });

  it.each(MUC_TIEU)("★★★ $ten — `__authCtx` BỊA do model sinh KHÔNG mở được phạm vi", async ({ ten, args }) => {
    chon.regex = { tool: null, args: {}, reason: "NO_TRIGGER_MATCH" };
    // ⚠ Đây là đầu vào THẬT của đường native: `tool.parameters.safeParse` GIỮ NGUYÊN ô `__authCtx`
    // đã khai trong schema, nên args do model sinh mang được một danh tính bịa.
    chon.llm = { tool: ten, args: { ...args, __authCtx: BIA }, reason: "NATIVE_TOOLCALL" };

    const r = await tryExecuteTool("câu hỏi mà regex không khớp", undefined, PHIEN);
    expect(r.result!.note).toBe("PERMISSION_DENIED");
    // Bằng chứng MẠNH: phạm vi được giải theo phiên THẬT (77/engineer), không theo 999/admin.
    expect(resolveFactoryScope).toHaveBeenCalledWith(expect.objectContaining({ id: 77, role: "engineer" }));
    expect(resolveFactoryScope).not.toHaveBeenCalledWith(expect.objectContaining({ id: 999 }));
    expect(checkPermissionMock.mock.calls.every((c) => c[0] === 77)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ĐƯỜNG 3/3 — VÒNG LẶP TOOL TỰ DO (`AI_TOOL_LOOP_ENABLED=1`)", () => {
  /**
   * ⚠ Vòng 1 và vòng 2 chọn **HAI tool KHÁC nhau** có chủ đích: `runToolLoop` có guard `lap_lai`
   * (cùng tool + cùng args ⇒ dừng), nên lặp lại một tool sẽ cho `rounds.length === 1` và ca này
   * trở thành một phép đo **một-lượt đội lốt vòng lặp**. Hai tool khác nhau còn phủ đúng thứ ta
   * cần: **cả hai** tool của mục #1 đi qua cổng phạm vi ở **hai vòng khác nhau**.
   */
  it("★★★ vòng lặp chạy 2 VÒNG với 2 tool khác nhau — CẢ HAI vòng đều bị cổng phạm vi chặn", async () => {
    process.env.AI_TOOL_LOOP_ENABLED = "1";
    chon.regex = { tool: "get_factory_stats", args: { days: 3 }, reason: "VONG_1" };
    chon.llm = { tool: "get_ng_compare", args: { period: "month", __authCtx: BIA }, reason: "VONG_N" };

    const r = await tryExecuteToolLoop("so sánh nhà máy", undefined, PHIEN);

    expect(r.loop, "cờ BẬT ⇒ phải thật sự đi đường vòng lặp").not.toBeNull();
    expect(r.loop!.stop, "cầu chì nhảy ⇒ ca này đo NHẦM thứ khác").not.toBe("kill_switch");
    expect(r.loop!.rounds.length, "phải chạy > 1 vòng, nếu không đây không phải phép đo vòng lặp").toBeGreaterThan(1);
    expect(r.loop!.rounds.map((x) => x.tool)).toEqual(["get_factory_stats", "get_ng_compare"]);
    expect(chon.soVongTiepTheo, "bộ chọn vòng ≥2 phải được hỏi").toBeGreaterThan(0);
    // ⚠ `ToolLoopRound` KHÔNG mang `ToolResult`; nó mang `summary` — và `summary` chính là thứ đi
    // vào prompt của vòng sau + của câu trả lời cuối. Đo trên nó là đo đúng thứ chảy ra ngoài.
    for (const v of r.loop!.rounds) {
      expect(v.summary ?? "", `vòng ${v.round} lọt qua cổng phạm vi`).toMatch(/chưa được gán/i);
      expect(v.summary ?? "", `vòng ${v.round} rò TÊN nhà máy B`).not.toContain("BÍ MẬT B");
    }
    expect(r.result!.note).toBe("PERMISSION_DENIED");
    expect(JSON.stringify(r.loop), "TÊN nhà máy B rò qua đường vòng lặp").not.toContain("BÍ MẬT B");
    expect(ghi.where).toHaveLength(0);
    expect(resolveFactoryScope).not.toHaveBeenCalledWith(expect.objectContaining({ id: 999 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ CHIỀU DƯƠNG trên cả ba đường — có gán ⇒ vẫn ĐỌC ĐƯỢC, và toàn quyền ⇒ KHÔNG bị thu hẹp", () => {
  it.each(MUC_TIEU)("$ten — người được gán A: truy vấn CÓ CHẠY và phạm vi được giải bằng tập id", async ({ cauHoi }) => {
    GAN_A();
    const r = await tryExecuteTool(cauHoi, undefined, PHIEN);
    expect(r.result!.note, "có gán mà vẫn từ chối ⇒ vá quá tay").toBeUndefined();
    expect(ghi.where.length, "truy vấn phải thật sự chạy").toBeGreaterThan(0);
    expect(factoryIdsInScope).toHaveBeenCalledWith(
      expect.objectContaining({ isGlobal: false, factoryCodes: ["FAC_A"] }),
    );
  });

  it.each(MUC_TIEU)("$ten — ADMIN: `factoryIdsInScope` KHÔNG được gọi (không có mệnh đề thu hẹp nào)", async ({ cauHoi }) => {
    TOAN_CUC();
    const r = await tryExecuteTool(cauHoi, undefined, PHIEN);
    expect(r.result!.note, "chặn nhầm admin").toBeUndefined();
    expect(factoryIdsInScope, "gọi nó với phạm vi toàn cục là một lỗi lập trình").not.toHaveBeenCalled();
    expect(ghi.where.length).toBeGreaterThan(0);
  });

  it("ADMIN vẫn nhận được TÊN của mọi nhà máy (lưới chống 'vá an ninh bằng cách chặn tất cả')", async () => {
    TOAN_CUC();
    const r = await tryExecuteTool("so sánh nhà máy", undefined, PHIEN);
    expect(r.result!.textSummary).toContain("Nhà máy BÍ MẬT B");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ TƯƠNG TÁC VỚI CỔNG THỨ TÁM (`toolKhongCoGiDeNoi`)", () => {
  /**
   * ⚠⚠ Cổng thứ tám chặn LLM diễn giải một kết quả rỗng. ★ 2026-08-18 vị từ đã ĐẢO CHIỀU: *có
   * `note` ⇒ chặn*, ngoại lệ khai tên ở `TOOL_NOTE_VAN_DIEN_GIAI` (xem
   * `aiLocalTools/toolNoteCensus.test.ts`). Trước đó cổng chỉ biết BỐN mã chép tay, nên mọi mã
   * rỗng khác (`SCOPE_EMPTY`, `NOT_FOUND_WITH_SUGGESTIONS`, …) đều lọt — model nhận kết quả rỗng
   * kèm chỉ dẫn *"ƯU TIÊN dùng dữ liệu thời gian thực"* và diễn giải bừa thành kết luận nhà xưởng.
   * ⇒ Ca này ĐO bằng chính hàm cổng, không tin vào docstring của bản vá.
   */
  it.each(MUC_TIEU)("★★★ $ten — kết quả 'phạm vi rỗng' KHOÁ được cổng thứ tám", async ({ cauHoi }) => {
    const r = await tryExecuteTool(cauHoi, undefined, PHIEN);
    expect(toolKhongCoGiDeNoi(r.result, 1), "note của phạm vi rỗng KHÔNG nằm trong nhóm chặn LLM").toBe(true);
  });

  it("★★ …và một kết quả CÓ dữ liệu thật KHÔNG bị cổng thứ tám nuốt (chống vá quá tay)", async () => {
    GAN_A();
    const r = await tryExecuteTool("so sánh nhà máy", undefined, PHIEN);
    expect(toolKhongCoGiDeNoi(r.result, 1)).toBe(false);
  });
});
