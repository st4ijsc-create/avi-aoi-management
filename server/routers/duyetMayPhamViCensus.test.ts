/**
 * ★★★ CENSUS AST (F5-nhanh, 2026-11-02; mở rộng theo re-review (a) Minor 2) — MỌI đường DUYỆT / TỪ CHỐI đăng ký máy và MỌI đường ĐÚC /
 * XOAY / THU HỒI khoá máy phải kiểm PHẠM VI MÁY trước khi ghi.
 *
 * Lỗ gốc: cờ `MACHINE_APPROVE_RBAC_OPEN_ENABLED` cho người không phải admin duyệt máy; tRPC `machine.approve` + socket
 * `admin:approve_registration` không kiểm phạm vi (duyệt / đúc khoá cho máy nhà máy khác); `machineApi.issueKey` đúc khoá không kiểm phạm vi.
 * Lớp lỗi "đường thứ N quên": đường MỚI không kiểm ⇒ ĐỎ.
 *
 * ĐIỂM nhận theo HÌNH DẠNG (không danh sách tên), `server/**` không test:
 *   loại DUYỆT (phải gọi `kiemPhamViDuyetMay`):
 *     · `approveMachine(` / `rejectMachine(`;
 *     · `registrationStatus: "approved" | "rejected"` trong đối số object của `updateMachine(` HOẶC của drizzle `.set(`;
 *     · `updateMachine(id, <biến>)`: biến khởi tạo bằng object literal có spread / có `registrationStatus` / không giải được ⇒ là điểm;
 *     · phát `"machine:registration_approved"` / `"machine:registration_rejected"`.
 *   loại KHOÁ (phải gọi `kiemPhamViDuyetMay` | `viTriHopLe` | `khoaMayGhi`): `issueMachineKey(` · `issueFleetMachineKey(` ·
 *     `issueMachineClaimToken(` · `rotateMachineKey(` · `revokeMachineKey(`.
 * ĐƠN VỊ = hàm (function-like) TRONG CÙNG chứa điểm (re-review Minor 2: không còn "hàm ngoài cùng" — một lời kiểm ở closure anh em không
 * được tính). Lời kiểm phải đứng TRƯỚC điểm trong đơn vị. Nhãn: thủ tục `router({...})` / handler `socket.on|once("ev", fn | tênHàm)`.
 * Có ĐỘT BIẾN cho từng hình dạng (chạy tay, ghi trong báo cáo F5-nhanh) + ca TỔNG HỢP (cuối tệp) cho từng biến thể đã biết.
 *
 * Re-review polish (2026-11-02) — biến thể thêm: `"approved" as const` (bóc as / satisfies / ngoặc / !); `.set(p)` với p giải được về object
 * có `registrationStatus`; `updateMachine(id, { ...extra })` inline có spread; gán `x.registrationStatus = "approved"` (hoặc x["registrationStatus"]);
 * lời kiểm mà KẾT QUẢ bị bỏ (`void kiemPhamViDuyetMay(...)`, `kiemPhamViDuyetMay(...)` không gán / không vào điều kiện, `viTriHopLe` không
 * await) KHÔNG được tính — kết quả của `kiemPhamViDuyetMay` phải vào một nhánh từ chối (điều kiện if / ?: đọc biến kết quả).
 *
 * GIỚI HẠN (không phát hiện được chắc chắn ⇒ KHAI ở đây, không đoán):
 *   · trạng thái lấy từ BIẾN (`registrationStatus: s`) hoặc khoá tính toán động khác chuỗi literal;
 *   · bản vá dựng ở hàm KHÁC rồi truyền vào (`updateMachine(id, dungBanVa())`) / `Object.assign` / alias tên hàm ghi;
 *   · `.set(p)` mà p KHÔNG giải được trong đơn vị (97 lời gọi `.set(bien)` khắp repo cho mọi bảng — gắn cờ bảo thủ sẽ thành dương tính giả hàng loạt);
 *   · SQL thô (`UPDATE machines SET "registrationStatus" = ...`) — hôm nay 0 chỗ trong server/** sản xuất ngoài db/hierarchy (MIEN_TEP);
 *   · "vào nhánh từ chối" kiểm theo HÌNH DẠNG (biến kết quả được đọc trong điều kiện), không chứng minh nhánh ấy thật sự dừng lời ghi.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");
const KIEM_DUYET = ["kiemPhamViDuyetMay"];
const KIEM_KHOA = ["kiemPhamViDuyetMay", "viTriHopLe", "khoaMayGhi"];
const GOI_KHOA = ["issueMachineKey", "issueFleetMachineKey", "issueMachineClaimToken", "rotateMachineKey", "revokeMachineKey"];

/** Tệp được miễn (có lý do; chỉ được thu hẹp). */
const MIEN_TEP: Record<string, string> = {
  "server/db/hierarchy.ts":
    "KHAI bộ ghi approveMachine/rejectMachine (tầng dữ liệu) + đường ENROLLMENT bằng token máy (thông tin xác thực máy, không có chủ thể người dùng)",
  "server/services/machineAuthService.ts": "KHAI các bộ đúc / xoay / thu hồi khoá (tầng dịch vụ); người gọi ở router/socket bị kiểm",
};
/** Đơn vị được miễn — CHỈ khi đơn vị còn mang đúng hình dạng nêu trong `phaiCo` (miễn gắn vào hình dạng, không gắn vào cái tên). */
const MIEN_DON_VI: Array<{ file: string; nhan: string; lyDo: string; phaiCo: RegExp }> = [
  {
    file: "server/routers/hierarchyRouters.ts",
    nhan: "thủ tục issueClaimToken",
    lyDo: "phát claim token CHỈ admin (adminProcedure) — admin luôn toàn quyền phạm vi",
    phaiCo: /^issueClaimToken:\s*adminProcedure\b/,
  },
  {
    file: "server/routers/hierarchyRouters.ts",
    nhan: "thủ tục enroll",
    lyDo: "đăng ký máy bằng ENROLLMENT TOKEN (thông tin xác thực máy do admin phát trước), không có chủ thể người dùng",
    phaiCo: /^enroll:\s*publicProcedure\b/,
  },
  {
    file: "server/routers/hierarchyRouters.ts",
    nhan: "thủ tục update",
    lyDo: "machine.update: ghi registrationStatus bị chặn cho mọi vai trừ admin ngay trong thân (doc 54 P0-2)",
    phaiCo: /data\.registrationStatus !== undefined && ctx\.user\.role !== "admin"/,
  },
];

function liet(dir: string, out: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    if (ten === "node_modules") continue;
    const p = resolve(dir, ten);
    const st = statSync(p);
    if (st.isDirectory()) liet(p, out);
    else if (/\.ts$/.test(ten) && !/\.test\.ts$/.test(ten) && !/\.d\.ts$/.test(ten)) out.push(p);
  }
  return out;
}
const tenGoi = (c: ts.CallExpression): string | null =>
  ts.isIdentifier(c.expression) ? c.expression.text : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : null;

/** Hàm được dùng làm handler theo TÊN: `socket.on("ev", tenHam)` / `.once` — tên hàm ⇒ tên sự kiện. */
function handlerTheoTen(sf: ts.SourceFile): Map<string, string> {
  const ra = new Map<string, string>();
  const di = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const t = tenGoi(n);
      const a0 = n.arguments[0];
      const a1 = n.arguments[1];
      if ((t === "on" || t === "once") && a0 && ts.isStringLiteralLike(a0) && a1 && ts.isIdentifier(a1)) ra.set(a1.text, a0.text);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}
function tenCuaHam(f: ts.Node): string | null {
  if (ts.isFunctionDeclaration(f) && f.name) return f.name.text;
  if ((ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && ts.isVariableDeclaration(f.parent) && ts.isIdentifier(f.parent.name)) return f.parent.name.text;
  return null;
}

/** Đơn vị = hàm trong cùng chứa `n`; nhãn theo thủ tục router / handler socket (gắn trực tiếp hoặc theo tên). */
function donVi(n: ts.Node, sf: ts.SourceFile, theoTen: Map<string, string>): { nut: ts.Node; nhan: string } {
  let trong: ts.Node | null = null;
  for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
    if (ts.isFunctionLike(a)) {
      trong = a;
      break;
    }
  }
  if (!trong) return { nut: sf, nhan: "cấp tệp" };
  for (let a: ts.Node | undefined = trong; a; a = a.parent) {
    if (ts.isPropertyAssignment(a) && ts.isObjectLiteralExpression(a.parent) && ts.isCallExpression(a.parent.parent) && tenGoi(a.parent.parent) === "router") {
      return { nut: trong, nhan: `thủ tục ${a.name.getText(sf)}` };
    }
    if (
      ts.isFunctionLike(a) &&
      ts.isCallExpression(a.parent) &&
      (tenGoi(a.parent) === "on" || tenGoi(a.parent) === "once") &&
      a.parent.arguments[1] === a &&
      ts.isStringLiteralLike(a.parent.arguments[0])
    ) {
      return { nut: trong, nhan: `socket.${tenGoi(a.parent)}("${(a.parent.arguments[0] as ts.StringLiteralLike).text}")` };
    }
    if (ts.isFunctionLike(a)) {
      const ten = tenCuaHam(a);
      if (ten && theoTen.has(ten)) return { nut: trong, nhan: `socket handler theo tên ${ten} ("${theoTen.get(ten)}")` };
    }
  }
  return { nut: trong, nhan: `hàm ${tenCuaHam(trong) ?? "vô danh"}` };
}

/** Bóc ngoặc / as / satisfies / ! — `"approved" as const` ⇒ `"approved"`. */
function boc(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
}
/** Chuỗi trạng thái duyệt/từ chối của một biểu thức (đã bóc), hoặc null. */
function trangThaiDuyet(e: ts.Expression | undefined): string | null {
  if (!e) return null;
  const x = boc(e);
  return ts.isStringLiteralLike(x) && (x.text === "approved" || x.text === "rejected") ? x.text : null;
}
const tenThuocTinh = (p: ts.ObjectLiteralElementLike): string | null => (p.name === undefined ? null : p.name.getText().replace(/["'`]/g, ""));
/** Khởi tạo của biến `ten` trong đơn vị (nếu có). */
function khoiTaoCua(ten: string, donViNut: ts.Node): ts.Expression | undefined {
  let ra: ts.Expression | undefined;
  const tim = (x: ts.Node) => {
    if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === ten && x.initializer) ra = x.initializer;
    if (!ra) ts.forEachChild(x, tim);
  };
  tim(donViNut);
  return ra;
}
/** `.set(bien)`: biến GIẢI ĐƯỢC về object literal (hoặc ?: của chúng) có thuộc tính `registrationStatus`. Không giải được ⇒ false (xem GIỚI HẠN). */
function bienSetCoTrangThai(bien: ts.Identifier, donViNut: ts.Node): boolean {
  const k = khoiTaoCua(bien.text, donViNut);
  if (!k) return false;
  const xet = (e: ts.Expression): boolean => {
    const x = boc(e);
    if (ts.isConditionalExpression(x)) return xet(x.whenTrue) || xet(x.whenFalse);
    return ts.isObjectLiteralExpression(x) && x.properties.some((p) => tenThuocTinh(p) === "registrationStatus");
  };
  return xet(k);
}

/**
 * Lời kiểm có ĐƯỢC DÙNG không (re-review polish): `kiemPhamViDuyetMay` trả kết quả ⇒ phải được gán vào biến (có thể qua `await` / `?:`)
 * mà biến ấy được ĐỌC trong điều kiện của một `if` / `?:` trong đơn vị, hoặc tự nó nằm trong điều kiện. `viTriHopLe` / `khoaMayGhi` NÉM khi
 * từ chối ⇒ phải được `await` (không `void`, không bỏ lửng promise).
 */
function ketQuaDuocDung(c: ts.CallExpression, donViNut: ts.Node): boolean {
  const ten = tenGoi(c);
  let x: ts.Node = c;
  let coAwait = false;
  for (;;) {
    const cha: ts.Node = x.parent;
    if (ts.isVoidExpression(cha)) return false;
    if (ts.isAwaitExpression(cha)) coAwait = true;
    if (ts.isAwaitExpression(cha) || ts.isParenthesizedExpression(cha) || ts.isAsExpression(cha) || (ts.isConditionalExpression(cha) && cha.condition !== x)) {
      x = cha;
      continue;
    }
    break;
  }
  const cha = x.parent;
  if (ten !== "kiemPhamViDuyetMay") {
    return coAwait && (ts.isExpressionStatement(cha) || ts.isReturnStatement(cha) || ts.isVariableDeclaration(cha));
  }
  const trongDieuKien = (n: ts.Node): boolean => {
    for (let a: ts.Node | undefined = n; a && a !== donViNut; a = a.parent) {
      const p: ts.Node | undefined = a.parent;
      if (p && ts.isIfStatement(p) && p.expression === a) return true;
      if (p && ts.isConditionalExpression(p) && p.condition === a) return true;
    }
    return false;
  };
  if (trongDieuKien(x)) return true;
  if (!ts.isVariableDeclaration(cha) || !ts.isIdentifier(cha.name)) return false;
  const bien = cha.name.text;
  const tenNut = cha.name;
  let docTrongDieuKien = false;
  const tim = (n: ts.Node) => {
    if (docTrongDieuKien) return;
    if (ts.isIdentifier(n) && n.text === bien && n !== tenNut && trongDieuKien(n)) docTrongDieuKien = true;
    ts.forEachChild(n, tim);
  };
  tim(donViNut);
  return docTrongDieuKien;
}

/** `updateMachine(id, bien)`: biến có thể chở registrationStatus không (giải trong đơn vị; không giải được ⇒ CÓ — bảo thủ). */
function bienCoTheChoTrangThai(bien: ts.Identifier, donViNut: ts.Node): boolean {
  let khoiTao: ts.Expression | undefined;
  const tim = (x: ts.Node) => {
    if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === bien.text && x.initializer) khoiTao = x.initializer;
    if (!khoiTao) ts.forEachChild(x, tim);
  };
  tim(donViNut);
  if (!khoiTao) return true;
  const xet = (e: ts.Expression): boolean => {
    let x: ts.Expression = e;
    while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
    if (ts.isConditionalExpression(x)) return xet(x.whenTrue) || xet(x.whenFalse);
    if (!ts.isObjectLiteralExpression(x)) return true;
    return x.properties.some((p) => ts.isSpreadAssignment(p) || (p.name !== undefined && p.name.getText() === "registrationStatus"));
  };
  return xet(khoiTao);
}

interface Diem {
  file: string;
  dong: number;
  nhan: string;
  loai: "duyet" | "khoa";
  chiTiet: string;
  daKiemTruoc: boolean;
  textDonVi: string;
}
function quet(file: string, ma: string): Diem[] {
  const sf = ts.createSourceFile(file, ma, ts.ScriptTarget.Latest, true);
  const theoTen = handlerTheoTen(sf);
  const ra: Diem[] = [];
  const them = (n: ts.Node, loai: "duyet" | "khoa", chiTiet: string) => {
    const dv = donVi(n, sf, theoTen);
    const kiem = loai === "duyet" ? KIEM_DUYET : KIEM_KHOA;
    let daKiemTruoc = false;
    const tim = (x: ts.Node) => {
      if (ts.isCallExpression(x) && kiem.includes(tenGoi(x) ?? "") && x.getStart(sf) < n.getStart(sf) && ketQuaDuocDung(x, dv.nut)) daKiemTruoc = true;
      ts.forEachChild(x, tim);
    };
    tim(dv.nut);
    // văn bản để đối chiếu miễn: thuộc tính router (nếu có) hoặc chính đơn vị
    let txt = dv.nut.getText(sf);
    for (let a: ts.Node | undefined = dv.nut; a; a = a.parent) {
      if (ts.isPropertyAssignment(a) && ts.isObjectLiteralExpression(a.parent) && ts.isCallExpression(a.parent.parent) && tenGoi(a.parent.parent) === "router") {
        txt = a.getText(sf);
        break;
      }
    }
    ra.push({ file, dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, nhan: dv.nhan, loai, chiTiet, daKiemTruoc, textDonVi: txt });
  };
  const di = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const t = tenGoi(n);
      if (t === "approveMachine" || t === "rejectMachine") them(n, "duyet", t);
      if (t && GOI_KHOA.includes(t)) them(n, "khoa", t);
      if (t === "updateMachine" && n.arguments[1] && ts.isIdentifier(boc(n.arguments[1]))) {
        const dv = donVi(n, sf, theoTen);
        const bien = boc(n.arguments[1]) as ts.Identifier;
        if (bienCoTheChoTrangThai(bien, dv.nut)) them(n, "duyet", `updateMachine(id, ${bien.text})`);
      }
      // updateMachine(id, { ...extra }) inline: spread có thể chở registrationStatus
      if (t === "updateMachine" && n.arguments[1]) {
        const o = boc(n.arguments[1]);
        if (ts.isObjectLiteralExpression(o) && o.properties.some((pp) => ts.isSpreadAssignment(pp))) them(n, "duyet", "updateMachine(id, { ...spread })");
      }
      // drizzle .set(bien) — chỉ khi biến giải được về object có registrationStatus (xem GIỚI HẠN)
      if (t === "set" && n.arguments.length === 1 && ts.isIdentifier(boc(n.arguments[0]))) {
        const dv = donVi(n, sf, theoTen);
        const bien = boc(n.arguments[0]) as ts.Identifier;
        if (bienSetCoTrangThai(bien, dv.nut)) them(n, "duyet", `set(${bien.text})`);
      }
    }
    if (ts.isPropertyAssignment(n) && tenThuocTinh(n) === "registrationStatus" && trangThaiDuyet(n.initializer)) {
      const tt = trangThaiDuyet(n.initializer);
      for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
        if (ts.isCallExpression(a)) {
          const t = tenGoi(a);
          if (t === "updateMachine" || t === "set") them(n, "duyet", `${t}(registrationStatus:${tt})`);
          break;
        }
      }
    }
    // gán thẳng: x.registrationStatus = "approved" | x["registrationStatus"] = "rejected"
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && trangThaiDuyet(n.right)) {
      const l = n.left;
      const laTrangThai =
        (ts.isPropertyAccessExpression(l) && l.name.text === "registrationStatus") ||
        (ts.isElementAccessExpression(l) && ts.isStringLiteralLike(l.argumentExpression) && l.argumentExpression.text === "registrationStatus");
      if (laTrangThai) them(n, "duyet", `gán .registrationStatus = ${trangThaiDuyet(n.right)}`);
    }
    if (ts.isStringLiteralLike(n) && (n.text === "machine:registration_approved" || n.text === "machine:registration_rejected")) {
      them(n, "duyet", `emit ${n.text}`);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

const TAT_CA = liet(resolve(GOC, "server")).flatMap((p) => {
  const ma = readFileSync(p, "utf8");
  if (!/approveMachine|rejectMachine|registrationStatus|registration_(approved|rejected)|updateMachine|MachineKey|MachineClaimToken/.test(ma)) return [];
  return quet(rel(p), ma);
});
const mienDonVi = (d: Diem) => MIEN_DON_VI.find((m) => m.file === d.file && m.nhan === d.nhan);

describe("★★★ F5-nhanh — census: duyệt / từ chối máy và đúc / xoay / thu hồi khoá máy đều kiểm phạm vi máy", () => {
  it("thiết bị đo tự canh: thấy đủ các đường đã biết", () => {
    const nhan = new Set(TAT_CA.filter((d) => !MIEN_TEP[d.file]).map((d) => `${d.file} :: ${d.nhan} :: ${d.loai}`));
    expect([...nhan]).toEqual(
      expect.arrayContaining([
        "server/routers/hierarchyRouters.ts :: thủ tục approve :: duyet",
        "server/routers/hierarchyRouters.ts :: thủ tục approve :: khoa",
        "server/routers/hierarchyRouters.ts :: thủ tục reject :: duyet",
        'server/_core/socket.ts :: socket.on("admin:approve_registration") :: duyet',
        'server/_core/socket.ts :: socket.on("admin:approve_registration") :: khoa',
        'server/_core/socket.ts :: socket.on("admin:reject_registration") :: duyet',
        "server/routers/machineApiRouters.ts :: thủ tục issueKey :: khoa",
        "server/routers/machineApiRouters.ts :: thủ tục rotateKey :: khoa",
        "server/routers/machineApiRouters.ts :: thủ tục revokeKey :: khoa",
      ]),
    );
  });

  it("mỗi điểm (ngoài MIEN) có lời kiểm phạm vi đứng TRƯỚC nó trong CÙNG hàm trong cùng", () => {
    const loi = TAT_CA.filter((d) => !MIEN_TEP[d.file] && !mienDonVi(d) && !d.daKiemTruoc).map(
      (d) => `${d.file}:${d.dong} [${d.loai}: ${d.chiTiet}] trong ${d.nhan}: thiếu ${d.loai === "duyet" ? KIEM_DUYET.join("|") : KIEM_KHOA.join("|")} TRƯỚC điểm này`,
    );
    expect(loi).toEqual([]);
  });

  it("miễn theo đơn vị chỉ còn hiệu lực khi đơn vị còn đúng HÌNH DẠNG đã nêu; MIEN mồ côi ⇒ ĐỎ", () => {
    const loi: string[] = [];
    for (const m of MIEN_DON_VI) {
      const ds = TAT_CA.filter((d) => d.file === m.file && d.nhan === m.nhan);
      if (ds.length === 0) loi.push(`MIEN_DON_VI mồ côi: ${m.file} :: ${m.nhan}`);
      for (const d of ds) if (!m.phaiCo.test(d.textDonVi.trim())) loi.push(`${m.file} :: ${m.nhan} không còn hình dạng được miễn (${m.phaiCo})`);
    }
    for (const f of Object.keys(MIEN_TEP)) if (!TAT_CA.some((d) => d.file === f)) loi.push(`MIEN_TEP mồ côi: ${f}`);
    expect(loi).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Re-review polish — CA TỔNG HỢP: mỗi biến thể đã biết phải tạo ra một điểm KHÔNG được kiểm (⇒ census ĐỎ); đối chứng đúng hình dạng ⇒ xanh
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ census tổng hợp — biến thể phải ĐỎ, hình dạng đúng phải xanh", () => {
  const boc1 = (than: string) => `export const r = router({ duyet: p.mutation(async ({ input, ctx }) => { ${than} }) });`;
  const coDiemHo = (ma: string) => quet("server/routers/zz_tong_hop.ts", ma).some((d) => !d.daKiemTruoc);
  const KIEM_DUNG = "const pv = await kiemPhamViDuyetMay(phamViCua(ctx), input.id); if (!pv.ok) throw new Error('nf');";

  it("(T1) registrationStatus: \"approved\" as const trong updateMachine ⇒ điểm hở; đối chứng có kiểm ⇒ xanh", () => {
    expect(coDiemHo(boc1(`await db.updateMachine(input.id, { registrationStatus: "approved" as const });`))).toBe(true);
    expect(coDiemHo(boc1(`${KIEM_DUNG} await db.updateMachine(input.id, { registrationStatus: "approved" as const });`))).toBe(false);
  });
  it("(T2) .set(p) với p giữ registrationStatus ⇒ điểm hở; .set(p) không có trạng thái ⇒ không phải điểm", () => {
    expect(coDiemHo(boc1(`const p = { registrationStatus: "approved" }; await d.update(machines).set(p);`))).toBe(true);
    expect(quet("server/routers/zz.ts", boc1(`const p = { name: "x" }; await d.update(machines).set(p);`))).toHaveLength(0);
  });
  it("(T3) updateMachine(id, { ...extra }) inline ⇒ điểm hở", () => {
    expect(coDiemHo(boc1(`await db.updateMachine(input.id, { ...input.extra });`))).toBe(true);
  });
  it("(T4) patch.registrationStatus = \"approved\" / patch[\"registrationStatus\"] = \"rejected\" ⇒ điểm hở", () => {
    expect(coDiemHo(boc1(`const patch: any = {}; patch.registrationStatus = "approved"; await db.updateMachine(input.id, patch);`))).toBe(true);
    expect(coDiemHo(boc1(`const patch: any = {}; patch["registrationStatus"] = "rejected";`))).toBe(true);
  });
  it("(T5) kết quả kiểm bị BỎ (void / không gán / gán mà không đọc trong điều kiện / viTriHopLe không await) ⇒ điểm hở; đọc trong nhánh từ chối ⇒ xanh", () => {
    const ghi = "await db.approveMachine(input.id, {});";
    expect(coDiemHo(boc1(`void kiemPhamViDuyetMay(phamViCua(ctx), input.id); ${ghi}`))).toBe(true);
    expect(coDiemHo(boc1(`await kiemPhamViDuyetMay(phamViCua(ctx), input.id); ${ghi}`))).toBe(true);
    expect(coDiemHo(boc1(`const pv = await kiemPhamViDuyetMay(phamViCua(ctx), input.id); console.log(pv); ${ghi}`))).toBe(true);
    expect(coDiemHo(boc1(`${KIEM_DUNG} ${ghi}`))).toBe(false);
    expect(coDiemHo(boc1(`const pv = x ? await kiemPhamViDuyetMay(phamViCua(ctx), input.id) : null; const m = pv?.ok ? 1 : 0; ${ghi}`))).toBe(false);
    const khoa = "return issueMachineKey({ machineId: input.id });";
    expect(coDiemHo(boc1(`void viTriHopLe(ctx, { machineId: input.id }, "machine"); ${khoa}`))).toBe(true);
    expect(coDiemHo(boc1(`viTriHopLe(ctx, { machineId: input.id }, "machine"); ${khoa}`))).toBe(true);
    expect(coDiemHo(boc1(`await viTriHopLe(ctx, { machineId: input.id }, "machine"); ${khoa}`))).toBe(false);
  });
});
