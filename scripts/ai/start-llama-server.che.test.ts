/**
 * Lô D1-script — `start-llama-server.ps1 -InThamSo` phải CHE giá trị `--api-key` NGAY Ở NGUỒN (HST 19/11: không chỉ che ở đầu ra).
 * Chạy THẬT powershell như tim-mmproj.test.ts, với các điều kiện HST 19/11:
 *   · khoá là chuỗi GIẢ do chính ca tạo (`khoa-gia-` + ngẫu nhiên), truyền tường minh qua `-EnvFile` trỏ .env TẠM;
 *   · script KHÔNG đọc .env thật (luôn có `-EnvFile`), không đọc tệp lựa chọn thật (`LLAMA_SERVER_SELECTION_FILE` trỏ tệp tạm không có),
 *     không thấy bin llama thật (`LLAMA_SERVER_BIN` = tệp rỗng trong thư mục tạm); thư mục làm việc = thư mục tạm;
 *   · env tiến trình con LỌC bỏ mọi biến LLAMA_* / GGUF_* / AI_* của tiến trình cha, đặt 6 cờ Luật A = false;
 *   · khẳng định NGUỒN: `--alias` mang đúng dấu giả của ca ⇒ .env đọc được là .env tạm ⇒ giá trị trước khi che chỉ có thể là khoá giả;
 *   · khẳng định dạng boolean ⇒ khi đỏ, vitest KHÔNG in giá trị khoá (chỉ in tiền tố giả đã biết qua thông điệp ca).
 * `-InThamSo` thoát ở :265, TRƯỚC mọi /health, Stop-Process, Start-Process (đọc mã main cc73d5f15: dòng 1–265 không có lệnh nào trong số đó).
 * Chỉ Windows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const SCRIPT = path.resolve(__dirname, "start-llama-server.ps1");
const MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf";
const TIEN_TO = "khoa-gia-";
let kho: string;
let tepEnv: string;

function envCon(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(LLAMA_|GGUF_|AI_)/i.test(k)) e[k] = v;
  for (const k of ["ROBOT_CONTROL_ENABLED", "OT_CONTROL_ENABLED", "FOE_ENABLED", "FOE_DURABLE", "OT_GATEWAY_ENABLED", "ROBOT_GATEWAY_ENABLED"]) e[k] = "false";
  return e;
}

function chay(them: string[]): { status: number; out: string; args: string[] | null } {
  fs.writeFileSync(
    tepEnv,
    [
      `GGUF_MODELS_DIR=${kho}`,
      `LLAMA_SERVER_MODEL=${MODEL}`,
      `LLAMA_SERVER_URL=http://127.0.0.1:9`,
      `LLAMA_SERVER_BIN=${path.join(kho, "llama-gia.exe")}`,
      `LLAMA_SERVER_SELECTION_FILE=${path.join(kho, "khong-co.json")}`,
      `LLAMA_SERVER_MMPROJ=off`,
      ...them,
    ].join("\n"),
  );
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-EnvFile", tepEnv, "-InThamSo"], {
    encoding: "utf8",
    timeout: 60_000,
    cwd: kho,
    env: envCon(),
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const dong = (r.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("{"));
  return { status: r.status ?? -1, out, args: dong ? (JSON.parse(dong).args as string[]) : null };
}
const sau = (args: string[] | null, co: string) => {
  const i = (args ?? []).indexOf(co);
  return i < 0 ? undefined : args![i + 1];
};

describe.runIf(WIN)("start-llama-server.ps1 -InThamSo — khoá", () => {
  beforeAll(() => {
    kho = fs.mkdtempSync(path.join(os.tmpdir(), "sls-che-"));
    tepEnv = path.join(kho, "thu.env");
    for (const t of [MODEL, "llama-gia.exe"]) fs.writeFileSync(path.join(kho, t), "");
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "exit 0"], { env: envCon() }); // ấm powershell
  }, 60_000);
  afterAll(() => fs.rmSync(kho, { recursive: true, force: true }));

  // Lô D1d (HST 20/11 09:26, bảng thêm/bớt pham-vi-lo-d1d-day-du.md): KHÔNG còn đưa giá trị lên dòng lệnh ⇒ chỉ có giá trị mà thiếu _FILE thì DỪNG.
  it("LLAMA_SERVER_API_KEY (giá trị GIẢ) KHÔNG có _FILE ⇒ thoát 2, không JSON tham số, lời báo nêu tên hai biến, giá trị không lọt", () => {
    const khoa = TIEN_TO + crypto.randomBytes(12).toString("hex");
    const r = chay([`LLAMA_SERVER_API_KEY=${khoa}`]);
    const sach = r.out.replaceAll(khoa, `${TIEN_TO}<…>`);
    expect(r.status, sach).toBe(2);
    expect(r.args, sach).toBeNull();
    // NGUỒN: lời báo này chỉ có khi script đọc đúng .env tạm của ca (có LLAMA_SERVER_API_KEY, không có _FILE).
    expect(sach).toContain("Co LLAMA_SERVER_API_KEY (khoa trong .env) ma khong co LLAMA_SERVER_API_KEY_FILE - KHONG khoi");
    expect(r.out.includes(khoa) || r.out.includes(JSON.stringify(khoa).slice(1, -1)), `giá trị ${TIEN_TO}<…> của ca lọt ra stdout/stderr`).toBe(false);
  }, 120_000);

  // Lô D1c C2 (HST 20/11 03:03, bảng thêm/bớt pham-vi-lo-d1c.md): -InThamSo KHÔNG in đường tệp khoá — SỬA kỳ vọng `toBe(tep)` ⇒ "<tep-khoa>", THÊM "đầu ra không chứa đường".
  it("LLAMA_SERVER_API_KEY_FILE có tệp (khoá GIẢ) ⇒ '--api-key-file <tep-khoa>', KHÔNG có '--api-key', nội dung tệp và ĐƯỜNG tệp không lọt", () => {
    const tep = path.join(kho, "k.key");
    const khoa = TIEN_TO + crypto.randomBytes(12).toString("hex");
    fs.writeFileSync(tep, khoa);
    const r = chay([`LLAMA_SERVER_API_KEY_FILE=${tep}`]);
    expect(r.status, r.out.replaceAll(khoa, `${TIEN_TO}<…>`)).toBe(0);
    // expect.soft: khẳng định :92 đỏ KHÔNG che khẳng định "không chứa đường" bên dưới (đỏ-trước phải thấy CẢ HAI).
    expect.soft(sau(r.args, "--api-key-file")).toBe("<tep-khoa>");
    // JSON của -InThamSo thoát `\` thành `\\` ⇒ so cả dạng thô lẫn dạng đã thoát JSON (chỉ so dạng thô thì kiểm này xanh giả).
    expect.soft(r.out.includes(tep) || r.out.includes(JSON.stringify(tep).slice(1, -1)), "đường tệp khoá lọt ra stdout/stderr").toBe(false);
    expect((r.args ?? []).includes("--api-key")).toBe(false);
    expect(r.out.includes(khoa), `nội dung tệp ${TIEN_TO}<…> lọt ra`).toBe(false);
  }, 120_000);

  it("LLAMA_SERVER_API_KEY_FILE trỏ tệp KHÔNG có ⇒ thoát 2, không in JSON tham số", () => {
    const r = chay([`LLAMA_SERVER_API_KEY_FILE=${path.join(kho, "khong-co.key")}`]);
    expect(r.status).toBe(2);
    expect(r.args).toBeNull();
    expect(r.out.includes(path.join(kho, "khong-co.key")), "lời báo lộ đường tệp khoá (D1c C2)").toBe(false);
  }, 120_000);
});
