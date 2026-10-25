/**
 * SCADA R1b-2a Task 5 (kiem-dinh M7) — CENSUS THỨ TỰ KHOÁ HÀNG `device_tags`.
 *
 *   ***∀ chuỗi drizzle trong `server/**` (không test) khoá `device_tags` `FOR UPDATE` mà KHÔNG lọc theo MỘT `id` duy nhất:
 *   chuỗi ấy PHẢI có `.orderBy(deviceTags.id)` (hoặc `asc(deviceTags.id)`) làm khoá sắp xếp ĐẦU TIÊN.***
 *
 * Vì sao: hai giao dịch khoá cùng một tập tag theo HAI thứ tự khác nhau (id / tagKey / thứ tự vật lý của heap khi không ORDER BY) là
 * đường dẫn tới vòng chờ 40P01. Thứ tự khoá dự án (troLaiKenh.ts): ADAPTER → LUẬT → TAG (FOR UPDATE, ORDER BY id) → KÊNH CHẾ ĐỘ.
 * Phân tích bằng AST (TypeScript compiler API), không regex dòng — chuỗi trải nhiều dòng (`congAdapterTx`) cũng bị bắt.
 *
 * Phạm vi vị từ:
 *   • khoá: lời gọi `.for("update", …)` có trong chuỗi một `.from(deviceTags)` hoặc `.innerJoin/.leftJoin(deviceTags, …)`, trừ khi tuỳ chọn
 *     `{ of: X }` chỉ khoá bảng khác;
 *   • một hàng: `.where(eq(deviceTags.id, …))` hoặc `.where(and(eq(deviceTags.id, …), …))`, hoặc khoá tự nhiên duy nhất
 *     (`and(eq(deviceTags.adapterId, …), eq(deviceTags.tagKey, …))`, ràng buộc `uq_device_tags_adapter_key`) — khoá MỘT hàng không có thứ tự để lệch;
 *   • `FOR SHARE` KHÔNG thuộc vị từ FOR UPDATE (brief T5); R1b-2a T6 (review T5 m-2) thêm MỘT ca riêng cho khoá NHIỀU hàng FOR SHARE (cùng
 *     luật ORDER BY id, ghim riêng `VI_TRI_NHIEU_HANG_SHARE`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi } from "../../routers/deployProcedureScan";

const GOC_REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface ViTriKhoaTag {
  /** `<đường tương đối>#<hàm bao ngoài gần nhất>` — ổn định khi số dòng xê dịch. */
  viTri: string;
  dong: number;
  motHang: boolean;
  coOrderById: boolean;
}

const laDeviceTags = (n: ts.Node | undefined): boolean =>
  !!n && ((ts.isIdentifier(n) && n.text === "deviceTags") || (ts.isPropertyAccessExpression(n) && n.name.text === "deviceTags"));

const laCotIdCuaTag = (n: ts.Node | undefined): boolean => !!n && ts.isPropertyAccessExpression(n) && n.name.text === "id" && laDeviceTags(n.expression);

const tenGoi = (c: ts.CallExpression): string | null => {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
};

const laCotCuaTag = (n: ts.Node | undefined, cot: string): boolean =>
  !!n && ts.isPropertyAccessExpression(n) && n.name.text === cot && laDeviceTags(n.expression);

/** `eq(deviceTags.<cot>, …)` đứng TRỰC TIẾP trong điều kiện (hoặc trong `and(...)` cấp trên cùng). */
function coEqCot(dk: ts.Expression | undefined, cot: string): boolean {
  if (!dk || !ts.isCallExpression(dk)) return false;
  const ten = tenGoi(dk);
  if (ten === "eq") return laCotCuaTag(dk.arguments[0], cot);
  if (ten === "and") return dk.arguments.some((a) => coEqCot(a, cot));
  return false;
}

/**
 * MỘT hàng: `eq(deviceTags.id, x)` (trần hoặc trong `and(...)`), HOẶC khoá tự nhiên duy nhất `uq_device_tags_adapter_key`
 * (`eq(deviceTags.adapterId, …)` VÀ `eq(deviceTags.tagKey, …)` cùng trong `and(...)` — `datStopPinTx`).
 */
function locMotId(dk: ts.Expression | undefined): boolean {
  return coEqCot(dk, "id") || (coEqCot(dk, "adapterId") && coEqCot(dk, "tagKey"));
}

/** Khoá sắp xếp đầu tiên là `deviceTags.id` (trần hoặc `asc(...)`). */
function orderTheoId(arg0: ts.Expression | undefined): boolean {
  if (!arg0) return false;
  if (laCotIdCuaTag(arg0)) return true;
  return ts.isCallExpression(arg0) && tenGoi(arg0) === "asc" && laCotIdCuaTag(arg0.arguments[0]);
}

/** Tuỳ chọn `{ of: X }` của `.for(...)`: trả `true` nếu chỉ khoá bảng KHÁC `deviceTags`. */
function ofBangKhac(opt: ts.Expression | undefined): boolean {
  if (!opt || !ts.isObjectLiteralExpression(opt)) return false;
  for (const p of opt.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "of") {
      const v = p.initializer;
      if (ts.isArrayLiteralExpression(v)) return !v.elements.some((x) => laDeviceTags(x));
      return !laDeviceTags(v);
    }
  }
  return false;
}

function hamBaoNgoai(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      const cha = p.parent;
      if (ts.isVariableDeclaration(cha) && ts.isIdentifier(cha.name)) return cha.name.text;
      if (ts.isPropertyAssignment(cha) && (ts.isIdentifier(cha.name) || ts.isStringLiteral(cha.name))) return cha.name.text;
      if (ts.isCallExpression(cha)) {
        // `.mutation(async () => …)` trong khai báo thủ tục tRPC: lấy tên thuộc tính của router (`update: protectedProcedure…`)
        for (let q: ts.Node | undefined = cha.parent; q; q = q.parent) {
          if (ts.isPropertyAssignment(q) && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name))) {
            let ten = q.name.text;
            for (let r: ts.Node | undefined = q.parent; r; r = r.parent) {
              if (ts.isPropertyAssignment(r) && (ts.isIdentifier(r.name) || ts.isStringLiteral(r.name))) ten = `${r.name.text}.${ten}`;
            }
            return ten;
          }
          if (ts.isFunctionDeclaration(q) && q.name) return q.name.text;
        }
      }
    }
  }
  return "(cấp tệp)";
}

/**
 * Mọi lượt khoá `device_tags` FOR UPDATE (mặc định) — hoặc FOR SHARE khi `cheDo = "share"` (R1b-2a T6, review T5 m-2: thêm thuần) — trong một
 * tệp nguồn.
 */
export function quetKhoaTag(duong: string, ma: string, cheDo: "update" | "share" = "update"): ViTriKhoaTag[] {
  const src = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
  const ra: ViTriKhoaTag[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "for") {
      const che = n.arguments[0];
      if (che && ts.isStringLiteralLike(che) && che.text === cheDo && !ofBangKhac(n.arguments[1])) {
        let coTag = false;
        let motHang = false;
        let coOrderById = false;
        for (let cur: ts.Expression = n.expression.expression; ; ) {
          if (ts.isCallExpression(cur)) {
            const ten = tenGoi(cur);
            if ((ten === "from" || ten === "innerJoin" || ten === "leftJoin" || ten === "rightJoin" || ten === "fullJoin") && laDeviceTags(cur.arguments[0])) coTag = true;
            if (ten === "where" && locMotId(cur.arguments[0])) motHang = true;
            if (ten === "orderBy" && orderTheoId(cur.arguments[0])) coOrderById = true;
            cur = cur.expression;
          } else if (ts.isPropertyAccessExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) {
            cur = cur.expression;
          } else break;
        }
        if (coTag) {
          const dong = src.getLineAndCharacterOfPosition(n.expression.name.getStart(src)).line + 1; // dòng của `.for(`
          ra.push({ viTri: `${duong}#${hamBaoNgoai(n)}`, dong, motHang, coOrderById });
        }
      }
    }
    n.forEachChild(di);
  };
  di(src);
  return ra;
}

const MOI_FILE = moiFileDuoi(GOC_REPO, "server", [".ts"]).filter((f) => !/\.test\.ts$/.test(f.duong) && !f.duong.includes("/__"));

let daQuet: ViTriKhoaTag[] | null = null;
let daQuetShare: ViTriKhoaTag[] | null = null;
/** Quét MỘT lần cho cả tệp (AST mọi file server mất ~10 s). Chỉ parse file có nhắc `deviceTags` (các file khác không thể có khoá tag). */
function moiKhoaTag(): ViTriKhoaTag[] {
  daQuet ??= MOI_FILE.flatMap((f) => {
    const ma = readFileSync(f.that, "utf8");
    return ma.includes("deviceTags") ? quetKhoaTag(f.duong, ma) : [];
  });
  return daQuet;
}
/** Như trên cho FOR SHARE (R1b-2a T6). */
function moiKhoaTagShare(): ViTriKhoaTag[] {
  daQuetShare ??= MOI_FILE.flatMap((f) => {
    const ma = readFileSync(f.that, "utf8");
    return ma.includes("deviceTags") ? quetKhoaTag(f.duong, ma, "share") : [];
  });
  return daQuetShare;
}

/**
 * GHIM — mọi lượt khoá NHIỀU hàng `device_tags` FOR SHARE trong `server/**` (đo bằng AST). Tất cả PHẢI `ORDER BY id`.
 *  - 2026-10-25 · R1b-2a T6 (review T5 m-2) — đo trên cây 4395bfd11 + T6: MỘT vị trí, `interlockRouter.ts#assertDichNguonSanSang` (tag nguồn
 *      telemetry_tag trên mọi adapter của máy, `FOR SHARE OF device_tags`) — trước đây không ORDER BY. FOR SHARE không chặn FOR SHARE, nhưng một
 *      bên FOR UPDATE theo thứ tự khác trên cùng tập hàng vẫn là đường tới 40P01 ⇒ cùng luật ORDER BY id.
 */
const VI_TRI_NHIEU_HANG_SHARE = ["server/routers/interlockRouter.ts#assertDichNguonSanSang"];

/**
 * GHIM — mọi lượt khoá NHIỀU hàng `device_tags` FOR UPDATE trong `server/**` (đo bằng AST, KHÔNG đoán). Tất cả PHẢI `ORDER BY id`.
 * Thêm một vị trí mới ⇒ thêm vào đây kèm ngày · task · lý do (lượt khoá mới phải theo đúng thứ tự khoá dự án — troLaiKenh.ts).
 *  - 2026-10-25 · R1b-2a T5 (kiem-dinh M7, phán quyết K8) — đo trên cây 9e53832c5 + T5: bốn vị trí.
 *      `deviceAdapterRouter.ts#delete` (khoá lại tag của adapter trước khi xoá — K8, trước đây không ORDER BY);
 *      `mappingAsCode.ts#importMapping` (`hangKhoa` — trước đây không ORDER BY);
 *      `stopPin.ts#goMoiStopPinCuaAdapterTx` (gỡ mọi ghim của adapter — K8, trước đây không ORDER BY);
 *      `troLaiKenh.ts#congAdapterTx` (cổng adapter — trước đây ORDER BY tagKey).
 *  - 2026-10-25 · R1b-2a T6 — vị trí thứ năm `scadaKenhRouter.ts#khaiHangLoat` (khai mức hàng loạt: tag `WHERE id IN (…) ORDER BY id FOR UPDATE`
 *      SAU adapter FOR SHARE → luật nhắm adapter FOR SHARE — đúng thứ tự khoá dự án).
 */
const VI_TRI_NHIEU_HANG = [
  "server/routers/scadaKenhRouter.ts#khaiHangLoat",
  "server/routers/deviceAdapterRouter.ts#delete",
  "server/services/ot/mappingAsCode.ts#importMapping",
  "server/services/ot/stopPin.ts#goMoiStopPinCuaAdapterTx",
  "server/services/scada/troLaiKenh.ts#congAdapterTx",
];

describe("★★★ census — khoá NHIỀU hàng `device_tags` FOR UPDATE luôn ORDER BY id (kiem-dinh M7)", () => {
  it("cầu chì — phạm vi quét không mù (đủ nhiều file, thấy troLaiKenh.ts và deviceAdapterRouter.ts)", () => {
    expect(MOI_FILE.length).toBeGreaterThan(1000);
    expect(MOI_FILE.some((f) => f.duong === "server/services/scada/troLaiKenh.ts")).toBe(true);
    expect(MOI_FILE.some((f) => f.duong === "server/routers/deviceAdapterRouter.ts")).toBe(true);
  });

  it("hiệu chuẩn — bộ quét BẮT chuỗi nhiều dòng không ORDER BY / ORDER BY tagKey, THA ORDER BY id / asc(id) / một id", () => {
    const vo = (than: string) => `async function f(tx) {\n  return tx\n    .select()\n    .from(deviceTags)\n${than}\n}\n`;
    const [khongOrder] = quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.adapterId, 1))\n    .for("update");`));
    expect(khongOrder).toMatchObject({ viTri: "x.ts#f", motHang: false, coOrderById: false, dong: 6 });
    const [theoKey] = quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.adapterId, 1))\n    .orderBy(deviceTags.tagKey)\n    .for("update");`));
    expect(theoKey).toMatchObject({ motHang: false, coOrderById: false });
    const [phuTagKey] = quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.adapterId, 1))\n    .orderBy(deviceTags.tagKey, deviceTags.id)\n    .for("update");`));
    expect(phuTagKey.coOrderById, "id chỉ là khoá phụ ⇒ vẫn sai thứ tự").toBe(false);
    expect(quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.adapterId, 1))\n    .orderBy(deviceTags.id)\n    .for("update");`))[0].coOrderById).toBe(true);
    expect(quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.adapterId, 1))\n    .orderBy(asc(deviceTags.id))\n    .for("update");`))[0].coOrderById).toBe(true);
    expect(quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.id, 7))\n    .limit(1)\n    .for("update");`))[0].motHang).toBe(true);
    expect(quetKhoaTag("x.ts", vo(`    .where(and(eq(deviceTags.id, 7), eq(deviceTags.adapterId, 1)))\n    .for("update");`))[0].motHang).toBe(true);
    // khoá tự nhiên duy nhất (adapterId, tagKey) ⇒ một hàng; chỉ một nửa khoá ⇒ nhiều hàng
    expect(quetKhoaTag("x.ts", vo(`    .where(and(eq(deviceTags.adapterId, 1), eq(deviceTags.tagKey, "k")))\n    .for("update");`))[0].motHang).toBe(true);
    expect(quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.tagKey, "k"))\n    .for("update");`))[0].motHang).toBe(false);
    // vô can: FOR SHARE, bảng khác, `of` chỉ khoá bảng khác
    expect(quetKhoaTag("x.ts", vo(`    .where(eq(deviceTags.adapterId, 1))\n    .for("share");`))).toEqual([]);
    expect(quetKhoaTag("x.ts", `async function g(tx) { return tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, 1)).for("update"); }`)).toEqual([]);
    expect(
      quetKhoaTag("x.ts", `async function g(tx) { return tx.select().from(deviceAdapters).innerJoin(deviceTags, eq(a, b)).for("update", { of: deviceAdapters }); }`),
    ).toEqual([]);
    // join khoá CẢ device_tags (không `of`) ⇒ bị bắt
    expect(quetKhoaTag("x.ts", `async function g(tx) { return tx.select().from(deviceAdapters).innerJoin(deviceTags, eq(a, b)).for("update"); }`)).toHaveLength(1);
  });

  it("hiệu chuẩn — tên vị trí của thủ tục tRPC lồng (`tags.update`) và của hàm khai báo", () => {
    const ma = `export const r = router({\n  tags: router({\n    update: p.mutation(async ({ input }) => {\n      await db.transaction(async (tx) => {\n        await tx.select().from(deviceTags).where(eq(deviceTags.adapterId, 1)).for("update");\n      });\n    }),\n  }),\n});\n`;
    expect(quetKhoaTag("r.ts", ma)[0].viTri).toBe("r.ts#tags.update");
  });

  it("★★★ ∀ khoá nhiều hàng `device_tags` FOR UPDATE ⇒ ORDER BY id là khoá sắp xếp đầu tiên", () => {
    const sai = moiKhoaTag()
      .filter((k) => !k.motHang && !k.coOrderById)
      .map((k) => `${k.viTri}:${k.dong}`);
    expect(sai, "khoá nhiều tag FOR UPDATE phải `.orderBy(deviceTags.id)` — hai thứ tự khác nhau trên cùng tập hàng ⇒ 40P01 (troLaiKenh.ts)").toEqual([]);
  });

  it("★ GHIM — danh sách vị trí khoá nhiều hàng (không thừa, không thiếu)", () => {
    const viTri = [...new Set(moiKhoaTag().filter((k) => !k.motHang).map((k) => k.viTri))].sort();
    expect(viTri, "vị trí khoá nhiều tag MỚI ⇒ thêm vào VI_TRI_NHIEU_HANG kèm ngày · task · lý do (và theo thứ tự khoá dự án)").toEqual([...VI_TRI_NHIEU_HANG].sort());
  });

  it("★★ R1b-2a T6 (review T5 m-2) — ∀ khoá nhiều hàng `device_tags` FOR SHARE ⇒ ORDER BY id; GHIM danh sách vị trí", () => {
    expect(quetKhoaTag("x.ts", `async function g(tx) { return tx.select().from(deviceTags).where(eq(deviceTags.adapterId, 1)).for("share"); }`, "share")).toHaveLength(1);
    expect(quetKhoaTag("x.ts", `async function g(tx) { return tx.select().from(deviceTags).where(eq(deviceTags.adapterId, 1)).for("update"); }`, "share")).toEqual([]);
    const sai = moiKhoaTagShare()
      .filter((k) => !k.motHang && !k.coOrderById)
      .map((k) => `${k.viTri}:${k.dong}`);
    expect(sai, "khoá nhiều tag FOR SHARE phải `.orderBy(deviceTags.id)` (troLaiKenh.ts)").toEqual([]);
    const viTri = [...new Set(moiKhoaTagShare().filter((k) => !k.motHang).map((k) => k.viTri))].sort();
    expect(viTri, "vị trí khoá nhiều tag FOR SHARE MỚI ⇒ thêm vào VI_TRI_NHIEU_HANG_SHARE kèm ngày · task · lý do").toEqual([...VI_TRI_NHIEU_HANG_SHARE].sort());
  });
});
