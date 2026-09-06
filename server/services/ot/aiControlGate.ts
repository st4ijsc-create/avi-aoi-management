/**
 * L-7 — HÀNG RÀO RIÊNG CHO TÁC NHÂN AI (AI control gate)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * TẠI SAO CÓ TỆP NÀY
 * ------------------
 * `commandDispatcher.ts` là hàng rào rất tốt — **cho NGƯỜI**. Nó trả lời câu
 * *"lệnh này có được phép không?"*. Nó KHÔNG trả lời câu *"tại sao lại có 40
 * lệnh trong 10 giây?"* — grep `rate.limit|throttle` trên tệp đó = **0**.
 * Và ở dòng 660 nó cố ý **fail-OPEN**: `safety === "UNKNOWN"` ⇒ cho qua + cảnh
 * báo. Với một người đứng cạnh máy, fail-open là ĐÚNG (UNKNOWN ≠ BLOCKED, và
 * người có mắt). Với một tác nhân AI ở xa, fail-open là SAI.
 *
 * Quyết định kiến trúc (chủ dự án đã chốt): **KHÔNG đổi một dòng hành vi nào
 * của dispatcher cho người.** Thay vào đó dựng MỘT lớp cổng RIÊNG, đặt TRƯỚC
 * dispatcher, và mọi tool AI phải đi qua nó. Người đi đường cũ, AI đi đường
 * mới và hẹp hơn.
 *
 * TRỤC PHÂN LOẠI = HƯỚNG NĂNG LƯỢNG, KHÔNG PHẢI "ĐỌC/GHI"
 * -------------------------------------------------------
 * Trục "đọc/ghi" phân loại SAI: `machine_stop` là một lệnh GHI, nhưng nó làm
 * máy AN TOÀN HƠN. `machine_start` cũng là một lệnh GHI, nhưng nó làm trục
 * quay. Hai lệnh cùng "ghi" mà ngược nhau hoàn toàn về hậu quả. Trục đúng là
 * **năng lượng đi vào hay đi ra khỏi hệ**:
 *
 *   Mức 1 — GIẢM năng lượng (stop, pause). Cho phép, vẫn ghi nhật ký.
 *   Mức 3 — GHI THAM SỐ không-an-toàn. Cho phép có điều kiện (cờ + trần + safety).
 *   Mức 4 — TĂNG năng lượng (start, reset). ★ CHẶN CỨNG cho AI.
 *   Mức 5 — Chuyển động vật lý / tham số an toàn / interlock. ★ CHẶN CỨNG.
 *
 * FAIL-CLOSED — NGƯỢC HẲN DISPATCHER
 * ----------------------------------
 * `phanLoaiMuc()` trả về **5 (chặn)** cho BẤT CỨ THỨ GÌ nó không nhận ra. Một
 * tool mới được thêm vào ngày mai, chưa ai kịp phân loại, sẽ bị chặn — chứ
 * không lọt qua. Đây là điểm khác biệt cốt lõi so với dispatcher, và là lý do
 * bảng tra phải là danh sách TRẮNG, không bao giờ là danh sách ĐEN.
 *
 * KHÔNG import `node:fs`. KHÔNG ghi tệp. KHÔNG gọi DB. Hàm thuần, đồng hồ tiêm
 * được ⇒ test chạy không cần sleep, không cần môi trường.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Kiểu
// ─────────────────────────────────────────────────────────────────────────────

/** Mức rủi ro theo HƯỚNG NĂNG LƯỢNG. 1 = giảm năng lượng … 5 = chuyển động vật lý. */
export type MucRuiRo = 1 | 3 | 4 | 5;

/**
 * Trạng thái safety-PLC, nhận QUA THAM SỐ (không gọi thẳng adapter facade —
 * giữ hàm thuần và test được). Cùng bộ giá trị mà `preflightSafety()` trong
 * commandDispatcher trả về.
 */
export type TrangThaiSafety = "OK" | "BLOCKED" | "UNKNOWN";

export interface DauVaoCongAi {
  /** Tên tool AI, đúng như đã đăng ký trong toolRegistry. */
  toolName: string;
  /** Tag đích, nếu tool có chọn tag (chỉ `set_machine_param` cho model tự chọn). */
  tagKey?: string | null;
  /** Người dùng phiên THẬT (ToolExecContext.user.id) — khoá trần tần suất. */
  userId: number;
  /** Adapter đích — khoá trần tần suất (mỗi adapter một quota riêng). */
  adapterId: number;
  /** Trạng thái safety-PLC đã đọc sẵn. VẮNG ⇒ coi như UNKNOWN ⇒ TỪ CHỐI. */
  safety?: TrangThaiSafety;
  /** Đồng hồ tiêm được. Mặc định `Date.now`. Test truyền hàm giả để không sleep. */
  now?: () => number;
  /** Môi trường tiêm được. Mặc định `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Bộ đếm tần suất tiêm được. VẮNG ⇒ dùng bộ đếm dùng-chung của tiến trình.
   * Test truyền bộ đếm riêng để các ca không nhiễm nhau.
   */
  boDem?: BoDemTanSuat;
  /**
   * `false` ⇒ chỉ CHẤM ĐIỂM, không tiêu quota (dùng cho preview / dry-run).
   * Mặc định `true` (một lần gọi = một lệnh đã tiêu).
   */
  tieuQuota?: boolean;
}

export interface KetQuaCongAi {
  choPhep: boolean;
  /** Lý do bằng tiếng Việt, đủ rõ để model HIỂU và KHÔNG thử lại vòng lặp. */
  lyDo: string;
  muc: MucRuiRo;
  /** Mã máy-đọc-được, để test và nhật ký bám vào (đừng bám vào chuỗi tiếng Việt). */
  ma: MaTuChoi | "CHO_PHEP";
}

export type MaTuChoi =
  | "MUC_QUA_CAO"
  | "CO_TAT"
  | "VUOT_TRAN_TAN_SUAT"
  | "SAFETY_KHONG_XAC_DINH"
  | "SAFETY_CHAN";

// ─────────────────────────────────────────────────────────────────────────────
// T1a — Bảng tra tĩnh. DANH SÁCH TRẮNG. Mặc định = 5.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ Bảng tra CHỈ chứa những tool đã được phân loại có chủ đích. Thiếu tên trong
 * bảng này KHÔNG có nghĩa là "chắc an toàn" — nó có nghĩa là "chưa ai xét" ⇒
 * mức 5 ⇒ chặn.
 *
 * Ghi chú từng dòng — vì sao mức đó, không phải mức khác:
 *
 *  machine_stop  (1) GIẢM năng lượng. Xấu nhất khi AI gọi nhầm: dừng oan một
 *                    máy đang chạy tốt — thiệt hại SẢN LƯỢNG, không phải NGƯỜI.
 *  machine_pause (1) như trên.
 *
 *  set_yield_threshold (3) không chạm PLC (ghi bảng ngưỡng cảnh báo). Nhưng nó
 *                    ĐỔI ngưỡng mà con người dựa vào để phát hiện sự cố ⇒ vẫn
 *                    phải qua cổng + nhật ký, không thả tự do.
 *  set_machine_param (3) CHỈ khi tag không nằm trong tập tag-an-toàn. Việc nâng
 *                    lên 5 cho tag an toàn do `phanLoaiMuc` làm bên dưới.
 *
 *  machine_start (4) TĂNG năng lượng — trục bắt đầu quay. Không có cách nào để
 *                    AI biết chắc không có tay người trong máy.
 *  machine_reset (4) reset xoá chốt lỗi ⇒ máy có thể tự chạy lại NGAY. Về hậu
 *                    quả, reset là một start có độ trễ.
 *
 *  reject_divert (5) ★ CHUYỂN ĐỘNG VẬT LÝ (cần gạt phôi). Brief giao việc KHÔNG
 *                    liệt kê tool này, nhưng nó CÓ đăng ký và CÓ tới dispatch()
 *                    (visionControl.ts:187). Bỏ sót nó = để hở đúng thứ mục 5.1
 *                    của bản thiết kế cấm tuyệt đối.
 *  spi_printer_offset (5) đổi offset máy in kem hàn — chuyển động đầu in.
 *  select_recipe (5) nạp recipe = thay TOÀN BỘ tập tham số máy một lần, gồm cả
 *                    tham số an toàn nằm trong recipe. Không kiểm điểm được.
 *  download_job  (5) nạp chương trình xuống máy — cùng lớp với nạp PLC.
 *  acknowledge_machine_alarm (5) ack cảnh báo = XOÁ tín hiệu mà con người đang
 *                    dùng để biết máy có vấn đề. AI ack tự động ⇒ mù thông tin.
 */
const BANG_TRA: Readonly<Record<string, MucRuiRo>> = Object.freeze({
  // ── Mức 1 — GIẢM năng lượng ────────────────────────────────────────────────
  machine_stop: 1,
  machine_pause: 1,
  // ── Mức 3 — ghi tham số không-an-toàn ──────────────────────────────────────
  set_yield_threshold: 3,
  set_machine_param: 3,
  // ── Mức 4 — TĂNG năng lượng ⇒ chặn cứng ────────────────────────────────────
  machine_start: 4,
  machine_reset: 4,
  // ── Mức 5 — chuyển động vật lý / thay cả tập tham số ⇒ chặn cứng ───────────
  reject_divert: 5,
  spi_printer_offset: 5,
  select_recipe: 5,
  download_job: 5,
  acknowledge_machine_alarm: 5,
});

/**
 * Khuôn tên tag ĐƯỢC COI LÀ AN TOÀN-QUAN-TRỌNG. Một tag khớp bất kỳ khuôn nào
 * ⇒ nâng thẳng lên mức 5, dù tool gọi nó là mức 3.
 *
 * ⚠ Đây là danh sách ĐEN, và danh sách đen thì KHÔNG BAO GIỜ đủ. Nó là lớp
 * phòng thủ THỨ HAI, không phải lớp thứ nhất. Lớp thứ nhất đúng là một danh
 * sách TRẮNG tag-cho-phép trong CSDL (mục 4.1 bản thiết kế) — chưa có bảng đó,
 * nên tạm thời `set_machine_param` vẫn rộng hơn mức mong muốn. Xem "MỐI LO CÒN
 * LẠI" trong báo cáo L-7.
 */
const KHUON_TAG_AN_TOAN: readonly RegExp[] = Object.freeze([
  /safety/i,
  /estop|e_stop|emergency/i,
  /interlock/i,
  /guard/i,
  /light[_-]?curtain|curtain/i,
  /door[_-]?lock|doorlock/i,
  /watchdog/i,
  /muting|mute[_-]?safety/i,
  /torque[_-]?limit|speed[_-]?limit|limit[_-]?override/i,
  /robot[_-]?(move|jog|motion|pos)/i,
]);

/** Tag có phải tag an-toàn-quan-trọng không? (dùng cho nâng mức) */
export function laTagAnToan(tagKey: string | null | undefined): boolean {
  if (typeof tagKey !== "string" || tagKey.length === 0) return false;
  return KHUON_TAG_AN_TOAN.some((re) => re.test(tagKey));
}

/**
 * T1a — Phân loại mức rủi ro.
 *
 * ★★★ MẶC ĐỊNH LÀ 5. Đây là cả điểm của hàm này. Đừng bao giờ đổi `?? 5` thành
 * một giá trị thấp hơn "cho tiện" — làm thế biến danh sách trắng thành danh
 * sách đen và vô hiệu hoá toàn bộ lớp cổng.
 */
export function phanLoaiMuc(toolName: string, tagKey?: string | null): MucRuiRo {
  // Đầu vào không phải chuỗi dùng được ⇒ không nhận ra ⇒ 5.
  if (typeof toolName !== "string" || toolName.length === 0) return 5;

  const co = Object.prototype.hasOwnProperty.call(BANG_TRA, toolName);
  const muc: MucRuiRo = co ? BANG_TRA[toolName] : 5;

  // Nâng mức: tag an-toàn-quan-trọng thì KHÔNG BAO GIỜ dưới 5, dù tool mức mấy.
  if (laTagAnToan(tagKey)) return 5;

  return muc;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1b — Trần tần suất (bộ đếm cửa sổ trượt, trong bộ nhớ)
// ─────────────────────────────────────────────────────────────────────────────

/** Số lệnh AI tối đa trong một cửa sổ, cho mỗi cặp (người dùng, adapter). */
export const TRAN_MAC_DINH = 5;
/** Độ dài cửa sổ (ms). */
export const CUA_SO_MAC_DINH_MS = 60_000;

/**
 * Bộ đếm cửa sổ trượt. Trong bộ nhớ, mỗi tiến trình một bản.
 *
 * ⚠ HẠN CHẾ ĐÃ BIẾT, nói thẳng: trần này KHÔNG dùng chung giữa nhiều tiến
 * trình. Chạy N bản sao máy chủ ⇒ trần thực tế là N × trần. Trần đúng phải ở
 * CSDL hoặc Redis. Bản trong-bộ-nhớ này chặn được đúng thứ nó nhắm tới — một
 * model quay vòng lặp trong MỘT phiên — và không chặn được nhiều hơn thế.
 */
export class BoDemTanSuat {
  private readonly moc = new Map<string, number[]>();

  constructor(
    readonly tran: number = TRAN_MAC_DINH,
    readonly cuaSoMs: number = CUA_SO_MAC_DINH_MS,
  ) {}

  private static khoa(userId: number, adapterId: number): string {
    return `${userId}::${adapterId}`;
  }

  /** Số lệnh còn nằm trong cửa sổ tại thời điểm `tNow` (đã dọn cái hết hạn). */
  demTrongCuaSo(userId: number, adapterId: number, tNow: number): number {
    const k = BoDemTanSuat.khoa(userId, adapterId);
    const arr = this.moc.get(k);
    if (!arr) return 0;
    const nguong = tNow - this.cuaSoMs;
    // Dọn tại chỗ: mốc cũ hơn cửa sổ thì không còn tính.
    const con = arr.filter((t) => t > nguong);
    if (con.length === 0) this.moc.delete(k);
    else this.moc.set(k, con);
    return con.length;
  }

  /** Đã chạm trần chưa? (chỉ đọc, KHÔNG tiêu quota) */
  daChamTran(userId: number, adapterId: number, tNow: number): boolean {
    return this.demTrongCuaSo(userId, adapterId, tNow) >= this.tran;
  }

  /** Ghi nhận một lệnh đã tiêu quota. */
  ghiNhan(userId: number, adapterId: number, tNow: number): void {
    const k = BoDemTanSuat.khoa(userId, adapterId);
    const arr = this.moc.get(k) ?? [];
    arr.push(tNow);
    this.moc.set(k, arr);
  }

  /** Xoá sạch — chỉ dùng trong test. */
  xoaHet(): void {
    this.moc.clear();
  }
}

/** Bộ đếm dùng-chung của tiến trình (khi lời gọi không tiêm bộ đếm riêng). */
const boDemChung = new BoDemTanSuat();

/** Chỉ dùng trong test — trả về bộ đếm dùng-chung để dọn giữa các ca. */
export function boDemChungChoTest(): BoDemTanSuat {
  return boDemChung;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1c — Cờ RIÊNG cho AI
// ─────────────────────────────────────────────────────────────────────────────

/** Tên cờ. RIÊNG BIỆT với `OT_CONTROL_ENABLED` — bật cái kia KHÔNG bật cái này. */
export const CO_AI_OT = "AI_OT_CONTROL_ENABLED";

/**
 * Cờ có bật không. Mặc định TẮT: chỉ đúng chuỗi `"true"` mới là bật.
 * Vắng mặt / rỗng / `"1"` / `"TRUE"` / `"yes"` đều là TẮT — cố ý nghiêm ngặt,
 * để không ai bật nhầm cổng ghi thiết bị bằng một lỗi chính tả.
 */
export function coAiOtBat(env: Record<string, string | undefined> = process.env): boolean {
  return env[CO_AI_OT] === "true";
}

// ─────────────────────────────────────────────────────────────────────────────
// T1d — Chuỗi kiểm chính
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cổng cho tác nhân AI. Gọi TRƯỚC mọi lối tới `dispatch()`.
 *
 * Thứ tự kiểm CÓ CHỦ ĐÍCH — rẻ và tuyệt đối trước, đắt và có điều kiện sau:
 *   1. Mức ≥ 4 ⇒ từ chối. Không cờ nào, không quyền nào mở được. Kiểm TRƯỚC cả
 *      cờ, để một `machine_start` bị từ chối vì ĐÚNG lý do ("AI không được
 *      tăng năng lượng"), chứ không phải vì lý do phụ ("cờ đang tắt") —
 *      thông điệp sai sẽ dạy model đi xin bật cờ.
 *   2. Cờ `AI_OT_CONTROL_ENABLED` phải === "true".
 *   3. Trần tần suất theo (người dùng, adapter).
 *   4. Safety-PLC: `UNKNOWN` ⇒ TỪ CHỐI (★ ngược dispatcher dòng 660),
 *      `BLOCKED` ⇒ TỪ CHỐI.
 *
 * Quota chỉ bị tiêu khi TẤT CẢ kiểm đều qua — một lệnh bị chặn không được ăn
 * mất suất của một lệnh hợp lệ sau đó.
 */
export function kiemCongAi(input: DauVaoCongAi): KetQuaCongAi {
  const muc = phanLoaiMuc(input.toolName, input.tagKey);
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now;
  const boDem = input.boDem ?? boDemChung;
  const tieuQuota = input.tieuQuota !== false;

  // ── (1) Mức ≥ 4 — chặn cứng, không cờ nào mở được ─────────────────────────
  if (muc >= 4) {
    const viSao =
      muc === 4
        ? `lệnh này LÀM TĂNG năng lượng của máy (trục có thể bắt đầu chuyển động)`
        : `lệnh này gây CHUYỂN ĐỘNG VẬT LÝ hoặc chạm tham số an toàn/interlock`;
    return {
      choPhep: false,
      muc,
      ma: "MUC_QUA_CAO",
      lyDo:
        `TỪ CHỐI VĨNH VIỄN — tool "${input.toolName}" ở Mức ${muc}: ${viSao}. ` +
        `Tác nhân AI KHÔNG BAO GIỜ được gửi lệnh Mức 4 trở lên, ` +
        `bất kể cấu hình, quyền hạn hay cờ môi trường. ` +
        `ĐỪNG THỬ LẠI — không có tham số nào, không có lần thử nào làm lệnh này được chấp nhận. ` +
        `Hãy trình bày đề xuất cho người vận hành để họ tự bấm nút.`,
    };
  }

  // ── (2) Cờ riêng cho AI ───────────────────────────────────────────────────
  if (!coAiOtBat(env)) {
    return {
      choPhep: false,
      muc,
      ma: "CO_TAT",
      lyDo:
        `TỪ CHỐI — cổng điều khiển thiết bị dành cho AI đang TẮT (${CO_AI_OT} ≠ "true"). ` +
        `Đây là một cờ RIÊNG, độc lập với OT_CONTROL_ENABLED: cổng cho người mở ` +
        `KHÔNG mở cổng cho AI. ĐỪNG THỬ LẠI trong phiên này — chỉ người quản trị ` +
        `mới bật được cờ này, và AI không có cách nào tự bật.`,
    };
  }

  // ── (3) Trần tần suất ─────────────────────────────────────────────────────
  const tNow = now();
  const dem = boDem.demTrongCuaSo(input.userId, input.adapterId, tNow);
  if (dem >= boDem.tran) {
    const giay = Math.round(boDem.cuaSoMs / 1000);
    return {
      choPhep: false,
      muc,
      ma: "VUOT_TRAN_TAN_SUAT",
      lyDo:
        `TỪ CHỐI — vượt trần tần suất: đã có ${dem}/${boDem.tran} lệnh trong ` +
        `${giay} giây vừa qua cho người dùng #${input.userId} trên adapter #${input.adapterId}. ` +
        `ĐỪNG THỬ LẠI NGAY — thử lại lập tức chỉ làm hỏng thêm. ` +
        `Hãy DỪNG chuỗi lệnh, báo cáo tình hình cho người vận hành và chờ họ quyết định.`,
    };
  }

  // ── (4) Safety-PLC — fail-CLOSED cho AI ───────────────────────────────────
  const safety: TrangThaiSafety = input.safety ?? "UNKNOWN";
  if (safety === "BLOCKED") {
    return {
      choPhep: false,
      muc,
      ma: "SAFETY_CHAN",
      lyDo:
        `TỪ CHỐI — safety-PLC đang báo BLOCKED (có điều kiện an toàn đang kích hoạt: ` +
        `E-stop, cửa mở, rèm sáng bị cắt, hoặc interlock). ĐỪNG THỬ LẠI — ` +
        `chỉ người vận hành tại chỗ mới xử lý và giải trừ được trạng thái này.`,
    };
  }
  if (safety !== "OK") {
    return {
      choPhep: false,
      muc,
      ma: "SAFETY_KHONG_XAC_DINH",
      lyDo:
        `TỪ CHỐI — không đọc được trạng thái safety-PLC (UNKNOWN: chưa cấu hình ` +
        `safety-PLC, hoặc lần đọc vừa rồi thất bại). Với người vận hành, UNKNOWN ` +
        `được cho qua kèm cảnh báo vì người có mắt nhìn máy; với tác nhân AI thì KHÔNG — ` +
        `AI không có cách nào biết trong máy có người hay không. ` +
        `ĐỪNG THỬ LẠI — hãy báo người vận hành kiểm tra cấu hình safety-PLC.`,
    };
  }

  // ── Qua hết ⇒ tiêu một suất quota ─────────────────────────────────────────
  if (tieuQuota) boDem.ghiNhan(input.userId, input.adapterId, tNow);

  return {
    choPhep: true,
    muc,
    ma: "CHO_PHEP",
    lyDo: `Cho phép — Mức ${muc}, cờ ${CO_AI_OT} bật, trong trần tần suất (${dem + 1}/${boDem.tran}), safety-PLC = OK.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 — `acked_unverified` nghiêm khắc hơn cho AI
// ─────────────────────────────────────────────────────────────────────────────

/** Chỉ phần kết quả dispatcher mà lớp bao ngoài này quan tâm. */
export interface KetQuaDispatchToiThieu {
  ok: boolean;
  status?: string;
  reason?: string | null;
  [k: string]: unknown;
}

/**
 * T3 — Với AI, `acked_unverified` KHÔNG PHẢI thành công.
 *
 * Dispatcher (dòng 807/819) đặt `status='acked_unverified'` khi đọc lại không
 * khớp giá trị vừa ghi, nhưng vẫn để `ok=true` — chỉ CẢNH BÁO. Với người, đó
 * là lựa chọn đúng: người nhìn thấy cảnh báo và tự phán đoán.
 *
 * Một model không "nhìn thấy cảnh báo"; nó đọc `ok`. `ok=true` sau một lần ghi
 * KHÔNG xác nhận được sẽ dạy model rằng lệnh đã có hiệu lực — rồi nó bước tiếp
 * sang lệnh sau dựa trên một trạng thái máy mà nó tưởng tượng ra.
 *
 * Hàm này KHÔNG đổi ngữ nghĩa dispatcher. Nó bọc BÊN NGOÀI, chỉ trên đường AI:
 * trả về một BẢN SAO với `ok=false`. Đường của người không gọi hàm này.
 */
export function siriengChoAi<T extends KetQuaDispatchToiThieu>(ketQua: T): T {
  if (ketQua == null || typeof ketQua !== "object") return ketQua;
  if (ketQua.status !== "acked_unverified") return ketQua;
  if (ketQua.ok === false) return ketQua; // đã false rồi, giữ nguyên (kể cả reason)

  return {
    ...ketQua,
    ok: false,
    reason:
      ketQua.reason ??
      "READBACK_KHONG_XAC_NHAN: lệnh đã được máy nhận (acked) nhưng đọc lại KHÔNG khớp " +
        "giá trị vừa ghi. Với tác nhân AI đây là THẤT BẠI, không phải cảnh báo — " +
        "KHÔNG được coi như đã có hiệu lực và KHÔNG được bước tiếp dựa trên nó.",
  };
}

/**
 * Tiện ích cho tool: dựng một `ToolExecuteResult`-shaped từ chối, để tool trả
 * thẳng về cho model. Giữ ở đây để 6+ tool không chép lại cùng một đoạn.
 */
export function ketQuaTuChoiChoTool(
  ketQua: KetQuaCongAi,
  toolName: string,
): {
  type: "action_result";
  title: string;
  data: { ok: false; rejected: true; ma: string; muc: MucRuiRo; lyDo: string };
  textSummary: string;
  note: string;
} {
  return {
    type: "action_result",
    title: `Cổng AI TỪ CHỐI lệnh "${toolName}" (Mức ${ketQua.muc})`,
    data: { ok: false, rejected: true, ma: ketQua.ma, muc: ketQua.muc, lyDo: ketQua.lyDo },
    textSummary: `${toolName} → TỪ CHỐI BỞI CỔNG AI (${ketQua.ma})`,
    note: ketQua.lyDo,
  };
}
