/**
 * ★ Đợt 9 (2026-10-21) — GIỮ KHOÁ KHE cho phép đo / đổi model NGOÀI app (đọc: server/services/ai/khoaKhe.ts).
 * Tệp `LLAMA_WATCHDOG_PAUSE_FILE` (mặc định %TEMP%/llama-watchdog.pause) mang JSON `{chu, lyDo, hetHan, pid, token}`;
 * gia hạn mỗi `nhipMs` (hetHan = bây giờ + giaHanMs); gỡ khi xong (chỉ khi tệp còn là của token này). Tiến trình chết ⇒
 * không còn gia hạn ⇒ khoá TỰ hết hạn sau ≤ giaHanMs.
 *
 *   import { giuKhoaKhe } from "../lib/khoaKhe.mjs";  const k = giuKhoaKhe({ chu: "mot-luot X", lyDo: "đo plc-st-v1" }); … k.go();
 *   node scripts/ai-eval/lib/khoaKhe.mjs giu "<chủ>" "<lý do>" [--co-dung <tệp cờ>]   # giữ tới khi có tệp cờ (hoặc SIGINT/SIGTERM)
 *   node scripts/ai-eval/lib/khoaKhe.mjs dung <tệp cờ> [giây chờ = 15]                 # báo người giữ gỡ khoá + CHỜ nó gỡ xong
 *   node scripts/ai-eval/lib/khoaKhe.mjs xem                                            # in khoá hiện tại
 *
 * ⚠ Đợt 9 (2026-10-22, đo): `kill $KHOA` từ bash trên Windows GIẾT CỨNG node — không SIGTERM, không chạy `go()` ⇒ khoá treo tới khi
 *   hết hạn (≤ 5 phút) sau MỖI đợt đo. Script shell dùng cờ tệp:
 *     node scripts/ai-eval/lib/khoaKhe.mjs giu "<chủ>" "<lý do>" --co-dung tmp/dung-khoa-$ & KHOA=$!
 *     …; node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-$; wait $KHOA
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
      const j = JSON.parse(fs.readFileSync(duong, "utf8").replace(/^﻿/, ""));
      // Của ta = đúng token, HOẶC bản BÀN GIAO của `doi-model.ps1 -GiuKhoa <chu>` (đúng chủ, chưa có token — ta chưa kịp ghi lại).
      if (j?.token === token || (j?.chu === chu && !j?.token)) fs.unlinkSync(duong);
    } catch {
      /* không còn / không phải của ta */
    }
  };
  process.once("exit", go);
  return { go, token, duong };
}

/**
 * Người giữ dừng theo CỜ TỆP: cờ xuất hiện ⇒ `k.go()`, xoá cờ (= báo người gọi `dungQuaCo` là ĐÃ gỡ xong), rồi `sauKhiGo()`.
 * Cờ cũ còn sót lúc bắt đầu bị xoá trước (không tự dừng ngay khi vừa giữ). Trả hàm huỷ theo dõi.
 */
export function theoDoiCoDung(k, coDung, sauKhiGo = () => {}, nhipMs = 250) {
  fs.rmSync(coDung, { force: true });
  const hen = setInterval(() => {
    if (!fs.existsSync(coDung)) return;
    clearInterval(hen);
    k.go();
    fs.rmSync(coDung, { force: true });
    sauKhiGo();
  }, nhipMs);
  return () => clearInterval(hen);
}

/** Đặt cờ rồi CHỜ người giữ gỡ (cờ biến mất). Hết giờ ⇒ xoá cờ, trả `false` (khoá sẽ tự hết hạn). */
export function dungQuaCo(coDung, choMs = 15_000) {
  fs.writeFileSync(coDung, String(Date.now()));
  const het = Date.now() + choMs;
  return new Promise((xong) => {
    const cho = setInterval(() => {
      if (!fs.existsSync(coDung)) {
        clearInterval(cho);
        xong(true);
      } else if (Date.now() > het) {
        clearInterval(cho);
        fs.rmSync(coDung, { force: true });
        xong(false);
      }
    }, 100);
  });
}

// ── CLI ──
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const thamSo = process.argv.slice(2);
  const iCo = thamSo.indexOf("--co-dung");
  const coDung = iCo >= 0 ? thamSo.splice(iCo, 2)[1] : null;
  const [lenh, chu, lyDo] = thamSo;
  if (lenh === "giu") {
    const k = giuKhoaKhe({ chu: chu || `khoaKhe.mjs PID ${process.pid}`, lyDo: lyDo || "" });
    console.log(`[khoa-khe] giữ ${k.duong} (token ${k.token}) — ${coDung ? `dừng: khoaKhe.mjs dung ${coDung}` : "Ctrl+C để gỡ"}`);
    const thoat = () => {
      k.go();
      process.exit(0);
    };
    process.on("SIGINT", thoat);
    process.on("SIGTERM", thoat);
    if (coDung) theoDoiCoDung(k, coDung, () => process.exit(0));
    else setInterval(() => {}, 1 << 30);
  } else if (lenh === "dung") {
    if (!chu) {
      console.error("dùng: khoaKhe.mjs dung <tệp cờ> [giây chờ]");
      process.exit(2);
    }
    const ok = await dungQuaCo(chu, 1000 * (Number(lyDo) > 0 ? Number(lyDo) : 15));
    if (ok) console.log("[khoa-khe] người giữ đã gỡ khoá");
    else console.error(`[khoa-khe] người giữ KHÔNG phản hồi cờ ${chu} — khoá sẽ tự hết hạn (≤ 5 phút)`);
    process.exit(ok ? 0 : 1);
  } else if (lenh === "xem") {
    try {
      console.log(fs.readFileSync(duongKhoaKhe(), "utf8"));
    } catch {
      console.log("(không có khoá)");
    }
  } else {
    console.error("dùng: khoaKhe.mjs giu <chủ> <lý do> [--co-dung <tệp cờ>] | dung <tệp cờ> [giây] | xem");
    process.exit(2);
  }
}
