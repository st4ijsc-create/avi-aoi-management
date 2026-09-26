/**
 * ★★★ **BA TÌNH HUỐNG SKU, ĐO LÚC CHẠY** — nửa hành vi của cổng giấy phép `MOD_AI`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI, DÙ ĐÃ CÓ BẢN ĐIỀU TRA DÂN SỐ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/routers/congGiayPhepAiCensus.test.ts` là một cổng **CẤU TRÚC**: nó chứng minh *cái gì
 * đứng sau cổng nào*. Nó **không** phát biểu được *cổng ấy quyết định thế nào khi có người gọi*.
 * Trước lượt này `server/_core/moduleGate.ts` — file mang toàn bộ luật thương mại của sản phẩm —
 * **KHÔNG có một lưới nào**. Cả bốn nhánh CHO QUA (cờ tắt · bypass · chưa khai SKU · CSDL sập) và
 * nhánh TỪ CHỐI đều chưa từng bị đo.
 *
 * ⇒ File này phát biểu **BA** câu, đúng ba loại khách mà chủ dự án đang bán, và mỗi câu là một
 *   **LƯỢNG TỪ chạy trên SỔ ĐĂNG KÝ THẬT** (`SYSTEM_MODULES` của `shared/module-registry.ts`) chứ
 *   không trên vài mã chép tay:
 *
 *   §2  Khách **KHÔNG** mua AI  — SKU có khai, không gồm `MOD_AI`:
 *       `MOD_AI` bị từ chối, **VÀ ∀ module khác trong SKU + ∀ module CORE vẫn CHO QUA**.
 *       Vế thứ hai là ràng buộc số một của cả lượt việc; nó là thứ ô này thật sự canh.
 *   §3  Khách **CÓ** mua AI     — SKU gồm `MOD_AI`: cho qua, và **KHÔNG MỘT module nào** đổi phán
 *       quyết so với §2 ngoài đúng `MOD_AI`.
 *   §4  **CHƯA KHAI SKU**       — không hàng license nào, không cache đĩa: **∀ module CHO QUA**
 *       (không-brick). Đây là khuôn MẶC ĐỊNH của một hệ mới cài.
 *
 * ⚠⚠ Vì sao **KHÔNG** đo trên CSDL thật: SKU của môi trường test được suy từ
 *    `server/license/license-state-cache.json` (một tệp **ĐANG ĐƯỢC GIT THEO DÕI**, vì bảng
 *    `licenses` RỖNG ở cả CSDL dev lẫn CSDL test). Nó liệt kê 10 module và **không** gồm `MOD_AI`.
 *    Một lưới đo trên đó sẽ (a) chỉ dựng được **một** trong ba tình huống, và (b) đổi màu khi ai đó
 *    kích hoạt một license trên máy mình. Nên tầng dữ liệu bị **chặn**, và ba tình huống được dựng
 *    tường minh — không để lại fixture nào trong bất kỳ CSDL nào.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SYSTEM_MODULES, CORE_MODULE_CODES } from "@shared/module-registry";

/** SKU của một khách CHỈ mua nền tảng + vài module vận hành — KHÔNG mua AI. */
const SKU_KHONG_AI = [
  "CORE_AUTH",
  "CORE_DASHBOARD",
  "CORE_SETTINGS",
  "CORE_ADMIN",
  "MOD_CORPORATE",
  "MOD_MONITORING",
  "MOD_ALERTS",
  "MOD_PRODUCTION",
  "MOD_ANALYTICS",
  "MOD_DATA_MANAGEMENT",
];
/** Cùng khách ấy, sau khi mua thêm AI. Khác ĐÚNG một phần tử. */
const SKU_CO_AI = [...SKU_KHONG_AI, "MOD_AI"];

const getAllLicensesMock = vi.fn();
const loadCacheMock = vi.fn();

vi.mock("../db", () => ({
  getAllLicenses: (...a: unknown[]) => getAllLicensesMock(...a),
}));
vi.mock("../license/license-service", () => ({
  licenseService: { loadLicenseStateCache: () => loadCacheMock() },
}));

/** Dựng một tình huống SKU: `null` ⇒ KHÔNG có hàng license nào và KHÔNG có cache đĩa. */
function dungSku(modules: string[] | null): void {
  getAllLicensesMock.mockReset();
  loadCacheMock.mockReset();
  if (modules === null) {
    getAllLicensesMock.mockResolvedValue({ licenses: [] });
    loadCacheMock.mockReturnValue(null);
    return;
  }
  getAllLicensesMock.mockImplementation(async (opts: { status?: string }) =>
    opts?.status === "active"
      ? { licenses: [{ allowedModules: modules }] }
      : { licenses: [] },
  );
  loadCacheMock.mockReturnValue(null);
}

const KHOA_ENV = ["LICENSE_MODULE_GATE_ENABLED", "LICENSE_BYPASS"] as const;

/**
 * Nạp LẠI `moduleGate` với biến môi trường đã đặt.
 * ⚠ `ENV` (`server/_core/env.ts`) đọc `process.env` **một lần lúc nạp module**, nên đổi env sau khi
 *   đã import là vô hiệu. `vi.resetModules()` + `await import(...)` là cách duy nhất đúng.
 */
async function napCong(env: Partial<Record<(typeof KHOA_ENV)[number], string>> = {}) {
  vi.resetModules();
  for (const k of KHOA_ENV) delete process.env[k];
  // Cổng BẬT là mặc định sản phẩm (`LICENSE_MODULE_GATE_ENABLED !== 'false'`), nhưng
  // `vitest` chạy với biến ấy chưa đặt và một số file lưới đặt nó = "false"; ghim tường minh
  // để file này đo ĐÚNG khuôn sản phẩm chứ không khuôn của môi trường.
  process.env.LICENSE_MODULE_GATE_ENABLED = env.LICENSE_MODULE_GATE_ENABLED ?? "true";
  if (env.LICENSE_BYPASS !== undefined) process.env.LICENSE_BYPASS = env.LICENSE_BYPASS;
  return import("./moduleGate");
}

/** Phán quyết cho **MỌI** module trong sổ đăng ký thật. */
async function phanQuyetToanSo(
  isModuleLicensed: (m: string) => Promise<boolean>,
): Promise<Record<string, boolean>> {
  const ra: Record<string, boolean> = {};
  for (const m of SYSTEM_MODULES) ra[m.code] = await isModuleLicensed(m.code);
  return ra;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  for (const k of KHOA_ENV) delete process.env[k];
});

describe("§1 — CẦU CHÌ: sổ đăng ký và tình huống có thật sự khác nhau không", () => {
  it("★ sổ đăng ký có đủ module, và SKU thử nghiệm là TẬP CON THẬT SỰ của nó", () => {
    // Không có ô này thì §2/§3 có thể xanh vì lượng từ chạy trên một tập RỖNG (tự thoả).
    expect(SYSTEM_MODULES.length).toBeGreaterThanOrEqual(15);
    const maTrongSo = new Set(SYSTEM_MODULES.map((m) => m.code));
    for (const m of SKU_CO_AI) expect(maTrongSo.has(m), `${m} phải có trong sổ đăng ký`).toBe(true);
    expect(maTrongSo.has("MOD_AI")).toBe(true);
    expect(SKU_KHONG_AI).not.toContain("MOD_AI");
    // Có module NGOÀI cả hai SKU (MOD_QUALITY/MOD_OT_CONTROL/…) — cần cho ca "không mua thì bị từ chối".
    expect([...maTrongSo].filter((m) => !SKU_CO_AI.includes(m)).length).toBeGreaterThan(0);
  });

  it("★ MOD_AI là module KHÔNG-CORE (nếu nó thành core thì cổng vĩnh viễn cho qua)", () => {
    const modAi = SYSTEM_MODULES.find((m) => m.code === "MOD_AI");
    expect(modAi, "MOD_AI biến mất khỏi sổ đăng ký").toBeDefined();
    expect(modAi?.isCore, "MOD_AI mà `isCore:true` ⇒ `moduleGate` cho qua MỌI lượt gọi").toBe(false);
    expect(CORE_MODULE_CODES).not.toContain("MOD_AI");
  });
});

describe("§2 — ★★★ KHÁCH **KHÔNG** MUA AI: AI tắt, MỌI THỨ KHÁC CHẠY Y NGUYÊN", () => {
  it("★★★ MOD_AI bị từ chối — VÀ ∀ module khác trong SKU + ∀ module CORE vẫn CHO QUA", async () => {
    dungSku(SKU_KHONG_AI);
    const { isModuleLicensed } = await napCong();
    const pq = await phanQuyetToanSo(isModuleLicensed);

    expect(pq.MOD_AI, "khách không mua AI mà MOD_AI vẫn qua ⇒ cổng KHÔNG cưỡng chế gì cả").toBe(false);

    // ⇐ Đây là ràng buộc số một, phát biểu bằng lượng từ trên sổ THẬT.
    const hongOan = SKU_KHONG_AI.filter((m) => pq[m] !== true);
    expect(
      hongOan,
      "MỘT MODULE KHÁCH ĐÃ MUA BỊ TỪ CHỐI. Đây là hồi quy nặng nhất có thể của lượt việc này.",
    ).toEqual([]);
    const coreHong = CORE_MODULE_CODES.filter((m) => pq[m] !== true);
    expect(coreHong, "module CORE không bao giờ được bị khoá").toEqual([]);
  });

  it("★★ middleware tRPC: `moduleGate('MOD_AI')` NÉM, `moduleGate` của module đã mua thì GỌI `next`", async () => {
    dungSku(SKU_KHONG_AI);
    const { moduleGate } = await napCong();
    const ctx = { user: { id: 1, role: "admin" } } as never;
    const next = vi.fn(async () => "DA_QUA");

    await expect(moduleGate("MOD_AI")({ ctx, next })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(next, "lượt bị từ chối KHÔNG được chạy handler").not.toHaveBeenCalled();

    // Chiều DƯƠNG trong CÙNG một tình huống: module đã mua vẫn đi tiếp.
    await expect(moduleGate("MOD_PRODUCTION")({ ctx, next })).resolves.toBe("DA_QUA");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("★ lượt từ chối mang `appCode: FEATURE_DISABLED` + `feature: moduleAi` (client phân biệt được)", async () => {
    dungSku(SKU_KHONG_AI);
    const { moduleGate } = await napCong();
    const ctx = { user: { id: 1, role: "admin" } } as never;
    try {
      await moduleGate("MOD_AI")({ ctx, next: async () => undefined });
      throw new Error("đáng lẽ phải ném");
    } catch (err) {
      const cause = (err as { cause?: { appCode?: string; appParams?: { feature?: string } } }).cause;
      expect(cause?.appCode).toBe("FEATURE_DISABLED");
      expect(cause?.appParams?.feature).toBe("moduleAi");
    }
  });
});

describe("§3 — KHÁCH **CÓ** MUA AI: hành vi KHÔNG đổi ngoài đúng một ô", () => {
  it("★★★ so với §2, ĐÚNG MỘT module đổi phán quyết — và đó là `MOD_AI`", async () => {
    dungSku(SKU_KHONG_AI);
    const { isModuleLicensed: khong } = await napCong();
    const pqKhong = await phanQuyetToanSo(khong);

    dungSku(SKU_CO_AI);
    const { isModuleLicensed: co } = await napCong();
    const pqCo = await phanQuyetToanSo(co);

    const doi = SYSTEM_MODULES.map((m) => m.code).filter((m) => pqKhong[m] !== pqCo[m]);
    expect(
      doi,
      "Mua thêm AI mà một module KHÁC đổi phán quyết ⇒ cổng đang trộn hai trục.",
    ).toEqual(["MOD_AI"]);
    expect(pqCo.MOD_AI).toBe(true);
  });

  it("★ middleware cho qua khi đã mua", async () => {
    dungSku(SKU_CO_AI);
    const { moduleGate } = await napCong();
    const next = vi.fn(async () => "DA_QUA");
    await expect(
      moduleGate("MOD_AI")({ ctx: { user: { id: 1 } } as never, next }),
    ).resolves.toBe("DA_QUA");
  });
});

describe("§4 — CHƯA KHAI SKU (khuôn mặc định hôm nay): KHÔNG-BRICK, mọi thứ cho qua", () => {
  it("★★★ không hàng license + không cache đĩa ⇒ ∀ module trong sổ đăng ký đều CHO QUA", async () => {
    dungSku(null);
    const { isModuleLicensed } = await napCong();
    const pq = await phanQuyetToanSo(isModuleLicensed);
    const biChan = SYSTEM_MODULES.map((m) => m.code).filter((m) => pq[m] !== true);
    expect(
      biChan,
      "Một hệ CHƯA TỪNG được khai SKU mà bị khoá module ⇒ vừa cài xong đã hỏng (brick).",
    ).toEqual([]);
  });

  it("★★ middleware cũng cho qua (không chỉ hàm thuần)", async () => {
    dungSku(null);
    const { moduleGate } = await napCong();
    const next = vi.fn(async () => "DA_QUA");
    await expect(
      moduleGate("MOD_AI")({ ctx: { user: { id: 1 } } as never, next }),
    ).resolves.toBe("DA_QUA");
  });

  it("★ cache ĐĨA vẫn là một lời khai SKU — có cache thì KHÔNG còn là 'chưa khai'", async () => {
    // ⚠ Đây chính là khuôn của hệ ĐANG CHẠY: bảng `licenses` RỖNG, nhưng
    //   `server/license/license-state-cache.json` liệt kê 10 module không gồm MOD_AI.
    getAllLicensesMock.mockResolvedValue({ licenses: [] });
    loadCacheMock.mockReturnValue({ allowedModules: SKU_KHONG_AI });
    const { isModuleLicensed } = await napCong();
    expect(await isModuleLicensed("MOD_AI")).toBe(false);
    expect(await isModuleLicensed("MOD_PRODUCTION")).toBe(true);
  });
});

describe("§5 — HAI ĐƯỜNG THOÁT VÀ MỘT FAIL-SAFE (bất đối xứng CỐ Ý)", () => {
  it("★ cờ `LICENSE_MODULE_GATE_ENABLED=false` ⇒ cho qua, và KHÔNG chạm CSDL", async () => {
    dungSku(SKU_KHONG_AI);
    const { isModuleLicensed } = await napCong({ LICENSE_MODULE_GATE_ENABLED: "false" });
    expect(await isModuleLicensed("MOD_AI")).toBe(true);
    expect(getAllLicensesMock, "cờ tắt mà vẫn truy CSDL ⇒ đường thoát nằm SAI chỗ").not.toHaveBeenCalled();
  });

  it("★ `LICENSE_BYPASS=true` (triển khai offline) ⇒ cho qua, và KHÔNG chạm CSDL", async () => {
    dungSku(SKU_KHONG_AI);
    const { isModuleLicensed } = await napCong({ LICENSE_BYPASS: "true" });
    expect(await isModuleLicensed("MOD_AI")).toBe(true);
    expect(getAllLicensesMock).not.toHaveBeenCalled();
  });

  it("★★ CSDL sập ⇒ CHO QUA (fail-safe), KHÔNG khoá khách đã trả tiền vì một trục trặc", async () => {
    getAllLicensesMock.mockRejectedValue(new Error("CSDL sập"));
    loadCacheMock.mockReturnValue(null);
    const { isModuleLicensed, moduleGate } = await napCong();
    expect(await isModuleLicensed("MOD_AI")).toBe(true);
    const next = vi.fn(async () => "DA_QUA");
    await expect(
      moduleGate("MOD_AI")({ ctx: { user: { id: 1 } } as never, next }),
    ).resolves.toBe("DA_QUA");
  });
});

describe("§6 — NỬA EXPRESS dùng CHUNG một động cơ quyết định", () => {
  /**
   * ⚠ Không có ô này thì `/api/ai/**` có thể lặng lẽ mang một luật entitlement THỨ HAI. Hai bản sao
   *   lệch nhau thì cái yếu hơn quyết định ai vào được, và không ai biết bản nào đang chạy.
   */
  it("★★ SKU không có AI ⇒ 403 + `MODULE_NOT_LICENSED`; SKU có AI ⇒ gọi `next`", async () => {
    dungSku(SKU_KHONG_AI);
    vi.resetModules();
    process.env.LICENSE_MODULE_GATE_ENABLED = "true";
    const { chanTuyenAiTheoGiayPhep, MA_TU_CHOI_GIAY_PHEP } = await import(
      "../routes/congGiayPhepAiExpress"
    );

    const goi = async (mw: ReturnType<typeof chanTuyenAiTheoGiayPhep>) => {
      let than: Record<string, unknown> | null = null;
      let ma = 0;
      let daNext = false;
      const res = {
        status(c: number) {
          ma = c;
          return this;
        },
        json(b: Record<string, unknown>) {
          than = b;
          return this;
        },
      };
      await new Promise<void>((ok) => {
        mw({} as never, res as never, (() => {
          daNext = true;
          ok();
        }) as never);
        setTimeout(ok, 300);
      });
      return { ma, than, daNext };
    };

    const chan = await goi(chanTuyenAiTheoGiayPhep());
    expect(chan.daNext, "SKU không có AI mà middleware vẫn cho đi tiếp").toBe(false);
    expect(chan.ma).toBe(403);
    expect((chan.than as { code?: string } | null)?.code).toBe(MA_TU_CHOI_GIAY_PHEP);

    dungSku(SKU_CO_AI);
    vi.resetModules();
    process.env.LICENSE_MODULE_GATE_ENABLED = "true";
    const lai = await import("../routes/congGiayPhepAiExpress");
    const qua = await goi(lai.chanTuyenAiTheoGiayPhep());
    expect(qua.daNext, "SKU CÓ mua AI mà middleware vẫn chặn").toBe(true);
  });
});
