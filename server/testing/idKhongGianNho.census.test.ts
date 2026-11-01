/**
 * ★ Census AST (2026-11-02, kiem-dinh) — test KHÔNG sinh id / khoá / cửa sổ thời gian từ một KHÔNG GIAN NHỎ (`Date.now() % 9_000`, `seconds % 9000`, `Math.random() * 900` …).
 *
 * Vì sao (hai gốc ĐÃ ĐO cùng một họ):
 *   • `robotHitlActionRequired.dot1c` — `990_710_000 + Date.now() % 9_000` + `audit_logs` WORM (không DELETE): 512/9000 id đã có hàng ⇒ ~5,7 % lượt đụng id cũ.
 *   • `apiKeyTenantScope` — ngày cửa sổ = `giây % 9000` + `product_inspections` WORM: 267/9000 ngày đã dùng ⇒ ~3 % lượt đếm thừa 9–11 ca đỏ (tái hiện xác định).
 * Không gian nhỏ + bảng KHÔNG dọn được ⇒ hàng của lượt trước tích luỹ ⇒ xác suất đụng tăng theo số lượt chạy (không bao giờ giảm). Mô-đun lớn (≥ 1e6) cho xác suất đụng
 * < 0,05 % / lượt ở quy mô hiện tại — không cấm.
 *
 * LUẬT: một biểu thức `X % N` với N ≤ 200_000 mà X chứa `Date.now()` / `ts` / `now` / `seconds`, hoặc `Math.random() * N` với N ≤ 10_000 KHÔNG đứng cạnh `Date.now()` trong cùng
 * biểu thức, bị cấm trong tệp test MỚI. Miễn: (a) dòng có chú thích `kd-census:ok <lý do>` (id chỉ sống trong bộ nhớ / bảng dọn được / có dò khoảng trống như
 * `chonNgayTrong` ở apiKeyTenantScope), hoặc (b) tệp nằm trong NỢ dưới đây — chỉ được GIẢM (bậc thang, trần = đúng độ dài).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const GOC = path.resolve(__dirname, "../..");
const THU_MUC = ["server", "scripts", "e2e", "shared"];
const BO_QUA = new Set(["node_modules", ".git", "dist"]);
const CHINH_NO = "server/testing/idKhongGianNho.census.test.ts";
const MOD_TOI_DA = 200_000;
const NGAU_NHIEN_TOI_DA = 10_000;

/**
 * NỢ — tệp CÓ biểu thức không gian nhỏ (đo 2026-11-02). Cột phải: bảng KHÔNG dọn được mà id/cửa sổ chạm tới, và xác suất đụng hiện tại (đếm hàng có sẵn trên `_test`).
 * Chỉ được GIẢM; sửa một tệp thì xoá dòng ở đây và hạ TRAN_NO.
 */
export const NO: readonly string[] = [
  // robot_jobs (WORM) / audit_logs (WORM) — id robot = base + now % 9_000: 168–512 / 9000 id đã có hàng (1,9–5,7 %). ĐẾM TUYỆT ĐỐI trên audit chỉ ở robotHitl (ĐỎ THẬT, scada-master đang sửa).
  "server/services/robot/robotHitlActionRequired.dot1c.db.test.ts", // audit_logs theo entityId: ĐỎ ~5,7 %
  "server/services/robot/robotAbortNeverOrder.dot1c.db.test.ts", // 2,3 % — truy theo jobId ⇒ an toàn
  "server/services/robot/robotCommandDispatcher.binding.db.test.ts", // 4,0 % — đếm TƯƠNG ĐỐI trước/sau ⇒ an toàn
  "server/services/robot/robotMotionLockPersist.dot4.db.test.ts", // 2,3 % — audit >= 1, nội dung lý do giống nhau ⇒ lành
  "server/services/robot/robotStopExempt.dot1c.db.test.ts", // 2,6 % — truy theo jobId ⇒ an toàn
  "server/services/orchestration/foe/foeApiKeyHolderDispatchers.dot9.db.test.ts", // 1,9 % — truy theo jobId ⇒ an toàn
  "server/services/orchestration/foe/foeProgramChecksumDispatchers.dot8.db.test.ts", // 2,1 % — truy theo jobId ⇒ an toàn
  "server/api/v1/equipmentCommands.r1a.db.test.ts", // 0,9 % — id chỉ trong mock; sổ truy theo khoá duy nhất ⇒ an toàn
  "server/services/ot/safetySimOnly.dot1c.db.test.ts", // % 900: robot_jobs 517/902 id đã có hàng nhưng ca không đọc robot_jobs ⇒ lành
  // product_inspections (WORM) — cửa sổ giờ = ts % 200_000: 42/200000 giờ đã dùng (0,02 %)
  "server/routers/reportExportScope.test.ts",
  "server/routers/reportServiceScope.test.ts",
  // id chỉ sống trong bộ nhớ (không chạm bảng) — xác suất đụng bằng 0 theo thiết kế
  "server/services/ot/drivers/enipAckMuon.thuVienThat.r1b2b2.test.ts",
  "server/services/ot/motPhan.r1b2b2.test.ts",
  "server/services/safety/plc/safetyPlcPoller.fix1.dot8.test.ts",
  // dispatcher THẬT + DB giả (vi.mock) — adapterId = nền + Math.random()*1000 chỉ phân biệt khoá trong bộ nhớ
  "server/services/ot/drivers/dangBay.drivers.r1b2b1.test.ts",
  "server/services/ot/drivers/matLienKetTheoWrite.drivers.r1b2b2.test.ts",
  "server/services/ot/drivers/mcTamKhoa.r1b2b2.test.ts",
  "server/services/ot/drivers/quaHanDriver.drivers.r1b2b2.test.ts",
  "server/services/ot/drivers/s7BitNgoaiDai.r1b2b2.test.ts",
  "server/services/ot/drivers/s7HanDuPhong.fix1.r1b2b2.test.ts",
  "server/services/ot/khongRoBoDocLai.t6b.r1b2b2.test.ts",
];
const TRAN_NO = 21;

export interface ViPham {
  dong: number;
  mau: "mod" | "ngau-nhien";
  chu: string;
}

const soCuaLiteral = (n: ts.Expression): number | null => {
  if (!ts.isNumericLiteral(n)) return null;
  const v = Number(n.text.replace(/_/g, ""));
  return Number.isFinite(v) ? v : null;
};
const chuaThoiGian = (n: ts.Node, sf: ts.SourceFile): boolean => /\bDate\.now\s*\(|\bperformance\.now\s*\(|\b(ts|now|seconds|giay|stamp)\b/.test(n.getText(sf));
/** Câu lệnh có một hằng số NỀN id (≥ 10_000) cộng với phần ngẫu nhiên ⇒ đây là id số, không phải chữ số hex / byte / octet IP. */
const coSoNenId = (st: ts.Node): boolean => {
  let co = false;
  const dd = (x: ts.Node) => {
    if (ts.isNumericLiteral(x) && Number(x.text.replace(/_/g, "")) >= 10_000) co = true;
    ts.forEachChild(x, dd);
  };
  dd(st);
  return co;
};
const cuaNhom = (n: ts.Node): ts.Node => {
  // biểu thức "bao" gần nhất để biết `Math.random()*N` có đứng cạnh `Date.now()` không: câu lệnh chứa nó
  let p: ts.Node = n;
  while (p.parent && !ts.isStatement(p.parent) && !ts.isSourceFile(p.parent)) p = p.parent;
  return p.parent && ts.isStatement(p.parent) ? p.parent : p;
};

/** Quét một nguồn: các biểu thức sinh từ không gian nhỏ không có chú thích miễn `kd-census:ok`. */
export function quetKhongGianNho(ten: string, nguon: string): ViPham[] {
  const sf = ts.createSourceFile(ten, nguon, ts.ScriptTarget.Latest, true);
  const dong = nguon.split("\n");
  const ra: ViPham[] = [];
  const xet = (n: ts.Node, mau: ViPham["mau"]) => {
    const d = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
    if (/kd-census:ok/.test(dong[d] ?? "") || /kd-census:ok/.test(dong[d - 1] ?? "")) return;
    ra.push({ dong: d + 1, mau, chu: n.getText(sf).slice(0, 80) });
  };
  const di = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PercentToken) {
      const N = soCuaLiteral(n.right);
      if (N !== null && N > 1 && N <= MOD_TOI_DA && chuaThoiGian(n.left, sf)) xet(n, "mod");
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      const mathRandom = (e: ts.Expression) => /^Math\.random\(\)$/.test(e.getText(sf));
      const N = mathRandom(n.left) ? soCuaLiteral(n.right) : mathRandom(n.right) ? soCuaLiteral(n.left) : null;
      if (N !== null && N >= 100 && N <= NGAU_NHIEN_TOI_DA && !/\bDate\.now\s*\(/.test(cuaNhom(n).getText(sf)) && coSoNenId(cuaNhom(n))) xet(n, "ngau-nhien");
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/** Tệp VI PHẠM: có biểu thức không gian nhỏ, không phải nợ cũ. Thuần ⇒ kiểm được bằng bản đồ giả. */
export const tepMoiViPham = (ket: ReadonlyMap<string, ViPham[]>, no: ReadonlySet<string>): string[] =>
  [...ket].filter(([f]) => !no.has(f)).map(([f, v]) => `${f}:${v.map((x) => x.dong).join(",")}`);

function lietKeTest(): string[] {
  const kq: string[] = [];
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (BO_QUA.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (/\.(test|spec)\.tsx?$/.test(e.name)) kq.push(path.relative(GOC, p).replace(/\\/g, "/"));
    }
  };
  for (const t of THU_MUC) if (fs.existsSync(path.join(GOC, t))) di(path.join(GOC, t));
  return kq.filter((f) => f !== CHINH_NO);
}

describe("census — test không sinh id/khoá/cửa sổ từ KHÔNG GIAN NHỎ (trên bảng không dọn được)", () => {
  const ket = new Map<string, ViPham[]>();
  for (const f of lietKeTest()) {
    const v = quetKhongGianNho(f, fs.readFileSync(path.join(GOC, f), "utf8"));
    if (v.length) ket.set(f, v);
  }
  const no = new Set(NO);

  it("★ tệp mới không có biểu thức không gian nhỏ (hoặc có chú thích `kd-census:ok <lý do>`)", () => {
    const vi = tepMoiViPham(ket, no);
    expect(vi, "id/khoá/cửa sổ sinh từ `% N` nhỏ hoặc `Math.random()*N` nhỏ: dùng id duy nhất thật (uuid / Date.now() + ngẫu nhiên), dò khoảng trống, hoặc chú thích `kd-census:ok` kèm lý do").toEqual([]);
  });

  it("★ bậc thang: mục nợ lỗi thời (tệp mất / không còn biểu thức) phải bị xoá khỏi NO", () => {
    expect(NO.filter((f) => !ket.has(f))).toEqual([]);
  });

  it("★ NO không trùng và trần bằng đúng độ dài (chỉ được GIẢM)", () => {
    expect(new Set(NO).size).toBe(NO.length);
    expect(NO.length, "NO ngắn đi ⇒ HẠ TRAN_NO cùng lúc").toBe(TRAN_NO);
  });
});

describe("census — đột biến của chính bộ quét", () => {
  it("tepMoiViPham: tệp có biểu thức nhưng ngoài NO ⇒ vi phạm; trong NO ⇒ sạch", () => {
    const v: ViPham = { dong: 3, mau: "mod", chu: "x" };
    const ket = new Map<string, ViPham[]>([["moi.test.ts", [v]], ["cu.test.ts", [v, v]]]);
    expect(tepMoiViPham(ket, new Set(["cu.test.ts"]))).toEqual(["moi.test.ts:3"]);
    expect(tepMoiViPham(ket, new Set())).toEqual(["moi.test.ts:3", "cu.test.ts:3,3"]);
  });
  it.each([
    ["Date.now() % 9_000", "const id = 990_710_000 + (Date.now() % 9_000);", 1],
    ["giây % 9000", "const d = new Date(2044, 0, 1 + (Math.floor(ts / 1000) % 9000));", 1],
    ["ts % 200_000", "const a = new Date(1_000_000_000_000 + (ts % 200_000) * 3_600_000);", 1],
    ["mô-đun lớn 1e6 không bị cấm", "const id = 700_000_000 + (Date.now() % 1_000_000);", 0],
    ["Math.random()*900 cộng nền id", "const a = 993_000 + Math.floor(Math.random() * 900);", 1],
    ["Math.random()*256 chữ số byte/hex không có nền id", "buf[i] = Math.floor(Math.random() * 256);", 0],
    ["octet IP", "const ip = `10.${Math.floor(Math.random() * 250)}.1.1`;", 0],
    ["Math.random()*1e4 cạnh Date.now() (duy nhất theo thời gian) được", "const R = `T${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;", 0],
    ["Math.random()*1e5 (TT tự dọn) không bị cấm", "const TT = `t9${Math.floor(Math.random() * 1e5)}`;", 0],
    ["% không liên quan thời gian", "const m = (Number(code) + 500_000) % 1_000_000;", 0],
    ["modulo nhỏ không liên quan thời gian (chỉ số vòng)", "const j = i % 7;", 0],
    ["chú thích miễn cùng dòng", "const id = 1 + (Date.now() % 9_000); // kd-census:ok id chỉ trong bộ nhớ", 0],
    ["chú thích miễn dòng trên", "// kd-census:ok dò khoảng trống\nconst id = 1 + (Date.now() % 9_000);", 0],
    ["chỉ nhắc trong chú thích", "// Date.now() % 9_000 bị cấm\nconst x = 1;", 0],
  ])("%s", (_t, nguon, mongDoi) => {
    expect(quetKhongGianNho("x.test.ts", nguon as string).length).toBe(mongDoi);
  });
});
