/**
 * ★★★ 2026-08-17 — `defectHeatmapRouter` phải NỐI danh tính phiên vào tầng dịch vụ.
 *
 * `defectSpatialHeatmap.scope.test.ts` chứng minh dịch vụ lọc ĐÚNG khi được cho biết
 * người gọi là ai. File này chứng minh mảnh còn lại: router THỰC SỰ nói cho nó biết, và
 * nói bằng `ctx.user` (phiên THẬT) chứ không bằng một hằng số hay một ô trong `input`.
 *
 * Không có ca này thì một đột biến "truyền cứng `{userId:1,userRole:'admin'}`" sẽ sống
 * sót toàn bộ lưới dịch vụ — mọi người dùng lại thấy toàn hệ thống, mà mọi ca vẫn xanh.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `defectHeatmapRouter` đứng sau `moduleProcedure("MOD_QUALITY")`. Cổng LICENSE mặc định
// BẬT (`ENV.licenseModuleGate = LICENSE_MODULE_GATE_ENABLED !== 'false'`) và CSDL test có
// SKU đã cấu hình KHÔNG gồm MOD_QUALITY ⇒ mọi lượt gọi bị FEATURE_DISABLED trước khi tới
// đoạn mã cần đo. Tắt cổng ấy Ở ĐÂY (qua `vi.hoisted`, chạy TRƯỚC khi `_core/env` được
// nạp) để file này đo ĐÚNG một trục: danh tính phiên có tới tầng lọc hay không.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

// ── Dịch vụ heatmap bị chặn: ca này đo ĐỐI SỐ đi vào, không đo phép gom ──────────────
// ⚠ Mock TỪNG PHẦN (`importOriginal`), KHÔNG thay cả module. Router nhập 6 thứ từ đây
// (`resolveCallerScope`, `resolveSavedHeatmapScope`, `scopeLabels`, `scopedConditions`, …) và
// một mock toàn phần sẽ làm mọi thủ tục KHÁC nổ ở lượt gọi đầu — biến một lưới đo-danh-tính
// thành một lưới đo-mock. Chỉ hai hàm CHẠM CSDL bị chặn, vì `getDb` ở dưới là bản giả.
const computeSpatialHeatmap = vi.fn();
const resolveContributingScope = vi.fn();
vi.mock("../services/defectSpatialHeatmap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/defectSpatialHeatmap")>();
  return {
    ...actual,
    computeSpatialHeatmap: (...a: unknown[]) => computeSpatialHeatmap(...a),
    resolveContributingScope: (...a: unknown[]) => resolveContributingScope(...a),
  };
});

// ── CSDL giả CHỈ cho `getDb` (`generate` ghi một hàng ⇒ cần insert→values→returning).
// Mock TỪNG PHẦN: `_core/trpc` (middleware `requireUser`) cũng nhập `phaiDoiMatKhau` từ
// đúng module này — thay cả module sẽ làm hỏng chính cổng đang cần chạy thật.
const insertedRows: unknown[] = [];
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getDb: async () => ({
      insert: () => ({
        values: (v: unknown) => {
          insertedRows.push(v);
          return { returning: async () => [{ id: 777 }] };
        },
      }),
    }),
  };
});

import { defectHeatmapRouter } from "./defectHeatmapRouter";

const RESULT = {
  grid: [[0]],
  gridWidth: 10,
  gridHeight: 10,
  totalDefects: 0,
  maxDefectsInCell: 0,
  hotspots: [],
  realCoordinates: true,
  mode: "bbox" as const,
  coordinateSpace: "observed_extent" as const,
  boardWidth: 1,
  boardHeight: 1,
  excludedNoBbox: 0,
  excludedNoBboxPct: 0,
  scopeApplied: true,
  scopeEmptyReason: "no_factory_assignment" as const,
  scopeMessage: "Tài khoản của bạn chưa được gán nhà máy nào…",
};

const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;
const INPUT = { startDate: "2026-08-01", endDate: "2026-08-10", gridWidth: 10, gridHeight: 10 };

/** Ô `scope` thực sự tới tầng dịch vụ ở lượt gọi thứ `n`. */
function scopeArg(n = 0): { userId: number; userRole: string } {
  return (computeSpatialHeatmap.mock.calls[n][1] as { scope: { userId: number; userRole: string } }).scope;
}

beforeEach(() => {
  computeSpatialHeatmap.mockReset();
  computeSpatialHeatmap.mockResolvedValue(RESULT);
  resolveContributingScope.mockReset();
  resolveContributingScope.mockResolvedValue({ corporateCode: null, factoryCode: null, distinctCombinations: 0 });
  insertedRows.length = 0;
});

describe("★★★ defectHeatmapRouter — danh tính phiên đi tới tầng lọc", () => {
  it("getBboxHeatmap: `scope` lấy từ ctx.user, KHÔNG phải hằng số", async () => {
    const caller = defectHeatmapRouter.createCaller(ctxFor(4242, "engineer"));
    await caller.getBboxHeatmap(INPUT as never);

    expect(computeSpatialHeatmap).toHaveBeenCalledOnce();
    expect(scopeArg()).toEqual({ userId: 4242, userRole: "engineer" });
  });

  it("getBboxHeatmap: người gọi KHÁC ⇒ `scope` KHÁC (chống truyền cứng một danh tính)", async () => {
    await defectHeatmapRouter.createCaller(ctxFor(1, "admin")).getBboxHeatmap(INPUT as never);
    await defectHeatmapRouter.createCaller(ctxFor(99, "operator")).getBboxHeatmap(INPUT as never);

    expect(scopeArg(0)).toEqual({ userId: 1, userRole: "admin" });
    expect(scopeArg(1)).toEqual({ userId: 99, userRole: "operator" });
  });

  it("getBboxHeatmap: ba ô phạm vi được TRẢ RA cho giao diện (câu 'rỗng' phải tới được người dùng)", async () => {
    const r = await defectHeatmapRouter
      .createCaller(ctxFor(50, "maintenance"))
      .getBboxHeatmap(INPUT as never);

    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
  });

  it("generate: cũng nối `scope` từ phiên, và trả ba ô phạm vi ra ngoài", async () => {
    const r = await defectHeatmapRouter
      .createCaller(ctxFor(7, "supervisor"))
      .generate({ ...INPUT, periodType: "DAILY" } as never);

    expect(scopeArg()).toEqual({ userId: 7, userRole: "supervisor" });
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
  });

  it("client KHÔNG tự khai được danh tính: ô lạ trong input bị zod chặn", async () => {
    const caller = defectHeatmapRouter.createCaller(ctxFor(48, "operator"));
    await caller.getBboxHeatmap({ ...INPUT, scope: { userId: 1, userRole: "admin" } } as never);

    // zod `.object()` bỏ ô không khai; kể cả lọt vào input thì router vẫn dựng `scope`
    // từ ctx.user ⇒ danh tính client bịa ra không bao giờ tới được tầng lọc.
    expect(scopeArg()).toEqual({ userId: 48, userRole: "operator" });
  });
});
