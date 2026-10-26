/**
 * SCADA R1b-1 Task 2 fix round 1/2 (điều phối 2026-10-24) — KHẢO SÁT KHẢ NĂNG DỪNG của một máy: nút DỪNG MÁY (`scadaCommands.dungMay`)
 * sẽ làm gì với TỪNG adapter đang bật, để người vận hành biết TRƯỚC khi cần dừng (không phải lúc nút báo đỏ).
 *
 * Một hàm, dùng ở hai nơi: (a) hộp xác nhận DỪNG MÁY liệt kê từng adapter trước khi gửi; (b) cảnh báo cấp máy ở M4 (faceplate), M10 (và M3
 * khi có). Đưa ra qua hàng `scadaKenh.cheDo.danhSach` (trường `khaNangDung`) — KHÔNG thêm thủ tục (bản nhiều máy một lượt đọc ghim).
 *
 * KẾT LUẬN theo THỨ TỰ của `dispatchCore` (cùng vị từ, không bản sao):
 *   1. không ghim DỪNG hợp lệ (`stopPinsFromTagRows` — luật của `loadStopPins`)  ⇒ `chua_ghim` (dungMay không gửi gì tới adapter này)
 *   2. adapter do edge sở hữu                                                    ⇒ `qua_edge` (dispatcher định tuyến STOP sang node edge;
 *      chỉ xác nhận khi edge báo lại — KHÔNG tính là `duoc`); kèm `edgeCode` + `edgeToiDuoc` (`edgeNodeReachability`: lượt kéo trong
 *      tiến trình này, không có thì tuổi heartbeat — MỘT lượt đọc rẻ). fix round 3: dưới hạn STOP_DB_STEP_DEADLINE_MS (khuôn của
 *      dispatcher ở routeEdgeOwnedAdapterCommand), quá hạn / lỗi ⇒ KHÔNG tới được (chiều an toàn cho cảnh báo); MỘT lượt hỏi mỗi node
 *      trong một lần khảo sát (bộ nhớ đệm theo lượt gọi)
 *   3. trung tâm không giữ driver (`getActiveDriver`)                            ⇒ `mat_ket_noi` (dispatch bước 4: ADAPTER_OFFLINE, không gửi gì)
 *   4. `!isOtControlEnabled()`                                                    ⇒ `mo_phong`, lyDo "ot_control_tat" (bước 5: writeSimulated)
 *   5. `isCommissioningRequired() && !isCommissioned(adapter)`                    ⇒ `mo_phong`, lyDo "chua_nghiem_thu" (bước 5a: writeSimulated)
 *   6. `!runningConnectionMatchesAdapterRow` (dấu vân tay kết nối ĐANG CHẠY ≠ hàng adapter — sửa adapter mà chưa nối lại)
 *                                                                                ⇒ `ghim_cu` (5a-stop: KHÔNG phải STOP ghim)
 *   7. còn lại                                                                    ⇒ `duoc`
 * kiem-dinh R1b-1 H1 (b) (2026-10-25) — CÙNG LUẬT với `dungMay` (`phanLoaiGhimStopHmi`): chỉ ghim của tag mức tác động ≤ 1 được STOP HMI gửi
 *   (NULL ⇒ 5 ⇒ bỏ qua). Adapter có ghim hợp lệ nhưng MỌI ghim ở tag mức cao ⇒ `ghim_muc_cao` ("không tới bằng STOP HMI" — không tính là
 *   `duoc`, không đếm vào `soAdapterGhimStop`); adapter có cả hai ⇒ kết luận theo các bước 2–7 cho ghim GỬI được + `ghimBoQua` (tagKey các ghim
 *   mức cao sẽ bị bỏ qua) để cảnh báo cấp máy nói rõ.
 * fix round 2: lỗi khi kiểm MỘT adapter (đọc nghiệm thu / vân tay / edge …) ⇒ `khong_kiem_duoc` cho adapter đó — KHÔNG BAO GIỜ `duoc`,
 * không làm hỏng cả danh sách. Lỗi đọc CHUNG (adapter / ghim) ⇒ mọi máy `loiKhaoSat: true`, adapters rỗng (UI nói "không kiểm được").
 * tongHop: mọi adapter `duoc` ⇒ "duoc"; không adapter nào `duoc` (kể cả máy không có adapter bật / lỗi khảo sát) ⇒ "khong"; còn lại ⇒
 * "mot_phan". `qua_edge` không tính là `duoc`.
 */
import { and, asc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { deviceAdapters, deviceTags, machines } from "../../../drizzle/schema";
import type { getDb } from "../../db/connection";
import { logger } from "../../logger";
import { getActiveDriver } from "../ot/otManager";
import { isOtControlEnabled, runningConnectionMatchesAdapterRow } from "../ot/commandDispatcher";
import { isCommissioned, isCommissioningRequired } from "../ot/commissioningService";
import { phanLoaiGhimStopHmi, stopPinsFromTagRows, type StopPinTagRowMuc } from "../ot/stopPin";
import { adapterOwnedByEdge } from "../ot/otAdapterOwnerGate";
import { edgeNodeReachability } from "../edge/edgeNodeCommands";
import { withDeadline } from "../ot/drivers/boundedClose";
import { STOP_DB_STEP_DEADLINE_MS } from "../robot/stopJob";
import type { TongHopDungKhanCap } from "../../../shared/dungKhanCap";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type TrangThaiKhaNangDung = "duoc" | "qua_edge" | "mat_ket_noi" | "mo_phong" | "ghim_cu" | "chua_ghim" | "ghim_muc_cao" | "khong_kiem_duoc";
export type LyDoKhaNangDung = "ot_control_tat" | "chua_nghiem_thu";

export interface KhaNangDungAdapter {
  adapterId: number;
  code: string;
  trangThai: TrangThaiKhaNangDung;
  lyDo?: LyDoKhaNangDung;
  /** qua_edge: mã node edge sở hữu (hoặc id khi node không còn mã) */
  edgeCode?: string;
  /** qua_edge: node có liên lạc được với trung tâm không (false ⇒ cảnh báo) */
  edgeToiDuoc?: boolean;
  /** kiem-dinh R1b-1 H1 (b) — tagKey các ghim hợp lệ mà STOP HMI sẽ BỎ QUA (tag mức tác động > 1); vắng = không có */
  ghimBoQua?: string[];
}

export interface KhaNangDungMay {
  machineId: number;
  adapters: KhaNangDungAdapter[];
  tongHop: "duoc" | "mot_phan" | "khong";
  /** lỗi đọc chung (adapter / ghim) — không kết luận được cho máy này; R1b-2b-1 T1 fix round 1: cả khi khảo sát có hạn quá hạn (`TuyChonKhaoSat.hanMs`) */
  loiKhaoSat?: true;
}

/**
 * R1b-1 T2 — số adapter bật có ≥ 1 ghim DỪNG hợp lệ (mọi kết luận ≠ chua_ghim). fix round 3: khảo sát LỖI (`loiKhaoSat`) / vắng ⇒ null
 * (KHÔNG BIẾT — không được đọc thành "chưa ghim" / 0 adapter).
 * kiem-dinh R1b-1 H1 (b) — adapter chỉ có ghim mức cao (`ghim_muc_cao`) KHÔNG nhận STOP HMI ⇒ không đếm (cùng luật với dungMay).
 * R1b-2b-1 T1 (2026-10-26) — chuyển từ `scadaKenhRouter.ts` (thân giữ nguyên) để `cheDo.danhSach` và `mayDungKhanCap` dùng CHUNG một hàm.
 */
export function soCoGhim(k: KhaNangDungMay | undefined): number | null {
  return !k || k.loiKhaoSat ? null : k.adapters.filter((a) => a.trangThai !== "chua_ghim" && a.trangThai !== "ghim_muc_cao").length;
}
export function coGhim(k: KhaNangDungMay | undefined): boolean | null {
  const n = soCoGhim(k);
  return n === null ? null : n > 0;
}

/**
 * Vị từ "máy CÓ NỐI" của `scadaKenh.cheDo.danhSach`: máy có ≥ 1 adapter (bật hay tắt) HOẶC đã khai kênh chế độ. R1b-2b-1 T1 (2026-10-26,
 * ruling C11) — rút từ router thành MỘT nguồn để `mayDungKhanCap` liệt kê CÙNG tập máy với HMI (không chép điều kiện).
 * ⚠ Tham chiếu cột `machines.id` của truy vấn ngoài ⇒ chỉ dùng trong `.from(machines)`.
 */
export function dieuKienMayCoNoi(): SQL {
  return or(
    sql`EXISTS (SELECT 1 FROM device_adapters a WHERE a."machineId" = ${machines.id})`,
    sql`EXISTS (SELECT 1 FROM scada_kenh_che_do k WHERE k.machine_id = ${machines.id})`,
  ) as SQL;
}

export function tongHopKhaNang(adapters: ReadonlyArray<KhaNangDungAdapter>): KhaNangDungMay["tongHop"] {
  const duoc = adapters.filter((a) => a.trangThai === "duoc").length;
  if (adapters.length > 0 && duoc === adapters.length) return "duoc";
  return duoc === 0 ? "khong" : "mot_phan";
}

type HangAdapter = { id: number; code: string; machineId: number };

/**
 * Adapter bật của các máy. Chủ edge KHÔNG đọc ở đây: R1b-1 T10 — một truy vấn chủ edge duy nhất cho cả dispatcher lẫn HMI
 * (`adapterOwnedByEdge`, mã edge kèm theo), hỏi từng adapter CÓ GHIM ở `ketLuanCoGhim`.
 */
async function docAdapterBat(db: Db, machineIds: number[]): Promise<HangAdapter[]> {
  const rows = await db
    .select({ id: deviceAdapters.id, code: deviceAdapters.code, machineId: deviceAdapters.machineId })
    .from(deviceAdapters)
    .where(and(inArray(deviceAdapters.machineId, machineIds), eq(deviceAdapters.isEnabled, true)))
    .orderBy(asc(deviceAdapters.id));
  return rows.map((r) => ({ id: r.id, code: r.code, machineId: r.machineId as number }));
}

/** Bộ nhớ đệm "node edge tới được không" của MỘT lần khảo sát (khoá: edgeNodeId). */
type DemToiEdge = Map<number, Promise<boolean>>;

/** fix round 3 — tới được node edge? Dưới hạn; quá hạn / lỗi ⇒ false (không bao giờ treo danh sách, không bao giờ nói "tới được" khi không biết). */
function edgeToiDuoc(dem: DemToiEdge, nodeId: number): Promise<boolean> {
  let p = dem.get(nodeId);
  if (!p) {
    p = withDeadline(
      Promise.resolve().then(() => edgeNodeReachability(nodeId)),
      STOP_DB_STEP_DEADLINE_MS,
      `edge node ${nodeId} reachability (khảo sát khả năng dừng)`,
    ).then(
      (r) => r.reachable === true,
      () => false,
    );
    dem.set(nodeId, p);
  }
  return p;
}

/** Một adapter có ghim: các bước 2–7 (thứ tự dispatchCore). Có thể ném — nơi gọi đổi thành `khong_kiem_duoc`. */
/**
 * R1b-2b-1 T1 fix round 2 (N1 b) — `daHetHan` (vắng ⇒ không bao giờ): khảo sát có hạn đã quá hạn ⇒ BỎ các bước truy vấn CÒN LẠI, trả
 * HET_HAN_KHAO_SAT (lượt bị bỏ rơi chỉ tốn đúng truy vấn nó đang chạy, không đi tiếp truy vấn 2–3).
 */
async function ketLuanCoGhim(
  db: Db,
  a: HangAdapter,
  dem: DemToiEdge,
  daHetHan: () => boolean = () => false,
): Promise<Omit<KhaNangDungAdapter, "adapterId" | "code"> | typeof HET_HAN_KHAO_SAT> {
  const chu = await adapterOwnedByEdge(db, a.id);
  if (chu) {
    if (daHetHan()) return HET_HAN_KHAO_SAT;
    return { trangThai: "qua_edge", edgeCode: chu.edgeCode, edgeToiDuoc: await edgeToiDuoc(dem, chu.edgeNodeId) };
  }
  if (!getActiveDriver(a.id)) return { trangThai: "mat_ket_noi" };
  if (!isOtControlEnabled()) return { trangThai: "mo_phong", lyDo: "ot_control_tat" };
  if (isCommissioningRequired()) {
    if (daHetHan()) return HET_HAN_KHAO_SAT;
    if (!(await isCommissioned(a.id))) return { trangThai: "mo_phong", lyDo: "chua_nghiem_thu" };
  }
  if (daHetHan()) return HET_HAN_KHAO_SAT;
  if (!(await runningConnectionMatchesAdapterRow(db, a.id))) return { trangThai: "ghim_cu" };
  return { trangThai: "duoc" };
}

/**
 * R1b-2b-1 T1 fix round 1 (review I1, điều phối 2026-10-26) — tuỳ chọn của khảo sát. Vắng ⇒ hành vi CŨ (không hạn, không giới hạn đồng thời —
 * `cheDo.danhSach` không đổi). `scadaCommands.mayDungKhanCap` truyền cả hai: một adapter chậm không được làm mất cả khối DỪNG khẩn cấp.
 */
export interface TuyChonKhaoSat {
  /**
   * Hạn của CẢ lượt khảo sát (ms, đo từ lúc gọi). Đọc chung (adapter / ghim) chưa xong khi hết hạn ⇒ MỌI máy `loiKhaoSat`; một adapter chưa
   * kết luận khi hết hạn ⇒ MÁY của nó `loiKhaoSat` (adapters rỗng — "không kiểm được", KHÔNG BAO GIỜ "được"); máy khác giữ kết luận.
   */
  hanMs?: number;
  /** số adapter kiểm đồng thời tối đa (hồ chờ); vắng ⇒ không giới hạn */
  dongThoiToiDa?: number;
  /**
   * R1b-2b-1 T1 fix round 2 (N1 a) — khe khảo sát DÙNG CHUNG TOÀN TIẾN TRÌNH (giữa MỌI lượt gọi). Mỗi việc có truy vấn (đọc chung; kiểm một
   * adapter) phải lấy MỘT khe NGAY (không xếp hàng); hết khe ⇒ việc ấy coi như quá hạn ("không kiểm được"). Khe chỉ trả khi việc THẬT xong
   * (không phải lúc hạn con hết) ⇒ việc bị bỏ rơi vẫn giữ khe ⇒ tải lại liên tục không chồng thêm truy vấn lên pool dùng chung với dungMay.
   */
  khe?: KheKhaoSat;
}

/** Dấu "hết hạn khảo sát" (không ném lỗi thô — ngân sách rawErrorCensus). */
const HET_HAN_KHAO_SAT: unique symbol = Symbol("het_han_khao_sat");

/** Khe khảo sát dùng chung (semaphore KHÔNG xếp hàng). `cao` = mức giữ cao nhất từng đo (cho test). */
export interface KheKhaoSat {
  readonly toiDa: number;
  /** lấy một khe NGAY; false ⇒ hết khe (không chờ) */
  thu(): boolean;
  /** trả một khe (gọi đúng một lần cho mỗi `thu()` thành công) */
  tra(): void;
  dangGiu(): number;
  cao(): number;
  /** chỉ test: đặt lại mức cao (không đụng số đang giữ) */
  _datLaiCao(): void;
}

export function taoKheKhaoSat(toiDa: number): KheKhaoSat {
  let giu = 0;
  let cao = 0;
  return {
    toiDa,
    thu() {
      if (giu >= toiDa) return false;
      giu++;
      if (giu > cao) cao = giu;
      return true;
    },
    tra() {
      if (giu > 0) giu--;
    },
    dangGiu: () => giu,
    cao: () => cao,
    _datLaiCao() {
      cao = giu;
    },
  };
}

/** Chạy `viec` trong một khe (nếu có `khe`): hết khe ⇒ HET_HAN_KHAO_SAT ngay; khe trả khi promise THẬT của `viec` xong. */
function trongKhe<T>(khe: KheKhaoSat | undefined, viec: () => Promise<T>): Promise<T | typeof HET_HAN_KHAO_SAT> {
  if (!khe) return viec();
  if (!khe.thu()) return Promise.resolve(HET_HAN_KHAO_SAT);
  let p: Promise<T>;
  try {
    p = viec();
  } catch (e) {
    khe.tra();
    return Promise.reject(e);
  }
  return p.finally(() => khe.tra());
}

/** `p` trong `ms` ms (null ⇒ không hạn). Hết hạn ⇒ HET_HAN_KHAO_SAT; reject muộn của `p` đã có handler (không thành unhandledRejection). */
function trongHanKhaoSat<T>(p: Promise<T>, ms: number | null): Promise<T | typeof HET_HAN_KHAO_SAT> {
  if (ms === null) return p;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(HET_HAN_KHAO_SAT), Math.max(0, ms));
    (t as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Chạy `f` trên từng phần tử với tối đa `toiDa` lượt đồng thời, giữ thứ tự. `f` không được ném (nơi gọi tự bắt). */
async function chayGioiHanDongThoi<T, R>(ds: readonly T[], toiDa: number | undefined, f: (x: T) => Promise<R>): Promise<R[]> {
  if (toiDa === undefined || toiDa <= 0 || toiDa >= ds.length) return Promise.all(ds.map(f));
  const out = new Array<R>(ds.length);
  let tiep = 0;
  const tho = async () => {
    while (tiep < ds.length) {
      const i = tiep++;
      out[i] = await f(ds[i]);
    }
  };
  await Promise.all(Array.from({ length: toiDa }, tho));
  return out;
}

/** Bản nhiều máy (một lượt đọc adapter + một lượt đọc ghim) — `scadaKenh.cheDo.danhSach` dùng. Không bao giờ ném. */
export async function khaoSatKhaNangDungNhieu(db: Db, machineIds: number[], tuyChon: TuyChonKhaoSat = {}): Promise<Map<number, KhaNangDungMay>> {
  const out = new Map<number, KhaNangDungMay>();
  for (const m of machineIds) out.set(m, { machineId: m, adapters: [], tongHop: "khong" });
  if (machineIds.length === 0) return out;
  const hetHanLuc = tuyChon.hanMs === undefined ? null : Date.now() + tuyChon.hanMs;
  const conLai = (): number | null => (hetHanLuc === null ? null : hetHanLuc - Date.now());
  // fix round 2 (N1 b) — việc bị bỏ rơi kiểm cái này trước MỖI truy vấn kế tiếp
  const daHetHan = (): boolean => hetHanLuc !== null && Date.now() >= hetHanLuc;
  const khe = tuyChon.khe;
  let adapters: HangAdapter[] = [];
  const ghim = new Map<number, StopPinTagRowMuc[]>();
  try {
    // fix round 2 (N1 a) — đọc chung cũng giữ MỘT khe dùng chung tới khi đọc THẬT xong; hết khe ⇒ như quá hạn (không xếp hàng)
    const docChung = await trongHanKhaoSat(
      trongKhe(khe, () => docAdapterVaGhim(db, machineIds, ghim, daHetHan)),
      conLai(),
    );
    if (docChung === HET_HAN_KHAO_SAT) {
      // fix round 1 (I1) — đọc chung quá hạn / hết khe: mọi máy "không kiểm được" (không bao giờ "được"); danh sách máy vẫn trả về
      logger.warn({ hanMs: tuyChon.hanMs, soMay: machineIds.length }, "[SCADA] khảo sát khả năng dừng: đọc adapter/ghim quá hạn hoặc hết khe");
      for (const v of out.values()) v.loiKhaoSat = true;
      return out;
    }
    adapters = docChung;
  } catch (err) {
    // fix round 2 — đọc chung hỏng: KHÔNG làm hỏng danh sách; mọi máy "không kiểm được" (không bao giờ "được")
    logger.error({ err: (err as Error)?.message ?? String(err) }, "[SCADA] khảo sát khả năng dừng: đọc adapter/ghim lỗi");
    for (const v of out.values()) v.loiKhaoSat = true;
    return out;
  }
  const dem: DemToiEdge = new Map();
  type KetQuaMot = (KhaNangDungAdapter & { machineId: number }) | { machineId: number; hetHan: true };
  const ketLuan = await chayGioiHanDongThoi(adapters, tuyChon.dongThoiToiDa, async (a): Promise<KetQuaMot> => {
    const co = { machineId: a.machineId, adapterId: a.id, code: a.code };
    try {
      const hang = ghim.get(a.id) ?? [];
      if (stopPinsFromTagRows(hang).length === 0) return { ...co, trangThai: "chua_ghim" };
      // kiem-dinh R1b-1 H1 (b) — cùng luật với dungMay: ghim mức cao bị bỏ qua; không còn ghim gửi được ⇒ "không tới bằng STOP HMI"
      const { gui, boQua } = phanLoaiGhimStopHmi(hang);
      const ghimBoQua = boQua.map((b) => b.tagKey);
      if (gui.length === 0) return { ...co, trangThai: "ghim_muc_cao", ghimBoQua };
      // fix round 1 (I1) — hết hạn trước khi tới lượt (hồ chờ) hoặc trong lúc kiểm ⇒ máy "không kiểm được"
      const ms = conLai();
      if (ms !== null && ms <= 0) return { machineId: a.machineId, hetHan: true };
      // fix round 2 (N1) — lấy khe dùng chung NGAY (hết khe ⇒ "không kiểm được", không chờ); khe trả khi kiểm THẬT xong; quá hạn ⇒ bỏ truy vấn còn lại
      const kl = await trongHanKhaoSat(
        trongKhe(khe, () => ketLuanCoGhim(db, a, dem, daHetHan)),
        ms,
      );
      if (kl === HET_HAN_KHAO_SAT) return { machineId: a.machineId, hetHan: true };
      return { ...co, ...kl, ...(ghimBoQua.length > 0 ? { ghimBoQua } : {}) };
    } catch (err) {
      // fix round 2 — lỗi khi kiểm MỘT adapter ⇒ chỉ adapter đó "không kiểm được"
      logger.error({ err: (err as Error)?.message ?? String(err), adapterId: a.id }, "[SCADA] khảo sát khả năng dừng: kiểm adapter lỗi");
      return { ...co, trangThai: "khong_kiem_duoc" };
    }
  });
  const mayHetHan = new Set<number>();
  for (const k of ketLuan) {
    if ("hetHan" in k) {
      mayHetHan.add(k.machineId);
      continue;
    }
    const { machineId, ...kq } = k;
    out.get(machineId)?.adapters.push(kq);
  }
  for (const v of out.values()) {
    v.tongHop = tongHopKhaNang(v.adapters);
    if (mayHetHan.has(v.machineId)) {
      // máy có adapter chưa kết luận khi hết hạn ⇒ cả máy "không kiểm được" (adapters rỗng — cùng hình dạng lỗi đọc chung)
      v.loiKhaoSat = true;
      v.adapters = [];
      v.tongHop = "khong";
    }
  }
  if (mayHetHan.size > 0) logger.warn({ hanMs: tuyChon.hanMs, may: [...mayHetHan] }, "[SCADA] khảo sát khả năng dừng: adapter quá hạn ⇒ máy 'không kiểm được'");
  return out;
}

/** Đọc chung: adapter bật của các máy + ghim của chúng (điền `ghim`). Ném khi DB lỗi (nơi gọi bắt). */
async function docAdapterVaGhim(
  db: Db,
  machineIds: number[],
  ghim: Map<number, StopPinTagRowMuc[]>,
  daHetHan: () => boolean = () => false,
): Promise<HangAdapter[] | typeof HET_HAN_KHAO_SAT> {
  const adapters = await docAdapterBat(db, machineIds);
  // fix round 2 (N1 b) — quá hạn sau truy vấn 1 ⇒ không chạy truy vấn ghim
  if (daHetHan()) return HET_HAN_KHAO_SAT;
  if (adapters.length > 0) {
    const rows = await db
      .select({
        adapterId: deviceTags.adapterId,
        tagKey: deviceTags.tagKey,
        dataType: deviceTags.dataType,
        stopValue: deviceTags.stopValue,
        writable: deviceTags.writable,
        isEnabled: deviceTags.isEnabled,
        actuationLevel: deviceTags.actuationLevel,
      })
      .from(deviceTags)
      .where(
        and(
          inArray(
            deviceTags.adapterId,
            adapters.map((a) => a.id),
          ),
          eq(deviceTags.isEnabled, true),
          eq(deviceTags.writable, true),
          isNotNull(deviceTags.stopValue),
        ),
      );
    for (const r of rows) ghim.set(r.adapterId, [...(ghim.get(r.adapterId) ?? []), r]);
  }
  return adapters;
}

/**
 * R1b-2b-1 T1 fix round 1 (điều phối M4 phương án b, 2026-10-26) — gợi ý cấp máy cho khối DỪNG khẩn cấp, suy từ CHÍNH kết quả khảo sát (không
 * đường khảo sát thứ hai) theo CÙNG phân loại của HMI (`tongHopKhaNang`: chỉ `duoc` là tới thiết bị thật — qua edge / mất kết nối / mô phỏng /
 * ghim cũ / chưa ghim / ghim mức cao đều KHÔNG tới). Không kiểm được (khảo sát lỗi / quá hạn / vắng / adapter `khong_kiem_duoc`) ⇒ "khong_ro" —
 * KHÔNG BAO GIỜ suy thành "du". Chỉ là gợi ý: client KHÔNG BAO GIỜ ẩn / khoá nút DỪNG theo nó.
 */
export function tongHopDungKhanCap(k: KhaNangDungMay | undefined): TongHopDungKhanCap {
  if (!k || k.loiKhaoSat) return "khong_ro";
  if (k.adapters.some((a) => a.trangThai === "khong_kiem_duoc")) return "khong_ro";
  switch (k.tongHop) {
    case "duoc":
      return "du";
    case "mot_phan":
      return "mot_phan";
    case "khong":
      return "khong_toi";
    default:
      return "khong_ro";
  }
}

/** Khả năng dừng của MỘT máy (hộp xác nhận + cảnh báo cấp máy). */
export async function khaoSatKhaNangDung(db: Db, machineId: number): Promise<KhaNangDungMay> {
  return (await khaoSatKhaNangDungNhieu(db, [machineId])).get(machineId) as KhaNangDungMay;
}
