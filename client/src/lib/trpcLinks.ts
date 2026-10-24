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
 * doc 81 Đợt 10 D fix review 6 (NF5-8, R-10-bb) — the STOP-only route is sent ALONE (never batched): a batch mixing it with any
 * other call is authenticated the normal, unbounded way, so a STOP would wait behind a slow DB.
 */
export function isStopOnlyOp(op: { path: string }): boolean {
  return op.path === "robot.consoleStop";
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
      true: httpLink<AppRouter>({ ...common }),
      false: splitLink<AppRouter>({
        condition: (op) => shouldSendAsPost(op),
        true: httpBatchLink<AppRouter>({ ...common, methodOverride: "POST" }),
        false: httpBatchLink<AppRouter>({ ...common, maxURLLength: TRPC_MAX_GET_URL_LENGTH }),
      }),
    }),
  ];
}
