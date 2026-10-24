/**
 * ★★★ 2026-10-24 — MARKDOWN DỰNG TĂNG DẦN KHI STREAM (thay cho "nối chữ thô rồi đổi hình ở cuối" — lỗi 1: ###, **, ```bash hiện nguyên, khối chữ đặc).
 *
 * Bộ dựng markdown an toàn (`markdownAnToan.ts`: marked.Lexer ⇒ cây danh sách trắng) nằm ở HOST — webview không có thư viện markdown (CSP, không nguồn ngoài). Vì vậy mỗi nhịp stream host phân tích
 * LẠI toàn bộ văn bản đã nhận và gửi cây mới; webview thay nội dung khối bằng cây đó. Phân tích lại cả văn bản mỗi mảnh là O(n²) nên có TIẾT LƯU: tối đa một lần mỗi `nhipMs`
 * (đầu tiên chạy NGAY — người dùng thấy chữ sớm; mảnh dồn dập ⇒ gộp, lần cuối luôn được gửi). `marked` chịu được văn bản dở dang (khối mã chưa đóng ⇒ coi như mở tới hết).
 * THUẦN (không import `vscode`); đồng hồ/hẹn giờ tiêm vào để lưới đo không phải đợi thật.
 */
import { phanTichMarkdown, type NutMd } from "./markdownAnToan";

export interface HenGio {
  now(): number;
  datHen(fn: () => void, ms: number): unknown;
  huyHen(h: unknown): void;
}

const HEN_GIO_THAT: HenGio = {
  now: () => Date.now(),
  datHen: (fn, ms) => setTimeout(fn, ms),
  huyHen: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class BoDemMdTangDan {
  private moiNhat = "";
  private daGuiLanCuoi = -Infinity;
  private hen: unknown = null;

  constructor(
    private readonly gui: (cay: NutMd[]) => void,
    private readonly nhipMs = 120,
    private readonly dh: HenGio = HEN_GIO_THAT,
    private readonly phanTich: (md: string) => NutMd[] = phanTichMarkdown,
  ) {}

  /** Văn bản ĐẦY ĐỦ tới lúc này (không phải mảnh mới). Không bao giờ ném. */
  capNhat(vanBan: string): void {
    this.moiNhat = vanBan;
    if (this.hen !== null) return; // đã hẹn: lần gửi tới sẽ lấy `moiNhat`
    const cho = this.nhipMs - (this.dh.now() - this.daGuiLanCuoi);
    if (cho <= 0) this.xaLuon();
    else this.hen = this.dh.datHen(() => this.xaLuon(), cho);
  }

  private xaLuon(): void {
    this.hen = null;
    if (this.moiNhat.trim() === "") return;
    this.daGuiLanCuoi = this.dh.now();
    try {
      this.gui(this.phanTich(this.moiNhat));
    } catch {
      /* gửi cây là phần HIỂN THỊ tăng dần — lỗi ở đây không được làm rớt lượt hỏi */
    }
  }

  /**
   * Khối/lượt kết thúc, lỗi hoặc huỷ: huỷ hẹn giờ treo, bỏ văn bản chờ và KHÔNG gửi thêm (bản cuối do nhánh `hoan_tat` / `ag_md` gửi). Dùng lại được: `capNhat` kế tiếp
   * bắt đầu một khối MỚI (agent có nhiều khối chữ xen kẽ lời gọi công cụ).
   */
  dung(): void {
    if (this.hen !== null) this.dh.huyHen(this.hen);
    this.hen = null;
    this.moiNhat = "";
    this.daGuiLanCuoi = -Infinity;
  }
}
