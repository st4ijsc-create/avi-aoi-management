/**
 * Task 6 (docs/MACHINE_CONFIG_DESIGN.md §6, docs/plans/2026-07-21-machine-config.md
 * — repo D:/SOURCES/avi-aoi-sim, ported here) — machine operating-config REPORT-UP
 * service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A machine pushes what it is ACTUALLY running (its scoped adjustments + the
 * resolved effective parameter set) into `machine_operating_config`. This is a
 * DIFFERENT concern than configDriftService's desired/reported shadow
 * (machine_config_state — "did the machine apply what the server told it to?"):
 * this table is a durable, per-(machine, configKind, scope) record an engineer
 * can browse to see the machine's CURRENT tuning, independent of any deploy.
 *
 * CRITICAL (design doc §2 verbatim): "Đẩy lên server = báo cáo cấu hình THỰC TẾ
 * của máy này, KHÔNG phải ghi đè baseline chung." This module writes ONLY
 * `machine_operating_config` — it MUST NEVER touch `machine_recipes` or any
 * other baseline table. Promoting one machine's tuning into the shared
 * recommendation is a distinct, out-of-scope, sign-off-gated action.
 *
 * GATED by MACHINE_OPERATING_CONFIG_REPORT_ENABLED (default OFF) — the router
 * procedure throws PRECONDITION_FAILED before this module is ever called while
 * the flag is off, so nothing here executes in a stock deployment.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { machineOperatingConfig, type MachineOperatingConfig } from "../../drizzle/schema";
import { resolveGuardrail, checkAgainstGuardrail } from "./ai/parameterGuardrailService";

// ── flag (read at call time — tests flip it; no redeploy) ─────────────────────

function envTrue(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

/** Master switch for POST reportSettings (machine_operating_config REPORT-UP). */
export function machineOperatingConfigReportEnabled(): boolean {
  return envTrue(process.env.MACHINE_OPERATING_CONFIG_REPORT_ENABLED);
}

// ── types ─────────────────────────────────────────────────────────────────────

export interface ParameterAdjustmentInput {
  value: string | number | boolean | null;
  by?: string | null;
  at?: string | null;
  note?: string | null;
}

export interface EffectiveParameterInput {
  key: string;
  value: string | number | boolean | null;
  source?: "baseline" | "machine" | "machineProduct";
  baselineValue?: string | number | boolean | null;
}

export interface ReportOperatingConfigInput {
  machineId: number;
  configKind: string;
  /** null ⇒ machine-scoped row; set ⇒ machine×product-scoped row. */
  productModelId: number | null;
  baselineVersion?: string | null;
  adjustments: Record<string, ParameterAdjustmentInput>;
  effective: EffectiveParameterInput[];
  checksum?: string | null;
  reportedBy?: string | null;
}

/**
 * Normalize the wire `EffectiveParameter[]` (the simulator's shape, per
 * mc-task1&2-report) into the jsonb MAP the column stores — keyed by parameter
 * key, matching `adjustments`' shape and the schema's declared
 * `Record<string, unknown>` TS type.
 */
function normalizeEffective(effective: EffectiveParameterInput[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of effective) {
    if (!p || typeof p.key !== "string" || !p.key) continue;
    out[p.key] = {
      value: p.value,
      source: p.source ?? null,
      baselineValue: p.baselineValue ?? null,
    };
  }
  return out;
}

// ── guardrail cross-check (I-1, mc-feature-review.md) ─────────────────────────

/**
 * The four `configKind`s the server already has a real typed vocabulary for
 * (`recipeSchemas.ts` — screw/dispense/weld/iot). `aoi_inspection` is
 * DELIBERATELY excluded: it is a simulator-only vocabulary the server has no
 * schema for at all (recipeSchemas.ts's own comment: "A machineType with NO
 * typed schema (e.g. AOI/AVI/ICT) always passes") — there is nothing to look a
 * guardrail up against, so `reportSettings` stores AOI reports unvalidated by
 * design (see `findOperatingConfigGuardrailViolation`'s doc comment).
 */
const SERVER_KNOWN_CONFIG_KINDS = new Set(["screw_program", "dispense_program", "weld_profile", "iot_settings"]);

export function isServerKnownConfigKind(configKind: string): boolean {
  return SERVER_KNOWN_CONFIG_KINDS.has(configKind);
}

/**
 * I-1 — `reportSettings` used to store whatever `adjustments`/`effective` values
 * a machine reported with NO numeric range check at all (only zod string/type
 * shape validation), even though the server already has a real per-(machine,
 * param) guardrail table (`parameter_guardrails`, doc 44 W5-A2) enforced on the
 * ACTUATION path (`set_machine_param`). This is the same cross-check applied to
 * the REPORT-UP path: for each reported key, resolve the effective guardrail
 * (machine-specific row wins over the machine-type default) and reject the
 * whole report if any numeric value falls outside it.
 *
 * Deliberately NOT flag-gated behind `PARAM_GUARDRAIL_ENABLED`/`_STRICT` (those
 * gate the ACTUATION write path in `machineControl.ts`) — this is validation on
 * a REPORT sink, always-on but low-risk: `checkAgainstGuardrail` called without
 * `strict` is already the same "no guardrail configured for this key ⇒ allowed"
 * shape every config-sync sibling in this codebase uses, so a machine reporting
 * a param nobody has authored a guardrail for is unaffected (matches the
 * exhibition's default-empty guardrail table — this fires only once an engineer
 * has actually set a range). `checkAgainstGuardrail`'s `maxStep` half is
 * intentionally NOT exercised here (no `oldValue` is passed) — a REPORT is not
 * a proposed step-change, it is the machine stating what it is already running.
 *
 * `aoi_inspection` is skipped entirely by the caller (see
 * `isServerKnownConfigKind`) — never reaches this function.
 *
 * Returns a human-readable violation detail (Vietnamese, same wording
 * `checkAgainstGuardrail` already produces for `set_machine_param`) for the
 * FIRST out-of-range value found, or null when everything checked out (or
 * nothing had a guardrail configured).
 */
export async function findOperatingConfigGuardrailViolation(
  machineId: number,
  adjustments: Record<string, ParameterAdjustmentInput> | undefined,
  effective: EffectiveParameterInput[] | undefined,
): Promise<string | null> {
  for (const [key, adj] of Object.entries(adjustments ?? {})) {
    const violation = await checkOneGuardrail(machineId, key, adj?.value);
    if (violation) return violation;
  }
  for (const p of effective ?? []) {
    if (!p?.key) continue;
    const violation = await checkOneGuardrail(machineId, p.key, p.value);
    if (violation) return violation;
  }
  return null;
}

async function checkOneGuardrail(machineId: number, key: string, value: unknown): Promise<string | null> {
  const guardrail = await resolveGuardrail(machineId, key);
  if (!guardrail) return null; // no guardrail authored for this key — allowed, non-strict (see doc comment above)
  const result = checkAgainstGuardrail(guardrail, value);
  return !result.ok && result.code === "OUT_OF_RANGE" ? `${key}: ${result.detail}` : null;
}

// ── write ─────────────────────────────────────────────────────────────────────

/**
 * Upsert the machine's reported operating config for ONE (machineId,
 * configKind, scope) row. `scope` is derived from `productModelId`'s nullness
 * here — the only caller-facing knob — mirroring the DB CHECK constraint
 * (`ck_moc_scope_matches_product`) so the two can never disagree.
 *
 * Upserts against the matching PARTIAL unique index — `uq_moc_machine_scope`
 * (WHERE productModelId IS NULL) or `uq_moc_product_scope` (WHERE
 * productModelId IS NOT NULL) — via `targetWhere`, so a re-report of the SAME
 * (machine, configKind[, product]) updates the existing row in place instead of
 * violating the index or inserting a duplicate. The machine-scoped row and any
 * number of per-product rows for the same (machine, configKind) coexist without
 * collision because they land on two DIFFERENT partial indexes.
 *
 * Writes ONLY `machine_operating_config` — see the header block above.
 */
export async function upsertOperatingConfigReport(
  input: ReportOperatingConfigInput,
): Promise<MachineOperatingConfig> {
  const d = await getDb();
  if (!d) throw new Error("Database not available");

  const scope: "machine" | "machine_product" = input.productModelId != null ? "machine_product" : "machine";
  const now = new Date();
  const values = {
    machineId: input.machineId,
    configKind: input.configKind,
    productModelId: input.productModelId,
    scope,
    baselineVersion: input.baselineVersion ?? null,
    adjustments: input.adjustments ?? {},
    effective: normalizeEffective(input.effective ?? []),
    checksum: input.checksum ?? null,
    reportedBy: input.reportedBy ?? null,
    reportedAt: now,
    updatedAt: now,
  };
  const setOnConflict = {
    baselineVersion: values.baselineVersion,
    adjustments: values.adjustments,
    effective: values.effective,
    checksum: values.checksum,
    reportedBy: values.reportedBy,
    reportedAt: values.reportedAt,
    updatedAt: values.updatedAt,
  };

  const [row] =
    input.productModelId != null
      ? await d
          .insert(machineOperatingConfig)
          .values(values)
          .onConflictDoUpdate({
            target: [
              machineOperatingConfig.machineId,
              machineOperatingConfig.configKind,
              machineOperatingConfig.productModelId,
            ],
            targetWhere: sql`${machineOperatingConfig.productModelId} IS NOT NULL`,
            set: setOnConflict,
          })
          .returning()
      : await d
          .insert(machineOperatingConfig)
          .values(values)
          .onConflictDoUpdate({
            target: [machineOperatingConfig.machineId, machineOperatingConfig.configKind],
            targetWhere: sql`${machineOperatingConfig.productModelId} IS NULL`,
            set: setOnConflict,
          })
          .returning();
  return row;
}
