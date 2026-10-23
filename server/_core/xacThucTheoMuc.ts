/**
 * R1a Task 7 (K8 + D5) — XÁC THỰC THEO MỨC TÁC ĐỘNG + SÀN VAI cho lệnh SCADA.
 *
 *   mức 1|3 ⇒ không cần 2FA                        (`cach: "khong_can"`)
 *   mức 4   ⇒ bước 2FA của PHIÊN, cache 10 phút     (`"phien"` khi cache còn, `"moi_lan"` khi vừa verify mã)
 *   mức 5   ⇒ TOTP TƯƠI ở MỌI lượt, mã dùng một lần (`"moi_lan"`)
 *   người CHƯA đăng ký 2FA ⇒ không làm được mức 4–5 (`TOTP_CHUA_DANG_KY`).
 *
 * ⚠⚠ BỎ QUA `AUTH_2FA_BAT_BUOC` và `ACTUATION_STEPUP_2FA` — quyết định D5 (chủ dự án + điều phối):
 *   chế độ nội bộ nới việc ĐÒI BẬT 2FA lúc đăng nhập/đặc quyền, nhưng mức 4–5 là lệnh chạm máy
 *   vật lý nên KHÔNG có nhánh "chưa bật thì cho qua" như `stepUpTotpMiddleware`. Hàm này không
 *   đọc `batBuoc2FA()` hay `actuationStepUp2faEnabled()`.
 *
 * Thứ tự kiểm (cố định, lưới §2 canh): SÀN VAI → (mức 1|3 xong) → đăng ký 2FA → cache (chỉ mức 4)
 *   → mã. Người dưới sàn nhận `ROLE_FLOOR` kể cả khi mã đúng, và mã KHÔNG bị tiêu.
 *
 * Quyết định ghi lại:
 *   · Mức 5 thành công ⇒ LÀM MỚI cache phiên của mức 4. Một mã tươi là bằng chứng mạnh hơn bước
 *     step-up mức 4; cache này vốn dùng chung theo phiên với `requireFreshTotp` (cùng Map), nên
 *     làm mới không mở thêm bề mặt nào mà mức 4 chưa có. Mức 5 thì KHÔNG BAO GIỜ đọc cache.
 *   · `totpCode` vắng hoặc rỗng ⇒ `TOTP_CAN`; có giá trị nhưng không đúng 6 chữ số ⇒ `TOTP_SAI`
 *     (không gọi verify, không chạm sổ).
 *   · `luot` (dấu lượt gọi của sổ `totp_consumed`, không phải bộ đếm audit): nếu một middleware
 *     step-up cũ ĐÃ verify mã trong CÙNG lượt gọi tRPC thì dùng lại dấu của nó
 *     (`ctx.__luotXacMinhTotp`) — nếu không, cùng một mã của chính lượt ấy sẽ bị sổ coi là phát
 *     lại. Không có ⇒ đúc dấu mới, nên hai lượt gọi khác nhau với cùng mã ⇒ `TOTP_SAI`.
 *   · Không ném lỗi: trả kết quả thuần; Task 8/9 đổi sang `appError`.
 *
 * ⚠⚠ Fix round 1 — FAIL-CLOSED theo mức: CHỈ `1` và `3` (so `===`) là mức thấp. Mọi giá trị khác
 *   lúc chạy (`"5"`, `2`, `undefined`, `NaN`…, lọt qua một phép ép kiểu) đi đường MỨC 5: sàn
 *   `ACTUATION_ROLES` + TOTP tươi, không đọc cache.
 * ⚠⚠ Fix round 1 — KHÔNG có `sessionToken` ⇒ mức 4 KHÔNG đọc và KHÔNG ghi cache phiên (cư xử như
 *   mức 5). Khoá dự phòng `user:{id}` của middleware cũ là chung cho MỌI phiên không token của
 *   cùng người, nên nó không phải "bước 2FA của PHIÊN".
 * ⚠⚠ HỢP ĐỒNG "MỘT MÃ TOTP CHO MỘT LƯỢT GỌI tRPC" (Task 8/9 phải tính tới): dấu lượt
 *   `ctx.__luotXacMinhTotp` (nếu chuỗi step-up cũ đã đặt) sống suốt lượt gọi, nên một thủ tục gọi
 *   helper N lần trong CÙNG lượt gọi với CÙNG `totpCode` được phép N lần bằng MỘT mã — sổ coi đó là
 *   cùng một lượt. Không có dấu ⇒ mỗi lần gọi helper đúc dấu mới ⇒ lần thứ hai cùng mã ⇒ `TOTP_SAI`.
 *   ⇒ Một thủ tục muốn "mỗi lệnh mức 5 một mã" thì gọi helper ĐÚNG MỘT lần cho mỗi lệnh, mỗi lượt gọi.
 */
import type { MucRuiRo } from "../services/ot/aiControlGate";
import { dauLuotGoiMoi } from "./totpOnce";
import {
  ACTUATION_ROLES,
  ghiStepUpPhien,
  khoaPhienStepUp,
  stepUpPhienConHan,
  verifyFreshTotp,
  type UserRole,
} from "./trpc";

const VAI_MUC_THAP: readonly UserRole[] = Object.freeze(["operator", "engineer", "supervisor", "admin"] as UserRole[]);

/** Sàn vai được ra lệnh ở mức `muc`. 1|3 ⇒ operator/engineer/supervisor/admin; 4|5 ⇒ `ACTUATION_ROLES`. */
export function vaiTroDuocGhi(muc: MucRuiRo): readonly UserRole[] {
  // Fail-closed: chỉ 1|3 (so `===`) được sàn thấp; mọi giá trị khác lúc chạy ⇒ sàn cao.
  return muc === 1 || muc === 3 ? VAI_MUC_THAP : ACTUATION_ROLES;
}

export type KetQuaXacThucTheoMuc =
  | { ok: true; cach: "khong_can" | "phien" | "moi_lan" }
  | { ok: false; ma: "ROLE_FLOOR" | "TOTP_CHUA_DANG_KY" | "TOTP_CAN" | "TOTP_SAI" };

export interface CtxXacThuc {
  user: { id: number; role: string; twoFactorEnabled?: boolean | null } | null | undefined;
  sessionToken?: string | null;
}

export async function kiemXacThucTheoMuc(
  ctx: CtxXacThuc,
  muc: MucRuiRo,
  totpCode?: string,
): Promise<KetQuaXacThucTheoMuc> {
  const user = ctx.user;
  // 1. Sàn vai — TRƯỚC mọi kiểm TOTP.
  if (!user || !vaiTroDuocGhi(muc).includes(user.role as UserRole)) return { ok: false, ma: "ROLE_FLOOR" };

  // 2. Mức 1|3: không cần 2FA. Liệt kê TƯỜNG MINH — mọi giá trị khác rơi xuống đường mức 5.
  if (muc === 1 || muc === 3) return { ok: true, cach: "khong_can" };
  const dungCache = muc === 4 && !!ctx.sessionToken; // chỉ mức 4 ĐÚNG, và chỉ khi có phiên thật

  // 3. Mức 4|5: phải đăng ký 2FA (cùng nguồn sự thật với adminProcedure/require2FA).
  if (!user.twoFactorEnabled) return { ok: false, ma: "TOTP_CHUA_DANG_KY" };

  const khoa = khoaPhienStepUp({ user, sessionToken: ctx.sessionToken });

  // 4. Chỉ mức 4 có sessionToken đọc cache phiên.
  if (dungCache && stepUpPhienConHan(khoa)) return { ok: true, cach: "phien" };

  // 5. Cần mã.
  if (totpCode === undefined || totpCode === null || totpCode === "") return { ok: false, ma: "TOTP_CAN" };
  if (typeof totpCode !== "string" || !/^\d{6}$/.test(totpCode)) return { ok: false, ma: "TOTP_SAI" };

  const luot = (ctx as { __luotXacMinhTotp?: string }).__luotXacMinhTotp ?? dauLuotGoiMoi();
  const kq = await verifyFreshTotp(user.id, totpCode, luot);
  if (!kq.hopLe) return { ok: false, ma: "TOTP_SAI" };

  // Mã đúng (mức 4 hoặc 5) ⇒ đặt/làm mới cache phiên 10 phút cho mức 4 — chỉ khi có sessionToken.
  if (ctx.sessionToken) ghiStepUpPhien(khoa);
  return { ok: true, cach: "moi_lan" };
}
