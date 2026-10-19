/**
 * Cụm PostgreSQL DÙNG-XONG-VỨT cho bộ `tasks-api2` (bài `pgsql` + bài drizzle `pg: true`).
 *
 * Vì sao không dùng CSDL `_test` của repo (vitest.setup.ts): `aoi` là CHỦ của CSDL ấy và các bài kiểm tích hợp khác đang
 * dùng chung nó — SQL do model sinh chạy ở đó có thể DROP bảng của người khác. Ở đây mỗi lượt chấm có CỤM RIÊNG:
 *   • `initdb` một lần vào khuôn `%TEMP%/ai-eval-pg-mau-<phiên bản>` (≈ 4 s), rồi mỗi lượt CHÉP khuôn vào thư mục bài;
 *   • `pg_ctl start` trên 127.0.0.1, cổng trống ngẫu nhiên, xác thực `trust` cho người dùng `eval`, fsync tắt;
 *   • người gọi (`cham.mjs`) DỪNG cụm trong `finally` — kể cả khi bài kiểm bị giết vì quá giờ.
 * Không cần admin (pg_ctl tự hạ quyền token khi chạy dưới tài khoản quản trị chưa nâng quyền).
 *
 * Tìm bin: `AI_EVAL_PG_BIN` (thư mục chứa initdb/pg_ctl) ⇒ `C:/Program Files/PostgreSQL/{18,17,16,15}/bin` ⇒ PATH.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const EXE = process.platform === "win32" ? ".exe" : "";

export function timPgBin() {
  const env = process.env.AI_EVAL_PG_BIN?.trim();
  if (env && fs.existsSync(path.join(env, `initdb${EXE}`))) return env;
  for (const v of ["18", "17", "16", "15"]) {
    const p = `C:/Program Files/PostgreSQL/${v}/bin`;
    if (fs.existsSync(path.join(p, `initdb${EXE}`))) return p;
  }
  return null;
}

/**
 * Chạy và chờ sự kiện `exit` (KHÔNG chờ `close`): `pg_ctl start` để lại tiến trình postgres thừa kế ống stdout/stderr,
 * nên chờ đóng ống là chờ tới khi máy chủ tắt.
 */
function chayCho(exe, args, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, signal });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const h = setTimeout(() => {
      try { p.kill(); } catch { /* đã chết */ }
      reject(new Error(`quá giờ ${timeoutMs} ms: ${path.basename(exe)} ${args.join(" ")}`));
    }, timeoutMs);
    p.on("error", (e) => { clearTimeout(h); reject(e); });
    p.on("exit", (code) => {
      clearTimeout(h);
      p.stdout.destroy();
      p.stderr.destroy();
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(exe)} thoát ${code}: ${out.slice(-800)}`));
    });
  });
}

function congTrong() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function khuon(bin, signal) {
  const ver = path.basename(path.dirname(bin)).replace(/[^\w.-]/g, "") || "pg";
  const mau = path.join(os.tmpdir(), `ai-eval-pg-mau-${ver}`);
  if (fs.existsSync(path.join(mau, "PG_VERSION"))) return mau;
  const tam = `${mau}-${process.pid}-${Date.now()}`;
  await chayCho(path.join(bin, `initdb${EXE}`), ["-D", tam, "-U", "eval", "-A", "trust", "-E", "UTF8", "--no-locale", "--no-sync"], 120000, signal);
  try {
    fs.renameSync(tam, mau);
  } catch {
    fs.rmSync(tam, { recursive: true, force: true }); // lượt song song khác đã đặt khuôn trước
  }
  return mau;
}

/** Dựng một cụm trong `dir/pgdata` ⇒ `{ url, dung() }`. */
export async function batPg(dir, signal) {
  const bin = timPgBin();
  if (!bin) throw new Error("không tìm thấy PostgreSQL (initdb) — đặt AI_EVAL_PG_BIN tới thư mục bin");
  const mau = await khuon(bin, signal);
  const data = path.join(dir, "pgdata");
  fs.rmSync(data, { recursive: true, force: true });
  fs.cpSync(mau, data, { recursive: true });
  const port = await congTrong();
  const pgCtl = path.join(bin, `pg_ctl${EXE}`);
  await chayCho(pgCtl, ["-D", data, "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=30`, "-l", path.join(dir, "pg.log"), "-w", "-t", "60", "start"], 90000, signal);
  let daDung = false;
  return {
    url: `postgres://eval@127.0.0.1:${port}/postgres`,
    async dung() {
      if (daDung) return;
      daDung = true;
      try {
        await chayCho(pgCtl, ["-D", data, "-m", "immediate", "-w", "-t", "30", "stop"], 60000);
      } catch {
        /* đã dừng / không dừng được — không làm hỏng kết quả chấm */
      }
    },
  };
}
