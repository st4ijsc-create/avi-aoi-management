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
