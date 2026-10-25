/**
 * SCADA R1b-2a Task 4 fix round 1 (review I-1, I-2, M-3) — MỘT hạn cho CẢ request STOP HMI (`scadaCommands.dungMay`).
 *
 * Lời hứa của kế hoạch (Review Focus 5): DB chậm-mà-sống ⇒ người vận hành nhận từ chối có mã "dùng E-STOP cứng" trong ≤ 2,5 s, tính từ
 * lúc request tới tRPC. Một hạn duy nhất `HAN_TONG_STOP_HMI_MS` bắt đầu ở `createContext` (server/_core/context.ts) khi request CHỈ gồm
 * dungMay, đi qua `ctx.hanChotStopHmi` (theo request, không có trạng thái module cho hạn) và bọc MỌI lượt chờ DB trước dispatch:
 *   1. xác thực đầy đủ (`sdk.authenticateRequest`) — min(HAN_XAC_THUC_STOP_HMI_MS, còn lại)            · context.ts
 *   2. cổng buộc đổi mật khẩu (`phaiDoiMatKhau`, SELECT users)                                         · trpc.ts chanKhiPhaiDoiMatKhau
 *   3. cổng giấy phép module (`resolveEntitlement`, 2 × getAllLicenses) — khi LICENSE_MODULE_GATE bật  · moduleGate.ts
 *   4. phạm vi tenant (`getTenantScope`) — khi TENANT_RLS_ENABLED bật                                   · trpc.ts tenantScopeMiddleware
 *   5. pha trước-gửi của handler (phạm vi / vai / ghim / dòng chờ) — min(HAN_TRUOC_GUI_STOP_HMI_MS, còn lại) · lenhHmi.dungMayHmi
 * Hết hạn ở 1–4 ⇒ NÉM `loiStopQuaHan` (fail-closed: thủ tục không chạy, không bao giờ để STOP đi tiếp mà bỏ qua một cổng). Hết hạn ở 5 ⇒
 * từ chối có mã của handler (có dòng attempts + audit). `dispatch()` NGOÀI mọi hạn: đã gửi thì không bao giờ từ chối vì hạn.
 * NGOÀI hạn (đo, ghi rõ): phần Express TRƯỚC tRPC — bộ giới hạn tần suất (Redis, passOnStoreError) và đọc thân request; middleware
 * giấy phép Express (`licenseEnforcementMiddleware`) không chạm DB. Truy vấn bị bỏ rơi khi hết hạn vẫn chạy nền tới khi DB trả lời.
 *
 * I-2: mã tRPC `SERVICE_UNAVAILABLE` (HTTP 503), KHÔNG phải TIMEOUT/408 — Chromium tự gửi lại một POST nhận 408 trên socket keep-alive dùng
 * lại (một lần bấm ⇒ hai lần thử, gấp đôi thời gian chờ). appCode `SCADA_STOP_PRECHECK_TIMEOUT` giữ nguyên (client không đổi).
 *
 * M-3: các từ chối KHÔNG ghi được sổ (chưa biết danh tính, hoặc chưa có kết nối DB, hoặc ở middleware) được ĐẾM TRONG BỘ NHỚ tiến trình
 * (`demStopQuaHanKhongGhiSo`, cho posture T12). ⚠ Bộ đếm MẤT khi khởi động lại tiến trình và chỉ của tiến trình này (nhiều bản API ⇒ mỗi
 * bản một bộ đếm) — `batDauLuc` cho biết đếm từ khi nào.
 */
import type { TRPCError } from "@trpc/server";
import { withDeadline } from "../services/ot/drivers/boundedClose";
import { appError, readAppErrorMeta } from "./appError";
import { logger } from "../logger";

/** Hạn TỔNG của một request STOP HMI, từ lúc vào createContext. */
export const HAN_TONG_STOP_HMI_MS = 2500;
/** Trần riêng của bước xác thực (trong hạn tổng). */
export const HAN_XAC_THUC_STOP_HMI_MS = 1500;
export const DUONG_DUNG_MAY_HMI = "scadaCommands.dungMay";
export const APP_CODE_STOP_QUA_HAN = "SCADA_STOP_PRECHECK_TIMEOUT" as const;

/** true ⇔ MỌI lượt gọi của request HTTP là `scadaCommands.dungMay` (cùng hình `isStopOnlyCall`; batch trộn thủ tục khác ⇒ false). */
export function laGoiChiDungMay(info: unknown): boolean {
  const calls = (info as { calls?: Array<{ path?: unknown }> } | undefined)?.calls;
  return Array.isArray(calls) && calls.length > 0 && calls.every((c) => typeof c?.path === "string" && c.path === DUONG_DUNG_MAY_HMI);
}

export type PhaQuaHanStopHmi = "truoc_gui" | "xac_thuc";
/** Bước mà từ chối vì hạn KHÔNG ghi được scada_command_attempts / audit. */
export type BuocKhongGhiSo = "xac_thuc" | "cong_doi_mat_khau" | "giay_phep" | "pham_vi_tenant" | "db";

/** Lỗi tRPC của một từ chối vì hạn (HTTP 503 + appCode — client hiện băng "dùng E-STOP cứng"). */
export function loiStopQuaHan(pha: PhaQuaHanStopHmi, chiTiet: string): TRPCError {
  return appError("SERVICE_UNAVAILABLE", "SCADA_STOP_PRECHECK_TIMEOUT", { ma: "STOP_QUA_HAN", pha }, chiTiet);
}

export function laLoiStopQuaHan(e: unknown): boolean {
  return readAppErrorMeta(e)?.appCode === APP_CODE_STOP_QUA_HAN;
}

class LoiHetHanYeuCauStopHmi extends Error {}

/**
 * Chờ `p` trong phần CÒN LẠI của hạn request `hanChot` (và ≤ `tran` nếu có). `hanChot` vắng (request không phải STOP HMI) ⇒ trả `p`
 * nguyên vẹn — mọi đường khác KHÔNG đổi. Hết hạn ⇒ đếm (M-3) + NÉM `loiStopQuaHan(pha)`. Lỗi của chính `p` đi nguyên.
 */
export function trongHanYeuCauStopHmi<T>(p: Promise<T>, hanChot: number | undefined, buoc: BuocKhongGhiSo, pha: PhaQuaHanStopHmi, tran?: number): Promise<T> {
  // không hạn ⇒ ĐÚNG promise gốc (không thêm một nhịp microtask nào cho mọi request khác)
  return hanChot === undefined ? p : choTrongHan(p, hanChot, buoc, pha, tran);
}

async function choTrongHan<T>(p: Promise<T>, hanChot: number, buoc: BuocKhongGhiSo, pha: PhaQuaHanStopHmi, tran?: number): Promise<T> {
  const ms = Math.max(1, Math.min(tran ?? Number.POSITIVE_INFINITY, hanChot - Date.now()));
  try {
    return await withDeadline(p, ms, "HMI STOP request", { unref: true, loi: () => new LoiHetHanYeuCauStopHmi() });
  } catch (e) {
    if (!(e instanceof LoiHetHanYeuCauStopHmi)) throw e;
    ghiNhanStopQuaHanKhongGhiSo(buoc);
    logger.error({ buoc, pha, hanMs: ms }, "[SCADA] STOP HMI: quá hạn trước khi gửi (middleware / xác thực) — STOP CHƯA được gửi; dùng E-STOP cứng");
    throw loiStopQuaHan(
      pha,
      `Máy chủ chậm — STOP HMI quá hạn ${HAN_TONG_STOP_HMI_MS} ms ở bước ${buoc}, STOP CHƯA được gửi. Dùng E-STOP cứng tại máy.`,
    );
  }
}

// ─── M-3: bộ đếm trong bộ nhớ các từ chối không ghi được sổ ─────────────────────────────────────────────────────────────────────
export const CUA_SO_DEM_STOP_QUA_HAN_MS = 24 * 60 * 60 * 1000;
/** Trần số mốc giữ lại (cũ nhất bị bỏ trước) — bộ đếm không bao giờ lớn vô hạn. */
export const TRAN_DEM_STOP_QUA_HAN = 10_000;
const mocDem: Array<{ at: number; buoc: BuocKhongGhiSo }> = [];
let batDauDem = Date.now();

function tiaMocCu(now: number): void {
  while (mocDem.length > 0 && now - mocDem[0].at > CUA_SO_DEM_STOP_QUA_HAN_MS) mocDem.shift();
  while (mocDem.length > TRAN_DEM_STOP_QUA_HAN) mocDem.shift();
}

export function ghiNhanStopQuaHanKhongGhiSo(buoc: BuocKhongGhiSo, now: number = Date.now()): void {
  mocDem.push({ at: now, buoc });
  tiaMocCu(now);
}

/** Số từ chối vì hạn KHÔNG ghi được sổ trong 24 h gần nhất (tiến trình này, từ `batDauLuc`). */
export function demStopQuaHanKhongGhiSo(now: number = Date.now()): { tong: number; theoBuoc: Partial<Record<BuocKhongGhiSo, number>>; batDauLuc: string } {
  tiaMocCu(now);
  const theoBuoc: Partial<Record<BuocKhongGhiSo, number>> = {};
  for (const m of mocDem) theoBuoc[m.buoc] = (theoBuoc[m.buoc] ?? 0) + 1;
  return { tong: mocDem.length, theoBuoc, batDauLuc: new Date(batDauDem).toISOString() };
}

/** Test seam. */
export function _datLaiDemStopQuaHanChoTest(): void {
  mocDem.length = 0;
  batDauDem = Date.now();
}
