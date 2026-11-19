/**
 * Lượt sửa tsc (một lượt, sau L3c) — khoá thẻ `LƯỢT SỬA TSC`, bốn hàm thuần trong kiemChung.ts, và nhánh gọi trong chayMotViec.
 * Test thuần: driver, tsc và lệnh kiểm đều là bản giả; chỉ dùng git trong thư mục tạm. KHÔNG chạm DB, mạng, mô hình.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, type Driver } from "./chayMotViec";
import type { MayDem } from "./hauQua";
import { canSuaTsc, caTestGiam, loiNhacSuaTsc, nganSachSuaTsc, soDemGiam, type ChayKiem, type KetQuaTsc } from "./kiemChung";
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
      expect(r.ok).toBe(true); // '0' là giá trị HỢP LỆ (không bị từ chối), chỉ không bật
      expect(r.ok && "suaTsc" in r.the).toBe(false);
    }
  });
  it("giá trị '1' có khoảng trắng đuôi hoặc dòng trống cuối thẻ vẫn được nhận", () => {
    for (const van of [`${goc}\nLƯỢT SỬA TSC: 1   `, `${goc}\nLƯỢT SỬA TSC: 1\n`, `${goc}\nLƯỢT SỬA TSC:   1  \n\n`]) {
      const r = docTheViec(van);
      expect(r.ok && r.the.suaTsc).toBe(true);
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
  it("giây model có phần lẻ ⇒ hạn làm tròn XUỐNG (không vượt phần còn lại): 1200 − 53,4 = 1146,6 ⇒ 1146", () => {
    expect(nganSachSuaTsc(t, 1200, 7, 53.4)).toEqual({ gioiHan: { soLuotToiDa: 13, msToiDa: 1_146_000 }, hanGiay: 1146 });
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

describe("soDemGiam — số `.each(` và `expect(` không được giảm (it.each đếm 1 cho cả bảng nên caTestGiam không thấy)", () => {
  const goc = 'it.each([1, 2, 3])("n %i", (n) => {\n  expect(n).toBeGreaterThan(0);\n});\nit("b", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n';
  it("không đổi, hoặc tăng cả hai ⇒ rỗng", () => {
    expect(soDemGiam(goc, goc)).toEqual([]);
    expect(soDemGiam(goc, `${goc}it.each([4])("m", () => { expect(4).toBe(4); });\n`)).toEqual([]);
  });
  it("mất `.each(` (3 expect, 1 each) ⇒ nêu tên số và trước→sau", () => {
    expect(soDemGiam(goc, goc.replace("it.each([1, 2, 3])", "it.skip.foo([1, 2, 3])"))).toEqual(["số lần `.each(`: 1→0"]);
  });
  it("mất một `expect(` ⇒ nêu số expect 3→2; mất cả hai ⇒ `.each(` đứng trước", () => {
    expect(soDemGiam(goc, goc.replace("  expect(2).toBe(2);\n", ""))).toEqual(["số lần `expect(`: 3→2"]);
    expect(soDemGiam(goc, "")).toEqual(["số lần `.each(`: 1→0", "số lần `expect(`: 3→0"]);
  });
  it("biên từ: `myexpect(`, `expect.soft(`, `expectation(` KHÔNG tính là `expect(`; `test.each(` và `describe.each(` tính là `.each(`", () => {
    expect(soDemGiam("myexpect(1); expect.soft(2); expectation(3);\n", "")).toEqual([]);
    expect(soDemGiam('test.each([1])("a", () => {});\ndescribe.each([1])("b", () => {});\n', "")).toEqual(["số lần `.each(`: 2→0"]);
  });
  it("thêm ép kiểu / đổi chỗ expect, số lượng giữ nguyên ⇒ rỗng (sửa kiểu hợp lệ không bị chặn)", () => {
    expect(soDemGiam(goc, goc.replace("expect(1)", "expect(1 as number)").replace("(n) =>", "(n: number) =>"))).toEqual([]);
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
const DANH_DAU = "LƯỢT SỬA TSC bị chặn trước khi chạy lại: `kiem` và `tsc` trong JSON là kết quả TRƯỚC lượt sửa (tepDoi, dong, diff, viPham là của SAU lượt sửa)";
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
const lamDriver = (soLuot: number, sua?: () => void, them: { ketQua1?: Record<string, unknown>; tienGiay?: number; bai?: string } = {}) => {
  const goi: Goi[] = [];
  const drv: Driver = async (v) => {
    goi.push({ lenh: v.lenh, hanGiay: v.hanGiay, gioiHanLuot: v.gioiHanLuot });
    if (goi.length === 1) {
      fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(wt, TEP), them.bai ?? BAI);
      if (them.tienGiay) vi.setSystemTime(Date.now() + them.tienGiay * 1000); // đồng hồ tiêm vào (chỉ Date), không đổi mã sản xuất
    } else sua?.();
    return { ghiChu: [], vong: 1, token: { cache: null, prompt: null, soLuotModel: goi.length === 1 ? soLuot : 3 }, hetGio: false, ...(goi.length === 1 ? them.ketQua1 : {}) } as never;
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
    expect(r.luotSua).toMatchObject({ soLuotModel: 3, viPham: 0, crlf: 0, dongSua: { them: 1, xoa: 1 } }); // riêng lượt sửa: đúng 1 dòng it("b") đổi, không lẫn 3 dòng của lượt đầu
    expect(r.luotSua).not.toHaveProperty("giamCa");
    expect(r.luuY).not.toContain(DANH_DAU); // lượt sửa chạy đủ ⇒ kiem/tsc là kết quả SAU, không đánh dấu
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
    expect(r.luuY).toContain(DANH_DAU);
  });

  it("★ lượt sửa chạm tệp NGOÀI danh sách được phép ⇒ vi-pham, ghi lý do riêng", async () => {
    const { drv } = lamDriver(7, () => fs.writeFileSync(path.join(wt, "client/src/lib/khac.ts"), "export const x = 1;\n"));
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.sauSuaTsc?.lyDo).toMatch(/^sửa tsc: 1 vi phạm diff, 0 tệp CRLF/);
    expect(r.luotSua).toMatchObject({ viPham: 1 });
    expect(r.luuY).toContain(DANH_DAU);
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
    expect(r.luuY).toContain(DANH_DAU);
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

  it("driver lượt đầu KHÔNG báo số lượt model (token null, hoặc thiếu soLuotModel) ⇒ không biết đã dùng bao nhiêu ⇒ không lượt sửa (không đoán là 0)", async () => {
    for (const token of [null, { cache: null, prompt: null }]) {
      const { drv, goi } = lamDriver(7, undefined, { ketQua1: { token } });
      const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
      expect(goi).toHaveLength(1);
      expect(r).toMatchObject({ ketCuc: "kiem-do", coLuotSua: false });
      expect(r.luuY?.join("\n")).toContain("LƯỢT SỬA TSC: không áp");
      fs.rmSync(path.join(wt, TEP), { force: true }); // lần lặp sau bắt đầu từ cây sạch
      git(wt, "reset", "-q");
      git(wt, "checkout", "-q", "--", ".");
    }
  });

  it("tsc đỏ nhưng KHÔNG dòng lỗi nào thuộc tệp đổi và được phép ⇒ không có lời nhắc ⇒ không gọi driver lần hai", async () => {
    const { drv, goi } = lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), BAI_SUA));
    const loiLa = tsc({ loiTrongTep: [`${TEP}x(3,5): error TS2345: tiền tố giống nhưng là tệp khác`], tongLoi: 1 });
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(loiLa, XANH).f);
    expect(goi).toHaveLength(1);
    expect(r).toMatchObject({ ketCuc: "kiem-do", coLuotSua: false });
    expect(r.luuY?.join("\n")).toContain("LƯỢT SỬA TSC: không áp");
  });

  it("lượt sửa ghi tệp được phép nhưng đổi sang CRLF ⇒ vi-pham, lý do nêu số tệp CRLF", async () => {
    const { drv } = lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), BAI_SUA.replace(/\n/g, "\r\n")));
    const t = lamTsc(DO, XANH);
    const r = await chay(the(CO), drv, lamKiem().f, t.f);
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.sauSuaTsc?.lyDo).toBe("sửa tsc: 0 vi phạm diff, 1 tệp CRLF sau lượt sửa");
    expect(r.luotSua).toMatchObject({ viPham: 0, crlf: 1 });
    expect(t.dem()).toBe(1);
  });

  it("driver lượt sửa trả `loi` (không phải hết giờ) ⇒ kiem-do, hong 'lượt sửa lỗi: …', không chạy lại tsc", async () => {
    let n = 0;
    const drv: Driver = async () => {
      if (n++ === 0) {
        fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
        fs.writeFileSync(path.join(wt, TEP), BAI);
        return { ghiChu: [], vong: 1, token: { cache: null, prompt: null, soLuotModel: 7 }, hetGio: false } as never;
      }
      return { ghiChu: [], vong: 0, token: null, hetGio: false, loi: "mất kết nối model" } as never;
    };
    const t = lamTsc(DO, XANH);
    const r = await chay(the(CO), drv, lamKiem().f, t.f);
    expect(r).toMatchObject({ ketCuc: "kiem-do", luotSua: { hong: "lượt sửa lỗi: mất kết nối model" } });
    expect(r.sauSuaTsc?.lyDo).toBe("lượt sửa lỗi: mất kết nối model");
    expect(t.dem()).toBe(1);
  });
});

describe("chayMotViec — lượt sửa tsc: chốt thứ hai (số `.each(` và `expect(` không giảm)", () => {
  const BAI_EACH = `import { it } from "vitest";\nit.each([1, 2])("n %i", (n) => {\n  expect(n).toBeGreaterThan(0);\n});\nit("b", () => {\n  expect(1).toBe(1);\n});\n`;
  const lam = (sua: string) => lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), sua), { bai: BAI_EACH });

  it("★ lượt sửa đổi `it.each(` thành `it(` (số ca it( không đổi 2→2, expect không đổi) ⇒ kiem-do, lý do nêu `.each(` 1→0; không chạy lại tsc", async () => {
    const { drv } = lam(BAI_EACH.replace("it.each([1, 2])(", "it("));
    const t = lamTsc(DO, XANH);
    const r = await chay(the(CO), drv, lamKiem().f, t.f);
    expect(r).toMatchObject({ ok: false, ketCuc: "kiem-do" });
    expect(r.sauSuaTsc?.lyDo).toBe("sửa tsc làm GIẢM ca test: số lần `.each(`: 1→0");
    expect(r.luotSua).toMatchObject({ giamCa: ["số lần `.each(`: 1→0"] });
    expect(t.dem()).toBe(1);
  });

  it("★ lượt sửa XOÁ một dòng `expect(` (số ca it( không đổi) ⇒ kiem-do, lý do nêu `expect(` 2→1", async () => {
    const { drv } = lam(BAI_EACH.replace("  expect(1).toBe(1);\n", ""));
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: false, ketCuc: "kiem-do" });
    expect(r.sauSuaTsc?.lyDo).toBe("sửa tsc làm GIẢM ca test: số lần `expect(`: 2→1");
  });

  it("★ sửa kiểu HỢP LỆ (thêm ép kiểu, số `.each(` và `expect(` giữ nguyên) KHÔNG bị chặn ⇒ xong; dongSua phản ánh đúng 2 dòng đổi", async () => {
    const { drv } = lam(BAI_EACH.replace("(n) =>", "(n: number) =>").replace("expect(1)", "expect(1 as number)"));
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true, luotSua: { dongSua: { them: 2, xoa: 2 } } });
  });
});

describe("chayMotViec — lượt sửa tsc: thời gian chờ NGƯỜI duyệt không ăn vào trần (đồng hồ Date tiêm bằng fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T03:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("★ tổng 1180 s trong đó chờ duyệt 1100 s ⇒ thời gian MODEL 80 s ⇒ còn 1120 s: lượt sửa CÓ chạy, driver nhận hanGiay 1120 (không phải hạn đầy đủ 1200)", async () => {
    const { drv, goi } = lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), BAI_SUA), { tienGiay: 1180, ketQua1: { duyet: { soLanCho: 3, soChapNhan: 3, soTuChoi: 0, giayChoDuyet: 1100 } } });
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(goi).toHaveLength(2);
    expect(goi[1]!.hanGiay).toBe(1120);
    expect(goi[1]!.gioiHanLuot).toEqual({ soLuotToiDa: 13, msToiDa: 1_120_000 });
    expect(r).toMatchObject({ ok: true, coLuotSua: true, giayTuong: 1180, giayKhongChoNguoi: 80 });
  });

  it("đối chứng: cùng 1180 s nhưng KHÔNG có thời gian chờ duyệt ⇒ model đã dùng 1180 s, còn 20 s < 30 ⇒ không lượt sửa", async () => {
    const { drv, goi } = lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), BAI_SUA), { tienGiay: 1180 });
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(goi).toHaveLength(1);
    expect(r).toMatchObject({ ketCuc: "kiem-do", coLuotSua: false, giayTuong: 1180 });
  });
});

describe("chayMotViec — lượt sửa tsc + KIỂM PHỦ: lượt sửa mang `phu`, số nhắc ghi riêng (HST duyệt 19/11 13:14)", () => {
  // HST 19/11 13:14: lượt sửa gọi driver bằng CÙNG `goiDriver` nên mang tuỳ chọn `phu` như lượt đầu; `phu.soLanNhac` giữ nghĩa "lượt 1";
  // số nhắc của lượt sửa ghi riêng ở `luotSua.soLanNhacPhu`, cờ `luotSua.biNhacPhu` (lượt sửa có bị nhắc về phủ hay không).
  const BAI_PHU = `import { it, expect } from "vitest";\nconst f = (x: number) => x;\nit("[D1] một", () => { expect(f(1)).toBe(1); });\nit("[D2] hai", () => { expect(f(2)).toBe(2); });\n`;
  const BAI_PHU_SUA = BAI_PHU.replace("(x: number) => x", "(x: number): number => x");
  const VAN_PHU = `MÃ: TC-90\nQUY TRÌNH: Làm ngay.\nĐÃ DUYỆT:\n1. Ca một.\n2. Ca hai.\nKIỂM PHỦ: CÓ\nMỤC TIÊU: thử phủ ở lượt sửa\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\nGIỚI HẠN: 15 phút, 8 vòng${CO}`;

  /** driver ghi lại `phu` của từng lời gọi; lượt 1 ghi BAI_PHU và báo `nhacPhu[0]` lần nhắc phủ, lượt 2 sửa kiểu và báo `nhacPhu[1]` */
  const lamDriverPhu = (nhacPhu: [number, number]) => {
    const phuCuaLoiGoi: unknown[] = [];
    const drv: Driver = async (v) => {
      const lan = phuCuaLoiGoi.push(v.phu);
      fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(wt, TEP), lan === 1 ? BAI_PHU : BAI_PHU_SUA);
      return { ghiChu: [], vong: 1, token: { cache: null, prompt: null, soLuotModel: lan === 1 ? 7 : 3 }, hetGio: false, soLanNhacPhu: nhacPhu[lan - 1] } as never;
    };
    return { drv, phuCuaLoiGoi };
  };
  /** lệnh kiểm giả: lệnh thường ⇒ xanh; lệnh có --outputFile ⇒ ghi JSON vitest "mọi ca passed" cho hai ca [D1] [D2] */
  const kiemPhuGia: ChayKiem = async (lenh) => {
    const m = /--outputFile="([^"]+)"/.exec(lenh);
    if (m) fs.writeFileSync(m[1]!, JSON.stringify({ testResults: [{ assertionResults: [{ title: "[D1] một", status: "passed" }, { title: "[D2] hai", status: "passed" }] }] }));
    return { lenh, ...kiemXanh };
  };

  it("lượt sửa CÓ mang `phu`, giống lượt đầu: hai lời gọi driver, cả hai có phu = {2 dòng ĐÃ DUYỆT k=1,2 không GIỮ, tenCaCu rỗng, tepTest=[TEP]}", async () => {
    const { drv, phuCuaLoiGoi } = lamDriverPhu([3, 5]);
    const r = await chay(VAN_PHU, drv, kiemPhuGia, lamTsc(DO, XANH).f);
    expect(phuCuaLoiGoi).toHaveLength(2);
    expect(phuCuaLoiGoi[0]).toEqual({ dongDuyet: [{ k: 1, giu: false, noiDung: "Ca một." }, { k: 2, giu: false, noiDung: "Ca hai." }], tenCaCu: new Set(), tepTest: [TEP] });
    expect(phuCuaLoiGoi[1]).toEqual(phuCuaLoiGoi[0]);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
  });

  it("`phu.soLanNhac` = số nhắc của LƯỢT ĐẦU (3); số nhắc của lượt sửa (5) không được cộng vào đó mà ghi riêng ở luotSua.soLanNhacPhu", async () => {
    const { drv } = lamDriverPhu([3, 5]);
    const r = await chay(VAN_PHU, drv, kiemPhuGia, lamTsc(DO, XANH).f);
    expect(r.phu).toMatchObject({ dongThieu: [], dongDaPhu: [1, 2], xacNhanPassed: true });
    expect(r.phu!.soLanNhac).toBe(3);
    expect((r as { luotSua?: unknown }).luotSua).toMatchObject({ soLanNhacPhu: 5, biNhacPhu: true });
  });

  it("lượt sửa bị nhắc 1 lần ⇒ luotSua.soLanNhacPhu = 1, biNhacPhu = true; phu.soLanNhac vẫn là số của lượt đầu (3)", async () => {
    const { drv } = lamDriverPhu([3, 1]);
    const r = await chay(VAN_PHU, drv, kiemPhuGia, lamTsc(DO, XANH).f);
    expect((r as { luotSua?: unknown }).luotSua).toMatchObject({ soLanNhacPhu: 1, biNhacPhu: true });
    expect(r.phu!.soLanNhac).toBe(3);
  });

  it("lượt sửa KHÔNG bị nhắc (0) ⇒ biNhacPhu = false, soLanNhacPhu = 0 (dongSua của lượt đó là sửa kiểu thuần)", async () => {
    const { drv } = lamDriverPhu([3, 0]);
    const r = await chay(VAN_PHU, drv, kiemPhuGia, lamTsc(DO, XANH).f);
    expect((r as { luotSua?: unknown }).luotSua).toMatchObject({ soLanNhacPhu: 0, biNhacPhu: false });
    expect(r.phu!.soLanNhac).toBe(3);
  });

  it("★★ driver KHÔNG báo soLanNhacPhu (như driverKho / driverCli) ⇒ luotSua.soLanNhacPhu === 0 (số, không undefined), biNhacPhu === false; phu.soLanNhac cũng 0", async () => {
    const phuCuaLoiGoi: unknown[] = [];
    const drv: Driver = async (v) => {
      const lan = phuCuaLoiGoi.push(v.phu);
      fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(wt, TEP), lan === 1 ? BAI_PHU : BAI_PHU_SUA);
      return { ghiChu: [], vong: 1, token: { cache: null, prompt: null, soLuotModel: lan === 1 ? 7 : 3 }, hetGio: false } as never; // KHÔNG có khoá soLanNhacPhu
    };
    const r = await chay(VAN_PHU, drv, kiemPhuGia, lamTsc(DO, XANH).f);
    expect(phuCuaLoiGoi).toHaveLength(2);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.luotSua).toHaveProperty("soLanNhacPhu", 0);
    expect(r.luotSua).toHaveProperty("biNhacPhu", false);
    expect(r.phu!.soLanNhac).toBe(0);
  });
});

describe("chayMotViec — lượt sửa tsc THÀNH CÔNG (trước đỏ, sau xong): các bước sau vẫn chạy (HA-6b hậu quả, L3b đột biến)", () => {
  // Luật: chayMotViec.ts:898 và :910 chỉ chạy khi kết cục HIỆN TẠI `qd` là "xong". Sau lượt sửa thành công qd = "xong" (:885) dù
  // `truocSua` là "kiem-do": các bước sau phải đọc `qd`, không đọc kết cục TRƯỚC lượt sửa. Mọi thứ dưới đây là giả: driver, lệnh kiểm, tsc, bộ đếm.
  const DAU = "MATKHAU_GIA_456";
  const URL_GIA = `postgresql://tho_ca_test:${DAU}@127.0.0.1:5434/aoi_management_test`;
  const THE_SUA = (them: string) => `MÃ: TC-90
MỤC TIÊU: thử bước sau lượt sửa
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
${them}LỆNH KIỂM: npx vitest run ${TEP}
GIỚI HẠN: 15 phút, 8 vòng${CO}`;
  const DRV = () => lamDriver(7, () => fs.writeFileSync(path.join(wt, TEP), BAI_SUA));

  /** bộ đếm giả: lần mở thứ n trả bản đồ `lan[n]` (nhãn bảng → số) */
  const moGia = (lan: Array<Record<string, number>>) => {
    const nk = { mo: 0, dong: 0 };
    const moMayDem = async () => {
      const n = nk.mo++;
      const may: MayDem = { kiemDinhDanh: async () => null, dem: async (m) => lan[n]![m.bang] ?? 0 };
      return { may, dong: async () => void nk.dong++ };
    };
    return { nk, moMayDem };
  };
  const chayDb = (van: string, drv: Driver, moMayDem: Parameters<typeof chayMotViec>[0]["moMayDem"]) =>
    chayMotViec({ van, wt, base: "HEAD", driver: drv, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: lamKiem().f, chayTsc: lamTsc(DO, XANH).f, envTran: {} as NodeJS.ProcessEnv, choPhepDb: true, testDbUrl: URL_GIA, moMayDem });
  const VAN_DB = THE_SUA("CSDL: chạm aoi_management_test (CHỈ CSDL _test)\nBẢNG ĐẾM:\nmachines\n");

  it("★★★ HA-6b sau lượt sửa thành công: hàng ĐỔI ở mục chấm (machines 10→12) ⇒ hau-qua-xau, ok:false; đếm đúng 2 lần (trước lượt, sau lệnh kiểm cuối)", async () => {
    const g = moGia([{ machines: 10 }, { machines: 12 }]);
    const { drv } = DRV();
    const r = await chayDb(VAN_DB, drv, g.moMayDem);
    expect(r.truocSuaTsc).toMatchObject({ ketCuc: "kiem-do" });
    expect(r.sauSuaTsc).toEqual({ ketCuc: "xong", lyDo: null }); // lượt sửa thành công
    expect(r).toMatchObject({ ok: false, ketCuc: "hau-qua-xau", coLuotSua: true });
    expect(r.hauQua).toMatchObject({ ketCuc: "hau-qua-xau", db: "co" });
    expect(r.hauQua).not.toHaveProperty("ghiKhiDo"); // ghiKhiDo = đếm bổ sung của kết cục đã đỏ (HA-6c), KHÔNG phải kiểm HA-6b
    expect(r.hauQua!.bang).toEqual([{ muc: "machines", ghi: false, truoc: 10, sau: 12, chenh: 2 }]);
    expect(g.nk).toMatchObject({ mo: 2, dong: 2 });
    expect(JSON.stringify(r)).not.toContain(DAU);
  });
  it("đối chứng HA-6b: hàng KHÔNG đổi sau lượt sửa thành công ⇒ xong, hauQua ok (db co) không có ghiKhiDo", async () => {
    const g = moGia([{ machines: 10 }, { machines: 10 }]);
    const { drv } = DRV();
    const r = await chayDb(VAN_DB, drv, g.moMayDem);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true, hauQua: { ketCuc: "ok", db: "co" } });
    expect(r.hauQua).not.toHaveProperty("ghiKhiDo");
    expect(g.nk.mo).toBe(2);
  });

  const NGUON_F = "export const f = (n: number) => (n > 0 ? 1 : 0);\n";
  const DB1 = "ĐỘT BIẾN: client/src/lib/f.ts|n > 0|n >= 0";
  const caiNguon = () => {
    fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
    fs.writeFileSync(path.join(wt, "client/src/lib/f.ts"), NGUON_F);
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "nguon");
  };
  /** lệnh kiểm giả: đỏ khi nguồn f.ts mang dấu `n >= 0` (đột biến đã áp) */
  const kiemTheoNguon: ChayKiem = async (lenh) => {
    const ng = fs.readFileSync(path.join(wt, "client/src/lib/f.ts"), "utf8");
    return ng.includes("n >= 0") ? { lenh, ...kiemXanh, exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 2 } } } : { lenh, ...kiemXanh };
  };
  const kiemXanhChung: ChayKiem = async (lenh) => ({ lenh, ...kiemXanh });
  const chayDotBien = (kiem: ChayKiem, drv: Driver) =>
    chayMotViec({ van: THE_SUA(`${DB1}\n`), wt, base: "HEAD", driver: drv, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: kiem, chayTsc: lamTsc(DO, XANH).f, envTran: {} as NodeJS.ProcessEnv });

  it("★★★ L3b sau lượt sửa thành công: đột biến SỐNG (lệnh kiểm vẫn xanh) ⇒ dot-bien-song, ok:false, dotBien.song 1", async () => {
    caiNguon();
    const { drv } = DRV();
    const r = await chayDotBien(kiemXanhChung, drv);
    expect(r.sauSuaTsc).toEqual({ ketCuc: "xong", lyDo: null });
    expect(r).toMatchObject({ ok: false, ketCuc: "dot-bien-song", coLuotSua: true, dotBien: { tong: 1, song: 1, do: 0, khoiPhucSach: true } });
    expect(fs.readFileSync(path.join(wt, "client/src/lib/f.ts"), "utf8")).toBe(NGUON_F);
  });
  it("★★★ L3b sau lượt sửa thành công: đột biến BỊ BẮT (lệnh kiểm đỏ khi đột biến) ⇒ xong, JSON có dotBien {tong 1, do 1, song 0}; nguồn khôi phục", async () => {
    caiNguon();
    const { drv } = DRV();
    const r = await chayDotBien(kiemTheoNguon, drv);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true, dotBien: { tong: 1, do: 1, song: 0, khoiPhucSach: true, tepLa: [] } });
    expect(fs.readFileSync(path.join(wt, "client/src/lib/f.ts"), "utf8")).toBe(NGUON_F);
  });
});

describe("chayMotViec — lượt sửa tsc: dongSua / tepSua đếm RIÊNG lượt sửa trên MỌI tệp (DONGSUA-0)", () => {
  // Luật (chayMotViec.ts, khối lượt sửa): mốc index = `git add` MỌI tepDoi trước lượt sửa; dongSua = tổng numstat (so index) của tepDoi SAU lượt sửa;
  // tepSua = từng tệp; tệp ngoài RE_TEP_TEST ⇒ một dòng luuY; ketCuc không đổi. Mọi thứ giả: driver, lệnh kiểm, tsc.
  const F = "client/src/lib/f.ts";
  const F_GOC = "export const f = 1;\nexport const g = 2;\nexport const h = 3;\n";
  const F_LUOT1 = F_GOC.replace("f = 1", "f = 10");
  const ghi = (rel: string, s: string) => {
    fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
    fs.writeFileSync(path.join(wt, rel), s);
  };
  const caiF = () => {
    ghi(F, F_GOC);
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "f");
  };
  const theCho = (...them: string[]) => the(CO).replace(`TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}`, `TỆP ĐƯỢC PHÉP SỬA/TẠO: ${[TEP, ...them].join(", ")}`);
  /** driver hai lượt: lượt 1 chạy `l1`, lượt 2 chạy `l2` */
  const lamDriver2 = (l1: () => void, l2: () => void) => {
    let n = 0;
    const drv: Driver = async () => {
      n += 1;
      (n === 1 ? l1 : l2)();
      return { ghiChu: [], vong: 1, token: { cache: null, prompt: null, soLuotModel: n === 1 ? 7 : 3 }, hetGio: false } as never;
    };
    return { drv, dem: () => n };
  };
  const CAU_NGOAI = (cacTep: string) => `LƯỢT SỬA TSC đổi tệp NGOÀI tệp test: ${cacTep} — người duyệt xem diff của lượt sửa; bộ chạy không phán đúng/sai việc đổi này`;
  const luuYGop = (r: { luuY?: string[] }) => (r.luuY ?? []).join("\n");

  it("★★★ lượt sửa đổi tệp test (1 dòng) VÀ tệp nguồn (1 dòng) ⇒ dongSua {2,2}; tepSua hai mục; dòng của LƯỢT ĐẦU ở tệp nguồn (f = 10) KHÔNG tính; luuY nêu tệp nguồn; ketCuc xong", async () => {
    caiF();
    const { drv } = lamDriver2(
      () => { ghi(TEP, BAI); ghi(F, F_LUOT1); },
      () => { ghi(TEP, BAI_SUA); ghi(F, F_LUOT1.replace("g = 2", "g = 20")); },
    );
    const r = await chay(theCho(F), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.luotSua?.dongSua).toEqual({ them: 2, xoa: 2 });
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }, { duong: F, them: 1, xoa: 1 }]);
    expect(r.luuY).toContain(CAU_NGOAI(`${F} (+1/−1)`));
    expect(r.dong).toEqual({ them: 5, xoa: 2 }); // tổng so HEAD sau lượt sửa: a.test.ts mới 3 dòng + f.ts 2 dòng đổi (f, g) ⇒ +5 −2 (ghim u5: so index sẽ ra số khác)
    expect(r.luotSua).not.toHaveProperty("soLanNhacPhu");
  });
  it("★★ lượt sửa CHỈ đổi tệp test ⇒ dongSua {1,1}, tepSua một mục, KHÔNG có câu luuY về tệp ngoài test; r.dong = {3,0} (tổng so HEAD, không co lại về phần lượt sửa)", async () => {
    caiF();
    const { drv } = lamDriver2(() => ghi(TEP, BAI), () => ghi(TEP, BAI_SUA));
    const r = await chay(theCho(F), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.luotSua?.dongSua).toEqual({ them: 1, xoa: 1 });
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }]);
    expect(luuYGop(r)).not.toContain("NGOÀI tệp test");
    expect(r.dong).toEqual({ them: 3, xoa: 0 });
  });
  it("★★ lượt sửa TẠO tệp nguồn mới 2 dòng + đổi tệp test 1 dòng ⇒ dongSua {3,1}; tepSua [test 1/1, g.ts 2/0]; luuY nêu g.ts (+2/−0)", async () => {
    const G = "client/src/lib/g.ts";
    const { drv } = lamDriver2(() => ghi(TEP, BAI), () => { ghi(TEP, BAI_SUA); ghi(G, "export const a = 1;\nexport const b = 2;\n"); });
    const r = await chay(theCho(G), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.luotSua?.dongSua).toEqual({ them: 3, xoa: 1 });
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }, { duong: G, them: 2, xoa: 0 }]);
    expect(r.luuY).toContain(CAU_NGOAI(`${G} (+2/−0)`));
  });
  it("★★ lượt sửa KHÔNG đổi gì (tsc vẫn đỏ) ⇒ dongSua {0,0} (số 0 THẬT), tepSua [], không câu luuY về tệp ngoài test, kiem-do", async () => {
    caiF();
    const { drv, dem } = lamDriver2(() => { ghi(TEP, BAI); ghi(F, F_LUOT1); }, () => undefined);
    const r = await chay(theCho(F), drv, lamKiem().f, lamTsc(DO, DO).f);
    expect(dem()).toBe(2);
    expect(r).toMatchObject({ ok: false, ketCuc: "kiem-do", coLuotSua: true });
    expect(r.luotSua?.dongSua).toEqual({ them: 0, xoa: 0 });
    expect(r.luotSua?.tepSua).toEqual([]);
    expect(luuYGop(r)).not.toContain("NGOÀI tệp test");
  });
  it("★★★ lượt đầu ĐỔI TÊN tệp nguồn (xoá f.ts, tạo f2.ts nội dung y hệt): mốc index không làm status nuốt đường f.ts ⇒ tepDoi có CẢ hai; tepSua chỉ phần lượt sửa (f2.ts 1/1)", async () => {
    caiF();
    const F2 = "client/src/lib/f2.ts";
    const { drv } = lamDriver2(
      () => { ghi(TEP, BAI); fs.rmSync(path.join(wt, F)); ghi(F2, F_GOC); },
      () => { ghi(TEP, BAI_SUA); ghi(F2, F_GOC.replace("f = 1", "f = 11")); },
    );
    const r = await chay(theCho(F, F2), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.tepDoi).toEqual([TEP, F, F2]);
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }, { duong: F2, them: 1, xoa: 1 }]);
    expect(r.luotSua?.dongSua).toEqual({ them: 2, xoa: 2 });
  });
  it("★★★ mốc index HỎNG (git add thất bại thật: `.git/index.lock` đang tồn tại lúc đặt mốc) ⇒ dongSua null, tepSua null (KHÔNG phải 0), luuY nói rõ; không có câu 'NGOÀI tệp test'; ketCuc vẫn xong; r.dong (so HEAD) vẫn đếm", async () => {
    const khoa = path.join(wt, ".git", "index.lock");
    const { drv } = lamDriver2(
      () => { ghi(TEP, BAI); fs.writeFileSync(khoa, ""); }, // khoá dựng ở cuối lượt 1 ⇒ thu() `add -N` và mốc `git add` đều thất bại
      () => { fs.rmSync(khoa, { force: true }); ghi(TEP, BAI_SUA); }, // gỡ khoá đầu lượt sửa ⇒ thu() sau lượt sửa chạy bình thường
    );
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(fs.existsSync(khoa)).toBe(false);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.luotSua?.dongSua).toBeNull();
    expect(r.luotSua?.tepSua).toBeNull();
    expect(r.luuY).toContain("LƯỢT SỬA TSC: không đặt được mốc index nên `luotSua.dongSua` / `tepSua` là null (không đếm được, KHÔNG phải 0)");
    expect(luuYGop(r)).not.toContain("NGOÀI tệp test");
    expect(r.luotSua).toMatchObject({ viPham: 0, crlf: 0 });
    expect(r.dong).toEqual({ them: 3, xoa: 0 });
  });
  it("★★ đối chứng mốc: KHÔNG có khoá ⇒ cùng thẻ cho dongSua {1,1} và KHÔNG có câu 'không đặt được mốc' (câu chỉ xuất hiện khi mốc hỏng)", async () => {
    const { drv } = lamDriver2(() => ghi(TEP, BAI), () => ghi(TEP, BAI_SUA));
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r.luotSua?.dongSua).toEqual({ them: 1, xoa: 1 });
    expect(luuYGop(r)).not.toContain("không đặt được mốc index");
  });
  it("★★ lượt sửa đổi tệp NHỊ PHÂN (numstat ghi `-`): số là 0 chứ không NaN; dongSua {1,1} chỉ từ tệp test; tepSua có mục nhị phân 0/0; luuY nêu (+0/−0)", async () => {
    const B = "client/src/lib/b.bin";
    fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
    fs.writeFileSync(path.join(wt, B), Buffer.from([0, 1, 2, 3]));
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "bin");
    const { drv } = lamDriver2(
      () => ghi(TEP, BAI),
      () => { ghi(TEP, BAI_SUA); fs.writeFileSync(path.join(wt, B), Buffer.from([0, 1, 2, 4])); },
    );
    const r = await chay(theCho(B), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }, { duong: B, them: 0, xoa: 0 }]);
    expect(r.luotSua?.dongSua).toEqual({ them: 1, xoa: 1 });
    expect(r.luuY).toContain(CAU_NGOAI(`${B} (+0/−0)`));
  });
  // ── THU-ADDN: thu() chỉ `git add -N` các đường CÒN trên đĩa; rc được báo (chayMotViec.ts, thu()) ──
  it("★★★ THU-ADDN: lượt đầu XOÁ tệp tracked, lượt sửa TẠO tệp mới ⇒ tệp mới có trong tepDoi, diff, dong và tepSua (trước: `add -N` nguyên khối hỏng vì đường đã xoá nên tệp mới vắng)", async () => {
    caiF();
    const G = "client/src/lib/g.ts";
    const { drv } = lamDriver2(
      () => { ghi(TEP, BAI); fs.rmSync(path.join(wt, F)); },
      () => { ghi(TEP, BAI_SUA); ghi(G, "x\ny\n"); },
    );
    const r = await chay(theCho(F, G), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.tepDoi).toEqual([TEP, F, G]);
    expect(r.dong).toEqual({ them: 5, xoa: 3 }); // a.test.ts mới +3, f.ts xoá −3 (3 dòng), g.ts mới +2
    expect(fs.readFileSync(r.diff ?? "", "utf8")).toContain("client/src/lib/g.ts");
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }, { duong: G, them: 2, xoa: 0 }]);
    expect(r.luotSua?.dongSua).toEqual({ them: 3, xoa: 1 });
    expect(r.luuY).toContain(CAU_NGOAI(`${G} (+2/−0)`));
    expect(luuYGop(r)).not.toContain("git add -N");
  });
  it("★★ lượt sửa XOÁ tệp nguồn tracked ⇒ dòng xoá được tính: tepSua có f.ts 0/3, dongSua {1,4}; luuY nêu (+0/−3)", async () => {
    caiF();
    const { drv } = lamDriver2(() => ghi(TEP, BAI), () => { ghi(TEP, BAI_SUA); fs.rmSync(path.join(wt, F)); });
    const r = await chay(theCho(F), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.tepDoi).toEqual([TEP, F]);
    expect(r.dong).toEqual({ them: 3, xoa: 3 });
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }, { duong: F, them: 0, xoa: 3 }]);
    expect(r.luotSua?.dongSua).toEqual({ them: 1, xoa: 4 });
    expect(r.luuY).toContain(CAU_NGOAI(`${F} (+0/−3)`));
  });
  it("★★ lượt sửa ĐỔI TÊN tệp nguồn (f.ts → f2.ts y hệt) ⇒ tepSua liệt kê CẢ hai (xoá 0/3 và thêm 3/0), không bị gộp thành một mục đổi tên làm mất cả hai", async () => {
    caiF();
    const F2 = "client/src/lib/f2.ts";
    const { drv } = lamDriver2(() => ghi(TEP, BAI), () => { ghi(TEP, BAI_SUA); fs.renameSync(path.join(wt, F), path.join(wt, F2)); });
    const r = await chay(theCho(F, F2), drv, lamKiem().f, lamTsc(DO, XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: true });
    expect(r.luotSua?.tepSua).toEqual([{ duong: TEP, them: 1, xoa: 1 }, { duong: F, them: 0, xoa: 3 }, { duong: F2, them: 3, xoa: 0 }]);
    expect(r.luotSua?.dongSua).toEqual({ them: 4, xoa: 4 });
    expect(r.luuY).toContain(CAU_NGOAI(`${F} (+0/−3), ${F2} (+3/−0)`));
  });
  it("★★★ THU-ADDN: `git add -N` của thu() sau lượt ĐẦU hỏng thật (index.lock đang tồn tại) ⇒ luuY nêu rõ (không im); ketCuc theo lệnh kiểm; không lượt sửa", async () => {
    const { drv } = lamDriver2(() => { ghi(TEP, BAI); fs.writeFileSync(path.join(wt, ".git", "index.lock"), ""); }, () => undefined);
    const r = await chay(the(CO), drv, lamKiem().f, lamTsc(XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: false });
    expect(r.luuY).toContain("thu() sau lượt đầu: `git add -N` thất bại — tệp MỚI có thể vắng khỏi diff / `dong` / luotSua.tepSua của lần thu này (đọc cây thật, đừng tin diff)");
  });
  it("★★★ THU-ADDN, ảnh hưởng lượt ĐẦU: lượt đầu XOÁ tệp tracked (không lượt sửa) ⇒ tepDoi, dong và văn bản diff (so HEAD) đúng như trước sửa: f.ts xoá 3 dòng, a.test.ts mới 3 dòng", async () => {
    caiF();
    const { drv } = lamDriver2(() => { ghi(TEP, BAI); fs.rmSync(path.join(wt, F)); }, () => undefined);
    const r = await chay(theCho(F), drv, lamKiem().f, lamTsc(XANH).f);
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", coLuotSua: false });
    expect(r.tepDoi).toEqual([TEP, F]);
    expect(r.dong).toEqual({ them: 3, xoa: 3 });
    const diff = fs.readFileSync(r.diff ?? "", "utf8");
    expect(diff).toContain(`diff --git a/${F} b/${F}\ndeleted file mode 100644`);
    for (const dong of ["-export const f = 1;", "-export const g = 2;", "-export const h = 3;"]) expect(diff).toContain(`\n${dong}\n`);
    expect(diff).toContain(`diff --git a/${TEP} b/${TEP}\nnew file mode 100644`);
    for (const dong of ['+import { it } from "vitest";', '+it("a", () => {});', '+it("b", () => {});']) expect(diff).toContain(`\n${dong}\n`);
    expect(luuYGop(r)).not.toContain("git add -N");
  });
});
