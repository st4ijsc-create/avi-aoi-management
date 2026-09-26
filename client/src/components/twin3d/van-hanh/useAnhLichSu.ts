/**
 * `useAnhLichSu` — T-1 (Đợt 28): truy vấn **ẢNH LỊCH SỬ** + phép đổ vào kho.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TRUY VẤN NÀY TÁCH RIÊNG, KHÔNG ĐI CÙNG "TẦNG 4"
 * ════════════════════════════════════════════════════════════════════════════
 * Brief xếp `anhLichSu` chung tầng 4 với ba truy vấn mô phỏng. Đo lại thì nó
 * **khác hạng**: ba truy vấn kia chỉ *trả dữ liệu cho một ngăn UI đọc*, còn cái
 * này **GHI vào kho trạng thái dùng chung** qua `datAnhLichSu`. Nó có **tác
 * dụng phụ**, chúng thì không.
 *
 * ⇒ Gộp chung sẽ giấu sự khác biệt ấy sau một cái tên nói "mô phỏng". Tách
 *   riêng giữ đúng một việc cho một tệp, và làm `useEffect` ghi kho nằm ngay
 *   cạnh truy vấn nuôi nó — thay vì cách nhau một màn hình cuộn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ §9.8 — ẢNH LỊCH SỬ ĐỔ VÀO **CÙNG MỘT KHO** VỚI GÓI SOCKET
 * ════════════════════════════════════════════════════════════════════════════
 * Không có `khoReplay` riêng. Gói lịch sử đi qua đúng `apDung()` mà gói socket
 * đi qua, chỉ khác `nguon` và có `mocXemLai`. Nhờ vậy **mọi luật phía sau** áp
 * y hệt nhau cho hai chế độ — tuổi quá hạn → `khong_ro`, và "đếm rỗng ≠ đếm 0".
 *
 * Một kho thứ hai sẽ là bản cài đặt thứ hai của cùng luật (G12), và hai bản ấy
 * sẽ lệch nhau đúng vào lúc khó phát hiện nhất: khi người dùng tua lại để điều
 * tra một sự cố.
 *
 * ⚠ **CHƯA CÓ DỮ LIỆU ⇒ CHỈ ĐÁNH DẤU ĐANG TUA, KHÔNG THAY CẢNH.** Đây là luật,
 *   không phải tối ưu: thay cảnh bằng dữ liệu TRỰC TIẾP mà gắn nhãn LỊCH SỬ là
 *   nói dối về thế giới. Người dùng đang xem 10:15 sáng qua phải thấy đúng
 *   10:15 sáng qua, hoặc thấy "đang tải" — không bao giờ thấy hiện tại đội lốt
 *   quá khứ.
 *
 * ★ G37: hook KHÔNG tự đọc `useSearch()`. `mocTua` đến từ `urlState.tg` ở trang
 *   cha rồi TRUYỀN XUỐNG.
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import type { KetQuaKhoTrangThai } from "./useKhoTrangThai";

export interface ThamSoAnhLichSu {
  /** Nhà máy đang xem; `null` ⇒ truy vấn TẮT. */
  factoryId: number | null;
  /**
   * Mốc thời gian đang tua (ms), hoặc `null` khi đang xem TRỰC TIẾP.
   *
   * ★ `null` mang nghĩa riêng và phải giữ: nó là tín hiệu **rời chế độ tua**,
   *   và `useEffect` bên dưới dùng nó để xoá ảnh lịch sử khỏi kho.
   */
  mocTua: number | null;
  /**
   * Ghi ảnh lịch sử vào kho dùng chung (`useKhoTrangThai`).
   *
   * ★ Kiểu lấy THẲNG từ `KetQuaKhoTrangThai` chứ không viết lại: một chữ ký
   *   chép tay là bản cài đặt thứ hai của cùng hợp đồng (G12), và nó sẽ lệch
   *   im lặng vào lần kho đổi kiểu.
   */
  datAnhLichSu: KetQuaKhoTrangThai["datAnhLichSu"];
}

export function useAnhLichSu({ factoryId, mocTua, datAnhLichSu }: ThamSoAnhLichSu) {
  const lichSuQ = trpc.twinCanh.anhLichSu.useQuery(
    { factoryId: factoryId ?? 0, moc: mocTua ?? 0 },
    { enabled: factoryId !== null && mocTua !== null, retry: false },
  );

  useEffect(() => {
    if (mocTua === null) {
      datAnhLichSu(null, null);
      return;
    }
    // Chưa có dữ liệu ⇒ chỉ đánh dấu đang tua (UI hiện "Xem lại"), CHƯA thay
    // cảnh. Thay cảnh bằng dữ liệu trực tiếp mà gắn nhãn lịch sử là nói dối.
    datAnhLichSu(mocTua, lichSuQ.data?.may ?? null);
  }, [mocTua, lichSuQ.data, datAnhLichSu]);

  return { lichSuQ };
}
