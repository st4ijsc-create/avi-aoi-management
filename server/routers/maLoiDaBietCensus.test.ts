/**
 * ★★★ SCADA R1b-2b-2b A — C1 polish round 2 (điều phối: phương án A) — CENSUS danh sách MÃ ĐÃ BIẾT `MA_LOI_DA_BIET` (`_chiTietKyThuat.ts`).
 *
 * `maLoiCua` chỉ nhận tiền tố `^[A-Z][A-Z0-9_]*:` của errorText (và `maLyDoThu` chỉ nhận mã thuần) khi mã nằm trong `MA_LOI_DA_BIET` — văn bản driver
 * thô bắt đầu bằng nhãn kiểu tên máy ("PLC01_LINE3: connect …") không được lộ nhãn ấy như "mã" cho người bị che. Không có hằng runtime chung cho
 * tập mã (mã dispatcher là literal ở điểm gọi; `MaTuChoiYeuCau` / `MaCongKenh` chỉ là KIỂU; tệp nguồn của 2a / client cấm sửa) ⇒ danh sách viết
 * TƯỜNG MINH, và census này SUY tập nguồn bằng AST lúc test, đòi `MA_LOI_DA_BIET` ⊇ tập ấy (mã mới ở dispatcher ⇒ ĐỎ, nêu tên từng mã thiếu).
 *
 * Nguồn (chỉ ĐỌC):
 *   • `dispatcher_reason` — commandDispatcher.ts / otEdgeDispatch.ts / otAdapterOwnerGate.ts: thuộc tính `reason:` / `code:` là literal (hoặc
 *     điều kiện / `??` của literal), biến tên `reason` khởi tạo literal, đối số mã của `writeRejected(db, input, "<MÃ>", …)` / `writeAll(…, status, "<MÃ>", …)`;
 *   • `union` — thành viên literal của kiểu `MaCongKenh`, `StopPinRefusalReason`, `MaTuChoiYeuCau`, `SafetyPreflightReason`;
 *   • `hang_ma` — hằng `export const <TÊN_HOA> = "<MÃ>" | [ … ] | Object.freeze([ … ])` (vd `MA_ON`, `MA_STOP_QUA_HAN`, `ADAPTER_OWNED_BY_EDGE`);
 *   • `lenhHmi_reasonCode` — literal `reasonCode: "<MÃ>"` của bộ ghi lần thử (lenhHmi.ts);
 *   • `status_viet_hoa` — `commandstatusenum` viết HOA (lenhHmi bước 9 ghi `String(kq.status).toUpperCase()` khi không có reason);
 *   • `cong_biet_client` — `CONG_BIET` (client/src/components/scada/ketQuaLenh.ts, ĐỌC tệp);
 *   • `du_phong` — `MA_LOI_DU_PHONG`.
 * Chỉ mã dạng `^[A-Z][A-Z0-9_]*$` được tính (literal chữ thường như `pin_load_failed` của `StopPinRefusalReason` không bao giờ là tiền tố mã —
 * được ĐẾM riêng trong báo cáo).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { MA_LOI_DA_BIET, MA_LOI_DU_PHONG, maLoiCua, maLyDoThu } from "./_chiTietKyThuat";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LA_MA = /^[A-Z][A-Z0-9_]*$/;
type Nguon = "dispatcher_reason" | "union" | "hang_ma" | "lenhHmi_reasonCode" | "status_viet_hoa" | "cong_biet_client" | "du_phong";

const TEP_DISPATCHER = ["server/services/ot/commandDispatcher.ts", "server/services/ot/otEdgeDispatch.ts", "server/services/ot/otAdapterOwnerGate.ts"];
const TEP_UNION: Record<string, string> = {
  MaCongKenh: "server/services/ot/commandDispatcher.ts",
  StopPinRefusalReason: "server/services/ot/commandDispatcher.ts",
  MaTuChoiYeuCau: "server/services/scada/lenhHmi.ts",
  SafetyPreflightReason: "server/services/ot/safetyPreflightPolicy.ts",
};
const TEP_HANG = [
  "server/services/ot/commandDispatcher.ts",
  "server/services/ot/otAdapterOwnerGate.ts",
  "server/services/scada/lenhHmi.ts",
  "server/services/scada/dieuTietThuLenh.ts",
  "server/services/ot/drivers/mitsubishiMcDriver.ts", // T3B-0 fix m3: OT_MC_TAM_KHOA
  "server/services/ot/drivers/s7Address.ts", // R1b-2b-2a T3C: OT_S7_BIT_NGOAI_DAI, OT_S7_DIA_CHI_THU_VIEN_BO
  "server/services/ot/motPhan.ts", // R1b-2b-2a T3E: MA_MOT_PHAN (reason của dispatch / tiền tố errorText khi lô áp một phần)
  "server/services/orchestration/foe/foeEngine.ts", // C2 fix 4: FOE_OUTCOME_UNKNOWN / FOE_OUTCOME_PARTIAL (tiền tố lỗi bước orchestration)
  "server/services/orchestration/foe/foeRunStore.ts", // C2 fix 4: FOE_GATE_REQUIRED (tiền tố lỗi bước — gateRequiredError)
];

const doc = (rel: string) => ts.createSourceFile(rel, readFileSync(join(GOC, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Mọi literal chuỗi trong một biểu thức literal / điều kiện / `??` / `||` / ngoặc (không đi vào lời gọi hàm). */
function literalCua(e: ts.Expression | undefined, ra: string[]): void {
  if (!e) return;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ra.push(e.text);
  else if (ts.isConditionalExpression(e)) {
    literalCua(e.whenTrue, ra);
    literalCua(e.whenFalse, ra);
  } else if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) {
    literalCua(e.left, ra);
    literalCua(e.right, ra);
  } else if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) literalCua(e.expression, ra);
}

/** Trích theo nguồn; xuất cho ca đột biến (tệp ảo). */
export function trichDispatcher(sf: ts.SourceFile): string[] {
  const ra: string[] = [];
  const t = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && ["reason", "code"].includes(n.name.getText())) literalCua(n.initializer, ra);
    if (ts.isVariableDeclaration(n) && n.name.getText() === "reason") literalCua(n.initializer, ra);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === "writeRejected") literalCua(n.arguments[2], ra);
      if (n.expression.text === "writeAll") literalCua(n.arguments[3], ra);
    }
    ts.forEachChild(n, t);
  };
  t(sf);
  return ra;
}
function trichUnion(sf: ts.SourceFile, ten: string): string[] {
  const ra: string[] = [];
  const t = (n: ts.Node) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === ten) {
      const u = (x: ts.TypeNode) => {
        if (ts.isUnionTypeNode(x)) x.types.forEach(u);
        else if (ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal)) ra.push(x.literal.text);
        else if (ts.isParenthesizedTypeNode(x)) u(x.type);
      };
      u(n.type);
    }
    ts.forEachChild(n, t);
  };
  t(sf);
  return ra;
}
function trichHang(sf: ts.SourceFile): string[] {
  const ra: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !/^[A-Z][A-Z0-9_]*$/.test(d.name.text) || !d.initializer) continue;
      const vals: string[] = [];
      let khac = false;
      const v = (e: ts.Expression) => {
        if (ts.isStringLiteral(e)) vals.push(e.text);
        else if (ts.isAsExpression(e) || ts.isParenthesizedExpression(e)) v(e.expression);
        else if (ts.isArrayLiteralExpression(e)) e.elements.forEach((x) => v(x as ts.Expression));
        else if (ts.isCallExpression(e) && /Object\.freeze$/.test(e.expression.getText()) && e.arguments[0]) v(e.arguments[0]);
        else khac = true;
      };
      v(d.initializer);
      if (!khac && vals.length > 0 && vals.every((x) => LA_MA.test(x))) ra.push(...vals);
    }
  }
  return ra;
}
function trichReasonCodeLenhHmi(sf: ts.SourceFile): string[] {
  const ra: string[] = [];
  const t = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && n.name.getText() === "reasonCode") literalCua(n.initializer, ra);
    ts.forEachChild(n, t);
  };
  t(sf);
  return ra;
}
function trichStatus(): string[] {
  const src = readFileSync(join(GOC, "drizzle/schema/enums.ts"), "utf8");
  const m = /commandStatusEnum\s*=\s*pgEnum\(\s*"commandstatusenum"\s*,\s*\[([^\]]*)\]/.exec(src);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1].toUpperCase()) : [];
}
function trichCongBiet(): string[] {
  const src = readFileSync(join(GOC, "client/src/components/scada/ketQuaLenh.ts"), "utf8");
  const m = /export const CONG_BIET = \[([\s\S]*?)\] as const;/.exec(src);
  return m ? [...m[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((x) => x[1]) : [];
}

function nguonDo(): Record<Nguon, { ma: Set<string>; thuong: number }> {
  const goi = (xs: string[]) => ({ ma: new Set(xs.filter((x) => LA_MA.test(x))), thuong: xs.filter((x) => !LA_MA.test(x)).length });
  return {
    dispatcher_reason: goi(TEP_DISPATCHER.flatMap((f) => trichDispatcher(doc(f)))),
    union: goi(Object.entries(TEP_UNION).flatMap(([ten, f]) => trichUnion(doc(f), ten))),
    hang_ma: goi(TEP_HANG.flatMap((f) => trichHang(doc(f)))),
    lenhHmi_reasonCode: goi(trichReasonCodeLenhHmi(doc("server/services/scada/lenhHmi.ts"))),
    status_viet_hoa: goi(trichStatus()),
    cong_biet_client: goi(trichCongBiet()),
    du_phong: goi([...MA_LOI_DU_PHONG]),
  };
}

/** Sàn đo được 2026-10-30 (số mã HOA mỗi nguồn) — bộ trích hỏng ⇒ ĐỎ thay vì xanh rỗng. */
const SAN: Record<Nguon, number> = {
  dispatcher_reason: 34,
  union: 28,
  hang_ma: 7,
  lenhHmi_reasonCode: 6,
  status_viet_hoa: 8,
  cong_biet_client: 28,
  du_phong: 6,
};

describe("★★★ census — MA_LOI_DA_BIET phủ MỌI mã nguồn (polish round 2, phương án A)", () => {
  const DO = nguonDo();
  const TAT_CA = new Set(Object.values(DO).flatMap((v) => [...v.ma]));

  it("§0 bộ trích KHÔNG rỗng: mỗi nguồn ≥ sàn đo được; tổng ≥ 76", () => {
    if (process.env.IN_MA === "1") {
      console.log("NGUON=" + JSON.stringify(Object.fromEntries(Object.entries(DO).map(([k, v]) => [k, { n: v.ma.size, thuong: v.thuong, ma: [...v.ma].sort() }]))));
      console.log("TAT_CA=" + JSON.stringify([...TAT_CA].sort()));
    }
    for (const [k, v] of Object.entries(DO) as Array<[Nguon, { ma: Set<string> }]>) expect(v.ma.size, `nguồn ${k}`).toBeGreaterThanOrEqual(Math.max(1, SAN[k]));
    expect(TAT_CA.size).toBeGreaterThanOrEqual(76); // đo 2026-10-30: 76 mã HOA khác nhau
  });

  it("§1 MA_LOI_DA_BIET ⊇ tập nguồn (nêu tên từng mã thiếu); mọi mục là mã HOA", () => {
    const ds = new Set<string>(MA_LOI_DA_BIET);
    const thieu = [...TAT_CA].filter((m) => !ds.has(m)).sort();
    expect(thieu, "mã nguồn chưa có trong MA_LOI_DA_BIET (_chiTietKyThuat.ts)").toEqual([]);
    for (const m of MA_LOI_DA_BIET) expect(m, "mục không phải mã").toMatch(LA_MA);
  });

  it("§2 ĐỘT BIẾN — mã dispatcher GIẢ mới (tệp ảo) ⇒ thiếu trong danh sách ⇒ §1 sẽ đỏ, nêu đúng tên", () => {
    const sf = ts.createSourceFile(
      "x.ts",
      'async function f() { const ids = await writeRejected(db, input, "MA_GIA_MOI_C1", "x"); return { reason: cond ? "MA_GIA_HAI" : "BUSY" }; }',
      ts.ScriptTarget.Latest,
      true,
    );
    const moi = new Set([...TAT_CA, ...trichDispatcher(sf).filter((x) => LA_MA.test(x))]);
    const ds = new Set<string>(MA_LOI_DA_BIET);
    expect([...moi].filter((m) => !ds.has(m)).sort()).toEqual(["MA_GIA_HAI", "MA_GIA_MOI_C1"]);
  });

  it("§3 hành vi: nhãn kiểu tên máy ở đầu văn bản driver ⇒ mã DỰ PHÒNG; tiền tố mã đã biết ⇒ giữ; mã thuần lạ ở lần thử ⇒ dự phòng", () => {
    expect(maLoiCua("PLC01_LINE3: connect ECONNREFUSED 10.0.0.5:44818", "failed")).toBe("DRIVER_WRITE_FAILED");
    expect(maLoiCua("PLC01_LINE3: connect ECONNREFUSED 10.0.0.5:44818", "timeout")).toBe("TIMEOUT");
    expect(maLoiCua("PLC01_LINE3: connect ECONNREFUSED 10.0.0.5:44818", null)).toBe("TECHNICAL_ERROR");
    expect(maLoiCua("TAG_NOT_WRITABLE: Tag \"x\" is not writable", "rejected")).toBe("TAG_NOT_WRITABLE");
    expect(maLoiCua("INTERLOCK_BLOCKED: rule 3", "rejected")).toBe("INTERLOCK_BLOCKED");
    expect(maLyDoThu("STOP_QUA_HAN")).toBe("STOP_QUA_HAN");
    expect(maLyDoThu("BUSY")).toBe("BUSY");
    expect(maLyDoThu("PLC01_LINE3")).toBe("TECHNICAL_ERROR");
    expect(maLyDoThu("PLC01_LINE3: connect ECONNREFUSED 10.0.0.5:44818")).toBe("TECHNICAL_ERROR");
  });
});
