#!/usr/bin/env node
/**
 * F5: tạo tệp khoá cho `--api-key-file` của llama-server. Khoá ngẫu nhiên 32 byte, chỉ in 4 ký tự cuối.
 *
 *   node scripts/ai/tao-khoa-llama.mjs <đường tệp ngoài repo>
 *
 * Không ghi đè tệp có sẵn. Từ chối đường trong repo (dễ commit nhầm). Windows: gỡ quyền kế thừa, chỉ chừa tài khoản đang chạy.
 * Thoát 0 = xong · 1 = từ chối · 2 = đặt quyền hỏng (tệp đã bị xoá).
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Đường hợp lệ: tuyệt đối sau resolve, ngoài `goc`, chưa tồn tại. Trả lý do từ chối hoặc null. */
export function lyDoTuChoi(tep, goc = GOC) {
  if (!tep) return "thiếu đường tệp";
  const p = path.resolve(tep);
  const rel = path.relative(goc, p);
  if (rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))) return "đường nằm trong repo";
  if (fs.existsSync(p)) return "tệp đã có, không ghi đè";
  return null;
}

export function taoKhoa() {
  return crypto.randomBytes(32).toString("base64url");
}

function datQuyen(p) {
  if (process.platform !== "win32") return fs.chmodSync(p, 0o600);
  const r = spawnSync("icacls", [p, "/inheritance:r", "/grant:r", `${os.userInfo().username}:F`], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tep = process.argv[2];
  const tuChoi = lyDoTuChoi(tep);
  if (tuChoi) {
    console.error(`từ chối: ${tuChoi}`);
    process.exit(1);
  }
  const p = path.resolve(tep);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const khoa = taoKhoa();
  fs.writeFileSync(p, `${khoa}\n`, { flag: "wx", mode: 0o600 });
  try {
    datQuyen(p);
  } catch (e) {
    fs.rmSync(p, { force: true });
    console.error(`không đặt được quyền, đã xoá tệp: ${e?.message ?? e}`);
    process.exit(2);
  }
  console.log(`đã tạo ${p}, khoá kết thúc bằng ...${khoa.slice(-4)}`);
}
