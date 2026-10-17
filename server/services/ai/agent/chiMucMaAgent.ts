/**
 * ★★ Đợt 2 (2026-10-17) — CẦU NỐI vòng agent ↔ CHỈ MỤC MÃ theo dự án (`server/services/ai/chiMucMa/`, do một luồng việc
 * SONG SONG dựng; hợp đồng: spec `2026-10-17-ai-local-dot2-ngu-canh-tri-nho-design.md` §3).
 *
 * Vì sao một tệp cầu nối thay vì import thẳng:
 *   1. Bộ thực thi / bộ quản lý nhận chỉ mục qua GIAO DIỆN TIÊM (`CongChiMucMa`) ⇒ lưới dùng bản GIẢ, không cần
 *      embedder/pgvector; và hai luồng việc không chặn nhau.
 *   2. Mặc định = `import("../chiMucMa")` ĐỘNG có bảo vệ: module vắng / nạp hỏng ⇒ `null` (tool nói thật "chỉ mục không
 *      có, dùng grep") — không bao giờ ném lên vòng agent. Kiểu của module do PHÍA NÀY khai (`CongChiMucMa`) và được
 *      kiểm hình dạng lúc chạy (đủ 4 hàm) — lệch hợp đồng ⇒ coi như vắng, không gọi mò.
 *
 * Dựng nền: `damBaoChiMucNen` chạy khi lượt chạy BẮT ĐẦU (và khi `search_code` gặp `chua-co`) — một lượt dựng mỗi
 * (gốc × dự án) đang bay, lỗi nuốt + log. Không gắn signal của lượt chạy: chỉ mục là của DỰ ÁN, không của một lượt —
 * người dùng bấm Dừng không được bỏ dở việc dựng chung (hàm dựng của chỉ mục tự lo ưu tiên `nen`).
 */

export type TrangThaiChiMuc = "san-sang" | "dang-dung" | "chua-co";

export interface DinhNghiaKyHieu {
  duong: string;
  dong: number;
  kind: string;
  chuKy: string;
}

export interface ThamChieuKyHieu {
  duong: string;
  dong: number;
  dongMa: string;
}

export interface DoanMaTimDuoc {
  duong: string;
  dongDau: number;
  dongCuoi: number;
  doan: string;
  diem: number;
}

/** Hợp đồng §3 của chỉ mục mã (phía agent gọi). `trangThaiChiMuc` là TUỲ CHỌN (không có trong §3). */
export interface CongChiMucMa {
  timKyHieu(y: { gocDuAn: string; ten: string; kind?: string; tran?: number }): Promise<{
    dinhNghia: DinhNghiaKyHieu[];
    thamChieu: ThamChieuKyHieu[];
    catBot: boolean;
  }>;
  timMaNgu(y: { gocDuAn: string; cauHoi: string; k?: number; signal?: AbortSignal }): Promise<{
    ketQua: DoanMaTimDuoc[];
    trangThai: TrangThaiChiMuc;
  }>;
  lamTuoiTep(y: { gocDuAn: string; duongs: string[] }): Promise<void>;
  dungChiMuc(y: { gocDuAn: string; projectId: string; signal?: AbortSignal }): Promise<{ soTep: number; soDoan: number; ms: number }>;
  trangThaiChiMuc?(y: { gocDuAn: string; projectId: string }): Promise<TrangThaiChiMuc>;
}

const HAM_BAT_BUOC = ["timKyHieu", "timMaNgu", "lamTuoiTep", "dungChiMuc"] as const;

/** Module có đủ 4 hàm của hợp đồng không (kiểm lúc chạy — kiểu TS không bảo vệ được một import động). */
export function laCongChiMucMa(m: unknown): m is CongChiMucMa {
  if (!m || (typeof m !== "object" && typeof m !== "function")) return false;
  return HAM_BAT_BUOC.every((k) => typeof (m as Record<string, unknown>)[k] === "function");
}

let _daNap: Promise<CongChiMucMa | null> | null = null;

/** Nạp chỉ mục mã THẬT (một lần mỗi tiến trình). Vắng / hỏng / lệch hợp đồng ⇒ `null`. Không ném. */
export function taiChiMucMa(): Promise<CongChiMucMa | null> {
  if (!_daNap) {
    _daNap = (async () => {
      try {
        // ⚠ Đường literal (để bộ đóng gói server thấy và gói module vào). Module do luồng việc chỉ mục dựng.
        // @ts-ignore -- `chiMucMa/index.ts` có thể chưa tồn tại lúc biên dịch nhánh này (luồng việc song song); kiểm hình dạng bên dưới.
        const m: unknown = await import("../chiMucMa");
        const goc = (m as { default?: unknown }).default;
        if (laCongChiMucMa(m)) return m;
        if (laCongChiMucMa(goc)) return goc;
        console.warn("[agent/chiMucMa] module chỉ mục mã thiếu hàm của hợp đồng §3 — coi như vắng");
        return null;
      } catch (e) {
        console.warn("[agent/chiMucMa] không nạp được chỉ mục mã (coi như vắng):", e instanceof Error ? e.message : String(e));
        return null;
      }
    })();
  }
  return _daNap;
}

/** Bộ phân giải chỉ mục cho một cấu hình: tiêm (kể cả `null` = cố ý vắng) hoặc mặc định thật. */
export function phanGiaiChiMuc(tiem: CongChiMucMa | null | undefined): () => Promise<CongChiMucMa | null> {
  if (tiem !== undefined) return () => Promise.resolve(tiem);
  return taiChiMucMa;
}

const _dangDung = new Map<string, Promise<void>>();

/**
 * Kích hoạt dựng chỉ mục NỀN cho (gốc × dự án) nếu cần — không chờ, không ném. Trả hứa hẹn của lượt dựng (lưới chờ
 * được) hoặc `null` khi không dựng.
 *   • `luon` (dùng khi `search_code` vừa nhận `chua-co`) ⇒ dựng, trừ khi đang có lượt bay cùng khoá;
 *   • còn lại: chỉ mục có `trangThaiChiMuc` ⇒ dựng khi `chua-co`; không có hàm ấy ⇒ dựng MỘT lần mỗi tiến trình mỗi
 *     khoá (hàm dựng của chỉ mục làm tươi theo băm — §3 — nên lượt lặp lại chỉ đọc băm).
 */
export function damBaoChiMucNen(
  cong: CongChiMucMa,
  y: { gocDuAn: string; projectId: string; luon?: boolean },
): Promise<void> | null {
  const khoa = `${y.projectId}\u0000${y.gocDuAn}`;
  const dang = _dangDung.get(khoa);
  if (dang) return dang;
  if (!y.luon && _daDungMotLan.has(khoa) && !cong.trangThaiChiMuc) return null;
  const p = (async () => {
    try {
      if (!y.luon && cong.trangThaiChiMuc) {
        const tt = await cong.trangThaiChiMuc({ gocDuAn: y.gocDuAn, projectId: y.projectId });
        if (tt !== "chua-co") return;
      }
      _daDungMotLan.add(khoa);
      await cong.dungChiMuc({ gocDuAn: y.gocDuAn, projectId: y.projectId });
    } catch (e) {
      console.warn(`[agent/chiMucMa] dựng chỉ mục nền hỏng (${y.projectId}):`, e instanceof Error ? e.message : String(e));
    } finally {
      _dangDung.delete(khoa);
    }
  })();
  _dangDung.set(khoa, p);
  return p;
}
const _daDungMotLan = new Set<string>();

/** Chỉ cho lưới. */
export function _datLaiChiMucMa(): void {
  _daNap = null;
  _dangDung.clear();
  _daDungMotLan.clear();
}
