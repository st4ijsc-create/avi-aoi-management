import { getDb } from "../db/connection";
import {
  productInspections,
  users,
  dailyStatistics,
  predictiveAlerts,
  predictiveAlertOccurrences,
  machines,
} from "../../drizzle/schema";
import { eq, and, gte, sql, inArray, lt, isNull, desc } from "drizzle-orm";
import { sendAlertNotification } from "./notificationService";
import { sendAlertEmail } from "./emailService";
import { redisService } from "./redisService";
// doc69 W1 "modelfix" — shared env→GGUF-basename resolver; the AI routing rationale below must PIN
// a text model (un-pinned calls used to land on the 0.6B RAG embedder → repetition garbage).
import { resolveLogicalModel } from "./ai/modelResolver";
import { decideAlertWrite, type AlertSeverity } from "./alerts/decideAlertWrite";
import { decideNotify } from "./alerts/decideNotify";

/** Wave 3 §4.2 — hạn dùng cảnh báo. Gia hạn mỗi lần tái diễn, nên hết hạn
 *  nghĩa là "tình trạng đã THÔI tái diễn", không phải "đã quá N ngày". */
function alertTtlMs(): number {
  const raw = Number(process.env.ALERT_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 72;
  return hours * 3600_000;
}

/** Sprint 5 §2.7 — cooldown im lặng cho cảnh báo ĐANG MỞ tái diễn. Mặc định 4h:
 *  với nhịp đo được 22 lần/ngày ⇒ ≤6 lượt báo/ngày thay vì 22. */
function renotifyCooldownMs(): number {
  const raw = Number(process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : 240;
  return minutes * 60_000;
}

/** 0 (mặc định) = CRITICAL luôn báo ngay, không bao giờ gộp. Van để khách chỉnh
 *  nếu CRITICAL hoá ra mới là nguồn nhiễu thật ở nhà máy của họ. */
function criticalCooldownMs(): number {
  const raw = Number(process.env.ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  return minutes * 60_000;
}

/** Sprint 5 §2.5 — VAN AN TOÀN, không phải cổng chặn. Chỉ để một vòng lặp hỏng
 *  phía phát (detector chạy mỗi giây) không bơm vô hạn vào bảng nhật ký. */
function maxPerWindow(): number {
  const raw = Number(process.env.ROUTE_ALERT_MAX_PER_WINDOW);
  return Number.isFinite(raw) && raw > 0 ? raw : 200;
}

/**
 * Sprint 5 debt E4 — biến môi trường sai chính tả/giá trị rơi về mặc định
 * TRONG IM LẶNG. `Number("abc")` → NaN → validation fail → mặc định 240;
 * `Number("-1")` → -1 → âm không hợp lệ → cũng rớt về 240 — cả hai không một
 * dòng log. Người vận hành gõ nhầm TÊN biến hoặc giá trị lúc định TẮT/chỉnh
 * cooldown sẽ nhận đúng 4h im lặng và không cách nào biết vì sao cấu hình của
 * họ bị bỏ qua.
 *
 * In MỘT LẦN lúc module nạp (không phải mỗi lần routeAlert() gọi — hàm này có
 * thể chạy hàng trăm lần/phút, log mỗi lượt sẽ làm ồn chính KPI đang cố sửa).
 * Nêu CẢ giá trị THÔ (raw, có thể undefined/rác) lẫn giá trị HIỆU LỰC
 * (effective — gọi thẳng 3 hàm ở trên để không lặp lại logic validate và có
 * nguy cơ lệch nhau). Khi khác nhau ⇒ cấu hình bị bỏ qua, cảnh báo RÕ để vận
 * hành biết còn phải sửa lại thay vì đoán mò suốt cửa sổ cooldown.
 */
function logEffectiveAlertRoutingEnvOnce(): void {
  const describeOne = (
    envName: string,
    effective: number,
    unit: string,
    isValidRaw: (n: number) => boolean,
  ): void => {
    const raw = process.env[envName];
    const rawDisplay = raw === undefined ? "(chưa đặt)" : JSON.stringify(raw);
    // Review round 1, Minor-4 (nâng lên) — trước đây so CHUỖI
    // (String(effective) !== raw): "60 " (khoảng trắng cuối), "060", "1e3" đều
    // là số THẬT SỰ ĐƯỢC DÙNG (Number() parse đúng, hàm validate ở trên chấp
    // nhận) nhưng lệch ĐỊNH DẠNG chuỗi với `effective` ⇒ bị báo "KHÔNG hợp lệ
    // — rơi về mặc định" SAI CẢ HAI MỆNH ĐỀ (giá trị vẫn đang được dùng, và
    // effective không phải mặc định). Phải kiểm ĐÚNG luật hợp lệ của chính hàm
    // đang mô tả (truyền vào isValidRaw), không suy từ so khớp định dạng chuỗi.
    if (raw !== undefined && !isValidRaw(Number(raw))) {
      console.log(
        `[SmartAlert] CẤU HÌNH ${envName}=${rawDisplay} KHÔNG hợp lệ — đã ÂM THẦM rơi về ` +
          `mặc định ${effective}${unit}. Nếu bạn định đổi giá trị này (kể cả để TẮT), kiểm ` +
          `tra lại chính tả/giá trị — cấu hình hiện tại đang bị BỎ QUA.`,
      );
      return;
    }
    console.log(`[SmartAlert] ${envName}: thô=${rawDisplay} → hiệu lực=${effective}${unit}`);
  };
  const isValidCooldown = (n: number) => Number.isFinite(n) && n >= 0;
  const isValidCap = (n: number) => Number.isFinite(n) && n > 0;
  describeOne("ALERT_RENOTIFY_COOLDOWN_MINUTES", renotifyCooldownMs() / 60_000, " phút", isValidCooldown);
  describeOne("ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES", criticalCooldownMs() / 60_000, " phút", isValidCooldown);
  describeOne("ROUTE_ALERT_MAX_PER_WINDOW", maxPerWindow(), " lượt/cửa sổ", isValidCap);
}
logEffectiveAlertRoutingEnvOnce();

// ─── Types ───────────────────────────────────────────────────────────────────

type AlertType =
  | "DEFECT_SPIKE"
  | "YIELD_DROP"
  | "MACHINE_FAILURE"
  | "QUALITY_DEGRADATION"
  | "PATTERN_ANOMALY";

type EscalationLevel = "L1" | "L2" | "L3";

interface SmartAlertEvent {
  type: AlertType;
  machineId?: number;
  factoryId?: number;
  productModelId?: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  data: Record<string, unknown>;
}

interface RouteTarget {
  userId: number;
  username: string;
  role: string;
  email: string | null;
  reason: string;
}

interface RoutingResult {
  alertType: AlertType;
  targets: RouteTarget[];
  consolidated: boolean;
  consolidationGroup?: string;
  escalationLevel: EscalationLevel;
  suggestedAction?: string;
}

// ─── Cooldown & De-duplication ───────────────────────────────────────────────
//
// PERSISTENCE (bug #4): the consolidation/dedup state and the pending-escalation
// state used to live in process-local Maps, so they were lost on restart and not
// safe across multiple instances. We now persist:
//   • consolidation counters → Redis (redisService — which itself falls back to a
//     shared in-memory cache when REDIS_URL is unset, so behaviour degrades
//     gracefully on single-instance deployments).
//   • pending escalation state → the predictive_alerts table directly. Every
//     routed alert is already INSERTed there with createdAt / acknowledgedAt /
//     escalationLevel, so the table IS the source of truth — no second store and
//     no drift. processAutoEscalation() now scans the table instead of a Map.

const CONSOLIDATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ESCALATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CONSOLIDATION_TTL_SECONDS = Math.ceil(CONSOLIDATION_WINDOW_MS / 1000);

// Redis key namespace for consolidation counters.
const consolidationRedisKey = (consolidationKey: string) =>
  `smartalert:consolidation:${consolidationKey}`;

interface ConsolidationEntry {
  timestamp: number;
  count: number;
  // Sprint 5 debt E5 — đã in cảnh báo VAN AN TOÀN cho CỬA SỔ này chưa. Một
  // vòng lặp hỏng ở phía phát sinh 1000 lượt/phút từng kéo theo 1000 dòng
  // warn/phút (mỗi lượt chạm trần lại warn một lần) — chính log dùng để PHÁT
  // HIỆN vòng lặp hỏng lại trở thành một vòng lặp gây ồn khác. Cờ này (nằm
  // NGAY TRONG entry Redis đã có sẵn, không cần kho nhớ riêng) đảm bảo chỉ
  // dòng warn ĐẦU TIÊN của mỗi cửa sổ 5 phút được in ra.
  warned?: boolean;
}

async function getConsolidationEntry(consolidationKey: string): Promise<ConsolidationEntry | null> {
  try {
    return await redisService.get<ConsolidationEntry>(consolidationRedisKey(consolidationKey));
  } catch (err) {
    console.error("[SmartAlert] consolidation read failed:", (err as Error).message);
    return null;
  }
}

async function setConsolidationEntry(consolidationKey: string, entry: ConsolidationEntry): Promise<void> {
  try {
    await redisService.set(consolidationRedisKey(consolidationKey), entry, CONSOLIDATION_TTL_SECONDS);
  } catch (err) {
    console.error("[SmartAlert] consolidation write failed:", (err as Error).message);
  }
}

// Sprint 5 debt E2 — cảnh báo KHÔNG gắn máy (vd YIELD_DROP cấp nhà máy) là nhóm
// DUY NHẤT còn đứng ngoài cooldown thông báo: existingOpen chỉ được tra khi có
// machineId (routeAlert, nhánh :212 bên dưới), nên decideAlertWrite() luôn trả
// action="insert" cho nhóm này — ở MỌI lượt gọi, không riêng lượt đầu. Không có
// dòng predictive_alerts nào để đọc notificationSentAt cho nhóm không-máy, nên
// mượn đúng khuôn Redis get/set ở trên để tự nhớ mốc gửi gần nhất theo
// consolidationKey. TTL = cooldown thường × 2 — đủ dài để cooldown không hết hạn
// thầm lặng giữa hai lần tái diễn đo được, tối thiểu 1s để tránh SETEX ttl<=0 khi
// khách chỉnh cooldown về 0.
const lastNotifyRedisKey = (consolidationKey: string) =>
  `smartalert:lastnotify:${consolidationKey}`;

interface LastNotifyEntry {
  timestamp: number;
}

async function getLastNotifyEntry(consolidationKey: string): Promise<LastNotifyEntry | null> {
  try {
    return await redisService.get<LastNotifyEntry>(lastNotifyRedisKey(consolidationKey));
  } catch (err) {
    console.error("[SmartAlert] đọc mốc-gửi-gần-nhất (nhóm không-máy) THẤT BẠI:", (err as Error).message);
    return null;
  }
}

async function setLastNotifyEntry(consolidationKey: string, entry: LastNotifyEntry, cooldownMs: number): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((cooldownMs * 2) / 1000));
  try {
    await redisService.set(lastNotifyRedisKey(consolidationKey), entry, ttlSeconds);
  } catch (err) {
    console.error("[SmartAlert] ghi mốc-gửi-gần-nhất (nhóm không-máy) THẤT BẠI:", (err as Error).message);
  }
}

// Map the integer escalationLevel stored on predictive_alerts (0=none/L1,
// 1=L2/supervisor, 2=L3/admin) to/from the logical L1/L2/L3 labels used here.
function escalationLevelToLabel(level: number): EscalationLevel {
  if (level >= 2) return "L3";
  if (level === 1) return "L2";
  return "L1";
}

// ─── Main Routing Logic ──────────────────────────────────────────────────────

export async function routeAlert(event: SmartAlertEvent): Promise<RoutingResult> {
  const db = await getDb();
  if (!db) {
    // Vòng sửa cuối, mục 2 — đường thoát IM LẶNG TUYỆT ĐỐI cuối cùng còn lại: không
    // dòng cảnh báo, không dòng nhật ký, KHÔNG cả một dòng log. Mọi lỗi I/O khác
    // trong hàm này giờ đều fail-open CÓ dấu vết (console.error/warn); DB không kết
    // nối được thì không có gì để nối vào cả, nhưng ít nhất phải THẤY được sự kiện
    // này đã xảy ra — khép nốt bất biến "không lần tái diễn nào biến mất im lặng".
    console.warn(`[SmartAlert] KHÔNG CÓ DB — bỏ cảnh báo "${event.type}" mà không ghi được gì (máy #${event.machineId ?? "?"})`);
    return { alertType: event.type, targets: [], consolidated: false, escalationLevel: "L1" };
  }

  // Step 1: Check consolidation — same root cause? (persisted in Redis)
  const consolidationKey = buildConsolidationKey(event);
  const existing = await getConsolidationEntry(consolidationKey);
  const now = Date.now();
  let consolidated = false;

  if (existing && now - existing.timestamp < CONSOLIDATION_WINDOW_MS) {
    const nextCount = existing.count + 1;
    consolidated = true;
    // Sprint 5 §2.5 — trần cũ là `nextCount > 3` và return sớm TRƯỚC cả đường
    // ghi DB lẫn nhật ký ⇒ lần tái diễn thứ 4+ biến mất không dấu vết: KPI đếm
    // thiếu ngay tại cửa, và flood ISA-18.2 (>10/10 phút) không kích hoạt được
    // cho MỘT máy (3/5 phút = 6/10 phút, dưới ngưỡng).
    // Việc gộp THÔNG BÁO nay do decideNotify lo — đây chỉ còn là van an toàn.
    const cap = maxPerWindow();
    // Sprint 5 debt E5 — trước đây warn MỖI LƯỢT chạm trần: một vòng lặp hỏng
    // 1000 lượt/phút sinh 1000 dòng warn/phút, chính log dùng để bắt vòng lặp
    // hỏng lại trở thành một vòng lặp gây ồn khác. Chỉ warn LẦN ĐẦU chạm trần
    // trong mỗi cửa sổ 5 phút — nhớ bằng field `warned` ngay trong entry Redis
    // đã có sẵn (không cần kho nhớ riêng).
    let warned = existing.warned ?? false;
    if (nextCount > cap && !warned) {
      console.warn(
        `[SmartAlert] VAN AN TOÀN: khoá ${consolidationKey} đã ${nextCount} lượt trong ` +
          `${CONSOLIDATION_WINDOW_MS / 1000}s (trần ROUTE_ALERT_MAX_PER_WINDOW=${cap}) — bỏ lượt này. ` +
          `Nghi vấn vòng lặp hỏng ở phía phát cảnh báo.`,
      );
      warned = true;
    }
    await setConsolidationEntry(consolidationKey, { timestamp: existing.timestamp, count: nextCount, warned });
    if (nextCount > cap) {
      return {
        alertType: event.type,
        targets: [],
        consolidated: true,
        consolidationGroup: consolidationKey,
        escalationLevel: "L1",
        suggestedAction: `Vượt trần ${cap} lượt/cửa sổ — nghi vấn vòng lặp hỏng ở phía phát.`,
      };
    }
  } else {
    await setConsolidationEntry(consolidationKey, { timestamp: now, count: 1, warned: false });
  }

  // W0-F G5.5 (doc 44, mig 0249): persist runbook/recommendation pointers when the
  // RAISER supplied one (e.g. SLO burn-rate alerts pass data.runbook from the SLO
  // catalogue). Columns are included ONLY when present so alert paths that carry
  // no reference keep the exact pre-0249 INSERT shape (safe on an un-migrated DB).
  const runbookRef =
    typeof event.data.runbookRef === "string" && event.data.runbookRef.trim()
      ? event.data.runbookRef.trim()
      : typeof event.data.runbook === "string" && event.data.runbook.trim()
        ? event.data.runbook.trim()
        : null;
  const recommendationRef =
    typeof event.data.recommendationRef === "string" && event.data.recommendationRef.trim()
      ? event.data.recommendationRef.trim()
      : null;

  // Wave 3 §3 — MỘT-CẢNH-BÁO-MỞ cho mỗi (machineId, alertType).
  let existingOpen: {
    id: number;
    severity: AlertSeverity;
    occurrenceCount: number;
    notificationSentAt: Date | null;
  } | null = null;
  let lookupFailed = false;
  if (event.machineId != null) {
    try {
      const rows = await db
        .select({
          id: predictiveAlerts.id,
          severity: predictiveAlerts.severity,
          occurrenceCount: predictiveAlerts.occurrenceCount,
          // Sprint 5 §2.4 — mốc gửi gần nhất. Cột đã có sẵn từ trước, chỉ chưa
          // ai đọc và chưa ai cập nhật sau lần INSERT đầu tiên.
          notificationSentAt: predictiveAlerts.notificationSentAt,
        })
        .from(predictiveAlerts)
        .where(and(
          eq(predictiveAlerts.machineId, event.machineId),
          eq(predictiveAlerts.alertType, event.type),
          eq(predictiveAlerts.status, "ACTIVE" as any),
          isNull(predictiveAlerts.acknowledgedAt),
        ))
        .orderBy(desc(predictiveAlerts.createdAt))
        .limit(1);
      existingOpen = rows[0]
        ? {
            id: rows[0].id,
            severity: String(rows[0].severity) as AlertSeverity,
            occurrenceCount: Number(rows[0].occurrenceCount ?? 1),
            notificationSentAt: rows[0].notificationSentAt ? new Date(rows[0].notificationSentAt) : null,
          }
        : null;
    } catch (err) {
      // FAIL-OPEN có chủ ý (spec §3d): thà một dòng trùng còn hơn mất một cảnh báo hỏng máy.
      lookupFailed = true;
      console.error("[SmartAlert] tra cứu cảnh báo mở THẤT BẠI — ghi mới để không bỏ sót:", (err as Error)?.message ?? err);
    }
  }

  // Mã máy: cột phi chuẩn hoá trước đây KHÔNG BAO GIỜ được ghi (spec §2 nguyên nhân 3).
  let machineCode: string | null = null;
  if (event.machineId != null) {
    try {
      const m = await db.select({ code: machines.code }).from(machines).where(eq(machines.id, event.machineId)).limit(1);
      machineCode = m[0]?.code ?? null;
    } catch { machineCode = null; }
  }

  const decision = decideAlertWrite(
    existingOpen,
    { machineId: event.machineId ?? null, alertType: event.type, severity: event.severity as AlertSeverity },
    lookupFailed,
  );

  // Sprint 5 debt E2 — nhóm KHÔNG gắn máy: existingOpen luôn null (lookup ở trên
  // chỉ chạy khi có machineId) nên decision.action luôn là "insert" cho nhóm này.
  // Đọc mốc gửi gần nhất từ Redis để BIẾT có phải lần đầu hay không.
  const isNoMachineGroup = event.machineId == null;
  const lastNotifyEntry = isNoMachineGroup ? await getLastNotifyEntry(consolidationKey) : null;

  // ⚠ CHỖ DỄ SAI NHẤT — luật #1 của decideNotify là `action === "insert" ⇒ báo
  // NGAY`, không xét gì thêm (kể cả lastNotifiedAt). decideAlertWrite() luôn trả
  // "insert" cho nhóm không-máy nên nếu truyền thẳng decision.action vào đây, luật
  // #1 sẽ ghi đè cooldown VÔ ĐIỀU KIỆN — đúng bug đang sửa (mọi lượt đều báo).
  // Chỉ khi Redis ĐÃ có mốc gửi (đã từng báo thật cho khoá này) mới coi lượt này
  // là "update" RIÊNG cho mục đích quyết-định-gửi. KHÔNG đụng `decision.action`
  // dùng cho nhánh ghi INSERT/UPDATE predictive_alerts phía dưới — nhóm không-máy
  // luôn thật sự INSERT (không có dòng đang mở nào để cập nhật); việc gộp ở đây
  // CHỈ ảnh hưởng quyết định có gửi thông báo hay không.
  const notifyAction: "insert" | "update" =
    isNoMachineGroup && lastNotifyEntry != null ? "update" : decision.action;

  // Sprint 5 §2.2 — GỬI hay không là quyết định RIÊNG với GHI hay không.
  const notifyDecision = decideNotify({
    action: notifyAction,
    incomingSeverity: event.severity as AlertSeverity,
    // ⚠ Mức của dòng ĐANG MỞ TRƯỚC update — KHÔNG dùng decision.severity (đã gộp).
    // Nhóm không-máy không có dòng đang mở nào để so ⇒ previousSeverity luôn null.
    // HỆ QUẢ TỰ NHIÊN (không phải thiếu sót): thiếu "mức trước" nghĩa là luật
    // "mức tăng" (severity-raised) KHÔNG BAO GIỜ áp dụng được cho nhóm này — chỉ
    // CRITICAL mới xuyên qua được cooldown của cảnh báo cấp nhà máy/không gắn máy.
    previousSeverity: existingOpen?.severity ?? null,
    lastNotifiedAt: isNoMachineGroup
      ? (lastNotifyEntry?.timestamp ?? null)
      : (existingOpen?.notificationSentAt?.getTime() ?? null),
    now: Date.now(),
    cooldownMs: renotifyCooldownMs(),
    criticalCooldownMs: criticalCooldownMs(),
  });

  // Chỉ trả giá cho những thứ ĐẮT khi thật sự sắp làm phiền ai đó: một truy vấn
  // pattern 30 ngày + một lượt gọi LLM. Trước đây chạy MỌI lượt lọt (≤3/5 phút).
  //
  // I-1 (vòng sửa cuối) — CẢ HAI là I/O DB nằm GIỮA quyết-định và đường-ghi, cùng
  // fail-open như tra-cứu-hỏng (:236) / ghi-hỏng (:393) / nhật-ký-hỏng (:414):
  // đường PHỤ (thông báo: ai nhận + gợi ý pattern) không được phép giết đường
  // CHÍNH (ghi sổ). checkPatterns() chạy GROUP BY 30 ngày trên predictive_alerts —
  // dễ time-out nhất trong hàm này, và nó time-out đúng lúc tải cao, tức đúng lúc
  // KPI cần đếm nhất. Không bọc ⇒ routeAlert() ném ra ngoài ⇒ không dòng cảnh báo,
  // không dòng nhật ký, KPI mất một lần, không dấu vết — đúng bệnh Wave 4 sinh ra
  // để chữa.
  const targets = notifyDecision.notify
    ? await determineTargets(db, event).catch((e) => {
        console.error("[SmartAlert] tra người nhận HỎNG — vẫn ghi sổ:", (e as Error)?.message ?? e);
        return [];
      })
    : [];
  const suggestedAction = notifyDecision.notify
    ? await checkPatterns(db, event).catch((e) => {
        console.error("[SmartAlert] truy vấn pattern HỎNG — vẫn ghi sổ:", (e as Error)?.message ?? e);
        return null;
      })
    : null;
  const aiReasoning = notifyDecision.notify
    ? await enrichRoutingWithAI(event, targets, suggestedAction).catch(() => null)
    : null;

  // Chỉ đóng dấu "đã gửi" khi thật sự có người nhận. Nhà máy chưa cấu hình role
  // nhận (không có user `maintenance`) mà vẫn stamp ⇒ cảnh báo im 4 giờ vì một
  // lượt gửi không tồn tại. LƯU Ý (Sprint 5 debt E3): đây chỉ còn là ĐIỀU KIỆN
  // ĐỦ ĐỂ THỬ đóng dấu — dấu THẬT SỰ chỉ được ghi SAU khi vòng gửi (:511 trở
  // xuống) xác nhận đã gửi thành công. willStamp KHÔNG còn được dùng để set
  // trực tiếp notificationSent/notificationSentAt trong khối ghi predictive_alerts
  // nữa (xem lý do ở khối ghi bên dưới).
  const willStamp = notifyDecision.notify && targets.length > 0;

  // WS-4: allow callers (e.g. predictiveMaintenanceService) to pass through
  // predictedTimeframe, confidenceScore, and factors. Backward-compatible —
  // these are optional fields on event.data; absent => previous behaviour.
  const eventFactors = Array.isArray(event.data.factors)
    ? (event.data.factors as Array<{ name: string; contribution: number; description: string }>)
    : [];
  const eventDataPoints = typeof event.data.dataPoints === "number" ? event.data.dataPoints : 0;

  // Build AI analysis payload
  const aiAnalysisPayload: Record<string, unknown> = {
    factors: eventFactors,
    recommendations: suggestedAction ? [suggestedAction] : [],
    dataPoints: eventDataPoints,
    modelUsed: "smart-alert-router",
  };

  if (aiReasoning) {
    aiAnalysisPayload.reasoning = aiReasoning.reasoning;
    aiAnalysisPayload.suggestedRootCause = aiReasoning.suggestedRootCause;
    aiAnalysisPayload.urgencyExplanation = aiReasoning.urgencyExplanation;
    aiAnalysisPayload.recommendations = [
      ...(suggestedAction ? [suggestedAction] : []),
      ...aiReasoning.recommendations,
    ];
    aiAnalysisPayload.modelUsed = "smart-alert-router+gguf";
  }

  const expiresAt = new Date(Date.now() + alertTtlMs());
  const confidence = event.data.confidence != null ? String(event.data.confidence) : null;
  const timeframe = event.data.predictedTimeframe ? String(event.data.predictedTimeframe) : null;

  // Tiêu đề: trước đây là "MACHINE FAILURE: HIGH" lặp y hệt trên 49 dòng.
  // Có máy ⇒ nêu máy + rủi ro + khung thời gian. Không có máy ⇒ giữ khuôn cũ,
  // KHÔNG bịa mã máy rỗng vào chuỗi (spec §4.1).
  const readableTitle = machineCode
    ? `${event.type.replace(/_/g, " ")} · ${machineCode}` +
      (event.data.currentValue != null ? ` · ${event.data.currentValue}%` : "") +
      (timeframe ? ` · ${timeframe}` : "")
    : `${event.type.replace(/_/g, " ")}: ${event.severity}`;

  let alertRecord: { id: number } | undefined;

  try {
    if (decision.action === "update") {
      await db
        .update(predictiveAlerts)
        .set({
          severity: decision.severity as any,
          occurrenceCount: decision.occurrenceCount,
          lastOccurredAt: new Date(),
          title: readableTitle.slice(0, 255),
          description: event.message,
          machineCode,
          currentValue: event.data.currentValue != null ? String(event.data.currentValue) : null,
          threshold: event.data.threshold != null ? String(event.data.threshold) : null,
          confidenceScore: confidence,
          predictedTimeframe: timeframe,
          // Sprint 5 §2.6(3) — lượt IM LẶNG không gọi LLM, nên payload lúc này
          // không có phần lý giải. Ghi đè sẽ XOÁ lý giải có từ lần báo trước.
          ...(notifyDecision.notify ? { aiAnalysis: aiAnalysisPayload } : {}),
          // Sprint 5 debt E3 — KHÔNG đóng dấu ở đây nữa. Trước đây stamp ngay
          // trong khối ghi này, TRƯỚC lượt gửi thật (:511) — tiến trình chết
          // giữa hai việc để lại dấu "đã báo" giả. Dấu THẬT chỉ được ghi bằng
          // một UPDATE riêng SAU khi gửi xong (xem khối sau vòng gửi bên dưới).
          expiresAt,
          updatedAt: new Date(),
          // KHÔNG đụng createdAt: processAutoEscalation() đo tuổi dòng để leo thang.
          // Reset createdAt ⇒ tình trạng kéo dài VĨNH VIỄN không bao giờ leo thang.
        } as any)
        // Vòng sửa cuối (review toàn nhánh, mục 5) — WHERE trước đây chỉ lọc theo id,
        // không lọc lại status='ACTIVE'. Cửa sổ vài mili-giây giữa lượt tra-cứu-cảnh-báo-mở
        // (:216-236, cũng lọc ACTIVE) và UPDATE này: nếu alertExpirySweeper đóng ĐÚNG dòng
        // này trong khe đó, UPDATE vẫn khớp theo id (SET không đổi status) và dòng ở lại
        // EXPIRED kèm resolutionNotes "đã thôi tái diễn" trong khi occurrenceCount/expiresAt
        // vừa được gia hạn ngay sau đó — ghi chú nói dối. Thêm eq(status,'ACTIVE') khiến
        // UPDATE là no-op (0 dòng khớp) nếu sweeper đã đóng nó trước; vòng quét kế tiếp của
        // routeAlert() sẽ tra không thấy cảnh báo mở (đã EXPIRED) và tự INSERT dòng mới —
        // tự lành, không kẹt trạng thái sai vĩnh viễn.
        .where(and(eq(predictiveAlerts.id, decision.id), eq(predictiveAlerts.status, "ACTIVE" as any)));
      alertRecord = { id: decision.id };
    } else {
      const [row] = await db
        .insert(predictiveAlerts)
        .values({
          alertType: event.type,
          severity: event.severity,
          title: readableTitle.slice(0, 255),
          description: event.message,
          machineId: event.machineId ?? null,
          machineCode,
          factoryId: event.factoryId ?? null,
          productModelId: event.productModelId ?? null,
          currentValue: event.data.currentValue ? String(event.data.currentValue) : null,
          threshold: event.data.threshold ? String(event.data.threshold) : null,
          confidenceScore: confidence,
          predictedTimeframe: timeframe,
          aiAnalysis: aiAnalysisPayload,
          status: "ACTIVE",
          // Sprint 5 debt E3 — luôn ghi CHƯA GỬI lúc tạo dòng: tới đây lượt gửi
          // thật (:511) chưa chạy nên KHÔNG thể biết đã gửi hay chưa. Dấu THẬT
          // chỉ được ghi bằng một UPDATE riêng SAU khi gửi thành công (fail-open
          // nếu gửi hỏng thì cứ để false/null — còn cơ hội thử lại ở lần tái diễn
          // kế tiếp, thay vì nói dối "đã báo" trong lúc không ai được báo).
          notificationSent: false,
          notificationSentAt: null,
          occurrenceCount: 1,
          lastOccurredAt: new Date(),
          expiresAt,
          ...(runbookRef ? { runbookRef } : {}),
          ...(recommendationRef ? { recommendationRef } : {}),
        } as any)
        .returning({ id: predictiveAlerts.id });
      alertRecord = row;
    }
  } catch (err) {
    // Sprint 5 §2.6(2) — FAIL-OPEN, cùng tinh thần với tra-cứu-hỏng ở trên: thà
    // báo trùng còn hơn im lặng về một máy sắp hỏng. Trước đây thông báo gửi
    // TRƯỚC khi ghi nên lỗi ghi không ảnh hưởng; nay thông báo đi sau, nên phải
    // nói rõ ra ở đây thay vì để hành vi thay đổi lặng lẽ.
    console.error("[SmartAlert] GHI cảnh báo THẤT BẠI — vẫn gửi thông báo để không bỏ sót:", (err as Error)?.message ?? err);
  }

  // Wave 4 §3 — nhật ký LẦN-TÁI-DIỄN. Ghi cho CẢ hai nhánh (ghi mới và cập nhật):
  // lần đầu tiên cũng là một lần tái diễn, không được bỏ sót.
  // FAIL-OPEN: sổ sách hỏng KHÔNG được làm hỏng đường cảnh báo.
  try {
    const { buildOccurrence } = await import("./alerts/buildOccurrence");
    // ⚠ event.severity = mức của LẦN NÀY. KHÔNG dùng decision.severity (đã gộp).
    // Dùng lại `confidence` đã tính ở trên (String hoá từ event.data.confidence:
    // unknown) thay vì đọc thẳng event.data.confidence — tsc từ chối gán `unknown`
    // vào tham số đã định kiểu của buildOccurrence; cùng một giá trị, buildOccurrence
    // tự chuẩn hoá chuỗi số về lại number nên kết quả không đổi.
    const occ = buildOccurrence(alertRecord?.id, { severity: event.severity, confidence }, new Date());
    if (occ) {
      await db.insert(predictiveAlertOccurrences).values(occ);
    }
  } catch (err) {
    // Log to ERROR, không phải warn: mất một dòng nhật ký nghĩa là KPI đếm
    // thiếu một lần — im lặng ở đây chính là bệnh Wave 4 sinh ra để chữa.
    console.error(`[SmartAlert] ghi nhật ký lần-tái-diễn THẤT BẠI cho cảnh báo #${alertRecord?.id} — KPI sẽ đếm thiếu lần này:`, err);
  }

  // Auto-escalation is now tracked via the predictive_alerts row itself
  // (status=ACTIVE, acknowledgedAt=null, escalationLevel). processAutoEscalation()
  // scans the table — nothing to register in process memory.

  // Sprint 5 §2.2 — Gửi SAU cùng: tới đây dòng cảnh báo và dòng nhật ký đã yên vị.
  //
  // Sprint 5 debt E3 — và giờ ĐÓNG DẤU cũng phải SAU CÙNG NỐT. Trước đây dấu
  // notificationSentAt được ghi ngay trong khối ghi predictive_alerts phía
  // trên, TRƯỚC lượt gửi thật ở đây — tiến trình chết đúng khe giữa hai việc
  // để lại một cảnh báo mang dấu "đã báo" mà KHÔNG ai được báo, im lặng suốt
  // cooldown (mặc định 4h) về một máy sắp hỏng. Sửa: chỉ đóng dấu SAU khi
  // sendSmartNotification() xác nhận đã gửi được — allDelivered=false khi
  // kênh in-app NÉM lỗi HOẶC khi nó trả về `null` một cách hợp lệ (người nhận
  // tắt in-app / đang trong giờ yên lặng — notificationService.ts, không phải
  // exception) ⇒ KHÔNG stamp, còn cơ hội thử lại ở lần tái diễn kế tiếp thay
  // vì mang một dấu "đã báo" giả.
  let allDelivered = true;
  if (notifyDecision.notify) {
    for (const target of targets) {
      const delivered = await sendSmartNotification(target, event);
      if (!delivered) allDelivered = false;
    }
  }

  if (willStamp && allDelivered) {
    if (isNoMachineGroup) {
      // Sprint 5 debt E2 (nay dời SAU gửi theo E3) — nhóm không-máy không có
      // dòng predictive_alerts đại diện "đang mở" để tự stamp, nên mượn Redis.
      await setLastNotifyEntry(consolidationKey, { timestamp: Date.now() }, renotifyCooldownMs());
    } else if (alertRecord?.id != null) {
      try {
        await db
          .update(predictiveAlerts)
          .set({ notificationSent: true, notificationSentAt: new Date(), updatedAt: new Date() })
          // Review round 1, Minor-2 — cùng lý do đã giải thích ở UPDATE anh em
          // (:497): lọc lại status='ACTIVE' để nếu alertExpirySweeper đã đóng
          // dòng này trong khe giữa lượt gửi và đây, UPDATE là no-op thay vì
          // bump updatedAt trên một dòng đã EXPIRED/RESOLVED.
          .where(and(eq(predictiveAlerts.id, alertRecord.id), eq(predictiveAlerts.status, "ACTIVE" as any)));
      } catch (err) {
        // FAIL-OPEN: đóng dấu hỏng KHÔNG được phép che mất việc ĐÃ gửi thành
        // công — chỉ mất dấu vết notificationSentAt cho dòng này, không mất
        // cảnh báo. Log rõ để vận hành biết cột có thể trễ/thiếu.
        console.error(
          `[SmartAlert] đóng dấu notificationSentAt THẤT BẠI cho cảnh báo #${alertRecord.id} (đã gửi thành công, chỉ lỗi ghi dấu):`,
          (err as Error)?.message ?? err,
        );
      }
    }
  }

  return {
    alertType: event.type,
    targets,
    consolidated,
    consolidationGroup: consolidated ? consolidationKey : undefined,
    escalationLevel: "L1",
    suggestedAction: aiReasoning?.reasoning || suggestedAction || undefined,
  };
}

// ─── Quality-Gate Breach → Unified Alert (FU-2) ──────────────────────────────
//
// Reusable entry point so a quality-gate breach raises ONE first-class, routed,
// persisted alert through the SAME unified path P0-E uses (routeAlert →
// predictive_alerts + in-app notify + email for HIGH/CRITICAL), plus a webhook
// fan-out so external subscribers see gate breaches too.
//
// The qualityGateEvaluator already guarantees one-open-event + a re-arm cooldown
// per gate, so it calls this at most once per breach. routeAlert's own Redis
// consolidation window is a second safety net against storms.

/** Normalized quality-gate breach payload (transport-agnostic). */
export interface QualityGateAlertInput {
  /** gate.action: 'stop' | 'pause' | 'alert' — drives severity mapping */
  action: string;
  gateId: number;
  gateName: string;
  gateType: string;
  machineId: number;
  lineId?: number | null;
  productModelId?: number | null;
  factoryId?: number | null;
  triggerValue: number;
  threshold: number;
  comparisonOperator?: string;
  eventId?: number | null;
  inspectionId?: number | null;
}

/**
 * Map a quality-gate action to the unified severity scale. Mirrors P0-E
 * conventions: stop = hard halt (CRITICAL), pause = operator hold (HIGH),
 * everything else (alert/unknown) = MEDIUM.
 */
function gateActionToSeverity(action: string): SmartAlertEvent["severity"] {
  switch (action) {
    case "stop":
      return "CRITICAL";
    case "pause":
      return "HIGH";
    default:
      return "MEDIUM";
  }
}

/**
 * Raise a quality-gate breach as a first-class, routed + persisted alert.
 * Returns the routing result (or null on failure). Best-effort webhook fan-out
 * is fired alongside routeAlert; neither path throws to the caller — callers
 * (the evaluator) treat this as fire-and-forget.
 */
export async function raiseQualityGateAlert(
  input: QualityGateAlertInput,
): Promise<RoutingResult | null> {
  const severity = gateActionToSeverity(input.action);
  const message =
    `Quality gate "${input.gateName}" breached: ${input.gateType}=` +
    `${input.triggerValue} ${input.comparisonOperator ?? ""} ${input.threshold} ` +
    `→ action=${input.action}` +
    (input.eventId != null ? ` (event #${input.eventId})` : "");

  const event: SmartAlertEvent = {
    type: "QUALITY_DEGRADATION",
    machineId: input.machineId,
    factoryId: input.factoryId ?? undefined,
    productModelId: input.productModelId ?? undefined,
    severity,
    message,
    data: {
      source: "quality_gate",
      gateId: input.gateId,
      gateName: input.gateName,
      gateType: input.gateType,
      action: input.action,
      currentValue: input.triggerValue,
      threshold: input.threshold,
      lineId: input.lineId ?? null,
      eventId: input.eventId ?? null,
      inspectionId: input.inspectionId ?? null,
    },
  };

  // Webhook fan-out (best-effort, lazy import to avoid an import cycle with the
  // router layer). HIGH/CRITICAL also email via routeAlert's sendSmartNotification.
  void import("../routers/webhookRouter")
    .then(({ sendWebhookEvent }) =>
      sendWebhookEvent("alert.triggered", {
        source: "quality_gate",
        gateId: input.gateId,
        gateName: input.gateName,
        gateType: input.gateType,
        action: input.action,
        severity,
        machineId: input.machineId,
        currentValue: input.triggerValue,
        threshold: input.threshold,
        message,
        eventId: input.eventId ?? null,
      }),
    )
    .catch((err) =>
      console.error(
        "[SmartAlert] quality-gate webhook failed:",
        (err as Error)?.message ?? err,
      ),
    );

  try {
    return await routeAlert(event);
  } catch (err) {
    console.error(
      "[SmartAlert] raiseQualityGateAlert routeAlert failed:",
      (err as Error)?.message ?? err,
    );
    return null;
  }
}

// ─── Target Determination ────────────────────────────────────────────────────

async function determineTargets(db: any, event: SmartAlertEvent): Promise<RouteTarget[]> {
  const targets: RouteTarget[] = [];

  switch (event.type) {
    case "DEFECT_SPIKE": {
      // Route to machine operator + supervisor
      const operators = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.role, ["operator" as const, "supervisor" as const]));

      for (const u of operators) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: u.role === "operator"
            ? `Operator — defect spike on machine #${event.machineId ?? "all"}`
            : `Supervisor oversight — defect spike on machine #${event.machineId ?? "all"}`,
        });
      }
      break;
    }

    case "YIELD_DROP": {
      // Route to quality inspectors
      const qualityEngineers = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(eq(users.role, "quality_inspector"));

      for (const u of qualityEngineers) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: `Quality inspector — yield drop${event.factoryId ? ` at factory #${event.factoryId}` : ""}`,
        });
      }
      break;
    }

    case "MACHINE_FAILURE": {
      // Route to maintenance team
      const maintenanceTeam = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(eq(users.role, "maintenance"));

      for (const u of maintenanceTeam) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: `Maintenance technician — machine failure prediction${event.machineId ? ` for machine #${event.machineId}` : ""}`,
        });
      }
      break;
    }

    case "QUALITY_DEGRADATION":
    case "PATTERN_ANOMALY":
    default: {
      // Route to admins and supervisors
      const admins = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.role, ["admin" as const, "supervisor" as const]));

      for (const u of admins) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: `${u.role === "admin" ? "Admin" : "Supervisor"} — ${event.type.replace(/_/g, " ").toLowerCase()} alert`,
        });
      }
      break;
    }
  }

  return targets;
}

// ─── Escalation Engine ───────────────────────────────────────────────────────

export async function processAutoEscalation(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const now = new Date();
  const cutoff = new Date(now.getTime() - ESCALATION_TIMEOUT_MS);
  let escalatedCount = 0;

  // Source of truth: scan predictive_alerts directly (survives restarts and is
  // shared across instances). Candidates = still ACTIVE, never acknowledged,
  // below the top escalation level (3=executive), and either never escalated or
  // last escalated > timeout ago.
  const candidates = await db
    .select()
    .from(predictiveAlerts)
    .where(
      and(
        eq(predictiveAlerts.status, "ACTIVE"),
        isNull(predictiveAlerts.acknowledgedAt),
        sql`${predictiveAlerts.escalationLevel} < 3`,
        // NOTE: pass the cutoff as an ISO string, not a JS Date. Inside a raw `sql`
        // fragment drizzle's postgres-js prepared path cannot serialize a Date
        // (postgres.js falls back to its string writer → Buffer.byteLength(Date)
        // throws ERR_INVALID_ARG_TYPE). Postgres coerces the ISO text to timestamp.
        sql`COALESCE(${predictiveAlerts.lastEscalatedAt}, ${predictiveAlerts.createdAt}) <= ${cutoff.toISOString()}`,
      ),
    );

  for (const alert of candidates) {
    const currentLevel = escalationLevelToLabel(alert.escalationLevel ?? 0);
    const nextLevel = getNextEscalationLevel(currentLevel);
    if (!nextLevel) continue;

    // Reconstruct a minimal event from the persisted row so escalation
    // notifications carry the original context.
    const event: SmartAlertEvent = {
      type: (alert.alertType as AlertType) ?? "PATTERN_ANOMALY",
      severity: (alert.severity as SmartAlertEvent["severity"]) ?? "MEDIUM",
      message: alert.description ?? alert.title ?? "Alert escalated",
      machineId: alert.machineId ?? undefined,
      factoryId: alert.factoryId ?? undefined,
      productModelId: alert.productModelId ?? undefined,
      data: {},
    };

    const escalationTargets = await getEscalationTargets(db, nextLevel);
    for (const target of escalationTargets) {
      await sendSmartNotification(target, event, true);
    }

    // Persist escalation: bump level + stamp lastEscalatedAt (resets the timer).
    await db
      .update(predictiveAlerts)
      .set({
        escalationLevel: (alert.escalationLevel ?? 0) + 1,
        lastEscalatedAt: now,
        updatedAt: now,
      })
      .where(eq(predictiveAlerts.id, alert.id));

    escalatedCount++;
  }

  return escalatedCount;
}

function getNextEscalationLevel(current: EscalationLevel): EscalationLevel | null {
  switch (current) {
    case "L1": return "L2";
    case "L2": return "L3";
    case "L3": return null;
  }
}

async function getEscalationTargets(db: any, level: EscalationLevel): Promise<RouteTarget[]> {
  const roleFilter = level === "L2"
    ? ["supervisor" as const]
    : ["admin" as const];

  const escalationUsers = await db
    .select({
      userId: users.id,
      username: users.username,
      role: users.role,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.role, roleFilter));

  return escalationUsers.map((u: any) => ({
    userId: u.userId,
    username: u.username,
    role: u.role,
    email: u.email,
    reason: `Auto-escalation (${level}) — alert unacknowledged >30 minutes`,
  }));
}

// ─── Pattern Recognition ─────────────────────────────────────────────────────

async function checkPatterns(
  db: any,
  event: SmartAlertEvent
): Promise<string | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT 
      EXTRACT(DOW FROM ${predictiveAlerts.createdAt}) as day_of_week,
      EXTRACT(HOUR FROM ${predictiveAlerts.createdAt}) as hour_of_day,
      COUNT(*) as occurrences
    FROM ${predictiveAlerts}
    WHERE ${predictiveAlerts.alertType} = ${event.type}
      AND ${predictiveAlerts.createdAt} >= ${thirtyDaysAgo.toISOString()}
      ${event.machineId ? sql`AND ${predictiveAlerts.machineId} = ${event.machineId}` : sql``}
    GROUP BY day_of_week, hour_of_day
    HAVING COUNT(*) >= 4
    ORDER BY occurrences DESC
    LIMIT 3
  `) as any;

  const rows = result.rows ?? [];
  if (rows.length === 0) return null;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const top = rows[0];
  const dayIdx = Number(top.day_of_week);
  const hour = Number(top.hour_of_day);
  const count = Number(top.occurrences);

  return `Recurring pattern detected: This alert occurs frequently on ${dayNames[dayIdx]}s around ${hour}:00 (${count} times in 30 days). Consider investigating a permanent fix.`;
}

// ─── Acknowledge Alert ───────────────────────────────────────────────────────

export async function acknowledgeAlert(
  alertId: number,
  userId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(predictiveAlerts)
    .set({
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
      status: "ACKNOWLEDGED",
    })
    .where(eq(predictiveAlerts.id, alertId));

  // Acknowledged rows are skipped by processAutoEscalation() (it filters on
  // acknowledgedAt IS NULL), so there is no separate pending store to clear.
  return true;
}

// ─── AI Reasoning Layer ──────────────────────────────────────────────────────

interface AiRoutingReasoning {
  reasoning: string;
  suggestedRootCause: string;
  urgencyExplanation: string;
  recommendations: string[];
}

/**
 * Non-blocking GGUF reasoning for smart alert routing.
 * Provides context-aware explanation of severity, root cause hypothesis,
 * and actionable recommendations.
 */
async function enrichRoutingWithAI(
  event: SmartAlertEvent,
  targets: RouteTarget[],
  patternSuggestion: string | null
): Promise<AiRoutingReasoning | null> {
  try {
    const { generateText } = await import("./aiGgufEngine");

    const prompt = `Manufacturing alert routing analysis:
- Alert Type: ${event.type}
- Severity: ${event.severity}
- Message: ${event.message}
- Data: ${JSON.stringify(event.data)}
- Routed to: ${targets.map(t => `${t.role} (${t.reason})`).join("; ") || "No targets"}
- Historical pattern: ${patternSuggestion || "No recurring pattern detected"}

Analyze this alert and respond in JSON format:
{
  "reasoning": "Why this severity level is appropriate and who should handle it",
  "suggestedRootCause": "Most likely root cause based on alert type and data",
  "urgencyExplanation": "How urgent this is and what happens if not addressed",
  "recommendations": ["Immediate action 1", "Follow-up action 2"]
}`;

    const result = await generateText({
      systemPrompt:
        "You are an expert alert routing system in a manufacturing factory with AOI inspection. " +
        "Analyze alerts and provide concise, actionable reasoning for routing decisions. Be specific to manufacturing context.",
      prompt,
      maxTokens: 256,
      temperature: 0.3,
      jsonMode: true,
    }, resolveLogicalModel("chat"));

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      reasoning: parsed.reasoning || "",
      suggestedRootCause: parsed.suggestedRootCause || "",
      urgencyExplanation: parsed.urgencyExplanation || "",
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5) : [],
    };
  } catch (err) {
    console.log("[SmartAlert] AI reasoning skipped:", (err as Error).message);
    return null;
  }
}

// ─── Defect Spike Detection ──────────────────────────────────────────────────

export async function detectDefectSpike(
  machineId: number,
  windowMinutes: number = 30,
  spikeThreshold: number = 2.0 // 2x above average = spike
): Promise<SmartAlertEvent | null> {
  const db = await getDb();
  if (!db) return null;

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
  const baselineStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Recent NG count in window
  const [recent] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(productInspections)
    .where(
      and(
        eq(productInspections.machineId, machineId),
        eq(productInspections.overallResult, "NG"),
        gte(productInspections.createdAt, windowStart)
      )
    );

  // 24h baseline average per same window length
  const [baseline] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(productInspections)
    .where(
      and(
        eq(productInspections.machineId, machineId),
        eq(productInspections.overallResult, "NG"),
        gte(productInspections.createdAt, baselineStart)
      )
    );

  const recentCount = Number(recent?.count ?? 0);
  const baselineCount = Number(baseline?.count ?? 0);
  const baselinePerWindow = baselineCount / (24 * 60 / windowMinutes);

  if (baselinePerWindow > 0 && recentCount >= baselinePerWindow * spikeThreshold) {
    return {
      type: "DEFECT_SPIKE",
      machineId,
      severity: recentCount >= baselinePerWindow * 3 ? "CRITICAL" : "HIGH",
      message: `Defect spike on machine #${machineId}: ${recentCount} NG in last ${windowMinutes}min (baseline ~${baselinePerWindow.toFixed(1)}/window)`,
      data: { recentCount, baselinePerWindow, spikeRatio: recentCount / baselinePerWindow },
    };
  }

  return null;
}

// ─── Yield Drop Detection ────────────────────────────────────────────────────

export async function detectYieldDrop(
  factoryId: number,
  dropThresholdPercent: number = 5.0
): Promise<SmartAlertEvent | null> {
  const db = await getDb();
  if (!db) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  // Today's yield from dailyStatistics
  const [todayStats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)`,
      ok: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)`,
    })
    .from(dailyStatistics)
    .where(
      and(
        eq(dailyStatistics.factoryId, factoryId),
        gte(dailyStatistics.date, today)
      )
    );

  // Yesterday's yield
  const [yesterdayStats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)`,
      ok: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)`,
    })
    .from(dailyStatistics)
    .where(
      and(
        eq(dailyStatistics.factoryId, factoryId),
        gte(dailyStatistics.date, yesterday),
        lt(dailyStatistics.date, today)
      )
    );

  const todayTotal = Number(todayStats?.total ?? 0);
  const todayOk = Number(todayStats?.ok ?? 0);
  const yesterdayTotal = Number(yesterdayStats?.total ?? 0);
  const yesterdayOk = Number(yesterdayStats?.ok ?? 0);

  if (todayTotal < 10 || yesterdayTotal < 10) return null; // Not enough data

  const todayYield = (todayOk / todayTotal) * 100;
  const yesterdayYield = (yesterdayOk / yesterdayTotal) * 100;
  const drop = yesterdayYield - todayYield;

  if (drop >= dropThresholdPercent) {
    return {
      type: "YIELD_DROP",
      factoryId,
      severity: drop >= 10 ? "CRITICAL" : drop >= 7 ? "HIGH" : "MEDIUM",
      message: `Yield dropped ${drop.toFixed(1)}% at factory #${factoryId}: ${todayYield.toFixed(1)}% today vs ${yesterdayYield.toFixed(1)}% yesterday`,
      data: { todayYield, yesterdayYield, drop, todayTotal, yesterdayTotal },
    };
  }

  return null;
}

// ─── Get Routing Stats ───────────────────────────────────────────────────────

export async function getAlertRoutingStats(days: number = 7) {
  const db = await getDb();
  if (!db) {
    return { totalAlerts: 0, byType: [], avgAckTimeMinutes: 0, pendingCount: 0 };
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byType = await db
    .select({
      alertType: predictiveAlerts.alertType,
      count: sql<number>`COUNT(*)`,
    })
    .from(predictiveAlerts)
    .where(gte(predictiveAlerts.createdAt, since))
    .groupBy(predictiveAlerts.alertType);

  const [ackTime] = await db
    .select({
      avgMinutes: sql<number>`AVG(EXTRACT(EPOCH FROM (${predictiveAlerts.acknowledgedAt} - ${predictiveAlerts.createdAt})) / 60)`,
    })
    .from(predictiveAlerts)
    .where(
      and(
        gte(predictiveAlerts.createdAt, since),
        sql`${predictiveAlerts.acknowledgedAt} IS NOT NULL`
      )
    );

  const [total] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(predictiveAlerts)
    .where(gte(predictiveAlerts.createdAt, since));

  // pendingCount = alerts still awaiting acknowledgement (the auto-escalation
  // backlog). Derived from the table now, not an in-memory Map size.
  const [pending] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(predictiveAlerts)
    .where(
      and(
        eq(predictiveAlerts.status, "ACTIVE"),
        isNull(predictiveAlerts.acknowledgedAt),
      ),
    );

  return {
    totalAlerts: Number(total?.count ?? 0),
    byType: byType.map((r: any) => ({ type: r.alertType, count: Number(r.count) })),
    avgAckTimeMinutes: Number(ackTime?.avgMinutes ?? 0),
    pendingCount: Number(pending?.count ?? 0),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildConsolidationKey(event: SmartAlertEvent): string {
  return `${event.type}:${event.machineId ?? "all"}:${event.factoryId ?? "all"}`;
}

/**
 * Sprint 5 debt E3 — trả về ĐÃ GỬI ĐƯỢC HAY CHƯA (true nếu ÍT NHẤT một kênh
 * thành công), để routeAlert() chỉ đóng dấu notificationSentAt SAU KHI xác
 * nhận thật. Trước đây hàm này tự nuốt hết lỗi và không trả gì — gọi nơi khác
 * không cách nào biết gửi có thành công hay không, nên dấu "đã báo" bị đóng
 * dựa trên Ý ĐỊNH gửi chứ không phải KẾT QUẢ gửi.
 */
async function sendSmartNotification(
  target: RouteTarget,
  event: SmartAlertEvent,
  isEscalation: boolean = false
): Promise<boolean> {
  const prefix = isEscalation ? "[ESCALATED] " : "";
  const title = `${prefix}${event.severity} Alert: ${event.type.replace(/_/g, " ")}`;
  let delivered = false;

  try {
    // Review round 1, Minor-3 (nâng lên) — sendAlertNotification() → sendNotification()
    // (notificationService.ts) KHÔNG NÉM khi người dùng tắt in-app hoặc đang trong
    // giờ yên lặng (quiet hours, ưu tiên khác URGENT) — nó trả `null` một cách HỢP
    // LỆ. `delivered=true` chỉ vì không có exception là SAI: target email=null, mức
    // HIGH, đúng giờ yên lặng ⇒ không ai nhận được gì nhưng vẫn coi là "đã gửi" ⇒
    // đúng bug E3 đang sửa, chỉ dời xuống một tầng khác. Phải kiểm THẲNG giá trị trả
    // về, không suy từ việc không ném lỗi.
    const result = await sendAlertNotification(target.userId, {
      title,
      message: `${event.message}\nRouted to you because: ${target.reason}`,
      priority: event.severity === "CRITICAL" ? "URGENT" : event.severity === "HIGH" ? "HIGH" : "NORMAL",
    });
    delivered = result != null;
  } catch (error) {
    console.error(`[Smart Alert] Failed to notify user ${target.username}:`, error);
  }

  if (target.email && (event.severity === "HIGH" || event.severity === "CRITICAL")) {
    try {
      // Review round 2, Important — sendAlertEmail() (emailService.ts) trả về
      // `Promise<boolean>` và trả `false` ở BA nhánh không thành công, KHÔNG hề
      // ném: (1) transporter chưa khởi tạo (SMTP chưa cấu hình), (2)
      // ALERT_EMAIL_TO chưa cấu hình, (3) transporter.sendMail() ném (bắt nội
      // bộ, trả false). `delivered = true` vô điều kiện sau `await` — như dòng
      // cũ ở đây — vừa bỏ qua CẢ BA nhánh false đó, vừa GHI ĐÈ kết quả ĐÚNG của
      // kênh in-app phía trên (vd in-app bị chặn giờ yên lặng ⇒ result=null ⇒
      // delivered=false, nhưng dòng vô điều kiện này biến nó thành true trở
      // lại) — đúng bug E3 tái sinh ở kênh email. Chỉ NÂNG delivered lên true
      // khi email THẬT SỰ gửi được; nếu email hỏng nhưng in-app đã thành công,
      // delivered vẫn phải giữ nguyên true (không được lỡ tay AND lại).
      const emailOk = await sendAlertEmail({
        ruleName: event.type,
        ruleType: event.type,
        message: `${prefix}${event.message}\nRouted because: ${target.reason}`,
        currentValue: 0,
        thresholdValue: 0,
      });
      if (emailOk) delivered = true;
    } catch (error) {
      console.error(`[Smart Alert] Failed to email ${target.email}:`, error);
    }
  }

  return delivered;
}

// ─── Cleanup stale entries ───────────────────────────────────────────────────

export function cleanupStaleAlerts(): void {
  // No-op retained for API compatibility (aiSmartAlertRoutingRouter.cleanup).
  // Consolidation counters now expire automatically via their Redis TTL
  // (CONSOLIDATION_TTL_SECONDS), and pending-escalation state lives in the
  // predictive_alerts table — there are no in-memory Maps left to prune.
}
