/**
 * V10 — lỗi kiểu phải tới model NGAY trong vòng làm việc: lệnh kiểm tự chạy XANH ⇒ bộ chạy chạy tsc và nối khối "KIỂU:" vào chính kết quả lần đó.
 * Mọi tsc ở đây là GIẢ (tiêm vào); không tiến trình con, không đồng hồ thật để đo, không model, không CSDL. Giờ lệnh kiểm là tham số `giay` của kết quả giả.
 * P1: sổ tsc riêng được HÂM trên cây gốc TRƯỚC khi gọi driver; hâm hỏng thì lượt vẫn chạy và trong vòng nói "chưa kiểm được" (không âm thầm chạy nguội).
 * Các trường mới đọc qua ép kiểu rộng để tệp này kiểm kiểu được cả khi mã chưa có chúng.
 * GIỚI HẠN CÓ TÊN: V10-KHONG-GOI-LENH · V10-DOI-KIEU-RONG · V10-LOI-TEP-KHAC · V10-THE-5-PHUT.
 * ĐỘT BIẾN PHẢI BẮT: không chạy tsc khi xanh · chạy cả khi đỏ · quá giờ/lỗi coi là sạch · gửi chữ lỗi ở chế độ chỉ số · lộ dòng lỗi của tệp ngoài phép · đếm sai lỗi tệp khác ·
 * vượt ngân sách chữ / mất vị trí lỗi / cắt không nói · bỏ dòng giải thích · hạn không trừ giờ lệnh kiểm / ngưỡng lệch · dùng sổ chung · không hâm / hâm sau driver / hâm hỏng vẫn chạy trong vòng ·
 * bỏ phép soi .env của tsc trong vòng · không ghi số giây, không ghi model có gọi lệnh kiểm.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, type DauVaoDriver, type Driver } from "./chayMotViec";
import { driverHost, tomTatKiemChoModel, type ChinhSachDuyet, type PhuThuocHost } from "./driverHost";
import * as kiemChung from "./kiemChung";
import { loiTscTrongTep, type ChayKiem, type KetQuaKiem, type KetQuaTsc } from "./kiemChung";
import type { TheViec } from "./theViec";

type TscGia = KetQuaTsc & { khoiTrongTep?: string[] };
interface KieuTrongVong {
  tepDoi: () => string[];
  chayTsc: (tepDoi: readonly string[], hanGiay: number) => Promise<TscGia>;
  /** lý do hâm sổ kiểu hỏng; null = hâm được */
  hamLoi: string | null;
}
const kieuCua = (v: DauVaoDriver): KieuTrongVong | undefined => (v as unknown as { kieu?: KieuTrongVong }).kieu;
const truong = <T,>(o: unknown, ten: string): T | undefined => (o as Record<string, unknown> | undefined)?.[ten] as T | undefined;

const THE: TheViec = { ma: "TC-V10", mucTieu: "x", tepDuocPhep: ["a.test.ts", "src/b.ts"], nguCanhDoc: [], lenhKiem: "npx vitest run a.test.ts", gioiHan: { giay: 60, vong: 3 } };
const kiemGia = (giay: number, hong = 0): KetQuaKiem => ({
  lenh: THE.lenhKiem,
  exit: hong ? 1 : 0,
  hetGio: false,
  giay,
  duoi: "dau ra gia",
  vitest: { tep: { dat: hong ? 0 : 1, hong: hong ? 1 : 0, boQua: 0, tong: 1 }, ca: { dat: 2 - hong, hong, boQua: 0, tong: 2 } },
});
const tscSach: TscGia = { exit: 0, hetGio: false, giay: 12, loiTrongTep: [], tongLoi: 0 };
const loiO = (tep: string, dong: number, chu = "Argument of type 'string' is not assignable to parameter of type 'number'.") => `${tep}(${dong},5): error TS2345: ${chu}`;
const tscDo = (loiTrongTep: string[], tongLoi = loiTrongTep.length, khoi?: string[]): TscGia => ({ exit: 2, hetGio: false, giay: 12, loiTrongTep, tongLoi, ...(khoi ? { khoiTrongTep: khoi } : {}) });

let wt: string;
let ra: string;
beforeEach(() => {
  wt = fs.mkdtempSync(path.join(os.tmpdir(), "v10-wt-"));
  ra = fs.mkdtempSync(path.join(os.tmpdir(), "v10-ra-"));
  fs.writeFileSync(path.join(wt, "tsconfig.tests.json"), "{}\n");
});
afterEach(() => {
  fs.rmSync(wt, { recursive: true, force: true });
  fs.rmSync(ra, { recursive: true, force: true });
});

interface TuyChonHost {
  kiem?: KetQuaKiem;
  tsc?: TscGia;
  tepDoi?: string[];
  hamLoi?: string | null;
  soLan?: number;
  cheDo?: "chi-so";
  khongKieu?: boolean;
}
/** Chạy driverHost với host GIẢ: model xin LỆNH KIỂM `soLan` lần liên tiếp (mỗi lần chờ nhận trả lời) rồi kết thúc. */
async function chayHost(o: TuyChonHost = {}) {
  const tin: string[] = [];
  const goiTsc: Array<{ tepDoi: string[]; han: number }> = [];
  type Su = { loai: string; [x: string]: unknown };
  let nghe: ((m: { seq: number; suKien: Su }) => void) | null = null;
  let nhan: (() => void) | null = null;
  const dep: PhuThuocHost = {
    kiemMoiTruong: async () => null,
    taoLuot: async () => {
      setTimeout(() => void (async () => {
        for (let i = 1; i <= (o.soLan ?? 1); i++) {
          const cho = new Promise<void>((r) => { nhan = r; });
          nghe?.({ seq: i, suKien: { loai: "can-duyet", id: `tc-${i}`, deXuat: { ten: "run_command", thamSo: { command: THE.lenhKiem }, moTa: "m", pendingActionId: `rc${i}`, xemTruoc: "diff" } } });
          await cho;
        }
        nghe?.({ seq: 99, suKien: { loai: "xong", lyDo: "hoan-thanh" } });
      })(), 10);
      return { ok: true, runId: "r1" };
    },
    nghe: (_r, fn) => { nghe = fn as never; return () => { nghe = null; }; },
    huy: () => undefined,
    duyet: async () => ({ ok: true, daGhi: true, status: "executed" }),
    bac: async (_id, lyDo) => { tin.push(lyDo); nhan?.(); },
    duAnId: () => "_tho_ca_wt_ao",
    chinhSachDuyet: (async () => ({ quyet: "tu-choi" })) as ChinhSachDuyet,
    bay: () => Date.now(),
    datKhoaKy: () => ({ ok: true, tam: false }),
    chayKiem: async () => o.kiem ?? kiemGia(1),
  };
  const kieu: KieuTrongVong = {
    tepDoi: () => o.tepDoi ?? ["a.test.ts"],
    chayTsc: async (tepDoi, han) => { goiTsc.push({ tepDoi: [...tepDoi], han }); return o.tsc ?? tscSach; },
    hamLoi: o.hamLoi ?? null,
  };
  const dv = { the: THE, wt, lenh: "L", hanGiay: 30, ra, ghiLuotDir: null, khoGhi: {}, ...(o.khongKieu ? {} : { kieu }), ...(o.cheDo ? { cheDoKiem: o.cheDo, giaTriBiMat: [] } : {}) } as DauVaoDriver;
  const kq = await driverHost(dep)(dv);
  return { tin, goiTsc, kq };
}
const phanKieu = (s: string) => { const i = s.indexOf("KIỂU:"); return i < 0 ? "" : s.slice(i); };

describe("V10 — kết quả lệnh kiểm trong vòng mang theo kiểu", () => {
  it("V10-T1 lệnh kiểm xanh + tsc đỏ ⇒ ngay lời nhắc lần đó có dòng lỗi kiểu", async () => {
    const dong = loiO("a.test.ts", 3);
    const r = await chayHost({ tsc: tscDo([dong]) });
    expect(r.tin[0]).toContain("KIỂU: ĐỎ — 1 lỗi trong tệp được phép, 0 lỗi ở tệp khác");
    expect(r.tin[0]).toContain(dong);
    expect(r.goiTsc).toEqual([{ tepDoi: ["a.test.ts"], han: 269 }]);
  });

  it("V10-T2 xanh + kiểu sạch ⇒ nói sạch", async () => {
    const r = await chayHost({ tsc: tscSach });
    expect(r.tin[0]).toContain("KIỂU: sạch");
    expect(r.tin[0]).not.toContain("KIỂU: ĐỎ");
  });

  it("V10-T3 tsc quá giờ ⇒ CHƯA kiểm được, không nói sạch", async () => {
    const r = await chayHost({ tsc: { exit: null, hetGio: true, giay: 169, loiTrongTep: [], tongLoi: 0 } });
    expect(r.tin[0]).toContain("KIỂU: CHƯA kiểm được");
    expect(r.tin[0]).not.toContain("KIỂU: sạch");
  });

  it("V10-T3b tsc không khởi chạy được ⇒ CHƯA kiểm được, kèm lý do", async () => {
    const r = await chayHost({ tsc: { exit: null, hetGio: false, giay: 0, loiTrongTep: [], tongLoi: 0, loi: "spawn ENOENT" } });
    expect(r.tin[0]).toContain("KIỂU: CHƯA kiểm được");
    expect(r.tin[0]).toContain("spawn ENOENT");
    expect(r.tin[0]).not.toContain("KIỂU: sạch");
  });

  it("V10-T4 lệnh kiểm đỏ ⇒ nói chưa kiểm kiểu vì đang đỏ, và KHÔNG gọi tsc", async () => {
    const r = await chayHost({ kiem: kiemGia(1, 1) });
    expect(r.tin[0]).toContain("KIỂU: chưa kiểm vì lệnh kiểm đang đỏ");
    expect(r.goiTsc).toEqual([]);
  });

  it("V10-T5 chế độ chỉ số ⇒ có con số, không có chữ nào của lỗi", async () => {
    const r = await chayHost({ cheDo: "chi-so", tsc: tscDo([loiO("a.test.ts", 3)], 4) });
    expect(r.tin[0]).toContain("KIỂU: ĐỎ — 1 lỗi trong tệp được phép, 3 lỗi ở tệp khác");
    expect(r.tin[0]).not.toContain("TS2345");
    expect(r.tin[0]).not.toContain("Argument of type");
  });

  it("V10-T6 lỗi ở tệp đã đổi nhưng NGOÀI phép chỉ được đếm, không lộ dòng", async () => {
    const r = await chayHost({ tepDoi: ["a.test.ts", "c.ts"], tsc: tscDo([loiO("a.test.ts", 3), loiO("c.ts", 9)], 5) });
    expect(r.tin[0]).toContain("KIỂU: ĐỎ — 1 lỗi trong tệp được phép, 4 lỗi ở tệp khác");
    expect(r.tin[0]).toContain("a.test.ts(3,5)");
    expect(r.tin[0]).not.toContain("c.ts(");
  });

  it("V10-T6b chỉ có lỗi ở tệp khác ⇒ vẫn là ĐỎ, không nói sạch", async () => {
    const r = await chayHost({ tsc: tscDo([], 7) });
    expect(r.tin[0]).toContain("KIỂU: ĐỎ — 0 lỗi trong tệp được phép, 7 lỗi ở tệp khác");
    expect(r.tin[0]).not.toContain("KIỂU: sạch");
  });

  it("V10-T7 giải thích dài ⇒ đủ vị trí mọi lỗi, cắt giải thích và nói đã cắt, trong ngân sách", async () => {
    const dau = [1, 2, 3].map((n) => loiO("a.test.ts", n));
    const khoi = dau.map((d, i) => `${d}\n  Type 'string' is not assignable to type 'number'. DAU_GIAI_THICH_${i + 1} ${"x".repeat(3000)}`);
    const r = await chayHost({ tsc: tscDo(dau, 3, khoi) });
    const p = phanKieu(r.tin[0]!);
    for (const n of [1, 2, 3]) {
      expect(p).toContain(`a.test.ts(${n},5): error TS2345`);
      expect(p).toContain(`DAU_GIAI_THICH_${n}`);
    }
    expect(p).toContain("đã cắt bớt giải thích");
    expect(p.length).toBeLessThanOrEqual(2400);
  });

  it("V10-T7b quá nhiều lỗi ⇒ giữ lỗi đầu, nói còn bao nhiêu lỗi không liệt kê, trong ngân sách", async () => {
    const dau = Array.from({ length: 60 }, (_, i) => loiO("a.test.ts", i + 1));
    const r = await chayHost({ tsc: tscDo(dau) });
    const p = phanKieu(r.tin[0]!);
    expect(p).toContain("KIỂU: ĐỎ — 60 lỗi trong tệp được phép");
    expect(p).toContain("a.test.ts(1,5): error TS2345");
    const soNeu = p.split("error TS2345").length - 1;
    expect(soNeu).toBeLessThan(60);
    expect(p).toContain(`còn ${60 - soNeu} lỗi không liệt kê`);
    expect(p.length).toBeLessThanOrEqual(2400);
  });

  it("V10-T7c bộ đọc đầu ra tsc giữ cả các dòng giải thích thụt lề của lỗi trong tệp đổi", () => {
    const dau = [loiO("a.test.ts", 3), "  Types of property 'x' are incompatible.", "    Type 'string' is not assignable to type 'number'.", loiO("khac.ts", 1), "  giai thich cua tep khac", "Found 2 errors."].join("\n");
    const r = loiTscTrongTep(dau, ["a.test.ts"]);
    expect(truong<string[]>(r, "khoiTrongTep")).toEqual([[loiO("a.test.ts", 3), "  Types of property 'x' are incompatible.", "    Type 'string' is not assignable to type 'number'."].join("\n")]);
    expect(r.trongTep).toEqual([loiO("a.test.ts", 3)]);
    expect(r.tong).toBe(2);
  });

  it("V10-T8 lệnh kiểm tốn 260 s ⇒ không gọi tsc, nói CHƯA kiểm được vì hết chỗ", async () => {
    const r = await chayHost({ kiem: kiemGia(260) });
    expect(r.tin[0]).toContain("KIỂU: CHƯA kiểm được");
    expect(r.tin[0]).toContain("260");
    expect(r.goiTsc).toEqual([]);
  });

  it("V10-T8b hạn tsc = 270 − giây lệnh kiểm; đúng 20 s vẫn chạy, 19 s thì không", async () => {
    expect((await chayHost({ kiem: kiemGia(100) })).goiTsc.map((g) => g.han)).toEqual([170]);
    expect((await chayHost({ kiem: kiemGia(250) })).goiTsc.map((g) => g.han)).toEqual([20]);
    expect((await chayHost({ kiem: kiemGia(251) })).goiTsc).toEqual([]);
  });

  it("V10-T8c không có tệp TypeScript đổi ⇒ nói không kiểm, không gọi tsc", async () => {
    const r = await chayHost({ tepDoi: ["ghi-chu.md"] });
    expect(r.tin[0]).toContain("KIỂU: không kiểm — không có tệp TypeScript đổi");
    expect(r.goiTsc).toEqual([]);
  });

  it("V10-T9 lệnh tsc dùng sổ RIÊNG khi được đưa đường sổ; không đưa thì y lệnh cũ", () => {
    const lenhTsc = (kiemChung as unknown as { lenhTsc?: (so?: string) => string }).lenhTsc;
    expect(lenhTsc?.("D:/ket qua/tsc.tsbuildinfo")).toBe('npx tsc --noEmit -p tsconfig.tests.json --incremental --tsBuildInfoFile "D:/ket qua/tsc.tsbuildinfo"');
    expect(lenhTsc?.()).toBe("npx tsc --noEmit -p tsconfig.tests.json");
  });

  it("V10-T10 trần 8 lần tự chạy giữ nguyên; mỗi lần kiểm kiểu được ghi số giây", async () => {
    const r = await chayHost({ soLan: 9 });
    expect(r.tin.slice(0, 8).every((s) => s.includes("KIỂU: sạch"))).toBe(true);
    expect(r.tin[8]).toContain("đã tự chạy lệnh kiểm 8 lần");
    expect(r.goiTsc).toHaveLength(8);
    const ghi = truong<Array<{ lan: number; giay: number | null; trangThai: string }>>(r.kq, "kieuTrongVong");
    expect(ghi).toHaveLength(8);
    expect(ghi?.[0]).toEqual({ lan: 1, giay: 12, trangThai: "sach" });
    expect(r.kq.ghiChu.join("\n")).toContain("KIỂU lần 1: sach, 12 s");
    expect(truong<number>(r.kq, "soTuChay")).toBe(9);
  });

  it("V10-P1c hâm sổ kiểu đã hỏng ⇒ trong vòng nói CHƯA kiểm được kèm lý do, KHÔNG âm thầm chạy nguội", async () => {
    const r = await chayHost({ hamLoi: "hâm quá hạn 900 s" });
    expect(r.tin[0]).toContain("KIỂU: CHƯA kiểm được — hâm sổ kiểu hỏng: hâm quá hạn 900 s");
    expect(r.goiTsc).toEqual([]);
  });

  it("V10-C1 đối chứng: driver không được đưa bộ kiểm kiểu ⇒ lời nhắc y như cũ từng byte", async () => {
    const r = await chayHost({ khongKieu: true });
    expect(r.tin[0]).toBe(tomTatKiemChoModel(kiemGia(1), 1));
  });
});

describe("V10 — trong chayMotViec: hâm trước, một sổ riêng, ghi vào chay.json", () => {
  const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
  const TEP = "client/src/lib/a.test.ts";
  const VAN = `MÃ: TC-V10\nQUY TRÌNH: làm\nMỤC TIÊU: thử\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\nGIỚI HẠN: 1 phút, 3 vòng`;
  const NOI_DUNG = "import { it, expect } from 'vitest';\nit('x', () => { expect(1).toBe(1); });\n";
  let goc: string;
  let kho: string;
  beforeEach(() => {
    goc = fs.mkdtempSync(path.join(os.tmpdir(), "v10cmv-"));
    kho = path.join(goc, "_tho_ca_wt_v10");
    fs.mkdirSync(kho, { recursive: true });
    git(kho, "init", "-q");
    git(kho, "config", "user.email", "t@t");
    git(kho, "config", "user.name", "t");
    git(kho, "config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(kho, "tsconfig.tests.json"), "{}\n");
    git(kho, "add", ".");
    git(kho, "commit", "-q", "-m", "init");
  });
  afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

  const kiemXanh: ChayKiem = async (lenh) => ({ ...kiemGia(1), lenh });
  async function chay(o: { ham?: TscGia; soTuChay?: number; trongDriver?: (v: DauVaoDriver) => Promise<unknown> } = {}) {
    const nhatKy: string[] = [];
    const goi: Array<{ tepDoi: string[]; han: number; so: string | undefined }> = [];
    const chayTsc = async (_w: string, tepDoi: readonly string[], han: number, so?: string): Promise<TscGia> => {
      nhatKy.push(`tsc ${tepDoi.length === 0 ? "ham" : "co-tep"}`);
      goi.push({ tepDoi: [...tepDoi], han, so });
      return tepDoi.length === 0 ? (o.ham ?? { ...tscSach, giay: 500 }) : tscSach;
    };
    let nhanDuoc: DauVaoDriver | null = null;
    let tuDriver: unknown;
    const driver: Driver = async (v) => {
      nhatKy.push("driver");
      nhanDuoc = v;
      fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(v.wt, TEP), NOI_DUNG);
      tuDriver = await o.trongDriver?.(v);
      return { vong: 1, token: null, ghiChu: [], hetGio: false, ...(o.soTuChay === undefined ? {} : { soTuChay: o.soTuChay }) };
    };
    // chỉ driver TỰ KHAI hỗ trợ kiểm kiểu trong vòng mới được hâm và nhận `kieu` (driverHost thật tự khai — xem V10-H1)
    Object.assign(driver, { kiemKieuTrongVong: true });
    const thuMucRa = path.join(goc, "ra");
    const r = await chayMotViec({ van: VAN, wt: kho, base: "HEAD", driver, ra: thuMucRa, choPhepKhoRieng: true, luat: "# l\n", chayKiem: kiemXanh, chayTsc: chayTsc as never });
    return { r, nhatKy, goi, v: nhanDuoc as DauVaoDriver | null, tuDriver, thuMucRa };
  }

  it("V10-P1a hâm chạy TRƯỚC driver, trên cây gốc (không tệp đổi), và được ghi vào kết quả", async () => {
    const x = await chay();
    expect(x.nhatKy.slice(0, 2)).toEqual(["tsc ham", "driver"]);
    expect(truong(x.r, "hamTsc")).toEqual({ dat: true, lyDo: null, giay: 500 });
    expect(kieuCua(x.v!)?.hamLoi).toBeNull();
  });

  it("V10-P1b hâm quá giờ ⇒ lượt vẫn chạy, driver nhận lý do, kết quả ghi rõ", async () => {
    const x = await chay({ ham: { exit: null, hetGio: true, giay: 900, loiTrongTep: [], tongLoi: 0 } });
    expect(truong<{ dat: boolean; lyDo: string; giay: number }>(x.r, "hamTsc")).toMatchObject({ dat: false, giay: 900 });
    expect(truong<{ lyDo: string }>(x.r, "hamTsc")?.lyDo).toContain("quá hạn");
    expect(kieuCua(x.v!)?.hamLoi).toContain("quá hạn");
    expect(x.nhatKy).toContain("driver");
  });

  it("V10-P1d thời gian hâm không trừ vào hạn của model", async () => {
    const x = await chay();
    expect(x.goi[0]?.tepDoi).toEqual([]);
    expect(x.v?.hanGiay).toBe(60);
  });

  it("V10-T9b hâm, kiểm trong vòng và kiểm cuối dùng CÙNG một sổ riêng nằm trong thư mục kết quả", async () => {
    const x = await chay({ trongDriver: async (v) => kieuCua(v)?.chayTsc(kieuCua(v)!.tepDoi(), 100) });
    const so = x.goi.map((g) => g.so);
    expect(x.goi.map((g) => g.tepDoi)).toEqual([[], [TEP], [TEP]]);
    expect(new Set(so).size).toBe(1);
    expect(so[0]?.startsWith(x.thuMucRa)).toBe(true);
    expect(so[0]?.endsWith(".tsbuildinfo")).toBe(true);
  });

  it("V10-T11 xuất hiện .env giữa lượt ⇒ kiểm kiểu trong vòng bị chặn, tsc thật không được gọi", async () => {
    const x = await chay({
      trongDriver: async (v) => {
        fs.writeFileSync(path.join(v.wt, ".env"), "");
        return kieuCua(v)?.chayTsc(kieuCua(v)!.tepDoi(), 100);
      },
    });
    expect(truong<string>(x.tuDriver, "loi")).toBe("ENV-XUAT-HIEN-GIUA-LUOT");
    expect(x.goi.map((g) => g.tepDoi)).toEqual([[]]);
  });

  it("V10-R6 kết quả ghi model có gọi lệnh kiểm hay không", async () => {
    expect(truong((await chay({ soTuChay: 0 })).r, "modelGoiLenhKiem")).toBe(false);
  });

  it("V10-R6b có gọi ⇒ true", async () => {
    expect(truong((await chay({ soTuChay: 2 })).r, "modelGoiLenhKiem")).toBe(true);
  });

  it("V10-C2 đối chứng: kho không có tsconfig.tests.json ⇒ không hâm, không gọi tsc", async () => {
    git(kho, "rm", "-q", "tsconfig.tests.json");
    git(kho, "commit", "-q", "-m", "bo tsconfig");
    const x = await chay();
    expect(x.goi).toEqual([]);
    expect(x.r.ketCuc).toBe("xong");
  });
});

describe("V10 — thêm sau lượt đỏ-trước (đã báo trước)", () => {
  it("V10-H1 driverHost thật tự khai hỗ trợ kiểm kiểu trong vòng (mất cờ này thì V10 tắt im lặng)", () => {
    const h = driverHost({} as PhuThuocHost);
    expect((h as unknown as { kiemKieuTrongVong?: boolean }).kiemKieuTrongVong).toBe(true);
  });

  it("V10-T3c tsc thoát khác 0 mà không có dòng lỗi đọc được (lỗi cấu hình, sập) ⇒ CHƯA kiểm được, không nói sạch", async () => {
    const r = await chayHost({ tsc: { exit: 1, hetGio: false, giay: 2, loiTrongTep: [], tongLoi: 0 } });
    expect(r.tin[0]).toContain("KIỂU: CHƯA kiểm được");
    expect(r.tin[0]).not.toContain("KIỂU: sạch");
  });

  it("V10-C3 đối chứng: driver hàm KHÔNG tự khai ⇒ không hâm, không nhận kieu, chỉ còn tsc cuối như trước", async () => {
    const goc = fs.mkdtempSync(path.join(os.tmpdir(), "v10c3-"));
    try {
      const kho = path.join(goc, "_tho_ca_wt_v10c3");
      fs.mkdirSync(kho, { recursive: true });
      const git = (...a: string[]) => spawnSync("git", a, { cwd: kho, encoding: "utf8" });
      git("init", "-q");
      git("config", "user.email", "t@t");
      git("config", "user.name", "t");
      git("config", "core.autocrlf", "false");
      fs.writeFileSync(path.join(kho, "tsconfig.tests.json"), "{}\n");
      git("add", ".");
      git("commit", "-q", "-m", "init");
      const TEP = "client/src/lib/a.test.ts";
      const goi: string[][] = [];
      let coKieu: boolean | null = null;
      const driver: Driver = async (v) => {
        coKieu = kieuCua(v) !== undefined;
        fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
        fs.writeFileSync(path.join(v.wt, TEP), "import { it, expect } from 'vitest';\nit('x', () => { expect(1).toBe(1); });\n");
        return { vong: 1, token: null, ghiChu: [], hetGio: false };
      };
      await chayMotViec({ van: `MÃ: TC-V10\nQUY TRÌNH: làm\nMỤC TIÊU: thử\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\nGIỚI HẠN: 1 phút, 3 vòng`, wt: kho, base: "HEAD", driver, ra: path.join(goc, "ra"), choPhepKhoRieng: true, luat: "# l\n", chayKiem: async (l) => ({ ...kiemGia(1), lenh: l }), chayTsc: async (_w, tep) => (goi.push([...tep]), tscSach) });
      expect(coKieu).toBe(false);
      expect(goi).toEqual([[TEP]]);
    } finally {
      fs.rmSync(goc, { recursive: true, force: true });
    }
  });
});

/*
 * LƯỢT 2 — viết SAU KHI biết đột biến c43 sống (bộ chốt trước của kiem-dinh); đo lại c43 KHÔNG phải bộ chốt trước. Lời nhắc gửi model có ba đường đưa chữ của tsc ra:
 * dòng lỗi, dòng giải thích, lỗi khởi chạy — cả ba phải qua bộ che token. Chuỗi giống token được GHÉP LÚC CHẠY, không nằm nguyên trong mã nguồn.
 */
describe("V10 lượt 2 — chữ của tsc đi qua bộ che token trước khi tới model", () => {
  const tokenGia = () => ["gh", "p_"].join("") + "A1b2".repeat(9);
  const chuCoToken = () => `Type '"${tokenGia()}"' is not assignable to type 'number'.`;

  it("V10-L2a token trong DÒNG LỖI không tới model", async () => {
    const r = await chayHost({ tsc: tscDo([loiO("a.test.ts", 3, chuCoToken())]) });
    expect(r.tin[0]).toContain("a.test.ts(3,5): error TS2345");
    expect(r.tin[0]).not.toContain(tokenGia());
    expect(r.tin[0]).toContain("[REDACTED_SECRET]");
  });

  it("V10-L2b token trong dòng GIẢI THÍCH không tới model", async () => {
    const dong = loiO("a.test.ts", 3);
    const r = await chayHost({ tsc: tscDo([dong], 1, [`${dong}\n  ${chuCoToken()} DAU_GIAI_THICH`]) });
    expect(r.tin[0]).toContain("DAU_GIAI_THICH");
    expect(r.tin[0]).not.toContain(tokenGia());
    expect(r.tin[0]).toContain("[REDACTED_SECRET]");
  });

  it("V10-L2c token trong lỗi KHỞI CHẠY tsc không tới model", async () => {
    const r = await chayHost({ tsc: { exit: null, hetGio: false, giay: 0, loiTrongTep: [], tongLoi: 0, loi: `spawn that bai ${tokenGia()}` } });
    expect(r.tin[0]).toContain("spawn that bai");
    expect(r.tin[0]).not.toContain(tokenGia());
    expect(r.tin[0]).toContain("[REDACTED_SECRET]");
  });
});
