/**
 * kiem-dinh P1-2 (2026-10-24) — TOTP TƯƠI cho mọi thay đổi CẤU HÌNH KÊNH (mức 5). Chuyển nguyên văn từ `scadaKenhRouter.ts` (R1b-1 Task 9)
 * để MỌI router đụng cấu hình kênh dùng CHUNG một bộ ánh xạ lỗi (cùng mã appError, cùng khoá i18n, cùng câu "cần mã" ở UI). Bên gọi (đo
 * 2026-10-25, rà soát cuối M-6):
 *   • `scadaKenh.capNhat` / `scadaKenh.cheDo.dat` / `scadaKenh.cheDo.go` — khai / sửa cột kênh, khai / gỡ kênh chế độ;
 *   • `deviceAdapter.tags.create` / `tags.update` / `tags.delete` — tạo lên khoá mồ côi, trỏ lại / tắt / xoá một tag ĐƯỢC BẢO VỆ (định nghĩa
 *     T9 r3 ở `troLaiKenh.ts`: đã khai, kênh chế độ, hoặc đích / nguồn của luật interlock không-alert ĐANG BẬT HOẶC ĐÃ DUYỆT);
 *   • `deviceAdapter.update` (đổi đích / tắt / đổi máy) / `deviceAdapter.delete` / `scadaDiag.tamTat` — adapter có tag được bảo vệ hoặc kênh
 *     chế độ (cổng chung `congAdapterTx`);
 *   • `mappingAsCode.applyImport` — một lô import đụng ≥ 1 tag được bảo vệ (MỘT mã cho cả lô);
 *   • `deviceAdapter.tags.setStopPin` (kiem-dinh R1b-1 H1 a, 2026-10-25) — MỌI lượt đặt / gỡ ghim DỪNG (sau sàn vai + kiểm hợp lệ);
 *   • `interlock.update` / `interlock.delete` (kiem-dinh R1b-1 I1 b, 2026-10-25) — sửa / xoá luật ghi lệnh ĐANG BẬT hoặc ĐÃ DUYỆT có đích /
 *     nguồn tag (`interlockRouter.luatCanTotpKhiSuaXoa`).
 *
 * Vì sao mức 5 trong handler, không phải middleware `requireFreshTotp`: middleware ấy là pass-through khi `ACTUATION_STEPUP_2FA` tắt
 * (dev hiện tại) và cache 10 phút theo phiên; `kiemXacThucTheoMuc` mức 5 KHÔNG đọc cờ env nào, không đọc cache, mã dùng một lần, dùng
 * chung khoá sai T16 (`TOTP_TAM_KHOA`). Bên gọi đặt lời gọi CUỐI — ngay trước lượt ghi, sau kiểm hợp lệ / nhất quán — để một lỗi kiểm
 * hợp lệ không tiêu mã (R1a final M-3).
 *
 * Census: `server/_core/trpcGioiHanThuTuc.census.test.ts` (BE_MAT_GOI_KIEM_XAC_THUC_THEO_MUC) — thủ tục gọi hàm này thuộc nhóm giới hạn "2fa",
 * TRỪ các miễn trừ có lý do bằng văn bản (phán quyết T9 a): `deviceAdapter.tags.create/update/delete`, `deviceAdapter.update/delete`,
 * `scadaDiag.tamTat` (chỉ đòi mã khi đụng tag được bảo vệ; dò mã đã bị khoá T16 theo tài khoản chặn; xếp vào nhóm "2fa" đếm theo path sẽ cho
 * mọi lượt sửa tag / adapter thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy).
 *
 * ★ R1b-2b-2a T5B (dieu-phoi 2026-11-01) — KHÔNG lấy thêm kết nối pool trong giao dịch giữ khoá hàng. Lượt kiểm (`kiemXacThucTheoMuc`) đọc 2FA
 *   (`get2FAStatus`), nạp / xoá bộ đếm sai (`totp_khoa_sai`, T16), tiêu mã ở sổ (`totp_consumed`) QUA POOL. Trước T5B mọi bên gọi chạy nó BÊN
 *   TRONG giao dịch cấu hình (đang giữ khoá adapter / luật / tag) ⇒ kết nối THỨ HAI trong khi kết nối thứ nhất giữ khoá ⇒ N giao dịch như thế cạn
 *   pool là tự khoá chết (mỗi cái chờ một kết nối mà chỉ cái khác nhả được) — đúng lớp ngân sách pool của đường STOP; hạn 3 s (R1b-2a Q5) chỉ đổi
 *   "treo" thành "CONFLICT thử lại", vẫn từ chối MỌI lượt cấu hình có mã khi pool cạn (đo: pool = 1 ⇒ 100 % CONFLICT).
 *   Nay MỌI bên gọi đi qua `chayGiaoDichTotpNgoai` (dưới): lượt 1 chạy giao dịch tới ĐÚNG chỗ kiểm cũ (CUỐI — sau mọi kiểm hợp lệ / nhất quán /
 *   phạm vi), cửa `cuaTotp()` ném một tín hiệu ⇒ giao dịch ROLLBACK, nhả khoá + kết nối; TOTP được kiểm NGOÀI mọi giao dịch (hàm dưới, nguyên văn
 *   như cũ, kể cả hạn 3 s); mã đúng ⇒ lượt 2 chạy lại giao dịch từ đầu (khoá lại, kiểm lại mọi thứ dưới khoá mới) và cửa thành no-op.
 *   Vì sao KHÔNG chuyển lượt kiểm vào `tx` (cách a): bộ đếm sai phải COMMIT kể cả khi giao dịch cấu hình rollback (lượt bị từ chối vì mã sai CHÍNH
 *   LÀ lượt rollback) — đếm trong `tx` thì dò mã không giới hạn. Vì sao KHÔNG kiểm trước giao dịch rồi mới ghi (cách b thuần): mã bị tiêu cả khi
 *   lượt ấy sau đó hỏng kiểm hợp lệ / không cần mã (R1a final M-3 ghim "lỗi kiểm hợp lệ không tiêu mã"), và cần-mã-hay-không chỉ biết DƯỚI khoá.
 *   Chống phát lại GIỮ NGUYÊN: cùng `kiemXacThucTheoMuc` (sổ `totp_consumed` ON CONFLICT một câu, khoá hàng; bộ đếm nạp TRƯỚC khi xác minh, commit
 *   độc lập), MỘT lượt xác minh cho mỗi lượt gọi. Cửa sổ duy nhất mới: giữa lượt 1 và lượt 2 trạng thái đổi ⇒ lượt 2 có thể hỏng kiểm hợp lệ SAU
 *   KHI mã đã tiêu (cùng tính chất với hôm trước khi lượt ghi hỏng sau lượt kiểm) — không bao giờ ghi mà không có mã: lượt 2 chỉ chạy khi chính
 *   lượt gọi này vừa xác minh đúng.
 *   Census: `khoaLuatVaPoolTrongTx.census.test.ts` (B) — `kiemTotpCauHinh` vẫn là hàm gọi pool; gọi nó trong callback `.transaction(` ⇒ ĐỎ.
 *   Giới hạn đã biết (preflight D10, giữ): lượt kiểm bị bỏ rơi khi quá hạn vẫn có thể chạy xong sau đó — mã có thể đã bị tiêu dù người dùng được
 *   báo "thử lại" (không có đường nào ghi cấu hình bằng lượt ấy: lượt 2 không chạy).
 */
import { z } from "zod";
import { appError } from "../../_core/appError";
import { kiemXacThucTheoMuc, type CtxXacThuc } from "../../_core/xacThucTheoMuc";
import { loiTotpKhoa } from "../../_core/totpKhoaSai";
import { withDeadline } from "../ot/drivers/boundedClose";

/** Mã TOTP 6 số của các mutation cấu hình kênh (vắng ⇒ `TOTP_CAN` ở handler, không phải lỗi zod — UI hiện đúng câu "cần mã"). */
export const totpCauHinhInput = z.string().max(16).optional();

/** R1b-2a T5 (Q5) — hạn của lượt kiểm TOTP. T5B: lượt kiểm nay chạy NGOÀI giao dịch (không giữ khoá nào) — hạn giữ để trần độ trễ + mã lỗi như cũ. */
export const HAN_TOTP_CAU_HINH_MS = 3000;

/** Quá hạn kiểm TOTP ⇒ "thử lại" (khoá i18n có sẵn `errors.reason.scadaKenhThuLai`). */
const loiQuaHanTotp = () =>
  appError(
    "CONFLICT",
    "OPERATION_FAILED",
    { operation: "scadaTotpCauHinh", reason: "scadaKenhThuLai" },
    "Không kiểm được mã xác thực kịp thời (hệ thống đang bận) — thay đổi chưa được lưu, thử lại.",
  );

/**
 * Mức 5 cố định: sàn vai ACTUATION_ROLES, phải đăng ký 2FA, mã 6 số mỗi lượt, không cache phiên, không đọc cờ env. Từ chối ⇒ NÉM appError.
 * `tuyChon.hanMs` (test): hạn của lượt kiểm, mặc định `HAN_TOTP_CAU_HINH_MS`.
 */
export async function kiemTotpCauHinh(ctx: CtxXacThuc, totpCode: string | undefined, tuyChon?: { hanMs?: number }): Promise<void> {
  const kq = await withDeadline(kiemXacThucTheoMuc(ctx, 5, totpCode), tuyChon?.hanMs ?? HAN_TOTP_CAU_HINH_MS, "scadaTotpCauHinh", {
    unref: true,
    loi: loiQuaHanTotp,
  });
  if (kq.ok) return;
  switch (kq.ma) {
    case "TOTP_CAN":
      throw appError("PRECONDITION_FAILED", "SCADA_CONFIG_TOTP_REQUIRED", { ma: kq.ma }, "Đổi cấu hình kênh cần mã xác thực 2 lớp (TOTP) — nhập mã rồi lưu lại.");
    case "TOTP_SAI":
      throw appError(
        "PRECONDITION_FAILED",
        "SCADA_CONFIG_TOTP_INVALID",
        { ma: kq.ma },
        "Mã xác thực 2 lớp không đúng hoặc đã được dùng — chờ mã mới rồi lưu lại.",
      );
    case "TOTP_CHUA_DANG_KY":
      throw appError(
        "PRECONDITION_FAILED",
        "SCADA_CONFIG_TOTP_NOT_ENROLLED",
        { ma: kq.ma },
        "Đổi cấu hình kênh cần xác thực 2 lớp, nhưng tài khoản này chưa đăng ký 2FA.",
      );
    case "ROLE_FLOOR":
      // scadaKenh (kySuProcedure: admin/engineer ∈ ACTUATION_ROLES) không bao giờ tới đây; deviceAdapter.tags.update (quyền canEdit, mọi vai)
      // thì có thể — vai dưới sàn mức 5 không được trỏ lại kênh đã khai (fail-closed).
      throw appError("FORBIDDEN", "SCADA_ROLE_FLOOR", { ma: kq.ma, level: 5 }, "Vai trò không được đổi cấu hình kênh.");
    case "TOTP_TAM_KHOA":
    case "TOTP_KHONG_KIEM_DUOC":
      throw loiTotpKhoa(kq.ma === "TOTP_TAM_KHOA" ? { ma: kq.ma, conLaiMs: kq.conLaiMs } : { ma: kq.ma }, { ma: kq.ma })!;
  }
}

/** Tín hiệu NỘI BỘ của lượt 1: giao dịch tới chỗ kiểm TOTP ⇒ rollback để kiểm NGOÀI giao dịch. Không bao giờ ra khỏi `chayGiaoDichTotpNgoai`. */
class CanKiemTotpNgoaiTx extends Error {
  constructor() {
    super("T5B: giao dịch tới chỗ kiểm TOTP — rollback, kiểm ngoài giao dịch");
    this.name = "CanKiemTotpNgoaiTx";
  }
}

/** Cửa TOTP trong giao dịch bị NUỐT (thân bắt lỗi rồi chạy tiếp) ⇒ lỗi lập trình, kêu to (không bao giờ coi là "đã qua cửa"). */
const loiCuaBiNuot = () =>
  appError(
    "INTERNAL_SERVER_ERROR",
    "OPERATION_FAILED",
    { operation: "scadaTotpCauHinh" },
    "T5B: cửa TOTP trong giao dịch cấu hình bị nuốt (thân giao dịch bắt tín hiệu rồi chạy tiếp) — lỗi lập trình.",
  );

/**
 * ★ R1b-2b-2a T5B — chạy một giao dịch cấu hình giữ khoá hàng mà kiểm TOTP mức 5 KHÔNG lấy thêm kết nối pool khi đang giữ khoá. Xem đầu tệp.
 *
 * @param chay   mở giao dịch (`db.transaction(async (tx) => …)`, hoặc gọi dịch vụ tự mở giao dịch) và gọi `cuaTotp()` — ĐỒNG BỘ, không I/O — ĐÚNG
 *               chỗ kiểm TOTP cũ (CUỐI, sau mọi kiểm hợp lệ, ngay trước lượt ghi), chỉ khi lượt ấy cần mã. Có thể chạy HAI lần: thân không được có
 *               hiệu ứng ngoài giao dịch TRƯỚC cửa (đọc / kiểm thì được).
 * @param xacMinh kiểm TOTP NGOÀI mọi giao dịch — bên gọi truyền `() => kiemTotpCauHinh(ctx, totpCode)`; ném appError ⇒ lượt bị từ chối với
 *               ĐÚNG mã lỗi như trước T5B (TOTP_CAN / TOTP_SAI / TOTP_CHUA_DANG_KY / ROLE_FLOOR / TOTP_TAM_KHOA / TOTP_KHONG_KIEM_DUOC / quá hạn).
 *
 * Luồng: lượt 1 không chạm cửa ⇒ trả / ném kết quả của nó (MỘT giao dịch — đường thường ngày không đổi). Chạm cửa ⇒ rollback ⇒ `xacMinh()` ⇒
 * (ném ⇒ từ chối) ⇒ lượt 2 với cửa no-op (đã xác minh cho CHÍNH lượt gọi này) ⇒ kết quả lượt 2.
 * Thứ tự từ chối giữ nguyên: mọi lỗi đứng trước cửa (phạm vi / NOT_FOUND / kiểm hợp lệ) ném ở lượt 1 TRƯỚC mọi kiểm mã ⇒ mã không bị tiêu, bộ
 * đếm sai không chạm (như cũ).
 */
export async function chayGiaoDichTotpNgoai<T>(chay: (cuaTotp: () => void) => Promise<T>, xacMinh: () => Promise<void>): Promise<T> {
  let chamCua = false;
  let luot1: { kq: T } | null = null;
  try {
    luot1 = {
      kq: await chay(() => {
        chamCua = true;
        throw new CanKiemTotpNgoaiTx();
      }),
    };
  } catch (e) {
    if (!chamCua) throw e; // lỗi THẬT của lượt 1 (đứng trước cửa) — nguyên văn
  }
  if (luot1 !== null) {
    if (chamCua) throw loiCuaBiNuot();
    return luot1.kq;
  }
  await xacMinh(); // NGOÀI giao dịch — không giữ khoá, không giữ kết nối
  return chay(() => undefined);
}
