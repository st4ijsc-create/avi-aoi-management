/**
 * cayVanHanh.ts — Đợt 22 mục **Z4 / G-7**: cây phân cấp ĐA SITE có ROLL-UP cho
 * màn **Vận hành** (`/twin`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TÁI DÙNG `CayPhanCap` CHỨ KHÔNG VIẾT CÂY THỨ HAI (G12)
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được 2026-09-08 (G70 — đếm bằng `<CayPhanCap`, không bằng tên chuỗi):
 *   · `<CayPhanCap`  : **1** chỗ render — `XuongThietKe.tsx:946`
 *   · `import { CayPhanCap }` : **1** — `XuongThietKe.tsx:102`
 *   · `TwinVanHanh.tsx:915` khớp chuỗi "CayPhanCap" nhưng là **CHÚ THÍCH**
 *     (nhắc `traCayPhanCapNhaMay`), KHÔNG phải mã chạy. G44 — đếm riêng ba
 *     dạng, đừng cộng chúng lại.
 *
 * Ba điều làm việc tái dùng ĐO ĐƯỢC là hợp lệ, không phải "tiện tay":
 *
 *   1. **`CayPhanCap` là component ĐIỀU KHIỂN THUẦN.** Nó không giữ state chọn
 *      (docblock §7.3 của chính nó nói thế), không import gì của trạng thái sửa
 *      (`trangThaiThietKe` chỉ cấp KIỂU cây + `locCay`/`duongToiNode`, đều là
 *      hàm thuần), và không có prop nào mang nghĩa "ghi".
 *
 *   2. **`CayThietKe` là CẤU TRÚC DỮ LIỆU, không phải trạng thái trình sửa.**
 *      Nó là `{goc, khuCho, theoKhoa}` — ba thứ dựng được từ `{xuong, chuyen,
 *      tram, may, datCho}`, đúng NĂM mảng mà `twinCanh.canhThietKe` ĐÃ trả về
 *      cho `/twin` từ trước đợt này (`TwinVanHanh.tsx` `canhQ`). Tức là màn Vận
 *      hành **đã có sẵn toàn bộ nguyên liệu**; không thêm một truy vấn nào.
 *
 *   3. **Bàn phím WAI-ARIA đầy đủ đã trả tiền rồi.** `role="tree"` + roving
 *      tabindex + Enter/Space/←/→/↑/↓/Home/End, có test thuần + `CayPhanCap.
 *      dom.test.tsx` render component THẬT. Viết bản thứ hai nghĩa là hoặc chép
 *      ngần ấy (G12 — "hai bản cài đặt hiếm khi chỉ lệch MỘT chỗ"), hoặc giao
 *      cho người dùng bàn phím một cây khai `role="tree"` mà không đi được —
 *      đúng lỗi mà docblock `CayPhanCap.tsx` gọi là "TỆ HƠN không có gì".
 *
 * ★★★ VÀ ĐÂY LÀ ĐIỀU KIỆN TÁI DÙNG — **màn Vận hành CHỈ ĐỌC**:
 *   `onChon` của `/twin` KHÔNG sửa gì. Nó **điều hướng**: dịch khoá node thành
 *   một thay đổi URL (`?pv=` / `?xem=`). Đây đúng khuôn lô Z đã dùng với
 *   `LopVung` — tái dùng bề mặt, KHÔNG tái dùng ngữ nghĩa ghi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ROLL-UP — HAI ĐẠI LƯỢNG, VÀ CHÚNG **KHÔNG** CÙNG MẪU SỐ (họ G7)
 * ════════════════════════════════════════════════════════════════════════════
 * `ropCanhBao` (cayPhanCapLogic.ts) đã cộng dồn CẢNH BÁO từ lá lên gốc. Nó là
 * phép cộng THUẦN trên cây và **không biết** giá trị nó cộng là cảnh báo hay
 * cái gì khác — nên nó dùng lại được nguyên vẹn cho SỐ MÁY. Điều PHẢI giữ tách
 * là hai bản đồ đầu vào:
 *
 *   · `demMayTrucTiep` — mỗi node `machine:` đóng góp **1**, mọi node khác 0.
 *     Sau `ropCanhBao`, một `line:` mang đúng số máy trong cây con của nó.
 *   · `demCanhBaoTrucTiep` — đã có sẵn, dựng bằng `demTrucTiep`.
 *
 * ⚠ **KHÔNG gộp hai bản đồ làm một** rồi hiện một con số: đó đúng là lớp lỗi
 *   §13d Z3 vừa bắt được ("huy hiệu khai SAI ĐẠI LƯỢNG"). Một `line:` có 6 máy
 *   và 2 cảnh báo phải nói được **cả hai**, và người đọc phải phân biệt được.
 *
 * ⚠ **Máy `khuCho` KHÔNG được cộng vào tổng của nhánh chính.** `dungCayThietKe`
 *   đã tách chúng ra (máy chưa `twin_dat_cho`), và `ropCanhBao` chỉ ghi các
 *   khoá nó thật sự đi qua. Nên tổng của `workshop:` là số máy **đứng trên sàn**
 *   của xưởng ấy, không phải số máy thuộc về nó trên giấy tờ. Hai câu khác
 *   nhau; ô đếm panel trái (`dem-may`) khai câu thứ hai. G9 — cùng chữ "máy",
 *   hai mẫu số.
 *
 * ĐƠN VỊ / KIỂU: module này KHÔNG biết gì về react, three, DOM hay i18n.
 */

import {
  khoaNode,
  tachKhoaNode,
  type CayThietKe,
  type KhoaNode,
} from "../thiet-ke/trangThaiThietKe";
import type { PhamVi, VatTheChon } from "./duongDanTwin";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 1. ROLL-UP SỐ MÁY                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bản đồ "đóng góp trực tiếp" của SỐ MÁY: mỗi node `machine:` = 1, còn lại 0.
 *
 * ★ Trả về bản đồ **chỉ chứa khoá máy**. `ropCanhBao` đọc `?? 0` cho khoá vắng,
 *   nên nhét `0` cho mọi node cha là công vô ích và làm bản đồ to gấp ~1,3 lần.
 *
 * ★ G8 — hàm này KHÔNG luôn-đúng: cây không có máy nào cho bản đồ RỖNG, và test
 *   ghim ca ấy cùng ca dương. Một chỉ báo chỉ biết nói "có" thì không đo gì.
 *
 * @param cay cây đã dựng bởi `dungCayThietKe`
 */
export function demMayTrucTiep(cay: CayThietKe): Map<KhoaNode, number> {
  const ra = new Map<KhoaNode, number>();
  for (const [khoa, node] of cay.theoKhoa) {
    if (node.loai === "machine") ra.set(khoa, 1);
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. KHOÁ NODE  ⇄  ĐIỀU HƯỚNG `/twin`                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Một cú chạm vào node cây, dịch sang ngôn ngữ URL của `/twin`.
 *
 * ★★★ HAI Ô, VÀ **CẢ HAI CÓ THỂ CÙNG CÓ MẶT**. Đây là chỗ dễ viết sai nhất:
 *   chạm vào một MÁY vừa phải mở panel máy (`chon`) vừa phải đưa phạm vi về
 *   line chứa nó (`phamVi`) — nếu chỉ đặt `chon`, người dùng bấm một máy ở
 *   line khác và panel mở ra một máy **không có trên cảnh đang xem**.
 */
export interface DieuHuongCay {
  /** Đổi phạm vi cảnh (`?pv=`). `null` = giữ nguyên phạm vi hiện tại. */
  phamVi: PhamVi | null;
  /** Đổi vật thể đang chọn (`?xem=`). `null` = bỏ chọn. */
  chon: VatTheChon | null;
}

/**
 * Dịch một khoá node của cây thành thay đổi điều hướng cho `/twin`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BỐN LOẠI NODE, BA CÁCH XỬ — VÀ SỰ KHÔNG ĐỐI XỨNG LÀ CÓ THẬT
 * ════════════════════════════════════════════════════════════════════════════
 * Cây mang bốn cấp `workshop / line / station / machine` (`traCayPhanCapNhaMay`).
 * `PhamVi` của `/twin` mang năm cấp `tapDoan / nhaMay / tang / line / may`
 * (`duongDanTwin.ts:38`). **Hai thang KHÔNG trùng nhau**, và giả vờ chúng trùng
 * là chỗ sinh lỗi:
 *
 *   · `line:`    → CÓ cấp phạm vi tương ứng ⇒ đổi `?pv=line:<id>`. ★ Ca duy
 *                  nhất khớp một-một.
 *   · `machine:` → `PhamVi` có cấp `may`, NHƯNG `/twin` mở máy bằng `?xem=`
 *                  (panel tại chỗ, §11 lô G "không redirect"), không bằng `?pv`.
 *                  ⇒ đặt `chon`, và `phamVi` để `null` (người gọi biết line của
 *                  máy, module thuần này không — xem `lineCuaMay`).
 *   · `station:` → **KHÔNG có cấp phạm vi**. `?xem=station:<id>` mở ngăn trạm
 *                  (`NganNhung` đã hỗ trợ `station` từ Đợt 10). ⇒ chỉ `chon`.
 *   · `workshop:`→ **KHÔNG có cấp phạm vi VÀ không có ngăn**. Cấp trên `line`
 *                  trong thang `/twin` là `tang`, mà xưởng KHÔNG phải tầng
 *                  (`XuongThietKe.tsx:252` ghi rõ: *"xưởng chưa gắn tầng"*).
 *                  ⇒ trả `{null, null}` = **KHÔNG ĐIỀU HƯỚNG ĐI ĐÂU**.
 *
 * ★★★ VÀ ĐÂY LÀ ĐIỀU PHẢI NÓI THẲNG: một node xưởng bấm vào **không đi đâu** là
 *   một mặt điều hướng NỬA VỜI, không phải một tính năng. Nhưng nó đúng hơn ba
 *   phương án còn lại:
 *     (a) đưa về `?pv=tang:<id>` với `id` của xưởng — SAI ID, và cảnh sẽ nạp
 *         tầng của một toà nhà khác mà không lỗi nào nổ;
 *     (b) ẩn node xưởng đi — thì cây mất cấp gộp duy nhất trên `line`, và
 *         roll-up "6 máy" không còn chỗ nào để hiện;
 *     (c) đưa về `?pv=nhaMay` — mất chỗ đứng, người dùng bấm một nhánh rồi bị
 *         ném về gốc.
 *   ⇒ Giữ nó là node **gộp/mở-gập**, và không hứa gì thêm. Component vẫn cho
 *     mở/gập bằng ← → như mọi node có con.
 *
 * @returns `null` nếu khoá không đọc được (không phải dạng `loai:id`).
 */
export function dieuHuongTuKhoa(khoa: KhoaNode): DieuHuongCay | null {
  const t = tachKhoaNode(khoa);
  if (t === null) return null;
  switch (t.loai) {
    case "line":
      return { phamVi: { cap: "line", id: t.id }, chon: { loai: "line", id: t.id } };
    case "machine":
      return { phamVi: null, chon: { loai: "machine", id: t.id } };
    case "station":
      return { phamVi: null, chon: { loai: "station", id: t.id } };
    default:
      // `workshop` (và mọi loại lạ trong tương lai) — xem docblock ở trên.
      return { phamVi: null, chon: null };
  }
}

/**
 * Khoá node ĐANG ĐƯỢC CHỌN, suy từ trạng thái URL của `/twin`.
 *
 * ★★★ ĐÂY LÀ VẾ THỨ HAI CỦA ĐỒNG BỘ HAI CHIỀU, và bỏ nó là hỏng nửa tính năng:
 *   không có hàm này thì click trong 3D làm panel máy mở ra nhưng cây **không
 *   đánh dấu và không tự bung nhánh** — người dùng nhìn thấy hai bề mặt nói hai
 *   câu khác nhau về cùng một máy.
 *
 * ★ Ưu tiên `chon` hơn `phamVi`: `chon` là thứ người dùng vừa chạm gần nhất.
 *   Khi không có `chon` mà phạm vi là `line`, đánh dấu chính node line ấy —
 *   nếu không, đi tới `/twin?pv=line:1` bằng breadcrumb sẽ để cây trống trơn.
 *
 * ★ `factory` KHÔNG có node trong cây (`dungCayThietKe` bắt đầu từ `workshop`)
 *   ⇒ trả `[]`, và cây không đánh dấu gì. Đó là câu ĐÚNG: cả cây đang trong
 *   phạm vi ấy, nên đánh dấu một hàng nào đó là nói dối về độ hẹp.
 */
export function tapChonTuUrl(
  chon: VatTheChon | null,
  phamVi: PhamVi,
): readonly KhoaNode[] {
  if (chon !== null) {
    if (chon.loai === "factory") return [];
    return [khoaNode(chon.loai, chon.id)];
  }
  if (phamVi.cap === "line" && phamVi.id !== null) return [khoaNode("line", phamVi.id)];
  return [];
}

/**
 * Line chứa một máy — người gọi cấp bản đồ `stationId → lineId`.
 *
 * ★ Vì sao KHÔNG nhét vào `dieuHuongTuKhoa`: hàm ấy chỉ đọc được khoá, và khoá
 *   `machine:7` **không mang** line của nó. Bắt `dieuHuongTuKhoa` nhận thêm hai
 *   bản đồ làm nó phải biết cấu trúc dữ liệu để trả lời một câu hỏi cú pháp.
 *   Tách ra là để mỗi hàm có đúng một mẫu số.
 *
 * @returns `null` khi máy không có trạm, hoặc trạm không tra ra line — và `null`
 *   ở đây nghĩa là **giữ nguyên phạm vi**, KHÔNG phải "về gốc".
 */
export function lineCuaMay(
  machineId: number,
  stationCuaMay: ReadonlyMap<number, number | null>,
  lineCuaTram: ReadonlyMap<number, number>,
): number | null {
  const st = stationCuaMay.get(machineId);
  if (st == null) return null;
  return lineCuaTram.get(st) ?? null;
}
