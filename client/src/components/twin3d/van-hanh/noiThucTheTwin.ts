/**
 * `noiThucTheTwin.ts` — **NƠI** một chuyền / một máy thật sự nằm trong bố cục
 * Twin 3D: nhà máy nào, toà nào, tầng nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — PH-12 (QA lần 11, 2026-09-15)
 * ════════════════════════════════════════════════════════════════════════════
 * Màn Line (`/twin/line/:id`) và màn Máy (`/twin/may/:id`) nhận MỘT id trên URL
 * và phải tự suy ra "hỏi dữ liệu của nhà máy nào, toà nào". Bản trước làm việc
 * ấy bằng hai phép lấy phần tử đầu:
 *
 *     const factoryId = factories[0]?.id ?? null;          // TwinLine:355 · TwinMay:284
 *     const toaNhaDau = (toaNhaQ.data ?? [])[0] ?? null;    // TwinLine:375 · TwinMay:299
 *
 * Thứ tự hai danh sách ấy do SERVER quyết định — `hierarchy.ts:340`
 * `orderBy(factories.name)` và `twinCanh.ts:260` `orderBy(asc(twinToaNha.ma))`.
 * Tức trang hỏi dữ liệu của **nhà máy đứng đầu theo TÊN** và **toà đứng đầu
 * theo MÃ**, bất kể chuyền/máy trên URL nằm ở đâu. Hai triệu chứng đo được
 * (`.qa-tapdoan/BANG-C.md`, 17 ca):
 *
 *   · SAI NHÀ MÁY  ⇒ "Máy 0 · Trạm 0", hoặc màn Máy nói *"không thuộc phạm vi
 *     đang xem"* cho một máy mà **API cho phép** (admin và giám đốc bị chối
 *     đúng cái máy mà công nhân — quyền hẹp nhất — mở được).
 *   · SAI TOÀ      ⇒ tiêu đề đúng số mà **cảnh 3D trống** (chuyền 299: "Máy 10 ·
 *     Trạm 10" nhưng 0 khối), và *"máy chưa có chỗ trên bố cục 3D"* trong khi
 *     CSDL **có** hàng `twin_dat_cho`.
 *
 * Bán kính: 77,4–93,1 % chuyền không vẽ đủ tuỳ vai (`.qa-tapdoan/pham-vi-hong.mjs`).
 *
 * ⚠ VÌ SAO 10 ĐỢT QA TRƯỚC KHÔNG THẤY — và vì sao đó là một bài học chứ không
 *   phải một sơ suất: docblock cũ ngay trên dòng ấy TỰ KHAI giới hạn, viện lý do
 *   *"đo 2026-09-09: 2 nhà máy, toàn bộ 82 hàng `twin_dat_cho` nằm ở MỘT tầng"*.
 *   Tiền đề ấy ĐÚNG lúc viết và **hết hạn** khi CSDL có 3 công ty · 12 toà ·
 *   2.338 hàng đặt chỗ. Đúng lớp G148: *lý do hoãn có HẠN SỬ DỤNG*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐƯỜNG SUY — VÀ VÌ SAO NÓ ĐÚNG
 * ════════════════════════════════════════════════════════════════════════════
 * Id đúng KHÔNG suy được ở client: `machines` không có cột `factoryId`, và
 * `twin_tang`/`twin_toa_nha` chỉ nối được với chuyền/máy QUA hàng đặt chỗ. Nên
 * server trả lời (`twinCanh.noiCuaThucThe` → `traNoiCuaThucThe`), theo hai chuỗi
 * CÓ THẬT trong lược đồ:
 *
 *   nhà máy: `machines.stationId → stations.lineId → production_lines.workshopId
 *             → workshops.factoryId`          (chuyền thì bắt đầu từ mắt thứ ba)
 *   toà/tầng: `twin_dat_cho.tangId → twin_tang.toaNhaId → twin_toa_nha.factoryId`
 *
 * ⚠ `workshops` **KHÔNG có cột `tangId`** (đo trên `drizzle/schema/hierarchy.ts`
 *   2026-09-15) — nên không có đường "xưởng → tầng"; hàng đặt chỗ là nguồn DUY
 *   NHẤT nói một thực thể đứng ở tầng nào. Ghi ra đây vì gợi ý ban đầu của brief
 *   nêu đường ấy, và một đường JOIN không tồn tại thì không lỗi biên dịch nào nổ.
 *
 * ★ Ba hàm dưới đây THUẦN (không react, không trpc, không `window`) để canh được
 *   bằng `vitest` ở `environment: "node"` — cùng lý do đã ghi ở `duongDanTwin.ts`.
 *   `chonNoiTheoDatCho` được **server import lại** (`server/db/twinCanh.ts`),
 *   đúng tiền lệ `sinhBoCuc` mà `twinCanhRouter.ts:110` đang dùng: một luật, một
 *   chỗ, một bộ test (G12).
 */

/** Nơi một thực thể nằm trong bố cục Twin. Hợp đồng của `twinCanh.noiCuaThucThe`. */
export interface NoiThucThe {
  /** Nhà máy suy từ CHUỖI PHÂN CẤP của chính thực thể. Luôn có (nếu không có ⇒ thủ tục trả NOT_FOUND). */
  factoryId: number;
  /**
   * Toà nhà chứa hàng đặt chỗ của thực thể.
   * `null` = thực thể CÓ THẬT và trong phạm vi nhưng **chưa được xếp chỗ** trên bố cục 3D.
   */
  toaNhaId: number | null;
  /** Tầng của hàng đặt chỗ. `null` cùng lúc với `toaNhaId`. */
  tangId: number | null;
}

/** Một hàng đặt chỗ đã quy về hai khoá hình học cần cho phép chọn. */
export interface HangDatChoNoi {
  tangId: number;
  toaNhaId: number;
}

/**
 * Nhà máy để hỏi dữ liệu — của CHÍNH chuyền/máy đang mở.
 *
 * ⚠⚠⚠ `null` khi server không trả lời được (ngoài phạm vi ⇒ `NOT_FOUND`, hoặc
 *   chưa hỏi xong). **KHÔNG được rơi về một nhà máy mặc định ở đây.** Một giá trị
 *   "đỡ" chỗ này biến câu trả lời *"tôi không thấy thực thể ấy"* của hàng rào
 *   tenant thành *"thì lấy tạm nhà máy khác"* — tức phá đúng thứ hàng rào đang
 *   giữ. `null` chảy xuống làm mọi truy vấn nền TẮT, và màn NÓI RA lý do (L-5).
 */
export function nhaMayDangXem(noi: NoiThucThe | null | undefined): number | null {
  return noi?.factoryId ?? null;
}

/**
 * Toà nhà CHỨA chuyền/máy, chọn trong danh sách toà của nhà máy ấy.
 *
 * Trả `null` ở BA ca khác nhau, và cả ba đều KHÔNG được rơi về `danhSach[0]`:
 *   ① `noi == null`          — ngoài phạm vi / chưa hỏi xong (xem cảnh báo ở `nhaMayDangXem`);
 *   ② `noi.toaNhaId == null` — thực thể chưa xếp chỗ; màn nói *"chưa có chỗ trên bố cục"* và
 *                              câu ấy khi đó ĐÚNG. Vẽ nó giữa hàng xóm của một toà khác còn tệ hơn;
 *   ③ toà không có trong danh sách — đã xoá mềm, hoặc rơi ra ngoài phạm vi giữa hai lượt hỏi.
 *
 * ⚠ Hàm trả về CHÍNH phần tử của danh sách (không phải một id) vì tầng gọi đọc
 *   tiếp `rongMm`/`sauMm` của nó để dựng sàn — lấy id rồi tra lại là hai nguồn
 *   sự thật cho một thứ.
 */
export function toaNhaDangXem<T extends { id: number } = { id: number }>(
  danhSach: readonly T[] | undefined | null,
  noi: NoiThucThe | null | undefined,
): T | null {
  const toaNhaId = noi?.toaNhaId ?? null;
  if (toaNhaId === null) return null;
  return (danhSach ?? []).find((t) => t.id === toaNhaId) ?? null;
}

/**
 * Toà/tầng của một thực thể, suy từ CÁC HÀNG ĐẶT CHỖ CÓ THẬT của nó.
 *
 * Một chuyền có nhiều hàng (chính nó + trạm + máy), và chúng KHÔNG bảo đảm cùng
 * một toà: một trạm cũ chưa dọn, một lần xếp chỗ nhầm tầng, hay một chuyền thật
 * sự trải hai tầng đều cho ra tập nhiều toà. Lấy **hàng đầu tiên** ở đây là để
 * thứ tự CSDL trả quyết định cảnh vẽ ở đâu — tức đúng lớp lỗi `[0]` mà module
 * này sinh ra để vá, chỉ đổi chỗ. Nên: **toà giữ ĐA SỐ hàng thắng**; trong toà
 * ấy, **tầng giữ đa số** thắng.
 *
 * ⚠ Hoà phiếu phá bằng `id` NHỎ NHẤT, không phải "hàng gặp trước": phép chọn
 *   phải TẤT ĐỊNH với mọi thứ tự CSDL trả về, nếu không cùng một chuyền sẽ vẽ
 *   khác nhau giữa hai lần tải mà không gì nổ.
 *
 * @returns `null` khi KHÔNG có hàng đặt chỗ nào — "chưa xếp chỗ", một sự thật
 *          khác hẳn "xếp ở toà đầu".
 */
export function chonNoiTheoDatCho(
  hang: readonly HangDatChoNoi[],
): { toaNhaId: number; tangId: number } | null {
  if (hang.length === 0) return null;

  const demToa = new Map<number, number>();
  for (const h of hang) demToa.set(h.toaNhaId, (demToa.get(h.toaNhaId) ?? 0) + 1);
  const toaNhaId = chonNhieuNhat(demToa);
  if (toaNhaId === null) return null;

  const demTang = new Map<number, number>();
  for (const h of hang) {
    if (h.toaNhaId !== toaNhaId) continue;
    demTang.set(h.tangId, (demTang.get(h.tangId) ?? 0) + 1);
  }
  const tangId = chonNhieuNhat(demTang);
  return tangId === null ? null : { toaNhaId, tangId };
}

/** Khoá có SỐ ĐẾM lớn nhất; hoà ⇒ khoá nhỏ nhất (tất định). */
function chonNhieuNhat(dem: ReadonlyMap<number, number>): number | null {
  let khoa: number | null = null;
  let cao = -1;
  for (const [k, n] of dem) {
    if (n > cao || (n === cao && khoa !== null && k < khoa)) {
      khoa = k;
      cao = n;
    }
  }
  return khoa;
}
