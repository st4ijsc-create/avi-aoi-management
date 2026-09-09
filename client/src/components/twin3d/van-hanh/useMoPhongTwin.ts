/**
 * `useMoPhongTwin` — T-1 **TẦNG 4** của §15.5.2: ba truy vấn MÔ PHỎNG / PHÁT LẠI.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TẦNG 4 TÁCH ĐƯỢC, TRONG KHI §15.5.2 NÓI "GOM 14 THÀNH 1"
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 27 (G90) đo lại và **bác** chữ "rủi ro thấp" của §15.5.2: 14 `useQuery`
 * của `TwinVanHanh.tsx` **không phải một khối**, chúng là **chuỗi xếp tầng** có
 * memo dẫn xuất **xen giữa** (`factories` → `factoryId` → `toaNha` → `dsTang`
 * → `tangIdsHoi` → `canhQ`). Một hook "trả 1 object" cho cả 14 phải nhận **9
 * tham số**, và **3 trong 9** được tính từ chính kết quả bên trong nó — **vòng
 * tròn**, không có thứ tự khai nào hợp lệ.
 *
 * Nên Đợt 28 chia **bốn tầng** và làm **rời nhất trước**. Tầng 4 là tầng rời
 * nhất, và "rời" ở đây là một tính chất **đo được**, không phải cảm giác:
 *
 *   ① **0 truy vấn nào khác đọc kết quả của tầng này.** `whatIfQ`/`dsWorkflowQ`
 *      /`phatLaiQ` không xuất hiện trong `enabled`, trong đối số, hay trong
 *      `useMemo` của bất kỳ truy vấn nào khác. Chuỗi phụ thuộc **kết thúc** ở
 *      đây — chúng là **lá**, không phải mắt xích.
 *   ② **Đầu vào đã dựng sẵn ở ngoài.** `dungWhatIf` là một memo có sẵn
 *      (`TwinVanHanh.tsx`), `coQuyenXemQuyTrinh` là một phép đọc quyền thuần.
 *      Hook chỉ **nhận**, không tự tính — nên không có vòng tròn.
 *   ③ **Không mang `refetchInterval`.** Cả ba đều `refetchOnWindowFocus: false`
 *      và không poll ⇒ tầng này **không chạm bất biến nhịp an toàn** (đó là
 *      tầng 2). Rủi ro hồi quy an toàn ở đây bằng **0**, và đó chính là lý do
 *      nó đi trước.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G37 — HOOK NÀY KHÔNG TỰ ĐỌC ROUTE, VÀ KHÔNG TỰ ĐỌC QUYỀN
 * ════════════════════════════════════════════════════════════════════════════
 * Không `useSearch()`, không `useRoute()` — cùng luật đã áp cho
 * `useTrangThaiTwin` (T-3). Thêm một vế nữa ở đây: hook cũng **không tự gọi**
 * `hasPermission`. Quyền đi vào qua tham số `coQuyenXemQuyTrinh`.
 *
 * Lý do là G37 nguyên bản đổi tên miền: một mảnh tự đọc ngữ cảnh của trang cha
 * sẽ **hỏng câm** khi đặt dưới một trang cha khác. Với quyền thì hỏng câm ấy
 * nguy hiểm hơn hỏng câm về route — nó có thể **bắn truy vấn mà người dùng
 * không được phép gọi**, và lỗi 403 duy nhất hiện ra là một ngăn trống trông
 * hệt như "chưa có quy trình nào".
 *
 * ⚠ `enabled: coQuyenXemQuyTrinh` là **cửa thứ nhất**, không phải cửa duy nhất.
 *   Cửa quyết định vẫn nằm ở server (`orchestrationRouter.ts:83`, `:244` đòi
 *   `machine_monitoring/canView`). Cửa ở đây chỉ để **không bắn** một truy vấn
 *   đã biết chắc sẽ bị từ chối — và để ngăn hiện `null` (ẩn cả mục) thay vì
 *   `[]` (có quyền, chưa có quy trình). Hai câu ấy KHÁC NHAU (§ luật ẩn-không-
 *   disable, `nganXuLyLogic.ts:102-111`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G5/G32 — MỌI HÀNH VI GIỮ NGUYÊN BYTE-ĐỐI-BYTE
 * ════════════════════════════════════════════════════════════════════════════
 * Tệp này **không sửa** một luật nào. Bốn thứ tinh tế được bê nguyên, và mỗi
 * thứ đều là một bài học đã trả giá:
 *
 *   ★ **Đối số giả khi chưa chạy.** `whatIf` nhận `{stations:[{stationId:0,
 *     cycleTimeSec:1}], horizonHours:1}` khi `!dungWhatIf.chay`. Trông thừa,
 *     nhưng `enabled:false` KHÔNG miễn cho đối số khỏi bị zod duyệt ở tầng
 *     `queryKey`; bỏ nó ra thì `.positive()`/`.min(1)` ném 400 cho một trạng
 *     thái hoàn toàn bình thường.
 *   ★ **`enabled` gấp đôi cửa** — `dungWhatIf.chay && daBamChay`. Vế (a) là
 *     "đầu vào dựng được", vế (b) là "người dùng đã bấm Chạy". Thiếu (b) thì
 *     mở màn là chạy mô phỏng.
 *   ★ **Hạ cờ khi đổi tham số.** `useEffect` đặt `daBamChay=false` mỗi khi
 *     `lineDangXem`/`horizonHours`/`heSoCycle` đổi. Không có nó, kết quả của
 *     chuyền TRƯỚC nằm lại dưới nhãn của chuyền MỚI — một lời khai sai mà
 *     **không lỗi nào nổ**.
 *   ★ **`workflowRef !== null`** trong `enabled` của `phatLai`, chứ không phải
 *     `workflowRef` truthy: chuỗi rỗng `""` là một `workflowRef` hợp lệ về
 *     kiểu và phải KHÔNG bắn, còn `?? ""` chỉ là chỗ giữ kiểu cho đối số.
 *
 * ⚠ Giới hạn tự khai: hook trả nguyên các đối tượng truy vấn của react-query
 *   (`.data`, `.isLoading`) chứ không bọc lại. Bọc lại sẽ phải chọn giữ cái gì
 *   và bỏ cái gì — và mỗi lần chọn như thế là một dịp làm mất một trạng thái
 *   ("đang tải" khác "đã chạy xong, rỗng"). Trả nguyên = giữ hành vi.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { KetQuaDungWhatIf } from "./moPhongLogic";

/**
 * Đầu vào của hook. **Mọi thứ đều nhận từ ngoài** — không tự đọc route, không
 * tự đọc quyền, không tự dựng đầu vào (xem G37 ở docblock trên).
 */
export interface ThamSoMoPhongTwin {
  /** Kết quả `dungDauVaoWhatIf(...)` — đã qua cửa kiểm hạn (G30) ở trang cha. */
  dungWhatIf: KetQuaDungWhatIf;
  /** `machine_monitoring/canView`. Trang cha đọc, hook chỉ nhận. */
  coQuyenXemQuyTrinh: boolean;
  /** Chuyền đang xem — một trong ba khoá reset cờ "đã bấm Chạy". */
  lineDangXem: number | null;
  /** Tầm mô phỏng (giờ) — khoá reset thứ hai. */
  horizonHours: number;
  /** Hệ số cycle time — khoá reset thứ ba. */
  heSoCycle: number;
}

export function useMoPhongTwin({
  dungWhatIf,
  coQuyenXemQuyTrinh,
  lineDangXem,
  horizonHours,
  heSoCycle,
}: ThamSoMoPhongTwin) {
  /*
   * ★ `enabled` GẤP ĐÔI cửa: chỉ bắn khi (a) đầu vào dựng được và (b) người
   *   dùng đã bấm Chạy. Thiếu (a) thì zod `.positive()`/`.min(1)` ném 400 cho
   *   một thứ ta đã BIẾT là không chạy được — một lỗi đỏ ở console cho một
   *   trạng thái hoàn toàn bình thường.
   */
  const [daBamChay, datDaBamChay] = useState(false);
  const whatIfQ = trpc.digitalTwin.whatIf.useQuery(
    dungWhatIf.chay
      ? dungWhatIf.dauVao
      : { stations: [{ stationId: 0, cycleTimeSec: 1 }], horizonHours: 1 },
    { enabled: dungWhatIf.chay && daBamChay, retry: false, refetchOnWindowFocus: false },
  );

  /*
   * ★ Đổi chuyền / đổi tham số ⇒ hạ cờ, buộc bấm Chạy lại. Nếu không, kết quả
   *   của chuyền TRƯỚC nằm lại trên màn hình dưới nhãn của chuyền MỚI — một lời
   *   khai sai mà không lỗi nào nổ (react-query giữ `data` cũ khi key đổi trong
   *   `keepPreviousData`, và ngay cả khi không thì khoảng trắng giữa hai lần
   *   fetch cũng đủ để đọc nhầm).
   */
  useEffect(() => {
    datDaBamChay(false);
  }, [lineDangXem, horizonHours, heSoCycle]);

  /*
   * #35 — phát lại workflow qua `orchestration.simulate`.
   *
   * ★★★ CỔNG QUYỀN: `orchestration.listWorkflows`/`simulate` đều đòi
   *   `machine_monitoring/canView` (`orchestrationRouter.ts:83`, `:244`). Luật
   *   dự án (`nganXuLyLogic.ts:102-111`): **thiếu quyền ⇒ ẨN**, không phải
   *   hiện-rồi-disable. Nên khi thiếu quyền ta KHÔNG bắn truy vấn (`enabled`)
   *   và trang truyền `null` xuống ngăn để nó ẩn cả mục — `null` khác `[]` (có
   *   quyền mà chưa có workflow nào, câu đó phải nói ra).
   */
  const [workflowRef, datWorkflowRef] = useState<string | null>(null);
  const dsWorkflowQ = trpc.orchestration.listWorkflows.useQuery(
    { limit: 50 },
    { enabled: coQuyenXemQuyTrinh, retry: false, refetchOnWindowFocus: false },
  );
  const phatLaiQ = trpc.orchestration.simulate.useQuery(
    { workflowRef: workflowRef ?? "", params: {} },
    { enabled: coQuyenXemQuyTrinh && workflowRef !== null, retry: false, refetchOnWindowFocus: false },
  );

  return {
    whatIfQ,
    dsWorkflowQ,
    phatLaiQ,
    daBamChay,
    datDaBamChay,
    workflowRef,
    datWorkflowRef,
  };
}
