/**
 * HA-9 — nối bộ quét tĩnh vào đường duyệt: hồ sơ chờ MANG `canhBao`, dang-cho.txt có dòng cảnh báo, duyet.ts trả lại cảnh báo, khoá thẻ CHO PHÉP TRONG TEST tắt cảnh báo oan,
 * thẻ SẠCH không đổi một byte (không khoá `canhBao`, dòng dang-cho.txt như cũ). KHÔNG tự chặn: thẻ có cảnh báo vẫn tới người duyệt và vẫn được chấp nhận.
 * ĐỘT BIẾN PHẢI BẮT: không gắn canhBao · gắn cả khi sạch · không đưa vào dang-cho.txt · chặn thẻ có cảnh báo · bỏ choPhepTrongTest · duyet.ts nuốt cảnh báo.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DauVaoDriver } from "./chayMotViec";
import { driverHost, duyetQuaTep, tepChoDuyet, tepDangCho, type ChinhSachDuyet, type HoSoCho, type PhuThuocHost } from "./driverHost";
import { ghiQuyet } from "./duyet";
import { docTheViec, type TheViec } from "./theViec";

const THE: TheViec = { ma: "TC-77", mucTieu: "x", tepDuocPhep: ["server/db/a.test.ts"], nguCanhDoc: [], lenhKiem: "npx vitest run server/db/a.test.ts", gioiHan: { giay: 5, vong: 3 } };
const WT = path.resolve(os.tmpdir(), "_tho_ca_wt_ao");

type Su = { loai: string; [k: string]: unknown };
function taoDep(kichBan: (phat: (e: Su) => void) => Promise<void> | void, chinhSach: ChinhSachDuyet) {
  const duyet: string[] = [];
  let f: ((m: { seq: number; suKien: Su }) => void) | null = null;
  let seq = 0;
  const dep: PhuThuocHost = {
    kiemMoiTruong: async () => null,
    taoLuot: async () => {
      setTimeout(() => void kichBan((e) => f?.({ seq: seq++, suKien: e })), 30);
      return { ok: true, runId: "r1" };
    },
    nghe: (_r, fn) => {
      f = fn as never;
      return () => {
        f = null;
      };
    },
    huy: () => undefined,
    duyet: async (id) => (duyet.push(id), { ok: true, daGhi: true, status: "executed" }),
    bac: async () => undefined,
    duAnId: () => "_tho_ca_wt_ao",
    chinhSachDuyet: chinhSach,
    bay: () => Date.now(),
    datKhoaKy: () => ({ ok: true, tam: false }),
  };
  return { dep, duyet };
}
const dauVao = (ra: string, the: TheViec = THE): DauVaoDriver => ({ the, wt: WT, lenh: "L", hanGiay: 5, ra, ghiLuotDir: null, khoGhi: {} });
/** thẻ ghi tệp cho phép; `moi` là nội dung bản MỚI, `cu` bản cũ */
const canDuyet = (cu: string, moi: string, id = "act-1") => ({
  loai: "can-duyet",
  id: "tc1",
  deXuat: { ten: "write_file", thamSo: { path: "server/db/a.test.ts", content: moi }, moTa: "m", pendingActionId: id, xemTruoc: { args: { path: "server/db/a.test.ts", original: cu, modified: moi } } },
});
const KET = async (phat: (e: Su) => void) => {
  await new Promise((r) => setTimeout(r, 120));
  phat({ loai: "xong", lyDo: "hoan-thanh" });
};

let ra: string;
beforeEach(() => {
  ra = fs.mkdtempSync(path.join(os.tmpdir(), "drv-cb-"));
});
afterEach(() => fs.rmSync(ra, { recursive: true, force: true }));

async function chayVoiNoiDung(cu: string, moi: string, the: TheViec = THE) {
  const thay: HoSoCho[] = [];
  const { dep, duyet } = taoDep(async (phat) => {
    phat(canDuyet(cu, moi));
    await KET(phat);
  }, async (h) => (thay.push(h), { quyet: "chap-nhan" }));
  const kq = await driverHost(dep)(dauVao(ra, the));
  return { h: thay[0]!, kq, duyet };
}

describe("driverHost — hồ sơ chờ mang canhBao (HA-9)", () => {
  it("★★★ thêm dòng nguy hiểm ⇒ hồ sơ có canhBao đúng mẫu + số dòng; thẻ VẪN tới người duyệt và được chấp nhận (không tự chặn)", async () => {
    const { h, kq, duyet } = await chayVoiNoiDung("a\nb", 'a\nb\nconst x = process.env.DATABASE_URL;\nspawn("ls");');
    expect(h.canhBao?.map((c) => [c.mau, c.dong])).toEqual(expect.arrayContaining([["database-url", 3], ["process-env", 3], ["child-process", 4]]));
    expect(duyet).toEqual(["act-1"]);
    expect(kq.duyet).toMatchObject({ soLanCho: 1, soChapNhan: 1 });
    expect(kq.ghiChu.join(" ")).toMatch(/CANH BAO \d+: .*child-process/);
  });
  it("★★★ thẻ SẠCH ⇒ hồ sơ KHÔNG có khoá canhBao (không đổi byte), ghiChu không nhắc cảnh báo", async () => {
    const { h, kq } = await chayVoiNoiDung("a", "a\nconst y = 1 + 2;");
    expect("canhBao" in h).toBe(false);
    expect(kq.ghiChu.join(" ")).not.toMatch(/CANH BAO/);
  });
  it("★★★ chỉ quét phần MỚI: dòng nguy hiểm đã có ở bản cũ ⇒ không cảnh báo", async () => {
    const { h } = await chayVoiNoiDung('spawn("ls");\nx', 'spawn("ls");\nx\ny');
    expect("canhBao" in h).toBe(false);
  });
  it("★★★ CHO PHÉP TRONG TEST (khoá thẻ) tắt cảnh báo oan, phần khác vẫn còn", async () => {
    const lay = docTheViec(`MÃ: TC-77
MỤC TIÊU: x
TỆP ĐƯỢC PHÉP SỬA/TẠO: server/db/a.test.ts
LỆNH KIỂM: npx vitest run server/db/a.test.ts
CHO PHÉP TRONG TEST: process.env.DATABASE_URL, vi.mock("./connection")`);
    expect(lay.ok && lay.the.choPhepTrongTest).toEqual(["process.env.DATABASE_URL", 'vi.mock("./connection")']);
    if (!lay.ok) throw new Error(lay.loi);
    const { h } = await chayVoiNoiDung("a", 'a\nconst u = process.env.DATABASE_URL;\nspawn("ls");', lay.the);
    expect(h.canhBao?.map((c) => c.mau)).toEqual(["child-process"]);
  });
  it("★★ lỗi bộ quét không làm hỏng lượt (xemTruoc kỳ lạ ⇒ vẫn tới người duyệt)", async () => {
    const thay: HoSoCho[] = [];
    const { dep } = taoDep(async (phat) => {
      phat({ loai: "can-duyet", id: "tc1", deXuat: { ten: "write_file", thamSo: { path: "server/db/a.test.ts" }, moTa: "m", pendingActionId: "act-2", xemTruoc: { args: { modified: 12345 } } } });
      await KET(phat);
    }, async (h) => (thay.push(h), { quyet: "chap-nhan" }));
    const kq = await driverHost(dep)(dauVao(ra));
    expect(thay).toHaveLength(1);
    expect(kq.duyet).toMatchObject({ soChapNhan: 1 });
  });
  it("★★★ bộ quét NÉM LỖI (getter ném khi đọc args.modified) ⇒ lượt KHÔNG hỏng, ghiChu có 'bộ quét tĩnh lỗi (bỏ qua)', thẻ vẫn tới người duyệt và không có canhBao", async () => {
    const thay: HoSoCho[] = [];
    const args = {
      path: "server/db/a.test.ts",
      original: "a",
      get modified(): string {
        throw new Error("getter-no-bom");
      },
    };
    const { dep, duyet } = taoDep(async (phat) => {
      phat({ loai: "can-duyet", id: "tc1", deXuat: { ten: "write_file", thamSo: { path: "server/db/a.test.ts" }, moTa: "m", pendingActionId: "act-q24", xemTruoc: { args } } });
      await KET(phat);
    }, async (h) => (thay.push(h), { quyet: "chap-nhan" })); // KHÔNG ghi JSON ở đây: getter ném sẽ làm JSON.stringify hỏng
    const kq = await driverHost(dep)(dauVao(ra));
    expect(thay).toHaveLength(1);
    expect("canhBao" in thay[0]!).toBe(false);
    expect(duyet).toEqual(["act-q24"]);
    expect(kq.duyet).toMatchObject({ soLanCho: 1, soChapNhan: 1 });
    expect(kq.ghiChu.join(" ")).toContain("bộ quét tĩnh lỗi (bỏ qua): getter-no-bom");
  });
  it("★★ dòng 550 KB lặp `require   ` ⇒ xong nhanh, hồ sơ mang cảnh báo `dong-qua-dai`", async () => {
    const dai = "require   ".repeat(55_000);
    const t0 = Date.now();
    const { h } = await chayVoiNoiDung("a", `a\n${dai}`);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(h.canhBao?.map((c) => [c.mau, c.dong])).toEqual([["dong-qua-dai", 2]]);
  });
});

describe("dang-cho.txt + duyet.ts (HA-9)", () => {
  const ho = (canhBao?: HoSoCho["canhBao"]): HoSoCho => ({ ma: "TC-99", id: "act-9", ten: "write_file", duong: ["a.ts"], moTa: null, lyDoModel: null, xemTruoc: null, thamSo: {}, nguonDangNgo: [], luc: new Date().toISOString(), hetHanLuc: "2026-11-13T07:00:00.000Z", ...(canhBao ? { canhBao } : {}) });
  const cb = [{ mau: "child-process" as const, dong: 4, manh: "spawn(", trich: 'spawn("ls");' }, { mau: "mang-ngoai" as const, dong: 5, manh: "fetch(", trich: "fetch(u)" }];
  it("★★★ dòng ĐẦU dang-cho.txt có `| CANH BAO n: mẫu,mẫu` khi có cảnh báo; thẻ sạch giữ NGUYÊN dòng cũ", async () => {
    const p = duyetQuaTep(ho(cb), { ra, hanMs: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(fs.readFileSync(tepDangCho(ra), "utf8")).toBe("TC-99 write_file a.ts id=act-9 HET HAN 2026-11-13T07:00:00.000Z | CANH BAO 2: child-process,mang-ngoai\n");
    expect(JSON.parse(fs.readFileSync(tepChoDuyet(ra, "TC-99"), "utf8")).canhBao).toHaveLength(2);
    ghiQuyet({ ma: "TC-99", id: "act-9", quyet: "tu-choi", ra });
    await p;

    const p2 = duyetQuaTep(ho(), { ra, hanMs: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(fs.readFileSync(tepDangCho(ra), "utf8")).toBe("TC-99 write_file a.ts id=act-9 HET HAN 2026-11-13T07:00:00.000Z\n");
    expect("canhBao" in JSON.parse(fs.readFileSync(tepChoDuyet(ra, "TC-99"), "utf8"))).toBe(false);
    ghiQuyet({ ma: "TC-99", id: "act-9", quyet: "tu-choi", ra });
    await p2;
  });
  it("★★★ duyet.ts (ghiQuyet) trả canhBao của hồ sơ để người duyệt thấy; thẻ sạch ⇒ không có khoá", async () => {
    const p = duyetQuaTep(ho(cb), { ra, hanMs: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    const kq = ghiQuyet({ ma: "TC-99", id: "act-9", quyet: "chap-nhan", ra });
    expect(kq).toMatchObject({ ok: true });
    expect(kq.ok && kq.canhBao?.map((c) => c.mau)).toEqual(["child-process", "mang-ngoai"]);
    await p;
    const p2 = duyetQuaTep(ho(), { ra, hanMs: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    const kq2 = ghiQuyet({ ma: "TC-99", id: "act-9", quyet: "chap-nhan", ra });
    expect(kq2.ok && "canhBao" in kq2).toBe(false);
    await p2;
  });
});
