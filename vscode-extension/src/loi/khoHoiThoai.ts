/**
 * ĐỢT F / TASK 2 — LƯU HỘI THOẠI BỀN.
 *
 * THUẦN (không import `vscode`): tệp này chỉ biết LƯU/ĐỌC một danh sách `HoiThoai`, không biết gì
 * về mạng, về webview, hay về giao thức `avi-tool` — `bangChat.ts` (tầng UI, có import `vscode`)
 * là nơi DUY NHẤT gọi vào đây, bơm một giao diện lưu trữ tối giản (`KhoLuuTruTho`) bọc quanh
 * `context.workspaceState`. Nhờ interface đó mà lưới ở đây chạy được không cần `vscode`.
 *
 * ⚠⚠⚠ KHÔNG chép bản sao thứ hai của logic chat: `HoiThoai.luot` dùng LẠI đúng kiểu `LuotChat`
 * (`./yeuCau.ts`, chỉ nhập KIỂU — xoá hết lúc biên dịch, không kéo theo phần dựng request/SSE của
 * tệp đó vào đây).
 */
import type { LuotChat } from "./yeuCau";
import { cheBiMat } from "./nguCanh";

/** Một hội thoại đã lưu: mã định danh (để UPSERT đúng bản ghi khi hội thoại còn đang tiếp diễn),
 *  tiêu đề gọn (sinh từ câu hỏi đầu), thời điểm CẬP NHẬT GẦN NHẤT (để tìm "gần nhất" và để B3 biết
 *  cái nào CŨ NHẤT khi phải cắt), và toàn bộ lượt hỏi/đáp. */
export interface HoiThoai {
  ma: string;
  tieuDe: string;
  thoiDiem: number;
  luot: LuotChat[];
}

/**
 * Giao diện lưu trữ TỐI GIẢN mà `khoHoiThoai.ts` cần — CHỈ hai việc: đọc một khoá, ghi một khoá.
 * `bangChat.ts` bơm một bản bọc `context.workspaceState` vào đây (`get`/`update` của VSCode); lưới
 * ở tệp `.unit.test.ts` cạnh đây bơm một bản giả bằng `Map` — cả hai đều khớp hình dạng này.
 *
 * ⚠ `ghi` trả `void | PromiseLike<void>` (KHÔNG phải `Promise` cụ thể, và KHÔNG phải `Thenable` của
 *   riêng `vscode` — dùng `PromiseLike` là kiểu THUẦN của TypeScript/JS, có sẵn không cần import gì)
 *   vì `context.workspaceState.update()` trả về một `Thenable`, không phải `Promise` thật; hai kiểu
 *   này khớp CẤU TRÚC (cùng có `.then`), nên gán được cho nhau mà tệp này không cần biết `vscode`
 *   tồn tại.
 */
export interface KhoLuuTruTho {
  doc<T>(khoa: string): T | undefined;
  ghi(khoa: string, giaTri: unknown): void | PromiseLike<void>;
}

/**
 * Khoá cất TOÀN BỘ danh sách hội thoại trong `context.workspaceState`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ B2 — VÌ SAO `workspaceState`, KHÔNG PHẢI `globalState`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `globalState` dùng CHUNG cho MỌI cửa sổ VSCode trên máy — một lập trình viên mở nhiều dự án khác
 * nhau (nhiều cửa sổ, hoặc cùng cửa sổ ở các thời điểm khác nhau) sẽ thấy CÙNG MỘT danh sách hội
 * thoại trộn lẫn giữa các dự án không liên quan, và "Lịch sử" (Task 3) của dự án A sẽ liệt kê cả
 * câu hỏi hỏi riêng về dự án B — đúng ngược thói quen lập trình viên: mỗi dự án có ngữ cảnh RIÊNG,
 * đóng dự án A rồi mở dự án B thì mong thấy lịch sử của B, không phải một mớ trộn mọi dự án đã
 * từng mở trên máy. `workspaceState` gắn với ĐÚNG thư mục workspace đang mở nên tự nhiên tách đúng
 * ranh giới đó — không cần thêm một khoá lồng theo đường dẫn dự án nào cả.
 */
export const KHOA_HOI_THOAI = "aviAiLocal.hoiThoai";

/** Trần SỐ HỘI THOẠI lưu đồng thời. */
export const TRAN_SO_HOI_THOAI = 50;

/**
 * Trần TỔNG KÝ TỰ, cộng dồn nội dung mọi lượt của MỌI hội thoại đang lưu.
 * `workspaceState` không phải kho vô hạn — nó nằm trong CSDL trạng thái dùng CHUNG cho mọi khoá
 * của mọi extension trong workspace, nên một extension chiếm hàng MB là gánh nặng cho tất cả. Một
 * hội thoại vài chục lượt hiếm khi vượt vài nghìn ký tự, nên trần này còn đủ chỗ cho hàng chục hội
 * thoại dài trước khi phải cắt cái cũ nhất.
 */
export const TRAN_TONG_KY_TU = 500_000;

/** Trần mặc định cho độ dài tiêu đề sinh tự động, tính theo CỤM KÝ TỰ (không phải mã UTF-16). */
const DO_DAI_TIEU_DE_MAC_DINH = 60;

/**
 * ★★★ B1 — sinh tiêu đề gọn từ câu hỏi đầu tiên.
 *
 * ★ KHÔNG cắt giữa ký tự TỔ HỢP tiếng Việt: dùng `Intl.Segmenter({granularity:"grapheme"})` để cắt
 *   theo CỤM KÝ TỰ NGƯỜI ĐỌC THẤY LÀ MỘT CHỮ, không phải theo mã điểm (`Array.from`/spread) hay chỉ
 *   số UTF-16 thô (`slice`/`length`). Khác biệt này CÓ THẬT với chữ Việt: một chữ có dấu có thể là
 *   MỘT mã điểm đã ghép sẵn (dạng NFC, "ế" = U+1EBF — cắt theo mã điểm ở đây vẫn đúng), NHƯNG cũng
 *   có thể là dạng NFD "dấu rời" — chữ gốc + một/nhiều dấu kết hợp là NHIỀU mã điểm riêng biệt cho
 *   MỘT chữ duy nhất (ví dụ "ệ" = "e" + dấu mũ (U+0302) + dấu nặng (U+0323), BA mã điểm). Cắt theo
 *   mã điểm ở ranh giới rơi đúng giữa cụm đó sẽ tách dấu khỏi chữ gốc — dấu bị bỏ lại, hiển thị sai
 *   chữ. `Intl.Segmenter` gộp cả cụm "chữ gốc + mọi dấu kết hợp đi kèm" thành MỘT đơn vị cắt, nên
 *   ranh giới cắt không bao giờ rơi vào giữa một cụm như vậy — bất kể dữ liệu đến ở dạng NFC hay
 *   NFD (dán từ nguồn nào cũng có thể là NFD, không có gì đảm bảo mọi chỗ dán vào đều đã NFC-hoá).
 */
export function sinhTieuDe(cauHoiDau: string, doDaiToiDa: number = DO_DAI_TIEU_DE_MAC_DINH): string {
  const gon = cauHoiDau.trim().replace(/\s+/g, " ");
  if (gon.length === 0) return "Hội thoại mới";
  const cum = Array.from(
    new Intl.Segmenter("vi", { granularity: "grapheme" }).segment(gon),
    (s) => s.segment,
  );
  // ★ RANH GIỚI CẮT: đúng bằng trần ⇒ GIỮ nguyên (không thêm "…"); vượt một cụm ⇒ CẮT.
  if (cum.length <= doDaiToiDa) return gon;
  return cum.slice(0, doDaiToiDa).join("") + "…";
}

/** `true` nếu `x` là một `LuotChat` — vai trò hợp lệ + `content` là chuỗi. */
function laLuotChatHopLe(x: unknown): x is LuotChat {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (o.role === "user" || o.role === "assistant") && typeof o.content === "string";
}

/**
 * ★★★ B5 — vị từ THUẦN kiểm hình dạng một `HoiThoai`. Đây là hàng rào DUY NHẤT đứng giữa dữ liệu
 * thô đọc từ `workspaceState` (có thể do một PHIÊN BẢN TRƯỚC ghi, hình dạng có thể đã đổi, hoặc
 * hỏng vì bất kỳ lý do nào khác) và phần còn lại của hệ thống — mọi chỗ đọc kho ĐỀU phải đi qua nó,
 * không ai được tự tiện `as HoiThoai` một giá trị chưa kiểm.
 */
export function laHoiThoaiHopLe(x: unknown): x is HoiThoai {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.ma === "string" &&
    typeof o.tieuDe === "string" &&
    typeof o.thoiDiem === "number" &&
    Number.isFinite(o.thoiDiem) &&
    Array.isArray(o.luot) &&
    o.luot.every(laLuotChatHopLe)
  );
}

/** Tổng ký tự của một hội thoại (cộng dồn `content` mọi lượt) — thước đo DUNG LƯỢNG cho B3, không
 *  phải thước đo HIỂN THỊ nên dùng `.length` (UTF-16) thô là đủ, không cần cụm ký tự. */
function demKyTu(h: HoiThoai): number {
  return h.luot.reduce((tong, l) => tong + l.content.length, 0);
}

/**
 * ★★★ B3 — GIỚI HẠN DUNG LƯỢNG: chặn trên CẢ số hội thoại LẪN tổng ký tự, cắt CŨ NHẤT trước.
 *
 * Sắp theo `thoiDiem` MỚI → CŨ, rồi nhận dần từ đầu (mới nhất) cho tới khi chạm MỘT trong hai trần
 * — phần còn lại (luôn là phần CŨ HƠN, vì đã sắp) bị cắt. Vượt trần vì SỐ và vượt trần vì KÝ TỰ là
 * hai NGUYÊN NHÂN khác nhau nhưng cùng một hậu quả (cắt cũ nhất), nên gộp một vòng lặp thay vì hai
 * lượt lọc riêng — hai lượt riêng có thể cắt SAI thứ tự nếu áp dụng không cẩn thận (trần SỐ giữ lại
 * N hội thoại mới nhất rồi trần KÝ TỰ lọc tiếp trên N đó vẫn đúng, nhưng viết chung một vòng rõ ràng
 * hơn và tránh việc phải chứng minh hai lượt lọc kế tiếp nhau không đổi thứ tự tương đối).
 *
 * ★ RANH GIỚI CẮT (cho cả hai trần): tổng NGAY DƯỚI hoặc ĐÚNG BẰNG trần ⇒ GIỮ; thêm một hội thoại
 *   nữa mà làm tổng VƯỢT trần ⇒ hội thoại đó (và mọi hội thoại cũ hơn nó) bị CẮT.
 *
 * ⚠ Hội thoại MỚI NHẤT (phần tử đầu sau khi sắp) LUÔN được giữ dù một mình nó đã vượt trần ký tự —
 *   nếu không, một hội thoại dài hơn cả trần sẽ tự xoá SẠCH kho (kể cả chính nó, thứ mới ghi), tệ
 *   hơn hẳn việc để dung lượng vượt trần một chút. Trần ký tự chỉ ngăn hội thoại CŨ HƠN chen thêm
 *   vào SAU khi đã có ít nhất một hội thoại trong kho.
 */
export function apDungTranDungLuong(
  ds: HoiThoai[],
  tranSo: number = TRAN_SO_HOI_THOAI,
  tranKyTu: number = TRAN_TONG_KY_TU,
): HoiThoai[] {
  const sapXep = [...ds].sort((a, b) => b.thoiDiem - a.thoiDiem);
  const giu: HoiThoai[] = [];
  let tongKyTu = 0;
  for (const h of sapXep) {
    if (giu.length >= tranSo) break;
    const kyTuHoiThoai = demKyTu(h);
    if (giu.length > 0 && tongKyTu + kyTuHoiThoai > tranKyTu) break;
    giu.push(h);
    tongKyTu += kyTuHoiThoai;
  }
  return giu;
}

/**
 * ★★★ ĐỢT G / TASK G2 / B4 — DỰ ĐOÁN hội thoại nào sẽ bị TRẦN B3 CẮT nếu `hoiThoaiSapLuu` được lưu
 * NGAY BÂY GIỜ, để gọi TRƯỚC lúc ghi thật. Người dùng phải BIẾT TRƯỚC khi hội thoại bị cắt, không
 * phải phát hiện SAU khi đã mất — im lặng để `luuHoiThoai` tự cắt rồi mới có ai đó tình cờ nhận ra
 * "Lịch sử" ngắn hơn hôm qua là đúng lớp lỗi "khai kết cục mà không đọc kết cục" mà dự án này đã trả
 * giá nhiều lần, áp lên chính KHO LƯU TRỮ thay vì một lượt ghi đĩa.
 *
 * THUẦN — không I/O, chạy trên ĐÚNG dữ liệu mà `apDungTranDungLuong` (bên trên) sẽ dùng thật, nên
 * không có đường nào để hai phép tính này trôi khỏi nhau.
 *
 * ★ RANH GIỚI: trả về mảng RỖNG khi lưu ngay bây giờ KHÔNG cắt gì (dưới ngưỡng ⇒ im lặng ở nơi gọi);
 *   trả về danh sách các `HoiThoai` CŨ NHẤT sẽ bị cắt khi vượt trần (số HOẶC ký tự) — nơi gọi cảnh
 *   báo đúng SỐ LƯỢNG đó, không đoán chung chung "sắp đầy".
 * ⚠ Loại `hoiThoaiSapLuu` khỏi TẬP SO SÁNH (theo `ma`) trước khi tính: hội thoại ĐANG được lưu luôn
 *   là MỚI NHẤT (thời điểm "bây giờ") nên `apDungTranDungLuong` không bao giờ cắt chính nó (xem
 *   docblock hàm đó) — so nó với chính bản ghi CŨ cùng `ma` (nếu có, đang UPSERT) sẽ đếm nhầm một
 *   hội thoại là "bị cắt" trong khi thực ra nó chỉ vừa được CẬP NHẬT.
 */
export function hoiThoaiSapBiCat(
  dsHienCo: HoiThoai[],
  hoiThoaiSapLuu: HoiThoai,
  tranSo: number = TRAN_SO_HOI_THOAI,
  tranKyTu: number = TRAN_TONG_KY_TU,
): HoiThoai[] {
  const hienCoKhacMa = dsHienCo.filter((h) => h.ma !== hoiThoaiSapLuu.ma);
  const sauKhiLuu = apDungTranDungLuong([...hienCoKhacMa, hoiThoaiSapLuu], tranSo, tranKyTu);
  const conLaiSauKhiLuu = new Set(sauKhiLuu.map((h) => h.ma));
  return hienCoKhacMa.filter((h) => !conLaiSauKhiLuu.has(h.ma));
}

/** Che bí mật trong TOÀN BỘ `content` của mỗi lượt — trả về mảng LƯỢT MỚI, không đổi mảng gốc. */
function cheBiMatLuot(luot: LuotChat[]): LuotChat[] {
  /**
   * ★★★ B4 — GỌI `cheBiMat` TRÊN NGUYÊN VĂN `content` CỦA TỪNG LƯỢT, KHÔNG TÁCH DÒNG TRƯỚC.
   *
   * ⚠⚠⚠ BÀI HỌC ĐÃ TRẢ GIÁ: luật che khối PEM (`nguCanh.ts`, luật 1) khớp bằng
   * `(-----BEGIN...)([\s\S]*?)(-----END...)` — một biểu thức ĐA DÒNG, cần thấy CẢ dòng BEGIN LẪN
   * dòng END trong CÙNG một lần gọi mới khớp được. Nếu tách `content` theo `\n` rồi gọi `cheBiMat`
   * trên TỪNG DÒNG riêng (kiểu `content.split("\n").map(cheBiMat).join("\n")`), dòng chứa
   * `-----BEGIN...-----` không còn thấy dòng `-----END...-----` (đã bị tách ra một lần gọi khác),
   * luật 1 KHÔNG BAO GIỜ khớp, và thân base64 của khoá riêng đi thẳng vào kho — che kiểu này im
   * lặng đến mức lưới soi TỪNG DÒNG riêng vẫn xanh trong khi khoá vẫn rò nguyên vẹn. Gọi
   * `cheBiMat(l.content)` trên CẢ CHUỖI `content` (giữ nguyên `\n`) một lần duy nhất là cách DUY
   * NHẤT luật đa dòng đó khớp đúng.
   */
  return luot.map((l) => ({ ...l, content: cheBiMat(l.content) }));
}

/**
 * ★★★ B1 + B4 — dựng một `HoiThoai` từ danh sách lượt CÒN NGUYÊN (câu hỏi/trả lời thô, CHƯA che bí
 * mật) — hàm THUẦN, không I/O.
 *
 * ⚠ CHE BÍ MẬT TRƯỚC, SINH TIÊU ĐỀ SAU — thứ tự này có ý nghĩa. Nếu tính `tieuDe` từ `content` GỐC
 *   rồi mới che `luot`, một câu hỏi ĐẦU TIÊN chính là đoạn PEM vừa dán vào sẽ làm TIÊU ĐỀ (một
 *   trường RIÊNG, không nằm trong `luot`) mang theo mẩu bí mật đó — trong khi `luot` đã được che
 *   đúng, kho vẫn rò bí mật qua đúng trường mà B3/Task 3 dùng để hiển thị trong danh sách "Lịch
 *   sử". Sinh tiêu đề từ `luot` ĐÃ CHE loại bỏ đường rò này bằng cấu trúc, không phải bằng lời hứa
 *   "nhớ che trước khi tính tiêu đề" ở một chỗ gọi khác.
 */
export function dungHoiThoai(ma: string, luotTho: LuotChat[], thoiDiem: number = Date.now()): HoiThoai {
  const luotSach = cheBiMatLuot(luotTho);
  const cauHoiDau = luotSach.find((l) => l.role === "user")?.content ?? "";
  return { ma, tieuDe: sinhTieuDe(cauHoiDau), thoiDiem, luot: luotSach };
}

/**
 * ★★★ B5 — đọc TOÀN BỘ danh sách hội thoại, ĐÃ LỌC SẠCH mọi phần tử sai hình dạng.
 *
 * ★ NHÁNH KIA (kho rỗng / hỏng / sai kiểu): `kho.doc` trả `undefined` (chưa từng ghi), hoặc một
 *   giá trị KHÔNG PHẢI mảng (dữ liệu cũ dạng khác, hoặc bị ai đó ghi đè), hoặc một mảng có phần tử
 *   thiếu trường/lệch kiểu (một phiên bản trước ghi hình dạng khác) — CẢ BA đều rơi về mảng RỖNG
 *   hoặc mảng đã LỌC BỎ phần tử hỏng, KHÔNG BAO GIỜ ném lỗi. `kho.doc` ném lỗi (một triển khai lưu
 *   trữ hỏng) cũng được bọc `try/catch` — đọc hỏng không được làm rớt cả khung chat.
 */
export function docDanhSachHoiThoai(kho: KhoLuuTruTho): HoiThoai[] {
  let tho: unknown;
  try {
    tho = kho.doc<unknown>(KHOA_HOI_THOAI);
  } catch {
    return [];
  }
  if (!Array.isArray(tho)) return [];
  return tho.filter(laHoiThoaiHopLe);
}

/** Hội thoại có `thoiDiem` LỚN NHẤT (gần nhất), hoặc `undefined` nếu kho rỗng — xem nhánh kia ở
 *  `docDanhSachHoiThoai`, hàm này thừa hưởng NGUYÊN hàng rào đó. */
export function docHoiThoaiGanNhat(kho: KhoLuuTruTho): HoiThoai | undefined {
  const ds = docDanhSachHoiThoai(kho);
  if (ds.length === 0) return undefined;
  return ds.reduce((moi, h) => (h.thoiDiem > moi.thoiDiem ? h : moi));
}

/**
 * ★★★ B1-B5 GỘP LẠI — LỐI VÀO DUY NHẤT để lưu một hội thoại: UPSERT theo `ma` (hội thoại còn đang
 * tiếp diễn cập nhật ĐÚNG bản ghi cũ, không đẻ thêm bản ghi mới mỗi lần hỏi), che bí mật + tính
 * tiêu đề (`dungHoiThoai`), rồi cắt theo trần dung lượng (`apDungTranDungLuong`) trước khi ghi.
 *
 * ★ NHÁNH KIA: `luotTho` RỖNG (hội thoại chưa có lượt nào — ví dụ "Chat mới" ở Task 3 gọi lưu ngay
 *   cả khi người dùng chưa kịp hỏi câu nào) ⇒ KHÔNG GHI GÌ, giữ nguyên kho — một mục rỗng trong
 *   "Lịch sử" không giúp ích gì và chỉ chiếm một suất trong trần B3.
 */
export async function luuHoiThoai(kho: KhoLuuTruTho, ma: string, luotTho: LuotChat[]): Promise<void> {
  if (luotTho.length === 0) return;
  const hoiThoai = dungHoiThoai(ma, luotTho);
  const hienCo = docDanhSachHoiThoai(kho).filter((h) => h.ma !== ma);
  const moi = apDungTranDungLuong([...hienCo, hoiThoai]);
  await kho.ghi(KHOA_HOI_THOAI, moi);
}
