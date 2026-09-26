/**
 * Bóc vỏ đáp ứng tRPC. Máy chủ dùng superjson: dữ liệu thật ở `result.data.json`. Đáp ứng lỗi trả
 * `null` để lớp trên KHÔNG hiển thị danh sách rỗng như thể "không có gì" trong khi thật ra hỏng.
 */
export function boBoiSuperjson(dap: unknown): unknown {
  if (!dap || typeof dap !== "object") return null;
  const o = dap as Record<string, unknown>;
  if (o.error) return null;
  const kq = o.result as Record<string, unknown> | undefined;
  if (!kq || typeof kq !== "object") return null;
  const du = kq.data as Record<string, unknown> | undefined;
  if (!du || typeof du !== "object") return null;
  return "json" in du ? du.json : du;
}
