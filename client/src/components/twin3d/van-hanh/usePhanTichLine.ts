/**
 * `usePhanTichLine` — T-1 **TẦNG 3** của §15.5.2: hai truy vấn PHÂN TÍCH THEO LINE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO HAI TRUY VẤN NÀY ĐI CÙNG NHAU — VÀ CHỈ HAI
 * ════════════════════════════════════════════════════════════════════════════
 * Chúng chia CHUNG đúng một cửa: `enabled: lineDangXem !== null`. Và cửa ấy
 * không phải tối ưu, nó là một câu về **ngữ nghĩa của đại lượng**:
 *
 *   WIP là đại lượng CỦA MỘT CHUYỀN. Cả hai thủ tục đều nhận `lineId` bắt buộc.
 *   Gọi chúng ở cấp Tầng/Xưởng thì hoặc phải **bịa** một `lineId`, hoặc phải
 *   gộp WIP của nhiều chuyền vào một cột — và một cột "tổng WIP toàn xưởng"
 *   đứng tại tâm một trạm là câu trả lời cho câu hỏi **không ai hỏi**.
 *
 * ⇒ Tách chúng thành một hook nhận `lineDangXem` làm tham số giữ nguyên khớp
 *   nối ấy ở **một chỗ duy nhất**, thay vì hai chỗ phải nhớ trùng nhau.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI NHỊP KHÁC NHAU, VÀ SỰ KHÁC NHAU ẤY LÀ CÓ CHỦ Ý (G5/G32)
 * ════════════════════════════════════════════════════════════════════════════
 * Đây là chỗ dễ "dọn cho gọn" nhất và cũng là chỗ **không được dọn**:
 *
 *   `wipFlowState`  → `nhipTongQuanMs` (THÍCH NGHI 5 s ↔ 30 s theo socket).
 *       WIP đổi theo từng chiếc rời trạm ⇒ cùng hạng "số liệu vận hành" với
 *       `overviewQ`. Socket chết thì phải rút ngắn để bù.
 *
 *   `wip.lineBalance` → `NHIP_CO_LUONG_MS` (CỐ ĐỊNH 30 s, KHÔNG thích nghi).
 *       Cân bằng chuyền là số liệu tổng hợp **theo KỲ**, không phải trạng thái
 *       tức thời. Hỏi nó 5 giây một lần khi socket chết chỉ đọc lại **đúng một
 *       hàng** — nhịp thích nghi ở đây tốn băng thông mà không đổi được một
 *       chữ số nào.
 *
 * ⚠ Gộp hai nhịp làm một (dù theo chiều nào) là đổi hành vi, không phải
 *   refactor. Lưới `usePhanTichLine.unit.test.ts` ghim từng cái vào ĐÚNG thủ
 *   tục của nó, vì một phép đếm tổng vẫn thoả được bằng hai nhịp đặt nhầm chỗ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TẦNG 3 KHÔNG MANG BẤT BIẾN AN TOÀN — VÀ ĐÓ LÀ MỘT PHÉP ĐO, KHÔNG PHẢI
 *     MỘT GIẢ ĐỊNH
 * ════════════════════════════════════════════════════════════════════════════
 * Bất biến "nhịp chỉ được RÚT NGẮN, không được KÉO DÀI" (Đợt 8) ràng buộc ba
 * truy vấn hạng an toàn của **tầng 2**: `andon.active` và `anToanRobot` (trần
 * 20 s), `sucKhoeMay` (trần 60 s) — chúng đi qua `nhipHoiToiDa(...)`.
 * Hai truy vấn ở đây **không gọi `nhipHoiToiDa`**, nên chúng không thể vi phạm
 * trần ấy. WIP chậm đi một nhịp là một con số cũ; **cảnh báo** chậm đi một nhịp
 * là một người đứng cạnh máy chưa biết phải dừng.
 *
 * ⇒ Vì vậy tầng 3 làm TRƯỚC tầng 2. Thứ tự này là hàng rào: đến lúc chạm vào
 *   tầng 2, lưới của tầng 3 và tầng 4 đã đứng sẵn.
 *
 * ★ G37: hook KHÔNG tự đọc `useSearch()`/`useRoute()`. `lineDangXem` được dẫn
 *   xuất từ phạm vi ở trang cha rồi TRUYỀN XUỐNG — cùng luật đã áp cho
 *   `useTrangThaiTwin` (T-3) và `useMoPhongTwin` (tầng 4).
 */
import { trpc } from "@/lib/trpc";
import { NHIP_CO_LUONG_MS } from "./nguonDuLieu";

export interface ThamSoPhanTichLine {
  /**
   * Chuyền đang xem, hoặc `null` khi phạm vi KHÔNG phải cấp line.
   *
   * ★ `null` ⇒ cả hai truy vấn TẮT. Đây là cửa ngữ nghĩa (xem docblock trên),
   *   không phải cửa hiệu năng.
   */
  lineDangXem: number | null;
  /**
   * Nhịp tổng quan THÍCH NGHI (`nhipHoiMs(coLuongDay)`) — chỉ `wipFlowState`
   * dùng. `lineBalance` cố tình KHÔNG dùng (nhịp cố định theo kỳ).
   */
  nhipTongQuanMs: number;
}

export function usePhanTichLine({ lineDangXem, nhipTongQuanMs }: ThamSoPhanTichLine) {
  /*
   * #61 — số WIP theo trạm. Nhịp thích nghi (#51) áp luôn ở đây: WIP đổi theo
   * từng chiếc rời trạm, nên nó cùng hạng "số liệu vận hành" với `overviewQ`.
   */
  const wipQ = trpc.digitalTwin.wipFlowState.useQuery(
    { lineId: lineDangXem ?? 0 },
    { enabled: lineDangXem !== null, retry: false, refetchInterval: nhipTongQuanMs },
  );

  /*
   * ★★★ #32 + #36 — MỘT truy vấn cho CẢ nút thắt LẪN nhịp chuyền.
   *
   * ⚠ Bản đầu gọi THÊM `digitalTwin.stationLoadHeatmap` chỉ để lấy
   *   `bottleneckStationId`. Đã BỎ, và lý do là một luật chứ không phải tiết
   *   kiệm: thủ tục đó KHÔNG trả `periodStart`, nên lời khai của nó không tự
   *   chứng minh được mình còn hạn — mà nghiệm thu Đợt 8 đo được rằng một lời
   *   khai 16 ngày tuổi tô đỏ SAI trạm. Ghép `bottleneckStationId` của truy vấn
   *   này với `periodStart` của truy vấn kia là mời G12 vào cửa: hai con số từ
   *   hai bản ghi khác nhau, trình bày như thể thuộc về một.
   *   `wip.lineBalance` trả NGUYÊN HÀNG — `periodStart`, `avgCycleTimeMs`,
   *   `bottleneckStationId` chắc chắn cùng một bản ghi.
   *
   * ★ `limit: 1` — chỉ cần bản ghi gần nhất; thủ tục đã `orderBy periodStart desc`.
   * ★ Nhịp CỐ ĐỊNH ở `NHIP_CO_LUONG_MS` (30 s) và KHÔNG thích nghi — xem
   *   docblock đầu tệp.
   */
  const canBangQ = trpc.wip.lineBalance.useQuery(
    { lineId: lineDangXem ?? 0, limit: 1 },
    { enabled: lineDangXem !== null, retry: false, refetchInterval: NHIP_CO_LUONG_MS },
  );

  return { wipQ, canBangQ };
}
