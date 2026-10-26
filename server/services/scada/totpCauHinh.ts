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
 * ★ R1b-2a T5 (kiem-dinh M7, điều phối Q5 DUYỆT 2026-10-25) — KẾT NỐI THỨ HAI TRONG GIAO DỊCH CẤU HÌNH, CÓ HẠN:
 *   Mọi bên gọi ở trên gọi hàm này BÊN TRONG giao dịch cấu hình (đang giữ khoá adapter / luật / tag). `kiemXacThucTheoMuc` đọc / ghi bộ đếm sai
 *   (`totp_khoa_sai`, T16) và sổ mã đã dùng (`totp_consumed`) qua POOL — một kết nối THỨ HAI ngoài `tx`. Điều đó là CỐ Ý và KHÔNG được chuyển
 *   vào `tx`: bộ đếm sai phải COMMIT kể cả khi giao dịch cấu hình rollback (lượt bị từ chối vì mã sai CHÍNH LÀ lượt rollback) — đếm trong `tx`
 *   thì mỗi mã sai bị rollback cùng giao dịch ⇒ bộ đếm không bao giờ tăng ⇒ dò mã không giới hạn.
 *   Cái giá: pool cạn (mọi kết nối đang bị các giao dịch cấu hình như thế này giữ) ⇒ lượt lấy kết nối thứ hai chờ VÔ HẠN trong khi `tx` giữ
 *   khoá. Vì vậy lượt kiểm được bọc `withDeadline(…, HAN_TOTP_CAU_HINH_MS)`: quá hạn ⇒ CONFLICT "thử lại" (`OPERATION_FAILED` · operation
 *   `scadaTotpCauHinh` · reason `scadaKenhThuLai`), giao dịch của bên gọi rollback và nhả khoá trong ≤ 3 s thay vì treo.
 *   Giới hạn đã biết (preflight D10): lượt kiểm bị bỏ rơi khi quá hạn vẫn có thể chạy xong sau đó trên kết nối riêng — mã có thể đã bị tiêu
 *   dù người dùng được báo "thử lại" (họ chờ mã mới; không có đường nào ghi cấu hình bằng lượt ấy vì giao dịch đã rollback).
 */
import { z } from "zod";
import { appError } from "../../_core/appError";
import { kiemXacThucTheoMuc, type CtxXacThuc } from "../../_core/xacThucTheoMuc";
import { loiTotpKhoa } from "../../_core/totpKhoaSai";
import { withDeadline } from "../ot/drivers/boundedClose";

/** Mã TOTP 6 số của các mutation cấu hình kênh (vắng ⇒ `TOTP_CAN` ở handler, không phải lỗi zod — UI hiện đúng câu "cần mã"). */
export const totpCauHinhInput = z.string().max(16).optional();

/** R1b-2a T5 (Q5) — hạn của lượt kiểm TOTP (kết nối thứ hai) khi chạy trong giao dịch cấu hình. Xem đầu tệp. */
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
