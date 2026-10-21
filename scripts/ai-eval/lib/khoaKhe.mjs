/**
 * ★ Đợt 9 (2026-10-21) — GIỮ KHOÁ KHE cho phép đo / đổi model NGOÀI app (đọc: server/services/ai/khoaKhe.ts).
 * Tệp `LLAMA_WATCHDOG_PAUSE_FILE` (mặc định %TEMP%/llama-watchdog.pause) mang JSON `{chu, lyDo, hetHan, pid, token}`;
 * gia hạn mỗi `nhipMs` (hetHan = bây giờ + giaHanMs); gỡ khi xong (chỉ khi tệp còn là của token này). Tiến trình chết ⇒
 * không còn gia hạn ⇒ khoá TỰ hết hạn sau ≤ giaHanMs.
 *
 *   import { giuKhoaKhe } from "../lib/khoaKhe.mjs";  const k = giuKhoaKhe({ chu: "mot-luot X", lyDo: "đo plc-st-v1" }); … k.go();
 *   node scripts/ai-eval/lib/khoaKhe.mjs giu "<chủ>" "<lý do>"   # giữ tới khi bị kill (dùng trong script shell), gỡ khi SIGINT/SIGTERM
 *   node scripts/ai-eval/lib/khoaKhe.mjs xem                      # in khoá hiện tại
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function duongKhoaKhe(env = process.env) {
  return (env.LLAMA_WATCHDOG_PAUSE_FILE || "").trim() || path.join(env.TEMP || os.tmpdir(), "llama-watchdog.pause");
}

export function giuKhoaKhe({ chu, lyDo = "", giaHanMs = 5 * 60_000, nhipMs = 30_000, duong = duongKhoaKhe() }) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ghi = () => {
    fs.mkdirSync(path.dirname(duong), { recursive: true });
    fs.writeFileSync(duong, JSON.stringify({ chu, lyDo, hetHan: new Date(Date.now() + giaHanMs).toISOString(), pid: process.pid, token }));
  };
  ghi();
  const hen = setInterval(() => {
    try {
      ghi(); // ghi LẠI cả khi người khác (doi-model.ps1) vừa ghi đè / gỡ — người giữ khoá là phép đo này
    } catch {
      /* ổ đĩa tạm hỏng: khoá sẽ tự hết hạn — phía an toàn */
    }
  }, nhipMs);
  hen.unref?.();
  let daGo = false;
  const go = () => {
    if (daGo) return;
    daGo = true;
    clearInterval(hen);
    try {
      const j = JSON.parse(fs.readFileSync(duong, "utf8"));
      if (j?.token === token) fs.unlinkSync(duong);
    } catch {
      /* không còn / không phải của ta */
    }
  };
  process.once("exit", go);
  return { go, token, duong };
}

// ── CLI ──
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [lenh, chu, lyDo] = process.argv.slice(2);
  if (lenh === "giu") {
    const k = giuKhoaKhe({ chu: chu || `khoaKhe.mjs PID ${process.pid}`, lyDo: lyDo || "" });
    console.log(`[khoa-khe] giữ ${k.duong} (token ${k.token}) — Ctrl+C / kill để gỡ`);
    const thoat = () => {
      k.go();
      process.exit(0);
    };
    process.on("SIGINT", thoat);
    process.on("SIGTERM", thoat);
    setInterval(() => {}, 1 << 30);
  } else if (lenh === "xem") {
    try {
      console.log(fs.readFileSync(duongKhoaKhe(), "utf8"));
    } catch {
      console.log("(không có khoá)");
    }
  } else {
    console.error("dùng: khoaKhe.mjs giu <chủ> <lý do> | xem");
    process.exit(2);
  }
}
