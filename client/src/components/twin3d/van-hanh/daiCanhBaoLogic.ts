/**
 * daiCanhBaoLogic.ts — MÔ HÌNH THUẦN của dải cảnh báo hợp nhất (§11 #12/#13/#14).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ DEDUPE PHẢI KHOÁ THEO THỰC THỂ, KHÔNG THEO ID PHONG BÌ — ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * Bản gốc `CommandCenter.tsx:1058-1065` gộp seed + live bằng `Map` khoá theo
 * `event.id`. Đo lại hai đường sinh id cho thấy khoá đó **không khử được trùng**:
 *
 *   1. **Seed đổi id mỗi lần refetch.** `commandCenterService.ts` dựng id seed
 *      dạng `"andon:{rowId}:{ts36}-{seq36}"` với `seq` là bộ đếm ĐƠN ĐIỆU của
 *      tiến trình. Cùng một hàng `andon_events` được `recentAlerts` trả về ở hai
 *      lượt poll cách nhau 15 s ⇒ **hai id khác nhau** ⇒ `Map` giữ CẢ HAI ⇒ một
 *      cảnh báo hiện hai dòng. Khoá theo id ở đây khử trùng đúng **số 0**.
 *
 *   2. **Socket phát MỘT sự kiện tới BA phòng.** `server/_core/socket.ts:1392-
 *      1394` — `emitAndonEvent` gọi `io.to("global").emit(...)`, rồi
 *      `io.to("line:{lineId}")`, rồi `io.to("machine:{machineId}")`. Một client
 *      đã join cả `global` lẫn `machine:{id}` nhận **cùng một raise 2-3 lần**.
 *      Ba bản sao này chia sẻ `id` phong bì nên `Map` id CÓ khử được — nhưng chỉ
 *      ca này, không khử được ca (1).
 *
 * ⇒ Khoá dedupe ở đây là {@link khoaCanhBao} = `"{nguon}:{idNguon}"` — **danh
 *   tính của THỰC THỂ trong bảng nguồn**, thứ không đổi qua refetch, qua phòng
 *   socket, qua vòng đời raise→ack→resolve. Đó là đại lượng duy nhất ổn định.
 *
 * ★★★ VÀ "GIỮ BẢN NÀO" LÀ MỘT QUYẾT ĐỊNH RIÊNG, KHÔNG PHẢI HỆ QUẢ.
 * Khi hai bản cùng khoá gặp nhau, `Map.set` kiểu "ghi sau đè trước" chọn theo
 * **thứ tự đến**, mà thứ tự đến là ngẫu nhiên (mạng). Với vòng đời ISA-18.2
 * (raise → acknowledged → resolved) thì bản đúng phải là bản **MỚI NHẤT theo
 * thời gian của chính dữ liệu**, không phải bản đến sau. Nếu không: một gói
 * socket `raised` đến trễ sẽ **lật ngược** một hàng đã `acknowledged` về chưa-ack,
 * và người vận hành thấy một cảnh báo họ vừa xác nhận sống dậy. {@link gopCanhBao}
 * vì thế so `capNhatLuc` chứ không dựa thứ tự lặp.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO ĐƯỢC TRÊN DB DEV 2026-09-07 (hai mô hình rời, BG-127)
 * ════════════════════════════════════════════════════════════════════════════
 *   Mô hình 1 — LIỆT KÊ toàn phân bố `state × status × (resolvedAt IS NULL)`:
 *     call/acknowledged/mở 2 · red/acknowledged/mở 2 · yellow/acknowledged/mở 3
 *     ⇒ TỔNG 7
 *   Mô hình 2 — ĐẾM TỔNG độc lập:
 *     tổng 7 · đang mở 7 · tồn đọng >24h **6**
 *
 * Ba hệ quả đi thẳng vào thiết kế module này:
 *
 * · **`status` = `acknowledged` ở CẢ 7/7 hàng, 0 hàng `raised`.** Nên mọi phép
 *   nghiệm thu dạng "đếm cảnh báo chưa ack" trên DB này cho **0** — và số 0 đó
 *   trông y hệt "mã hỏng hoàn toàn" (G5). Test của module này vì vậy dựng ca
 *   dương bằng tay cho CẢ HAI nhánh ack/chưa-ack.
 *
 * · **`state` thật chỉ có `call|red|yellow`** trong khi `andonStateEnum` khai 4
 *   giá trị (`green` nữa). Đúng lớp lỗi G19 — nhưng ở đây nó đi theo chiều
 *   AN TOÀN: `green` vẫn được {@link MUC_HOP_LE} nhận và ánh xạ xuống mức thấp
 *   nhất, thay vì rơi vào `default` im lặng.
 *
 * · **`stationId` NULL ở 7/7 hàng**, `machineId` và `lineId` đủ 7/7. Nên
 *   {@link locTheoPhamVi} không được đòi `stationId` mới cho qua.
 *
 * ★ Module THUẦN (RB-8.1): không react, không three, không `Date.now()` ẩn —
 *   `bayGio` luôn là THAM SỐ. Đọc đồng hồ bên trong làm test phụ thuộc lúc chạy
 *   và làm nhóm "tồn đọng >24h" không thể ghim được bằng bất kỳ giá trị nào.
 */

// ---------------------------------------------------------------------------
// Mức độ
// ---------------------------------------------------------------------------

/**
 * Mức độ của một dòng trong dải, ĐÃ chuẩn hoá.
 *
 * ★ CỐ Ý KHÔNG dùng lại `EcosystemSeverity` (5 giá trị: info/low/medium/high/
 *   critical) của `useEcosystemEvents.ts`. Lý do đo được: `andon_events` **không
 *   có cột severity** — cả `commandCenterService.ts` lẫn `ecosystemEvents.ts`
 *   đều SUY nó ra từ `state` bằng cùng một công thức chép hai bản
 *   (`red|call → critical`, `yellow → high`, còn lại → `info`). Đi qua thang 5
 *   mức đó là **mất thông tin rồi bịa lại**: `call` (gọi hỗ trợ) và `red` (dừng
 *   máy) bị trộn thành cùng một `critical`, không tách lại được.
 *
 * ⇒ Giữ nguyên `state` gốc — cùng bộ ba với `MucCanhBao` của `LopCanhBao.tsx:48`
 *   nên badge 3D và dải 2D nói **cùng một thứ tiếng** (không phải hai thang phải
 *   đồng bộ tay), cộng `green` để phủ hết enum.
 */
export type MucDoCanhBao = "red" | "call" | "yellow" | "green";

/** Mọi mức hợp lệ, theo thứ tự ƯU TIÊN GIẢM DẦN. Cũng là thứ tự chip lọc. */
export const MUC_THEO_UU_TIEN: readonly MucDoCanhBao[] = ["red", "call", "yellow", "green"];

const MUC_HOP_LE: ReadonlySet<string> = new Set(MUC_THEO_UU_TIEN);

/** Điểm ưu tiên: CAO hơn = nghiêm trọng hơn. Dùng để sắp xếp phá hoà. */
const DIEM_MUC: Readonly<Record<MucDoCanhBao, number>> = {
  red: 4,
  call: 3,
  yellow: 2,
  green: 1,
};

/**
 * Chuẩn hoá `andon_events.state` thô về {@link MucDoCanhBao}.
 *
 * ★★★ GIÁ TRỊ LẠ RƠI VỀ `red`, KHÔNG PHẢI `green`. Đây là quyết định an toàn có
 *   chủ đích, và nó ngược với bản năng "mặc định = ít nghiêm trọng nhất":
 *   một giá trị `state` mà mã này chưa biết là một cảnh báo ta **KHÔNG hiểu**,
 *   và giấu nó xuống đáy dải (hoặc lọc mất bởi chip) là cách để một chế độ hỏng
 *   mới ra đời trong im lặng. G19 vừa ghi đúng ca ấy: cột hẹp hơn enum ⇒ mọi
 *   thứ rơi về nhánh mặc định ⇒ replay sơn xám cả nhà máy mà không gì nổ.
 *   Đẩy cái chưa biết LÊN TRÊN thì người vận hành nhìn thấy và báo được.
 */
export function chuanHoaMuc(state: string | null | undefined): MucDoCanhBao {
  const s = (state ?? "").trim().toLowerCase();
  return MUC_HOP_LE.has(s) ? (s as MucDoCanhBao) : "red";
}

// ---------------------------------------------------------------------------
// Hình dạng một cảnh báo
// ---------------------------------------------------------------------------

/** Nguồn sinh ra cảnh báo — phần đầu của khoá dedupe. */
export type NguonCanhBao = "andon" | "safety";

/** Vòng đời ISA-18.2 (§9.2) rút gọn về ba pha có trong `andon_events.status`. */
export type PhaCanhBao = "raised" | "acknowledged" | "resolved";

/** Một dòng của dải, đã chuẩn hoá từ seed HOẶC từ socket. */
export interface CanhBaoDai {
  /** Id hàng trong bảng nguồn (`andon_events.id`). ỔN ĐỊNH qua mọi lần đọc. */
  idNguon: number;
  nguon: NguonCanhBao;
  muc: MucDoCanhBao;
  pha: PhaCanhBao;
  /** Tiêu đề đã sẵn sàng hiển thị. Component KHÔNG gọi `t()` lên nó (RB-8.3). */
  tieuDe: string;
  /** `andon_events.raisedAt` — epoch ms. Đây là mốc tính TUỔI (#13). */
  luc: number;
  /**
   * Mốc để chọn bản MỚI HƠN khi trùng khoá (xem docblock đầu tệp). Thường là
   * `acknowledgedAt ?? raisedAt`, hoặc thời điểm gói socket tới.
   *
   * ⚠ KHÁC `luc` một cách có chủ đích: một hàng được ack lúc 10:00 cho một sự cố
   * nổ lúc 08:00 vẫn phải **đứng theo tuổi 08:00** trong nhóm tồn đọng (nếu
   * không thì ack một cảnh báo cũ làm nó "trẻ lại" và nhảy khỏi nhóm tồn đọng —
   * tức là ẩn đúng thứ nhóm ấy sinh ra để phơi bày).
   */
  capNhatLuc: number;
  machineId: number | null;
  lineId: number | null;
  stationId: number | null;
  workshopId: number | null;
}

/**
 * Khoá dedupe — danh tính THỰC THỂ, không phải danh tính gói tin.
 *
 * ★ Gồm `nguon` vì `andon_events.id = 5` và `safety_events.id = 5` là hai sự
 *   kiện khác nhau; khoá chỉ bằng số sẽ **nuốt mất một trong hai** — một cảnh
 *   báo an toàn biến mất vì trùng số thứ tự với một andon. Chế độ hỏng im lặng
 *   và đúng vào loại cảnh báo nghiêm trọng nhất.
 */
export function khoaCanhBao(c: Pick<CanhBaoDai, "nguon" | "idNguon">): string {
  return `${c.nguon}:${c.idNguon}`;
}

// ---------------------------------------------------------------------------
// #12 — Gộp seed + socket, dedupe, cap
// ---------------------------------------------------------------------------

/**
 * Trần số dòng giữ trong dải (#12 "cap 100").
 *
 * ★ Trần này là chống-vỡ-bộ-nhớ, KHÔNG phải chính sách hiển thị: socket có thể
 *   bắn không giới hạn trong một sự cố dây chuyền, và một mảng không trần sẽ lớn
 *   mãi trong suốt phiên làm việc.
 */
export const TRAN_DAI = 100;

/**
 * Gộp seed + socket thành một dải: **dedupe theo thực thể → sắp xếp → cắt trần**.
 *
 * Thứ tự ba bước KHÔNG hoán vị được, và đây là chỗ dễ sai nhất:
 *   · dedupe TRƯỚC cắt trần — cắt trước thì 100 dòng đầu có thể là 50 cảnh báo
 *     nhân đôi, và 50 cảnh báo thật bị đẩy ra ngoài trần bởi chính bản sao của
 *     nhau. Trần khi đó đo "số GÓI TIN" chứ không đo "số CẢNH BÁO" — đúng lớp
 *     lỗi G7 (đếm đầu vào ≠ đầu ra).
 *   · sắp xếp TRƯỚC cắt trần — cắt trên mảng chưa sắp xếp thì thứ bị bỏ là thứ
 *     đến muộn, không phải thứ cũ nhất; một cảnh báo `red` mới toanh có thể bị
 *     cắt trong khi 100 cảnh báo `green` từ hôm qua ở lại.
 *
 * ★ Sắp xếp: MỚI NHẤT trước (`luc` giảm dần); hoà thì mức NGHIÊM TRỌNG hơn lên
 *   trước; hoà nữa thì theo khoá — **TẤT ĐỊNH**, để cùng đầu vào luôn cho cùng
 *   thứ tự và ảnh chụp nghiệm thu so sánh được. `Array.sort` không ổn định giữa
 *   các engine cho mảng lớn, nên phá hoà tường minh chứ không dựa vào nó.
 *
 * ★ G8 — đầu vào rỗng trả `[]`, không phải `[undefined]` hay throw.
 *
 * @param seed từ `andon.active` (đã chuẩn hoá) — nguồn ĐẦY ĐỦ nhưng chậm
 * @param song từ socket `andon:event` (đã chuẩn hoá) — nguồn NHANH nhưng lẻ tẻ
 */
export function gopCanhBao(
  seed: readonly CanhBaoDai[],
  song: readonly CanhBaoDai[],
  tran: number = TRAN_DAI,
): CanhBaoDai[] {
  const theoKhoa = new Map<string, CanhBaoDai>();
  const nap = (c: CanhBaoDai) => {
    const k = khoaCanhBao(c);
    const cu = theoKhoa.get(k);
    // ★★★ GIỮ BẢN MỚI HƠN THEO DỮ LIỆU, không theo thứ tự đến (docblock đầu tệp).
    //   `>=` chứ không `>`: hai bản CÙNG mốc là cùng một sự thật đọc hai lần, và
    //   lấy bản sau cho seed-thắng-seed một cách tất định.
    if (cu === undefined || c.capNhatLuc >= cu.capNhatLuc) theoKhoa.set(k, c);
  };
  for (const c of seed) nap(c);
  for (const c of song) nap(c);

  const ra = [...theoKhoa.values()].sort((a, b) => {
    if (b.luc !== a.luc) return b.luc - a.luc;
    const d = DIEM_MUC[b.muc] - DIEM_MUC[a.muc];
    if (d !== 0) return d;
    return khoaCanhBao(a) < khoaCanhBao(b) ? -1 : 1;
  });

  const buoc = Number.isFinite(tran) && tran > 0 ? Math.floor(tran) : TRAN_DAI;
  return ra.length > buoc ? ra.slice(0, buoc) : ra;
}

/**
 * DỤNG CỤ ĐO ĐỘC LẬP: đếm số khoá xuất hiện NHIỀU HƠN MỘT LẦN trong một dải.
 *
 * ★★★ Vì sao tồn tại, và vì sao nó KHÔNG được gọi từ `gopCanhBao`:
 *   một bộ đếm dẫn xuất từ thuật toán không bao giờ **bác bỏ** được thuật toán
 *   ấy. Hàm này quét ĐẦU RA và trả lời đúng câu người dùng hỏi — *"trên màn còn
 *   dòng nào lặp không?"* — nên nó có thể nói `gopCanhBao` sai. Đây chính là
 *   khuôn đã bắt được lời khai sai `data-so-an = 0` của `locBadge` (xem docblock
 *   `locBadge.ts`), mang nguyên sang.
 *
 * ★ Trả về SỐ KHOÁ BỊ LẶP (không phải số dòng thừa): 3 dòng cùng khoá tính là 1.
 *   Hai đại lượng khác nhau — đặt tên theo đúng cái nó đếm.
 */
export function demKhoaLap(dai: readonly CanhBaoDai[]): number {
  const dem = new Map<string, number>();
  for (const c of dai) {
    const k = khoaCanhBao(c);
    dem.set(k, (dem.get(k) ?? 0) + 1);
  }
  let lap = 0;
  for (const n of dem.values()) if (n > 1) lap += 1;
  return lap;
}

// ---------------------------------------------------------------------------
// #13 — Nhóm "Tồn đọng > 24h"
// ---------------------------------------------------------------------------

/** 24 giờ tính bằng ms — ngưỡng "tồn đọng" (#13). */
export const NGUONG_TON_DONG_MS = 86_400_000;

/** Dải đã tách hai nhóm. */
export interface NhomCanhBao {
  /** Tuổi ≤ 24h. */
  homNay: CanhBaoDai[];
  /** Tuổi > 24h — ISA-18.2 gọi đây là alarm "stale", phải phơi ra chứ không giấu. */
  tonDong: CanhBaoDai[];
}

/**
 * Tách dải thành "Hôm nay" và "Tồn đọng >24h" (#13).
 *
 * ★★★ TUỔI TÍNH TỪ `luc` (= `raisedAt`), KHÔNG từ `capNhatLuc`. Xem docblock của
 *   {@link CanhBaoDai.capNhatLuc}: nếu tính từ mốc cập nhật thì **ack một cảnh
 *   báo cũ sẽ làm nó trẻ lại** và nhảy từ "Tồn đọng" sang "Hôm nay". Nhóm tồn
 *   đọng khi đó tự dọn sạch mỗi khi có người bấm ack — tức nó đo *thao tác gần
 *   nhất* thay vì đo *sự cố còn treo bao lâu*, và mất sạch giá trị.
 *
 * ★ Biên: đúng 24h **thuộc "Hôm nay"** (`>` mới là tồn đọng) — khớp bản gốc
 *   `CommandCenter.tsx:1092-1093`. Test ghim cả ba điểm 24h−1ms / 24h / 24h+1ms.
 *
 * ★ `bayGio` là THAM SỐ (không đọc `Date.now()`): xem docblock đầu tệp.
 * ★ Cảnh báo có `luc` trong TƯƠNG LAI (lệch đồng hồ máy chủ/máy trạm) cho tuổi
 *   âm ⇒ rơi vào "Hôm nay". Đúng: một mốc tương lai chắc chắn không phải tồn
 *   đọng 24h, và ném nó sang nhóm tồn đọng vì `Math.abs` sẽ là bịa.
 */
export function tachNhom(dai: readonly CanhBaoDai[], bayGio: number): NhomCanhBao {
  const homNay: CanhBaoDai[] = [];
  const tonDong: CanhBaoDai[] = [];
  for (const c of dai) {
    if (bayGio - c.luc > NGUONG_TON_DONG_MS) tonDong.push(c);
    else homNay.push(c);
  }
  return { homNay, tonDong };
}

/**
 * Số NGÀY tồn đọng để hiện badge "tồn đọng Nd".
 *
 * ★ Sàn là 1: một cảnh báo 25 giờ ra `Math.floor(25/24) = 1` — đúng. Nhưng một
 *   cảnh báo 24h+1ms ra `0`, và badge "tồn đọng 0d" tự mâu thuẫn với chính nhóm
 *   nó đang đứng. Kẹp về 1, khớp bản gốc `CommandCenter.tsx:1138`.
 */
export function soNgayTonDong(c: CanhBaoDai, bayGio: number): number {
  return Math.max(1, Math.floor((bayGio - c.luc) / NGUONG_TON_DONG_MS));
}

// ---------------------------------------------------------------------------
// #14 — Chip lọc mức độ
// ---------------------------------------------------------------------------

/** Lựa chọn của chip lọc. `"tat_ca"` = không lọc. */
export type ChonMuc = MucDoCanhBao | "tat_ca";

/**
 * Lọc dải theo chip mức độ (#14).
 *
 * ★ So khớp CHÍNH XÁC một mức, không phải "từ mức này trở lên". Hai ngữ nghĩa
 *   này khác nhau và chọn nhầm là lỗi câm: nếu `red` nghĩa là "red trở lên" thì
 *   chip `yellow` sẽ hiện cả red — người dùng lọc "chỉ vàng" mà thấy đỏ sẽ tưởng
 *   bộ lọc hỏng. Bản gốc `CommandCenter.tsx:1088-1091` cũng khớp chính xác.
 *
 * ★ G8 — `"tat_ca"` trả về mảng NGUYÊN VẸN (cùng phần tử), không phải bản sao
 *   rỗng; và một mức không có dòng nào trả `[]` chứ không rơi về toàn bộ dải
 *   (rơi về toàn bộ là cách bộ lọc tự khai "không có kết quả" bằng cách hiện
 *   TẤT CẢ — người dùng không thể phân biệt với "bộ lọc không chạy").
 */
export function locTheoMuc(dai: readonly CanhBaoDai[], chon: ChonMuc): CanhBaoDai[] {
  if (chon === "tat_ca") return [...dai];
  return dai.filter((c) => c.muc === chon);
}

/** Đếm số dòng theo từng mức — cho con số trên chip. */
export function demTheoMuc(dai: readonly CanhBaoDai[]): Record<ChonMuc, number> {
  const ra: Record<ChonMuc, number> = { tat_ca: dai.length, red: 0, call: 0, yellow: 0, green: 0 };
  for (const c of dai) ra[c.muc] += 1;
  return ra;
}

// ---------------------------------------------------------------------------
// #15 — Lọc theo phạm vi nhánh đang chọn
// ---------------------------------------------------------------------------

/** Tập id của một nhánh cây — khớp `PhamViNhanh` của `cayPhanCapLogic.ts`. */
export interface TapPhamVi {
  workshopIds: ReadonlySet<number>;
  lineIds: ReadonlySet<number>;
  stationIds: ReadonlySet<number>;
  machineIds: ReadonlySet<number>;
}

/**
 * Lọc dải theo cây con đang chọn (#15).
 *
 * ★★★ PHẠM VI RỖNG ⇒ KHÔNG LỌC (trả nguyên dải). "Không chọn nhánh nào" và
 *   "chọn một nhánh không chứa gì" phải cho hai kết quả khác nhau, nhưng cả hai
 *   đều đi vào đây với bốn tập rỗng nếu người gọi không phân biệt. Nên hợp đồng
 *   ở đây là: **người gọi truyền `null` khi không chọn gì**; truyền một `TapPhamVi`
 *   rỗng thật sự (nhánh trống) sẽ lọc ra `[]` — đúng, vì nhánh ấy thật sự không
 *   có máy nào.
 *
 * ★ Một cảnh báo khớp nếu BẤT KỲ trục nào của nó nằm trong phạm vi (machine HOẶC
 *   line HOẶC station HOẶC workshop). Đo được trên DB dev: `stationId` NULL ở
 *   7/7 hàng đang mở, `machineId`/`lineId` đủ 7/7 — nên đòi khớp station là loại
 *   sạch mọi cảnh báo thật (G19).
 *
 * ★ Cảnh báo KHÔNG có trục nào (`machineId`/`lineId`/`stationId`/`workshopId`
 *   đều null) được **GIỮ LẠI**, không loại. NT-3: một cảnh báo không gắn được
 *   vào cây là dữ liệu ta chưa hiểu, và giấu nó khi người dùng chọn một nhánh
 *   nghĩa là nó biến mất khỏi mọi khung nhìn hẹp — chỉ hiện khi không lọc gì,
 *   tức gần như không bao giờ.
 */
export function locTheoPhamVi(
  dai: readonly CanhBaoDai[],
  pham: TapPhamVi | null,
): CanhBaoDai[] {
  if (pham === null) return [...dai];
  return dai.filter((c) => {
    if (c.machineId !== null && pham.machineIds.has(c.machineId)) return true;
    if (c.lineId !== null && pham.lineIds.has(c.lineId)) return true;
    if (c.stationId !== null && pham.stationIds.has(c.stationId)) return true;
    if (c.workshopId !== null && pham.workshopIds.has(c.workshopId)) return true;
    const coTruc =
      c.machineId !== null ||
      c.lineId !== null ||
      c.stationId !== null ||
      c.workshopId !== null;
    return !coTruc;
  });
}

// ---------------------------------------------------------------------------
// Chuẩn hoá đầu vào thô
// ---------------------------------------------------------------------------

/**
 * Hàng thô từ `andon.active` HOẶC từ gói socket `andon:event`.
 *
 * ★ Hai nguồn có hình dạng GẦN giống nhau nhưng không bằng nhau, và khác biệt
 *   nằm ở kiểu thời gian: tRPC superjson trả `Date`, socket trả **chuỗi ISO**
 *   (`AndonRealtimeEvent.raisedAt: Date | string`, `socket.ts:1379`). Cộng thẳng
 *   hai kiểu đó vào một phép trừ cho `NaN` — và `NaN > NGUONG` là `false`, nên
 *   **mọi cảnh báo rơi hết vào "Hôm nay" mà không có lỗi nào nổ**. Chính xác
 *   loại hỏng câm mà một hàm chuẩn hoá dùng chung sinh ra để chặn.
 */
export interface HangCanhBaoTho {
  id: number;
  state?: string | null;
  status?: string | null;
  title?: string | null;
  raisedAt?: Date | string | number | null;
  acknowledgedAt?: Date | string | number | null;
  machineId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
}

/**
 * Quy mọi kiểu thời gian về epoch ms. `null` khi không đọc được.
 *
 * ★ Trả `null` chứ KHÔNG trả `0` cho giá trị hỏng: `0` là 1970-01-01, tức tuổi
 *   ~56 năm ⇒ dòng đó nhảy vào "Tồn đọng" với badge "tồn đọng 20000d". Một lỗi
 *   phân tích ngày tháng trở thành một con số trông như dữ liệu thật.
 */
export function docMoc(v: Date | string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

const PHA_HOP_LE: ReadonlySet<string> = new Set(["raised", "acknowledged", "resolved"]);

/**
 * Chuẩn hoá một hàng thô thành {@link CanhBaoDai}.
 *
 * @param workshopId xưởng của cảnh báo — `andon_events` KHÔNG có cột này (đo
 *   được: bảng chỉ có `lineId`/`stationId`/`machineId`), nên người gọi tra từ
 *   cây rồi truyền vào. Để `null` nếu chưa tra được — {@link locTheoPhamVi} vẫn
 *   khớp được qua ba trục còn lại.
 * @param mocDuPhong dùng khi hàng thô không có `raisedAt` đọc được. Người gọi
 *   truyền thời điểm nhận gói. KHÔNG mặc định `Date.now()` bên trong (RB-8.1).
 */
export function chuanHoaHang(
  tho: HangCanhBaoTho,
  mocDuPhong: number,
  workshopId: number | null = null,
): CanhBaoDai {
  const luc = docMoc(tho.raisedAt) ?? mocDuPhong;
  const ack = docMoc(tho.acknowledgedAt);
  const phaTho = (tho.status ?? "").trim().toLowerCase();
  return {
    idNguon: tho.id,
    nguon: "andon",
    muc: chuanHoaMuc(tho.state),
    pha: PHA_HOP_LE.has(phaTho) ? (phaTho as PhaCanhBao) : "raised",
    tieuDe: (tho.title ?? "").trim(),
    luc,
    // Bản mới hơn thắng khi trùng khoá: mốc ack (nếu có) mới là tin tức mới nhất.
    capNhatLuc: ack !== null && ack > luc ? ack : luc,
    machineId: tho.machineId ?? null,
    lineId: tho.lineId ?? null,
    stationId: tho.stationId ?? null,
    workshopId,
  };
}
