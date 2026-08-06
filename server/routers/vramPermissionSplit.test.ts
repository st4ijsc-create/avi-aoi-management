/**
 * ★★★ Pha 5 Task 3b — **BIT QUYỀN CỦA VRAM PHẢI LÀ BIT RIÊNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: MỘT BIT DÙNG CHUNG CHO 10 THỦ TỤC, 8 TRONG ĐÓ KHÔNG CÓ 2FA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đếm được ở Task 3b bước 1: `machine_control/canDelete` là sàn của **10 thủ tục / 8 router**, và
 * **8/10 là `protectedProcedure` TRẦN** — không role-floor, không 2FA. Nguy hiểm nhất đích danh:
 * `programming.deleteProject` (`programmingRouter.ts:261`) **xoá CASCADE cả cây mã nguồn có phiên
 * bản** (`programArtifacts`), không chốt an toàn, không OTP.
 * ⇒ Cấp bit ấy cho `supervisor` để mở **hai** nút VRAM (hai thủ tục **CHẶT NHẤT** trong tập:
 * `deployProcedure` = role-floor + 2FA + step-up OTP tươi) sẽ mở luôn **tám** thủ tục lỏng nhất.
 * Chủ dự án chốt: **TÁCH BIT RIÊNG** — module `vram_control`.
 *
 * ⚠⚠ **CỔNG RA THẬT SỰ CỦA TASK LÀ CA THỨ HAI**, không phải ca thứ nhất: *"`supervisor` **có** bit
 * VRAM ⇒ `programming.deleteProject` **VẪN BỊ TỪ CHỐI**"*. Thiếu nó thì "tách bit" mới chỉ là **đổi
 * tên một chuỗi**.
 *
 * ⚠⚠ LƯỚI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE: **không ca nào giả `requirePermission`/
 * `checkPermission`.** Cổng quyền THẬT chạy, đọc bảng `permissions` THẬT (qua một `getDb` giả trả
 * `FakeDb`), nên **tên module là thứ CHỊU TẢI** — đúng cái đang được kiểm. Tiền lệ ngược lại
 * (`edgeRuntimeDelete.test.ts:21` giả nguyên `../_core/accessControl`) **không chứng minh được gì
 * về tên module**, nên không dùng lại ở đây.
 *
 * ⚠ `LICENSE_MODULE_GATE_ENABLED=false`: `programmingRouter` đứng sau `moduleGate("MOD_ENGINEERING")`
 * (`programmingRouter.ts:26`) — **chạy TRƯỚC** `requirePermission`. Nếu cổng license từ chối trước
 * thì ca "bị từ chối" sẽ **XANH VÌ LÝ DO SAI**. Tắt nó ⇒ biến duy nhất còn lại là **cổng QUYỀN**;
 * và mọi ca từ chối vẫn khẳng định `appCode` + `action` tường minh nên một cổng khác chặn nhầm
 * **không** làm ca xanh được.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Middleware kiểm toán ghi DB fire-and-forget cho MỌI mutation — tắt trước khi `trpc.ts` nạp.
// `moduleGate`: xem khối docstring trên.
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

/** Người thi hành LÁ của hộ `vision-sidecar` — mắt xích DUY NHẤT chạm tiến trình thật. */
const sidecar = vi.hoisted(() => ({ stop: null as null | (() => Promise<boolean>) }));
vi.mock("../services/llamaVisionSidecar", () => ({
  stopSidecar: async () => (sidecar.stop === null ? false : sidecar.stop()),
  isVisionSidecarAvailable: () => false,
  getVisionSidecarConfig: () => null,
}));
vi.mock("../services/vram/vramGpuHolders", () => ({
  readProcTable: async () => null,
  readGpuHolders: async () => null,
  readComputeApps: async () => null,
}));
vi.mock("../services/vram/vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
  __vramDroppedEventCount: () => 0,
}));

import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { vramRouter } from "./vramRouter";
import { programmingRouter } from "./programmingRouter";
import { permissions, programProjects, programArtifacts } from "../../drizzle/schema";
import { readAppErrorMeta } from "../_core/appError";
import * as broker from "../services/vram/vramBroker";
import { __resetSharedLedgerForTests } from "../services/vram/vramSharedLedger";
import { __resetDecisionTickForTests } from "../services/vram/vramTickCell";
import { __resetVramDeferForTests } from "../services/vram/vramDefer";
import { VRAM_CONTROL_MODULE } from "@shared/permissions";

const MIB = 1024 * 1024;

/**
 * ⚠ MỘT người dùng DUY NHẤT cho cả hai chiều của cổng ra. Tách thành hai user thì ca "bị từ chối"
 * có thể từ chối vì một lý do khác (id khác ⇒ không có hàng quyền nào) mà vẫn xanh.
 */
const SUP_ID = 42;
const supervisor = { id: SUP_ID, role: "supervisor", name: "Sup", twoFactorEnabled: true };

type HanhQuyen = {
  module: string;
  canView?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

/** Vật chất hoá **đúng những hàng `permissions`** mà lượt cấp quyền thật sẽ INSERT — không hơn. */
function capQuyen(userId: number, rows: HanhQuyen[]) {
  fake.seed(
    permissions,
    rows.map((r, i) => ({
      id: 900 + i,
      userId,
      category: "machine_control",
      moduleName: r.module,
      canView: r.canView === true,
      canCreate: r.canCreate === true,
      canEdit: r.canEdit === true,
      canDelete: r.canDelete === true,
      canExport: false,
      expiresAt: null,
    })),
  );
}

const ctxCua = (user: unknown) =>
  ({ user, req: { ip: "127.0.0.1", headers: {} }, res: {}, sessionToken: "t" }) as never;
const vram = (user: unknown = supervisor) => vramRouter.createCaller(ctxCua(user));
const prog = (user: unknown = supervisor) => programmingRouter.createCaller(ctxCua(user));

/** Lỗi của một lượt gọi, hoặc `null` nếu nó **không** ném. */
async function loiCua(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

/** Một dự án chương trình máy CÓ THẬT trong kho — để đo "còn nguyên hay đã bốc hơi". */
function dungMotDuAn() {
  fake.seed(programProjects, [{ id: 7, name: "PLC line-1", deviceId: 1, defaultBranch: "main" }]);
  fake.seed(programArtifacts, [{ id: 70, projectId: 7, version: 3, branch: "main", source: "LD-source" }]);
}
/** Đếm qua **đúng bảng mã sản xuất ghi vào**, không qua một biến của ca. */
function demDuAn(): { duAn: number; macNguon: number } {
  const key = (t: unknown) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")];
  return {
    duAn: (fake.store.get(key(programProjects)) ?? []).length,
    macNguon: (fake.store.get(key(programArtifacts)) ?? []).length,
  };
}

/** Đi qua ĐÚNG đường thoát: một lượt `reserve()` thật ghi vào sổ cục bộ. */
function xinThat(owner: string, bytes: number) {
  const out = broker.reserve(
    { owner, kind: "external-process", estimatedBytes: bytes, priority: "interactive", reclaimer: "vision-sidecar" },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
  if (out.lease === null) throw new Error("ca này cần một giấy phép ĐƯỢC CẤP");
  broker.setLeaseRefCount(out.lease.id, 0);
  return out.lease;
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  sidecar.stop = null;
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A. CỔNG RA — MỘT `supervisor`, MỘT BỘ QUYỀN, HAI CHIỀU
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("Task 3b — bit VRAM riêng: mở ĐÚNG hai nút VRAM, KHÔNG mở gì khác", () => {
  it("★★★ CỔNG RA: supervisor CHỈ có bit VRAM ⇒ `preempt` thu hồi THẬT; CÙNG người đó ⇒ `programming.deleteProject` TỪ CHỐI và cây mã nguồn CÒN NGUYÊN", async () => {
    // Đúng bộ hàng quyền mà lượt cấp quyền thật sẽ INSERT — KHÔNG có `machine_control` nào.
    capQuyen(SUP_ID, [{ module: VRAM_CONTROL_MODULE, canDelete: true, canCreate: true }]);
    dungMotDuAn();

    // ── CHIỀU CHO PHÉP (đối chứng DƯƠNG CÓ RĂNG: byte phải rời SỔ thật) ─────────────────────
    const lease = xinThat("sidecar:vision", 7_825 * MIB);
    sidecar.stop = async () => {
      broker.release(lease); // đúng việc `proc.on("exit")` làm ở sản xuất
      return true;
    };
    const r = await vram().preempt({ owner: "sidecar:vision" });
    expect(r.outcome, "supervisor có bit VRAM ⇒ lệnh phải QUA cổng quyền và CHẠY").toBe("reclaimed");
    expect(r.freedBytes).toBe(7_825 * MIB);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(false);

    // ── CHIỀU TỪ CHỐI — ĐÂY LÀ CỔNG RA THẬT SỰ ─────────────────────────────────────────────
    const truoc = demDuAn();
    const err = await loiCua(prog().deleteProject({ id: 7 }));
    expect(err, "bit VRAM TUYỆT ĐỐI không được với tới đường xoá mã nguồn").not.toBeNull();
    expect(readAppErrorMeta(err)).toMatchObject({
      appCode: "PERMISSION_DENIED",
      appParams: { action: "canDelete" },
    });
    // ⚠ Câu từ chối chưa đủ: phải chứng minh **không một hàng nào biến mất**.
    expect(demDuAn()).toEqual(truoc);
    expect(demDuAn().macNguon, "mã nguồn có phiên bản phải còn nguyên").toBe(1);
  });

  it("★★★ ĐỐI CHỨNG: CÙNG supervisor, đổi sang bit CŨ `machine_control/canDelete` ⇒ `deleteProject` XOÁ THẬT (⇒ từ chối ở ca trên đến từ ĐÚNG cổng quyền, không phải một cổng khác)", async () => {
    capQuyen(SUP_ID, [{ module: "machine_control", canDelete: true }]);
    dungMotDuAn();

    const out = await prog().deleteProject({ id: 7 });
    expect(out).toMatchObject({ ok: true, id: 7, retainedDeployAudit: true });
    expect(demDuAn()).toEqual({ duAn: 0, macNguon: 0 });
  });

  it("★★★ ĐỘT BIẾN SỐNG: supervisor có ĐỦ bit CŨ (`machine_control` canDelete+canCreate) nhưng KHÔNG có bit VRAM ⇒ cả ba lệnh VRAM TỪ CHỐI", async () => {
    capQuyen(SUP_ID, [{ module: "machine_control", canView: true, canCreate: true, canEdit: true, canDelete: true }]);
    xinThat("sidecar:vision", 7_825 * MIB);
    const truoc = broker.snapshot().totalReservedBytes;

    const e1 = await loiCua(vram().preempt({ owner: "sidecar:vision" }));
    expect(readAppErrorMeta(e1)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canDelete" } });
    const e2 = await loiCua(vram().releaseStale({ leaseKey: "worker:999:1#lease-7" }));
    expect(readAppErrorMeta(e2)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canDelete" } });
    const e3 = await loiCua(vram().retryDeferred({ owner: "cron:kb-sync" }));
    expect(readAppErrorMeta(e3)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canCreate" } });

    expect(broker.snapshot().totalReservedBytes, "không một byte nào được đụng tới").toBe(truoc);
  });

  it("supervisor KHÔNG một hàng quyền nào ⇒ TỪ CHỐI (cổng vẫn sống, không phải fail-open)", async () => {
    capQuyen(SUP_ID, []);
    const e = await loiCua(vram().preempt({ owner: "sidecar:vision" }));
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canDelete" } });
  });

  /**
   * ★★★ **TASK 3B THU HẸP — TUYỆT ĐỐI KHÔNG NỚI.** Đổi vế THẨM QUYỀN mà vô tình hạ vế DANH TÍNH thì
   * bit riêng chỉ là một lượt đánh đổi tồi: `supervisor` với bit VRAM sẽ giết được tiến trình
   * **không cần OTP tươi**. Trước Task 3b **không lưới nào ở máy chủ** canh mặt này (`git grep
   * ACTUATION_STEPUP_2FA` trên mọi file test dưới `server/` ⇒ **0 kết quả**) ⇒ đột biến *"gỡ
   * step-up"* sẽ xanh. Ca này đóng đúng chỗ đó: hạ `deployProcedure` → `actuationProcedure` ⇒ **ĐỎ**.
   *
   * ⚠ Cờ bật ⇒ `requireFreshTotp` đòi OTP 6 số **đọc từ raw input**, trước cả zod. Không OTP ⇒
   * `INVALID_VALUE{field:"twoFactorCode"}` — không chạm DB, tất định.
   */
  it("★★★ step-up 2FA CÒN NGUYÊN: supervisor CÓ bit VRAM nhưng KHÔNG có OTP tươi ⇒ hai lệnh phá huỷ vẫn bị chặn", async () => {
    capQuyen(SUP_ID, [{ module: VRAM_CONTROL_MODULE, canDelete: true, canCreate: true }]);
    const truoc = process.env.ACTUATION_STEPUP_2FA;
    process.env.ACTUATION_STEPUP_2FA = "true";
    try {
      const e1 = await loiCua(vram().preempt({ owner: "sidecar:vision" }));
      expect(readAppErrorMeta(e1)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
      const e2 = await loiCua(vram().releaseStale({ leaseKey: "worker:999:1#lease-7" }));
      expect(readAppErrorMeta(e2)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });

      // ⚠ ĐỐI CHỨNG CHIỀU NGƯỢC: `retryDeferred` KHÔNG phá huỷ ⇒ đứng ở `actuationProcedure`,
      // **không** đòi OTP tươi. Thiếu ô này thì "chặn hết" cũng là xanh.
      const rd = await vram().retryDeferred({ owner: "khong-phai-mot-ho-nao" });
      expect(rd.outcome).toBe("refused");
    } finally {
      if (truoc === undefined) delete process.env.ACTUATION_STEPUP_2FA;
      else process.env.ACTUATION_STEPUP_2FA = truoc;
    }
  });

  it("`releaseStale` + `retryDeferred` với bit VRAM ⇒ QUA cổng quyền (trả DỮ LIỆU có `reason`, KHÔNG ném)", async () => {
    capQuyen(SUP_ID, [{ module: VRAM_CONTROL_MODULE, canDelete: true, canCreate: true }]);

    const rs = await vram().releaseStale({ leaseKey: "worker:999:1#lease-7" });
    expect(rs.outcome).toBe("refused");
    expect(rs.reason, "từ chối NGHIỆP VỤ phải có lý do đọc được — đó là bằng chứng đã vào thân thủ tục").not.toBeNull();

    const rd = await vram().retryDeferred({ owner: "khong-phai-mot-ho-nao" });
    expect(rd.outcome).toBe("refused");
    expect(rd.reason).toBe("unknown-background-host");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// B. BẤT BIẾN CẤU TRÚC — "BIT RIÊNG" PHẢI LÀ MỘT SỰ THẬT ĐẾM ĐƯỢC, KHÔNG PHẢI MỘT LỜI HỨA
//
// ⚠⚠ Phát biểu theo lượng từ ĐẢO: **"mọi lời gọi `requirePermission` trên toàn `server/` mang
// module VRAM đều phải nằm trong `vramRouter.ts`"** — đối tượng **tự khai**, không có danh sách
// trắng nào để một phần tử thứ N+1 lọt qua. Dựng một điểm gọi MỚI trong một FILE MỚI ⇒ ĐỎ.
// ⚠ Đối số không phân giải được ⇒ **ĐỎ**, không phải "bỏ qua im lặng": một cổng bỏ qua thứ nó
// không hiểu là một cổng khai xanh vì lý do sai.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const GOC = join(TEST_DIR, "..", ".."); // gốc repo
const SERVER = join(GOC, "server");

function motFile(goc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(goc)) {
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) {
      if (ten === "node_modules") continue;
      motFile(p, ra);
    } else if (ten.endsWith(".ts") && !ten.endsWith(".test.ts") && !ten.endsWith(".d.ts")) {
      ra.push(p);
    }
  }
  return ra;
}

/** `action === null` = đối số action là một BIẾN (`hierarchyRouters.ts:73`) — module vẫn phân giải được. */
type DiemGoi = { file: string; module: string; action: string | null };

/** Bóc `x as const` / `x satisfies T` để tới được chuỗi thật bên dưới. */
function boVo(n: ts.Expression): ts.Expression {
  let cur = n;
  while (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

/** Mọi hằng CHUỖI khai ở tầng module của một file (`const X = "…"`, kể cả có `export`). */
function hangChuoiCuaFile(sf: ts.SourceFile): Map<string, string> {
  const ra = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const v = boVo(d.initializer);
      if (ts.isStringLiteral(v)) ra.set(d.name.text, v.text);
    }
  }
  return ra;
}

const boNhoHang = new Map<string, Map<string, string>>();
function hangChuoiCuaDuong(duong: string): Map<string, string> {
  const cache = boNhoHang.get(duong);
  if (cache) return cache;
  let ra = new Map<string, string>();
  try {
    ra = hangChuoiCuaFile(ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true));
  } catch {
    /* file không tồn tại / không đọc được ⇒ map rỗng ⇒ điểm gọi rơi vào "không phân giải được" (ĐỎ) */
  }
  boNhoHang.set(duong, ra);
  return ra;
}

/** Mọi lời gọi `requirePermission(...)` trên `server/**`, kèm đối số đã PHÂN GIẢI. */
function quetDiemGoi(): { diem: DiemGoi[]; khongPhanGiaiDuoc: string[] } {
  const diem: DiemGoi[] = [];
  const khongPhanGiaiDuoc: string[] = [];

  for (const duong of motFile(SERVER)) {
    const ma = readFileSync(duong, "utf8");
    if (!ma.includes("requirePermission(")) continue;
    const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
    const ten = relative(GOC, duong).split(sep).join("/");

    // Hằng chuỗi khai ở tầng module (`const MODULE = "mes_bom"`).
    const hang = hangChuoiCuaFile(sf);

    // ⚠⚠ …VÀ hằng chuỗi **NHẬP TỪ FILE KHÁC** (`import { VRAM_CONTROL_MODULE } from "@shared/…"`).
    // Không có nhánh này thì mọi điểm gọi dùng hằng dùng-chung sẽ "không phân giải được" ⇒ lưới
    // buộc người ta viết chuỗi trực tiếp, tức **đẻ bản sao thứ hai** của một tên đã có chủ. Phân
    // giải TỔNG QUÁT (đi theo đường dẫn), **không** liệt kê tên hằng nào cả.
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const spec = stmt.moduleSpecifier.text;
      const goc = spec.startsWith("@shared/")
        ? join(GOC, "shared", `${spec.slice("@shared/".length)}.ts`)
        : spec.startsWith(".")
          ? join(duong, "..", `${spec}.ts`)
          : null;
      if (goc === null) continue;
      const b = stmt.importClause?.namedBindings;
      if (b === undefined || !ts.isNamedImports(b)) continue;
      const cuaHo = hangChuoiCuaDuong(goc);
      for (const el of b.elements) {
        const tenGoc = (el.propertyName ?? el.name).text;
        const v = cuaHo.get(tenGoc);
        if (v !== undefined) hang.set(el.name.text, v);
      }
    }

    const doiSo = (n: ts.Node): string | null => {
      const v = ts.isExpression(n) ? boVo(n) : n;
      if (ts.isStringLiteral(v)) return v.text;
      if (ts.isIdentifier(v)) return hang.get(v.text) ?? null;
      return null;
    };

    const di = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "requirePermission"
      ) {
        const m = n.arguments[0] === undefined ? null : doiSo(n.arguments[0]);
        const a = n.arguments[1] === undefined ? null : doiSo(n.arguments[1]);
        const dong = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        // ⚠ **MODULE** là thứ chịu tải của bất biến "bit riêng" ⇒ không phân giải được **module**
        // là ĐỎ. `action` động thì vẫn ghi nhận (kèm `null`) và bị khoá bằng một ca riêng dưới —
        // vứt cả điểm gọi đi chỉ vì action động là tự đục một lỗ vào chính cái lưới này.
        if (m === null) khongPhanGiaiDuoc.push(`${ten}:${dong}`);
        else diem.push({ file: ten, module: m, action: a });
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return { diem, khongPhanGiaiDuoc };
}

describe("Task 3b — bit VRAM là bit RIÊNG (bất biến cấu trúc trên toàn `server/**`)", () => {
  const { diem, khongPhanGiaiDuoc } = quetDiemGoi();

  it("mọi `moduleName` của `requirePermission` phân giải được (không điểm gọi nào bị bỏ qua im lặng)", () => {
    // ⚠ So bằng CHUỖI GHÉP, không bằng mảng: khi đỏ, câu lỗi phải **gọi tên file:dòng** để người
    // đọc biết đi đâu — một `[Array(1)]` bị cắt ngắn là một cổng chỉ đường tới hư không.
    expect(khongPhanGiaiDuoc.join(" · ")).toBe("");
    expect(diem.length, "phải quét ra hàng trăm điểm gọi — 0 nghĩa là lưới không chạm mã nào").toBeGreaterThan(200);
  });

  it("không module nào ở đây được cấp bằng một `action` ĐỘNG (một action động che được cả `canDelete`)", () => {
    const dong = diem
      .filter((d) => d.action === null)
      .filter((d) => d.module === "machine_control" || d.module === VRAM_CONTROL_MODULE);
    expect(dong.map((d) => `${d.file}:${d.module}`).join(" · ")).toBe("");
  });

  it("★★★ module VRAM CHỈ xuất hiện ở `vramRouter.ts` — không một router nào khác đứng trên nó", () => {
    const noiXuatHien = [...new Set(diem.filter((d) => d.module === VRAM_CONTROL_MODULE).map((d) => d.file))].sort();
    expect(noiXuatHien).toEqual(["server/routers/vramRouter.ts"]);
  });

  it("★★★ `vramRouter.ts` KHAI ĐỦ và KHAI ĐÚNG ba cổng của nó — không còn bám `machine_control/canDelete`", () => {
    const cua = diem
      .filter((d) => d.file === "server/routers/vramRouter.ts")
      .map((d) => `${d.module}/${d.action}`)
      .sort();
    expect(cua).toEqual(
      [`${VRAM_CONTROL_MODULE}/canCreate`, `${VRAM_CONTROL_MODULE}/canDelete`, "machine_control/canView"].sort(),
    );
  });

  it("bit CŨ vẫn nguyên vẹn cho 8 thủ tục kia — task này THU HẸP VRAM, không đụng phần còn lại", () => {
    const cu = diem.filter((d) => d.module === "machine_control" && d.action === "canDelete");
    expect(cu.map((d) => d.file).sort()).toEqual(
      [
        "server/routers/deviceAdapterRouter.ts",
        "server/routers/deviceAdapterRouter.ts",
        "server/routers/edgeRuntimeRouter.ts",
        "server/routers/hotFolderRouter.ts",
        "server/routers/orchestrationRouter.ts",
        "server/routers/programmingRouter.ts",
        "server/routers/programmingRouter.ts",
        "server/routers/unsMappingRouter.ts",
      ].sort(),
    );
  });
});
