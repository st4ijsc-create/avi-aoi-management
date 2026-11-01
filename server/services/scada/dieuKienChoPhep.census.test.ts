/**
 * ★★★ SCADA R1b-2b-2b A C5 (KD-2bA 5.3) — CENSUS AST: "Điều kiện cho phép" chạy khô và `request` dùng CÙNG MỘT hàm cổng.
 *
 * Bằng AST (TypeScript) trên `lenhHmi.ts` + `scadaCommandsRouter.ts`:
 *   1. Các hàm cổng tĩnh (`CONG`) + hàm cấp dưới của chúng (`CAP_DUOI`) KHÔNG được gọi ở đâu trong thân `yeuCauGhiTag` (kể cả closure lồng) —
 *      request chỉ được đi qua `kiemDieuKienGhiTag`, gọi ĐÚNG MỘT lần (không bản chép).
 *   2. `kiemDieuKienGhiTag` gọi đủ `CONG`, mỗi hàm ĐÚNG một lần, ĐÚNG thứ tự cố định (cờ → 0433 → phạm vi → đọc tag → kênh + giá trị → vai →
 *      edge → chế độ → canTotp).
 *   3. `canTotp` không được gọi ở đâu khác trong tệp (bản xem trước nhận `needsTotp` từ kết quả cổng).
 *   4. `kiemDieuKienGhiTag` không nhắc tên nào có tác dụng phụ (`GHI`): ghi attempts / bảng / khoá chọn / TOTP / dispatch / audit / socket. Lối
 *      ghi duy nhất của request (gửi lại) đi qua móc `moc.sauPhamVi` mà chạy khô không truyền.
 *   5. Router: không gọi hàm cổng nào trực tiếp; `kiemDieuKienGhiTag` gọi ĐÚNG một lần, trong thủ tục `dieuKienChoPhep`; thủ tục đó không nhắc
 *      tên nào thuộc `GHI` hay đường gửi (`yeuCauGhiTag`, `xacNhanGhiTag`, `dungMayHmi` …).
 *   6. (fix round 1, review M-3) `xacNhanGhiTag` (confirm) chạy lại cổng trên dữ liệu HIỆN TẠI bằng chuỗi RIÊNG (có từ R1a, không đổi ở C5):
 *      ghim chuỗi lời gọi của nó (`THU_TU_XAC_NHAN`) — cổng của confirm = `CONG` trừ `canTotp` (cùng thứ tự), rồi `kiemXacThucTheoMuc` SAU cổng
 *      chế độ, rồi gia hạn khoá, rồi `dispatch`. Ai sửa thứ tự / bỏ một cổng ở confirm (lệch khỏi cổng chung) ⇒ ĐỎ.
 * Ca "tệp ảo" ở cuối: tiêm vi phạm vào bản sao nguồn ⇒ bộ quét phải báo đúng chỗ (chống "xanh vì quét trúng 0 thứ").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const DAY = dirname(fileURLToPath(import.meta.url));
const NGUON_LENH = readFileSync(join(DAY, "lenhHmi.ts"), "utf8");
const NGUON_ROUTER = readFileSync(join(DAY, "..", "..", "routers", "scadaCommandsRouter.ts"), "utf8");

/** Cổng tĩnh — ĐÚNG thứ tự gọi trong `kiemDieuKienGhiTag`. */
const CONG = [
  "lenhHmiBat",
  "canh0433",
  "adapterTrongPhamViLenh",
  "docTagLenh",
  "kiemCongKenhVaGiaTri",
  "kiemCongVaiTro",
  "kiemCongEdge",
  "kiemCongCheDo",
  "canTotp",
] as const;
/** Hàm cấp dưới mà một bản chép cổng sẽ phải gọi. */
const CAP_DUOI = [
  "kiemGiaTriGhi",
  "laKenhGhi",
  "mucTacDongKenh",
  "vaiTroDuocGhi",
  "checkPermission",
  "adapterOwnedByEdge",
  "cheDoMay",
  "idsTrongPhamVi",
  "stepUpPhienConHan",
  "biet0433Thieu",
] as const;
/** Tên có tác dụng phụ — chạy khô không được nhắc tới. */
const GHI = [
  "ghiThuLenh",
  "chenDongTongKet",
  "nenGhiThuLenh",
  "giuKhoaChon",
  "giaHanKhoaChon",
  "nhaKhoaChon",
  "kiemXacThucTheoMuc",
  "verifyTotpOnce",
  "dispatch",
  "recordAuditEvent",
  "phatScadaCmd",
  "insert",
  "update",
  "delete",
  "transaction",
  "execute",
] as const;
const DUONG_GUI = ["yeuCauGhiTag", "xacNhanGhiTag", "huyYeuCauGhi", "dungMayHmi"] as const;

type Goi = { ten: string; vt: number };

function sf(src: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
}

function hamCapTep(s: ts.SourceFile): Map<string, ts.FunctionDeclaration> {
  const m = new Map<string, ts.FunctionDeclaration>();
  s.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name) m.set(n.name.text, n);
  });
  return m;
}

/** Mọi lời gọi `ten(…)` (callee là định danh trần) trong nút, theo vị trí. */
function loiGoi(n: ts.Node): Goi[] {
  const out: Goi[] = [];
  const di = (x: ts.Node) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) out.push({ ten: x.expression.text, vt: x.getStart() });
    x.forEachChild(di);
  };
  di(n);
  return out.sort((p, q) => p.vt - q.vt);
}

/** Mọi định danh (kể cả tên thuộc tính `x.insert`) trong nút. */
function dinhDanh(n: ts.Node): Set<string> {
  const out = new Set<string>();
  const di = (x: ts.Node) => {
    if (ts.isIdentifier(x)) out.add(x.text);
    x.forEachChild(di);
  };
  di(n);
  return out;
}

/** Hàm cấp tệp chứa vị trí `vt` (hoặc null). */
function hamChua(ham: Map<string, ts.FunctionDeclaration>, vt: number): string | null {
  for (const [ten, f] of ham) if (vt >= f.getStart() && vt < f.getEnd()) return ten;
  return null;
}

function quetLenh(src: string) {
  const s = sf(src);
  const ham = hamCapTep(s);
  const yeuCau = ham.get("yeuCauGhiTag");
  const kiem = ham.get("kiemDieuKienGhiTag");
  if (!yeuCau || !kiem) throw new Error("không thấy yeuCauGhiTag / kiemDieuKienGhiTag ở cấp tệp");
  const camTrongYeuCau = new Set<string>([...CONG, ...CAP_DUOI]);
  const goiYeuCau = loiGoi(yeuCau);
  const goiKiem = loiGoi(kiem);
  const tapCong = new Set<string>(CONG);
  return {
    viPhamYeuCau: goiYeuCau.filter((g) => camTrongYeuCau.has(g.ten)).map((g) => g.ten),
    soLanKiemTrongYeuCau: goiYeuCau.filter((g) => g.ten === "kiemDieuKienGhiTag").length,
    thuTuCongTrongKiem: goiKiem.filter((g) => tapCong.has(g.ten)).map((g) => g.ten),
    canTotpNgoaiKiem: loiGoi(s)
      .filter((g) => g.ten === "canTotp")
      .map((g) => hamChua(ham, g.vt))
      .filter((h) => h !== "kiemDieuKienGhiTag"),
    ghiTrongKiem: GHI.filter((t) => dinhDanh(kiem.body!).has(t)),
  };
}

/**
 * Chuỗi lời gọi của `xacNhanGhiTag` — ĐO bằng AST trên cây 630fe4970 (2026-11-01). `kiemCongKenhVaGiaTri` hai lần: một trong nhánh tag vắng / tắt
 * (dựng mã từ chối), một ở cổng 3–4. Không có `canTotp` (confirm xác minh thật bằng `kiemXacThucTheoMuc`).
 */
const THU_TU_XAC_NHAN = [
  "lenhHmiBat",
  "canh0433",
  "adapterTrongPhamViLenh",
  "docTagLenh",
  "kiemCongKenhVaGiaTri",
  "kiemCongKenhVaGiaTri",
  "kiemCongVaiTro",
  "kiemCongEdge",
  "kiemCongCheDo",
  "kiemXacThucTheoMuc",
  "giaHanKhoaChon",
  "dispatch",
] as const;

function quetXacNhan(src: string): { chuoi: string[]; congKhongLap: string[] } {
  const ham = hamCapTep(sf(src)).get("xacNhanGhiTag");
  if (!ham) throw new Error("không thấy xacNhanGhiTag ở cấp tệp");
  const theoDoi = new Set<string>([...CONG, "kiemXacThucTheoMuc", "giaHanKhoaChon", "giuKhoaChon", "dispatch"]);
  const chuoi = loiGoi(ham).filter((g) => theoDoi.has(g.ten)).map((g) => g.ten);
  const tapCong = new Set<string>(CONG);
  const congKhongLap = chuoi.filter((t, i) => tapCong.has(t) && chuoi.indexOf(t) === i);
  return { chuoi, congKhongLap };
}

function quetRouter(src: string) {
  const s = sf(src);
  const goiTatCa = loiGoi(s);
  let thuTuc: ts.PropertyAssignment | null = null;
  const di = (x: ts.Node) => {
    if (ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === "dieuKienChoPhep") thuTuc = x;
    x.forEachChild(di);
  };
  di(s);
  if (!thuTuc) throw new Error("không thấy thủ tục dieuKienChoPhep");
  const tt = thuTuc as ts.PropertyAssignment;
  const trongThuTuc = (g: Goi) => g.vt >= tt.getStart() && g.vt < tt.getEnd();
  const ten = dinhDanh(tt);
  const tapCong = new Set<string>([...CONG, ...CAP_DUOI]);
  return {
    congGoiTrucTiep: goiTatCa.filter((g) => tapCong.has(g.ten)).map((g) => g.ten),
    kiemGoi: goiTatCa.filter((g) => g.ten === "kiemDieuKienGhiTag").map(trongThuTuc),
    camTrongThuTuc: [...GHI, ...DUONG_GUI].filter((t) => ten.has(t)),
  };
}

describe("C5 census — một hàm cổng dùng chung (KD-2bA 5.3)", () => {
  it("★ thân yeuCauGhiTag KHÔNG gọi hàm cổng / hàm cấp dưới nào; gọi kiemDieuKienGhiTag ĐÚNG một lần", () => {
    const q = quetLenh(NGUON_LENH);
    expect(q.viPhamYeuCau, "request phải đi qua kiemDieuKienGhiTag, không chép cổng").toEqual([]);
    expect(q.soLanKiemTrongYeuCau).toBe(1);
  });

  it("★ kiemDieuKienGhiTag gọi đủ cổng, mỗi cổng MỘT lần, đúng thứ tự cố định", () => {
    expect(quetLenh(NGUON_LENH).thuTuCongTrongKiem).toEqual([...CONG]);
  });

  it("canTotp chỉ được gọi trong kiemDieuKienGhiTag", () => {
    expect(quetLenh(NGUON_LENH).canTotpNgoaiKiem).toEqual([]);
  });

  it("★ kiemDieuKienGhiTag không nhắc tên nào có tác dụng phụ (ghi / khoá / TOTP / dispatch / audit / socket)", () => {
    expect(quetLenh(NGUON_LENH).ghiTrongKiem).toEqual([]);
  });

  it("★ router: không gọi cổng trực tiếp; kiemDieuKienGhiTag đúng một lần, trong dieuKienChoPhep; thủ tục không nhắc đường ghi / gửi", () => {
    const q = quetRouter(NGUON_ROUTER);
    expect(q.congGoiTrucTiep).toEqual([]);
    expect(q.kiemGoi).toEqual([true]);
    expect(q.camTrongThuTuc).toEqual([]);
  });
});

describe("C5 census — confirm (xacNhanGhiTag) không lệch khỏi cổng chung (fix round 1, review M-3)", () => {
  it("★ chuỗi lời gọi của xacNhanGhiTag đúng THU_TU_XAC_NHAN", () => {
    expect(quetXacNhan(NGUON_LENH).chuoi).toEqual([...THU_TU_XAC_NHAN]);
  });

  it("★ cổng của confirm (không lặp) = CONG trừ canTotp, cùng thứ tự với kiemDieuKienGhiTag", () => {
    expect(quetXacNhan(NGUON_LENH).congKhongLap).toEqual(CONG.filter((t) => t !== "canTotp"));
  });
});

describe("C5 census — tệp ảo: bộ quét bắt vi phạm tiêm vào", () => {
  const tiemVaoYeuCau = (dong: string) => {
    const moc = "  const dk = await kiemDieuKienGhiTag(nguoi, pv, input, moc);\n";
    expect(NGUON_LENH.includes(moc), "mốc tiêm phải tồn tại").toBe(true);
    return NGUON_LENH.replace(moc, moc + dong);
  };

  it("request gọi cổng chế độ trực tiếp (bản chép) ⇒ báo kiemCongCheDo", () => {
    expect(quetLenh(tiemVaoYeuCau("  await kiemCongCheDo(null, now);\n")).viPhamYeuCau).toEqual(["kiemCongCheDo"]);
  });

  it("request gọi cấp dưới trong closure lồng ⇒ báo cheDoMay", () => {
    expect(quetLenh(tiemVaoYeuCau("  const f = async () => cheDoMay(null, now); void f;\n")).viPhamYeuCau).toEqual(["cheDoMay"]);
  });

  it("bỏ kiemCongCheDo khỏi kiemDieuKienGhiTag ⇒ thứ tự lệch", () => {
    // mốc DUY NHẤT của kiemDieuKienGhiTag (confirm có cùng dòng `const cheDo = …` nhưng theo sau là `tuChoiKetThuc`)
    const moc = "  const cheDo = await kiemCongCheDo(a.machineId, now);\n  if (!cheDo.ok) return dung(";
    expect(NGUON_LENH.split(moc).length - 1, "mốc tiêm phải khớp đúng một lần").toBe(1);
    const src = NGUON_LENH.replace(moc, "  const cheDo = { ok: true } as const;\n  if (!cheDo.ok) return dung(");
    expect(quetLenh(src).thuTuCongTrongKiem).not.toEqual([...CONG]);
  });

  it("chạy khô ghi attempts ⇒ báo ghiThuLenh", () => {
    const moc = "  // TOTP: chỉ BÁO (đọc cache step-up)";
    expect(NGUON_LENH.includes(moc)).toBe(true);
    const src = NGUON_LENH.replace(moc, "  await ghiThuLenh(db, { userId: 0, stage: \"request\", outcome: \"rejected\" });\n" + moc);
    expect(quetLenh(src).ghiTrongKiem).toEqual(["ghiThuLenh"]);
  });

  it("confirm đảo cổng edge / chế độ ⇒ chuỗi lệch", () => {
    const edge = "  const edge = await kiemCongEdge(db, a.id);\n  if (!edge.ok) return tuChoiKetThuc(edge.tuChoi);\n";
    const cheDo = "  const cheDo = await kiemCongCheDo(a.machineId, now);\n  if (!cheDo.ok) return tuChoiKetThuc(cheDo.tuChoi);\n";
    expect(NGUON_LENH.includes(edge + cheDo), "mốc tiêm phải tồn tại").toBe(true);
    const src = NGUON_LENH.replace(edge + cheDo, cheDo + edge);
    expect(quetXacNhan(src).congKhongLap).not.toEqual(CONG.filter((t) => t !== "canTotp"));
  });

  it("router gọi request trong thủ tục chạy khô ⇒ báo yeuCauGhiTag", () => {
    const moc = "      const kq = await kiemDieuKienGhiTag(nguoiGoi(ctx), phamViCua(ctx), input);\n";
    expect(NGUON_ROUTER.includes(moc)).toBe(true);
    const src = NGUON_ROUTER.replace(moc, moc + "      void yeuCauGhiTag;\n");
    expect(quetRouter(src).camTrongThuTuc).toEqual(["yeuCauGhiTag"]);
  });
});
