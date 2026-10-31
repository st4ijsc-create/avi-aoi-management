/**
 * SCADA R1b-2b-2a T3 fix round 1 (kiem-dinh M-4) — MỘT nơi đọc + kẹp các hạn OT (ms) lấy từ env mà đi vào `setTimeout` / `setInterval`.
 *
 * Vì sao: Node kẹp mọi độ trễ ngoài 1..2^31−1 (Infinity, 1e12, 3 000 000 000, âm, NaN) về 1 ms (TimeoutOverflowWarning). Trước đây
 * `Number(process.env.OT_CONTROL_TIMEOUT_MS ?? 5000) || 5000` ở nhiều nơi đọc độc lập (dispatcher · trần chờ nối lại EIP · bộ hẹn dự phòng S7 ·
 * otEdgeDispatch · chuyển chủ robot) ⇒ "Infinity" làm MỌI lời ghi S7 thành "không rõ" + hạ phiên và dispatcher hết hạn ngay; "-5" ⇒ hẹn âm (= ngay).
 *
 * Luật: hợp lệ khi `Number.isFinite`, > 0 và ≤ `TRAN_HEN_GIO_MS` (2^31−1 − 10 000 — lề đủ cho mọi phép cộng hạn dẫn xuất: +1500 bộ hẹn dự phòng S7,
 * +1000 ân hạn B3 …, nên mọi `setTimeout` dẫn xuất vẫn ≤ 2^31−1). Không đặt / rỗng ⇒ mặc định, im lặng. Không hợp lệ ⇒ mặc định + cảnh báo MỘT LẦN mỗi
 * (biến, giá trị) — không spam mỗi lệnh. Đọc LÚC GỌI (test / vận hành đổi env không cần khởi động lại module).
 * Module không phụ thuộc gì (driver import được mà không kéo dispatcher / DB).
 */

/** Hạn lệnh mặc định của dispatcher khi `OT_CONTROL_TIMEOUT_MS` không đặt / không hợp lệ. */
export const HAN_LENH_OT_MAC_DINH_MS = 5000;

/** Trần một hạn OT đọc từ env: 2^31−1 (trần `setTimeout`) trừ lề 10 000 ms cho các phép cộng hạn dẫn xuất. */
export const TRAN_HEN_GIO_MS = 2_147_483_647 - 10_000;

const daCanhBao = new Set<string>();

/**
 * Đọc env `ten` (ms) theo luật trên; `macDinh` khi không đặt hoặc không hợp lệ. Giá trị hợp lệ giữ nguyên (không làm tròn — như các nơi đọc cũ).
 */
export function hanMsTuEnv(ten: string, macDinh: number): number {
  const raw = process.env[ten];
  if (raw === undefined || raw.trim() === "") return macDinh;
  const n = Number(raw);
  // Dạng LOẠI (không phải dạng "chấp nhận khi trong khoảng"): `NaN <= 0` và `NaN > trần` đều false ⇒ chỉ `isFinite` chặn NaN — kiểm này mang tải.
  if (Number.isFinite(n) && !(n <= 0) && !(n > TRAN_HEN_GIO_MS)) return n;
  const khoa = `${ten}\u0000${raw}`;
  if (!daCanhBao.has(khoa)) {
    daCanhBao.add(khoa);
    console.warn(`[OT] env ${ten}=${JSON.stringify(raw)} is not a valid timeout (must be a finite number of ms in 1..${TRAN_HEN_GIO_MS}) — using the default ${macDinh} ms`);
  }
  return macDinh;
}

/** Hạn lệnh MẶC ĐỊNH (`OT_CONTROL_TIMEOUT_MS`, 5000) — nguồn DUY NHẤT cho dispatcher, otEdgeDispatch, driver S7 / EIP, chuyển chủ robot. */
export function hanLenhOtMacDinhMs(): number {
  return hanMsTuEnv("OT_CONTROL_TIMEOUT_MS", HAN_LENH_OT_MAC_DINH_MS);
}

/** Cho test: quên các cảnh báo đã in (mỗi test bắt đầu như tiến trình mới). */
export function __datLaiCanhBaoHanMsChoTest(): void {
  daCanhBao.clear();
}
