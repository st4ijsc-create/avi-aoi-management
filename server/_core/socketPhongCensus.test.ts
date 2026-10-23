/**
 * ★★★ CENSUS AST (2026-10-23) — MỌI `socket.join(...)` của gateway socket phải đứng sau một CỔNG kiểm (phạm vi / quyền / xác thực), hoặc nằm
 * trong danh sách MIỄN có lý do.
 *
 * Lỗ gốc: handler `subscribe` cho MỌI socket người dùng join `factory:` / `workshop:` / `line:` / `machine:` / `robot:` / `device:` /
 * `telemetry:all` bằng id TỰ KHAI (chỉ `twin:` có kiểm) ⇒ nhà máy B nhận dữ liệu realtime của nhà máy A. Đây là lớp lỗi "đường thứ N quên":
 * ai thêm một `socket.join` mới mà quên cổng sẽ làm lưới này ĐỎ đúng chỗ (mặc định của phòng mới là CHẶN, không phải im lặng).
 *
 * Hình dạng: đọc AST (không regex trên dòng) → với mỗi lời gọi `<x>.join(<phòng>)` mà `<x>` là `socket`, lấy (1) mẫu tên phòng,
 * (2) HANDLER bao ngoài (hàm truyền cho `socket.on(...)`). Mỗi lời gọi phải khớp ĐÚNG MỘT luật trong BẢNG dưới đây; luật `gate` đòi handler
 * chứa các lời gọi cổng đã khai; luật `mien` ghi LÝ DO. Luật mồ côi (không lời gọi nào khớp) ⇒ ĐỎ. Riêng `thuVaoPhong(...)` (hàm bọc join bất đồng
 * bộ của `subscribe`): MỌI lời gọi phải truyền một CỔNG hợp lệ (hoặc `Promise.resolve(false)` — id sai hình dạng ⇒ từ chối).
 *
 * Có ĐỘT BIẾN: lưới phải BẮT (a) phòng mới không cổng, (b) cổng bị thay bằng `Promise.resolve(true)`, (c) bỏ cổng của luật cũ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();

interface Luat {
  file: string;
  /** Khớp MẪU tên phòng (nguồn của đối số đầu tiên của `join`, đã bỏ khoảng trắng thừa). */
  phong: RegExp;
  /** Các chuỗi PHẢI xuất hiện trong handler bao ngoài (lời gọi cổng). */
  gate?: string[];
  /** Miễn: LÝ DO (bắt buộc khi không có `gate`). */
  mien?: string;
}

/** Cổng hợp lệ cho đối số thứ hai của `thuVaoPhong(phòng, <cổng>)`. */
const CONG_THU_VAO_PHONG = ["duocVaoPhongPhamVi", "duocVaoPhongRobot", "duocVaoPhongThietBi", "duocVaoPhongTelemetryAll"];

const LUAT: Luat[] = [
  // ── subscribe: hàm bọc join bất đồng bộ (MỌI lời gọi `thuVaoPhong` được kiểm riêng bên dưới)
  { file: "server/_core/socket.ts", phong: /^phong$/, gate: ["duocVaoPhongPhamVi(", "duocVaoPhongRobot(", "duocVaoPhongThietBi(", "duocVaoPhongTelemetryAll("] },
  // ── twin: cổng có từ Đợt 6 (G12/G20)
  { file: "server/_core/socket.ts", phong: /^`twin:\$\{twinFactoryId\}`$/, gate: ["nguoiXemDuocNhan(", "resolveTenantFactoryScope("] },
  // ── engineering: QUYỀN + PHẠM VI
  { file: "server/_core/socket.ts", phong: /^phong$/, gate: ["duocVaoPhongEngineering(", "duocVaoPhongPhamVi("] },
  // ── luồng MÁY: phòng `machine:{id}` của CHÍNH máy đã xác thực apiKey (id lấy từ máy đã gắn, không từ payload)
  { file: "server/_core/socket.ts", phong: /^`machine:\$\{machineId\}`$/, gate: ["xacDinhMaySuKien("] },
  // ── admin
  { file: "server/_core/socket.ts", phong: /^"admin"$/, gate: ["duocQuanLyDangKyMay("] },
  // ── P-S1b: tự vào phòng theo PHẠM VI của chính người dùng (idsTrongPhamVi) — không từ lời tự khai
  { file: "server/_core/socketPhongQuyen.ts", phong: /^PHONG_TOAN_QUYEN_SOCKET$/, gate: ["laSocketNguoiDung(", "idsTrongPhamVi("] },
  { file: "server/_core/socketPhongQuyen.ts", phong: /^`factory:\$\{id\}`$/, gate: ["laSocketNguoiDung(", "idsTrongPhamVi("] },
  // ── thông báo theo người dùng: chỉ phòng CỦA MÌNH
  { file: "server/services/notificationService.ts", phong: /^`user:\$\{userId\}`$/, gate: ["duocVaoPhongNguoiDung("] },
  // ── MIỄN (có lý do — KHÔNG thêm im lặng)
  {
    file: "server/_core/socket.ts",
    phong: /^"global"$/,
    mien: "phòng chung CHỈ cho socket người dùng đã xác thực (đã qua `laSocketNguoiDung` ở đầu `subscribe`). ⚠ GHI NHẬN: nhiều sự kiện máy vẫn phát vào `global` (andon/oee/inspection…) — rò theo NHÀ MÁY ở tầng PHÁT, không phải tầng vào phòng; cần việc riêng (phát theo phòng nhà máy).",
  },
  { file: "server/_core/socket.ts", phong: /^`site:\$\{\(data as any\)\.siteCode\}`$/, mien: "roll-up liên nhà máy của federation (cấp SITE, không phải dữ liệu một nhà máy); chưa có mô hình phạm vi theo site — cần quyết định sản phẩm." },
  { file: "server/_core/socket.ts", phong: /^"sites:global"$/, mien: "như `site:` — tổng hợp federation toàn cục; trang Federation là trang quản trị cấp tập đoàn." },
  { file: "server/_core/socket.ts", phong: /^"ai:agents"$/, mien: "tín hiệu NHẮC làm mới (không mang dữ liệu phiên/kế hoạch/đối số — xem `aiAgentRealtime.ts`); chỉ socket người dùng." },
];

/** Hợp lệ làm đối số cổng của `thuVaoPhong`. */
function laCongHopLe(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return laCongHopLe(e.expression);
  if (ts.isConditionalExpression(e)) return laCongHopLe(e.whenTrue) && laCongHopLe(e.whenFalse);
  if (ts.isCallExpression(e)) {
    const t = e.expression.getText();
    if (t === "Promise.resolve") return e.arguments.length === 1 && e.arguments[0].getText() === "false"; // từ chối, không phải mở cửa
    return CONG_THU_VAO_PHONG.includes(t);
  }
  return false;
}

export interface ViPham {
  file: string;
  dong: number;
  phong: string;
  lyDo: string;
}

/** Quét một tệp nguồn: trả vi phạm + (file, mẫu phòng) đã khớp luật nào (để bắt luật mồ côi). */
export function quetJoin(src: string, file: string): { viPham: ViPham[]; khop: number[] } {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const viPham: ViPham[] = [];
  const khop: number[] = [];
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const handlerBao = (n: ts.Node): ts.Node => {
    // hàm truyền cho một lời gọi `.on(...)` gần nhất; không có ⇒ hàm ngoài cùng
    let cur: ts.Node | undefined = n.parent;
    let hamNgoai: ts.Node | undefined;
    while (cur) {
      if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur) || ts.isFunctionDeclaration(cur)) {
        hamNgoai = cur;
        const p = cur.parent;
        if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "on" && p.expression.expression.getText().endsWith("socket")) return cur;
      }
      cur = cur.parent;
    }
    return hamNgoai ?? sf;
  };

  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      // socket.join(<phòng>)
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "join" && callee.expression.getText() === "socket" && n.arguments.length >= 1) {
        const phong = n.arguments[0].getText().replace(/\s+/g, " ");
        const handler = handlerBao(n).getText();
        const ungVien = LUAT.map((l, i) => ({ l, i })).filter(({ l }) => l.file === file && l.phong.test(phong));
        // chọn luật có đủ cổng trong handler (cùng mẫu `phong` có thể có nhiều luật theo handler khác nhau)
        const dat = ungVien.filter(({ l }) => (l.gate ?? []).every((g) => handler.includes(g)));
        if (ungVien.length === 0) {
          viPham.push({ file, dong: dong(n), phong, lyDo: "`socket.join` KHÔNG có trong bảng luật — phòng mới phải có CỔNG (phạm vi/quyền/xác thực) hoặc khai MIỄN kèm lý do" });
        } else if (dat.length === 0) {
          viPham.push({ file, dong: dong(n), phong, lyDo: `handler bao ngoài THIẾU cổng đã khai (${ungVien.map(({ l }) => (l.gate ?? ["(miễn)"]).join("+")).join(" | ")})` });
        } else {
          for (const { i } of dat) khop.push(i);
        }
      }
      // thuVaoPhong(<phòng>, <cổng>)
      if (ts.isIdentifier(callee) && callee.text === "thuVaoPhong") {
        if (n.arguments.length < 2 || !laCongHopLe(n.arguments[1])) {
          viPham.push({ file, dong: dong(n), phong: n.arguments[0]?.getText() ?? "?", lyDo: "`thuVaoPhong` phải nhận một CỔNG hợp lệ (duocVaoPhong* hoặc Promise.resolve(false)) làm đối số thứ hai" });
        }
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return { viPham, khop };
}

/** Tệp server (không test) có `socket.join(` — gom TOÀN BỘ gateway, không chỉ socket.ts. */
function tepCoJoin(): string[] {
  const out: string[] = [];
  const di = (dir: string) => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = resolve(dir, ten);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (/\.ts$/.test(ten) && !/\.(test|spec|d)\.ts$/.test(ten) && readFileSync(p, "utf8").includes("socket.join(")) out.push(relative(GOC, p).replace(/\\/g, "/"));
    }
  };
  di(resolve(GOC, "server"));
  return out.sort();
}

const doc = (rel: string) => readFileSync(resolve(GOC, rel), "utf8");

describe("census — mọi socket.join đứng sau cổng hoặc có miễn kèm lý do", () => {
  it("quét TOÀN server/: chỉ các tệp đã biết có socket.join (tệp mới ⇒ phải vào bảng luật)", () => {
    expect(tepCoJoin()).toEqual(["server/_core/socket.ts", "server/_core/socketPhongQuyen.ts", "server/services/notificationService.ts"]);
  });

  it("socket.ts + notificationService.ts: 0 vi phạm; mọi luật đều có ≥ 1 lời gọi khớp (không luật mồ côi); miễn có lý do", () => {
    const tong: ViPham[] = [];
    const khop = new Set<number>();
    for (const f of tepCoJoin()) {
      const r = quetJoin(doc(f), f);
      tong.push(...r.viPham);
      r.khop.forEach((i) => khop.add(i));
    }
    expect(tong, tong.map((v) => `${v.file}:${v.dong} ${v.phong} — ${v.lyDo}`).join("\n")).toEqual([]);
    const moCoi = LUAT.map((l, i) => ({ l, i })).filter(({ i }) => !khop.has(i));
    expect(moCoi.map(({ l }) => `${l.file} ${l.phong}`), "luật mồ côi — xoá hoặc sửa").toEqual([]);
    for (const l of LUAT) expect(Boolean(l.gate?.length) || (l.mien ?? "").length > 20, `luật ${l.phong} thiếu cổng/lý do miễn`).toBe(true);
  });

  it("tên cổng trong bảng thực sự được export (không trỏ vào hàm không tồn tại)", () => {
    const src = doc("server/_core/socketPhongQuyen.ts");
    for (const g of CONG_THU_VAO_PHONG) expect(src, g).toMatch(new RegExp(`export (async )?function ${g}\\b|export const ${g}\\b`));
  });
});

describe("ĐỘT BIẾN — lưới phải BẮT", () => {
  const socketTs = () => doc("server/_core/socket.ts");

  it("(a) thêm một phòng MỚI không cổng ở `subscribe` ⇒ ĐỎ", () => {
    const loi = socketTs().replace('socket.join("global");', 'socket.join("global");\n      socket.join(`plc:${dd.plcId}`);');
    expect(loi).not.toBe(socketTs());
    const r = quetJoin(loi, "server/_core/socket.ts");
    expect(r.viPham.some((v) => v.phong.includes("plc:"))).toBe(true);
  });

  it("(b) một lời gọi `thuVaoPhong` bị thay cổng bằng Promise.resolve(true) / bỏ cổng ⇒ ĐỎ", () => {
    const g = 'thuVaoPhong("telemetry:all", duocVaoPhongTelemetryAll(socket.data));';
    expect(socketTs()).toContain(g);
    const a = quetJoin(socketTs().replace(g, 'thuVaoPhong("telemetry:all", Promise.resolve(true));'), "server/_core/socket.ts");
    expect(a.viPham.length).toBeGreaterThan(0);
    const b = quetJoin(socketTs().replace(g, 'thuVaoPhong("telemetry:all", socket.data ? Promise.resolve(true) : duocVaoPhongTelemetryAll(socket.data));'), "server/_core/socket.ts");
    expect(b.viPham.length).toBeGreaterThan(0);
    const c = quetJoin(socketTs().replace(g, 'thuVaoPhong("telemetry:all");'), "server/_core/socket.ts");
    expect(c.viPham.length).toBeGreaterThan(0);
  });

  it("(c) bỏ cổng của luật cũ: twin không còn nguoiXemDuocNhan / engineering không còn kiểm phạm vi ⇒ ĐỎ", () => {
    const twin = socketTs().split("nguoiXemDuocNhan(").join("khongKiem(");
    expect(quetJoin(twin, "server/_core/socket.ts").viPham.some((v) => v.phong.includes("twin:"))).toBe(true);
    const eng = socketTs().replace('(await duocVaoPhongPhamVi(socket.data, "machine", data.machineId))', "true");
    expect(eng).not.toBe(socketTs());
    expect(quetJoin(eng, "server/_core/socket.ts").viPham.some((v) => v.phong === "phong")).toBe(true);
  });

  it("(d) đối chứng DƯƠNG: nguồn gốc không đột biến ⇒ 0 vi phạm (bộ dò không đỏ vô cớ)", () => {
    expect(quetJoin(socketTs(), "server/_core/socket.ts").viPham).toEqual([]);
  });
});
