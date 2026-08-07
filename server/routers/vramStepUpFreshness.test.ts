/**
 * ★★★ Pha 6 Task 1 (M-4) — **STEP-UP 2FA PHẢI ĐÓNG Ở MÁY CHỦ, KHÔNG CHỈ Ở UI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: NGHIỆM THU SỐNG PHA 5 ĐO ĐƯỢC MỘT LƯỢT PHÁ HUỶ QUA CỔNG KHÔNG OTP
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu sống của **Pha 5** (`docs/superpowers/reports/2026-08-06-vram-pha5-nghiem-thu-song.md`
 * — lưới này đóng một món nợ của pha ấy nên nó **tự khai `Pha 5`**, để `vramPha5Gate.test.ts` kéo
 * nó vào lượng từ *"mọi lưới Pha 5 phải được §Cổng kiểm chung phủ"* thay vì lọt ra ngoài vì viết
 * hoa): `engineer1` gọi
 * `vram.preempt` **KHÔNG có `totpCode`** vẫn **QUA** step-up, vì `stepUpVerifiedUntil`
 * (`_core/trpc.ts`) là cache **10 phút theo `sessionToken`**, **DÙNG CHUNG cho MỌI
 * `deployProcedure` của hệ**. Vừa step-up cho `programming.deployBuild` thì `vram.preempt` chạy
 * **không hỏi OTP lần nào** trong 10 phút.
 *
 * ⚠⚠ Đây là lớp *"mặt đọc hứa nhiều hơn mặt lệnh"* theo chiều **NGƯỢC**: `VramBrokerPanel` bọc
 * `stepUp.guard(...)` và hỏi OTP **mỗi lần bấm**, nên ai đọc mã UI sẽ **tưởng đã đóng**. Nguy hơn
 * chiều thuận vì nó **không gây triệu chứng nào** — mọi ảnh chụp nghiệm thu đều thấy hộp thoại OTP.
 *
 * ⚠⚠ **LƯỚI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE.** Không ca nào giả `requireFreshTotp`,
 * `requirePermission`, hay `speakeasy`. Cache được **hâm nóng bằng một lượt gọi THẬT** qua
 * `deployProcedure` **thật** (export của `_core/trpc.ts`) với một OTP **thật** sinh bằng
 * `speakeasy` trên một secret **thật** trong bảng `users` — rồi lệnh VRAM thật bị gọi trên **cùng
 * `sessionToken`**. Đó chính xác là kịch bản đã đo được trên hệ sống.
 *
 * ⚠⚠ **ĐẢO LƯỢNG TỪ.** Bất biến KHÔNG liệt kê `preempt`/`releaseStale` — nó nói:
 *
 *   ***∀ mutation của `vramRouter` đứng sau cổng PHÁ HUỶ (`requirePermission(VRAM_CONTROL_MODULE,
 *   "canDelete")`): MỌI lượt gọi PHẢI mang một `totpCode` hợp lệ của CHÍNH lượt ấy. Không lượt nào
 *   được qua nhờ trạng thái mà một lượt KHÁC để lại.***
 *
 * Tập PHÁ HUỶ **suy ra từ chính `vramRouter.ts`** bằng AST, không chép tay ⇒ một lệnh phá huỷ thứ
 * ba sinh ra ở bất kỳ đâu trong router cũng **tự đưa mình vào lượng từ**.
 *
 * ⚠ **ĐỐI CHỨNG DƯƠNG là điều kiện tồn tại của lưới này**: không có nó thì một bản vá **chặn hết**
 * cũng xanh — lớp lỗi đã để `215/215` xanh suốt thời gian một tool luôn `PERMISSION_DENIED`.
 * ⚠ **KHÔNG BẮT NHẦM**: một thủ tục `deployProcedure` **khác** (nền của
 * `programming.deployBuild` / `orchestration.deployWorkflow`) phải **KHÔNG** bị phép siết chạm tới
 * — cache phiên của nó còn nguyên. Đó là quyết định phạm vi, xem `task-1-report.md` Bước 2/3.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import speakeasy from "speakeasy";
import { z } from "zod";

// Middleware kiểm toán ghi DB fire-and-forget cho MỌI mutation — tắt trước khi `trpc.ts` nạp.
// `LICENSE_MODULE_GATE_ENABLED=false`: cổng license chạy TRƯỚC cổng quyền; bật nó thì một ca
// "bị chặn" có thể xanh vì **lý do sai**.
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
import { router, deployProcedure } from "../_core/trpc";
import { permissions, users } from "../../drizzle/schema";
import { readAppErrorMeta } from "../_core/appError";
import * as broker from "../services/vram/vramBroker";
import { __resetSharedLedgerForTests } from "../services/vram/vramSharedLedger";
import { __resetDecisionTickForTests } from "../services/vram/vramTickCell";
import { __resetVramDeferForTests } from "../services/vram/vramDefer";
import { VRAM_CONTROL_MODULE } from "@shared/permissions";

const MIB = 1024 * 1024;
const SUP_ID = 42;
const supervisor = { id: SUP_ID, role: "supervisor", name: "Sup", twoFactorEnabled: true };

/** Secret 2FA THẬT — `verifyFreshTotp` chạy `speakeasy.totp.verify` nguyên bản trên nó. */
const SECRET_2FA = "K52U24CYJRNTQSKMG47FKUSHKFKUQW2D";
/** OTP **của lượt gọi này**. Sinh mới mỗi lần để không có ô nào phụ thuộc một chuỗi cứng. */
const otp = (): string => speakeasy.totp({ secret: SECRET_2FA, encoding: "base32" });

/**
 * ⚠ `FakeDb.select(projection)` **bỏ qua** projection và trả **hàng thô**, nên hàng phải mang CẢ
 * hai hình dạng: bí danh mà `verifyFreshTotp` đọc (`secret`/`enabled`) và tên thuộc tính schema.
 * Đổi bí danh ở `_core/trpc.ts` mà quên chỗ này ⇒ verify trả `false` ⇒ **đối chứng dương ĐỎ**
 * (hỏng theo chiều AN TOÀN, không im lặng).
 */
function seedNguoiDung2FA(): void {
  fake.seed(users, [
    { id: SUP_ID, secret: SECRET_2FA, enabled: true, twoFactorSecret: SECRET_2FA, twoFactorEnabled: true },
  ]);
}

type HanhQuyen = { module: string; canView?: boolean; canCreate?: boolean; canEdit?: boolean; canDelete?: boolean };

/** Vật chất hoá **đúng những hàng `permissions`** mà lượt cấp quyền thật sẽ INSERT — không hơn. */
function capQuyen(userId: number, rows: HanhQuyen[]): void {
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

/**
 * ⚠ MỖI ca một `sessionToken` RIÊNG. `stepUpVerifiedUntil` là một `Map` cấp module **không có
 * đường xoá** — dùng chung một khoá thì ca sau thừa hưởng cache của ca trước và mọi khẳng định
 * "cache nguội" thành vô nghĩa. Khoá riêng cho **cách ly thật**, không cần cửa hậu ở mã sản xuất.
 */
let demPhien = 0;
const phienMoi = (): string => `pha6-task1-sess-${++demPhien}`;
const ctxCua = (phien: string, user: unknown = supervisor) =>
  ({ user, req: { ip: "127.0.0.1", headers: {} }, res: {}, sessionToken: phien }) as never;

/**
 * **MỘT thủ tục `deployProcedure` KHÁC** — đại diện của `programming.deployBuild` /
 * `orchestration.deployWorkflow` trong lưới này. Nó dùng **chính** `deployProcedure` export từ
 * `_core/trpc.ts`, nên nó chia sẻ **đúng** middleware và **đúng** `Map` cache của mã sản xuất.
 * ⚠ Vì thế nó vừa là **cái bơm** hâm nóng cache, vừa là ô **KHÔNG BẮT NHẦM**.
 */
const routerKhac = router({
  deployKhac: deployProcedure
    .input(z.object({ totpCode: z.string().max(16).optional() }))
    .mutation(() => ({ ok: true as const })),
});

const vram = (phien: string, user: unknown = supervisor) => vramRouter.createCaller(ctxCua(phien, user));
const khac = (phien: string, user: unknown = supervisor) => routerKhac.createCaller(ctxCua(phien, user));

/** Gọi một mutation của `vramRouter` **theo tên** — cần cho lượng từ ∀ trên tập suy ra từ AST. */
function goiTheoTen(phien: string, ten: string, input: unknown): Promise<unknown> {
  const caller = vram(phien) as unknown as Record<string, (i: unknown) => Promise<unknown>>;
  const f = caller[ten];
  if (typeof f !== "function") return Promise.reject(new Error(`vramRouter không có mutation \`${ten}\``));
  return f(input);
}

/** Lỗi của một lượt gọi, hoặc `null` nếu nó **không** ném. */
async function loiCua(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẬP "LỆNH PHÁ HUỶ" — SUY RA TỪ `vramRouter.ts`, KHÔNG CHÉP TAY
//
// ⚠ Định nghĩa lấy từ chính docstring của router: *phá huỷ* = đứng sau
//   `requirePermission(VRAM_CONTROL_MODULE, "canDelete")`. Neo vào **cổng thẩm quyền**, không vào
//   tên biến sàn: đổi tên biến là dọn dẹp hợp lệ, đổi cổng là một quyết định an ninh.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const VRAM_ROUTER = join(TEST_DIR, "vramRouter.ts");

/** Định danh TRÁI NHẤT của một chuỗi truy cập (`a.use(x).input(y)` → `a`). */
function gocChuoi(n: ts.Node | undefined): string | null {
  let cur: ts.Node | undefined = n;
  for (;;) {
    if (cur === undefined) return null;
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else return null;
  }
}

interface HinhDangLenh {
  /** `true` khi chuỗi của thủ tục chứa `requirePermission(VRAM_CONTROL_MODULE, "canDelete")`. */
  readonly phaHuy: boolean;
  /** `true` khi chuỗi có `.mutation(` — `query` nằm ngoài bất biến step-up. */
  readonly laMutation: boolean;
}

function lenhCuaRouter(nguon?: string): { anhXa: Record<string, HinhDangLenh>; mu: string[] } {
  const ma = nguon ?? readFileSync(VRAM_ROUTER, "utf8");
  const sf = ts.createSourceFile("vramRouter.ts", ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** MỌI `requirePermission(M, A)` bên trong một biểu thức, chuẩn hoá thành `M/A`. */
  const congTrong = (n: ts.Node): string[] => {
    const ra: string[] = [];
    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "requirePermission") {
        const m = x.arguments[0];
        const a = x.arguments[1];
        // Ô module là hằng dùng chung (`VRAM_CONTROL_MODULE`) hoặc một chuỗi viết thẳng.
        const mv =
          m !== undefined && ts.isStringLiteral(m)
            ? m.text
            : m !== undefined && ts.isIdentifier(m) && m.text === "VRAM_CONTROL_MODULE"
              ? VRAM_CONTROL_MODULE
              : "?";
        const av = a !== undefined && ts.isStringLiteral(a) ? a.text : "?";
        ra.push(`${mv}/${av}`);
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };

  const bien = new Map<string, { cong: string[]; goc: string | null }>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      bien.set(d.name.text, { cong: congTrong(d.initializer), goc: gocChuoi(d.initializer) });
    }
  }
  /** Leo ngược chuỗi biến, gom MỌI cổng gặp trên đường; dừng ở định danh không phải khai báo file. */
  const phanGiai = (bd: string | null): { cong: string[]; san: string | null } => {
    const cong: string[] = [];
    let cur = bd;
    for (let i = 0; i < 16 && cur !== null; i++) {
      const b = bien.get(cur);
      if (b === undefined) return { cong, san: cur };
      cong.push(...b.cong);
      cur = b.goc;
    }
    return { cong, san: null };
  };

  const anhXa: Record<string, HinhDangLenh> = {};
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
          mu.push(`vramRouter.ts:${dong} — ô của router KHÔNG phải \`tên: <chuỗi thủ tục>\``);
          continue;
        }
        let laMutation = false;
        const doc = (x: ts.Node): void => {
          if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "mutation") {
            laMutation = true;
          }
          ts.forEachChild(x, doc);
        };
        doc(p.initializer);
        const tuGoc = phanGiai(gocChuoi(p.initializer));
        if (tuGoc.san === null) {
          mu.push(`vramRouter.ts:${dong} \`${p.name.text}\` — KHÔNG leo được tới một sàn thủ tục`);
          continue;
        }
        const cong = [...new Set([...congTrong(p.initializer), ...tuGoc.cong])];
        if (cong.some((c) => c.includes("?"))) {
          mu.push(`vramRouter.ts:${dong} \`${p.name.text}\` — cổng KHÔNG đọc được: [${cong.join(", ")}]`);
          continue;
        }
        anhXa[p.name.text] = { phaHuy: cong.includes(`${VRAM_CONTROL_MODULE}/canDelete`), laMutation };
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { anhXa, mu };
}

const LENH = lenhCuaRouter();
/** ∀ của bất biến chính — **suy ra**, không liệt kê. */
const PHA_HUY: readonly string[] = Object.keys(LENH.anhXa).filter(
  (k) => LENH.anhXa[k]?.phaHuy === true && LENH.anhXa[k]?.laMutation === true,
);
/** Mutation KHÔNG phá huỷ — nền của các ca "không bắt nhầm". */
const KHONG_PHA_HUY: readonly string[] = Object.keys(LENH.anhXa).filter(
  (k) => LENH.anhXa[k]?.phaHuy !== true && LENH.anhXa[k]?.laMutation === true,
);

/** Tham số tối thiểu để lượt gọi **đi hết middleware** rồi mới chạm zod. */
const KHONG_THAM_SO: Record<string, unknown> = {};

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  sidecar.stop = null;
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  seedNguoiDung2FA();
  capQuyen(SUP_ID, [{ module: VRAM_CONTROL_MODULE, canDelete: true, canCreate: true }]);
  process.env.ACTUATION_STEPUP_2FA = "true";
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 0. CẦU CHÌ — một tập rỗng làm MỌI khẳng định dưới thành chân lý rỗng
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Pha 6 M-4 — cầu chì của lượng từ", () => {
  it("★★★ đọc được `vramRouter.ts`: 0 ô mù, tập PHÁ HUỶ không rỗng, tập KHÔNG-phá-huỷ không rỗng", () => {
    expect(LENH.mu.join("\n"), "một ô không phân giải được là một ô KHÔNG AI CANH").toBe("");
    expect(PHA_HUY.length, "0 lệnh phá huỷ ⇒ mọi ca ∀ dưới đây là chân lý rỗng").toBeGreaterThanOrEqual(2);
    expect(KHONG_PHA_HUY.length, "0 lệnh không-phá-huỷ ⇒ ca 'không bắt nhầm' là chân lý rỗng").toBeGreaterThanOrEqual(1);
    expect(PHA_HUY.filter((k) => KHONG_PHA_HUY.includes(k)), "hai tập không được giao nhau").toEqual([]);
  });

  it("★★★ cầu chì — OTP thật verify được qua ĐƯỜNG THẬT (`deployProcedure` + `speakeasy` + bảng `users`)", async () => {
    const phien = phienMoi();
    await expect(khac(phien).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });
  });

  it("★★★ cầu chì — cờ `ACTUATION_STEPUP_2FA` ĐANG BẬT và middleware ĐANG chạy (phiên nguội ⇒ chặn)", async () => {
    const e = await loiCua(khac(phienMoi()).deployKhac({}));
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. BẤT BIẾN CHÍNH — ∀ lệnh PHÁ HUỶ: OTP của một lượt KHÁC KHÔNG mở được cửa
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ M-4 — OTP của một lượt KHÁC không được mở cửa cho lệnh phá huỷ VRAM", () => {
  it("★★★ CA ĐO ĐƯỢC Ở NGHIỆM THU SỐNG: step-up cho một `deployProcedure` khác ⇒ `preempt` KHÔNG `totpCode` phải BỊ CHẶN, và KHÔNG một byte nào rời sổ", async () => {
    const phien = phienMoi();
    // Nhịp 1 — một lượt step-up HỢP LỆ ở một thủ tục KHÁC (đúng `programming.deployBuild` ở hệ thật).
    await expect(khac(phien).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });

    // Nhịp 2 — CÙNG phiên, trong 10 phút, lệnh PHÁ HUỶ **không** kèm OTP.
    const lease = xinThat("sidecar:vision", 7_825 * MIB);
    sidecar.stop = async () => {
      broker.release(lease);
      return true;
    };
    const truoc = broker.snapshot().totalReservedBytes;
    const e = await loiCua(vram(phien).preempt({ owner: "sidecar:vision" }));

    expect(e, "lượt phá huỷ không mang OTP của CHÍNH nó PHẢI bị từ chối").not.toBeNull();
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
    // ⚠ Câu từ chối chưa đủ: phải chứng minh **không một byte nào bị đụng**.
    expect(broker.snapshot().totalReservedBytes, "bị chặn ⇒ chưa ai bị thu hồi").toBe(truoc);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id), "giấy phép phải còn nguyên").toBe(true);
  });

  it("★★★ ∀ lệnh PHÁ HUỶ (suy ra từ AST): cache đã ấm ⇒ lượt KHÔNG mang OTP vẫn bị chặn ở ĐÚNG cổng OTP", async () => {
    for (const ten of PHA_HUY) {
      const phien = phienMoi();
      await expect(khac(phien).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });
      const e = await loiCua(goiTheoTen(phien, ten, KHONG_THAM_SO));
      expect(
        readAppErrorMeta(e),
        `\`${ten}\` qua được step-up bằng OTP của một lượt KHÁC — M-4 còn sống ở thủ tục này`,
      ).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
    }
  });

  it("★★★ hai lượt PHÁ HUỶ liên tiếp: OTP của lượt THỨ NHẤT không mở cửa cho lượt THỨ HAI", async () => {
    const phien = phienMoi();
    // Lượt 1 — hợp lệ, có OTP của chính nó. `{}` ⇒ qua hết middleware rồi mới hỏng ở zod.
    const e1 = await loiCua(vram(phien).preempt({ totpCode: otp() } as never));
    expect((e1 as { code?: string })?.code, "lượt CÓ OTP phải đi qua middleware và dừng ở zod").toBe("BAD_REQUEST");

    // Lượt 2 — cùng phiên, không OTP ⇒ vẫn phải bị chặn ở cổng OTP.
    const e2 = await loiCua(vram(phien).preempt({ owner: "sidecar:vision" }));
    expect(readAppErrorMeta(e2)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. ĐỐI CHỨNG DƯƠNG — "chặn hết" cũng là xanh nếu không có mục này
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ ĐỐI CHỨNG DƯƠNG — lượt CÓ OTP hợp lệ VẪN QUA, và byte rời sổ THẬT", () => {
  it("★★★ `preempt` + OTP tươi của CHÍNH lượt ấy ⇒ thu hồi THẬT (7.825 MiB rời sổ)", async () => {
    const phien = phienMoi();
    const lease = xinThat("sidecar:vision", 7_825 * MIB);
    sidecar.stop = async () => {
      broker.release(lease); // đúng việc `proc.on("exit")` làm ở sản xuất
      return true;
    };
    const r = await vram(phien).preempt({ owner: "sidecar:vision", totpCode: otp() });
    expect(r.outcome, "OTP đúng ⇒ lệnh PHẢI chạy").toBe("reclaimed");
    expect(r.freedBytes).toBe(7_825 * MIB);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(false);
  });

  it("★★★ ∀ lệnh PHÁ HUỶ: lượt CÓ OTP hợp lệ đi QUA mọi middleware (dừng ở zod, KHÔNG ở cổng OTP)", async () => {
    for (const ten of PHA_HUY) {
      const e = await loiCua(goiTheoTen(phienMoi(), ten, { totpCode: otp() }));
      expect((e as { code?: string })?.code, `\`${ten}\` với OTP hợp lệ phải qua được step-up`).toBe("BAD_REQUEST");
      expect(
        readAppErrorMeta(e),
        `\`${ten}\` bị chặn ở cổng OTP dù OTP hợp lệ — phép siết đang CHẶN HẾT`,
      ).not.toMatchObject({ appParams: { field: "twoFactorCode" } });
    }
  });

  it("★★ OTP SAI vẫn bị từ chối (phép siết không biến cổng thành 'có ô totpCode là qua')", async () => {
    const e = await loiCua(vram(phienMoi()).preempt({ owner: "sidecar:vision", totpCode: "000000" }));
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. KHÔNG BẮT NHẦM — phép siết KHÔNG được lan sang thủ tục `deployProcedure` khác
//
// ⚠⚠ Đây là ô **phạm vi**. Kế hoạch Pha 6 xếp *"step-up hở ở `orchestration.deployWorkflow` +
//    `programming.deployBuild`"* vào §"KHÔNG làm ở Pha 6 — cần chủ dự án quyết". Ca dưới đây
//    **ghi lại hiện trạng ấy như một sự thật đo được**, để một lượt siết toàn hệ về sau là một
//    **quyết định nói ra**, không phải một tác dụng phụ của task này.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ KHÔNG BẮT NHẦM — phép siết chỉ chạm lệnh PHÁ HUỶ của VRAM", () => {
  it("★★★ một thủ tục `deployProcedure` KHÁC giữ NGUYÊN cache phiên 10 phút (hiện trạng, cố ý ngoài phạm vi Pha 6)", async () => {
    const phien = phienMoi();
    await expect(khac(phien).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });
    // Không OTP, cùng phiên ⇒ vẫn QUA. Đây là hành vi **trước** task này, và task này không đổi nó.
    await expect(khac(phien).deployKhac({})).resolves.toEqual({ ok: true });
  });

  it("★★★ mutation KHÔNG phá huỷ của VRAM không bị kéo vào cổng OTP", async () => {
    for (const ten of KHONG_PHA_HUY) {
      const e = await loiCua(goiTheoTen(phienMoi(), ten, KHONG_THAM_SO));
      expect(
        readAppErrorMeta(e),
        `\`${ten}\` KHÔNG đứng sau cổng phá huỷ ⇒ không được đòi OTP tươi`,
      ).not.toMatchObject({ appParams: { field: "twoFactorCode" } });
    }
  });

  it("★★ cờ TẮT ⇒ pass-through hoàn toàn (phép siết KHÔNG tự bật step-up ở deployment chưa bật cờ)", async () => {
    const truoc = process.env.ACTUATION_STEPUP_2FA;
    process.env.ACTUATION_STEPUP_2FA = "false";
    try {
      const phien = phienMoi();
      const lease = xinThat("sidecar:vision", 1_024 * MIB);
      sidecar.stop = async () => {
        broker.release(lease);
        return true;
      };
      const r = await vram(phien).preempt({ owner: "sidecar:vision" });
      expect(r.outcome, "cờ TẮT ⇒ không thủ tục nào đòi OTP").toBe("reclaimed");
    } finally {
      if (truoc === undefined) delete process.env.ACTUATION_STEPUP_2FA;
      else process.env.ACTUATION_STEPUP_2FA = truoc;
    }
  });

  it("★★ mặt ĐỌC (`query`) nằm ngoài bất biến step-up", () => {
    expect(LENH.anhXa.state?.laMutation, "`state` là `query`").toBe(false);
    expect(PHA_HUY, "`query` không được lọt vào lượng từ đòi OTP").not.toContain("state");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 4. LƯỚI-CHO-LƯỚI — bộ suy tập PHÁ HUỶ phải ĐỎ dưới đúng đột biến nó được dựng ra để bắt
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★ lưới-cho-lưới — tập PHÁ HUỶ suy ra từ AST có RĂNG", () => {
  const GOC = readFileSync(VRAM_ROUTER, "utf8");

  it("★★★ một lệnh phá huỷ THỨ BA sinh ra ⇒ nó TỰ vào lượng từ (không cần ai nhớ cập nhật danh sách)", () => {
    const ma = GOC.replace(
      "export const vramRouter = router({",
      [
        "export const vramRouter = router({",
        "  huyThemMot: vramDestructiveProcedure.input(z.object({})).mutation(async () => ({ ok: true })),",
      ].join("\n"),
    );
    expect(ma, "đột biến phải thật sự đổi được nguồn").not.toBe(GOC);
    const { anhXa, mu } = lenhCuaRouter(ma);
    expect(mu.join("\n")).toBe("");
    expect(Object.keys(anhXa).filter((k) => anhXa[k]?.phaHuy === true)).toContain("huyThemMot");
  });

  it("★★ hạ cổng của `preempt` xuống `canCreate` ⇒ nó RỜI tập phá huỷ (bộ suy đọc CỔNG, không đọc tên)", () => {
    const ma = GOC.replace(
      'deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"))',
      'deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"))',
    );
    expect(ma).not.toBe(GOC);
    const { anhXa } = lenhCuaRouter(ma);
    expect(anhXa.preempt?.phaHuy).toBe(false);
  });

  it("★★ KHÔNG BẮT NHẦM — đổi TÊN biến sàn (dọn dẹp hợp lệ) ⇒ tập PHÁ HUỶ không đổi", () => {
    const ma = GOC.split("vramDestructiveProcedure").join("vramDestructiveProcedureDoi");
    expect(ma).not.toBe(GOC);
    const { anhXa, mu } = lenhCuaRouter(ma);
    expect(mu.join("\n")).toBe("");
    expect(
      Object.keys(anhXa)
        .filter((k) => anhXa[k]?.phaHuy === true)
        .sort(),
    ).toEqual([...PHA_HUY].sort());
  });
});
