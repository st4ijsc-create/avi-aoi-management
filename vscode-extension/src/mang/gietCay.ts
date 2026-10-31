/**
 * ★★★ Đợt 12 / H2 — GIẾT CẢ CÂY tiến trình con của extension (lệnh đã duyệt, MCP server). Lớp I/O mỏng: quyết định nằm ở
 * `shared/tienTrinhAnToan.ts#gietCayTienTrinhChung` (một chủ với máy chủ); tệp này chỉ cung cấp hiệu ứng thật (`taskkill`, `process.kill`).
 *
 * VÌ SAO: trên Windows `cp.kill()` chỉ giết đúng tiến trình đầu — `npm → cmd → node` (hoặc một MCP server là `npx` bọc `node`) còn lại mồ côi,
 * tiếp tục chạy và giữ cổng/tệp. POSIX: tiến trình phải sinh với `detached: true` (xem nơi gọi) để pid là thủ lĩnh nhóm.
 */
import { spawn } from "node:child_process";
import { gietCayTienTrinhChung, type KetQuaGiet } from "../../../shared/tienTrinhAnToan";

export function gietCayTienTrinh(pid: number | undefined | null): KetQuaGiet {
  return gietCayTienTrinhChung(pid, {
    windows: process.platform === "win32",
    chayTaskkill: (p) => {
      const tk = spawn("taskkill", ["/PID", String(p), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      tk.on("error", () => {
        // taskkill vắng mặt là chuyện của môi trường — nơi gọi vẫn gọi thêm `cp.kill()` làm lớp thứ hai.
      });
      tk.unref();
    },
    guiTinHieu: (p, tinHieu) => {
      process.kill(p, tinHieu);
    },
  });
}

/**
 * ⚠ THỨ TỰ: `taskkill /T` đi theo liên kết cha→con; nếu `cp.kill()` giết CHA trước thì cháu mất cha và `/T` không tìm ra (đo: cháu `detached` còn sống).
 * Nên ra lệnh giết cây TRƯỚC, `cp.kill()` chỉ là lớp thứ hai: ngay khi giết cây không ra lệnh được, còn lại thì sau ân hạn ngắn.
 */
export function gietCayThenLopHai(cp: { pid?: number; kill: () => boolean }, anHanMs = 1_500): void {
  const r = gietCayTienTrinh(cp.pid);
  const lopHai = () => {
    try {
      cp.kill();
    } catch {
      // đã chết sẵn — vô hại
    }
  };
  if (r === "da-ra-lenh") setTimeout(lopHai, anHanMs).unref();
  else lopHai();
}


/** Hiệu ứng tiêm được (cho lưới đo nhánh POSIX trên máy Windows mà không giết nhầm tiến trình thật). */
export interface MoDongMem {
  windows: boolean;
  gietCay: (pid: number | undefined | null) => KetQuaGiet;
}

/**
 * ★ Đợt 12/H2 (theo kiem-dinh) — ĐÓNG MỘT TIẾN TRÌNH SỐNG LÂU, KHÔNG detached (MCP server).
 * Windows: như `gietCayThenLopHai` (`taskkill /T /F` đủ cây). POSIX: pid KHÔNG phải thủ lĩnh nhóm ⇒ `kill(-pid)` hụt rồi rơi về SIGKILL
 * thẳng vào `npx`/`node` đầu ⇒ cháu do `npx` sinh mồ côi. Nên POSIX gửi SIGTERM TRƯỚC (npx/npm chuyển tín hiệu cho cháu, server dọn dẹp
 * êm), rồi SIGKILL cả cây sau ân hạn nếu còn sống.
 */
export function dongTienTrinhSongLau(
  cp: { pid?: number; kill: (tinHieu?: NodeJS.Signals) => boolean; exitCode: number | null; signalCode: NodeJS.Signals | null },
  anHanMs = 2_000,
  mo: MoDongMem = { windows: process.platform === "win32", gietCay: gietCayTienTrinh },
): void {
  if (mo.windows) {
    gietCayThenLopHai(cp as { pid?: number; kill: () => boolean }, 1_500);
    return;
  }
  try {
    cp.kill("SIGTERM");
  } catch {
    // đã chết sẵn — vô hại
  }
  setTimeout(() => {
    if (cp.exitCode !== null || cp.signalCode !== null) return; // đã thoát êm
    mo.gietCay(cp.pid);
    try {
      cp.kill("SIGKILL");
    } catch {
      // vô hại
    }
  }, anHanMs).unref();
}
