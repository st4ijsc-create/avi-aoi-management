/**
 * Pure data-shaping helpers for the reporting pages (doc 32 R4).
 * ============================================================================
 * Extracted from Reports.tsx / ReportBuilder.tsx so the transforms are
 * unit-testable without rendering the full tRPC / i18n / router stack. These
 * feed the "By machine" / "By factory" report tabs (doc 32 P0 #2 — previously
 * hardcoded []) and the on-demand export filters (item 15).
 */

export interface MachineComparisonRow {
  name: string;
  code: string;
  total: number;
  yieldRate: number;
  ngRate: number;
}

export interface TopBottomMachines {
  top?: any[];
  bottom?: any[];
}

/**
 * Combine top + bottom machines (deduped by id) into the machine-comparison rows
 * the Reports "By machine" tab + its Excel/PDF sheets consume. `yieldRate` is the
 * canonical FINAL yield; `ngRate` is derived from raw counts. Optionally scoped to
 * a single factory (matched via the machine list's `factoryId`).
 */
export function buildMachineComparison(
  topBottom: TopBottomMachines | null | undefined,
  machines: Array<{ id: number; factoryId?: number | null }> | null | undefined,
  selectedFactory: string,
): MachineComparisonRow[] {
  if (!topBottom) return [];
  const combined = [...(topBottom.top ?? []), ...(topBottom.bottom ?? [])];
  const factoryFilter = selectedFactory !== "all" ? parseInt(selectedFactory, 10) : null;
  const factoryByMachineId = new Map<number, number | null | undefined>(
    (machines ?? []).map((m) => [m.id, m.factoryId]),
  );
  const seen = new Set<number>();
  return combined
    .filter((m: any) => {
      if (m.id == null || seen.has(m.id)) return false;
      seen.add(m.id);
      if (factoryFilter != null) return factoryByMachineId.get(m.id) === factoryFilter;
      return true;
    })
    .map((m: any) => {
      const total = Number(m.total) || 0;
      const ng = Number(m.ng) || 0;
      return {
        name: m.name || m.code || `#${m.id}`,
        code: m.code || "",
        total,
        yieldRate: Number(m.finalYield) || 0,
        ngRate: total > 0 ? (ng / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.yieldRate - a.yieldRate);
}

export interface FactoryComparisonRow {
  name: string;
  code: string;
  total: number;
  yieldRate: number;
  machines: number;
}

/**
 * Shape per-factory yield rows (from corporateFactoryStats.yieldRateByFactory)
 * into the Reports "By factory" tab + export rows. Names resolve from the factory
 * master list by code; machine counts come from the machine list grouped by
 * factoryId. Optionally scoped to a single factory.
 */
export function buildFactoryComparison(
  factoryYield: any[] | null | undefined,
  factories: Array<{ id: number; code: string; name: string }> | null | undefined,
  machines: Array<{ factoryId?: number | null }> | null | undefined,
  selectedFactory: string,
): FactoryComparisonRow[] {
  if (!factoryYield) return [];
  const factoryByCode = new Map((factories ?? []).map((f) => [f.code, f]));
  const machineCountByFactoryId = new Map<number, number>();
  for (const m of machines ?? []) {
    const fid = m.factoryId;
    if (fid != null) machineCountByFactoryId.set(fid, (machineCountByFactoryId.get(fid) || 0) + 1);
  }
  const selectedCode =
    selectedFactory !== "all"
      ? (factories ?? []).find((f) => String(f.id) === selectedFactory)?.code
      : null;
  return factoryYield
    .filter((f) => (selectedCode ? f.factoryCode === selectedCode : true))
    .map((f) => {
      const matched = factoryByCode.get(f.factoryCode);
      return {
        name: matched?.name || f.factoryCode || "N/A",
        code: f.factoryCode || "",
        total: Number(f.totalInspections) || 0,
        yieldRate: parseFloat(f.yieldRate) || 0,
        machines: matched ? machineCountByFactoryId.get(matched.id) || 0 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Build the on-demand report filter object from the ReportBuilder controls
 * ("all"/empty → omitted). Numeric ids are coerced; shift is trimmed (item 15).
 */
export function buildOnDemandReportFilters(input: {
  lineId?: string;
  stationId?: string;
  productModelId?: string;
  shift?: string;
}): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (input.lineId && input.lineId !== "all") out.lineId = Number(input.lineId);
  if (input.stationId && input.stationId !== "all") out.stationId = Number(input.stationId);
  if (input.productModelId && input.productModelId !== "all") out.productModelId = Number(input.productModelId);
  if (input.shift && input.shift.trim()) out.shift = input.shift.trim();
  return out;
}
