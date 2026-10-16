/**
 * ★★★ Rà bảo mật a5f56d089 · phát hiện 2 (2026-10-17) — **ĐƯỜNG KHO CHECKPOINT** của vòng agent, và vị từ
 * "đường này có rơi vào kho không" cho HÀNG RÀO ĐƯỜNG của hộp cát (`confineTargetUnder`/`confineDirUnder`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH RA FILE NÀY (thay vì để trong `ai/agent/checkpointAgent.ts`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cửa giam giữ (`readToolsProgramming.ts`) phải hỏi được câu "đích có nằm trong kho không" ở MỌI lượt đọc/ghi
 * của tool, mà `checkpointAgent.ts` lại nhập cửa giam giữ ⇒ đặt vị từ ở đó là vòng nhập. Ở đây chỉ có
 * `path`/`os`/`fs.realpathSync` (không API chuyển byte nào — đúng tập `programmingFileIo.census` cho phép).
 * Phép KIỂM kho có hợp lệ không (không nằm trong gốc dự án nào) cần danh sách dự án ⇒ ở `checkpointAgent.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHO MẶC ĐỊNH — THƯ MỤC DỮ LIỆU ỨNG DỤNG CỦA NGƯỜI DÙNG CHẠY SERVER, KHÔNG PHẢI REPO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản T3 đặt mặc định `<cwd>/tmp/ai-checkpoints` = TRONG gốc dự án "repo" ⇒ chính agent (tool ghi) ghi/đè được
 * `manifest.json` ⇒ một lần "Hoàn tác" ghi nội dung model chọn vào đường manifest khai. Mặc định mới:
 *   • Windows : `%LOCALAPPDATA%\avi-aoi-management\ai-checkpoints` (vắng ⇒ `<home>\AppData\Local\…`);
 *   • POSIX   : `$XDG_STATE_HOME/avi-aoi-management/ai-checkpoints` (vắng ⇒ `~/.local/state/…`).
 * Lý do chọn: (1) ổn định qua restart/đổi nhánh/`git clean` (khác `os.tmpdir()` — bị dọn ⇒ mất điểm khôi phục
 * trong khi UI vẫn hứa "Hoàn tác"); (2) ngoài mọi worktree/repo; (3) thuộc người dùng chạy server, không cần
 * quyền quản trị. `AI_CHECKPOINT_DIR` vẫn ghi đè — nhưng `checkpointAgent.khoCheckpointHopLe` TỪ CHỐI một kho
 * rơi vào (hoặc chứa) bất kỳ gốc dự án nào.
 * ⚠ Đọc env TẠI CHỖ GỌI (lưới lật env theo ca).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BIEN_KHO_CHECKPOINT = "AI_CHECKPOINT_DIR";
const TEN_UNG_DUNG = "avi-aoi-management";

/** Thư mục dữ liệu ỨNG DỤNG (bền, theo người dùng) — không phải repo, không phải thư mục tạm. */
export function thuMucDuLieuUngDung(): string {
  if (process.platform === "win32") {
    const la = (process.env.LOCALAPPDATA ?? "").trim();
    const goc = la !== "" && path.isAbsolute(la) ? la : path.join(os.homedir(), "AppData", "Local");
    return path.resolve(goc, TEN_UNG_DUNG);
  }
  const xdg = (process.env.XDG_STATE_HOME ?? "").trim();
  const goc = xdg !== "" && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "state");
  return path.resolve(goc, TEN_UNG_DUNG);
}

/** Đường kho (CHƯA kiểm hợp lệ): `AI_CHECKPOINT_DIR` (tương đối ⇒ theo cwd) hoặc mặc định ngoài repo. */
export function duongKhoCheckpoint(): string {
  const raw = (process.env[BIEN_KHO_CHECKPOINT] ?? "").trim();
  if (raw === "") return path.join(thuMucDuLieuUngDung(), "ai-checkpoints");
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

/** realpath của tổ tiên SÂU NHẤT còn tồn tại + phần đuôi chưa tồn tại. */
export function realpathMotPhan(p: string): string {
  const abs = path.resolve(p);
  let d = abs;
  const duoi: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(d), ...duoi);
    } catch {
      const cha = path.dirname(d);
      if (cha === d) return abs;
      duoi.unshift(path.basename(d));
      d = cha;
    }
  }
}

/** `con` nằm trong (hoặc chính là) `cha` — so theo đoạn; Windows không phân biệt hoa/thường. */
export function namTrongHoacLa(con: string, cha: string): boolean {
  const a = path.resolve(con);
  const b = path.resolve(cha);
  const x = process.platform === "win32" ? a.toLowerCase() : a;
  const y = process.platform === "win32" ? b.toLowerCase() : b;
  if (x === y) return true;
  const rel = path.relative(y, x);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * ★★★ HÀNG RÀO ĐƯỜNG: đích tuyệt đối `abs` có rơi vào kho checkpoint không — so CẢ dạng chữ LẪN realpath (một
 * junction/symlink trong gốc dự án trỏ vào kho cũng bị bắt). Lỗi bất ngờ ⇒ `true` (fail-closed: từ chối đích).
 */
export function laDuongTrongKhoCheckpoint(abs: string): boolean {
  try {
    const kho = duongKhoCheckpoint();
    if (namTrongHoacLa(abs, kho)) return true;
    return namTrongHoacLa(realpathMotPhan(abs), realpathMotPhan(kho));
  } catch {
    return true;
  }
}
