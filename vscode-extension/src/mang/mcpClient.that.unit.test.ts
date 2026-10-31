// Đợt 12 / H2 — MCP server (tiến trình THẬT): môi trường nền đã lọc bí mật, biến RIÊNG của server đặt sau lọc, đóng kênh giết cả cây.
import { afterEach, describe, expect, it } from "vitest";
import { taoTienTrinhMcpNgoai } from "./mcpClient";

const DAT: string[] = [];
afterEach(() => {
  for (const k of DAT.splice(0)) delete process.env[k];
});

async function docHet(dongDoc: AsyncIterable<Buffer>): Promise<string> {
  let s = "";
  for await (const c of dongDoc) s += c.toString("utf8");
  return s;
}

describe("taoTienTrinhMcpNgoai — môi trường (thật)", () => {
  it("★★★ khoá/token của dev KHÔNG tới MCP server; biến RIÊNG khai cho server (`moi`) thì CÓ (đặt sau lọc)", async () => {
    for (const [k, v] of [["GITHUB_TOKEN", "ghp_" + "c".repeat(36)], ["AWS_SECRET_ACCESS_KEY", "aws-mat-456"], ["JAVA_HOME", "C:\\jdk-mcp"]] as const) {
      process.env[k] = v;
      DAT.push(k);
    }
    const kenh = taoTienTrinhMcpNgoai({
      ten: "thu",
      lenh: process.execPath,
      doi: ["-e", "console.log(JSON.stringify(process.env))"],
      moi: { MY_SERVER_TOKEN: "token-rieng-cua-server" },
    });
    const env = JSON.parse(await docHet(kenh.dongDoc)) as Record<string, string>;
    const ten = Object.keys(env).map((k) => k.toUpperCase());
    expect(ten).not.toContain("GITHUB_TOKEN");
    expect(ten).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(JSON.stringify(env)).not.toContain("aws-mat-456");
    expect(env.JAVA_HOME).toBe("C:\\jdk-mcp");
    expect(env.MY_SERVER_TOKEN).toBe("token-rieng-cua-server");
  }, 30_000);
});

describe("taoTienTrinhMcpNgoai — đóng kênh giết CẢ CÂY (thật)", () => {
  // POSIX: MCP server KHÔNG detached (chủ ý, tránh mồ côi khi host chết) ⇒ chỉ giết được đúng pid; cây chỉ bảo đảm trên Windows (taskkill /T).
  it.skipIf(process.platform !== "win32")("★★ `dong()` giết cả tiến trình CHÁU (server là wrapper bọc tiến trình thật)", async () => {
    const script =
      'const cp=require("child_process");' +
      'const g=cp.spawn(process.execPath,["-e","setTimeout(()=>{},120000)"],{stdio:"ignore",detached:true});' +
      'console.log("PID-CHAU:"+g.pid);setTimeout(()=>{},120000)';
    const kenh = taoTienTrinhMcpNgoai({ ten: "thu", lenh: process.execPath, doi: ["-e", script], moi: {} });
    const dau = await kenh.dongDoc[Symbol.asyncIterator]().next();
    const mm = /PID-CHAU:([0-9]+)/.exec(Buffer.from(dau.value as Buffer).toString("utf8"));
    expect(mm).not.toBeNull();
    const pidChau = Number(mm![1]);
    kenh.dong();
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
        process.kill(pidChau, "SIGKILL");
      } catch {
        /* */
      }
    }
    expect(con, "tiến trình CHÁU của MCP server còn sống sau dong()").toBe(false);
  }, 40_000);
});
