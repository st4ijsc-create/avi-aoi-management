import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, ghepLenh, driverKho, type Driver } from "./chayMotViec";
import { docTheViec } from "./theViec";
import type { ChayKiem, KetQuaKiem } from "./kiemChung";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

const THE = (tep = "client/src/lib/a.test.ts") => `MÃ: TC-99
MỤC TIÊU: thử bộ chạy
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${tep}
LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts
GIỚI HẠN: 1 phút, 3 vòng`;

let goc: string;
let ra: string;
let wt: string;

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcp-"));
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

const kiemXanh: KetQuaKiem = {
  lenh: "x",
  exit: 0,
  hetGio: false,
  giay: 1,
  duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } },
};
/** Mặc định: lệnh kiểm GIẢ xanh (ca kiểm đơn vị không chạy npx thật). Các ca L3a cuối tệp tiêm bản riêng. */
const chayKiemXanh: ChayKiem = async (lenh) => ({ ...kiemXanh, lenh });
const chay = (over: Partial<Parameters<typeof chayMotViec>[0]> = {}) =>
  chayMotViec({ van: THE(), wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# luat thu\n", chayKiem: chayKiemXanh, ...over });

describe("chayMotViec — chạy khô (driver kho, không model)", () => {
  it("★ ghi đúng tệp được phép ⇒ ok, diff thu đủ tệp MỚI, AGENTS.md không lẫn, KHÔNG commit", async () => {
    const head0 = git(wt, "rev-parse", "HEAD");
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "import { it } from 'vitest';\nit('x', () => {});\n" } });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", ma: "TC-99", nhanh: "pilot/tho-ca-TC-99", driver: "kho", vong: 1 });
    expect(r.tepDoi).toEqual(["client/src/lib/a.test.ts"]);
    expect(r.dong).toEqual({ them: 2, xoa: 0 });
    expect(r.viPham).toEqual([]);
    expect(fs.readFileSync(r.diff!, "utf8")).toContain("+it('x'");
    expect(git(wt, "rev-parse", "HEAD")).toBe(head0); // không commit
    expect(git(wt, "branch", "--show-current")).toBe("pilot/tho-ca-TC-99");
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe("# luat thu\n");
    expect(r.luuY?.join(" ")).toMatch(/token/);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // một dòng JSON tuần tự hoá được
  });

  it("★ chạm tệp NGOÀI danh sách + VÙNG CẤM ⇒ vi-pham, nêu từng tệp", async () => {
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "a\n", "client/src/lib/khac.ts": "b\n", "server/services/ot/x.ts": "c\n" } });
    expect(r.ok).toBe(false);
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.viPham).toEqual(expect.arrayContaining([{ duong: "client/src/lib/khac.ts", loai: "ngoai-danh-sach" }, { duong: "server/services/ot/x.ts", loai: "vung-cam", chiTiet: "ot" }]));
    expect(r.viPham).toHaveLength(2);
  });

  it("★ tệp có CRLF ⇒ vi-pham (luật LF)", async () => {
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "a\r\nb\r\n" } });
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.crlf).toEqual(["client/src/lib/a.test.ts"]);
  });

  it("★ không có thay đổi nào và không lỗi ⇒ khong-lam, ok:false (KHÔNG BAO GIỜ 'xong' khi không làm gì)", async () => {
    const r = await chay();
    expect(r).toMatchObject({ ok: false, ketCuc: "khong-lam", tepDoi: [], dong: { them: 0, xoa: 0 } });
  });
  it("★ lượt LỖI (driver báo loi) mà không đổi tệp ⇒ loi-driver, không phải khong-lam/xong; lyDoDung đi vào JSON", async () => {
    const loi: Driver = async () => ({ vong: null, token: null, ghiChu: [], hetGio: false, loi: "TOOL_CALL_KHONG_HO_TRO: model null", lyDoDung: "loi-model" });
    expect(await chay({ driver: loi })).toMatchObject({ ok: false, ketCuc: "loi-driver", loi: expect.stringContaining("TOOL_CALL_KHONG_HO_TRO"), lyDoDung: "loi-model" });
  });

  it("driver hết giờ ⇒ het-gio; driver lỗi ⇒ loi-driver; vi phạm thắng", async () => {
    const hetGio: Driver = async () => ({ vong: null, token: null, ghiChu: [], hetGio: true });
    expect((await chay({ driver: hetGio })).ketCuc).toBe("het-gio");
    const loi: Driver = async () => ({ vong: null, token: null, ghiChu: [], hetGio: false, loi: "no" });
    expect(await chay({ driver: loi })).toMatchObject({ ketCuc: "loi-driver", ok: false, loi: "no" });
  });
});

describe("chayMotViec — từ chối an toàn", () => {
  it("thẻ hỏng ⇒ tu-choi, không đụng worktree", async () => {
    const r = await chay({ van: "MÃ: X\n" });
    expect(r).toMatchObject({ ok: false, ketCuc: "tu-choi" });
    expect(git(wt, "branch", "--show-current")).not.toContain("pilot");
  });
  it("★ worktree không tên _tho_ca* ⇒ từ chối (không sửa nhầm nơi khác)", async () => {
    const khac = path.join(goc, "kho-khac");
    fs.mkdirSync(khac);
    git(khac, "init", "-q");
    expect(await chay({ wt: khac, choPhepKhoRieng: false })).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("_tho_ca") });
  });
  it("★ worktree CHÍNH (không phải liên kết) ⇒ từ chối khi không có cờ kiểm", async () => {
    expect(await chay({ choPhepKhoRieng: false })).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("worktree CHÍNH") });
  });
  it("★ worktree bẩn ⇒ từ chối, không tạo nhánh", async () => {
    fs.writeFileSync(path.join(wt, "dang-lam-do.txt"), "x");
    expect(await chay()).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("không sạch") });
    expect(git(wt, "branch", "--show-current")).not.toContain("pilot");
  });
  it("base không tồn tại ⇒ từ chối", async () => {
    expect(await chay({ base: "khong-co-nhanh-nay" })).toMatchObject({ ketCuc: "tu-choi" });
  });
});

describe("ghepLenh & driverKho", () => {
  it("lệnh ghép luật + thẻ (không có tệp ngoài thẻ)", () => {
    const d = docTheViec(THE());
    if (!d.ok) throw new Error("thẻ");
    const l = ghepLenh(d.the, "# luat\n");
    expect(l).toContain("# luat");
    expect(l).toContain("TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts");
    expect(l).toContain("LỆNH KIỂM: npx vitest run");
  });
  it("driverKho bỏ qua đường thoát ra ngoài worktree", async () => {
    const r = await driverKho({ the: {} as never, wt, lenh: "", hanGiay: 1, ghiLuotDir: null, khoGhi: { "../thoat.txt": "x" } });
    expect(fs.existsSync(path.join(goc, "thoat.txt"))).toBe(false);
    expect(r.ghiChu.join(" ")).toMatch(/bỏ qua/);
  });
});

describe("chayMotViec — test chạm DB (luật 2026-11-02)", () => {
  it("★ LỆNH KIỂM trỏ vào tệp test ĐÃ CÓ mà import getDb ⇒ tu-choi, chưa tạo nhánh", async () => {
    fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
    fs.writeFileSync(path.join(wt, "client/src/lib/a.test.ts"), 'import { getDb } from "../../../server/db/connection";\n');
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "co test db");
    const r = await chay();
    expect(r).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("chạm DB") });
    expect(git(wt, "branch", "--show-current")).not.toContain("pilot");
  });
  it("★ LỆNH KIỂM trỏ vào *.db.test (chưa có) ⇒ tu-choi", async () => {
    const the = THE("client/src/lib/a.db.test.ts").replace("a.test.ts", "a.db.test.ts");
    expect(await chay({ van: the })).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining(".db.test") });
  });
  it("★ Thợ Cả VIẾT test chạm DB ⇒ vi-pham cham-db (dieu-phoi không được chạy nó)", async () => {
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": 'import postgres from "postgres";\n' } });
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.viPham).toEqual([{ duong: "client/src/lib/a.test.ts", loai: "cham-db", chiTiet: "import postgres" }]);
  });
});

describe("chayMotViec — cất kết quả lượt trước (cây bẩn trên nhánh pilot)", () => {
  it("★ cây bẩn trên nhánh pilot/tho-ca-* ⇒ commit vào CHÍNH nhánh đó rồi chạy tiếp; luuY nói rõ; nhánh cũ giữ tệp", async () => {
    git(wt, "checkout", "-q", "-b", "pilot/tho-ca-TC-98");
    fs.writeFileSync(path.join(wt, "ket-qua-cu.txt"), "hồ sơ lượt trước\n");
    git(wt, "add", "ket-qua-cu.txt");
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "it('x', () => {});\n" } });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", nhanh: "pilot/tho-ca-TC-99" });
    expect(r.luuY?.join(" ")).toContain("đã cất kết quả lượt trước vào nhánh pilot/tho-ca-TC-98");
    expect(git(wt, "show", "pilot/tho-ca-TC-98:ket-qua-cu.txt")).toBe("hồ sơ lượt trước");
    expect(git(wt, "log", "-1", "--format=%s", "pilot/tho-ca-TC-98")).toContain("cất kết quả lượt trước");
    expect(r.tepDoi).toEqual(["client/src/lib/a.test.ts"]); // tệp cũ không lẫn vào diff mới
  });
  it("★ cây bẩn trên nhánh KHÁC (main/nhánh thường) ⇒ vẫn từ chối, KHÔNG commit gì", async () => {
    const dau = git(wt, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(wt, "dang-lam-do.txt"), "x");
    expect(await chay()).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("không đứng trên nhánh pilot") });
    expect(git(wt, "rev-parse", "HEAD")).toBe(dau);
  });
});

describe("chayMotViec — bước cất dùng PATHSPEC (hook BG-124 chặn commit trần)", () => {
  /** Hook thật của repo (bản chạy trong .git/hooks của kho chính) — chỉ cho qua pathspec-commit (index tạm next-index-*). */
  const HOOK = `#!/bin/sh
ten_index=$(basename "\${GIT_INDEX_FILE:-index}")
case "$ten_index" in
  next-index-*) exit 0 ;;
  *) echo "BG-124: COMMIT TRAN bi chan" >&2; exit 1 ;;
esac
`;
  const caiHook = () => {
    const f = path.join(wt, ".git", "hooks", "pre-commit");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, HOOK, { mode: 0o755 });
  };
  it("★ có hook từ chối commit trần: cất vẫn thành công (pathspec), CHỈ commit tệp của lượt trước, không cuốn tệp khác đang stage", async () => {
    caiHook();
    git(wt, "checkout", "-q", "-b", "pilot/tho-ca-TC-97");
    fs.writeFileSync(path.join(wt, "ket-qua-cu.txt"), "lượt trước\n");
    git(wt, "add", "ket-qua-cu.txt");
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "it('x', () => {});\n" } });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong" });
    expect(git(wt, "show", "pilot/tho-ca-TC-97:ket-qua-cu.txt")).toBe("lượt trước");
    expect(git(wt, "log", "-1", "--format=%s", "pilot/tho-ca-TC-97")).toContain("cất kết quả lượt trước");
  });
  it("đối chứng: chính hook ấy CHẶN commit trần (để biết ca trên có sức kiểm)", () => {
    caiHook();
    fs.writeFileSync(path.join(wt, "x.txt"), "x");
    git(wt, "add", "x.txt");
    const r = spawnSync("git", ["commit", "-q", "-m", "tran"], { cwd: wt, encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });
});

describe("chayMotViec — L3a: bộ chạy TỰ chạy lệnh kiểm và đọc kết quả", () => {
  const TEST_OK = "import { it } from 'vitest';\nit('x', () => {});\n";
  it("★ lệnh kiểm XANH ⇒ xong, JSON mang kiem + tepTest, chạy ĐÚNG lệnh của thẻ trong ĐÚNG worktree", async () => {
    const goi: Array<[string, string, number]> = [];
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": TEST_OK }, hanKiemGiay: 77, chayKiem: async (l, w, h) => (goi.push([l, w, h]), { ...kiemXanh, lenh: l }) });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", tepTest: [{ duong: "client/src/lib/a.test.ts", soCa: 1 }] });
    expect(r.kiem).toMatchObject({ exit: 0, vitest: { ca: { dat: 2 } } });
    expect(goi).toEqual([["npx vitest run client/src/lib/a.test.ts", path.resolve(wt), 77]]);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it("★ lệnh kiểm ĐỎ ⇒ kiem-do, ok:false, lý do vào luuY (trước đây vẫn 'xong')", async () => {
    const r = await chay({
      khoGhi: { "client/src/lib/a.test.ts": TEST_OK },
      chayKiem: async (l) => ({ ...kiemXanh, lenh: l, exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 1, boQua: 0, tong: 2 } } }),
    });
    expect(r).toMatchObject({ ok: false, ketCuc: "kiem-do" });
    expect(r.luuY?.join(" ")).toMatch(/L3a: LỆNH KIỂM đỏ/);
  });
  it("★ tệp test model viết 0 ca ⇒ test-rong và KHÔNG chạy lệnh kiểm", async () => {
    let goi = 0;
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "import { describe } from 'vitest';\ndescribe('x', () => {});\n" }, chayKiem: async (l) => (goi++, { ...kiemXanh, lenh: l }) });
    expect(r).toMatchObject({ ok: false, ketCuc: "test-rong" });
    expect(goi).toBe(0);
    expect(r.kiem).toBeUndefined();
  });
  it("★ STICKY: vi-pham / khong-lam KHÔNG chạy lệnh kiểm (không tốn giờ, không nâng lên)", async () => {
    let goi = 0;
    const dem: ChayKiem = async (l) => (goi++, { ...kiemXanh, lenh: l });
    expect((await chay({ khoGhi: { "client/src/lib/a.test.ts": TEST_OK, "client/src/lib/khac.ts": "b\n" }, chayKiem: dem })).ketCuc).toBe("vi-pham");
    expect((await chay({ chayKiem: dem })).ketCuc).toBe("khong-lam");
    expect(goi).toBe(0);
  });
});
