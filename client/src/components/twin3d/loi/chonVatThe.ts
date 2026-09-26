/**
 * chonVatThe.ts — picking + đồng bộ HAI CHIỀU giữa cảnh 3D và DOM.
 *
 * Hai chiều nghĩa là:
 *   • 3D → DOM: click vào máy trong cảnh phải cuộn danh sách 2D tới đúng dòng.
 *   • DOM → 3D: click vào dòng trong danh sách 2D phải làm sáng đúng máy.
 *
 * Vì sao tách ra .ts thuần: phần KHÓ của picking không phải raycast (three lo),
 * mà là **bảng tra hai chiều `instanceId ↔ machineId`**. BatchedMesh trả về
 * `batchId` — chỉ số CỤC BỘ trong lô, KHÔNG phải id máy. Nhầm hai thứ này là lỗi
 * câm: click máy số 3 chọn phải máy có id 3, đúng ngẫu nhiên khi dữ liệu nhỏ và
 * sai ngay khi lọc bớt máy. Bảng tra ở đây test được mà không cần WebGL.
 */

/** Bảng tra hai chiều giữa chỉ số instance trong lô và id máy. */
export interface BangTraLo {
  /** instanceId (chỉ số trong BatchedMesh) → machineId. */
  mayTheoInstance: number[];
  /** machineId → instanceId. */
  instanceTheoMay: Map<number, number>;
}

/**
 * Dựng bảng tra từ danh sách máy đã sắp xếp ĐÚNG THỨ TỰ NẠP VÀO BatchedMesh.
 *
 * ⚠ Thứ tự mảng `machineIds` phải KHỚP TUYỆT ĐỐI thứ tự gọi `addInstance()`.
 * Người gọi phải dựng cả hai từ CÙNG một mảng, trong CÙNG một `useMemo`.
 * Id trùng lặp: lần xuất hiện ĐẦU thắng ở chiều máy→instance (đó là instance
 * được vẽ trước), nhưng cả hai chỉ số vẫn tra ngược ra đúng id máy.
 */
export function dungBangTra(machineIds: number[]): BangTraLo {
  const instanceTheoMay = new Map<number, number>();
  machineIds.forEach((id, i) => {
    if (!instanceTheoMay.has(id)) instanceTheoMay.set(id, i);
  });
  return { mayTheoInstance: [...machineIds], instanceTheoMay };
}

/**
 * instanceId (batchId của three) → machineId. Trả `null` khi ngoài phạm vi.
 *
 * Trả `null` chứ KHÔNG ném và KHÔNG trả 0: `null` buộc người gọi xử lý, còn 0 là
 * một machineId hợp lệ về kiểu và sẽ âm thầm chọn nhầm máy.
 */
export function mayTuInstance(bang: BangTraLo, instanceId: number | null | undefined): number | null {
  if (typeof instanceId !== "number" || !Number.isInteger(instanceId)) return null;
  if (instanceId < 0 || instanceId >= bang.mayTheoInstance.length) return null;
  return bang.mayTheoInstance[instanceId];
}

/** machineId → instanceId. `null` khi máy không nằm trong lô đang vẽ (đã bị lọc). */
export function instanceTuMay(bang: BangTraLo, machineId: number | null | undefined): number | null {
  if (typeof machineId !== "number") return null;
  const i = bang.instanceTheoMay.get(machineId);
  return i === undefined ? null : i;
}

/** Trạng thái chọn/hover của cảnh — một nguồn sự thật cho cả 3D lẫn DOM. */
export interface TrangThaiChon {
  dangChon: number | null;
  dangHover: number | null;
}

export const TRANG_THAI_CHON_RONG: TrangThaiChon = Object.freeze({
  dangChon: null,
  dangHover: null,
});

/**
 * Áp một cú click lên trạng thái chọn.
 *
 * Click vào chỗ trống (`machineId === null`) BỎ chọn; click lại đúng máy đang
 * chọn cũng bỏ chọn (toggle) — hành vi này khớp với cách người dùng mong đợi ở
 * mọi bảng danh sách trong repo.
 */
export function apClick(hienTai: TrangThaiChon, machineId: number | null): TrangThaiChon {
  if (machineId === null) return { ...hienTai, dangChon: null };
  if (hienTai.dangChon === machineId) return { ...hienTai, dangChon: null };
  return { ...hienTai, dangChon: machineId };
}

/** Áp một cú rê chuột. Tách khỏi click để hover không bao giờ đổi selection. */
export function apHover(hienTai: TrangThaiChon, machineId: number | null): TrangThaiChon {
  if (hienTai.dangHover === machineId) return hienTai; // giữ NGUYÊN tham chiếu
  return { ...hienTai, dangHover: machineId };
}

/**
 * Tập instance cần tô nhấn (highlight) — dùng để chỉ ghi `setColorAt` cho các
 * instance THỰC SỰ đổi, thay vì quét lại toàn lô mỗi lần rê chuột.
 *
 * Trả về tập hợp instanceId của (chọn cũ ∪ chọn mới ∪ hover cũ ∪ hover mới).
 */
export function instanceCanVeLai(
  bang: BangTraLo,
  truoc: TrangThaiChon,
  sau: TrangThaiChon,
): number[] {
  const ids = new Set<number>();
  for (const m of [truoc.dangChon, sau.dangChon, truoc.dangHover, sau.dangHover]) {
    const i = instanceTuMay(bang, m);
    if (i !== null) ids.add(i);
  }
  return [...ids].sort((a, b) => a - b);
}

/** Mức nhấn sáng của một máy: 0 = bình thường, 0.2 = hover, 0.4 = đang chọn. */
export function mucNhanSang(machineId: number, tt: TrangThaiChon): number {
  if (tt.dangChon === machineId) return 0.4;
  if (tt.dangHover === machineId) return 0.2;
  return 0;
}
