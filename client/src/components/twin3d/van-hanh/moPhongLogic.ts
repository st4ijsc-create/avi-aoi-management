/**
 * moPhongLogic.ts — §11 #30 (what-if năng suất) + #35 (phát lại workflow).
 *
 * Tầng THUẦN của ngăn "Mô phỏng". `NganMoPhong.tsx` chỉ VẼ; mọi quyết định
 * "có đủ dữ liệu để chạy không / con số này còn hạn không" nằm ở đây, vì đó là
 * phần duy nhất test được ở `environment: "node"` (RB-8.1, `.unit.test.ts`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO NGĂN NÀY TỒN TẠI — §12b.2 G-2
 * ════════════════════════════════════════════════════════════════════════════
 * Bản thiết kế đã duyệt xếp what-if là *"mặt mô phỏng DUY NHẤT trong cả 4
 * trang — đúng nghĩa digital **twin** chứ không phải digital shadow"*. Mọi thứ
 * khác trên `/twin` trả lời *"nhà máy ĐANG thế nào"*; chỉ ngăn này trả lời
 * *"nhà máy SẼ thế nào nếu…"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI THỦ TỤC, HAI HỒ SƠ RỦI RO KHÁC HẲN NHAU — ĐỌC KỸ TRƯỚC KHI SỬA
 * ════════════════════════════════════════════════════════════════════════════
 *   • `digitalTwin.whatIf` (`digitalTwinRouter.ts:218`) — **hàm thuần, không
 *     chạm CSDL**. Mọi con số nó trả về suy từ chính `input` của người gọi. Nên
 *     nó KHÔNG mang rủi ro tenant, và Q1 cố ý MIỄN TRỪ nó khỏi hàng rào phạm vi
 *     (`digitalTwinRouter.ts:207-216` ghi lý do). ⇒ Ngăn này gửi cái gì lên thì
 *     nhận đúng cái đó về; **rủi ro nằm ở ĐẦU VÀO ta tự dựng**, không ở server.
 *   • `orchestration.simulate` (`orchestrationRouter.ts:243`) — CÓ đọc CSDL
 *     (`orchestration_workflows`, `machines`) và **có cổng quyền**
 *     `machine_monitoring/canView` (`:244`). Ngăn phải ẩn khi thiếu quyền.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G30/G45 — ĐẦU VÀO WHAT-IF PHẢI TỰ CHỨNG MINH ĐƯỢC MÌNH CÒN HẠN
 * ════════════════════════════════════════════════════════════════════════════
 * `whatIf` là hàm thuần: **nó tin tuyệt đối `cycleTimeSec` ta gửi lên** và
 * không có cách nào biết con số ấy 18 ngày tuổi. Nên cửa kiểm hạn phải đứng ở
 * ĐÂY, trước khi gọi — nếu không, ngăn sẽ in ra một bảng năng suất trông rất
 * thuyết phục dựng trên nhịp chuyền của tháng trước. Đúng lớp lỗi mà nghiệm thu
 * Đợt 8 đã trả giá để học (`TwinVanHanh.tsx:1408-1422`: một lời khai
 * `line_balance` 16 ngày tuổi tô đỏ SAI trạm).
 *
 * ⇒ Dùng lại `conHieuLuc` + `HAN_KHAI_NGHEN_MS` của `wipTram.ts` (G12: **đừng
 *   viết bản thứ hai** của luật 8 giờ). Cùng nguồn `wip.lineBalance`, cùng hàng,
 *   nên `avgCycleTimeMs` và `periodStart` chắc chắn thuộc về nhau.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO ĐƯỢC TRÊN CSDL NÀY 2026-09-08 — VÌ SAO HONEST-NULL KHÔNG PHẢI LÝ THUYẾT
 * ════════════════════════════════════════════════════════════════════════════
 *   line_balance_metrics, chuyền 1:  6 hàng, hàng mới nhất `periodStart`
 *                                    2026-08-21 (**18 ngày**), và chính hàng ấy
 *                                    có `avgCycleTimeMs` = **NULL**.
 *   station_dwell_time,   chuyền 1:  12 trạm có số, nhưng mốc mới nhất
 *                                    2026-07-19 / 2026-08-21 (**18–51 ngày**).
 *
 * ⇒ Trên CSDL này, what-if **không có nguồn nhịp còn hạn nào**. Ngăn PHẢI hiện
 *   `—` kèm LÝ DO ĐỌC ĐƯỢC, không được `?? 0` và cũng không được lặng lẽ lấy
 *   một hằng số mặc định — cả hai đều là lời khai sai (G50/G15/NT-3.5).
 *   Đây không phải "chưa làm xong": đây là kết quả ĐO ĐƯỢC của tính năng (G45).
 */

import { conHieuLuc, HAN_KHAI_NGHEN_MS } from "./wipTram";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #30 — WHAT-IF: DỰNG ĐẦU VÀO, VÀ TỪ CHỐI DỰNG KHI KHÔNG ĐỦ                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vì sao ngăn what-if KHÔNG chạy được. Mỗi mã là một câu KHÁC NHAU với người
 * vận hành, và trộn chúng thành một "không có dữ liệu" chung là vứt đi đúng
 * phần thông tin giúp họ biết phải làm gì (G50: ba lớp phủ cùng "rỗng" vì ba
 * lý do khác nhau ⇒ ba hành động khác nhau).
 */
export type LyDoKhongMoPhong =
  /** Phạm vi đang xem không phải một CHUYỀN ⇒ không có tập trạm để mô phỏng. */
  | "chua_chon_line"
  /** Truy vấn nhịp chuyền đang tải hoặc bị từ chối ⇒ chưa biết gì, chưa kết luận. */
  | "chua_do"
  /** Chuyền có trạm nhưng KHÔNG hàng `line_balance` nào ⇒ chưa từng đo nhịp. */
  | "khong_co_ban_ghi"
  /** Có hàng, nhưng `avgCycleTimeMs` NULL ⇒ bản ghi tồn tại mà không mang nhịp. */
  | "ban_ghi_khong_co_nhip"
  /** Có nhịp, nhưng bản ghi quá hạn 8 giờ ⇒ lời khai hết hiệu lực (G30). */
  | "nhip_het_han"
  /** Chuyền không có trạm nào ⇒ `whatIf` đòi `stations.min(1)`. */
  | "khong_co_tram";

/** Một trạm của chuyền đang xem, rút về đúng phần what-if cần. */
export interface TramMoPhong {
  stationId: number;
  ten: string | null;
}

/** Hàng `line_balance` gần nhất — nhịp VÀ mốc của nó, LUÔN đi cùng nhau. */
export interface NhipChuyen {
  /** `avgCycleTimeMs` của hàng. `null` = hàng có nhưng không mang nhịp. */
  avgCycleTimeMs: number | null;
  /** ms epoch của `periodStart`. `null` = không rõ ⇒ không kiểm hạn được. */
  mocKhai: number | null;
}

/**
 * Đầu vào đúng hợp đồng `digitalTwin.whatIf` (`digitalTwinRouter.ts:219-228`).
 * ★ `stations[].cycleTimeSec` là `.positive()` ở zod — nên hàm dựng dưới đây
 *   phải TỪ CHỐI khi nhịp ≤ 0, chứ không gửi lên để server ném 400.
 */
export interface DauVaoWhatIf {
  stations: Array<{ stationId: number; name: string | null; cycleTimeSec: number }>;
  horizonHours: number;
  cycleTimeMultiplier: number;
}

/** Kết quả dựng đầu vào: hoặc chạy được, hoặc một LÝ DO đọc được. */
export type KetQuaDungWhatIf =
  | { chay: true; dauVao: DauVaoWhatIf; tuoiMs: number }
  | { chay: false; lyDo: LyDoKhongMoPhong; tuoiMs: number | null };

export interface ThamSoWhatIf {
  /** `null` khi phạm vi không phải cấp `line`. */
  lineId: number | null;
  tram: readonly TramMoPhong[];
  /** `undefined` = truy vấn chưa xong / bị từ chối; `null` = chạy xong, 0 hàng. */
  nhip: NhipChuyen | null | undefined;
  horizonHours: number;
  cycleTimeMultiplier: number;
  bayGio: number;
}

/**
 * Dựng đầu vào `whatIf` từ trạng thái trang — hoặc từ chối, kèm lý do.
 *
 * ★★★ VÌ SAO HÀM NÀY TRẢ LÝ DO THAY VÌ `null`:
 *   `null` buộc tầng vẽ đoán vì sao, và mọi lần đoán đều ra cùng một câu
 *   "không có dữ liệu" — che mất khác biệt giữa *"anh chưa chọn chuyền"* (người
 *   dùng sửa được trong 1 giây) và *"nhịp chuyền hết hạn 18 ngày"* (phải đi báo
 *   bộ phận số liệu). Hai câu, hai hành động.
 *
 * ★ Thứ tự kiểm là CÓ CHỦ Ý, từ ngoài vào trong: chọn chuyền → có trạm → đã đo
 *   → có bản ghi → bản ghi có nhịp → nhịp còn hạn. Đảo thứ tự sẽ báo "hết hạn"
 *   cho một chuyền chưa hề được chọn.
 */
export function dungDauVaoWhatIf(p: ThamSoWhatIf): KetQuaDungWhatIf {
  if (p.lineId == null) return { chay: false, lyDo: "chua_chon_line", tuoiMs: null };
  if (p.tram.length === 0) return { chay: false, lyDo: "khong_co_tram", tuoiMs: null };
  if (p.nhip === undefined) return { chay: false, lyDo: "chua_do", tuoiMs: null };
  if (p.nhip === null) return { chay: false, lyDo: "khong_co_ban_ghi", tuoiMs: null };

  const tuoiMs =
    p.nhip.mocKhai != null && Number.isFinite(p.nhip.mocKhai)
      ? p.bayGio - p.nhip.mocKhai
      : null;

  const ms = p.nhip.avgCycleTimeMs;
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return { chay: false, lyDo: "ban_ghi_khong_co_nhip", tuoiMs };
  }
  // G30 — cùng cửa 8 giờ với lời khai nút thắt. KHÔNG viết lại luật (G12).
  if (!conHieuLuc(p.nhip.mocKhai, p.bayGio)) {
    return { chay: false, lyDo: "nhip_het_han", tuoiMs };
  }

  /*
   * ★ Nhịp CHUYỀN, không phải nhịp TỪNG TRẠM. `line_balance_metrics` đo theo
   *   chuyền, nên mọi trạm nhận cùng một `cycleTimeSec` — và đó là điều PHẢI
   *   nói ra ở giao diện, vì kết quả `perStation` sẽ trông "cân bằng hoàn hảo"
   *   một cách giả tạo. Ngăn không được để người xem tưởng đó là số đo riêng
   *   của từng trạm.
   * ⚠ CỐ Ý không lấy `station_dwell_time` làm nhịp từng trạm: `dwellMs` gộp cả
   *   `starvedMs`/`blockedMs` (cột có thật trong bảng) — tức là thời gian trạm
   *   ĐỢI, không phải thời gian nó LÀM. Dùng nó làm cycle time là đo nhầm đại
   *   lượng, đúng họ G7 với `commandLog.avgDurations` mà #36 đã mắc.
   */
  const cycleTimeSec = ms / 1000;
  return {
    chay: true,
    tuoiMs: tuoiMs ?? 0,
    dauVao: {
      stations: p.tram.map((t) => ({
        stationId: t.stationId,
        name: t.ten,
        cycleTimeSec,
      })),
      horizonHours: p.horizonHours,
      cycleTimeMultiplier: p.cycleTimeMultiplier,
    },
  };
}

/** Trần của `horizonHours` / `cycleTimeMultiplier` — khớp zod ở router. */
export const HORIZON_MIN = 1;
export const HORIZON_MAX = 720;
export const HE_SO_MIN = 0.1;
export const HE_SO_MAX = 10;

/**
 * Kẹp một tham số người dùng gõ về khoảng zod chấp nhận.
 *
 * ★ Trả `macDinh` cho đầu vào KHÔNG PHẢI SỐ (ô input rỗng cho `NaN`), chứ không
 *   kẹp `NaN` — `Math.min/max` với `NaN` trả `NaN`, và `NaN` đi thẳng qua zod
 *   `.positive()` thành một lỗi 400 khó hiểu ở tận server.
 */
export function kep(gt: number, min: number, max: number, macDinh: number): number {
  if (!Number.isFinite(gt)) return macDinh;
  return Math.min(max, Math.max(min, gt));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #35 — PHÁT LẠI WORKFLOW                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Một bước trên dòng thời gian dự đoán (`SimTimelineEntry`, foeSimulator.ts:58). */
export interface BuocMoPhong {
  stepId: string;
  stepType: string;
  machineId?: number;
  command?: string;
  startMs: number;
  endMs: number;
  status: string;
  note?: string;
}

/** Một bước ĐÃ ĐẶT vào khung phát lại — kèm phần trăm để vẽ thanh. */
export interface BuocPhatLai extends BuocMoPhong {
  /** Vị trí trái của thanh, % tổng thời lượng. */
  traiPhanTram: number;
  /** Bề rộng thanh, % tổng thời lượng. Luôn > 0 để bước 0 ms vẫn thấy được. */
  rongPhanTram: number;
  /** Bước này đã chạy xong tại `mocMs` chưa. */
  daChay: boolean;
  /** Bước này đang chạy tại `mocMs`. */
  dangChay: boolean;
}

/**
 * Đặt các bước lên khung phát lại tại mốc `mocMs`.
 *
 * ★★★ `rongPhanTram` CÓ SÀN, VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH ĐO ĐƯỢC:
 *   `orchestration.simulate` để `gateMs` mặc định **0** cho `hitl_gate`
 *   (`orchestrationRouter.ts:257` cho phép chỉnh, mặc định 0 ở `foeSimulator`).
 *   Một bước 0 ms cho bề rộng 0 % ⇒ **biến mất khỏi màn hình**. Người xem sẽ
 *   kết luận workflow không có cổng duyệt nào — trong khi nó có, và đó chính là
 *   bước quan trọng nhất để nhìn. Sàn 0,5 % giữ nó thấy được mà không nói dối
 *   về thời lượng (nhãn vẫn in số ms thật).
 *
 * ★ `tongMs <= 0` (workflow toàn bước tức thời): chia đều thay vì chia cho 0.
 *   Không có `Infinity`/`NaN` nào được rời hàm này — chúng sẽ thành
 *   `width: NaN%` và CSS bỏ qua trong im lặng, tức là hỏng câm.
 */
export function datBuocPhatLai(
  buoc: readonly BuocMoPhong[],
  tongMs: number,
  mocMs: number,
): BuocPhatLai[] {
  const n = buoc.length;
  if (n === 0) return [];
  const SAN = 0.5;

  /*
   * ★★★ CÙNG cửa `coThoiLuong` với `mocBuocKeTiep` — MỘT nguồn quyết định chế
   *   độ (G12). Nếu hai hàm này dùng hai luật khác nhau thì nút ►/◄ đi theo chỉ
   *   số trong khi thanh tô màu theo mili giây: bấm nút thấy con số đổi mà
   *   KHÔNG thanh nào sáng lên. Hỏng câm, và rất khó lần ra.
   */
  const theoThoiGian = coThoiLuong(buoc, tongMs);

  return buoc.map((b, i) => {
    const trai = theoThoiGian ? (b.startMs / tongMs) * 100 : (i / n) * 100;
    const rong = theoThoiGian
      ? Math.max(SAN, ((b.endMs - b.startMs) / tongMs) * 100)
      : 100 / n;
    return {
      ...b,
      traiPhanTram: Math.max(0, Math.min(100, trai)),
      rongPhanTram: Math.max(SAN, Math.min(100, rong)),
      /*
       * ★ `endMs <= mocMs` chứ không `<`: một bước kết thúc ĐÚNG tại mốc đang
       *   xem đã chạy xong rồi. Với `<`, bước cuối không bao giờ được đánh dấu
       *   xong khi kéo con trượt tới hết — thanh chạy tới cuối mà vẫn báo "đang
       *   chạy", và không assertion nào về "hàm có được gọi không" bắt được.
       *
       * ★ Chế độ theo BƯỚC: `mocMs` là CHỈ SỐ, nên so với `i` chứ không với
       *   `endMs` (mọi `endMs` đều bằng 0 ⇒ so kiểu kia cho MỌI bước "đã chạy"
       *   ngay tại mốc 0 — thanh xanh hết từ đầu, con trượt vô nghĩa).
       */
      daChay: theoThoiGian ? b.endMs <= mocMs : i < mocMs,
      dangChay: theoThoiGian ? b.startMs <= mocMs && b.endMs > mocMs : i === mocMs,
    };
  });
}

/**
 * Dòng thời gian này có mang THÔNG TIN THỜI LƯỢNG không.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO ĐƯỢC 2026-09-08 — **4/5 WORKFLOW THẬT TRẢ `totalDurationMs = 0`**
 * ════════════════════════════════════════════════════════════════════════════
 * Chạy `orchestration.simulate` trên cả 5 hàng `orchestration_workflows`:
 *
 *     Line-a-startup            total 34000  4 bước  (command/parallel/wait_state)
 *     qt-1-order-production     total     0  6 bước  (TOÀN hitl_gate)
 *     qt-2-quality-closed-loop  total     0  4 bước  (TOÀN hitl_gate)
 *     qt-3-material-replenish.  total     0  3 bước  (TOÀN hitl_gate)
 *     qt-4-changeover-npi       total     0  5 bước  (TOÀN hitl_gate)
 *
 * Đây **KHÔNG phải lỗi** của `simulate`: `gateMs` mặc định **0** là có chủ ý và
 * đúng (`foeSimulator.ts:680`, docblock `:127` ghi *"the human pause is 0 in sim
 * by default"*). Một cổng chờ NGƯỜI không có thời lượng đoán được — bịa ra một
 * con số cho nó chính là thứ lô này cấm.
 *
 * ⇒ Nhưng hệ quả với giao diện thì nghiêm trọng: một workflow **5 bước có thật**
 *   in ra `0.0s / 0.0s`, đọc y hệt *"workflow rỗng"*. Và mọi biên `startMs` gộp
 *   về đúng một giá trị `0`, nên nút ►/◄ **không đi đâu được** — chết đúng kiểu
 *   G32 `f(x) = x`, trên **4/5 dữ liệu thật**.
 *
 * ⇒ Nên tầng này phải PHÂN BIỆT hai chế độ, và nói ra chế độ đang dùng:
 *     • **theo THỜI GIAN** — có thời lượng thật, biên là `startMs`;
 *     • **theo BƯỚC**      — thời lượng không mang thông tin, biên là CHỈ SỐ.
 *   Trình bày `0.0s` như một phép đo trong chế độ thứ hai là lời khai sai.
 */
export function coThoiLuong(buoc: readonly BuocMoPhong[], tongMs: number): boolean {
  if (!Number.isFinite(tongMs) || tongMs <= 0) return false;
  /*
   * ★ KHÔNG bước nào ⇒ chỉ còn `tongMs` để đi theo, và nó hợp lệ. Chế độ BƯỚC
   *   trên một mảng rỗng cho tập biên RỖNG, tức con trượt chết hẳn — tệ hơn
   *   đúng thứ bản vá này đi sửa. (Ô lưới "mảng rỗng vẫn đi được" bắt được ca
   *   này ngay trong lượt vá — chính là lý do nó được viết.)
   */
  if (buoc.length === 0) return true;
  // Có tổng > 0 nhưng mọi bước dài 0 ⇒ vẫn không so sánh được bước với bước.
  return buoc.some((b) => Number.isFinite(b.endMs - b.startMs) && b.endMs > b.startMs);
}

/**
 * Mốc kế tiếp khi bấm ►/◄ — **về BIÊN bước**, không cộng một delta cố định.
 *
 * ★★★ ĐÂY LÀ LUẬT ĐÃ TRẢ GIÁ Ở LÔ L (`mocTheoBuoc`, §11g.4): cộng thô không bao
 *   giờ đặt chân lên biên tròn, nên có những bước **không bao giờ tới được bằng
 *   bàn phím**. Ở đây biên là `startMs` của từng bước, nên nhảy phải ĐI TỚI
 *   biên gần nhất theo hướng, và phải DI TRỌN Ô (nếu đang đứng đúng trên biên
 *   thì đi sang biên kế) — nếu không thì `f(x) = x` và nút bấm không làm gì
 *   (G32).
 *
 * ★★★ CHẾ ĐỘ THEO BƯỚC (`coThoiLuong` = false): biên là **CHỈ SỐ bước**, không
 *   phải `startMs`. Trên 4/5 workflow thật mọi `startMs` đều bằng 0, nên tập
 *   biên gộp về `[0]` và nút bấm CHẾT — đúng lớp G32, và **chỉ trình duyệt thật
 *   bắt được** (1.694 lưới đơn vị đều xanh). Xem `coThoiLuong` ở trên.
 */
export function mocBuocKeTiep(
  buoc: readonly BuocMoPhong[],
  mocMs: number,
  huong: 1 | -1,
  tongMs: number,
): number {
  // Chế độ theo BƯỚC — mốc mang nghĩa "chỉ số bước", không phải mili giây.
  const theoThoiGian = coThoiLuong(buoc, tongMs);
  const bien = theoThoiGian
    ? [...new Set([0, ...buoc.map((b) => b.startMs), tongMs])]
    : buoc.map((_, i) => i);

  const sap = bien.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (sap.length === 0) return mocMs;

  if (huong === 1) {
    const kt = sap.find((x) => x > mocMs);
    return kt ?? sap[sap.length - 1];
  }
  const truoc = [...sap].reverse().find((x) => x < mocMs);
  return truoc ?? sap[0];
}

/**
 * Tuổi một lời khai, rút về **ĐƠN VỊ + SỐ** — KHÔNG phải chuỗi đã dịch sẵn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẢN ĐẦU TRẢ CHUỖI TIẾNG VIỆT CỨNG, VÀ **ẢNH TỰ CHỤP BẮT ĐƯỢC**
 * ════════════════════════════════════════════════════════════════════════════
 * Nó trả thẳng `"17 ngày"`, rồi tầng vẽ ghép vào khuôn `"{{tuoi}} ago"` của
 * bản tiếng Anh ⇒ màn hình in **"(17 ngày ago)"**. Cả `tsc`, cả 36 lưới đơn vị,
 * cả 3 ca Playwright đều XANH — vì không ô nào hỏi *"chuỗi này thuộc ngôn ngữ
 * nào"*. Chỉ khi TỰ ĐỌC ảnh chụp mới lộ.
 *
 * ⇒ Module thuần KHÔNG được sinh chữ cho người đọc. Nó trả dữ liệu; `t()` ở
 *   tầng vẽ mới biết ngôn ngữ. Đây cũng là lý do hàm này không nhận `t` vào —
 *   nhận `t` là kéo i18next vào một module phải chạy ở `environment: "node"`.
 */
export interface TuoiDaRut {
  so: number;
  donVi: "phut" | "gio" | "ngay";
}

export function nhanTuoi(tuoiMs: number | null): TuoiDaRut | null {
  if (tuoiMs == null || !Number.isFinite(tuoiMs) || tuoiMs < 0) return null;
  const phut = Math.floor(tuoiMs / 60_000);
  if (phut < 60) return { so: phut, donVi: "phut" };
  const gio = Math.floor(phut / 60);
  if (gio < 24) return { so: gio, donVi: "gio" };
  return { so: Math.floor(gio / 24), donVi: "ngay" };
}

/** Hạn hiệu lực dùng cho what-if — CÙNG hằng số với lời khai nút thắt (G12). */
export { HAN_KHAI_NGHEN_MS };
