/**
 * ★★★ CENSUS AST (P-S1b, 2026-10-23) — KHÔNG ĐƯỢC PHÁT dữ liệu máy vào phòng `global` hay tới MỌI socket.
 *
 * Lỗ gốc: `io.to("global").emit(...)` / `io.emit(...)` / `socket.broadcast.emit(...)` gửi sự kiện máy tới MỌI client trình duyệt ⇒ người dùng nhà
 * máy B nhận andon/safety/inspection/oee/downtime/mqtt… của nhà máy A. Từ P-S1b sự kiện máy đi qua `socketPhatTheoNhaMay.phatTheoNhaMay`
 * (phòng toàn quyền + phòng nhà máy + phòng phụ). Lưới này đọc AST mọi tệp `server/**` và ĐỎ khi ai đó thêm một điểm phát kiểu cũ — trừ khi nằm trong
 * danh sách MIỄN kèm LÝ DO. Mặc định của một điểm phát mới là CHẶN, không phải im lặng.
 *
 * Bốn dạng bị bắt (callee `.emit`):  (1) `io.emit` / `io?.emit` / `getIO()….emit` (tới mọi socket) · (2) `.to("global")` / `.in("global")` ·
 * (3) `….broadcast.emit` · (4) `.to([... "global" ...])`. Không đụng `io.to("admin")`, `io.to(\`user:…\`)`, `io.to(\`twin:…\`)`, `scada:*`… (phòng có chủ).
 * Có ĐỘT BIẾN: lưới phải bắt từng dạng và THA điểm phát hợp lệ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();

/** MIỄN có lý do. Khoá = đường tệp + tên sự kiện (chuỗi nguyên văn) — KHÔNG thêm im lặng. */
const MIEN: { file: string; suKien: string; lyDo: string }[] = [
  // (trống: sau P-S1b không còn điểm phát nào vào `global`/tới mọi socket. Giữ cơ chế cho lần sau.)
];

export interface ViPhamPhat {
  file: string;
  dong: number;
  dang: string;
  suKien: string;
}

function laIo(e: ts.Expression): boolean {
  const t = e.getText().replace(/[?!]/g, "").replace(/\s+/g, "");
  return t === "io" || t === "getIO()" || /\.io$/.test(t) || t === "(socketModuleasany).io";
}

function chuoiGlobal(e: ts.Expression): boolean {
  if (ts.isStringLiteralLike(e)) return e.text === "global";
  if (ts.isArrayLiteralExpression(e)) return e.elements.some((x) => ts.isExpression(x) && chuoiGlobal(x));
  return false;
}

/** Quét một tệp nguồn: mọi `.emit(...)` rơi vào bốn dạng cấm. */
export function quetPhat(src: string, file: string): ViPhamPhat[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: ViPhamPhat[] = [];
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "emit") {
      const recv = n.expression.expression;
      const suKien = n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : n.arguments[0]?.getText() ?? "?";
      let dang: string | null = null;
      if (ts.isPropertyAccessExpression(recv) && recv.name.text === "broadcast") dang = "broadcast.emit";
      else if (laIo(recv)) dang = "io.emit (tới MỌI socket)";
      else if (ts.isCallExpression(recv) && ts.isPropertyAccessExpression(recv.expression) && (recv.expression.name.text === "to" || recv.expression.name.text === "in")) {
        if (recv.arguments.length > 0 && chuoiGlobal(recv.arguments[0])) dang = `.${recv.expression.name.text}("global").emit`;
        // chuỗi `.to(a).to("global")`
        let cur: ts.Expression = recv;
        while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
          if ((cur.expression.name.text === "to" || cur.expression.name.text === "in") && cur.arguments.length > 0 && chuoiGlobal(cur.arguments[0])) dang = `.to(…"global"…).emit`;
          cur = cur.expression.expression;
        }
      }
      if (dang) out.push({ file, dong: dong(n), dang, suKien });
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return out;
}

function tepServer(): string[] {
  const out: string[] = [];
  const di = (dir: string) => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = resolve(dir, ten);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (/\.ts$/.test(ten) && !/\.(test|spec|d)\.ts$/.test(ten)) out.push(p);
    }
  };
  di(resolve(GOC, "server"));
  return out;
}

const doc = (rel: string) => readFileSync(resolve(GOC, rel), "utf8");
const bocChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("census — không phát dữ liệu máy vào `global` / tới mọi socket", () => {
  it("quét TOÀN server/: 0 điểm phát vào global / io.emit / broadcast (trừ miễn có lý do)", () => {
    const tep = tepServer();
    expect(tep.length, "glob rỗng ⇒ census mù").toBeGreaterThan(300);
    const vi: ViPhamPhat[] = [];
    for (const p of tep) {
      const rel = relative(GOC, p).replace(/\\/g, "/");
      const src = readFileSync(p, "utf8");
      if (!/\.emit\(/.test(src)) continue;
      for (const v of quetPhat(src, rel)) if (!MIEN.some((m) => m.file === v.file && m.suKien === v.suKien)) vi.push(v);
    }
    expect(vi, vi.map((v) => `${v.file}:${v.dong} ${v.dang} "${v.suKien}"`).join("\n")).toEqual([]);
  });

  it("mọi mục miễn có lý do và còn tồn tại (không miễn mồ côi)", () => {
    for (const m of MIEN) {
      expect(m.lyDo.length, `miễn ${m.file} ${m.suKien} thiếu lý do`).toBeGreaterThan(20);
      expect(quetPhat(doc(m.file), m.file).some((v) => v.suKien === m.suKien), `miễn mồ côi: ${m.file} ${m.suKien}`).toBe(true);
    }
  });

  it("bộ phát theo nhà máy KHÔNG chứa chuỗi \"global\" trong mã (chú thích bỏ qua) — nó là chốt chặn, không được tự mở cửa", () => {
    expect(bocChuThich(doc("server/_core/socketPhatTheoNhaMay.ts"))).not.toMatch(/["'`]global["'`]/);
  });

  it("các điểm phát đã chuyển đều đi qua phatTheoNhaMay / phatMangTheoNhaMay (đếm ≥ 20 trong socket.ts + 3 dịch vụ)", () => {
    const dem = (f: string) => (bocChuThich(doc(f)).match(/\bphat(Mang)?TheoNhaMay\(/g) ?? []).length;
    expect(dem("server/_core/socket.ts")).toBeGreaterThanOrEqual(20);
    expect(dem("server/services/machinePresenceService.ts")).toBeGreaterThanOrEqual(1);
    expect(dem("server/services/downtimeDetectionService.ts")).toBeGreaterThanOrEqual(2);
  });
});

describe("ĐỘT BIẾN — lưới phải BẮT bốn dạng và THA điểm hợp lệ", () => {
  const f = "server/x.ts";
  it("(1) io.emit / io?.emit / getIO()!.emit", () => {
    expect(quetPhat('io.emit("a", 1);', f)).toHaveLength(1);
    expect(quetPhat('io?.emit("a", 1);', f)).toHaveLength(1);
    expect(quetPhat('getIO()!.emit("a", 1);', f)).toHaveLength(1);
    expect(quetPhat('(socketModule as any).io.emit("a", 1);', f)).toHaveLength(1);
  });
  it("(2) .to(\"global\") / .in('global')", () => {
    expect(quetPhat('io.to("global").emit("a", 1);', f)).toHaveLength(1);
    expect(quetPhat("io?.in('global').emit('a', 1);", f)).toHaveLength(1);
  });
  it("(3) socket.broadcast.emit", () => {
    expect(quetPhat('socket.broadcast.emit("a", 1);', f)).toHaveLength(1);
  });
  it("(4) mảng phòng có global / chuỗi .to(x).to(\"global\")", () => {
    expect(quetPhat('io.to(["a", "global"]).emit("a", 1);', f)).toHaveLength(1);
    expect(quetPhat('io.to("a").to("global").emit("a", 1);', f)).toHaveLength(1);
  });
  it("THA: phòng có chủ (admin · user · twin · factory · scope:all · machine) và socket.emit tới chính socket", () => {
    for (const s of [
      'io.to("admin").emit("a", 1);',
      "io.to(`user:${id}`).emit('a', 1);",
      "io.to(`twin:${f}`).emit('a', 1);",
      'io.to(["scope:all", "factory:3"]).emit("a", 1);',
      "io.to(`machine:${m}`).emit('a', 1);",
      'socket.emit("a", 1);',
    ]) expect(quetPhat(s, f), s).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ PV-socket-1 (2026-11-03) — `site:update` (KPI + số cảnh báo theo SITE) chỉ phát theo PHẠM VI, từ ĐÚNG MỘT chỗ
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Lỗ L1: `io.to(`site:${code}`)` / `io.to("sites:global")` — phòng ai đăng nhập cũng vào được. Từ PV-socket-1 phòng của `site:update` là
// `sites:all` / `sites:corp:{mã}` (cổng `duocVaoPhongFederation`), định tuyến bởi `phongNhanSiteUpdate` (gương `dieuKienTrang`). Luật:
//  (S1) `.to/.in` tới một tên phòng DỰNG TẠI CHỖ bắt đầu `site:` / `sites:` (literal, template, phép nối `"sites:" + x`) ⇒ CẤM ở mọi nơi
//       (fix round 1 m1 — kể cả trong hàm phát: tên phòng chỉ đến từ hằng / hàm dựng của socketPhongQuyen.ts);
//  (S2) `.emit("site:update", …)` ⇒ CHỈ trong hàm `emitSiteUpdate` của socket.ts;
//  (S3) `.to/.in` có đối số chạm `sites:` / tên phòng federation (hằng · hàm dựng) ⇒ CHỈ trong `emitSiteUpdate`;
//  (S4) chuỗi `sites:all` / `sites:corp:` (literal, không tính chú thích) ⇒ CHỈ trong socketPhongQuyen.ts (không ai dựng tên phòng ở nơi khác).
const TEN_PHONG_FEDERATION = /\b(PHONG_SITES_TOAN_QUYEN|TIEN_TO_PHONG_SITES_TAP_DOAN|phongSitesTapDoan|phongNhanSiteUpdate)\b/;
const HAM_PHAT_SITE = { file: "server/_core/socket.ts", ham: "emitSiteUpdate" };

export interface ViPhamSite {
  file: string;
  dong: number;
  luat: "S1" | "S2" | "S3" | "S4";
  ma: string;
}

/** Đoạn chữ ĐẦU TIÊN (trái nhất) của mỗi tên phòng trong đối số: literal · template · phép nối `a + b` · ngoặc · mảng (fix round 1 m1). */
function chuoiCua(e: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(e)) return chuoiCua(e.expression);
  if (ts.isStringLiteralLike(e)) return [e.text];
  if (ts.isTemplateExpression(e)) return [e.head.text];
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return chuoiCua(e.left);
  if (ts.isArrayLiteralExpression(e)) return e.elements.flatMap((x) => (ts.isExpression(x) ? chuoiCua(x) : []));
  return [];
}

/** Bộ lọc trước của lượt quét toàn server (fix round 1 m1): KHÔNG phân biệt hoa thường — phongSitesTapDoan / PHONG_SITES_TOAN_QUYEN … viết hoa S. */
export const canQuetSite = (src: string): boolean => /site/i.test(src);

export function quetPhatSite(src: string, file: string): ViPhamSite[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: ViPhamSite[] = [];
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const trongHamPhat = (n: ts.Node): boolean => {
    if (file !== HAM_PHAT_SITE.file) return false;
    for (let c: ts.Node | undefined = n.parent; c; c = c.parent) if (ts.isFunctionDeclaration(c)) return c.name?.text === HAM_PHAT_SITE.ham;
    return false;
  };
  const duyet = (n: ts.Node): void => {
    if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n)) && /sites:all|^sites:corp:/.test(n.text) && file !== "server/_core/socketPhongQuyen.ts") {
      out.push({ file, dong: dong(n), luat: "S4", ma: n.getText() });
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "emit") {
      const suKien = n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : null;
      if (suKien === "site:update" && !trongHamPhat(n)) out.push({ file, dong: dong(n), luat: "S2", ma: n.getText().slice(0, 80) });
      for (let cur: ts.Expression = n.expression.expression; ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression); cur = cur.expression.expression) {
        const ten = cur.expression.name.text;
        if ((ten !== "to" && ten !== "in") || cur.arguments.length === 0) continue;
        const dd = cur.arguments[0];
        if (chuoiCua(dd).some((t) => t.startsWith("site:") || t.startsWith("sites:"))) out.push({ file, dong: dong(n), luat: "S1", ma: dd.getText() });
        else if ((/sites:/.test(dd.getText()) || TEN_PHONG_FEDERATION.test(dd.getText())) && !trongHamPhat(n)) out.push({ file, dong: dong(n), luat: "S3", ma: dd.getText() });
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return out;
}

describe("census PV-socket-1 — `site:update` chỉ phát theo phạm vi, từ ĐÚNG MỘT hàm", () => {
  it("quét TOÀN server/: 0 vi phạm S1–S4", () => {
    const tep = tepServer();
    expect(tep.length, "glob rỗng ⇒ census mù").toBeGreaterThan(300);
    const vp: ViPhamSite[] = [];
    for (const p of tep) {
      const rel = relative(GOC, p).replace(/\\/g, "/");
      const src = readFileSync(p, "utf8");
      if (!canQuetSite(src)) continue;
      vp.push(...quetPhatSite(src, rel));
    }
    expect(vp, vp.map((v) => `${v.file}:${v.dong} ${v.luat} ${v.ma}`).join("\n")).toEqual([]);
  });

  it("đối chứng DƯƠNG: `emitSiteUpdate` THẬT phát `site:update` đúng một lần qua `phongNhanSiteUpdate` (bộ dò không mù)", () => {
    const src = doc(HAM_PHAT_SITE.file);
    const than = src.slice(src.indexOf("export function emitSiteUpdate("), src.indexOf("// Emit alert escalation event"));
    expect(bocChuThich(than).match(/\.emit\("site:update"/g) ?? []).toHaveLength(1);
    expect(than).toContain("io.to(phongNhanSiteUpdate(");
    expect(bocChuThich(src).match(/\.emit\("site:update"/g) ?? []).toHaveLength(1);
  });
});

describe("ĐỘT BIẾN PV-socket-1 — lưới site:update phải BẮT", () => {
  const goc = () => doc(HAM_PHAT_SITE.file);
  const dongPhat = "io.to(phongNhanSiteUpdate({ corporateCode, isLocal })).emit(\"site:update\", goi);";
  const doi = (thay: string) => quetPhatSite(goc().replace(dongPhat, thay), HAM_PHAT_SITE.file);
  it("nguồn gốc: dòng phát có mặt + 0 vi phạm", () => {
    expect(goc()).toContain(dongPhat);
    expect(quetPhatSite(goc(), HAM_PHAT_SITE.file)).toEqual([]);
  });
  it("(S1) quay lại `sites:global` / `site:{code}` (kể cả trong hàm phát) ⇒ ĐỎ", () => {
    expect(doi('io.to("sites:global").emit("site:update", goi);').some((v) => v.luat === "S1")).toBe(true);
    expect(doi("io.to(`site:${evt.siteCode}`).emit(\"site:update\", goi);").some((v) => v.luat === "S1")).toBe(true);
    expect(doi('io.to(["sites:all", "sites:global"]).emit("site:update", goi);').some((v) => v.luat === "S1")).toBe(true);
  });
  it("(S2/S3) phát `site:update` hoặc vào phòng federation NGOÀI `emitSiteUpdate` ⇒ ĐỎ", () => {
    const them = goc() + '\nexport function phatKhac(io: any, ma: string) { io.to(phongSitesTapDoan(ma)).emit("x", 1); io.to("a").emit("site:update", 1); }\n';
    const vp = quetPhatSite(them, HAM_PHAT_SITE.file);
    expect(vp.map((v) => v.luat).sort()).toEqual(["S2", "S3"]);
    expect(quetPhatSite('io.to(PHONG_SITES_TOAN_QUYEN).emit("y", 1);', "server/services/x.ts").map((v) => v.luat)).toEqual(["S3"]);
  });
  it("(m1) phép nối / template / ngoặc tới `site:` / `sites:` ⇒ S1 ĐỎ ở mọi nơi; tệp chỉ dùng tên hàm dựng (không chữ \"site\" thường) KHÔNG bị bỏ qua", () => {
    for (const ma of ['io.to("site:" + c).emit("x", 1);', 'io.to("sites:" + "global").emit("x", 1);', 'io.to(("sites:corp:" + m)).emit("x", 1);', "io.to(`sites:${k}`).emit('x', 1);", 'io.in(["a", "sites:" + k]).emit("x", 1);']) {
      expect(quetPhatSite(ma, "server/services/x.ts").map((v) => v.luat), ma).toContain("S1");
    }
    expect(doi('io.to("sites:" + "all").emit("site:update", goi);').some((v) => v.luat === "S1")).toBe(true); // kể cả trong hàm phát
    const chiTenHam = 'import { phongSitesTapDoan } from "../_core/socketPhongQuyen";\nexport function f(io: any, c: string) { io.to(phongSitesTapDoan(c)!).emit("kpi:detail", 1); }\n';
    expect(/site/.test(chiTenHam)).toBe(false); // bộ lọc cũ (phân biệt hoa thường) sẽ BỎ QUA tệp này
    expect(canQuetSite(chiTenHam)).toBe(true); // bộ lọc THẬT của lượt quét toàn server
    expect(quetPhatSite(chiTenHam, "server/services/x.ts").map((v) => v.luat)).toEqual(["S3"]);
  });

  it("(S4) dựng tên phòng `sites:all` / `sites:corp:` ở tệp khác ⇒ ĐỎ (tham chiếu: socketPhongQuyen.ts được phép)", () => {
    expect(quetPhatSite('const p = "sites:all";', "server/services/x.ts").map((v) => v.luat)).toEqual(["S4"]);
    expect(quetPhatSite("const p = `sites:corp:${m}`;", "server/services/x.ts").map((v) => v.luat)).toEqual(["S4"]);
    expect(quetPhatSite('const p = "sites:all";', "server/_core/socketPhongQuyen.ts")).toEqual([]);
  });
});
