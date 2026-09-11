/**
 * ★★★ ĐỢT 45 (mục 4) — CHÍNH SÁCH NHÃN MÁY TRÊN `/twin`: MỘT HÀM QUYẾT, BA NGUỒN THEO THỨ TỰ.
 *
 *   1. URL `?thu=` — tường minh nhất, chia sẻ được, F5/Back giữ (QĐ-23 tinh thần "URL là sự thật"):
 *        `nhanTatCa`      ⇒ hiện tên MỌI máy
 *        `nhanBatThuong`  ⇒ chỉ tên máy bất thường (+ đang chọn, + đang rê chuột)
 *      (cả hai cùng có — link tay ghép — thì `nhanTatCa` thắng: người dùng vừa đòi NHIỀU hơn.)
 *   2. Lựa chọn ĐÃ NHỚ (localStorage `twin3d.nhan.macDinh`) — nút bấm ghi vào đây cùng lúc ghi URL,
 *      để lượt mở `/twin` sau từ menu (URL trơn) vẫn theo ý người dùng.
 *   3. Mặc định: CHỈ NHÃN BẤT THƯỜNG. Đo Đợt 44: 16 nhãn "· Không rõ" chồng tâm, 41/42 máy cùng
 *      trạng thái — tên mọi máy không mang thông tin; tên máy bất thường thì có.
 *
 * Thuần .ts: KHÔNG chạm `window` — người gọi đưa `Storage` vào (test ở `environment: "node"`).
 */

export type ChinhSachNhan = "batThuong" | "tatCa";

/** Khoá localStorage nhớ lựa chọn nhãn. */
export const KHOA_UU_TIEN_NHAN = "twin3d.nhan.macDinh";

/** Mặc định của màn: chỉ nhãn bất thường. */
export const CHINH_SACH_NHAN_MAC_DINH: ChinhSachNhan = "batThuong";

const HOP_LE: readonly ChinhSachNhan[] = ["batThuong", "tatCa"];

/** Đọc lựa chọn đã nhớ. Rác/thiếu/không có storage (Safari riêng tư ném) ⇒ `null`. */
export function docUuTienNhan(storage: Pick<Storage, "getItem"> | null | undefined): ChinhSachNhan | null {
  try {
    const v = storage?.getItem(KHOA_UU_TIEN_NHAN) ?? null;
    return (HOP_LE as readonly string[]).includes(v ?? "") ? (v as ChinhSachNhan) : null;
  } catch {
    return null;
  }
}

/** Ghi lựa chọn. Không có storage / ném ⇒ bỏ qua im lặng (URL vẫn mang lựa chọn). */
export function ghiUuTienNhan(storage: Pick<Storage, "setItem"> | null | undefined, cs: ChinhSachNhan): void {
  try {
    storage?.setItem(KHOA_UU_TIEN_NHAN, cs);
  } catch {
    /* Safari riêng tư / quota — không phải lỗi của màn. */
  }
}

/** Chính sách hiệu lực từ (URL, lựa chọn đã nhớ). */
export function chinhSachNhanHieuLuc(thu: readonly string[], uuTien: ChinhSachNhan | null): ChinhSachNhan {
  if (thu.includes("nhanTatCa")) return "tatCa";
  if (thu.includes("nhanBatThuong")) return "batThuong";
  return uuTien ?? CHINH_SACH_NHAN_MAC_DINH;
}

/** `true` ⇔ chỉ vẽ nhãn máy bất thường — đúng kiểu prop `chiNhanBatThuong` của `CanhVanHanh`. */
export function chiNhanBatThuongTu(thu: readonly string[], uuTien: ChinhSachNhan | null): boolean {
  return chinhSachNhanHieuLuc(thu, uuTien) === "batThuong";
}

/**
 * Danh sách `thu` MỚI khi người dùng bật/tắt: bỏ cả hai tên cũ, ghi đúng MỘT tên tường minh.
 * Ghi tường minh cả hai chiều (không chỉ chiều "khác mặc định") để link chia sẻ nói rõ ý.
 */
export function thuSauKhiDoiChinhSach(thu: readonly string[], moi: ChinhSachNhan): string[] {
  const khac = thu.filter((t) => t !== "nhanTatCa" && t !== "nhanBatThuong");
  return [...khac, moi === "tatCa" ? "nhanTatCa" : "nhanBatThuong"];
}
