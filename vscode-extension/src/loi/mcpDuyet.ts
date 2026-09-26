/**
 * ★★★ ĐỢT H / TASK H2 / B3 — DUYỆT TỪNG MCP SERVER LẦN ĐẦU, NHỚ QUYẾT ĐỊNH THEO MÁY.
 *
 * Tool ngoài là TIẾN TRÌNH CỦA NGƯỜI KHÁC — người dùng phải đồng ý TRƯỚC khi ta spawn nó lần đầu
 * (nhánh kia: từ chối ⇒ KHÔNG spawn gì cả, xem `mang/mcpDieuPhoi.ts#xinPhepNeuCan`, nơi DUY NHẤT
 * gọi `vscode.window.showWarningMessage` cho việc này). Quyết định "đồng ý" được LƯU và không hỏi
 * lại — nhưng chỉ khi CẤU HÌNH của server đó KHÔNG ĐỔI kể từ lúc duyệt: `vanTayCauHinh` băm
 * (command, args, cwd, và CHỈ TÊN KHOÁ của env — không phải giá trị, xem lý do ở đó) để một lượt
 * đổi `command`/`args`/`cwd` (ai đó sửa cấu hình MÁY, hoặc — dù `scope:"machine"` đã chặn workspace
 * ghi đè — một cách sửa cấu hình nào khác trong tương lai) buộc phải hỏi lại, trong khi việc XOAY
 * VÒNG giá trị một biến môi trường (token hết hạn, đổi key) không làm phiền người dùng bằng một
 * hộp thoại mỗi lần.
 *
 * "Nhớ theo MÁY": nơi gọi (`mang/mcpDieuPhoi.ts`) lưu trạng thái này vào `context.globalState` —
 * KHÔNG `workspaceState` (mỗi workspace một trạng thái riêng sẽ hỏi lại phiền cho cùng MỘT server)
 * và KHÔNG bật `setKeysForSync` (không đồng bộ sang máy khác — một sự đồng ý trên máy NÀY không tự
 * động lan sang máy KHÁC, đúng nghĩa "theo máy").
 *
 * THUẦN — không `import "vscode"`, không `import "node:child_process"`.
 */
import { createHash } from "node:crypto";
import type { CauHinhMcpServer } from "./mcpCauHinh";

/**
 * Vân tay CẤU TRÚC của một cấu hình server — KHÔNG băm giá trị `env` (chỉ TÊN KHOÁ, đã sắp xếp):
 * xoay vòng một API key không nên buộc người dùng duyệt lại, nhưng đổi LỆNH/THAM SỐ/THƯ MỤC (tức
 * đổi MÃ SẼ CHẠY) thì phải.
 */
export function vanTayCauHinh(cfg: CauHinhMcpServer): string {
  const dinhDanh = JSON.stringify({
    lenh: cfg.lenh,
    doi: cfg.doi,
    thuMuc: cfg.thuMuc ?? null,
    khoaMoi: Object.keys(cfg.moi).sort(),
  });
  return createHash("sha256").update(dinhDanh, "utf8").digest("hex");
}

export interface TrangThaiMotServerMcp {
  /** Vân tay TẠI LÚC người dùng bấm "Cho phép" — `undefined` nghĩa là CHƯA TỪNG duyệt. */
  daDuyetVanTay?: string;
  /** Người dùng chủ động TẮT server này ở giao diện quản lý (B5) — tách khỏi việc "đã duyệt". */
  tat?: boolean;
}

export type KhoTrangThaiMcp = Record<string, TrangThaiMotServerMcp>;

/**
 * Kho RỖNG hoặc HỎNG (sai kiểu — bản trước ghi hình dạng khác, hoặc bị chỉnh tay ngoài extension)
 * ⇒ object rỗng, KHÔNG BAO GIỜ đoán một mục là "đã duyệt"/"đang bật" khi không chắc — cùng nguyên
 * tắc an toàn-là-mặc-định đã áp cho `chuanHoaMucQuyen` (`mucQuyen.ts`).
 */
export function chuanHoaKhoTrangThaiMcpNgoai(gt: unknown): KhoTrangThaiMcp {
  if (!gt || typeof gt !== "object" || Array.isArray(gt)) return {};
  const ra: KhoTrangThaiMcp = {};
  for (const [ten, v] of Object.entries(gt as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    ra[ten] = {
      daDuyetVanTay: typeof o.daDuyetVanTay === "string" ? o.daDuyetVanTay : undefined,
      tat: o.tat === true,
    };
  }
  return ra;
}

/** Đã duyệt VÀ cấu hình chưa đổi kể từ lúc duyệt (vân tay khớp). */
export function daDuocDuyet(kho: KhoTrangThaiMcp, cfg: CauHinhMcpServer): boolean {
  return kho[cfg.ten]?.daDuyetVanTay === vanTayCauHinh(cfg);
}

export function biTat(kho: KhoTrangThaiMcp, ten: string): boolean {
  return kho[ten]?.tat === true;
}

/** Ghi lại một quyết định "Cho phép" — hàm THUẦN dựng object MỚI, không đổi `kho` tại chỗ. */
export function ghiDaDuyet(kho: KhoTrangThaiMcp, cfg: CauHinhMcpServer): KhoTrangThaiMcp {
  return { ...kho, [cfg.ten]: { ...kho[cfg.ten], daDuyetVanTay: vanTayCauHinh(cfg) } };
}

/** Bật/tắt một server ở giao diện quản lý (B5) — KHÔNG đụng cờ đã-duyệt. */
export function datTat(kho: KhoTrangThaiMcp, ten: string, tat: boolean): KhoTrangThaiMcp {
  return { ...kho, [ten]: { ...kho[ten], tat } };
}
