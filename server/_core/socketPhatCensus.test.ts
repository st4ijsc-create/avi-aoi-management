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
      'io.to("sites:global").emit("a", 1);',
    ]) expect(quetPhat(s, f), s).toHaveLength(0);
  });
});
