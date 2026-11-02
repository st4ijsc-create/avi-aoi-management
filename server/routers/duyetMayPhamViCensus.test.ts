/**
 * ★★★ CENSUS AST (F5-nhanh, 2026-11-02) — MỌI đường DUYỆT / TỪ CHỐI đăng ký máy gọi `kiemPhamViDuyetMay` (server/_core/phamViDuyetMay.ts)
 * TRƯỚC khi ghi.
 *
 * Lỗ gốc: cờ `MACHINE_APPROVE_RBAC_OPEN_ENABLED` cho người không phải admin duyệt máy; cả tRPC `machine.approve` lẫn socket
 * `admin:approve_registration` không kiểm phạm vi ⇒ duyệt / đúc khoá cho máy nhà máy khác. Lớp lỗi "đường thứ N quên": một đường duyệt /
 * từ chối MỚI (router khác, REST, socket khác) mà không gọi hàm chung ⇒ ĐỎ.
 *
 * "Đường duyệt / từ chối" nhận theo HÌNH DẠNG (không danh sách tên), trong `server/**` không test:
 *   · lời gọi `approveMachine(` / `rejectMachine(` (bộ ghi của db/hierarchy);
 *   · `registrationStatus: "approved" | "rejected"` trong đối số của `updateMachine(`;
 *   · phát `"machine:registration_approved"` / `"machine:registration_rejected"`.
 * Đơn vị = thủ tục (thuộc tính của `router({...})`) · handler `socket.on(...)` · hàm ngoài cùng. Đơn vị phải gọi `kiemPhamViDuyetMay(` ở vị
 * trí TRƯỚC điểm ghi đầu tiên.
 * Có ĐỘT BIẾN (chạy tay, ghi trong báo cáo F5-nhanh): bỏ lời gọi ở tRPC / ở socket; thêm một thủ tục duyệt mới không gọi ⇒ ĐỎ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");
const HAM = "kiemPhamViDuyetMay";

/** Tệp được miễn (có lý do; chỉ được thu hẹp). */
const MIEN: Record<string, string> = {
  "server/db/hierarchy.ts":
    "KHAI các bộ ghi approveMachine/rejectMachine (tầng dữ liệu, không có người gọi) + đường ENROLLMENT bằng token máy (thông tin xác thực " +
    "máy, không có chủ thể người dùng để kiểm phạm vi — token do admin phát trước)",
};

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

/** Đơn vị bao quanh một điểm ghi + nhãn. */
function donVi(n: ts.Node, sf: ts.SourceFile): { nut: ts.Node; nhan: string } {
  let ngoaiCung: ts.Node | null = null;
  for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
    // thủ tục: thuộc tính của object literal là đối số của `router(`
    if (
      ts.isPropertyAssignment(a) &&
      ts.isObjectLiteralExpression(a.parent) &&
      ts.isCallExpression(a.parent.parent) &&
      tenGoi(a.parent.parent) === "router"
    ) {
      return { nut: a, nhan: `thủ tục ${a.name.getText(sf)}` };
    }
    // handler socket.on("ev", fn)
    if (
      ts.isFunctionLike(a) &&
      ts.isCallExpression(a.parent) &&
      tenGoi(a.parent) === "on" &&
      a.parent.arguments[1] === a &&
      ts.isStringLiteralLike(a.parent.arguments[0])
    ) {
      return { nut: a, nhan: `socket.on("${(a.parent.arguments[0] as ts.StringLiteralLike).text}")` };
    }
    if (ts.isFunctionLike(a)) ngoaiCung = a;
  }
  return { nut: ngoaiCung ?? sf, nhan: "hàm ngoài cùng" };
}

interface Diem {
  file: string;
  dong: number;
  nhan: string;
  coHam: boolean;
  hamTruoc: boolean;
  loai: string;
}
function quet(file: string, ma: string): Diem[] {
  const sf = ts.createSourceFile(file, ma, ts.ScriptTarget.Latest, true);
  const ra: Diem[] = [];
  const them = (n: ts.Node, loai: string) => {
    const dv = donVi(n, sf);
    const goi: number[] = [];
    const tim = (x: ts.Node) => {
      if (ts.isCallExpression(x) && tenGoi(x) === HAM) goi.push(x.getStart(sf));
      ts.forEachChild(x, tim);
    };
    tim(dv.nut);
    ra.push({
      file,
      dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      nhan: dv.nhan,
      coHam: goi.length > 0,
      hamTruoc: goi.some((g) => g < n.getStart(sf)),
      loai,
    });
  };
  const di = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const t = tenGoi(n);
      if (t === "approveMachine" || t === "rejectMachine") them(n, t);
    }
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(sf) === "registrationStatus" &&
      ts.isStringLiteralLike(n.initializer) &&
      (n.initializer.text === "approved" || n.initializer.text === "rejected")
    ) {
      // chỉ khi nằm trong đối số của updateMachine(...)
      for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
        if (ts.isCallExpression(a)) {
          if (tenGoi(a) === "updateMachine") them(n, `updateMachine(registrationStatus:${n.initializer.text})`);
          break;
        }
      }
    }
    if (ts.isStringLiteralLike(n) && (n.text === "machine:registration_approved" || n.text === "machine:registration_rejected")) {
      them(n, `emit ${n.text}`);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

const TAT_CA = liet(resolve(GOC, "server")).flatMap((p) => {
  const f = rel(p);
  const ma = readFileSync(p, "utf8");
  if (!/approveMachine|rejectMachine|registrationStatus|registration_(approved|rejected)/.test(ma)) return [];
  return quet(f, ma);
});

describe("★★★ F5-nhanh — census: mọi đường duyệt / từ chối máy kiểm phạm vi máy", () => {
  it("thiết bị đo tự canh: thấy đủ bốn đường đã biết (tRPC approve/reject, socket approve/reject)", () => {
    const nhan = new Set(TAT_CA.filter((d) => !MIEN[d.file]).map((d) => `${d.file} :: ${d.nhan}`));
    expect([...nhan]).toEqual(
      expect.arrayContaining([
        "server/routers/hierarchyRouters.ts :: thủ tục approve",
        "server/routers/hierarchyRouters.ts :: thủ tục reject",
        'server/_core/socket.ts :: socket.on("admin:approve_registration")',
        'server/_core/socket.ts :: socket.on("admin:reject_registration")',
      ]),
    );
  });

  it("mỗi điểm duyệt / từ chối (ngoài MIEN) nằm trong đơn vị gọi kiemPhamViDuyetMay TRƯỚC điểm ghi", () => {
    const loi = TAT_CA.filter((d) => !MIEN[d.file] && !(d.coHam && d.hamTruoc)).map(
      (d) => `${d.file}:${d.dong} [${d.loai}] trong ${d.nhan}: ${d.coHam ? "gọi kiemPhamViDuyetMay SAU điểm ghi" : "KHÔNG gọi kiemPhamViDuyetMay"}`,
    );
    expect(loi).toEqual([]);
  });

  it("MIEN chỉ được thu hẹp: mục mồ côi ⇒ ĐỎ", () => {
    const moCoi = Object.keys(MIEN).filter((f) => !TAT_CA.some((d) => d.file === f));
    expect(moCoi).toEqual([]);
  });
});
