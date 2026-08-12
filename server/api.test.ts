import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { readAppErrorMeta } from "./_core/appError";

// Mock database functions with correct names
vi.mock("./db", () => ({
  // ★ Pha 7 Task 9 (9b) — `auth.me` nay kèm ô SUY RA `mustChangePassword`, đọc DB MỚI (KHÔNG suy
  //   từ `ctx.user`, thứ đã bị `redactServerOnlyUserFields` làm rỗng). Thiếu ô này thì `auth.me` đỏ.
  phaiDoiMatKhau: vi.fn().mockResolvedValue(false),
  layMocMatKhau: vi.fn().mockResolvedValue({ passwordChangedAt: null, passwordInvalidBefore: null }),
  layBiMatNguoiDung: vi.fn().mockResolvedValue({ passwordHash: null, twoFactorSecret: null }),
  getFactories: vi.fn().mockResolvedValue([
    { id: 1, code: "FAC001", name: "Factory 1", isActive: true },
  ]),
  getFactoryById: vi.fn().mockResolvedValue({ id: 1, code: "FAC001", name: "Factory 1" }),
  createFactory: vi.fn().mockResolvedValue(1),
  updateFactory: vi.fn().mockResolvedValue(undefined),
  getWorkshops: vi.fn().mockResolvedValue([
    { id: 1, factoryId: 1, code: "WS001", name: "Workshop 1" },
  ]),
  getWorkshopsByFactory: vi.fn().mockResolvedValue([]),
  createWorkshop: vi.fn().mockResolvedValue(1),
  getProductionLines: vi.fn().mockResolvedValue([]),
  getProductionLinesByWorkshop: vi.fn().mockResolvedValue([]),
  createProductionLine: vi.fn().mockResolvedValue(1),
  getStations: vi.fn().mockResolvedValue([]),
  getStationsByLine: vi.fn().mockResolvedValue([]),
  createStation: vi.fn().mockResolvedValue(1),
  getMachines: vi.fn().mockResolvedValue([
    { id: 1, code: "AVI001", name: "AVI Machine 1", machineType: "AVI", apiKey: "test-api-key" },
  ]),
  getMachinesByStation: vi.fn().mockResolvedValue([]),
  getMachineByApiKey: vi.fn().mockResolvedValue({ id: 1, code: "AVI001", name: "AVI Machine 1" }),
  getMachineById: vi.fn().mockResolvedValue({ id: 1, code: "AVI001", name: "AVI Machine 1" }),
  // W3-B (M7): machine.create pre-checks duplicates + audits via createAuditLog
  getMachineByCode: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue({ id: 1 }),
  createMachine: vi.fn().mockResolvedValue(1),
  updateMachineHeartbeat: vi.fn().mockResolvedValue(undefined),
  getProductInspections: vi.fn().mockResolvedValue([]),
  getProductInspectionById: vi.fn().mockResolvedValue({
    id: 1, serialNumber: "SN001", overallResult: "OK", originalResult: "OK", machineId: 1
  }),
  createProductInspection: vi.fn().mockResolvedValue(1),
  updateProductInspectionNTF: vi.fn().mockResolvedValue(undefined),
  searchInspections: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getDashboardStats: vi.fn().mockResolvedValue({ total: 100, ok: 95, ng: 3, ntf: 2, yieldRate: 97 }),
  getMachineStats: vi.fn().mockResolvedValue({ total: 50, ok: 48, ng: 1, ntf: 1, yieldRate: 98 }),
  getFactoryLayoutsByWorkshop: vi.fn().mockResolvedValue([]),
  getFactoryLayoutById: vi.fn().mockResolvedValue({ id: 1, name: "Layout 1" }),
  createFactoryLayout: vi.fn().mockResolvedValue(1),
  updateFactoryLayout: vi.fn().mockResolvedValue(undefined),
  getMachinePositionsByLayout: vi.fn().mockResolvedValue([]),
  createMachinePosition: vi.fn().mockResolvedValue(1),
  updateMachinePosition: vi.fn().mockResolvedValue(undefined),
  deleteMachinePosition: vi.fn().mockResolvedValue(undefined),
  getMeasurementResultsByInspection: vi.fn().mockResolvedValue([]),
  getMeasurementResultById: vi.fn().mockResolvedValue({ id: 1, result: "OK" }),
  updateMeasurementResultRemark: vi.fn().mockResolvedValue(undefined),
  createMeasurementResult: vi.fn().mockResolvedValue(1),
  createMeasurementResults: vi.fn().mockResolvedValue(undefined),
  getMeasurementPointDefsByMachine: vi.fn().mockResolvedValue([]),
  getMeasurementPointDefByCode: vi.fn().mockResolvedValue(null),
  createMeasurementPointDef: vi.fn().mockResolvedValue(1),
  upsertDailyStatistics: vi.fn().mockResolvedValue(undefined),
  getDailyStatistics: vi.fn().mockResolvedValue([]),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createAnonymousContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("Factory Router", () => {
  it("should list factories for authenticated user", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.factory.list();

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should get factory by id", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.factory.getById({ id: 1 });

    expect(result).toBeDefined();
  });

  it("should allow admin to create factory", async () => {
    const ctx = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.factory.create({
      code: "FAC002",
      name: "Factory 2",
    });

    expect(result).toHaveProperty("id");
  });

  /**
   * ★★★★ Review TOÀN NHÁNH Pha 9 · **KỲ VỌNG SAI, HÀNH VI ĐÚNG.**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ CA NÀY ĐỎ VÌ **CHÍNH NÓ**, KHÔNG VÌ SẢN PHẨM — VÀ ĐÓ LÀ HAI CHUYỆN KHÁC HẲN NHAU
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Đo được (`npx vitest run server/api.test.ts -t "reject non-admin"`, trước lượt sửa):
   *
   *     Expected: "Admin access required"
   *     Received: "Bạn không có quyền create cho module \"settings_factory\""
   *
   * RBAC **vẫn từ chối** — nó chỉ thôi nói tiếng Anh, từ **AI Sprint 5** (`appError` +
   * `errors.PERMISSION_DENIED`, `server/_core/accessControl.ts:191-196`). Kỳ vọng là cái **cũ**.
   *
   * ⚠⚠ **KHÔNG nới thành *"ném bất cứ gì cũng được"***: thế là biến một ca thật thành một ca
   *    trang trí — nó sẽ xanh cả khi `factory.create` ném vì DB rớt, vì zod, vì một `TypeError`.
   * ⚠⚠ **VÀ KHÔNG ghim CÂU TIẾNG VIỆT**: một lượt đổi bản dịch (hoặc đổi ngôn ngữ mặc định) sẽ
   *    làm ca này đỏ trong khi bất biến an ninh **không hề đổi** — đúng cái bẫy vừa mắc, chỉ
   *    khác ngôn ngữ. Ghim câu chữ là ghim **hiển thị**, không phải **cơ chế**.
   * ⇒ Ghim đúng thứ là **hợp đồng máy-đọc-được** mà chính `appError` sinh ra để tồn tại:
   *   `TRPCError.code === "FORBIDDEN"` ∧ `appCode === "PERMISSION_DENIED"` ∧
   *   `appParams.action === "canCreate"`. Ba vế, và **cả ba đều đỏ được**:
   *     · RBAC thôi từ chối        ⇒ không ném ⇒ ĐỎ ở `daNem`;
   *     · từ chối vì lý do KHÁC    ⇒ `appCode` khác ⇒ ĐỎ;
   *     · gắn nhầm `action`        ⇒ `appParams` khác ⇒ ĐỎ (đo được: `canCreate`, không `canEdit`).
   */
  it("should reject non-admin from creating factory", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    // ĐỐI CHỨNG DƯƠNG nằm ngay trên (`should allow admin to create factory`): cùng thủ tục, cùng
    // đầu vào, chỉ đổi vai ⇒ ca này KHÔNG thể xanh bằng một bản vá "chặn tất".
    let daNem: unknown = null;
    try {
      await caller.factory.create({ code: "FAC002", name: "Factory 2" });
    } catch (e) {
      daNem = e;
    }

    expect(daNem, "vai `user` TẠO ĐƯỢC nhà máy ⇒ cổng RBAC đã biến mất").not.toBeNull();
    expect((daNem as { code?: string })?.code, "phải là FORBIDDEN, không phải một lỗi hạ tầng").toBe(
      "FORBIDDEN",
    );
    expect(
      readAppErrorMeta(daNem),
      "mã máy-đọc-được của lượt từ chối đã đổi — client bản địa hoá theo đúng nó",
    ).toEqual({ appCode: "PERMISSION_DENIED", appParams: { action: "canCreate" } });
  });
});

describe("Workshop Router", () => {
  it("should list workshops for authenticated user", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.workshop.list();

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should allow admin to create workshop", async () => {
    const ctx = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.workshop.create({
      factoryId: 1,
      code: "WS002",
      name: "Workshop 2",
    });

    expect(result).toHaveProperty("id");
  });
});

describe("Machine Router", () => {
  it("should list machines for authenticated user", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.machine.list();

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should allow admin to create machine with API key", async () => {
    const ctx = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.machine.create({
      stationId: 1,
      code: "AVI002",
      name: "AVI Machine 2",
      machineType: "AVI",
    });

    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("apiKey");
    expect(result.apiKey).toBeTruthy();
  });
});

describe("Dashboard Router", () => {
  it("should get dashboard stats for authenticated user", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.dashboard.getStats({});

    expect(result).toBeDefined();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("ng");
    expect(result).toHaveProperty("ntf");
    expect(result).toHaveProperty("yieldRate");
  });
});

describe("Inspection Router", () => {
  it("should search inspection results", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.inspection.search({});

    expect(result).toBeDefined();
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
  });

  it("should get inspection by id", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.inspection.getById({ id: 1 });

    expect(result).toBeDefined();
    expect(result).toHaveProperty("inspection");
    expect(result).toHaveProperty("measurements");
    expect(result).toHaveProperty("machine");
  });
});

describe("Auth Router", () => {
  it("should return user for authenticated request", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.me();

    expect(result).toBeDefined();
    expect(result?.email).toBe("test@example.com");
  });

  it("should return null for anonymous request", async () => {
    const ctx = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.me();

    expect(result).toBeNull();
  });

  it("should logout successfully", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
  });
});

describe("Protected Routes", () => {
  it("should reject unauthenticated access to factory list", async () => {
    const ctx = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.factory.list()).rejects.toThrow();
  });

  it("should reject unauthenticated access to dashboard stats", async () => {
    const ctx = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.dashboard.getStats({})).rejects.toThrow();
  });
});
