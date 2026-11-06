/**
 * Interlock — đánh giá điều kiện rule ĐỒNG BỘ, chỉ đọc DB (KHÔNG Andon/dispatch).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH RIÊNG (doc 25 T1):
 *   - commandDispatcher.dispatch() cần một CỔNG interlock ĐỒNG BỘ, fail-closed
 *     chạy TRƯỚC mọi real-write cho lệnh HITL. Trước đây interlockEngine chỉ là
 *     poll-loop async (mặc định TẮT) → lệnh người-xác-nhận có thể ghi xuống máy
 *     mà KHÔNG qua interlock.
 *   - Module này KHÔNG import commandDispatcher/andonService nên KHÔNG tạo vòng
 *     phụ thuộc khi commandDispatcher import ngược lại (an toàn về mặt module).
 *   - fetchObservation được CHUYỂN vào đây (từ interlockEngine) để cả engine (poll)
 *     lẫn dispatcher (inline) DÙNG CHUNG một logic — tránh nhân bản.
 *
 * SAFETY: các hàm ở đây chỉ ĐỌC feed + trả boolean/kết quả cổng. Chúng KHÔNG bao
 * giờ raise Andon hay ghi lệnh máy — đó là việc của engine/dispatcher.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, or, sql, desc, type SQL } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  interlockRules,
  processResults,
  spcRuleViolations,
  cpkHistory,
  otTelemetry,
  type InterlockRule,
} from "../../../drizzle/schema";
import {
  evaluateCondition,
  deriveObserved,
  type ComparisonOperator,
  type InterlockSourceType,
  type KetQuaDanhGia,
  type ObservationContext,
} from "./ruleEvaluator";
import {
  NGUONG_DEADBAND_MS,
  SO_LICH_SU_TOI_DA,
  adapterTheoMa,
  boDemDangBat,
  demAdapterTrungTamKhaiTag,
  timTheoMayVaTag,
} from "../scada/boDemHienTai";

/** Window start = now - windowSeconds (default 300s). */
function windowStart(rule: InterlockRule): Date {
  const secs = rule.windowSeconds ?? 300;
  return new Date(Date.now() - secs * 1000);
}

/**
 * Query the source feed for a rule and reduce it to an ObservationContext. PURE
 * derivation happens in ruleEvaluator.deriveObserved(). Each branch is scoped by
 * machine when machineId is set (best-effort; rules may be line/station scoped).
 */
/** Độ tươi tối thiểu của hàng telemetry mới nhất khi không biết pollMs của adapter (đường DB). */
export const DO_TUOI_TOI_THIEU_DB_MS = 15_000;

export async function fetchObservation(rule: InterlockRule, now: number = Date.now()): Promise<ObservationContext> {
  const db = await getDb();
  if (!db) return {};
  const since = windowStart(rule);

  switch (rule.sourceType as InterlockSourceType) {
    case "spc_violation": {
      const conds = [gte(spcRuleViolations.detectedAt, since), eq(spcRuleViolations.isActive, true)];
      if (rule.machineId != null) conds.push(eq(spcRuleViolations.machineId, rule.machineId));
      const [r] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(spcRuleViolations)
        .where(and(...conds));
      return { count: r?.c ?? 0 };
    }
    case "process_result": {
      // Count NG/fail process results in window (sourceKey may name a stepType).
      const conds = [gte(processResults.measuredAt, since), eq(processResults.result, "fail")];
      if (rule.machineId != null) conds.push(eq(processResults.machineId, rule.machineId));
      if (rule.sourceKey) conds.push(eq(processResults.stepType, rule.sourceKey));
      const [r] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(processResults)
        .where(and(...conds));
      return { count: r?.c ?? 0 };
    }
    case "ng_rate": {
      // NG-rate (%) over process_results in window: fail / total * 100.
      const conds = [gte(processResults.measuredAt, since)];
      if (rule.machineId != null) conds.push(eq(processResults.machineId, rule.machineId));
      const [r] = await db
        .select({
          total: sql<number>`count(*)::int`,
          fail: sql<number>`count(*) filter (where ${processResults.result} = 'fail')::int`,
        })
        .from(processResults)
        .where(and(...conds));
      const total = r?.total ?? 0;
      const fail = r?.fail ?? 0;
      return { scalar: total > 0 ? (fail / total) * 100 : 0 };
    }
    case "cpk": {
      const conds = [];
      if (rule.machineId != null) conds.push(eq(cpkHistory.machineId, rule.machineId));
      const [r] = await db
        .select({ cpk: cpkHistory.cpk })
        .from(cpkHistory)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(cpkHistory.periodEnd))
        .limit(1);
      return { scalar: r?.cpk != null ? Number(r.cpk) : null };
    }
    case "telemetry_tag": {
      // Canonical ot_telemetry (P2): ts/metric/numValue.
      const conds = [gte(otTelemetry.ts, since)];
      if (rule.machineId != null) conds.push(eq(otTelemetry.machineId, rule.machineId));
      if (rule.sourceKey) conds.push(eq(otTelemetry.metric, rule.sourceKey));
      // ILK-04 (doc 80 Phụ lục D §7.4) — lấy N mẫu MỚI NHẤT trong cửa sổ
      // (ORDER BY ts DESC LIMIT n), rồi đảo lại thành thứ tự thời gian TĂNG DẦN
      // (cũ→mới) vì `series` là hợp đồng "newest-last" mà ruleEvaluator dùng
      // (consecutiveCount lấy `series.slice(-consecutiveCount)`). Trước vá:
      // ORDER BY ts ASC LIMIT n lấy N mẫu CŨ NHẤT trong cửa sổ — khi cửa sổ có
      // nhiều hơn windowSize mẫu, cổng không bao giờ thấy giá trị mới nhất
      // (tái hiện: 120 mẫu/1h, windowSize 50 → cổng thấy mẫu #1..50, bỏ #51..120).
      //
      // SCADA R0 Task 9 (D2, fix 3 + vòng 2) — đường DB phải KHỚP ngữ nghĩa bộ đệm:
      //   (a) hàng MỚI NHẤT (mọi chất lượng; ORDER BY ts DESC, id DESC để xác định khi ts bằng nhau) không good ⇒ chat_luong_xau —
      //       không "lùi" về mẫu good cũ;
      //   (b) hàng trong cửa sổ đến từ >1 deviceId ⇒ mo_ho (không chọn bừa giữa hai nguồn);
      //   (c) hàng mới nhất cũ hơn max(3 × pollMs, 15 s) (pollMs của adapter đăng ký có code = deviceId; deadband ⇒ ≥ 70 s như bộ đệm) ⇒ cu.
      //       TUỔI ĐO TỪ `ingestedAt` (giờ MÁY CHỦ nhận — cùng ngữ nghĩa `rx` của bộ đệm), KHÔNG từ `ts` (giờ thiết bị): đồng hồ thiết bị
      //       chạy NHANH X thì sau khi thiết bị chết, giá trị cuối vẫn "tươi" thêm X ⇒ cổng đánh giá một giá trị đã chết (fail-open); lớp lỗi
      //       lệch múi giờ naive ±7 h của repo cũng đi cùng đường này. `ingestedAt` null (hàng cũ) ⇒ lùi về `ts`.
      //       CỬA SỔ vẫn lọc theo `ts` (giữ chỉ mục (machineId, ts)): hàng có `ts` lệch CŨ quá windowSeconds bị cửa sổ loại ⇒ chuỗi rỗng ⇒
      //       khong_co_mau ⇒ cổng CHẶN (fail-closed) — chọn thế thay vì `OR ingestedAt >= since` vốn phá cắt chunk của hypertable; độ TƯƠI thì
      //       chỉ xét theo `ingestedAt` nên đồng hồ chạy nhanh KHÔNG thể kéo dài tuổi thọ giá trị;
      //   (d) chuỗi = các hàng good MỚI HƠN hàng không-good gần nhất — không nối mẫu qua một đoạn mất kết nối / giá trị không chắc;
      //   (e) giới hạn max(windowSize, consecutiveCount) để windowSize < consecutiveCount không chặn vĩnh viễn.
      const rows = await db
        .select({ v: otTelemetry.numValue, t: otTelemetry.ts, ingestedAt: otTelemetry.ingestedAt, quality: otTelemetry.quality, deviceId: otTelemetry.deviceId })
        .from(otTelemetry)
        .where(and(...conds))
        .orderBy(desc(otTelemetry.ts), desc(otTelemetry.id))
        .limit(Math.max(rule.windowSize ?? 50, rule.consecutiveCount ?? 1));
      if (rows.length === 0) return { series: [], scalar: null };
      if (rows[0].quality !== "good") return { series: [], scalar: null, thieuDuLieu: "chat_luong_xau" };
      if (new Set(rows.map((r) => r.deviceId ?? null)).size > 1) return { series: [], scalar: null, thieuDuLieu: "mo_ho" };
      const adapter = adapterTheoMa(rows[0].deviceId);
      const nguongCu = Math.max(
        3 * (adapter?.pollMs ?? 0),
        DO_TUOI_TOI_THIEU_DB_MS,
        adapter?.coDeadband ? NGUONG_DEADBAND_MS : 0,
      );
      const gioMs = (d: unknown): number => (d instanceof Date ? d.getTime() : d == null ? Number.NaN : new Date(d as string).getTime());
      const nhan = gioMs(rows[0].ingestedAt);
      const tMoiNhat = Number.isFinite(nhan) ? nhan : gioMs(rows[0].t); // ingestedAt null (hàng cũ) ⇒ ts
      if (!Number.isFinite(tMoiNhat) || now - tMoiNhat > nguongCu) return { series: [], scalar: null, thieuDuLieu: "cu" };
      const batDauNgat = rows.findIndex((r) => r.quality !== "good");
      const lien = batDauNgat === -1 ? rows : rows.slice(0, batDauNgat); // mới → cũ, chỉ phần liền mạch good
      lien.reverse();
      const series = lien.map((r) => (r.v != null ? Number(r.v) : null));
      const latest = series.length ? series[series.length - 1] : null;
      return { series, scalar: latest };
    }
    default:
      return {};
  }
}

/**
 * SCADA R0 Task 9 (K3, D11) — đọc quan sát SỐNG của luật `telemetry_tag` từ BỘ ĐỆM GIÁ TRỊ HIỆN TẠI (Task 7) thay vì hàng DB tới 300 s tuổi.
 * Trả `obs` khi có đúng MỘT mẫu tốt, còn tươi; ngược lại trả lý do thiếu dữ liệu (D2: fail-closed — người gọi quyết định chặn).
 *   - luật không gắn máy ⇒ mo_ho (không đoán máy);   0 mẫu ⇒ khong_co_mau;   >1 adapter cùng tagKey trên máy ⇒ mo_ho (không chọn bừa);
 *   - q !== "good" ⇒ chat_luong_xau;   stale ⇒ cu;   ngược lại series = lichSu (cũ→mới), scalar = v.
 *   - final I3 (c): series CHỈ gồm điểm có giờ nhận `rx >= now - windowSeconds·1000` (khớp `ts >= since` của đường DB, theo giờ máy chủ).
 */
function docTuBoDem(
  rule: InterlockRule,
  now: number,
  soAdapterKhai: number,
): { obs: ObservationContext } | { lyDo: NonNullable<KetQuaDanhGia["lyDo"]> } {
  if (rule.machineId == null || !rule.sourceKey?.trim()) return { lyDo: "cau_hinh" };
  // Residual fix (Review Focus 2) — >1 adapter OT trung tâm của máy KHAI tag này ⇒ mơ hồ, kể cả khi mới một adapter có mục trong bộ đệm.
  if (soAdapterKhai > 1) return { lyDo: "mo_ho" };
  const mau = timTheoMayVaTag(rule.machineId, rule.sourceKey, now);
  if (mau.length === 0) return { lyDo: "khong_co_mau" };
  if (mau.length > 1) return { lyDo: "mo_ho" };
  const m = mau[0];
  if (m.q !== "good") return { lyDo: "chat_luong_xau" };
  if (m.stale) return { lyDo: "cu" };
  const scalar = typeof m.v === "number" ? m.v : typeof m.v === "boolean" ? Number(m.v) : null;
  const tuRx = now - (rule.windowSeconds ?? 300) * 1000;
  const series = m.lichSu.filter((_, i) => (m.lichSuRx[i] ?? Number.NEGATIVE_INFINITY) >= tuRx);
  return { obs: { series, scalar } };
}

const NGUON_SO_VO_HUONG: ReadonlySet<string> = new Set(["telemetry_tag", "cpk"]);

/**
 * Đánh giá MỘT luật và trả KẾT QUẢ + giá trị quan sát (engine cần `observed` để ghi sự kiện). `danhGiaLuat` là vỏ chỉ trả kết quả.
 * Có thể ném lỗi nếu fetchObservation lỗi — caller phải bắt và xử lý fail-closed.
 *
 * Thiếu dữ liệu (D2) chỉ áp cho nguồn có GIÁ TRỊ VÔ HƯỚNG có thể vắng (telemetry_tag, cpk): quan sát null ⇒ thieuDuLieu, KHÔNG phải "an toàn".
 * Nguồn đếm (spc_violation, process_result) và ng_rate luôn có số (0 là câu trả lời hợp lệ).
 */
export async function danhGiaLuatChiTiet(
  rule: InterlockRule,
  now: number = Date.now(),
): Promise<{ ketQua: KetQuaDanhGia; observed: number | null }> {
  const sourceType = rule.sourceType as InterlockSourceType;
  const thieu = (lyDo: NonNullable<KetQuaDanhGia["lyDo"]>) => ({
    ketQua: { dung: false, thieuDuLieu: true, lyDo } as KetQuaDanhGia,
    observed: null as number | null,
  });

  // Luật telemetry_tag không gắn máy (hoặc không khai tag) ⇒ HỎNG CẤU TRÚC (cau_hinh) — cùng quy tắc ở cả hai đường (cache bật/tắt):
  // không đoán máy, không bao giờ đánh giá được ⇒ cổng CHẶN (fail-closed), engine không tự phát hành động, router từ chối tạo/sửa/duyệt.
  if (sourceType === "telemetry_tag" && (rule.machineId == null || !rule.sourceKey?.trim())) return thieu("cau_hinh");

  let obs: ObservationContext;
  // Bộ đệm giữ tối đa SO_LICH_SU_TOI_DA mẫu: luật cần "N điểm liên tiếp" với N lớn hơn thì cache KHÔNG đủ ⇒ đọc chuỗi từ DB (vẫn fail-closed
  // nếu DB thiếu mẫu) thay vì chặn vĩnh viễn vì lichSu không bao giờ đủ dài.
  const canChuoiDaiHonBoDem = rule.consecutiveCount != null && rule.consecutiveCount > SO_LICH_SU_TOI_DA;
  // SCADA R0 final I2 — bộ đệm CHỈ được nuôi bởi đường OT trung tâm trong tiến trình này: chỉ đọc nó khi một adapter OT trung tâm đã đăng
  // ký của máy luật KHAI tag luật. Nguồn khác (edge, MQTT, MTConnect, SECS/GEM, CFX, /api/v1, simulator, bản sao không chạy cổng OT) ⇒
  // đường DB (cùng ngữ nghĩa fail-closed). Không có nhánh này, mọi luật của các nguồn đó CHẶN vĩnh viễn với khong_co_mau khi bật bộ đệm.
  const soAdapterKhai =
    sourceType === "telemetry_tag" && rule.machineId != null && rule.sourceKey != null ? demAdapterTrungTamKhaiTag(rule.machineId, rule.sourceKey) : 0;
  if (sourceType === "telemetry_tag" && boDemDangBat() && !canChuoiDaiHonBoDem && soAdapterKhai > 0) {
    const doc = docTuBoDem(rule, now, soAdapterKhai);
    if ("lyDo" in doc) return thieu(doc.lyDo);
    obs = doc.obs;
  } else {
    obs = await fetchObservation(rule, now);
    if (obs.thieuDuLieu) return thieu(obs.thieuDuLieu);
  }

  const observed = deriveObserved(sourceType, obs);
  const threshold = rule.threshold != null ? Number(rule.threshold) : null;
  const lienTiep = rule.consecutiveCount != null && rule.consecutiveCount > 1 && Array.isArray(obs.series);

  if (NGUON_SO_VO_HUONG.has(sourceType)) {
    if (lienTiep) {
      // Đánh giá "N điểm liên tiếp": chưa đủ N mẫu, hoặc có mẫu không phải số trong N mẫu cuối ⇒ chưa kết luận được (không phải "an toàn").
      const series = obs.series!;
      const n = rule.consecutiveCount!;
      if (series.length < n) return thieu("khong_co_mau");
      if (series.slice(-n).some((v) => typeof v !== "number" || Number.isNaN(v))) return thieu("khong_co_mau");
    } else if (observed == null || Number.isNaN(observed)) {
      return thieu("khong_co_mau");
    }
  }

  const dung = evaluateCondition(
    observed,
    rule.comparisonOperator as ComparisonOperator,
    threshold,
    rule.consecutiveCount,
    obs.series,
  );
  return { ketQua: { dung, thieuDuLieu: false }, observed };
}

/** Kết quả đánh giá một luật (đúng/sai/thiếu dữ liệu). Dùng chung bởi cổng inline và interlockEngine. */
export async function danhGiaLuat(rule: InterlockRule, now: number = Date.now()): Promise<KetQuaDanhGia> {
  return (await danhGiaLuatChiTiet(rule, now)).ketQua;
}

/**
 * Đánh giá ĐỒNG BỘ điều kiện của một rule → true khi điều kiện ĐANG vi phạm (met). Giữ cho người gọi cũ; trả `danhGiaLuat(...).dung`
 * (thiếu dữ liệu ⇒ false ở đây — nơi cần phân biệt phải gọi `danhGiaLuat`). Có thể ném lỗi — caller phải bắt và xử lý fail-closed.
 */
export async function evaluateRuleCondition(rule: InterlockRule): Promise<boolean> {
  return (await danhGiaLuat(rule)).dung;
}

/**
 * Các action interlock được coi là "chặn máy" (dùng làm allowlist cho cổng inline).
 * Export để nơi khác đo "độ phủ interlock" (ví dụ `oversightRouter.posture`, ILK-06) dùng
 * ĐÚNG cùng tập — hai định nghĩa "rule nào thực sự chặn được lệnh" lệch nhau là chính hình
 * dạng báo-xanh-giả mà ILK-06 tồn tại để bắt (Fix round 1 doc 80 Đợt 1 Task 2).
 */
export const INTERLOCK_GATE_ACTIONS: ReadonlySet<string> = new Set([
  "block_downstream",
  "stop_line",
  "reduce_speed",
]);

export interface InterlockGateViolation {
  ruleId: number;
  ruleName: string;
  action: string;
  /** "thieu_du_lieu" = bị chặn vì luật KHÔNG đánh giá được (thiếu/xấu/cũ/mơ hồ — D2), không phải vì điều kiện met. */
  lyDo?: "thieu_du_lieu" | "cau_hinh";
}

export interface InterlockGateResult {
  /** true = có rule chặn đang vi phạm HOẶC lỗi đánh giá (fail-closed) → cấm ghi. */
  blocked: boolean;
  /** true = bị chặn vì lỗi/không đánh giá được (fail-closed), không phải do rule met. */
  failClosed: boolean;
  violations: InterlockGateViolation[];
  /**
   * SCADA R1b-2b-2a A2(j) — present ⇔ the rule set aimed at this command has MORE than `tran` rows (`TRAN_LUAT_INTERLOCK`): the gate evaluated
   * NOTHING and refused (`blocked && failClosed`), never a subset. Callers only name it in their refusal text (codes unchanged).
   */
  vuotTran?: { tran: number };
}

/**
 * Đích máy của lệnh khi hỏi cổng. `machineId` = MỘT id máy (dạng cũ); `machineIds` = TẬP máy (A2(i)(1): đường OT truyền
 * `tapMayChoInterlock(máy của adapter, máy bên gọi)`; A2(l): cổng robot truyền máy NƠI robot đứng — `tapMayChoRobot`, KHÔNG BAO GIỜ id robot).
 * Luật `targetMachineId` khớp nếu nằm trong HỢP của hai trường (null / vắng bị bỏ).
 * `robotId` (A2(l)) — CHỈ để gọi tên robot trong cảnh báo vượt trần (khoá khử trùng + entityId); KHÔNG tham gia khớp luật.
 */
export interface InterlockGateTarget {
  adapterId: number;
  machineId?: number | null;
  machineIds?: readonly number[];
  tagKeys: string[];
  robotId?: number;
}

/** Rule có nhắm tới đúng thiết bị/máy của lệnh này không (theo targetAdapterId/targetMachineId/commandTag). */
function isTargeted(rule: InterlockRule, params: InterlockGateTarget): boolean {
  const byAdapter = rule.targetAdapterId != null && rule.targetAdapterId === params.adapterId;
  const target = rule.targetMachineId;
  const byMachine =
    target != null &&
    ((params.machineId != null && target === params.machineId) || (params.machineIds?.includes(target) ?? false));
  // commandTag khớp tag đang ghi (và, nếu có targetAdapterId, phải cùng adapter).
  const byTag =
    rule.commandTag != null &&
    params.tagKeys.includes(rule.commandTag) &&
    (rule.targetAdapterId == null || rule.targetAdapterId === params.adapterId);
  return byAdapter || byMachine || byTag;
}

/** The JS filter of the gate over an ENABLED rule: approved (raw) + a blocking action + `isTargeted`. Exported for the J2 equivalence grid only. */
export function laLuatChanNhamDung(rule: InterlockRule, params: InterlockGateTarget): boolean {
  return rule.approvedBy != null && INTERLOCK_GATE_ACTIONS.has(rule.action) && isTargeted(rule, params);
}

/**
 * SCADA R1b-2b-2a A2(j) — the most rules the gate loads for ONE command. More ⇒ fail-closed (`vuotTran`) + one deduped URGENT alert; never a
 * partial set. Why 1000 (the old literal, kept): the query is now narrowed to the rules aimed AT this command (adapter / machine set / global tag
 * key — `dieuKienLuatUngVien`), enabled + approved + a blocking action; a real target has single digits to tens of those, so 1000 is reached only by
 * misconfiguration. A smaller value would turn configurations we cannot measure into new refusals; a larger or no cap would let a pathological rule
 * set add unbounded latency to the gate, which also runs on the pinned-STOP path (commandDispatcher, before the R-1D-c override). The narrowed set
 * is a subset of what the old unnarrowed `.limit(1000)` counted, so no command that passed the old cap honestly can hit this one.
 */
export const TRAN_LUAT_INTERLOCK = 1000;
let tranLuatChoTest: number | null = null;
/** Tests only: lower the cap (null = back to TRAN_LUAT_INTERLOCK). */
export function _datTranLuatInterlockChoTest(n: number | null): void {
  tranLuatChoTest = n;
}
function tranLuatHienTai(): number {
  return tranLuatChoTest ?? TRAN_LUAT_INTERLOCK;
}

/** The machine set of a target: {machineId} ∪ machineIds, safe integers only (no integer column value can equal anything else), de-duplicated. */
function tapMayCuaDich(params: InterlockGateTarget): number[] {
  const out: number[] = [];
  for (const m of [params.machineId, ...(params.machineIds ?? [])]) {
    if (typeof m === "number" && Number.isSafeInteger(m) && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * SCADA R1b-2b-2a A2(j) — the SQL form of "enabled + approved + blocking action + `isTargeted`" — EXACTLY the JS filter (pinned by the J2 grid,
 * interlockGate.tranLuat.a2j.test.ts, and its DB twin), so the cap counts only rules that can decide this command:
 *   • approved: `approvedBy IS NOT NULL` ≡ `r.approvedBy != null` (raw, deliberately — see evaluateInterlockGate);
 *   • action: `action IN INTERLOCK_GATE_ACTIONS` ≡ `.has(r.action)`;
 *   • byAdapter: `targetAdapterId = adapterId` (NULL never equal) — only for a safe-integer adapterId (anything else can equal no integer);
 *   • byMachine: `targetMachineId IN {machineId} ∪ machineIds` — omitted when that set is empty (robot gate: tapMayChoRobot; OT: tapMayChoInterlock);
 *   • byTag: `commandTag IN tagKeys AND targetAdapterId IS NULL` — the `targetAdapterId = adapterId` half of JS byTag is already byAdapter; omitted
 *     when there is no tag key (robot gate).
 * A rule with no targetAdapterId, no targetMachineId and no commandTag is targeted by NOTHING in JS, so no SQL branch returns it. The JS filter
 * still runs after the query (backstop).
 */
export function dieuKienLuatUngVien(params: InterlockGateTarget): SQL {
  const nhanh: SQL[] = [];
  if (Number.isSafeInteger(params.adapterId)) nhanh.push(eq(interlockRules.targetAdapterId, params.adapterId));
  const tapMay = tapMayCuaDich(params);
  if (tapMay.length > 0) nhanh.push(inArray(interlockRules.targetMachineId, tapMay));
  const tags = [...new Set((params.tagKeys ?? []).filter((t): t is string => typeof t === "string"))];
  if (tags.length > 0) nhanh.push(and(inArray(interlockRules.commandTag, tags), isNull(interlockRules.targetAdapterId)) as SQL);
  return and(
    eq(interlockRules.enabled, true),
    isNotNull(interlockRules.approvedBy),
    inArray(interlockRules.action, [...INTERLOCK_GATE_ACTIONS] as Array<InterlockRule["action"]>),
    nhanh.length > 0 ? (or(...nhanh) as SQL) : sql`false`,
  ) as SQL;
}

/** In-process dedup of the cap alert (the inbox row is also deduped durably for 24 h by raiseCriticalStopAlert `khuTrungBenVung`). */
const tranDaBao = new Map<string, number>();
const TRAN_BAO_CUA_SO_MS = 24 * 60 * 60 * 1000;
/** Tests only: forget the in-process dedup (simulates a restart). */
export function _quenCanhBaoTranLuatChoTest(): void {
  tranDaBao.clear();
}

/** The robot id named by a target (A2(l): passed separately — never one of its machines), or null. */
function robotCuaDich(params: InterlockGateTarget): number | null {
  return typeof params.robotId === "number" && Number.isSafeInteger(params.robotId) ? params.robotId : null;
}

/**
 * The dedup key of the cap alert: the adapter AND the machine set, plus the robot (A2(l): the robot gate passes adapterId -1 for every robot and
 * the machines of its place — two robots on one line share the set, so the robot id is part of the key).
 */
export function khoaCanhBaoTranLuat(params: InterlockGateTarget): string {
  const robot = robotCuaDich(params);
  return `interlock_tran_luat:adapter:${params.adapterId}:may:${tapMayCuaDich(params).join(",")}${robot !== null ? `:robot:${robot}` : ""}`;
}

/**
 * ONE deduped URGENT alert that the rule set of a target exceeds the cap (the alert stream + a safety-critical inbox row to every active admin).
 * Fire-and-forget: never awaited on the decision path, never throws. An inbox / alert-stream notice is neither an Andon nor a command write
 * (the module rule at the top still holds).
 */
function baoVuotTranLuat(params: InterlockGateTarget, tran: number): void {
  const key = khoaCanhBaoTranLuat(params);
  const now = Date.now();
  const luc = tranDaBao.get(key);
  if (luc !== undefined && now - luc < TRAN_BAO_CUA_SO_MS) return;
  if (tranDaBao.size >= 5_000) tranDaBao.clear();
  tranDaBao.set(key, now);
  const tapMay = tapMayCuaDich(params);
  // A2(l) — the robot is named by its OWN id (params.robotId), never by one of its machines (it used tapMay[0])
  const robot = robotCuaDich(params);
  const dich = params.adapterId >= 0 ? `adapter ${params.adapterId}` : `robot ${robot ?? "?"}`;
  const message =
    `The interlock rules aimed at ${dich}${tapMay.length ? ` (machines ${tapMay.join(", ")})` : ""} exceed ${tran} ` +
    `(enabled, approved, blocking). The inline interlock gate refuses every command to it (fail-closed) until the rule set is reduced; ` +
    `a pinned OT STOP is still sent (R-1D-c). Review the interlock rules of this target.`;
  void (async () => {
    try {
      let recipients: number[] = [];
      try {
        const db = await getDb();
        const r = db ? await (db as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true`) : [];
        recipients = ((Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: unknown }>).map((x) => Number(x.id)).filter((x) => Number.isSafeInteger(x) && x > 0);
      } catch {
        recipients = []; // the alert stream + log still carry it
      }
      const { raiseCriticalStopAlert } = await import("../robot/criticalStopAlert");
      await raiseCriticalStopAlert({
        kind: "interlock_tran_luat",
        title: `Interlock rule set over the cap — ${dich}`,
        message,
        recipients,
        dedupKey: key,
        source: params.adapterId >= 0 ? "ot" : "robot",
        entityType: params.adapterId >= 0 ? "device_adapter" : "robot",
        entityId: params.adapterId >= 0 ? params.adapterId : (robot ?? undefined),
        khuTrungBenVung: {},
      });
    } catch (err) {
      console.error(`[InterlockGate] cap alert failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    }
  })();
}

/**
 * CỔNG INTERLOCK ĐỒNG BỘ — dùng inline trong commandDispatcher.dispatch() TRƯỚC
 * mọi real-write cho lệnh HITL.
 *
 * Chỉ xét rule đã enabled + approved (approvedBy != null), có action chặn/dừng
 * (allowlist), và nhắm ĐÚNG target của lệnh (targetAdapterId / targetMachineId /
 * commandTag). Với mỗi rule liên quan, đánh giá điều kiện live: nếu ĐANG vi phạm →
 * ghi vào violations. blocked=true khi có ≥1 vi phạm.
 *
 * FAIL-CLOSED: bất kỳ lỗi nào (không có DB, query lỗi, evaluator ném) → trả
 * { blocked:true, failClosed:true } để dispatcher TỪ CHỐI ghi (an toàn hơn cho phép).
 * Rule proposed/chưa duyệt KHÔNG chặn (không nằm trong tập enabled+approved).
 * kiem-dinh R1b-1 I1 (a) (2026-10-25) — CỐ Ý dùng `approvedBy != null` THÔ, không dùng "duyệt còn hiệu lực" (bám định nghĩa tag khớp —
 * `dinhNghiaDuyet.ts`): cổng này CHỈ CHẶN; coi luật lệch bám là chưa duyệt sẽ GỠ chặn (fail-open). Luật lệch bám vẫn chặn theo điều kiện như
 * trước; nó chỉ mất quyền bật lại / tự gửi lệnh (enable, engine, dispatcher).
 */
export async function evaluateInterlockGate(params: InterlockGateTarget): Promise<InterlockGateResult> {
  try {
    const now = Date.now();
    const db = await getDb();
    if (!db) return { blocked: true, failClosed: true, violations: [] };

    // SCADA R1b-2b-2a A2(j) — only the rules that can decide THIS command (dieuKienLuatUngVien ≡ the JS filter below), in a fixed order, cap + 1:
    // more than the cap ⇒ refuse (fail-closed) + one deduped alert — never evaluate an arbitrary subset (the old `.limit(1000)` counted every
    // enabled rule of the database, unordered ⇒ a targeted rule could fall outside it and the command went through).
    const tran = tranLuatHienTai();
    const enabledRules = await db
      .select()
      .from(interlockRules)
      .where(dieuKienLuatUngVien(params))
      .orderBy(asc(interlockRules.id))
      .limit(tran + 1);
    if (enabledRules.length > tran) {
      console.error(`[InterlockGate] more than ${tran} interlock rules aimed at adapter ${params.adapterId} — fail-closed (nothing evaluated)`);
      baoVuotTranLuat(params, tran);
      return { blocked: true, failClosed: true, violations: [], vuotTran: { tran } };
    }

    // Backstop: the same filter in JS (the SQL above returns exactly this set; kept so a query change can never widen what blocks).
    const relevant = enabledRules.filter((r) => laLuatChanNhamDung(r, params));

    const violations: InterlockGateViolation[] = [];
    for (const rule of relevant) {
      // danhGiaLuat có thể ném → nhảy xuống catch → fail-closed.
      const kq = await danhGiaLuat(rule, now);
      if (kq.thieuDuLieu && kq.lyDo === "cau_hinh") {
        // Luật hỏng cấu trúc: LUÔN chặn (cho_qua là chấp nhận thiếu DỮ LIỆU, không phải chấp nhận luật hỏng).
        violations.push({ ruleId: rule.id, ruleName: rule.name, action: rule.action, lyDo: "cau_hinh" });
      } else if (kq.thieuDuLieu) {
        // D2 fail-closed: thiếu/xấu/cũ/mơ hồ ⇒ CHẶN, trừ khi chủ luật khai tường minh "cho_qua". Giá trị khác/vắng ⇒ coi như "chan".
        if (rule.khiThieuDuLieu !== "cho_qua") {
          violations.push({ ruleId: rule.id, ruleName: rule.name, action: rule.action, lyDo: "thieu_du_lieu" });
        }
      } else if (kq.dung) {
        violations.push({ ruleId: rule.id, ruleName: rule.name, action: rule.action });
      }
    }

    return { blocked: violations.length > 0, failClosed: false, violations };
  } catch {
    // Lỗi đánh giá bất kỳ → fail-closed: cấm real-write.
    return { blocked: true, failClosed: true, violations: [] };
  }
}
