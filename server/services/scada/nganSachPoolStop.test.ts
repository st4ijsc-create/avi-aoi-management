/**
 * SCADA R1b-2b-1 final fix (rà soát cuối I-1, 2026-10-27) — NGÂN SÁCH pool DB của đường STOP HMI.
 *
 * Hai trần toàn tiến trình cùng giữ kết nối của MỘT pool (pool chính `getDb()`, cỡ `resolvePoolMax()`) khi DB chậm — truy vấn đã bị bỏ rơi
 * vẫn giữ kết nối tới khi DB trả lời (≤ statement_timeout 30 s):
 *   · khe khảo sát của khối DỪNG khẩn cấp (`DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP`, T1 — `mayDungKhanCap.ts`);
 *   · lượt ghi sổ STOP HMI đã quá hạn mà còn treo (`TRAN_GHI_SO_TREO_STOP_HMI`, T9 — `lenhHmi.ts`).
 * Mỗi trần từng được định cỡ RIÊNG (16 và 8 ⇒ 24 / 25) ⇒ lượt đọc trước-gửi của `dungMay` còn 1 kết nối. Test này ghim tổng:
 *   khe khảo sát + sổ treo ≤ pool MẶC ĐỊNH (production, không đặt `DB_POOL_MAX`) − `DU_TRU_POOL_CHO_DUNG_MAY`.
 * Nâng một trần, hạ pool mặc định hoặc hạ phần dự trữ dưới 8 ⇒ ĐỎ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePoolMax } from "../../db/connection";
import { DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP } from "./mayDungKhanCap";
import { DU_TRU_POOL_CHO_DUNG_MAY, TRAN_GHI_SO_TREO_STOP_HMI } from "./lenhHmi";

describe("R1b-2b-1 final fix I-1 — ngân sách pool DB của đường STOP HMI", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("khe khảo sát + lượt sổ treo ≤ pool mặc định − dự trữ cho dungMay (dự trữ ≥ 8)", () => {
    // pool MẶC ĐỊNH của production: không đặt DB_POOL_MAX (chuỗi rỗng ⇒ resolvePoolMax lui về mặc định) — không đọc .env của máy chạy test
    vi.stubEnv("DB_POOL_MAX", "");
    const poolMacDinh = resolvePoolMax();
    // không ghim 25: NÂNG pool mặc định vẫn xanh; HẠ nó dưới tổng trần + dự trữ ⇒ bất đẳng thức dưới đỏ
    expect(DU_TRU_POOL_CHO_DUNG_MAY, "dự trữ cho lượt đọc trước-gửi của dungMay").toBeGreaterThanOrEqual(8);
    const tongTran = DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP + TRAN_GHI_SO_TREO_STOP_HMI;
    expect(
      tongTran,
      `khảo sát ${DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP} + sổ treo ${TRAN_GHI_SO_TREO_STOP_HMI} phải ≤ pool ${poolMacDinh} − dự trữ ${DU_TRU_POOL_CHO_DUNG_MAY}`,
    ).toBeLessThanOrEqual(poolMacDinh - DU_TRU_POOL_CHO_DUNG_MAY);
  });

  it("giá trị đã duyệt (điều phối 2026-10-27): khảo sát 8, sổ treo 8, dự trữ 9 ⇒ 8 + 8 = 16 = 25 − 9", () => {
    expect(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP).toBe(8);
    expect(TRAN_GHI_SO_TREO_STOP_HMI).toBe(8);
    expect(DU_TRU_POOL_CHO_DUNG_MAY).toBe(9);
  });

  it("thiết bị đo: ngân sách đỏ khi pool nhỏ hơn (DB_POOL_MAX=20 ⇒ 20 − 9 = 11 < 16)", () => {
    vi.stubEnv("DB_POOL_MAX", "20");
    expect(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP + TRAN_GHI_SO_TREO_STOP_HMI).toBeGreaterThan(resolvePoolMax() - DU_TRU_POOL_CHO_DUNG_MAY);
  });
});
