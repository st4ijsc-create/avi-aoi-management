import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, ghepLenh, type Driver } from "./chayMotViec";
import { docTheViec } from "./theViec";
import { tinhTranLuot } from "./tranLuot";
import type { ChayKiem } from "./kiemChung";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const the = (them = "") => `MÃ: TC-89
MỤC TIÊU: thử trần lượt
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts
LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts
GIỚI HẠN: 15 phút, 8 vòng${them}`;
const chayKiemXanh: ChayKiem = async (lenh) => ({
  lenh, exit: 0, hetGio: false, giay: 1, duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } },
});
const TEST_MOI = `import { it } from "vitest";\nit("x", () => {});\n`;

let goc: string;
let wt: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tct-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
  ra = path.join(goc, "ra");
  fs.mkdirSync(wt, { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, "README.md"), "x\n");
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

type Nhan = { gioiHanLuot?: unknown; hanGiay?: number; lenh?: string };
const chayVoiDriver = async (van: string, env: Record<string, string> = {}) => {
  const nhan: Nhan = {};
  const drv: Driver = async (v) => {
    nhan.gioiHanLuot = v.gioiHanLuot;
    nhan.hanGiay = v.hanGiay;
    nhan.lenh = v.lenh;
    return { ghiChu: [], vong: 1, token: null, hetGio: false } as never;
  };
  const r = await chayMotViec({ van, wt, base: "HEAD", driver: drv, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh, envTran: env as NodeJS.ProcessEnv });
  return { r, nhan };
};

describe("HA-3 — trần lượt theo khoá thẻ, chạy qua chayMotViec", () => {
  it("★★★ thẻ KHÔNG có khoá ⇒ driver KHÔNG nhận gioiHanLuot; JSON không có `tran`; hanGiay như cũ (900); lời nhắc giữ dòng GIỚI HẠN '… 8 vòng' NGUYÊN VĂN", async () => {
    const { r, nhan } = await chayVoiDriver(the());
    expect(nhan.gioiHanLuot).toBeUndefined();
    expect("tran" in r).toBe(false);
    expect(nhan.hanGiay).toBe(900);
    expect(nhan.lenh).toContain("GIỚI HẠN: 15 phút, 8 vòng");
    expect(nhan.lenh).not.toContain("TRẦN");
  });
  it("★★★ không khoá ⇒ lời nhắc BẰNG đúng ghepLenh cũ (so từng byte với ghepLenh không tham số trần)", async () => {
    const d = docTheViec(the());
    if (!d.ok) throw new Error("thẻ");
    const { nhan } = await chayVoiDriver(the());
    expect(nhan.lenh).toBe(ghepLenh(d.the, "# l\n"));
    expect(ghepLenh(d.the, "# l\n", null)).toBe(ghepLenh(d.the, "# l\n"));
  });
  it("★★★ TRẦN LƯỢT MODEL: 20 ⇒ driver nhận soLuotToiDa 20 (thẻ 20 < env mặc định 30); JSON ghi ba nguồn và số thực dùng", async () => {
    const { r, nhan } = await chayVoiDriver(the("\nTRẦN LƯỢT MODEL: 20"));
    expect(nhan.gioiHanLuot).toEqual({ soLuotToiDa: 20 });
    expect(r.tran).toMatchObject({ donVi: "luot-goi-model", khoaThe: { luotModel: 20, phut: null, tokenRa: null }, luotEnv: null, tranCung: 120, luotThucDung: 20, apDungTuThe: true });
  });
  it("★★★ thẻ 60 mà env chưa đặt ⇒ 30 (env mặc định chặn); env 100 ⇒ 60; env 20 ⇒ 20", async () => {
    expect((await chayVoiDriver(the("\nTRẦN LƯỢT MODEL: 60"))).nhan.gioiHanLuot).toEqual({ soLuotToiDa: 30 });
    expect((await chayVoiDriver(the("\nTRẦN LƯỢT MODEL: 60"), { AI_AGENT_SO_LUOT_TOI_DA: "100" })).nhan.gioiHanLuot).toEqual({ soLuotToiDa: 60 });
    expect((await chayVoiDriver(the("\nTRẦN LƯỢT MODEL: 60"), { AI_AGENT_SO_LUOT_TOI_DA: "20" })).nhan.gioiHanLuot).toEqual({ soLuotToiDa: 20 });
  });
  it("★★★ TRẦN PHÚT ⇒ msToiDa và hanGiay của driver theo phút của thẻ (không theo chữ '15 phút')", async () => {
    const { nhan, r } = await chayVoiDriver(the("\nTRẦN PHÚT: 25"));
    expect(nhan.gioiHanLuot).toEqual({ msToiDa: 1_500_000 });
    expect(nhan.hanGiay).toBe(1500);
    expect(r.tran?.phutThucDung).toBe(25);
  });
  it("★★ TRẦN TOKEN RA ⇒ tokenRaToiDa", async () => {
    expect((await chayVoiDriver(the("\nTRẦN TOKEN RA: 5000"))).nhan.gioiHanLuot).toEqual({ tokenRaToiDa: 5000 });
  });
  it("★★★ lời nhắc báo trần THẬT ngay đầu lượt và bỏ chữ '8 vòng' tự do (không mâu thuẫn)", async () => {
    const { nhan } = await chayVoiDriver(the("\nTRẦN LƯỢT MODEL: 60"), { AI_AGENT_SO_LUOT_TOI_DA: "45" });
    expect(nhan.lenh).toContain("TRẦN LƯỢT MODEL: 45");
    expect(nhan.lenh).toContain("một lần gọi model");
    expect(nhan.lenh).toContain("GIỚI HẠN: 15 phút");
    expect(nhan.lenh).not.toContain("8 vòng");
  });
  it("★★★ chữ '8 vòng' trong GIỚI HẠN KHÔNG bao giờ thành trần: thẻ chỉ có chữ đó ⇒ không ép gì", async () => {
    const { nhan } = await chayVoiDriver(the());
    expect(nhan.gioiHanLuot).toBeUndefined();
  });
  it("★★ thẻ khoá sai ⇒ tu-choi trước khi chạm worktree", async () => {
    const r = await chayMotViec({ van: the("\nTRẦN LƯỢT MODEL: 500"), wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n" });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("TRẦN LƯỢT MODEL");
  });
  it("★ tinhTranLuot dùng đúng env được tiêm, không đọc process.env của ca kiểm", async () => {
    const truoc = process.env.AI_AGENT_SO_LUOT_TOI_DA;
    process.env.AI_AGENT_SO_LUOT_TOI_DA = "5";
    try {
      expect((await chayVoiDriver(the("\nTRẦN LƯỢT MODEL: 60"), {})).nhan.gioiHanLuot).toEqual({ soLuotToiDa: 30 });
    } finally {
      if (truoc === undefined) delete process.env.AI_AGENT_SO_LUOT_TOI_DA;
      else process.env.AI_AGENT_SO_LUOT_TOI_DA = truoc;
    }
    expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "5" }).luotThucDung).toBe(5);
  });
});

describe("HA-3 — lệnh kiểm VÀ tsc luôn chạy trên cây cuối dù lượt không xong", () => {
  const TEST_OK = "import { it } from 'vitest';\nit('x', () => {});\n";
  const caiTsconfig = () => {
    fs.writeFileSync(path.join(wt, "tsconfig.tests.json"), "{}\n");
    git(wt, "add", "tsconfig.tests.json");
    git(wt, "commit", "-q", "-m", "tsconfig");
  };
  const ghiTestRoiLoi = (over: { hetGio?: boolean; loi?: string }): Driver => async (v) => {
    fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
    fs.writeFileSync(path.join(v.wt, "client/src/lib/a.test.ts"), TEST_OK);
    return { vong: 30, token: null, ghiChu: [], hetGio: over.hetGio ?? false, ...(over.loi ? { loi: over.loi } : {}) };
  };
  const run = (driver: Driver, goiTsc: string[][], chayTscExit = 0) =>
    chayMotViec({
      van: the(), wt, base: "HEAD", driver, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh,
      chayTsc: async (_w, tep) => (goiTsc.push([...tep]), { exit: chayTscExit, hetGio: false, giay: 1, loiTrongTep: chayTscExit ? ["client/src/lib/a.test.ts(1,1): error TS2322: x"] : [], tongLoi: chayTscExit ? 1 : 0 }),
    });
  it("★★★ het-luot (loi-driver) + có tệp test + có tsconfig ⇒ ketCuc GIỮ loi-driver, VẪN chạy lệnh kiểm VÀ tsc, JSON mang cả hai", async () => {
    caiTsconfig();
    const goi: string[][] = [];
    const r = await run(ghiTestRoiLoi({ loi: "lượt dừng không hoàn thành: lyDo=het-luot" }), goi);
    expect(r.ketCuc).toBe("loi-driver");
    expect(r.kiem).toMatchObject({ exit: 0 });
    expect(r.tsc).toMatchObject({ exit: 0, tongLoi: 0 });
    expect(goi).toEqual([["client/src/lib/a.test.ts"]]);
    expect(r.luuY?.join(" ")).toMatch(/tsc exit 0, 0 lỗi/);
  });
  it("★★★ het-gio cũng vậy; tsc đỏ vẫn KHÔNG đổi ketCuc (sticky) nhưng được ghi lại", async () => {
    caiTsconfig();
    const goi: string[][] = [];
    const r = await run(ghiTestRoiLoi({ hetGio: true }), goi, 2);
    expect(r.ketCuc).toBe("het-gio");
    expect(r.tsc).toMatchObject({ exit: 2, tongLoi: 1 });
    expect(r.luuY?.join(" ")).toMatch(/tsc exit 2, 1 lỗi/);
  });
  it("★★ không có tsconfig.tests.json ⇒ KHÔNG chạy tsc (như cũ)", async () => {
    const goi: string[][] = [];
    const r = await run(ghiTestRoiLoi({ loi: "x" }), goi);
    expect(goi).toEqual([]);
    expect("tsc" in r).toBe(false);
  });
  it("★★ lượt không đổi tệp test nào ⇒ KHÔNG chạy lệnh kiểm lẫn tsc", async () => {
    caiTsconfig();
    const goi: string[][] = [];
    const r = await run(async () => ({ vong: 1, token: null, ghiChu: [], hetGio: false, loi: "x" }), goi);
    expect(goi).toEqual([]);
    expect("kiem" in r).toBe(false);
    expect("tsc" in r).toBe(false);
  });
  it("★★★ vi-pham (ghi ngoài tệp được phép) ⇒ KHÔNG chạy mã của model (không kiểm, không tsc)", async () => {
    caiTsconfig();
    const goi: string[][] = [];
    const r = await run(
      async (v) => {
        fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
        fs.writeFileSync(path.join(v.wt, "client/src/lib/a.test.ts"), TEST_OK);
        fs.writeFileSync(path.join(v.wt, "ngoai-pham-vi.ts"), "export const a = 1;\n");
        return { vong: 1, token: null, ghiChu: [], hetGio: false, loi: "x" };
      },
      goi,
    );
    expect(r.ketCuc).toBe("vi-pham");
    expect(goi).toEqual([]);
    expect("kiem" in r).toBe(false);
  });
});
