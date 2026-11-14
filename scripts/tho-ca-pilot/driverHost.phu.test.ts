/**
 * HA-10 — dòng PHỦ trong vòng TỰ CHẠY lệnh kiểm của driverHost: host sinh từ quét TĨNH tệp test của worktree (số dòng + tag), kèm vào lời nhắc model
 * (cả chế độ chi-so), nhắc dòng THIẾU tối đa 2 lần/lượt; không bật `phu` ⇒ lời nhắc bằng đúng tóm tắt cũ.
 * ĐỘT BIẾN PHẢI BẮT: không kèm PHỦ · kèm cả khi không bật · bỏ trần 2 lần · chế độ chi-so không kèm · đọc tệp test từ nơi khác worktree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DauVaoDriver } from "./chayMotViec";
import { driverHost, tomTatKiemChoModel, tomTatChiSoChoModel, type ChinhSachDuyet, type PhuThuocHost } from "./driverHost";
import type { DongDuyet } from "./kiemPhu";
import type { KetQuaKiem } from "./kiemChung";
import type { TheViec } from "./theViec";

const THE: TheViec = { ma: "TC-78", mucTieu: "x", tepDuocPhep: ["a.test.ts"], nguCanhDoc: [], lenhKiem: "npx vitest run a.test.ts", gioiHan: { giay: 5, vong: 3 } };
const DONG: DongDuyet[] = [
  { k: 1, giu: false, noiDung: "n ≤ 0 ⇒ N=1" },
  { k: 2, giu: false, noiDung: "n lớn ⇒ cắt 100" },
  { k: 3, giu: true, noiDung: "GIỮ: hành vi cũ" },
];
const CA1 = 'it("[D1] n ≤ 0 ⇒ 1", () => { expect(f(0)).toBe(1); });\n';
const CA2 = 'it("[D2] n lớn ⇒ 100", () => { expect(f(999)).toBe(100); });\n';

type Su = { loai: string; [k: string]: unknown };
const kiemFake = (): KetQuaKiem => ({ lenh: "x", exit: 0, hetGio: false, giay: 1, duoi: "ok", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } } });
const canChay = (id: string) => ({ loai: "can-duyet", id: `tc-${id}`, deXuat: { ten: "run_command", thamSo: { command: THE.lenhKiem }, moTa: "m", pendingActionId: id, xemTruoc: "diff" } });

function taoDep(soLan: number) {
  const bac: string[] = [];
  let f: ((m: { seq: number; suKien: Su }) => void) | null = null;
  let seq = 0;
  const dep: PhuThuocHost = {
    kiemMoiTruong: async () => null,
    taoLuot: async () => {
      setTimeout(
        () =>
          void (async () => {
            const phat = (e: Su) => f?.({ seq: seq++, suKien: e });
            for (let i = 1; i <= soLan; i++) {
              phat(canChay(`rc${i}`));
              await new Promise((r) => setTimeout(r, 80));
            }
            phat({ loai: "xong", lyDo: "hoan-thanh" });
          })(),
        30,
      );
      return { ok: true, runId: "r1" };
    },
    nghe: (_r, fn) => {
      f = fn as never;
      return () => {
        f = null;
      };
    },
    huy: () => undefined,
    duyet: async () => ({ ok: true, daGhi: true, status: "executed" }),
    bac: async (_id, ly) => {
      bac.push(ly);
    },
    duAnId: () => "_tho_ca_wt_ao",
    chinhSachDuyet: (async () => ({ quyet: "tu-choi" })) as ChinhSachDuyet,
    bay: () => Date.now(),
    datKhoaKy: () => ({ ok: true, tam: false }),
    chayKiem: async () => kiemFake(),
  };
  return { dep, bac };
}

let wt: string;
let ra: string;
beforeEach(() => {
  wt = fs.mkdtempSync(path.join(os.tmpdir(), "drv-phu-wt-"));
  ra = fs.mkdtempSync(path.join(os.tmpdir(), "drv-phu-ra-"));
});
afterEach(() => {
  fs.rmSync(wt, { recursive: true, force: true });
  fs.rmSync(ra, { recursive: true, force: true });
});
const dauVao = (over: Partial<DauVaoDriver> = {}): DauVaoDriver => ({
  the: THE,
  wt,
  lenh: "L",
  hanGiay: 5,
  ra,
  ghiLuotDir: null,
  khoGhi: {},
  phu: { dongDuyet: DONG, tenCaCu: new Set(), tepTest: ["a.test.ts"] },
  ...over,
});

describe("driverHost — dòng PHỦ trong lời nhắc tự chạy lệnh kiểm (HA-10)", () => {
  it("★★★ thiếu dòng 2 ⇒ lời nhắc có `PHỦ: dòng 2 chưa có ca … [D2]` (không nhắc dòng 1 đã đủ, không nhắc dòng GIỮ 3); ghiChu + soLanNhacPhu", async () => {
    fs.writeFileSync(path.join(wt, "a.test.ts"), CA1);
    const { dep, bac } = taoDep(1);
    const kq = await driverHost(dep)(dauVao());
    expect(bac).toHaveLength(1);
    expect(bac[0]).toContain("PHỦ: dòng 2 chưa có ca");
    expect(bac[0]).toContain("[D2]");
    expect(bac[0]).not.toContain("[D1]");
    expect(bac[0]).not.toContain("[D3]");
    expect(kq.ghiChu.join(" ")).toContain("PHỦ lần 1: thiếu dòng 2");
    expect(kq.soLanNhacPhu).toBe(1);
  });
  it("★★★ đủ cả hai dòng cần phủ ⇒ dòng xác nhận `PHỦ: đủ 2/2`, không đếm là nhắc thiếu", async () => {
    fs.writeFileSync(path.join(wt, "a.test.ts"), CA1 + CA2);
    const { dep, bac } = taoDep(1);
    const kq = await driverHost(dep)(dauVao());
    expect(bac[0]).toContain("PHỦ: đủ 2/2");
    expect(bac[0]).not.toContain("chưa có ca");
    expect(kq.soLanNhacPhu).toBe(0);
  });
  it("★★★ chế độ chi-so vẫn kèm dòng PHỦ (chỉ số dòng + tag do host sinh, không từ đầu ra test) và vẫn là tóm tắt chi-so", async () => {
    fs.writeFileSync(path.join(wt, "a.test.ts"), CA1);
    const { dep, bac } = taoDep(1);
    await driverHost(dep)(dauVao({ cheDoKiem: "chi-so" }));
    expect(bac[0]!.startsWith(tomTatChiSoChoModel(kiemFake(), 1, []))).toBe(true);
    expect(bac[0]).toContain("PHỦ: dòng 2 chưa có ca");
  });
  it("★★★ không bật `phu` ⇒ lời nhắc bằng ĐÚNG tóm tắt cũ, không có chữ PHỦ, soLanNhacPhu vắng", async () => {
    fs.writeFileSync(path.join(wt, "a.test.ts"), CA1);
    const { dep, bac } = taoDep(1);
    const kq = await driverHost(dep)(dauVao({ phu: undefined }));
    expect(bac).toEqual([tomTatKiemChoModel(kiemFake(), 1)]);
    expect("soLanNhacPhu" in kq).toBe(false);
  });
  it("★★★ nhắc dòng THIẾU tối đa 2 lần/lượt: lần 3, 4 không kèm PHỦ nữa; soLanNhacPhu = 2", async () => {
    fs.writeFileSync(path.join(wt, "a.test.ts"), CA1);
    const { dep, bac } = taoDep(4);
    const kq = await driverHost(dep)(dauVao());
    expect(bac).toHaveLength(4);
    expect(bac.map((b) => b.includes("PHỦ:"))).toEqual([true, true, false, false]);
    expect(kq.soLanNhacPhu).toBe(2);
  });
  it("★★ model thêm ca giữa lượt: lần chạy 1 thiếu, lần chạy 2 đủ ⇒ lời nhắc đổi từ thiếu sang `đủ` (đọc tệp từ worktree MỖI lần)", async () => {
    fs.writeFileSync(path.join(wt, "a.test.ts"), CA1);
    const { dep, bac } = taoDep(2);
    const goc = dep.chayKiem!;
    let lan = 0;
    dep.chayKiem = async (...a) => {
      if (++lan === 2) fs.writeFileSync(path.join(wt, "a.test.ts"), CA1 + CA2);
      return goc(...a);
    };
    await driverHost(dep)(dauVao());
    expect(bac[0]).toContain("chưa có ca");
    expect(bac[1]).toContain("PHỦ: đủ 2/2");
  });
});

describe("driverHost — HA-10 bổ sung (kiem-dinh d2)", () => {
  it("★★★ đã nhắc THIẾU đủ 2 lần mà lần 3 model đã phủ đủ ⇒ dòng `PHỦ: đủ 2/2` VẪN được gửi (trần 2 lần chỉ áp cho dòng thiếu); soLanNhacPhu vẫn 2", async () => {
    fs.writeFileSync(path.join(wt, "a.test.ts"), CA1);
    const { dep, bac } = taoDep(3);
    const goc = dep.chayKiem!;
    let lan = 0;
    dep.chayKiem = async (...a) => {
      if (++lan === 3) fs.writeFileSync(path.join(wt, "a.test.ts"), CA1 + CA2);
      return goc(...a);
    };
    const kq = await driverHost(dep)(dauVao());
    expect(bac).toHaveLength(3);
    expect(bac[0]).toContain("PHỦ: dòng 2 chưa có ca");
    expect(bac[1]).toContain("PHỦ: dòng 2 chưa có ca");
    expect(bac[2]).toContain("PHỦ: đủ 2/2");
    expect(kq.soLanNhacPhu).toBe(2);
  });
});
