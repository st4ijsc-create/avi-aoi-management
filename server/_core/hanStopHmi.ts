/**
 * SCADA R1b-2a Task 4 fix round 1 (review I-1, I-2, M-3) — MỘT hạn cho CẢ request STOP HMI (`scadaCommands.dungMay`).
 *
 * Lời hứa của kế hoạch (Review Focus 5): DB chậm-mà-sống ⇒ người vận hành nhận từ chối có mã "dùng E-STOP cứng" trong ≤ 2,5 s, tính từ
 * lúc request tới tRPC. Một hạn duy nhất `HAN_TONG_STOP_HMI_MS` bắt đầu ở `createContext` (server/_core/context.ts) khi request CÓ CHỨA
 * dungMay (một mình HOẶC trong batch tRPC — R1b-2b-1 T15, bọc hạn chứ không từ chối), đi qua `ctx.hanChotStopHmi` (theo request, không có trạng thái module cho hạn) và bọc MỌI lượt chờ DB trước dispatch:
 *   1. xác thực đầy đủ (`sdk.authenticateRequest`) — min(HAN_XAC_THUC_STOP_HMI_MS, còn lại)            · context.ts
 *   2. cổng buộc đổi mật khẩu (`phaiDoiMatKhau`, SELECT users)                                         · trpc.ts chanKhiPhaiDoiMatKhau
 *   3. cổng giấy phép module (`resolveEntitlement`, 2 × getAllLicenses) — khi LICENSE_MODULE_GATE bật  · moduleGate.ts
 *   4. phạm vi tenant (`getTenantScope`) — khi TENANT_RLS_ENABLED bật                                   · trpc.ts tenantScopeMiddleware
 *   5. pha trước-gửi của handler (phạm vi / vai / ghim / dòng chờ) — min(HAN_TRUOC_GUI_STOP_HMI_MS, còn lại) · lenhHmi.dungMayHmi
 * Hết hạn ở 1–4 ⇒ NÉM `loiStopQuaHan` (fail-closed: thủ tục không chạy, không bao giờ để STOP đi tiếp mà bỏ qua một cổng). Hết hạn ở 5 ⇒
 * từ chối có mã của handler (có dòng attempts + audit). `dispatch()` NGOÀI mọi hạn: đã gửi thì không bao giờ từ chối vì hạn.
 * NGOÀI hạn (đo, ghi rõ): phần Express TRƯỚC tRPC — bộ giới hạn tần suất và đọc thân request; middleware giấy phép Express
 * (`licenseEnforcementMiddleware`) không chạm DB. Bộ giới hạn (R1b-2b-1 T14): MỘT lệnh Redis nguyên tử mỗi lượt đếm (`LUA_TANG_DEM`), hạn
 * `HAN_LENH_REDIS_GIOI_HAN_MS` = 250 ms mỗi lệnh ⇒ thêm tối đa ~250 ms trước `createContext`; Redis sập / lỗi / chậm quá hạn ⇒ đếm DỰ PHÒNG trong
 * bộ nhớ tiến trình (`StoreDuPhongBoNho`, cùng trần — 600 / phút / phiên cho STOP — nhưng THEO TIẾN TRÌNH), không bao giờ fail-open.
 * Truy vấn bị bỏ rơi khi hết hạn vẫn chạy nền tới khi DB trả lời.
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

/**
 * R1b-2b-1 T15 (kiểm định G4) — true ⇔ `info.calls` là mảng và có ≥ 1 phần tử `scadaCommands.dungMay` (batch trộn CŨNG tính).
 * Quyết định: BỌC HẠN, KHÔNG từ chối — từ chối một STOP vì hình dạng request là một cổng phần mềm đứng trước STOP (bất biến: STOP không bao giờ
 * bị chặn bởi hình dạng request). Hệ quả CHẤP NHẬN (KD-T15): các lượt gọi KHÁC trong cùng batch dùng chung hạn tổng ⇒ khi DB / xác thực chậm
 * chúng cũng có thể nhận 503 `SCADA_STOP_PRECHECK_TIMEOUT`. Chỉ client không chuẩn gửi hình này (trpcLinks tách dungMay riêng).
 * `laGoiChiDungMay` giữ nguyên cho tầng giới hạn tần suất và log.
 */
export function laGoiCoDungMay(info: unknown): boolean {
  const calls = (info as { calls?: Array<{ path?: unknown }> } | undefined)?.calls;
  return Array.isArray(calls) && calls.some((c) => typeof c?.path === "string" && c.path === DUONG_DUNG_MAY_HMI);
}

export type PhaQuaHanStopHmi = "truoc_gui" | "xac_thuc";
/**
 * Bước mà từ chối vì hạn KHÔNG ghi được scada_command_attempts / audit.
 * R1b-2a final-fix M-1: "ghi_so_loi" = đã có kết nối DB nhưng lượt chèn dòng từ chối STOP_QUA_HAN ném (reset kết nối, thiếu cột 0433 …) ⇒
 * dòng không có trong sổ ⇒ đếm ở đây để posture `stopQuaHan24h` không đếm thiếu.
 */
export type BuocKhongGhiSo = "xac_thuc" | "cong_doi_mat_khau" | "giay_phep" | "pham_vi_tenant" | "db" | "ghi_so_loi";

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
export function trongHanYeuCauStopHmi<T>(
  p: Promise<T>,
  hanChot: number | undefined,
  buoc: BuocKhongGhiSo,
  pha: PhaQuaHanStopHmi,
  tran?: number,
  duongThuTuc?: string,
): Promise<T> {
  // không hạn ⇒ ĐÚNG promise gốc (không thêm một nhịp microtask nào cho mọi request khác)
  return hanChot === undefined ? p : choTrongHan(p, hanChot, buoc, pha, tran, duongThuTuc);
}

async function choTrongHan<T>(p: Promise<T>, hanChot: number, buoc: BuocKhongGhiSo, pha: PhaQuaHanStopHmi, tran?: number, duongThuTuc?: string): Promise<T> {
  const conLai = hanChot - Date.now();
  const ms = Math.max(1, Math.min(tran ?? Number.POSITIVE_INFINITY, conLai));
  try {
    // final-fix — hạn ĐÃ cạn ⇒ từ chối NGAY, tất định (trước: cuộc đua 1 ms với lượt đọc DB — DB ấm thắng ⇒ cổng cho qua rồi cổng sau mới từ
    // chối, pha khác; lưới "hạn tổng ĐÃ cạn qua router" chập chờn theo thứ tự chạy). Lời hứa `p` bị bỏ rơi chạy nền như mọi lượt quá hạn.
    if (conLai <= 0) {
      p.catch(() => undefined);
      throw new LoiHetHanYeuCauStopHmi();
    }
    return await withDeadline(p, ms, "HMI STOP request", { unref: true, loi: () => new LoiHetHanYeuCauStopHmi() });
  } catch (e) {
    if (!(e instanceof LoiHetHanYeuCauStopHmi)) throw e;
    // R1b-2b-1 T15 vòng sửa 1 (I1): `duongThuTuc` biết ⇒ và KHÔNG phải dungMay ⇒ lượt gọi ANH EM cùng batch (KD-T15): vẫn nhận 503 (fail-closed, chung hạn)
    // nhưng KHÔNG đếm vào `stopQuaHan24h` và KHÔNG log "STOP CHƯA được gửi" (không phải STOP). Vắng `duongThuTuc` (xác thực ở createContext — cả request
    // có dungMay) ⇒ tính là STOP như trước.
    if (duongThuTuc !== undefined && duongThuTuc !== DUONG_DUNG_MAY_HMI) {
      logger.warn({ buoc, pha, hanMs: ms, duongThuTuc }, "[SCADA] call cùng batch với dungMay quá hạn tổng STOP — nhận 503 chung hạn (không phải STOP, không đếm stopQuaHan24h)");
      throw loiStopQuaHan(
        pha,
        `Máy chủ chậm — lượt gọi này nằm CÙNG batch với STOP HMI nên chung hạn ${HAN_TONG_STOP_HMI_MS} ms và quá hạn ở bước ${buoc}. Gửi lại riêng lượt này.`,
      );
    }
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

// ─── R1b-2b-1 T9 (mục 46): làm ấm import ĐỘNG của đường STOP HMI ─────────────────────────────────────────────────────────────────
/**
 * MỌI `import("<spec>")` trong `server/_core/trpc.ts`, `server/_core/moduleGate.ts`, `server/_core/context.ts` (cùng thư mục với tệp này ⇒
 * CÙNG chuỗi spec) — các middleware mà request STOP HMI (`scadaCommands.dungMay`) đi qua. Lần import ĐẦU của một module lớn (vd. `../db`) tốn
 * hàng trăm ms đĩa + biên dịch, và nằm TRONG hạn tổng `HAN_TONG_STOP_HMI_MS` ⇒ STOP đầu tiên sau khởi động có thể quá hạn chỉ vì import lạnh.
 * `index.ts` gọi `lamAmDuongStopHmi()` ngay sau `listen`. Lưới `hanStopHmi.lamAm.test.ts` quét ba tệp: spec mới thiếu ở đây ⇒ ĐỎ.
 */
export const MODULE_DUONG_STOP_HMI: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ["../db", () => import("../db")],
  ["../db/tenantContext", () => import("../db/tenantContext")],
  ["./accessControl", () => import("./accessControl")],
  ["../license/license-service", () => import("../license/license-service")],
  ["../services/robot/robotStopAuthMemo", () => import("../services/robot/robotStopAuthMemo")],
  ["../services/auditTrailService", () => import("../services/auditTrailService")],
];

/** Gọi MỌI loader (song song); KHÔNG BAO GIỜ ném — loader lỗi ⇒ tên nó vào `loi` (STOP sau đó vẫn tự import như trước, chỉ chậm hơn). */
export async function lamAmDuongStopHmi(
  dsModule: ReadonlyArray<readonly [string, () => Promise<unknown>]> = MODULE_DUONG_STOP_HMI,
): Promise<{ ok: number; loi: string[] }> {
  const kq = await Promise.allSettled(
    dsModule.map(async ([, nap]) => {
      await nap();
    }),
  );
  const loi = dsModule.flatMap(([ten], i) => (kq[i].status === "rejected" ? [ten] : []));
  return { ok: dsModule.length - loi.length, loi };
}
