/**
 * ★★★ Đợt 3a — LƯỚI DỊCH VỤ dự án cá nhân trên hệ tệp THẬT (thư mục tạm), tầng dữ liệu = kho BỘ NHỚ tiêm vào (lưới
 * CSDL thật + tuyến tRPC nằm ở `server/routers/duAnCaNhanRouter.test.ts`). Đo:
 *   §1 gốc quản lý: mặc định D:\AI-Projects ⇔ có ổ D, ngược lại <home>; gốc chồng lấn repo chính / hộp cát / dự án
 *      admin / kho checkpoint ⇒ GOC_QUAN_LY_KHONG_HOP_LE (cả hai chiều).
 *   §2 cách ly người dùng: thư mục `u<id>` theo id; junction `u<id>` ra ngoài ⇒ từ chối; dự án trỏ (junction) ra
 *      ngoài thư mục chủ / sang người khác ⇒ `duAnCaNhanDungCho` false.
 *   §3 tạo: rỗng / khuôn (4 khuôn THẬT của repo) / zip — đều có git + commit đầu; tên xấu, khuôn lạ; trần số + dung
 *      lượng; khoá một-lượt; hỏng giữa chừng ⇒ không để rác.
 *   §4 đổi tên / xoá vào thùng rác (chủ, admin được; người khác KHONG_TIM_THAY); dọn rác sau 30 ngày.
 *   §5 Q1: tệp trong dự án cá nhân KHÔNG phải "ghi vào repo chính" ⇒ chế độ tu-dong không bị Q1 chặn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  HAN_THUNG_RAC_MS,
  KHUON_CO_SAN,
  damBaoThuMucNguoiDung,
  doiTenDuAnCaNhan,
  donThungRac,
  kiemTraGocQuanLy,
  taoDuAnCaNhan,
  xoaDuAnCaNhan,
  type KhoDuAnCaNhan,
} from "./duAnCaNhan";
import { BIEN_GOC_DU_AN_CA_NHAN, duAnCaNhanDungCho, gocQuanLyMacDinh, thuMucNguoiDung, TEN_THUNG_RAC } from "../../aiLocalTools/gocDuAnCaNhan";
import { BIEN_DANH_SACH_GOC } from "../../aiLocalTools/repoProjects";
import { BIEN_GOC_HOP_CAT } from "../../aiLocalTools/repoSandbox";
import { BIEN_KHO_CHECKPOINT } from "../../aiLocalTools/khoCheckpoint";
import { laGhiVaoRepoChinh, gocRepoChinh } from "../../aiCodingTuTriGhi";

let TAM = "";
let GOC = ""; // AI_PROJECTS_ROOT của lưới
const CU: Record<string, string | undefined> = {};
const BIEN = [BIEN_GOC_DU_AN_CA_NHAN, BIEN_DANH_SACH_GOC, BIEN_GOC_HOP_CAT, BIEN_KHO_CHECKPOINT, "AI_PROJECTS_MAX_PER_USER", "AI_PROJECTS_MAX_BYTES_PER_USER"];

/** Kho bộ nhớ — cùng hợp đồng `KhoDuAnCaNhan` mà tầng dữ liệu thật thực thi. */
function khoNho(): KhoDuAnCaNhan & { hang: Map<string, { id: string; ten: string; goc: string; chuSoHuu: number }> } {
  const hang = new Map<string, { id: string; ten: string; goc: string; chuSoHuu: number }>();
  return {
    hang,
    dem: async (chu) => [...hang.values()].filter((h) => h.chuSoHuu === chu).length,
    them: async (m) => {
      if (hang.has(m.id)) return { ok: false };
      hang.set(m.id, { id: m.id, ten: m.ten, goc: m.goc, chuSoHuu: m.chuSoHuu });
      return { ok: true };
    },
    doc: async (id) => hang.get(id) ?? null,
    doiTen: async (id, chu, ten) => {
      const h = hang.get(id);
      if (!h || h.chuSoHuu !== chu) return { ok: false };
      h.ten = ten;
      return { ok: true };
    },
    xoa: async (id) => ({ ok: hang.delete(id) }),
    napLai: async () => undefined,
  };
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeAll(() => {
  TAM = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "duan3a-")));
});
afterAll(() => {
  fs.rmSync(TAM, { recursive: true, force: true });
});
beforeEach(() => {
  for (const k of BIEN) CU[k] = process.env[k];
  GOC = fs.mkdtempSync(path.join(TAM, "goc-"));
  process.env[BIEN_GOC_DU_AN_CA_NHAN] = GOC;
  const hopCat = path.join(TAM, "hop-cat-mac-dinh");
  fs.mkdirSync(hopCat, { recursive: true });
  process.env[BIEN_GOC_HOP_CAT] = hopCat;
  process.env[BIEN_DANH_SACH_GOC] = `repo=Repo|${hopCat}`;
  process.env[BIEN_KHO_CHECKPOINT] = path.join(TAM, "kho-checkpoint");
  delete process.env.AI_PROJECTS_MAX_PER_USER;
  delete process.env.AI_PROJECTS_MAX_BYTES_PER_USER;
});
afterEach(() => {
  for (const k of BIEN) {
    if (CU[k] === undefined) delete process.env[k];
    else process.env[k] = CU[k]!;
  }
});

describe("§1 — GỐC QUẢN LÝ", () => {
  it("★★ mặc định: Windows có ổ D ⇒ D:\\AI-Projects; không có ổ D / POSIX ⇒ <home>/AI-Projects", () => {
    expect(gocQuanLyMacDinh("win32", (p) => p === "D:\\", "C:\\Users\\k")).toBe("D:\\AI-Projects");
    expect(gocQuanLyMacDinh("win32", () => false, "C:\\Users\\k")).toBe(path.join("C:\\Users\\k", "AI-Projects"));
    expect(gocQuanLyMacDinh("linux", () => true, "/home/k")).toBe(path.join("/home/k", "AI-Projects"));
  });

  it("★★★ gốc NẰM TRONG repo chính ⇒ từ chối (agent tự động trên dự án cá nhân sẽ thành cửa sau vào mã server)", () => {
    process.env[BIEN_GOC_DU_AN_CA_NHAN] = path.join(gocRepoChinh(), "tmp", "ai-projects-thu");
    expect(kiemTraGocQuanLy()).toMatchObject({ ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE" });
  });

  it("★★★ gốc CHỨA kho checkpoint / nằm trong dự án admin / trùng hộp cát ⇒ từ chối (cả hai chiều)", () => {
    process.env[BIEN_KHO_CHECKPOINT] = path.join(GOC, "kho");
    expect(kiemTraGocQuanLy()).toMatchObject({ ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE" });
    process.env[BIEN_KHO_CHECKPOINT] = path.join(TAM, "kho-checkpoint");
    const admin = path.join(TAM, "du-an-admin");
    fs.mkdirSync(admin, { recursive: true });
    process.env[BIEN_DANH_SACH_GOC] = `repo=Repo|${process.env[BIEN_GOC_HOP_CAT]};adm=Admin|${admin}`;
    process.env[BIEN_GOC_DU_AN_CA_NHAN] = path.join(admin, "ca-nhan");
    expect(kiemTraGocQuanLy()).toMatchObject({ ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE" });
    process.env[BIEN_GOC_DU_AN_CA_NHAN] = process.env[BIEN_GOC_HOP_CAT]!;
    expect(kiemTraGocQuanLy()).toMatchObject({ ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE" });
  });

  it("★ gốc sạch ⇒ được nhận, TẠO nếu chưa có, trả realpath", () => {
    const moi = path.join(TAM, "goc-chua-co");
    process.env[BIEN_GOC_DU_AN_CA_NHAN] = moi;
    const kq = kiemTraGocQuanLy();
    expect(kq).toEqual({ ok: true, goc: fs.realpathSync.native(moi) });
  });
});

describe("§2 — CÁCH LY NGƯỜI DÙNG", () => {
  it("★★★ thư mục theo ID ổn định `u<id>` (không theo tên); hai người hai thư mục anh em", async () => {
    const kho = khoNho();
    const a = await taoDuAnCaNhan({ userId: 7, ten: "Trùng tên", cachTao: "rong" }, kho);
    const b = await taoDuAnCaNhan({ userId: 8, ten: "Trùng tên", cachTao: "rong" }, kho);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const ga = kho.hang.get(a.id)!.goc;
    const gb = kho.hang.get(b.id)!.goc;
    expect(path.basename(path.dirname(ga))).toBe("u7");
    expect(path.basename(path.dirname(gb))).toBe("u8");
    expect(duAnCaNhanDungCho(ga, 7)).toBe(true);
    expect(duAnCaNhanDungCho(ga, 8), "dự án của u7 KHÔNG đứng đúng chỗ của u8").toBe(false);
  });

  it("★★★ junction `u<id>` trỏ RA NGOÀI gốc ⇒ damBaoThuMucNguoiDung từ chối (không tạo dự án vào đó)", () => {
    const ngoai = path.join(TAM, "ngoai-u9");
    fs.mkdirSync(ngoai, { recursive: true });
    fs.symlinkSync(ngoai, path.join(GOC, "u9"), "junction");
    expect(damBaoThuMucNguoiDung(9, fs.realpathSync.native(GOC))).toMatchObject({ ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE" });
  });

  it("★★★ junction `u19` → `u20` (VẪN trong gốc — realpath cha khớp) ⇒ vẫn từ chối nhờ lstat: dự án u19 không rơi vào cây u20", () => {
    fs.mkdirSync(path.join(GOC, "u20"), { recursive: true });
    fs.symlinkSync(path.join(GOC, "u20"), path.join(GOC, "u19"), "junction");
    expect(damBaoThuMucNguoiDung(19, fs.realpathSync.native(GOC))).toMatchObject({ ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE" });
  });

  it("★★★ dự án là junction trong thư mục chủ trỏ ra ngoài (repo chính) ⇒ duAnCaNhanDungCho false", () => {
    fs.mkdirSync(thuMucNguoiDung(5), { recursive: true });
    const lienKet = path.join(thuMucNguoiDung(5), "u5-junction");
    fs.symlinkSync(gocRepoChinh(), lienKet, "junction");
    expect(duAnCaNhanDungCho(lienKet, 5)).toBe(false);
    expect(duAnCaNhanDungCho(thuMucNguoiDung(5), 5), "chính thư mục người dùng không phải một dự án").toBe(false);
  });
});

async function zipSach(): Promise<Buffer> {
  const z = new JSZip();
  z.file("src/main.py", "print('hi')\n");
  z.file("README.md", "# zip\n");
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("§3 — TẠO dự án", () => {
  it("★★★ rỗng ⇒ thư mục mới + `git init` + đúng 1 commit đầu, cây sạch", async () => {
    const kho = khoNho();
    const kq = await taoDuAnCaNhan({ userId: 3, ten: "Dự án rỗng", cachTao: "rong" }, kho);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    const goc = kho.hang.get(kq.id)!.goc;
    expect(git(["rev-list", "--count", "HEAD"], goc)).toBe("1");
    expect(git(["status", "--porcelain"], goc)).toBe("");
    expect(kq.id).toMatch(/^u3-[0-9a-f]{10}$/);
  });

  it.each(KHUON_CO_SAN.map((k) => [k]))("★★ khuôn THẬT `%s` (sandbox-projects/khuon) chép offline + commit đầu chứa tệp", async (k) => {
    const kho = khoNho();
    const kq = await taoDuAnCaNhan({ userId: 4, ten: `Khuôn ${k}`, cachTao: "khuon", khuon: k }, kho);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    const goc = kho.hang.get(kq.id)!.goc;
    const tep = git(["ls-files"], goc).split("\n").filter(Boolean);
    expect(tep.length).toBeGreaterThanOrEqual(3);
    expect(git(["status", "--porcelain"], goc)).toBe("");
  });

  it("★★ zip sạch ⇒ tệp vào đúng chỗ + commit; zip-slip ⇒ mã lỗi VÀ thư mục dở bị dọn", async () => {
    const kho = khoNho();
    const ok = await taoDuAnCaNhan({ userId: 6, ten: "Từ zip", cachTao: "zip", zip: await zipSach() }, kho);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(git(["ls-files"], kho.hang.get(ok.id)!.goc).split("\n").sort()).toEqual(["README.md", "src/main.py"]);

    const z = new JSZip();
    z.file("../thoat.txt", "x");
    const xau = await taoDuAnCaNhan({ userId: 6, ten: "Zip xấu", cachTao: "zip", zip: await z.generateAsync({ type: "nodebuffer" }) }, kho);
    expect(xau).toMatchObject({ ok: false, ma: "ZIP_DUONG_DAN_XAU" });
    expect(fs.readdirSync(thuMucNguoiDung(6)).length, "chỉ còn dự án hợp lệ — không rác").toBe(1);
    expect(kho.hang.size).toBe(1);
  });

  it("★ tên xấu / cách tạo lạ / khuôn lạ ⇒ mã đúng, không tạo gì", async () => {
    const kho = khoNho();
    expect(await taoDuAnCaNhan({ userId: 1, ten: "a|b", cachTao: "rong" }, kho)).toMatchObject({ ma: "TEN_KHONG_HOP_LE" });
    expect(await taoDuAnCaNhan({ userId: 1, ten: "", cachTao: "rong" }, kho)).toMatchObject({ ma: "TEN_KHONG_HOP_LE" });
    expect(await taoDuAnCaNhan({ userId: 1, ten: "x", cachTao: "tai-ve" }, kho)).toMatchObject({ ma: "CACH_TAO_KHONG_HOP_LE" });
    expect(await taoDuAnCaNhan({ userId: 1, ten: "x", cachTao: "khuon", khuon: "../../server" }, kho)).toMatchObject({ ma: "KHUON_KHONG_CO" });
    expect(await taoDuAnCaNhan({ userId: 1, ten: "x", cachTao: "zip" }, kho)).toMatchObject({ ma: "ZIP_THIEU" });
    expect(kho.hang.size).toBe(0);
  });

  it("★★★ trần SỐ dự án / người (env) ⇒ VUOT_TRAN_SO_DU_AN; người khác không bị ảnh hưởng", async () => {
    process.env.AI_PROJECTS_MAX_PER_USER = "2";
    const kho = khoNho();
    for (let i = 0; i < 2; i++) expect((await taoDuAnCaNhan({ userId: 11, ten: `p${i}`, cachTao: "rong" }, kho)).ok).toBe(true);
    expect(await taoDuAnCaNhan({ userId: 11, ten: "p3", cachTao: "rong" }, kho)).toMatchObject({ ok: false, ma: "VUOT_TRAN_SO_DU_AN" });
    expect((await taoDuAnCaNhan({ userId: 12, ten: "khac", cachTao: "rong" }, kho)).ok).toBe(true);
  });

  it("★★★ trần DUNG LƯỢNG / người ⇒ VUOT_TRAN_DUNG_LUONG và thư mục dở bị dọn", async () => {
    const kho = khoNho();
    process.env.AI_PROJECTS_MAX_BYTES_PER_USER = String(64 * 1024);
    const z = new JSZip();
    z.file("du-lieu.txt", "x".repeat(200 * 1024));
    const kq = await taoDuAnCaNhan({ userId: 13, ten: "lớn", cachTao: "zip", zip: await z.generateAsync({ type: "nodebuffer", compression: "STORE" }) }, kho);
    expect(kq).toMatchObject({ ok: false });
    expect(["VUOT_TRAN_DUNG_LUONG", "ZIP_QUA_LON"]).toContain((kq as { ma: string }).ma);
    expect(fs.readdirSync(thuMucNguoiDung(13))).toEqual([]);
  });

  it("★★ khoá MỘT lượt tạo / người: hai lượt song song ⇒ một DANG_TAO", async () => {
    const kho = khoNho();
    const [a, b] = await Promise.all([
      taoDuAnCaNhan({ userId: 14, ten: "a", cachTao: "rong" }, kho),
      taoDuAnCaNhan({ userId: 14, ten: "b", cachTao: "rong" }, kho),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ ma: "DANG_TAO" });
  });

  it("★★ lưu hàng hỏng ⇒ LUU_THAT_BAI và thư mục bị dọn", async () => {
    const kho = khoNho();
    kho.them = async () => ({ ok: false });
    expect(await taoDuAnCaNhan({ userId: 15, ten: "x", cachTao: "rong" }, kho)).toMatchObject({ ok: false, ma: "LUU_THAT_BAI" });
    expect(fs.readdirSync(thuMucNguoiDung(15))).toEqual([]);
  });
});

describe("§4 — ĐỔI TÊN / XOÁ VÀO THÙNG RÁC", () => {
  it("★★★ đổi tên: chủ được; người khác ⇒ KHONG_TIM_THAY (cùng mã với không tồn tại); admin được", async () => {
    const kho = khoNho();
    const kq = await taoDuAnCaNhan({ userId: 21, ten: "Cũ", cachTao: "rong" }, kho);
    if (!kq.ok) throw new Error("tạo hỏng");
    expect(await doiTenDuAnCaNhan({ id: 22, role: "engineer" }, kq.id, "Lấy trộm", kho)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await doiTenDuAnCaNhan({ id: 21, role: "engineer" }, "u21-khongco", "x", kho)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await doiTenDuAnCaNhan({ id: 21, role: "engineer" }, kq.id, "Mới", kho)).toEqual({ ok: true, id: kq.id, ten: "Mới" });
    expect(await doiTenDuAnCaNhan({ id: 1, role: "admin" }, kq.id, "Admin đặt", kho)).toMatchObject({ ok: true });
    expect(kho.hang.get(kq.id)!.ten).toBe("Admin đặt");
  });

  it("★★★ xoá = CHUYỂN vào `<gốc>/.thung-rac/<thời điểm>__<id>` (byte còn nguyên), hàng biến mất; người khác không xoá được", async () => {
    const kho = khoNho();
    const kq = await taoDuAnCaNhan({ userId: 31, ten: "Sẽ xoá", cachTao: "khuon", khuon: "python" }, kho);
    if (!kq.ok) throw new Error("tạo hỏng");
    const goc = kho.hang.get(kq.id)!.goc;
    expect(await xoaDuAnCaNhan({ id: 32, role: "engineer" }, kq.id, kho)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(fs.existsSync(goc)).toBe(true);
    const luc = 1_700_000_000_000;
    const x = await xoaDuAnCaNhan({ id: 31, role: "engineer" }, kq.id, kho, luc);
    expect(x.ok).toBe(true);
    expect(fs.existsSync(goc)).toBe(false);
    const rac = path.join(fs.realpathSync.native(GOC), TEN_THUNG_RAC, `${luc}__${kq.id}`);
    expect(x.ok && x.thungRac).toBe(rac);
    expect(fs.readFileSync(path.join(rac, "main.py"), "utf8")).toContain("Xin chào");
    expect(kho.hang.has(kq.id)).toBe(false);
  });

  it("★★ dọn thùng rác: mục < 30 ngày GIỮ, mục ≥ 30 ngày XOÁ CỨNG", () => {
    const gocThat = fs.realpathSync.native(GOC);
    const thung = path.join(gocThat, TEN_THUNG_RAC);
    const bayGio = 1_800_000_000_000;
    const moi = path.join(thung, `${bayGio - HAN_THUNG_RAC_MS + 60_000}__u1-moi`);
    const cu = path.join(thung, `${bayGio - HAN_THUNG_RAC_MS - 1}__u1-cu`);
    for (const d of [moi, cu]) fs.mkdirSync(d, { recursive: true });
    expect(donThungRac(gocThat, bayGio)).toBe(1);
    expect(fs.existsSync(moi)).toBe(true);
    expect(fs.existsSync(cu)).toBe(false);
  });

  it("★ xoá hàng hỏng ⇒ thư mục được chuyển VỀ chỗ cũ (không để hàng trỏ hư không)", async () => {
    const kho = khoNho();
    const kq = await taoDuAnCaNhan({ userId: 41, ten: "giữ", cachTao: "rong" }, kho);
    if (!kq.ok) throw new Error("tạo hỏng");
    const goc = kho.hang.get(kq.id)!.goc;
    kho.xoa = async () => ({ ok: false });
    expect(await xoaDuAnCaNhan({ id: 41, role: "engineer" }, kq.id, kho)).toMatchObject({ ok: false, ma: "XOA_THAT_BAI" });
    expect(fs.existsSync(goc)).toBe(true);
  });
});

describe("§5 — Q1: dự án cá nhân KHÔNG phải repo chính ⇒ vòng tu-dong không bị Q1 chặn", () => {
  it("★★★ laGhiVaoRepoChinh(gốc dự án cá nhân, tệp) = false; đối chứng: tệp server/ của repo chính = true", async () => {
    const kho = khoNho();
    const kq = await taoDuAnCaNhan({ userId: 51, ten: "q1", cachTao: "khuon", khuon: "node-ts" }, kho);
    if (!kq.ok) throw new Error("tạo hỏng");
    const goc = kho.hang.get(kq.id)!.goc;
    expect(laGhiVaoRepoChinh(goc, "src/index.ts")).toBe(false);
    expect(laGhiVaoRepoChinh(goc, "src/moi/tep-moi.ts")).toBe(false);
    expect(laGhiVaoRepoChinh(gocRepoChinh(), "server/_core/index.ts"), "đối chứng: Q1 vẫn bắt repo chính").toBe(true);
  });
});
