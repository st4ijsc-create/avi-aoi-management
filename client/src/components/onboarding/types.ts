// WS-2 — shared types for the Machine Onboarding Wizard
import type { MachineType } from "@/constants/machineTypes";

export interface WizardState {
  // Step 1 — machine info & connectivity
  code: string;
  name: string;
  machineType: MachineType;
  serialNumber: string;
  ipAddress: string;
  port: number;
  protocol: "websocket" | "tcp" | "http";

  // Step 2 — connection test result
  connectionTested: boolean;
  connectionOk: boolean;
  latencyMs?: number;

  // Step 3 — station assignment + approval
  stationId?: number;
  machineId?: number; // created/registered machine id
  apiKey?: string;
  approved: boolean;

  // Step 4 — product + AI model deploy
  productModelId?: number;
  modelId?: number;
  modelVersion?: string;
  deploymentId?: number;

  // Step 5 — verification
  deployStatus?: string;

  // LUỒNG ① — AI Setup Advisor: the accepted proposed bundle (advisory, pre-fills
  // subsequent steps). Undefined = manual / AI skipped. Shape mirrors the
  // server's ConfigBundle (kept loose to avoid a server-type import on the client).
  aiBundle?: AISetupBundle;
  /** Recommended AI model code from the bundle (display + Step4 hint). */
  recommendedModelCode?: string;
}

// Mirror of server ConfigBundle (server/services/aiSetupAdvisor.ts). Loose by
// design — the client only needs to read it for review + pre-fill.
export interface AISetupProposedPoint {
  code: string | null;
  name: string | null;
  measurementType: string | null;
  unit: string | null;
  lsl: number | null;
  usl: number | null;
  target: number | null;
  source: "data" | "copied" | "default";
  sampleSize: number;
  note?: string;
}

export interface AISetupBundle {
  ok: boolean;
  disabled?: boolean;
  templateMachine: {
    id: number; code: string | null; name: string | null;
    machineType: string; stationId: number | null; productModelId: number | null;
  } | null;
  similarityReason: string;
  points: AISetupProposedPoint[];
  ngThresholds: Array<{
    warning: number; critical: number; minSampleSize: number;
    cooldownMinutes: number; source: "data" | "copied" | "default";
  }>;
  stationSuggestion: { stationId: number | null; source: "data" | "copied" | "default" };
  model: { code: string; source: "data" | "copied" | "default" };
  summary: {
    points: number; ngThresholds: number;
    thresholdsFromData: number; thresholdsCopied: number;
  };
  notes: string[];
  degraded: boolean;
}

export const initialWizardState: WizardState = {
  code: "",
  name: "",
  machineType: "AOI",
  serialNumber: "",
  ipAddress: "",
  port: 8080,
  protocol: "tcp",
  connectionTested: false,
  connectionOk: false,
  approved: false,
};

export interface StepProps {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}
