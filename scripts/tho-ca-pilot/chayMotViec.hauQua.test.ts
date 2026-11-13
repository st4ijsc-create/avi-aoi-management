/**
 * HA-6b (phần 1) qua chayMotViec(): thẻ có `BẢNG ĐẾM:` + `--cho-phep-db` ⇒ đếm hàng trước lượt và sau lệnh kiểm cuối; chênh ở mục chấm ⇒ ketCuc `hau-qua-xau` (KHÔNG ĐẠT);
 * có cờ DB mà không đếm được ⇒ `hau-qua-xau` (fail-closed); không cờ DB ⇒ `khong-do-db` (không mở kết nối). Bộ đếm là bản giả tiêm vào — KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: bỏ đếm sau · bỏ hạ kết cục · lỗi đếm bị bỏ qua · mở kết nối khi không cờ DB · không đóng kết nối · BẢNG ĐẾM lọt vào lệnh đưa model.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, ghepLenh } from "./chayMotViec";
import type { MayDem } from "./hauQua";
import type { ChayKiem } from "./kiemChung";
import { docTheViec } from "./theViec";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const DAU = "MATKHAU_GIA_456";
const URL_GIA = `postgresql://tho_ca_test:${DAU}@127.0.0.1:5434/aoi_management_test`;
const TEP = "server/db/statisticsScope.test.ts";
const THE = (bang: string) => `MÃ: TC-95
MỤC TIÊU: thử hậu quả
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
CSDL: chạm aoi_management_test (CHỈ CSDL _test)
${bang === "" ? "" : `BẢNG ĐẾM:\n${bang}\n`}LỆNH KIỂM: npx vitest run ${TEP}
GIỚI HẠN: 1 phút, 3 vòng`;
const BANG = "factories WHERE code LIKE 'SS_FAC_%'\nmachines\nGHI: product_inspections";
const NGUON = `import { getDb } from "./connection";\nimport { it } from "vitest";\nit("x", () => { void getDb; });\n`;

let goc: string;
let wt: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tchq-"));
  wt = path.join(goc, "_tho_ca_wt_hq");
  ra = path.join(goc, "ra");
  fs.mkdirSync(path.join(wt, "server/db"), { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, TEP), `import { getDb } from "./connection";\nvoid getDb;\n`);
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

const xanh: ChayKiem = async (lenh) => ({ lenh, exit: 0, hetGio: false, giay: 1, duoi: "", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } } });

/** bộ đếm giả: lần mở thứ n trả `lan[n]` (bản đồ nhãn → số) hoặc ném lỗi quyền */
function moGia(lan: Array<Record<string, number> | "loi">) {
  const nk = { mo: 0, dong: 0, url: [] as string[], dem: 0 };
  const moMayDem = async (url: string) => {
    const n = nk.mo++;
    nk.url.push(url);
    const may: MayDem = {
      kiemDinhDanh: async () => null,
      dem: async (m) => {
        nk.dem++;
        const kq = lan[n];
        if (kq === "loi" || kq === undefined) throw Object.assign(new Error(`permission denied ${DAU}`), { code: "42501" });
        const nhan = m.cot ? `${m.bang} WHERE ${m.cot} ${m.toanTu} '${m.giaTri}'` : m.bang;
        return kq[nhan] ?? 0;
      },
    };
    return { may, dong: async () => void nk.dong++ };
  };
  return { nk, moMayDem };
}
const BAN_DAU = { "factories WHERE code LIKE 'SS_FAC_%'": 4, machines: 10, product_inspections: 100 };
const chay = (van: string, o: Partial<Parameters<typeof chayMotViec>[0]> = {}) =>
  chayMotViec({ van, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: xanh, khoGhi: { [TEP]: NGUON }, choPhepDb: true, testDbUrl: URL_GIA, ...o });

describe("HA-6b — kiểm hậu quả bằng đếm hàng", () => {
  it("★★★ đếm trước = sau ⇒ xong; JSON có bảng trước/sau/chênh từng mục; đếm 2 lần, đóng 2 lần; mục GHI chỉ ghi", async () => {
    const g = moGia([BAN_DAU, BAN_DAU]);
    const r = await chay(THE(BANG), { moMayDem: g.moMayDem });
    expect(r.ketCuc).toBe("xong");
    expect(r.hauQua).toMatchObject({ ketCuc: "ok", db: "co" });
    expect(r.hauQua!.bang).toEqual([
      { muc: "factories WHERE code LIKE 'SS_FAC_%'", ghi: false, truoc: 4, sau: 4, chenh: 0 },
      { muc: "machines", ghi: false, truoc: 10, sau: 10, chenh: 0 },
      { muc: "product_inspections", ghi: true, truoc: 100, sau: 100, chenh: 0 },
    ]);
    expect(g.nk).toMatchObject({ mo: 2, dong: 2, dem: 6 });
    expect(g.nk.url).toEqual([URL_GIA, URL_GIA]);
    expect(JSON.stringify(r)).not.toContain(DAU);
  });
  it("★★★ hàng ĐỔI ở mục chấm sau lệnh kiểm xanh ⇒ hau-qua-xau (ok:false), lý do nêu mục; lệnh kiểm vẫn xanh", async () => {
    const g = moGia([BAN_DAU, { ...BAN_DAU, machines: 12 }]);
    const r = await chay(THE(BANG), { moMayDem: g.moMayDem });
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.ok).toBe(false);
    expect(r.kiem).toMatchObject({ exit: 0 });
    expect(r.luuY?.join(" ")).toContain("machines 10→12 (+2)");
    expect(r.hauQua!.bang[1]).toMatchObject({ chenh: 2 });
  });
  it("★★★ chỉ mục GHI đổi ⇒ vẫn xong (số vẫn nằm trong JSON)", async () => {
    const g = moGia([BAN_DAU, { ...BAN_DAU, product_inspections: 130 }]);
    const r = await chay(THE(BANG), { moMayDem: g.moMayDem });
    expect(r.ketCuc).toBe("xong");
    expect(r.hauQua!.bang[2]).toMatchObject({ truoc: 100, sau: 130, chenh: 30 });
  });
  it("★★★ FAIL-CLOSED: đếm lỗi (quyền) ⇒ hau-qua-xau `khong-dem-duoc`, lý do KHÔNG chép thông điệp lỗi; mở kết nối lỗi cũng vậy", async () => {
    const g = moGia(["loi", "loi"]);
    const r = await chay(THE(BANG), { moMayDem: g.moMayDem });
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.hauQua).toMatchObject({ db: "khong-dem-duoc" });
    expect(r.luuY?.join(" ")).toContain("khong-dem-duoc");
    expect(r.luuY?.join(" ")).toContain("42501");
    expect(JSON.stringify(r)).not.toContain(DAU);
    expect(g.nk.dong).toBe(2);
    const r2 = await chay(THE(BANG), { khoGhi: { [TEP]: `${NGUON}// lần hai\n` }, moMayDem: async () => Promise.reject(new Error(`ECONNREFUSED ${DAU}`)) });
    expect(r2.ketCuc).toBe("hau-qua-xau");
    expect(r2.hauQua!.lyDo).toContain("không mở được kết nối đếm");
    expect(JSON.stringify(r2)).not.toContain(DAU);
  });
  it("★★★ KHÔNG cờ DB: thẻ có BẢNG ĐẾM ⇒ `khong-do-db`, không mở kết nối, không chấm (kết cục theo lệnh kiểm)", async () => {
    const g = moGia([]);
    const TEP2 = "server/x/a.test.ts";
    const van = THE(BANG).replace(/^CSDL:.*\n/m, "").split(TEP).join(TEP2);
    const r = await chayMotViec({ van, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: xanh, khoGhi: { [TEP2]: `import { it } from "vitest";\nit("x", () => { void 1; });\n` }, moMayDem: g.moMayDem });
    expect(r.ketCuc).toBe("xong");
    expect(r.hauQua).toEqual({ ketCuc: "ok", db: "khong-do-db", lyDo: null, bang: [] });
    expect(g.nk.mo).toBe(0);
  });
  it("★★ thẻ KHÔNG có BẢNG ĐẾM: không khoá hauQua, không mở kết nối", async () => {
    const g = moGia([]);
    const r = await chay(THE(""), { moMayDem: g.moMayDem });
    expect(r.ketCuc).toBe("xong");
    expect("hauQua" in r).toBe(false);
    expect(g.nk.mo).toBe(0);
  });
  it("★★★ BẢNG ĐẾM sai dạng (;, OR, subquery) ⇒ thẻ bị từ chối, chưa đếm gì", async () => {
    for (const xau of ["factories; drop table machines", "factories WHERE code = 'a' OR 1=1", "(select 1)"]) {
      const g = moGia([BAN_DAU]);
      const r = await chay(THE(xau), { moMayDem: g.moMayDem });
      expect(r.ketCuc, xau).toBe("tu-choi");
      expect(g.nk.mo).toBe(0);
    }
  });
  it("★★★ driver nhận `the` KHÔNG có bangDem (và lệnh không chứa tên bảng / giá trị)", async () => {
    let thay: unknown = null;
    let lenh = "";
    const g = moGia([BAN_DAU, BAN_DAU]);
    await chay(THE(BANG), {
      moMayDem: g.moMayDem,
      driver: async (v) => {
        thay = v.the;
        lenh = v.lenh;
        fs.writeFileSync(path.join(wt, TEP), NGUON);
        return { vong: 1, token: null, ghiChu: [], hetGio: false };
      },
    });
    expect(thay).not.toBeNull();
    expect("bangDem" in (thay as object)).toBe(false);
    for (const x of ["SS_FAC_", "product_inspections", "BẢNG ĐẾM"]) expect(lenh).not.toContain(x);
  });
  it("★★★ model KHÔNG thấy BẢNG ĐẾM: lệnh đưa model không chứa tên bảng / giá trị", () => {
    const d = docTheViec(THE(BANG));
    if (!d.ok) throw new Error(d.loi);
    expect(d.the.bangDem).toHaveLength(3);
    const lenh = ghepLenh(d.the, "# l\n", null);
    for (const x of ["SS_FAC_", "product_inspections", "BẢNG ĐẾM", "factories"]) expect(lenh).not.toContain(x);
  });
});
