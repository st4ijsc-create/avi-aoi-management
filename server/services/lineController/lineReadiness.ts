/**
 * doc 44 W3-A2 / G3.1 — Line readiness checklist v1 (SYNAPSE LDS-L3 §6.2).
 *
 * "Kiểm sẵn sàng trước khi chạy": idle→ready (và mọi transition VÀO 'ready')
 * BẮT BUỘC qua checklist này; không đạt → tuyến GIỮ NGUYÊN trạng thái + trả
 * danh sách checks (KHÔNG tự động HELD từ idle — spec + quyết định batch).
 *
 * 5 check v1 (mỗi check {name, passed, detail}, skipped=true khi check không
 * áp dụng — honest, không giả vờ đã kiểm):
 *   1. machines_online     — mọi máy ACTIVE của tuyến đang online (presence từ
 *                            machine_status_logs; máy chưa có log → fallback
 *                            operationStatus === 'running').
 *   2. no_machine_faulted  — không máy nào operationStatus='error' /
 *                            lifecycleStatus='faulted'.
 *   3. feeder_verify       — line-level feeder run-gate (feederVerifyService.
 *                            assertLineSetupOkForRun) khi FEEDER_VERIFY_ENFORCED
 *                            bật; flag OFF → skipped.
 *   4. safety_read         — ĐỌC safety-PLC (advisory, read-only): BLOCKED →
 *                            fail; UNKNOWN/adapter OFF → skipped + ghi honest,
 *                            KHÔNG chặn khi chưa có HW (theo yêu cầu batch).
 *   5. recipe_loaded       — recipe_set_ref có mặt (chỉ khi requireRecipe=true;
 *                            không yêu cầu → skipped).
 *
 * Kết quả gần nhất được cache per line (LINE_READINESS_CACHE_MS, mặc định 30s)
 * cho GET /v1/lines/:id/state ("readiness cache").
 */
import { isFeederVerifyEnforced, assertLineSetupOkForRun } from "../feederVerifyService";
import * as repo from "./lineStateRepo";

export interface ReadinessCheck {
  name: string;
  passed: boolean;
  /** Check không áp dụng trong cấu hình hiện tại (flag OFF / UNKNOWN / not required). */
  skipped?: boolean;
  detail: string;
}

export interface LineReadinessResult {
  lineId: number;
  ready: boolean;
  checks: ReadinessCheck[];
  checkedAt: string;
}

export interface ReadinessOptions {
  /** Bắt buộc recipe_set_ref có mặt (check 5). Mặc định false (v1). */
  requireRecipe?: boolean;
}

// ─── Cache (per line, TTL) ────────────────────────────────────────────────────

export function readinessCacheTtlMs(): number {
  const n = Number(process.env.LINE_READINESS_CACHE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

const cache = new Map<number, LineReadinessResult>();

/** Kết quả readiness còn tươi (≤ TTL) của lần check gần nhất, hoặc null. */
export function getCachedReadiness(lineId: number): LineReadinessResult | null {
  const hit = cache.get(lineId);
  if (!hit) return null;
  if (Date.now() - new Date(hit.checkedAt).getTime() > readinessCacheTtlMs()) return null;
  return hit;
}

/** Test seam: xóa cache readiness. */
export function _resetReadinessCacheForTests(): void {
  cache.clear();
}

// ─── Checklist ───────────────────────────────────────────────────────────────

/**
 * Chạy checklist sẵn sàng v1 cho một tuyến. Không bao giờ throw — một check
 * lỗi runtime được ghi FAIL (fail-safe, default-deny hướng an toàn) trừ các
 * check được định nghĩa skipped-honest ở trên.
 */
export async function checkLineReadiness(
  lineId: number,
  opts: ReadinessOptions = {},
): Promise<LineReadinessResult> {
  const checks: ReadinessCheck[] = [];

  // 1 + 2 — máy của tuyến: online + không fault.
  try {
    const lineMachines = await repo.getLineMachines(lineId);
    if (lineMachines.length === 0) {
      checks.push({
        name: "machines_online",
        passed: false,
        detail: "Tuyến không có máy ACTIVE nào (machine → station → line) — không thể chạy tuyến rỗng.",
      });
      checks.push({
        name: "no_machine_faulted",
        passed: true,
        skipped: true,
        detail: "Bỏ qua: tuyến không có máy (đã fail ở machines_online).",
      });
    } else {
      const presence = await repo.getLatestPresence(lineMachines.map((m) => m.id));
      const offline = lineMachines.filter((m) => {
        const p = presence.get(m.id);
        if (p) return p !== "online";
        // Máy chưa có status log nào → fallback trạng thái vận hành (honest).
        return m.operationStatus !== "running";
      });
      checks.push({
        name: "machines_online",
        passed: offline.length === 0,
        detail:
          offline.length === 0
            ? `Tất cả ${lineMachines.length} máy của tuyến đang online.`
            : `${offline.length}/${lineMachines.length} máy offline: ${offline.map((m) => m.code).join(", ")}.`,
      });

      const faulted = lineMachines.filter(
        (m) => m.operationStatus === "error" || m.lifecycleStatus === "faulted",
      );
      checks.push({
        name: "no_machine_faulted",
        passed: faulted.length === 0,
        detail:
          faulted.length === 0
            ? "Không máy nào ở trạng thái lỗi."
            : `Máy đang lỗi: ${faulted.map((m) => `${m.code}(${m.operationStatus}/${m.lifecycleStatus})`).join(", ")}.`,
      });
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    checks.push({ name: "machines_online", passed: false, detail: `Không đọc được danh sách máy: ${msg}` });
    checks.push({ name: "no_machine_faulted", passed: false, detail: `Không đọc được danh sách máy: ${msg}` });
  }

  // 3 — feeder verify (chỉ khi enforced — tái dùng line-level run-gate doc 38 T-1).
  if (!isFeederVerifyEnforced()) {
    checks.push({
      name: "feeder_verify",
      passed: true,
      skipped: true,
      detail: "Bỏ qua: FEEDER_VERIFY_ENFORCED đang OFF (advisory-only).",
    });
  } else {
    try {
      const gate = await assertLineSetupOkForRun(lineId);
      checks.push({
        name: "feeder_verify",
        passed: gate.allowed,
        detail: gate.allowed
          ? `Feeder setup run-ready (${gate.machines.length} máy có feeder tham gia).`
          : gate.reason ?? "Feeder setup chưa run-ready.",
      });
    } catch (err) {
      // Enforced mà không kiểm được → FAIL (default-deny, không đoán).
      checks.push({
        name: "feeder_verify",
        passed: false,
        detail: `FEEDER_VERIFY_ENFORCED bật nhưng không kiểm được: ${(err as Error)?.message ?? err}`,
      });
    }
  }

  // 4 — safety READ (advisory, read-only; UNKNOWN → skipped honest, KHÔNG chặn).
  checks.push(await safetyReadCheck());

  // 5 — recipe_set_ref (chỉ khi yêu cầu).
  if (!opts.requireRecipe) {
    checks.push({
      name: "recipe_loaded",
      passed: true,
      skipped: true,
      detail: "Bỏ qua: recipe không được yêu cầu cho transition này (requireRecipe=false).",
    });
  } else {
    try {
      const row = await repo.getLineState(lineId);
      const ref = row?.recipeSetRef ?? null;
      checks.push({
        name: "recipe_loaded",
        passed: !!ref,
        detail: ref ? `Recipe set đã nạp: ${ref}.` : "Chưa có recipe_set_ref trên tuyến (yêu cầu recipe).",
      });
    } catch (err) {
      checks.push({
        name: "recipe_loaded",
        passed: false,
        detail: `Không đọc được line_states: ${(err as Error)?.message ?? err}`,
      });
    }
  }

  const result: LineReadinessResult = {
    lineId,
    ready: checks.every((c) => c.passed),
    checks,
    checkedAt: new Date().toISOString(),
  };
  cache.set(lineId, result);
  return result;
}

/**
 * Đọc trạng thái safety-PLC (READ-ONLY, advisory — safety vật lý vẫn thuộc
 * safety-PLC độc lập, spec §19.2). Mirror logic adapterFacade.getSafetyStatus:
 * bất kỳ finding ACTIVE nào → BLOCKED (fail-safe); adapter OFF / không config /
 * không đọc được → UNKNOWN → check SKIPPED + ghi honest (KHÔNG chặn khi chưa
 * có HW — quyết định batch W3-A2).
 */
async function safetyReadCheck(): Promise<ReadinessCheck> {
  try {
    const plc = await import("../safety/plc/safetyPlcAdapter");
    if (!plc.safetyPlcAdapterEnabled()) {
      return {
        name: "safety_read",
        passed: true,
        skipped: true,
        detail: "Bỏ qua: safety-PLC adapter đang OFF (chưa có nguồn đọc an toàn — honest UNKNOWN).",
      };
    }
    const configs = await plc.listPlcConfigs({ onlyEnabled: true });
    if (configs.length === 0) {
      return {
        name: "safety_read",
        passed: true,
        skipped: true,
        detail: "Bỏ qua: safety-PLC adapter bật nhưng không có config nào enabled — trạng thái UNKNOWN (honest).",
      };
    }
    let anyOk = false;
    for (const cfg of configs) {
      try {
        const status = await plc.backendForConfig(cfg).read();
        const active = plc.statusToFindings(status);
        if (active.length > 0) {
          return {
            name: "safety_read",
            passed: false,
            detail: `Safety BLOCKED (safety_plc:${cfg.code}): ${active.map((f) => f.flag).join(", ")}.`,
          };
        }
        anyOk = true;
      } catch {
        /* một config đọc lỗi → unknown cục bộ; không bịa trạng thái */
      }
    }
    if (anyOk) {
      return { name: "safety_read", passed: true, detail: "Safety state OK (đọc từ safety-PLC, advisory)." };
    }
    return {
      name: "safety_read",
      passed: true,
      skipped: true,
      detail: "Bỏ qua: không config safety-PLC nào đọc được — trạng thái UNKNOWN (honest, không chặn khi chưa có HW).",
    };
  } catch {
    return {
      name: "safety_read",
      passed: true,
      skipped: true,
      detail: "Bỏ qua: module safety-PLC không tải được — trạng thái UNKNOWN (honest).",
    };
  }
}
