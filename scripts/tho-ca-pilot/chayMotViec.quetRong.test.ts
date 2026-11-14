/**
 * HA-6d qua chayMotViec(): `quetRong` + `--cho-phep-db` ⇒ count(*) MỌI bảng TRƯỚC lượt và SAU lệnh kiểm cuối; bảng NGOÀI thẻ `BẢNG ĐẾM:` đổi ⇒ ghi vào `quetRong` + `luuY`, KHÔNG đổi ketCuc.
 * Bộ quét và bộ đếm là bản giả tiêm vào — KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: quét khi không bật · quét không cờ DB · bảng ngoài thẻ làm đổi ketCuc · không quét SAU khi kết cục đã đỏ · lỗi quét làm ném / đổi kết cục · không đóng kết nối ·
 * URL sai · lộ mật khẩu · thẻ không BẢNG ĐẾM thì không quét được.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chayMotViec, main, thamSoQuetRongTuDongLenh } from "./chayMotViec";
import type { MayDem } from "./hauQua";
import type { ChayKiem } from "./kiemChung";
import type { MayQuet } from "./quetRong";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const DAU = "MATKHAU_GIA_789";
const URL_GIA = `postgresql://tho_ca_test:${DAU}@127.0.0.1:5434/aoi_management_test`;
const TEP = "server/db/statisticsScope.test.ts";
const THE = (bang: string) => `MÃ: TC-94
MỤC TIÊU: thử quét rộng
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
CSDL: chạm aoi_management_test (CHỈ CSDL _test)
${bang === "" ? "" : `BẢNG ĐẾM:\n${bang}\n`}LỆNH KIỂM: npx vitest run ${TEP}
GIỚI HẠN: 1 phút, 3 vòng`;
const NGUON = `import { getDb } from "./connection";\nimport { it } from "vitest";\nit("x", () => { void getDb; });\n`;

let goc: string;
let wt: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcqr-"));
  wt = path.join(goc, "_tho_ca_wt_qr");
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
const kiemDo: ChayKiem = async (lenh) => ({ lenh, exit: 1, hetGio: false, giay: 1, duoi: "FAIL", vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 1 } } });

/** bộ quét giả: lần mở thứ n trả `lan[n]` (bản đồ bảng → số) hoặc "mo-loi" (không mở được) hoặc "liet-ke-loi" */
function moQuetGia(lan: Array<Record<string, number | null> | "mo-loi" | "liet-ke-loi">) {
  const nk = { mo: 0, dong: 0, url: [] as string[] };
  const moMayQuet = async (url: string) => {
    const n = nk.mo++;
    nk.url.push(url);
    const kq = lan[n];
    if (kq === "mo-loi" || kq === undefined) throw Object.assign(new Error(`connect ${DAU}`), { code: "28P01" });
    const may: MayQuet = {
      lietKe: async () => {
        if (kq === "liet-ke-loi") throw Object.assign(new Error(`permission denied ${DAU}`), { code: "42501" });
        return Object.keys(kq);
      },
      dem: async (b) => (kq as Record<string, number | null>)[b] ?? null,
    };
    return { may, dong: async () => void nk.dong++ };
  };
  return { nk, moMayQuet };
}
/** bộ đếm HA-6b giả */
function moDemGia(lan: Array<Record<string, number>>) {
  const nk = { mo: 0 };
  const moMayDem = async () => {
    const n = nk.mo++;
    const may: MayDem = { kiemDinhDanh: async () => null, dem: async (m) => lan[n]?.[m.cot ? `${m.bang} WHERE ${m.cot} ${m.toanTu} '${m.giaTri}'` : m.bang] ?? 0 };
    return { may, dong: async () => undefined };
  };
  return { nk, moMayDem };
}
const BANG = "machines\nGHI: product_inspections";
/** `moMayDem` mặc định là bản giả (đếm 0) để KHÔNG BAO GIỜ mở kết nối thật tới 127.0.0.1:5434 khi thẻ có BẢNG ĐẾM */
const chay = (van: string, o: Partial<Parameters<typeof chayMotViec>[0]> = {}) =>
  chayMotViec({ van, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: xanh, khoGhi: { [TEP]: NGUON }, choPhepDb: true, testDbUrl: URL_GIA, moMayDem: moDemGia([{}, {}]).moMayDem, ...o });

describe("HA-6d — quét rộng count(*) mọi bảng trước/sau", () => {
  it("★★★ bảng NGOÀI thẻ đổi (+2): ghi vào quetRong.doi + ngoaiThe + luuY; ketCuc VẪN xong; quét 2 lần, đóng 2 lần, đúng URL; không lộ mật khẩu", async () => {
    const q = moQuetGia([{ machines: 10, product_inspections: 100, user_corporate_assignments: 5, audit_logs: 7 }, { machines: 10, product_inspections: 100, user_corporate_assignments: 7, audit_logs: 7 }]);
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet });
    expect(r.ketCuc).toBe("xong");
    expect(r.ok).toBe(true);
    expect(r.quetRong).toEqual({ ok: true, lyDo: null, soBang: 4, doi: [{ bang: "user_corporate_assignments", truoc: 5, sau: 7, chenh: 2 }], ngoaiThe: ["user_corporate_assignments"], khongDem: [], tongChenh: 2 });
    expect(q.nk).toMatchObject({ mo: 2, dong: 2 });
    expect(q.nk.url).toEqual([URL_GIA, URL_GIA]);
    expect(r.luuY?.join(" ")).toContain("HA-6d: bảng NGOÀI thẻ BẢNG ĐẾM đổi");
    expect(r.luuY?.join(" ")).toContain("user_corporate_assignments 5→7 (+2)");
    expect(JSON.stringify(r)).not.toContain(DAU);
  });
  it("★★★ bảng TRONG thẻ đổi (machines +1) mà HA-6b không đếm sai: ghi vào doi nhưng KHÔNG vào ngoaiThe, không có lưu ý HA-6d; ketCuc xong khi bộ đếm của thẻ thấy chênh 0 ở mục GHI", async () => {
    const q = moQuetGia([{ machines: 10, a: 1 }, { machines: 11, a: 1 }]);
    const d = moDemGia([{ machines: 10 }, { machines: 10 }]); // bộ đếm thẻ (giả) không thấy; quét rộng vẫn ghi doi
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet, moMayDem: d.moMayDem });
    expect(r.quetRong!.doi).toEqual([{ bang: "machines", truoc: 10, sau: 11, chenh: 1 }]);
    expect(r.quetRong!.ngoaiThe).toEqual([]);
    expect(r.luuY?.join(" ") ?? "").not.toContain("HA-6d");
  });
  it("★★★ bảng ngoài thẻ đổi KHÔNG làm đổi ketCuc: cùng bài làm, có quét rộng hay không đều ra `xong`; JSON không quét thì không có khoá quetRong", async () => {
    const q = moQuetGia([{ a: 1 }, { a: 99 }]);
    const co = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet });
    expect(co.ketCuc).toBe("xong");
    expect(co.quetRong!.tongChenh).toBe(98);
  });
  it("★★★ cùng bài làm KHÔNG bật quetRong: cũng `xong`, JSON không có khoá quetRong (cờ tắt ⇒ đầu ra không đổi)", async () => {
    const khong = await chay(THE(BANG), { moMayQuet: moQuetGia([{ a: 1 }, { a: 99 }]).moMayQuet });
    expect(khong.ketCuc).toBe("xong");
    expect("quetRong" in khong).toBe(false);
  });
  it("★★★ không bật quetRong ⇒ không mở kết nối quét nào (0 lần)", async () => {
    const q = moQuetGia([{ a: 1 }, { a: 2 }]);
    const r = await chay(THE(BANG), { moMayQuet: q.moMayQuet });
    expect(r.ketCuc).toBe("xong");
    expect(q.nk.mo).toBe(0);
  });
  it("★★★ kết cục ĐỎ vẫn quét SAU: kiem-do giữ nguyên, quetRong có số đo thật", async () => {
    const q = moQuetGia([{ a: 1, b: 5 }, { a: 1, b: 9 }]);
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet, chayKiem: kiemDo });
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.quetRong).toMatchObject({ ok: true, ngoaiThe: ["b"], tongChenh: 4 });
    expect(q.nk.mo).toBe(2);
  });
  it("★★★ quetRong mà KHÔNG có cờ DB ⇒ tu-choi (không quét, không mở kết nối)", async () => {
    const q = moQuetGia([{ a: 1 }, { a: 2 }]);
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet, choPhepDb: false, testDbUrl: undefined });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("--quet-rong cần --cho-phep-db");
    expect(q.nk.mo).toBe(0);
  });
  it("★★★ thẻ KHÔNG có BẢNG ĐẾM vẫn quét được (mọi bảng đổi đều là ngoài thẻ)", async () => {
    const q = moQuetGia([{ a: 1 }, { a: 4 }]);
    const r = await chay(THE(""), { quetRong: true, moMayQuet: q.moMayQuet });
    expect(r.ketCuc).toBe("xong");
    expect(r.quetRong).toMatchObject({ ok: true, ngoaiThe: ["a"], tongChenh: 3 });
  });
  it("★★★ quét SAU không mở được ⇒ quetRong ok:false (lý do nêu phía sau), KHÔNG ném, ketCuc giữ nguyên, lưu ý nêu quét không xong, không lộ mật khẩu", async () => {
    const q = moQuetGia([{ a: 1 }, "mo-loi"]);
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet });
    expect(r.ketCuc).toBe("xong");
    expect(r.quetRong).toMatchObject({ ok: false, lyDo: "sau: không mở được kết nối quét", soBang: 0, doi: [] });
    expect(r.luuY?.join(" ")).toContain("HA-6d: quét rộng không xong");
    expect(JSON.stringify(r)).not.toContain(DAU);
  });
  it("★★★ quét TRƯỚC không liệt kê được (lỗi quyền) ⇒ ok:false lý do chỉ tên lớp + mã, ketCuc xong, mật khẩu không lộ", async () => {
    const q = moQuetGia(["liet-ke-loi", { a: 1 }]);
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet });
    expect(r.ketCuc).toBe("xong");
    expect(r.quetRong).toMatchObject({ ok: false, lyDo: "trước: không liệt kê được bảng: Error 42501" });
    expect(JSON.stringify(r)).not.toContain(DAU);
    expect(q.nk.dong).toBe(2);
  });
  it("★★★ cùng lượt có hậu quả HA-6b xấu (bộ đếm thẻ thấy machines +2) và quét rộng: ketCuc hau-qua-xau do HA-6b, quetRong vẫn có", async () => {
    const q = moQuetGia([{ machines: 10, z: 1 }, { machines: 12, z: 1 }]);
    const d = moDemGia([{ machines: 10 }, { machines: 12 }]);
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: q.moMayQuet, moMayDem: d.moMayDem });
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.quetRong!.doi).toEqual([{ bang: "machines", truoc: 10, sau: 12, chenh: 2 }]);
  });
});

describe("HA-6d — cờ dòng lệnh", () => {
  afterEach(() => vi.restoreAllMocks());
  it("★★★ `--quet-rong` KHÔNG kèm `--cho-phep-db` ⇒ main trả 2 (từ chối ngay, chưa đọc thẻ), thông báo nêu cờ cần có", async () => {
    const ghi: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((s: unknown) => (ghi.push(String(s)), true)) as typeof process.stderr.write);
    const ma = await main(["--the", "khong-ton-tai.txt", "--quet-rong"]);
    expect(ma).toBe(2);
    expect(ghi.join("")).toContain("--quet-rong cần --cho-phep-db");
  });
});

describe("HA-6d — --quet-rong-cham (chấm) và cảnh báo ở đầu", () => {
  const ngoai = [{ machines: 10, user_corporate_assignments: 5 }, { machines: 10, user_corporate_assignments: 6 }];
  it("★★★ -cham: bảng NGOÀI thẻ đổi ⇒ ketCuc hau-qua-xau (ok:false); lý do nêu tên bảng; quetRong.cham=true; kết quả thẻ vẫn nêu tên bảng", async () => {
    const q = moQuetGia(ngoai);
    const r = await chay(THE(BANG), { quetRongCham: true, moMayQuet: q.moMayQuet });
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.ok).toBe(false);
    expect(r.quetRong).toMatchObject({ ok: true, cham: true, ngoaiThe: ["user_corporate_assignments"] });
    expect(r.luuY?.join(" ")).toContain("HA-6d (chấm): bảng NGOÀI thẻ BẢNG ĐẾM đổi: user_corporate_assignments");
    expect(q.nk.mo).toBe(2); // -cham hàm ý bật quét rộng, không cần thêm --quet-rong
  });
  it("★★★ -cham: chỉ bảng TRONG thẻ đổi (hoặc không bảng nào đổi) ⇒ KHÔNG nâng, ketCuc xong", async () => {
    const r1 = await chay(THE(BANG), { quetRongCham: true, moMayQuet: moQuetGia([{ machines: 10, a: 1 }, { machines: 11, a: 1 }]).moMayQuet });
    expect(r1.ketCuc).toBe("xong");
    expect(r1.quetRong).toMatchObject({ cham: true, ngoaiThe: [] });
  });
  it("★★★ -cham: quét KHÔNG xong ⇒ fail-closed hau-qua-xau, lý do nêu quét không xong, không lộ mật khẩu", async () => {
    const r = await chay(THE(BANG), { quetRongCham: true, moMayQuet: moQuetGia([{ a: 1 }, "mo-loi"]).moMayQuet });
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.luuY?.join(" ")).toContain("HA-6d (chấm): quét rộng không xong (sau: không mở được kết nối quét) — fail-closed");
    expect(JSON.stringify(r)).not.toContain(DAU);
  });
  it("★★★ -cham: kết cục ĐÃ đỏ (kiem-do) + bảng ngoài thẻ đổi ⇒ kết cục giữ nguyên kiem-do (không ghi đè)", async () => {
    const r = await chay(THE(BANG), { quetRongCham: true, moMayQuet: moQuetGia(ngoai).moMayQuet, chayKiem: kiemDo });
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.quetRong).toMatchObject({ cham: true, ngoaiThe: ["user_corporate_assignments"] });
  });
  it("★★★ -cham mà KHÔNG có cờ DB ⇒ tu-choi nêu đúng cờ, 0 lần mở", async () => {
    const q = moQuetGia(ngoai);
    const r = await chay(THE(BANG), { quetRongCham: true, moMayQuet: q.moMayQuet, choPhepDb: false, testDbUrl: undefined });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("--quet-rong-cham cần --cho-phep-db");
    expect(q.nk.mo).toBe(0);
  });
  it("★★★ chế độ thường: bảng ngoài thẻ đổi ⇒ canhBaoQuet NGAY SAU ketCuc trong JSON, luuY[0] là dòng đó, nhật ký có 'CẢNH BÁO'; ketCuc xong", async () => {
    const nk: string[] = [];
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: moQuetGia(ngoai).moMayQuet, nhatKy: (s) => nk.push(s) });
    expect(r.ketCuc).toBe("xong");
    const khoa = Object.keys(r);
    expect(khoa[khoa.indexOf("ketCuc") + 1]).toBe("canhBaoQuet");
    expect(r.canhBaoQuet).toHaveLength(1);
    expect(r.canhBaoQuet![0]).toContain("user_corporate_assignments 5→6 (+1)");
    expect(r.luuY![0]).toBe(r.canhBaoQuet![0]);
    expect(nk.filter((s) => s.startsWith("CẢNH BÁO HA-6d"))).toEqual([`CẢNH BÁO ${r.canhBaoQuet![0]}`]);
  });
  it("★★★ chế độ thường: bảng KHÔNG đếm được (quá hạn) ⇒ canhBaoQuet nêu 'chỗ MÙ' + tên bảng ở đầu; ketCuc xong; không có cảnh báo ⇒ không có khoá canhBaoQuet", async () => {
    const r = await chay(THE(BANG), { quetRong: true, moMayQuet: moQuetGia([{ machines: 10, lon: null }, { machines: 10, lon: null }]).moMayQuet });
    expect(r.ketCuc).toBe("xong");
    expect(r.canhBaoQuet).toEqual(["HA-6d: 1 bảng KHÔNG đếm được (quá hạn hoặc lỗi) — chỗ MÙ của phép quét: lon"]);
    expect(r.luuY![0]).toBe(r.canhBaoQuet![0]);
    const sach = await chay(THE(BANG).replace("TC-94", "TC-92"), { quetRong: true, moMayQuet: moQuetGia([{ machines: 1 }, { machines: 1 }]).moMayQuet });
    expect("canhBaoQuet" in sach).toBe(false);
  });
});

describe("HA-6d — cờ --quet-rong-cham ở dòng lệnh", () => {
  afterEach(() => vi.restoreAllMocks());
  it("★★★ `--quet-rong-cham` KHÔNG kèm `--cho-phep-db` ⇒ main trả 2, thông báo nêu cờ", async () => {
    const ghi: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((s: unknown) => (ghi.push(String(s)), true)) as typeof process.stderr.write);
    expect(await main(["--the", "khong-ton-tai.txt", "--quet-rong-cham"])).toBe(2);
    expect(ghi.join("")).toContain("--quet-rong-cham cần --cho-phep-db");
  });
});

describe("HA-6d — ca nghiệm thu thuần: mô phỏng TC-13 âm (10 bảng đổi: 9 trong thẻ + user_corporate_assignments)", () => {
  // số thật của lượt TC-13 âm 14/11: 6 bảng nền +1, product_inspections +8, measurement_point_defs +1, measurement_results +4, user_corporate_assignments +1 (ngoài thẻ) = 20 hàng
  const TRUOC = { factories: 0, workshops: 0, production_lines: 0, stations: 0, machines: 0, workstations: 0, product_inspections: 155182, measurement_point_defs: 0, measurement_results: 49968, user_corporate_assignments: 3, audit_logs: 1314346, users: 40 };
  const SAU = { factories: 1, workshops: 1, production_lines: 1, stations: 1, machines: 1, workstations: 1, product_inspections: 155190, measurement_point_defs: 1, measurement_results: 49972, user_corporate_assignments: 4, audit_logs: 1314346, users: 40 };
  const BANG9 = ["factories", "workshops", "production_lines", "stations", "machines", "workstations", "product_inspections", "measurement_point_defs", "measurement_results"].join("\n");
  it("★★★ --quet-rong-cham báo ĐỦ 10 bảng đổi (tổng +20), đúng 1 bảng ngoài thẻ; bảng không đổi (audit_logs, users) không có mặt; ketCuc hau-qua-xau", async () => {
    const q = moQuetGia([TRUOC, SAU]);
    const d = moDemGia([TRUOC, SAU]); // bộ đếm của thẻ (HA-6b) cũng thấy 9 bảng của nó đổi
    const r = await chay(THE(BANG9), { quetRongCham: true, moMayQuet: q.moMayQuet, moMayDem: d.moMayDem });
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.ok).toBe(false);
    expect(r.quetRong!.doi.map((x) => x.bang)).toEqual(["factories", "machines", "measurement_point_defs", "measurement_results", "product_inspections", "production_lines", "stations", "user_corporate_assignments", "workshops", "workstations"]);
    expect(r.quetRong!.doi).toHaveLength(10);
    expect(r.quetRong!.tongChenh).toBe(20);
    expect(r.quetRong!.ngoaiThe).toEqual(["user_corporate_assignments"]);
    expect(r.quetRong!.doi.find((x) => x.bang === "product_inspections")).toEqual({ bang: "product_inspections", truoc: 155182, sau: 155190, chenh: 8 });
    expect(r.quetRong!.doi.find((x) => x.bang === "user_corporate_assignments")).toEqual({ bang: "user_corporate_assignments", truoc: 3, sau: 4, chenh: 1 });
    expect(r.hauQua!.bang.filter((x) => x.chenh !== 0)).toHaveLength(9); // HA-6b chỉ thấy 9 bảng trong thẻ
    expect(r.canhBaoQuet![0]).toContain("user_corporate_assignments 3→4 (+1)");
  });
  it("★★★ cùng số liệu nhưng bộ đếm của thẻ KHÔNG thấy (chênh 0): chỉ -cham bắt được ⇒ ketCuc hau-qua-xau với lý do bảng ngoài thẻ", async () => {
    const d = moDemGia([TRUOC, TRUOC]);
    const r = await chay(THE(BANG9), { quetRongCham: true, moMayQuet: moQuetGia([TRUOC, SAU]).moMayQuet, moMayDem: d.moMayDem });
    expect(r.hauQua).toMatchObject({ ketCuc: "ok" });
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.luuY?.join(" ")).toContain("HA-6d (chấm): bảng NGOÀI thẻ BẢNG ĐẾM đổi: user_corporate_assignments");
  });
});

describe("HA-6d — thamSoQuetRongTuDongLenh (thuần)", () => {
  it("★★★ chuyển đúng hai cờ sang tham số; không cờ ⇒ cả hai false và không lỗi", () => {
    expect(thamSoQuetRongTuDongLenh({}, true)).toEqual({ quetRong: false, quetRongCham: false });
    expect(thamSoQuetRongTuDongLenh({ "quet-rong": "1" }, true)).toEqual({ quetRong: true, quetRongCham: false });
    expect(thamSoQuetRongTuDongLenh({ "quet-rong-cham": "1" }, true)).toEqual({ quetRong: false, quetRongCham: true });
    expect(thamSoQuetRongTuDongLenh({ "quet-rong": "1", "quet-rong-cham": "1" }, true)).toEqual({ quetRong: true, quetRongCham: true });
  });
  it("★★★ thiếu --cho-phep-db ⇒ lỗi nêu đúng cờ (-cham ưu tiên khi có cả hai); không cờ quét thì không lỗi dù không có cờ DB", () => {
    expect(thamSoQuetRongTuDongLenh({ "quet-rong": "1" }, false).loi).toBe("--quet-rong cần --cho-phep-db");
    expect(thamSoQuetRongTuDongLenh({ "quet-rong-cham": "1" }, false).loi).toBe("--quet-rong-cham cần --cho-phep-db");
    expect(thamSoQuetRongTuDongLenh({ "quet-rong": "1", "quet-rong-cham": "1" }, false).loi).toBe("--quet-rong-cham cần --cho-phep-db");
    expect(thamSoQuetRongTuDongLenh({}, false)).toEqual({ quetRong: false, quetRongCham: false });
  });
});
