/**
 * ★★★ SCADA R1b-2b-2b A — C1 (KD-2bA 1.1 + 1.3; điều phối 2026-10-27) — CENSUS hai cột chi tiết kỹ thuật của `command_log`.
 *
 * Luật (điều phối): KHÔNG thủ tục nào dưới mức "admin / engineer có `machine_control.canEdit`" trả `errorText` / `ackValue` của
 * `command_log` (văn bản lỗi driver có thể mang host:port; ackValue là ledger nội bộ / payload ack thiết bị).
 *
 * Cách đo: quét AST MỌI tệp `.ts` của `server/` (trừ test / testkit / bộ dựng test `__*`) tìm MỌI chỗ ĐỌC hai cột:
 *   • `cot`          — truy cập thuộc tính `commandLog.errorText` / `commandLog.ackValue` (bảng drizzle);
 *   • `select_tat_ca`— `.select()` KHÔNG đối số rồi `.from(commandLog)` (đọc nguyên hàng ⇒ có cả hai cột);
 *   • `sql_tho`      — chuỗi / template SQL thô chứa `"errorText"` hoặc `"ackValue"`;
 *   • `query_api`    — `db.query.commandLog.*` (API quan hệ trả nguyên hàng).
 * Mỗi chỗ có khoá `tệp#hàm-bao#loại` và PHẢI có trong `SO_CAI` với số lần ĐÚNG và một PHÂN LOẠI:
 *   • `che`        — thủ tục canView trả hàng ra ngoài: qua `cheHangLenh` / `chiTietKyThuatCua` (`_chiTietKyThuat.ts`) — cấu trúc được
 *                    kiểm thêm ở §2 (thân thủ tục phải gọi bộ che); hành vi đo ở `commandLogRouter.nhatKy.r1b2b2b.db.test.ts`;
 *   • `vi_tu`      — chỉ trong WHERE / FILTER (không ra ngoài);
 *   • `suy_ra`     — đọc để SUY RA trường an toàn (`ma` = tiền tố mã, `ledger`, `intentId`) — không trả nguyên cột;
 *   • `ghi_canEdit`— đường ghi / dispatch trả kết quả cho NGƯỜI RA LỆNH (đã qua `machine_control.canEdit`);
 *   • `noi_bo`     — dịch vụ nội bộ, không trả về thủ tục đọc.
 * Chỗ đọc MỚI (khoá lạ hoặc số tăng) ⇒ ĐỎ: người thêm phải phân loại có lý do (và nếu là thủ tục canView: qua bộ che).
 *
 * §3 (KD-2bA 1.3) — chứng minh `requested_value.daXacMinhPhamVi` của lần thử `adapter_id` NULL do MÁY CHỦ đặt: mọi lời gọi ghi lần thử
 * KHÔNG có adapter mà có `requestedValue` đều nằm ở MỘT chỗ (`tuChoiQuaHan`), cờ là biến cục bộ chỉ nhận literal `false` / `true`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Loai = "cot" | "select_tat_ca" | "sql_tho" | "query_api";
type PhanLoai = "che" | "vi_tu" | "suy_ra" | "ghi_canEdit" | "noi_bo";

function tepServer(): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist") continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (/\.ts$/.test(n) && !/\.(test|spec)\.ts$/.test(n) && !/testkit/i.test(n) && !n.startsWith("__") && !n.endsWith(".d.ts")) ra.push(p);
    }
  };
  di(join(GOC, "server"));
  return ra.sort();
}

/** Tên hàm / thủ tục bao gần nhất (FunctionDeclaration · MethodDeclaration · VariableDeclaration của arrow/function · PropertyAssignment). */
function hamBao(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isVariableDeclaration(p) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
    if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isCallExpression(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
  }
  return "<tep>";
}

const COT = new Set(["errorText", "ackValue"]);

/** Quét MỘT nguồn (đường dẫn tương đối dùng làm khoá). Xuất ra cho §4 (đột biến trên tệp ảo). */
export function quetNguon(rel: string, src: string): Map<string, number> {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dem = new Map<string, number>();
  const them = (n: ts.Node, loai: Loai) => {
    const k = `${rel}#${hamBao(n)}#${loai}`;
    dem.set(k, (dem.get(k) ?? 0) + 1);
  };
  const tham = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "commandLog" && COT.has(n.name.text)) them(n, "cot");
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "from" &&
      n.arguments.length === 1 &&
      ts.isIdentifier(n.arguments[0]) &&
      n.arguments[0].text === "commandLog"
    ) {
      const goc = n.expression.expression;
      if (ts.isCallExpression(goc) && ts.isPropertyAccessExpression(goc.expression) && /^select(Distinct)?$/.test(goc.expression.name.text) && goc.arguments.length === 0) {
        them(n, "select_tat_ca");
      }
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === "commandLog" && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "query") them(n, "query_api");
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const t = n.text;
      if (t.includes('"errorText"') || t.includes('"ackValue"')) them(n, "sql_tho");
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return dem;
}

/**
 * ★ SỔ CÁI — đo 2026-10-30 trên feat/scada-r1b2b2 (3819461fb + C1). Mỗi khoá: [số lần, phân loại, lý do].
 */
const SO_CAI: Record<string, [number, PhanLoai, string]> = {
  // ── commandLogRouter (thủ tục canView) ──
  "server/routers/commandLogRouter.ts#list#select_tat_ca": [1, "che", "rows.map(cheHangLenh(r, chiTietKyThuatCua(ctx)))"],
  "server/routers/commandLogRouter.ts#get#select_tat_ca": [1, "che", "cheHangLenh(row, chiTietKyThuatCua(ctx))"],
  "server/routers/commandLogRouter.ts#nhatKy#cot": [2, "che", "ackValue chỉ trong vị từ notIntent; errorText ⇒ loi chỉ khi duocXem, ngược lại reasonCode = maLoiCua"],
  "server/routers/commandLogRouter.ts#stats#cot": [2, "vi_tu", "isIntent / notIntent trong WHERE + đếm"],
  "server/routers/commandLogRouter.ts#stats#sql_tho": [1, "vi_tu", "count FILTER not exists r.\"ackValue\"->>'intentId' — chỉ đếm"],
  // ── dispatcher (đường ghi — chỉ người ra lệnh đã qua canEdit nhận kết quả) ──
  "server/services/ot/commandDispatcher.ts#dispatchCore#select_tat_ca": [2, "ghi_canEdit", "idempotency (probe + lệnh sau): cachedResult.reason = errorText trả cho NGƯỜI GỌI dispatch (scadaCommands.confirm / dungMay / AI tool — machine_control.canEdit)"],
  "server/services/ot/commandDispatcher.ts#reserveRealWrite#select_tat_ca": [1, "ghi_canEdit", "prior trong tx: cachedResult cho người gọi dispatch (canEdit)"],
  // ── lenhHmi.trangThai — chủ yêu cầu, chỉ trường SUY RA ──
  "server/services/scada/lenhHmi.ts#trangThaiYeuCauGhi#cot": [2, "suy_ra", "ma = tiền tố mã của errorText; ledger = ackValue.ledger — không trả nguyên cột"],
  // ── edge (nội bộ / vị từ / suy ra intentId; mutation canEdit) ──
  "server/services/edge/edgeResolutionService.ts#listEdgeResolutionItems#sql_tho": [4, "suy_ra", "vị từ ledger + ackValue->>'intentId' / 'lateAfterResolutionId' (số) — không trả ackValue"],
  "server/services/edge/edgeResolutionService.ts#resolveOrphanedIntent#sql_tho": [1, "vi_tu", "EXISTS ... ackValue->>'ledger' — vị từ"],
  "server/services/edge/edgeResolutionService.ts#reviewLateResult#sql_tho": [1, "ghi_canEdit", "supervisorProcedure + canEdit; ackValue chỉ đọc ledger/intentId vào audit"],
};

function doCay(): Map<string, number> {
  const tong = new Map<string, number>();
  for (const p of tepServer()) {
    const rel = relative(GOC, p).replace(/\\/g, "/");
    const src = readFileSync(p, "utf8");
    if (!src.includes("commandLog") && !src.includes("errorText") && !src.includes("ackValue")) continue;
    for (const [k, v] of quetNguon(rel, src)) tong.set(k, (tong.get(k) ?? 0) + v);
  }
  return tong;
}

describe("★★★ census — errorText / ackValue của command_log không ra khỏi máy chủ dưới mức canEdit kỹ sư (KD-2bA 1.1)", () => {
  const DO = doCay();

  it("§0 thiết bị đo thấy dữ liệu: ≥ 1 chỗ mỗi loại cot / select_tat_ca / sql_tho", () => {
    const loai = new Set([...DO.keys()].map((k) => k.split("#")[2]));
    expect(loai.has("cot")).toBe(true);
    expect(loai.has("select_tat_ca")).toBe(true);
    expect(loai.has("sql_tho")).toBe(true);
  });

  it("§1 MỌI chỗ đọc hai cột có trong sổ cái, ĐÚNG số lần (chỗ mới ⇒ phân loại trước)", () => {
    const mong = new Map(Object.entries(SO_CAI).filter(([, v]) => v[0] > 0).map(([k, v]) => [k, v[0]]));
    const lech: string[] = [];
    for (const [k, n] of DO) if (mong.get(k) !== n) lech.push(`${k}: đo ${n}, sổ ${mong.get(k) ?? "—"}`);
    for (const [k, n] of mong) if (!DO.has(k)) lech.push(`${k}: sổ ${n}, đo 0 (gỡ khỏi sổ)`);
    expect(lech, "chỗ đọc errorText/ackValue của command_log lệch sổ cái").toEqual([]);
  });

  it("§2 mọi thủ tục canView của commandLogRouter đọc nguyên hàng / errorText ĐỀU gọi bộ che trong thân (cheHangLenh | chiTietKyThuatCua)", () => {
    const rel = "server/routers/commandLogRouter.ts";
    const src = readFileSync(join(GOC, rel), "utf8");
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const thuTuc = new Map<string, string>();
    const tham = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && ts.isCallExpression(n.initializer) && /\.query\(/.test(n.initializer.getText())) thuTuc.set(n.name.getText(), n.initializer.getText());
      ts.forEachChild(n, tham);
    };
    tham(sf);
    expect([...thuTuc.keys()].sort()).toEqual(["avgDurations", "get", "list", "nhatKy", "stats"]);
    const canChe = [...Object.keys(SO_CAI)].filter((k) => k.startsWith(rel) && SO_CAI[k][1] === "che" && SO_CAI[k][0] > 0).map((k) => k.split("#")[1]);
    expect(canChe.sort()).toEqual(["get", "list", "nhatKy"]);
    for (const t of canChe) expect(thuTuc.get(t), `thủ tục ${t} không gọi bộ che`).toMatch(/chiTietKyThuatCua\(ctx\)/);
    for (const t of ["list", "get"]) expect(thuTuc.get(t), `thủ tục ${t} không qua cheHangLenh`).toMatch(/cheHangLenh\(/);
    // nhatKy: errorText chỉ vào `loi` qua duocXem
    expect(thuTuc.get("nhatKy")).toMatch(/loi: duocXem \? \(r\.errorText \?\? null\) : null/);
    expect(thuTuc.get("nhatKy")).not.toMatch(/ackValue:/);
  });

  it("§4 ĐỘT BIẾN (tệp ảo) — thủ tục canView mới trả select() nguyên hàng ⇒ khoá LẠ (đỏ ở §1); select có chiếu không hai cột ⇒ không vào sổ", () => {
    const ro = quetNguon(
      "server/routers/xRo.ts",
      `export const r = router({ moi: protectedProcedure.query(async () => db.select().from(commandLog)) , sach: protectedProcedure.query(async () => db.select({ id: commandLog.id }).from(commandLog)), tho: p.query(() => sql\`select "errorText" from command_log\`) });`,
    );
    expect(Object.fromEntries(ro)).toEqual({ "server/routers/xRo.ts#moi#select_tat_ca": 1, "server/routers/xRo.ts#tho#sql_tho": 1 });
    for (const k of ro.keys()) expect(SO_CAI[k]).toBeUndefined();
  });
});

describe("★★ KD-2bA 1.3 — `daXacMinhPhamVi` của lần thử adapter NULL do MÁY CHỦ đặt, client không đặt được", () => {
  const tepGhi = tepServer().filter((p) => readFileSync(p, "utf8").includes("scadaCommandAttempts") || readFileSync(p, "utf8").includes("ghiThuLenh"));

  it("chỉ lenhHmi.ts INSERT vào scada_command_attempts (2 chỗ: chenDongTongKet, ghiThuLenh)", () => {
    const cho: string[] = [];
    for (const p of tepGhi) {
      const rel = relative(GOC, p).replace(/\\/g, "/");
      const sf = ts.createSourceFile(rel, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const tham = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "insert" && n.arguments[0]?.getText() === "scadaCommandAttempts") cho.push(`${rel}#${hamBao(n)}`);
        ts.forEachChild(n, tham);
      };
      tham(sf);
    }
    expect(cho.sort()).toEqual(["server/services/scada/lenhHmi.ts#chenDongTongKet", "server/services/scada/lenhHmi.ts#ghiThuLenh"]);
  });

  it("mọi lời gọi ghiThuLenh / ghiThuCoHan KHÔNG adapterId mà CÓ requestedValue: đúng MỘT chỗ (tuChoiQuaHan); cờ là biến cục bộ chỉ nhận literal", () => {
    const kq = kiemCoXacMinh(readFileSync(join(GOC, "server/services/scada/lenhHmi.ts"), "utf8"));
    expect(kq.soLoiGoi).toBeGreaterThanOrEqual(10); // thiết bị đo thấy dữ liệu
    expect(kq.khongAdapterCoGiaTri).toEqual(["tuChoiQuaHan"]);
    expect(kq.viPham).toEqual([]);
  });

  it("ĐỘT BIẾN (trong bộ nhớ, không chạm lenhHmi.ts trên đĩa) — cờ lấy từ input / gán từ biến khác / dòng thử NULL mới mang input.value ⇒ đỏ", () => {
    const goc = readFileSync(join(GOC, "server/services/scada/lenhHmi.ts"), "utf8");
    const dot = (tu: string, thanh: string) => {
      expect(goc.includes(tu), `mẫu đột biến không còn khớp: ${tu}`).toBe(true);
      return kiemCoXacMinh(goc.replace(tu, thanh));
    };
    // (a) cờ trong requested_value lấy từ input client
    expect(dot("requestedValue: { machineId: input.machineId, daXacMinhPhamVi, buoc", "requestedValue: { machineId: input.machineId, daXacMinhPhamVi: (input as any).daXacMinhPhamVi, buoc").viPham.length).toBeGreaterThan(0);
    // (b) biến cờ được gán từ thứ khác literal
    expect(dot("daXacMinhPhamVi = true;", "daXacMinhPhamVi = Boolean((input as any).xacMinh);").viPham.length).toBeGreaterThan(0);
    // (c) lời gọi ghi lần thử KHÔNG adapter mới mang giá trị client
    const c = dot(
      'await ghiThuLenh(db, { userId, stage: "request", outcome: "rejected", reasonCode: "NOT_FOUND", lyDo: input.lyDo });',
      'await ghiThuLenh(db, { userId, stage: "request", outcome: "rejected", reasonCode: "NOT_FOUND", lyDo: input.lyDo, requestedValue: input.value });',
    );
    expect(c.khongAdapterCoGiaTri.length).toBe(2);
    expect(c.viPham.length).toBeGreaterThan(0);
  });
});

/**
 * KD-2bA 1.3 — kiểm nguồn lenhHmi: (1) mọi lời gọi ghi lần thử KHÔNG `adapterId` mà CÓ `requestedValue` ⇒ giá trị là object literal máy chủ
 * dựng, `daXacMinhPhamVi` viết tắt (biến cục bộ); (2) mọi khai báo biến `daXacMinhPhamVi` khởi tạo `false`, mọi phép gán chỉ literal true/false.
 */
function kiemCoXacMinh(src: string): { viPham: string[]; soLoiGoi: number; khongAdapterCoGiaTri: string[] } {
  const sf = ts.createSourceFile("lenhHmi.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const viPham: string[] = [];
  const khaiBao = new Map<string, ts.ObjectLiteralExpression>();
  const nhat = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) khaiBao.set(n.name.text, n.initializer);
    ts.forEachChild(n, nhat);
  };
  nhat(sf);
  const coThuocTinh = (o: ts.ObjectLiteralExpression, ten: string): ts.ObjectLiteralElementLike | undefined =>
    o.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === ten) ??
    o.properties
      .filter(ts.isSpreadAssignment)
      .map((sp) => (ts.isIdentifier(sp.expression) ? khaiBao.get(sp.expression.text) : undefined))
      .map((k) => (k ? coThuocTinh(k, ten) : undefined))
      .find(Boolean);
  const khongAdapterCoGiaTri: string[] = [];
  let soLoiGoi = 0;
  const khai: string[] = [];
  const gan: string[] = [];
  const tham = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "ghiThuLenh" || n.expression.text === "ghiThuCoHan")) {
      const o = n.arguments[1];
      if (o && ts.isObjectLiteralExpression(o)) {
        soLoiGoi++;
        const ad = coThuocTinh(o, "adapterId");
        const rv = coThuocTinh(o, "requestedValue");
        if (!ad && rv) {
          const ten = hamBao(n);
          khongAdapterCoGiaTri.push(ten);
          if (!(ts.isPropertyAssignment(rv) && ts.isObjectLiteralExpression(rv.initializer))) viPham.push(`${ten}: requestedValue không phải object literal máy chủ dựng (${rv.getText().slice(0, 60)})`);
          else {
            const co = coThuocTinh(rv.initializer, "daXacMinhPhamVi");
            if (!co || !ts.isShorthandPropertyAssignment(co)) viPham.push(`${ten}: daXacMinhPhamVi không phải biến cục bộ (${co?.getText().slice(0, 60) ?? "vắng"})`);
          }
        }
      }
    }
    if (ts.isVariableDeclaration(n) && n.name.getText() === "daXacMinhPhamVi") khai.push(n.initializer?.getText() ?? "");
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText() === "daXacMinhPhamVi") gan.push(n.right.getText());
    ts.forEachChild(n, tham);
  };
  tham(sf);
  if (khai.length === 0) viPham.push("không thấy khai báo daXacMinhPhamVi");
  for (const k of khai) if (k !== "false") viPham.push(`khai báo daXacMinhPhamVi = ${k}`);
  if (gan.length === 0) viPham.push("không thấy phép gán daXacMinhPhamVi = true sau kiểm phạm vi");
  for (const g of gan) if (g !== "true" && g !== "false") viPham.push(`gán daXacMinhPhamVi = ${g}`);
  return { viPham, soLoiGoi, khongAdapterCoGiaTri };
}
