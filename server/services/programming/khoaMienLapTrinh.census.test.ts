/**
 * ★★★ SCADA R1b-2b-2a T6d (AN TOÀN, dieu-phoi 2026-11-01) — CENSUS: MỌI khoá idempotency lấy từ input BÊN GỌI (tRPC input / REST body / tham số) đi tới
 * `dispatch()` OT (trực tiếp, qua `sendCommand` / adapter lập trình, hoặc qua tra cứu / ghi `program_deployments`) phải đi qua HÀM ĐẶT MIỀN khoá
 * (`khoaMienLapTrinh` / `tienToMienLapTrinh` / `khoaDispatchLapTrinh`). Quét AST (TypeScript compiler API), không regex dòng.
 *
 * (A) Bề mặt bên gọi — mọi tệp nguồn (không test) dưới `server/routers`, `server/routes`, `server/api`: trong một lời gọi tới hàm thuộc `DIEM_TOI_DISPATCH`,
 *     mọi "khoá bên gọi" xuất hiện trong ĐỐI SỐ phải nằm bên trong một lời gọi hàm đặt miền. Khoá bên gọi =
 *       • biểu thức `<gốc>(.x)*.idempotencyKey` / `.idempotencyKeyPrefix` với gốc ∈ {input, body, req, params, query, args, cmd};
 *       • định danh của một biến khai báo (cùng tệp) có bộ khởi tạo chứa khoá bên gọi CHƯA đặt miền (lan theo khai báo tới điểm bất động: `const k =
 *         body.idempotencyKey?.trim() || nanoid(); const command = buildCommand(…, k, …)` ⇒ `command` cũng là khoá bên gọi).
 *     Miễn trừ có tên, mỗi mục có lý do (`MIEN_TRU_VI_TRI` / `TRUONG_MIEN_TRU`): khoá CŨ chưa đặt miền chỉ dùng để tra hàng TRƯỚC T6d của CHÍNH người gọi
 *     (`timDeployTruoc` lọc `requestedBy`), và đường REST robot (robot_jobs, chốt R-1C-i của robot; mọi lệnh không phải robot ⇒ 501 trước dispatcher).
 * (B) Sổ cái MỌI tham chiếu tới `dispatch` của commandDispatcher trong `server/**` (không test): nhập tĩnh `import { dispatch [as x] }`, nhập động
 *     `const { dispatch } = await import(…commandDispatcher)` hoặc `ns.dispatch` của `import * as ns` / `const ns = await import(…)`. Mỗi tham chiếu (lời gọi
 *     hoặc truyền như giá trị) phải nằm trong `SO_CAI_DISPATCH` với NGUỒN KHOÁ đã phân loại; đường lập trình (`mien_lap_trinh`) phải có thuộc tính
 *     `idempotencyKey` của đối số là lời gọi `khoaDispatchLapTrinh(…)` (A2(a): hoặc định danh của `const x = khoaDispatchLapTrinh(…)` trong CÙNG hàm — hàm trả
 *     null khi phần bên gọi rỗng, bên gọi từ chối trước dispatch()). Điểm mới / điểm biến mất ⇒ đỏ.
 * (D) T6d fix 1 (review M4) — sổ cái MỌI chỗ tra / ghi `program_deployments` theo khoá (`eq(programDeployments.idempotencyKey, …)` / `.insert(programDeployments)`)
 *     trong `server/**`: chỗ tra phải lọc `requestedBy`; nguồn khoá đã phân loại (`mien_trong_ham` ⇒ hàm bao gọi hàm đặt miền — vd URSim deploy).
 * Chống quét rỗng: (A) tập điểm gọi ĐÃ đặt miền ĐÚNG bằng `DIEM_DA_DAT_MIEN`; (B), (D) tập tham chiếu ĐÚNG bằng sổ cái; số tệp quét > 0.
 *
 * GIỚI HẠN (ghi rõ): (A) lan khoá bên gọi chỉ qua KHAI BÁO biến trong cùng tệp (không qua phép gán lại, tham số hàm, thuộc tính đối tượng dựng rời);
 * (B) không phân giải `dispatch` truyền qua nhiều lớp biến (vd `const f = dispatch; f(…)` được đếm là MỘT tham chiếu ở chỗ gán — vẫn vào sổ cái);
 * (B') A2(a) fix round 1 — khoá truyền qua `const`: chốt null chỉ nhận dạng `if (x === null | == null) return / throw` (không `if (!x)`, không hàm chốt riêng,
 *     không `?? `); thứ tự xét theo VỊ TRÍ trong mã + khối bao, không theo luồng điều khiển (chốt trong `try` bị `catch` nuốt vẫn được tính); đếm khai báo
 *     tính cả hàm lồng (khắt khe hơn phạm vi thật — một tên trùng trong hàm lồng cũng làm điểm gọi đỏ).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const THU_MUC_BEN_GOI = ["server/routers", "server/routes", "server/api"];
// T6d fix 1 (review M4): + `deployUrscriptToUrsim` (ghi `program_deployments` theo khoá bên gọi; đặt miền trong hàm + §D) — bên gọi mới từ input ⇒ (A) bắt
const DIEM_TOI_DISPATCH = new Set(["deployBuild", "requestDeployApproval", "rollbackDeployment", "deployToFleet", "assertIdempotencyKeyConsistent", "dispatch", "executeCommand", "sendCommand", "deployUrscriptToUrsim"]);
const HAM_DAT_MIEN = new Set(["khoaMienLapTrinh", "tienToMienLapTrinh", "khoaDispatchLapTrinh"]);
const GOC_BEN_GOI = new Set(["input", "body", "req", "params", "query", "args", "cmd"]);
const TRUONG_KHOA = new Set(["idempotencyKey", "idempotencyKeyPrefix"]);
/** Thuộc tính đối tượng được phép mang khoá CHƯA đặt miền: khoá CŨ — chỉ tra hàng TRƯỚC T6d của CHÍNH người gọi (`timDeployTruoc` lọc requestedBy). */
const TRUONG_MIEN_TRU = new Set(["khoaCu", "tienToCu"]);
/** Đối số VỊ TRÍ (0-based) được phép mang khoá chưa đặt miền — cùng lý do khoá cũ của chính người gọi. */
const MIEN_TRU_VI_TRI: Record<string, number[]> = {
  assertIdempotencyKeyConsistent: [2], // khoaBenGoi: tra hàng cũ của chính người gọi + văn bản CONFLICT (không phải khoá lưu / dispatch)
  rollbackDeployment: [4], // khoaCu
};
/** Điểm gọi được miễn CẢ điểm (tệp#hàm-bao#điểm) — lý do bắt buộc. */
const DIEM_MIEN_TRU: Record<string, string> = {
};

/** (A) Điểm gọi (tệp#hàm-bao#điểm) có khoá bên gọi ĐÃ đặt miền — đo lúc viết T6d. */
const DIEM_DA_DAT_MIEN = [
  "server/routers/programmingRouter.ts#deployBuild#assertIdempotencyKeyConsistent",
  "server/routers/programmingRouter.ts#deployBuild#deployBuild",
  "server/routers/programmingRouter.ts#requestDeployApproval#assertIdempotencyKeyConsistent",
  "server/routers/programmingRouter.ts#requestDeployApproval#requestDeployApproval",
  "server/routers/programmingRouter.ts#rollbackDeployment#rollbackDeployment",
  "server/routers/programmingRouter.ts#deployToFleet#deployToFleet",
].sort();

type NguonKhoa = "may_chu" | "mien_lap_trinh" | "uy_quyen_ben_goi";
/**
 * (B) SỔ CÁI mọi tham chiếu `dispatch` (commandDispatcher) ngoài test — tệp#hàm-bao → [nguồn khoá, lý do]. `uy_quyen_ben_goi` = khoá do bên gọi NỘI BỘ
 * của hàm truyền vào (hàm là cổng chung); các bên gọi ấy nằm trong (A) hoặc là mã máy chủ.
 */
const SO_CAI_DISPATCH: Record<string, [NguonKhoa, string]> = {
  "server/services/aiLocalTools/writeHandlers/machineControl.ts#runDispatch": ["may_chu", "(khoá do executeMachineControl đặt) ctx.actionId (hàng ai_pending_actions máy chủ tạo) hoặc `mc-<máy>-<lệnh>-<Date.now()>`"],
  "server/services/aiLocalTools/writeHandlers/visionControl.ts#runDispatch": ["may_chu", "(khoá do executeVisionControl đặt) ctx.actionId hoặc `vc-<máy>-<lệnh>-<Date.now()>`"],
  "server/services/equipment/equipmentAdapter.ts#sendCommand": ["uy_quyen_ben_goi", "command.idempotencyKey của bên gọi sendCommand: FOE (run/step/attempt máy chủ sinh); REST v1 chỉ tới adapter robot (miễn trừ (A))"],
  "server/services/interlock/interlockEngine.ts#evaluateRule": ["may_chu", "`il-<rule>-<event>`"],
  "server/services/ot/adapterFacade.ts#executeCommand": ["uy_quyen_ben_goi", "cmd.idempotency_key || cmd.command_id — KHÔNG có bên gọi sản xuất (rà T6d (c)); bên gọi mới từ input ⇒ (A) bắt"],
  "server/services/programming/mitsubishi/mitsubishiEngineeringAdapter.ts#deploy": ["mien_lap_trinh", "khoaDispatchLapTrinh(opts.idempotencyKey, requestedBy) — miền `pd:u<người yêu cầu>:`"],
  "server/services/scada/lenhHmi.ts#xacNhanGhiTag": ["may_chu", "`hmi:<requestId uuid>` (yêu cầu ghi tag máy chủ tạo)"],
  "server/services/scada/lenhHmi.ts#guiStopMotAdapter": ["may_chu", "`hmistop:<actionId uuid>`"],
};

function liet(dir: string, ra: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      liet(p, ra);
    } else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && !/\.d\.ts$/.test(n)) ra.push(p);
  }
  return ra;
}

const tenGoi = (e: ts.Expression): string | null => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null);

/** Tên "hàm bao" gần nhất: thuộc tính của router (`deployBuild: …`), phương thức, hoặc hàm khai báo. */
function hamBao(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent, con: ts.Node = n; p; con = p, p = p.parent) {
    if (ts.isPropertyAssignment(p) && p.initializer === con && con === n) continue; // `{ dispatch: dispatch }` — giá trị của chính nút, không phải hàm bao
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
  }
  return "<module>";
}

export interface KetQuaQuet {
  viPham: string[];
  daDatMien: string[];
  /** điểm miễn trừ CẢ điểm thật sự gặp khoá bên gọi (chống miễn trừ mồ côi). */
  daMienTru: string[];
}

/** (A) Quét MỘT tệp bề mặt bên gọi: vi phạm (khoá bên gọi chưa đặt miền) + điểm đã đặt miền. */
export function quet(rel: string, src: string): KetQuaQuet {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const viPham: string[] = [];
  const daDatMien = new Set<string>();
  const daMienTru = new Set<string>();
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const trongHamDatMien = (n: ts.Node, ranh: ts.Node | undefined): boolean => {
    for (let p: ts.Node | undefined = n.parent; p && p !== ranh; p = p.parent) {
      if (ts.isCallExpression(p) && HAM_DAT_MIEN.has(tenGoi(p.expression) ?? "")) return true;
    }
    return false;
  };
  const laTruyCapKhoa = (n: ts.Node): boolean => {
    if (!ts.isPropertyAccessExpression(n) || !TRUONG_KHOA.has(n.name.text)) return false;
    let r: ts.Expression = n.expression;
    while (ts.isPropertyAccessExpression(r) || ts.isNonNullExpression(r) || ts.isParenthesizedExpression(r)) r = r.expression;
    return ts.isIdentifier(r) && GOC_BEN_GOI.has(r.text);
  };
  // lan khoá bên gọi qua khai báo biến (điểm bất động trong tệp)
  const bienKhoa = new Set<string>();
  const coKhoaChuaMien = (n: ts.Node): boolean => {
    let co = false;
    const tham = (m: ts.Node): void => {
      if (co) return;
      if ((laTruyCapKhoa(m) || (ts.isIdentifier(m) && bienKhoa.has(m.text) && !ts.isPropertyAccessExpression(m.parent))) && !trongHamDatMien(m, n.parent)) {
        co = true;
        return;
      }
      ts.forEachChild(m, tham);
    };
    tham(n);
    return co;
  };
  for (let doi = true; doi; ) {
    doi = false;
    const tham = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && !bienKhoa.has(n.name.text) && coKhoaChuaMien(n.initializer)) {
        bienKhoa.add(n.name.text);
        doi = true;
      }
      ts.forEachChild(n, tham);
    };
    tham(sf);
  }
  const laKhoaBenGoi = (n: ts.Node): boolean =>
    laTruyCapKhoa(n) || (ts.isIdentifier(n) && bienKhoa.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n));
  const trongTruongMienTru = (n: ts.Node, ranh: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p && p !== ranh.parent; p = p.parent) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && TRUONG_MIEN_TRU.has(p.name.text)) return true;
    }
    return false;
  };
  const tham = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const ten = tenGoi(n.expression);
      if (ten && DIEM_TOI_DISPATCH.has(ten)) {
        const diem = `${rel}#${hamBao(n)}#${ten}`;
        n.arguments.forEach((a, viTri) => {
          if ((MIEN_TRU_VI_TRI[ten] ?? []).includes(viTri)) return;
          const xet = (m: ts.Node): void => {
            if (laKhoaBenGoi(m)) {
              if (trongHamDatMien(m, n)) daDatMien.add(diem);
              else if (diem in DIEM_MIEN_TRU) daMienTru.add(diem);
              else if (!trongTruongMienTru(m, a)) viPham.push(`${rel}:${dong(m)} ${hamBao(n)}#${ten}: ${m.getText(sf)} chưa qua hàm đặt miền`);
              return;
            }
            ts.forEachChild(m, xet);
          };
          xet(a);
        });
      }
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return { viPham, daDatMien: [...daDatMien], daMienTru: [...daMienTru] };
}

export interface ThamChieuDispatch {
  diem: string;
  /** đường lập trình: thuộc tính `idempotencyKey` của đối số là lời gọi `khoaDispatchLapTrinh(…)`. */
  khoaQuaMienLapTrinh: boolean;
}

/** (B) Mọi tham chiếu tới `dispatch` của commandDispatcher trong MỘT tệp. */
export function thamChieuDispatch(rel: string, src: string): ThamChieuDispatch[] {
  if (!src.includes("commandDispatcher")) return [];
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tuCD = (m: ts.Expression) => ts.isStringLiteral(m) && /(^|\/)commandDispatcher$/.test(m.text);
  const tenDispatch = new Set<string>(); // định danh cục bộ = dispatch
  const khongGian = new Set<string>(); // `ns` của `import * as ns` / `const ns = await import(…)`
  const vungKhai = new Set<ts.Node>(); // nút định danh là CHỖ KHAI BÁO (không đếm)
  const laImportDong = (e: ts.Expression | undefined): boolean => {
    let x = e;
    while (x && (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x))) x = x.expression;
    return !!x && ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.ImportKeyword && x.arguments.length > 0 && tuCD(x.arguments[0]!);
  };
  const tham1 = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && tuCD(n.moduleSpecifier) && n.importClause?.namedBindings) {
      const nb = n.importClause.namedBindings;
      if (ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if ((el.propertyName ?? el.name).text === "dispatch" && !el.isTypeOnly) {
            tenDispatch.add(el.name.text);
            vungKhai.add(el.name);
          }
        }
      } else if (ts.isNamespaceImport(nb)) khongGian.add(nb.name.text);
    }
    if (ts.isVariableDeclaration(n) && laImportDong(n.initializer)) {
      if (ts.isIdentifier(n.name)) khongGian.add(n.name.text);
      else if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          const goc = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
          if (goc === "dispatch" && ts.isIdentifier(el.name)) {
            tenDispatch.add(el.name.text);
            vungKhai.add(el.name);
          }
        }
      }
    }
    ts.forEachChild(n, tham1);
  };
  tham1(sf);
  const ra: ThamChieuDispatch[] = [];
  const laGoiDatMienDispatch = (e: ts.Expression | undefined): boolean => !!e && ts.isCallExpression(e) && tenGoi(e.expression) === "khoaDispatchLapTrinh";
  const hamGan = (n: ts.Node): ts.Node => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) return p;
    return sf;
  };
  /**
   * A2(a) — `khoaDispatchLapTrinh` trả `null` khi phần bên gọi rỗng (bên gọi trả lời từ chối, không gọi dispatch()) ⇒ điểm gọi đọc kết quả vào một
   * `const` rồi truyền định danh. Fix round 1 (F4) — định danh được chấp nhận CHỈ KHI, trong hàm bao gần nhất của lời gọi dispatch:
   *   • tên ấy được khai báo ĐÚNG MỘT lần (biến ở mọi khối, tham số, phần tử phân rã, hàm / lớp cùng tên ⇒ đều đếm — không che bóng, không trùng tham số);
   *   • lần khai ấy là `const <tên> = khoaDispatchLapTrinh(…)` khai TRỰC TIẾP trong hàm ấy (không `let`, không hàm đặt miền khác);
   *   • có chốt `if (<tên> === null | == null) return / throw …` nằm SAU lần khai, kết thúc TRƯỚC lời dùng, trong một khối bao lời dùng.
   */
  const constDatMien = (id: ts.Identifier): boolean => {
    const ham = hamGan(id);
    const khai: ts.Node[] = [];
    const quet = (m: ts.Node): void => {
      if ((ts.isVariableDeclaration(m) || ts.isParameter(m) || ts.isBindingElement(m)) && ts.isIdentifier(m.name) && m.name.text === id.text) khai.push(m);
      else if ((ts.isFunctionDeclaration(m) || ts.isClassDeclaration(m)) && m.name?.text === id.text) khai.push(m);
      ts.forEachChild(m, quet);
    };
    quet(ham);
    if (khai.length !== 1) return false;
    const d = khai[0]!;
    if (!ts.isVariableDeclaration(d) || !ts.isVariableDeclarationList(d.parent) || (d.parent.flags & ts.NodeFlags.Const) === 0) return false;
    if (!laGoiDatMienDispatch(d.initializer) || hamGan(d) !== ham) return false;
    const laTen = (e: ts.Expression) => ts.isIdentifier(e) && e.text === id.text;
    const laNull = (e: ts.Expression) => e.kind === ts.SyntaxKind.NullKeyword;
    const soNull = (e: ts.Expression): boolean =>
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
      ((laTen(e.left) && laNull(e.right)) || (laNull(e.left) && laTen(e.right)));
    const raKhoi = (st: ts.Statement): boolean =>
      ts.isReturnStatement(st) || ts.isThrowStatement(st) || (ts.isBlock(st) && st.statements.some((x) => ts.isReturnStatement(x) || ts.isThrowStatement(x)));
    const baoLoiDung = (khoi: ts.Node): boolean => {
      for (let q: ts.Node | undefined = id.parent; q; q = q.parent) if (q === khoi) return true;
      return false;
    };
    let coChot = false;
    const tim = (m: ts.Node): void => {
      if (coChot) return;
      if (ts.isIfStatement(m) && soNull(m.expression) && raKhoi(m.thenStatement) && m.getStart() >= d.getEnd() && m.getEnd() <= id.getStart() && hamGan(m) === ham && baoLoiDung(m.parent)) coChot = true;
      else ts.forEachChild(m, tim);
    };
    tim(ham);
    return coChot;
  };
  const doiSoMien = (call: ts.CallExpression | undefined): boolean => {
    const o = call?.arguments[0];
    if (!o || !ts.isObjectLiteralExpression(o)) return false;
    const p = o.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === "idempotencyKey");
    return !!p && (laGoiDatMienDispatch(p.initializer) || (ts.isIdentifier(p.initializer) && constDatMien(p.initializer)));
  };
  const tham2 = (n: ts.Node): void => {
    let laTC = false;
    if (ts.isIdentifier(n) && tenDispatch.has(n.text) && !vungKhai.has(n)) {
      const p = n.parent;
      const laTenThuocTinh = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isImportSpecifier(p) || ts.isBindingElement(p);
      laTC = !laTenThuocTinh;
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === "dispatch" && ts.isIdentifier(n.expression) && khongGian.has(n.expression.text)) laTC = true;
    if (laTC) {
      const call = ts.isCallExpression(n.parent) && n.parent.expression === n ? n.parent : undefined;
      ra.push({ diem: `${rel}#${hamBao(n)}`, khoaQuaMienLapTrinh: doiSoMien(call) });
    }
    ts.forEachChild(n, tham2);
  };
  tham2(sf);
  return ra;
}

function quetCay(): { a: KetQuaQuet; b: ThamChieuDispatch[]; soTepA: number; soTepB: number } {
  const viPham: string[] = [];
  const daDatMien: string[] = [];
  const daMienTru: string[] = [];
  let soTepA = 0;
  for (const d of THU_MUC_BEN_GOI) {
    for (const p of liet(join(GOC, d))) {
      soTepA++;
      const rel = relative(GOC, p).replace(/\\/g, "/");
      const k = quet(rel, readFileSync(p, "utf8"));
      viPham.push(...k.viPham);
      daDatMien.push(...k.daDatMien);
      daMienTru.push(...k.daMienTru);
    }
  }
  const b: ThamChieuDispatch[] = [];
  const tepB = liet(join(GOC, "server"));
  for (const p of tepB) {
    const rel = relative(GOC, p).replace(/\\/g, "/");
    if (rel === "server/services/ot/commandDispatcher.ts") continue; // chính nó
    b.push(...thamChieuDispatch(rel, readFileSync(p, "utf8")));
  }
  return { a: { viPham, daDatMien: [...new Set(daDatMien)].sort(), daMienTru: [...new Set(daMienTru)].sort() }, b, soTepA, soTepB: tepB.length };
}

describe("★★★ census T6d — khoá idempotency của bên gọi tới dispatch() / program_deployments luôn qua hàm đặt miền", () => {
  const k = quetCay();

  it("chống quét rỗng: có tệp được quét ở cả hai bề mặt", () => {
    expect(k.soTepA).toBeGreaterThan(50);
    expect(k.soTepB).toBeGreaterThan(500);
  });

  it("§A 0 vi phạm: không khoá bên gọi nào tới điểm dispatch / tra cứu deploy mà chưa đặt miền", () => {
    expect(k.a.viPham).toEqual([]);
  });

  it("§A chống quét rỗng: tập điểm ĐÃ đặt miền đúng bằng danh sách đã đo; mỗi miễn trừ CẢ điểm thật sự còn gặp khoá bên gọi (không miễn trừ mồ côi)", () => {
    expect(k.a.daDatMien).toEqual(DIEM_DA_DAT_MIEN);
    expect(k.a.daMienTru).toEqual(Object.keys(DIEM_MIEN_TRU).sort());
  });

  it("§B sổ cái: MỌI tham chiếu dispatch() đã phân loại nguồn khoá (điểm mới / biến mất ⇒ đỏ); đường lập trình luôn qua khoaDispatchLapTrinh", () => {
    const diem = [...new Set(k.b.map((t) => t.diem))].sort();
    expect(diem).toEqual(Object.keys(SO_CAI_DISPATCH).sort());
    for (const t of k.b) {
      const [nguon] = SO_CAI_DISPATCH[t.diem]!;
      if (nguon === "mien_lap_trinh") expect({ diem: t.diem, mien: t.khoaQuaMienLapTrinh }).toEqual({ diem: t.diem, mien: true });
    }
  });

  it("§C ĐỘT BIẾN tệp ảo (A): bỏ hàm đặt miền ⇒ vi phạm nêu đúng chỗ; khoá qua BIẾN ⇒ vẫn bắt; khoaCu / vị trí miễn trừ ⇒ không; khoá máy chủ ⇒ bỏ qua", () => {
    const boMien = quet(
      "server/routers/ao.ts",
      `export const r = { deployBuild: p.mutation(async ({ input, ctx }) => deployBuild({ buildId: 1, idempotencyKey: input.idempotencyKey, khoaCu: input.idempotencyKey }, u)) };`,
    );
    expect(boMien.viPham).toEqual(["server/routers/ao.ts:1 deployBuild#deployBuild: input.idempotencyKey chưa qua hàm đặt miền"]);
    expect(boMien.daDatMien).toEqual([]);
    const coMien = quet(
      "server/routers/ao.ts",
      `export const r = { deployToFleet: p.mutation(async ({ input, ctx }) => deployToFleet({ idempotencyKeyPrefix: tienToMienLapTrinh(ctx.user.id, input.idempotencyKeyPrefix), tienToCu: input.idempotencyKeyPrefix }, u)) };`,
    );
    expect(coMien).toEqual({ viPham: [], daDatMien: ["server/routers/ao.ts#deployToFleet#deployToFleet"], daMienTru: [] });
    const quaBien = quet("server/routes/ao.ts", `async function h(req) { const k = req.body.idempotencyKey?.trim() || nanoid(); const cmd2 = build(k); return thing.sendCommand(cmd2); }`);
    expect(quaBien.viPham).toEqual(["server/routes/ao.ts:1 h#sendCommand: cmd2 chưa qua hàm đặt miền"]);
    const bienDaMien = quet("server/routes/ao.ts", `async function h(req) { const k = khoaMienLapTrinh(u, req.body.idempotencyKey); return rollbackDeployment(1, u, h, k); }`);
    expect(bienDaMien.viPham).toEqual([]);
    const viTri = quet("server/routes/ao.ts", `async function h(req) { return rollbackDeployment(1, u, h, req.body.idempotencyKey); }`);
    expect(viTri.viPham).toEqual(["server/routes/ao.ts:1 h#rollbackDeployment: req.body.idempotencyKey chưa qua hàm đặt miền"]);
    expect(quet("server/routes/ao.ts", `async function h(req) { return rollbackDeployment(1, u, h, khoaMienLapTrinh(u, req.body.idempotencyKey), req.body.idempotencyKey); }`).viPham).toEqual([]); // vị trí 4 = khoaCu
    expect(quet("server/routers/ao.ts", `async function h(input) { return assertIdempotencyKeyConsistent(input.idempotencyKey, w, input.idempotencyKey, 1); }`).viPham).toHaveLength(1); // vị trí 0 chưa miền
    expect(quet("server/api/ao.ts", `async function h(body) { return dispatch({ adapterId: 1, idempotencyKey: body.idempotencyKey }); }`).viPham).toHaveLength(1);
    expect(quet("server/routers/ao.ts", `deployBuild({ idempotencyKey: row.idempotencyKey })`).viPham).toEqual([]); // khoá máy chủ (hàng đã lưu)
  });

  it("§C ĐỘT BIẾN tệp ảo (B): tham chiếu dispatch mới (tĩnh / động / không gian tên / truyền như giá trị) được đếm; khoá lập trình thiếu khoaDispatchLapTrinh ⇒ mien=false", () => {
    expect(thamChieuDispatch("server/x.ts", `import { dispatch as d } from "../ot/commandDispatcher"; export async function f() { return d({ idempotencyKey: "a" }); }`)).toEqual([{ diem: "server/x.ts#f", khoaQuaMienLapTrinh: false }]);
    expect(thamChieuDispatch("server/x.ts", `export async function g() { const { dispatch } = await import("./commandDispatcher"); return dispatch({ idempotencyKey: khoaDispatchLapTrinh(k, 1) }); }`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: true }]);
    expect(thamChieuDispatch("server/x.ts", `import * as cd from "./ot/commandDispatcher"; export function h() { return cd.dispatch(i); }`)).toEqual([{ diem: "server/x.ts#h", khoaQuaMienLapTrinh: false }]);
    expect(thamChieuDispatch("server/x.ts", `import { dispatch } from "./ot/commandDispatcher"; const deps = { dispatch, x: 1 };`)).toEqual([{ diem: "server/x.ts#<module>", khoaQuaMienLapTrinh: false }]); // thuộc tính rút gọn = truyền như giá trị
    expect(thamChieuDispatch("server/x.ts", `import { dispatch } from "./ot/commandDispatcher"; start({ dispatch: dispatch });`)).toEqual([{ diem: "server/x.ts#<module>", khoaQuaMienLapTrinh: false }]);
    expect(thamChieuDispatch("server/x.ts", `import { isOtControlEnabled } from "./ot/commandDispatcher"; dispatch(x);`)).toEqual([]); // dispatch KHÁC (không nhập từ commandDispatcher)
    // A2(a) — khoá qua `const` gán từ khoaDispatchLapTrinh trong CÙNG hàm ⇒ mien=true; `let` / hàm đặt miền khác / const ở hàm khác ⇒ mien=false
    const dong = (than: string) => thamChieuDispatch("server/x.ts", `export async function g(o) { const { dispatch } = await import("./commandDispatcher"); ${than} }`);
    expect(dong(`const khoa = khoaDispatchLapTrinh(o.k, 1); if (khoa === null) return; return dispatch({ idempotencyKey: khoa });`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: true }]);
    expect(dong(`let khoa = khoaDispatchLapTrinh(o.k, 1); khoa = o.k; return dispatch({ idempotencyKey: khoa });`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
    expect(dong(`const khoa = khoaMienLapTrinh(1, o.k); return dispatch({ idempotencyKey: khoa });`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
    expect(dong(`const khoa = o.k; return dispatch({ idempotencyKey: khoa });`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
    expect(
      thamChieuDispatch("server/x.ts", `const khoa = khoaDispatchLapTrinh(k, 1); export async function g() { const { dispatch } = await import("./commandDispatcher"); return dispatch({ idempotencyKey: khoa }); }`),
    ).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
  });

  // A2(a) fix round 1 F4 — mỗi ca giả (4 đầu) ĐƯỢC luật cũ (chỉ khớp tên) chấp nhận và phải bị từ chối; 2 ca cuối: chốt hợp lệ vẫn được nhận.
  const M = (than: string, thamSo = "o") => thamChieuDispatch("server/x.ts", `export async function g(${thamSo}) { const { dispatch } = await import("./commandDispatcher"); ${than} }`);
  it("§C F4 const khoaDispatchLapTrinh: che bóng trong khối", () => {
    expect(M(`const khoa = khoaDispatchLapTrinh(o.k, 1); if (khoa === null) return; { const khoa = o.k; return dispatch({ idempotencyKey: khoa }); }`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
  });
  it("§C F4 const khoaDispatchLapTrinh: tham số cùng tên (const cùng cấp — AST vẫn dựng dù JS báo trùng)", () => {
    expect(M(`const khoa = khoaDispatchLapTrinh(o.k, 1); if (khoa === null) return; return dispatch({ idempotencyKey: khoa });`, "o, khoa")).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
  });
  it("§C F4 const khoaDispatchLapTrinh: tham số cùng tên, const trong khối", () => {
    expect(M(`{ const khoa = khoaDispatchLapTrinh(o.k, 1); if (khoa === null) return; } return dispatch({ idempotencyKey: khoa });`, "o, khoa")).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
  });
  it("§C F4 const khoaDispatchLapTrinh: không chốt null", () => {
    expect(M(`const khoa = khoaDispatchLapTrinh(o.k, 1); return dispatch({ idempotencyKey: khoa });`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
  });
  it("§C F4 const khoaDispatchLapTrinh: chốt SAU lời dùng", () => {
    expect(M(`const khoa = khoaDispatchLapTrinh(o.k, 1); const r = dispatch({ idempotencyKey: khoa }); if (khoa === null) return; return r;`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: false }]);
  });
  it("§C F4 const khoaDispatchLapTrinh: chốt hợp lệ `null == khoa` + khối return", () => {
    expect(M(`const khoa = khoaDispatchLapTrinh(o.k, 1); if (null == khoa) { log(); return { ok: false }; } return dispatch({ idempotencyKey: khoa });`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: true }]);
  });
  it("§C F4 const khoaDispatchLapTrinh: chốt hợp lệ throw", () => {
    expect(M(`const khoa = khoaDispatchLapTrinh(o.k, 1); if (khoa === null) throw e; return dispatch({ idempotencyKey: khoa });`)).toEqual([{ diem: "server/x.ts#g", khoaQuaMienLapTrinh: true }]);
  });
});

/**
 * (D) SCADA R1b-2b-2a T6d fix 1 (review M4) — SỔ CÁI mọi chỗ TRA / GHI `program_deployments` THEO KHOÁ trong `server/**` (không test):
 *   • tra = lời gọi `eq(programDeployments.idempotencyKey, …)` — phải nằm trong `and(…)` có `eq(programDeployments.requestedBy, …)` (chỉ hàng của CHÍNH
 *     người gọi: khoá của người / nhà máy khác không bao giờ trả hàng của họ, không lộ "đã tồn tại");
 *   • ghi = `.insert(programDeployments)`.
 * Mỗi chỗ (tệp#hàm-bao) phải có trong `SO_CAI_PROGRAM_DEPLOYMENTS` với NGUỒN khoá đã phân loại; `mien_trong_ham` ⇒ CHÍNH hàm bao gọi một hàm đặt miền.
 * Chỗ mới / chỗ biến mất ⇒ đỏ.
 */
type NguonKhoaDeploy = "mien_o_router" | "mien_trong_ham" | "mien_o_ben_goi_noi_bo";
const SO_CAI_PROGRAM_DEPLOYMENTS: Record<string, [NguonKhoaDeploy, string]> = {
  "server/services/programming/programmingService.ts#deployBuild": ["mien_o_router", "req.idempotencyKey = khoaMienLapTrinh(ctx.user.id, input.idempotencyKey) ở programmingRouter (§A); approve / rollback / fleet truyền khoá đã lưu (đã miền)"],
  "server/services/programming/programmingService.ts#findDeploymentByKey": ["mien_o_router", "khoá đã miền từ deployBuild / requestDeployApproval / timDeployTruoc; lọc requestedBy"],
  "server/services/programming/programmingService.ts#requestDeployApproval": ["mien_o_router", "req.idempotencyKey = khoaMienLapTrinh(…) ở programmingRouter (§A)"],
  "server/services/robot/ursim/ursimDeployService.ts#deployUrscriptToUrsim": ["mien_trong_ham", "khoaDispatchLapTrinh(req.idempotencyKey, req.hitl.requestedBy) ĐẦU hàm; tra lọc requestedBy (chưa có bên gọi sản xuất — T6d fix 1, review M4)"],
  "server/services/robot/ursim/ursimDeployService.ts#record": ["mien_o_ben_goi_noi_bo", "chỉ được gọi từ deployUrscriptToUrsim với req ĐÃ đặt miền"],
};

export interface ChoDeployTheoKhoa {
  diem: string;
  loai: "tra" | "ghi";
  /** tra: nằm trong `and(…)` có `eq(programDeployments.requestedBy, …)`. */
  locNguoi: boolean;
  /** hàm bao gần nhất có gọi một hàm đặt miền. */
  hamCoDatMien: boolean;
}

/** (D) Mọi chỗ tra / ghi `program_deployments` theo khoá trong MỘT tệp. */
export function deployTheoKhoa(rel: string, src: string): ChoDeployTheoKhoa[] {
  if (!src.includes("programDeployments")) return [];
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const laCot = (e: ts.Expression | undefined, cot: string) => !!e && ts.isPropertyAccessExpression(e) && e.name.text === cot && ts.isIdentifier(e.expression) && e.expression.text === "programDeployments";
  const laEqCot = (e: ts.Node, cot: string) => ts.isCallExpression(e) && tenGoi(e.expression) === "eq" && laCot(e.arguments[0], cot);
  const hamGan = (n: ts.Node): ts.Node => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) return p;
    return sf;
  };
  const coDatMien = (h: ts.Node): boolean => {
    let co = false;
    const t = (m: ts.Node): void => {
      if (co) return;
      if (ts.isCallExpression(m) && HAM_DAT_MIEN.has(tenGoi(m.expression) ?? "")) co = true;
      else ts.forEachChild(m, t);
    };
    t(h);
    return co;
  };
  const ra: ChoDeployTheoKhoa[] = [];
  const tham = (n: ts.Node): void => {
    if (laEqCot(n, "idempotencyKey")) {
      const p = n.parent;
      const locNguoi = ts.isCallExpression(p) && tenGoi(p.expression) === "and" && p.arguments.some((a) => laEqCot(a, "requestedBy"));
      ra.push({ diem: `${rel}#${hamBao(n)}`, loai: "tra", locNguoi, hamCoDatMien: coDatMien(hamGan(n)) });
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "insert" && n.arguments.length === 1 && ts.isIdentifier(n.arguments[0]!) && (n.arguments[0] as ts.Identifier).text === "programDeployments") {
      ra.push({ diem: `${rel}#${hamBao(n)}`, loai: "ghi", locNguoi: true, hamCoDatMien: coDatMien(hamGan(n)) });
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return ra;
}

describe("★★★ census T6d fix 1 (§D, review M4) — mọi chỗ tra / ghi program_deployments theo khoá: đã phân loại miền, tra lọc người yêu cầu", () => {
  const cho: ChoDeployTheoKhoa[] = [];
  for (const p of liet(join(GOC, "server"))) {
    const rel = relative(GOC, p).replace(/\\/g, "/");
    cho.push(...deployTheoKhoa(rel, readFileSync(p, "utf8")));
  }

  it("sổ cái: tập chỗ ĐÚNG bằng sổ (chỗ mới / biến mất ⇒ đỏ; chống quét rỗng); mọi chỗ TRA lọc requestedBy; `mien_trong_ham` ⇒ hàm bao gọi hàm đặt miền", () => {
    expect(cho.length).toBeGreaterThanOrEqual(6); // đo 2026-11-01: programmingService 3 ghi + 1 tra, URSim 1 tra + 1 ghi
    expect([...new Set(cho.map((c) => c.diem))].sort()).toEqual(Object.keys(SO_CAI_PROGRAM_DEPLOYMENTS).sort());
    expect(cho.filter((c) => c.loai === "tra" && !c.locNguoi)).toEqual([]);
    for (const c of cho) {
      if (SO_CAI_PROGRAM_DEPLOYMENTS[c.diem]![0] === "mien_trong_ham") expect({ diem: c.diem, mien: c.hamCoDatMien }).toEqual({ diem: c.diem, mien: true });
    }
    expect(cho.filter((c) => c.diem.endsWith("ursimDeployService.ts#deployUrscriptToUrsim")).map((c) => c.loai)).toEqual(["tra"]);
  });

  it("§D ĐỘT BIẾN tệp ảo: tra theo khoá KHÔNG lọc requestedBy ⇒ locNguoi=false; bỏ hàm đặt miền ⇒ hamCoDatMien=false; tra có lọc ⇒ ổn", () => {
    expect(deployTheoKhoa("server/x.ts", `export async function f(k) { return db.select().from(programDeployments).where(eq(programDeployments.idempotencyKey, k)); }`)).toEqual([
      { diem: "server/x.ts#f", loai: "tra", locNguoi: false, hamCoDatMien: false },
    ]);
    expect(
      deployTheoKhoa("server/x.ts", `export async function f(r) { const k = khoaDispatchLapTrinh(r.k, r.u); return db.select().from(programDeployments).where(and(eq(programDeployments.idempotencyKey, k), eq(programDeployments.requestedBy, r.u))); }`),
    ).toEqual([{ diem: "server/x.ts#f", loai: "tra", locNguoi: true, hamCoDatMien: true }]);
    expect(deployTheoKhoa("server/x.ts", `async function g(v) { await db.insert(programDeployments).values(v); }`)).toEqual([{ diem: "server/x.ts#g", loai: "ghi", locNguoi: true, hamCoDatMien: false }]);
  });
});
