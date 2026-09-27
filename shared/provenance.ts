/**
 * doc 80 Đợt 1 Task 4 (X-01 · ORC-13) — NHÃN NGUỒN DỮ LIỆU (DEMO / SEED / SIM) và chế độ
 * gửi lệnh của một run orchestration (DRY-RUN hay thật).
 *
 * ⚠ Hàm THUẦN, dùng chung client + server. Chỉ SUY từ tín hiệu ĐÃ CÓ trong dữ liệu — không bịa
 *   tín hiệu mới, không đoán theo tên bảng. Tín hiệu (đo trên DB dev 2026-09-27, phiên chỉ-đọc):
 *     • `contextJson.seed === true`           (orchestration_runs — 6/6 run seed)
 *     • `scope` ∈ {'demo','seed','sim'}       (operator_assignments scope='demo'; safety_plc_configs scope='sim')
 *     • `origin === 'seed'`                   (device_types — 31/31)
 *     • tiền tố `DEMO-` / `SIM-` / `SEED-` trên mã định danh (taskKey 'DEMO-TASK-*', code 'SIM-SAFETY-PLC-1')
 *     • `simulated === true`
 *     • `payload.demo === true`               (tasks do scripts/seed-automation-demo.mjs tạo)
 *   Nhiều tín hiệu ⇒ một nhãn theo thứ tự SIM > DEMO > SEED (SIM là cảnh báo mạnh nhất: không
 *   phải thiết bị thật), kèm TOÀN BỘ tín hiệu trong `reasons`.
 */

export type ProvenanceLabel = "SIM" | "DEMO" | "SEED";

export interface Provenance {
  label: ProvenanceLabel;
  /** Mọi tín hiệu đã khớp, dạng máy đọc được (vd `scope=demo`, `taskKey=DEMO-*`). */
  reasons: string[];
}

/** Các trường mã định danh được soi tiền tố. */
const ID_FIELDS = ["taskKey", "code", "ref", "workflowRef", "typeKey", "key"] as const;
const PREFIX_RE = /^(DEMO|SIM|SEED)-/i;
const RANK: Record<ProvenanceLabel, number> = { SIM: 3, DEMO: 2, SEED: 1 };

function isObj(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function deriveProvenance(row: Record<string, unknown> | null | undefined): Provenance | null {
  if (!isObj(row)) return null;
  const hits: Array<[ProvenanceLabel, string]> = [];

  if (row.simulated === true) hits.push(["SIM", "simulated=true"]);

  const scope = typeof row.scope === "string" ? row.scope.trim().toLowerCase() : "";
  if (scope === "sim") hits.push(["SIM", "scope=sim"]);
  else if (scope === "demo") hits.push(["DEMO", "scope=demo"]);
  else if (scope === "seed") hits.push(["SEED", "scope=seed"]);

  if (isObj(row.contextJson) && row.contextJson.seed === true) hits.push(["SEED", "contextJson.seed=true"]);
  if (typeof row.origin === "string" && row.origin.trim().toLowerCase() === "seed") hits.push(["SEED", "origin=seed"]);
  if (isObj(row.payload) && row.payload.demo === true) hits.push(["DEMO", "payload.demo=true"]);

  for (const f of ID_FIELDS) {
    const v = row[f];
    if (typeof v !== "string") continue;
    const m = PREFIX_RE.exec(v.trim());
    if (m) {
      const p = m[1].toUpperCase() as ProvenanceLabel;
      hits.push([p, `${f}=${p}-*`]);
    }
  }

  if (hits.length === 0) return null;
  let label = hits[0][0];
  for (const [l] of hits) if (RANK[l] > RANK[label]) label = l;
  return { label, reasons: [...new Set(hits.map(([, r]) => r))] };
}

// ── ORC-13 — chế độ gửi lệnh của run ───────────────────────────────────────────────

export type StepDispatchKind = "simulated" | "live" | "other";
export type RunDispatchMode = "simulated" | "live" | "mixed" | "none";

export interface RunDispatchSummary {
  mode: RunDispatchMode;
  simulated: number;
  live: number;
}

/** Trạng thái dispatcher nghĩa là lệnh ĐÃ rời máy chủ tới thiết bị thật. */
const LIVE_STATUSES = new Set(["sent", "acked", "done"]);

/**
 * Phân loại `resultJson` của MỘT bước run. `null` = bước không phải lệnh gửi qua dispatcher
 * (hitl_gate, delay, bước seed `{ok:true}`…). Hình dạng kết quả do foeEngine ghi:
 * `{ routedTo, status, accepted, simulated, detail }`.
 */
export function classifyStepDispatch(result: unknown): StepDispatchKind | null {
  if (!isObj(result)) return null;
  const routedTo = typeof result.routedTo === "string" ? result.routedTo : null;
  const hasSimFlag = typeof result.simulated === "boolean";
  if (routedTo == null && !hasSimFlag) return null;
  const status = typeof result.status === "string" ? result.status : "";
  const detailSim = isObj(result.detail) && result.detail.simulated === true;
  if (result.simulated === true || status === "simulated" || detailSim || (routedTo != null && /sim/i.test(routedTo))) {
    return "simulated";
  }
  if (LIVE_STATUSES.has(status)) return "live";
  return "other";
}

/** Gộp các bước của MỘT run ⇒ DRY-RUN (simulated) / thật (live) / lẫn (mixed) / không có lệnh (none). */
export function summarizeRunDispatch(stepResults: unknown[]): RunDispatchSummary {
  let simulated = 0;
  let live = 0;
  for (const r of stepResults) {
    const k = classifyStepDispatch(r);
    if (k === "simulated") simulated += 1;
    else if (k === "live") live += 1;
  }
  const mode: RunDispatchMode =
    simulated > 0 && live > 0 ? "mixed" : simulated > 0 ? "simulated" : live > 0 ? "live" : "none";
  return { mode, simulated, live };
}
