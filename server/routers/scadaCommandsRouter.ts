/**
 * SCADA R1a Task 8 — `scadaCommands` (ruling R-2: `scada.commands.*` của kế hoạch = `trpc.scadaCommands.*`): lệnh ghi tag từ HMI.
 *
 *   request (mutation) — bước 1: bản xem trước + khoá chọn + dòng chờ `ai_pending_actions` (tool "hmi.write_tag", TTL 60 s).
 *   confirm / huy / trangThai — Task 9 (KHÔNG có ở đây).
 *
 * Router MỎNG: logic + thứ tự cổng + nhật ký `scada_command_attempts` ở `server/services/scada/lenhHmi.ts`. Ở đây chỉ: danh tính + phạm
 * vi từ `ctx` (`phamViCua(ctx)`, không bao giờ từ input) và đổi từ chối thành `appError` (mỗi mã MỘT lời gọi literal — cổng
 * appErrorParamsCoverage đọc được tham số).
 *
 * QUYỀN: `moduleProcedure("MOD_OT_CONTROL")` (đăng nhập + giấy phép). KHÔNG dùng sàn vai ở procedure: operator được ghi kênh mức 1–3
 * (Q4), mà mức chỉ biết SAU khi đọc tag ⇒ `vaiTroDuocGhi(muc)` + `machine_control.canEdit` kiểm TRONG handler (cổng 5 của lenhHmi).
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { phamViCua } from "./_phamViNguoiXem";
import { yeuCauGhiTag, type TuChoiYeuCau } from "../services/scada/lenhHmi";

const thuTucLenh = moduleProcedure("MOD_OT_CONTROL");

const lyDoInput = z.string().trim().min(5).max(300);

const so = (n: number | null) => (n === null ? "—" : n);

/** Từ chối ⇒ appError. `ma` (= reason_code của dòng attempts) luôn có trong params cho M5. */
export function loiTuChoiLenh(t: TuChoiYeuCau) {
  switch (t.ma) {
    case "FEATURE_DISABLED":
      return appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "scadaCommands", ma: t.ma }, "Lệnh HMI SCADA đang tắt (SCADA_COMMANDS_ENABLED).");
    case "NOT_FOUND":
      return t.entity === "adapter"
        ? appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter", ma: t.ma }, "Adapter không tồn tại.")
        : appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag", ma: t.ma }, t.chiTiet);
    case "CHANNEL_READ_ONLY":
      return appError("PRECONDITION_FAILED", "SCADA_CHANNEL_READ_ONLY", { ma: t.ma, tagKey: t.tagKey }, t.chiTiet);
    case "TYPE_MISMATCH":
      return appError("BAD_REQUEST", "SCADA_VALUE_TYPE_MISMATCH", { ma: t.ma, tagKey: t.tagKey, dataType: t.dataType }, t.chiTiet);
    case "OUT_OF_RANGE":
      return appError("BAD_REQUEST", "SCADA_VALUE_OUT_OF_RANGE", { ma: t.ma, tagKey: t.tagKey, min: so(t.min), max: so(t.max) }, t.chiTiet);
    case "OFF_STEP":
      return t.goiY !== undefined
        ? appError("BAD_REQUEST", "SCADA_VALUE_OFF_STEP", { ma: t.ma, tagKey: t.tagKey, step: t.step, goiY: t.goiY }, t.chiTiet)
        : appError("BAD_REQUEST", "SCADA_VALUE_OFF_STEP_NO_HINT", { ma: t.ma, tagKey: t.tagKey, step: t.step }, t.chiTiet);
    case "ROLE_FLOOR":
      return appError("FORBIDDEN", "SCADA_ROLE_FLOOR", { ma: t.ma, level: t.level }, t.chiTiet);
    case "PERMISSION_DENIED":
      return appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canEdit", ma: t.ma }, t.chiTiet);
    case "TOTP_CHUA_DANG_KY":
      return appError("PRECONDITION_FAILED", "SCADA_TOTP_NOT_ENROLLED", { ma: t.ma, level: t.level }, t.chiTiet);
    case "EDGE_CHUA_HO_TRO":
      return appError("PRECONDITION_FAILED", "SCADA_EDGE_NOT_SUPPORTED", { ma: t.ma, edgeCode: t.edgeCode }, t.chiTiet);
    case "MODE_LOCAL":
      return appError("PRECONDITION_FAILED", "SCADA_MACHINE_NOT_REMOTE", { ma: t.ma, lyDo: t.lyDo }, t.chiTiet);
    case "DANG_DUOC_CHON":
      return appError(
        "CONFLICT",
        "SCADA_TAG_SELECTED_BY_OTHER",
        { ma: t.ma, boiUserId: t.boiUserId, boiTen: t.boiTen, hetHanLuc: t.hetHanLuc },
        t.chiTiet,
      );
    case "KHOA_CHON_LOI":
      return appError("CONFLICT", "OPERATION_FAILED", { operation: "scadaSelectTag", reason: "scadaSelectionLockBusy", ma: t.ma }, t.chiTiet);
    case "DA_XU_LY":
      return appError("CONFLICT", "SCADA_REQUEST_ALREADY_HANDLED", { ma: t.ma }, t.chiTiet);
  }
}

export const scadaCommandsRouter = router({
  request: thuTucLenh
    .input(
      z.object({
        adapterId: z.number().int().positive(),
        tagKey: z.string().min(1).max(128),
        value: z.union([z.number().finite(), z.boolean(), z.string().max(256)]),
        lyDo: lyDoInput,
        clientRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const kq = await yeuCauGhiTag(
        {
          user: { id: ctx.user.id, role: ctx.user.role, twoFactorEnabled: ctx.user.twoFactorEnabled },
          sessionToken: ctx.sessionToken ?? null,
        },
        phamViCua(ctx),
        input,
      );
      if (!kq.ok) throw loiTuChoiLenh(kq.tuChoi);
      return kq.ketQua;
    }),
});
