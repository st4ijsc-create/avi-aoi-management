/**
 * SCADA R1a Task 8 — `scadaCommands` (ruling R-2: `scada.commands.*` của kế hoạch = `trpc.scadaCommands.*`): lệnh ghi tag từ HMI.
 *
 *   request (mutation)   — bước 1: bản xem trước + khoá chọn + dòng chờ `ai_pending_actions` (tool "hmi.write_tag", TTL 60 s).
 *   confirm (mutation)   — bước 2 (R1a Task 9): 2FA theo mức tag HIỆN TẠI, kiểm lại cổng, gia hạn khoá nguyên tử, CAS
 *                          proposed→confirmed, `dispatch()` hitl hmi.write_tag đọc lại bắt buộc. Thứ tự + quyết định: lenhHmi.ts.
 *   huy (mutation)       — chủ yêu cầu huỷ: proposed→cancelled, nhả khoá.
 *   trangThai (query)    — chủ yêu cầu xem: dòng chờ + attempts + command_log theo actionId (không address/errorText).
 *   dungMay (mutation)   — R1b-1 Task 2: STOP HMI MỘT bước — giá trị DỪNG ĐÃ GHIM tới mọi adapter bật của máy qua `dispatch()` (không khoá
 *                          chọn, không kiểm chế độ, không 2FA, mức 1; miễn nhóm giới hạn "2fa" — census trpcGioiHanThuTuc). Thứ tự: lenhHmi.ts.
 *   mayDungKhanCap (query) — R1b-2b-1 T1 (mục 59): máy trong phạm vi mà người gọi được dừng, cho khối DỪNG khẩn cấp trên trang buộc đổi
 *                          mật khẩu (tối thiểu; miễn cổng buộc-đổi-mật-khẩu cùng dungMay). Logic: services/scada/mayDungKhanCap.ts.
 *   dieuKienChoPhep (query) — R1b-2b-2b A C5 (M4, B-T11): "Điều kiện cho phép" CHẠY KHÔ — CÙNG hàm cổng tĩnh với request
 *                          (`kiemDieuKienGhiTag`), không ghi gì, không tiêu TOTP, không dispatch; trần 60 / phút / người + 30 / phút / (người, adapter).
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
import { appError, readAppErrorMeta, type AppErrorCode, type AppErrorParams } from "../_core/appError";
import { loiTotpKhoa } from "../_core/totpKhoaSai";
import { phamViCua } from "./_phamViNguoiXem";
import {
  datLuotDieuKien,
  dungMayHmi,
  huyYeuCauGhi,
  kiemDieuKienGhiTag,
  trangThaiYeuCauGhi,
  xacNhanGhiTag,
  yeuCauGhiTag,
  type ChuaTinhDieuKien,
  type NguoiGoiLenh,
  type TuChoiYeuCau,
} from "../services/scada/lenhHmi";
import type { MucRuiRo } from "../services/ot/aiControlGate";
import { mayDungKhanCap } from "../services/scada/mayDungKhanCap";

const thuTucLenh = moduleProcedure("MOD_OT_CONTROL");

// R1b-1 T7 fix round 1 (I-1): NUL (U+0000) không lưu được vào Postgres (jsonb của dòng chờ + cột ly_do của attempts) ⇒ từ chối rõ ràng ở cửa vào.
const khongNul = (v: string) => !v.includes("\u0000");
const THONG_BAO_NUL = "Lý do không được chứa ký tự NUL (U+0000).";
const lyDoInput = z.string().trim().min(5).max(300).refine(khongNul, { message: THONG_BAO_NUL });

const so = (n: number | null) => (n === null ? "—" : n);

const requestIdInput = z.object({ requestId: z.string().uuid() });

/** Danh tính người gọi từ `ctx` (không bao giờ từ input). */
function nguoiGoi(ctx: {
  user: { id: number; role: string; twoFactorEnabled?: boolean | null };
  sessionToken?: string | null;
  __luotXacMinhTotp?: string;
}): NguoiGoiLenh {
  return {
    user: { id: ctx.user.id, role: ctx.user.role, twoFactorEnabled: ctx.user.twoFactorEnabled },
    sessionToken: ctx.sessionToken ?? null,
    ...(ctx.__luotXacMinhTotp ? { __luotXacMinhTotp: ctx.__luotXacMinhTotp } : {}),
  };
}

/** Từ chối ⇒ appError. `ma` (= reason_code của dòng attempts) luôn có trong params cho M5. */
export function loiTuChoiLenh(t: TuChoiYeuCau) {
  switch (t.ma) {
    case "FEATURE_DISABLED":
      return appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "scadaCommands", ma: t.ma }, "Lệnh HMI SCADA đang tắt (SCADA_COMMANDS_ENABLED).");
    case "NOT_FOUND":
      if (t.entity === "scadaRequest") return appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "scadaRequest", ma: t.ma }, "Yêu cầu không tồn tại.");
      // R1b-1 Task 2 — dungMay: máy không tồn tại = ngoài phạm vi (cùng một lỗi)
      if (t.entity === "machine") return appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine", ma: t.ma }, "Máy không tồn tại.");
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
    case "HET_HAN":
      return appError("PRECONDITION_FAILED", "SCADA_REQUEST_EXPIRED", { ma: t.ma }, t.chiTiet);
    case "KHOA_MAT":
      return appError("CONFLICT", "SCADA_SELECTION_LOST", { ma: t.ma }, t.chiTiet);
    case "TOTP_CAN":
      return appError("PRECONDITION_FAILED", "SCADA_TOTP_REQUIRED", { ma: t.ma, level: t.level }, t.chiTiet);
    case "TOTP_SAI":
      return appError("PRECONDITION_FAILED", "SCADA_TOTP_INVALID", { ma: t.ma, level: t.level }, t.chiTiet);
    case "MAY_DA_DOI":
      return appError("PRECONDITION_FAILED", "SCADA_MACHINE_REBOUND", { ma: t.ma }, t.chiTiet);
    // R1b-1 Task 2 — STOP HMI: máy không có adapter bật nào mang tag ghim DỪNG ⇒ không gửi được gì; dùng E-STOP cứng
    case "CHUA_GHIM_STOP":
      return appError("PRECONDITION_FAILED", "SCADA_STOP_NOT_PINNED", { ma: t.ma }, t.chiTiet);
    // kiem-dinh R1b-1 H1 (b) — có ghim nhưng MỌI ghim nằm trên tag mức tác động > 1 ⇒ STOP HMI không gửi gì; dùng E-STOP cứng
    case "GHIM_MUC_CAO":
      return appError("PRECONDITION_FAILED", "SCADA_STOP_PINS_HIGH_LEVEL", { ma: t.ma, soTag: t.soTag, tagKeys: t.tagKeys }, t.chiTiet);
    // R1b-2a Task 4 (M-1) — pha trước-gửi của STOP HMI quá hạn: STOP CHƯA được gửi (dispatch 0 lần) ⇒ dùng E-STOP cứng.
    // Fix round 1 (I-2): SERVICE_UNAVAILABLE (HTTP 503), KHÔNG TIMEOUT/408 — Chromium tự gửi lại POST nhận 408 trên socket keep-alive dùng lại.
    // Xác thực / middleware (server/_core/hanStopHmi.ts `loiStopQuaHan`) ném CÙNG appCode + mã trực tiếp — không qua đây.
    case "STOP_QUA_HAN":
      return appError("SERVICE_UNAVAILABLE", "SCADA_STOP_PRECHECK_TIMEOUT", { ma: t.ma, pha: t.pha }, t.chiTiet);
    // R1b-2a Task 9 — thiếu migration 0433 ⇒ request / confirm từ chối có mã (KHÔNG BAO GIỜ dungMay)
    case "THIEU_MIGRATION":
      return appError("PRECONDITION_FAILED", "SCADA_SCHEMA_MISSING", { ma: t.ma, migration: t.migration }, t.chiTiet);
    // R1a Task 16 — bộ đếm TOTP sai (chung mọi bên gọi TOTP): CÙNG mã + câu i18n với đăng nhập / 2FA, thêm `{ ma, level }` cho M5.
    // M5 chỉ hiện "tạm khoá, thử lại sau N phút" (`remainingMinutes`) — không có số lần sai.
    case "TOTP_TAM_KHOA":
    case "TOTP_KHONG_KIEM_DUOC":
      return loiTotpKhoa(t.ma === "TOTP_TAM_KHOA" ? { ma: t.ma, conLaiMs: t.conLaiMs } : { ma: t.ma }, { ma: t.ma, level: t.level })!;
  }
}

/**
 * KD-2bA 5.2 — phần CÔNG BỐ của một từ chối: ĐÚNG `(appCode, params)` của lỗi mà `loiTuChoiLenh` dựng cho `request` — không hơn (không
 * `chiTiet`, không `boiUserId` / `conLaiMs` / `edgeNodeId` … ngoài params đó). Dựng bằng CHÍNH `loiTuChoiLenh` ⇒ client dịch bằng cùng khoá.
 */
export type TuChoiCongBo = { code: AppErrorCode; params: AppErrorParams };
export function tuChoiCongBo(t: TuChoiYeuCau): TuChoiCongBo {
  // loiTuChoiLenh luôn dựng bằng appError ⇒ luôn có appCode (test C5 phủ MỌI mã); thiếu (không thể) ⇒ mã chung OPERATION_FAILED
  const meta = readAppErrorMeta(loiTuChoiLenh(t));
  return { code: (meta?.appCode ?? "OPERATION_FAILED") as AppErrorCode, params: meta?.appParams ?? {} };
}

/** HỢP ĐỒNG B-T11 — kết quả `scadaCommands.dieuKienChoPhep`. */
export type DieuKienChoPhep =
  | { quaCongTinh: true; canTotp: boolean; muc: MucRuiRo; canhBao: string[]; chuaTinh: ChuaTinhDieuKien[] }
  | { quaCongTinh: false; tuChoi: TuChoiCongBo; chuaTinh: ChuaTinhDieuKien[] };

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
      const kq = await yeuCauGhiTag(nguoiGoi(ctx), phamViCua(ctx), input);
      if (!kq.ok) throw loiTuChoiLenh(kq.tuChoi);
      return kq.ketQua;
    }),

  confirm: thuTucLenh
    .input(z.object({ requestId: z.string().uuid(), totpCode: z.string().length(6).optional() }))
    .mutation(async ({ ctx, input }) => {
      const kq = await xacNhanGhiTag(nguoiGoi(ctx), phamViCua(ctx), input);
      if (!kq.ok) throw loiTuChoiLenh(kq.tuChoi);
      return kq.ketQua;
    }),

  huy: thuTucLenh.input(requestIdInput).mutation(async ({ ctx, input }) => {
    const kq = await huyYeuCauGhi(nguoiGoi(ctx), input);
    if (!kq.ok) throw loiTuChoiLenh(kq.tuChoi);
    return kq.ketQua;
  }),

  trangThai: thuTucLenh.input(requestIdInput).query(async ({ ctx, input }) => {
    const kq = await trangThaiYeuCauGhi(nguoiGoi(ctx), input);
    if (!kq.ok) throw loiTuChoiLenh(kq.tuChoi);
    return kq.ketQua;
  }),

  /**
   * R1b-1 Task 2 — STOP HMI một bước. `lyDo` TUỲ CHỌN (không bắt gõ lý do khi dừng máy). Phạm vi + sàn vai mức 1 + `machine_control.canEdit`
   * kiểm trong lenhHmi; KHÔNG 2FA, KHÔNG khoá chọn, KHÔNG kiểm chế độ (dispatcher miễn STOP khớp ghim).
   */
  dungMay: thuTucLenh
    .input(
      z.object({
        machineId: z.number().int().positive(),
        // STOP KHÔNG BAO GIỜ bị từ chối vì chữ lý do (rà soát T7 vòng 1): NUL/ký tự điều khiển + quá 300 ký tự ⇒ service LỌC + CẮT (catLyDo),
        // không BAD_REQUEST. Trần 2000 chỉ chặn thân yêu cầu khổng lồ.
        lyDo: z.string().max(2000).optional(),
        clientRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // R1b-2a T4 fix round 1 (I-1) — pha trước-gửi dùng phần CÒN LẠI của hạn tổng của request (đặt ở createContext), không phải 2 s mới
      // final-fix (điều phối 2026-10-26) — người đang bị buộc đổi mật khẩu VẪN dừng được máy (cổng miễn riêng dungMay); dungMayHmi ghi audit
      const kq = await dungMayHmi(nguoiGoi(ctx), phamViCua(ctx), input, {
        hanChotYeuCau: ctx.hanChotStopHmi,
        dangBiBuocDoiMatKhau: ctx.stopKhiBuocDoiMatKhau === true,
      });
      if (!kq.ok) throw loiTuChoiLenh(kq.tuChoi);
      return kq.ketQua;
    }),

  /**
   * R1b-2b-1 T1 (mục 59, điều phối Q1 2026-10-26) — danh sách TỐI THIỂU cho khối "DỪNG MÁY khẩn cấp" trên trang buộc đổi mật khẩu: máy trong
   * phạm vi mà người gọi được dừng (sàn vai mức 1 + machine_control.canEdit, như dungMay; không đạt ⇒ rỗng). Phần tử THỨ HAI của tập miễn cổng
   * buộc-đổi-mật-khẩu. Chỉ id / nhãn máy / nhãn chuyền / coDung / số adapter (ruling C16); ≤ 201 hàng + `biCat` (C6). Thân có hạn 3 s.
   */
  mayDungKhanCap: thuTucLenh.query(({ ctx }) => mayDungKhanCap(nguoiGoi(ctx), phamViCua(ctx))),

  /**
   * R1b-2b-2b A C5 (M4, hợp đồng B-T11) — "Điều kiện cho phép" CHẠY KHÔ: chạy CÙNG các cổng tĩnh của `request` (`kiemDieuKienGhiTag`, cùng
   * thứ tự) mà KHÔNG ghi gì (0 `ai_pending_actions`, 0 `scada_command_attempts`, 0 audit, không chạm bộ điều tiết), KHÔNG xác minh / tiêu
   * TOTP (chỉ báo `canTotp`), KHÔNG lấy khoá chọn, KHÔNG `dispatch()`. Kết luận `quaCongTinh` + `chuaTinh` (KD-2bA 5.1).
   *   • NOT_FOUND (adapter / tag không tồn tại hoặc ngoài phạm vi) ⇒ NÉM y hệt `request` (cùng `loiTuChoiLenh`) — chạy khô không là cửa dò.
   *   • Từ chối khác ⇒ trả `{ quaCongTinh:false, tuChoi:{code, params} }` = đúng phần công bố của lỗi `request` (KD-2bA 5.2).
   *   • Trần (Q6 + KD-2bA 5.4): 60 lượt / 60 s / người, 30 lượt / 60 s / (người, adapter) — TRƯỚC mọi chạm DB ⇒ TOO_MANY_REQUESTS
   *     `OPERATION_FAILED {operation:"scadaDryRun", reason:"rateLimited"}`; bị chặn thì không đếm, log chẩn đoán (lenhHmi `datLuotDieuKien`).
   */
  dieuKienChoPhep: thuTucLenh
    .input(
      z
        .object({
          adapterId: z.number().int().positive(),
          tagKey: z.string().min(1).max(128),
          value: z.union([z.number().finite(), z.boolean(), z.string().max(256)]),
        })
        .strict(),
    )
    .query(async ({ ctx, input }): Promise<DieuKienChoPhep> => {
      const tran = datLuotDieuKien(ctx.user.id, input.adapterId);
      if (!tran.ok) {
        throw appError(
          "TOO_MANY_REQUESTS",
          "OPERATION_FAILED",
          { operation: "scadaDryRun", reason: "rateLimited" },
          `Quá ${tran.tran} lượt chạy khô "Điều kiện cho phép" trong 60 s.`,
        );
      }
      const kq = await kiemDieuKienGhiTag(nguoiGoi(ctx), phamViCua(ctx), input);
      if (kq.quaCongTinh) return { quaCongTinh: true, canTotp: kq.canTotp, muc: kq.muc, canhBao: kq.canhBao, chuaTinh: kq.chuaTinh };
      if (kq.tuChoi.ma === "NOT_FOUND") throw loiTuChoiLenh(kq.tuChoi);
      return { quaCongTinh: false, tuChoi: tuChoiCongBo(kq.tuChoi), chuaTinh: kq.chuaTinh };
    }),
});
