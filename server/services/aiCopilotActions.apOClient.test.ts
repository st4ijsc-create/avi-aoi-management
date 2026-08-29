/**
 * ★★★ ĐỢT C · TASK 5 (2026-08-29, spec §6.5) — KIỂM TOÁN LƯỢT ÁP Ở CLIENT (chế độ LOCAL), ĐO TẠI MÁY CHỦ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * MỆNH ĐỀ TRUNG TÂM — GHI TRƯỚC KHI BYTE RƠI, CHỐT SAU, VÀ KHÔNG ĐƯỢC KHAI ĐIỀU MÁY CHỦ KHÔNG BIẾT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ở chế độ LOCAL, byte rơi trên đĩa máy lập trình viên qua EXTENSION VS Code — máy chủ không với
 * tới tệp đó. `batDauApDungOClient` ghi hàng `dang_ap_client` TRƯỚC khi extension ghi byte;
 * `chotApDungOClient` chốt `da_ap_client`/`ap_client_that_bai` SAU, theo đúng lời khai của
 * extension. Lưới này khoá năm bất biến brief đòi: (1) hàng mới tạo đúng trạng thái + trả
 * actionId/token; (2) chốt theo ĐÚNG `thanhCong`; (3) token sai ⇒ từ chối, không đổi trạng thái;
 * (4) người dùng khác ⇒ từ chối; (5) chốt hai lần ⇒ idempotent (không ném, không đổi trạng thái ở
 * lần hai dù lần hai khai NGƯỢC lại); cộng thêm (6) `argsJson` KHÔNG chứa toàn văn nội dung tệp
 * (bất biến chống rò — spec §6.5: "mã đã ở máy dev, máy chủ không cần bản sao") và (7) chốt một
 * hàng không ở `dang_ap_client` ⇒ từ chối rành mạch.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ LƯỚI MOCK (khuôn `aiCopilotActions.giandQuyen.test.ts`/`aiCopilotActions.test.ts`),
 * KHÔNG PHẢI DB THẬT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai hàm này KHÔNG gọi `tool.execute()` (không có `Tool` thật đứng sau chế độ LOCAL — đường ghi là
 * extension, ngoài tầm với của server) và không chạm repo git — mọi mệnh đề ở đây là VỀ CỘT `status`
 * VÀ `argsJson` TRONG CSDL, đúng bề mặt mà một CSDL giả (in-memory, cùng các chuỗi `drizzle` thật
 * dùng: `insert().values()` · `select().from().where().limit()` · `update().set().where().
 * returning()`) mô phỏng trung thực. Phép giành-quyền-bằng-CAS ở `chotApDungOClient` dùng lại đúng
 * khuôn `confirmAction` (đã được `aiCopilotActions.giandQuyen.test.ts` đo cửa sổ đua ở lớp CHUNG) —
 * lưới này không đo lại cửa sổ đua đó, chỉ đo hành vi ĐẶC THÙ của hai hàm mới.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake in-memory ai_pending_actions store + drizzle-like query builder (khuôn có sẵn) ──
type Row = Record<string, any>;
const store = new Map<string, Row>();

function makeFakeDb() {
  return {
    insert: (_table: unknown) => ({
      values: async (vals: Row) => {
        store.set(vals.id, { ...vals });
      },
    }),
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of store.values()) if (pred(r)) return [{ ...r }];
            return [];
          },
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: Row) => ({
        where: (pred: (r: Row) => boolean) => {
          let daChay: Row[] | null = null;
          const run = (): Row[] => {
            if (daChay) return daChay;
            const trung: Row[] = [];
            for (const r of store.values()) {
              if (pred(r)) {
                Object.assign(r, patch);
                trung.push(r);
              }
            }
            daChay = trung;
            return trung;
          };
          return {
            then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) =>
              Promise.resolve({ rowCount: run().length }).then(ok, ng),
            returning: async (_cols?: unknown) => run().map((r) => ({ id: r.id })),
          };
        },
      }),
    }),
  };
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  gt: (col: any, val: any) => (r: Row) => r[col.__name] > val,
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

// `aiCopilotActions.ts` import `checkPermission` ở đỉnh file (dùng cho `proposeAction`/
// `confirmAction`) — hai hàm mới KHÔNG gọi nó, nhưng module THẬT của `_core/accessControl` có một
// hằng top-level dùng `sql\`\`` (drizzle-orm) mà lưới này không mock `sql`. Mock đứng ở đây cùng
// khuôn `aiCopilotActions.test.ts`/`giandQuyen.test.ts` — tránh nạp module thật, không đổi ý nghĩa
// lưới (checkPermission không nằm trong đường chạy của batDauApDungOClient/chotApDungOClient).
vi.mock("../_core/accessControl", () => ({ checkPermission: vi.fn(async () => true) }));

vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));

const logCrudOperation = vi.fn(async () => ({ id: 1 }));
vi.mock("./auditTrailService", () => ({
  AUDIT_ACTIONS: {
    AI_ACTION_PROPOSED: "ai_action_proposed",
    AI_ACTION_CONFIRMED: "ai_action_confirmed",
    AI_ACTION_EXECUTED: "ai_action_executed",
    AI_ACTION_DENIED: "ai_action_denied",
    AI_ACTION_CANCELLED: "ai_action_cancelled",
    AI_CLIENT_APPLY_STARTED: "ai_client_apply_started",
    AI_CLIENT_APPLIED: "ai_client_applied",
    AI_CLIENT_APPLY_FAILED: "ai_client_apply_failed",
  },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: vi.fn(async () => {}),
}));

import { batDauApDungOClient, chotApDungOClient } from "./aiCopilotActions";

const NGUOI_A = { id: 101, role: "developer", name: "Dev A" };
const NGUOI_B = { id: 202, role: "developer", name: "Dev B" };

function dauVaoBatDau(overrides: Partial<Parameters<typeof batDauApDungOClient>[0]> = {}) {
  return {
    path: "src/foo.ts",
    nhanWorkspace: "demo-workspace",
    sha256Truoc: "a".repeat(64),
    sha256Sau: "b".repeat(64),
    tomTat: "Sửa hàm foo",
    soDongThem: 3,
    soDongBot: 1,
    ...overrides,
  };
}

/** Hàng CHƯA qua `batDauApDungOClient` — dùng để dựng ca "trạng thái lạ" (§7) mà không phụ thuộc
 *  hành vi của chính hàm đang bị lưới đo. */
function gieoHangTrangThaiLa(id: string, status: string) {
  store.set(id, {
    id,
    userId: NGUOI_A.id,
    userRole: NGUOI_A.role,
    tool: "ap_o_client",
    status,
    argsJson: { path: "x", sha256Truoc: "a".repeat(64), sha256Sau: "b".repeat(64), tomTat: "t", soDongThem: 0, soDongBot: 0 },
    requiredPermissionJson: null,
    summary: "tóm tắt",
    previewJson: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    resultJson: null,
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — batDauApDungOClient: GHI TRƯỚC khi byte rơi", () => {
  it("★★★ tạo hàng status='dang_ap_client', trả actionId+token, userId lấy từ phiên", async () => {
    const kq = await batDauApDungOClient(dauVaoBatDau(), NGUOI_A);
    expect(kq.actionId).toBeTruthy();
    expect(kq.token).toBe(kq.actionId); // cùng quy ước token === actionId của propose/confirm.

    const hang = store.get(kq.actionId);
    expect(hang).toBeTruthy();
    expect(hang?.status).toBe("dang_ap_client");
    expect(hang?.tool).toBe("ap_o_client");
    expect(hang?.userId).toBe(NGUOI_A.id);

    expect(logCrudOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "ai_client_apply_started" }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — chotApDungOClient: chốt SAU theo ĐÚNG lời khai extension gửi", () => {
  it("★★★ thanhCong:true ⇒ 'da_ap_client'", async () => {
    const kq = await batDauApDungOClient(dauVaoBatDau(), NGUOI_A);
    const chot = await chotApDungOClient(
      { actionId: kq.actionId, token: kq.token, thanhCong: true, sha256SauThat: "c".repeat(64) },
      NGUOI_A,
    );
    expect(chot.ok).toBe(true);
    expect(chot.status).toBe("da_ap_client");
    expect(store.get(kq.actionId)?.status).toBe("da_ap_client");
    expect(logCrudOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "ai_client_applied" }),
    );
  });

  it("★★★ thanhCong:false ⇒ 'ap_client_that_bai'", async () => {
    const kq = await batDauApDungOClient(dauVaoBatDau(), NGUOI_A);
    const chot = await chotApDungOClient(
      { actionId: kq.actionId, token: kq.token, thanhCong: false, loi: "EACCES" },
      NGUOI_A,
    );
    expect(chot.ok).toBe(true);
    expect(chot.status).toBe("ap_client_that_bai");
    expect(store.get(kq.actionId)?.status).toBe("ap_client_that_bai");
    expect(logCrudOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "ai_client_apply_failed" }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — token SAI ⇒ từ chối, trạng thái KHÔNG đổi", () => {
  it("★★★", async () => {
    const kq = await batDauApDungOClient(dauVaoBatDau(), NGUOI_A);
    const chot = await chotApDungOClient(
      { actionId: kq.actionId, token: "token-gia-mao-khong-khop", thanhCong: true },
      NGUOI_A,
    );
    expect(chot.ok).toBe(false);
    expect(chot.status).toBe("invalid");
    expect(store.get(kq.actionId)?.status, "token sai không được đổi trạng thái hàng").toBe("dang_ap_client");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — người dùng KHÁC gọi chốt ⇒ từ chối", () => {
  it("★★★", async () => {
    const kq = await batDauApDungOClient(dauVaoBatDau(), NGUOI_A);
    const chot = await chotApDungOClient({ actionId: kq.actionId, token: kq.token, thanhCong: true }, NGUOI_B);
    expect(chot.ok).toBe(false);
    expect(chot.status).toBe("invalid");
    expect(store.get(kq.actionId)?.status, "người dùng khác không được đổi trạng thái hàng").toBe(
      "dang_ap_client",
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — chốt HAI LẦN ⇒ idempotent", () => {
  it("★★★ lần hai KHÔNG ném, KHÔNG đổi trạng thái — kể cả khi lần hai khai NGƯỢC LẠI lần đầu", async () => {
    const kq = await batDauApDungOClient(dauVaoBatDau(), NGUOI_A);

    const lan1 = await chotApDungOClient(
      { actionId: kq.actionId, token: kq.token, thanhCong: true, sha256SauThat: "c".repeat(64) },
      NGUOI_A,
    );
    expect(lan1.status).toBe("da_ap_client");

    // Lần hai khai NGƯỢC LẠI (thanhCong:false) — một client lỗi/độc hại gọi lại với câu trả lời
    // trái ngược không được phép lật kết cục đã chốt.
    const lan2 = await chotApDungOClient(
      { actionId: kq.actionId, token: kq.token, thanhCong: false, loi: "gia-mao-lan-hai" },
      NGUOI_A,
    );
    expect(lan2.ok, "chốt lần hai trên hàng đã chốt phải trả cache (ok:true), không ném").toBe(true);
    expect(lan2.status, "lần hai không được LẬT kết cục lần đầu").toBe("da_ap_client");
    expect(store.get(kq.actionId)?.status).toBe("da_ap_client");

    // Audit AI_CLIENT_APPLIED chỉ được ghi ĐÚNG MỘT lần (lượt chốt thật) — lần cache-return không
    // ghi audit mới, nếu không sổ kiểm toán sẽ có hai dòng cho một sự kiện.
    const soLanAudit = logCrudOperation.mock.calls.filter((c: any[]) => c[1]?.action === "ai_client_applied").length;
    expect(soLanAudit).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — argsJson KHÔNG chứa toàn văn nội dung tệp (bất biến chống rò, spec §6.5)", () => {
  it("★★ CHỈ chứa path + hai băm + tóm tắt + số dòng — không một khoá nội dung nào lọt vào", async () => {
    const kq = await batDauApDungOClient(dauVaoBatDau(), NGUOI_A);
    const hang = store.get(kq.actionId)!;

    expect(Object.keys(hang.argsJson).sort()).toEqual(
      ["path", "sha256Truoc", "sha256Sau", "tomTat", "soDongThem", "soDongBot"].sort(),
    );
    // Khẳng định tường minh — không chỉ "đúng danh sách khoá" mà còn "không có khoá nội dung nào",
    // để một đợt sau lỡ tay thêm `modified`/`original` vào input mà quên lọc ra sẽ bị lưới này bắt.
    for (const k of ["original", "modified", "content", "noiDungTruoc", "noiDungSau", "before", "after", "nhanWorkspace"]) {
      expect(hang.argsJson, `argsJson không được có khoá "${k}"`).not.toHaveProperty(k);
    }
    // `nhanWorkspace` đi vào `summary` (cột riêng, mục đích hiển thị) — không bị mất, chỉ không ở argsJson.
    expect(hang.summary).toContain("demo-workspace");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — chốt một hàng KHÔNG ở trạng thái 'dang_ap_client' ⇒ từ chối rành mạch", () => {
  it("★★ hàng đang 'proposed' (chưa từng qua batDauApDungOClient) ⇒ từ chối, trạng thái giữ nguyên", async () => {
    gieoHangTrangThaiLa("hang-la-1", "proposed");
    const chot = await chotApDungOClient({ actionId: "hang-la-1", token: "hang-la-1", thanhCong: true }, NGUOI_A);
    expect(chot.ok).toBe(false);
    expect(chot.status).toBe("invalid");
    expect(store.get("hang-la-1")?.status).toBe("proposed");
  });

  it("★★ hàng đang 'expired' ⇒ từ chối, trạng thái giữ nguyên", async () => {
    gieoHangTrangThaiLa("hang-la-2", "expired");
    const chot = await chotApDungOClient({ actionId: "hang-la-2", token: "hang-la-2", thanhCong: true }, NGUOI_A);
    expect(chot.ok).toBe(false);
    expect(chot.status).toBe("invalid");
    expect(store.get("hang-la-2")?.status).toBe("expired");
  });
});
