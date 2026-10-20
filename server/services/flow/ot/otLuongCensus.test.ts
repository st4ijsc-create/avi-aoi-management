/**
 * ★★★ Đợt 8.5 — CENSUS "ĐIỂM GỌI = 1 HÀM BAO" của Luồng AI (spec §6 hàng 8.5). Lượng từ là ∀, suy từ mã — không danh sách tay:
 *
 *   (A) ∀ tệp sản xuất dưới `server/services/flow/**`: KHÔNG import một module thuộc ĐƯỜNG THỰC THI — dispatcher OT
 *       (`ot/commandDispatcher`), dispatcher robot (`robot/robotCommandDispatcher`), động cơ FOE (`orchestration/foe/foeEngine`),
 *       và ∀ module sản xuất nào khác dưới `server/**` import một trong ba (tập SUY RA, ví dụ `equipmentAdapter`,
 *       `aiLocalTools/writeHandlers/*`, `orchestrationRouter`…) — cộng cả cây `server/services/{ot,robot,orchestration,equipment}`
 *       và `aiCopilotActions` (confirm ⇒ execute). Ngoại lệ DUY NHẤT: `flow/ot/congOtLuong.ts` import `ot/aiControlGate` (thuần).
 *   (B) ∀ tệp ấy: không định danh nào trong mã (AST, không tính chú thích/chuỗi) thuộc tập tên đường thực thi THẬT:
 *       `dispatch`, `dispatchRobotJob`, `sendCommand`, `writeTags`, `startRun`, `resumeRun`, `deployWorkflow`, `rollbackWorkflow`,
 *       `abortRun`, `confirmAction`, `proposeAction`, `commandDispatcher`, `robotCommandDispatcher`, `foeEngine`.
 *   (C) ∀ node hạng `ot` trong SỔ ĐĂNG KÝ (lúc chạy, `danhSachNut()`): khai ở một lời gọi `dangKyNut({...})` có `type` +
 *       `tacDungPhu` là chữ cố định, và thân `chay` GỌI `kiemVaDeXuat` nhập từ `flow/ot/congOtLuong`. Node ot thứ N+1 không
 *       khai / không gọi ⇒ ĐỎ (đảo lượng từ: đi từ sổ đăng ký, không từ danh sách tệp).
 *   (D) `congOtLuong.ts` thật sự gọi `phanLoaiMuc` + `kiemCongAi` (hàm bao không rỗng ruột).
 * Bộ quét tự kiểm bằng đột biến trên mã tổng hợp (§đột biến) — một bộ quét không bắt được gì là chân lý rỗng.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { danhSachNut } from "../dangKyNut";
import "../nut";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const rel = (p: string) => relative(GOC, p).split(sep).join("/");
const boDuoi = (p: string) => p.replace(/\.(ts|tsx|js|mjs)$/, "").replace(/\/index$/, "");

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

/** Mọi chỉ định module (tĩnh, export-from, `import()` / `require()` với chuỗi cố định), đã phân giải về `server/...` (không đuôi). */
function nhapCua(tepRel: string, nguon: ts.SourceFile): { dich: string; mu: boolean }[] {
  const ra: { dich: string; mu: boolean }[] = [];
  const them = (spec: ts.Expression | undefined) => {
    if (!spec) return;
    if (!ts.isStringLiteralLike(spec)) {
      ra.push({ dich: "(động)", mu: true });
      return;
    }
    const s = spec.text;
    ra.push({ dich: s.startsWith(".") ? boDuoi(rel(resolve(GOC, dirname(tepRel), s))) : s, mu: false });
  };
  const di = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) them(n.moduleSpecifier);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      them(n.arguments[0]);
    }
    ts.forEachChild(n, di);
  };
  di(nguon);
  return ra;
}

export const TEN_THUC_THI = new Set([
  "dispatch", "dispatchRobotJob", "sendCommand", "writeTags", "startRun", "resumeRun", "deployWorkflow", "rollbackWorkflow",
  "abortRun", "confirmAction", "proposeAction", "commandDispatcher", "robotCommandDispatcher", "foeEngine",
]);

const GOC_THUC_THI = ["server/services/ot/commandDispatcher", "server/services/robot/robotCommandDispatcher", "server/services/orchestration/foe/foeEngine"];
const CAY_CAM = ["server/services/ot/", "server/services/robot/", "server/services/orchestration/", "server/services/equipment/", "server/services/aiLocalTools/"];
const MODULE_CAM = new Set(["server/services/aiCopilotActions"]);
const CONG_OT = "server/services/flow/ot/congOtLuong";
const AI_CONTROL_GATE = "server/services/ot/aiControlGate";

/** (A') Tập SUY RA: mọi module sản xuất dưới `server/**` import thẳng một trong ba gốc thực thi (+ chính ba gốc). */
function tapThucThiSuyRa(): Set<string> {
  const tap = new Set(GOC_THUC_THI);
  for (const p of moiTep(join(GOC, "server"))) {
    const src = readFileSync(p, "utf8");
    if (!/commandDispatcher|robotCommandDispatcher|foeEngine/.test(src)) continue;
    const r = rel(p);
    const sf = ts.createSourceFile(r, src, ts.ScriptTarget.Latest, true);
    if (nhapCua(r, sf).some((x) => GOC_THUC_THI.includes(x.dich))) tap.add(boDuoi(r));
  }
  return tap;
}

export interface ViPham {
  tep: string;
  loai: "import-cam" | "ten-thuc-thi" | "nut-ot-khong-qua-ham-bao" | "mu";
  chiTiet: string;
}
export interface NutKhai {
  type: string;
  tacDungPhu: string;
  goiHamBao: boolean;
  tep: string;
}

/** Quét MỘT tệp (đường dẫn tương đối gốc repo + mã). Thuần — dùng chung cho mã thật và đột biến tổng hợp. */
export function quetTep(tepRel: string, src: string, tapThucThi: ReadonlySet<string>): { viPham: ViPham[]; nut: NutKhai[] } {
  const viPham: ViPham[] = [];
  const nut: NutKhai[] = [];
  const sf = ts.createSourceFile(tepRel, src, ts.ScriptTarget.Latest, true);
  const tepKhongDuoi = boDuoi(tepRel);
  // (A) import
  const tenNhapHamBao = new Set<string>();
  for (const x of nhapCua(tepRel, sf)) {
    if (x.mu) {
      viPham.push({ tep: tepRel, loai: "mu", chiTiet: "import()/require() với chỉ định không cố định" });
      continue;
    }
    if (x.dich === AI_CONTROL_GATE && tepKhongDuoi === CONG_OT) continue;
    if (tapThucThi.has(x.dich) || MODULE_CAM.has(x.dich) || CAY_CAM.some((c) => x.dich.startsWith(c))) {
      viPham.push({ tep: tepRel, loai: "import-cam", chiTiet: x.dich });
    }
  }
  sf.forEachChild(function di(n) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith(".")) {
      const dich = boDuoi(rel(resolve(GOC, dirname(tepRel), n.moduleSpecifier.text)));
      const nb = n.importClause?.namedBindings;
      if (dich === CONG_OT && nb && ts.isNamedImports(nb)) {
        for (const e of nb.elements) if ((e.propertyName ?? e.name).text === "kiemVaDeXuat") tenNhapHamBao.add(e.name.text);
      }
    }
  });
  if (tepKhongDuoi === CONG_OT) tenNhapHamBao.add("kiemVaDeXuat");
  // (B) định danh
  const di = (n: ts.Node) => {
    if (ts.isIdentifier(n) && TEN_THUC_THI.has(n.text)) viPham.push({ tep: tepRel, loai: "ten-thuc-thi", chiTiet: n.text });
    // (C) dangKyNut({...})
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "dangKyNut") {
      const obj = n.arguments[0];
      if (!obj || !ts.isObjectLiteralExpression(obj)) {
        viPham.push({ tep: tepRel, loai: "mu", chiTiet: "dangKyNut(...) không nhận đối tượng chữ" });
      } else {
        const lay = (ten: string) => obj.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === ten);
        const chu = (ten: string): string | null => {
          const p = lay(ten);
          return p && ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : null;
        };
        const type = chu("type");
        const hang = chu("tacDungPhu");
        // `type` là hằng số (vd `LOAI_GOI_LUONG_CON`) chỉ chấp nhận khi hạng là chữ cố định KHÁC "ot"; node ot phải khai chữ
        // cố định cả hai ô — không thì (C) không đối chiếu được sổ đăng ký với mã ⇒ mù ⇒ đỏ.
        if (hang === null || (type === null && hang === "ot")) {
          viPham.push({ tep: tepRel, loai: "mu", chiTiet: `dangKyNut: type/tacDungPhu không phải chữ cố định (${type ?? "?"})` });
        } else if (type === null) {
          nut.push({ type: "(hằng)", tacDungPhu: hang, goiHamBao: false, tep: tepRel });
        } else {
          const chay = lay("chay");
          let goi = false;
          const tim = (m: ts.Node) => {
            if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && tenNhapHamBao.has(m.expression.text)) goi = true;
            ts.forEachChild(m, tim);
          };
          if (chay) tim(chay);
          nut.push({ type, tacDungPhu: hang, goiHamBao: goi, tep: tepRel });
          if (hang === "ot" && !goi) viPham.push({ tep: tepRel, loai: "nut-ot-khong-qua-ham-bao", chiTiet: type });
        }
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { viPham, nut };
}

const TAP = tapThucThiSuyRa();
const TEP_FLOW = moiTep(join(GOC, "server/services/flow")).map((p) => ({ r: rel(p), src: readFileSync(p, "utf8") }));
const QUET = TEP_FLOW.map((t) => quetTep(t.r, t.src, TAP));
const VI_PHAM = QUET.flatMap((q) => q.viPham);
const NUT = QUET.flatMap((q) => q.nut);

describe("★★★ Đợt 8.5 — census: Luồng AI chạm OT CHỈ qua một hàm bao", () => {
  it("cầu chì: bộ quét thấy tệp, tập thực thi suy ra đủ lớn, sổ có node", () => {
    expect(TEP_FLOW.length).toBeGreaterThanOrEqual(15);
    expect(TAP.size, "tập module đường thực thi suy ra quá nhỏ ⇒ bộ suy mù").toBeGreaterThanOrEqual(10);
    for (const g of GOC_THUC_THI) expect(TAP.has(g)).toBe(true);
    expect([...TAP].some((x) => x.startsWith("server/services/aiLocalTools/writeHandlers/")), "writeHandlers phải nằm trong tập suy ra").toBe(true);
    expect(NUT.length).toBeGreaterThanOrEqual(10);
  });

  it("★★★ (A)(B) 0 import / 0 định danh đường thực thi dưới server/services/flow/**", () => {
    expect(VI_PHAM.map((v) => `${v.tep}: ${v.loai} ${v.chiTiet}`)).toEqual([]);
  });

  it("★★★ (C) ∀ node hạng `ot` của SỔ ĐĂNG KÝ đều khai cố định và gọi `kiemVaDeXuat`", () => {
    const otSo = danhSachNut().filter((n) => n.tacDungPhu === "ot").map((n) => n.type).sort();
    expect(otSo.length, "không có node ot nào ⇒ lượng từ rỗng").toBeGreaterThanOrEqual(2);
    for (const t of otSo) {
      const k = NUT.find((n) => n.type === t);
      expect(k, `node ot '${t}' trong sổ đăng ký nhưng KHÔNG tìm thấy lời khai dangKyNut cố định dưới flow/**`).toBeDefined();
      expect(k!.tacDungPhu, t).toBe("ot");
      expect(k!.goiHamBao, `node ot '${t}' (${k!.tep}) không gọi kiemVaDeXuat`).toBe(true);
    }
    // chiều ngược: lời khai ot trong mã ⇒ phải có trong sổ (không khai "ma")
    expect(NUT.filter((n) => n.tacDungPhu === "ot").map((n) => n.type).sort()).toEqual(otSo);
  });

  it("(C') chỉ congOtLuong.ts import aiControlGate; chỉ node ot gọi hàm bao", () => {
    const nhapGate = TEP_FLOW.filter((t) => /aiControlGate/.test(t.src) && /from\s+"[^"]*aiControlGate"/.test(t.src)).map((t) => t.r);
    expect(nhapGate).toEqual(["server/services/flow/ot/congOtLuong.ts"]);
    expect(NUT.filter((n) => n.goiHamBao && n.tacDungPhu !== "ot").map((n) => n.type)).toEqual([]);
  });

  it("(D) hàm bao thật sự gọi phanLoaiMuc + kiemCongAi", () => {
    const src = TEP_FLOW.find((t) => t.r === "server/services/flow/ot/congOtLuong.ts")!.src;
    const sf = ts.createSourceFile("c.ts", src, ts.ScriptTarget.Latest, true);
    const goi = new Set<string>();
    const di = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) goi.add(n.expression.text);
      ts.forEachChild(n, di);
    };
    di(sf);
    expect(goi.has("phanLoaiMuc")).toBe(true);
    expect(goi.has("kiemCongAi")).toBe(true);
  });

  describe("§đột biến — bộ quét phải ĐỎ trên từng lỗ", () => {
    const T = "server/services/flow/nut/thu.ts";
    const vp = (src: string, tep = T) => quetTep(tep, src, TAP).viPham.map((v) => v.loai);
    it.each([
      ["import dispatcher OT", `import { dispatch as d } from "../../ot/commandDispatcher"; d({} as never);`, "import-cam"],
      ["import động robot", `async function f(){ await import("../../robot/robotCommandDispatcher"); }`, "import-cam"],
      ["import động cơ FOE", `import { startRun as s } from "../../orchestration/foe/foeEngine";`, "import-cam"],
      ["import module SUY RA (equipmentAdapter)", `import "../../equipment/equipmentAdapter";`, "import-cam"],
      ["import aiControlGate ngoài hàm bao", `import { kiemCongAi as k } from "../../ot/aiControlGate";`, "import-cam"],
      ["import confirmAction", `import { confirmAction as c } from "../../aiCopilotActions";`, "import-cam"],
      ["import động chỉ định biến", `const m = "x"; async function f(){ await import(m); }`, "mu"],
      ["định danh dispatch", `const o: any = {}; o.dispatch({});`, "ten-thuc-thi"],
      ["định danh sendCommand", `const o: any = {}; o.sendCommand({});`, "ten-thuc-thi"],
      [
        "node ot KHÔNG gọi hàm bao",
        `import { dangKyNut } from "../dangKyNut"; dangKyNut({ type: "ot.lau", typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"], tacDungPhu: "ot", lapLai: "atMostOnce", async chay() { return { main: [] }; } });`,
        "nut-ot-khong-qua-ham-bao",
      ],
      [
        "node ot gọi một hàm TRÙNG TÊN không nhập từ hàm bao",
        `import { dangKyNut } from "../dangKyNut"; const kiemVaDeXuat = async () => 1; dangKyNut({ type: "ot.gia", typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"], tacDungPhu: "ot", lapLai: "atMostOnce", async chay() { await kiemVaDeXuat(); return { main: [] }; } });`,
        "nut-ot-khong-qua-ham-bao",
      ],
      [
        "hạng không phải chữ cố định",
        `import { dangKyNut } from "../dangKyNut"; const h = "ot" as const; dangKyNut({ type: "ot.an", typeVersion: 1, laKichHoat: false, congVao: [], congRa: [], tacDungPhu: h, lapLai: "atMostOnce", async chay() { return {}; } });`,
        "mu",
      ],
    ])("%s ⇒ ĐỎ", (_ten, src, loai) => {
      expect(vp(src)).toContain(loai);
    });
    it("đối chứng dương: node ot nhập và gọi kiemVaDeXuat ⇒ XANH", () => {
      const src = `import { dangKyNut } from "../dangKyNut"; import { kiemVaDeXuat as k } from "../ot/congOtLuong"; dangKyNut({ type: "ot.tot", typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"], tacDungPhu: "ot", lapLai: "atMostOnce", async chay(_t, n) { return (await k({ loai: "lenh", may: 1, lenh: "stop" }, n as never)) as never; } });`;
      expect(vp(src)).toEqual([]);
    });
  });
});
