import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARGS_PYTHON, bienDichMa, chay, envChoBienDichMa, loaiLoiMoiTruong, namTrongCay, phanTichDotnet, phanTichPython, phanTichTsc } from "./bienDichMa";

const co = (lenh: string, args: string[]) => {
  try {
    return spawnSync(lenh, args, { stdio: "ignore", windowsHide: true }).status === 0;
  } catch {
    return false;
  }
};
const CO_DOTNET = co("dotnet", ["--version"]);
const CO_PY = co(process.platform === "win32" ? "python" : "python3", ["--version"]);

describe("phân tích đầu ra", () => {
  it("dotnet: lấy dòng/cột/mã/thông điệp, bỏ đuôi [proj], khử lặp, bỏ cảnh báo", () => {
    const log = [
      "C:\\t\\Code.cs(4,78): warning CS0169: The field is never used [C:\\t\\p.csproj]",
      "C:\\t\\Code.cs(6,80): error CS0122: 'A.P' is inaccessible due to its protection level [C:\\t\\p.csproj]",
      "C:\\t\\Code.cs(6,80): error CS0122: 'A.P' is inaccessible due to its protection level [C:\\t\\p.csproj]",
      "C:\\t\\Code.cs(7,1): error CS1002: ; expected [C:\\t\\p.csproj]",
    ].join("\r\n");
    const ds = phanTichDotnet(log);
    expect(ds).toEqual([
      { dong: 6, cot: 80, ma: "CS0122", thongDiep: "'A.P' is inaccessible due to its protection level" },
      { dong: 7, cot: 1, ma: "CS1002", thongDiep: "; expected" },
    ]);
  });
  it("tsc", () => {
    const ds = phanTichTsc("code.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\nrác\ncode.ts(9,1): error TS1005: ';' expected.");
    expect(ds.map((d) => [d.dong, d.cot, d.ma])).toEqual([[3, 5, "TS2322"], [9, 1, "TS1005"]]);
  });
  it("python: dòng + câu lỗi cuối; rác ⇒ rỗng", () => {
    const ds = phanTichPython('  File "code.py", line 3\n    def f(:\n          ^\nSyntaxError: invalid syntax\n');
    expect(ds).toEqual([{ dong: 3, cot: null, ma: null, thongDiep: "SyntaxError: invalid syntax" }]);
    expect(phanTichPython("")).toEqual([]);
  });
  it("loaiLoiMoiTruong: gạt thiếu gói/kiểu, giữ lỗi thật", () => {
    const m = (ma: string) => ({ dong: 1, cot: 1, ma, thongDiep: "x" });
    expect(loaiLoiMoiTruong("cs", [m("CS0246"), m("CS0122")])).toEqual({ cua: [m("CS0122")], moiTruong: 1 });
    expect(loaiLoiMoiTruong("cs", [m("CS0234")]).cua).toEqual([]);
    expect(loaiLoiMoiTruong("ts", [m("TS2307"), m("TS2591"), m("TS2322")])).toEqual({ cua: [m("TS2322")], moiTruong: 2 });
    expect(loaiLoiMoiTruong("py", [{ dong: 1, cot: null, ma: null, thongDiep: "SyntaxError" }]).cua).toHaveLength(1);
  });
});

describe("cách ly", () => {
  it("namTrongCay: trong / ngoài / chính nó", () => {
    expect(namTrongCay("/repo", "/repo/tmp/x")).toBe(true);
    expect(namTrongCay("/repo", "/repo")).toBe(true);
    expect(namTrongCay("/repo", "/other/x")).toBe(false);
    expect(namTrongCay("/repo", "/repo2/x")).toBe(false);
  });
  it("envChoBienDichMa: không khoá / DB thật / đường dẫn khoá; DB chết; telemetry tắt", () => {
    const e = envChoBienDichMa({
      PATH: "p", SYSTEMROOT: "r", DATABASE_URL: "postgresql://aoi:real@db/aoi", LLAMA_SERVER_API_KEY: "k", LLAMA_SERVER_API_KEY_FILE: "D:/k",
      JWT_SECRET: "s", ANTHROPIC_API_KEY: "a", AI_AGENT_NEN_MOC: "0.5",
    });
    expect(e.PATH).toBe("p");
    expect(e.LLAMA_SERVER_API_KEY).toBeUndefined();
    expect(e.LLAMA_SERVER_API_KEY_FILE).toBeUndefined();
    expect(e.JWT_SECRET).toBeUndefined();
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.AI_AGENT_NEN_MOC).toBeUndefined();
    expect(e.DATABASE_URL).toContain(":9/");
    expect(e.DATABASE_URL).not.toContain("real");
    expect(e.DOTNET_CLI_TELEMETRY_OPTOUT).toBe("1");
  });
});

const dauTmp = () => fs.readdirSync(os.tmpdir()).filter((t) => t.startsWith("tukiem-"));

describe.skipIf(!CO_PY)("bienDichMa python (chạy thật)", () => {
  it("mã đúng ⇒ ok; mã sai cú pháp ⇒ loi có số dòng; thư mục tạm được xoá", async () => {
    const truoc = dauTmp();
    expect((await bienDichMa({ ngonNgu: "py", ma: "def f(x):\n    return x + 1\n" }, 10_000)).trangThai).toBe("ok");
    const r = await bienDichMa({ ngonNgu: "py", ma: "def f(:\n    return 1\n" }, 10_000);
    expect(r.trangThai).toBe("loi");
    expect(r.chanDoan[0]!.dong).toBe(1);
    expect(dauTmp().sort()).toEqual(truoc.sort());
  }, 30_000);
  it("KHÔNG thực thi mã: py_compile không chạy lệnh ở mức module", async () => {
    const dau = path.join(os.tmpdir(), `tukiem-dau-${process.pid}.txt`);
    const ma = `import pathlib\npathlib.Path(${JSON.stringify(dau)}).write_text("da chay")\n`;
    const r = await bienDichMa({ ngonNgu: "py", ma }, 10_000);
    expect(r.trangThai).toBe("ok");
    expect(fs.existsSync(dau)).toBe(false);
  }, 30_000);
});

describe("bienDichMa ts (chạy thật)", () => {
  it("lỗi kiểu ⇒ loi; thiếu @types/node không bị đổ cho model", async () => {
    const r = await bienDichMa({ ngonNgu: "ts", ma: "export const x: number = 'a';\n" }, 20_000);
    expect(r.trangThai).toBe("loi");
    expect(r.chanDoan[0]!.ma).toBe("TS2322");
    const r2 = await bienDichMa({ ngonNgu: "ts", ma: "import fs from 'node:fs';\nexport const a = fs;\n" }, 20_000);
    expect(r2.trangThai).toBe("khong-kiem-duoc");
    const r3 = await bienDichMa({ ngonNgu: "ts", ma: "export function f(a: number): number { return a + 1; }\n" }, 20_000);
    expect(r3.trangThai).toBe("ok");
  }, 60_000);
});

describe.skipIf(!CO_DOTNET)("bienDichMa C# (chạy thật)", () => {
  it("CS0122 (private lớp lồng gọi từ lớp ngoài) ⇒ loi đúng mã; mã đúng ⇒ ok", async () => {
    const hong = "namespace Sol { public static class B { public static double T(string s){ var p=new P(s); return p.Parse(); } private class P { string s; public P(string x){s=x;} private double Parse(){return 1;} } } }";
    const r = await bienDichMa({ ngonNgu: "cs", ma: hong }, 60_000);
    expect(r.trangThai).toBe("loi");
    expect(r.chanDoan.some((d) => d.ma === "CS0122")).toBe(true);
    const dung = hong.replace("private double Parse", "internal double Parse");
    expect((await bienDichMa({ ngonNgu: "cs", ma: dung }, 60_000)).trangThai).toBe("ok");
  }, 180_000);
  it("hết giờ ⇒ khong-kiem-duoc/het-gio và thư mục tạm vẫn được xoá", async () => {
    const truoc = dauTmp();
    const r = await bienDichMa({ ngonNgu: "cs", ma: "class A {}" }, 1);
    expect(r).toMatchObject({ trangThai: "khong-kiem-duoc", lyDo: "het-gio" });
    await new Promise((x) => setTimeout(x, 4000));
    expect(dauTmp().sort()).toEqual(truoc.sort());
  }, 30_000);
});

describe("cách ly (tiếp)", () => {
  it("thư mục tạm nằm trong repo ⇒ TỪ CHỐI, không tạo thư mục", async () => {
    const truoc = dauTmp();
    const r = await bienDichMa({ ngonNgu: "py", ma: "x = 1" }, 5_000, undefined, { cwdRepo: os.tmpdir() });
    expect(r).toMatchObject({ trangThai: "khong-kiem-duoc", lyDo: "thu-muc-tam-trong-repo" });
    expect(dauTmp().sort()).toEqual(truoc.sort());
  });
  it("python chạy ở chế độ cô lập -I", () => {
    expect(ARGS_PYTHON[0]).toBe("-I");
    expect(ARGS_PYTHON).toContain("py_compile");
  });
  it("hết giờ ⇒ giết tiến trình con thật (không để mồ côi)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tukiem-giet-"));
    try {
      const js = "require('fs').writeFileSync('pid', String(process.pid)); setInterval(() => {}, 1000);";
      const r = await chay(process.execPath, ["-e", js], dir, 1500);
      expect(r.hetGio).toBe(true);
      const pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8"));
      expect(pid).toBeGreaterThan(0);
      let con = true;
      try {
        process.kill(pid, 0);
      } catch {
        con = false;
      }
      expect(con).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
  it("đầu ra bị chặn ở 64 KB tại chỗ nhận", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tukiem-dau-ra-"));
    try {
      const r = await chay(process.execPath, ["-e", "process.stdout.write('x'.repeat(500000))"], dir, 10_000);
      expect(r.exit).toBe(0);
      expect(r.dauRa.length).toBe(64 * 1024);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
