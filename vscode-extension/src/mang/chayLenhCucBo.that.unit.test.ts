// Đợt 12 / H2 — chạy tiến trình THẬT (node con): môi trường đã lọc bí mật, đầu ra ĐẦU+CUỐI không giết lệnh, hết giờ giết CẢ CÂY.
// Cháu sinh với `detached:true` — trên Windows nếu không thì `cp.kill()` đã kéo cháu chết theo và lưới không phân biệt được có/không `taskkill /T`.
// (Tệp M2 cũ nói lớp spawn "không unit-test trực tiếp" vì I/O thật; ba hành vi AN TOÀN dưới đây thì phải có lưới — đo bằng tiến trình thật.)
import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import type { LenhDaDuyet } from "../loi/lenhChoPhep";
import { chayLenhCucBo } from "./chayLenhCucBo";

const lenhNode = (script: string, env?: Record<string, string>): LenhDaDuyet =>
  ({ ten: "node-test", argv: [process.execPath, "-e", script], hienThi: "node -e …", ...(env ? { env } : {}) }) as unknown as LenhDaDuyet;

const DAT: string[] = [];
const datEnv = (k: string, v: string) => {
  process.env[k] = v;
  DAT.push(k);
};
afterEach(() => {
  for (const k of DAT.splice(0)) delete process.env[k];
});

describe("chayLenhCucBo — môi trường (thật)", () => {
  it("★★★ token/khoá đám mây của dev KHÔNG tới tiến trình con; PATH, proxy, JAVA_HOME thì có; `lenh.env` đặt sau lọc", async () => {
    datEnv("GITHUB_TOKEN", "ghp_" + "b".repeat(36));
    datEnv("AWS_SECRET_ACCESS_KEY", "aws-bi-mat-123");
    datEnv("DATABASE_URL", "postgres://u:matkhau@h/db");
    datEnv("MY_API_KEY", "khoa-rieng");
    datEnv("JAVA_HOME", "C:\\jdk-thu");
    datEnv("HTTPS_PROXY", "http://proxy.thu:8080");
    const kq = await chayLenhCucBo({
      lenh: lenhNode("console.log(JSON.stringify(process.env))", { GOFLAGS_THU: "-mod=mod" }),
      cwd: tmpdir(),
      tranMs: 20_000,
    });
    expect(kq.ok).toBe(true);
    const env = JSON.parse(kq.output) as Record<string, string>;
    const ten = Object.keys(env).map((k) => k.toUpperCase());
    for (const cam of ["GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "DATABASE_URL", "MY_API_KEY"]) expect(ten, cam).not.toContain(cam);
    expect(JSON.stringify(env)).not.toContain("aws-bi-mat-123");
    expect(JSON.stringify(env)).not.toContain("matkhau");
    expect(env.JAVA_HOME).toBe("C:\\jdk-thu");
    expect(env.HTTPS_PROXY).toBe("http://proxy.thu:8080");
    expect(ten.some((k) => k === "PATH")).toBe(true);
    expect(env.GOFLAGS_THU).toBe("-mod=mod");
  }, 40_000);
});

describe("chayLenhCucBo — đầu ra ĐẦU + CUỐI (thật)", () => {
  it("★★ lệnh in 5 MB rồi báo lỗi ở cuối: KHÔNG bị giết, thoát bình thường, giữ ĐẦU và dòng lỗi CUỐI, khai phần giữa bị bỏ", async () => {
    const kq = await chayLenhCucBo({
      lenh: lenhNode(
        'process.stdout.write("DAU-LENH\\n");for(let i=0;i<50;i++)process.stdout.write("x".repeat(100000)+"\\n");process.stderr.write("LOI-CUOI-CUNG\\n");process.exit(3)',
      ),
      cwd: tmpdir(),
      tranMs: 30_000,
    });
    expect(kq.timedOut).toBe(false);
    expect(kq.exitCode).toBe(3); // thoát TỰ NHIÊN (trước đây: bị giết ở 2 MB, exitCode null)
    expect(kq.output.startsWith("DAU-LENH")).toBe(true);
    expect(kq.output).toContain("LOI-CUOI-CUNG");
    expect(kq.output).toContain("Ở GIỮA");
    expect(kq.daCatSom).toBe(true);
    expect(kq.output.length).toBeLessThan(20_000);
  }, 60_000);

  it("★ in nhiều rồi thoát 0 ⇒ ok=true (bị cắt ở giữa KHÔNG làm lệnh thành công hoá thất bại)", async () => {
    const kq = await chayLenhCucBo({
      lenh: lenhNode('for(let i=0;i<40;i++)process.stdout.write("y".repeat(100000)+"\\n")'),
      cwd: tmpdir(),
      tranMs: 30_000,
    });
    expect(kq.exitCode).toBe(0);
    expect(kq.daCatSom).toBe(true);
    expect(kq.ok).toBe(true);
  }, 60_000);

  it("đầu ra ngắn ⇒ nguyên văn, không báo cắt", async () => {
    const kq = await chayLenhCucBo({ lenh: lenhNode('console.log("xin chao")'), cwd: tmpdir(), tranMs: 20_000 });
    expect(kq.output.trim()).toBe("xin chao");
    expect(kq.daCatSom).toBe(false);
    expect(kq.ok).toBe(true);
  }, 30_000);
});

describe("chayLenhCucBo — hết giờ giết CẢ CÂY (thật)", () => {
  it("★★★ tiến trình CHÁU cũng chết khi hết giờ (trước đây `cp.kill()` chỉ giết tiến trình đầu ⇒ cháu mồ côi)", async () => {
    // Cha in pid của cháu ra stdout (không ghi tệp — census extension cấm mọi API ghi tệp trong cây `src/`, kể cả lưới).
    const script =
      'const cp=require("child_process");' +
      'const g=cp.spawn(process.execPath,["-e","setTimeout(()=>{},120000)"],{stdio:"ignore",detached:true});' +
      'console.log("PID-CHAU:"+g.pid);setTimeout(()=>{},120000)';
    const kq = await chayLenhCucBo({ lenh: lenhNode(script), cwd: tmpdir(), tranMs: 2_500 });
    expect(kq.timedOut).toBe(true);
    const m = /PID-CHAU:([0-9]+)/.exec(kq.output);
    expect(m, "cha phải in pid cháu trước khi bị giết").not.toBeNull();
    const pidChau = Number(m![1]);
    let con = true;
    for (let i = 0; i < 30 && con; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        process.kill(pidChau, 0);
      } catch {
        con = false;
      }
    }
    if (con) {
      try {
        process.kill(pidChau, "SIGKILL"); // dọn để không để mồ côi nếu lưới đỏ
      } catch {
        /* */
      }
    }
    expect(con, "tiến trình CHÁU còn sống sau khi hết giờ").toBe(false);
  }, 40_000);
});
