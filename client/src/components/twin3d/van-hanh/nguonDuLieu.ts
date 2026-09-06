/**
 * nguonDuLieu.ts — §11 #51 + #52: **NHỊP HỎI THÍCH NGHI** và **XUẤT XỨ DỮ LIỆU**.
 *
 * Hai tính năng độc nhất của `FactoryLiveMap3D.tsx` mà §11 đòi mang sang Twin:
 *
 *   #51  Adaptive poll 5 s ↔ 30 s theo trạng thái WS   → `loi/`
 *   #52  Badge phân biệt SHADOW vs TWIN                → panel "Tươi dữ liệu"
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ #52 — VÌ SAO "SHADOW vs TWIN" KHÔNG PHẢI CHUYỆN CHỮ NGHĨA
 * ════════════════════════════════════════════════════════════════════════════
 * `FactoryLiveMap3D.tsx:153` nói thẳng ra sự phân biệt này:
 *   *"Đây là digital SHADOW — màu phản ánh telemetry/heartbeat THỰC của máy…
 *     Khác với digital TWIN (mô phỏng what-if)…"*
 *
 * Hai thứ trông GIỐNG HỆT nhau trên màn hình — cùng hình học, cùng bảng màu —
 * nhưng trả lời hai câu hỏi khác hẳn:
 *   `bong`    (SHADOW) — *"nhà máy ĐANG thế nào"*. Đọc từ thiết bị thật.
 *   `mo_phong`(TWIN)   — *"nhà máy SẼ thế nào nếu…"*. Sinh ra từ giả định.
 *   `so_do`   (SƠ ĐỒ)  — chỉ là bố cục, KHÔNG có số liệu vận hành nào.
 *
 * Người vận hành đọc một con số mô phỏng như thể nó là số đo thật sẽ ra quyết
 * định trên một nhà máy KHÔNG TỒN TẠI. Đây đúng tinh thần NT-4 ("số giả định
 * phải tự khai là giả định") và là lý do §11 #62 xếp badge xuất xứ vào nhóm
 * bắt buộc giữ.
 *
 * ★ Module THUẦN (RB-8.1).
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #51 — NHỊP HỎI THÍCH NGHI                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Nhịp hỏi khi KHÔNG có luồng đẩy — phải tự đi hỏi thường xuyên. */
export const NHIP_KHONG_LUONG_MS = 5_000;
/** Nhịp hỏi khi ĐÃ có luồng đẩy — chỉ còn là lưới an toàn. */
export const NHIP_CO_LUONG_MS = 30_000;

/**
 * ★★★ Nhịp hỏi theo trạng thái luồng (#51).
 *
 * Logic gốc ở `FactoryLiveMap3D.tsx:68` là `usePollingInterval(wsLive ? 30000 :
 * 5000)`. Rút ra đây vì Twin cần ĐÚNG luật đó và một bản chép tay thứ hai sẽ
 * lệch (G12).
 *
 * ⚠ Khi có luồng, poll **KHÔNG được tắt hẳn** — nó hạ xuống 30 s và ở lại đó.
 *   Tắt hẳn nghĩa là một luồng chết âm thầm sẽ đóng băng màn hình vĩnh viễn mà
 *   không có đường nào phục hồi. 30 giây là cái giá rẻ cho một lưới an toàn, và
 *   nó ăn khớp với `khoTrangThai.ketNoiTheoMoc` — cờ `im_lang` bật ở 25 s, tức
 *   là người dùng ĐÃ được báo trước khi lượt poll cứu viện chạy.
 */
export function nhipHoiMs(coLuong: boolean): number {
  return coLuong ? NHIP_CO_LUONG_MS : NHIP_KHONG_LUONG_MS;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #52 / #62 — XUẤT XỨ DỮ LIỆU                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Xuất xứ của những con số đang hiện trên cảnh.
 *
 *   `bong`     — SHADOW: đo từ thiết bị thật (telemetry/heartbeat).
 *   `mo_phong` — TWIN: sinh ra từ mô phỏng what-if. **KHÔNG phải số đo.**
 *   `so_do`    — chỉ có bố cục, không có số liệu vận hành.
 *   `khong_ro` — chưa xác định được (chưa tải xong, hoặc không nguồn nào khai).
 */
export type XuatXu = "bong" | "mo_phong" | "so_do" | "khong_ro";

export interface NguonHienTai {
  /** Có ít nhất một máy mang số liệu vận hành thật? */
  coSoLieuThat: boolean;
  /** Cảnh đang hiện kết quả mô phỏng? */
  dangMoPhong: boolean;
}

/**
 * ★★★ Quy xuất xứ. Thứ tự KHÔNG được đổi.
 *
 * 1. `dangMoPhong` THẮNG mọi thứ: khi màn hình đang vẽ kết quả what-if, việc
 *    bên dưới có số thật hay không **không đổi được** câu trả lời cho câu hỏi
 *    *"cái tôi đang nhìn có phải sự thật không"*. Xếp `bong` ở đây vì "có số
 *    thật" là cách nhanh nhất để một con số giả định được đọc như số đo.
 * 2. có số liệu thật ⇒ `bong` (SHADOW).
 * 3. không có số liệu nhưng có bố cục ⇒ `so_do`.
 * 4. còn lại ⇒ `khong_ro`.
 */
export function xuatXuHienTai(n: NguonHienTai, coBoCuc: boolean): XuatXu {
  if (n.dangMoPhong) return "mo_phong";
  if (n.coSoLieuThat) return "bong";
  if (coBoCuc) return "so_do";
  return "khong_ro";
}

/**
 * `true` khi xuất xứ này KHÔNG được đọc như số đo thật — UI phải khai rõ
 * (NT-4). Tách thành hàm để không nơi nào phải nhớ danh sách.
 */
export function laGiaDinh(xx: XuatXu): boolean {
  return xx === "mo_phong";
}
