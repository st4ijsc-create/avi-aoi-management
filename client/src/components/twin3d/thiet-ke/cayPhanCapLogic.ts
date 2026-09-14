/**
 * cayPhanCapLogic.ts — MÔ HÌNH THUẦN cho `CayPhanCap.tsx` (§11 #8/#9/#10/#11/#15).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — VÀ VÌ SAO NÓ THUẦN
 * ════════════════════════════════════════════════════════════════════════════
 * `CayPhanCap.tsx` là `.tsx`, không nằm trong `include` của `vitest.config.ts`
 * cho môi trường node. Bốn tính năng của Đợt 8 (roll-up đếm, lọc + highlight,
 * lọc-chỉ-cảnh-báo + auto-expand, bàn phím WAI-ARIA) đều là **biến đổi dữ liệu
 * thuần** — chôn chúng trong component nghĩa là chúng KHÔNG ĐO ĐƯỢC, đúng lớp
 * lỗi §1.6 mà cả spec này được viết để chặn.
 *
 * Đặc biệt là **bàn phím**. Bản năng đầu tiên là viết `onKeyDown` thẳng trong
 * component và coi nó "không test được vì cần DOM". Nhưng cái đáng đo của một
 * cây WAI-ARIA không phải sự kiện DOM — mà là **hàm quyết định**: *"đang ở node
 * X, bấm phím K, thì con trỏ đi đâu và cây mở/đóng gì?"*. Đó là hàm thuần trên
 * một danh sách phẳng. Nên {@link phimCay} sống ở đây, có test node đầy đủ, còn
 * component chỉ còn việc **nối** nó vào `onKeyDown` — và việc NỐI được đo riêng
 * bằng `CayPhanCap.dom.test.tsx` (jsdom, render component THẬT).
 *
 * ⇒ Hai phép đo tách rời nhau đúng theo G20: test thuần đo *luật đúng không*,
 *   test DOM đo *luật có được gọi không*. Thiếu vế nào cũng là "cổng xanh mà
 *   không đo gì" — G16 đã bắt được đúng ca đó với `locBadge.ts` (18 test xanh,
 *   0 chỗ gọi).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CÂY PHẲNG LÀ TRUNG TÂM CỦA CẢ MODULE
 * ════════════════════════════════════════════════════════════════════════════
 * Bàn phím của một cây điều hướng theo **thứ tự thị giác**: ↓ từ một node ĐANG
 * MỞ đi vào con đầu của nó, còn từ một node ĐANG ĐÓNG thì nhảy qua toàn bộ cây
 * con sang anh em kế tiếp. Viết luật đó bằng đệ quy trên cây lồng là chỗ sinh
 * lỗi off-by-one kinh điển.
 *
 * Cách làm ở đây: {@link duyetPhang} dựng đúng **một** danh sách các hàng ĐANG
 * NHÌN THẤY, theo đúng thứ tự chúng xuất hiện trên màn. Sau đó ↑/↓ chỉ còn là
 * `chiSo ± 1` — không thể sai. Và vì component cũng vẽ từ CHÍNH danh sách đó,
 * thứ tự bàn phím **không thể trôi khỏi** thứ tự thị giác: chúng là một.
 *
 * ⚠ Đây là điều kiện đúng đắn thật sự, không phải tiện tay: nếu component vẽ
 *   bằng đệ quy riêng còn bàn phím đi trên danh sách riêng thì hai bản cài đặt
 *   sẽ trôi khỏi nhau (G12 — "hai bản cài đặt hiếm khi chỉ lệch một chỗ"), và
 *   triệu chứng là focus nhảy sang hàng người dùng không nhìn thấy.
 *
 * ĐƠN VỊ / KIỂU: module này KHÔNG biết gì về react, three, DOM hay i18n.
 */

import type { CayThietKe, KhoaNode, NodeCay } from "./trangThaiThietKe";

// ---------------------------------------------------------------------------
// #8 — Roll-up đếm cảnh báo
// ---------------------------------------------------------------------------

/**
 * Bản đồ `KhoaNode → số cảnh báo ĐANG MỞ` sau khi đã cộng dồn con lên cha.
 *
 * ★ Vì sao là `Map` chứ không phải trường trên `NodeCay`: `dungCayThietKe` là
 *   nguồn của cây và nó KHÔNG biết gì về cảnh báo (đúng — nó là mô hình bố cục).
 *   Nhồi `soCanhBao` vào `NodeCay` buộc mọi nơi dựng cây phải cấp dữ liệu alarm,
 *   kể cả màn Thiết kế lúc chưa tải alarm. Bản đồ rời giữ hai mối quan tâm rời.
 */
export type DemCanhBao = ReadonlyMap<KhoaNode, number>;

/**
 * Cộng dồn số cảnh báo từ lá lên gốc (#8 "roll-up đếm").
 *
 * ★★★ HAI ĐẠI LƯỢNG KHÁC NHAU, VÀ ĐÂY LÀ CHỖ DỄ LẪN NHẤT (G7):
 *   · `soTrucTiep` — cảnh báo gắn TRỰC TIẾP vào node đó
 *   · giá trị trả về — cảnh báo của node đó **CỘNG toàn bộ cây con**
 * Một cha có 0 cảnh báo trực tiếp nhưng 3 máy con đang đỏ phải hiện **3**, không
 * phải 0. Nếu hiện 0 thì người dùng gập nhánh lại và nhánh tự khai là "sạch" —
 * đúng thứ NT-3 cấm ("không có dữ liệu ≠ bình thường"), chỉ khác là ở đây nó tệ
 * hơn: **có dữ liệu, và dữ liệu bị giấu**.
 *
 * ★ G8 — hàm này KHÔNG phải chỉ báo luôn-đúng: cây không có cảnh báo nào cho ra
 *   bản đồ toàn 0, và test ghim điều đó cùng với ca dương.
 *
 * @param nodes      các node gốc (cả `goc` lẫn `khuCho` đều dùng được)
 * @param soTrucTiep số cảnh báo gắn trực tiếp lên từng khoá
 */
export function ropCanhBao(
  nodes: readonly NodeCay[],
  soTrucTiep: ReadonlyMap<KhoaNode, number>,
): DemCanhBao {
  const ra = new Map<KhoaNode, number>();
  const di = (n: NodeCay): number => {
    let tong = soTrucTiep.get(n.khoa) ?? 0;
    for (const c of n.con) tong += di(c);
    ra.set(n.khoa, tong);
    return tong;
  };
  for (const n of nodes) di(n);
  return ra;
}

/**
 * Dựng `soTrucTiep` từ danh sách cảnh báo thô.
 *
 * ★ ĐO ĐƯỢC 2026-09-07 trên DB dev — cột `andon_events.stationId` là **NULL ở
 *   cả 7/7 hàng đang mở**, trong khi `machineId` và `lineId` đều có đủ. Nên một
 *   cảnh báo gắn được vào cây qua `machine:` (chính xác nhất) hoặc `line:`. Hàm
 *   nhận sẵn khoá đã dựng để module này không phải biết bảng nào có cột nào —
 *   nhưng ghi lại số đo ở đây vì nó giải thích vì sao `khoaNode("station", …)`
 *   gần như không bao giờ trúng trên dữ liệu thật (G19: dữ liệu hẹp hơn schema).
 *
 * ★ Khoá KHÔNG có trong cây bị **bỏ qua có chủ đích** — `ropCanhBao` chỉ ghi các
 *   khoá nó thật sự đi qua. Một cảnh báo của nhà máy khác không được cộng vào
 *   tổng của cây đang xem; cộng vào là nói dối về phạm vi.
 */
export function demTrucTiep(khoaCuaCanhBao: readonly KhoaNode[]): Map<KhoaNode, number> {
  const ra = new Map<KhoaNode, number>();
  for (const k of khoaCuaCanhBao) ra.set(k, (ra.get(k) ?? 0) + 1);
  return ra;
}

// ---------------------------------------------------------------------------
// #9 — Highlight đoạn khớp
// ---------------------------------------------------------------------------

/** Một mảnh nhãn: `khop=true` ⇒ component bọc `<mark>`. */
export interface ManhNhan {
  chu: string;
  khop: boolean;
}

/**
 * Cắt nhãn thành các mảnh khớp / không khớp để component bọc `<mark>` (#9).
 *
 * ★★★ CẮT TẤT CẢ LẦN KHỚP, KHÔNG PHẢI LẦN ĐẦU. Bản của `CommandCenter.tsx:245`
 *   (`HighlightedName`) dùng `indexOf` một lần rồi dừng: tìm "st" trên
 *   `"SIM-L1-SPI-ST"` chỉ tô được đoạn đầu tiên, và người dùng thấy một chữ "ST"
 *   được tô còn chữ "ST" bên cạnh thì không — trông như lỗi hiển thị. Ở đây quét
 *   hết chuỗi.
 *
 * ★ So khớp KHÔNG PHÂN BIỆT HOA THƯỜNG, nhưng **trả về chữ GỐC**: nếu trả về
 *   chuỗi đã hạ chữ thường thì nhãn `SIM-L1-AOI` hiện thành `sim-l1-aoi` ngay
 *   khi người dùng gõ tìm kiếm — nhãn tự đổi hình dạng dưới tay người dùng.
 *
 * ★ G8 — chuỗi tìm RỖNG trả về đúng MỘT mảnh `khop=false` chứa cả nhãn (không
 *   phải mảng rỗng): mảng rỗng làm nhãn biến mất khỏi màn khi chưa gõ gì.
 * ★ Chuỗi tìm KHÔNG XUẤT HIỆN cũng trả về một mảnh `khop=false` — không throw.
 */
export function catNhanTheoTim(nhan: string, tim: string): ManhNhan[] {
  const q = tim.trim().toLowerCase();
  if (q === "" || nhan === "") return [{ chu: nhan, khop: false }];
  const thap = nhan.toLowerCase();
  const ra: ManhNhan[] = [];
  let i = 0;
  for (;;) {
    const v = thap.indexOf(q, i);
    if (v < 0) break;
    if (v > i) ra.push({ chu: nhan.slice(i, v), khop: false });
    ra.push({ chu: nhan.slice(v, v + q.length), khop: true });
    i = v + q.length;
  }
  if (ra.length === 0) return [{ chu: nhan, khop: false }];
  if (i < nhan.length) ra.push({ chu: nhan.slice(i), khop: false });
  return ra;
}

// ---------------------------------------------------------------------------
// #10 — Lọc "chỉ node có cảnh báo"
// ---------------------------------------------------------------------------

/**
 * Cắt cây xuống chỉ còn nhánh CÓ cảnh báo (#10), dựa trên bản đồ roll-up.
 *
 * ★★★ PHẢI DÙNG SỐ ROLL-UP, KHÔNG DÙNG SỐ TRỰC TIẾP. Một xưởng có 0 cảnh báo
 *   trực tiếp nhưng chứa một máy đỏ: lọc theo số trực tiếp sẽ cắt cả xưởng ⇒
 *   **máy đỏ biến mất khỏi bộ lọc tên là "chỉ node có cảnh báo"**. Chế độ hỏng
 *   này im lặng và ngược hẳn ý định của tính năng, nên nó được ghim bằng test
 *   riêng có ca dương (cha 0 trực tiếp / con 1).
 *
 * ★ Node giữ lại giữ NGUYÊN con đã lọc — đường xuống lá phải liền, nếu không thì
 *   cây trả về một cha trống rỗng không click xuống được gì.
 */
export function locTheoCanhBao(nodes: readonly NodeCay[], dem: DemCanhBao): NodeCay[] {
  const ra: NodeCay[] = [];
  for (const n of nodes) {
    if ((dem.get(n.khoa) ?? 0) === 0) continue;
    ra.push({ ...n, con: locTheoCanhBao(n.con, dem) });
  }
  return ra;
}

/**
 * Khoá của MỌI node có con trong `nodes` — tập cần auto-expand khi bộ lọc bật.
 *
 * ★ Auto-expand chỉ **CỘNG THÊM** vào tập người dùng đang mở, không thay thế nó
 *   (component hợp nhất hai tập). Ghi đè state mở của người dùng nghĩa là tắt bộ
 *   lọc xong cây bung/gập khác hẳn lúc trước khi lọc — người dùng mất chỗ đứng.
 *
 * ★ Lá KHÔNG vào tập: `aria-expanded` của một node không con phải là `undefined`
 *   chứ không phải `false` (WAI-ARIA), và mở một lá là vô nghĩa.
 */
export function khoaCanMo(nodes: readonly NodeCay[]): Set<KhoaNode> {
  const ra = new Set<KhoaNode>();
  const di = (n: NodeCay) => {
    if (n.con.length === 0) return;
    ra.add(n.khoa);
    for (const c of n.con) di(c);
  };
  for (const n of nodes) di(n);
  return ra;
}

// ---------------------------------------------------------------------------
// #15 — Scope filter theo subtree
// ---------------------------------------------------------------------------

/** Tập id theo loại, dùng để lọc dải cảnh báo theo nhánh đang chọn (#15). */
export interface PhamViNhanh {
  workshopIds: ReadonlySet<number>;
  lineIds: ReadonlySet<number>;
  stationIds: ReadonlySet<number>;
  machineIds: ReadonlySet<number>;
  /** Mọi khoá trong nhánh, kể cả node gốc của nhánh. */
  khoa: ReadonlySet<KhoaNode>;
}

/** Phạm vi RỖNG — dùng khi không chọn gì. */
export function phamViRong(): PhamViNhanh {
  return {
    workshopIds: new Set(),
    lineIds: new Set(),
    stationIds: new Set(),
    machineIds: new Set(),
    khoa: new Set(),
  };
}

/**
 * Gom mọi id trong cây con của một node (#15).
 *
 * ★★★ PHẢI GỒM CHÍNH NODE ĐÓ, không chỉ hậu duệ. Chọn một máy lá rồi lọc dải
 *   cảnh báo theo "cây con của nó" mà không tính chính nó ⇒ tập rỗng ⇒ dải báo
 *   "không có cảnh báo" cho đúng cái máy người dùng vừa click vì nó đang đỏ.
 *   Đây là G5 ở dạng độc nhất: bộ lọc luôn cho tập rỗng, và tập rỗng trông y hệt
 *   "máy này ổn". Test ghim riêng ca lá.
 *
 * ★ Trả {@link phamViRong} khi khoá không có trong cây — người gọi phân biệt
 *   được "không chọn gì" bằng cách tự kiểm `khoa.size === 0`.
 */
export function phamViCuaNhanh(cay: CayThietKe, khoa: KhoaNode | null): PhamViNhanh {
  if (khoa === null) return phamViRong();
  const goc = cay.theoKhoa.get(khoa);
  if (!goc) return phamViRong();
  const workshopIds = new Set<number>();
  const lineIds = new Set<number>();
  const stationIds = new Set<number>();
  const machineIds = new Set<number>();
  const khoaTap = new Set<KhoaNode>();
  const di = (n: NodeCay) => {
    khoaTap.add(n.khoa);
    if (n.loai === "workshop") workshopIds.add(n.id);
    else if (n.loai === "line") lineIds.add(n.id);
    else if (n.loai === "station") stationIds.add(n.id);
    else if (n.loai === "machine") machineIds.add(n.id);
    for (const c of n.con) di(c);
  };
  di(goc);
  return { workshopIds, lineIds, stationIds, machineIds, khoa: khoaTap };
}

// ---------------------------------------------------------------------------
// #11 — Cây phẳng + bàn phím WAI-ARIA
// ---------------------------------------------------------------------------

/** Một hàng ĐANG NHÌN THẤY trên cây, theo đúng thứ tự thị giác. */
export interface HangPhang {
  node: NodeCay;
  /** Bậc thụt lề, gốc = 0. Cũng là `aria-level - 1`. */
  bac: number;
  /** Node này đang mở hay không. Lá luôn `false`. */
  mo: boolean;
  /** Có con hay không — quyết định `aria-expanded` có mặt hay `undefined`. */
  coCon: boolean;
}

/**
 * Trải cây thành danh sách hàng ĐANG NHÌN THẤY (xem docblock đầu tệp).
 *
 * ★★★ CÂY CON CỦA NODE ĐÓNG KHÔNG VÀO DANH SÁCH. Đây là toàn bộ điểm của hàm:
 *   ↓ từ một node đóng phải nhảy sang **anh em kế tiếp**, không chui vào con
 *   đang bị gập. Nếu con bị gập vẫn nằm trong danh sách thì focus đi vào một
 *   hàng **không tồn tại trên màn** — trình đọc màn hình đọc tên nó, người dùng
 *   nhìn thấy con trỏ biến mất. Test ghim đúng ca này.
 *
 * @param mo tập khoá đang mở (đã hợp nhất auto-expand ở tầng gọi)
 */
export function duyetPhang(nodes: readonly NodeCay[], mo: ReadonlySet<KhoaNode>): HangPhang[] {
  const ra: HangPhang[] = [];
  const di = (ds: readonly NodeCay[], bac: number) => {
    for (const n of ds) {
      const coCon = n.con.length > 0;
      const dangMo = coCon && mo.has(n.khoa);
      ra.push({ node: n, bac, mo: dangMo, coCon });
      if (dangMo) di(n.con, bac + 1);
    }
  };
  di(nodes, 0);
  return ra;
}

/** Phím bàn phím mà cây xử lý. Mọi phím khác ⇒ `phimCay` trả `null`. */
export type PhimCayHopLe =
  | "Enter"
  | " "
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

/**
 * Việc phải làm sau một phím. `null` = phím không thuộc về cây (đừng
 * `preventDefault`, để trình duyệt xử lý — cuộn trang, gõ chữ…).
 */
export interface ViecPhim {
  /** Khoá node phải NHẬN FOCUS sau phím này. `null` = giữ nguyên focus. */
  focus: KhoaNode | null;
  /** Khoá node phải MỞ. `null` = không mở gì. */
  mo: KhoaNode | null;
  /** Khoá node phải ĐÓNG. `null` = không đóng gì. */
  dong: KhoaNode | null;
  /** Khoá node phải KÍCH HOẠT (chọn). `null` = không chọn. */
  chon: KhoaNode | null;
}

const VIEC_RONG: ViecPhim = { focus: null, mo: null, dong: null, chon: null };

/**
 * ★★★ HÀM QUYẾT ĐỊNH BÀN PHÍM WAI-ARIA (#11) — trái tim của mục này.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Theo APG "Tree View" pattern. Tám phím, và **ba** trong số đó có hành vi phụ
 * thuộc trạng thái mở/đóng — đó là chỗ mọi bản cài đặt vội đều sai:
 *
 * | Phím        | Node ĐÓNG (hoặc lá)              | Node ĐANG MỞ                  |
 * |-------------|----------------------------------|-------------------------------|
 * | `→`         | MỞ nó (nếu có con), focus giữ    | focus xuống CON ĐẦU           |
 * | `←`         | focus lên CHA                    | ĐÓNG nó, focus giữ            |
 * | `↑`/`↓`     | hàng trước/sau trong danh sách phẳng (không phụ thuộc)   |
 * | `Home`/`End`| hàng đầu / hàng CUỐI CÙNG đang nhìn thấy                  |
 * | `Enter`/`␣` | kích hoạt (chọn)                                          |
 *
 * ★ `→` trên node ĐÃ MỞ **không mở lại** mà đi vào con: đây là hành vi APG và là
 *   thứ phân biệt một cây thật với một danh sách có mũi tên. Bản
 *   `CommandCenter.tsx:330-343` chỉ làm nửa đầu (`ArrowRight && !isOpen`) và
 *   **không có ↑/↓/Home/End nào cả** — tức trên bàn phím nó không đi lại được
 *   giữa các node, chỉ mở/đóng được node đang focus. Đó là lý do mục này KHÔNG
 *   phải "chép từ CommandCenter sang".
 *
 * ★ `←` trên node gốc đang đóng: không có cha ⇒ trả {@link VIEC_RONG}, KHÔNG
 *   throw và KHÔNG cuộn focus vòng lại cuối cây (vòng lại làm người dùng lạc).
 *
 * ★ `↑` ở hàng đầu / `↓` ở hàng cuối: DỪNG, không cuộn vòng — APG quy định thế,
 *   và cuộn vòng trên cây dài làm mất cảm giác về biên.
 *
 * ★★★ G8 — hàm này KHÔNG luôn trả về việc: phím lạ (`"a"`, `Tab`, `Escape`) và
 *   `khoaFocus` không có trong danh sách đều trả `null`/`VIEC_RONG`. Nếu nó luôn
 *   trả một việc thì `preventDefault` sẽ nuốt cả `Tab` và người dùng bàn phím bị
 *   **nhốt trong cây** — lỗi trợ năng nặng hơn hẳn lỗi nó đang vá.
 *
 * @param hang      danh sách phẳng ĐANG NHÌN THẤY (từ {@link duyetPhang})
 * @param khoaFocus node đang giữ focus; `null` = chưa có ⇒ mọi phím điều hướng
 *                  đưa focus về hàng đầu (thay vì không làm gì)
 * @param phim      `KeyboardEvent.key` thô
 */
export function phimCay(
  hang: readonly HangPhang[],
  khoaFocus: KhoaNode | null,
  phim: string,
): ViecPhim | null {
  if (hang.length === 0) return null;
  const laPhimCay =
    phim === "Enter" ||
    phim === " " ||
    phim === "ArrowUp" ||
    phim === "ArrowDown" ||
    phim === "ArrowLeft" ||
    phim === "ArrowRight" ||
    phim === "Home" ||
    phim === "End";
  if (!laPhimCay) return null;

  const i = khoaFocus === null ? -1 : hang.findIndex((h) => h.node.khoa === khoaFocus);

  // Home/End không cần biết đang đứng ở đâu.
  if (phim === "Home") return { ...VIEC_RONG, focus: hang[0].node.khoa };
  if (phim === "End") return { ...VIEC_RONG, focus: hang[hang.length - 1].node.khoa };

  // Chưa có focus (hoặc focus trỏ vào hàng đã bị lọc mất): đưa về hàng đầu thay
  // vì im lặng — im lặng làm bàn phím trông như hỏng ngay lần bấm đầu tiên.
  if (i < 0) {
    if (phim === "Enter" || phim === " ") return null;
    return { ...VIEC_RONG, focus: hang[0].node.khoa };
  }

  const h = hang[i];
  const khoa = h.node.khoa;

  if (phim === "Enter" || phim === " ") return { ...VIEC_RONG, chon: khoa };

  if (phim === "ArrowDown") {
    return i + 1 < hang.length ? { ...VIEC_RONG, focus: hang[i + 1].node.khoa } : VIEC_RONG;
  }
  if (phim === "ArrowUp") {
    return i > 0 ? { ...VIEC_RONG, focus: hang[i - 1].node.khoa } : VIEC_RONG;
  }

  if (phim === "ArrowRight") {
    if (!h.coCon) return VIEC_RONG;
    if (!h.mo) return { ...VIEC_RONG, mo: khoa };
    // Đang mở ⇒ con đầu là hàng ngay sau trong danh sách phẳng (theo dựng của
    // `duyetPhang`). Không tự đi tìm `h.node.con[0]`: nếu cây đã bị LỌC thì con
    // đầu THẬT có thể đã bị cắt khỏi màn, và focus sẽ nhảy vào hàng vô hình.
    return i + 1 < hang.length ? { ...VIEC_RONG, focus: hang[i + 1].node.khoa } : VIEC_RONG;
  }

  // ArrowLeft
  if (h.coCon && h.mo) return { ...VIEC_RONG, dong: khoa };
  // Lên cha: tìm ngược hàng đầu tiên có bậc NHỎ HƠN. Dùng danh sách phẳng thay
  // vì `node.cha` vì cha có thể không nằm trên màn khi cây đang bị lọc.
  for (let j = i - 1; j >= 0; j--) {
    if (hang[j].bac < h.bac) return { ...VIEC_RONG, focus: hang[j].node.khoa };
  }
  return VIEC_RONG;
}

/**
 * Roving tabindex: node nào mang `tabIndex=0` (tất cả còn lại `-1`).
 *
 * ★★★ ĐÚNG MỘT hàng trong cả cây được `0`. Đó là toàn bộ ý nghĩa của "roving":
 *   `Tab` đưa con trỏ VÀO cây một lần, rồi mũi tên đi bên trong. Cho mọi hàng
 *   `tabIndex=0` (bản năng đầu tiên, và là lỗi phổ biến nhất) biến một cây 82
 *   máy thành **82 chặng Tab** người dùng phải bấm qua để tới nút kế tiếp.
 *
 * ★ Thứ tự dự phòng: node đang FOCUS → node đang CHỌN (nếu còn trên màn) → hàng
 *   ĐẦU. Bậc thứ hai quan trọng: chọn một máy trong 3D rồi Tab vào cây phải rơi
 *   đúng vào máy đó, không rơi về đầu cây.
 * ★ Danh sách rỗng ⇒ `null`, và component không render hàng nào để mà gắn.
 */
export function khoaNhanTab(
  hang: readonly HangPhang[],
  khoaFocus: KhoaNode | null,
  daChon: readonly KhoaNode[],
): KhoaNode | null {
  if (hang.length === 0) return null;
  if (khoaFocus !== null && hang.some((h) => h.node.khoa === khoaFocus)) return khoaFocus;
  for (let i = daChon.length - 1; i >= 0; i--) {
    const k = daChon[i];
    if (hang.some((h) => h.node.khoa === k)) return k;
  }
  return hang[0].node.khoa;
}
