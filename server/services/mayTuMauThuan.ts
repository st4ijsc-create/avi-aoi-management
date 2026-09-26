// server/services/mayTuMauThuan.ts
//
// ★★★ Khối C Task 13 (BG-98, spec QĐ-8) — cổng "MÁY TỰ MÂU THUẪN".
//
// HAI cổng, HAI nguồn — CẤM GỘP:
//   · Cổng bản-dạy (`specGateCayV2.ts`) chấm `value` bằng giới hạn KỸ SƯ đã dạy
//     trên hệ (`measurement_point_defs`). Đó là NGUỒN SỰ THẬT của giới hạn.
//   · Cổng NÀY chỉ so máy với CHÍNH máy: `lowerLimit`/`upperLimit` máy tự khai
//     kèm TỪNG kết quả (mẫu thật đo được: 48/48 component có cặp này, xem
//     `task-13-brief.md`) đối chiếu với `value`/`result` — cũng chính máy khai,
//     trong CÙNG một lá. `value` nằm ngoài khoảng do CHÍNH MÁY khai mà máy vẫn
//     kết `OK` ⇒ lỗi PIPELINE của máy (không phải lỗi thiếu bản dạy, không phải
//     lỗi kỹ sư soạn giới hạn sai).
// Chấm lời khai bằng chính lời khai của cổng bản-dạy sẽ là một cổng RỖNG (xem
// docblock đầu `specGateCayV2.ts`) — nhưng dùng CHÍNH cặp giới hạn đó để phát
// hiện máy tự mâu thuẫn với chính nó là một phép kiểm KHÁC LỚP, hợp lệ, và
// không cần bản dạy nào cả — chạy được ngay hôm nay dù `measurement_point_defs`
// đang 0 hàng mang giới hạn.
//
// ⚠ KHÔNG đổi verdict, KHÔNG ghi remark vào `measurement_results` — đây thuần là
// TÍN HIỆU CHẤT LƯỢNG PIPELINE MÁY, trả trong response `submitInspectionTreeV2`
// + log warn khi có mâu thuẫn. File này không chạm DB, không đồng hồ, không số
// ngẫu nhiên.
import { tachTriDo } from "../db/inspection";

/** Hình dạng TỐI THIỂU của một lá cần để so máy với chính máy. */
export interface LaTuMauThuan {
  readonly result: "OK" | "NG";
  readonly value: string | number | null;
  readonly lowerLimit: string | number | null;
  readonly upperLimit: string | number | null;
}

/**
 * Component thô có TỰ MÂU THUẪN không: `value` nằm ngoài `[lowerLimit, upperLimit]`
 * do CHÍNH MÁY khai kèm lá này, mà máy vẫn kết `result === "OK"`.
 *
 * Hàm THUẦN. `tachTriDo` (`server/db/inspection.ts`) là BẢN TÁCH trị đo DUY NHẤT —
 * cùng bản mà cổng bản-dạy (`specGateCayV2.ts`) dùng, không viết tay lần hai.
 *
 * Bốn ca (theo brief):
 *  · `value` NGOÀI `[lowerLimit, upperLimit]` VÀ `result === "OK"` ⇒ `true` (mâu thuẫn).
 *  · `value` ngoài khoảng nhưng `result === "NG"` ⇒ `false` — máy đã tự khai đúng
 *    hướng với chính giới hạn nó gửi, không có gì mâu thuẫn để báo.
 *  · thiếu MỘT trong hai limit (`null`/`undefined`) ⇒ `false` — không đủ để kết luận.
 *  · `value` không parse được thành số (`tachTriDo` đi nhánh text) ⇒ `false`.
 */
export function demTuMauThuan(la: LaTuMauThuan): boolean {
  if (la.result !== "OK") return false;
  if (la.lowerLimit === null || la.lowerLimit === undefined) return false;
  if (la.upperLimit === null || la.upperLimit === undefined) return false;

  const lower = Number(la.lowerLimit);
  const upper = Number(la.upperLimit);
  if (isNaN(lower) || isNaN(upper)) return false;

  // Cùng phép tách trị đo mà cổng bản-dạy dùng — nhánh text (`measuredValueText`)
  // nghĩa là `value` không parse được thành số ⇒ không đủ để so với limit số.
  const { measuredValue } = tachTriDo(la.value);
  if (measuredValue === undefined) return false;
  const v = Number(measuredValue);
  if (isNaN(v)) return false;

  return v < lower || v > upper;
}

/** Trần mẫu giữ lại — cùng con số `SO_MAU_TRUOT` bên cổng bản-dạy (`specGateCayV2.ts`). */
const SO_MAU_MAY_TU_MAU_THUAN = 20;

/** Bộ đếm cho MỘT lượt ingest — đếm được, không âm thầm. */
export interface ThongKeMayTuMauThuan {
  /** Tổng linh kiện đi qua bộ đếm này (mọi lá của cây, không lọc gì trước). */
  tong: number;
  /** Số linh kiện TỰ MÂU THUẪN — xem {@link demTuMauThuan}. */
  mauThuan: number;
  /** Tối đa {@link SO_MAU_MAY_TU_MAU_THUAN} mẫu `captureId/componentId: …` để chẩn đoán. */
  mau: string[];
}

/** Cổng đếm — có TRẠNG THÁI (bộ đếm) nhưng KHÔNG có I/O, giống hình dạng `CongSpecCayV2`. */
export interface DemMayTuMauThuan {
  dem(captureExtId: string, la: LaTuMauThuan & { componentId: string }): void;
  readonly thongKe: ThongKeMayTuMauThuan;
}

/**
 * Dựng bộ đếm MỚI — gọi cho MỖI lượt ingest (như `taoCongSpecCayV2`), không phải
 * một lần toàn cục, để bộ đếm không cộng dồn xuyên các bo khác nhau.
 */
export function taoDemMayTuMauThuan(): DemMayTuMauThuan {
  const thongKe: ThongKeMayTuMauThuan = { tong: 0, mauThuan: 0, mau: [] };
  return {
    thongKe,
    dem(captureExtId, la) {
      thongKe.tong += 1;
      if (!demTuMauThuan(la)) return;
      thongKe.mauThuan += 1;
      if (thongKe.mau.length < SO_MAU_MAY_TU_MAU_THUAN) {
        thongKe.mau.push(
          `${captureExtId}/${la.componentId}: value=${String(la.value)} ngoai ` +
            `[${String(la.lowerLimit)}, ${String(la.upperLimit)}] nhung result=OK`,
        );
      }
    },
  };
}
