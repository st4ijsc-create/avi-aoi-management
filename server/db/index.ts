// DB barrel - re-exports all domain modules for backward compatibility
// All imports from "../db" or "./db" continue to work

export * from "./connection";
export * from "./auth";
export * from "./hierarchy";
export * from "./product";
export * from "./inspection";
export * from "./layout";
export * from "./statistics";
// Wave R1 (doc 32) — report data aggregators (defect Pareto by category/severity/
// ipcSection, per-product yield, per-week yield trend, workstation NG heatmap).
export * from "./reportAggregators";
export * from "./alerts";
export * from "./production";
export * from "./machine";
export * from "./mqtt";
export * from "./system";
export * from "./dashboard";
export * from "./andonBoard";
export * from "./integration";
export * from "./spc";
export * from "./license";
export * from "./ai";
export * from "./aiAdvanced";
export * from "./aiSpecialist";
export * from "./processResult";
export * from "./bom";
export * from "./energy";
