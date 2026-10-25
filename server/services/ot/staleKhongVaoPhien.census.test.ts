/**
 * ★★ SCADA R1b-2a T13 fix round 2/3 (điều phối 2026-10-26, K13) — CENSUS "KHÔNG AI PHÁT MẪU `stale` VÀO QUYẾT ĐỊNH `connected`".
 *
 * Bối cảnh: `mauMayChuDaTraLoi` (reconnectNhanh.ts) — luật DUY NHẤT mà `taoBatDocTot` / `laDocTot` / `laTickHong` dùng để quyết định
 * "máy chủ đã trả lời" (⇒ `connected`, D1 không đếm) — coi `bad` + `stale` là ĐÃ trả lời (K13: thẳng hàng với đường poll). Hôm nay
 * KHÔNG driver / đường nào phát `stale` vào sink của phiên, nên lựa chọn đó vô hại. Nhưng `stale` theo định nghĩa là "không được làm
 * tươi" = KHÔNG có câu trả lời mới: một bộ canh độ tươi tương lai phát `stale` vào sink (vd. subscription OPC UA im lặng) sẽ báo
 * `connected` giả và chặn D1 — fail-open. LUẬT: bộ canh độ tươi trên đường này PHẢI phát `comm_lost`, KHÔNG BAO GIỜ `stale`.
 *
 * Census (AST) — fix round 3: bản round 2 chỉ bắt phép GÁN vào trường `reason`/`quality`/`statusCode` và bị vượt bởi ba dạng (đã đo bằng
 * chính bộ quét): đối số của helper lô `mauXauChoMoiTag(tags, sc, "stale", at)`, hằng gián tiếp (`const S = "stale"` rồi dùng S), hàm
 * phân loại `return "stale"`. Nay: ∀ tệp sản xuất `.ts` dưới `server/services/ot/**` (gồm `drivers/`), MỌI chuỗi `"stale"` (literal hoặc
 * template không thế chỗ) dùng làm GIÁ TRỊ đều bị bắt. Chỉ bỏ qua những vị trí KHÔNG sinh ra giá trị: kiểu (`type L = … | "stale"`),
 * so sánh `===` / `!==` / `==` / `!=`, nhãn `case "stale":`, tên thuộc tính (`{ "stale": … }`) và khoá truy cập (`x["stale"]`).
 * Mỗi chỗ còn lại phải nằm trong `CHO_PHEP` (bảng ghim theo tệp + số lần, có lý do và ngày; chỉ dành cho miền KHÁC hoặc phản hồi `stale`
 * THẬT do thiết bị báo, điều phối duyệt). Nhà sản xuất mới ⇒ ĐỎ ⇒ đổi sang `comm_lost`, hoặc chứng minh và ghim. Bộ quét tự kiểm bằng
 * vi phạm tổng hợp (mỗi dạng đã từng lọt có một ca đỏ riêng).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const THU_MUC = "server/services/ot";
const rel = (p: string) => relative(GOC, p).split(sep).join("/");

interface ChoPhep {
  /** Tệp (đường dẫn từ gốc repo). */
  tep: string;
  /** Số chuỗi "stale" dùng làm giá trị được phép trong tệp — ĐÚNG bằng (thêm một chỗ ⇒ đỏ, bớt ⇒ đỏ: ghim phải đo lại). */
  soLan: number;
  /** Vì sao chỗ này KHÔNG tới quyết định connected (miền khác), hoặc là `stale` THẬT do thiết bị báo. */
  lyDo: string;
  /** YYYY-MM-DD. */
  ngay: string;
}

/** ★ Bảng ghim — đo 2026-10-26 trên cây hiện tại: đúng MỘT chỗ, ở miền đồng bộ epoch STOP (không phải mẫu tag). */
const CHO_PHEP: readonly ChoPhep[] = [
  {
    tep: "server/services/ot/otStopEpochSync.ts",
    soLan: 1,
    lyDo:
      "reject(\"stale\", …) tại :501 là mã TỪ CHỐI thông điệp epoch STOP giữa các bản sao (RejectReason của otStopEpochSync: thông điệp quá " +
      "tuổi / lệch đồng hồ) — miền đồng bộ epoch, không phải OtSample; không đi vào sink của phiên, taoBatDocTot, laDocTot hay laTickHong.",
    ngay: "2026-10-26",
  },
];

interface PhatHien {
  tep: string;
  dong: number;
  /** Loại nút cha (để người đọc biết dạng: CallExpression, ReturnStatement, VariableDeclaration, PropertyAssignment…). */
  nguCanh: string;
}

function laChuoiStale(n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === "stale";
}

const SO_SANH = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Literal "stale" ở vị trí KHÔNG sinh ra giá trị (kiểu, so sánh, nhãn case, tên thuộc tính, khoá truy cập)? */
function viTriKhongPhaiGiaTri(n: ts.Node): boolean {
  // Bỏ ngoặc / `as const` / `satisfies` / `!` để nhìn đúng ngữ cảnh: (x === ("stale" as const)) vẫn là so sánh.
  let con: ts.Node = n;
  let p = n.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression(p))) {
    if ((ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) && p.type === con) return true;
    con = p;
    p = p.parent;
  }
  if (!p) return false;
  if (ts.isLiteralTypeNode(p)) return true; // type L = "stale"; (x: "stale") => …
  if (ts.isBinaryExpression(p) && SO_SANH.has(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p) && p.expression === con) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) && p.name === con) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === con) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  return false;
}

/** Bộ quét: mọi chuỗi "stale" dùng làm GIÁ TRỊ trong mã nguồn `ma` (tên tệp `tep` chỉ để báo). */
function quetStale(ma: string, tep: string): PhatHien[] {
  const sf = ts.createSourceFile(tep, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ra: PhatHien[] = [];
  const di = (n: ts.Node): void => {
    if (laChuoiStale(n) && !viTriKhongPhaiGiaTri(n)) {
      ra.push({ tep, dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, nguCanh: ts.SyntaxKind[n.parent.kind] });
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.endsWith(".d.ts") && !/\.testkit\.ts$/.test(ten)) ra.push(p);
  }
  return ra;
}

describe("R1b-2a T13 fix round 2/3 — census: không chuỗi `stale` nào dùng làm giá trị dưới server/services/ot (K13)", () => {
  const dem = (ma: string) => quetStale(ma, "tong-hop.ts").length;

  // ── Ba dạng đã LỌT bộ quét round 2 (rereview, đo bằng chính bộ quét) — mỗi dạng một ca, phải ĐỎ (≥ 1 phát hiện). ──
  it("self-test (fix round 3): helper lô `mauXauChoMoiTag(tags, sc, \"stale\", at)` (dạng trangThaiAdapter.ts:120 / vongPoll.ts:201) ⇒ bị bắt", () => {
    expect(dem(`declare function mauXauChoMoiTag(t: unknown[], sc: string, r: string, at: Date): unknown[]; const at = new Date(); const ds = mauXauChoMoiTag([], "x", "stale", at);`)).toBe(1);
  });
  it("self-test (fix round 3): hằng gián tiếp `const S = \"stale\"` rồi dùng ⇒ bị bắt", () => {
    expect(dem(`const S = "stale"; declare function phat(r: string): void; phat(S); const m = { quality: "bad", reason: S };`)).toBe(1);
  });
  it("self-test (fix round 3): hàm phân loại trả `\"stale\"` (return / mũi tên) ⇒ bị bắt", () => {
    expect(dem(`function phanLoai(ms: number): string { if (ms > 5000) return "stale"; return "comm_lost"; }`)).toBe(1);
    expect(dem(`const phanLoai2 = (ms: number) => (ms > 5000 ? "stale" : "comm_lost");`)).toBe(1);
  });

  it("self-test: các dạng gán trực tiếp (round 2) vẫn bị bắt", () => {
    expect(dem(`const a = { tagKey: "t", quality: "bad", reason: "stale" };`)).toBe(1);
    expect(dem(`function f(ok: boolean) { return { quality: "bad", reason: ok ? "comm_lost" : "stale" }; }`)).toBe(1);
    expect(dem(`const m = { reason: "stale" as const, statusCode: \`stale\` };`)).toBe(2);
    expect(dem(`declare const s: { reason?: string }; s.reason = "stale";`)).toBe(1);
    expect(dem(`declare const s: Record<string, string>; s["quality"] = "stale";`)).toBe(1);
    expect(dem(`const m = { reason: "stale" } satisfies { reason: string };`)).toBe(1);
    expect(dem(`const ds = ["comm_lost", "stale"]; const mp = new Map([["k", "stale"]]);`)).toBe(2);
  });

  it("self-test: vị trí KHÔNG sinh giá trị không bị bắt (kiểu, so sánh, case, tên thuộc tính, khoá, chú thích)", () => {
    expect(
      dem(
        [
          `type L = "comm_lost" | "stale";`,
          `interface I { r: "stale" }`,
          `function g(x: "stale" | "ok") { return x; }`,
          `declare const s: { reason?: string };`,
          `const b1 = s.reason === "stale"; const b2 = "stale" !== s.reason; const b3 = s.reason == ("stale" as const);`,
          `switch (s.reason) { case "stale": break; default: break; }`,
          `const k = { "stale": 1 }; declare const rec: Record<string, number>; const v = rec["stale"];`,
          `const c = "x" as "stale" | "x";`,
          `// reason: "stale" — chú thích`,
          `/* mauXauChoMoiTag(tags, sc, "stale", at) */`,
        ].join("\n"),
      ),
    ).toBe(0);
  });

  it("∀ tệp sản xuất dưới server/services/ot/**: mọi chuỗi 'stale' dùng làm giá trị ∈ bảng ghim CHO_PHEP (tệp + số lần đúng bằng)", () => {
    const tep = moiTep(join(GOC, THU_MUC));
    const tenTep = new Set(tep.map(rel));
    // Chống glob rỗng / sai gốc: tập quét phải chứa đúng những tệp quyết định, mọi driver, và các nơi đã có helper lô.
    expect(tep.length).toBeGreaterThan(50);
    for (const bat of [
      "server/services/ot/reconnectNhanh.ts",
      "server/services/ot/otManager.ts",
      "server/services/ot/connectionSupervisor.ts",
      "server/services/ot/vongPoll.ts",
      "server/services/ot/trangThaiAdapter.ts",
      "server/services/ot/chatLuong.ts",
      "server/services/ot/otStopEpochSync.ts",
      "server/services/ot/drivers/opcuaDriver.ts",
      "server/services/ot/drivers/s7Driver.ts",
      "server/services/ot/drivers/mitsubishiMcDriver.ts",
      "server/services/ot/drivers/modbusDriver.ts",
      "server/services/ot/drivers/slmpDriver.ts",
      "server/services/ot/drivers/ethernetIpDriver.ts",
      "server/services/ot/drivers/stubDriver.ts",
    ]) {
      expect(tenTep.has(bat), bat).toBe(true);
    }
    const phatHien = tep.flatMap((p) => quetStale(readFileSync(p, "utf8"), rel(p)));
    const theoTep = new Map<string, PhatHien[]>();
    for (const x of phatHien) theoTep.set(x.tep, [...(theoTep.get(x.tep) ?? []), x]);
    const ngoaiBang = phatHien.filter((x) => !CHO_PHEP.some((c) => c.tep === x.tep));
    expect(
      ngoaiBang,
      "chuỗi 'stale' mới dùng làm giá trị — bộ canh độ tươi PHẢI phát comm_lost; miền khác / phản hồi thiết bị thật ⇒ ghim vào CHO_PHEP (lý do + ngày, điều phối duyệt)",
    ).toEqual([]);
    for (const c of CHO_PHEP) {
      expect(c.lyDo.trim().length, `${c.tep}: thiếu lý do`).toBeGreaterThan(20);
      expect(c.ngay, `${c.tep}: ngày`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(theoTep.get(c.tep)?.length ?? 0, `${c.tep}: số chỗ 'stale' phải ĐÚNG bằng ghim (đo lại nếu đổi)`).toBe(c.soLan);
    }
  });
});
