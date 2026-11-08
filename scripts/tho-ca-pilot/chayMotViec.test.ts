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

describe("ghepLenh — QUY TRÌNH và ghi chú lệnh kiểm tới tay model", () => {
  it("★ thẻ TC-05: model thấy QUY TRÌNH và lệnh kiểm SẠCH (không lời văn dính vào lệnh)", () => {
    const dt = docTheViec(`MÃ: TC-05
MỤC TIÊU: viết test
TỆP ĐƯỢC PHÉP SỬA/TẠO: server/utils/msaReport.unit.test.ts
LỆNH KIỂM: npx vitest run server/utils/msaReport.unit.test.ts. Ngoài ra có đột biến.
QUY TRÌNH: Trước khi viết test, in danh sách hành vi (≤ 12 dòng) và chờ duyệt.
GIỚI HẠN: 15 phút, 8 vòng.`);
    expect(dt.ok).toBe(true);
    if (!dt.ok) return;
    const lenh = ghepLenh(dt.the, "# luat");
    expect(lenh).toContain("\nLỆNH KIỂM: npx vitest run server/utils/msaReport.unit.test.ts\n");
    expect(lenh).toContain("GHI CHÚ LỆNH KIỂM: Ngoài ra có đột biến.");
    expect(lenh).toContain("QUY TRÌNH: Trước khi viết test, in danh sách hành vi (≤ 12 dòng) và chờ duyệt.");
  });
});

describe("chayMotViec — L3c tsc + chạy kiểm bổ sung khi lượt dừng giữa chừng", () => {
  const TEST_OK = "import { it } from 'vitest';\nit('x', () => {});\n";
  const tscSach = async () => ({ exit: 0, hetGio: false, giay: 1, loiTrongTep: [] as string[], tongLoi: 0 });
  const caiTsconfig = () => {
    fs.writeFileSync(path.join(wt, "tsconfig.tests.json"), "{}\n");
    git(wt, "add", "tsconfig.tests.json");
    git(wt, "commit", "-q", "-m", "tsconfig");
  };
  it("★ lệnh kiểm xanh + tsc BÁO LỖI trong tệp đổi ⇒ kiem-do, JSON mang tsc", async () => {
    caiTsconfig();
    const r = await chay({
      khoGhi: { "client/src/lib/a.test.ts": TEST_OK },
      chayTsc: async () => ({ exit: 2, hetGio: false, giay: 3, loiTrongTep: ["client/src/lib/a.test.ts(1,1): error TS2322: x"], tongLoi: 1 }),
    });
    expect(r).toMatchObject({ ok: false, ketCuc: "kiem-do", tsc: { exit: 2 } });
    expect(r.luuY?.join(" ")).toMatch(/L3a: tsc: 1 lỗi kiểu/);
  });
  it("tsc sạch ⇒ xong, có trường tsc; không có tsconfig.tests.json ⇒ KHÔNG chạy tsc", async () => {
    let goi = 0;
    const dem = async () => (goi++, await tscSach());
    expect((await chay({ khoGhi: { "client/src/lib/a.test.ts": TEST_OK }, chayTsc: dem })).ketCuc).toBe("xong");
    expect(goi).toBe(0); // kho tạm chưa có tsconfig.tests.json
  });
  it("★ có tsconfig + tsc sạch ⇒ xong và tsc được gọi đúng một lần với tệp đổi", async () => {
    caiTsconfig();
    const goi: string[][] = [];
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": TEST_OK }, chayTsc: async (_w, tep) => (goi.push([...tep]), tscSach()) });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", tsc: { exit: 0 } });
    expect(goi).toEqual([["client/src/lib/a.test.ts"]]);
  });
  it("★ loi-driver MÀ có tệp test ⇒ ketCuc giữ loi-driver nhưng VẪN chạy lệnh kiểm và ghi kiem (không mất số đo)", async () => {
    let goi = 0;
    const loi: Driver = async (v) => {
      fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(v.wt, "client/src/lib/a.test.ts"), TEST_OK);
      return { vong: 1, token: null, ghiChu: [], hetGio: false, loi: "lượt dừng không hoàn thành: lyDo=lap-lai" };
    };
    const r = await chay({ driver: loi, chayKiem: async (l) => (goi++, { ...kiemXanh, lenh: l }) });
    expect(r).toMatchObject({ ok: false, ketCuc: "loi-driver", kiem: { exit: 0 } });
    expect(goi).toBe(1);
    expect(r.luuY?.join(" ")).toMatch(/ketCuc loi-driver giữ nguyên/);
  });
  it("het-gio có tệp test cũng chạy kiểm bổ sung; loi-driver KHÔNG có tệp test thì không chạy; vi-pham không chạy", async () => {
    let goi = 0;
    const dem: ChayKiem = async (l) => (goi++, { ...kiemXanh, lenh: l });
    const ghiTest: Driver = async (v) => {
      fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(v.wt, "client/src/lib/a.test.ts"), TEST_OK);
      return { vong: 1, token: null, ghiChu: [], hetGio: true };
    };
    expect((await chay({ driver: ghiTest, chayKiem: dem })).ketCuc).toBe("het-gio");
    expect(goi).toBe(1);
    const khongTest: Driver = async () => ({ vong: 1, token: null, ghiChu: [], hetGio: false, loi: "x" });
    expect((await chay({ driver: khongTest, chayKiem: dem })).ketCuc).toBe("loi-driver");
    expect(goi).toBe(1);
  });
});

describe("chayMotViec — tên trường thời gian đúng nghĩa", () => {
  it("★ giayKhongChoNguoi = giayTuong − giayChoDuyet (driver có thống kê duyệt); KHÔNG còn trường giayModel gây hiểu nhầm", async () => {
    const drv: Driver = async () => ({ vong: 1, token: null, ghiChu: [], hetGio: false, duyet: { soLanCho: 1, soChapNhan: 1, soTuChoi: 0, giayChoDuyet: 0.5 } });
    const r = (await chay({ driver: drv })) as unknown as Record<string, unknown>;
    expect(r.giayModel).toBeUndefined();
    expect(r.giayKhongChoNguoi).toBe(Math.round(((r.giayTuong as number) - 0.5) * 10) / 10);
  });
});

describe("chayMotViec — L3b đột biến trong thẻ / KHÔNG ĐƯỢC KHẲNG ĐỊNH / ghim-nghi-ngo", () => {
  const TEST_OK = "import { it } from 'vitest';\nit('x', () => {});\n";
  const NGUON = "export const f = (n: number) => (n > 0 ? 1 : 0);\n";
  const THE_DB = (them: string) => `MÃ: TC-88
MỤC TIÊU: thử đột biến
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts
LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts
${them}
GIỚI HẠN: 1 phút, 3 vòng`;
  const DB1 = "ĐỘT BIẾN: client/src/lib/f.ts|n > 0|n >= 0";
  const caiNguon = () => {
    fs.mkdirSync(path.join(wt, "client/src/lib"), { recursive: true });
    fs.writeFileSync(path.join(wt, "client/src/lib/f.ts"), NGUON);
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "nguon");
  };
  /** lệnh kiểm GIẢ: đỏ khi nguồn mang một trong các dấu hiệu */
  const kiemTheoNguon = (dau: string[]): ChayKiem => async (lenh) => {
    const ng = fs.readFileSync(path.join(wt, "client/src/lib/f.ts"), "utf8");
    return dau.some((d) => ng.includes(d)) ? { ...kiemXanh, lenh, exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 1 } } } : { ...kiemXanh, lenh };
  };

  it("★ đột biến BỊ BẮT ⇒ xong, JSON mang dotBien{do:1}; nguồn khôi phục nguyên văn, cây chỉ còn tệp model đổi", async () => {
    caiNguon();
    const r = await chay({ van: THE_DB(DB1), khoGhi: { "client/src/lib/a.test.ts": TEST_OK }, chayKiem: kiemTheoNguon(["n >= 0"]) });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", dotBien: { tong: 1, do: 1, song: 0, khoiPhucSach: true, tepLa: [] } });
    expect(fs.readFileSync(path.join(wt, "client/src/lib/f.ts"), "utf8")).toBe(NGUON);
    expect(git(wt, "status", "--porcelain").split("\n").filter((x) => x && !x.endsWith("AGENTS.md")).map((x) => x.replace(/^\S+\s+/, ""))).toEqual(["client/src/lib/a.test.ts"]);
  });
  it("★ đột biến SỐNG ⇒ dot-bien-song, ok:false, nêu đột biến nào", async () => {
    caiNguon();
    const r = await chay({ van: THE_DB(DB1), khoGhi: { "client/src/lib/a.test.ts": TEST_OK }, chayKiem: kiemTheoNguon([]) });
    expect(r).toMatchObject({ ok: false, ketCuc: "dot-bien-song", dotBien: { song: 1 } });
    expect(r.luuY?.join(" ")).toMatch(/1\/1 đột biến SỐNG/);
  });
  it("★ thẻ lỗi (đột biến không khớp đúng 1 chỗ trên base) ⇒ tu-choi TRƯỚC khi gọi driver (không tốn lượt model)", async () => {
    caiNguon();
    let goi = 0;
    const drv: Driver = async () => (goi++, { vong: 1, token: null, ghiChu: [], hetGio: false });
    const r = await chay({ van: THE_DB("ĐỘT BIẾN: client/src/lib/f.ts|không-có-chuỗi-này|x"), driver: drv });
    expect(r).toMatchObject({ ok: false, ketCuc: "tu-choi" });
    expect(r.loi).toMatch(/0 lần/);
    expect(goi).toBe(0);
  });
  it("★ CÁCH LY: model/driver KHÔNG thấy đột biến — không có trong lệnh (prompt), không trong `the` đưa cho driver, và nguồn trên đĩa lúc driver chạy chưa bị đột biến", async () => {
    caiNguon();
    let lenhThay = "";
    let theThay: Record<string, unknown> = {};
    let nguonLucDriver = "";
    const drv: Driver = async (v) => {
      lenhThay = v.lenh;
      theThay = v.the as unknown as Record<string, unknown>;
      nguonLucDriver = fs.readFileSync(path.join(v.wt, "client/src/lib/f.ts"), "utf8");
      fs.writeFileSync(path.join(v.wt, "client/src/lib/a.test.ts"), TEST_OK);
      return { vong: 1, token: null, ghiChu: [], hetGio: false };
    };
    await chay({
      van: THE_DB(`${DB1}\nKHÔNG ĐƯỢC KHẲNG ĐỊNH: CHUOI-CAM-BI-MAT-123`),
      driver: drv,
      chayKiem: kiemTheoNguon(["n >= 0"]),
    });
    for (const bimat of ["n >= 0", "n > 0", "client/src/lib/f.ts", "CHUOI-CAM-BI-MAT-123", "ĐỘT BIẾN", "KHÔNG ĐƯỢC KHẲNG ĐỊNH"]) {
      expect(lenhThay, `prompt chứa "${bimat}"`).not.toContain(bimat);
    }
    expect(theThay.dotBien).toBeUndefined();
    expect(theThay.khangDinhCam).toBeUndefined();
    expect(nguonLucDriver).toBe(NGUON);
  });
  it("★ KHÔNG ĐƯỢC KHẲNG ĐỊNH trong expect(...) của test model viết ⇒ vi-pham khang-dinh-cam (không chạy lệnh kiểm)", async () => {
    caiNguon();
    let goi = 0;
    const test = "import { it, expect } from 'vitest';\nit('x', () => {\n  expect(f(1)).toBe('?old=1?new=2');\n});\n";
    const r = await chay({
      van: THE_DB("KHÔNG ĐƯỢC KHẲNG ĐỊNH: ?old=1?new=2"),
      khoGhi: { "client/src/lib/a.test.ts": test },
      chayKiem: async (l) => (goi++, { ...kiemXanh, lenh: l }),
    });
    expect(r).toMatchObject({ ok: false, ketCuc: "vi-pham" });
    expect(r.viPham).toEqual([{ duong: "client/src/lib/a.test.ts", loai: "khang-dinh-cam", chiTiet: expect.stringContaining("?old=1?new=2") }]);
    expect(goi).toBe(0);
  });
  it("★ nhãn nghi ghim lỗi ⇒ CẢNH BÁO ghimNghiNgo (kèm dòng), ketCuc vẫn xong", async () => {
    const test = "import { it } from 'vitest';\n// HIỆN TRẠNG — lỗi đã biết\nit('x', () => {});\n";
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": test } });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", ghimNghiNgo: [{ duong: "client/src/lib/a.test.ts", dong: 2 }] });
  });
  it("không có ĐỘT BIẾN trong thẻ ⇒ không có trường dotBien; đột biến chỉ áp khi mọi bước trước xanh (lệnh kiểm đỏ ⇒ kiem-do, không áp)", async () => {
    caiNguon();
    const r0 = await chay({ khoGhi: { "client/src/lib/a.test.ts": TEST_OK } });
    expect(r0.dotBien).toBeUndefined();
    let goi = 0;
    const r1 = await chay({
      van: THE_DB(DB1),
      khoGhi: { "client/src/lib/a.test.ts": `${TEST_OK}// lượt hai\n` },
      chayKiem: async (l) => (goi++, { ...kiemXanh, lenh: l, exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 1 } } }),
    });
    expect(r1.ketCuc).toBe("kiem-do");
    expect(r1.dotBien).toBeUndefined();
    expect(goi).toBe(1);
  });
});
