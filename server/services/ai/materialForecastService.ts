/**
 * doc 44 W5-A2 (gap G4.21) — Material time-to-empty forecast (SYNAPSE §10:
 * "Dự báo tiêu hao vật tư: ước tính thời điểm hết vật tư → chủ động sinh nhiệm vụ
 * cấp liệu (QT-3)").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Tốc độ tiêu hao (rate) đo từ component_installations trong cửa sổ 24h theo
 * (machine, componentCode): tổng qty đã lắp / số giờ cửa sổ ⇒ qty/giờ. current_qty
 * lấy từ feeder_materials.qtyOnFeeder. time_to_empty = current_qty / rate ⇒ emptyAt.
 *
 * HONEST-NULL: thiếu current_qty (không có feeder / qtyOnFeeder null) ⇒ emptyAt=null,
 * status='no_current_qty' (KHÔNG bịa). rate=0 (không tiêu hao gần đây) ⇒ emptyAt=null,
 * status='no_consumption'. READ-ONLY + fail-safe (không ghi, không ném).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { componentInstallations, feederMaterials } from "../../../drizzle/schema";

export type ForecastStatus = "ok" | "no_current_qty" | "no_consumption";

export interface TimeToEmpty {
  machineId: number;
  componentCode: string;
  /** Units currently loaded (feeder_materials.qtyOnFeeder). NULL when unknown. */
  currentQty: number | null;
  /** Measured consumption rate (units/hour) over the window. */
  ratePerHour: number;
  /** Hours until empty (currentQty / rate). NULL when not computable. */
  hoursToEmpty: number | null;
  /** ISO timestamp when the material is projected to run out. NULL when not computable. */
  emptyAt: string | null;
  status: ForecastStatus;
  windowHours: number;
  /** Total units installed in the window (basis for the rate). */
  consumedInWindow: number;
}

/**
 * PURE math — given a current quantity, a per-hour consumption rate and a
 * reference time, project when the material empties. Honest-null when the inputs
 * cannot support a projection (unknown qty, or no consumption to extrapolate).
 */
export function computeTimeToEmpty(
  currentQty: number | null,
  ratePerHour: number,
  now: Date = new Date(),
): { hoursToEmpty: number | null; emptyAt: string | null; status: ForecastStatus } {
  if (currentQty == null || !Number.isFinite(currentQty)) {
    return { hoursToEmpty: null, emptyAt: null, status: "no_current_qty" };
  }
  if (!(ratePerHour > 0) || !Number.isFinite(ratePerHour)) {
    return { hoursToEmpty: null, emptyAt: null, status: "no_consumption" };
  }
  const hoursToEmpty = currentQty / ratePerHour;
  const emptyAt = new Date(now.getTime() + hoursToEmpty * 60 * 60 * 1000).toISOString();
  return { hoursToEmpty, emptyAt, status: "ok" };
}

/** Consumption rate (units/hour) for (machine, component) over `windowHours`. Fail-safe → 0. */
async function measuredRate(
  machineId: number,
  componentCode: string,
  windowHours: number,
): Promise<{ ratePerHour: number; consumed: number }> {
  try {
    const db = await getDb();
    if (!db) return { ratePerHour: 0, consumed: 0 };
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const [row] = await db
      .select({ consumed: sql<number>`COALESCE(SUM(${componentInstallations.qty}), 0)`.as("consumed") })
      .from(componentInstallations)
      .where(
        and(
          eq(componentInstallations.machineId, machineId),
          eq(componentInstallations.componentCode, componentCode),
          gte(componentInstallations.installedAt, since),
        ),
      );
    const consumed = Number(row?.consumed ?? 0);
    const ratePerHour = windowHours > 0 ? consumed / windowHours : 0;
    return { ratePerHour, consumed };
  } catch {
    return { ratePerHour: 0, consumed: 0 };
  }
}

/** Current quantity loaded for (machine, component). Fail-safe → null (honest). */
async function currentQtyFor(machineId: number, componentCode: string): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ qty: feederMaterials.qtyOnFeeder })
      .from(feederMaterials)
      .where(and(eq(feederMaterials.machineId, machineId), eq(feederMaterials.componentCode, componentCode)))
      .limit(1);
    if (!row || row.qty == null) return null;
    const n = Number(row.qty);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Forecast time-to-empty for one (machine, component). READ-ONLY + fail-safe. */
export async function forecastTimeToEmpty(input: {
  machineId: number;
  componentCode: string;
  windowHours?: number;
}): Promise<TimeToEmpty> {
  const windowHours = input.windowHours && input.windowHours > 0 ? input.windowHours : 24;
  const [{ ratePerHour, consumed }, currentQty] = await Promise.all([
    measuredRate(input.machineId, input.componentCode, windowHours),
    currentQtyFor(input.machineId, input.componentCode),
  ]);
  const { hoursToEmpty, emptyAt, status } = computeTimeToEmpty(currentQty, ratePerHour);
  return {
    machineId: input.machineId,
    componentCode: input.componentCode,
    currentQty,
    ratePerHour,
    hoursToEmpty,
    emptyAt,
    status,
    windowHours,
    consumedInWindow: consumed,
  };
}

/**
 * Forecast every component currently loaded on a machine's feeders. Soonest to
 * empty first (nulls last). READ-ONLY + fail-safe → [].
 */
export async function forecastMachineMaterials(machineId: number, windowHours = 24): Promise<TimeToEmpty[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const feeders = await db
      .select({ componentCode: feederMaterials.componentCode })
      .from(feederMaterials)
      .where(eq(feederMaterials.machineId, machineId));
    const components = Array.from(new Set(feeders.map((f) => f.componentCode).filter(Boolean)));
    const out: TimeToEmpty[] = [];
    for (const componentCode of components) {
      out.push(await forecastTimeToEmpty({ machineId, componentCode, windowHours }));
    }
    // Soonest depletion first; unknowns (null hoursToEmpty) sink to the bottom.
    out.sort((a, b) => {
      if (a.hoursToEmpty == null && b.hoursToEmpty == null) return 0;
      if (a.hoursToEmpty == null) return 1;
      if (b.hoursToEmpty == null) return -1;
      return a.hoursToEmpty - b.hoursToEmpty;
    });
    return out;
  } catch {
    return [];
  }
}
