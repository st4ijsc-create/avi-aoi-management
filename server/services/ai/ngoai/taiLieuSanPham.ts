/**
 * ★ Đợt 10.4b — bộ lọc DUY NHẤT "tài liệu SẢN PHẨM được gửi cho model ngoài" (chuyển nguyên từ `routes/kbNgoai.ts` của L1 ở L3c để L1 và
 * `search_docs` của agent ngoài dùng ĐÚNG MỘT bộ — dieu-phoi 03/11: "không bản sao thứ hai").
 *
 * Hai khoá cùng phải qua: (1) `sourceType` thuộc loại tài liệu KỸ THUẬT chung; (2) `sourcePath` nằm dưới một thư mục tài liệu sản phẩm đã
 * biết (`sourceType` có thể do bên ghi vào kho khai — `ingestKnowledgeRecord`). (L3c) khoá (3): đường KHÔNG thuộc tài liệu nội bộ —
 * `docs/superpowers` (kế hoạch / đặc tả / kiểm toán), `.superpowers`, `.claude`, bộ nhớ, `.env*`, kế hoạch / lộ trình — kể cả khi hai khoá
 * đầu cho qua (áp cho CẢ L1).
 */

/** loại nguồn (`sourceType` của kho KB) ⇒ loại kho cho `ghepPhan` — CHỈ tài liệu kỹ thuật chung của sản phẩm được gửi ra ngoài. */
export const LOAI_KHO_THEO_NGUON: Readonly<Record<string, "api">> = Object.freeze({
  doc: "api",
  service: "api",
  type: "api",
  domain: "api",
  router: "api",
  feature: "api",
  schema_table: "api",
  route: "api",
  module: "api",
  nav: "api",
  pattern: "api",
});

/**
 * ★ rà kiem-dinh L1 (4) — khoá THỨ HAI: chunk phải nằm dưới một thư mục TÀI LIỆU SẢN PHẨM đã biết (đo trên knowledge/chunks.jsonl
 * 2026-10-30). `ingest/…`, `knowledge/operational*`, studio, mọi đường khác ⇒ BỎ.
 */
export const TIEN_TO_TAI_LIEU_SAN_PHAM: readonly string[] = [
  "docs/",
  "apidocs/",
  "server/",
  "client/src/",
  "drizzle/schema/",
  "shared/",
  "knowledge/domain/",
  "knowledge/features/",
];

/** (L3c, dieu-phoi 03/11) đoạn đường của tài liệu NỘI BỘ — có mặt ở BẤT KỲ cấp nào ⇒ bỏ. */
export const DOAN_NOI_BO: ReadonlySet<string> = new Set(["superpowers", ".superpowers", ".claude", "memory", "plans", "specs", "audits"]);
/** (L3c) tên tệp `.env*` ở mọi nơi. */
export const KHUON_TEN_NOI_BO: readonly RegExp[] = [/^\.env/i];
/** (L3c) tài liệu KẾ HOẠCH / LỘ TRÌNH nội bộ dưới `docs/` (`AI_UPGRADE_PLAN.md`, `UpgradePlan.md`, `…_ROADMAP.md`; "plan" KHÔNG theo sau chữ cái — `PLANNING_NOTES.md` qua) — chỉ xét dưới `docs/` (mã `planner.ts` không dính). */
export const KHUON_TEN_KE_HOACH_DOCS: readonly RegExp[] = [/plan(?![a-z])/i, /roadmap/i];

export function laTaiLieuSanPham(t: { sourceType: string; sourcePath?: string | null }): boolean {
  const p = String(t.sourcePath ?? "").replace(/\\/g, "/");
  if (!(t.sourceType in LOAI_KHO_THEO_NGUON) || p.includes("..")) return false;
  if (!TIEN_TO_TAI_LIEU_SAN_PHAM.some((tt) => p.startsWith(tt))) return false;
  const doan = p.split("/").filter(Boolean).map((d) => d.toLowerCase());
  if (doan.some((d) => DOAN_NOI_BO.has(d))) return false;
  const ten = doan[doan.length - 1] ?? "";
  if (KHUON_TEN_NOI_BO.some((k) => k.test(ten))) return false;
  return !(doan[0] === "docs" && KHUON_TEN_KE_HOACH_DOCS.some((k) => k.test(ten)));
}
