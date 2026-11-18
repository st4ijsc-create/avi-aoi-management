import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bienDichMa,
  chay,
  DONG_THOI_MAC_DINH,
  DONG_THOI_TOI_DA,
  GioiHanDongThoi,
  laDacTaNgoaiThuMucTam,
  phatHienThamChieuNgoai,
  soKheDongThoi,
  TSCONFIG,
} from "./bienDichMa";

const BS = String.fromCharCode(92);

describe("laDacTaNgoaiThuMucTam", () => {
  it.each([
    ["/etc/passwd", true],
    [`${BS}${BS}may${BS}chia${BS}a.ts`, true],
    [`${BS}abs${BS}a.ts`, true],
    ["C:/x/a.ts", true],
    [`c:${BS}x${BS}a.ts`, true],
    ["file:///x/a.ts", true],
    ["FILE:///x/a.ts", true],
    ["~/a.ts", true],
    ["../a", true],
    ["./../a", true],
    [`.${BS}..${BS}a`, true],
    ["a/../../b", true],
    ["./local", false],
    ["local", false],
    ["lodash", false],
    ["@scope/pkg", false],
    ["node:fs", false],
    ["a/b.c/d", false],
    ["..foo", false],
  ])("%s ⇒ %s", (spec, ngoai) => {
    expect(laDacTaNgoaiThuMucTam(spec)).toBe(ngoai);
  });
});

describe("phatHienThamChieuNgoai (chặn trước khi biên dịch TS)", () => {
  it.each([
    ["triple-slash path tuyệt đối", `/// <reference path="/etc/x.ts" />${"\n"}const a = 1;`, "tham-chieu-triple-slash"],
    ["triple-slash path tương đối trong thư mục tạm cũng bị chặn", `/// <reference path="./a.ts" />`, "tham-chieu-triple-slash"],
    ["triple-slash types", `/// <reference types="node" />`, "tham-chieu-triple-slash"],
    ["triple-slash lib", `/// <reference lib="dom" />`, "tham-chieu-triple-slash"],
    ["triple-slash có khoảng trắng", `///    <reference path="x" />`, "tham-chieu-triple-slash"],
    ["triple-slash không ở đầu tệp", `const a = 1;${"\n"}/// <reference path="x" />`, "tham-chieu-triple-slash"],
    ["import tuyệt đối POSIX", `import { a } from "/srv/app/secret.ts";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import ổ đĩa", `import { a } from "C:/srv/secret.ts";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import ổ đĩa dấu gạch ngược", `import { a } from "C:${BS}srv${BS}secret.ts";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import UNC", `import { a } from "${BS}${BS}may${BS}chia${BS}s.ts";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import ra ngoài ../", `import { a } from "../../server/db";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import file:", `import { a } from "file:///x/y.ts";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import không có from", `import "../x";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["export * from", `export * from "../x";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["export { } from", `export { a } from "/x";`, "tham-chieu-ngoai-thu-muc-tam"],
    ["require", `const a = require("../x");`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import = require", `import a = require("/x");`, "tham-chieu-ngoai-thu-muc-tam"],
    ["import() động", `const m = await import("../x");`, "tham-chieu-ngoai-thu-muc-tam"],
    ["kiểu import()", `type T = typeof import("../x");`, "tham-chieu-ngoai-thu-muc-tam"],
    ["nháy đơn", `import { a } from '../x';`, "tham-chieu-ngoai-thu-muc-tam"],
    ["nháy ngược", "const m = await import(`../x`);", "tham-chieu-ngoai-thu-muc-tam"],
    ["đứng sau mã khác trên cùng dòng", `const a = 1; import { b } from "../x";`, "tham-chieu-ngoai-thu-muc-tam"],
  ])("chặn: %s", (_t, ma, lyDo) => {
    expect(phatHienThamChieuNgoai(ma)).toBe(lyDo);
  });

  it.each([
    ["mã thường", `export function f(a: number): number { return a + 1; }`],
    ["import gói trần (không resolve được, TS2307 bị gạt)", `import { x } from "lodash";`],
    ["import tương đối trong thư mục tạm", `import { x } from "./cung-thu-muc";`],
    ["chuỗi giống đường nhưng không phải đặc tả mô-đun", `const p = "../x"; console.log(p);`],
    ["chú thích hai gạch chéo", `// xem ../x${"\n"}const a = 1;`],
    ["chữ reference thường", `const reference = 1;`],
    ["tên thuộc tính from", `const o = { from: 1 }; o.from + 1;`],
    ["import node:", `import fs from "node:fs";`],
  ])("không chặn: %s", (_t, ma) => {
    expect(phatHienThamChieuNgoai(ma)).toBeNull();
  });
});

describe("TSCONFIG — noResolve thật sự ngăn tsc đi theo tham chiếu", () => {
  it("★★★ cấu hình có noResolve:true", () => {
    expect(JSON.parse(TSCONFIG).compilerOptions.noResolve).toBe(true);
  });

  const tsc = createRequire(path.join(process.cwd(), "package.json")).resolve("typescript/bin/tsc");
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const dung = (ngoai: string, code: (duongNgoai: string) => string) => {
    const A = fs.mkdtempSync(path.join(os.tmpdir(), "tkc-ngoai-"));
    const B = fs.mkdtempSync(path.join(os.tmpdir(), "tkc-bien-dich-"));
    dirs.push(A, B);
    const f = path.join(A, "ngoai.ts");
    fs.writeFileSync(f, ngoai);
    fs.writeFileSync(path.join(B, "code.ts"), code(f.replace(/\\/g, "/")));
    fs.writeFileSync(path.join(B, "tsconfig.json"), TSCONFIG);
    return B;
  };

  it("★★★ /// <reference path> tới tệp ngoài: KHÔNG nạp (Cannot find name), không lộ kiểu của tệp ngoài", async () => {
    const B = dung("declare const TEN_BI_MAT_ZZ: number;\n", (f) => `/// <reference path="${f}" />\nconst v: string = TEN_BI_MAT_ZZ;\n`);
    const r = await chay(process.execPath, [tsc, "-p", "tsconfig.json", "--pretty", "false"], B, 120_000);
    expect(r.dauRa).toContain("TS2304");
    expect(r.dauRa).not.toContain("TS2322"); // TS2322 chỉ xuất hiện nếu tệp ngoài đã được nạp (number ⇒ string)
    expect(r.dauRa).not.toMatch(/number/);
  }, 130_000);

  it("★★★ import tới tệp ngoài: KHÔNG nạp (TS2307), không lộ tên xuất của tệp ngoài", async () => {
    const B = dung("export const TEN_BI_MAT_ZZ = 1;\n", (f) => `import { TEN_BI_MAT_ZZ } from "${f}";\nconst v: string = TEN_BI_MAT_ZZ;\n`);
    const r = await chay(process.execPath, [tsc, "-p", "tsconfig.json", "--pretty", "false"], B, 120_000);
    expect(r.dauRa).toContain("TS2307");
    expect(r.dauRa).not.toContain("TS2322");
    expect(r.dauRa).not.toMatch(/number/);
  }, 130_000);
});

describe("bienDichMa — chặn tham chiếu ngoài chạy TRƯỚC khi giữ khe hay dựng tiến trình", () => {
  it("★★★ TS có /// <reference ⇒ khong-kiem-duoc/tham-chieu-triple-slash; không xin khe", async () => {
    const gh = new GioiHanDongThoi();
    const spy = vi.spyOn(gh, "layKhe");
    const r = await bienDichMa({ ngonNgu: "ts", ma: `/// <reference path="/etc/x.ts" />\nconst a = 1;\n` }, 5_000, undefined, { gioiHan: gh });
    expect(r).toEqual({ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "tham-chieu-triple-slash" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("★★★ TS import ra ngoài ⇒ khong-kiem-duoc/tham-chieu-ngoai-thu-muc-tam", async () => {
    const gh = new GioiHanDongThoi();
    const r = await bienDichMa({ ngonNgu: "ts", ma: `import { a } from "../../server/db";\n` }, 5_000, undefined, { gioiHan: gh });
    expect(r).toEqual({ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "tham-chieu-ngoai-thu-muc-tam" });
  });
  it("★★ chỉ áp cho TS: Python có chuỗi giống đặc tả vẫn biên dịch bình thường", async () => {
    const gh = new GioiHanDongThoi();
    const r = await bienDichMa({ ngonNgu: "py", ma: `s = 'import a from "../b"'\nprint(s)\n` }, 60_000, undefined, { gioiHan: gh });
    expect(r.trangThai).toBe("ok");
  }, 70_000);
});

describe("bienDichMa.ts — giữ spawn nhìn thấy được với kiểm kê VRAM", () => {
  it("★★★ dòng khai regex đặc tả mô-đun KHÔNG chứa dấu nháy đơn/kép/ngược (bộ quét vramAllocationSites không hiểu regex và sẽ nuốt mã phía sau)", () => {
    const nguon = fs.readFileSync(path.join(__dirname, "bienDichMa.ts"), "utf8");
    const dong = nguon.split(/\r?\n/).find((l) => l.startsWith("const RE_DAC_TA"));
    expect(dong).toBeDefined();
    expect(dong).not.toMatch(/[\x22\x27\x60]/);
    expect(nguon).toMatch(/\bspawn\(/);
  });
});

describe("soKheDongThoi", () => {
  it.each([
    [undefined, DONG_THOI_MAC_DINH],
    ["", DONG_THOI_MAC_DINH],
    ["abc", DONG_THOI_MAC_DINH],
    ["0", DONG_THOI_MAC_DINH],
    ["-3", DONG_THOI_MAC_DINH],
    ["1.5", DONG_THOI_MAC_DINH],
    ["1", 1],
    ["3", 3],
    ["4", 4],
    ["9", DONG_THOI_TOI_DA],
  ])("AI_CHAT_TU_KIEM_DONG_THOI=%s ⇒ %s", (v, kq) => {
    expect(soKheDongThoi({ AI_CHAT_TU_KIEM_DONG_THOI: v } as NodeJS.ProcessEnv)).toBe(kq);
  });
  it("mặc định là 2 và trần là 4", () => {
    expect(DONG_THOI_MAC_DINH).toBe(2);
    expect(DONG_THOI_TOI_DA).toBe(4);
  });
});

describe("GioiHanDongThoi — trần biên dịch đồng thời", () => {
  it("★★★ dưới trần: cấp ngay; đủ trần thì người thứ ba phải chờ đến khi có khe trả", async () => {
    const g = new GioiHanDongThoi();
    const a = await g.layKhe(2, 1000);
    const b = await g.layKhe(2, 1000);
    expect(g.soDangGiu).toBe(2);
    let xong = false;
    const cho = g.layKhe(2, 5000).then((n) => {
      xong = true;
      return n;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(xong).toBe(false);
    expect(g.soDangCho).toBe(1);
    a!();
    const c = await cho;
    expect(c).not.toBeNull();
    expect(g.soDangGiu).toBe(2);
    expect(g.soDangCho).toBe(0);
    b!();
    c!();
    expect(g.soDangGiu).toBe(0);
  });

  it("★★ FIFO: hai người chờ được cấp theo thứ tự vào hàng", async () => {
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 1000);
    const thuTu: string[] = [];
    const p1 = g.layKhe(1, 5000).then((n) => (thuTu.push("1"), n));
    const p2 = g.layKhe(1, 5000).then((n) => (thuTu.push("2"), n));
    giu!();
    const n1 = await p1;
    expect(thuTu).toEqual(["1"]);
    n1!();
    const n2 = await p2;
    expect(thuTu).toEqual(["1", "2"]);
    n2!();
  });

  it("★★★ chờ quá hạn ⇒ null, rời hàng đợi; khe trả sau đó KHÔNG cấp cho người đã bỏ", async () => {
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 1000);
    const bo = await g.layKhe(1, 20);
    expect(bo).toBeNull();
    expect(g.soDangCho).toBe(0);
    giu!();
    expect(g.soDangGiu).toBe(0);
  });

  it("★★★ huỷ khi đang chờ ⇒ null và rời hàng; đã huỷ từ trước ⇒ null, không giữ khe", async () => {
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 1000);
    const ac = new AbortController();
    const cho = g.layKhe(1, 5000, ac.signal);
    expect(g.soDangCho).toBe(1);
    ac.abort();
    expect(await cho).toBeNull();
    expect(g.soDangCho).toBe(0);
    const daHuy = new AbortController();
    daHuy.abort();
    expect(await g.layKhe(1, 1000, daHuy.signal)).toBeNull();
    expect(g.soDangGiu).toBe(1);
    giu!();
    expect(g.soDangGiu).toBe(0);
  });

  it("★★★ đã huỷ từ trước mà khe còn trống ⇒ null NGAY và không giữ khe", async () => {
    const g = new GioiHanDongThoi();
    const ac = new AbortController();
    ac.abort();
    const t0 = Date.now();
    expect(await g.layKhe(2, 5000, ac.signal)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(g.soDangGiu).toBe(0);
  });

  it("★★★ trả khe nhiều lần chỉ giải phóng MỘT khe (không cho vượt trần)", async () => {
    const g = new GioiHanDongThoi();
    const a = await g.layKhe(1, 1000);
    a!();
    a!();
    a!();
    expect(g.soDangGiu).toBe(0);
    const b = await g.layKhe(1, 1000);
    expect(b).not.toBeNull();
    expect(await g.layKhe(1, 20)).toBeNull(); // trần 1 vẫn giữ, dù đã gọi trả ba lần
    b!();
  });

  it("★★ người mới không chen ngang hàng đợi khi vừa có khe trống", async () => {
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 1000);
    const thuTu: string[] = [];
    const cho = g.layKhe(1, 5000).then((n) => (thuTu.push("cho"), n));
    giu!();
    const moi = g.layKhe(1, 5000).then((n) => (thuTu.push("moi"), n));
    const nCho = await cho;
    expect(thuTu[0]).toBe("cho");
    nCho!();
    (await moi)!();
  });
});

describe("bienDichMa — khe đồng thời", () => {
  it("★★★ đầy khe và hết hạn chờ ⇒ khong-kiem-duoc/day-khe-bien-dich, không dựng tiến trình", async () => {
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 1000);
    const r = await bienDichMa({ ngonNgu: "py", ma: "x = 1\n" }, 40, undefined, { gioiHan: g, toiDaDongThoi: 1 });
    expect(r).toEqual({ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "day-khe-bien-dich" });
    giu!();
  });
  it("★★★ khe được TRẢ sau khi biên dịch xong (cả khi mã có lỗi)", async () => {
    const g = new GioiHanDongThoi();
    const r = await bienDichMa({ ngonNgu: "py", ma: "def f(:\n" }, 60_000, undefined, { gioiHan: g, toiDaDongThoi: 1 });
    expect(r.trangThai).toBe("loi");
    expect(g.soDangGiu).toBe(0);
  }, 70_000);
  it("★★★ không nêu toiDaDongThoi ⇒ lấy trần từ AI_CHAT_TU_KIEM_DONG_THOI", async () => {
    vi.stubEnv("AI_CHAT_TU_KIEM_DONG_THOI", "1");
    try {
      const g = new GioiHanDongThoi();
      const giu = await g.layKhe(1, 1000);
      const r = await bienDichMa({ ngonNgu: "py", ma: "x = 1" }, 40, undefined, { gioiHan: g });
      expect(r).toEqual({ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "day-khe-bien-dich" });
      giu!();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("★★ đã huỷ ⇒ khong-kiem-duoc/huy", async () => {
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 1000);
    const ac = new AbortController();
    const p = bienDichMa({ ngonNgu: "py", ma: "x = 1\n" }, 60_000, ac.signal, { gioiHan: g, toiDaDongThoi: 1 });
    ac.abort();
    expect(await p).toEqual({ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "huy" });
    giu!();
  });
  it("★★ thời gian chờ khe được trừ vào hạn biên dịch (chờ gần hết hạn ⇒ không biên dịch kịp)", async () => {
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 1000);
    setTimeout(() => giu!(), 50);
    const t0 = Date.now();
    const r = await bienDichMa({ ngonNgu: "py", ma: "x = 1\n" }, 60_000, undefined, { gioiHan: g, toiDaDongThoi: 1 });
    expect(r.trangThai).toBe("ok");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  }, 70_000);
});

describe("bienDichMa — thời gian chờ khe bị TRỪ khỏi trần biên dịch (b12)", () => {
  afterEach(() => vi.useRealTimers());
  const khoi = { ngonNgu: "py", ma: "x = 1\n" } as const;
  const dung = () => {
    const nhan: number[] = [];
    const chayTrongKhe = (async (_k: unknown, tranMs: number) => (nhan.push(tranMs), { trangThai: "ok", chanDoan: [] })) as never;
    return { nhan, chayTrongKhe };
  };
  it("★★★ chờ khe 400 ms trong trần 1000 ms ⇒ lượt biên dịch chỉ còn đúng 600 ms", async () => {
    vi.useFakeTimers();
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 10_000);
    const { nhan, chayTrongKhe } = dung();
    const p = bienDichMa(khoi, 1000, undefined, { gioiHan: g, toiDaDongThoi: 1, chayTrongKhe });
    await vi.advanceTimersByTimeAsync(400);
    giu!();
    expect(await p).toEqual({ trangThai: "ok", chanDoan: [] });
    expect(nhan).toEqual([600]);
  });
  it("★★★ không phải chờ ⇒ nhận đủ trần (không trừ oan)", async () => {
    vi.useFakeTimers();
    const { nhan, chayTrongKhe } = dung();
    await bienDichMa(khoi, 1000, undefined, { gioiHan: new GioiHanDongThoi(), toiDaDongThoi: 1, chayTrongKhe });
    expect(nhan).toEqual([1000]);
  });
  it("★★ chờ sát trần (999/1000 ms) ⇒ vẫn còn đúng 1 ms, không âm", async () => {
    vi.useFakeTimers();
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 10_000);
    const { nhan, chayTrongKhe } = dung();
    const p = bienDichMa(khoi, 1000, undefined, { gioiHan: g, toiDaDongThoi: 1, chayTrongKhe });
    await vi.advanceTimersByTimeAsync(999);
    giu!();
    await p;
    expect(nhan).toEqual([1]);
  });
  it("★★★ hai lần chờ nối tiếp: mỗi lượt tự trừ phần chờ của CHÍNH nó (không dồn)", async () => {
    vi.useFakeTimers();
    const g = new GioiHanDongThoi();
    const giu = await g.layKhe(1, 10_000);
    const { nhan, chayTrongKhe } = dung();
    const a = bienDichMa(khoi, 1000, undefined, { gioiHan: g, toiDaDongThoi: 1, chayTrongKhe });
    await vi.advanceTimersByTimeAsync(200);
    giu!();
    await a;
    const b = bienDichMa(khoi, 1000, undefined, { gioiHan: g, toiDaDongThoi: 1, chayTrongKhe });
    await b;
    expect(nhan).toEqual([800, 1000]);
  });
});
