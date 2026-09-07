/**
 * wipTram.ts — §11 #61 + #32 + #36: **WIP THEO TRẠM, NÚT THẮT, VÀ NHỊP CHUYỀN**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — L-2 CỦA ĐỢT 7 ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * `CanhVanHanh.tsx` đã có đủ `OngWip` (InstancedMesh, màu nghẽn, RB-7 dispose) và
 * đã render nó. Nhưng chỗ gọi DUY NHẤT truyền `wip={[]}` — một **hằng rỗng viết
 * cứng** — và `OngWip` `return null` khi rỗng. Nghĩa là lớp phủ chạy qua `check`,
 * qua `build`, qua 994 test, và **chưa bao giờ vẽ một pixel nào**.
 *
 * Đó là G5 nguyên bản: *cổng xanh trên tập rỗng trùng khít cổng xanh của hệ
 * đúng*. Phần thiếu không phải mã vẽ — mà là **phép quy từ số WIP ra hình học**.
 * Nó nằm ở đây, THUẦN (RB-8.1), để test được mà không cần WebGL, và để không ai
 * viết bản chép tay thứ hai cho bảng 2D (G12).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỘT PHÉP TÍNH, HAI BỀ MẶT — ĐIỀU KIỆN §11.5
 * ════════════════════════════════════════════════════════════════════════════
 * §11.5 bắt: *mọi lớp phủ màu trên 3D phải có bảng xếp hạng 2D song song*. Lý do
 * là một giới hạn thị giác thật: màu (và chiều cao cột) cho biết "trạm 5 nóng
 * hơn trạm 4", KHÔNG cho biết "hơn bao nhiêu". Vậy nên `xepHangWip()` và
 * `cotWip()` cùng ăn MỘT đầu vào `TinhWip[]` và cùng gọi MỘT `laNghen()`. Nếu 3D
 * tô đỏ trạm 7 thì bảng 2D **bắt buộc** cũng xếp trạm 7 đầu và gắn cùng cờ —
 * hai bản cài đặt rời sẽ lệch, và G12 nói chúng hiếm khi chỉ lệch một chỗ.
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ĐẦU VÀO                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Một trạm đã ghép SỐ WIP với VỊ TRÍ 3D của nó. */
export interface TinhWip {
  stationId: number;
  ma: string;
  ten: string;
  /** `stations.orderIndex` — chiều dòng chảy. */
  thuTu: number;
  /**
   * Số WIP đang chờ tại trạm. `null` = **CHƯA ĐO ĐƯỢC**, KHÔNG phải 0.
   *
   * ★ NT-3: một trạm không có dòng nào trong `wipFlowState` có thể là "trống
   *   thật" HOẶC "chưa từng có serial nào đi qua đường ghi nhận". Người gọi
   *   biết phân biệt (truy vấn thành công + trạm vắng ⇒ 0 thật); module này
   *   chỉ cam kết KHÔNG tự bịa một số 0.
   */
  soWip: number | null;
  /** Tâm trạm trong mét (hệ toạ độ cảnh). */
  x: number;
  z: number;
}

/** Một cột WIP 3D — đúng hình dạng `CanhVanHanhProps["wip"]`. */
export interface CotWip {
  x: number;
  z: number;
  /** Chiều cao mét. */
  cao: number;
  nghen: boolean;
}

/** Một dòng bảng xếp hạng 2D (§11.5). */
export interface DongXepHangWip {
  stationId: number;
  ma: string;
  ten: string;
  thuTu: number;
  soWip: number | null;
  nghen: boolean;
  /** Hạng 1 = nhiều WIP nhất. `null` khi trạm chưa đo được. */
  hang: number | null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NGƯỠNG                                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chiều cao (mét) của MỘT đơn vị WIP. 0,25 m × 20 WIP = 5 m — cao ngang một
 * máy lớn, đủ nổi trên sàn mà chưa che mất hình học phía sau.
 */
export const CAO_MOI_WIP_M = 0.25;

/** Trần chiều cao cột (mét). Không có trần thì một trạm kẹt 400 WIP dựng một cây cột xuyên trần nhà và che cả xưởng. */
export const CAO_TOI_DA_M = 6;

/**
 * ★★★ Bội số so với TRUNG VỊ để gọi là "nghẽn".
 *
 * Dùng TRUNG VỊ chứ không phải TRUNG BÌNH, và đây là quyết định có hậu quả đo
 * được: chính cái trạm nghẽn (WIP rất lớn) kéo trung bình lên, nên với trung
 * bình nó tự làm mình trông bình thường — thủ phạm xoá dấu vết của chính nó.
 * Trung vị miễn nhiễm với một-hai giá trị cực đại.
 */
export const BOI_NGHEN = 2;

/** Dưới ngưỡng này thì không trạm nào bị gọi là nghẽn, dù bội số bao nhiêu. */
export const WIP_TOI_THIEU_DE_NGHEN = 3;

/**
 * ★★★ HẠN DÙNG của lời khai nút thắt từ server (ms). 8 giờ = một ca sản xuất.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CON SỐ NÀY RA ĐỜI TỪ MỘT PHÉP ĐO TRÊN DB THẬT, KHÔNG TỪ SUY LUẬN
 * ════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu thị giác Đợt 8 (`/twin?pv=line:1`, dữ liệu SIM-FAC thật) bắt được:
 *
 *   `line_balance_metrics` bản ghi mới nhất của Line 1: `periodStart` =
 *   2026-08-21, tức **16 ngày 18 giờ trước**, `bottleneckStationId = 10`.
 *   Trong khi đó `wip_tracking` SỐNG nói trạm **1** đang giữ **3.152** chiếc —
 *   gấp **22 lần** trung vị (~140) của 11 trạm còn lại, và trạm 10 chỉ có 124
 *   (ít thứ ba từ dưới lên).
 *
 * Bản đầu của `laNghen` cho lời khai server thắng VÔ ĐIỀU KIỆN. Hậu quả đo được
 * trên màn hình thật: cột đỏ và dòng đỏ nằm ở trạm **124 WIP**, còn trạm **3.152
 * WIP** vẽ màu bình thường. Người vận hành nhìn màn đó sẽ đi chữa đúng cái trạm
 * KHÔNG hỏng, và bỏ qua cái đang ngập.
 *
 * ★ Bài học tổng quát hơn con số: **"nguồn có thẩm quyền hơn" không có nghĩa là
 *   "đúng mãi mãi"**. Một lời khai cũ vẫn là một lời khai, và khi nó mâu thuẫn
 *   với phép đo SỐNG thì cái cũ phải nhường. Đây cùng họ với luật "lý do hoãn có
 *   HẠN SỬ DỤNG" mà Khối D đã trả giá để học.
 *
 * ★ 8 giờ chứ không phải 1 giờ: `line_balance` là số liệu tổng hợp theo KỲ, và
 *   một dây chuyền chạy ổn định có thể không sinh bản ghi mới trong vài giờ mà
 *   kết luận nút thắt vẫn còn đúng. 8 giờ = ranh giới ca — qua ca thì sản phẩm,
 *   tổ vận hành và cấu hình đều có thể đã đổi, nên lời khai cũ hết hiệu lực.
 */
export const HAN_KHAI_NGHEN_MS = 8 * 60 * 60 * 1000;

/**
 * Lời khai nút thắt của server có còn hiệu lực không.
 *
 * `mocKhai == null` (không biết bản ghi từ bao giờ) ⇒ **KHÔNG tin**. Một lời
 * khai không kèm dấu thời gian thì không kiểm được hạn, và mặc định "cứ tin"
 * chính là chế độ hỏng vừa đo được ở trên.
 */
export function conHieuLuc(
  mocKhai: number | null | undefined,
  bayGio: number,
): boolean {
  if (mocKhai == null || !Number.isFinite(mocKhai)) return false;
  return bayGio - mocKhai <= HAN_KHAI_NGHEN_MS;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NÚT THẮT                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Trung vị của các số ĐÃ ĐO ĐƯỢC. `null` khi không có mẫu nào. */
export function trungViWip(tram: readonly TinhWip[]): number | null {
  const so = tram.map((t) => t.soWip).filter((n): n is number => n != null);
  if (so.length === 0) return null;
  const sap = [...so].sort((a, b) => a - b);
  const giua = Math.floor(sap.length / 2);
  return sap.length % 2 === 1 ? sap[giua] : (sap[giua - 1] + sap[giua]) / 2;
}

/**
 * Lời khai nút thắt của server, kèm ĐỦ thứ để kiểm hạn.
 *
 * ★ `mocKhai` và `bayGio` là THAM SỐ, không đọc `Date.now()` bên trong — cùng lý
 *   do như `khoTrangThai`: module thuần phải test được mà không giả lập đồng hồ,
 *   và khi tua lại lịch sử thì "còn hạn" phải tính theo mốc ĐANG XEM.
 */
export interface KhaiNghen {
  /** `bottleneckStationId` server trả về. `null` = server không khai. */
  nghenTheoServer: number | null;
  /** ms epoch của bản ghi `line_balance` sinh ra lời khai. `null` = không rõ. */
  mocKhai: number | null;
  /** Đồng hồ mà TRANG đang render theo. */
  bayGio: number;
}

/**
 * ★★★ Trạm này có phải nút thắt không.
 *
 * HAI đường, và đường thứ nhất THẮNG:
 *
 * **1. Nút thắt do SERVER khai** (`digitalTwin.stationLoadHeatmap
 *    .bottleneckStationId`, suy từ bản ghi `line_balance` thật) — **CHỈ KHI CÒN
 *    HẠN** (`conHieuLuc`, xem `HAN_KHAI_NGHEN_MS`). Khi bản ghi còn tươi thì con
 *    số đó có thẩm quyền hơn một suy luận WIP tức thời, và client KHÔNG được bác
 *    nó: hai bản cài đặt cùng trả lời "trạm nào nghẽn" thì sớm muộn cũng lệch
 *    (G12), nên chúng được xếp hạng tường minh thay vì chạy song song.
 *
 *    ⚠ NHƯNG THẨM QUYỀN CÓ HẠN DÙNG. Nghiệm thu Đợt 8 đo được một bản ghi **16
 *    ngày tuổi** khai trạm 10 (124 WIP) là nút thắt trong khi trạm 1 đang giữ
 *    **3.152** chiếc. Tin lời khai hết hạn ⇒ tô đỏ đúng trạm KHÔNG hỏng. Nên
 *    quá hạn thì nó bị bỏ qua hoàn toàn và ta rơi về đường 2.
 *
 * **2. Suy từ WIP** khi server không khai (chưa có `line_balance`, hoặc người
 *    dùng không có quyền gọi thủ tục đó). BA điều kiện, cả ba đều cần:
 *   a. đo được (`soWip != null`) — chưa đo KHÔNG được tô đỏ. Tô đỏ một trạm
 *      mình không biết gì về nó là lời khai sai, đúng thứ NT-3 cấm.
 *   b. `soWip >= WIP_TOI_THIEU_DE_NGHEN` — chuyền chạy nhẹ (trung vị 1) thì
 *      một trạm có 2 chiếc không phải là sự cố; thiếu điều kiện này cả màn
 *      hình đỏ vào giờ nghỉ và người vận hành học cách phớt lờ nó.
 *   c. `soWip >= BOI_NGHEN × trung vị` — nghẽn là chuyện SO SÁNH, không phải
 *      một con số tuyệt đối. 40 WIP ở mọi trạm là chuyền bận, không phải nghẽn.
 *
 * ⚠ Khi server ĐÃ khai một trạm nút thắt, các trạm khác trả `false` KỂ CẢ khi
 *   WIP của chúng vượt bội số — nếu không thì màn hình có hai "nút thắt" và
 *   không câu nào trong hai câu đó còn nghĩa.
 */
export function laNghen(
  soWip: number | null,
  trungVi: number | null,
  ctx?: KhaiNghen & { stationId: number },
): boolean {
  if (ctx && ctx.nghenTheoServer != null && conHieuLuc(ctx.mocKhai, ctx.bayGio)) {
    return ctx.stationId === ctx.nghenTheoServer;
  }
  if (soWip == null || trungVi == null) return false;
  if (soWip < WIP_TOI_THIEU_DE_NGHEN) return false;
  return soWip >= BOI_NGHEN * trungVi;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BỀ MẶT 1 — CỘT 3D                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Số WIP → cột 3D. Trạm CHƯA ĐO ĐƯỢC bị **bỏ khỏi kết quả**, không dựng cột cao
 * 0: một cột dí sát sàn trông y hệt "trạm trống", tức là bịa ra câu trả lời "0"
 * cho câu hỏi mình không biết. Vắng mặt là cách trung thực để nói "không biết".
 *
 * Trạm ĐO ĐƯỢC và bằng 0 cũng không dựng cột — nhưng đó là vì "không có gì để
 * vẽ", và bảng 2D vẫn liệt kê nó với số `0`, nên thông tin không mất.
 */
export function cotWip(tram: readonly TinhWip[], khai?: KhaiNghen): CotWip[] {
  const tv = trungViWip(tram);
  const ra: CotWip[] = [];
  for (const t of tram) {
    if (t.soWip == null || t.soWip <= 0) continue;
    ra.push({
      x: t.x,
      z: t.z,
      cao: Math.min(CAO_TOI_DA_M, t.soWip * CAO_MOI_WIP_M),
      nghen: laNghen(t.soWip, tv, khai ? { ...khai, stationId: t.stationId } : undefined),
    });
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BỀ MẶT 2 — BẢNG XẾP HẠNG 2D (§11.5)                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bảng xếp hạng song song với lớp phủ 3D. Giữ NGUYÊN thứ tự dòng chảy (`thuTu`)
 * — dải Line là một bản đồ chuyền, đảo nó theo WIP làm mất chính cái mà người
 * đọc dùng để định vị — nhưng gắn thêm `hang` để câu "trạm nào nặng nhất" trả
 * lời được bằng SỐ chứ không bằng cách so màu.
 *
 * Trạm chưa đo được nhận `hang: null` và KHÔNG chiếm chỗ trong dãy hạng: xếp nó
 * "hạng 12/12" là khẳng định nó ít WIP nhất, điều ta không biết.
 */
export function xepHangWip(
  tram: readonly TinhWip[],
  khai?: KhaiNghen,
): DongXepHangWip[] {
  const tv = trungViWip(tram);
  // Hạng tính trên các giá trị ĐO ĐƯỢC, giảm dần; bằng nhau thì cùng hạng.
  const daDo = tram
    .map((t) => t.soWip)
    .filter((n): n is number => n != null)
    .sort((a, b) => b - a);
  return tram.map((t) => ({
    stationId: t.stationId,
    ma: t.ma,
    ten: t.ten,
    thuTu: t.thuTu,
    soWip: t.soWip,
    nghen: laNghen(t.soWip, tv, khai ? { ...khai, stationId: t.stationId } : undefined),
    hang: t.soWip == null ? null : daDo.indexOf(t.soWip) + 1,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #36 — NHỊP CHUYỀN THẬT                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Nhịp chậm nhất còn coi là "chuyền đang chạy" (ms). Trên mức này ⇒ đứng yên. */
export const NHIP_CHAM_NHAT_MS = 120_000;

/** Nhịp nhanh nhất chấp nhận (ms) — dưới mức này là số rác, không phải chuyền nhanh. */
export const NHIP_NHANH_NHAT_MS = 200;

/**
 * ★★★ §11 #36 — nhịp THẬT cho mũi tên dòng chảy, thay `nhipMs: null` viết cứng.
 *
 * `DongChayLine` đã cam kết: *"tốc độ mũi tên tỉ lệ với nhịp THẬT, và ĐỨNG YÊN
 * khi Line dừng. Một dòng chảy chạy đều trong khi chuyền đã dừng là lời khai sai
 * về thế giới"*. Với `nhipMs: null` viết cứng thì nửa sau của lời hứa được giữ
 * một cách rẻ tiền — mũi tên đứng yên **luôn luôn**, kể cả khi chuyền chạy — và
 * nửa đầu chưa bao giờ được thử.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ SPEC §11 #36 CHỈ SAI NGUỒN — `commandLog.avgDurations` ĐO ĐẠI LƯỢNG KHÁC
 * ════════════════════════════════════════════════════════════════════════════
 * Spec ghi *"`commandLog.avgDurations` → cycle time thật"*. Đọc thủ tục đó
 * (`server/routers/commandLogRouter.ts:105`) thì nó tính
 * `avg(ackedAt − sentAt) GROUP BY commandType` — tức là **độ trễ ACK của lệnh
 * điều khiển**, gộp theo LOẠI LỆNH, không theo chuyền, không theo sản phẩm.
 * Một chuyền chạy 12 s/chiếc mà lệnh `START` ack trong 80 ms sẽ cho mũi tên
 * chạy nhanh gấp 150 lần sự thật. Đây đúng họ G7 "đo nhầm đại lượng".
 *
 * Nguồn ĐÚNG có sẵn: `line_balance_metrics.avgCycleTimeMs`
 * (`drizzle/schema/mes.ts:90`), lộ ra client qua `wip.lineBalance` —
 * ms/chiếc theo TỪNG LINE, đúng cả đại lượng lẫn phạm vi.
 *
 * `null`/0/không hữu hạn ⇒ `null` (đứng yên): chuyền chưa đo được nhịp thì mũi
 * tên KHÔNG được chạy — bịa một tốc độ chính là lời khai sai đã nói ở trên.
 *
 * ⚠ `NHIP_CHAM_NHAT_MS` là TRẦN chứ không phải kẹp: một nhịp 5 phút/chiếc nghĩa
 *   là chuyền gần như dừng, và mũi tên bò chậm hơn mắt phân biệt được sẽ bị đọc
 *   là "đang chạy". Trả `null` (đứng hẳn) trung thực hơn.
 */
export function nhipTuCanBang(avgCycleTimeMs: number | null | undefined): number | null {
  if (avgCycleTimeMs == null || !Number.isFinite(avgCycleTimeMs) || avgCycleTimeMs <= 0) {
    return null;
  }
  if (avgCycleTimeMs > NHIP_CHAM_NHAT_MS) return null;
  return Math.max(NHIP_NHANH_NHAT_MS, avgCycleTimeMs);
}
