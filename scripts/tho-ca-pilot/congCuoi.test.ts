/**
 * PILOT-CONG-CUOI — cổng cuối của bộ chạy phải đòi tsc THẬT SỰ sạch phần model gây ra: chặn lỗi MỚI so với nền ở MỌI tệp; không có nền thì mọi lỗi đều chặn;
 * tsc thoát khác 0 không có dòng lỗi, hoặc có lỗi không gắn tệp, thì chặn. Nền là danh sách lỗi của lượt HÂM (cây gốc, trước khi gọi model).
 * Mọi tsc ở đây là GIẢ (tiêm vào); không tiến trình tsc, không model, không CSDL. Kho git nằm trong thư mục tạm.
 * Tên mới đọc qua ép kiểu rộng để tệp này kiểm kiểu được cả khi mã chưa có chúng.
 * GIỚI HẠN CÓ TÊN: CC-LUOT-SUA-TEP-KHAC · CC-SO-CHI-DONG-DAU · CC-CUNG-CHU-KHONG-BIET-CHO-NAO · CC-DOI-TEN-TEP · CC-NOI-CHAYLENHTSC.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, type DauVaoDriver, type Driver } from "./chayMotViec";
import { driverHost, type ChinhSachDuyet, type PhuThuocHost } from "./driverHost";
import * as kiemChung from "./kiemChung";
import { loiTscTrongTep, quyetKetCuc, type ChayKiem, type KetQuaKiem, type KetQuaTsc } from "./kiemChung";
import type { TheViec } from "./theViec";

interface SoVoiNen { soLoiNen: number; loiMoi: string[] }
type TscGia = KetQuaTsc & { khoiTrongTep?: string[]; dongLoi?: string[]; loiKhongViTri?: string[]; soVoiNen?: SoVoiNen };
interface KieuCC {
  tepDoi: () => string[];
  chayTsc: (tepDoi: readonly string[], hanGiay: number) => Promise<TscGia>;
  hamLoi: string | null;
  nen?: readonly string[] | null;
}
const kieuCua = (v: DauVaoDriver): KieuCC | undefined => (v as unknown as { kieu?: KieuCC }).kieu;
const moi = <T,>(ten: string): T | undefined => (kiemChung as unknown as Record<string, unknown>)[ten] as T | undefined;
const truong = <T,>(o: unknown, ten: string): T | undefined => (o as Record<string, unknown> | undefined)?.[ten] as T | undefined;

const loi = (tep: string, dong: number, chu = "Type 'string' is not assignable to type 'number'.", ma = "TS2322") => `${tep}(${dong},7): error ${ma}: ${chu}`;
const sach: TscGia = { exit: 0, hetGio: false, giay: 1, loiTrongTep: [], tongLoi: 0 };
/** kết quả tsc đỏ ĐẦY ĐỦ như bộ đọc thật phải trả: mọi dòng lỗi + phần nằm trong tệp đổi */
const doCo = (dong: string[], tepDoi: readonly string[] = [], them: Partial<TscGia> = {}): TscGia => ({
  exit: 2,
  hetGio: false,
  giay: 1,
  loiTrongTep: dong.filter((d) => tepDoi.some((t) => d.startsWith(`${t}(`))),
  tongLoi: dong.length,
  dongLoi: dong,
  ...them,
});

const kiemGia = (giay = 1): KetQuaKiem => ({ lenh: "npx vitest run a.test.ts", exit: 0, hetGio: false, giay, duoi: "dau ra gia", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } } });
const quyet = (tsc: TscGia) => quyetKetCuc({ truoc: "xong", dungVitest: true, tepTest: [{ duong: "a.test.ts", soCa: 2 }], kiem: kiemGia(), tsc });

describe("PILOT-CONG-CUOI — quyết ở cổng cuối", () => {
  it("CC-Q1 tsc thoát khác 0 mà không có dòng lỗi ⇒ kiem-do, lý do nêu mã thoát", () => {
    const r = quyet({ ...sach, exit: 2 });
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toContain("tsc thoát mã 2 mà không có dòng lỗi đọc được");
  });

  it("CC-Q2 mã thoát vắng mà không hết giờ, không lỗi khởi chạy ⇒ kiem-do", () => {
    const r = quyet({ ...sach, exit: null });
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toContain("tsc thoát mã null mà không có dòng lỗi đọc được");
  });

  it("CC-Q3 có lỗi KHÔNG GẮN TỆP (lỗi cấu hình) ⇒ kiem-do kể cả khi các lỗi gắn tệp đều là lỗi nền", () => {
    const r = quyet(doCo([loi("khac.ts", 1)], [], { loiKhongViTri: ["error TS5023: Unknown compiler option 'x'."], soVoiNen: { soLoiNen: 1, loiMoi: [] } }));
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toContain("TS5023");
  });

  it("CC-Q4 không có nền để so + lỗi chỉ ở tệp khác ⇒ kiem-do, lý do nói không có nền", () => {
    const r = quyet(doCo([loi("khac.ts", 1), loi("khac.ts", 2)]));
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toContain("tsc: 2 lỗi kiểu, không có nền để so");
  });

  it("CC-Q5 có lỗi MỚI so với nền ở tệp khác ⇒ kiem-do, lý do nêu số lỗi mới và dòng lỗi", () => {
    const moiNhat = loi("khac.ts", 4);
    const r = quyet(doCo([loi("nen.ts", 1), moiNhat], [], { soVoiNen: { soLoiNen: 1, loiMoi: [moiNhat] } }));
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toContain("tsc: 1 lỗi kiểu MỚI so với nền");
    expect(r.lyDo).toContain(moiNhat);
  });

  it("CC-Q6 đối chứng: chỉ còn lỗi nền ⇒ xong", () => {
    expect(quyet(doCo([loi("nen.ts", 1), loi("nen.ts", 2)], [], { soVoiNen: { soLoiNen: 2, loiMoi: [] } })).ketCuc).toBe("xong");
  });

  it("CC-Q7 đối chứng: lỗi trong tệp model đổi vẫn chặn dù có trong nền", () => {
    const r = quyet(doCo([loi("a.test.ts", 1)], ["a.test.ts"], { soVoiNen: { soLoiNen: 1, loiMoi: [] } }));
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toContain("tsc: 1 lỗi kiểu trong tệp model đổi");
  });
});

describe("PILOT-CONG-CUOI — so với nền", () => {
  type SoLoiMoi = (nen: readonly string[], cuoi: readonly string[]) => string[];
  const so = (nen: string[], cuoi: string[]) => {
    const f = moi<SoLoiMoi>("soLoiMoi");
    expect(typeof f).toBe("function");
    return f!(nen, cuoi);
  };

  it("CC-S1 lỗi nền bị DỊCH DÒNG (sửa phía trên) không phải lỗi mới", () => {
    expect(so([loi("a.ts", 3), loi("b.ts", 8)], [loi("a.ts", 40), loi("b.ts", 8).replace("(8,7)", "(8,11)")])).toEqual([]);
  });

  it("CC-S2 cùng chữ lỗi xuất hiện THÊM một lần ⇒ đúng một lỗi mới", () => {
    const ra = so([loi("a.ts", 3)], [loi("a.ts", 3), loi("a.ts", 9)]);
    expect(ra).toHaveLength(1);
    expect(ra[0]).toContain("a.ts(");
  });

  it("CC-S3 khác tệp, khác mã hoặc khác thông điệp ⇒ mới", () => {
    const cuoi = [loi("b.ts", 3), loi("a.ts", 3, "Type 'string' is not assignable to type 'number'.", "TS2345"), loi("a.ts", 3, "Cannot find name 'x'.")];
    expect(so([loi("a.ts", 3)], cuoi)).toEqual(cuoi);
  });

  it("CC-S4 gạch chéo ngược và xuôi là cùng một tệp", () => {
    expect(so([loi("src\\a.ts", 3)], [loi("src/a.ts", 3)])).toEqual([]);
  });

  it("CC-S5 bớt lỗi (model gỡ lỗi nền) ⇒ không có lỗi mới; nền rỗng ⇒ mọi lỗi đều mới", () => {
    expect(so([loi("a.ts", 3), loi("b.ts", 4)], [loi("b.ts", 4)])).toEqual([]);
    expect(so([], [loi("a.ts", 3)])).toEqual([loi("a.ts", 3)]);
  });

  type GanSoVoiNen = (t: TscGia, nen: readonly string[] | null) => TscGia;
  const gan = (t: TscGia, nen: readonly string[] | null) => {
    const f = moi<GanSoVoiNen>("ganSoVoiNen");
    expect(typeof f).toBe("function");
    return f!(t, nen);
  };

  it("CC-S6 gắn so-với-nền: đủ danh sách ⇒ có số lỗi nền và lỗi mới; tsc sạch ⇒ không lỗi mới", () => {
    expect(gan(doCo([loi("a.ts", 9), loi("c.ts", 1)]), [loi("a.ts", 3)]).soVoiNen).toEqual({ soLoiNen: 1, loiMoi: [loi("c.ts", 1)] });
    expect(gan(sach, [loi("a.ts", 3)]).soVoiNen).toEqual({ soLoiNen: 1, loiMoi: [] });
  });

  it("CC-S7 không có nền, hoặc lượt cuối không đủ danh sách dòng lỗi ⇒ KHÔNG gắn so-với-nền", () => {
    expect(gan(doCo([loi("a.ts", 3)]), null).soVoiNen).toBeUndefined();
    expect(gan({ ...doCo([loi("a.ts", 3)]), tongLoi: 3 }, []).soVoiNen).toBeUndefined();
    expect(gan({ exit: 2, hetGio: false, giay: 1, loiTrongTep: [], tongLoi: 2 }, []).soVoiNen).toBeUndefined();
  });

  it("CC-P1 bộ đọc đầu ra tsc trả MỌI dòng lỗi gắn tệp (không kèm dòng giải thích) và tách lỗi không gắn tệp", () => {
    const chung = "error TS18003: No inputs were found in config file.";
    const dau = [loi("a.ts", 3), "  Types of property 'x' are incompatible.", loi("khac.ts", 1), chung, "Found 2 errors."].join("\n");
    const r = loiTscTrongTep(dau, ["a.ts"]);
    expect(truong<string[]>(r, "dongLoi")).toEqual([loi("a.ts", 3), loi("khac.ts", 1)]);
    expect(truong<string[]>(r, "loiKhongViTri")).toEqual([chung]);
    expect(r.tong).toBe(2);
  });
});

describe("PILOT-CONG-CUOI — trong chayMotViec: nền lấy từ lượt hâm", () => {
  const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
  const TEP = "client/src/lib/a.test.ts";
  const NEN = "server/utils/nen.ts";
  const KHAC = "server/utils/khac.ts";
  const VAN = `MÃ: TC-CC\nQUY TRÌNH: làm\nMỤC TIÊU: thử\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\nGIỚI HẠN: 1 phút, 3 vòng`;
  const VAN_SUA = `${VAN}\nLƯỢT SỬA TSC: 1\nTRẦN LƯỢT MODEL: 20\nTRẦN PHÚT: 20`;
  const NOI_DUNG = "import { it, expect } from 'vitest';\nit('x', () => { expect(1).toBe(1); });\n";
  let goc: string;
  let kho: string;
  beforeEach(() => {
    goc = fs.mkdtempSync(path.join(os.tmpdir(), "cccmv-"));
    kho = path.join(goc, "_tho_ca_wt_cc");
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

  const kiemXanh: ChayKiem = async (lenh) => ({ ...kiemGia(), lenh });
  interface TuyChon {
    /** kết quả lượt hâm */
    ham?: TscGia;
    /** kết quả các lượt tsc có tệp đổi, theo thứ tự */
    cuoi: TscGia[];
    khongTuKhai?: boolean;
    van?: string;
    loiDriver?: string;
  }
  async function chay(o: TuyChon) {
    const hang = [...o.cuoi];
    let goiDriver = 0;
    let nenNhanDuoc: readonly string[] | null | undefined;
    const chayTsc = async (_w: string, tepDoi: readonly string[]): Promise<TscGia> => (tepDoi.length === 0 ? (o.ham ?? sach) : (hang.shift() ?? sach));
    const driver: Driver = async (v) => {
      goiDriver += 1;
      if (goiDriver === 1) nenNhanDuoc = kieuCua(v)?.nen;
      fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(v.wt, TEP), `${NOI_DUNG}// luot ${goiDriver}\n`);
      return { vong: 1, token: { cache: null, prompt: null, soLuotModel: 5 }, ghiChu: [], hetGio: false, ...(o.loiDriver ? { loi: o.loiDriver } : {}) };
    };
    if (!o.khongTuKhai) Object.assign(driver, { kiemKieuTrongVong: true });
    const r = await chayMotViec({ van: o.van ?? VAN, wt: kho, base: "HEAD", driver, ra: path.join(goc, "ra"), choPhepKhoRieng: true, luat: "# l\n", chayKiem: kiemXanh, chayTsc: chayTsc as never, envTran: {} as NodeJS.ProcessEnv });
    return { r, goiDriver, nenNhanDuoc, tsc: r.tsc as TscGia | undefined, lyDo: r.luuY?.join(" | ") ?? "" };
  }

  it("CC-M1 lỗi nền còn nguyên (bị dịch dòng) ⇒ xong, kết quả ghi số lỗi nền và 0 lỗi mới", async () => {
    const x = await chay({ ham: doCo([loi(NEN, 3)]), cuoi: [doCo([loi(NEN, 9)], [TEP])] });
    expect(x.r.ketCuc).toBe("xong");
    expect(x.tsc?.soVoiNen).toEqual({ soLoiNen: 1, loiMoi: [] });
  });

  it("CC-M2 lỗi MỚI ở tệp model KHÔNG đổi ⇒ kiem-do", async () => {
    const x = await chay({ ham: doCo([loi(NEN, 3)]), cuoi: [doCo([loi(NEN, 3), loi(KHAC, 5)], [TEP])] });
    expect(x.r.ketCuc).toBe("kiem-do");
    expect(x.lyDo).toContain("tsc: 1 lỗi kiểu MỚI so với nền");
    expect(x.lyDo).toContain(loi(KHAC, 5));
  });

  it("CC-M3 driver không tự khai (không hâm, không nền) + lỗi chỉ ở tệp khác ⇒ kiem-do", async () => {
    const x = await chay({ khongTuKhai: true, cuoi: [doCo([loi(KHAC, 5)], [TEP])] });
    expect(x.r.ketCuc).toBe("kiem-do");
    expect(x.lyDo).toContain("không có nền để so");
  });

  it.each([
    ["M4a hâm quá giờ", { exit: null, hetGio: true, giay: 900, loiTrongTep: [], tongLoi: 0 } as TscGia],
    ["M4b hâm thoát khác 0 không dòng lỗi", { exit: 1, hetGio: false, giay: 1, loiTrongTep: [], tongLoi: 0 } as TscGia],
    ["M4c hâm có lỗi không gắn tệp", doCo([loi(NEN, 3)], [], { loiKhongViTri: ["error TS5023: Unknown compiler option 'x'."] })],
    ["M4d hâm không đủ danh sách dòng lỗi", { exit: 2, hetGio: false, giay: 1, loiTrongTep: [], tongLoi: 1 } as TscGia],
  ])("CC-%s ⇒ không có nền: lỗi ở tệp khác chặn và driver nhận nền rỗng-giá-trị", async (_ten, ham) => {
    const x = await chay({ ham, cuoi: [doCo([loi(NEN, 3)], [TEP])] });
    expect(x.r.ketCuc).toBe("kiem-do");
    expect(x.lyDo).toContain("không có nền để so");
    expect(x.nenNhanDuoc).toBeNull();
  });

  it("CC-M5 driver tự khai nhận đúng danh sách nền của lượt hâm", async () => {
    const x = await chay({ ham: doCo([loi(NEN, 3), loi(NEN, 4)]), cuoi: [sach] });
    expect(x.nenNhanDuoc).toEqual([loi(NEN, 3), loi(NEN, 4)]);
  });

  it("CC-M6 sau LƯỢT SỬA TSC, lượt tsc thứ hai vẫn được so với cùng nền ⇒ xong", async () => {
    const x = await chay({ van: VAN_SUA, ham: doCo([loi(NEN, 3)]), cuoi: [doCo([loi(NEN, 3), loi(TEP, 2)], [TEP]), doCo([loi(NEN, 3)], [TEP])] });
    expect(x.goiDriver).toBe(2);
    expect(x.r.ketCuc).toBe("xong");
    expect(x.tsc?.soVoiNen).toEqual({ soLoiNen: 1, loiMoi: [] });
  });

  it("CC-M7 lượt dừng giữa chừng: kết cục giữ nguyên, số đo tsc vẫn ghi so-với-nền", async () => {
    const x = await chay({ loiDriver: "lượt dừng không hoàn thành: lyDo=het-luot", ham: doCo([loi(NEN, 3)]), cuoi: [doCo([loi(NEN, 3), loi(KHAC, 5)], [TEP])] });
    expect(x.r.ketCuc).toBe("loi-driver");
    expect(x.tsc?.soVoiNen).toEqual({ soLoiNen: 1, loiMoi: [loi(KHAC, 5)] });
  });
});

describe("PILOT-CONG-CUOI — khối KIỂU trong vòng nêu lỗi MỚI ở tệp khác", () => {
  const THE: TheViec = { ma: "TC-CC", mucTieu: "x", tepDuocPhep: ["a.test.ts"], nguCanhDoc: [], lenhKiem: "npx vitest run a.test.ts", gioiHan: { giay: 60, vong: 3 } };
  let wt: string;
  let ra: string;
  beforeEach(() => {
    wt = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wt-"));
    ra = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ra-"));
    fs.writeFileSync(path.join(wt, "tsconfig.tests.json"), "{}\n");
  });
  afterEach(() => {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(ra, { recursive: true, force: true });
  });

  /** trạng thái kiểm kiểu mà driver ghi lại ở lần chạy `khoi` gần nhất (đi vào chay.json) */
  let trangThaiGhi: string[] = [];

  /** chạy driverHost với host GIẢ: model xin LỆNH KIỂM một lần rồi kết thúc; trả khối "KIỂU:" mà model nhận */
  async function khoi(o: { tsc: TscGia; nen?: readonly string[] | null; tepDoi?: string[]; cheDo?: "chi-so" }) {
    const tin: string[] = [];
    type Su = { loai: string; [x: string]: unknown };
    let nghe: ((m: { seq: number; suKien: Su }) => void) | null = null;
    let nhan: (() => void) | null = null;
    const dep: PhuThuocHost = {
      kiemMoiTruong: async () => null,
      taoLuot: async () => {
        setTimeout(() => void (async () => {
          const cho = new Promise<void>((r) => { nhan = r; });
          nghe?.({ seq: 1, suKien: { loai: "can-duyet", id: "tc-1", deXuat: { ten: "run_command", thamSo: { command: THE.lenhKiem }, moTa: "m", pendingActionId: "rc1", xemTruoc: "diff" } } });
          await cho;
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
      chayKiem: async () => kiemGia(),
    };
    const kieu: KieuCC = { tepDoi: () => o.tepDoi ?? ["a.test.ts"], chayTsc: async () => o.tsc, hamLoi: null, ...(o.nen === undefined ? {} : { nen: o.nen }) };
    const kq = await driverHost(dep)({ the: THE, wt, lenh: "L", hanGiay: 30, ra, ghiLuotDir: null, khoGhi: {}, kieu, ...(o.cheDo ? { cheDoKiem: o.cheDo, giaTriBiMat: [] } : {}) } as unknown as DauVaoDriver);
    trangThaiGhi = (kq.kieuTrongVong ?? []).map((m) => String(m.trangThai));
    const i = (tin[0] ?? "").indexOf("KIỂU:");
    return i < 0 ? "" : tin[0]!.slice(i);
  }
  const NEN = loi("server/utils/nen.ts", 1);
  const MOI = (n: number, chu = `Cannot find name 'x${n}'.`) => loi(`server/utils/m${n}.ts`, n, chu, "TS2304");

  it("CC-V1 nêu số lỗi MỚI ở tệp khác và dòng của lỗi mới, không nêu dòng của lỗi nền", async () => {
    const p = await khoi({ nen: [NEN], tsc: doCo([NEN, MOI(1)]) });
    expect(p).toContain("KIỂU: ĐỎ — 0 lỗi trong tệp được phép, 2 lỗi ở tệp khác.");
    expect(p).toContain("1 lỗi MỚI ở tệp khác so với cây gốc");
    expect(p).toContain(MOI(1));
    expect(p).not.toContain("server/utils/nen.ts");
  });

  it("CC-V2 nhiều nhất 5 dòng lỗi mới, nói còn bao nhiêu", async () => {
    const p = await khoi({ nen: [], tsc: doCo([1, 2, 3, 4, 5, 6, 7].map((n) => MOI(n))) });
    expect(p).toContain("7 lỗi MỚI ở tệp khác so với cây gốc");
    expect(p.split("error TS2304").length - 1).toBe(5);
    expect(p).toContain("còn 2 lỗi mới ở tệp khác không liệt kê");
  });

  it("CC-V3 không kèm dòng giải thích của lỗi ở tệp khác (kể cả tệp đã đổi nhưng ngoài phép)", async () => {
    const dong = loi("c.ts", 9);
    const p = await khoi({ nen: [], tepDoi: ["a.test.ts", "c.ts"], tsc: doCo([dong], ["a.test.ts", "c.ts"], { khoiTrongTep: [`${dong}\n  DAU_GIAI_THICH_NGOAI`] }) });
    expect(p).toContain(dong);
    expect(p).not.toContain("DAU_GIAI_THICH_NGOAI");
  });

  it("CC-V4 đường bị chính sách hộp cát chặn ⇒ không nêu, chỉ đếm", async () => {
    const cam = [loi("../ngoai/a.ts", 1, "DAU_CAM_1"), loi("node_modules/x/b.ts", 2, "DAU_CAM_2")];
    const p = await khoi({ nen: [], tsc: doCo([...cam, MOI(1)]) });
    expect(p).toContain("3 lỗi MỚI ở tệp khác so với cây gốc");
    expect(p).toContain(MOI(1));
    expect(p).not.toContain("DAU_CAM_1");
    expect(p).not.toContain("DAU_CAM_2");
    expect(p).toContain("còn 2 lỗi mới ở tệp khác không liệt kê");
  });

  it("CC-V5 token trong dòng lỗi mới ở tệp khác không tới model", async () => {
    const tokenGia = ["gh", "p_"].join("") + "A1b2".repeat(9);
    const p = await khoi({ nen: [], tsc: doCo([loi("server/utils/m1.ts", 1, `Type '"${tokenGia}"' is not assignable to type 'number'.`)]) });
    expect(p).toContain("server/utils/m1.ts(1,7)");
    expect(p).not.toContain(tokenGia);
    expect(p).toContain("[REDACTED_SECRET]");
  });

  it("CC-V6 chế độ chỉ số ⇒ có số lỗi mới, không có chữ nào của lỗi", async () => {
    const p = await khoi({ cheDo: "chi-so", nen: [NEN], tsc: doCo([NEN, MOI(1)]) });
    expect(p).toContain("1 lỗi MỚI ở tệp khác so với cây gốc");
    expect(p).not.toContain("TS2304");
    expect(p).not.toContain("server/utils/m1.ts");
  });

  it("CC-V7 lỗi trong tệp được phép đứng trước, lỗi mới ở tệp khác vẫn có mặt, cả khối trong ngân sách", async () => {
    const trong = [1, 2, 3].map((n) => loi("a.test.ts", n, `T${n} ${"y".repeat(400)}`));
    const khoiDai = trong.map((d) => `${d}\n  ${"z".repeat(3000)}`);
    const khac = [1, 2, 3, 4, 5].map((n) => MOI(n, `K${n} ${"x".repeat(400)}`));
    const p = await khoi({ nen: [], tsc: doCo([...trong, ...khac], ["a.test.ts"], { khoiTrongTep: khoiDai }) });
    expect(p.length).toBeLessThanOrEqual(2400);
    for (const n of [1, 2, 3]) expect(p).toContain(`a.test.ts(${n},7)`);
    expect(p).toContain("server/utils/m1.ts(1,7)");
    expect(p.indexOf("a.test.ts(3,7)")).toBeLessThan(p.indexOf("server/utils/m1.ts(1,7)"));
  });

  it("CC-V8 đối chứng: không có nền ⇒ khối y như V10 (chỉ đếm tệp khác)", async () => {
    const mong = "KIỂU: ĐỎ — 0 lỗi trong tệp được phép, 1 lỗi ở tệp khác. Lệnh kiểm xanh CHƯA đủ: sửa lỗi kiểu rồi gọi lại đúng lệnh kiểm.";
    expect(await khoi({ nen: null, tsc: doCo([MOI(1)]) })).toBe(mong);
    expect(await khoi({ tsc: doCo([MOI(1)]) })).toBe(mong);
  });

  it("CC-V9 chỉ còn lỗi nền (0 lỗi trong tệp được phép, 0 lỗi mới) ⇒ không bảo model đi sửa", async () => {
    const p = await khoi({ nen: [NEN], tsc: doCo([NEN]) });
    expect(p).toContain("KIỂU: không có lỗi mới — 1 lỗi sẵn có ở tệp khác");
    expect(p).not.toContain("sửa lỗi kiểu");
    // trạng thái RIÊNG: không được lẫn với lượt kiểu sạch thật
    expect(trangThaiGhi).toEqual(["nen"]);
  });
});
