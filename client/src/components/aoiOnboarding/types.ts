// W2-D (doc 27 §3 C4) — shared types for the AOI/AVI Connection Wizard
// (/aoi-onboarding). 5 steps: machine+vendor → data source → dry-run →
// credential → commissioning sign-off.

/** Common render model both dry-run backends map into (aoiOnboarding.dryRun
 *  for pasted payloads, hotFolder.dryRun for uploaded sample files). */
export interface DryRunRenderModel {
  serialNumber: string;
  productModel?: string | null;
  overallResult: string;
  measurementCount: number;
  /** OK/NG/NTF breakdown (aoiOnboarding.dryRun) — hotFolder path only has ngCount. */
  results?: { OK: number; NG: number; NTF: number } | null;
  ngCount?: number | null;
  warnings: string[];
  sample?: Array<{
    pointCode: string | null;
    measuredValue: unknown;
    result: string;
    defectCatalogCode: string | null;
  }>;
  /** Detected file format (hotFolder path): csv | xml | json. */
  format?: string | null;
}

export interface AoiWizardState {
  // Step 1 — machine + vendor adapter
  machineId?: number;
  machineCode?: string;
  machineName?: string;
  machineHasApiKey: boolean;
  adapterKey?: string;
  adapterLabel?: string;

  // Step 2 — data source
  ingestionMode: "hot-folder" | "http-push";
  hotFolder: {
    watchPath: string;
    filePattern: string;
    archivePath: string;
    errorPath: string;
  };

  // Step 3 — dry-run validation
  dryRunPassed: boolean;
  dryRunSummary?: DryRunRenderModel | null;
  /** Admin-only reason to sign off WITHOUT a passing dry-run (audited). */
  overrideReason: string;

  // Step 4 — credential (plaintextKey lives in memory ONLY — never in the draft)
  keyIssued: boolean;
  keyPrefix?: string;
  plaintextKey?: string;

  // Step 5 — sign-off
  signedOff: boolean;
}

export const initialAoiWizardState: AoiWizardState = {
  machineHasApiKey: false,
  ingestionMode: "hot-folder",
  hotFolder: {
    watchPath: "",
    filePattern: "*.{csv,xml,json}",
    archivePath: "",
    errorPath: "",
  },
  dryRunPassed: false,
  overrideReason: "",
  keyIssued: false,
  signedOff: false,
};

/** Draft snapshot persisted server-side (matches aoiOnboardingRouter snapshotSchema). */
export interface AoiDraftSnapshot {
  step?: number;
  vendor?: { adapterKey: string; label?: string };
  ingestion?: {
    mode: "hot-folder" | "http-push";
    hotFolder?: { watchPath: string; filePattern?: string; archivePath?: string; errorPath?: string };
  };
  dryRun?: { passed: boolean; at?: string; adapterKey?: string; summary?: Record<string, unknown> };
  credential?: { issued?: boolean; keyPrefix?: string; issuedAt?: string };
  notes?: string;
}

/** Serialize wizard state → server draft snapshot. NEVER includes plaintextKey. */
export function buildSnapshot(state: AoiWizardState, step: number): AoiDraftSnapshot {
  return {
    step,
    ...(state.adapterKey
      ? { vendor: { adapterKey: state.adapterKey, label: state.adapterLabel } }
      : {}),
    ingestion: {
      mode: state.ingestionMode,
      ...(state.ingestionMode === "hot-folder" && state.hotFolder.watchPath
        ? {
            hotFolder: {
              watchPath: state.hotFolder.watchPath,
              filePattern: state.hotFolder.filePattern || undefined,
              archivePath: state.hotFolder.archivePath || undefined,
              errorPath: state.hotFolder.errorPath || undefined,
            },
          }
        : {}),
    },
    ...(state.dryRunPassed || state.dryRunSummary
      ? {
          dryRun: {
            passed: state.dryRunPassed,
            at: new Date().toISOString(),
            adapterKey: state.adapterKey,
            summary: (state.dryRunSummary ?? undefined) as Record<string, unknown> | undefined,
          },
        }
      : {}),
    ...(state.keyIssued
      ? { credential: { issued: true, keyPrefix: state.keyPrefix, issuedAt: new Date().toISOString() } }
      : {}),
  };
}

/** Hydrate wizard state from a resumed server draft snapshot. */
export function applySnapshot(snap: AoiDraftSnapshot): Partial<AoiWizardState> {
  const patch: Partial<AoiWizardState> = {};
  if (snap.vendor?.adapterKey) {
    patch.adapterKey = snap.vendor.adapterKey;
    patch.adapterLabel = snap.vendor.label;
  }
  if (snap.ingestion?.mode) {
    patch.ingestionMode = snap.ingestion.mode;
    if (snap.ingestion.hotFolder) {
      patch.hotFolder = {
        watchPath: snap.ingestion.hotFolder.watchPath ?? "",
        filePattern: snap.ingestion.hotFolder.filePattern ?? "*.{csv,xml,json}",
        archivePath: snap.ingestion.hotFolder.archivePath ?? "",
        errorPath: snap.ingestion.hotFolder.errorPath ?? "",
      };
    }
  }
  if (snap.dryRun) {
    patch.dryRunPassed = snap.dryRun.passed === true;
    patch.dryRunSummary = (snap.dryRun.summary as unknown as DryRunRenderModel) ?? null;
  }
  if (snap.credential?.issued) {
    patch.keyIssued = true;
    patch.keyPrefix = snap.credential.keyPrefix;
  }
  return patch;
}

export interface StepProps {
  state: AoiWizardState;
  update: (patch: Partial<AoiWizardState>) => void;
  onNext: () => void;
  onBack: () => void;
  /** Jump to a step (used by draft resume). */
  goToStep: (step: number) => void;
  /** Persist the current draft snapshot (fire-and-forget). */
  persistDraft: () => void;
}
