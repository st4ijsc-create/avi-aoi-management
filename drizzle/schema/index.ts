// Schema barrel - re-exports all domain schemas for backward compatibility
// All imports from "../drizzle/schema" or "../../drizzle/schema" continue to work

export * from "./enums";
export * from "./auth";
export * from "./hierarchy";
export * from "./product";
export * from "./inspection";
export * from "./layout";
export * from "./production";
export * from "./scheduling";
export * from "./machine";
export * from "./alerts";
export * from "./mqtt";
export * from "./dashboard";
export * from "./system";
export * from "./ai";
export * from "./oee";
export * from "./integration";
export * from "./spc";
export * from "./license";
export * from "./mes";
export * from "./g3";
export * from "./ot";
export * from "./process";
export * from "./andon";
export * from "./interlock";
export * from "./robot";
export * from "./aiInsight";
export * from "./kb";
export * from "./masterdata";
export * from "./orchestration";
export * from "./edge";
export * from "./programming";
export * from "./federation";
export * from "./integrationOutbox";
export * from "./erpOauth";
export * from "./fleet";
export * from "./fleetResource";
export * from "./twin";
export * from "./safetyWorkforce";
export * from "./safetyZones";
export * from "./safetyVision";
export * from "./equipmentStandards";
export * from "./equipmentIntegration";
export * from "./fieldHealth";
export * from "./aiLoop";
export * from "./goldenSample";
export * from "./aiEmbeddingHead";
export * from "./controlAudit";
export * from "./factoryZones";
export * from "./hotFolder";
export * from "./aoiCommissioning";
export * from "./defectDisposition";
export * from "./measurementCorrections";
export * from "./productPanel";
export * from "./operatorBadge";
export * from "./componentLibrary";
export * from "./productOnboarding";
export * from "./reportArtifact";
export * from "./lineMaterials"; // doc 35 W4-C — feeder-verify + MSD floor-life + stencil cycle counter
export * from "./maintenanceParts"; // doc 35 W4-A — work-order spare-parts consumption ledger
export * from "./ncr"; // doc 35 W4-B — nonconformance reports + golden-revalidation flags
export * from "./ecn"; // doc 35 W4-D — engineering change control (ECN/ECO)
export * from "./routing"; // doc 35 W4-E — ISA-95 routing master + steps
export * from "./reportingMart"; // doc 35 W5-B — dim/fact reporting mart
export * from "./contracts"; // doc 44 W0-E — persisted LDS-L1 contract-schema registry (G2.5)
export * from "./assetRegistry"; // doc 44 W2-A2 — config-drift snapshots (G1.11)
export * from "./policyStore"; // doc 44 W3-A1 — policy-as-code store + append-only decision log (G3.11/G3.13)
export * from "./orderLifecycle"; // doc 44 W3-A3 — order lifecycle transitions (G3.6/G3.7, spec LDS-L3 §8.2)
export * from "./lineController"; // doc 44 W3-A2 — Line Controller FSM: line_states + line_state_transitions (G3.1)
