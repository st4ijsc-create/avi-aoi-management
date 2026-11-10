/**
 * `--cho-phep-db` — URL CSDL (có MẬT KHẨU) chỉ đi qua ENV, không bao giờ qua argv, stdout, log, JSON hay tệp đầu ra.
 * Phép quét: chạy với URL GIẢ mang dấu `MATKHAU_GIA_123`, rồi tìm chuỗi đó ở MỌI nơi bộ chạy có thể để lại — kỳ vọng 0.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec } from "./chayMotViec";
import { taoChayLenhKiem, type ChayKiem } from "./kiemChung";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const DAU = "MATKHAU_GIA_123";
const URL_GIA = `postgresql://avi_app:${DAU}@127.0.0.1:5434/aoi_management_test`;
const TEP = "server/db/statisticsScope.test.ts";
const THE = `MÃ: TC-96
MỤC TIÊU: thử rò URL
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
CSDL: chạm aoi_management_test (CHỈ CSDL _test)
LỆNH KIỂM: npx vitest run ${TEP}
GIỚI HẠN: 1 phút, 3 vòng`;

let goc: string;
let wt: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
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

const moiTep = (d: string): string[] =>
  fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? moiTep(path.join(d, e.name)) : [path.join(d, e.name)])) : [];

const chayKiemXanh: ChayKiem = async (lenh) => ({
  lenh, exit: 0, hetGio: false, giay: 1, duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } },
});

describe("URL CSDL có mật khẩu KHÔNG rò ra đầu ra của bộ chạy", () => {
  it("★★★ chạy thật với URL giả: JSON, nhật ký, diff và mọi tệp trong thư mục ra không chứa dấu mật khẩu", async () => {
    const nhatKy: string[] = [];
    const r = await chayMotViec({
      van: THE, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh,
      khoGhi: { [TEP]: `import { getDb } from "./connection";\nimport { it } from "vitest";\nit("x", () => { void getDb; });\n` },
      choPhepDb: true, testDbUrl: URL_GIA, nhatKy: (s) => nhatKy.push(s),
    });
    expect(r.ketCuc).toBe("xong");
    expect(r.choPhepDb).toBe(true);
    expect(JSON.stringify(r)).not.toContain(DAU);
    expect(nhatKy.join("\n")).not.toContain(DAU);
    const tep = moiTep(ra);
    expect(tep.length).toBeGreaterThan(0);
    for (const f of tep) expect(fs.readFileSync(f, "utf8"), f).not.toContain(DAU);
  });

  it("★★★ lý do từ chối cũng không in URL (URL sai tên CSDL / owner aoi / rác)", async () => {
    for (const url of [`postgresql://avi_app:${DAU}@h/aoi_management`, `postgresql://aoi:${DAU}@h/aoi_management_test`, `${DAU}-khong-phai-url`]) {
      const r = await chayMotViec({ van: THE, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh, choPhepDb: true, testDbUrl: url });
      expect(r.ketCuc).toBe("tu-choi");
      expect(JSON.stringify(r)).not.toContain(DAU);
    }
  });

  it.skipIf(process.platform !== "win32")(
    "★★★ danh sách tiến trình của HĐH (Win32_Process.CommandLine) KHÔNG chứa mật khẩu khi lệnh kiểm đang chạy; tiến trình con vẫn thấy URL qua env",
    async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-con-"));
      try {
        // lệnh kiểm "sống" ~5 s và in độ dài URL nó thấy trong env (KHÔNG in URL)
        const lenh = `node -e "console.log('DO_DAI=' + process.env.TEST_DATABASE_URL.length); setTimeout(function(){}, 5000)"`;
        const chay = taoChayLenhKiem({ testDbUrl: URL_GIA })(lenh, cwd, 60);
        await new Promise((r) => setTimeout(r, 1500));
        const ps = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        const dong = String(ps.stdout ?? "");
        expect(dong).toContain("DO_DAI="); // bằng chứng phép quét thấy đúng tiến trình con
        expect(dong).not.toContain(DAU);
        const kq = await chay;
        expect(kq.duoi).toContain(`DO_DAI=${URL_GIA.length}`);
        expect(kq.duoi).not.toContain(DAU);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
