/**
 * ★★★ Đợt 2 — chỉ mục NGỮ NGHĨA (`search_code`) trên DB `_test` THẬT (pgvector, bảng mig 0391) với bộ nhúng GIẢ
 * tiêm vào (GPU đang đo cổng Đợt 1 — không nạp model thật).
 *
 * Bộ nhúng giả: túi-từ băm vào 1024 chiều rồi chuẩn hoá L2 — tất định, và CÓ ngữ nghĩa thô (câu hỏi chung từ với
 * đoạn ⇒ cosine cao) nên phép xếp hạng của pgvector đo được thật. Nó GHI LẠI mọi văn bản được nhúng ⇒ đo được
 * "làm tươi chỉ nhúng lại đúng tệp đổi" và "che bí mật TRƯỚC khi nhúng/lưu" bằng chính đầu vào model sẽ thấy.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  catDoan,
  choDungXong,
  datBoNhung,
  dungChiMuc,
  lamTuoiTep,
  timMaNgu,
  trangThaiChiMuc,
  type BoNhung,
} from "./nguNghia";
import * as chiMucMa from "./index";

const DB_URL = process.env.DATABASE_URL;
const SO_CHIEU = 1024;

function tachTu(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

function vecTuiTu(s: string): number[] {
  const v = new Array<number>(SO_CHIEU).fill(0);
  for (const w of tachTu(s)) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619) >>> 0;
    v[h % SO_CHIEU] += 1;
  }
  const tong = v.reduce((a, x) => a + x * x, 0);
  if (tong === 0) v[0] = 1; // văn bản không có từ nào ⇒ vector đơn vị cố định (cosine không định nghĩa trên vector 0)
  const n = Math.sqrt(tong) || 1;
  return v.map((x) => x / n);
}

class BoNhungGia implements BoNhung {
  readonly moHinh = "gia-tui-tu-1024";
  readonly soChieu = SO_CHIEU;
  daNhung: string[] = [];
  truocMoiLo?: () => void;
  async nhungTaiLieu(van: string[]): Promise<number[][]> {
    this.truocMoiLo?.();
    this.daNhung.push(...van);
    return van.map(vecTuiTu);
  }
  async nhungCauHoi(cauHoi: string): Promise<number[]> {
    return vecTuiTu(cauHoi);
  }
  /** Tệp (dòng đầu của văn bản nhúng = đường tương đối) đã được nhúng. */
  tepDaNhung(): string[] {
    return [...new Set(this.daNhung.map((t) => t.split("\n")[0]!))].sort();
  }
}

describe("index.ts — mặt tiếp xúc §3 cho agent", () => {
  it("xuất đúng 4 hàm của hợp đồng (+ `trangThaiChiMuc` tuỳ chọn) và chúng là hàm", () => {
    for (const ten of ["timKyHieu", "timMaNgu", "lamTuoiTep", "dungChiMuc", "trangThaiChiMuc"] as const) {
      expect(typeof chiMucMa[ten], ten).toBe("function");
    }
    expect(chiMucMa.timMaNgu).toBe(timMaNgu);
  });
});

describe("catDoan — cắt đoạn theo ranh giới định nghĩa (thuần)", () => {
  it("mỗi định nghĩa cấp đỉnh một đoạn; chú thích ngay trên định nghĩa đi cùng nó; dòng 1-based liên tục", () => {
    const src = [
      `import x from "x";`, // 1
      ``, // 2
      `/** Tính tổng. */`, // 3
      `export function tinhTong(a: number) {`, // 4
      `  return a;`, // 5
      `}`, // 6
      ``, // 7
      `export class Kho {`, // 8
      `  them() {}`, // 9
      `}`, // 10
    ].join("\n");
    const d = catDoan(src, "ts", { toiThieu: 1 });
    expect(d.map((x) => [x.dongDau, x.dongCuoi])).toEqual([
      [1, 2],
      [3, 7],
      [8, 10],
    ]);
    expect(d[1]!.noiDung.split("\n")[0]).toBe("/** Tính tổng. */");
  });

  it("không có định nghĩa (hoặc ngôn ngữ không trích) ⇒ cửa sổ 60 dòng chồng 10", () => {
    const src = Array.from({ length: 130 }, (_, i) => `-- dong ${i + 1}`).join("\n");
    const d = catDoan(src, null);
    expect(d.map((x) => [x.dongDau, x.dongCuoi])).toEqual([
      [1, 60],
      [51, 110],
      [101, 130],
    ]);
  });

  it("một định nghĩa quá dài ⇒ chia cửa sổ bên trong nó, không mất dòng nào", () => {
    const than = Array.from({ length: 150 }, (_, i) => `  const x${i} = ${i};`);
    const src = [`export function dai() {`, ...than, `}`].join("\n");
    const d = catDoan(src, "ts");
    expect(d[0]!.dongDau).toBe(1);
    expect(d[d.length - 1]!.dongCuoi).toBe(152);
    for (const x of d) expect(x.dongCuoi - x.dongDau + 1).toBeLessThanOrEqual(80);
  });
});

describe.skipIf(!DB_URL)("chỉ mục ngữ nghĩa trên DB _test thật (bộ nhúng giả)", () => {
  let tam: string;
  let goc: string;
  let bo: BoNhungGia;
  const duAnDaDung: string[] = [];
  let dem = 0;

  const duAnMoi = () => {
    const id = `t-cmm-${process.pid}-${Date.now().toString(36)}-${dem++}`;
    duAnDaDung.push(id);
    return id;
  };
  const viet = (rel: string, noiDung: string, g = goc) => {
    const abs = path.join(g, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, noiDung, "utf8");
  };
  const hangCua = async (projectId: string) => {
    const { getDb } = await import("../../../db/connection");
    const db = (await getDb())!;
    return (await db.execute(sql`
      SELECT duong, bam, "dongDau", "dongCuoi", "noiDung", "moHinh" FROM ai_code_chunks
      WHERE "projectId" = ${projectId} ORDER BY duong, "dongDau"`)) as unknown as Array<{
      duong: string;
      bam: string;
      dongDau: number;
      dongCuoi: number;
      noiDung: string;
      moHinh: string;
    }>;
  };

  beforeEach(() => {
    tam = fs.mkdtempSync(path.join(os.tmpdir(), "chimucma-ng-"));
    goc = path.join(tam, "du-an");
    fs.mkdirSync(goc);
    bo = new BoNhungGia();
    datBoNhung(bo);
    viet("src/thanhToan.ts", [
      `/** Tính tổng tiền đơn hàng gồm thuế. */`,
      `export function tinhTongTienDonHang(donHang: DonHang): number {`,
      `  return donHang.dong.reduce((s, d) => s + d.gia * d.soLuong, 0) * 1.1;`,
      `}`,
    ].join("\n"));
    viet("src/nhatKy.py", [`def ghi_nhat_ky_canh_bao(thong_diep):`, `    print("canh bao", thong_diep)`].join("\n"));
    viet("src/ketNoi.go", [`package db`, `func MoKetNoiCoSoDuLieu(chuoi string) error {`, `  return nil`, `}`].join("\n"));
    viet("README.md", "# không phải mã — không vào chỉ mục\n");
  });
  afterEach(() => {
    datBoNhung(null);
    fs.rmSync(tam, { recursive: true, force: true });
  });
  afterAll(async () => {
    const { getDb } = await import("../../../db/connection");
    const db = await getDb();
    if (!db) return;
    for (const id of duAnDaDung) await db.execute(sql`DELETE FROM ai_code_chunks WHERE "projectId" = ${id}`);
  });

  it("dựng ⇒ lưu theo projectId + băm tệp; tìm ⇒ đoạn đúng xếp đầu, kèm tệp:dòng, trangThai san-sang", async () => {
    const p = duAnMoi();
    const kq = await dungChiMuc({ gocDuAn: goc, projectId: p });
    expect(kq).toMatchObject({ soTep: 3, soDoan: 3 });
    expect(kq.ms).toBeGreaterThanOrEqual(0);
    const hang = await hangCua(p);
    expect(hang.map((h) => h.duong)).toEqual(["src/ketNoi.go", "src/nhatKy.py", "src/thanhToan.ts"]);
    for (const h of hang) {
      expect(h.bam).toMatch(/^[0-9a-f]{64}$/);
      expect(h.moHinh).toBe("gia-tui-tu-1024");
    }

    const tim = await timMaNgu({ gocDuAn: goc, projectId: p, cauHoi: "tinh tong tien don hang" });
    expect(tim.trangThai).toBe("san-sang");
    expect(tim.ketQua[0]).toMatchObject({ duong: "src/thanhToan.ts", dongDau: 1, dongCuoi: 4 });
    expect(tim.ketQua[0]!.doan).toContain("tinhTongTienDonHang");
    expect(tim.ketQua[0]!.diem).toBeGreaterThan(tim.ketQua[1]!.diem);
    const k1 = await timMaNgu({ gocDuAn: goc, projectId: p, cauHoi: "ket noi co so du lieu", k: 1 });
    expect(k1.ketQua.map((r) => r.duong)).toEqual(["src/ketNoi.go"]);
  });

  it("dựng lại không đổi gì ⇒ 0 lượt nhúng; làm tươi sau khi sửa MỘT tệp ⇒ chỉ nhúng lại tệp đó", async () => {
    const p = duAnMoi();
    await dungChiMuc({ gocDuAn: goc, projectId: p });
    bo.daNhung = [];
    await dungChiMuc({ gocDuAn: goc, projectId: p });
    expect(bo.daNhung).toEqual([]);

    viet("src/nhatKy.py", [`def ghi_nhat_ky_loi_nghiem_trong(thong_diep):`, `    print("loi", thong_diep)`].join("\n"));
    await lamTuoiTep({ gocDuAn: goc, projectId: p, duongs: ["src/nhatKy.py", "src/thanhToan.ts"] });
    expect(bo.tepDaNhung()).toEqual(["src/nhatKy.py"]);
    const hang = (await hangCua(p)).filter((h) => h.duong === "src/nhatKy.py");
    expect(hang).toHaveLength(1);
    expect(hang[0]!.noiDung).toContain("ghi_nhat_ky_loi_nghiem_trong");
  });

  it("tệp bị xoá ⇒ biến khỏi chỉ mục (qua làm tươi và qua dựng lại)", async () => {
    const p = duAnMoi();
    await dungChiMuc({ gocDuAn: goc, projectId: p });
    fs.rmSync(path.join(goc, "src/ketNoi.go"));
    await lamTuoiTep({ gocDuAn: goc, projectId: p, duongs: ["src/ketNoi.go"] });
    expect((await hangCua(p)).map((h) => h.duong)).not.toContain("src/ketNoi.go");

    fs.rmSync(path.join(goc, "src/nhatKy.py"));
    const kq = await dungChiMuc({ gocDuAn: goc, projectId: p });
    expect(kq.soTep).toBe(1);
    expect((await hangCua(p)).map((h) => h.duong)).toEqual(["src/thanhToan.ts"]);
  });

  it("cách ly projectId: tìm trong dự án B KHÔNG BAO GIỜ trả đoạn của dự án A", async () => {
    const a = duAnMoi();
    const b = duAnMoi();
    const gocB = path.join(tam, "du-an-b");
    fs.mkdirSync(gocB);
    viet("lib/khoB.ts", "export function quanLyKhoHangB() { return 1; }\n", gocB);
    await dungChiMuc({ gocDuAn: goc, projectId: a });
    await dungChiMuc({ gocDuAn: gocB, projectId: b });
    const kq = await timMaNgu({ gocDuAn: gocB, projectId: b, cauHoi: "tinh tong tien don hang", k: 20 });
    expect(kq.ketQua.map((r) => r.duong)).toEqual(["lib/khoB.ts"]);
  });

  it("che bí mật TRƯỚC khi nhúng và lưu (chuỗi kết nối, password=, khoá API, email)", async () => {
    const p = duAnMoi();
    viet("src/cauHinh.ts", [
      `export function layCauHinh() {`,
      `  const url = "postgres://aoi:MatKhauThat123@db.noi-bo:5432/aoi";`,
      `  const password = "hunter2-bi-mat";`,
      `  const khoa = "sk-ABCDEFGHIJKLMNOPQRSTUVWX";`,
      `  const lienHe = "ky.su@nha-may.vn";`,
      `  return { url, password, khoa, lienHe };`,
      `}`,
    ].join("\n"));
    await dungChiMuc({ gocDuAn: goc, projectId: p });
    const hang = (await hangCua(p)).filter((h) => h.duong === "src/cauHinh.ts");
    expect(hang.length).toBeGreaterThan(0);
    const luu = hang.map((h) => h.noiDung).join("\n");
    const daNhung = bo.daNhung.filter((t) => t.startsWith("src/cauHinh.ts")).join("\n");
    for (const bimat of ["MatKhauThat123", "hunter2-bi-mat", "sk-ABCDEFGHIJKLMNOPQRSTUVWX", "ky.su@nha-may.vn"]) {
      expect(luu, bimat).not.toContain(bimat);
      expect(daNhung, bimat).not.toContain(bimat);
    }
    expect(luu).toContain("layCauHinh");
  });

  it("chưa dựng ⇒ `chua-co` trả NGAY + kích hoạt dựng nền; xong nền ⇒ `san-sang` (cả qua `trangThaiChiMuc`)", async () => {
    const p = duAnMoi();
    expect(await trangThaiChiMuc({ gocDuAn: goc, projectId: p })).toBe("chua-co");
    const kq = await timMaNgu({ gocDuAn: goc, projectId: p, cauHoi: "tinh tong tien" });
    expect(kq).toEqual({ ketQua: [], trangThai: "chua-co" });
    expect(await trangThaiChiMuc({ gocDuAn: goc, projectId: p })).toBe("dang-dung");
    await choDungXong(p);
    expect(await trangThaiChiMuc({ gocDuAn: goc, projectId: p })).toBe("san-sang");
    const sau = await timMaNgu({ gocDuAn: goc, projectId: p, cauHoi: "tinh tong tien don hang" });
    expect(sau.trangThai).toBe("san-sang");
    expect(sau.ketQua[0]!.duong).toBe("src/thanhToan.ts");
  });

  it("làm tươi trên dự án CHƯA dựng ⇒ không tạo chỉ mục nửa vời (tìm vẫn phải nói `chua-co`)", async () => {
    const p = duAnMoi();
    await lamTuoiTep({ gocDuAn: goc, projectId: p, duongs: ["src/thanhToan.ts"] });
    expect(await hangCua(p)).toEqual([]);
    expect(bo.daNhung).toEqual([]);
  });

  it("an toàn: đường `..`, tuyệt đối ngoài gốc, `.env`, đuôi cấm, thư mục cấm ⇒ không đọc, không lưu, không ném", async () => {
    const p = duAnMoi();
    await dungChiMuc({ gocDuAn: goc, projectId: p });
    const ngoai = path.join(tam, "ngoai");
    fs.mkdirSync(ngoai);
    fs.writeFileSync(path.join(ngoai, "evil.ts"), "export function moiNgoai() {}\n");
    viet(".env.ts", "export const KHOA = 1;\n");
    viet("node_modules/x/index.ts", "export function moiNodeModules() {}\n");
    viet("ban.exe", "MZ");
    bo.daNhung = [];
    await lamTuoiTep({
      gocDuAn: goc,
      projectId: p,
      duongs: ["../ngoai/evil.ts", path.join(ngoai, "evil.ts"), ".env.ts", "node_modules/x/index.ts", "ban.exe", "src/../../ngoai/evil.ts"],
    });
    expect(bo.daNhung).toEqual([]);
    const ds = (await hangCua(p)).map((h) => h.duong);
    expect(ds.every((d) => d.startsWith("src/"))).toBe(true);
    // Dựng lại toàn bộ cũng không nhặt chúng.
    await dungChiMuc({ gocDuAn: goc, projectId: p });
    expect(bo.tepDaNhung()).toEqual([]);
  });

  it("trần số tệp ⇒ dừng đúng trần và khai `catBot`; huỷ ⇒ dừng giữa chừng bằng AbortError", async () => {
    const p = duAnMoi();
    const tran = await dungChiMuc({ gocDuAn: goc, projectId: p, tranTep: 2 });
    expect(tran.soTep).toBe(2);
    expect(tran.catBot).toBe(true);

    const q = duAnMoi();
    const ac = new AbortController();
    bo.truocMoiLo = () => ac.abort();
    await expect(dungChiMuc({ gocDuAn: goc, projectId: q, signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    bo.truocMoiLo = undefined;
    expect((await hangCua(q)).length).toBe(0);
  });

  it("projectId không hợp lệ (đường dẫn) ⇒ từ chối, không chạm DB", async () => {
    await expect(dungChiMuc({ gocDuAn: goc, projectId: "D:\\x" })).rejects.toThrow(/projectId/);
  });
});
