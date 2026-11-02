/**
 * SCADA R1b-2b-2a Task 9 (mục 71) — ngân sách pool DB của đường STOP HMI so với `DB_POOL_MAX` THẬT của tiến trình.
 *
 * Ba con số cùng tranh MỘT pool chính (`getDb()`, cỡ `resolvePoolMax()`) khi DB chậm: khe khảo sát của khối DỪNG khẩn cấp
 * (`DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP`), lượt ghi nền STOP đang bay (`TRAN_GHI_TREO_STOP`) và phần dự trữ cho lượt đọc trước-gửi của
 * `dungMay` (`DU_TRU_POOL_CHO_DUNG_MAY`). `nganSachPoolStop.test.ts` ghim phép cộng ở pool MẶC ĐỊNH; module này cảnh báo khi vận hành đặt
 * `DB_POOL_MAX` thấp hơn tổng. CHỈ báo: không ném, không chặn khởi động, không đổi pool.
 */
import { resolvePoolMax } from "../../db/connection";
import { logger } from "../../logger";
import { TRAN_GHI_TREO_STOP } from "../ot/ghiTreoCoTran";
import { DU_TRU_POOL_CHO_DUNG_MAY } from "./lenhHmi";
import { DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP } from "./mayDungKhanCap";

export interface NganSachPoolStop {
  poolMax: number;
  canToiThieu: number;
  du: boolean;
}

export function kiemNganSachPoolStop(poolMax: number = resolvePoolMax()): NganSachPoolStop {
  const canToiThieu = DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP + TRAN_GHI_TREO_STOP + DU_TRU_POOL_CHO_DUNG_MAY;
  return { poolMax, canToiThieu, du: poolMax >= canToiThieu };
}

let daCanhBao = false;

/** MỘT lần mỗi tiến trình; không ném. */
export function canhBaoNganSachPoolStopKhiKhoiDong(): void {
  if (daCanhBao) return;
  daCanhBao = true;
  const k = kiemNganSachPoolStop();
  if (k.du) return;
  logger.warn(
    { poolMax: k.poolMax, canToiThieu: k.canToiThieu },
    `[SCADA] DB_POOL_MAX ${k.poolMax} < ${k.canToiThieu} — ngân sách pool của STOP HMI hụt: khi DB chậm, lượt đọc trước-gửi của DỪNG MÁY có thể thiếu kết nối`,
  );
}
