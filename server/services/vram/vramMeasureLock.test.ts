import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMeasureLockForTests, measureWindowDepth, withMeasureWindow } from "./vramMeasureLock";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// I-2 dua console.warn vao nhanh het-ngan-sach (dung, spec §5.4 doi "co tieng"), nhung
// dieu do lam nhieu ca cu (khong lien quan I-2) in canh bao ra stderr. Cham lang mac
// dinh cho CA FILE; cac ca I-2 tu ghi de bang vi.spyOn rieng de doc duoc noi dung.
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("withMeasureWindow", () => {
  beforeEach(() => { __resetMeasureLockForTests(); });

  it("hai luot KHONG bao gio chong nhau", async () => {
    const nhatKy: string[] = [];
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => {
      nhatKy.push("A vao");
      await new Promise<void>((r) => { moKhoaA = r; });
      nhatKy.push("A ra");
      return "a";
    });
    await tick();
    const b = withMeasureWindow(async () => { nhatKy.push("B vao"); return "b"; });
    await tick();
    expect(nhatKy).toEqual(["A vao"]); // B con xep hang
    moKhoaA();
    await Promise.all([a, b]);
    expect(nhatKy).toEqual(["A vao", "A ra", "B vao"]);
  });

  it("bao dat do duoc khi khong tranh chap", async () => {
    const r = await withMeasureWindow(async () => 7);
    expect(r).toEqual({ value: 7, measurable: true });
  });

  it("het ngan sach cho thi VAN CHAY, chi mat phep do", async () => {
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; });
    await tick();
    const b = await withMeasureWindow(async () => "b", 0);
    expect(b).toEqual({ value: "b", measurable: false });
    moKhoaA();
    await a;
  });

  it("ham nem VAN nha khoa — khong khoa chet", async () => {
    await expect(withMeasureWindow(async () => { throw new Error("vo"); })).rejects.toThrow("vo");
    expect(measureWindowDepth()).toBe(0);
    const r = await withMeasureWindow(async () => "sau do");
    expect(r.measurable).toBe(true);
  });

  it("luot chay khong do KHONG giu khoa cua nguoi khac", async () => {
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; });
    await tick();
    await withMeasureWindow(async () => "b", 0);   // bo qua khoa
    await tick();
    expect(measureWindowDepth()).toBe(1);          // van chi co A giu
    moKhoaA();
    await a;
  });
});

// review vong 1 Critical (C-1) — brief goc de nghi "giu khoa la du de measurable:true"
// la SAI: mot luot bo-cuoc van CHAY o ngoai khoa va co the chay XEN vao dung cua so ma
// nguoi giu dang do, khien so byte cua no bi cong lan vao phep do cua nguoi giu. Test
// nay dung dung nhat ky ["A vao", "B CHAY", "A ra"] ma review dua ra lam vi du, voi
// IT NHAT HAI nguoi cho (B va C) de khong lot qua mot cai fix "chi nho luot bo-cuoc gan
// nhat" (single-flag) thay vi dem dung.
describe("withMeasureWindow — C-1: nguoi giu KHONG duoc nuot byte cua nguoi bo cuoc", () => {
  beforeEach(() => { __resetMeasureLockForTests(); });

  it('nhat ky ["A vao","B CHAY","A ra"] ⇒ A.measurable PHAI la false', async () => {
    const nhatKy: string[] = [];
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => {
      nhatKy.push("A vao");
      await new Promise<void>((r) => { moKhoaA = r; });
      nhatKy.push("A ra");
      return "a";
    });
    await tick();

    // B va C deu dang XEP HANG cho A (hai nguoi cho) khi ca hai het ngan sach
    // (budget=0) va bo cuoc — ca hai CHAY o ngoai khoa trong luc A van con giu.
    const b = withMeasureWindow(async () => { nhatKy.push("B CHAY"); return "b"; }, 0);
    const c = withMeasureWindow(async () => "c", 0);
    const [bResult, cResult] = await Promise.all([b, c]);
    expect(bResult.measurable).toBe(false);
    expect(cResult.measurable).toBe(false);
    expect(nhatKy).toEqual(["A vao", "B CHAY"]); // B da chay XEN, A van con giu khoa

    moKhoaA();
    const aResult = await a;

    expect(nhatKy).toEqual(["A vao", "B CHAY", "A ra"]);
    expect(aResult.measurable).toBe(false); // <- C-1: khong duoc khai "do duoc"
  });

  it("luot bo-cuoc DA chay tu TRUOC khi cua so mo ⇒ cleanStart bat duoc (ve a)", async () => {
    const nhatKy: string[] = [];
    let moKhoaZ!: () => void;
    let moKhoaB!: () => void;

    // Z giu khoa truoc. B xep hang cho Z voi ngan sach RAT NGAN ⇒ het gio truoc
    // khi Z nha khoa, roi B CHAY o ngoai khoa nhung CHUA XONG (con bi chan boi
    // moKhoaB).
    const z = withMeasureWindow(async () => {
      await new Promise<void>((r) => { moKhoaZ = r; });
      return "z";
    });
    await tick();
    const b = withMeasureWindow(async () => {
      nhatKy.push("B bat dau (khong do)");
      await new Promise<void>((r) => { moKhoaB = r; });
      return "b";
    }, 0);
    await tick();
    await tick();
    expect(nhatKy).toEqual(["B bat dau (khong do)"]); // B dang CHAY, chua xong

    moKhoaZ();
    await z; // Z nha khoa HOAN TAT — dangGiu ve false, nhung B van dang chay

    // A xin khoa: khong tranh chap (dangGiu=false) ⇒ duoc cap NGAY, trong luc B
    // (bo cuoc) van con dang chay o ngoai khoa.
    const a = await withMeasureWindow(async () => "a");

    moKhoaB();
    await b;

    expect(a.measurable).toBe(false); // A mo cua so trong luc B (bo cuoc) van dang chay
  });
});

// review vong 1 Important (I-1) — voi CHI mot nguoi cho, shift()/splice() khong the
// phan biet "chuyen tiep dung nguoi" voi "nuot luot". Ca duoi day dung BA nguoi cho:
// B bo cuoc (het ngan sach) trong khi VAN o DAU hang doi, roi A moi nha khoa — B phai
// TU RUT va nhuong luot cho C (khong duoc "danh cap" luot roi bo khong ai nhan).
describe("withMeasureWindow — I-1: nguoi bo cuoc phai CHUYEN TIEP luot, khong nuot", () => {
  beforeEach(() => { __resetMeasureLockForTests(); });

  it("B bo cuoc GIUA hang cho ⇒ C va D van nhan duoc luot, khoa KHONG ket vinh vien", async () => {
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => {
      await new Promise<void>((r) => { moKhoaA = r; });
      return "a";
    });
    await tick();

    // B xep hang DAU TIEN sau A voi ngan sach RAT NGAN ⇒ het gio truoc khi A nha
    // khoa. C va D xep hang SAU B voi ngan sach mac dinh (rat dai) ⇒ van dang cho
    // THAT SU (khong bo cuoc) khi B het gio.
    const b = withMeasureWindow(async () => "b", 0);
    const c = withMeasureWindow(async () => "c");
    const d = withMeasureWindow(async () => "d");

    const bResult = await b; // cho B het gio va tu rut khoi hang cho
    expect(bResult.measurable).toBe(false);
    expect(measureWindowDepth()).toBe(1); // A van con giu khoa nghiem tuc

    // A nha khoa SAU KHI B da bo cuoc — luot phai chuyen cho C (nguoi ke), KHONG
    // phai bi B (da bo cuoc) nuot mat.
    moKhoaA();
    const [, cResult, dResult] = await Promise.all([a, c, d]);

    expect(cResult.measurable).toBe(true);
    expect(dResult.measurable).toBe(true);
    expect(measureWindowDepth()).toBe(0); // khoa phai VE 0, KHONG ket vinh vien
  });
});

// review vong 1 Important (I-2) — hoan het-ngan-sach phai CO TIENG (spec §5.4), khong
// duoc cam lang va vo danh: dong canh bao phai neu ro CA nguoi bo cuoc LAN nguoi dang
// giu, va van co gia tri mac dinh ro rang khi khong ai truyen nhan.
describe("withMeasureWindow — I-2: het ngan sach phai CO TIENG (canh bao neu ro hai phia)", () => {
  beforeEach(() => { __resetMeasureLockForTests(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("ghi DUNG MOT dong canh bao neu ro ca nguoi bo cuoc lan nguoi dang giu", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let moKhoaA!: () => void;
    const a = withMeasureWindow(
      async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; },
      undefined,
      "model-A",
    );
    await tick();
    const b = await withMeasureWindow(async () => "b", 0, "model-B");
    expect(b.measurable).toBe(false);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("model-B"); // ai bo cuoc
    expect(msg).toContain("model-A"); // ai dang giu

    moKhoaA();
    await a;
  });

  it("khong truyen nhan van co dong canh bao voi gia tri MAC DINH ro rang, khong phai chuoi rong", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; });
    await tick();
    await withMeasureWindow(async () => "b", 0);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toMatch(/""/); // khong phai nhan rong ""

    moKhoaA();
    await a;
  });
});
