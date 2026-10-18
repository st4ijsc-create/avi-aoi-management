/**
 * ★★★ Đợt 3c — CỬA SINH ỨNG DỤNG (tiến trình THẬT): môi trường LỌC + PORT/HOST, không shell, cwd = gốc; và phép
 * dựng argv từ khai báo chạy (npm script · python venv · dotnet run offline).
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dungLenhUngDung, sinhUngDungThat } from "./cuaSinhUngDung";

const tam: string[] = [];
function gocTam(): string {
  const g = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-sinh-"));
  tam.push(g);
  return g;
}
afterEach(() => {
  for (const g of tam.splice(0)) fs.rmSync(g, { recursive: true, force: true });
  delete process.env.DOTNET_CHO_PHEP_RESTORE;
});

describe("§1 — dựng argv từ khai báo chạy (KHÔNG chuỗi lệnh tự do)", () => {
  it("★★★ npm script ⇒ node <npm-cli.js> run <dev|start> (không qua npm.cmd, không shell)", () => {
    const r = dungLenhUngDung({ loai: "npm", script: "dev" }, gocTam());
    expect("thieu" in r).toBe(false);
    if ("thieu" in r) return;
    expect(r.file).toBe(process.execPath);
    expect(r.args.slice(-2)).toEqual(["run", "dev"]);
    expect(r.args[0]).toMatch(/npm-cli\.js$/);
    expect(r.moTa).toBe("npm run dev");
  });

  it("★★★ python ⇒ python CỦA VENV khi có `.venv` (gói đã cài nằm ở đó), python hệ thống khi không", () => {
    const g = gocTam();
    let r = dungLenhUngDung({ loai: "python", tep: "app.py" }, g);
    expect(!("thieu" in r) && r.file).toBe("python");
    const py = process.platform === "win32" ? path.join(g, ".venv", "Scripts", "python.exe") : path.join(g, ".venv", "bin", "python");
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.writeFileSync(py, "");
    r = dungLenhUngDung({ loai: "python", tep: "app.py" }, g);
    expect(!("thieu" in r) && r.file).toBe(py);
    expect(!("thieu" in r) && r.args).toEqual(["app.py"]);
  });

  it("★★ dotnet ⇒ `run --project <csproj> --no-launch-profile` (launchSettings không đè ASPNETCORE_URLS) + `--no-restore` mặc định offline", () => {
    const r = dungLenhUngDung({ loai: "dotnet", duAn: "src/App.csproj" }, gocTam());
    expect(!("thieu" in r) && r.args).toEqual(["run", "--project", "src/App.csproj", "--no-launch-profile", "--no-restore"]);
    process.env.DOTNET_CHO_PHEP_RESTORE = "1";
    const r2 = dungLenhUngDung({ loai: "dotnet", duAn: "src/App.csproj" }, gocTam());
    expect(!("thieu" in r2) && r2.args).toEqual(["run", "--project", "src/App.csproj", "--no-launch-profile"]);
  });
});

describe("§2 — tiến trình THẬT: môi trường LỌC, PORT/HOST đúng cổng cấp, cwd = gốc", () => {
  it("★★★ không bí mật máy chủ, CÓ PORT/HOST/ASPNETCORE_URLS, cwd đúng gốc", async () => {
    const g = gocTam();
    const con = sinhUngDungThat(
      { file: process.execPath, args: ["-e", "console.log(JSON.stringify({env: process.env, cwd: process.cwd()}))"], envThem: {}, moTa: "t" },
      g,
      5155,
      "127.0.0.2",
      { ...process.env, DATABASE_URL: "postgres://canary-ai7:matkhau@x/y", MASTER_API_KEY: "canary-master-ai7" },
    );
    let out = "";
    con.stdout?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    await new Promise<void>((giai) => con.on("exit", () => giai()));
    const j = JSON.parse(out.trim()) as { env: Record<string, string>; cwd: string };
    expect(out).not.toContain("canary-ai7");
    expect(out).not.toContain("canary-master-ai7");
    expect(j.env.PORT).toBe("5155");
    expect(j.env.HOST).toBe("127.0.0.2");
    expect(j.env.ASPNETCORE_URLS).toBe("http://127.0.0.2:5155");
    expect(fs.realpathSync(j.cwd).toLowerCase()).toBe(fs.realpathSync(g).toLowerCase());
  });

  it("★★ envThem của lệnh KHÔNG đè được PORT/HOST (cổng là của trình quản lý, không của khai báo)", async () => {
    const con = sinhUngDungThat(
      { file: process.execPath, args: ["-e", "console.log(process.env.PORT + ' ' + process.env.HOST)"], envThem: { PORT: "80", HOST: "0.0.0.0" }, moTa: "t" },
      gocTam(),
      5156,
      "127.0.0.2",
    );
    let out = "";
    con.stdout?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    await new Promise<void>((giai) => con.on("exit", () => giai()));
    expect(out.trim()).toBe("5156 127.0.0.2");
  });
});
