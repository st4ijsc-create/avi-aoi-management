/**
 * ĐỢT H / TASK H3 — BỘ NHỚ DÀI HẠN (thứ CHƯA TỪNG TỒN TẠI trước đợt này — grep `ai_memory` /
 * `bo_nho_ai` / `longTermMemory` trên toàn repo ra 0 trước bản vá này).
 *
 * THUẦN (không import `vscode`), CÙNG KHUÔN `loi/khoHoiThoai.ts`: tệp này chỉ biết LƯU/ĐỌC một danh
 * sách `MucBoNho`, không biết gì về webview hay giao thức `avi-tool`. ★★★ KHÔNG chép lại `khuôn kho`
 * — tái dùng NGUYÊN `KhoLuuTruTho` (`./khoHoiThoai`, `doc`/`ghi` nhận khoá làm THAM SỐ nên MỘT hình
 * dạng phục vụ mọi khoá `workspaceState`, xem docblock `KHOA_HOI_THOAI`); một interface lưu trữ THỨ
 * HAI y hệt hình dạng chỉ là bản chép tay của cái đã có.
 *
 * ★★★ PHÁN QUYẾT B1 (chủ dự án, 2026-09-04) — `context.workspaceState`, KHÔNG PHẢI tệp trong repo.
 * Kế hoạch gốc đề xuất lưu thành tệp để đọc/sửa bằng mắt; chủ dự án CHỌN KHÁC, lý do đo được: bất
 * biến chịu lực nhất của extension là census 22/22 — đúng MỘT điểm áp-chỉnh-sửa workspace, lệnh ghi
 * `fs.*` = 0 (xem `loi/census.unit.test.ts`; tên hai API đó CỐ Ý không nhắc nguyên văn Ở ĐÂY, cùng lý
 * do `ui/apBanVa.ts` cũng tự tránh — census soi VĂN BẢN nên nhắc tên là tự cộng thêm một lần đếm).
 * Ghi thêm một tệp bộ nhớ vào repo là mở đường ghi THỨ HAI, đổi một bất biến an toàn lấy sự tiện.
 * "Nhìn thấy và sửa được" (B2) đạt bằng GIAO DIỆN xem/xoá (`ui/boNhoQuanLy.ts`), không nhất thiết
 * bằng tệp.
 */
import type { KhoLuuTruTho } from "./khoHoiThoai";
import { cheBiMat } from "./nguCanh";

/** Nguồn của một mục nhớ — ĐÚNG hai cách hợp lệ theo B5: người dùng CHỦ ĐỘNG bảo nhớ, hoặc AI đề
 *  xuất và người dùng ĐÃ DUYỆT. Không có giá trị thứ ba: một mục nhớ tự động không ai kiểm là đúng
 *  thứ B5 cấm. */
export type NguonBoNho = "nguoi_dung_bao_nho" | "ai_de_xuat_duyet";

/** Một mục nhớ đã lưu: mã định danh (để xoá ĐÚNG một mục — B2), nội dung (ĐÃ che bí mật trước khi
 *  ghi — B3, xem `dungMucBoNho`), thời điểm tạo, và nguồn (để giao diện B2 nói RÕ mục này tới từ
 *  đâu, không lẫn lộn "AI tự bịa" với "người dùng tự tay gõ"). */
export interface MucBoNho {
  ma: string;
  noiDung: string;
  thoiDiem: number;
  nguon: NguonBoNho;
}

const CAC_NGUON_HOP_LE: readonly NguonBoNho[] = ["nguoi_dung_bao_nho", "ai_de_xuat_duyet"];

/** Vị từ hình dạng THUẦN — không đoán một giá trị lạ thành một trong hai nguồn hợp lệ. */
export function laNguonBoNhoHopLe(x: unknown): x is NguonBoNho {
  return typeof x === "string" && (CAC_NGUON_HOP_LE as readonly string[]).includes(x);
}

/**
 * ★★★ Hàng rào DUY NHẤT giữa dữ liệu THÔ đọc từ `workspaceState` (có thể do một PHIÊN BẢN TRƯỚC
 * ghi, hình dạng có thể đã đổi, hoặc hỏng vì bất kỳ lý do nào khác) và phần còn lại của hệ thống —
 * mọi chỗ đọc kho ĐỀU phải đi qua nó, không ai được tự tiện `as MucBoNho` một giá trị chưa kiểm.
 * Cùng khuôn `laHoiThoaiHopLe` (`./khoHoiThoai.ts`).
 */
export function laMucBoNhoHopLe(x: unknown): x is MucBoNho {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.ma === "string" &&
    typeof o.noiDung === "string" &&
    typeof o.thoiDiem === "number" &&
    Number.isFinite(o.thoiDiem) &&
    laNguonBoNhoHopLe(o.nguon)
  );
}

/**
 * Khoá cất TOÀN BỘ danh sách mục nhớ trong `context.workspaceState`.
 *
 * ★ CÙNG lý do `KHOA_HOI_THOAI`/`KHOA_MUC_QUYEN` dùng `workspaceState` chứ không `globalState`: một
 *   quyết định kiến trúc/quy ước của dự án A không nên tự động "nhớ" sang dự án B chỉ vì mở cùng một
 *   máy — mỗi workspace có bộ nhớ RIÊNG, đúng ranh giới người lập trình viên trông đợi.
 */
export const KHOA_BO_NHO = "aviAiLocal.boNho";

/** Trần SỐ MỤC NHỚ lưu đồng thời. Một mục nhớ là một sự kiện HIẾM (quyết định kiến trúc, quy ước,
 *  sở thích) chứ không phải mọi lượt hỏi — trần cao hơn hẳn `TRAN_SO_HOI_THOAI` (50) là hợp lý vì
 *  mỗi mục rất NGẮN (một câu), khác một hội thoại dài hàng chục lượt. */
export const TRAN_SO_MUC_BO_NHO = 200;

/** Trần TỔNG KÝ TỰ, cộng dồn `noiDung` của MỌI mục đang lưu — cùng lý do `TRAN_TONG_KY_TU` ở
 *  `khoHoiThoai.ts`: `workspaceState` dùng CHUNG cho mọi khoá của mọi extension trong workspace. */
export const TRAN_TONG_KY_TU_BO_NHO = 200_000;

/** Tổng ký tự `noiDung` của một mục — thước đo DUNG LƯỢNG cho phần cắt trần, `.length` (UTF-16) thô
 *  là đủ, cùng lý do `demKyTu` ở `khoHoiThoai.ts` (không phải thước đo HIỂN THỊ). */
function demKyTuBoNho(m: MucBoNho): number {
  return m.noiDung.length;
}

/**
 * ★★★ B1 — GIỚI HẠN DUNG LƯỢNG: chặn trên CẢ số mục LẪN tổng ký tự, cắt CŨ NHẤT trước. THUẬT TOÁN
 * giống hệt `apDungTranDungLuong` (`khoHoiThoai.ts`) nhưng vận hành trên `MucBoNho[]`, một hình dạng
 * dữ liệu khác hẳn `HoiThoai[]` — đây là tái dùng CÙNG Ý TƯỞNG cắt-cũ-nhất-trước, không phải chép
 * lại logic của `khoHoiThoai.ts` (hai hàm không thể dùng chung một chữ ký kiểu).
 *
 * ★ RANH GIỚI CẮT (cho cả hai trần): tổng NGAY DƯỚI hoặc ĐÚNG BẰNG trần ⇒ GIỮ; thêm một mục nữa mà
 *   làm tổng VƯỢT trần ⇒ mục đó (và mọi mục cũ hơn nó) bị CẮT.
 * ⚠ Mục MỚI NHẤT LUÔN được giữ dù một mình nó đã vượt trần ký tự — cùng lý do `apDungTranDungLuong`:
 *   không để một mục dài hơn cả trần tự xoá SẠCH kho, kể cả chính nó vừa được ghi.
 */
export function apDungTranBoNho(
  ds: MucBoNho[],
  tranSo: number = TRAN_SO_MUC_BO_NHO,
  tranKyTu: number = TRAN_TONG_KY_TU_BO_NHO,
): MucBoNho[] {
  const sapXep = [...ds].sort((a, b) => b.thoiDiem - a.thoiDiem);
  const giu: MucBoNho[] = [];
  let tongKyTu = 0;
  for (const m of sapXep) {
    if (giu.length >= tranSo) break;
    const kyTu = demKyTuBoNho(m);
    if (giu.length > 0 && tongKyTu + kyTu > tranKyTu) break;
    giu.push(m);
    tongKyTu += kyTu;
  }
  return giu;
}

/**
 * ★★★ B3 — CHE BÍ MẬT TRƯỚC KHI GHI, không phải lúc đọc ra. Gọi `cheBiMat` trên NGUYÊN VĂN
 * `noiDungTho` — MỘT lần, trên CẢ CHUỖI (giữ nguyên mọi `\n` nếu có) — KHÔNG tách dòng trước rồi che
 * từng dòng riêng.
 *
 * ⚠⚠⚠ BÀI HỌC ĐÃ TRẢ GIÁ (Đợt D/H2, nhắc lại nguyên văn ở `khoHoiThoai.ts#cheBiMatLuot`): luật che
 * khối PEM (`nguCanh.ts`, luật 1) khớp bằng `(-----BEGIN...)([\s\S]*?)(-----END...)` — một biểu thức
 * ĐA DÒNG, cần thấy CẢ dòng BEGIN LẪN dòng END trong CÙNG một lần gọi mới khớp được. `noiDungTho` của
 * một mục nhớ hoàn toàn có thể là một khoá riêng PEM dán nguyên văn (nhiều dòng) — gọi `cheBiMat`
 * đúng MỘT lần trên cả chuỗi `noiDungTho` (không `.split("\n").map(cheBiMat)`) là cách DUY NHẤT luật
 * đa dòng đó khớp đúng.
 */
export function dungMucBoNho(ma: string, noiDungTho: string, nguon: NguonBoNho, thoiDiem: number = Date.now()): MucBoNho {
  return { ma, noiDung: cheBiMat(noiDungTho), thoiDiem, nguon };
}

/**
 * ★★★ đọc TOÀN BỘ danh sách mục nhớ, ĐÃ LỌC SẠCH mọi phần tử sai hình dạng — cùng khuôn
 * `docDanhSachHoiThoai` (`khoHoiThoai.ts`): kho rỗng/hỏng/sai kiểu ⇒ mảng rỗng hoặc đã lọc, KHÔNG
 * BAO GIỜ ném lỗi (một bộ nhớ đọc hỏng không được làm rớt cả khung chat).
 */
export function docDanhSachBoNho(kho: KhoLuuTruTho): MucBoNho[] {
  let tho: unknown;
  try {
    tho = kho.doc<unknown>(KHOA_BO_NHO);
  } catch {
    return [];
  }
  if (!Array.isArray(tho)) return [];
  return tho.filter(laMucBoNhoHopLe);
}

/**
 * ★★★ B5 — LỐI VÀO DUY NHẤT để THÊM một mục nhớ: che bí mật + cắt trần TRƯỚC khi ghi. `ma` do NƠI
 * GỌI sinh (cùng khuôn `luuHoiThoai` nhận `ma` làm tham số — không tự sinh `randomUUID` ở đây vì
 * `loi/` KHÔNG import gì ngoài phạm vi THUẦN của chính module này).
 *
 * ★ NHÁNH KIA: `noiDungTho` RỖNG (sau `trim`) ⇒ KHÔNG GHI GÌ, giữ nguyên kho — cùng lý do
 *   `luuHoiThoai` bỏ qua `luotTho` rỗng: một mục nhớ rỗng không giúp ích gì và chỉ chiếm một suất
 *   trong trần B1. Đây CŨNG chính là hàng rào cho nhánh "người dùng từ chối đề xuất" của B5 — nơi
 *   GỌI (`ui/bangChat.ts`) không gọi hàm này chút nào khi bị từ chối, nên "không ghi gì cả" đã đúng
 *   TRƯỚC CẢ khi chạm hàng rào rỗng này; hàng rào ở đây là lớp phòng thủ THỨ HAI cho ca nội dung
 *   trắng/toàn khoảng trắng lọt qua được lớp kiểm ở `ui/`.
 */
export async function themMucBoNho(
  kho: KhoLuuTruTho,
  ma: string,
  noiDungTho: string,
  nguon: NguonBoNho,
  thoiDiem: number = Date.now(),
): Promise<void> {
  if (noiDungTho.trim().length === 0) return;
  const muc = dungMucBoNho(ma, noiDungTho, nguon, thoiDiem);
  const hienCo = docDanhSachBoNho(kho).filter((m) => m.ma !== ma);
  const moi = apDungTranBoNho([...hienCo, muc]);
  await kho.ghi(KHOA_BO_NHO, moi);
}

/**
 * ★★★ B2 — xoá ĐÚNG MỘT mục theo `ma`. Bỏ qua (không ghi gì) nếu `ma` không khớp mục nào — một lượt
 * xoá một mục KHÔNG CÒN TỒN TẠI (đã bị trần B1 cắt, hoặc bị bấm xoá hai lần liên tiếp trước khi
 * giao diện kịp vẽ lại) không nên đẻ ra một lượt ghi thừa hay một lỗi.
 */
export async function xoaMucBoNho(kho: KhoLuuTruTho, ma: string): Promise<void> {
  const hienCo = docDanhSachBoNho(kho);
  const con = hienCo.filter((m) => m.ma !== ma);
  if (con.length === hienCo.length) return; // không có gì để xoá — không ghi một danh sách y hệt
  await kho.ghi(KHOA_BO_NHO, con);
}

/** ★★★ B2 — xoá TẤT CẢ mục nhớ. Bỏ qua nếu kho đã rỗng sẵn — cùng lý do `xoaMucBoNho`. */
export async function xoaTatCaBoNho(kho: KhoLuuTruTho): Promise<void> {
  if (docDanhSachBoNho(kho).length === 0) return;
  await kho.ghi(KHOA_BO_NHO, []);
}
