/**
 * ★★★ SCADA R1b-2b-2a T3E (backlog 90, điều kiện 2) — CENSUS: mọi chỗ trong `server/` GỬI một lệnh thiết bị và nhận kết cục của nó (nơi có thể rẽ
 * nhánh "thử lại / gửi lại" khi thấy `failed`) phải XÉT lô áp MỘT PHẦN (`motPhan` / `MOT_PHAN`), hoặc nằm trong danh sách MIỄN có lý do.
 *
 * Tập chỗ KHÔNG viết tay — SUY bằng AST (TypeScript) trên mọi `.ts` không test dưới `server/` (bỏ tệp trợ giúp chỉ-test `__*.ts`):
 *   • lời gọi phương thức `.sendCommand(…)` (mặt tiền thiết bị EquipmentAdapter — FOE, API v1, quét STOP của FOE …);
 *   • lời gọi một tên NHẬP từ mô-đun gửi lệnh: `dispatch` (ot/commandDispatcher), `dispatchOtOnEdge` (ot/otEdgeDispatch), `executeOtDeviceWrite` /
 *     `executeOtDeviceWriteUnlessStopped` (ot/otDeviceWrite), `dispatchRobotJob` (robot/robotCommandDispatcher), `dispatchRobotOnEdge`
 *     (robot/robotEdgeDispatch) — theo import tĩnh (có đổi tên / namespace), `const { x } = await import(…)`, `const [{ x }] = await Promise.all([import(…)])`,
 *     `const m = await import(…)` + `m.x(…)`, `(await import(…)).x(…)`, và bên gửi TIÊM (`this.deps.dispatch(…)` trong tệp nhập — kể cả `import type` —
 *     từ mô-đun gửi). Lời gọi TRONG chính mô-đun định nghĩa (bản bọc) là một phần của bên gửi.
 *   • LƯỚI THÔ đối chiếu: tệp có văn bản `<tên>(` VÀ nhắc tới mô-đun của tên ấy mà AST không thấy chỗ nào ⇒ ĐỎ (bộ phân giải bị lọt).
 * Chỗ = `tệp::hàm` — hàm NGOÀI CÙNG chứa lời gọi (khai báo / phương thức `Lớp.tên` / arrow gán tên; arrow vô danh ⇒ tên thuộc tính / biến gần nhất,
 * vd thủ tục tRPC). "XÉT" = thân hàm ấy, hoặc thân một hàm CÙNG TỆP mà nó gọi trực tiếp theo tên (một bước), gọi `motPhanCua` / `motPhanTuKetQua` /
 * `ketCucLo` (server/services/ot/motPhan.ts — MỘT nơi suy).
 * Đột biến bỏ phần xét ở một chỗ ⇒ ĐỎ, nêu tên chỗ (ca tệp ảo dưới đây + bảng đột biến của báo cáo).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** mô-đun gửi lệnh → các tên xuất là "gửi". Khoá = đuôi đường dẫn (không phần mở rộng). */
const BEN_GUI: Record<string, readonly string[]> = {
  "ot/commandDispatcher": ["dispatch"],
  "ot/otEdgeDispatch": ["dispatchOtOnEdge"],
  "ot/otDeviceWrite": ["executeOtDeviceWrite", "executeOtDeviceWriteUnlessStopped"],
  "robot/robotCommandDispatcher": ["dispatchRobotJob"],
  "robot/robotEdgeDispatch": ["dispatchRobotOnEdge"],
};
const TEN_XET = new Set(["motPhanCua", "motPhanTuKetQua", "ketCucLo"]);

/**
 * MIỄN — chỗ gửi mà KHÔNG có nhánh gửi lại tự động khi `failed` (kết cục về người gọi / người vận hành), hoặc là STOP (luôn gửi lại — dừng là
 * idempotent), hoặc là robot (MỘT job, không kết quả theo item ⇒ không thể "một phần"), hoặc là bản bọc / bên tạo kết cục.
 */
export const MIEN: Record<string, string> = {
  // ── bản bọc / mặt tiền (kết cục đi qua nguyên vẹn; người tiêu thụ xét) ──
  "server/services/ot/otEdgeDispatch.ts::runDeviceStage": "bản bọc device stage của edge: trả ExecutedWrite cho dispatchOtOnEdge, nơi rollUp gộp bằng ketCucLo (MOT_PHAN + motPhan)",
  "server/services/equipment/equipmentAdapter.ts::OtEquipmentAdapter.sendCommand": "mặt tiền OT: chuyển reason MOT_PHAN + motPhan của dispatcher / edge vào detail (FOE xét); không thử lại",
  "server/services/equipment/equipmentAdapter.ts::RobotEquipmentAdapter.sendCommand": "robot: một job, không kết quả theo item ⇒ không thể một phần; không thử lại",
  // ── một lần gửi, kết cục về người gọi (không gửi lại tự động; reason MOT_PHAN tới người gọi) ──
  "server/api/v1/router.ts::createV1Router": "API v1: một lần sendCommand, kết quả (detail.reason / detail.motPhan) trả về bên gọi API; không thử lại",
  "server/services/aiLocalTools/writeHandlers/machineControl.ts::runDispatch": "công cụ AI ghi: một lần dispatch sau HITL, kết quả (reason MOT_PHAN) về người dùng; không thử lại",
  "server/services/aiLocalTools/writeHandlers/visionControl.ts::runDispatch": "công cụ AI ghi: một lần dispatch sau HITL, kết quả về người dùng; không thử lại",
  "server/services/interlock/interlockEngine.ts::evaluateRule": "interlock tự chặn: một lần dispatch mỗi sự kiện, kết quả vào sổ + audit; không thử lại",
  "server/services/ot/adapterFacade.ts::createAdapterFacade": "lệnh canonical tag.write: MỘT write, một lần dispatch, ack mang reason (dispatchResultToAck); trùng khoá ⇒ ack cũ, không thực thi lại",
  "server/services/uns/sparkplugCommand.ts::SparkplugCommandHandler.routeControlMetrics": "Sparkplug DCMD: một lần dispatch (tiêm) mỗi loại lệnh, kết quả ghi log; không thử lại",
  "server/services/programming/mitsubishi/mitsubishiEngineeringAdapter.ts::MitsubishiEngineeringAdapter.deploy": "đẩy tham số công thức MC (lô nhiều write): một lần dispatch, error = reason (MOT_PHAN) về người triển khai; không thử lại",
  // ── STOP: luôn gửi lại / gửi ngay (dừng là idempotent) ──
  "server/services/orchestration/foe/foeEngine.ts::runAbortStopSweep": "quét STOP khi huỷ run: chỉ gửi STOP ghim — dừng là idempotent",
  "server/services/edge/edgeExecutionAgent.ts::edgeDispatchDevicePort": "cổng thiết bị của lệnh trung tâm trên edge: robot abort / STOP OT ghim — dừng là idempotent",
  "server/services/edge/edgeGatewayRuntime.ts::releaseAdapter": "STOP ghim khi nhả thiết bị (thử lại theo chu kỳ là của STOP — dừng là idempotent)",
  "server/services/edge/edgeGatewayRuntime.ts::quiesceRobot": "robot abort khi edge dừng thiết bị (STOP)",
  "server/services/robot/deviceOwnershipService.ts::sendRobotStop": "robot abort khi chuyển chủ sở hữu (STOP)",
  "server/services/robot/deviceOwnershipService.ts::sendAdapterStop": "STOP ghim OT khi chuyển chủ sở hữu — dừng là idempotent",
  "server/routers/robotRouter.ts::consoleStopNoSessionPath": "robot STOP từ bàn điều khiển (abort)",
  // ── robot / AGV: một job, không kết quả theo item ⇒ không thể một phần ──
  "server/routers/robotRouter.ts::<module>": "thủ tục robot (abort / job): một job; không kết quả theo item",
  "server/services/ros2/ros2Bridge.ts::Ros2Bridge.dispatchToRos2": "robot (ROS2): một job; không kết quả theo item",
  "server/services/vda5050/vda5050Adapter.ts::Vda5050Adapter.sendOrder": "AGV (VDA5050): một job; không kết quả theo item",
  "server/services/vda5050/vda5050Adapter.ts::Vda5050Adapter.sendInstantActions": "AGV (VDA5050): một job; không kết quả theo item",
};

export interface ChoGui {
  tep: string;
  ham: string;
  dong: number;
  ten: string;
  xet: boolean;
}

const laHam = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n);

function tenCua(n: ts.Node): string | null {
  if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
  if (ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) {
    const lop = ts.isClassLike(n.parent) && n.parent.name ? `${n.parent.name.text}.` : "";
    return `${lop}${n.name.getText()}`;
  }
  if (ts.isConstructorDeclaration(n)) return ts.isClassLike(n.parent) && n.parent.name ? `${n.parent.name.text}.constructor` : "constructor";
  if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
  if (ts.isPropertyAssignment(n.parent)) return n.parent.name.getText();
  return null;
}

/** Hàm NGOÀI CÙNG chứa nút (tên + nút); ngoài mọi hàm ⇒ <module>. Arrow / function vô danh ngoài cùng ⇒ tên thuộc tính / biến gần nhất phía trên. */
function hamNgoaiCung(n: ts.Node): { ten: string; nut: ts.Node | null } {
  let ngoai: ts.Node | null = null;
  for (let p = n.parent; p; p = p.parent) if (laHam(p)) ngoai = p;
  if (!ngoai) return { ten: "<module>", nut: null };
  const t = tenCua(ngoai);
  // arrow vô danh ngoài cùng (vd thủ tục tRPC `p: x.mutation(async () => …)` trong một đối tượng cấp module) ⇒ chỗ cấp tệp `<module>`;
  // phần xét vẫn tính trên thân của chính arrow ấy
  return { ten: t ?? "<module>", nut: ngoai };
}

const moDunCua = (spec: string): string | null => {
  const s = spec.replace(/\\/g, "/").replace(/\.(ts|js)$/, "");
  return Object.keys(BEN_GUI).find((k) => s === k || s.endsWith(`/${k}`) || (s.startsWith("./") && `ot/${s.slice(2)}` === k) || (s.startsWith("./") && `robot/${s.slice(2)}` === k)) ?? null;
};
const laImport = (e: ts.Expression | undefined): string | null => {
  let x = e;
  while (x && (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x))) x = x.expression;
  if (x && ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.ImportKeyword && x.arguments[0] && ts.isStringLiteral(x.arguments[0])) return moDunCua(x.arguments[0].text);
  return null;
};

/** Quét MỘT tệp (đường dẫn tương đối + văn bản) — xuất cho ca đột biến (tệp ảo). */
export function quetTep(rel: string, van: string): ChoGui[] {
  const sf = ts.createSourceFile(rel, van, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ten = new Map<string, string>(); // tên cục bộ → tên gửi
  const khongGian = new Map<string, string>(); // namespace cục bộ → mô-đun
  const daNhap = new Set<string>(); // mô-đun gửi được nhập (kể cả `import type`) — cho bên gửi TIÊM (deps.dispatch)
  const nhanBinding = (b: ts.BindingName, md: string) => {
    if (!ts.isObjectBindingPattern(b)) return;
    for (const el of b.elements) {
      const goc = (el.propertyName ?? el.name).getText();
      if (BEN_GUI[md]!.includes(goc) && ts.isIdentifier(el.name)) ten.set(el.name.text, goc);
    }
  };
  const thu = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const md = moDunCua(n.moduleSpecifier.text);
      if (md) daNhap.add(md);
      const nb = n.importClause?.namedBindings;
      if (md && nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (BEN_GUI[md]!.includes((el.propertyName ?? el.name).text)) ten.set(el.name.text, (el.propertyName ?? el.name).text);
      if (md && nb && ts.isNamespaceImport(nb)) khongGian.set(nb.name.text, md);
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const md = laImport(n.initializer);
      if (md && ts.isObjectBindingPattern(n.name)) nhanBinding(n.name, md);
      if (md && ts.isIdentifier(n.name)) khongGian.set(n.name.text, md);
      // const [{ a }, { b }] = await Promise.all([import(…), import(…)])
      let x: ts.Expression = n.initializer;
      while (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isArrayBindingPattern(n.name) && ts.isCallExpression(x) && x.expression.getText() === "Promise.all" && x.arguments[0] && ts.isArrayLiteralExpression(x.arguments[0])) {
        n.name.elements.forEach((el, i) => {
          const mdi = laImport((x as ts.CallExpression & { arguments: ts.NodeArray<ts.ArrayLiteralExpression> }).arguments[0]!.elements[i]);
          if (mdi && ts.isBindingElement(el)) nhanBinding(el.name, mdi);
        });
      }
    }
    ts.forEachChild(n, thu);
  };
  thu(sf);

  // hàm khai báo trong tệp (cho bước một-hop): tên → nút
  const hamTrongTep = new Map<string, ts.Node>();
  const gom = (n: ts.Node) => {
    if (laHam(n)) {
      const t = tenCua(n);
      if (t) hamTrongTep.set(t.includes(".") ? t.split(".").pop()! : t, n);
    }
    ts.forEachChild(n, gom);
  };
  gom(sf);
  const goiTen = (nut: ts.Node, tap: ReadonlySet<string>): boolean => {
    let co = false;
    const d = (x: ts.Node) => {
      if (co) return;
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && tap.has(x.expression.text)) co = true;
      ts.forEachChild(x, d);
    };
    d(nut);
    return co;
  };
  const xetHam = (nut: ts.Node | null): boolean => {
    if (!nut) return false;
    if (goiTen(nut, TEN_XET)) return true;
    let co = false;
    const d = (x: ts.Node) => {
      if (co) return;
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) {
        const h = hamTrongTep.get(x.expression.text);
        if (h && h !== nut && goiTen(h, TEN_XET)) co = true;
      }
      ts.forEachChild(x, d);
    };
    d(nut);
    return co;
  };

  const ra: ChoGui[] = [];
  const them = (n: ts.CallExpression, tenGui: string) => {
    const h = hamNgoaiCung(n);
    ra.push({ tep: rel, ham: h.ten, dong: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, ten: tenGui, xet: xetHam(h.nut) });
  };
  const tim = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isPropertyAccessExpression(e) && e.name.text === "sendCommand") them(n, "sendCommand");
      else if (ts.isIdentifier(e) && ten.has(e.text)) them(n, ten.get(e.text)!);
      else if (ts.isPropertyAccessExpression(e)) {
        let o: ts.Expression = e.expression;
        while (ts.isParenthesizedExpression(o) || ts.isAwaitExpression(o)) o = o.expression;
        const md = ts.isIdentifier(o) ? khongGian.get(o.text) : laImport(e.expression);
        if (md && BEN_GUI[md]!.includes(e.name.text)) them(n, e.name.text);
        // bên gửi TIÊM: `this.deps.dispatch(…)` trong tệp nhập (kiểu) từ mô-đun gửi
        else if (!md && [...daNhap].some((m) => BEN_GUI[m]!.includes(e.name.text))) them(n, e.name.text);
      }
    }
    ts.forEachChild(n, tim);
  };
  tim(sf);
  return ra;
}

function tepSanPham(): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (n === "node_modules") continue;
        di(p);
      } else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && !/\.d\.ts$/.test(n) && !n.startsWith("__")) ra.push(p);
    }
  };
  di(join(GOC, "server"));
  return ra;
}

/** Vi phạm: chỗ không xét mà không miễn; miễn không còn chỗ (cũ); FOE (chỗ thử lại thật duy nhất) không được miễn. */
export function kiem(cho: ChoGui[], mien: Record<string, string>): { khongXet: string[]; mienCu: string[]; foeBiMien: boolean } {
  const khoa = (c: ChoGui) => `${c.tep}::${c.ham}`;
  const khongXet = [...new Set(cho.filter((c) => !c.xet && !(khoa(c) in mien)).map((c) => `${khoa(c)} (${c.ten} :${c.dong})`))];
  const co = new Set(cho.map(khoa));
  const mienCu = Object.keys(mien).filter((k) => !co.has(k));
  return { khongXet, mienCu, foeBiMien: "server/services/orchestration/foe/foeEngine.ts::execCommand" in mien };
}

const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");
const TAT_CA = tepSanPham().map((p) => ({ rel: rel(p), van: readFileSync(p, "utf8") }));
const CHO = TAT_CA.flatMap((f) => quetTep(f.rel, f.van));

describe("★★★ T3E — census: mọi chỗ gửi lệnh phải xét MOT_PHAN (hoặc miễn có lý do)", () => {
  it("có chỗ để xét (bộ quét không rỗng): FOE execCommand (.sendCommand) được tìm thấy và XÉT", () => {
    expect(CHO.length).toBeGreaterThan(10);
    const foe = CHO.filter((c) => c.tep === "server/services/orchestration/foe/foeEngine.ts" && c.ham === "execCommand");
    expect(foe).toHaveLength(1);
    expect(foe[0]!.xet).toBe(true);
  });

  it("★ mọi chỗ: xét motPhan, hoặc nằm trong MIEN (nêu tên chỗ thiếu); không miễn cũ; FOE không được miễn", () => {
    const k = kiem(CHO, MIEN);
    expect(k.khongXet, `chỗ gửi lệnh chưa xét MOT_PHAN: ${k.khongXet.join(" | ")}`).toEqual([]);
    expect(k.mienCu, `miễn không còn chỗ: ${k.mienCu.join(" | ")}`).toEqual([]);
    expect(k.foeBiMien).toBe(false);
  });

  it("lưới thô: tệp nhắc mô-đun gửi (văn bản) + có lời gọi mang TÊN gửi (AST, mọi callee — không qua bộ phân giải import) ⇒ bộ phân giải thấy ≥ 1 chỗ", () => {
    const lot: string[] = [];
    for (const f of TAT_CA) {
      if (moDunCua(f.rel.replace(/^server\/services\//, "").replace(/\.ts$/, ""))) continue; // mô-đun định nghĩa (bản bọc nội bộ)
      const sf = ts.createSourceFile(f.rel, f.van, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const goi = new Map<string, number>();
      const d = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          const e = n.expression;
          const t = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
          if (t) goi.set(t, (goi.get(t) ?? 0) + 1);
        }
        ts.forEachChild(n, d);
      };
      d(sf);
      for (const [md, tenDs] of Object.entries(BEN_GUI)) {
        if (!f.van.includes(md.split("/").pop()!)) continue;
        for (const t of tenDs) {
          const so = goi.get(t) ?? 0;
          const ast = CHO.filter((c) => c.tep === f.rel && c.ten === t).length;
          if (so > 0 && ast === 0) lot.push(`${f.rel}: ${t} ×${so}`);
        }
      }
    }
    expect(lot, `bộ phân giải lọt: ${lot.join(" | ")}`).toEqual([]);
  });

  it("vòng thử lại của FOE (execStep) gọi khongGuiLaiMotPhan (ghim cấu trúc của chỗ thử lại)", () => {
    const f = TAT_CA.find((x) => x.rel === "server/services/orchestration/foe/foeEngine.ts")!;
    const sf = ts.createSourceFile(f.rel, f.van, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const execStep = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "execStep");
    expect(execStep).toBeDefined();
    expect(/\bkhongGuiLaiMotPhan\(\s*outcome\s*,\s*stop\s*\)/.test(execStep!.getText())).toBe(true);
  });

  it("★ đột biến (tệp ảo): bỏ motPhanCua khỏi ketCucLenhFoe ⇒ chỗ FOE execCommand ĐỎ, nêu tên", () => {
    const f = TAT_CA.find((x) => x.rel === "server/services/orchestration/foe/foeEngine.ts")!;
    expect(f.van).toContain("motPhanCua(result.detail?.motPhan)");
    const dotBien = f.van.replace("motPhanCua(result.detail?.motPhan)", "null as never");
    const cho = [...CHO.filter((c) => c.tep !== f.rel), ...quetTep(f.rel, dotBien)];
    const k = kiem(cho, MIEN);
    expect(k.khongXet.some((x) => x.startsWith("server/services/orchestration/foe/foeEngine.ts::execCommand "))).toBe(true);
  });

  it("đột biến (tệp ảo): một chỗ gửi MỚI không xét ⇒ ĐỎ, nêu tên; miễn cho nó ⇒ xanh; miễn còn lại khi chỗ biến mất ⇒ ĐỎ (cũ)", () => {
    const moi = quetTep("server/services/x/guiLaiMoi.ts", `import { dispatch } from "../ot/commandDispatcher";\nexport async function guiLai(i: any) { for (let n = 0; n < 3; n++) { const r = await dispatch(i); if (r.ok) return r; } }\n`);
    expect(moi).toHaveLength(1);
    expect(kiem([...CHO, ...moi], MIEN).khongXet).toEqual(["server/services/x/guiLaiMoi.ts::guiLai (dispatch :2)"]);
    expect(kiem([...CHO, ...moi], { ...MIEN, "server/services/x/guiLaiMoi.ts::guiLai": "thử" }).khongXet).toEqual([]);
    expect(kiem(CHO, { ...MIEN, "server/services/x/khongCo.ts::f": "cũ" }).mienCu).toEqual(["server/services/x/khongCo.ts::f"]);
    // xét qua MỘT bước trong tệp
    const motBuoc = quetTep("server/services/x/xet.ts", `import { dispatchOtOnEdge } from "../ot/otEdgeDispatch";\nimport { motPhanCua } from "../ot/motPhan";\nfunction loc(r: any) { return motPhanCua(r.motPhan); }\nexport async function g(i: any) { const r = await dispatchOtOnEdge(i); return loc(r); }\n`);
    expect(motBuoc).toMatchObject([{ ham: "g", xet: true }]);
    // phân giải: import động + Promise.all + namespace
    const dong = quetTep("server/services/x/dong.ts", `export async function a() { const [{ dispatchOtOnEdge: d }] = await Promise.all([import("../ot/otEdgeDispatch")]); await d({}); }\nexport async function b() { const m = await import("../ot/commandDispatcher"); await m.dispatch({} as any); }\nexport async function c() { await (await import("../robot/robotCommandDispatcher")).dispatchRobotJob({} as any); }\n`);
    expect(dong.map((x) => `${x.ham}:${x.ten}`)).toEqual(["a:dispatchOtOnEdge", "b:dispatch", "c:dispatchRobotJob"]);
  });
});
