/**
 * Doc 80 Đợt 1 Task 6 (XC-01) — tRPC links của app: query có input LỚN đi POST.
 *
 * Vì sao: `httpBatchLink` mặc định gửi query bằng GET, input nằm trong URL (JSON đã
 * URL-encode, phình ~1,5–3×). Server Node trả **HTTP 431** khi phần header vượt ~16 KB — đo
 * trước task: 431 ở 30 block IR (lint + preview cùng batch), 20 rung POU, XML PLCopen 12 KB.
 * Khi đó lint IR hiện "không đọc được" và Save/Build bị khoá cho mọi flow thật.
 *
 * Cách sửa (tRPC v11): `splitLink` theo kích thước input ĐÃ serialize (superjson → JSON →
 * byte UTF-8):
 *   - query > 2 KB ⇒ `httpBatchLink` với `methodOverride: "POST"` (input đi trong body; server
 *     bật `allowMethodOverride` — `server/_core/trpcAdapter.ts`);
 *   - còn lại (query nhỏ, mọi mutation) ⇒ `httpBatchLink` GET như cũ. Nhánh GET thêm
 *     `maxURLLength` để một tick có NHIỀU query sát ngưỡng tự tách thành nhiều request
 *     thay vì dồn thành một URL > trần (một query đơn ≤ 2 KB ⇒ URL ≤ ~6,2 KB nên luôn vừa).
 *
 * Query vẫn là query ở cả hai phía (react-query cache, tRPC `type`), chỉ phương thức HTTP đổi.
 *
 * doc 81 Đợt 5 H fix 1 (review M1, R-5-m #3) — mọi thủ tục `license.*` đi một request RIÊNG (`httpLink`, không batch): cổng
 * giấy phép của client (`license.systemState` → `license.getAllowedModules`, RouteGuard) không còn chờ thủ tục CHẬM NHẤT
 * của batch (httpBatchLink không-stream trả cả batch một lần — `commandCenter.hierarchy` đo 113 s cho admin trên `_test`).
 */
import { httpBatchLink, httpLink, splitLink, type TRPCLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import { TRPC_MAX_BATCH_SIZE } from "../../../shared/trpcBatch";

/** Input query serialize lớn hơn ngưỡng này (byte) ⇒ gửi POST. */
export const TRPC_POST_INPUT_THRESHOLD_BYTES = 2048;

/**
 * Trần độ dài URL cho batch GET (path + query). 8000 < 8 KB bộ đệm dòng request mặc định
 * của nginx và < ~16 KB tổng header của Node; một query đơn ≤ 2 KB mã hoá tối đa 3×.
 */
export const TRPC_MAX_GET_URL_LENGTH = 8000;

/** Số byte UTF-8 của input sau `superjson.serialize` + `JSON.stringify` (đúng thứ link gửi đi). */
export function serializedInputBytes(input: unknown): number {
  if (input === undefined) return 0;
  return new TextEncoder().encode(JSON.stringify(superjson.serialize(input))).length;
}

/** `license.*` — cổng giấy phép, không bao giờ chung batch với thủ tục khác. */
export function isLicenseOp(op: { path: string }): boolean {
  return op.path.startsWith("license.");
}

/**
 * STOP routes sent ALONE (never batched), for two DIFFERENT server-side reasons:
 *  - `robot.consoleStop` — doc 81 Đợt 10 D fix review 6 (NF5-8, R-10-bb): the server's bounded STOP-only auth (context.ts
 *    `isStopOnlyCall` + robotStopAuth, 300 ms) applies only to a request made of that route alone; in a mixed batch it would be
 *    authenticated the normal, unbounded way and wait behind a slow DB.
 *  - `scadaCommands.dungMay` — SCADA R1b-1 T2 fix round 1: ONLY so the server counts it in the dedicated HMI STOP tier instead of the
 *    general /api bucket (a non-batched `POST /api/trpc/scadaCommands.dungMay` carrying a validly signed session — rateLimitConfig
 *    `laStopHmiCoPhienKy`; R1b-2a T3: that tier is a wide cap per session of a person, `TRAN_STOP_HMI_MOI_PHUT` = 600 / min, never
 *    reached by hand).
 *    R1b-2a T4 (M-1): sent alone it ALSO gets the server's bounded HMI STOP auth (context.ts `laGoiChiDungMay`, full authentication under
 *    `HAN_XAC_THUC_STOP_HMI_MS` = 1.5 s) and the real pre-dispatch deadline (lenhHmi `HAN_TRUOC_GUI_STOP_HMI_MS` = 2 s, dispatch outside it):
 *    a slow-but-alive DB ⇒ a coded refusal `SCADA_STOP_PRECHECK_TIMEOUT` ("dùng E-STOP cứng") within ~2.5 s, never an unbounded wait. The
 *    client's 10 s "kết quả chưa rõ" fallback stays for a dead network. In a mixed batch neither bound applies.
 *    Its 429s (STOP tier plain JSON, or the general limiter's body) are turned into a tRPC error with `httpStatus 429` by
 *    `fetchDungMay429` below, so the client keys its E-STOP banner on the STATUS whatever the body is.
 */
export function isStopOnlyOp(op: { path: string }): boolean {
  return op.path === "robot.consoleStop" || op.path === "scadaCommands.dungMay";
}

/** R1b-2a T4 (ruling T3 c3) — path tRPC của STOP HMI. */
export const DUONG_DUNG_MAY = "scadaCommands.dungMay";
/** Mã JSON-RPC của tRPC cho TOO_MANY_REQUESTS (`TRPC_ERROR_CODES_BY_KEY.TOO_MANY_REQUESTS`). */
export const TRPC_MA_TOO_MANY_REQUESTS = -32029;
const THONG_BAO_429_DUNG_MAY = "Too many STOP requests — use the hard E-STOP";

/** URL của một yêu cầu httpLink (KHÔNG batch) tới `scadaCommands.dungMay`. */
export function laUrlDungMay(input: RequestInfo | URL): boolean {
  const s = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return decodeURIComponent(new URL(s, "http://x").pathname).endsWith(`/${DUONG_DUNG_MAY}`);
  } catch {
    return false;
  }
}

/**
 * R1b-2a T4 (ruling T3 c3) — một 429 KHÔNG phải lỗi tRPC trên dungMay (tầng STOP: `{"error":"Too many STOP requests — use the hard E-STOP"}`;
 * `apiLimiter`: thân khác; proxy: có thể không phải JSON) ⇒ thân lỗi tRPC + superjson `{code TOO_MANY_REQUESTS, httpStatus 429}`.
 * Không đổi thì httpLink ra `TRPCClientError("Unable to transform response from server")` không có `data` (thân JSON lạ — còn
 * `meta.response.status`) hoặc mất luôn `meta` (thân không phải JSON — `res.json()` ném trước khi gắn meta) ⇒ client không còn biết là 429.
 * Thân đã là lỗi tRPC (`{error: {json: …}}`) ⇒ giữ nguyên (giữ appCode của nó).
 */
export async function doi429DungMayThanhLoiTrpc(res: Response): Promise<Response> {
  let thongBao = THONG_BAO_429_DUNG_MAY;
  try {
    const j = (await res.clone().json()) as { error?: unknown; message?: unknown } | null;
    if (j && typeof j.error === "object" && j.error !== null) return res;
    if (typeof j?.error === "string" && j.error.trim()) thongBao = j.error;
    else if (typeof j?.message === "string" && j.message.trim()) thongBao = j.message;
  } catch {
    /* thân không phải JSON (proxy) — dùng câu mặc định */
  }
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json");
  const shape = { message: thongBao, code: TRPC_MA_TOO_MANY_REQUESTS, data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, path: DUONG_DUNG_MAY } };
  return new Response(JSON.stringify({ error: superjson.serialize(shape) }), { status: 429, statusText: res.statusText, headers });
}

/** fetch của nhánh không-batch: 429 trên dungMay ⇒ lỗi tRPC `httpStatus 429` (mọi đường khác đi nguyên). */
export function fetchDungMay429(goc?: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await (goc ?? globalThis.fetch)(input, init);
    return res.status === 429 && laUrlDungMay(input) ? doi429DungMayThanhLoiTrpc(res) : res;
  }) as typeof fetch;
}

/** Chỉ QUERY có input > ngưỡng mới đi nhánh POST; mutation vốn đã POST, subscription không đổi. */
export function shouldSendAsPost(op: { type: string; input: unknown }): boolean {
  if (op.type !== "query") return false;
  return serializedInputBytes(op.input) > TRPC_POST_INPUT_THRESHOLD_BYTES;
}

export function createAppTrpcLinks(opts: {
  url: string;
  headers?: () => Record<string, string>;
  fetch?: typeof fetch;
}): TRPCLink<AppRouter>[] {
  // `maxItems` = trần server (shared/trpcBatch.ts): client TỰ CHIA batch lớn thành nhiều yêu cầu ≤ trần, không bao giờ bị server từ chối.
  const common = { url: opts.url, transformer: superjson, headers: opts.headers, fetch: opts.fetch, maxItems: TRPC_MAX_BATCH_SIZE };
  return [
    splitLink<AppRouter>({
      condition: (op) => isLicenseOp(op) || isStopOnlyOp(op),
      true: httpLink<AppRouter>({ ...common, fetch: fetchDungMay429(opts.fetch) }),
      false: splitLink<AppRouter>({
        condition: (op) => shouldSendAsPost(op),
        true: httpBatchLink<AppRouter>({ ...common, methodOverride: "POST" }),
        false: httpBatchLink<AppRouter>({ ...common, maxURLLength: TRPC_MAX_GET_URL_LENGTH }),
      }),
    }),
  ];
}
