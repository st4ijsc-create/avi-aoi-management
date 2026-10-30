/**
 * ★★★ Đợt 12 / H2 — HAI MẢNH THUẦN dùng chung giữa máy chủ (`server/services/aiLocalTools/repoCommandSandbox.ts`) và extension
 * (`vscode-extension/src/mang/chayLenhCucBo.ts`, `mcpClient.ts`): bộ đệm đầu ra ĐẦU + CUỐI bộ nhớ hằng số, và quyết định "giết CẢ CÂY
 * tiến trình". THUẦN: không import gì, không `node:*`, không `vscode`, không chạm tiến trình — mọi hiệu ứng (chạy `taskkill`, gửi tín
 * hiệu) do bên gọi TIÊM vào, nên mỗi bên vẫn là chủ duy nhất của điểm sinh tiến trình của mình (census `vramAllocationSites` phía máy
 * chủ và census đường ghi phía extension không đổi con số nào).
 *
 * Nguồn gốc: chuyển nguyên văn từ `repoCommandSandbox.ts` (máy chủ), nơi chúng đã được đo; phía máy chủ nay đi qua ĐÚNG hai mảnh này
 * (một chủ, không hai bản sao trôi nhau). Ý tưởng "học từ DeepSeek Harness (MIT)": xem docs/superpowers/specs/2026-10-31-harness-tho-ca-hoc-tu-deepseek.md §H2.
 */

// ═════════════════════════════════════════════════════════════════
// BỘ ĐỆM ĐẦU RA — ĐẦU + CUỐI, BỘ NHỚ HẰNG SỐ
// ═════════════════════════════════════════════════════════════════
/**
 * ⚠ Bộ nhớ O(1) là một yêu cầu AN TOÀN, không phải tối ưu: một lệnh in ra vô hạn (một vòng lặp `console.log` trong một ca test) sẽ làm
 * tiến trình CHỦ (máy chủ / extension host) hết bộ nhớ nếu ta gom hết rồi mới cắt. Trần đầu ra phải chặn ở chỗ NHẬN, không ở chỗ TRẢ.
 * Giữ cả ĐẦU lẫn CUỐI vì lỗi build/test gần như luôn nằm ở CUỐI, còn lệnh/phiên bản nằm ở ĐẦU.
 */
export class BoDemDauRa {
  private dau = "";
  private duoi = "";
  private tong = 0;

  constructor(
    private readonly tranDau: number,
    private readonly tranCuoi: number,
  ) {}

  them(s: string): void {
    if (s === "") return;
    this.tong += s.length;
    if (this.dau.length < this.tranDau) this.dau += s.slice(0, this.tranDau - this.dau.length);
    this.duoi = (this.duoi + s).slice(-this.tranCuoi);
  }

  get byteThat(): number {
    return this.tong;
  }

  get catBot(): boolean {
    return this.tong > this.dau.length + Math.min(this.tong - this.dau.length, this.duoi.length);
  }

  /** Ghép ĐẦU + (khai số byte bỏ giữa) + CUỐI. */
  ket(): { text: string; boQua: number } {
    if (this.tong <= this.dau.length) return { text: this.dau, boQua: 0 };
    const conLai = this.tong - this.dau.length;
    const soCuoi = Math.min(conLai, this.duoi.length);
    const phanCuoi = this.duoi.slice(this.duoi.length - soCuoi);
    const boQua = conLai - soCuoi;
    if (boQua <= 0) return { text: this.dau + phanCuoi, boQua: 0 };
    return { text: `${this.dau}\n…[ĐÃ CẮT ${boQua} byte Ở GIỮA — đầu ${this.dau.length}, cuối ${soCuoi}]…\n${phanCuoi}`, boQua };
  }
}

// ═════════════════════════════════════════════════════════════════
// GIẾT **CẢ CÂY** TIẾN TRÌNH
// ═════════════════════════════════════════════════════════════════
export type KetQuaGiet = "khong-can" | "khong-co-pid" | "da-ra-lenh" | "loi";

/** Hiệu ứng do bên gọi tiêm vào (để mảnh này giữ thuần và đo được không cần sinh tiến trình thật). */
export interface MoGietCay {
  /** `process.platform === "win32"` của bên gọi. */
  windows: boolean;
  /** Windows: ra lệnh `taskkill /PID <pid> /T /F` (không đợi). Ném ⇒ "loi". */
  chayTaskkill: (pid: number) => void;
  /** POSIX: gửi tín hiệu tới `pid` (âm = cả nhóm). Ném ⇒ thử đường kế tiếp. */
  guiTinHieu: (pid: number, tinHieu: "SIGKILL") => void;
}

/**
 * Windows: `taskkill /T /F` là cách DUY NHẤT giết được cháu/chắt (`cp.kill()` chỉ giết đúng tiến trình đầu — `npm → cmd → node` còn lại
 * mồ côi). POSIX: tiến trình PHẢI sinh với `detached: true` ⇒ pid là thủ lĩnh nhóm ⇒ pid âm giết cả nhóm; không phải thủ lĩnh ⇒ rơi về
 * giết đúng pid.
 */
export function gietCayTienTrinhChung(pid: number | undefined | null, mo: MoGietCay): KetQuaGiet {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return "khong-co-pid";
  if (mo.windows) {
    try {
      mo.chayTaskkill(pid);
      return "da-ra-lenh";
    } catch {
      return "loi";
    }
  }
  try {
    mo.guiTinHieu(-pid, "SIGKILL");
    return "da-ra-lenh";
  } catch {
    try {
      mo.guiTinHieu(pid, "SIGKILL");
      return "da-ra-lenh";
    } catch {
      return "loi";
    }
  }
}
