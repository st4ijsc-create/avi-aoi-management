/**
 * Lượt sửa tsc (một lượt, sau L3c) — khoá thẻ `LƯỢT SỬA TSC`, bốn hàm thuần trong kiemChung.ts, và nhánh gọi trong chayMotViec.
 * Test thuần: driver, tsc và lệnh kiểm đều là bản giả; chỉ dùng git trong thư mục tạm. KHÔNG chạm DB, mạng, mô hình.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, type Driver } from "./chayMotViec";
import { canSuaTsc, caTestGiam, loiNhacSuaTsc, nganSachSuaTsc, type ChayKiem, type KetQuaTsc } from "./kiemChung";
import { docTheViec } from "./theViec";
import { tinhTranLuot } from "./tranLuot";

const tsc = (o: Partial<KetQuaTsc> = {}): KetQuaTsc => ({ exit: 2, hetGio: false, giay: 1, loiTrongTep: ["a.ts(1,1): error TS2322: x"], tongLoi: 1, ...o });
const tranThe = (khoa: Record<string, number>, env: Record<string, string> = {}) => tinhTranLuot(khoa, env);

describe("khoá thẻ LƯỢT SỬA TSC", () => {
  const goc = "MÃ: TC-90\nMỤC TIÊU: thử\nTỆP ĐƯỢC PHÉP SỬA/TẠO: a.test.ts\nLỆNH KIỂM: npx vitest run a.test.ts";
  it("'1' ⇒ suaTsc true; vắng hoặc '0' ⇒ KHÔNG có thuộc tính suaTsc (đối tượng thẻ y như trước)", () => {
    const co = docTheViec(`${goc}\nLƯỢT SỬA TSC: 1`);
    expect(co.ok && co.the.suaTsc).toBe(true);
    for (const van of [goc, `${goc}\nLƯỢT SỬA TSC: 0`]) {
      const r = docTheViec(van);
      expect(r.ok && "suaTsc" in r.the).toBe(false);
    }
  });
  it("giá trị khác 0/1 ⇒ thẻ bị từ chối với lý do nêu khoá", () => {
    for (const v of ["2", "có", "true", ""]) {
      const r = docTheViec(`${goc}\nLƯỢT SỬA TSC: ${v}`);
      expect(r).toEqual({ ok: false, loi: "LƯỢT SỬA TSC phải là 1 hoặc 0" });
    }
  });
});

describe("canSuaTsc", () => {
  it("chỉ true khi thẻ xin VÀ tsc đỏ thật trong tệp model đổi", () => {
    expect(canSuaTsc(true, tsc())).toBe(true);
    expect(canSuaTsc(undefined, tsc())).toBe(false);
    expect(canSuaTsc(false, tsc())).toBe(false);
    expect(canSuaTsc(true, null)).toBe(false);
    expect(canSuaTsc(true, tsc({ hetGio: true }))).toBe(false);
    expect(canSuaTsc(true, tsc({ loi: "không khởi chạy" }))).toBe(false);
    expect(canSuaTsc(true, tsc({ exit: 2, loiTrongTep: [], tongLoi: 5 }))).toBe(false);
  });
});

describe("nganSachSuaTsc — phần CÒN LẠI của trần thẻ, không cộng thêm", () => {
  const t = tranThe({ luotModel: 20, phut: 20 });
  it("thẻ 20 lượt/20 phút, đã dùng 7 lượt và 53 s ⇒ còn 13 lượt, 1147 s", () => {
    expect(nganSachSuaTsc(t, 1200, 7, 53)).toEqual({ gioiHan: { soLuotToiDa: 13, msToiDa: 1_147_000 }, hanGiay: 1147 });
  });
  it("biên: còn đúng 2 lượt ⇒ cho; còn 1 ⇒ không", () => {
    expect(nganSachSuaTsc(t, 1200, 18, 0)?.gioiHan.soLuotToiDa).toBe(2);
    expect(nganSachSuaTsc(t, 1200, 19, 0)).toBeNull();
    expect(nganSachSuaTsc(t, 1200, 25, 0)).toBeNull();
  });
  it("biên thời gian: còn đúng 30 s ⇒ cho; còn 29 s ⇒ không", () => {
    expect(nganSachSuaTsc(t, 1200, 7, 1170)?.hanGiay).toBe(30);
    expect(nganSachSuaTsc(t, 1200, 7, 1171)).toBeNull();
  });
  it("env hạ trần: thẻ 20 mà AI_AGENT_SO_LUOT_TOI_DA=10 ⇒ trần thực 10, đã dùng 7 ⇒ còn 3", () => {
    expect(nganSachSuaTsc(tranThe({ luotModel: 20, phut: 20 }, { AI_AGENT_SO_LUOT_TOI_DA: "10" }), 1200, 7, 0)?.gioiHan.soLuotToiDa).toBe(3);
  });
  it("không cho khi: không có thẻ trần; thẻ chỉ TRẦN PHÚT; có TRẦN TOKEN RA; không biết số lượt đã dùng", () => {
    expect(nganSachSuaTsc(null, 1200, 7, 0)).toBeNull();
    expect(nganSachSuaTsc(tranThe({ phut: 20 }), 1200, 7, 0)).toBeNull();
    expect(nganSachSuaTsc(tranThe({ luotModel: 20, tokenRa: 5000 }), 1200, 7, 0)).toBeNull();
    expect(nganSachSuaTsc(t, 1200, null, 0)).toBeNull();
  });
});

describe("loiNhacSuaTsc — chỉ câu dặn + đường tệp + lỗi nguyên văn của tệp được phép", () => {
  const loiA = "client/src/lib/a.test.ts(156,32): error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'.";
  const loiNgoai = "server/utils/khac.ts(9,1): error TS2322: bí mật của tệp khác";
  it("★ đúng từng dòng; lỗi của tệp ngoài tepOk bị LỌC BỎ; không thêm chữ gợi ý nào", () => {
    const s = loiNhacSuaTsc("TC-90", ["client/src/lib/a.test.ts"], ["client/src/lib/a.test.ts"], "npx vitest run client/src/lib/a.test.ts", [loiA, loiNgoai]);
    expect(s).toBe(
      ["MÃ: TC-90", "TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts", "LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts", "Sửa lỗi kiểu, đừng đổi hành vi hay kỳ vọng.", loiA].join("\n"),
    );
    expect(s).not.toContain("khac.ts");
    expect(s).not.toContain("bí mật");
  });
  it("tepOk viết kiểu Windows vẫn khớp dòng lỗi dùng dấu '/'", () => {
    expect(loiNhacSuaTsc("T", ["a.ts"], ["client\\src\\lib\\a.test.ts"], "l", [loiA])).toContain(loiA);
  });
  it("tên tệp chỉ GIỐNG tiền tố không khớp (a.test.ts vs a.test.tsx) và không còn dòng nào ⇒ null", () => {
    expect(loiNhacSuaTsc("T", ["a.test.ts"], ["client/src/lib/a.test.ts"], "l", ["client/src/lib/a.test.tsx(1,1): error TS1: x"])).toBeNull();
    expect(loiNhacSuaTsc("T", ["a.ts"], ["a.ts"], "l", [])).toBeNull();
  });
});

describe("caTestGiam — chốt chống 'sửa kiểu bằng cách bỏ ca'", () => {
  const a = { duong: "a.test.ts", soCa: 5 };
  it("không đổi, thêm ca, thêm tệp mới ⇒ rỗng", () => {
    expect(caTestGiam([a], [a])).toEqual([]);
    expect(caTestGiam([a], [{ ...a, soCa: 9 }])).toEqual([]);
    expect(caTestGiam([a], [a, { duong: "b.test.ts", soCa: 1 }])).toEqual([]);
  });
  it("mất 1 ca ⇒ nêu 5→4; tệp biến mất ⇒ 5→0; chỉ nêu tệp giảm", () => {
    const b = { duong: "b.test.ts", soCa: 2 };
    expect(caTestGiam([a, b], [{ ...a, soCa: 4 }, b])).toEqual(["a.test.ts: 5→4"]);
    expect(caTestGiam([a, b], [b])).toEqual(["a.test.ts: 5→0"]);
  });
});

// ── nhánh gọi trong chayMotViec (driver / tsc / lệnh kiểm giả) ─────────────────────────────────────
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const TEP = "client/src/lib/a.test.ts";
const BAI = `import { it } from "vitest";\nit("a", () => {});\nit("b", () => {});\n`;
const BAI_SUA = `import { it } from "vitest";\nit("a", () => {});\nit("b", () => {}); // đã sửa kiểu\n`;
const LOI_A = `${TEP}(3,5): error TS2345: sai kieu`;
const LOI_NGOAI = "client/src/lib/khac.ts(1,1): error TS2322: ngoai";
const the = (them = "") => `MÃ: TC-90\nMỤC TIÊU: thử lượt sửa tsc\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\nGIỚI HẠN: 15 phút, 8 vòng${them}`;
const CO = "\nLƯỢT SỬA TSC: 1\nTRẦN LƯỢT MODEL: 20\nTRẦN PHÚT: 20";

let goc: string;
let wt: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tst-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
  ra = path.join(goc, "ra");
  fs.mkdirSync(wt, { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, "README.md"), "x\n");
  fs.writeFileSync(path.join(wt, "tsconfig.tests.json"), "{}\n");
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

type Goi = { lenh: string; hanGiay: number; gioiHanLuot?: unknown };
/** Lượt 1 ghi BAI và báo `soLuot` lượt model đã dùng; lượt 2 (nếu có) chạy `sua`. */
const lamDriver = (soLuot: number, sua?: () => void) => {
  const goi: Goi[] = [];
  const drv: Driver = async (v) => {
    goi.push({ lenh: v.lenh, hanGiay: v.hanGiay, gioiHanLuot: v.gioiHanLuot });
    if (goi.length === 1) {
      fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(wt, TEP), BAI);
    } else sua?.();
    return { ghiChu: [], vong: 1, token: { cache: null, prompt: null, soLuotModel: goi.length === 1 ? soLuot : 3 }, hetGio: false } as never;
  };
  return { drv, goi };
};
const kiemXanh = { exit: 0, hetGio: false, giay: 1, duoi: "", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } } };
const lamKiem = () => {
  let n = 0;
  const f: ChayKiem = async (lenh) => ({ lenh, ...kiemXanh });
  return { f: (async (...a: Parameters<ChayKiem>) => (n++, f(...a))) as ChayKiem, dem: () => n };
};
/** tsc giả: lần gọi thứ k trả `kq[min(k, cuoi)]`. */
const lamTsc = (...kq: KetQuaTsc[]) => {
  let n = 0;
  return { f: async () => kq[Math.min(n++, kq.length - 1)]!, dem: () => n };
};
const DO = tsc({ loiTrongTep: [LOI_A, LOI_NGOAI], tongLoi: 2 });
const XANH = tsc({ exit: 0, loiTrongTep: [], tongLoi: 0 });
const chay = (van: string, drv: Driver, kiem: ChayKiem, t: () => Promise<KetQuaTsc>) =>
  chayMotViec({ van, wt, base: "HEAD", driver: drv, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: kiem, chayTsc: t, envTran: {} as NodeJS.ProcessEnv });

describe("chayMotViec — lượt sửa tsc", () => {
  it("★ tsc đỏ rồi xanh sau lượt sửa ⇒ xong; lời nhắc đúng từng byte, chỉ lỗi của tệp được phép; ngân sách = phần còn lại; hai kết cục trước/sau", async () => {
    const { drv, goi } = lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), BAI_SUA));
    const k = lamKiem();
    const t = lamTsc(DO, XANH);
    const r = await chay(the(CO), drv, k.f, t.f);
    expect(goi).toHaveLength(2);
    expect(goi[1]!.lenh).toBe(
      ["MÃ: TC-90", `TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}`, `LỆNH KIỂM: npx vitest run ${TEP}`, "Sửa lỗi kiểu, đừng đổi hành vi hay kỳ vọng.", LOI_A].join("\n"),
    );
    const gh = goi[1]!.gioiHanLuot as { soLuotToiDa: number; msToiDa: number };
    expect(gh.soLuotToiDa).toBe(13);
    expect(gh.msToiDa).toBeLessThanOrEqual(1_200_000);
    expect(gh.msToiDa).toBeGreaterThan(1_100_000);
    expect(goi[1]!.hanGiay).toBe(gh.msToiDa / 1000);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.truocSuaTsc).toMatchObject({ ketCuc: "kiem-do" });
    expect(r.sauSuaTsc).toEqual({ ketCuc: "xong", lyDo: null });
    expect(r.luotSua).toMatchObject({ soLuotModel: 3, viPham: 0, crlf: 0 });
    expect(r.luotSua).not.toHaveProperty("giamCa");
    expect(k.dem()).toBe(2); // lệnh kiểm chạy lại sau lượt sửa
    expect(t.dem()).toBe(2); // tsc chạy lại sau lượt sửa
    expect(fs.readFileSync(path.join(wt, TEP), "utf8")).toBe(BAI_SUA);
    expect(fs.readFileSync(r.diff!, "utf8")).toContain("đã sửa kiểu"); // diff thu lại SAU lượt sửa
  });

  it("★ lượt sửa làm GIẢM ca test (bỏ một it) ⇒ kiem-do, nêu 2→1, KHÔNG chạy lại tsc/lệnh kiểm", async () => {
    const { drv } = lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), `import { it } from "vitest";\nit("a", () => {});\n`));
    const k = lamKiem();
    const t = lamTsc(DO, XANH);
    const r = await chay(the(CO), drv, k.f, t.f);
    expect(r).toMatchObject({ ok: false, ketCuc: "kiem-do", coLuotSua: true });
    expect(r.luotSua).toMatchObject({ giamCa: [`${TEP}: 2→1`] });
    expect(r.sauSuaTsc).toMatchObject({ ketCuc: "kiem-do", lyDo: `sửa tsc làm GIẢM ca test: ${TEP}: 2→1` });
    expect(k.dem()).toBe(1);
    expect(t.dem()).toBe(1);
  });

  it("★ lượt sửa chạm tệp NGOÀI danh sách được phép ⇒ vi-pham, ghi lý do riêng", async () => {
    const { drv } = lamDriver(7, () => fs.writeFileSync(path.join(wt, "client/src/lib/khac.ts"), "export const x = 1;\n"));
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.sauSuaTsc?.lyDo).toMatch(/^sửa tsc: 1 vi phạm diff, 0 tệp CRLF/);
    expect(r.luotSua).toMatchObject({ viPham: 1 });
  });

  it("tsc VẪN đỏ sau lượt sửa ⇒ kiem-do (TRƯỢT); driver đúng 2 lần, không có lượt thứ ba", async () => {
    const { drv, goi } = lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), BAI_SUA));
    const t = lamTsc(DO, DO);
    const r = await chay(the(CO), drv, lamKiem().f, t.f);
    expect(goi).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, ketCuc: "kiem-do", coLuotSua: true });
    expect(r.truocSuaTsc?.ketCuc).toBe("kiem-do");
    expect(r.sauSuaTsc?.ketCuc).toBe("kiem-do");
  });

  it("lượt sửa lỗi/hết giờ ⇒ kiem-do với lý do 'lượt sửa …', không chạy lại tsc", async () => {
    let n = 0;
    const drv: Driver = async () => {
      if (n++ === 0) {
        fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
        fs.writeFileSync(path.join(wt, TEP), BAI);
        return { ghiChu: [], vong: 1, token: { cache: null, prompt: null, soLuotModel: 7 }, hetGio: false } as never;
      }
      return { ghiChu: [], vong: 0, token: null, hetGio: true } as never;
    };
    const t = lamTsc(DO, XANH);
    const r = await chay(the(CO), drv, lamKiem().f, t.f);
    expect(r).toMatchObject({ ketCuc: "kiem-do", luotSua: { hong: "lượt sửa hết giờ" } });
    expect(t.dem()).toBe(1);
  });

  it("★★★ thẻ KHÔNG có khoá + tsc đỏ ⇒ driver đúng 1 lần, kiem-do như cũ, JSON KHÔNG có coLuotSua / truocSuaTsc / sauSuaTsc / luotSua", async () => {
    const { drv, goi } = lamDriver(7);
    const r = await chay(the("\nTRẦN LƯỢT MODEL: 20\nTRẦN PHÚT: 20"), drv, lamKiem().f, lamTsc(DO).f);
    expect(goi).toHaveLength(1);
    expect(r.ketCuc).toBe("kiem-do");
    for (const k of ["coLuotSua", "truocSuaTsc", "sauSuaTsc", "luotSua"]) expect(k in r).toBe(false);
  });

  it("thẻ có khoá, tsc xanh ngay ⇒ không có lượt sửa: coLuotSua false, trước = sau = xong", async () => {
    const { drv, goi } = lamDriver(7);
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(XANH).f);
    expect(goi).toHaveLength(1);
    expect(r).toMatchObject({ ok: true, coLuotSua: false, truocSuaTsc: { ketCuc: "xong" }, sauSuaTsc: { ketCuc: "xong" } });
    expect("luotSua" in r).toBe(false);
  });

  it("thẻ có khoá nhưng THIẾU TRẦN LƯỢT MODEL ⇒ không lượt sửa (không có phần 'còn lại' để tính); luuY nói rõ", async () => {
    const { drv, goi } = lamDriver(7);
    const r = await chay(the("\nLƯỢT SỬA TSC: 1"), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(goi).toHaveLength(1);
    expect(r).toMatchObject({ ketCuc: "kiem-do", coLuotSua: false });
    expect(r.luuY?.join("\n")).toContain("LƯỢT SỬA TSC: không áp");
  });

  it("đã dùng 19/20 lượt ⇒ còn 1 < 2 ⇒ không lượt sửa; trần không được nới", async () => {
    const { drv, goi } = lamDriver(19);
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(goi).toHaveLength(1);
    expect(r).toMatchObject({ ketCuc: "kiem-do", coLuotSua: false });
  });
});
