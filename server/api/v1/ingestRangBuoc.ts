/**
 * doc 81 Đợt 1B Task 8 — ingest `/api/v1/ingest/*` (+ `/api/ot/ingest`, R17): RÀNG BUỘC khoá ↔ máy
 * + mã HTTP ĐÚNG NGHĨA.
 *
 * ── ĐO (BE3 §L4) ────────────────────────────────────────────────────────────────────────────
 *   • khoá `mk_` của ESP32 ghi được telemetry cho `SCRW-SIM-01` (HTTP 200, dòng rơi vào máy khác):
 *     `deviceId`/`machineId` trong BODY quyết định máy (router.ts `toCanonicalSample`).
 *   • process-result gộp MỌI lỗi (kể cả DB sập, 429) thành 400 ⇒ SDK coi 4xx là vĩnh viễn và VỨT
 *     bản ghi.
 *
 * ── LUẬT (R16 — NGHIÊM, fix round 1) ──────────────────────────────────────────────────────────
 * "Máy của khoá" (`mayCuaKhoa`) = máy mà credential thuộc về:
 *   • khoá `mk_` (hàng `api_keys` có `machineId`) → máy đó;
 *   • khoá plaintext `machines.apiKey` (khi `MACHINE_SHARED_KEY_ALLOWED` cho phép) → máy đó.
 * Cả hai đều tra lại máy theo id (còn hoạt động không, mã HIỆN TẠI là gì); máy vắng/ngừng ⇒ 401.
 * Khoá KHÔNG gắn máy (MASTER_API_KEY, khoá chung `api_keys.machineId IS NULL`, token OAuth) giữ
 * nguyên hành vi cũ — repo KHÔNG có cơ chế "danh sách thiết bị được phép của gateway" nào (đã grep:
 * `api_keys`, `edge_nodes`, `apiKeyScope.ts` chỉ mang phạm vi TENANT), nên không bịa bảng mới.
 *
 * Với khoá gắn máy M (id, code), một request bị 403 và KHÔNG GHI GÌ nếu:
 *   telemetry — ∃ mẫu có `machineId` ≠ M.id, hoặc ∃ mẫu có `deviceId` (có mặt) ≠ M.code — so KHỚP
 *               CHÍNH XÁC, không tra `machines`. Mẫu hợp lệ rồi bị GHIM `machineId = M.id`, nên bus
 *               KHÔNG BAO GIỜ tự quy máy từ `deviceId` cho khoá gắn máy. Lý do (review fix round 1):
 *               đường quy máy của bus (a) cache `deviceId→machineId` VĨNH VIỄN (máy đổi mã ⇒ mã cũ
 *               vẫn trỏ máy cũ) và (b) `machines.code` chỉ duy nhất trong hàng ĐANG HOẠT ĐỘNG, bus
 *               không lọc `isActive` và không ORDER BY ⇒ một máy đã ngừng cùng mã có thể "thắng".
 *               Ghim theo khoá cắt cả hai đường; `deviceId` vẫn lưu nguyên văn trong dòng.
 *   inspection / process-result — body `machineCode` (nếu có) ≠ M.code. (Máy thật của bản ghi vốn đã
 *               theo header key trong `authenticateMachine`; trước bản vá, lời khai lệch bị lặng lẽ
 *               ghi sang máy của khoá — nay nói thẳng 403.)
 */
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import type { Response } from "express";
import { ApiHttpError } from "./envelope";
import type { ApiPrincipal } from "./auth";

export interface MayCuaKhoa {
  id: number;
  code: string;
}

/**
 * Máy mà credential của request thuộc về; `null` = khoá không gắn máy (hành vi cũ, không ràng buộc).
 * Khoá `mk_` HOẶC khoá plaintext trỏ tới máy đã xoá/ngừng ⇒ 401 (cùng kết luận `authenticateMachine`:
 * machineInactiveOrMissing). DB vắng/lỗi ⇒ 503 (không đoán).
 */
export async function mayCuaKhoa(p: ApiPrincipal | undefined): Promise<MayCuaKhoa | null> {
  if (!p || p.machineId == null) return null;
  const { getMachineById, getDb } = await import("../../db");
  let m: { id: number; code: string; isActive?: boolean | null } | undefined;
  let dbVang = false;
  try {
    m = (await getMachineById(p.machineId)) as typeof m;
    // getMachineById trả `undefined` CẢ khi DB vắng — tách hai trường hợp, đừng biến DB sập thành 401.
    if (!m) dbVang = !(await getDb());
  } catch {
    dbVang = true;
  }
  if (dbVang) throw new ApiHttpError(503, "db_unavailable", "Database unavailable — retry.");
  if (!m || m.isActive === false) {
    throw new ApiHttpError(401, "unauthorized", "Invalid API key (its machine is missing or inactive).");
  }
  return { id: m.id, code: m.code };
}

export interface ViPhamRangBuoc {
  index: number;
  field: "machineId" | "deviceId" | "machineCode";
  value: string | number;
}

/** Trần số vi phạm liệt kê trong phản hồi (một lô 20k mẫu sai không được thành 20k dòng JSON). */
const VI_PHAM_TOI_DA = 20;

/** Lỗi 403 ràng buộc — `ApiHttpError` (bề mặt /api/v1) mang `details` để route OT dựng thân riêng. */
function nem403(may: MayCuaKhoa, viPham: ViPhamRangBuoc[]): never {
  throw new ApiHttpError(
    403,
    "machine_mismatch",
    `This key belongs to machine ${may.code}; it cannot write data for another machine. Nothing was stored.`,
    { keyMachine: may.code, violationCount: viPham.length, violations: viPham.slice(0, VI_PHAM_TOI_DA) },
  );
}

/**
 * Telemetry (R16 nghiêm): mọi mẫu phải thuộc máy của khoá — `machineId` (nếu có) === M.id VÀ
 * `deviceId` (nếu có) === M.code. Vi phạm ⇒ ném 403 (cả lô, không ghi dòng nào). Hợp lệ ⇒ trả MẢNG
 * MỚI với `machineId = M.id` trên MỌI mẫu (bus không tự quy máy nữa). Thuần, không I/O.
 */
export function kiemMauTelemetryThuocMay<T extends { machineId?: number | null; deviceId?: string | null }>(
  samples: ReadonlyArray<T>,
  may: MayCuaKhoa,
): T[] {
  const viPham: ViPhamRangBuoc[] = [];
  samples.forEach((s, index) => {
    if (s.machineId != null && s.machineId !== may.id) viPham.push({ index, field: "machineId", value: s.machineId });
    else if (s.deviceId != null && s.deviceId !== may.code) viPham.push({ index, field: "deviceId", value: s.deviceId });
  });
  if (viPham.length > 0) nem403(may, viPham);
  return samples.map((s) => ({ ...s, machineId: may.id }));
}

/** inspection / process-result: `machineCode` khai trong body (nếu có) phải là mã máy của khoá. */
export function kiemMachineCodeThuocMay(body: Record<string, unknown>, may: MayCuaKhoa): void {
  const khai = typeof body.machineCode === "string" ? body.machineCode.trim() : "";
  if (khai && khai !== may.code) nem403(may, [{ index: 0, field: "machineCode", value: khai }]);
}

// ── Mã HTTP đúng nghĩa cho lỗi từ caller tRPC (inspection / process-result) ─────────────────────

/** Giây gợi ý chờ khi 429 — cửa sổ cố định 60 s của `enforceMachineIngestRateLimit` (cận trên). */
export const INGEST_RETRY_AFTER_S = 60;

/** Walk err → err.cause: lỗi DỮ LIỆU vĩnh viễn (Postgres 22xxx/23xxx, ZodError, JSON hỏng). */
function laLoiDuLieu(err: unknown): boolean {
  let cur: unknown = err;
  for (let d = 0; d < 5 && cur; d++) {
    if (cur instanceof ZodError || cur instanceof SyntaxError) return true;
    if (typeof cur !== "object") break;
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "string" && /^(22|23)\d{3}$/.test(c)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export interface IngestLoiHttp {
  status: number;
  code: string;
  message: string;
  retryAfterS?: number;
}

/**
 * Lỗi ném ra từ `machineApi.submitInspection/submitProcessResult` → mã HTTP.
 * Bảng theo mã tRPC chuẩn (TRPCError → HTTP của chính tRPC), trừ ba điểm có chủ ý:
 *   • lỗi dữ liệu (BAD_REQUEST / PARSE_ERROR / UNPROCESSABLE_CONTENT, hoặc 22xxx/23xxx/Zod/JSON ở
 *     `cause`) ⇒ 400 `ingest_failed` (giữ mã chuỗi cũ cho SDK);
 *   • TOO_MANY_REQUESTS ⇒ 429 + Retry-After;
 *   • INTERNAL_SERVER_ERROR và mọi lỗi không phân loại được (DB sập, `DbUnavailableError`, mất kết
 *     nối…) ⇒ 503 — gửi lại được; cùng ranh giới "tạm thời" mà WAL process/inspection đã dùng.
 */
export function ingestLoiHttp(err: unknown): IngestLoiHttp {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof TRPCError
      ? err.code
      : err && typeof err === "object" && (err as { name?: unknown }).name === "TRPCError"
        ? String((err as { code?: unknown }).code)
        : null;
  switch (code) {
    case "BAD_REQUEST":
    case "PARSE_ERROR":
    case "UNPROCESSABLE_CONTENT":
      return { status: 400, code: "ingest_failed", message };
    case "UNAUTHORIZED":
      return { status: 401, code: "unauthorized", message };
    case "FORBIDDEN":
      return { status: 403, code: "forbidden", message };
    case "NOT_FOUND":
      return { status: 404, code: "not_found", message };
    case "CONFLICT":
      return { status: 409, code: "conflict", message };
    case "PRECONDITION_FAILED":
      return { status: 412, code: "precondition_failed", message };
    case "PAYLOAD_TOO_LARGE":
      return { status: 413, code: "payload_too_large", message };
    case "TOO_MANY_REQUESTS":
      return { status: 429, code: "rate_limited", message, retryAfterS: INGEST_RETRY_AFTER_S };
    // Fix round 1 — ba mã KHÔNG tạm thời: gửi lại y nguyên không bao giờ thành công, nên không được
    // rơi xuống 503 (thiết bị sẽ thử lại mãi). Mã HTTP theo đúng bảng của tRPC.
    case "METHOD_NOT_SUPPORTED":
      return { status: 405, code: "method_not_supported", message };
    case "CLIENT_CLOSED_REQUEST":
      return { status: 499, code: "client_closed_request", message };
    case "NOT_IMPLEMENTED":
      return { status: 501, code: "not_implemented", message };
    default:
      if (laLoiDuLieu(err)) return { status: 400, code: "ingest_failed", message };
      return { status: 503, code: "ingest_unavailable", message: "Ingest temporarily unavailable — retry." };
  }
}

/** Log 503 GỘP: tối đa một dòng mỗi 10 s, kèm số lượt đã nén (DB sập ⇒ mọi thiết bị cùng lỗi). */
const LOG_503_MOI_MS = 10_000;
let log503Luc = 0;
let log503Nen = 0;
function log503(err: unknown): void {
  const now = Date.now();
  if (now - log503Luc < LOG_503_MOI_MS) {
    log503Nen++;
    return;
  }
  const nen = log503Nen;
  log503Luc = now;
  log503Nen = 0;
  // Không in payload/khoá — chỉ thông điệp gốc, để vận hành thấy vì sao 503.
  console.error(
    `[api/v1 ingest] transient failure → 503${nen > 0 ? ` (+${nen} lượt tương tự đã gộp)` : ""}:`,
    err instanceof Error ? err.message : String(err),
  );
}

/** Ném `ApiHttpError` theo `ingestLoiHttp` (đặt Retry-After khi 429). */
export function nemLoiIngest(res: Response, err: unknown): never {
  if (err instanceof ApiHttpError) throw err;
  const m = ingestLoiHttp(err);
  if (m.retryAfterS != null) res.setHeader("Retry-After", String(m.retryAfterS));
  if (m.status >= 500) log503(err);
  throw new ApiHttpError(m.status, m.code, m.message);
}
