/**
 * ĐƯỜNG DÒNG LỆNH THẬT: gọi `main(argv)` (cùng đường phân tích tham số `docThamSo` + dựng ThamSoViec như khi chạy `tsx chayMotViec.ts …`) rồi đọc JSON ở stdout.
 * Lỗ phát hiện ở rà kiem-dinh --luat-cach: bỏ dòng truyền `luatCach` ở main() mà 506 test vẫn xanh vì không test nào đi qua CLI.
 * Mỗi cờ dưới đây có ít nhất một ca ĐI QUA main(). Cờ KHÔNG test được ở đây (cần driver host = CSDL + máy chủ model): --env-tu, --nguoi-id, --nguoi-vai, --han-duyet, --cong-ke-hoach, --ghi-luot.
 * ĐỘT BIẾN PHẢI BẮT: bỏ truyền luatCach / luat / base / ra / khoGhi / wt / choPhepDb / testDbUrl / coAiAgent / thẻ.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./chayMotViec";

const sh = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

const B1 = "# AGENTS gốc của base\nSENTINEL_B1_CLI: luật chung.\n";
const BO_SUNG = "# Bổ sung CLI\nSENTINEL_BOSUNG_CLI: phần riêng.\n";
const THE = (csdl = false) => `MÃ: TC-93
MỤC TIÊU: thử qua dòng lệnh
TỆP ĐƯỢC PHÉP SỬA/TẠO: docs/ghi-chu.md
${csdl ? "CSDL: chạm aoi_management_test (CHỈ CSDL _test; mọi ghi nằm trong giao dịch ROLLBACK)\n" : ""}LỆNH KIỂM: npx vitest run scripts/x/a.test.ts
GIỚI HẠN: 1 phút, 3 vòng`;
const URL_TEST = "postgresql://tho_ca_test:MatKhauCLI9876@127.0.0.1:5434/aoi_management_test";

let goc: string;
let wt: string;
let ra: string;
let baseSha: string;
let tepThe: string;
const envCu: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("AI_AGENT_")) envCu[k] = process.env[k];
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tccli-"));
  const kho = path.join(goc, "kho-chinh");
  wt = path.join(goc, "_tho_ca_wt_cli");
  ra = path.join(goc, "ra");
  fs.mkdirSync(path.join(kho, "docs"), { recursive: true });
  git(kho, "init", "-q");
  git(kho, "config", "user.email", "t@t");
  git(kho, "config", "user.name", "t");
  git(kho, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(kho, "docs/ghi-chu.md"), "cu\n");
  fs.writeFileSync(path.join(kho, "AGENTS.md"), B1);
  git(kho, "add", ".");
  git(kho, "commit", "-q", "-m", "init");
  baseSha = git(kho, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(kho, "docs/ghi-chu.md"), "cu\nthem\n");
  git(kho, "commit", "-qam", "sau");
  // main() chỉ nhận worktree LIÊN KẾT (không có đường tắt kho riêng ở dòng lệnh)
  git(kho, "worktree", "add", "-q", "--detach", wt, "HEAD");
  tepThe = path.join(goc, "the.txt");
  fs.writeFileSync(tepThe, THE());
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("AI_AGENT_") && !(k in envCu)) delete process.env[k];
  for (const [k, v] of Object.entries(envCu)) if (v !== undefined) process.env[k] = v;
  fs.rmSync(goc, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** gọi main(argv), bắt stdout/stderr; trả mã thoát + JSON cuối của stdout (nếu có) */
async function chayCli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((s: string | Uint8Array) => (out.push(String(s)), true)) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string | Uint8Array) => (err.push(String(s)), true)) as never);
  let ma: number;
  try {
    ma = await main(argv);
  } finally {
    vi.restoreAllMocks();
  }
  const dongJson = out.join("").split("\n").filter((x) => x.trim().startsWith("{")).pop();
  return { ma, json: dongJson ? (JSON.parse(dongJson) as Record<string, any>) : null, out: out.join(""), err: err.join("") };
}
const coBan = (them: string[] = []) => ["--the", tepThe, "--wt", wt, "--base", baseSha, "--driver", "kho", "--ra", ra, ...them];

describe("main() — cờ luật", () => {
  it("★★★ --luat-cach ghep + --luat <tệp> ⇒ JSON luatCach=ghep, luat.nguon/sha là TỆP --luat, có b1 (AGENTS.md của BASE)", async () => {
    const tepLuat = path.join(goc, "bo-sung.md");
    fs.writeFileSync(tepLuat, BO_SUNG);
    const r = await chayCli(coBan(["--luat-cach", "ghep", "--luat", tepLuat]));
    expect(r.json, r.err).not.toBeNull();
    expect(r.json!.luatCach).toBe("ghep");
    expect(r.json!.luat).toEqual({ sha256: sh(BO_SUNG), nguon: path.resolve(tepLuat), byte: Buffer.byteLength(BO_SUNG, "utf8") });
    expect(r.json!.b1).toMatchObject({ sha256: sh(B1), saoLuotKhop: true });
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(B1);
  });
  it("★★★ KHÔNG --luat-cach ⇒ ghi-de (mặc định): JSON luatCach=ghi-de, không có b1, AGENTS.md worktree bị ghi đè bằng luật --luat", async () => {
    const tepLuat = path.join(goc, "luat.md");
    fs.writeFileSync(tepLuat, BO_SUNG);
    const r = await chayCli(coBan(["--luat", tepLuat]));
    expect(r.json!.luatCach).toBe("ghi-de");
    expect("b1" in r.json!).toBe(false);
    expect(r.json!.luat).toMatchObject({ sha256: sh(BO_SUNG), nguon: path.resolve(tepLuat) });
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(BO_SUNG);
  });
  it("★★ --luat-cach lạ ⇒ mã 2, thông báo nêu giá trị", async () => {
    const r = await chayCli(coBan(["--luat-cach", "tron"]));
    expect(r.ma).toBe(2);
    expect(r.err).toContain("tron");
  });
  it("★★ --luat trỏ tệp không có ⇒ ném lỗi (không lùi lặng lẽ về luật mặc định)", async () => {
    await expect(chayCli(coBan(["--luat", path.join(goc, "khong-co.md")]))).rejects.toThrow("--luat: không có tệp");
  });
});

describe("main() — cờ nơi chạy", () => {
  it("★★★ --base <sha> ⇒ JSON baseSha = đúng sha đó (không phải HEAD / main)", async () => {
    const r = await chayCli(coBan());
    expect(r.json!.baseSha).toBe(baseSha);
    expect(r.json!.nhanh).toBe("pilot/tho-ca-TC-93");
    expect(git(wt, "rev-parse", "pilot/tho-ca-TC-93")).toBe(baseSha);
  });
  it("★★★ --ra <thư mục> ⇒ diff nằm ĐÚNG trong thư mục đó; --wt ⇒ chạy đúng worktree (nhánh pilot ở đó)", async () => {
    const r = await chayCli(coBan());
    expect(path.resolve(r.json!.diff)).toBe(path.join(path.resolve(ra), "TC-93.diff"));
    expect(fs.existsSync(path.join(ra, "TC-93.diff"))).toBe(true);
    expect(git(wt, "branch", "--show-current")).toBe("pilot/tho-ca-TC-93");
  });
  it("★★★ --kho-ghi '<json>' (driver kho) ⇒ tệp được ghi vào worktree và vào tepDoi/diff", async () => {
    const r = await chayCli(coBan(["--kho-ghi", JSON.stringify({ "docs/ghi-chu.md": "moi\n" })]));
    expect(fs.readFileSync(path.join(wt, "docs/ghi-chu.md"), "utf8")).toBe("moi\n");
    expect(r.json!.tepDoi).toEqual(["docs/ghi-chu.md"]);
    expect(r.json!.driver).toBe("kho");
  });
  it("★★ --driver lạ ⇒ mã 2; thiếu --the ⇒ mã 2 và nêu cách dùng", async () => {
    expect((await chayCli(coBan(["--driver", "xe"]))).ma).toBe(2);
    const r = await chayCli([]);
    expect(r.ma).toBe(2);
    expect(r.err).toContain("--luat-cach ghi-de|ghep");
  });
  it("★★ thẻ đọc từ --the: mã thẻ trong JSON là của tệp thẻ", async () => {
    expect((await chayCli(coBan())).json!.ma).toBe("TC-93");
  });
});

describe("main() — cờ AI_AGENT_* (--co)", () => {
  it("★★★ --co AI_AGENT_NEN_MOC=0.5 ⇒ JSON coAiAgent mang cờ đó; cờ không hợp lệ ⇒ mã 2", async () => {
    const r = await chayCli(coBan(["--co", "AI_AGENT_NEN_MOC=0.5"]));
    expect(r.json!.coAiAgent).toMatchObject({ AI_AGENT_NEN_MOC: "0.5" });
    const sai = await chayCli(coBan(["--co", "PATH=1"]));
    expect(sai.ma).toBe(2);
    expect(sai.err).toContain("--co không hợp lệ");
  });
});

describe("main() — --cho-phep-db + --tep-url-csdl (đường thành công)", () => {
  it("★★★ đủ cờ + thẻ có dòng CSDL + --ra ngoài ⇒ JSON choPhepDb=true, vaiCsdl=tho_ca_test, KHÔNG có mật khẩu ở stdout/stderr/JSON", async () => {
    fs.writeFileSync(tepThe, THE(true));
    const tepUrl = path.join(goc, "tho_ca_test.url");
    fs.writeFileSync(tepUrl, URL_TEST);
    const r = await chayCli(coBan(["--cho-phep-db", "--tep-url-csdl", tepUrl]));
    expect(r.json, r.err).not.toBeNull();
    expect(r.json!.choPhepDb).toBe(true);
    expect(r.json!.vaiCsdl).toBe("tho_ca_test");
    expect(r.out + r.err).not.toContain("MatKhauCLI9876");
    expect(JSON.stringify(r.json)).not.toContain("MatKhauCLI9876");
  });
  it("★★★ KHÔNG --cho-phep-db ⇒ JSON không có choPhepDb/vaiCsdl (cờ mặc định TẮT)", async () => {
    const r = await chayCli(coBan());
    expect("choPhepDb" in r.json!).toBe(false);
    expect("vaiCsdl" in r.json!).toBe(false);
  });
  it("★★ thẻ KHÔNG có dòng CSDL mà có cờ ⇒ từ chối (tu-choi), mã thoát 1", async () => {
    const tepUrl = path.join(goc, "tho_ca_test.url");
    fs.writeFileSync(tepUrl, URL_TEST);
    const r = await chayCli(coBan(["--cho-phep-db", "--tep-url-csdl", tepUrl]));
    expect(r.ma).toBe(1);
    expect(r.json!.ketCuc).toBe("tu-choi");
    expect(r.json!.loi).toContain("dòng CSDL");
  });
});
