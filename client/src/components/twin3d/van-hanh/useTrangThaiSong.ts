/**
 * `useTrangThaiSong` — T-1 **TẦNG 2** của §15.5.2: bốn truy vấn TRẠNG THÁI LIVE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐÂY LÀ TẦNG MANG BẤT BIẾN AN TOÀN. ĐỌC HẾT KHỐI NÀY TRƯỚC KHI SỬA.
 * ════════════════════════════════════════════════════════════════════════════
 * Ba trong bốn truy vấn ở đây đi qua `nhipHoiToiDa(coLuongDay, TRẦN)`, và chữ
 * "trần" ấy là một **luật an toàn** ra đời ở Đợt 8 sau một sự cố thật:
 *
 *     Một bản vá "nối tính năng #51" áp thẳng `nhipHoiMs` vào `andon.active`.
 *     `nhipHoiMs(true)` = 30 s. Truy vấn cảnh báo đang chạy 20 s **CHẬM ĐI
 *     thành 30 s** mỗi khi socket khoẻ. `check` xanh. Toàn bộ test xanh.
 *     Không một cổng nào đỏ. Thứ đổi là: người đứng cạnh máy biết tin muộn
 *     hơn 10 giây.
 *
 * ⇒ **LUẬT**: nhịp thích nghi **CHỈ ĐƯỢC RÚT NGẮN, KHÔNG ĐƯỢC KÉO DÀI**.
 *   `nhipHoiToiDa` = `Math.min(nhipHoiMs(coLuong), tranMs)` chính là hiện thân
 *   của luật đó: socket chết ⇒ rút về 5 s; socket khoẻ ⇒ **ở lại trần**, không
 *   bao giờ trôi lên 30 s.
 *
 * ⚠ *"An toàn không được chậm đi vì một tối ưu."* Nếu một thay đổi ở tệp này
 *   làm bất kỳ số nào dưới đây LỚN HƠN, đó **không phải** refactor — đó là hồi
 *   quy an toàn, dù mọi cổng vẫn xanh.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TRẦN LÀ HẰNG CÓ TÊN, KHÔNG PHẢI SỐ RẢI RÁC Ở CHỖ GỌI
 * ════════════════════════════════════════════════════════════════════════════
 * Trước Đợt 28, `20_000` xuất hiện **hai lần** dưới dạng số trần trong một tệp
 * 3.674 dòng, và bất biến canh chúng phải **đếm chuỗi văn bản** ở trang. Phép
 * đếm ấy đã một lần suýt hỏng (ĐB-9: `toContain` vẫn xanh khi trần bị gỡ khỏi
 * MỘT trong hai chỗ, vì chuỗi còn sót ở chỗ kia đủ để thoả).
 *
 * Đặt tên cho trần đổi bản chất phép đo: thay vì canh **hai chỗ gọi giống
 * nhau**, ta canh **một định nghĩa** cộng với việc mỗi chỗ gọi dùng đúng tên
 * nào. Một đột biến đổi `20_000 → 30_000` bây giờ phải đi qua hằng này, và
 * `nhipAnToan.unit.test.ts` đọc thẳng **GIÁ TRỊ THẬT** của nó — không phải văn
 * bản của một dòng nào đó.
 *
 * ★ TRẦN KHÔNG ĐƯỢC NỚI. Nếu ai đó cần một nhịp chậm hơn cho một truy vấn MỚI,
 *   truy vấn ấy khai trần riêng của nó — KHÔNG sửa hai hằng này.
 */
import { trpc } from "@/lib/trpc";
import { nhipHoiToiDa } from "./nguonDuLieu";

/**
 * ★★★ TRẦN NHỊP HẠNG AN TOÀN — 20 giây. **KHÔNG ĐƯỢC TĂNG.**
 *
 * Áp cho `andon.active` (cảnh báo đang mở) và `twinCanh.anToanRobot` (E-STOP,
 * §11 #26). Hai truy vấn này **cùng hạng với nhau** và **không cùng hạng** với
 * số liệu tổng quan 30 s: E-STOP là trạng thái an toàn của một cỗ máy đang
 * chạy, không phải một chỉ số hiệu suất.
 */
export const TRAN_NHIP_AN_TOAN_MS = 20_000;

/**
 * ★ TRẦN NHỊP SỨC KHOẺ MÁY — 60 giây. **KHÔNG ĐƯỢC TĂNG.**
 *
 * Sức khoẻ máy đổi chậm hơn trạng thái nhiều nên 60 s là đủ, và ở nhịp đó nó
 * không đua với luồng đẩy. Nhưng nó vẫn là một trần: `nhipHoiMs` không được
 * kéo truy vấn này dài ra quá một phút.
 */
export const TRAN_NHIP_SUC_KHOE_MS = 60_000;

export interface ThamSoTrangThaiSong {
  /** Nhà máy đang xem; `null` ⇒ ba truy vấn theo nhà máy TẮT. */
  factoryId: number | null;
  /**
   * Có luồng đẩy (socket) khoẻ hay không — đầu vào của nhịp thích nghi.
   *
   * ★ Trang cha dẫn xuất bằng `coLuongTheoKetNoi(ketNoi)` rồi TRUYỀN XUỐNG
   *   (G37). Hook KHÔNG tự đọc trạng thái kết nối.
   */
  coLuongDay: boolean;
  /** Nhịp tổng quan THÍCH NGHI đầy đủ 5 s ↔ 30 s (`nhipHoiMs(coLuongDay)`). */
  nhipTongQuanMs: number;
}

export function useTrangThaiSong({ factoryId, coLuongDay, nhipTongQuanMs }: ThamSoTrangThaiSong) {
  /*
   * Trạng thái sống + OEE + andon (hợp đồng `factoryCommand.overview`).
   *
   * ★★★ #51 — nhịp ĐẦY ĐỦ 5 s ↔ 30 s. Đây là truy vấn tổng quan, cùng hạng với
   *   `machineStatus.listWithStatus` mà `FactoryLiveMap3D.tsx:68` áp luật này.
   *   KHÔNG có trần: nó được phép chạy tới 30 s vì nó là số liệu, không phải
   *   cảnh báo.
   */
  const overviewQ = trpc.factoryCommand.overview.useQuery(
    { factoryId: factoryId ?? undefined },
    { enabled: factoryId !== null, retry: false, refetchInterval: nhipTongQuanMs },
  );

  /*
   * Cảnh báo đang mở — nguồn cho badge 3D và cho `NganXuLy`.
   *
   * ★★★ #51 CÓ TRẦN 20 s — và trần này KHÔNG phải sự thận trọng thừa.
   *   `nhipHoiMs(true)` = 30 s. Áp thẳng nó vào đây sẽ làm truy vấn cảnh báo
   *   **CHẬM ĐI** (20 → 30 s) mỗi khi socket khoẻ — một hồi quy an toàn đội lốt
   *   "nối tính năng #51". Luật đúng: nhịp thích nghi chỉ được rút NGẮN.
   */
  const andonQ = trpc.andon.active.useQuery(undefined, {
    retry: false,
    refetchInterval: nhipHoiToiDa(coLuongDay, TRAN_NHIP_AN_TOAN_MS),
  });

  /*
   * ★★★ §11 #26 — NGUỒN DỮ LIỆU AN TOÀN (E-STOP). Đây là ô đã đóng nợ Đợt 6.
   *
   * ★ Nhịp làm mới 20 s, BẰNG `andonQ` chứ không bằng `overviewQ` (30 s): E-STOP
   *   cùng hạng với cảnh báo đang mở, không cùng hạng với số liệu tổng quan.
   *   ★★★ #51 giữ nguyên bất biến đó qua `nhipHoiToiDa(_, TRAN_NHIP_AN_TOAN_MS)`:
   *   socket chết thì rút về 5 s, socket khoẻ thì ở lại 20 s — KHÔNG bao giờ
   *   trôi lên 30 s.
   */
  const anToanQ = trpc.twinCanh.anToanRobot.useQuery(
    { factoryId: factoryId ?? 0 },
    {
      enabled: factoryId !== null,
      retry: false,
      refetchInterval: nhipHoiToiDa(coLuongDay, TRAN_NHIP_AN_TOAN_MS),
    },
  );

  /*
   * ★★★ ĐỢT 21 A-4 — SỨC KHOẺ MÁY LÊN CẢNH.
   *
   * ⚠ `refetchInterval` cùng khuôn `nhipHoiToiDa` với `anToanQ`: sức khoẻ đổi
   *   chậm hơn trạng thái nhiều, nên 60 s là đủ và nó không đua với luồng đẩy.
   */
  const sucKhoeQ = trpc.twinCanh.sucKhoeMay.useQuery(
    { factoryId: factoryId ?? 0 },
    {
      enabled: factoryId !== null,
      retry: false,
      refetchInterval: nhipHoiToiDa(coLuongDay, TRAN_NHIP_SUC_KHOE_MS),
    },
  );

  return { overviewQ, andonQ, anToanQ, sucKhoeQ };
}
