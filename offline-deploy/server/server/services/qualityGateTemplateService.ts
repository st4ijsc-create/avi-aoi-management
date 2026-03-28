/**
 * Quality Gate Template Service
 * Thư viện template Quality Gate chuẩn công nghiệp
 */

export interface QualityGateTemplateRule {
  gateType: "yield_rate" | "ng_count" | "ng_rate" | "cpk_threshold" | "consecutive_ng";
  threshold: number;
  comparisonOperator: "lt" | "lte" | "gt" | "gte" | "eq";
  windowSize: number;
  consecutiveCount: number;
  action: "alert" | "pause" | "stop";
  autoResumeAfterMinutes?: number;
}

export interface QualityGateTemplate {
  id: string;
  name: string;
  nameKey: string;  // i18n key
  description: string;
  descriptionKey: string;
  standard: string;
  category: "electronics" | "automotive" | "aerospace" | "medical" | "general" | "custom";
  icon: string;
  rules: QualityGateTemplateRule[];
  notifyRoles: string[];
  isBuiltIn: boolean;
}

/**
 * 6 Built-in quality gate templates
 */
export const BUILTIN_TEMPLATES: QualityGateTemplate[] = [
  // 1. IPC-A-610 Electronics Assembly
  {
    id: "ipc-a-610",
    name: "IPC-A-610 Electronics Assembly",
    nameKey: "qualityGateTemplates.ipcA610Name",
    description: "IPC-A-610 standard for electronics assembly quality. Class 2 (Dedicated Service Electronics). Covers soldering, component placement, PCB cleanliness.",
    descriptionKey: "qualityGateTemplates.ipcA610Desc",
    standard: "IPC-A-610 Rev H",
    category: "electronics",
    icon: "CircuitBoard",
    rules: [
      { gateType: "yield_rate", threshold: 95, comparisonOperator: "lt", windowSize: 200, consecutiveCount: 3, action: "alert" },
      { gateType: "ng_rate", threshold: 3, comparisonOperator: "gt", windowSize: 100, consecutiveCount: 3, action: "pause" },
      { gateType: "consecutive_ng", threshold: 1, comparisonOperator: "gte", windowSize: 50, consecutiveCount: 5, action: "stop", autoResumeAfterMinutes: 30 },
      { gateType: "cpk_threshold", threshold: 1.33, comparisonOperator: "lt", windowSize: 200, consecutiveCount: 1, action: "alert" },
    ],
    notifyRoles: ["quality_inspector", "supervisor"],
    isBuiltIn: true,
  },

  // 2. Automotive IATF 16949
  {
    id: "iatf-16949",
    name: "Automotive IATF 16949",
    nameKey: "qualityGateTemplates.iatf16949Name",
    description: "IATF 16949 automotive quality management standard. Zero-defect philosophy with stringent control limits for safety-critical components.",
    descriptionKey: "qualityGateTemplates.iatf16949Desc",
    standard: "IATF 16949:2016",
    category: "automotive",
    icon: "Car",
    rules: [
      { gateType: "yield_rate", threshold: 99.5, comparisonOperator: "lt", windowSize: 500, consecutiveCount: 1, action: "alert" },
      { gateType: "ng_count", threshold: 3, comparisonOperator: "gt", windowSize: 500, consecutiveCount: 1, action: "pause" },
      { gateType: "consecutive_ng", threshold: 1, comparisonOperator: "gte", windowSize: 100, consecutiveCount: 2, action: "stop", autoResumeAfterMinutes: 60 },
      { gateType: "cpk_threshold", threshold: 1.67, comparisonOperator: "lt", windowSize: 300, consecutiveCount: 1, action: "stop" },
      { gateType: "ng_rate", threshold: 0.5, comparisonOperator: "gt", windowSize: 200, consecutiveCount: 2, action: "pause" },
    ],
    notifyRoles: ["quality_inspector", "supervisor", "admin"],
    isBuiltIn: true,
  },

  // 3. Electronics SMT (Surface Mount Technology)
  {
    id: "smt-electronics",
    name: "SMT Electronics Manufacturing",
    nameKey: "qualityGateTemplates.smtName",
    description: "Quality gates for SMT (Surface Mount Technology) process. Monitors solder paste, pick-and-place accuracy, reflow soldering defects.",
    descriptionKey: "qualityGateTemplates.smtDesc",
    standard: "IPC J-STD-001",
    category: "electronics",
    icon: "Cpu",
    rules: [
      { gateType: "yield_rate", threshold: 97, comparisonOperator: "lt", windowSize: 300, consecutiveCount: 2, action: "alert" },
      { gateType: "ng_rate", threshold: 2, comparisonOperator: "gt", windowSize: 150, consecutiveCount: 3, action: "pause" },
      { gateType: "consecutive_ng", threshold: 1, comparisonOperator: "gte", windowSize: 50, consecutiveCount: 3, action: "stop", autoResumeAfterMinutes: 20 },
      { gateType: "cpk_threshold", threshold: 1.33, comparisonOperator: "lt", windowSize: 250, consecutiveCount: 1, action: "alert" },
    ],
    notifyRoles: ["quality_inspector", "supervisor"],
    isBuiltIn: true,
  },

  // 4. Aerospace AS9100
  {
    id: "as9100",
    name: "Aerospace AS9100",
    nameKey: "qualityGateTemplates.as9100Name",
    description: "AS9100 aerospace quality management system. Extremely stringent tolerances for flight-critical components with zero tolerance for defects.",
    descriptionKey: "qualityGateTemplates.as9100Desc",
    standard: "AS9100 Rev D",
    category: "aerospace",
    icon: "Plane",
    rules: [
      { gateType: "yield_rate", threshold: 99.9, comparisonOperator: "lt", windowSize: 1000, consecutiveCount: 1, action: "stop" },
      { gateType: "ng_count", threshold: 1, comparisonOperator: "gte", windowSize: 500, consecutiveCount: 1, action: "stop", autoResumeAfterMinutes: 120 },
      { gateType: "consecutive_ng", threshold: 1, comparisonOperator: "gte", windowSize: 100, consecutiveCount: 1, action: "stop" },
      { gateType: "cpk_threshold", threshold: 2.0, comparisonOperator: "lt", windowSize: 500, consecutiveCount: 1, action: "stop" },
    ],
    notifyRoles: ["quality_inspector", "supervisor", "admin"],
    isBuiltIn: true,
  },

  // 5. Medical Device ISO 13485
  {
    id: "iso-13485",
    name: "Medical Device ISO 13485",
    nameKey: "qualityGateTemplates.iso13485Name",
    description: "ISO 13485 medical device quality management. Patient safety focus with rigorous process validation and traceability requirements.",
    descriptionKey: "qualityGateTemplates.iso13485Desc",
    standard: "ISO 13485:2016",
    category: "medical",
    icon: "Heart",
    rules: [
      { gateType: "yield_rate", threshold: 99.7, comparisonOperator: "lt", windowSize: 500, consecutiveCount: 1, action: "pause" },
      { gateType: "ng_count", threshold: 2, comparisonOperator: "gt", windowSize: 200, consecutiveCount: 1, action: "stop", autoResumeAfterMinutes: 90 },
      { gateType: "consecutive_ng", threshold: 1, comparisonOperator: "gte", windowSize: 50, consecutiveCount: 1, action: "stop" },
      { gateType: "cpk_threshold", threshold: 1.67, comparisonOperator: "lt", windowSize: 300, consecutiveCount: 1, action: "pause" },
      { gateType: "ng_rate", threshold: 0.3, comparisonOperator: "gt", windowSize: 500, consecutiveCount: 1, action: "stop" },
    ],
    notifyRoles: ["quality_inspector", "supervisor", "admin"],
    isBuiltIn: true,
  },

  // 6. General Manufacturing (Default)
  {
    id: "general-manufacturing",
    name: "General Manufacturing",
    nameKey: "qualityGateTemplates.generalName",
    description: "General-purpose quality gates suitable for most manufacturing environments. Balanced between sensitivity and practicality.",
    descriptionKey: "qualityGateTemplates.generalDesc",
    standard: "ISO 9001:2015",
    category: "general",
    icon: "Factory",
    rules: [
      { gateType: "yield_rate", threshold: 90, comparisonOperator: "lt", windowSize: 100, consecutiveCount: 3, action: "alert" },
      { gateType: "ng_rate", threshold: 5, comparisonOperator: "gt", windowSize: 100, consecutiveCount: 5, action: "pause" },
      { gateType: "consecutive_ng", threshold: 1, comparisonOperator: "gte", windowSize: 50, consecutiveCount: 10, action: "stop", autoResumeAfterMinutes: 15 },
    ],
    notifyRoles: ["quality_inspector", "supervisor"],
    isBuiltIn: true,
  },
];

/**
 * Get all built-in templates
 */
export function getBuiltinTemplates(): QualityGateTemplate[] {
  return BUILTIN_TEMPLATES;
}

/**
 * Get a specific built-in template by ID
 */
export function getBuiltinTemplate(id: string): QualityGateTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id);
}
