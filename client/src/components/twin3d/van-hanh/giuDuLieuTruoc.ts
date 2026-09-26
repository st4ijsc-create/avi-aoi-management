/**
 * giuDuLieuTruoc.ts — GIỮ dữ liệu của lượt hỏi trước khi CHÍNH truy vấn ấy đổi khoá (tangIds `[]` → thật),
 * để hàng máy / ô trạm không REMOUNT giữa hai pha.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 40 (QA Đợt 39 Pareto #5) — ĐO ĐƯỢC, KHÔNG PHỎNG ĐOÁN
 * ════════════════════════════════════════════════════════════════════════════
 * `.qa-dot39/cua-so-som/*.json` (lấy mẫu 250 ms từ lúc mở màn): ô trạm Line `o-tram-14` xuất hiện @1113 ms,
 * BIẾN MẤT @1271, xuất hiện lại @1540 (6/12 lần; hàng `may-hang-14` ở `/twin` cùng hình dạng). Cơ chế: cả ba
 * trang hỏi `twinCanh.canhThietKe` HAI LƯỢT — lượt 1 với `tangIds: []` (chưa biết tầng), lượt 2 với tầng thật
 * sau khi `chiTietToaNha` về. Đổi `tangIds` = đổi KHOÁ truy vấn ⇒ react-query coi là truy vấn MỚI ⇒ `data`
 * `undefined` cho tới khi lượt 2 về ⇒ `tram`/`may` rỗng một nhịp ⇒ DOM gỡ rồi dựng lại (~250 ms).
 *
 * ★ `placeholderData` giữ `data` của lượt trước trong lúc lượt sau chạy — **CHỈ khi cùng nhà máy**. Giữ dữ liệu
 *   nhà máy A trong lúc đang hỏi nhà máy B là in máy của A dưới tên B ~300 ms: một lời khai sai, dù ngắn.
 *   Khoá tRPC v11: `[["twinCanh","canhThietKe"], { input: { factoryId, tangIds }, type: "query" }]` — đọc
 *   `input.factoryId` của truy vấn trước từ `previousQuery.queryKey`, không suy từ chỗ khác.
 * ★ `isPlaceholderData` = true trong pha 2: ai cần "đã có bố cục thật chưa" phải hỏi `!canhQ.isFetching`
 *   (màn Máy đã làm thế cho `chuaDatCho` từ Đợt 34) — không hỏi `isSuccess`.
 */

/** Hình dạng tối thiểu của `previousQuery` mà hàm này đọc — không kéo theo kiểu react-query đầy đủ. */
export interface TruyVanTruoc {
  queryKey?: readonly unknown[];
}

/** Đọc `input.factoryId` từ khoá truy vấn tRPC; `null` khi không đọc được (⇒ KHÔNG giữ). */
export function factoryIdCuaKhoa(queryKey: readonly unknown[] | undefined): number | null {
  const phan = queryKey?.[1];
  if (!phan || typeof phan !== "object") return null;
  const input = (phan as { input?: unknown }).input;
  if (!input || typeof input !== "object") return null;
  const id = (input as { factoryId?: unknown }).factoryId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

/**
 * `placeholderData` cho `canhThietKe`: trả dữ liệu lượt trước NẾU lượt trước hỏi CÙNG `factoryId`; ngược lại
 * `undefined` (react-query ⇒ không placeholder ⇒ hành vi cũ).
 */
export function giuKhiCungNhaMay<T>(factoryId: number | null) {
  return (truoc: T | undefined, truyVanTruoc?: TruyVanTruoc): T | undefined => {
    if (truoc === undefined || factoryId === null) return undefined;
    return factoryIdCuaKhoa(truyVanTruoc?.queryKey) === factoryId ? truoc : undefined;
  };
}
