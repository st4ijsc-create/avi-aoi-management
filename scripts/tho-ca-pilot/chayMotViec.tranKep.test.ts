/**
 * Trần của thẻ BỊ KẸP xuống (khoá TRẦN LƯỢT MODEL > AI_AGENT_SO_LUOT_TOI_DA hoặc > mặc định 30) ⇒ MỘT dòng cảnh báo đầu lượt + JSON `tran` ghi theYeuCau / thucDung / biKep / lyDoKep.
 * ĐỘT BIẾN PHẢI BẮT: bỏ cảnh báo · cảnh báo khi KHÔNG kẹp · cảnh báo hai lần · biKep luôn true/false · lyDoKep sai nguồn (env vs mặc định) · so >= thay >.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, type Driver } from "./chayMotViec";
import type { ChayKiem } from "./kiemChung";
import { dongCanhBaoKep, tinhTranLuot } from "./tranLuot";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const the = (them = "") => `MÃ: TC-88
MỤC TIÊU: thử trần bị kẹp
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts
LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts
GIỚI HẠN: 15 phút, 8 vòng${them}`;
const chayKiemXanh: ChayKiem = async (lenh) => ({ lenh, exit: 0, hetGio: false, giay: 1, duoi: "", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } } });

let goc: string;
let wt: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tck-"));
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

const chay = async (them: string, env: Record<string, string> = {}) => {
  const nk: string[] = [];
  const drv: Driver = async () => ({ ghiChu: [], vong: 1, token: null, hetGio: false }) as never;
  const r = await chayMotViec({ van: the(them), wt, base: "HEAD", driver: drv, ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh, envTran: env as NodeJS.ProcessEnv, nhatKy: (s) => nk.push(s) });
  return { r, nk, canhBao: nk.filter((x) => x.startsWith("CẢNH BÁO: trần thẻ")) };
};

describe("tinhTranLuot — kẹp", () => {
  it("★★★ thẻ 60, env chưa đặt ⇒ kẹp về mặc định 30, lý do nêu 'mặc định 30' và biến chưa đặt", () => {
    const t = tinhTranLuot({ luotModel: 60 }, {});
    expect(t).toMatchObject({ theYeuCau: 60, thucDung: 30, luotThucDung: 30, biKep: true, lyDoKep: "mặc định 30 (AI_AGENT_SO_LUOT_TOI_DA chưa đặt)" });
  });
  it("★★★ thẻ 60, env 45 ⇒ kẹp 45, lý do nêu ĐÚNG biến và giá trị", () => {
    expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "45" })).toMatchObject({ thucDung: 45, biKep: true, lyDoKep: "AI_AGENT_SO_LUOT_TOI_DA=45" });
  });
  it("★★★ biến ĐÃ đặt nhưng KHÔNG hợp lệ ('abc', '0', '-5', '3.5') ⇒ lý do nêu 'không hợp lệ: \"<giá trị>\"', khác với 'chưa đặt'", () => {
    for (const v of ["abc", "0", "-5", "3.5"]) {
      expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: v })).toMatchObject({ biKep: true, thucDung: 30, lyDoKep: `mặc định 30 (AI_AGENT_SO_LUOT_TOI_DA không hợp lệ: "${v}")` });
    }
  });
  it("★★ biến rỗng / toàn khoảng trắng ⇒ coi là CHƯA đặt; giá trị dài bị cắt 24 ký tự; ký tự điều khiển đổi thành '?'", () => {
    expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "   " }).lyDoKep).toBe("mặc định 30 (AI_AGENT_SO_LUOT_TOI_DA chưa đặt)");
    expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "" }).lyDoKep).toBe("mặc định 30 (AI_AGENT_SO_LUOT_TOI_DA chưa đặt)");
    expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "x".repeat(40) }).lyDoKep).toBe(`mặc định 30 (AI_AGENT_SO_LUOT_TOI_DA không hợp lệ: "${"x".repeat(24)}")`);
    expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "ab" }).lyDoKep).toBe('mặc định 30 (AI_AGENT_SO_LUOT_TOI_DA không hợp lệ: "a?b")');
  });
  it("★★ biến không hợp lệ nhưng thẻ KHÔNG bị kẹp (thẻ ≤ 30) ⇒ không có lý do kẹp", () => {
    expect(tinhTranLuot({ luotModel: 20 }, { AI_AGENT_SO_LUOT_TOI_DA: "abc" })).toMatchObject({ biKep: false, lyDoKep: null });
  });
  it("★★★ env 500 (vượt trần cứng) tự kẹp về 120 ở soLuotToiDaTuEnv; thẻ 100 < 120 ⇒ KHÔNG kẹp", () => {
    expect(tinhTranLuot({ luotModel: 100 }, { AI_AGENT_SO_LUOT_TOI_DA: "500" })).toMatchObject({ thucDung: 100, biKep: false, lyDoKep: null });
    expect(tinhTranLuot({ luotModel: 120 }, { AI_AGENT_SO_LUOT_TOI_DA: "500" })).toMatchObject({ thucDung: 120, biKep: false });
  });
  it("★★★ thẻ BẰNG hoặc DƯỚI trần ⇒ không kẹp (biên: bằng)", () => {
    expect(tinhTranLuot({ luotModel: 30 }, {})).toMatchObject({ biKep: false, lyDoKep: null, theYeuCau: 30, thucDung: 30 });
    expect(tinhTranLuot({ luotModel: 20 }, {})).toMatchObject({ biKep: false });
    expect(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "60" })).toMatchObject({ biKep: false });
  });
  it("★★ thẻ không khoá lượt (chỉ TRẦN PHÚT) ⇒ theYeuCau null, không kẹp", () => {
    expect(tinhTranLuot({ phut: 25 }, {})).toMatchObject({ theYeuCau: null, biKep: false, lyDoKep: null });
  });
  it("★★ input vượt trần cứng trực tiếp (không qua thẻ) ⇒ kẹp bởi env/mặc định trước; còn 120 khi env =120", () => {
    expect(tinhTranLuot({ luotModel: 500 }, { AI_AGENT_SO_LUOT_TOI_DA: "120" })).toMatchObject({ thucDung: 120, biKep: true, lyDoKep: "AI_AGENT_SO_LUOT_TOI_DA=120" });
  });
  it("★★ dongCanhBaoKep: đúng chữ khi kẹp, null khi không", () => {
    expect(dongCanhBaoKep(tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "30" }))).toBe("CẢNH BÁO: trần thẻ 60 bị kẹp còn 30 bởi AI_AGENT_SO_LUOT_TOI_DA=30");
    expect(dongCanhBaoKep(tinhTranLuot({ luotModel: 60 }, {}))).toBe("CẢNH BÁO: trần thẻ 60 bị kẹp còn 30 bởi mặc định 30 (AI_AGENT_SO_LUOT_TOI_DA chưa đặt)");
    expect(dongCanhBaoKep(tinhTranLuot({ luotModel: 20 }, {}))).toBeNull();
  });
});

describe("chayMotViec — cảnh báo đầu lượt + JSON", () => {
  it("★★★ kẹp ⇒ ĐÚNG MỘT dòng cảnh báo, đứng NGAY SAU dòng 'bắt đầu'; JSON tran mang theYeuCau/thucDung/biKep/lyDoKep", async () => {
    const { r, nk, canhBao } = await chay("\nTRẦN LƯỢT MODEL: 60", { AI_AGENT_SO_LUOT_TOI_DA: "30" });
    expect(canhBao).toEqual(["CẢNH BÁO: trần thẻ 60 bị kẹp còn 30 bởi AI_AGENT_SO_LUOT_TOI_DA=30"]);
    expect(nk.indexOf(canhBao[0]!)).toBe(nk.findIndex((x) => x.startsWith("bắt đầu")) + 1); // ngay sau dòng 'bắt đầu', trước khi driver chạy
    expect(r.tran).toMatchObject({ theYeuCau: 60, thucDung: 30, biKep: true, lyDoKep: "AI_AGENT_SO_LUOT_TOI_DA=30" });
  });
  it("★★★ không kẹp (thẻ 20, hoặc thẻ 60 với env 60) ⇒ KHÔNG có dòng cảnh báo; JSON biKep=false, lyDoKep=null", async () => {
    for (const [them, env] of [["\nTRẦN LƯỢT MODEL: 20", {}], ["\nTRẦN LƯỢT MODEL: 60", { AI_AGENT_SO_LUOT_TOI_DA: "60" }]] as const) {
      const { r, canhBao } = await chay(them, env);
      expect(canhBao, them).toEqual([]);
      expect(r.tran).toMatchObject({ biKep: false, lyDoKep: null });
    }
  });
  it("★★★ thẻ KHÔNG khoá ⇒ không có `tran`, không cảnh báo (hành vi cũ)", async () => {
    const { r, canhBao } = await chay("", { AI_AGENT_SO_LUOT_TOI_DA: "5" });
    expect("tran" in r).toBe(false);
    expect(canhBao).toEqual([]);
  });
  it("★★ chỉ có TRẦN PHÚT ⇒ không cảnh báo kẹp dù env nhỏ", async () => {
    const { canhBao, r } = await chay("\nTRẦN PHÚT: 25", { AI_AGENT_SO_LUOT_TOI_DA: "5" });
    expect(canhBao).toEqual([]);
    expect(r.tran).toMatchObject({ theYeuCau: null, biKep: false });
  });
});
