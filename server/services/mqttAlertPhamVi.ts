/**
 * W17b (kiểm định phamViGhi, 2026-10-25; chủ dự án quyết luật cảnh báo MQTT THEO NHÀ MÁY) — PHẠM VI TRẠM của mỗi luật khi đánh giá.
 *
 * Số đo MQTT (độ trễ · tỉ lệ thất bại · thông lượng) đọc `mqtt_message_logs`, có cột `stationId` ⇒ nhà máy qua stations → production_lines → workshops.factoryId.
 *   • luật CỦA NHÀ MÁY F (factoryId = F) đánh giá số đo của các trạm nhà máy F;
 *   • luật MẶC ĐỊNH (factoryId NULL) đánh giá số đo của các trạm KHÔNG thuộc nhà máy nào đang có luật riêng ĐANG BẬT cùng khoá (ruleType, categoryId) + bản ghi chưa gán trạm
 *     ⇒ mỗi trạm được đánh giá bởi ĐÚNG MỘT luật cho mỗi khoá (ghi đè), không đếm hai lần;
 *   • BROKER_DISCONNECT / CLIENT_OFFLINE là trạng thái CHUNG của broker ngoài / sự hiện diện thiết bị cục bộ (bộ nhớ tiến trình, không gắn trạm) ⇒ CHỈ luật mặc định.
 * ĐƯỜNG NHANH: luật mặc định mà không nhà máy nào ghi đè khoá của nó ⇒ `undefined` ⇒ truy vấn y hệt trước đây (cùng câu SQL, cùng chi phí).
 */
import { sql, type SQL } from "drizzle-orm";

/** Loại luật có số đo theo trạm (⇒ được đặt theo nhà máy). Hai loại còn lại chỉ có luật mặc định. */
export const KIEU_LUAT_THEO_TRAM: ReadonlySet<string> = new Set(["LATENCY_THRESHOLD", "MESSAGE_FAILURE_RATE", "THROUGHPUT_LOW", "THROUGHPUT_HIGH"]);

export interface LuatChoPhamVi {
  id: number;
  ruleType: string;
  categoryId?: number | null;
  factoryId?: number | null;
}

export interface PhamViTram {
  /** Chỉ các trạm của nhà máy này (luật nhà máy). */
  gom?: number;
  /** Loại các trạm của những nhà máy này (luật mặc định có nhà máy ghi đè khoá của nó); bản ghi stationId NULL vẫn tính. */
  loaiTru?: number[];
}

export const khoaGhiDe = (r: Pick<LuatChoPhamVi, "ruleType" | "categoryId">): string => `${r.ruleType}|${r.categoryId ?? ""}`;

/**
 * Phạm vi trạm của MỌI luật đang bật (theo id). Luật không có phạm vi (đường nhanh) vắng khỏi map. `luatDangBat` = đúng tập luật `isEnabled` mà bộ đánh giá sắp chạy.
 */
export function phanPhamViTram(luatDangBat: ReadonlyArray<LuatChoPhamVi>): Map<number, PhamViTram> {
  const nhaMayGhiDe = new Map<string, Set<number>>();
  for (const r of luatDangBat) {
    if (r.factoryId == null || !KIEU_LUAT_THEO_TRAM.has(r.ruleType)) continue;
    const k = khoaGhiDe(r);
    const t = nhaMayGhiDe.get(k) ?? new Set<number>();
    t.add(r.factoryId);
    nhaMayGhiDe.set(k, t);
  }
  const ra = new Map<number, PhamViTram>();
  for (const r of luatDangBat) {
    if (!KIEU_LUAT_THEO_TRAM.has(r.ruleType)) continue;
    if (r.factoryId != null) {
      ra.set(r.id, { gom: r.factoryId });
      continue;
    }
    const loai = nhaMayGhiDe.get(khoaGhiDe(r));
    if (loai && loai.size > 0) ra.set(r.id, { loaiTru: [...loai].sort((a, b) => a - b) });
  }
  return ra;
}

/** Danh sách id trạm của các nhà máy (truy vấn con). */
function tramCuaNhaMay(nhaMay: number[]): SQL {
  return sql`SELECT s.id FROM stations s JOIN production_lines pl ON pl.id = s."lineId" JOIN workshops w ON w.id = pl."workshopId" WHERE w."factoryId" IN (${sql.join(nhaMay.map((n) => sql`${n}`), sql`, `)})`;
}

/** Điều kiện SQL trên cột `"stationId"` của `mqtt_message_logs` — `undefined` = không lọc (đường nhanh). */
export function dieuKienTram(pv: PhamViTram | undefined): SQL | undefined {
  if (!pv) return undefined;
  if (pv.gom != null) return sql`"stationId" IN (${tramCuaNhaMay([pv.gom])})`;
  if (pv.loaiTru && pv.loaiTru.length > 0) return sql`("stationId" IS NULL OR "stationId" NOT IN (${tramCuaNhaMay(pv.loaiTru)}))`;
  return undefined;
}

export { hangKetQua } from "../db/hangKetQua";
