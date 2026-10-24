/**
 * ★ Đợt 9 (2026-10-24, dieu-phoi duyệt) — `start-llama-server.ps1` chọn `--mmproj` THEO MODEL (`LLAMA_SERVER_MMPROJ`, `tim-mmproj.ps1`).
 * KheNang/API đổi model gọi đúng script này với `-Model <basename>` ⇒ đổi 35B↔27B phải mang ĐÚNG mmproj của model mới, model không có
 * mmproj ⇒ không cờ. Chạy THẬT powershell với `-InThamSo` (chỉ in tham số, không /health, không dừng, không spawn) trên thư mục model
 * giả (tệp rỗng — chỉ Test-Path). Chỉ Windows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const SCRIPT = path.resolve(__dirname, "start-llama-server.ps1");
let kho: string;
let tepEnv: string;

function chay(model: string, cheDo: string | null): { args: string[] } | { exit: number; out: string } {
  const env = [
    `GGUF_MODELS_DIR=${kho}`,
    `LLAMA_SERVER_MODEL=Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf`,
    `LLAMA_SERVER_URL=http://127.0.0.1:8091`,
    `LLAMA_SERVER_BIN=${path.join(kho, "llama-server.exe")}`,
    `LLAMA_SERVER_SELECTION_FILE=${path.join(kho, "khong-co.json")}`,
    ...(cheDo === null ? [] : [`LLAMA_SERVER_MMPROJ=${cheDo}`]),
  ].join("\n");
  fs.writeFileSync(tepEnv, env);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-EnvFile", tepEnv, "-Model", model, "-InThamSo"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const dong = (r.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("{"));
  if (r.status !== 0 || !dong) return { exit: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
  return { args: JSON.parse(dong).args };
}
const mmprojCua = (r: ReturnType<typeof chay>) => {
  if (!("args" in r)) throw new Error(`script hỏng: ${JSON.stringify(r)}`);
  const i = r.args.indexOf("--mmproj");
  return i < 0 ? null : path.basename(r.args[i + 1]);
};

describe.runIf(WIN)("start-llama-server.ps1 — --mmproj theo model", () => {
  beforeAll(() => {
    kho = fs.mkdtempSync(path.join(os.tmpdir(), "tim-mmproj-"));
    tepEnv = path.join(kho, "thu.env");
    for (const t of [
      "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", "Qwen3.6-35B-A3B-mmproj-F16.gguf",
      "Qwen3.6-27B-UD-Q4_K_XL.gguf", "Qwen3.6-27B-mmproj-F16.gguf",
      "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf", "llama-server.exe",
    ]) fs.writeFileSync(path.join(kho, t), "");
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "exit 0"]); // ấm powershell
  }, 60_000);
  afterAll(() => fs.rmSync(kho, { recursive: true, force: true }));

  it("auto: 35B ⇒ mmproj của 35B; đổi khe sang 27B ⇒ mmproj của 27B (không lẫn)", () => {
    expect(mmprojCua(chay("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", "auto"))).toBe("Qwen3.6-35B-A3B-mmproj-F16.gguf");
    expect(mmprojCua(chay("Qwen3.6-27B-UD-Q4_K_XL.gguf", "auto"))).toBe("Qwen3.6-27B-mmproj-F16.gguf");
  }, 120_000);
  it("auto: model không có mmproj ⇒ không cờ (chạy chữ)", () => {
    expect(mmprojCua(chay("Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf", "auto"))).toBeNull();
  }, 60_000);
  it("off ⇒ không cờ; đường dẫn tường minh không tồn tại ⇒ thoát 2 (không spawn)", () => {
    expect(mmprojCua(chay("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", "off"))).toBeNull();
    const r = chay("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", path.join(kho, "khong-co-mmproj.gguf"));
    expect("exit" in r && r.exit).toBe(2);
  }, 120_000);
  it("vắng khoá ⇒ mặc định hiện hành của mã", () => {
    // Mặc định hiện hành: 'off' cho tới khi dieu-phoi duyệt đổi sang 'auto' (đổi mặc định ⇒ sửa ca này cùng commit).
    expect(mmprojCua(chay("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", null))).toBeNull();
  }, 60_000);
});
