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
 * ⚠ **KHÔNG BẮT NHẦM** (đã ĐỔI ở Task 1b): trục này **không còn** là *"thủ tục `deployProcedure`
 * khác giữ nguyên cache phiên"* — chủ dự án đã chốt **siết nốt** cả 5 thủ tục deploy, nên phép siết
 * nay nằm ở **GỐC** `deployProcedure` (`_core/trpc.ts`) và chạm **cả 7**. Cái không được chạm là
 * `actuationProcedure` (sàn KHÔNG phải deploy) — xem mục 3. Lưới hành vi của 5 thủ tục thật:
 * `server/routers/deployStepUpFreshness.test.ts`; lý lẽ ở `task-1b-report.md`.
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
import { VRAM_COMMAND_DESTRUCTIVE, vramCommandIsDestructive } from "../services/vram/vramCommands";

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
 * ⚠ Vì thế nó vừa là **cái bơm** hâm nóng cache (`requireFreshTotp` vẫn đọc/ghi cache phiên —
 * Task 1b **không gỡ** nó, chỉ chain thêm phép siết per-call **sau** nó), vừa là ô chứng minh
 * phép siết nằm ở **GỐC** chứ không ở `vramRouter` (Task 1b — mục 3).
 */
const routerKhac = router({
  // ⚠ I-4: `totpCode` **BẮT BUỘC**, y hệt hình dạng sản xuất — một phép thử M3 khai lỏng hơn cái
  //   nó mô phỏng thì nó thôi mô phỏng cái ấy.
  deployKhac: deployProcedure
    .input(z.object({ totpCode: z.string().max(16) }))
    .mutation(() => ({ ok: true as const })),
});

/**
 * Payload **thiếu `totpCode`** — hình dạng của một người gọi **TỪ DÂY** (HTTP/JSON), thứ `tsc`
 * không ràng buộc được. ⚠ I-4 (review Task 1b) làm `totpCode` **bắt buộc** ở **hợp đồng** zod, và
 * đó là chỗ `tsc` bắt được lượt gỡ mã khỏi một điểm gọi client. Nhưng cổng an ninh thật phải đứng
 * vững trước một payload **thô** — nên các ca dưới đây cố ý đi vòng qua kiểu, thay vì nới zod lại.
 */
function tuDay<T>(v: T): T & { totpCode: string } {
  return v as T & { totpCode: string };
}

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
// TẬP "LỆNH PHÁ HUỶ" — NEO VÀO **HÀNH VI**, KHÔNG VÀO CHỮ KÝ THẨM QUYỀN
//
// ⚠⚠⚠ I-2 (review) — BẢN ĐẦU CỦA LƯỚI NÀY NEO SAI TRỤC, VÀ NÓ BỎ LỌT MỘT LỆNH GIẾT TIẾN TRÌNH.
// Bản đầu định nghĩa *phá huỷ* = đứng sau `requirePermission(VRAM_CONTROL_MODULE, "canDelete")`.
// Đột biến **R2b** của reviewer: đặt một lệnh **giết tiến trình** (gọi `vramPreemptCommand`) sau
// cổng **`canCreate`** ⇒ ba lưới có trước đỏ, **nhưng lưới này XANH 16/16** — và tệ hơn im lặng,
// ca "KHÔNG BẮT NHẦM" còn **KHẲNG ĐỊNH** rằng đường ấy *"không được đòi OTP tươi"*. Ba lưới kia là
// **danh-sách-ghim**, nên người thêm thủ tục sẽ *"cập nhật cho khớp"*, và **đúng lúc đó lỗ ship
// được**.
//
// ⇒ **ĐẢO LƯỢNG TỪ.** *"Phá huỷ"* là sự thật của **HÀM LỆNH**, không phải của bit quyền ai đó gắn
//   cho nó ở router. Chủ của sự thật ấy là `services/vram/vramCommands.ts`
//   (`VRAM_COMMAND_DESTRUCTIVE`) — **file thi hành hành vi**. Lưới này chỉ **đọc** phân loại đó rồi
//   phát biểu:
//
//     ***∀ mutation của `vramRouter` mà thân nó THAM CHIẾU một hàm lệnh được phân loại PHÁ HUỶ:
//     chuỗi thủ tục PHẢI chain `requirePerCallFreshTotp`, VÀ lượt gọi không mang OTP PHẢI bị chặn.***
//
// ⚠ Cộng một ca đóng vòng: ***∀ hàm `vram*Command` export từ `vramCommands.ts` PHẢI có một mục
//   trong `VRAM_COMMAND_DESTRUCTIVE`*** — thêm hàm lệnh mới mà quên phân loại ⇒ ĐỎ, không im lặng
//   rơi vào nhóm "không phá huỷ". (`vramCommandIsDestructive` cũng fail-closed: chưa phân loại ⇒
//   coi như PHÁ HUỶ.)
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const VRAM_ROUTER = join(TEST_DIR, "vramRouter.ts");
const VRAM_COMMANDS = join(TEST_DIR, "..", "services", "vram", "vramCommands.ts");

/** Tên phép siết per-call (`_core/trpc.ts`) — thứ mà MỌI thủ tục phá huỷ phải chain. */
const TEN_PHEP_SIET = "requirePerCallFreshTotp";
/** Hình dạng tên của một **hàm lệnh** VRAM (`vramCommands.ts`). */
const LA_HAM_LENH = /^vram\w*Command$/;

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
  /** `true` khi thân thủ tục **tham chiếu một hàm lệnh PHÁ HUỶ** (phân loại ở `vramCommands.ts`). */
  readonly phaHuy: boolean;
  /** `true` khi chuỗi có `.mutation(` — `query` nằm ngoài bất biến step-up. */
  readonly laMutation: boolean;
  /** `true` khi chuỗi thủ tục chain `requirePerCallFreshTotp` (bất biến CẤU TRÚC của phép siết). */
  readonly siet: boolean;
  /** Tên các hàm lệnh mà thân thủ tục tham chiếu — để câu lỗi gọi ĐÍCH DANH. */
  readonly hamLenh: readonly string[];
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

  /** MỌI định danh xuất hiện trong một biểu thức — nền của cả "hàm lệnh" lẫn "có chain phép siết". */
  const dinhDanhTrong = (n: ts.Node): Set<string> => {
    const ra = new Set<string>();
    const di = (x: ts.Node): void => {
      if (ts.isIdentifier(x)) ra.add(x.text);
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };

  const bien = new Map<string, { cong: string[]; siet: boolean; goc: string | null }>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      bien.set(d.name.text, {
        cong: congTrong(d.initializer),
        siet: dinhDanhTrong(d.initializer).has(TEN_PHEP_SIET),
        goc: gocChuoi(d.initializer),
      });
    }
  }
  /** Leo ngược chuỗi biến, gom MỌI cổng + phép siết gặp trên đường; dừng ở định danh ngoài file. */
  const phanGiai = (bd: string | null): { cong: string[]; siet: boolean; san: string | null } => {
    const cong: string[] = [];
    let siet = false;
    let cur = bd;
    for (let i = 0; i < 16 && cur !== null; i++) {
      const b = bien.get(cur);
      if (b === undefined) return { cong, siet, san: cur };
      cong.push(...b.cong);
      if (b.siet) siet = true;
      cur = b.goc;
    }
    return { cong, siet, san: null };
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
        // ★ I-2 — PHÁ HUỶ suy từ **hàm lệnh mà thân thủ tục gọi**, không từ bit quyền của nó.
        const dinhDanh = dinhDanhTrong(p.initializer);
        const hamLenh = [...dinhDanh].filter((x) => LA_HAM_LENH.test(x)).sort();
        anhXa[p.name.text] = {
          phaHuy: hamLenh.some((h) => vramCommandIsDestructive(h)),
          laMutation,
          siet: dinhDanh.has(TEN_PHEP_SIET) || tuGoc.siet,
          hamLenh,
        };
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
    // ⚠ Cầu chì của trục MỚI: mọi mutation phải THẤY được hàm lệnh của nó. Một ô không tham chiếu
    //   hàm lệnh nào thì lượng từ theo HÀNH VI không nói gì về nó ⇒ đó là một ô KHÔNG AI CANH.
    const khongHam = Object.keys(LENH.anhXa).filter(
      (k) => LENH.anhXa[k]?.laMutation === true && (LENH.anhXa[k]?.hamLenh.length ?? 0) === 0,
    );
    expect(khongHam.join(" · "), "mutation không tham chiếu hàm lệnh nào ⇒ ngoài tầm lượng từ HÀNH VI").toBe("");
  });

  it("★★★ I-2 ĐÓNG VÒNG — ∀ hàm `vram*Command` export từ `vramCommands.ts` PHẢI được phân loại", () => {
    /**
     * ⚠ Không có ca này thì `VRAM_COMMAND_DESTRUCTIVE` là một **danh sách có phần tử thứ N+1**: ai
     * thêm `vramNukeCommand` mà quên phân loại sẽ rơi vào `true` (fail-closed) — đúng chiều, nhưng
     * **im lặng**. Ca này biến lượt quên ấy thành một **quyết định phải nói ra**.
     */
    const ma = readFileSync(VRAM_COMMANDS, "utf8");
    const sf = ts.createSourceFile("vramCommands.ts", ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const xuat: string[] = [];
    for (const st of sf.statements) {
      if (!ts.isFunctionDeclaration(st) || st.name === undefined) continue;
      const co = ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
      if (co && LA_HAM_LENH.test(st.name.text)) xuat.push(st.name.text);
    }
    expect(xuat.length, "không thấy hàm lệnh nào — bộ quét hỏng ⇒ ca này thành chân lý rỗng").toBeGreaterThanOrEqual(3);
    const chuaPhanLoai = xuat.filter((h) => !(h in VRAM_COMMAND_DESTRUCTIVE));
    expect(
      chuaPhanLoai.join(" · "),
      "hàm lệnh CHƯA được phân loại phá-huỷ/không — phải khai ở `VRAM_COMMAND_DESTRUCTIVE`",
    ).toBe("");
  });

  it("★★★ I-2 BẤT BIẾN CẤU TRÚC — ∀ mutation PHÁ HUỶ: chuỗi thủ tục PHẢI chain `requirePerCallFreshTotp`", () => {
    /**
     * ⚠⚠ Đây là ô mà đột biến **R2b** đi qua được ở bản đầu. Nó neo vào **HÀNH VI** (hàm lệnh mà
     * thân thủ tục gọi), nên đặt một lệnh giết tiến trình sau **bất kỳ** bit quyền nào cũng không
     * thoát: hễ nó gọi `vramPreemptCommand` thì nó **phải** đứng sau phép siết.
     */
    const thieu = PHA_HUY.filter((k) => LENH.anhXa[k]?.siet !== true);
    expect(
      thieu.map((k) => `${k} (gọi ${LENH.anhXa[k]?.hamLenh.join(", ")})`).join(" · "),
      `mutation gọi một hàm lệnh PHÁ HUỶ mà KHÔNG chain ${TEN_PHEP_SIET} ⇒ OTP của một lượt khác mở được cửa`,
    ).toBe("");
  });

  it("★★★ cầu chì — OTP thật verify được qua ĐƯỜNG THẬT (`deployProcedure` + `speakeasy` + bảng `users`)", async () => {
    const phien = phienMoi();
    await expect(khac(phien).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });
  });

  it("★★★ cầu chì — cờ `ACTUATION_STEPUP_2FA` ĐANG BẬT và middleware ĐANG chạy (phiên nguội ⇒ chặn)", async () => {
    const e = await loiCua(khac(phienMoi()).deployKhac(tuDay({})));
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
    const e = await loiCua(vram(phien).preempt(tuDay({ owner: "sidecar:vision" })));

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
    const e2 = await loiCua(vram(phien).preempt(tuDay({ owner: "sidecar:vision" })));
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
// 3. KHÔNG BẮT NHẦM — phép siết KHÔNG được lan ra ngoài nhánh `deployProcedure`
//
// ⚠⚠⚠ Ô **PHẠM VI**, VÀ NÓ ĐÃ ĐỔI Ở TASK 1b — CA DƯỚI ĐÂY TỪNG KHẲNG ĐỊNH ĐIỀU NGƯỢC LẠI.
// Bản Task 1 ghi *"một thủ tục `deployProcedure` KHÁC giữ NGUYÊN cache phiên 10 phút"* như một
// sự thật đo được, vì kế hoạch Pha 6 xếp *"step-up hở ở `orchestration.deployWorkflow` +
// `programming.deployBuild`"* vào §"KHÔNG làm — cần chủ dự án quyết". Chủ dự án **đã quyết**
// (2026-08-06): **SIẾT NỐT**. `deployProcedure` nay chain `requirePerCallFreshTotp` ngay tại
// GỐC (`_core/trpc.ts`), nên câu cũ **sai sự thật** và ca này đã ĐỎ đúng lúc bản vá vào.
// ⇒ Trục "không bắt nhầm" **dịch xuống một tầng**: cái không được chạm nay là
//   `actuationProcedure` (sàn KHÔNG phải deploy) — xem ca kế tiếp, suy từ HÀNH VI.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ KHÔNG BẮT NHẦM — phép siết chỉ chạm nhánh `deployProcedure`", () => {
  it("★★★ Task 1b — một thủ tục `deployProcedure` KHÁC nay CŨNG bị siết (cache phiên thôi mở được cửa)", async () => {
    /**
     * ⚠ Đây là **nửa VRAM** của cổng ra Task 1b, đo từ phía lưới VRAM: `deployKhac` đứng trên
     * **chính** `deployProcedure` export của `_core/trpc.ts` (đại diện `programming.deployBuild` /
     * `orchestration.deployWorkflow`), nên nó chứng minh phép siết nằm ở **GỐC**, không phải ở
     * `vramRouter`. Lưới hành vi đầy đủ cho 5 thủ tục thật:
     * `server/routers/deployStepUpFreshness.test.ts`.
     */
    const phien = phienMoi();
    await expect(khac(phien).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });
    // Cùng phiên, cache ĐÃ ấm, không OTP ⇒ nay BỊ CHẶN ở đúng cổng OTP.
    const e = await loiCua(khac(phien).deployKhac(tuDay({})));
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
    // …và ĐỐI CHỨNG DƯƠNG: OTP của chính lượt ấy thì vẫn qua.
    await expect(khac(phien).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });
  });

  it("★★★ mutation KHÔNG PHÁ HUỶ (theo HÀNH VI) không bị kéo vào cổng OTP", async () => {
    /**
     * ⚠⚠ I-2 — **CÂU KHẲNG ĐỊNH NÀY TỪNG SAI SỰ THẬT.** Bản đầu lấy `KHONG_PHA_HUY` từ **chữ ký
     * thẩm quyền**, nên dưới đột biến R2b (lệnh **giết tiến trình** đặt sau cổng `canCreate`) nó
     * **khẳng định** rằng một đường giết tiến trình *"không được đòi OTP tươi"* — tệ hơn im lặng.
     * Nay tập này suy từ **hàm lệnh mà thân thủ tục gọi**: một lệnh giết tiến trình **không thể**
     * rơi vào đây dù ai gắn bit gì cho nó.
     */
    for (const ten of KHONG_PHA_HUY) {
      expect(
        LENH.anhXa[ten]?.hamLenh.filter((h) => vramCommandIsDestructive(h)),
        `\`${ten}\` gọi một hàm lệnh PHÁ HUỶ ⇒ nó KHÔNG được nằm trong tập "không phá huỷ"`,
      ).toEqual([]);
      const e = await loiCua(goiTheoTen(phienMoi(), ten, KHONG_THAM_SO));
      expect(
        readAppErrorMeta(e),
        `\`${ten}\` không phá huỷ gì ⇒ không được đòi OTP tươi`,
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
      // ⚠ I-4: `totpCode` nay BẮT BUỘC ở zod. Cờ TẮT ⇒ middleware pass-through nên mã này
      //   **không được verify** — nó chỉ thoả hợp đồng. Đúng cái ca này đo: cờ TẮT thì một mã
      //   SAI cũng đi lọt, tức phép siết KHÔNG tự bật step-up ở deployment chưa bật cờ.
      const r = await vram(phien).preempt({ owner: "sidecar:vision", totpCode: "000000" });
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

  /** Chèn một ô mới vào thân `vramRouter` — nền của mọi đột biến "đường thoát mới". */
  const themO = (dong: string): string =>
    GOC.replace("export const vramRouter = router({", ["export const vramRouter = router({", dong].join("\n"));

  it("★★★ một lệnh phá huỷ THỨ BA sinh ra ⇒ nó TỰ vào lượng từ (không cần ai nhớ cập nhật danh sách)", () => {
    const ma = themO(
      "  huyThemMot: vramDestructiveProcedure.input(z.object({})).mutation(async ({ input }) => vramPreemptCommand(input.owner)),",
    );
    expect(ma, "đột biến phải thật sự đổi được nguồn").not.toBe(GOC);
    const { anhXa, mu } = lenhCuaRouter(ma);
    expect(mu.join("\n")).toBe("");
    expect(Object.keys(anhXa).filter((k) => anhXa[k]?.phaHuy === true)).toContain("huyThemMot");
  });

  it("★★★ R2b NGUYÊN VĂN — lệnh GIẾT TIẾN TRÌNH đặt sau cổng `canCreate` VẪN là PHÁ HUỶ và VẪN bị đòi phép siết", () => {
    /**
     * ⚠⚠⚠ **ĐÂY LÀ CA MÀ BẢN ĐẦU CỦA LƯỚI NÀY BỎ LỌT.** Đột biến đặt `vramPreemptCommand` (giết
     * tiến trình) sau `vramActuationProcedure` (cổng `canCreate`, **không** có phép siết). Neo vào
     * chữ ký thẩm quyền ⇒ nó rơi khỏi tập phá huỷ và lưới XANH. Neo vào **HÀNH VI** ⇒ nó **ở lại**
     * tập phá huỷ, và bất biến cấu trúc bắt được vì chuỗi của nó KHÔNG chain phép siết.
     */
    const ma = themO(
      "  preemptQuaCanCreate: vramActuationProcedure.input(z.object({})).mutation(async ({ input }) => vramPreemptCommand(input.owner)),",
    );
    expect(ma).not.toBe(GOC);
    const { anhXa, mu } = lenhCuaRouter(ma);
    expect(mu.join("\n")).toBe("");
    // (i) HÀNH VI thắng chữ ký: bit là `canCreate`, nhưng nó vẫn PHÁ HUỶ.
    expect(anhXa.preemptQuaCanCreate?.phaHuy, "gọi `vramPreemptCommand` ⇒ PHÁ HUỶ, bất kể bit quyền").toBe(true);
    // (ii) …và nó KHÔNG chain phép siết ⇒ bất biến cấu trúc phải bắt được.
    expect(anhXa.preemptQuaCanCreate?.siet).toBe(false);
    const thieu = Object.keys(anhXa).filter((k) => anhXa[k]?.phaHuy === true && anhXa[k]?.siet !== true);
    expect(thieu, "R2b phải bị bắt ĐÍCH DANH").toEqual(["preemptQuaCanCreate"]);
  });

  it("★★ ĐỔI BIT QUYỀN không đổi phân loại HÀNH VI (bộ suy đã RỜI khỏi trục chữ ký)", () => {
    const ma = GOC.replace(
      'deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"))',
      'deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"))',
    );
    expect(ma).not.toBe(GOC);
    const { anhXa } = lenhCuaRouter(ma);
    expect(anhXa.preempt?.phaHuy, "`preempt` vẫn gọi `vramPreemptCommand` ⇒ vẫn PHÁ HUỶ").toBe(true);
  });

  it("★★ gỡ `requirePerCallFreshTotp` khỏi sàn phá huỷ ⇒ bất biến CẤU TRÚC bắt được (không cần chạy thời gian thực)", () => {
    const ma = GOC.replace('.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete")).use(requirePerCallFreshTotp)',
      '.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"))');
    expect(ma).not.toBe(GOC);
    const { anhXa } = lenhCuaRouter(ma);
    const thieu = Object.keys(anhXa).filter((k) => anhXa[k]?.phaHuy === true && anhXa[k]?.siet !== true).sort();
    expect(thieu).toEqual([...PHA_HUY].sort());
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
