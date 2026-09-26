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

/**
 * Payload **thiếu `totpCode`** — hình dạng của một người gọi **TỪ DÂY** (HTTP/JSON), thứ `tsc`
 * không ràng buộc được. ⚠ I-4 (review Task 1b) làm `totpCode` **bắt buộc** ở **hợp đồng** zod, và
 * đó là chỗ `tsc` bắt được lượt gỡ mã khỏi một điểm gọi client. Nhưng cổng an ninh thật phải đứng
 * vững trước một payload **thô** — nên các ca dưới đây cố ý đi vòng qua kiểu, thay vì nới zod lại.
 */
function tuDay<T>(v: T): T & { totpCode: string } {
  return v as T & { totpCode: string };
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
    // ⚠ I-4: `totpCode` BẮT BUỘC ở zod; cờ step-up TẮT ở ca này ⇒ mã không được verify, nó chỉ
    //   thoả hợp đồng. Bất biến của ca này là **cổng QUYỀN**, không phải cổng OTP.
    const r = await vram().preempt({ owner: "sidecar:vision", totpCode: "000000" });
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

    const e1 = await loiCua(vram().preempt(tuDay({ owner: "sidecar:vision" })));
    expect(readAppErrorMeta(e1)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canDelete" } });
    const e2 = await loiCua(vram().releaseStale(tuDay({ leaseKey: "worker:999:1#lease-7" })));
    expect(readAppErrorMeta(e2)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canDelete" } });
    const e3 = await loiCua(vram().retryDeferred({ owner: "cron:kb-sync" }));
    expect(readAppErrorMeta(e3)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canCreate" } });

    expect(broker.snapshot().totalReservedBytes, "không một byte nào được đụng tới").toBe(truoc);
  });

  it("supervisor KHÔNG một hàng quyền nào ⇒ TỪ CHỐI (cổng vẫn sống, không phải fail-open)", async () => {
    capQuyen(SUP_ID, []);
    const e = await loiCua(vram().preempt(tuDay({ owner: "sidecar:vision" })));
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
      const e1 = await loiCua(vram().preempt(tuDay({ owner: "sidecar:vision" })));
      expect(readAppErrorMeta(e1)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
      const e2 = await loiCua(vram().releaseStale(tuDay({ leaseKey: "worker:999:1#lease-7" })));
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

    // ⚠ I-4: xem ghi chú `totpCode` ở ca cổng-ra bên trên.
    const rs = await vram().releaseStale({ leaseKey: "worker:999:1#lease-7", totpCode: "000000" });
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

/**
 * Hằng chuỗi của một file **cộng** hằng chuỗi **NHẬP TỪ FILE KHÁC**
 * (`import { VRAM_CONTROL_MODULE } from "@shared/permissions"`).
 *
 * ⚠⚠ Không có nhánh nhập thì mọi điểm gọi dùng hằng dùng-chung sẽ "không phân giải được" ⇒ lưới
 * buộc người ta viết chuỗi trực tiếp, tức **đẻ bản sao thứ hai** của một tên đã có chủ. Phân giải
 * **TỔNG QUÁT** (đi theo đường dẫn), **không** liệt kê tên hằng nào cả.
 */
function hangKemNhap(sf: ts.SourceFile, duong: string): Map<string, string> {
  const hang = hangChuoiCuaFile(sf);
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
      const v = cuaHo.get((el.propertyName ?? el.name).text);
      if (v !== undefined) hang.set(el.name.text, v);
    }
  }
  return hang;
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

    const hang = hangKemNhap(sf, duong);

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

  /**
   * ⚠⚠ C-1 (review TOÀN NHÁNH) — **TÊN CŨ CỦA CA NÀY TỰ XƯNG "KHAI ĐÚNG" TRONG KHI NÓ CHỈ KIỂM
   * "KHAI ĐỦ".** Nó phát biểu trên một **TẬP** chuỗi `module/action`, nên một lượt **hoán vị**
   * `canDelete` ↔ `canCreate` giữa hai thủ tục giữ nguyên tập ⇒ **XANH**. Ca vẫn giữ lại (nó khoá
   * đúng thứ nó khoá: không còn bám `machine_control/canDelete`), nhưng trục **ánh xạ** nay có chủ
   * ở **khối D** — đừng đọc ca này như một lời hứa về cặp (thủ tục → cổng).
   */
  it("★★★ `vramRouter.ts` KHAI ĐỦ ba cổng của nó — không còn bám `machine_control/canDelete` (TẬP; ánh xạ xem khối D)", () => {
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// C. TRỤC CƯỠNG CHẾ THỨ HAI — NEO VÀO **HÀM LỆNH**, KHÔNG VÀO **MIDDLEWARE**
//
// ⚠⚠⚠ I-3 (review Task 3b) — HAI BẤT BIẾN Ở KHỐI B **CÙNG MÙ** TRƯỚC MỘT ĐỘT BIẾN ĐO ĐƯỢC.
// Reviewer dựng **M-R2**: một **write-tool của Agent** trong `services/aiLocalTools/vramTools.ts`,
// đứng trên bit **CŨ** `machine_control/canDelete` (qua `checkPermission` gọi tay, **không** qua
// `requirePermission`), gọi **thẳng** `vramPreemptCommand(owner)`. Kết quả đo:
// **95 file / 1517 ca XANH y hệt baseline — 0 đỏ.** Cả cổng AST lẫn cổng runtime cùng không thấy.
// Lý do: cả hai bất biến của khối B phát biểu trên **tập lời gọi `requirePermission(`**; một cổng
// quyền đi bằng trục khác nằm **NGOÀI LƯỢNG TỪ**. Và đây không phải giả thuyết — `vramTools.ts`
// **đã là** một bề mặt quyền thật, Task 4 sẽ mở lại đúng file đó, còn thứ duy nhất ngăn ba lệnh
// thành write-tool hôm nay là **một đoạn văn xuôi trong docstring**.
//
// ⇒ Đảo lượng từ **một nấc nữa**: không hỏi *"ai gọi `requirePermission`"* mà hỏi
//   ***"MỌI đường chạm tới ba HÀM LỆNH có đứng sau bit `vram_control` không"***.
//   Ba hàm ấy là **cửa hẹp**: chúng là chỗ duy nhất trong hệ dựng ra ba lệnh VRAM cho một bề mặt
//   bên ngoài ⇒ canh cửa hẹp thì mọi bề mặt tương lai — tool Agent, REST, cron, WebSocket — đều
//   **tự khai**, không cần lưới biết trước hình dạng của chúng.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Ba **hàm lệnh**. Chạm được một trong ba là chạm được đường phá huỷ VRAM. */
const HAM_LENH = ["vramPreemptCommand", "vramReleaseStaleCommand", "vramRetryDeferredCommand"] as const;

/** File **định nghĩa** ba hàm ấy — nơi duy nhất được nhắc tên chúng ngoài cổng đã rào. */
const NHA_CUA_LENH = "server/services/vram/vramCommands.ts";
/** Cổng đã rào: router VRAM. Mọi tham chiếu ở đây phải nằm trong một thủ tục có bit `vram_control`. */
const CONG_DA_RAO = "server/routers/vramRouter.ts";

type ViPhamLenh = { noi: string; vi: string };

/** Gốc TRÁI NHẤT của một chuỗi `a.b(...).c(...)` — tức cái thủ tục được dựng lên từ đó. */
function gocChuoi(n: ts.Node): string | null {
  let cur: ts.Node = n;
  for (;;) {
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    else if (ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isSatisfiesExpression(cur))
      cur = cur.expression;
    else return null;
  }
}

/**
 * Với MỘT file: mọi tham chiếu tới một hàm lệnh có đứng sau bit `vram_control` không.
 *
 * Tách khỏi đĩa (nhận `ten` + `ma`) để bộ ca **tự dựng được nguồn tổng hợp** — nếu không thì ca
 * *"lưới có bắt không"* và ca *"lưới có bắt NHẦM không"* đều phải sửa file thật, tức không chạy
 * được trong một lượt `vitest`.
 */
function soiDuongToiLenh(ten: string, ma: string): ViPhamLenh[] {
  const viPham: ViPhamLenh[] = [];
  if (ten === NHA_CUA_LENH) return viPham; // chính nó khai ra ba hàm
  if (!HAM_LENH.some((h) => ma.includes(h))) return viPham;

  const sf = ts.createSourceFile(ten, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hang = hangKemNhap(sf, join(GOC, ten));

  /** `const X = <chuỗi>.use(requirePermission(M, A))` ⇒ X ↦ "M/A". */
  const congCua = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      let cua: string | null = null;
      const tim = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "requirePermission") {
          const g = (x: ts.Node | undefined): string | null =>
            x === undefined
              ? null
              : ts.isStringLiteral(x)
                ? x.text
                : ts.isIdentifier(x)
                  ? (hang.get(x.text) ?? null)
                  : null;
          cua = `${g(n.arguments[0])}/${g(n.arguments[1])}`;
        }
        ts.forEachChild(n, tim);
      };
      tim(d.initializer);
      if (cua !== null) congCua.set(d.name.text, cua);
    }
  }

  const di = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && (HAM_LENH as readonly string[]).includes(n.text)) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      const noi = `${ten}:${line + 1} (${n.text})`;
      // Nhập khẩu KHÔNG phải một đường chạy — nó chỉ mang cái tên vào file. Đường chạy là chỗ DÙNG.
      const nhap = n.parent !== undefined && (ts.isImportSpecifier(n.parent) || ts.isImportClause(n.parent));
      if (!nhap) {
        if (ten !== CONG_DA_RAO) {
          viPham.push({ noi, vi: `đường tới hàm lệnh VRAM nằm NGOÀI cổng đã rào (${CONG_DA_RAO})` });
        } else {
          // Trong router: leo lên tới ô `<tên>: <chuỗi thủ tục>` rồi hỏi gốc chuỗi đứng trên bit nào.
          let p: ts.Node | undefined = n.parent;
          while (p !== undefined && !ts.isPropertyAssignment(p)) p = p.parent;
          const goc = p === undefined ? null : gocChuoi(p.initializer);
          const cua = goc === null ? null : (congCua.get(goc) ?? null);
          if (cua === null) {
            viPham.push({ noi, vi: `không leo được tới một thủ tục có requirePermission (gốc: ${goc ?? "?"})` });
          } else if (!cua.startsWith(`${VRAM_CONTROL_MODULE}/`)) {
            viPham.push({ noi, vi: `đứng trên ${cua} — PHẢI là ${VRAM_CONTROL_MODULE}/…` });
          }
        }
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return viPham;
}

describe("Task 3b (I-3) — MỌI đường tới ba HÀM LỆNH đều đứng sau bit `vram_control`", () => {
  it("★★★ trên toàn `server/**`: 0 vi phạm — và lưới phải THẤY ba hàm ấy (cầu chì chống lưới mù)", () => {
    const viPham: ViPhamLenh[] = [];
    let soFileChamLenh = 0;
    for (const duong of motFile(SERVER)) {
      const ten = relative(GOC, duong).split(sep).join("/");
      const ma = readFileSync(duong, "utf8");
      if (HAM_LENH.some((h) => ma.includes(h))) soFileChamLenh++;
      viPham.push(...soiDuongToiLenh(ten, ma));
    }
    expect(viPham.map((v) => `${v.noi}: ${v.vi}`).join("\n")).toBe("");
    // ⚠ Cầu chì: nếu bộ quét đọc 0 file có nhắc tên hàm lệnh thì "0 vi phạm" là vô nghĩa.
    expect(soFileChamLenh, "lưới không chạm file nào nhắc tới hàm lệnh — bộ quét đã hỏng?").toBeGreaterThanOrEqual(2);
  });

  it("★★★ M-R2 — write-tool Agent đứng trên bit CŨ, gọi THẲNG `vramPreemptCommand` ⇒ ĐỎ, kèm CON TRỎ đích danh", () => {
    const ma = [
      'import { checkPermission } from "../../_core/accessControl";',
      'import { vramPreemptCommand } from "../vram/vramCommands";',
      "export const reclaimVram = {",
      '  name: "reclaim_vram", kind: "write",',
      '  requiredPermission: { module: "machine_control", action: "canDelete" },',
      "  handler: async (p: { owner: string; userId: number; role: string }) => {",
      '    const ok = await checkPermission(p.userId, p.role, "machine_control", "canDelete");',
      "    if (!ok) return null;",
      "    return vramPreemptCommand(p.owner);",
      "  },",
      "};",
    ].join("\n");
    const v = soiDuongToiLenh("server/services/aiLocalTools/vramTools.ts", ma);
    expect(v.length, "M-R2 phải bị bắt").toBeGreaterThan(0);
    // ⚠ "Lưới DẪN người ta tới đâu?" — câu đỏ phải chỉ ĐÍCH DANH file:dòng và tên hàm lệnh.
    const cau = v.map((x) => `${x.noi}: ${x.vi}`).join("\n");
    expect(cau).toContain("server/services/aiLocalTools/vramTools.ts:9");
    expect(cau).toContain("vramPreemptCommand");
    expect(cau).toContain("NGOÀI cổng đã rào");
  });

  it("★★★ một đường thứ hai tới hàm lệnh ở MỘT FILE MỚI bất kỳ (cron · REST · cầu nối) ⇒ ĐỎ", () => {
    for (const ten of [
      "server/services/vram/vramCron.ts",
      "server/routes/vramRest.ts",
      "server/services/field/vramFieldBridge.ts",
    ]) {
      const v = soiDuongToiLenh(
        ten,
        'import { vramReleaseStaleCommand } from "x";\nexport const go = () => vramReleaseStaleCommand("k");',
      );
      expect(v.map((x) => x.noi).join(" · "), ten).toContain(`${ten}:2`);
    }
  });

  it("★★★ ĐỘT BIẾN TRONG chính cổng đã rào: thủ tục tụt về bit CŨ ⇒ ĐỎ (canh CỔNG, không chỉ canh FILE)", () => {
    const ma = [
      'import { requirePermission } from "../_core/accessControl";',
      'import { vramPreemptCommand } from "../services/vram/vramCommands";',
      'const congCu = deployProcedure.use(requirePermission("machine_control", "canDelete"));',
      "export const r = router({",
      "  preempt: congCu.input(z.object({})).mutation(async ({ input }) => vramPreemptCommand(input.owner)),",
      "});",
    ].join("\n");
    const v = soiDuongToiLenh(CONG_DA_RAO, ma);
    expect(v.map((x) => x.vi).join(" · ")).toContain("machine_control/canDelete");
  });

  it("★★ KHÔNG BẮT NHẦM — file không nhắc hàm lệnh · chỉ nhắc trong CHÚ THÍCH · tên GẦN GIỐNG", () => {
    expect(soiDuongToiLenh("server/services/x.ts", "export const a = 1;")).toEqual([]);
    // Chú thích không phải node AST ⇒ không phải một đường chạy.
    expect(
      soiDuongToiLenh(
        "server/services/vram/vramReadModel.ts",
        "// `vramCommands.vramRetryDeferredCommand()` gọi ĐÚNG hàm này.\nexport const a = 1;",
      ),
    ).toEqual([]);
    // Định danh KHÁC, chỉ trùng tiền tố ⇒ không phải hàm lệnh.
    expect(
      soiDuongToiLenh(
        "server/services/y.ts",
        "type VramPreemptCommandResult = { a: 1 };\nexport const b: VramPreemptCommandResult = { a: 1 };",
      ),
    ).toEqual([]);
  });

  it("★★ KHÔNG BẮT NHẦM — nhập khẩu trong chính cổng đã rào không bị tính là đường chạy", () => {
    const ma = ['import { vramPreemptCommand } from "../services/vram/vramCommands";', "export const a = 1;"].join("\n");
    expect(soiDuongToiLenh(CONG_DA_RAO, ma)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// D. ★★★ C-1 (review TOÀN NHÁNH 2026-08-06) — CANH **ÁNH XẠ**, KHÔNG CANH **TẬP**.
//
// ⚠⚠⚠ VÌ SAO KHỐI NÀY TỒN TẠI: MỘT LƯỢT **HOÁN VỊ** HAI BIT LÀ MỘT BẢN VÁ **SHIP ĐƯỢC**.
// Reviewer dựng đột biến **W1**: đổi `canDelete` ↔ `canCreate` **giữa hai thủ tục**
// (`vramDestructiveProcedure` ↔ `vramActuationProcedure`). Đo được:
//   • cổng của kế hoạch (9 đường)         ⇒ **99 file / 1675 ca XANH TOÀN BỘ**
//   • ca AST "KHAI ĐỦ và KHAI ĐÚNG…" (:436) ⇒ **XANH**
//   • gương client `vramCommandReach.role.unit.test.ts` ("nguồn ĐỘC LẬP") ⇒ **XANH 100%**
// Chỉ **hai ca RUNTIME** trong chính file này đỏ — bắt **tình cờ**, không phải vì ai phát biểu
// bất biến ấy.
//
// Lý do cả hai cổng AST cùng mù: chúng rút ra một **TẬP chuỗi `module/action`** rồi so tập.
// Hoán vị **giữ nguyên tập** ⇒ hai vế bất biến không đổi. Đây đúng lớp lỗi *"luật 'tồn tại' ở chỗ
// cần 'với mọi'"*: luật đang nói *"∃ một điểm gọi mang cặp này"*, chỗ cần là
// ***"∀ thủ tục p: (sàn, cổng) của p = cặp kỳ vọng của p"***.
//
// ⚠ Hậu quả nếu lọt: `engineer` — vai chủ dự án duyệt cấp `vram_control/canCreate` — có **thẩm
// quyền máy chủ** chạy `vram.preempt` (giết tiến trình) và `vram.releaseStale` (xoá hàng khỏi sổ
// chung), trong khi gương client vẫn **xám hai nút** ⇒ **không dấu hiệu nào trên UI**.
//
// ⚠ Lượng từ ở đây neo vào **KHOÁ CỦA ROUTER** (`preempt`/`releaseStale`/`retryDeferred`/`state`),
// KHÔNG vào tên biến thủ tục: đổi tên biến là một lượt dọn dẹp hợp lệ, còn đổi **cái mà `preempt`
// đứng trên** là một quyết định an ninh. Neo vào tên biến sẽ bắt nhầm lượt đầu và bỏ lọt lượt sau.
// ⚠ Không phân giải được ⇒ **ĐỎ**, không "bỏ qua im lặng" — và lưới **KHÔNG ép người sau đặt tên**
// cho sàn: chain thẳng `preempt: deployProcedure.use(requirePermission(…))` vẫn phân giải được
// (có ca khoá điều đó, để lưới không "chỉ đường tới bản vá sai").
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Hình dạng của MỘT thủ tục: **sàn danh tính** (role-floor/2FA) + **cổng thẩm quyền** (RBAC). */
type HinhDangThuTuc = { san: string; cong: string };

/**
 * ★★★ Cặp kỳ vọng cho **từng khoá** của `vramRouter`. Đây là bảng phải đọc khi ai đó hỏi
 * *"lệnh này đứng trên bit nào"* — và nó là bảng mà `toEqual` cưỡng chế **cả hai chiều**:
 * thêm một thủ tục mà quên khai ⇒ ĐỎ; đổi cổng của một thủ tục ⇒ ĐỎ; hoán vị hai thủ tục ⇒ ĐỎ.
 */
const HINH_DANG_MONG_DOI: Readonly<Record<string, HinhDangThuTuc>> = {
  // Mặt ĐỌC — **cố ý** ở lại `machine_control/canView` để bằng mức tool `get_vram_state` (N8).
  state: { san: "protectedProcedure", cong: "machine_control/canView" },
  // Hai lệnh PHÁ HUỶ — sàn chặt nhất của hệ (`deployProcedure` = role-floor + 2FA + step-up OTP).
  preempt: { san: "deployProcedure", cong: `${VRAM_CONTROL_MODULE}/canDelete` },
  releaseStale: { san: "deployProcedure", cong: `${VRAM_CONTROL_MODULE}/canDelete` },
  // KHÔNG phá huỷ ⇒ actuation, bit `canCreate`. ⚠ Nâng nó lên `deployProcedure` là một hồi quy:
  // `input` của nó không khai `totpCode` và panel không bọc step-up ⇒ nút bấm mãi không chạy (I-3).
  retryDeferred: { san: "actuationProcedure", cong: `${VRAM_CONTROL_MODULE}/canCreate` },
};

/**
 * Đọc `vramRouter.ts` (hoặc một nguồn tổng hợp) ra **ánh xạ khoá-router → (sàn, cổng)**.
 *
 * Tách khỏi đĩa (nhận `ten` + `ma`) để bộ ca tự dựng được đột biến — nếu không thì mọi ca "lưới có
 * bắt không" đều phải sửa file thật, tức không chạy được trong một lượt `vitest`.
 */
function anhXaThuTuc(ten: string, ma: string): { anhXa: Record<string, HinhDangThuTuc>; mu: string[] } {
  const sf = ts.createSourceFile(ten, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hang = hangKemNhap(sf, join(GOC, ten));

  const val = (x: ts.Node | undefined): string | null => {
    if (x === undefined) return null;
    const v = ts.isExpression(x) ? boVo(x) : x;
    if (ts.isStringLiteral(v)) return v.text;
    if (ts.isIdentifier(v)) return hang.get(v.text) ?? null;
    return null;
  };

  /** MỌI `requirePermission(M, A)` nằm trong một biểu thức. Nhiều hơn một ⇒ mơ hồ ⇒ ĐỎ. */
  const congTrong = (n: ts.Node): string[] => {
    const ra: string[] = [];
    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "requirePermission") {
        ra.push(`${val(x.arguments[0]) ?? "?"}/${val(x.arguments[1]) ?? "?"}`);
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };

  /** Mọi khai báo ở tầng module: tên ⇒ (cổng khai TẠI CHỖ, gốc chuỗi mà nó dựng lên từ đó). */
  const bien = new Map<string, { cong: string[]; goc: string | null }>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      bien.set(d.name.text, { cong: congTrong(d.initializer), goc: gocChuoi(d.initializer) });
    }
  }

  /**
   * Leo ngược chuỗi biến: gom **mọi** cổng gặp trên đường, và dừng ở định danh **không phải** một
   * khai báo của file này — đó chính là **SÀN** (`deployProcedure` / `actuationProcedure` /
   * `protectedProcedure`, đều nhập từ `_core/trpc`).
   * ⚠ Một alias (`const A = B;`) **không** giấu được cổng của `B` — đó là hình dạng lách hiển nhiên
   * nhất của một lưới canh-ánh-xạ, và nó bị đóng ngay tại đây.
   */
  const phanGiai = (bd: string | null): { cong: string[]; san: string | null } => {
    const cong: string[] = [];
    let cur = bd;
    for (let i = 0; i < 16 && cur !== null; i++) {
      const b = bien.get(cur);
      if (b === undefined) return { cong, san: cur };
      cong.push(...b.cong);
      cur = b.goc;
    }
    return { cong, san: null }; // vòng lặp / không leo tới đâu ⇒ mù ⇒ ĐỎ
  };

  const anhXa: Record<string, HinhDangThuTuc> = {};
  const mu: string[] = [];
  const di = (n: ts.Node): void => {
    const arg0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "router" &&
      arg0 !== undefined &&
      ts.isObjectLiteralExpression(arg0)
    ) {
      for (const p of arg0.properties) {
        const dong = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) {
          mu.push(`${ten}:${dong} — ô của router KHÔNG phải \`tên: <chuỗi thủ tục>\``);
          continue;
        }
        const khoa = p.name.text;
        const tuGoc = phanGiai(gocChuoi(p.initializer));
        // ⚠ Cổng viết THẲNG trong chuỗi của ô (không qua biến) cũng phải được tính — nếu không,
        // lưới sẽ ép người sau đặt tên cho sàn, và một `preempt: deployProcedure.use(...)` inline
        // sẽ **im lặng lọt**.
        const tatCa = [...new Set([...congTrong(p.initializer), ...tuGoc.cong])].sort();
        if (tuGoc.san === null || tatCa.length !== 1 || tatCa[0]?.includes("?") === true) {
          mu.push(
            `${ten}:${dong} \`${khoa}\` — sàn: ${tuGoc.san ?? "KHÔNG phân giải được"} · cổng: [${tatCa.join(", ")}]`,
          );
          continue;
        }
        anhXa[khoa] = { san: tuGoc.san, cong: tatCa[0] as string };
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { anhXa, mu };
}

/** Nguồn tổng hợp tối thiểu, đúng hình dạng thật của `vramRouter.ts` — nền cho mọi đột biến dưới. */
function nguonRouter(than: string, dau = ""): string {
  return [
    'import { router, protectedProcedure, actuationProcedure, deployProcedure } from "../_core/trpc";',
    'import { requirePermission } from "../_core/accessControl";',
    'import { VRAM_CONTROL_MODULE } from "@shared/permissions";',
    'const vramDestructiveProcedure = deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"));',
    'const vramActuationProcedure = actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"));',
    'const vramReadProcedure = protectedProcedure.use(requirePermission("machine_control", "canView"));',
    dau,
    "export const vramRouter = router({",
    than,
    "});",
  ].join("\n");
}

const THAN_DUNG = [
  "  state: vramReadProcedure.query(async () => buildVramAgentState()),",
  "  preempt: vramDestructiveProcedure.input(z.object({})).mutation(async ({ input }) => f(input)),",
  "  releaseStale: vramDestructiveProcedure.input(z.object({})).mutation(async ({ input }) => f(input)),",
  "  retryDeferred: vramActuationProcedure.input(z.object({})).mutation(({ input }) => f(input)),",
].join("\n");

describe("★★★ C-1 — ÁNH XẠ `thủ tục → (sàn, cổng)` của `vramRouter` (canh CẶP, không canh TẬP)", () => {
  const DUONG = "server/routers/vramRouter.ts";

  it("★★★ mã SẢN XUẤT ở HEAD: từng khoá đứng ĐÚNG cặp của nó — và 0 ô mù", () => {
    const { anhXa, mu } = anhXaThuTuc(DUONG, readFileSync(join(GOC, DUONG), "utf8"));
    expect(mu.join("\n"), "một ô không phân giải được là một ô KHÔNG AI CANH").toBe("");
    expect(anhXa).toEqual(HINH_DANG_MONG_DOI);
  });

  it("★★★ W1 — **HOÁN VỊ** `canDelete` ↔ `canCreate` giữa hai thủ tục ⇒ ĐỎ (dù TẬP không đổi)", () => {
    const ma = nguonRouter(THAN_DUNG)
      .replace('deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"))', "@D@")
      .replace('actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"))', "@A@")
      .replace("@D@", 'deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"))')
      .replace("@A@", 'actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"))');
    const { anhXa, mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toBe("");

    // ⚠ ĐỐI CHỨNG — lưới đời trước (**TẬP** cổng) vẫn XANH dưới đúng đột biến này. Không có ô này
    // thì ca trên chỉ chứng minh "có một lưới đỏ", không chứng minh **lưới MỚI mới bắt được**.
    const tapCong = [...new Set(Object.values(anhXa).map((h) => h.cong))].sort();
    expect(tapCong, "TẬP cổng KHÔNG đổi — đó là toàn bộ lý do C-1 lọt").toEqual(
      [`${VRAM_CONTROL_MODULE}/canCreate`, `${VRAM_CONTROL_MODULE}/canDelete`, "machine_control/canView"].sort(),
    );

    expect(anhXa).not.toEqual(HINH_DANG_MONG_DOI);
    expect(anhXa.preempt?.cong, "hoán vị ⇒ lệnh PHÁ HUỶ tụt xuống bit RỘNG HƠN").toBe(
      `${VRAM_CONTROL_MODULE}/canCreate`,
    );
    expect(anhXa.retryDeferred?.cong).toBe(`${VRAM_CONTROL_MODULE}/canDelete`);
  });

  it("★★★ W3 — nâng `retryDeferred` lên `deployProcedure` ⇒ ĐỎ ở trục SÀN (cổng không đổi)", () => {
    const ma = nguonRouter(THAN_DUNG).replace(
      'const vramActuationProcedure = actuationProcedure.use(',
      'const vramActuationProcedure = deployProcedure.use(',
    );
    const { anhXa, mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toBe("");
    expect(anhXa.retryDeferred).toEqual({ san: "deployProcedure", cong: `${VRAM_CONTROL_MODULE}/canCreate` });
    expect(anhXa).not.toEqual(HINH_DANG_MONG_DOI);
  });

  it("★★★ HÌNH DẠNG CỦA TÔI — **ALIAS** một thủ tục sang thủ tục kia (tên biến giữ nguyên, TẬP giữ nguyên) ⇒ ĐỎ", () => {
    /**
     * ⚠ Đây là C-1 dưới một hình dạng KHÁC HẲN W1: không đụng một chuỗi `canDelete`/`canCreate` nào,
     * không đụng thứ tự đối số. Chỉ thêm **một dòng gán**:
     *     const congPhaHuy = vramActuationProcedure;
     * rồi cho `preempt` đứng trên nó. Tên biến `vramDestructiveProcedure` **vẫn còn nguyên** trong
     * file (một lưới neo vào TÊN BIẾN sẽ xanh), tập cổng **vẫn đủ ba** (lưới đời trước xanh), và
     * `preempt` **thật sự** chạy dưới `canCreate` + sàn `actuationProcedure` — mất luôn step-up 2FA.
     */
    const ma = nguonRouter(
      THAN_DUNG.replace("preempt: vramDestructiveProcedure", "preempt: congPhaHuy"),
      "const congPhaHuy = vramActuationProcedure;",
    );
    const { anhXa, mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toBe("");
    expect(ma, "đối chứng: tên biến cũ vẫn còn trong file").toContain("vramDestructiveProcedure");
    expect(anhXa.preempt).toEqual({ san: "actuationProcedure", cong: `${VRAM_CONTROL_MODULE}/canCreate` });
    expect(anhXa).not.toEqual(HINH_DANG_MONG_DOI);
  });

  it("★★★ cổng THỨ HAI chồng lên một ô ⇒ MÙ (ĐỎ), không im lặng chọn cái đầu tiên", () => {
    const ma = nguonRouter(
      THAN_DUNG.replace(
        "preempt: vramDestructiveProcedure.input(",
        'preempt: vramDestructiveProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate")).input(',
      ),
    );
    const { mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toContain("`preempt`");
  });

  it("★★★ thủ tục KHÔNG có cổng nào (thẳng `deployProcedure`) ⇒ MÙ (ĐỎ) — sàn danh tính ≠ sàn thẩm quyền", () => {
    const ma = nguonRouter(THAN_DUNG.replace("preempt: vramDestructiveProcedure", "preempt: deployProcedure"));
    const { anhXa, mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toContain("`preempt`");
    expect(anhXa.preempt, "ô mù KHÔNG được lọt vào ánh xạ như một cặp hợp lệ").toBeUndefined();
  });

  it("★★★ thủ tục MỚI thêm vào router mà không khai ⇒ ĐỎ (danh sách không có phần tử thứ N+1 im lặng)", () => {
    const ma = nguonRouter(
      `${THAN_DUNG}\n  killAll: vramDestructiveProcedure.input(z.object({})).mutation(async () => 1),`,
    );
    const { anhXa, mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toBe("");
    expect(anhXa).not.toEqual(HINH_DANG_MONG_DOI);
    expect(Object.keys(anhXa)).toContain("killAll");
  });

  it("★★ KHÔNG ÉP ĐẶT TÊN — chain INLINE `deployProcedure.use(requirePermission(…))` vẫn phân giải ĐÚNG", () => {
    /**
     * ⚠ *"Lưới DẪN người ta tới đâu?"* — nếu chain inline rơi vào nhánh mù thì phản ứng tự nhiên là
     * **đặt một cái tên cho có**, tức lưới dạy một thói quen chứ không canh một tính chất. Ở đây
     * inline vẫn ĐÚNG; chỉ **thiếu cổng** hoặc **hai cổng** mới là mù.
     */
    const ma = nguonRouter(
      THAN_DUNG.replace(
        "preempt: vramDestructiveProcedure.input(",
        'preempt: deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete")).input(',
      ),
    );
    const { anhXa, mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toBe("");
    expect(anhXa).toEqual(HINH_DANG_MONG_DOI);
  });

  it("★★ KHÔNG BẮT NHẦM — đổi TÊN BIẾN thủ tục (một lượt dọn dẹp hợp lệ) ⇒ VẪN XANH", () => {
    const ma = nguonRouter(THAN_DUNG).split("vramDestructiveProcedure").join("congPhaHuyVram");
    const { anhXa, mu } = anhXaThuTuc(DUONG, ma);
    expect(mu.join("\n")).toBe("");
    expect(anhXa).toEqual(HINH_DANG_MONG_DOI);
  });

  it("★★ KHÔNG BẮT NHẦM — file không có `router({…})` cho ánh xạ RỖNG, 0 ô mù", () => {
    expect(anhXaThuTuc("server/routers/x.ts", "export const a = 1;")).toEqual({ anhXa: {}, mu: [] });
  });
});
