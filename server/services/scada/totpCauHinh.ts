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
 */
import { z } from "zod";
import { appError } from "../../_core/appError";
import { kiemXacThucTheoMuc, type CtxXacThuc } from "../../_core/xacThucTheoMuc";
import { loiTotpKhoa } from "../../_core/totpKhoaSai";

/** Mã TOTP 6 số của các mutation cấu hình kênh (vắng ⇒ `TOTP_CAN` ở handler, không phải lỗi zod — UI hiện đúng câu "cần mã"). */
export const totpCauHinhInput = z.string().max(16).optional();

/**
 * Mức 5 cố định: sàn vai ACTUATION_ROLES, phải đăng ký 2FA, mã 6 số mỗi lượt, không cache phiên, không đọc cờ env. Từ chối ⇒ NÉM appError.
 */
export async function kiemTotpCauHinh(ctx: CtxXacThuc, totpCode: string | undefined): Promise<void> {
  const kq = await kiemXacThucTheoMuc(ctx, 5, totpCode);
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
