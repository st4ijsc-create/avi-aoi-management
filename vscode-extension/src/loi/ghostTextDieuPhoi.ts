/**
 * ★★★ ĐỢT 4C — điều phối thời gian của ghost-text: gỡ dội + huỷ lượt cũ khi gõ tiếp + nghỉ sau lỗi.
 *
 * Không `vscode` (token huỷ nhận theo HÌNH DẠNG `CancellationToken`, không nhập kiểu) — đo bằng đồng hồ giả.
 */

/** Hình dạng tối thiểu của `vscode.CancellationToken`. */
export interface TokenHuy {
  isCancellationRequested: boolean;
  onCancellationRequested(cb: () => void): { dispose(): void };
}

/**
 * Mỗi lần gọi `cho()`: HUỶ lượt trước (kể cả lượt đã qua gỡ dội và đang gọi mạng — `signal` của nó bị abort), rồi chờ
 * `doTreMs`. Trả `AbortSignal` nếu lượt này vẫn là lượt mới nhất khi hết chờ; `undefined` nếu đã bị thay/huỷ.
 * `signal` trả về sống tới khi có lượt mới (hoặc token VSCode huỷ) — đưa thẳng vào `fetch`.
 */
export class DieuPhoiGoDoi {
  private hienTai: AbortController | undefined;

  constructor(private readonly doTreMs: number) {}

  async cho(token?: TokenHuy, doTreMs: number = this.doTreMs): Promise<AbortSignal | undefined> {
    this.hienTai?.abort();
    const ac = new AbortController();
    this.hienTai = ac;
    if (token?.isCancellationRequested) {
      ac.abort();
      return undefined;
    }
    const dk = token?.onCancellationRequested(() => ac.abort());
    const conSong = await new Promise<boolean>((giai) => {
      if (ac.signal.aborted) return giai(false);
      const hen = setTimeout(() => giai(true), Math.max(0, doTreMs));
      ac.signal.addEventListener("abort", () => {
        clearTimeout(hen);
        giai(false);
      });
    });
    if (!conSong || ac.signal.aborted) {
      dk?.dispose();
      return undefined;
    }
    ac.signal.addEventListener("abort", () => dk?.dispose());
    return ac.signal;
  }

  huyTatCa(): void {
    this.hienTai?.abort();
    this.hienTai = undefined;
  }
}

/** Sau lỗi mạng/5xx/429: nghỉ quãng này rồi mới thử lại (đừng dội máy chủ đang chết mỗi lần gõ phím). */
export const NGHI_SAU_LOI_MANG_MS = 30_000;

export type LoaiLoiGhost = "mang" | "http" | "tu-choi";

/**
 * Trạng thái lỗi của ghost-text. ⚠ Ghost-text KHÔNG BAO GIỜ bật thông báo lỗi (nó chạy mỗi lần gõ phím) — lỗi chỉ đi
 * vào nhật ký + thanh trạng thái; lớp này quyết định có nên GỌI nữa không.
 *   · `mang`/`http` ⇒ nghỉ `NGHI_SAU_LOI_MANG_MS`;
 *   · `tu-choi` (401/403: token chết/thiếu phạm vi `fim`) ⇒ nghỉ tới khi `datLai()` (đăng nhập lại, đổi cấu hình).
 */
export class TrangThaiLoiGhost {
  private nghiDen = 0;
  private tuChoi = false;

  ghiLoi(loai: LoaiLoiGhost, bayGio: number): void {
    if (loai === "tu-choi") this.tuChoi = true;
    else this.nghiDen = bayGio + NGHI_SAU_LOI_MANG_MS;
  }

  ghiThanhCong(): void {
    this.nghiDen = 0;
    this.tuChoi = false;
  }

  datLai(): void {
    this.ghiThanhCong();
  }

  dangNghi(bayGio: number): boolean {
    return this.tuChoi || bayGio < this.nghiDen;
  }
}
