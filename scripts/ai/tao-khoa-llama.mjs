#!/usr/bin/env node
/**
 * F5: tạo tệp khoá cho `--api-key-file` của llama-server. Khoá ngẫu nhiên 32 byte, chỉ in 4 ký tự cuối.
 *
 *   node scripts/ai/tao-khoa-llama.mjs <đường tệp ngoài repo>
 *
 * Không ghi đè tệp có sẵn. Từ chối đường trong repo (dễ commit nhầm), trong thư mục cha của repo (nơi các worktree và `_tho_ca_wt` nằm) và trong mọi gốc
 * `AI_REPO_SANDBOX_ROOTS` (tool đọc tệp của agent đọc được ở đó). So trên cả đường THẬT (realpath): junction/symlink trỏ vào các nơi đó cũng bị từ chối.
 * Windows: gỡ quyền kế thừa, chỉ chừa tài khoản đang chạy. Thứ tự: tạo tệp RỖNG ⇒ đặt quyền ⇒ mới ghi khoá, để khoá không lúc nào nằm với quyền kế thừa.
 * Thoát 0 = xong · 1 = từ chối · 2 = đặt quyền hỏng (tệp đã bị xoá).
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const trong = (con, cha) => {
  const rel = path.relative(cha, con);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

/** Gốc dự án khai trong `AI_REPO_SANDBOX_ROOTS` (`id=nhãn|đường;...`). */
export function gocDuAn(chuoi = "") {
  return chuoi.split(";").map((m) => m.slice(m.indexOf("|") + 1).trim()).filter((d, i, a) => d && a[i].includes(":"));
}

/** Đường thật: realpath của tổ tiên gần nhất đang tồn tại (phân giải junction/symlink) + phần đuôi chưa tồn tại. */
export function duongThat(p) {
  let dau = path.resolve(p);
  const duoi = [];
  while (!fs.existsSync(dau)) {
    const cha = path.dirname(dau);
    if (cha === dau) break;
    duoi.unshift(path.basename(dau));
    dau = cha;
  }
  try {
    dau = fs.realpathSync.native(dau);
  } catch {
    /* không phân giải được thì giữ đường đã resolve */
  }
  return path.join(dau, ...duoi);
}

const coMuc = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/** Đường hợp lệ: ngoài repo, ngoài thư mục cha của repo, ngoài mọi gốc dự án (so cả đường gõ lẫn đường thật hai phía), chưa tồn tại. Trả lý do từ chối hoặc null. */
export function lyDoTuChoi(tep, goc = GOC, cacGoc = gocDuAn(process.env.AI_REPO_SANDBOX_ROOTS)) {
  if (!tep) return "thiếu đường tệp";
  const ps = [path.resolve(tep), duongThat(tep)];
  const vao = (g) => ps.some((p) => trong(p, path.resolve(g)) || trong(p, duongThat(g)));
  if (vao(goc)) return "đường nằm trong repo";
  if (vao(path.dirname(goc))) return "đường nằm trong thư mục chứa các worktree";
  if (cacGoc.some(vao)) return "đường nằm trong gốc dự án mà agent đọc được";
  // lstat: cả liên kết treo (trỏ tới chỗ chưa có) cũng tính là đã có; không ghi theo nó.
  if (coMuc(path.resolve(tep))) return "tệp đã có, không ghi đè";
  return null;
}

export function taoKhoa() {
  return crypto.randomBytes(32).toString("base64url");
}

export function datQuyen(p) {
  if (process.platform !== "win32") return fs.chmodSync(p, 0o600);
  const r = spawnSync("icacls", [p, "/inheritance:r", "/grant:r", `${os.userInfo().username}:F`], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
}

/**
 * Tạo tệp RỖNG (wx: không ghi đè, không theo liên kết có sẵn) ⇒ đặt quyền ⇒ ghi khoá vào chính tệp đó. Đặt quyền hỏng ⇒ xoá tệp
 * (lúc đó tệp còn rỗng) và ném. Trả khoá.
 */
export function taoTepKhoa(p, datQuyenFn = datQuyen) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "", { flag: "wx", mode: 0o600 });
  try {
    datQuyenFn(p);
  } catch (e) {
    fs.rmSync(p, { force: true });
    throw e;
  }
  const khoa = taoKhoa();
  const fd = fs.openSync(p, "r+");
  try {
    fs.writeSync(fd, `${khoa}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return khoa;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tep = process.argv[2];
  const tuChoi = lyDoTuChoi(tep);
  if (tuChoi) {
    console.error(`từ chối: ${tuChoi}`);
    process.exit(1);
  }
  const p = path.resolve(tep);
  let khoa;
  try {
    khoa = taoTepKhoa(p);
  } catch (e) {
    console.error(`không đặt được quyền, đã xoá tệp: ${e?.message ?? e}`);
    process.exit(2);
  }
  console.log(`đã tạo ${p}, khoá kết thúc bằng ...${khoa.slice(-4)}`);
}
