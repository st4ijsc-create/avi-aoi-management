/**
 * HA-9 — bộ quét tĩnh CẢNH BÁO trên thẻ chờ duyệt. THUẦN (không fs / mạng / env).
 * Mỗi trong CHÍN mẫu có: một ca DƯƠNG (đúng tên mẫu, đúng số dòng) và một ca ÂM (mã vô hại gần giống KHÔNG bị cảnh báo).
 * ĐỘT BIẾN PHẢI BẮT: bỏ từng mẫu · cho qua đường trong worktree/tmp sai · quét cả dòng cũ · bỏ che mật khẩu · allow-list nới (chú thích lách) · quét cả chú thích · bỏ chặn exec(regex).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cheMatKhauUrl, dongMoiCuaTep, dongMoiTuHoSo, quetHoSo, quetTinh, TAT_CA_MAU, tachChoPhep, tomTatCanhBao, type MauQuet } from "./quetTinh";

const WT = path.resolve("D:/SOURCES/_tho_ca_wt");
const TMP = path.resolve("C:/Users/x/AppData/Local/Temp");
const tc = { wt: WT, thuMucTam: [TMP] };
const quet = (ma: string, choPhep: string[] = []) => quetTinh(dongMoiCuaTep("", ma), { ...tc, choPhep });
const maus = (ma: string, choPhep: string[] = []) => quet(ma, choPhep).map((c) => c.mau);

describe("chín mẫu — DƯƠNG", () => {
  it.each<[MauQuet, string]>([
    ["duong-tuyet-doi", 'const f = "C:\\Users\\Admin\\secret.txt";'],
    ["duong-tuyet-doi", 'readFileSync("/etc/passwd")'],
    ["duong-tuyet-doi", 'const p = "D:/SOURCES/avi-aoi-management/x.ts";'],
    ["env-tep", 'readFileSync(".env", "utf8")'],
    ["env-tep", 'const t = "../.env.local";'],
    ["bi-mat", 'const u = "D:/SOURCES/_tho_ca_pilot/bi-mat/x";'],
    ["bi-mat", 'const f = "tho_ca_test.url";'],
    ["database-url", "const u = process.DATABASE_URL_X; const v = DATABASE_URL;"],
    ["database-url", 'const c = "postgres://u:p@127.0.0.1:5434/aoi_management_test";'],
    ["process-env", "const n = process.env.NODE_ENV;"],
    ["process-env", 'const k = process.env["SECRET"];'],
    ["child-process", 'import { spawn } from "node:child_process";'],
    ["child-process", 'execSync("dir")'],
    ["child-process", 'const r = spawnSync("git", ["status"]);'],
    ["ghi-tep", 'writeFileSync("out.txt", "x");'],
    ["ghi-tep", 'await fs.promises.rm("dist", { recursive: true });'],
    ["mang-ngoai", 'const r = await fetch("https://example.com/x");'],
    ["mang-ngoai", 'const u = "https://evil.example/a";'],
    ["mang-ngoai", 'const s = net.connect(80, "10.0.0.5");'],
    ["eval-dong", 'eval("1+1")'],
    ["eval-dong", 'const f = new Function("a", "return a");'],
    ["eval-dong", "const m = await import(`./x/${ten}`);"],
    ["eval-dong", 'const m = require("./a" + ten);'],
  ])("%s ⇐ %s", (mau, ma) => {
    expect(maus(ma)).toContain(mau);
  });
  it("★ đủ cả chín tên mẫu đều từng được kích hoạt ở bảng trên", () => {
    expect([...TAT_CA_MAU]).toHaveLength(9);
    expect(new Set(TAT_CA_MAU).size).toBe(9);
  });
});

describe("chín mẫu — ÂM (mã vô hại gần giống)", () => {
  it.each<[string, string]>([
    ["đường trong worktree", `const f = "${WT.replace(/\\/g, "/")}/client/src/a.ts";`],
    ["đường trong thư mục tạm", `const f = "${TMP.replace(/\\/g, "/")}/phat-lai/x";`],
    ["đường tương đối", 'const f = "./fixtures/a.json";'],
    ["URL không phải đường ổ đĩa", 'const u = "http://127.0.0.1:5434/x";'],
    ["process.env KHÔNG là .env", "const e = processEnv;"],
    ["dotenv không có dấu chấm", 'import dotenv from "dotenv";'],
    ["regex.exec không phải child_process", "const m = re.exec(s); const n = /a/.exec(s);"],
    ["tên hàm chứa exec", "const r = myExec(1); execute(2); doSpawn(3);"],
    ["ghi vào thư mục tạm", 'writeFileSync(path.join(os.tmpdir(), "a.txt"), "x");'],
    ["mkdtemp", 'const t = fs.mkdtempSync(path.join(os.tmpdir(), "x-"));'],
    ["đọc tệp (không ghi)", 'const s = readFileSync("a.txt", "utf8");'],
    ["mạng tới 127.0.0.1:5434", 'const c = net.connect("127.0.0.1:5434");'],
    ["URL localhost", 'const u = "http://localhost:3000/x";'],
    ["file:// và node:", 'import x from "node:fs"; const u = "file:///a/b";'],
    ["import chuỗi thuần", 'const m = await import("./a"); const r = require("./b");'],
    ["import template không ${}", "const m = await import(`./a`);"],
    ["Function là tên khác", "const myFunction = 1; type Function2 = number;"],
  ])("%s ⇒ không cảnh báo", (_t, ma) => {
    expect(quet(ma)).toEqual([]);
  });
  it("★★★ đường ĐÚNG BẰNG worktree / thư mục tạm (không có phần đuôi) ⇒ được", () => {
    expect(quet(`const w = "${WT.replace(/\\/g, "/")}";`)).toEqual([]);
    expect(quet(`const t = "${TMP.replace(/\\/g, "/")}";`)).toEqual([]);
  });
  it("★★★ anh em CÙNG TIỀN TỐ với worktree / thư mục tạm (`…_tho_ca_wt-evil`, `…Temp2`) ⇒ VẪN cảnh báo (biên là dấu phân cách)", () => {
    expect(maus(`const w = "${WT.replace(/\\/g, "/")}-evil/x";`)).toContain("duong-tuyet-doi");
    expect(maus(`const t = "${TMP.replace(/\\/g, "/")}2/x";`)).toContain("duong-tuyet-doi");
  });
  it("★★★ chuỗi JS gạch ngược KÉP trong worktree (`\"D:\\\\SOURCES\\\\_tho_ca_wt\\\\a\"`) ⇒ KHÔNG cảnh báo oan; đối chứng: đường ngoài worktree cũng dạng `\\\\` ⇒ VẪN cảnh báo", () => {
    expect(quet('const w = "D:\\\\SOURCES\\\\_tho_ca_wt\\\\a\\\\b.ts";')).toEqual([]);
    expect(maus('const w = "D:\\\\SOURCES\\\\khac\\\\a.ts";')).toContain("duong-tuyet-doi");
    expect(maus('const w = "D:\\\\SOURCES\\\\_tho_ca_wt-evil\\\\a.ts";')).toContain("duong-tuyet-doi");
  });
  it("★★★ hoa/thường (q18): `d:\\sources\\_tho_ca_wt\\x` và `D:\\SOURCES\\_tho_ca_wt\\x` cùng kết quả (được); anh em `wt-evil` khác hoa/thường vẫn cảnh báo", () => {
    expect(quet('const a = "d:\\sources\\_tho_ca_wt\\x.ts";')).toEqual([]);
    expect(quet('const a = "D:\\SOURCES\\_tho_ca_wt\\x.ts";')).toEqual([]);
    expect(maus('const a = "d:\\sources\\_THO_CA_WT-evil\\x.ts";')).toContain("duong-tuyet-doi");
    expect(maus('const a = "D:\\SOURCES\\_tho_ca_wt-evil\\x.ts";')).toContain("duong-tuyet-doi");
  });
  it("★★★ dòng > 4000 ký tự không chạy regex: dòng 550 KB lặp `require   ` xong < 200 ms VÀ có đúng một cảnh báo `dong-qua-dai`", () => {
    const dai = "require   ".repeat(55_000);
    const t0 = performance.now();
    const ra = quet(`a\n${dai}`);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(ra.map((c) => [c.mau, c.dong])).toEqual([["dong-qua-dai", 2]]);
    expect(ra[0]!.trich.length).toBeLessThanOrEqual(200);
  });
  it("★★ thông điệp dong-qua-dai nói rõ dòng KHÔNG được quét; né quét bằng dòng dài vẫn để lại cảnh báo", () => {
    const [c] = quet(`const p = "${"y".repeat(4100)}";`);
    expect(c!.mau).toBe("dong-qua-dai");
    expect(c!.manh).toContain("KHÔNG ĐƯỢC QUÉT");
    expect(maus(`const a = "${"x".repeat(4100)}"; const d = process.env.DATABASE_URL;`)).toEqual(["dong-qua-dai"]);
  });
  it("★★ biên: dòng đúng 4000 ký tự vẫn được quét; 4001 ký tự ⇒ chỉ `dong-qua-dai`; dòng chú thích dài không cảnh báo", () => {
    const them = (n: number, dau: string) => dau + "x".repeat(n - dau.length);
    expect(maus(them(4000, "const a = process.env.X; "))).toContain("process-env");
    expect(maus(them(4001, "const a = process.env.X; "))).toEqual(["dong-qua-dai"]);
    expect(quet(them(5000, "// "))).toEqual([]);
  });
  it("★ DƯƠNG đối chứng của ca 'mạng tới 127.0.0.1:5434': cùng lệnh nhưng KHÔNG nêu :5434 ⇒ cảnh báo", () => {
    expect(maus('const c = net.connect(5434, "127.0.0.1");')).toContain("mang-ngoai");
  });
  it("★ LÁCH: nhắc 127.0.0.1:5434 chỉ trong CHÚ THÍCH cuối dòng không bỏ qua cảnh báo mạng", () => {
    expect(maus('const c = net.connect(80, "10.0.0.5"); // 127.0.0.1:5434')).toContain("mang-ngoai");
  });
  it("★ DƯƠNG đối chứng của 'ghi vào thư mục tạm': cùng lệnh không nêu tmp ⇒ cảnh báo", () => {
    expect(maus('writeFileSync(path.join(dir, "a.txt"), "x");')).toContain("ghi-tep");
  });
});

describe("dòng mới / chú thích / che mật khẩu / số dòng", () => {
  it("★ chỉ quét dòng MỚI: dòng đã có ở bản cũ không bị cảnh báo; dòng thêm thì có, đúng số dòng của bản mới", () => {
    const cu = ["a", 'const x = process.env.NODE_ENV;', "b"].join("\n");
    const moi = ["a", 'const x = process.env.NODE_ENV;', "b", 'spawn("ls");'].join("\n");
    const cb = quetTinh(dongMoiCuaTep(cu, moi), tc);
    expect(cb.map((c) => [c.mau, c.dong])).toEqual([["child-process", 4]]);
  });
  it("★ dòng chỉ DỜI chỗ không coi là mới; đếm theo multiset (thêm bản sao thứ hai thì tính)", () => {
    const cu = "spawn(1)\nx";
    expect(dongMoiCuaTep(cu, "x\nspawn(1)")).toEqual([]);
    expect(dongMoiCuaTep(cu, "spawn(1)\nx\nspawn(1)").map((d) => d.so)).toEqual([3]);
  });
  it("★ dòng chú thích thuần (//, /*, *) không quét; dòng mã có chú thích cuối dòng vẫn quét phần mã", () => {
    expect(quet('// eval("x") spawn(1) .env')).toEqual([]);
    expect(quet(' * spawn(1) process.env')).toEqual([]);
    expect(maus('spawn("ls"); // ok')).toContain("child-process");
  });
  it("★ che mật khẩu URL trong manh và trich", () => {
    const cb = quet('const c = "postgres://tho_ca_test:MatKhauRat123@127.0.0.1:5434/aoi_management_test";');
    expect(cb.length).toBeGreaterThan(0);
    for (const c of cb) {
      expect(c.manh).not.toContain("MatKhauRat123");
      expect(c.trich).not.toContain("MatKhauRat123");
    }
    expect(cb.find((c) => c.mau === "database-url")!.manh).toContain("://***@");
    expect(cheMatKhauUrl("https://a:b@h/x")).toBe("https://***@h/x");
  });
  it("★ trích cắt 200 ký tự, đoạn khớp cắt 120; số cảnh báo tối đa 100", () => {
    const dai = `spawn("${"x".repeat(500)}")`;
    expect(quet(dai)[0]!.trich.length).toBeLessThanOrEqual(200);
    const nhieu = Array.from({ length: 300 }, (_, i) => `spawn(${i});`).join("\n");
    expect(quet(nhieu)).toHaveLength(100);
  });
  it("★ tomTatCanhBao: rỗng khi sạch; liệt kê tên mẫu duy nhất", () => {
    expect(tomTatCanhBao(undefined)).toBe("");
    expect(tomTatCanhBao([])).toBe("");
    expect(tomTatCanhBao(quet('spawn(1); spawn(2); fetch("https://a.b/c");'))).toBe("CANH BAO 4: child-process,mang-ngoai");
  });
});

describe("CHO PHÉP TRONG TEST — chỉ tắt cảnh báo khi đoạn khớp nằm TRONG mục cho phép", () => {
  it("★ mục cho phép đúng đoạn khớp ⇒ tắt đúng cảnh báo đó, cảnh báo khác trên cùng dòng vẫn còn", () => {
    const ma = "const u = process.env.DATABASE_URL; spawn(1);";
    expect(maus(ma)).toEqual(expect.arrayContaining(["database-url", "process-env", "child-process"]));
    expect(maus(ma, ["process.env.DATABASE_URL"])).toEqual(["child-process"]);
  });
  it("★ LÁCH: ghi mục cho phép vào chú thích / chuỗi trên cùng dòng KHÔNG tắt cảnh báo của đoạn khác", () => {
    expect(maus('spawn("ls"); // getDb', ["getDb"])).toContain("child-process");
    expect(maus('spawn("ls"); const note = "process.env.DATABASE_URL";', ["process.env.DATABASE_URL"])).toContain("child-process");
  });
  it("★ mục cho phép phải bao TRỌN đoạn khớp: `DATABASE_URL` không tắt `process.env.DATABASE_URL`", () => {
    expect(maus("const u = process.env.DATABASE_URL;", ["DATABASE_URL"])).toEqual(["process-env"]);
  });
  it("★★★ mục cho phép là TIỀN TỐ của đoạn khớp (`process.env` vs `process.env.DATABASE_URL`) ⇒ KHÔNG tắt (đoạn khớp phải nằm trọn trong mục)", () => {
    expect(maus("const u = process.env.DATABASE_URL;", ["process.env"])).toEqual(expect.arrayContaining(["process-env", "database-url"]));
  });
  it("★★★ mục cho phép RỖNG không làm treo bộ quét (indexOf('') không bao giờ -1)", () => {
    expect(maus("spawn(1)", ["", "x"])).toEqual(["child-process"]);
  });
  it("★ mục cho phép rỗng không tắt gì", () => {
    expect(maus("spawn(1)", [""])).toEqual(["child-process"]);
  });
  it("tachChoPhep: `;` ưu tiên; dấu phẩy NGOÀI ngoặc/nháy; ngoặc/nháy giữ nguyên", () => {
    expect(tachChoPhep('getDb, vi.mock("./connection", () => ({ a, b }))')).toEqual(["getDb", 'vi.mock("./connection", () => ({ a, b }))']);
    expect(tachChoPhep("a, b; c")).toEqual(["a, b", "c"]);
    expect(tachChoPhep("  ")).toEqual([]);
  });
});

describe("dongMoiTuHoSo / quetHoSo", () => {
  it("★ ưu tiên xemTruoc.args.{original,modified}", () => {
    const h = { xemTruoc: { args: { path: "a.ts", original: "x\ny", modified: "x\ny\nspawn(1)" } }, thamSo: { content: "không dùng" } };
    expect(dongMoiTuHoSo(h).map((d) => d.dong)).toEqual(["spawn(1)"]);
    expect(quetHoSo(h, tc).map((c) => c.mau)).toEqual(["child-process"]);
  });
  it("★ không có xemTruoc: suy từ thamSo (content, edits[].new_string, diff chỉ dòng +)", () => {
    expect(dongMoiTuHoSo({ thamSo: { content: "a\neval(1)" } }).map((d) => d.dong)).toEqual(["a", "eval(1)"]);
    expect(dongMoiTuHoSo({ thamSo: { edits: [{ old_string: "x", new_string: "spawn(1)" }, { old_string: "y", new_string: "z" }] } }).map((d) => d.dong)).toEqual(["spawn(1)", "z"]);
    expect(dongMoiTuHoSo({ thamSo: { diff: "--- a\n+++ b\n-spawn(0)\n+spawn(1)\n ctx" } }).map((d) => d.dong)).toEqual(["spawn(1)"]);
  });
  it("★ tệp mới hoàn toàn (original rỗng) ⇒ quét hết; xemTruoc rỗng ⇒ không lỗi", () => {
    expect(quetHoSo({ xemTruoc: { args: { modified: "eval(1)" } } }, tc).map((c) => c.mau)).toEqual(["eval-dong"]);
    expect(quetHoSo({ xemTruoc: null, thamSo: {} }, tc)).toEqual([]);
  });
});
