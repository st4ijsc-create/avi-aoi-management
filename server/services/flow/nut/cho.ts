/**
 * ★★ Lô logic-cho (2026-10-26; dieu-phoi duyệt động cơ `__hen`) — HAI NODE ĐIỀU KHIỂN NHỎ:
 *
 * `logic.cho` — hẹn giờ: item đi qua NGUYÊN VẸN nhưng node kế chỉ chạy sau `giay` giây (0 … 86400, mặc định 60). KHÔNG giữ worker: node trả `__hen`, động cơ xếp node kế vào
 *   hàng đợi với `availableAt = now() + giay`, bền qua khởi động lại. Trần TỔNG mỗi lượt: một lượt không được còn chờ quá 7 ngày kể từ lúc bắt đầu (vượt ⇒ bước lỗi QUA_TRAN_CHO).
 *   Lưu ý vận hành: lượt đang hẹn vẫn là `dang-chay` ⇒ chiếm một chỗ của `maxConcurrentRuns`.
 * `logic.dung-loi` — dừng CÓ CHỦ Ý: ném lỗi với thông điệp `thongDiep` (≤ 200 ký tự). Mặc định lượt dừng `loi`; node khai `khiLoi` khác `dung` thì lỗi KHÔNG dừng lượt (item lỗi ra cổng `loi`
 *   do động cơ dựng — hiện KHÔNG node nào khai cổng `loi` nên chưa nối được: giới hạn sẵn có của động cơ). Không có cổng ra. Không thử lại (mặc định retry 0).
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type KetQuaChay, type YeuCauHen } from "../dangKyNut";

export const CHO_TOI_DA_GIAY = 86_400;
export const CHO_MAC_DINH_GIAY = 60;
export const TRAN_THONG_DIEP_DUNG_LOI = 200;

export class LoiCho extends Error {
  readonly ma = "THAM_SO_SAI";
  constructor(message: string) {
    super(message);
  }
}

export class LoiDungLoi extends Error {
  readonly ma = "DUNG_LOI";
}

dangKyNut({
  type: "logic.cho",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay | YeuCauHen> {
    const vao = ngu.inputs.main ?? [];
    const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, vao[0] ?? { json: {} }, vao)) as Record<string, unknown>;
    const giay = t.giay === undefined ? CHO_MAC_DINH_GIAY : t.giay;
    if (typeof giay !== "number" || !Number.isFinite(giay) || giay < 0 || giay > CHO_TOI_DA_GIAY) {
      throw new LoiCho(`logic.cho: giay phải là số 0 … ${CHO_TOI_DA_GIAY} (nhận ${JSON.stringify(giay)})`);
    }
    return { __hen: { ms: Math.round(giay * 1000), ra: { main: vao } } };
  },
});

dangKyNut({
  type: "logic.dung-loi",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: [],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vao = ngu.inputs.main ?? [];
    let tin = "Luồng dừng có chủ ý";
    try {
      const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, vao[0] ?? { json: {} }, vao)) as Record<string, unknown>;
      if (typeof t.thongDiep === "string" && t.thongDiep.trim()) tin = t.thongDiep.trim();
    } catch {
      /* biểu thức lỗi ⇒ giữ thông điệp mặc định: node dừng-lỗi KHÔNG được tự lỗi theo cách khác */
    }
    throw new LoiDungLoi(tin.slice(0, TRAN_THONG_DIEP_DUNG_LOI));
  },
});
