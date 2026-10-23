/**
 * SCADA R0 Task 7 (fix bao mat) - KHOA META DANH RIENG.
 *
 * `adapterId`, `tagKey`, `statusCode`, `reason`, `tsSource` do CHINH duong OT trong tien trinh dat vao `meta`
 * (`ingest.ts sampleToCanonical`). Duong ingest NGOAI (POST /api/ot/ingest, /api/v1, cau MQTT) cho nguoi goi da xac thuc
 * gui `meta` tuy y => phai go cac khoa nay truoc khi vao bus de nguoi goi khong gia danh dau OT trong tien trinh.
 * (Bo dem gia tri hien tai khong con tin meta; day la phong thu theo chieu sau cho moi nguoi doc meta sau nay.)
 */
export const KHOA_META_DANH_RIENG = ["adapterId", "tagKey", "statusCode", "reason", "tsSource"] as const;

/** `meta` khong phai object (hoac mang) => null; nguoc lai ban sao khong con khoa danh rieng. */
export function boKhoaMetaDanhRieng(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
  for (const k of KHOA_META_DANH_RIENG) delete out[k];
  return out;
}
