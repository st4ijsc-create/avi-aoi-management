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
 *     `idempotencyKey` của đối số là lời gọi `khoaDispatchLapTrinh(…)`. Điểm mới / điểm biến mất ⇒ đỏ.
 * Chống quét rỗng: (A) tập điểm gọi ĐÃ đặt miền ĐÚNG bằng `DIEM_DA_DAT_MIEN`; (B) tập tham chiếu ĐÚNG bằng sổ cái; số tệp quét > 0.
 *
 * GIỚI HẠN (ghi rõ): (A) lan khoá bên gọi chỉ qua KHAI BÁO biến trong cùng tệp (không qua phép gán lại, tham số hàm, thuộc tính đối tượng dựng rời);
 * (B) không phân giải `dispatch` truyền qua nhiều lớp biến (vd `const f = dispatch; f(…)` được đếm là MỘT tham chiếu ở chỗ gán — vẫn vào sổ cái).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const THU_MUC_BEN_GOI = ["server/routers", "server/routes", "server/api"];
const DIEM_TOI_DISPATCH = new Set(["deployBuild", "requestDeployApproval", "rollbackDeployment", "deployToFleet", "assertIdempotencyKeyConsistent", "dispatch", "executeCommand", "sendCommand"]);
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
  "server/api/v1/router.ts#createV1Router#sendCommand":
    "REST v1 POST /equipment/:id/commands — CHỈ robot (mọi lệnh không phải robot ⇒ 501 TRƯỚC idempotencyKey / dispatcher, SCADA R1b-1 T5 D8): khoá vào robot_jobs (không gian khoá riêng, không phải command_log) và chốt R-1C-i của robot (cùng robot + jobType, IDEMPOTENCY_KEY_REUSED, STOP vẫn gửi)",
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
  "server/services/unsPublisher.ts#startCommandHandler": ["may_chu", "tiêm vào sparkplugCommand: `spcmd-<máy>-<loại>-<lệnh>-<Date.now()>`"],
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
  const doiSoMien = (call: ts.CallExpression | undefined): boolean => {
    const o = call?.arguments[0];
    if (!o || !ts.isObjectLiteralExpression(o)) return false;
    const p = o.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === "idempotencyKey");
    return !!p && ts.isCallExpression(p.initializer) && tenGoi(p.initializer.expression) === "khoaDispatchLapTrinh";
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
  });
});
