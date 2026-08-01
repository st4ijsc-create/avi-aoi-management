/**
 * Control Tower — persona model (doc 46 FE-W3.1, decision D4 "consolidate + complete").
 *
 * ONE persona-configurable command surface (`/control-tower`) that composes the
 * most important live signals from the six overlapping command screens
 * (CommandCenter · FactoryCommandView · MESControlTower · WarRoom · OpsConsole ·
 * CorporateDashboard) and links out to each for depth. Rather than rewrite them,
 * we pick WHICH compact panels to show per persona:
 *
 *   • Executive  — corporate yield/OEE, exec summary, top AI risks, alarm health.
 *   • Supervisor — per-line OEE, plan-vs-actual, shift compare, Andon rail.
 *   • Operations — live alarm rail, alarm health, top downtime, Andon rail.
 *
 * The chosen persona is persisted in localStorage; on first visit it is derived
 * from the signed-in user's role (see `personaForRole`). Nothing here fabricates
 * data — every panel reads a REAL tRPC router with an honest empty/loading state.
 */

export type Persona = "executive" | "supervisor" | "operations";

/** Every panel the Control Tower can render (keys map → components in panels.tsx). */
export type PanelKey =
  | "corporate"
  | "execSummary"
  | "topRisks"
  | "alarmHealth"
  | "lineOee"
  | "planVsActual"
  | "shiftCompare"
  | "andonRail"
  | "liveAlarms"
  | "topDowntime";

export const PERSONAS: readonly Persona[] = ["executive", "supervisor", "operations"] as const;

/** i18n key + English default for each persona label (rendered via t()). */
export const PERSONA_META: Record<Persona, { labelKey: string; labelDefault: string; descKey: string; descDefault: string }> = {
  executive: {
    labelKey: "controlTower.persona.executive",
    labelDefault: "Executive",
    descKey: "controlTower.persona.executiveDesc",
    descDefault: "Corporate yield & OEE, executive summary, top risks and alarm health.",
  },
  supervisor: {
    labelKey: "controlTower.persona.supervisor",
    labelDefault: "Supervisor",
    descKey: "controlTower.persona.supervisorDesc",
    descDefault: "Per-line OEE, plan vs actual, shift comparison and the Andon rail.",
  },
  operations: {
    labelKey: "controlTower.persona.operations",
    labelDefault: "Operations",
    descKey: "controlTower.persona.operationsDesc",
    descDefault: "Live alarm rail, alarm health, top downtime and the Andon rail.",
  },
};

/** Ordered panel set per persona. */
export const PERSONA_PANELS: Record<Persona, readonly PanelKey[]> = {
  executive: ["corporate", "execSummary", "topRisks", "alarmHealth"],
  supervisor: ["lineOee", "planVsActual", "shiftCompare", "andonRail"],
  operations: ["liveAlarms", "alarmHealth", "topDowntime", "andonRail"],
};

/**
 * Map an authenticated user's role → the most useful default persona.
 * Mirrors the role vocabulary in `lib/roleLanding.ts`. Unknown roles fall back
 * to the executive (high-level, read-only) view.
 */
export function personaForRole(role?: string | null): Persona {
  switch (role) {
    case "supervisor":
      return "supervisor";
    case "operator":
    case "maintenance":
    case "engineer":
    case "quality_inspector":
      return "operations";
    case "admin":
    case "it_admin":
    case "manager":
    case "viewer":
    case "user":
    default:
      return "executive";
  }
}

const STORAGE_KEY = "controlTower:persona";

/** Read the persisted persona (validated), or null when unset/invalid. */
export function getStoredPersona(): Persona | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && (PERSONAS as readonly string[]).includes(raw) ? (raw as Persona) : null;
  } catch {
    return null;
  }
}

/** Persist the chosen persona (best-effort; ignores private-mode failures). */
export function storePersona(persona: Persona): void {
  try {
    localStorage.setItem(STORAGE_KEY, persona);
  } catch {
    /* storage unavailable — persona simply won't persist */
  }
}
