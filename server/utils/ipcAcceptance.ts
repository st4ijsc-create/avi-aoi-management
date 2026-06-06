/**
 * P4.A G11 (extension) — IPC-A-610 acceptance helper.
 *
 *  Class 1 — Consumer / general purpose.
 *  Class 2 — General electronics: dedicated service electronics where
 *            extended life and uninterrupted service is desired but not
 *            critical. (Default for most EMS production.)
 *  Class 3 — High-reliability electronics where continued performance or
 *            performance-on-demand is critical (automotive safety,
 *            aerospace, medical life-support, military).
 *
 *  Per-defect verdict is stored on `defect_catalog.classRules` jsonb:
 *
 *    {
 *      class2?: { accept, severity?, limit?, notes? },
 *      class3?: { accept, severity?, limit?, notes? }
 *    }
 *
 *  When `classRules` is absent, we fall back to the legacy
 *  `acceptanceClass` field: if the defect is flagged at the requested class
 *  or stricter, the verdict is `'reject'` (with row severity); otherwise
 *  `'accept'`.
 */

export type IpcClass = "1" | "2" | "3";

export const IPC_CLASSES: Record<IpcClass, { name: string; description: string }> = {
  "1": {
    name: "Class 1 — General",
    description:
      "Consumer / general electronics where major requirement is product function. Cosmetic imperfections are not important.",
  },
  "2": {
    name: "Class 2 — Dedicated Service",
    description:
      "General electronics: products where continued performance and extended life is required, but uninterrupted service is non-critical. Typical EMS default.",
  },
  "3": {
    name: "Class 3 — High Reliability",
    description:
      "Products where continued high performance / performance-on-demand is critical: automotive safety, aerospace, medical life-support, military. Strictest accept criteria.",
  },
};

export type Verdict = "accept" | "process" | "reject";
export type Severity = "critical" | "major" | "minor" | "cosmetic";

export interface ClassRule {
  accept: Verdict;
  severity?: Severity;
  /** Numeric / textual limit override (e.g. "void <=9% area", "fill >=100%"). */
  limit?: string;
  notes?: string;
}

export interface ClassRules {
  class2?: ClassRule;
  class3?: ClassRule;
}

export interface DefectRow {
  code: string;
  severity?: string | null;
  acceptanceClass?: string | null;
  classRules?: ClassRules | null;
}

export interface ResolvedRule {
  accept: Verdict;
  severity: Severity;
  limit?: string;
  notes?: string;
  /** True when the verdict came from explicit `classRules`. */
  explicit: boolean;
}

export function listIpcClasses() {
  return (Object.keys(IPC_CLASSES) as IpcClass[]).map((id) => ({
    id,
    ...IPC_CLASSES[id],
  }));
}

/**
 * Resolve the effective verdict + severity for a defect at the requested
 * IPC class. Falls back to the legacy `acceptanceClass` flag when no
 * explicit per-class rule is present.
 */
export function resolveDefectForClass(
  defect: DefectRow,
  ipcClass: IpcClass,
): ResolvedRule {
  const rules = defect.classRules ?? null;
  const explicit = rules
    ? ipcClass === "3"
      ? rules.class3
      : ipcClass === "2"
        ? rules.class2
        : undefined
    : undefined;

  const fallbackSeverity = (defect.severity as Severity) ?? "minor";

  if (explicit) {
    return {
      accept: explicit.accept,
      severity: explicit.severity ?? fallbackSeverity,
      limit: explicit.limit,
      notes: explicit.notes,
      explicit: true,
    };
  }

  // Legacy fallback: acceptanceClass = strictest class this defect is
  // flagged on. So `acceptanceClass='2'` → flagged for both Class 2 and 3.
  // `acceptanceClass='3'` → only flagged when target = Class 3.
  const flagged = legacyFlagged(defect.acceptanceClass ?? null, ipcClass);
  return {
    accept: flagged ? "reject" : "accept",
    severity: fallbackSeverity,
    explicit: false,
  };
}

function legacyFlagged(acceptanceClass: string | null, target: IpcClass): boolean {
  if (!acceptanceClass) return true; // no policy → conservative
  const a = Number.parseInt(acceptanceClass, 10);
  const t = Number.parseInt(target, 10);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return true;
  return t >= a;
}
