/**
 * ★★ SCADA R1b-2a T13 fix round 2 (điều phối 2026-10-26, K13) — CENSUS "KHÔNG AI PHÁT MẪU `stale` VÀO QUYẾT ĐỊNH `connected`".
 *
 * Bối cảnh: `mauMayChuDaTraLoi` (reconnectNhanh.ts) — luật DUY NHẤT mà `taoBatDocTot` / `laDocTot` / `laTickHong` dùng để quyết định
 * "máy chủ đã trả lời" (⇒ `connected`, D1 không đếm) — coi `bad` + `stale` là ĐÃ trả lời (K13: thẳng hàng với đường poll). Hôm nay
 * KHÔNG driver / đường nào phát `stale` vào sink của phiên, nên lựa chọn đó vô hại. Nhưng `stale` theo định nghĩa là "không được làm
 * tươi" = KHÔNG có câu trả lời mới: một bộ canh độ tươi tương lai phát `stale` vào sink (vd. subscription OPC UA im lặng) sẽ báo
 * `connected` giả và chặn D1 — fail-open. LUẬT: bộ canh độ tươi trên đường này PHẢI phát `comm_lost`, KHÔNG BAO GIỜ `stale`.
 *
 * Census (AST, không tính chú thích / kiểu / đối số gọi hàm): ∀ tệp sản xuất `.ts` dưới `server/services/ot/**` (gồm `drivers/`),
 * mọi nơi GÁN chuỗi `"stale"` cho trường mẫu `reason` / `quality` / `statusCode` — thuộc tính object literal (kể cả nhánh `?:`,
 * `as const`, `satisfies`, template không thế chỗ), gán `x.reason = "stale"`, hoặc biến tên `reason`/`quality`/`statusCode` khởi tạo bằng
 * `"stale"` (để dùng shorthand) — phải nằm trong `CHO_PHEP` (bảng ghim: chỉ phản hồi `stale` THẬT do thiết bị báo, mỗi mục có lý do và
 * ngày). Bảng ghim RỖNG ngày 2026-10-26: không có nhà sản xuất nào. Nhà sản xuất thứ nhất ⇒ ĐỎ ⇒ người thêm phải chứng minh đó là phản
 * hồi thiết bị (và điều phối duyệt), hoặc đổi sang `comm_lost`. Bộ quét tự kiểm bằng vi phạm tổng hợp.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const THU_MUC = "server/services/ot";
const rel = (p: string) => relative(GOC, p).split(sep).join("/");
const TRUONG_MAU = new Set(["reason", "quality", "statusCode"]);

interface ChoPhep {
  /** Tệp (đường dẫn từ gốc repo). */
  tep: string;
  /** Trường mẫu được gán "stale". */
  truong: "reason" | "quality" | "statusCode";
  /** Vì sao đây là `stale` THẬT do thiết bị báo (không phải bộ canh độ tươi phía mình). */
  lyDo: string;
  /** YYYY-MM-DD. */
  ngay: string;
}

/** ★ Bảng ghim — 2026-10-26: RỖNG (đo: không nhà sản xuất nào; driver OPC UA ánh xạ StatusCode chỉ ra comm_lost/config_error/device_error). */
const CHO_PHEP: readonly ChoPhep[] = [];

interface PhatHien {
  tep: string;
  dong: number;
  truong: string;
}

function laChuoiStale(n: ts.Node): boolean {
  return (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === "stale";
}

/** Có chuỗi "stale" ở đâu đó trong BIỂU THỨC giá trị (nhánh ?:, ||, as const, satisfies, ngoặc…) — không đi vào hàm lồng. */
function chuaStale(n: ts.Node): boolean {
  if (laChuoiStale(n)) return true;
  if (ts.isFunctionLike(n) || ts.isCallExpression(n)) return false;
  return ts.forEachChild(n, (c) => (chuaStale(c) ? true : undefined)) === true;
}

function tenThuocTinh(name: ts.PropertyName | ts.MemberName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

/** Bộ quét: mọi nơi gán "stale" cho trường mẫu trong mã nguồn `ma` (tên tệp `tep` chỉ để báo). */
function quetStale(ma: string, tep: string): PhatHien[] {
  const sf = ts.createSourceFile(tep, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ra: PhatHien[] = [];
  const ghi = (n: ts.Node, truong: string) => ra.push({ tep, dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, truong });
  const di = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n)) {
      const t = tenThuocTinh(n.name);
      if (t && TRUONG_MAU.has(t) && chuaStale(n.initializer)) ghi(n, t);
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const trai = n.left;
      const t = ts.isPropertyAccessExpression(trai)
        ? trai.name.text
        : ts.isElementAccessExpression(trai) && ts.isStringLiteral(trai.argumentExpression)
          ? trai.argumentExpression.text
          : null;
      if (t && TRUONG_MAU.has(t) && chuaStale(n.right)) ghi(n, t);
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (TRUONG_MAU.has(n.name.text) && chuaStale(n.initializer)) ghi(n, n.name.text);
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

describe("R1b-2a T13 fix round 2 — census: không mẫu `stale` nào tới quyết định connected (K13)", () => {
  it("bộ quét tự kiểm — vi phạm tổng hợp bị bắt, dạng vô hại không bị bắt", () => {
    const vp = (ma: string) => quetStale(ma, "tong-hop.ts").map((x) => x.truong);
    expect(vp(`const a = { tagKey: "t", quality: "bad", reason: "stale" };`)).toEqual(["reason"]);
    expect(vp(`function f(ok: boolean) { return { quality: "bad", reason: ok ? "comm_lost" : "stale" }; }`)).toEqual(["reason"]);
    expect(vp(`const m = { reason: "stale" as const, statusCode: \`stale\` };`)).toEqual(["reason", "statusCode"]);
    expect(vp(`declare const s: { reason?: string }; s.reason = "stale";`)).toEqual(["reason"]);
    expect(vp(`declare const s: Record<string, string>; s["quality"] = "stale";`)).toEqual(["quality"]);
    expect(vp(`const reason = "stale"; const mau = { quality: "bad", reason };`)).toEqual(["reason"]);
    expect(vp(`const m = { reason: "stale" } satisfies { reason: string };`)).toEqual(["reason"]);
    // vô hại: kiểu, đối số gọi hàm, trường khác, chú thích, so sánh
    expect(
      vp(
        [
          `type L = "comm_lost" | "stale";`,
          `declare function reject(r: string, m: string): void; reject("stale", "x");`,
          `const k = { kind: "stale", lyDo: "stale" };`,
          `// reason: "stale"`,
          `declare const s: { reason?: string }; const b = s.reason === "stale";`,
          `const reason = laStale("stale");`,
          `declare function laStale(x: string): string;`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("∀ tệp sản xuất dưới server/services/ot/**: mọi nơi gán 'stale' cho trường mẫu ∈ bảng ghim CHO_PHEP (hôm nay: RỖNG)", () => {
    const tep = moiTep(join(GOC, THU_MUC));
    const tenTep = new Set(tep.map(rel));
    // Chống glob rỗng / sai gốc: tập quét phải chứa đúng những tệp quyết định và mọi driver.
    expect(tep.length).toBeGreaterThan(50);
    for (const bat of [
      "server/services/ot/reconnectNhanh.ts",
      "server/services/ot/otManager.ts",
      "server/services/ot/connectionSupervisor.ts",
      "server/services/ot/vongPoll.ts",
      "server/services/ot/chatLuong.ts",
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
    const ngoaiBang = phatHien.filter((x) => !CHO_PHEP.some((c) => c.tep === x.tep && c.truong === x.truong));
    expect(ngoaiBang, "nhà sản xuất 'stale' mới — bộ canh độ tươi PHẢI phát comm_lost; phản hồi thiết bị thật ⇒ thêm vào CHO_PHEP (lý do + ngày, điều phối duyệt)").toEqual([]);
    // Bảng ghim không được mục chết / thiếu lý do / sai ngày.
    for (const c of CHO_PHEP) {
      expect(c.lyDo.trim().length, `${c.tep}: thiếu lý do`).toBeGreaterThan(10);
      expect(c.ngay, `${c.tep}: ngày`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(phatHien.some((x) => x.tep === c.tep && x.truong === c.truong), `${c.tep}#${c.truong}: mục ghim không còn nhà sản xuất`).toBe(true);
    }
  });
});
